// Map / niveau (#19, #48) : bornes, obstacles AABB + meshes de l'arène urbaine.
// buildArena(scene) construit le décor ; obstacles est muté en place (jamais réassigné).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { UTOPIA_DATA } from './map-utopia-data.js';   // #205 : données générées depuis le blend (rivière/collines/colliders/ponts)

export const MAP_HALF = 24;
export const obstacles = [], obstacleMeshes = [];
// #203 : zones interdites au spawn ennemi (intérieurs de bâtiments utopia) — mutées en place comme obstacles
export const noSpawnZones = [];
export function inNoSpawnZone(x, z){ return noSpawnZones.some(b => x>=b.minX && x<=b.maxX && z>=b.minZ && z<=b.maxZ); }
// #204 : sol à hauteur variable — UNE surface praticable par (x,z). Zones analytiques posées
// par le build de chaque map (ordre = priorité, première zone qui matche gagne) ; table vide
// (portal/urban/fallback) = sol plat 0 partout, comportement historique inchangé.
export const groundZones = [];
export const playerSpawn = { x:0, z:0 };   // point d'apparition du joueur (muté par les builds, ex. utopia (0,3))
// #205 : bornes rectangulaires par map (mutées par les builds, reset ±MAP_HALF) — suivies par
// le clamp joueur, randomSpawn, le clamp ennemi et le pet.
export const MAP_BOUNDS = { minX:-MAP_HALF, maxX:MAP_HALF, minZ:-MAP_HALF, maxZ:MAP_HALF };
export function groundHeight(x, z){
  for(const g of groundZones){
    if(g.kind === 'rect'){ if(x>=g.minX && x<=g.maxX && z>=g.minZ && z<=g.maxZ) return g.y; }
    else if(g.kind === 'ramp'){                                   // rampe linéaire le long d'un axe (escalier lissé)
      if(x>=g.minX && x<=g.maxX && z>=g.minZ && z<=g.maxZ){
        const c = (g.axis === 'x') ? x : z;
        const t = Math.max(0, Math.min(1, (c - g.c0) / (g.c1 - g.c0)));
        return g.y0 + (g.y1 - g.y0) * t;
      }
    }
    else if(g.kind === 'arch'){                                   // #205 : pont en arche (parabole le long d'un axe)
      if(x>=g.minX && x<=g.maxX && z>=g.minZ && z<=g.maxZ){
        const c = (g.axis === 'x') ? x : z;
        const t = Math.max(0, Math.min(1, (c - g.c0) / (g.c1 - g.c0)));
        const u = 2*t - 1;
        return g.yEnd + (g.yApex - g.yEnd) * (1 - u*u);
      }
    }
    else if(g.kind === 'grid'){                                   // #205 : grille de hauteurs bilinéaire (collines)
      if(x>=g.minX && x<=g.maxX && z>=g.minZ && z<=g.maxZ){
        const fx = (x - g.minX) / (g.maxX - g.minX) * (g.nx - 1);
        const fz = (z - g.minZ) / (g.maxZ - g.minZ) * (g.nz - 1);
        const ix = Math.min(g.nx - 2, Math.floor(fx)), iz = Math.min(g.nz - 2, Math.floor(fz));
        const tx = fx - ix, tz = fz - iz, D = g.data, n = g.nx;
        return D[iz*n+ix]*(1-tx)*(1-tz) + D[iz*n+ix+1]*tx*(1-tz)
             + D[(iz+1)*n+ix]*(1-tx)*tz + D[(iz+1)*n+ix+1]*tx*tz;
      }
    } else {                                                      // disk / ring (centrés sur g.x, g.z)
      const r = Math.hypot(x - g.x, z - g.z);
      if(g.kind === 'disk'){ if(r <= g.r) return g.y; }
      else if(r >= g.r0 && r < g.r1) return g.y;
    }
  }
  return 0;
}
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
  // canaux Y : bout proche du centre raccourci de 2,4 (cf. blend) pour ne plus empiéter sur le
  // rebord de l'amphithéâtre (rHole 9.18) — le bout côté bâtiment ne bouge pas.
  [-5.44,-14.0,2.6,10.1],[5.44,-14.0,2.6,10.1],[-5.44,14.0,2.6,10.1],[5.44,14.0,2.6,10.1],
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
// #206 : porte des bâtiments du cœur = la baie vitrée frontale EXTÉRIEURE (côté opposé au centre
// de la place — l'autre côté est bloqué dehors par canal + parterre). Baie entre meneaux :
// lz ∈ s·[2.19, 4.28] (s = m·sign(cz)), soit z monde = cz + sign(cz)·[2.19, 4.28], largeur 2.09.
const UTOPIA_DOOR = { zIn:2.19, zOut:4.28, xClip:3.9 };
let utopiaDoorCount_ = 0, utopiaRoofCount_ = 0;
export function utopiaDoorCount(){ return utopiaDoorCount_; }
export function utopiaRoofCount(){ return utopiaRoofCount_; }
function addUtopiaBuildingColliders(cx, cz, m, doorSide = 0){
  for(const [lx, lz, w, d] of UTOPIA_BUILDING_BOXES){
    if(doorSide && lx === 4.36){   // vitre avant scindée autour de la baie-porte (#206)
      addCollider(cx + m*4.36, cz + m*doorSide*(-1.105), 0.3, 6.59);   // grand pan côté centre (lz s·[-4.4, 2.19])
      addCollider(cx + m*4.36, cz + m*doorSide*4.34, 0.3, 0.12);       // bouchon du meneau extérieur (lz s·[4.28, 4.4])
      continue;
    }
    addCollider(cx + m*lx, cz + m*lz, w, d);
  }
  noSpawnZones.push({ minX:cx-5.6, maxX:cx+5.6, minZ:cz-7.1, maxZ:cz+7.1 });   // pas de spawn ennemi dans les lobbys
}
// #206 : découpe visuelle de la baie-porte dans la vitre RDC (mesh *vitre0*, matériau propre
// VerreBleu.002) — plans de clipping en espace MONDE par instance (le GLB est cloné 8× à des
// positions/rotations différentes, le matériau est donc cloné par bâtiment), clipIntersection :
// le fragment n'est jeté que dans l'intersection des 3 demi-espaces = le trou, bords sur les
// meneaux. renderer.localClippingEnabled est activé côté main.js.
function cutBuildingGlassDoor(building, cx, cz, m, s){
  const zA = cz + m*s*UTOPIA_DOOR.zIn, zB = cz + m*s*UTOPIA_DOOR.zOut;
  const planes = [
    new THREE.Plane(new THREE.Vector3(0, 0, -1), Math.min(zA, zB)),      // jeté si z > zMin
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -Math.max(zA, zB)),      // jeté si z < zMax
    m > 0 ? new THREE.Plane(new THREE.Vector3(-1, 0, 0), cx + UTOPIA_DOOR.xClip)     // jeté si x > cx+3.9 (façade +x)
          : new THREE.Plane(new THREE.Vector3(1, 0, 0), -(cx - UTOPIA_DOOR.xClip)),  // jeté si x < cx−3.9 (façade −x)
  ];
  let cut = false;
  building.traverse(o => {
    if(!o.isMesh || !/vitre0/.test(o.name) || Array.isArray(o.material)) return;
    o.material = o.material.clone();
    o.material.clippingPlanes = planes;
    o.material.clipIntersection = true;
    cut = true;
  });
  if(cut) utopiaDoorCount_++;
}
// Tout matériau Blender en alpha BLEND (verre des vitres, eau des canaux/rivière, feuillage alpha...)
// charge en depthWrite:false via GLTFLoader — deux surfaces transparentes proches (ex. eau + plante,
// verre + pot) se trient alors mal entre elles et semblent flotter l'une derrière/à travers l'autre
// (glace "à l'intérieur" du bâtiment, lac "sous" les plantes, eau visible dans les escaliers du dessous).
// On force depthWrite sur TOUT matériau transparent — appliqué dans addProp, donc sur chaque prop
// de chaque map (le fix est générique, pas spécifique aux bâtiments utopia).
function fixTransparentDepthWrite(mesh){
  mesh.traverse(o => {
    if(!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for(const m of mats) if(m && m.transparent) m.depthWrite = true;
  });
}
// #204 : place-amphithéâtre enfoncée (mesures blend ×0.8) — fond −1.92, 3 gradins de 0.48,
// trou/rive du sol dallé à r=9.18 (frontière moteur = frontière visuelle), 4 escaliers cardinaux
// rendus praticables par des rampes lisses (le pas visuel de 0.24 ne mérite pas des marches moteur).
const AMPHI = { rFond:7.24, r1:7.92, r2:8.60, rHole:9.18, yFond:-1.92, y1:-1.44, y2:-0.96, y3:-0.48,
                stairHw:1.36, stairIn:6.88, rampFrom:7.02 };
function pushUtopiaGroundZones(){
  const Z = groundZones, A = AMPHI;
  // Socle du médaillon central (place.glb v2) AVANT tout : +0.176 au-dessus du fond, r 3.44
  Z.push({ kind:'disk', x:0, z:0, r:3.44, y:A.yFond + 0.176 });
  // 4 escaliers (rampes) AVANT les anneaux : dans leur rectangle, la rampe prime sur les gradins
  Z.push({ kind:'ramp', minX: A.stairIn, maxX: A.rHole, minZ:-A.stairHw, maxZ: A.stairHw, axis:'x', c0: A.rampFrom, c1: A.rHole, y0:A.yFond, y1:0 });
  Z.push({ kind:'ramp', minX:-A.rHole, maxX:-A.stairIn, minZ:-A.stairHw, maxZ: A.stairHw, axis:'x', c0:-A.rampFrom, c1:-A.rHole, y0:A.yFond, y1:0 });
  Z.push({ kind:'ramp', minX:-A.stairHw, maxX: A.stairHw, minZ: A.stairIn, maxZ: A.rHole, axis:'z', c0: A.rampFrom, c1: A.rHole, y0:A.yFond, y1:0 });
  Z.push({ kind:'ramp', minX:-A.stairHw, maxX: A.stairHw, minZ:-A.rHole, maxZ:-A.stairIn, axis:'z', c0:-A.rampFrom, c1:-A.rHole, y0:A.yFond, y1:0 });
  Z.push({ kind:'ring', x:0, z:0, r0:A.rFond, r1:A.r1, y:A.y1 });
  Z.push({ kind:'ring', x:0, z:0, r0:A.r1, r1:A.r2, y:A.y2 });
  Z.push({ kind:'ring', x:0, z:0, r0:A.r2, r1:A.rHole, y:A.y3 });
  Z.push({ kind:'disk', x:0, z:0, r:A.rFond, y:A.yFond });
  // #205 : ponts en arche + collines (grilles) + médaillons plats des ronds-points
  for(const b of UTOPIA_DATA.bridges)
    Z.push({ kind:'arch', minX:b.minX, maxX:b.maxX, minZ:b.minZ, maxZ:b.maxZ, axis:b.axis, c0:b.c0, c1:b.c1, yEnd:b.yEnd, yApex:b.yApex });
  for(const h of UTOPIA_DATA.hills)
    Z.push({ kind:'grid', minX:h.minX, maxX:h.maxX, minZ:h.minZ, maxZ:h.maxZ, nx:h.nx, nz:h.nz, data:h.data });
  for(const m of UTOPIA_DATA.medallions)
    Z.push({ kind:'disk', x:m.x, z:m.z, r:m.r, y:0.176 });
  // RdC des 8 bâtiments : dalle du blend à z=0.13 → terrasse +0.104 en jeu
  for(const [bx, bz] of UTOPIA_DATA.buildings)
    Z.push({ kind:'rect', minX:bx-4.16, maxX:bx+4.16, minZ:bz-5.76, maxZ:bz+5.76, y:0.104 });
}
async function buildUtopiaArena(scene){
  sceneRef = scene;
  try {
    if(typeof window !== 'undefined' && window.__FORCE_DECOR_FAIL__) throw new Error('decor force-fail (test)');
    // #205 : bâtiments ×8 (mêmes GLB/colliders, 4 nouveaux à z=±31.2) — aucun chargé → fallback
    let anyBuilding = null;
    for(const [bx, bz, m] of UTOPIA_DATA.buildings){
      const b = await addProp('decor/utopia/building.glb', { x:bx, z:bz, scale:0.8, rotY: m < 0 ? Math.PI : 0 });
      if(b) anyBuilding = b;
      // #206 : 4 bâtiments du cœur (|z|<20) = halls visitables par une baie-porte ;
      // 4 bâtiments extérieurs (z=±31.2) = toits accessibles par escalier (une seule surface par (x,z))
      const core = Math.abs(bz) < 20, s = m * Math.sign(bz);
      addUtopiaBuildingColliders(bx, bz, m, core ? s : 0);
      if(core && b) cutBuildingGlassDoor(b, bx, bz, m, s);
    }
    if(!anyBuilding) throw new Error('aucun batiment utopia charge');
    // #205 : sol du blend (dalles + socle + rails + néons/inlays + médaillons plats) — remplace
    // ENTIÈREMENT le sol code, les parapets d'enceinte v1 et la paroi de rive #204. Sans lui la
    // map n'a pas de sol → fallback. Idem place.glb (sinon le trou d'amphithéâtre serait un puits nu).
    const solGlb = await addProp('decor/utopia/sol.glb', { x:0, z:0, scale:0.8, shadow:false });
    if(!solGlb) throw new Error('sol utopia manquant');
    const placeGlb = await addProp('decor/utopia/place.glb', { x:0, z:0, scale:0.8, shadow:false });
    if(!placeGlb) throw new Error('amphitheatre utopia manquant');
    // Zones de sol + colliders du cœur (v1) + stèle + spawn dans la fosse
    pushUtopiaGroundZones();
    addCollider(-0.2, 0, 2.8, 2.6);                 // stèle/terminal au centre du fond
    playerSpawn.x = 0; playerSpawn.z = 3;
    for(const [cx, cz, w, d] of UTOPIA_CANALS) addCollider(cx, cz, w, d);
    for(const [cx, cz, w, d] of UTOPIA_PROPS_COLLIDERS) addCollider(cx, cz, w, d);
    // #205 : rivière (segments troués aux ponts), garde-corps des ponts, colliders d'instance
    for(const [cx, cz, w, d] of UTOPIA_DATA.river) addCollider(cx, cz, w, d);
    for(const b of UTOPIA_DATA.bridges) for(const [cx, cz, w, d] of b.rails) addCollider(cx, cz, w, d);
    for(const [cx, cz, w, d] of UTOPIA_DATA.colliders) addCollider(cx, cz, w, d);
    // Bandes de façade fleuries des 4 nouveaux bâtiments (au cœur, le parterre les couvre déjà)
    for(const [fx, fz] of [[-10.84, 31.2], [-10.84, -31.2], [10.84, 31.2], [10.84, -31.2]])
      addCollider(fx, fz, 1.5, 8.4);
    // #205 : bornes de la map complète (clamp joueur/ennemis/spawns/pet)
    MAP_BOUNDS.minX = UTOPIA_DATA.bounds.minX; MAP_BOUNDS.maxX = UTOPIA_DATA.bounds.maxX;
    MAP_BOUNDS.minZ = UTOPIA_DATA.bounds.minZ; MAP_BOUNDS.maxZ = UTOPIA_DATA.bounds.maxZ;
    // #205 : le reste de l'esplanade (résilient : la map reste jouable sans ces visuels)
    await addProp('decor/utopia/riviere.glb',    { x:0, z:0, scale:0.8, shadow:false });
    await addProp('decor/utopia/collines.glb',   { x:0, z:0, scale:0.8, shadow:false });
    await addProp('decor/utopia/vegetation.glb', { x:0, z:0, scale:0.8, shadow:false });
    await addProp('decor/utopia/avenue.glb',     { x:0, z:0, scale:0.8, shadow:false });
    await addProp('decor/utopia/tour.glb',       { x:0, z:0, scale:0.8, shadow:false });
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
  // img (#206) : visuel de la carte dans le panneau Map (optionnel — sans img, look icône)
  { id:'utopia', label:'Cité utopique',      build:buildUtopiaArena, img:'decor/utopia/background.png' },
];
const DEFAULT_MAP_ID = 'portal';

// Retire tout le décor de la map courante (meshes + colliders + lampes) avant de reconstruire —
// le cache GLB par URL (propCache_) est volontairement conservé (rebasculer plus tard sur la même
// map ne re-télécharge/re-parse rien).
export function clearArenaDecor(scene){
  for(const m of obstacleMeshes) scene.remove(m);
  for(const l of arenaLamps) scene.remove(l);
  obstacles.length = 0; obstacleMeshes.length = 0; arenaLamps.length = 0; noSpawnZones.length = 0;
  groundZones.length = 0; playerSpawn.x = 0; playerSpawn.z = 0;   // #204 : sol plat + spawn origine par défaut
  MAP_BOUNDS.minX = -MAP_HALF; MAP_BOUNDS.maxX = MAP_HALF; MAP_BOUNDS.minZ = -MAP_HALF; MAP_BOUNDS.maxZ = MAP_HALF;   // #205
  decorPropCount_ = 0; decorBackdropCount_ = 0;
  utopiaDoorCount_ = 0; utopiaRoofCount_ = 0;   // #206
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
    fixTransparentDepthWrite(mesh);
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
