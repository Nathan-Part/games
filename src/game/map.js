// Map / niveau (#19, #48) : bornes, obstacles AABB + meshes de l'arène urbaine.
// buildArena(scene) construit le décor ; obstacles est muté en place (jamais réassigné).
import * as THREE from 'three';

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
  wall:      () => new THREE.MeshStandardMaterial({ color:0x2c313c, roughness:0.95 }),
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

export function buildArena(scene){
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
