// Map / niveau (#19, #48) : bornes, obstacles AABB + meshes de l'arène urbaine.
// buildArena(scene) construit le décor ; obstacles est muté en place (jamais réassigné).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const MAP_HALF = 24;
export const obstacles = [], obstacleMeshes = [];
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
export async function buildArena(scene){
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
      await addProp('decor/forest/tree.glb', { x:tx, z:tz, scale:0.9+Math.random()*0.4, rotY:Math.random()*Math.PI*2, collider:{ w:0.6, d:0.6 } });
    }
    const rocks = [[-10,15],[9,-6],[-6,-17],[14,3]];
    for(const [rx, rz] of rocks){
      await addProp('decor/ruins/block.glb', { x:rx, z:rz, scale:0.5, rotY:Math.random()*Math.PI*2, collider:{ w:0.8, d:0.8 } });
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
      await addProp('decor/ruins/block.glb', { x:ex, z:ez, scale:0.9, rotY:Math.random()*Math.PI*2 });
    }
  } catch (e) {
    console.warn('[map] chargement du decor thematique KO, arene de secours activee:', e);
    // buildFallbackArena pousse dans obstacles/obstacleMeshes qui peuvent deja contenir des entrees
    // partielles issues du essai precedent — c'est acceptable (collision surabondante, jamais manquante).
    buildFallbackArena(scene);
  }
}

// ====== Props GLB (décor thématique) : chargement + collision optionnelle ======
const propLoader = new GLTFLoader();
let decorPropCount_ = 0, decorBackdropCount_ = 0;
export function decorPropCount(){ return decorPropCount_; }
export function decorBackdropCount(){ return decorBackdropCount_; }

export async function addProp(url, { x=0, z=0, y=0, scale=1, rotY=0, collider=null } = {}){
  try {
    const gltf = await propLoader.loadAsync(url);
    const mesh = gltf.scene;
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.scale.setScalar(scale);
    mesh.traverse(o => { if(o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
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
    const gltf = await propLoader.loadAsync(url);
    const mesh = gltf.scene;
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
