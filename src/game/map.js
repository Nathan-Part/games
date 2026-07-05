// Map / niveau (#19, #48) : bornes, obstacles AABB + meshes de l'arène urbaine.
// buildArena(scene) construit le décor ; obstacles est muté en place (jamais réassigné).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

export const MAP_HALF = 24;
export const obstacles = [], obstacleMeshes = [];
// #203 : zones interdites au spawn ennemi (intérieurs de bâtiments utopia) — mutées en place comme obstacles
export const noSpawnZones = [];
export function inNoSpawnZone(x, z){ return noSpawnZones.some(b => x>=b.minX && x<=b.maxX && z>=b.minZ && z<=b.maxZ); }
export const arenaLamps = [];   // lampes d'accent (éteintes quand la boutique est ouverte)
let sceneRef = null;

export function addBox(cx, cz, w, d, h){
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color:0x2a3550, roughness:0.8 }));
  mesh.position.set(cx, h/2, cz); mesh.castShadow = mesh.receiveShadow = true; sceneRef.add(mesh); obstacleMeshes.push(mesh);
  obstacles.push({ minX:cx-w/2, maxX:cx+w/2, minZ:cz-d/2, maxZ:cz+d/2 });
}
// ====== Vraie map / niveau (#19) : arène urbaine (enceinte + bâtiments + cover) ======
const levelMat = {
  concrete:  () => new THREE.MeshStandardMaterial({ color:0x3a3f4b, roughness:0.9,  metalness:0.05 }),
  concrete2: () => new THREE.MeshStandardMaterial({ color:0x4a4136, roughness:0.92 }),   // béton chaud (variation)
  wall:      () => new THREE.MeshStandardMaterial({ color:0x33362c, roughness:0.95 }),
};
export function addWall(cx, cz, w, d, h){
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), levelMat.wall());
  m.position.set(cx, h/2, cz); m.castShadow = m.receiveShadow = true; sceneRef.add(m); obstacleMeshes.push(m);
  obstacles.push({ minX:cx-w/2, maxX:cx+w/2, minZ:cz-d/2, maxZ:cz+d/2 }); return m;
}
export function addBuilding(cx, cz, w, d, h, opt = {}){
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), (opt.warm ? levelMat.concrete2() : levelMat.concrete()));
  m.position.set(cx, h/2, cz); m.castShadow = m.receiveShadow = true; sceneRef.add(m); obstacleMeshes.push(m);
  obstacles.push({ minX:cx-w/2, maxX:cx+w/2, minZ:cz-d/2, maxZ:cz+d/2 });
  if(opt.lit){   // bandeau lumineux (décor : pas de collision, masqué en boutique via obstacleMeshes)
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w*0.72, 0.2, d*0.72),
      new THREE.MeshStandardMaterial({ color:0xffe6bd, emissive:0xffb860, emissiveIntensity:0.9, roughness:0.5 }));
    strip.position.set(cx, h-0.18, cz); sceneRef.add(strip); obstacleMeshes.push(strip);
  }
  return m;
}

export function pointInObstacle(x, z){ return obstacles.some(b => x>=b.minX && x<=b.maxX && z>=b.minZ && z<=b.maxZ); }   // #48

// ====== Arène de secours (ex-arène urbaine) : filet de sécurité si le décor thématique échoue ======
function buildFallbackArena(scene){
  sceneRef = scene;
  addBox(-5, 6, 2, 2, 1.5); addBox(7, -4, 3, 1, 2); addBox(0, 12, 2, 2, 1.5);   // caisses d'origine (conservées)
  // mur d'enceinte (arène fermée + toile de fond) ; en retrait du bord (le clamp ±MAP_HALF reste libre)
  addWall(0, 22, 48, 1.6, 4); addWall(0, -22, 48, 1.6, 4); addWall(22, 0, 1.6, 48, 4); addWall(-22, 0, 1.6, 48, 4);
  // bâtiments (couloirs, angles, bloqueurs de vue) — évitent l'origine, le couloir +Z et les points d'ennemis testés
  addBuilding(-13, 13, 6, 6, 5, { lit:true }); addBuilding(-14, -12, 6, 7, 4.5, { warm:true });
  addBuilding(13, -13, 7, 6, 5, { warm:true, lit:true }); addBuilding(16, 8, 4, 8, 4.5); addBuilding(-17, 0, 3, 7, 4);
  // cover bas (barricades pour se mettre à couvert)
  addBox(8, 4, 2, 2, 1.2); addBox(-7, -6, 2.5, 1, 1.2); addBox(4, -10, 2, 2, 1.2); addBox(-3, 18, 3, 2, 1.4);
  // lampes d'accent chaudes (décor pur, sans ombre)
  const lamp1 = new THREE.PointLight(0xffcf9a, 0.6, 26); lamp1.position.set(-13, 6, 13); scene.add(lamp1);
  const lamp2 = new THREE.PointLight(0xffcf9a, 0.6, 26); lamp2.position.set(13, 6, -13); scene.add(lamp2);
  arenaLamps.push(lamp1, lamp2);
}

// ====== Nouvelle arène thématique (Portail des ruines) — resilience totale ======
async function buildPortalArena(scene){
  sceneRef = scene;
  try {
    if(typeof window !== 'undefined' && window.__FORCE_DECOR_FAIL__) throw new Error('decor force-fail (test)');
    // Tasks 9-13 ajoutent ici la construction du niveau thematique (portail, ruines, foret, chateau, decor lointain).

    // Zone portail (piece hero, centree en (0,-8))
    await addProp('decor/portal/arch.glb', { x:0, z:-8.5, scale:1.4, collider:{ w:3, d:1 } });
    await addProp('decor/portal/pillar.glb', { x:-1.8, z:-9.5, scale:1, collider:{ w:0.8, d:0.8 } });
    await addProp('decor/portal/pillar.glb', { x: 1.8, z:-9.5, scale:1, collider:{ w:0.8, d:0.8 } });
    await addProp('decor/portal/pillar.glb', { x:-1.8, z:-6.5, scale:1, collider:{ w:0.8, d:0.8 } });
    await addProp('decor/portal/pillar.glb', { x: 1.8, z:-6.5, scale:1, collider:{ w:0.8, d:0.8 } });
    const portalLight = new THREE.PointLight(0xb266ff, 1.4, 18); portalLight.position.set(0, 2.2, -8); scene.add(portalLight);
    arenaLamps.push(portalLight);

    // Zone ruines (cover), autour du portail
    await addProp('decor/ruins/block.glb', { x:-6, z:4,   rotY:0.4,  scale:1.1, collider:{ w:2.4, d:2.2 } });
    await addProp('decor/ruins/block.glb', { x:7,  z:2,   rotY:1.1,  scale:1.3, collider:{ w:2,   d:2.5 } });
    await addProp('decor/ruins/block.glb', { x:-8, z:-10, rotY:2.0,  scale:1,   collider:{ w:2,   d:2   } });
    await addProp('decor/ruins/block.glb', { x:6,  z:-14, rotY:0.7,  scale:1.2, collider:{ w:2.2, d:2   } });
    await addProp('decor/ruins/block.glb', { x:10, z:6,   rotY:2.6,  scale:0.7, collider:{ w:1,   d:1   } });

    // Zone foret (anneau exterieur) : troncs en cover ponctuel, clairieres degagees entre chaque instance
    const trees = [[-16,16],[-18,10],[-15,-4],[-19,-16],[14,17],[17,12],[16,-18],[-4,19],[3,-19],[11,-8]];
    for(const [tx, tz] of trees){
      await addProp('decor/forest/tree.glb', { x:tx, z:tz, scale:0.9+Math.random()*0.4, rotY:Math.random()*Math.PI*2, collider:{ w:0.6, d:0.6 }, shadow:false });
    }
    const rocks = [[-10,15],[9,-6],[-6,-17],[14,3]];
    for(const [rx, rz] of rocks){
      await addProp('decor/ruins/block.glb', { x:rx, z:rz, scale:0.5, rotY:Math.random()*Math.PI*2, collider:{ w:0.8, d:0.8 }, shadow:false });
    }

    // Exterieur du chateau (cote est de l'arene) - portes fermees, pas d'interieur (tranche future)
    await addProp('decor/castle/wall.glb',  { x:17, z:6,  scale:1.2, rotY:Math.PI/2, collider:{ w:2, d:8 } });
    await addProp('decor/castle/wall.glb',  { x:17, z:-9, scale:1.0, rotY:Math.PI/2, collider:{ w:2, d:6 } });
    await addProp('decor/castle/tower.glb', { x:18, z:-2, scale:1.3, collider:{ w:4, d:4 } });

    // Enceinte (identique en forme/collision a l'ancienne arene urbaine, juste re-habillee visuellement
    // via la recoloration de levelMat.wall ci-dessous) - buildArena ne reutilise pas buildFallbackArena,
    // ces 4 appels doivent donc etre repetes ici pour que l'arene ait bien une enceinte fermee.
    addWall(0, 22, 48, 1.6, 4); addWall(0, -22, 48, 1.6, 4); addWall(22, 0, 1.6, 48, 4); addWall(-22, 0, 1.6, 48, 4);

    // Decor lointain (hors enceinte, jamais de collider) : cite futuriste + montagnes
    await addBackdropProp('decor/backdrop/city_cluster.glb', { x:-38, z:0,  scale:3, rotY:0.3 });
    await addBackdropProp('decor/backdrop/mountain.glb',     { x:0,   z:45, scale:5 });

    // Rochers decoratifs le long de l'enceinte (pas de collider - le mur invisible+recolore fait deja la collision)
    const edgeRocks = [[-20,20],[0,21],[20,20],[-21,0],[21,0],[-20,-20],[0,-21],[20,-20]];
    for(const [ex, ez] of edgeRocks){
      await addProp('decor/ruins/block.glb', { x:ex, z:ez, scale:0.9, rotY:Math.random()*Math.PI*2, shadow:false });
    }
  } catch (e) {
    console.warn('[map] chargement du decor thematique KO, arene de secours activee:', e);
    // buildFallbackArena pousse dans obstacles/obstacleMeshes qui peuvent deja contenir des entrees
    // partielles issues du essai precedent — c'est acceptable (collision surabondante, jamais manquante).
    buildFallbackArena(scene);
  }
}

// ====== Map #203 : Cité utopique — dérivée de la scène Blender map_utopia.blend de Nathan ======
// Assets decor/utopia/ (GLB Draco). Échelle blend→jeu 0.8 ; game (x,z) = (0.8·bx, -0.8·by).
// Les colliders sont posés EN CODE (indépendants des GLB, qui sont purement visuels) : chaque
// valeur ci-dessous vient des bbox relevées dans la scène Blender (docs scratchpad inventaire).
function addCollider(cx, cz, w, d){ obstacles.push({ minX:cx-w/2, maxX:cx+w/2, minZ:cz-d/2, maxZ:cz+d/2 }); }
const UTOPIA_CANALS = [   // bassins/canaux infranchissables — aussi trous du sol dallé
  [-12.8,-6.8,10.9,2.3],[12.8,-6.8,10.9,2.3],[-12.8,6.8,10.9,2.3],[12.8,6.8,10.9,2.3],   // canaux X
  [-5.44,-12.8,2.6,12.5],[5.44,-12.8,2.6,12.5],[-5.44,12.8,2.6,12.5],[5.44,12.8,2.6,12.5], // canaux Y
];
const UTOPIA_PROPS_COLLIDERS = [
  [-10.8,-11.2,6,4],[10.8,-11.2,6,4],[-10.8,11.2,6,4],[10.8,11.2,6,4],                    // parterres fleuris (cover)
  [-3.44,10.4,1.4,1.4],[3.44,10.4,1.4,1.4],[-3.44,15.2,1.4,1.4],[3.44,15.2,1.4,1.4],      // pots
  [-3.44,-11.2,1.4,1.4],[3.44,-11.2,1.4,1.4],
  [-9.84,4.4,0.7,0.7],[10,-3.84,0.7,0.7],[-10,-16,0.7,0.7],                               // kiosques
  [-7.6,-7.6,0.5,0.5],[7.6,-7.6,0.5,0.5],[-7.6,7.6,0.5,0.5],[7.6,7.6,0.5,0.5],            // lampadaires
];
// Coquille d'un bâtiment (repère local, façade vers +x). Les ENTRÉES sont les deux angles
// ouverts de la loggia (design d'origine du blend, vitre élargie à l'export) — le centre de la
// façade est occupé côté rue par le parterre fleuri, donc vitre avant PLEINE au milieu.
// m=+1 rangée ouest, m=-1 rangée est (GLB tourné de π).
const UTOPIA_BUILDING_BOXES = [
  [ 4.36,0,0.3,8.8],                              // vitre avant (pleine, angles ouverts de part et d'autre)
  [-4.68,0,0.3,12.24],                            // vitre arrière
  [-1.02,-6.12,7.32,0.3],[-1.02,6.12,7.32,0.3],   // vitres latérales (raccourcies côté façade = passages d'angle)
  [ 4.54,5.8,0.5,0.5],[ 4.54,-6.2,0.5,0.5],       // piliers de colonnade aux angles d'entrée
  [-2.88,0,1.92,2.56],                            // noyau ascenseur (plein toute hauteur)
  [ 0.84,0,0.56,2.4],                             // comptoir d'accueil
  [ 0.16,3.12,3.2,3.2],                           // salon (canapés + table basse)
  [-1.9,-5.85,5.56,2.22],                         // salle vitrée d'angle nord-ouest (fermée : porte trop étroite)
];
function addUtopiaBuildingColliders(cx, cz, m){
  for(const [lx, lz, w, d] of UTOPIA_BUILDING_BOXES) addCollider(cx + m*lx, cz + m*lz, w, d);
  noSpawnZones.push({ minX:cx-5.6, maxX:cx+5.6, minZ:cz-7.1, maxZ:cz+7.1 });   // pas de spawn ennemi dans les lobbys
}
const utopiaMat = {
  marble: () => new THREE.MeshStandardMaterial({ color:0xe9edf4, roughness:0.4, metalness:0.05 }),
  padDark:() => new THREE.MeshStandardMaterial({ color:0x2b3138, roughness:0.5, metalness:0.3 }),
  neon:   () => new THREE.MeshStandardMaterial({ color:0x9fdcff, emissive:0x66ccff, emissiveIntensity:1.4, roughness:0.4 }),
};
async function buildUtopiaArena(scene){
  sceneRef = scene;
  try {
    if(typeof window !== 'undefined' && window.__FORCE_DECOR_FAIL__) throw new Error('decor force-fail (test)');
    // Bâtiments d'abord : sans eux la map n'a pas de sens → fallback si aucun ne charge
    const bWN = await addProp('decor/utopia/building.glb', { x:-16.64, z:-10.4, scale:0.8 });
    const bWS = await addProp('decor/utopia/building.glb', { x:-16.64, z: 10.4, scale:0.8 });
    const bEN = await addProp('decor/utopia/building.glb', { x: 16.64, z:-10.4, scale:0.8, rotY:Math.PI });
    const bES = await addProp('decor/utopia/building.glb', { x: 16.64, z: 10.4, scale:0.8, rotY:Math.PI });
    if(!bWN && !bWS && !bEN && !bES) throw new Error('aucun batiment utopia charge');
    addUtopiaBuildingColliders(-16.64, -10.4, 1); addUtopiaBuildingColliders(-16.64, 10.4, 1);
    addUtopiaBuildingColliders( 16.64, -10.4,-1); addUtopiaBuildingColliders( 16.64, 10.4,-1);
    // Sol dallé clair avec trous au droit des canaux (l'eau des GLB est en contrebas)
    const shape = new THREE.Shape();
    shape.moveTo(-MAP_HALF, -MAP_HALF); shape.lineTo(MAP_HALF, -MAP_HALF);
    shape.lineTo(MAP_HALF, MAP_HALF); shape.lineTo(-MAP_HALF, MAP_HALF); shape.closePath();
    for(const [cx, cz, w, d] of UTOPIA_CANALS){
      const h = new THREE.Path();
      h.moveTo(cx-w/2, cz-d/2); h.lineTo(cx-w/2, cz+d/2); h.lineTo(cx+w/2, cz+d/2); h.lineTo(cx+w/2, cz-d/2); h.closePath();
      shape.holes.push(h);
    }
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), utopiaMat.marble());
    floor.rotation.x = -Math.PI/2; floor.position.y = 0.02; floor.receiveShadow = true;
    scene.add(floor); obstacleMeshes.push(floor);
    // Enceinte : parapets de marbre blanc (même empreinte de collision que les autres maps)
    for(const [cx, cz, w, d] of [[0,22,48,1.6],[0,-22,48,1.6],[22,0,1.6,48],[-22,0,1.6,48]]){
      const p = new THREE.Mesh(new THREE.BoxGeometry(w, 2.5, d), utopiaMat.marble());
      p.position.set(cx, 1.25, cz); p.castShadow = false; p.receiveShadow = true;
      scene.add(p); obstacleMeshes.push(p); addCollider(cx, cz, w, d);
    }
    for(const [cx, cz, w, d] of UTOPIA_CANALS) addCollider(cx, cz, w, d);
    for(const [cx, cz, w, d] of UTOPIA_PROPS_COLLIDERS) addCollider(cx, cz, w, d);
    // Pad central lumineux (spawn) : disque sombre + anneau néon, fidèle aux images de référence
    const pad = new THREE.Mesh(new THREE.CircleGeometry(2.6, 48), utopiaMat.padDark());
    pad.rotation.x = -Math.PI/2; pad.position.y = 0.035; scene.add(pad); obstacleMeshes.push(pad);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.0, 3.35, 64), utopiaMat.neon());
    ring.rotation.x = -Math.PI/2; ring.position.y = 0.04; scene.add(ring); obstacleMeshes.push(ring);
    // Place fleurie + kiosques + lampadaires + canaux (GLB unique, déjà centré) — shadow:false (perf)
    await addProp('decor/utopia/plaza.glb', { x:0, z:0, scale:0.8, shadow:false });
    // Passerelles aériennes entre les toits (~10 m de haut : aucune collision au sol, décor pur)
    await addProp('decor/utopia/passerelles.glb', { x:0, z:0, scale:0.8, shadow:false });
    // Drone en vol lent au-dessus de la place (cosmétique) : va-et-vient + rotation via onBeforeRender
    const drone = await addProp('decor/utopia/drone.glb', { x:0, z:0, y:9, scale:0.8, shadow:false });
    if(drone){
      drone.onBeforeRender = () => {
        const t = performance.now() / 1000;
        drone.position.set(Math.sin(t*0.11)*10, 9 + Math.sin(t*0.7)*0.35, Math.cos(t*0.13)*8);
        drone.rotation.y = t * 0.2;
      };
    }
    // Lumière d'accent froide au-dessus du pad (l'ambiance jour vient de MAP_VISUALS côté main.js)
    const glow = new THREE.PointLight(0xbfe8ff, 0.6, 22); glow.position.set(0, 4, 0); scene.add(glow);
    arenaLamps.push(glow);
  } catch (e) {
    console.warn('[map] decor utopia KO, arene de secours activee:', e);
    buildFallbackArena(scene);
  }
}

// ====== Registre des maps (#201) — ajouter une map future = 1 entrée ici, aucun autre code d'UI requis ======
export const MAPS = [
  { id:'portal', label:'Portail des ruines', build:buildPortalArena },
  { id:'urban',  label:'Arène urbaine',      build:buildFallbackArena },
  { id:'utopia', label:'Cité utopique',      build:buildUtopiaArena },
];
const DEFAULT_MAP_ID = 'portal';

// Retire tout le décor de la map courante (meshes + colliders + lampes) avant de reconstruire —
// le cache GLB par URL (propCache_) est volontairement conservé (rebasculer plus tard sur la même
// map ne re-télécharge/re-parse rien).
export function clearArenaDecor(scene){
  for(const m of obstacleMeshes) scene.remove(m);
  for(const l of arenaLamps) scene.remove(l);
  obstacles.length = 0; obstacleMeshes.length = 0; arenaLamps.length = 0; noSpawnZones.length = 0;
  decorPropCount_ = 0; decorBackdropCount_ = 0;
}

export async function buildArena(scene, mapId = DEFAULT_MAP_ID){
  sceneRef = scene;
  const entry = MAPS.find(m => m.id === mapId) || MAPS.find(m => m.id === DEFAULT_MAP_ID);
  await entry.build(scene);
}

// ====== Props GLB (décor thématique) : chargement + collision optionnelle ======
const propLoader = new GLTFLoader();
// Draco (#203) : les GLB utopia sont compressés (fleurs = ~260K tris) ; décodeur servi par le
// même CDN unpkg que three lui-même (import map de game.html) — même profil de disponibilité.
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/gltf/');
propLoader.setDRACOLoader(dracoLoader);
const propCache_ = new Map();   // url -> Promise<THREE.Object3D> (le template chargé, non positionné)
let decorPropCount_ = 0, decorBackdropCount_ = 0;
export function decorPropCount(){ return decorPropCount_; }
export function decorBackdropCount(){ return decorBackdropCount_; }

// Charge le GLB une seule fois par URL (mutualisé entre addProp/addBackdropProp) ; les appels suivants
// clonent le template en mémoire au lieu de re-télécharger/re-parser le même fichier (ex. decor/ruins/block.glb
// utilisé 17x dans buildArena) — cf. finding audit "GLB charge N fois pour la meme URL".
async function loadPropTemplate_(url){
  if(!propCache_.has(url)) propCache_.set(url, propLoader.loadAsync(url).then(gltf => gltf.scene));
  return propCache_.get(url);
}

export async function addProp(url, { x=0, z=0, y=0, scale=1, rotY=0, collider=null, shadow=true } = {}){
  try {
    const template = await loadPropTemplate_(url);
    const mesh = template.clone();
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.scale.setScalar(scale);
    // shadow:false pour le décor répété en grand nombre (arbres, rochers) — chaque caster GLB coûte cher
    // à projeter dans la shadow map 2048×2048 du keyLight ; réservé aux pièces architecturales (portail/ruines/château).
    mesh.traverse(o => { if(o.isMesh){ o.castShadow = shadow; o.receiveShadow = true; } });
    sceneRef.add(mesh);
    obstacleMeshes.push(mesh);
    decorPropCount_++;
    if(collider){
      const { w, d } = collider;
      obstacles.push({ minX:x-w/2, maxX:x+w/2, minZ:z-d/2, maxZ:z+d/2 });
    }
    return mesh;
  } catch (e) {
    console.warn('[map] addProp echec:', url, e);
    return null;
  }
}

export async function addBackdropProp(url, { x=0, z=0, y=0, scale=1, rotY=0 } = {}){
  try {
    const template = await loadPropTemplate_(url);
    const mesh = template.clone();
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.scale.setScalar(scale);
    mesh.traverse(o => { if(o.isMesh){ o.castShadow = false; o.receiveShadow = false; } });
    sceneRef.add(mesh);
    obstacleMeshes.push(mesh);
    decorBackdropCount_++;
    return mesh;
  } catch (e) {
    console.warn('[map] addBackdropProp echec:', url, e);
    return null;
  }
}
