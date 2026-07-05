// Pet compagnon — chien de guerre (spec docs/superpowers/specs/2026-07-05-chien-loadout-et-multimap-design.md).
// Machine à états idle/follow/chase/attack : suit le joueur, attaque les ennemis proches.
// Devenu un bonus du système de loadout (#156, "série de points") — n'apparaît QUE via summon(),
// plus de compagnon permanent (ancien comportement : spec 2026-07-03, remplacé le 2026-07-05).
// Asset : pets/chien2/chien-rigged.glb (clips embarqués Walk_Cycle + Attack_Paw, tête vers +Z).
// window.__FAST_PET__ (tests) : primitive à la place du GLB, même machine à états.

const PET_URL = 'pets/chien2/chien-rigged.glb';
const PET_TARGET_H = 0.9;                          // moitié de la hauteur du joueur (1.8 m, cf. spawnModel)
const FOLLOW_DIST = 1.8, STOP_DIST = 1.1;          // hystérésis follow/idle
const SPEED_FOLLOW = 3.4, SPEED_CHASE = 4.6;
const DETECT_R = 7, ATTACK_R = 1.3, GIVEUP_R = 11;
const HIT_RANGE = 1.9;                             // tolérance à l'impact (cible qui recule)
const ATTACK_DURATION = 22/24, ATTACK_HIT_AT = 13/24;  // secondes (clip 24 fps, impact frame 13)
const ATTACK_DMG = 12, ATTACK_CD = 1.4;
const TELEPORT_R = 25, PET_R = 0.4;
const PET_HP = 150;              // vie du chien invoqué (plus l'ancien "invulnérable" permanent)
const PET_DESPAWN_S = 30;        // disparaît tout seul si non tué avant (temps de jeu)
const RETALIATE_DMG = 10;        // riposte de la cible si elle survit à l'attaque (combat symétrique, auto-contenu ici)

export function initPet(ctx){
  const { THREE, scene, loader, getPlayerPos, enemies, damageEnemy,
          obstacles, MAP_HALF, pushOutCircleAABB, registerFeature } = ctx;

  let group = null, mixer = null, walkAction = null, attackAction = null;
  let clipNames = [];
  let state = 'idle';           // idle | follow | chase | attack
  let target = null;
  let attackT = -1, hitDone = false;   // attaque en cours (timer) ; -1 = aucune
  let clock = 0, cdUntil = 0;
  let attackCount = 0;
  let loading = false, loaded = false;
  let hp = PET_HP, despawnAt = 0, pendingSummon = false;
  let groundY = 0;   // offset vertical calculé au chargement (pieds au sol) — jamais écrasé par un repositionnement X/Z

  function groundAndScale(g){
    // Normalise par la hauteur du SQUELETTE (pas la bbox — sous-estime certains modèles skinnés, cf.
    // pitfalls CLAUDE.md), pieds au sol : même technique que buildEnemyAssets pour les ennemis.
    g.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    let lo = Infinity, hi = -Infinity, hasBones = false;
    g.traverse(o => { if(o.isBone){ hasBones = true; o.getWorldPosition(v); lo = Math.min(lo, v.y); hi = Math.max(hi, v.y); } });
    const rigH = hasBones ? ((hi - lo) || 1) : 1;
    g.scale.setScalar(PET_TARGET_H / rigH);
    g.updateMatrixWorld(true);
    lo = Infinity;
    g.traverse(o => { if(o.isBone){ o.getWorldPosition(v); lo = Math.min(lo, v.y); } });
    if(hasBones) g.position.y -= lo;
    return g.position.y;
  }

  function buildFast(){
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, PET_TARGET_H, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x8899bb }));
    body.position.y = PET_TARGET_H / 2; g.add(body);
    return g;
  }

  function onReady(g){
    group = g;
    group.visible = false;             // ne s'affiche qu'à l'invocation (loadout) — plus de compagnon permanent
    scene.add(group);
    loaded = true; loading = false;
    if(pendingSummon){ pendingSummon = false; doSummon(); }
  }

  function load(){
    if(loading || loaded) return;
    loading = true;
    if(window.__FAST_PET__){ onReady(buildFast()); return; }
    loader.load(PET_URL, (gltf) => {
      const g = gltf.scene;
      groundY = groundAndScale(g);
      clipNames = gltf.animations.map(c => c.name);
      mixer = new THREE.AnimationMixer(g);
      const wc = THREE.AnimationClip.findByName(gltf.animations, 'Walk_Cycle');
      const ac = THREE.AnimationClip.findByName(gltf.animations, 'Attack_Paw');
      if(wc){ walkAction = mixer.clipAction(wc); walkAction.play(); walkAction.paused = true; }
      if(ac){ attackAction = mixer.clipAction(ac); attackAction.setLoop(THREE.LoopOnce, 1); }
      onReady(g);
    }, undefined, (err) => { loading = false; console.error('pet: échec chargement GLB', err); });
  }

  function placeNearPlayer(){
    if(!group) return;
    const p = getPlayerPos();
    group.position.set(p.x + 1.2, groundY, p.z + 1.2);
  }

  // Invocation (#156 loadout, touche 4) : appelée par summon() ci-dessous, ou différée si le GLB
  // n'est pas encore chargé (pendingSummon, cf. onReady).
  function doSummon(){
    hp = PET_HP; despawnAt = clock + PET_DESPAWN_S;
    target = null; attackT = -1; hitDone = false; cdUntil = 0; state = 'idle';
    group.visible = true;
    placeNearPlayer();
  }
  function summon(){
    if(!loaded){ load(); pendingSummon = true; return false; }
    doSummon();
    return true;
  }
  function die(){ group.visible = false; }         // tué au combat (riposte) — invocable de nouveau plus tard
  function despawn(){ group.visible = false; }      // délai écoulé sans avoir été tué

  function distTo(x, z){ return Math.hypot(group.position.x - x, group.position.z - z); }

  function nearestEnemy(range){
    let best = null, bd = range;
    for(const e of enemies){
      if(!e.alive) continue;
      const d = distTo(e.root.position.x, e.root.position.z);
      if(d < bd){ bd = d; best = e; }
    }
    return best;
  }

  function resolveCollisions(x, z){
    x = Math.max(-MAP_HALF, Math.min(MAP_HALF, x));
    z = Math.max(-MAP_HALF, Math.min(MAP_HALF, z));
    for(const b of obstacles){
      const o = pushOutCircleAABB(x, z, PET_R, b);
      x = o.x; z = o.z;
    }
    return { x, z };
  }

  // Pas de pathfinding : on tente la direction directe puis des angles de repli de plus en plus
  // ouverts (±40°/±80°/±120°) — le premier pas qui avance vraiment gagne (glissement le long des murs,
  // sinon le pet reste coincé contre les caisses/bâtiments de l'arène).
  function moveToward(x, z, speed, dt){
    const dx = x - group.position.x, dz = z - group.position.z;
    const d = Math.hypot(dx, dz); if(d < 1e-4) return;
    const base = Math.atan2(dx, dz);
    const step = speed * dt;
    for(const off of [0, 0.7, -0.7, 1.4, -1.4, 2.1, -2.1]){
      const a = base + off;
      const cand = resolveCollisions(group.position.x + Math.sin(a)*step,
                                     group.position.z + Math.cos(a)*step);
      const moved = Math.hypot(cand.x - group.position.x, cand.z - group.position.z);
      if(moved >= step * 0.4){
        group.position.x = cand.x; group.position.z = cand.z;
        group.rotation.y = a;                      // tête vers +Z → face à la direction du pas
        return;
      }
    }
  }

  function setWalking(on, fast){
    if(!walkAction) return;
    walkAction.paused = !on;
    if(on) walkAction.timeScale = fast ? 1.4 : 1.0;
  }

  function startAttack(){
    state = 'attack'; attackT = 0; hitDone = false;
    setWalking(false);
    if(attackAction){ attackAction.reset(); attackAction.play(); }
  }

  function update(dt){
    if(!group || !group.visible) return;
    clock += dt;
    if(clock >= despawnAt){ despawn(); return; }    // délai écoulé sans avoir été tué (#156)
    if(mixer) mixer.update(dt);

    if(attackT >= 0){                               // claque en cours : immobile
      attackT += dt;
      if(!hitDone && attackT >= ATTACK_HIT_AT){
        hitDone = true;
        if(target && target.alive && distTo(target.root.position.x, target.root.position.z) <= HIT_RANGE){
          damageEnemy(target, ATTACK_DMG); attackCount++;
          if(target.alive){                          // riposte si la cible survit (combat symétrique, contenu ici)
            hp = Math.max(0, hp - RETALIATE_DMG);
            if(hp <= 0){ die(); return; }
          }
        }
      }
      if(attackT >= ATTACK_DURATION){ attackT = -1; cdUntil = clock + ATTACK_CD; state = 'chase'; }
      return;
    }

    if(!target || !target.alive ||
       distTo(target.root.position.x, target.root.position.z) > GIVEUP_R){
      target = nearestEnemy(DETECT_R);
    }

    if(target){
      const d = distTo(target.root.position.x, target.root.position.z);
      if(d <= ATTACK_R && clock >= cdUntil){ startAttack(); return; }
      state = 'chase';
      moveToward(target.root.position.x, target.root.position.z, SPEED_CHASE, dt);
      setWalking(true, true);
      return;
    }

    const p = getPlayerPos();
    const d = distTo(p.x, p.z);
    if(d > TELEPORT_R){ placeNearPlayer(); }        // anti-blocage
    if(d > FOLLOW_DIST || (state === 'follow' && d > STOP_DIST)){
      state = 'follow';
      moveToward(p.x, p.z, SPEED_FOLLOW, dt);
      setWalking(true, false);
    } else {
      state = 'idle';
      setWalking(false);
    }
  }

  registerFeature({
    update,
    resetRun(){
      // Plus de compagnon permanent (#156) : chaque run démarre SANS chien tant qu'il n'est pas invoqué
      // via le loadout. Chargement paresseux conservé (évite un délai à la 1re invocation) mais reste caché.
      target = null; attackT = -1; hitDone = false; cdUntil = 0; state = 'idle';
      hp = PET_HP; despawnAt = 0; pendingSummon = false;
      if(group) group.visible = false;
      else if(!loaded) load();
    },
    onLobby(){
      target = null; attackT = -1;
      if(group) group.visible = false;
    },
  });

  return {                                          // getters pour l'API debug
    loaded: () => loaded,
    visible: () => !!(group && group.visible),
    pos: () => group ? { x: group.position.x, y: group.position.y, z: group.position.z } : { x:0, y:0, z:0 },
    state: () => state,
    attackCount: () => attackCount,
    setPos: (x, z) => { if(group) group.position.set(x, groundY, z); },
    clips: () => clipNames.slice(),
    summon: () => summon(),                         // invocation loadout (#156, touche 4)
    heightM: () => group ? new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3()).y : 0,
    hp: () => hp,
    maxHp: () => PET_HP,
    despawnTimeLeft: () => (group && group.visible) ? Math.max(0, despawnAt - clock) : 0,
    damage: (n) => { if(group && group.visible){ hp = Math.max(0, hp - n); if(hp <= 0) die(); } },   // test/debug
    forceDespawn: () => { despawnAt = clock; },      // test/debug : fait expirer le timer au prochain update()
  };
}
