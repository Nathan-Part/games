// Pet compagnon — chien (spec docs/superpowers/specs/2026-07-03-jeu-pet-chien-design.md).
// Machine à états idle/follow/chase/attack : suit le joueur, attaque les ennemis proches.
// Intégré via le registre de features (update/resetRun/onLobby) — aucun reset dispersé.
// Asset : pets/chien2/chien-rigged.glb (clips embarqués Walk_Cycle + Attack_Paw, tête vers +Z).
// window.__FAST_PET__ (tests) : primitive à la place du GLB, même machine à états.

const PET_URL = 'pets/chien2/chien-rigged.glb';
const SCALE = 0.5;
const FOLLOW_DIST = 1.8, STOP_DIST = 1.1;          // hystérésis follow/idle
const SPEED_FOLLOW = 3.4, SPEED_CHASE = 4.6;
const DETECT_R = 7, ATTACK_R = 1.3, GIVEUP_R = 11;
const HIT_RANGE = 1.9;                             // tolérance à l'impact (cible qui recule)
const ATTACK_DURATION = 22/24, ATTACK_HIT_AT = 13/24;  // secondes (clip 24 fps, impact frame 13)
const ATTACK_DMG = 12, ATTACK_CD = 1.4;
const TELEPORT_R = 25, PET_R = 0.4;

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

  function buildFast(){
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.4, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x8899bb }));
    body.position.y = 0.35; g.add(body);
    return g;
  }

  function onReady(g){
    group = g;
    group.visible = true;
    scene.add(group);
    placeNearPlayer();
    loaded = true; loading = false;
  }

  function load(){
    if(loading || loaded) return;
    loading = true;
    if(window.__FAST_PET__){ onReady(buildFast()); return; }
    loader.load(PET_URL, (gltf) => {
      const g = gltf.scene;
      g.scale.multiplyScalar(SCALE);
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
    group.position.set(p.x + 1.2, 0, p.z + 1.2);
  }

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
    if(mixer) mixer.update(dt);

    if(attackT >= 0){                               // claque en cours : immobile
      attackT += dt;
      if(!hitDone && attackT >= ATTACK_HIT_AT){
        hitDone = true;
        if(target && target.alive && distTo(target.root.position.x, target.root.position.z) <= HIT_RANGE){
          damageEnemy(target, ATTACK_DMG); attackCount++;
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
      target = null; attackT = -1; hitDone = false; cdUntil = 0; state = 'idle';
      if(!loaded){ load(); return; }               // chargement paresseux au 1er run
      group.visible = true;
      placeNearPlayer();
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
    setPos: (x, z) => { if(group) group.position.set(x, 0, z); },
    clips: () => clipNames.slice(),
  };
}
