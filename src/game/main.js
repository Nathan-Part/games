import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { captureRest, captureRestWorld, boneOrder, retargetClipWorld as retargetClipWorldShared } from '../shared/retarget.js';
import { worldPos, cameraRelative, locomotionState, resolveClipRole, pushOutCircleAABB } from './utils.js';
import { ANIM_DIR, PERSO_DIR, iconFor, animKeyFromFile, prettyLabel, listDir, isGlb, isImg, seedPersosToGallery, loadCharactersFromGallery } from './assets.js';
import { MAP_HALF, MAP_BOUNDS, obstacles, obstacleMeshes, arenaLamps, addBox, addWall, addBuilding, pointInObstacle, buildArena, addProp, addBackdropProp, decorPropCount, decorBackdropCount, MAPS, clearArenaDecor, noSpawnZones, inNoSpawnZone, groundHeight, playerSpawn, utopiaDoorCount, utopiaRoofCount } from './map.js';
import { updateFeatures, resetRunFeatures, lobbyFeatures, registerFeature } from './registry.js';
import { initPet } from './pet.js';
import { SAVE_KEY, save, persist, resetSave } from './save.js';
import { bindAudioVolume, initAudio, resumeAudio, playSound, playTone, setMuted, isMuted, applyVolume, audioGain, audioState, soundCount, lastSound } from './audio.js';

// ====== API debug (contrat figé) ======
const G = window.__game = {
  booted:false, phase:'lobby', characters:[], character:null,
  locomotion:'idle', clips:[], view:'third',
  position(){ return model ? worldPos(model) : {x:0,y:0,z:0}; },
  camera(){ return {x:camera.position.x,y:camera.position.y,z:camera.position.z, yaw:camYaw, pitch:camPitch, dist:camDist}; },
  debug:{},
};
// Helpers purs : voir src/game/utils.js
Object.assign(G.debug, { cameraRelative, locomotionState, resolveClipRole, pushOutCircleAABB });

// ====== Sauvegarde locale : voir src/game/save.js ======
const MONEY_PER_KILL = 10, MONEY_PER_WAVE = 25;
// ====== Modes de difficulté (#46) ======
const DIFFICULTIES = {
  facile:    { id:'facile',    name:'Facile',    hp:0.7, dmg:0.7, money:1.2 },
  normal:    { id:'normal',    name:'Normal',    hp:1.0, dmg:1.0, money:1.0 },
  difficile: { id:'difficile', name:'Difficile', hp:1.4, dmg:1.5, money:0.9 },
};
function curDiff(){ return DIFFICULTIES[(save.settings && save.settings.difficulty) || 'normal'] || DIFFICULTIES.normal; }
G.debug.difficulty = () => curDiff().id;
G.debug.setDifficulty = (id) => { if(DIFFICULTIES[id]){ save.settings.difficulty = id; persist(); if(typeof renderSettings === 'function') renderSettings(); } };
function addMoney(n){ n = Math.round(n * ksMoneyMultiplier()); save.money += n; runMoney_ += n; G.money = save.money; addLifetimeStat('moneyEarned', n); persist(); updateMoneyHud(); }   // #80 : moneyEarned cumulé ; runMoney_ = gagné cette partie
function recordScore(){ if(score > save.bestScore){ save.bestScore = score; persist(); } }
// ====== #157 Classement local (leaderboard top 5) ======
const LEADERBOARD_MAX = 5;
function submitScore(entry){
  const withDate = Object.assign({ date: new Date().toISOString() }, entry);
  save.leaderboard.push(withDate);
  save.leaderboard.sort((a,b) => b.score - a.score);
  const rank = save.leaderboard.indexOf(withDate);
  save.leaderboard = save.leaderboard.slice(0, LEADERBOARD_MAX);
  persist();
  return rank < LEADERBOARD_MAX ? rank + 1 : -1;
}
G.debug.leaderboard = () => JSON.parse(JSON.stringify(save.leaderboard));
G.debug.submitScore = (entry) => submitScore(entry);
G.debug.clearLeaderboard = () => { save.leaderboard = []; persist(); };
function updateMoneyHud(){ const el = document.getElementById('money-hud'); if(el) el.innerHTML = `${ico('coin')} ${save.money}`; }
function updateHomeMeta(){   // accueil : profil + intel + équipement (C-5 : <b> internes, garde l'icône SVG)
  const set = (id, v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
  const bw = save.bestWave || 0;
  set('home-money-v', save.money); set('home-record-v', bw);
  set('hub-rank-v', Math.floor(bw / 2) + 1);                                  // rang dérivé du record
  const xf = document.getElementById('hub-xp-fill'); if(xf) xf.style.width = ((bw % 2) / 2 * 100) + '%';
  set('intel-wave', bw);
  set('intel-bestscore', (save.leaderboard[0] && save.leaderboard[0].score) || 0);   // #157
  set('intel-prestige', (save.prestige||0) > 0 ? '★'+save.prestige : '—');            // #159
  set('intel-achievements', (save.unlockedAchievements||[]).length + '/' + ACHIEVEMENTS.length);   // #196
  let combo = 1; try { combo = comboMultiplier(save.bestCombo || 0); } catch(e){}
  set('intel-combo', 'x' + combo);
  set('hub-combo-v', 'x' + combo);   // chip haut-droite (refonte utopie)
  set('intel-money', save.money);
  let wName = '—'; try { wName = weaponById(save.selectedWeapon).name; } catch(e){}
  set('intel-weapon', wName);
  const accName = (slot) => { try { const a = accessoryItemById(save.equipped && save.equipped[slot]); return a ? a.name : 'Aucun'; } catch(e){ return '—'; } };
  set('intel-mask', accName('helmet'));
  set('intel-cost', accName('costume'));
}
G.money = save.money;
G.debug.save = {
  get(){ return JSON.parse(JSON.stringify(save)); },
  reset(){ resetSave(); G.money = save.money; updateMoneyHud(); if(typeof applyAllSettings === 'function') applyAllSettings(); },
  addMoney(n){ addMoney(n); }, raw(){ try { return localStorage.getItem(SAVE_KEY); } catch(e){ return null; } },
  live(){ return save; },   // accès direct à l'objet save en mémoire (pour tests de mutation)
  rates(){ return { perKill:MONEY_PER_KILL, perWave:MONEY_PER_WAVE }; },
};

// ====== Système de rareté (socle #24) : paliers partagés par toutes les vitrines ======
const RARITIES = {
  commun:     { id:'commun',     name:'Commun',     color:'#9aa3b2', tier:0 },
  rare:       { id:'rare',       name:'Rare',       color:'#4f9dff', tier:1 },
  epique:     { id:'epique',     name:'Épique',     color:'#b066ff', tier:2 },
  legendaire: { id:'legendaire', name:'Légendaire', color:'#ffb02e', tier:3 },
};
const RARITY_ORDER = ['commun','rare','epique','legendaire'];
function rarityInfo(key){ return RARITIES[key] || RARITIES.commun; }
function rarityBadge(key){ const r = rarityInfo(key);   // M-8 : le hex litéral ${r.color} reste dans le DOM (tests)
  return `<span class="rb" style="--rc:${r.color}">${r.name}</span>`; }
// ---- helpers UI refonte ----
function ico(name){ return `<svg class="ico" aria-hidden="true"><use href="#i-${name}"></use></svg>`; }
function statBar(label, pct, text){ const p = Math.max(4, Math.min(100, Math.round(pct)));   // M-7 : pct numérique
  return `<div class="statbar"><span class="lbl">${label}</span><span class="trk"><i style="width:${p}%"></i></span><span class="val">${text}</span></div>`; }
function itemCard(o){   // o:{rc,icon,name,rarity,sub,foot,on,owned,data,img,cls}
  // thumb : icône par défaut, recouverte par l'image `img` si fournie (onerror -> retire l'img, l'icône réapparaît)
  const thumb = `<div class="thumb${o.img?' has-img':''}">${ico(o.icon)}`
    + `${o.img?`<img class="thumb-img" src="${o.img}" alt="" loading="lazy" onerror="this.remove()">`:''}</div>`;
  return `<div class="icard${o.on?' on':''}${o.cls?' '+o.cls:''}"${o.data||''} style="--rc:${o.rc}">`
    + `${o.owned?`<span class="ribbon">${ico('check')}</span>`:''}`
    + thumb + `<div class="nm">${o.name}</div>`
    + `<div class="ic-meta">${rarityBadge(o.rarity)}${o.sub?`<span class="ic-sub">${o.sub}</span>`:''}</div>`
    + `<div class="ic-foot">${o.foot||''}</div></div>`; }

// ====== Accessoires 3D (#26) : casque/costume attachés aux os (remplace skins) ======
function buildHelmetVisor(){ const g=new THREE.Group();
  const steel=new THREE.MeshStandardMaterial({color:0x2b2f3a,metalness:0.6,roughness:0.4});
  const glass=new THREE.MeshStandardMaterial({color:0x101a2e,metalness:0.3,roughness:0.2,emissive:0x14233f});
  const dome=new THREE.Mesh(new THREE.SphereGeometry(0.13,18,12,0,Math.PI*2,0,Math.PI*0.62),steel);
  const visor=new THREE.Mesh(new THREE.BoxGeometry(0.22,0.06,0.16),glass); visor.position.set(0,0,0.07);
  g.add(dome,visor); g.traverse(o=>{if(o.isMesh)o.castShadow=true;}); return g; }
function buildHelmetCrown(){ const g=new THREE.Group();
  const gold=new THREE.MeshStandardMaterial({color:0xd2a93b,metalness:0.8,roughness:0.3,emissive:0x3a2c08});
  const band=new THREE.Mesh(new THREE.CylinderGeometry(0.135,0.135,0.06,20,1,true),gold); band.position.y=0.06;
  for(let i=0;i<6;i++){const a=i/6*Math.PI*2; const sp=new THREE.Mesh(new THREE.ConeGeometry(0.03,0.10,8),gold);
    sp.position.set(Math.cos(a)*0.135,0.13,Math.sin(a)*0.135); g.add(sp);} g.add(band);
  g.traverse(o=>{if(o.isMesh)o.castShadow=true;}); return g; }
function buildHelmetHalo(){ const g=new THREE.Group();
  const halo=new THREE.MeshStandardMaterial({color:0xffe08a,emissive:0xffb02e,emissiveIntensity:0.9,metalness:0.4,roughness:0.4});
  const ring=new THREE.Mesh(new THREE.TorusGeometry(0.12,0.018,10,28),halo); ring.rotation.x=Math.PI/2; ring.position.y=0.18;
  g.add(ring); g.traverse(o=>{if(o.isMesh)o.castShadow=true;}); return g; }
function buildCostumePlate(){ const g=new THREE.Group();
  const steel=new THREE.MeshStandardMaterial({color:0x6a7180,metalness:0.7,roughness:0.4});
  const chest=new THREE.Mesh(new THREE.BoxGeometry(0.32,0.30,0.09),steel); chest.position.set(0,0.04,0.07);
  const shL=new THREE.Mesh(new THREE.SphereGeometry(0.10,12,10),steel); shL.position.set(-0.21,0.16,0.02);
  const shR=shL.clone(); shR.position.x=0.21; g.add(chest,shL,shR);
  g.traverse(o=>{if(o.isMesh)o.castShadow=true;}); return g; }
function buildCostumeCape(){ const g=new THREE.Group();
  const cloth=new THREE.MeshStandardMaterial({color:0x7a1f2b,roughness:0.9,side:THREE.DoubleSide});
  const cape=new THREE.Mesh(new THREE.PlaneGeometry(0.42,0.7),cloth); cape.position.set(0,-0.18,-0.12); cape.rotation.x=-0.18;
  g.add(cape); g.traverse(o=>{if(o.isMesh)o.castShadow=true;}); return g; }
function buildCostumeWings(){ const g=new THREE.Group();
  const wing=new THREE.MeshStandardMaterial({color:0xeaf2ff,emissive:0x6a86c0,roughness:0.6,side:THREE.DoubleSide});
  const wL=new THREE.Mesh(new THREE.PlaneGeometry(0.34,0.5),wing); wL.position.set(-0.2,0,-0.10); wL.rotation.set(0,0.6,0.2);
  const wR=wL.clone(); wR.position.x=0.2; wR.rotation.set(0,-0.6,-0.2); g.add(wL,wR);
  g.traverse(o=>{if(o.isMesh)o.castShadow=true;}); return g; }
// Accessoires « vrais » (images PNG/JPG fournies dans artefact/accessory/). build:null pour l'instant
// (pas d'accroche 3D — viendra plus tard). L'image de carte vient du champ `img`, la fiche des champs `desc`/`bonuses`.
const HELMETS = [
  { id:'helm:none',  name:'Aucun',        price:0,    rarity:'commun',     build:null, img:null,
    desc:'Visage à découvert. Rien à cacher, rien à craindre.', bonuses:[] },
  { id:'helm:insect', name:'Insectoïde',  price:400,  rarity:'rare',       build:null,
    img:'artefact/accessory/mask/insect-viber/insect-viber.png',
    desc:'Masque de chasse aux reflets chitineux. Pour ceux qui frappent avant qu\'on les voie.',
    bonuses:[ { icon:'eye',    name:'Vision de traque', desc:'Repère ta cible dans le chaos.' },
              { icon:'sprint', name:'Instinct',         desc:'Réagis plus vite à la menace.' },
              { icon:'target', name:'Précision',        desc:'Chaque tir vise juste.' } ] },
  { id:'helm:skull-soldier', name:'Crâne Soldat', price:800, rarity:'epique', build:null,
    img:'artefact/accessory/mask/skeleton-soldier/squelette-soldier.png',
    desc:'La mort en uniforme. Un masque taillé pour hanter le champ de bataille.',
    bonuses:[ { icon:'shield', name:'Intimidation', desc:'Ta seule présence fait reculer l\'ennemi.' },
              { icon:'medal',  name:'Vétéran',      desc:'Le calme de ceux qui ont tout vu.' },
              { icon:'flash',  name:'Frappe nette', desc:'Aucune hésitation au moment d\'agir.' } ] },
  { id:'helm:skull-ram', name:'Crâne Bélier', price:1500, rarity:'legendaire', build:null,
    img:'artefact/accessory/mask/skeleton-ram/squelette-belier.png',
    desc:'Cornes d\'os et regard vide. Le symbole de ceux qui enfoncent les lignes.',
    bonuses:[ { icon:'trophy', name:'Domination', desc:'Impose ton autorité dès ton apparition.' },
              { icon:'sprint', name:'Charge',     desc:'Rien ne t\'arrête une fois lancé.' },
              { icon:'heart',  name:'Terreur',    desc:'Une légende ne meurt jamais vraiment.' } ] },
];
const COSTUMES = [
  { id:'cost:none',  name:'Aucun',         price:0,    rarity:'commun',     build:null, img:null,
    desc:'Tenue standard. Sobre et fonctionnelle.', bonuses:[] },
  { id:'cost:insect', name:'Carapace Insecte', price:700, rarity:'epique', build:null,
    img:'artefact/accessory/suit/insect-viber/insect-viber.png',
    desc:'Blindage biomimétique articulé. Léger, résistant, imprévisible.',
    bonuses:[ { icon:'shield', name:'Carapace',  desc:'Encaisse là où les autres tombent.' },
              { icon:'sprint', name:'Agilité',   desc:'Bouge comme si tu ne pesais rien.' },
              { icon:'flash',  name:'Réflexes',  desc:'Esquive avant même de penser.' } ] },
  { id:'cost:bone',  name:'Armure Ossuaire', price:1400, rarity:'legendaire', build:null,
    img:'artefact/accessory/suit/skeleton-ram/skeleton-ram.png',
    desc:'Plaques d\'os fossilisé serties sur l\'acier. L\'armure des seigneurs de guerre.',
    bonuses:[ { icon:'trophy', name:'Prestige',   desc:'Affiche ton statut sur le champ de bataille.' },
              { icon:'shield', name:'Forteresse', desc:'Un rempart que rien ne fait plier.' },
              { icon:'medal',  name:'Légende',    desc:'Rien n\'égale un roi sur le terrain.' } ] },
];
const ACCESSORY_SLOTS = { helmet:HELMETS, costume:COSTUMES };
const ACCESSORY_BONE = { helmet:{ name:'Head', re:/head/i, off:{x:0,y:0.10,z:0.04} },
                         costume:{ name:'Spine2', re:/spine2|chest|spine1|spine/i, off:{x:0,y:0.10,z:0} } };
function accessoryById(slot, id){ return (ACCESSORY_SLOTS[slot]||[]).find(a => a.id === id) || null; }
function accessoryItemById(id){ return HELMETS.find(a=>a.id===id) || COSTUMES.find(a=>a.id===id) || null; }
function findBoneNamed(root, exact, re){ let b=null; root.traverse(o=>{ if(o.isBone && o.name===exact) b=o; });
  if(!b) root.traverse(o=>{ if(o.isBone && !b && re.test(o.name)) b=o; }); return b; }
function clearBoneTag(root, tag){ const rm=[]; root.traverse(o=>{ if(o.userData && o.userData.accSlot===tag) rm.push(o); });
  for(const o of rm){ if(o.parent) o.parent.remove(o); } }
function clearAccessory(root, slot){ clearBoneTag(root, slot); }
// attache un mesh à un os : offset donné en MONDE (m) ; on annule rotation+échelle de l'os pour un placement intuitif
function attachToBoneWorld(bone, mesh, tag, off){
  bone.updateWorldMatrix(true, false);
  const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
  bone.matrixWorld.decompose(wp, wq, ws);
  const inv = 1 / (ws.x || 1), iq = wq.clone().invert();
  mesh.scale.multiplyScalar(inv);                          // taille réelle (annule l'échelle monde de l'os)
  mesh.quaternion.copy(iq);                                // aligné MONDE au repos (suit ensuite les mouvements de l'os)
  const local = new THREE.Vector3(off.x, off.y, off.z).applyQuaternion(iq);
  mesh.position.set(local.x * inv, local.y * inv, local.z * inv);   // offset MONDE converti en local de l'os
  mesh.userData.accSlot = tag; bone.add(mesh);
}
function applyAccessories(root){
  if(!root) return;
  for(const slot of ['helmet','costume']){
    clearAccessory(root, slot);
    const a = accessoryById(slot, save.equipped[slot]); if(!a || !a.build) continue;
    const spec = ACCESSORY_BONE[slot], bone = findBoneNamed(root, spec.name, spec.re); if(!bone) continue;
    attachToBoneWorld(bone, a.build(), slot, spec.off);
  }
}
function buyAccessory(id){
  const a = accessoryItemById(id); if(!a) return false;
  if(save.ownedAccessories.includes(id) || save.money < a.price) return false;
  save.money -= a.price; G.money = save.money; save.ownedAccessories.push(id);
  persist(); updateMoneyHud(); updateHomeMeta(); return true;
}
function selectAccessory(slot, id){
  if(!ACCESSORY_SLOTS[slot] || !accessoryById(slot, id) || !save.ownedAccessories.includes(id)) return false;
  save.equipped[slot] = id; persist(); applyAccessories(model); return true;
}
// ---- Essayer avant d'acheter : aperçu d'un accessoire sur le perso sans le posséder/équiper ----
let shopAccPreview = { helmet:null, costume:null };
function previewAccessory(slot, id){
  if(!model || !ACCESSORY_SLOTS[slot]) return false;
  const a = accessoryById(slot, id); if(!a) return false;
  shopAccPreview[slot] = id;
  clearAccessory(model, slot);                              // retire le mesh courant de ce slot
  if(a.build){ const spec = ACCESSORY_BONE[slot], bone = findBoneNamed(model, spec.name, spec.re);
    if(bone) attachToBoneWorld(bone, a.build(), slot, spec.off); }   // attache l'aperçu (même non possédé)
  return true;
}
function clearAccessoryPreview(){                            // restaure l'état réellement équipé sur le perso
  shopAccPreview = { helmet:null, costume:null };
  if(model) applyAccessories(model);
}
G.debug.playerAccessory = (slot) => save.equipped[slot];
G.debug.accessoryAttached = (slot) => { if(!model) return false; let f=false; model.traverse(o=>{ if(o.userData && o.userData.accSlot===slot) f=true; }); return f; };
// (les debug shop.accessory* sont ajoutés après la définition de G.debug.shop, plus bas)


// ====== Réglages (#18) : sensibilité souris / volume / vue par défaut (persistés) ======
let lookSensitivity = 1;
bindAudioVolume(() => save.settings.volume);   // le module audio lit le volume des réglages (voir src/game/audio.js)
function applyAllSettings(){ lookSensitivity = save.settings.sensitivity; applyVolume(); }
function setSetting(key, val){
  if(!save.settings || !(key in save.settings)) return false;
  if(key === 'sensitivity'){ const n=+val; val = isFinite(n) ? Math.max(0.2, Math.min(3, n)) : save.settings.sensitivity; }   // bornes slider (évite visée figée à 0)
  if(key === 'volume'){ const n=+val; val = isFinite(n) ? Math.max(0, Math.min(1, n)) : save.settings.volume; }                // bornes slider (évite gain négatif/>1)
  save.settings[key] = val; persist();
  if(key === 'sensitivity') lookSensitivity = val;
  if(key === 'volume') applyVolume();
  return true;
}
lookSensitivity = save.settings.sensitivity;   // init sensibilité (le volume s'applique à l'init audio, masterGain pas encore déclaré ici)
G.debug.settings = {
  get(){ return JSON.parse(JSON.stringify(save.settings)); },
  set(k, v){ return setSetting(k, v); },
  sensitivity(){ return lookSensitivity; },
  gain(){ return audioGain(); },
};

// ====== Moteur ======
const app = document.getElementById('app');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a16);
scene.fog = new THREE.Fog(0x0a0a16, 18, 60);
const SCENE_BG = new THREE.Color(0x0a0a16), SCENE_FOG = scene.fog;
// #203 : visuels de match PAR MAP — bg devient la skybox équirectangulaire une fois chargée (utopia)
const MAP_VISUALS = {
  portal: { bg:0x0a0a16, fog:[0x0a0a16,18,60],   grid:false, stars:true,  hemi:0.9, key:[0xfff2e0,2.4] },
  urban:  { bg:0x0a0a16, fog:[0x0a0a16,18,60],   grid:true,  stars:true,  hemi:0.9, key:[0xfff2e0,2.4] },
  // #205 : map complète — fog lointain (esplanade 153×185), ombres élargies, far caméra poussé,
  // sol bitume urbain masqué (utopia apporte son propre sol GLB, coplanaire sinon)
  utopia: { bg:0xbfdcff, fog:[0xdceafc,60,260],  grid:false, stars:false, hemi:1.6, key:[0xfff8ec,3.0], sky:'decor/utopia/skybox.jpg', shadowHalf:100, far:420, urbanGround:false },
};
let matchBg_ = SCENE_BG, matchFog_ = SCENE_FOG, matchHemi_ = 0.9;
const skyCache_ = {};   // url -> Texture équirect (chargée une fois, survit aux switchs de map)

const camera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 0.1, 200);
camera.position.set(0, 3, -6);

const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });   // alpha : en lobby le canvas est transparent au-dessus du fond CSS (assets/img/lobby-bg.jpg)
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;   // #206 : baies-portes/encoches découpées par clippingPlanes (map.js)
app.appendChild(renderer.domElement);

const hemi = new THREE.HemisphereLight(0x9bb6ff, 0x1a1d26, 0.9); scene.add(hemi);
const keyLight = new THREE.DirectionalLight(0xfff2e0, 2.4);   // key chaude (urbain)
keyLight.position.set(8, 14, 6); keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048,2048); keyLight.shadow.camera.far = 60;
keyLight.shadow.camera.left=-20; keyLight.shadow.camera.right=20;
keyLight.shadow.camera.top=20; keyLight.shadow.camera.bottom=-20;
scene.add(keyLight);

// MAP_HALF : importé de src/game/map.js
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(MAP_HALF*2, MAP_HALF*2),
  new THREE.MeshStandardMaterial({ color:0x23262e, roughness:0.96 }));   // bitume urbain
ground.rotation.x = -Math.PI/2; ground.receiveShadow = true; scene.add(ground);
const grid = new THREE.GridHelper(MAP_HALF*2, MAP_HALF, 0x39435c, 0x20252f); scene.add(grid);
grid.visible = false;   // theme "portail des ruines" : sol naturel, la grille technique urbaine ne convient plus
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(300 * 3);
for(let i=0;i<300;i++){
  starPos[i*3]   = (Math.random()-0.5) * 160;
  starPos[i*3+1] = 30 + Math.random() * 40;
  starPos[i*3+2] = (Math.random()-0.5) * 160;
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const starMat = new THREE.PointsMaterial({ color:0xffffff, size:0.4, transparent:true, opacity:0.85, depthWrite:false });
const stars = new THREE.Points(starGeo, starMat); scene.add(stars);
// disque récepteur d'ombre (lobby uniquement) : ancre visuellement le perso au podium du fond utopie
const lobbyShadow = new THREE.Mesh(new THREE.CircleGeometry(2.4, 40), new THREE.ShadowMaterial({ opacity:0.3 }));
lobbyShadow.rotation.x = -Math.PI/2; lobbyShadow.position.y = 0.02; lobbyShadow.receiveShadow = true;
lobbyShadow.visible = false; scene.add(lobbyShadow);
const shopLight = new THREE.DirectionalLight(0xbcd0ff, 0); shopLight.position.set(2.4, 3, 3.4); scene.add(shopLight); // appoints vitrine boutique
const shopFill  = new THREE.DirectionalLight(0xfff0d8, 0); shopFill.position.set(-3, 2.2, 2.6); scene.add(shopFill);

const loader = new GLTFLoader();

// ====== État partagé (rempli par les tasks suivantes) ======
let model = null, mixer = null, lobbyIdle = false;
let velY = 0, grounded = true, groundY = 0, doubleJumpAvailable = false;   // #135
const CAM_DIST = 5.5; let camYaw = 0, camPitch = 0.25, camDist = 5.5;
const JUMP_SPEED = 6, GRAVITY = 18;
// #204 : sol à hauteur variable — montée ≤ STEP_UP_MAX instantanée (gradins 0.48, marches, RdC),
// au-delà = mur ; descente > STEP_DOWN_SNAP = chute (joueur) / glisse à ENEMY_DESCENT_SPEED (ennemis)
const STEP_UP_MAX = 0.55, STEP_DOWN_SNAP = 0.5, ENEMY_DESCENT_SPEED = 8;
// Dégâts de chute (demande Nathan, cohérence avec les toits #206 à 9.64 m sans garde-corps côté
// escalier) : aucun dégât sous FALL_SAFE (sauts normaux ~1 m, petites marches) ; au-delà, dégâts
// proportionnels à la hauteur de chute, plafonnés (jamais léthal à eux seuls). airPeakY_ suit le
// point le plus haut atteint pendant la phase aérienne (init paresseuse dans updateController —
// couvre saut ET pas dans le vide, sans toucher les handlers de saut).
const FALL_SAFE = 3.0, FALL_DMG_PER_M = 5, FALL_DMG_MAX = 40;
let airPeakY_ = null;
const EYE_HEIGHT = 1.62;                       // hauteur des yeux (vue 1re personne)
let view = 'third';                            // 'third' | 'first'
function applyViewVisibility(){ if(model) model.visible = (view === 'third'); } // masqué en FPS (viewmodel à la place)
function setView(v){
  view = (v === 'first') ? 'first' : 'third';
  G.view = view; applyViewVisibility(); clampPitch();   // recale le pitch dans la plage du mode
  if(viewModel) viewModel.visible = (view === 'first');
}
function toggleView(){ setView(view === 'first' ? 'third' : 'first'); }

// ====== Map : obstacles + bornes — voir src/game/map.js ======
const PLAYER_R = 0.45;
function applyMapVisuals(mapId){   // #203 : ambiance de match par map (fond/fog/lumières/grille/étoiles)
  const v = MAP_VISUALS[mapId] || MAP_VISUALS.portal;
  matchBg_ = new THREE.Color(v.bg);
  matchFog_ = new THREE.Fog(v.fog[0], v.fog[1], v.fog[2]);
  matchHemi_ = v.hemi;
  keyLight.color.setHex(v.key[0]); keyLight.intensity = v.key[1];
  grid.visible = !!v.grid; stars.visible = !!v.stars;
  // #205 : ombres + far caméra par map (grande esplanade utopia)
  const sh = v.shadowHalf || 20;
  keyLight.shadow.camera.left = -sh; keyLight.shadow.camera.right = sh;
  keyLight.shadow.camera.top = sh; keyLight.shadow.camera.bottom = -sh;
  keyLight.shadow.camera.far = sh >= 100 ? 280 : 60;
  keyLight.shadow.camera.updateProjectionMatrix();
  camera.far = v.far || 200; camera.updateProjectionMatrix();
  // NB : appelée au boot avant l'état boutique/lobby → ne PAS appeler updateShopScene ici ;
  // c'est elle qui relira matchBg_/matchFog_/matchHemi_ à chaque changement d'état.
  if(v.sky){   // skybox panoramique : remplace la couleur unie une fois chargée (résilient : couleur sinon)
    if(skyCache_[v.sky]) matchBg_ = skyCache_[v.sky];
    else new THREE.TextureLoader().load(v.sky, tex => {
      tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.SRGBColorSpace;
      skyCache_[v.sky] = tex;
      if(save.settings.mapId === mapId){ matchBg_ = tex; updateShopScene(); }   // callback post-boot : sans risque
    });
  }
}
// Décor de la map chargé À LA DEMANDE (retour Nathan 2026-07-06 : le boot ne doit plus attendre le
// décor, seulement le lobby/perso — le décor (lourd sur utopia) se charge au clic sur "Déployer",
// ou plus tôt si l'utilisateur change de map depuis le panneau avant même de jouer). `ensureArenaReady`
// est idempotente (ne reconstruit pas si déjà prête) et dédoublonne les appels concurrents via la promesse.
let arenaReady = false, arenaBuildPromise = null;
async function ensureArenaReady(){
  if(arenaReady) return;
  if(!arenaBuildPromise) arenaBuildPromise = buildArena(scene, save.settings.mapId).then(() => {
    applyMapVisuals(save.settings.mapId); arenaReady = true;
  });
  await arenaBuildPromise;
}
// Reconstruit la map à chaud (#201 multi-map) : retire le décor courant puis (re)construit la map choisie.
// Le registre MAPS (map.js) est la seule source de vérité — ajouter une map = 1 entrée, pas de code ici à changer.
async function switchMap(id){
  if(!MAPS.some(m => m.id === id) || id === save.settings.mapId) return false;
  document.getElementById('boot-loading-msg').textContent = 'Chargement du décor…';
  document.getElementById('boot-loading').classList.remove('hidden');
  clearArenaDecor(scene);
  setSetting('mapId', id);
  arenaReady = false; arenaBuildPromise = null;   // force la reconstruction pour la nouvelle map
  await ensureArenaReady();
  updateShopScene();   // re-masque le décor fraîchement construit si on est encore dans la vitrine lobby
  document.getElementById('boot-loading').classList.add('hidden');
  return true;
}
G.debug.mapHalf = MAP_HALF;
G.debug.obstacleCount = () => obstacles.length;
G.debug.pointInObstacle = (x, z) => pointInObstacle(x, z);
G.debug.setObstacleTest = (cx, cz) => addBox(cx, cz, 2, 2, 1.5);
G.debug.mapTheme = () => ({ bg: '#' + new THREE.Color((MAP_VISUALS[save.settings.mapId] || MAP_VISUALS.portal).bg).getHexString(), gridVisible: grid.visible });   // couleur du thème (stable même quand la skybox texture remplace le fond)
G.debug.starsVisible = () => stars.visible;
G.debug.noSpawnZoneCount = () => noSpawnZones.length;
G.debug.inNoSpawnZone = (x, z) => inNoSpawnZone(x, z);
G.debug.testAddProp = (url, opts) => addProp(url, opts);
G.debug.mapId = () => save.settings.mapId;
G.debug.mapList = () => MAPS.map(m => m.id);
G.debug.setMapId = (id) => switchMap(id);
G.debug.groundHeightAt = (x, z) => groundHeight(x, z);                          // #204 (pur)
G.debug.playerSpawnPoint = () => ({ x: playerSpawn.x, z: playerSpawn.z });      // #204
G.debug.mapBoundsGet = () => ({ ...MAP_BOUNDS });                               // #205
G.debug.shadowHalfGet = () => (MAP_VISUALS[save.settings.mapId] || MAP_VISUALS.portal).shadowHalf || 20;   // #205
G.debug.testAddBackdropProp = (url, opts) => addBackdropProp(url, opts);
G.debug.decorPropCount = () => decorPropCount();
G.debug.decorBackdropCount = () => decorBackdropCount();
G.debug.utopiaDoorCount = () => utopiaDoorCount();                              // #206 : baies-portes découpées
G.debug.utopiaRoofCount = () => utopiaRoofCount();                              // #206 : toits accessibles
G.debug.setPos = (x, z) => { if(model){ model.position.x = x; model.position.z = z; model.position.y = groundY + groundHeight(x, z); velY = 0; grounded = true; } };   // #204 : pose au sol local
G.debug.playerFootY = () => model ? model.position.y - groundY : 0;   // #204 : hauteur des pieds au-dessus du zéro map

// ====== Assets + galerie de personnages : voir src/game/assets.js ======
const ROOT_BONE = 'Hips';
// ne garde que les persos validés pour le jeu ; repli sur tous si aucun n'est validé
function filterPlayable(records){
  const ready = records.filter(c => c.gameReady);
  return ready.length ? ready : records;
}
G.debug.filterPlayable = (records) => filterPlayable(records);

// ====== Animation / retargeting (repris de app.html) ======
let anims = [];           // [{ key, label, icon, clip }]
let sourceModel=null, sourceBoneByName={}, sourceRest=null, sourceRestWorld=null;
let targetRest=null, targetRestWorld=null, targetBoneOrder=null;

// Retargeting espace-monde : algorithme partagé dans src/shared/retarget.js ;
// ce wrapper lui passe l'état source/cible courant du module.
function retargetClipWorld(raw) {
  return retargetClipWorldShared(raw, {
    sourceModel, sourceBoneByName, sourceRest, sourceRestWorld,
    targetRest, targetRestWorld, targetBoneOrder, rootBone: ROOT_BONE,
  });
}

async function loadAnims(animFiles) {
  anims = [];
  for (const f of animFiles) {
    try {
      const g = await loader.loadAsync(ANIM_DIR + f);
      const clip = g.animations[0];
      if (!clip) continue;
      const key = animKeyFromFile(f);
      clip.name = key;
      anims.push({ key, label: prettyLabel(key), icon: iconFor(f), clip });
      // 1er fichier = squelette source partagé (les clips sont créés sur ce rig)
      if (!sourceModel) {
        sourceModel = g.scene;
        sourceRest = captureRest(g.scene);
        sourceRestWorld = captureRestWorld(g.scene);
        g.scene.traverse(o => { if (o.isBone) sourceBoneByName[o.name] = o; });
      }
    } catch (e) { console.warn('anim KO', f, e); }
  }
  anims.sort((a, b) => a.label.localeCompare(b.label));
}

// idle dérivé : rapproche chaque pose de la pose de repos cible (repli si pas d'Alert)
// Idle dérivé (repli quand le perso n'a aucun clip idle dédié) : jusqu'ici on gardait TOUTES les
// keyframes du clip marche (amplitude réduite mais même rythme de foulée) → un idle qui rejoue en
// boucle le cycle de marche, même atténué, se VOIT comme "il marche sur place en permanence" (bug
// remonté par Nathan, repro en 3e personne car le corps entier n'est visible que dans cette vue).
// Fix : figer sur UNE seule keyframe (1er instant du clip) au lieu de garder tout le cycle — une
// vraie pose statique, pas un cycle de marche atténué.
function deriveIdle(clip){
  const amp = 0.18;
  const tracks = clip.tracks.map(tr=>{
    const size = tr.getValueSize ? tr.getValueSize() : tr.values.length / tr.times.length;
    const first = Float32Array.from(tr.values.slice(0, size));   // fige sur la 1re keyframe : plus de cycle
    if(tr.name.endsWith('.quaternion')){
      const boneName = tr.name.slice(0, tr.name.lastIndexOf('.'));
      const rest = targetRest[boneName] && targetRest[boneName].q;
      if(rest){
        const q = new THREE.Quaternion(first[0], first[1], first[2], first[3]);
        const o = new THREE.Quaternion().copy(rest).slerp(q, amp);
        first[0]=o.x; first[1]=o.y; first[2]=o.z; first[3]=o.w;
      }
      return new THREE.QuaternionKeyframeTrack(tr.name, [0], first);
    }
    return new tr.constructor(tr.name, [0], first);
  });
  return new THREE.AnimationClip('idle_derived', 1, tracks);
}

const actions = { idle:null, walk:null, run:null };
async function spawnModel(char){
  const url = URL.createObjectURL(new Blob([char.bytes]));
  const gltf = await loader.loadAsync(url); URL.revokeObjectURL(url);
  const m = gltf.scene;
  m.traverse(o => { if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
  applyAccessories(m);                                // accessoires 3D (#26) : casque/costume attachés dès le spawn
  applyBoosts(m);                                      // visuels de boost (#28) : bottes/gilet/médaille
  targetRest = captureRest(m); targetRestWorld = captureRestWorld(m); targetBoneOrder = boneOrder(m);
  const box = new THREE.Box3().setFromObject(m);
  const size = box.getSize(new THREE.Vector3()); const center = box.getCenter(new THREE.Vector3());
  const s = 1.8/(size.y||1); m.scale.setScalar(s);
  m.position.sub(center.multiplyScalar(s)); m.position.y += (size.y*s)/2;
  m.rotation.y = 0;
  if(mixer){ mixer.stopAllAction(); mixer = null; }   // lobby : l'idle est (re)posé par playLobbyIdle
  lobbyIdle = false;
  if(model){ scene.remove(model); heldWeapon = null; }   // nouveau modèle => l'arme se ré-attache à la partie suivante
  model = m; model.userData.charId = char.id; scene.add(model);   // tag : quel perso ce modèle représente (vérif sélection)
  groundY = m.position.y; velY = 0; grounded = true; doubleJumpAvailable = false;
  applyShopVisibility();   // si la boutique (vitrine d'arme) est ouverte, masque ce nouveau perso
}
// joue une anim idle sur le perso du lobby (plus de T-pose) — non-bloquant ; sauté en mode test rapide
async function playLobbyIdle(){
  // #52 : animation looping (bras naturels) — préfère Casual_Walk → walk → idle ; plus de pose figée
  if(!model || window.__FAST_WEAPON__) return;
  const target = model;
  try { if(!anims.length) await loadAnims((await listDir(ANIM_DIR)).filter(isGlb)); } catch(e){ return; }
  if(model !== target) return;
  const calm = anims.find(a => /casual.*walk|walk.*casual/i.test(a.key))
    || anims.find(a => /^(slow.*walk|walk)/i.test(a.key))
    || anims.find(a => /walk/i.test(a.key))
    || anims.find(a => /idle/i.test(a.key));
  const clip = calm ? retargetClipWorld(calm.clip) : retargetRole('walk') || retargetRole('idle');
  if(clip){
    mixer = new THREE.AnimationMixer(model);
    const act = mixer.clipAction(clip);
    act.setLoop(THREE.LoopRepeat, Infinity);
    act.play();                                     // looping — pas de paused=true
    lobbyIdle = true;
  }
}
G.debug.lobbyAnimated = () => lobbyIdle;
function retargetRole(role){
  const names = anims.map(a => a.key);
  const key = resolveClipRole(role, names);
  let raw = key ? anims.find(a=>a.key===key)?.clip : null;
  if(!raw && role==='run') raw = anims.find(a=>resolveClipRole('walk',[a.key]))?.clip; // run -> walk
  if(!raw && role==='walk') raw = anims.find(a=>resolveClipRole('run',[a.key]))?.clip;  // walk -> run
  if(!raw && role==='idle'){ const w = anims.find(a=>resolveClipRole('walk',[a.key]))?.clip; return w?deriveIdle(retargetClipWorld(w)):null; }
  if(!raw) return null;
  return retargetClipWorld(raw);
}

// ====== Lobby (sélection 3D : on voit le perso, on slide, bouton Jouer) ======
let characters = [];        // persos jouables (lobby) ; sous-ensemble validé de la galerie
let allCharacters = [];     // toute la galerie (source de sélection des ennemis)
let lobbyIndex = 0;

function setLobbyCamera(){
  camera.position.set(0, 1.95, 6.8);   // dézoom (retour utilisateur) : perso plus petit, posé au centre du podium du fond
  camera.lookAt(0, 1.46, 0);
}
// points du carrousel perso (refonte utopie) : un point par perso possédé, l'actif en violet
function updateCharDots(){
  const d = document.getElementById('char-dots'); if(!d) return;
  d.innerHTML = characters.map((_, i) => `<i${i === lobbyIndex ? ' class="on"' : ''}></i>`).join('');
}
async function previewCharacter(index){
  const n = characters.length; if(!n) return;
  lobbyIndex = ((index % n) + n) % n;
  const c = characters[lobbyIndex];
  document.getElementById('char-name').textContent = c.label;   // maj immédiate du nom
  updateCharDots();
  save.selectedCharacterId = c.id; persist();                  // mémorise le perso choisi (tranche 12)
  await spawnModel(c);                                          // affiche le modèle (turntable)
  playLobbyIdle();                                              // non-bloquant : joue l'idle dès que prêt (no T-pose)
}
function cycleCharacter(dir){ if(G.phase==='lobby') previewCharacter(lobbyIndex + dir); }
// le lobby ne montre que les persos POSSÉDÉS (catalogue), résolus aux modèles de la galerie
function rebuildLobbyCharacters(){
  characters = CHARACTERS.filter(c => save.ownedCharacters.includes(c.id))
    .map(c => { const rec = allCharacters.find(a => a.id === c.id); return rec ? Object.assign({}, rec, { label:c.name }) : null; })
    .filter(Boolean);
  if(!characters.length) characters = filterPlayable(allCharacters);   // repli sécurité
  G.characters = characters.map(c => ({ id:c.id, label:c.label }));
}
// (re)affiche le perso équipé en 3D (onglet Personnage de la boutique / après équipement)
async function showSelectedCharacter(){
  const c = characterById(save.selectedCharacterId), rec = allCharacters.find(a => a.id === c.id);
  if(rec){ await spawnModel(rec); playLobbyIdle(); applyShopVisibility(); }
}

async function initLobby(){
  try {
    if(window.__FORCE_LIST_FAIL__) throw new Error('forced');
    await seedPersosToGallery();
    allCharacters = await loadCharactersFromGallery();
    rebuildLobbyCharacters();                                    // persos possédés
    if(!characters.length){ showOverlay('Aucun personnage. Ajoute-en via studio.html ou vérifie /perso.'); return; }
    updateHomeMeta();                                            // accueil : argent + record
    setLobbyCamera();
    const savedIdx = characters.findIndex(c => c.id === save.selectedCharacterId);   // rouvre sur le perso mémorisé
    await previewCharacter(savedIdx >= 0 ? savedIdx : 0);
    G.phase = 'lobby';
    updateShopScene();   // vitrine lobby : canvas transparent au-dessus du fond utopie, décor d'arène masqué
  } catch (e) {
    console.warn('init KO', e);
    showOverlay('Impossible de lister les dossiers du jeu.');
  } finally {
    document.getElementById('boot-loading').classList.add('hidden');   // le boot couvre tout jusqu'au lobby prêt (anti-flash)
  }
}
// ====== Reset commun de partie — SOURCE UNIQUE (étape 4) ======
// Toute remise à zéro d'état de run vit ICI et uniquement ici ; startGame ET restartGame
// l'appellent. Fin de la classe de bugs « asymétrie des resets » (audits 2026-06-30 it.2).
function resetRunState(){
  resetMatchWeapon(); resetCombo(); resetPower(); resetCallouts(); resetRunStats(); initChallenges(); resetStamina(); resetKillstreak(); resetLoadoutPoints();
  resetFireMode(); resetShield(); resetSemiAuto(); onStreakReset(); resetSticky();
  rampageKills_=0; rampageUntil_=0; stunUntil_=0; stunCount_=0; overheat_=0; overheatPaused_=false; infiniteAmmo_=false;
  fsLastT=0; rankKillsOvr=rankAccOvr=rankWaveOvr=null; lastWaveBonus_=0; medicHealCount_=0; lastMedicHealTarget_=-1;
  for(const g of enemyGrenadeProjs_) scene.remove(g.mesh); enemyGrenadeProjs_=[]; enemyGrenadeCount_=0; frenzyCount_=0;
  clearMines(); mineStock=MAX_MINES; updateMineHud();
  showGrenadeArc(false); dashRemaining=0; dashCdUntil=0; clearTurret(); turretCooldownUntil=0; secondWindUsed=false; secondWindInvulnUntil=0;
  setHardcore(save.settings.hardcore); setRain(save.settings.rain);
  score=0; G.score=0; applyWeaponStats(); ammo=curMag; G.ammo=ammo; reloading=false; lastShot=-1;
  resetRunFeatures();   // hooks resetRun() des features enregistrées (registre étape 4)
}

async function startGame(){
  if(G.phase==='loading' || G.phase==='playing') return;
  const char = characters[lobbyIndex]; if(!char) return;
  G.phase = 'loading';
  document.getElementById('lobby').classList.add('hidden');
  const showingBootForArena = !arenaReady;   // décor chargé à la demande (retour Nathan) : 1er "Déployer" seulement
  if(showingBootForArena){
    document.getElementById('boot-loading-msg').textContent = 'Chargement du décor…';
    document.getElementById('boot-loading').classList.remove('hidden');
  }
  await ensureArenaReady();
  if(showingBootForArena) document.getElementById('boot-loading').classList.add('hidden');
  updateShopScene();   // sortie de la vitrine lobby : fond opaque + décor d'arène restaurés (décor déjà prêt ici)
  if(!model) await spawnModel(char);                            // sécurité (normalement déjà affiché)
  if(!anims.length){ await loadAnims((await listDir(ANIM_DIR)).filter(isGlb)); }
  if(G.phase !== 'loading') return;   // backToHome() appelé pendant le chargement → on n'écrase pas le lobby (HUD/cibles fantômes)
  model.position.set(playerSpawn.x, groundY + groundHeight(playerSpawn.x, playerSpawn.z), playerSpawn.z);   // #204 : spawn par map (utopia : fond de l'amphithéâtre)
  model.rotation.y = 0;
  mixer = new THREE.AnimationMixer(model);                      // mixer de jeu sur le modèle déjà chargé
  danceActionCache = {}; dancing = false; danceAction = null; meleeAnimCache = null;   // nouvelles actions de danse sur ce mixer (#27)
  actions.idle = mixer.clipAction(retargetRole('idle'));
  const wc = retargetRole('walk'); actions.walk = wc ? mixer.clipAction(wc) : null;
  const rc = retargetRole('run');  actions.run  = rc ? mixer.clipAction(rc) : null;
  // repli course→marche (retargetRole ré-utilise le clip marche quand aucun clip course dédié
  // n'existe, même nom de clip conservé) : sans ceci, "courir" rejoue la marche à sa vitesse
  // native → indiscernable de la marche à l'écran ("quand je cours il marche aussi"). On accélère
  // la lecture au ratio des vitesses de déplacement pour au moins distinguer visuellement l'allure.
  if(actions.run && actions.walk && rc.name === wc.name) actions.run.timeScale = RUN_SPEED / WALK_SPEED;
  G.clips = Object.keys(actions).filter(k=>actions[k]);
  G.debug.locoClipInfo = () => ['idle','walk','run'].map(k => actions[k] ? { role:k, clip:actions[k].getClip().name, frames:actions[k].getClip().tracks[0]?.times.length, timeScale:actions[k].timeScale } : { role:k, clip:null });
  curLoco = 'idle'; actions.idle.play();
  setView(save.settings.defaultView);                          // vue de départ selon les réglages (#18 ; défaut 3e personne)
  G.character = { id:char.id, label:char.label };
  G.locomotion = 'idle';
  showHud();
  resetRunState();       // reset commun startGame/restartGame (étape 4 — source unique)
  getDailyContracts();   // #62 : initialise save.daily (sinon trackDailyKill/Wave sortent sur !save.daily → contrats inertes en production) + rafraîchit le seed du jour
  spawnDefaultTargets();
  { const ch = document.getElementById('crosshair'); ch.classList.remove('hidden'); ch.style.visibility = 'visible'; } // reset visibilité (sinon réticule bloqué masqué si on a quitté en visant)
  document.getElementById('combat').classList.remove('hidden');
  document.getElementById('wave-hud').classList.remove('hidden');
  document.getElementById('money-hud').classList.remove('hidden'); updateMoneyHud();
  document.getElementById('radar').classList.remove('hidden');   // mini-carte (#21)
  grenades = save.consumables.frag; document.getElementById('grenade-hud').classList.remove('hidden'); updateGrenadeHud();   // stock persistant (#155)
  flashbangs = save.consumables.flashbang; document.getElementById('flashbang-hud').classList.remove('hidden'); updateFlashbangHud(); // stock persistant (#155)
  document.getElementById('firemode-hud').classList.remove('hidden'); updateFiremodeHud(); // burst (#64) — resetFireMode fait par resetRunState
  document.getElementById('mine-hud').classList.remove('hidden'); updateMineHud(); // claymore (#65) — clearMines/mineStock faits par resetRunState
  document.getElementById('shield-bar').classList.remove('hidden'); // shield (#67) — resetShield fait par resetRunState
  smokeStock = save.consumables.smoke; document.getElementById('smoke-hud').classList.remove('hidden'); updateSmokeHud();  // stock persistant (#155)
  stickyStockCount = save.consumables.sticky; molotovStockCount = save.consumables.molotov; empStockCount = save.consumables.emp; medkitStockCount = save.consumables.medkit; // stock persistant (#155/#178)
  document.getElementById('medkit-hud').classList.remove('hidden'); updateMedkitHud();   // #178
  document.getElementById('xp-hud').classList.remove('hidden'); updateXpHud();            // XP (#60)
  document.getElementById('dash-hud').classList.remove('hidden'); updateDashHud();         // dash (#35)
  updateCombatHud();
  if(!enemyBase) await buildEnemyAssets(char);
  startWave(1);
  clearSpawnMarkers(); // spawn markers (#70) — efface les marqueurs du spawn initial (vague 1)
  applyPlayerStats(); health = maxHealth; G.health = health; lastDamageAt = -999;
  document.getElementById('healthbar').classList.remove('hidden'); updateHealthHud();
  initAudio();
  ensureWeapon();                              // chargement non-bloquant (l'arme apparaît dès qu'elle est prête)
  startLifetimeTimer(); // lifetime playtime (#80)
  G.phase = 'playing';
  updateLoadoutHud();   // affiche les barres du loadout choisi (#156)
}
G.debug.start = async (index=0) => { await previewCharacter(index); await startGame(); };
// ====== #158 Mode Entraînement ======
let trainingActive_ = false;
async function startTraining(){
  await startGame();
  trainingActive_ = true;
  clearEnemies();
  infiniteAmmo_ = true;
  updateTrainingHud();
}
function updateTrainingHud(){ const el = document.getElementById('training-hud'); if(el) el.classList.toggle('hidden', !trainingActive_); }
G.debug.trainingActive = () => trainingActive_;
G.debug.startTraining = () => startTraining();

// boutons + clavier du lobby (slide gauche/droite, Entrée/Espace = jouer)
document.getElementById('prev').onclick = () => cycleCharacter(-1);
document.getElementById('next').onclick = () => cycleCharacter(1);
document.getElementById('play-btn').onclick = () => startGame();
// Accueil : panneaux Boutique / Réglages (placeholders, remplis aux tranches 13/18)
const openPanel = id => document.getElementById(id).classList.remove('hidden');
const closePanel = id => document.getElementById(id).classList.add('hidden');
document.getElementById('btn-shop').onclick = openShop;
document.getElementById('shop-close').onclick = closeShop;
function shopNav(dir){ if(shopTab === 'player') setShopChar(shopCharIndex + dir); else setShopWeapon(shopWeaponIndex + dir); }   // flèches selon l'onglet (#25)
document.getElementById('shop-prev').onclick = () => shopNav(-1);
document.getElementById('shop-next').onclick = () => shopNav(1);
for(const t of document.querySelectorAll('.shop-tab')) t.onclick = () => setShopTab(t.dataset.tab);
document.getElementById('btn-settings').onclick = () => openSettings();
document.getElementById('btn-howto').onclick = () => openPanel('howto-panel');
document.getElementById('btn-loadout').onclick = () => { renderLoadoutPanel(); openPanel('loadout-panel'); };
document.getElementById('btn-training').onclick = () => startTraining();
function renderLoadoutPanel(){
  const el = document.getElementById('loadout-grid'); if(!el) return;
  const LOADOUT_ICON = { turret:'grenade', mine:'sticky', airstrike:'flash', carepackage:'molotov', dog:'soldier' };
  const LOADOUT_KEYLABEL = { turret:'L', mine:'Y', airstrike:'U', carepackage:'I', dog:'4' };
  let html = '';
  for(const key of LOADOUT_BONUSES){
    const on = save.selectedLoadout.includes(key);
    const foot = `<button class="icbtn${on?' on':''}" data-loadout="${key}">${on ? '✓ Choisi' : 'Choisir'} — touche ${LOADOUT_KEYLABEL[key]}</button>`;
    html += itemCard({ rc:rarityInfo('commun').color, icon:LOADOUT_ICON[key], name:LOADOUT_NAMES[key], rarity:'commun', sub:`Palier : ${LOADOUT_THRESHOLDS[key]} pts`, foot, on, data:` data-loadout="${key}"` });
  }
  el.innerHTML = html;
  el.querySelectorAll('[data-loadout]').forEach(b => b.onclick = () => { toggleLoadoutBonus(b.dataset.loadout); renderLoadoutPanel(); });
}
for(const t of document.querySelectorAll('.howto-tab')) t.onclick = () => {
  for(const x of document.querySelectorAll('.howto-tab')) x.classList.toggle('active', x === t);
  for(const p of document.querySelectorAll('.howto-page')) p.classList.toggle('active', p.dataset.howtoPage === t.dataset.howto);
};
for(const b of document.querySelectorAll('.panel-back')) b.onclick = () => closePanel(b.dataset.panel);
// ====== Panneau Réglages (#18) : remplit les contrôles depuis la save, applique + persiste à chaque changement ======
function renderSettings(){
  const s = save.settings;
  const se = document.getElementById('set-sensitivity'), sv = document.getElementById('set-sensitivity-val');
  if(se){ se.value = s.sensitivity; sv.textContent = (+s.sensitivity).toFixed(1) + '×'; }
  const vo = document.getElementById('set-volume'), vv = document.getElementById('set-volume-val');
  if(vo){ vo.value = s.volume; vv.textContent = Math.round(s.volume * 100) + '%'; }
  const vw = document.getElementById('set-view');
  if(vw) vw.textContent = s.defaultView === 'first' ? '1re personne' : '3e personne';
  const cur = (s.difficulty || 'normal');                       // surlignage difficulté (#46)
  document.querySelectorAll('#set-diff .set-diff-btn').forEach(b => b.classList.toggle('on', b.dataset.diff === cur));
  const hc = document.getElementById('set-hardcore');           // toggle hardcore (#94)
  if(hc){ hc.textContent = s.hardcore ? '☠ Activé' : 'Désactivé'; hc.classList.toggle('on', !!s.hardcore); }
  const rn = document.getElementById('set-rain');               // toggle pluie (#93)
  if(rn){ rn.textContent = s.rain ? '🌧 Activé' : 'Désactivé'; rn.classList.toggle('on', !!s.rain); }
}
// ====== Panneau Map (#201/#202) : bouton dédié depuis l'accueil, boutons générés depuis le registre MAPS ======
function renderMapPanel(){
  const el = document.getElementById('map-grid'); if(!el) return;
  el.innerHTML = MAPS.map(m => {
    const on = m.id === save.settings.mapId;
    // #206 : carte illustrée si la map fournit un visuel (MAPS[].img) — voile dégradé côté CSS
    const img = m.img ? ` has-img" style="background-image:url('${m.img}')` : '';
    return `<button class="map-card${on ? ' on' : ''}${img}" data-map="${m.id}">
      <span class="mc-ico"><svg class="ico"><use href="#i-map"></use></svg></span>
      <b>${m.label}</b><small>${on ? 'Terrain actuel' : 'Choisir ce terrain'}</small></button>`;
  }).join('');
}
document.getElementById('btn-map').onclick = () => { renderMapPanel(); openPanel('map-panel'); };
document.getElementById('map-grid').addEventListener('click', async e => {
  const b = e.target.closest('[data-map]'); if(!b) return;
  await switchMap(b.dataset.map); renderMapPanel();
});
function openSettings(){ renderSettings(); openPanel('settings-panel'); }
document.getElementById('set-sensitivity').oninput = e => { setSetting('sensitivity', parseFloat(e.target.value)); renderSettings(); };
document.getElementById('set-volume').oninput = e => { setSetting('volume', parseFloat(e.target.value)); renderSettings(); };
document.getElementById('set-view').onclick = () => { setSetting('defaultView', save.settings.defaultView === 'first' ? 'third' : 'first'); renderSettings(); };
document.getElementById('set-diff').addEventListener('click', e => { const b = e.target.closest('.set-diff-btn'); if(b) G.debug.setDifficulty(b.dataset.diff); });   // #46
document.getElementById('set-hardcore').onclick = () => { setSetting('hardcore', !save.settings.hardcore); renderSettings(); };   // #94 toggle hardcore persistant
document.getElementById('set-rain').onclick = () => { setSetting('rain', !save.settings.rain); setRain(save.settings.rain); renderSettings(); };   // #93 toggle pluie persistant
addEventListener('keydown', e => {
  if(G.phase!=='lobby') return;
  if(shopOpen){                                                  // navigation boutique
    if(e.code==='Escape') closeShop();
    else if((shopTab==='weapons'||shopTab==='player') && e.code==='ArrowLeft') shopNav(-1);
    else if((shopTab==='weapons'||shopTab==='player') && e.code==='ArrowRight') shopNav(1);
    return;
  }
  if(e.code==='Escape'){                                          // ferme n'importe quel panneau ouvert (Réglages, Comment jouer...)
    const openPanelEl = document.querySelector('.panel:not(.hidden)');
    if(openPanelEl){ closePanel(openPanelEl.id); return; }
  }
  if(e.code==='ArrowLeft' || e.code==='KeyA') cycleCharacter(-1);
  else if(e.code==='ArrowRight' || e.code==='KeyD') cycleCharacter(1);
  else if(e.code==='Enter' || e.code==='Space'){ e.preventDefault(); startGame(); }
});

initLobby().then(() => {
  // hook dev : #settings / #map / #loadout / #howto / #shop dans l'URL ouvre le panneau au boot (captures/tests visuels)
  const h = location.hash.slice(1);
  if(/^(settings|map|loadout|howto|shop)$/.test(h)) document.getElementById('btn-' + h)?.click();
});

// ====== Entrées clavier (event.code => ZQSD sur AZERTY) ======
const input = { forward:false, back:false, left:false, right:false, sprint:false, fire:false, aim:false };
const CODE = { KeyW:'forward', ArrowUp:'forward', KeyS:'back', ArrowDown:'back',
               KeyA:'left', ArrowLeft:'left', KeyD:'right', ArrowRight:'right' };
addEventListener('keydown', e => {
  if(e.code==='Escape' && G.phase==='playing' && airstrikeTargeting){ closeAirstrikeTargeting(); return; }   // #156b annule le ciblage
  if(CODE[e.code]){ input[CODE[e.code]]=true; e.preventDefault(); }
  if(e.code==='ShiftLeft'||e.code==='ShiftRight'||e.code==='KeyR') input.sprint=true; // R ou Shift = courir
  if(e.code==='KeyQ') input.aim=true;                                                 // A (AZERTY) = viser
  if(e.code==='KeyE') input.fire=true;                                                // E = tirer
  if(e.code==='Space' && G.phase==='playing'){
    if(grounded){ velY = JUMP_SPEED; grounded = false; doubleJumpAvailable = true; e.preventDefault(); }        // saut normal (arme le double saut)
    else if(doubleJumpAvailable){ velY = JUMP_SPEED; doubleJumpAvailable = false; e.preventDefault(); }         // double saut (#135)
  }
  if(e.code==='KeyF' && G.phase==='playing') reload();                                // F = recharger
  if(e.code==='KeyG' && G.phase==='playing') pickupWeapon();                          // G = ramasser l'arme d'un cadavre (#23)
  if(e.code==='KeyB' && G.phase==='playing' && grenades > 0) showGrenadeArc(true);    // B (maintien) = viser l'arc de grenade (#33/#97)
  if(e.code==='KeyN' && G.phase==='playing') throwFlashbang();                        // N = lancer une flashbang (#57)
  if(e.code==='KeyT' && G.phase==='playing') fireModeToggle();                        // T = basculer auto/burst (#64)
  if(e.code==='KeyY' && G.phase==='playing') triggerLoadoutBonus('mine');              // Y = claymore prête (loadout #156)
  if(e.code==='KeyL' && G.phase==='playing') triggerLoadoutBonus('turret');            // L = tourelle prête (loadout #156)
  if(e.code==='KeyU' && G.phase==='playing') triggerLoadoutBonus('airstrike');         // U = frappe aérienne prête (loadout #156)
  if(e.code==='KeyI' && G.phase==='playing') triggerLoadoutBonus('carepackage');       // I = caisse de ravitaillement prête (loadout #156)
  if(e.code==='Digit4' && G.phase==='playing') triggerLoadoutBonus('dog');            // 4 = chien de guerre prêt (loadout #156/#201 ; toutes les lettres A-Z sont déjà prises)
  if(e.code==='KeyH' && G.phase==='playing') throwSmoke();                             // H = grenade fumigène (#69)
  if(e.code==='KeyJ' && G.phase==='playing') throwSticky();                           // J = grenade collante (#118)
  if(e.code==='KeyK' && G.phase==='playing') throwMolotov();                          // K = molotov, zone de feu (#130)
  if(e.code==='KeyO' && G.phase==='playing') throwEmp();                              // O = grenade EMP (#136)
  if(e.code==='KeyP' && G.phase==='playing'){ semiAuto = !semiAuto; updateSemiAutoHud(); } // P = toggle semi-auto (#78)
  if(e.code==='KeyC' && G.phase==='playing') dash();                                  // C = dash / esquive (#35)
  if(e.code==='KeyX' && G.phase==='playing') playerMelee();                           // X = corps-à-corps (#45)
  if(e.code==='KeyZ' && G.phase==='playing') useMedkit();                             // Z = trousse de soin (#178)
  if(G.phase==='playing' && (e.code==='Digit1'||e.code==='Digit2'||e.code==='Digit3')) playDance(+e.code.slice(5)-1);   // 1/2/3 = danses (#27)
  if(e.code==='KeyV' && G.phase==='playing'){ toggleView(); e.preventDefault(); }
  if(e.code==='KeyM'){ setMuted(!isMuted()); }
  resumeAudio(); });
addEventListener('keyup', e => { if(CODE[e.code]) input[CODE[e.code]]=false;
  if(e.code==='ShiftLeft'||e.code==='ShiftRight'||e.code==='KeyR') input.sprint=false;
  if(e.code==='KeyQ') input.aim=false;
  if(e.code==='KeyE') input.fire=false;
  if(e.code==='KeyB' && arcVisible_){ throwGrenade(); showGrenadeArc(false); } });   // B relâché = lancer la grenade le long de l'arc visé (#97)
G.debug.setInput = (s={}) => { input.forward=!!s.forward; input.back=!!s.back;
  input.left=!!s.left; input.right=!!s.right; input.sprint=!!s.sprint;
  input.fire=!!s.fire; input.aim=!!s.aim; };
G.debug.setYaw = (r) => { camYaw = r; };
G.debug.setView = (v) => setView(v);
G.debug.toggleView = () => toggleView();
G.debug.modelVisible = () => !!(model && model.visible);
G.debug.jump = () => { if(G.phase!=='playing') return;
  if(grounded){ velY = JUMP_SPEED; grounded = false; doubleJumpAvailable = true; }
  else if(doubleJumpAvailable){ velY = JUMP_SPEED; doubleJumpAvailable = false; } };
G.debug.airJump = () => G.debug.jump();   // #135 : alias explicite pour les tests (même logique sol/air)
G.debug.doubleJumpAvailable = () => doubleJumpAvailable;
G.debug.velY = () => velY;

// ====== Caméra 3e personne (pointer lock + repli) ======
const canvasEl = renderer.domElement;
canvasEl.addEventListener('click', () => { resumeAudio(); if(G.phase==='playing') canvasEl.requestPointerLock?.(); });
// L'overlay de pause recouvre le canvas : il doit lui-même reprendre la main au clic.
document.getElementById('pause').addEventListener('click', () => {
  if(G.phase==='playing') canvasEl.requestPointerLock?.();
});
canvasEl.addEventListener('mousedown', e => {
  if(G.phase!=='playing' || document.pointerLockElement!==canvasEl) return;
  if(e.button===0) input.fire = true; else if(e.button===2) input.aim = true;
});
addEventListener('mouseup', e => { if(e.button===0) input.fire = false; else if(e.button===2) input.aim = false; });
canvasEl.addEventListener('contextmenu', e => e.preventDefault());
const PITCH_3RD_MIN = -0.2, PITCH_3RD_MAX = 0.9;   // orbite 3e personne (regard surtout vers le bas)
const PITCH_1ST_MIN = -1.35, PITCH_1ST_MAX = 1.35; // 1re personne : haut ET bas (quasi vertical)
function clampPitch(){
  const lo = view === 'first' ? PITCH_1ST_MIN : PITCH_3RD_MIN;
  const hi = view === 'first' ? PITCH_1ST_MAX : PITCH_3RD_MAX;
  camPitch = Math.max(lo, Math.min(hi, camPitch));
}
function applyLook(dx, dy){
  camYaw -= dx * 0.0025 * lookSensitivity;
  // 1re personne : souris vers le haut (dy<0) => regarder vers le haut (pitch ↑) — non inversé.
  // 3e personne : on conserve l'orbite existante.
  camPitch += (view === 'first' ? -dy : dy) * 0.0025 * lookSensitivity;
  clampPitch();
}
addEventListener('mousemove', e => {
  if(document.pointerLockElement !== canvasEl) return;
  applyLook(e.movementX, e.movementY);
});
G.debug.look = (dx, dy) => applyLook(dx, dy);
const AIM_DIST = 3.0, SHOULDER = 0.6;
let shake = 0;
function updateCamera(dt){
  if(!model) return;
  updateCameraKick(dt); // camera kick (#77)
  if(view === 'first'){
    const p = model.position;
    const eye = p.y + EYE_HEIGHT;
    camDist += (0 - camDist) * Math.min(1, dt*10);
    camera.position.set(p.x, eye, p.z);
    if(shake > 0){ const k = shake*0.06; camera.position.x += (Math.random()-0.5)*k; camera.position.y += (Math.random()-0.5)*k; shake = Math.max(0, shake - dt*6); }
    const look = new THREE.Vector3(Math.sin(camYaw)*Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw)*Math.cos(camPitch));
    camera.lookAt(camera.position.x + look.x, camera.position.y + look.y, camera.position.z + look.z);
    return;
  }
  const targetDist = input.aim ? AIM_DIST : CAM_DIST;
  camDist += (targetDist - camDist) * Math.min(1, dt*10);
  const p = model.position;
  const right = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
  const sh = input.aim ? SHOULDER : 0;
  const ty = p.y + 1.5;
  const look = new THREE.Vector3(Math.sin(camYaw)*Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw)*Math.cos(camPitch));
  const desired = new THREE.Vector3(
    p.x - look.x*camDist + right.x*sh,
    ty + look.y*camDist,
    p.z - look.z*camDist + right.z*sh);
  camera.position.lerp(desired, Math.min(1, dt*8));
  if(shake > 0){ const k = shake*0.12; camera.position.x += (Math.random()-0.5)*k; camera.position.y += (Math.random()-0.5)*k; shake = Math.max(0, shake - dt*6); } explosionShake_ = Math.max(0, explosionShake_ - dt*3.33);
  camera.lookAt(p.x + right.x*sh, ty, p.z + right.z*sh);
}

// ====== #56 Stamina ======
const STAMINA_MAX = 100, STAMINA_DRAIN = 25, STAMINA_REGEN = 15, STAMINA_MIN_RUN = 20;
let stamina = STAMINA_MAX, staminaDepleted = false;
function updateStaminaHud(){
  const el = document.getElementById('stamina-hud'); if(!el) return;
  if(G.phase !== 'playing'){ el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const fill = document.getElementById('stamina-fill'); if(!fill) return;
  fill.style.width = Math.round(stamina / STAMINA_MAX * 100) + '%';
  fill.classList.toggle('low', staminaDepleted);
}
function resetStamina(){ stamina = STAMINA_MAX; staminaDepleted = false; updateStaminaHud(); }
G.debug.stamina = () => stamina;
G.debug.staminaDepleted = () => staminaDepleted;
G.debug.setStamina = (v) => { stamina = Math.max(0, Math.min(STAMINA_MAX, v)); if(stamina===0) staminaDepleted=true; else if(staminaDepleted && stamina>=STAMINA_MIN_RUN) staminaDepleted=false; updateStaminaHud(); };

// ====== Contrôleur + machine d'état locomotion ======
const WALK_SPEED = 2.4, RUN_SPEED = 5.4, TURN_LERP = 12;
let curLoco = 'idle';
let danceActionCache = {}, dancing = false, danceAction = null, danceEndAt = 0;   // danses (#27)
function setLoco(state){
  if(state===curLoco) return;
  const next = actions[state] || actions.idle;
  const prev = actions[curLoco];
  if(next){ next.reset().play(); if(prev && prev!==next) prev.crossFadeTo(next, 0.2, false); }
  curLoco = state; G.locomotion = state;
}
// ====== Dash / esquive (#35) ======
const DASH_DISTANCE = 2.6, DASH_SPEED = 16, DASH_CD = 1.4;
let dashRemaining = 0, dashCdUntil = 0, dashDir = { x:0, z:1 };
let lastMoveSpeed_ = 0;                                       // dernière vitesse de déplacement effective (#127 test)
function dash(){
  if(G.phase !== 'playing' || !model || !grounded || nowS() < dashCdUntil) return false;
  const f = (input.forward?1:0)-(input.back?1:0), s = (input.left?1:0)-(input.right?1:0);
  if(f||s){ const d = cameraRelative({forward:f, strafe:s}, camYaw); const l = Math.hypot(d.x,d.z)||1; dashDir = { x:d.x/l, z:d.z/l }; }
  else { dashDir = { x:Math.sin(camYaw), z:Math.cos(camYaw) }; }
  dashRemaining = DASH_DISTANCE; dashCdUntil = nowS() + DASH_CD; updateDashHud(); playSound('shot');
  waveDashCount_++;   // #182 : bonus "vague sans dash"
  return true;
}
function updateDashHud(){ const el = document.getElementById('dash-hud'); if(!el) return;
  const left = Math.max(0, dashCdUntil - nowS()), ready = left <= 0;
  el.classList.toggle('ready', ready);
  el.innerHTML = `⟫ Dash<div class="dbar" style="width:${ready?100:Math.round((1-left/DASH_CD)*100)}%"></div>`; }
G.debug.dash = () => dash();
G.debug.isDashing = () => dashRemaining > 0;
G.debug.dashReady = () => G.phase==='playing' && grounded && nowS() >= dashCdUntil;
G.debug.dashCooldownLeft = () => Math.max(0, dashCdUntil - nowS());
G.debug.dashInvulnActive = () => dashRemaining > 0;   // #142
function updateController(dt){
  if(G.phase!=='playing' || !model) return;
  const px0_ = model.position.x, pz0_ = model.position.z;   // #163 : distance parcourue
  if(dancing){// danse en cours (#27) : fige la loco
    const moving = input.forward || input.back || input.left || input.right;
    if(nowS() >= danceEndAt || moving) endDance();              // fin (durée écoulée ou mouvement)
    else return;
  }
  const f = (input.forward?1:0) - (input.back?1:0);
  const s = (input.left?1:0) - (input.right?1:0); // +s = droite écran (corrige l'inversion gauche/droite)
  let speed = 0;
  if(dashRemaining > 0){                                         // dash (#35) : budget de distance, frame-rate-independent
    const step = Math.min(DASH_SPEED*dt, dashRemaining);
    model.position.x += dashDir.x*step; model.position.z += dashDir.z*step; dashRemaining -= step; speed = DASH_SPEED;
    model.rotation.y = Math.atan2(dashDir.x, dashDir.z);
  } else if(f||s){
    const dir = cameraRelative({forward:f, strafe:s}, camYaw);
    const len = Math.hypot(dir.x, dir.z) || 1;
    const vx = dir.x/len, vz = dir.z/len;
    const canRun = input.sprint && !staminaDepleted;
    if(canRun){ stamina = Math.max(0, stamina - STAMINA_DRAIN*dt); if(stamina===0) staminaDepleted=true; }
    else { stamina = Math.min(STAMINA_MAX, stamina + STAMINA_REGEN*dt); if(staminaDepleted && stamina>=STAMINA_MIN_RUN) staminaDepleted=false; }
    updateStaminaHud();
    speed = (canRun ? RUN_SPEED : WALK_SPEED) * speedMult * (isStunned() ? STUN_SPEED_MULT : 1) * (rampageActive() ? RAMPAGE_SPEED : 1) * (activePower==='speed_boost' ? 2 : 1) * (playerSlowedByFrost() ? FROST_SLOW_MULT : 1); // stun (#121) rampage (#125) speed boost (#127) gel (#146)
    lastMoveSpeed_ = speed;                                   // vitesse effective (pour tests #127)
    model.position.x += vx*speed*dt;
    model.position.z += vz*speed*dt;
    const target = Math.atan2(vx, vz);
    let a = model.rotation.y;
    let diff = ((target - a + Math.PI)%(Math.PI*2)) - Math.PI;
    model.rotation.y = a + diff*Math.min(1, dt*TURN_LERP);
  } else {
    stamina = Math.min(STAMINA_MAX, stamina + STAMINA_REGEN*dt);
    if(staminaDepleted && stamina>=STAMINA_MIN_RUN) staminaDepleted=false;
    updateStaminaHud();
  }
  // bornes de map (#205 : rectangulaires, par map)
  model.position.x = Math.max(MAP_BOUNDS.minX, Math.min(MAP_BOUNDS.maxX, model.position.x));
  model.position.z = Math.max(MAP_BOUNDS.minZ, Math.min(MAP_BOUNDS.maxZ, model.position.z));
  // collision obstacles
  for(const b of obstacles){
    const o = pushOutCircleAABB(model.position.x, model.position.z, PLAYER_R, b);
    model.position.x = o.x; model.position.z = o.z;
  }
  // #204 : sol à hauteur variable — montée ≤ STEP_UP_MAX instantanée, marche trop haute = mur
  // (revert au début de frame), descente > STEP_DOWN_SNAP = passage en chute (gravité ci-dessous)
  const gh_ = groundY + groundHeight(model.position.x, model.position.z);
  if(gh_ - model.position.y > STEP_UP_MAX){ model.position.x = px0_; model.position.z = pz0_; }
  else if(grounded){
    if(model.position.y - gh_ <= STEP_DOWN_SNAP) model.position.y = gh_;
    else { grounded = false; velY = 0; }
  }
  // saut (vertical, gravité)
  if(!grounded){
    if(airPeakY_ === null || model.position.y > airPeakY_) airPeakY_ = model.position.y;   // sommet de la phase aérienne (saut ou pas dans le vide)
    velY -= GRAVITY*dt;
    model.position.y += velY*dt;
    const landY = groundY + groundHeight(model.position.x, model.position.z);   // #204 : sol local sous le joueur
    if(model.position.y <= landY){
      const fallDist = airPeakY_ - landY;
      model.position.y = landY; velY = 0; grounded = true; doubleJumpAvailable = false;   // #135 : réarmé seulement par un nouveau saut au sol
      if(fallDist > FALL_SAFE) damagePlayer(Math.min(FALL_DMG_MAX, Math.round((fallDist - FALL_SAFE) * FALL_DMG_PER_M)));
      airPeakY_ = null;
    }
  }
  setLoco(locomotionState(speed, input.sprint && !staminaDepleted));
  runDistance_ += Math.hypot(model.position.x - px0_, model.position.z - pz0_);   // #163
}

// ====== UI : HUD, pause, overlay ======
function showHud(){
  const h = document.getElementById('hud'); h.classList.remove('hidden');
  h.innerHTML = `<b>${G.character?.label||''}</b>`
    + `<br>ZQSD / flèches : bouger · R/Shift : courir · Espace : sauter (2× = double-saut) · C : dash`
    + `<br>E ou clic G : tirer · A ou clic D : viser · F : recharger · X : couteau · T : auto/rafale · P : semi-auto`
    + `<br>B (maintenir) : grenade · N : flashbang · H : fumigène · J : collante · Y : claymore`
    + `<br>K : molotov · O : grenade EMP · L : tourelle sentinelle · G : ramasser arme`
    + `<br>1/2/3 : danses · Souris : caméra · V : vue 1re/3e · M : son · Échap : pause`;
}
function showOverlay(msg){
  document.getElementById('overlay').classList.remove('hidden');
  document.getElementById('overlay-msg').innerHTML =
    `⚠️ ${msg}<br><br>Lance via un serveur local :<br><code>python -m http.server 8123</code><br>puis <code>http://localhost:8123/game.html</code>`;
}
let paused = false;   // #40 : vrai gel de la partie
function setPaused(b){ paused = !!b && G.phase==='playing'; if(!airstrikeTargeting) document.getElementById('pause').classList.toggle('hidden', !paused); }
G.debug.setPaused = (b) => setPaused(b);
G.debug.pauseOpen = () => paused;
document.getElementById('pause-resume').addEventListener('click', e => { e.stopPropagation(); canvasEl.requestPointerLock?.(); setPaused(false); });
document.getElementById('pause-restart').addEventListener('click', e => { e.stopPropagation(); setPaused(false); restartGame(); });
document.getElementById('pause-menu').addEventListener('click', e => { e.stopPropagation(); setPaused(false); backToHome(); });
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if(G.phase==='playing') setPaused(!locked); else document.getElementById('pause').classList.add('hidden');
});

// ====== Catalogue d'armes (boutique #13) ======
// 💡 Futur modèle 3D (#39) : pour ajouter une arme dont le GLB n'est pas encore prêt, déclare-la avec
//    une IMAGE placeholder + le dossier où tu déposeras le GLB plus tard, ex. :
//      { id:'lmg', name:'Mitrailleuse', price:1800, rarity:'legendaire',
//        stats:{ mag:60, cooldown:0.06, reload:2.6, dmgMult:0.7, recoil:1.4 },
//        previewImg:'artefact/lmg/preview.png', assetDir:'artefact/lmg/' }
//    -> l'image s'affiche dans la vitrine ; dès qu'un .glb est dans `artefact/lmg/`, le MODÈLE s'affiche
//       automatiquement (auto-découverte, zéro changement de code). Marche pour toute future catégorie.
// ====== Catalogue d'armes — #49 (noms originaux + sous-catégories) / #50 (couteaux multiples) ======
const WEAPONS = [
  // Fusils d'assaut (assault)
  { id:'default', name:'Viper-AR', price:0, glb:true, rarity:'commun', category:'assault',
    stats:{ mag:12, cooldown:0.12, reload:1.2, dmgMult:1.0, recoil:1.0, range:60 }, build:buildWeaponMesh },
  { id:'raptor', name:'Raptor X5', price:900, rarity:'rare', category:'assault',
    stats:{ mag:18, cooldown:0.10, reload:1.1, dmgMult:1.2, recoil:0.9, range:65 }, build:buildRaptorMesh },
  { id:'cyclone', name:'Cyclone MK3', price:2000, rarity:'epique', category:'assault',
    stats:{ mag:30, cooldown:0.08, reload:1.0, dmgMult:1.4, recoil:0.75, range:70 }, build:buildCycloneMesh },
  // Mitraillettes (smg)
  { id:'smg', name:'Hornet PDW', price:700, rarity:'rare', category:'smg',
    stats:{ mag:24, cooldown:0.07, reload:1.4, dmgMult:0.6, recoil:0.6, range:25 }, build:buildSmgMesh },
  { id:'storm', name:'Storm-9', price:1400, rarity:'epique', category:'smg',
    stats:{ mag:32, cooldown:0.055, reload:1.3, dmgMult:0.7, recoil:0.5, range:30 }, build:buildStorm9Mesh },
  // Snipers
  { id:'sniper', name:'Eclipse SR', price:1500, rarity:'epique', category:'sniper',
    stats:{ mag:5, cooldown:0.85, reload:1.9, dmgMult:3.0, recoil:2.2, range:160 }, build:buildSniperMesh },
  { id:'phantom_sr', name:'Phantom L115', price:2800, rarity:'legendaire', category:'sniper',
    stats:{ mag:4, cooldown:1.1, reload:2.2, dmgMult:4.5, recoil:2.8, range:200 }, build:buildPhantomSrMesh },
  // Fusils à pompe (shotgun)
  { id:'shotgun', name:'Devastator 870', price:1100, rarity:'epique', category:'shotgun',
    stats:{ mag:6, cooldown:0.7, reload:2.0, dmgMult:0.55, recoil:2.6, pellets:8, range:14 }, build:buildShotgunMesh },
  { id:'breacher', name:'Breacher MK2', price:1700, rarity:'rare', category:'shotgun',
    stats:{ mag:8, cooldown:0.55, reload:1.7, dmgMult:0.45, recoil:2.2, pellets:10, range:12 }, build:buildBreacherMesh },
  // Pistolets
  { id:'pistol', name:'Specter-P', price:300, rarity:'commun', category:'pistol',
    stats:{ mag:15, cooldown:0.22, reload:0.9, dmgMult:0.9, recoil:0.65, range:28 }, build:buildPistolMesh },
  { id:'jackal', name:'Jackal-45', price:600, rarity:'rare', category:'pistol',
    stats:{ mag:12, cooldown:0.18, reload:0.85, dmgMult:1.3, recoil:0.8, range:35 }, build:buildJackalMesh },
  // Mitrailleuse lourde (lmg)
  { id:'lmg', name:'Thunderer LMG', price:1800, rarity:'legendaire', category:'lmg',
    stats:{ mag:50, cooldown:0.09, reload:3.2, dmgMult:0.75, recoil:1.4, range:75 }, build:buildLmgMesh },
  // Corps-à-corps (#50 : 3 couteaux, le premier gratuit et possédé par défaut)
  { id:'knife', name:'Lame franche', price:0, rarity:'commun', category:'melee', melee:true,
    stats:{ mag:1, cooldown:0.55, reload:0, dmgMult:3.0, recoil:0 }, build:() => buildKnifeMesh('basic') },
  { id:'combat_knife', name:'Bowie sanglante', price:650, rarity:'rare', category:'melee', melee:true,
    stats:{ mag:1, cooldown:0.50, reload:0, dmgMult:4.0, recoil:0 }, build:() => buildKnifeMesh('bowie') },
  { id:'phantom_blade', name:'Lame Fantôme', price:1200, rarity:'epique', category:'melee', melee:true,
    stats:{ mag:1, cooldown:0.40, reload:0, dmgMult:5.0, recoil:0 }, build:() => buildKnifeMesh('phantom') },
];
function weaponById(id){ return WEAPONS.find(w => w.id === id) || WEAPONS[0]; }
// Fiches boutique (#207) : description + vignette du carrousel. Pour brancher une vraie image d'arme,
// ajouter `img:'artefact/weapons/xxx.png'` à l'entrée correspondante (sinon la carte affiche une icône).
const WEAPON_INFO = {
  default:      { desc:"Fusil d'assaut polyvalent. Équilibré pour toutes les situations." },
  raptor:       { desc:"Fusil d'assaut nerveux à cadence relevée. Fait pour la pression constante." },
  cyclone:      { desc:"Fusil d'assaut d'élite. Cadence folle et dégâts qui ne pardonnent pas." },
  smg:          { desc:"Mitraillette compacte et vive. Reine du combat rapproché." },
  storm:        { desc:"PDW haut de gamme. Un mur de balles en une poignée de secondes." },
  sniper:       { desc:"Fusil de précision. Un tir, une cible neutralisée à distance." },
  phantom_sr:   { desc:"Sniper légendaire longue portée. La mort silencieuse venue de loin." },
  shotgun:      { desc:"Pompe dévastatrice à courte portée. Efface tout ce qui approche." },
  breacher:     { desc:"Fusil à pompe rapide. Ouvre le passage et nettoie les couloirs." },
  pistol:       { desc:"Pistolet de secours fiable. Toujours prêt quand le chargeur est vide." },
  jackal:       { desc:"Gros calibre semi-auto. Frappe fort, chaque balle compte." },
  lmg:          { desc:"Mitrailleuse lourde légendaire. Feu nourri sans jamais faiblir." },
  knife:        { desc:"Couteau de combat simple et fiable. Silencieux et mortel de dos." },
  combat_knife: { desc:"Lame lourde à saigner. Elle tranche là où les autres griffent." },
  phantom_blade:{ desc:"Lame spectrale ultra-rapide. Frappe avant qu'on la voie." },
};
function weaponDesc(id){ return (WEAPON_INFO[id] && WEAPON_INFO[id].desc) || 'Arme de combat.'; }
function weaponThumb(id){ return (WEAPON_INFO[id] && WEAPON_INFO[id].img) || null; }   // PNG à fournir par arme
// ====== Améliorations d'arme (#14) ======
const UPGRADE_SPECS = {
  damage:   { name:'Dégâts',   max:5, baseCost:300, apply:(s,l)=>{ s.dmgMult *= 1 + 0.15*l; } },
  fireRate: { name:'Cadence',  max:5, baseCost:300, apply:(s,l)=>{ s.cooldown *= 1 - 0.08*l; } },
  recoil:   { name:'Recul',    max:5, baseCost:200, apply:(s,l)=>{ s.recoil  *= 1 - 0.12*l; } },
  mag:      { name:'Chargeur', max:5, baseCost:250, apply:(s,l)=>{ s.mag = Math.round(s.mag * (1 + 0.2*l)); } },
};
function upgradeLevel(weaponId, type){ return (save.weaponUpgrades[weaponId] && save.weaponUpgrades[weaponId][type]) || 0; }
function upgradeCost(weaponId, type){ const l = upgradeLevel(weaponId, type);
  return l >= UPGRADE_SPECS[type].max ? null : UPGRADE_SPECS[type].baseCost * (l + 1); }
function buyUpgrade(weaponId, type){
  const spec = UPGRADE_SPECS[type]; if(!spec) return false;
  const cost = upgradeCost(weaponId, type);
  if(cost == null || save.money < cost) return false;
  const up = save.weaponUpgrades[weaponId] || (save.weaponUpgrades[weaponId] = {});
  save.money -= cost; G.money = save.money; up[type] = (up[type] || 0) + 1;
  persist(); updateMoneyHud(); updateHomeMeta();
  if(weaponId === save.selectedWeapon) applyWeaponStats();   // effet immédiat si arme équipée
  return true;
}
function weaponStats(id = effectiveWeaponId()){
  const b = weaponById(id).stats;
  const s = { mag:b.mag, cooldown:b.cooldown, reload:b.reload, dmgMult:b.dmgMult, recoil:b.recoil, pellets:b.pellets || 1, range:b.range ?? SHOT_RANGE };
  for(const type in UPGRADE_SPECS){ const l = upgradeLevel(id, type); if(l > 0) UPGRADE_SPECS[type].apply(s, l); }
  return s;
}
let curMag = 12, curCooldown = 0.12, curReload = 1.2, curDmgMult = 1, curRecoil = 1, curPellets = 1, curRange = 80;
let activePower = null, powerExpireAt = 0;   // #34 power-up actif (déclaré tôt : utilisé par applyWeaponStats)
function powerFactor(){ const f = { dmg:1, cd:1, mag:1 }; if(activePower === 'dmgx2') f.dmg = 2; else if(activePower === 'rapid') f.cd = 1/1.8; else if(activePower === 'extended_mag') f.mag = 2; return f; }   // #34/#95
function enemyTimeScale(){ return activePower === 'slowmo' ? 0.4 : 1; }   // #42 slow-mo : ralentit les ennemis
G.debug.enemyTimeScale = () => enemyTimeScale();
function applyWeaponStats(){ const s = weaponStats(), pf = powerFactor();
  const wDef = weaponById(effectiveWeaponId());
  if(wDef && wDef.melee){
    curMag=1; curCooldown=s.cooldown; curReload=0; curDmgMult=s.dmgMult; curRecoil=0; curPellets=1;
  } else {
    curMag=Math.round(s.mag*pf.mag); curCooldown=s.cooldown*pf.cd; curReload=s.reload; curDmgMult=s.dmgMult*pf.dmg; curRecoil=s.recoil; curPellets=s.pellets || 1; curRange=s.range ?? SHOT_RANGE;
  }
}
G.debug.weaponStats = (id) => weaponStats(id);
function buyWeapon(id){
  const w = WEAPONS.find(x => x.id === id);   // pas de fallback default : un id inconnu ne doit pas être "acheté" (sinon id brut poussé dans ownedWeapons → save polluée)
  if(!w || save.ownedWeapons.includes(id) || save.money < w.price) return false;
  save.money -= w.price; G.money = save.money; save.ownedWeapons.push(id);
  persist(); updateMoneyHud(); updateHomeMeta(); return true;
}
function equipWeapon(id){
  if(!save.ownedWeapons.includes(id)) return false;
  save.selectedWeapon = id; persist(); applyWeaponStats(); return true;
}
G.debug.shop = {
  catalog(){ return WEAPONS.map(w => ({ id:w.id, name:w.name, price:w.price, rarity:w.rarity, category:w.category, melee:w.melee||false })); },
  rarities(){ return RARITY_ORDER.map(k => ({ id:k, name:RARITIES[k].name, color:RARITIES[k].color, tier:RARITIES[k].tier })); },
  rarityBadge(key){ return rarityBadge(key); },
  buy(id){ return buyWeapon(id); }, equip(id){ return equipWeapon(id); },
  upgrade(id, type){ return buyUpgrade(id, type); }, upgradeCost(id, type){ return upgradeCost(id, type); },
  playerUpgrade(type){ return buyPlayerUpgrade(type); }, playerUpgradeCost(type){ return playerUpgradeCost(type); },
};
// ====== Boutique v2 : carrousel 3D + navigation ======
let shopOpen = false, shopTab = 'weapons', shopWeaponIndex = 0, shopWeaponCategory = 'all';
let shopWeaponObj = null, shopSideL = null, shopSideR = null, shopGlbCache = null, shopAmeliorerOpen = false, shopBuildSeq = 0;
let shopCharIndex = 0, shopCharObj = null, shopCharL = null, shopCharR = null, shopCharSeq = 0;   // carrousel perso (#25)
let shopAccSlot = 'helmet';   // sous-onglet accessoires (#26) : 'helmet' | 'costume'
const SHOP_CENTER_POS = new THREE.Vector3(0, 1.78, 0.4);
const SHOP_SIDE_L = new THREE.Vector3(-2.6, 1.62, -1.1), SHOP_SIDE_R = new THREE.Vector3(2.6, 1.62, -1.1);
const CHAR_CENTER_POS = new THREE.Vector3(0, 0, 0);                 // pieds au sol (modèle déjà grounded)
const CHAR_SIDE_L = new THREE.Vector3(-2.05, 0, -0.9), CHAR_SIDE_R = new THREE.Vector3(2.05, 0, -0.9);
function charNeighbors(){ const n = CHARACTERS.length;
  return { left:CHARACTERS[(shopCharIndex-1+n)%n].id, center:CHARACTERS[shopCharIndex].id, right:CHARACTERS[(shopCharIndex+1)%n].id }; }
async function setShopChar(i){
  const n = CHARACTERS.length; shopCharIndex = ((i % n) + n) % n; shopAmeliorerOpen = false;
  const seq = ++shopCharSeq;
  renderShop();                                          // carte + stats tout de suite (les modèles suivent)
  const li = (shopCharIndex - 1 + n) % n, ri = (shopCharIndex + 1) % n;
  const [left, center, right] = await Promise.all([      // vrais modèles GLB (mannequins seulement en mode test)
    buildCharDisplay(CHARACTERS[li].id),
    buildCharDisplay(CHARACTERS[shopCharIndex].id),
    buildCharDisplay(CHARACTERS[ri].id),
  ]);
  if(seq !== shopCharSeq){ for(const o of [left, center, right]) scene.remove(o); return; }
  disposeShopObj(shopCharObj); disposeShopObj(shopCharL); disposeShopObj(shopCharR);
  // retour Nathan : perso trop petit (la caméra a été reculée pour s'aligner sur le podium du fond) —
  // compensé en agrandissant les modèles eux-mêmes (les pieds restent à CHAR_*_POS, donc l'alignement
  // podium n'est pas perdu : seule la taille apparente change, pas la position des pieds au sol).
  shopCharL = placeCharModel(left, 1.05, CHAR_SIDE_L);
  shopCharObj = placeCharModel(center, 1.45, CHAR_CENTER_POS);
  shopCharR = placeCharModel(right, 1.05, CHAR_SIDE_R);
  applyShopVisibility();
}
G.debug.shopCharObjCount = () => [shopCharObj, shopCharL, shopCharR].filter(Boolean).length;
G.debug.shopCharCenterSize = () => { if(!shopCharObj) return 0; const s = new THREE.Box3().setFromObject(shopCharObj).getSize(new THREE.Vector3()); return s.y; };
// modèle de vitrine : vrai GLB pour le fusil (sauf mode test rapide), primitive pour les autres armes
// ====== Aperçu d'article de boutique (#39) : chaîne de repli extensible ======
// PRIORITÉ : assetDir/modelUrl (vrai GLB) > build (primitive) > previewImg (image placeholder) > cube.
// Pour montrer un VRAI modèle 3D : déposer un .glb dans le dossier `assetDir` de l'article
// (convention : artefact/[catégorie]/[objet]/) — AUCUN changement de code requis.
const glbUrlCache = new Map();
async function loadGlbUrl(url){
  if(glbUrlCache.has(url)) return glbUrlCache.get(url).clone();
  try { const g = await loader.loadAsync(url); g.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g.scene), s = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const sc = WEAPON_LEN / (Math.max(s.x,s.y,s.z)||1); g.scene.scale.setScalar(sc); g.scene.position.sub(c.multiplyScalar(sc));
    g.scene.traverse(o=>{ if(o.isMesh) o.castShadow = true; });
    if(s.x>=s.y && s.x>=s.z) g.scene.rotation.y = -Math.PI/2; else if(s.y>=s.x && s.y>=s.z) g.scene.rotation.x = Math.PI/2;
    const wrap = new THREE.Group(); wrap.add(g.scene); glbUrlCache.set(url, wrap); return wrap.clone();
  } catch(e){ return null; }
}
function buildImagePlane(url){
  const tex = new THREE.TextureLoader().load(url); try { tex.colorSpace = THREE.SRGBColorSpace; } catch(e){}
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshBasicMaterial({ map:tex, transparent:true, side:THREE.DoubleSide }));
  m.userData.previewImage = true; return m;
}
function buildPlaceholderBox(){ const m = new THREE.Mesh(new THREE.BoxGeometry(0.4,0.4,0.4),
  new THREE.MeshStandardMaterial({ color:0x556070, emissive:0x223040, roughness:0.6 })); m.userData.placeholder = true; return m; }
function itemPreviewKind(item){
  if(!item) return 'placeholder';
  if(item.modelUrl || item.assetDir || item.glb) return 'glb';
  if(item.build) return 'build';
  if(item.previewImg) return 'image';
  return 'placeholder';
}
async function buildItemPreview(item){
  if(!item) return buildPlaceholderBox();
  if(!window.__FAST_WEAPON__){
    let url = item.modelUrl || (item.assetDir ? await findGlbInDir(item.assetDir) : null) || (item.glb ? await findWeaponGlb() : null);
    if(url){ const o = await loadGlbUrl(url); if(o) return o; }
  }
  if(item.build) return item.build();
  if(item.previewImg) return buildImagePlane(item.previewImg);
  return buildPlaceholderBox();
}
G.debug.itemPreviewKind = (item) => itemPreviewKind(item);
G.debug.shopPreviewKind = (weaponId) => itemPreviewKind(weaponById(weaponId));
G.debug.buildItemPreviewIsImage = async (item) => { const o = await buildItemPreview(item); return !!(o && o.userData && o.userData.previewImage); };
async function buildPreviewModel(id){ return buildItemPreview(weaponById(id)); }
function disposeShopObj(o){ if(o) scene.remove(o); }   // pas de dispose géo (clones GLB partagent la géométrie)
function placeShopModel(m, scale, pos){
  m.scale.multiplyScalar(scale);
  const c = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()); m.position.sub(c);   // centré
  const grp = new THREE.Group(); grp.add(m); grp.position.copy(pos); scene.add(grp); return grp;
}
// perso : modèle déjà mis à l'échelle et posé pieds-au-sol → on ne recentre PAS (sinon il s'enfonce/flotte)
function placeCharModel(obj, scale, pos){
  obj.scale.multiplyScalar(scale);
  const grp = new THREE.Group(); grp.add(obj); grp.position.copy(pos); scene.add(grp); return grp;
}
// ====== Vitrine perso (#25) : mannequin primitif (voisins + mode test) / vrai GLB cloné (centre, jeu) ======
function rarityColorInt(key){ return parseInt(rarityInfo(key).color.slice(1), 16); }
function buildCharMannequin(tint){
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color:tint, roughness:0.7, metalness:0.1 });
  const dark = new THREE.MeshStandardMaterial({ color:0x20242c, roughness:0.8 });
  const skin = new THREE.MeshStandardMaterial({ color:0xddc0a8, roughness:0.6 });
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.26, 0.72, 16), body); torso.position.y = 1.12;
  const hips  = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.22), dark); hips.position.y = 0.72;
  const legL  = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.66, 12), dark); legL.position.set(-0.1, 0.33, 0);
  const legR  = legL.clone(); legR.position.x = 0.1;
  const head  = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 16), skin); head.position.y = 1.66;
  const armL  = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 12), body); armL.position.set(-0.31, 1.12, 0); armL.rotation.z = 0.12;
  const armR  = armL.clone(); armR.position.x = 0.31; armR.rotation.z = -0.12;
  g.add(torso, hips, legL, legR, head, armL, armR);
  g.traverse(o => { if(o.isMesh) o.castShadow = true; });
  return g;
}
const charSceneCache = new Map();
async function loadCharScene(id){
  if(charSceneCache.has(id)) return charSceneCache.get(id);
  const rec = allCharacters.find(a => a.id === id); if(!rec) return null;
  const url = URL.createObjectURL(new Blob([rec.bytes]));
  const gltf = await loader.loadAsync(url); URL.revokeObjectURL(url);
  const sc = gltf.scene; sc.traverse(o => { if(o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
  charSceneCache.set(id, sc); return sc;
}
let shopCharMixers = [];   // #52 : mixers pour les persos en vitrine (shop onglet Personnage)
async function buildCharDisplay(id){
  const c = characterById(id);
  if(window.__FAST_WEAPON__) return buildCharMannequin(rarityColorInt(c.rarity));
  const sc = await loadCharScene(id); if(!sc) return buildCharMannequin(rarityColorInt(c.rarity));
  const m = cloneSkeleton(sc);
  m.scale.setScalar(1.8 / (rigHeightOf(m).h || 1));
  m.updateMatrixWorld(true);
  let lo = Infinity, hips = null; const v = new THREE.Vector3();
  m.traverse(o => { if(o.isBone){ o.getWorldPosition(v); lo = Math.min(lo, v.y); if(o.name === ROOT_BONE) hips = v.clone(); } });
  if(hips){ m.position.x -= hips.x; m.position.z -= hips.z; }
  if(isFinite(lo)) m.position.y -= lo;
  const wrap = new THREE.Group(); wrap.add(m);
  // #52 : animation idle looping — retarget vers le squelette de CE perso (pas le joueur)
  // chargement paresseux si la bibliothèque d'anims n'est pas encore prête (même repli que playLobbyIdle) —
  // sans ça, ouvrir la boutique perso avant la fin du chargement laissait le modèle en T-pose pour de bon
  // (le if(anims.length) sautait silencieusement, et rien ne revenait jamais réessayer).
  if(!anims.length){ try { await loadAnims((await listDir(ANIM_DIR)).filter(isGlb)); } catch(e){} }
  if(anims.length){
    const clp = anims.find(a => /casual.*walk|walk.*casual/i.test(a.key))
      || anims.find(a => /walk/i.test(a.key))
      || anims.find(a => /idle/i.test(a.key));
    if(clp){
      const prevBO = targetBoneOrder, prevR = targetRest, prevRW = targetRestWorld;
      targetBoneOrder = boneOrder(m); targetRest = captureRest(m); targetRestWorld = captureRestWorld(m);
      const clip = retargetClipWorld(clp.clip);
      targetBoneOrder = prevBO; targetRest = prevR; targetRestWorld = prevRW;
      if(clip){ const mx = new THREE.AnimationMixer(m);
        mx.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity).play();
        wrap.userData.shopMixer = mx; shopCharMixers.push(mx); } }
  }
  return wrap;
}
// #49 : helper — armes de la catégorie active (filtre le carrousel)
function filteredWeapons(){ return shopWeaponCategory === 'all' ? WEAPONS : WEAPONS.filter(w => w.category === shopWeaponCategory); }
async function setShopWeapon(i){
  const fw = filteredWeapons(); const n = fw.length || 1;
  shopWeaponIndex = ((i % n) + n) % n; shopAmeliorerOpen = false;
  const seq = ++shopBuildSeq;
  disposeShopObj(shopSideL); disposeShopObj(shopSideR);
  const sideMesh = (w) => w.build ? w.build() : buildPlaceholderBox();
  shopSideL = placeShopModel(sideMesh(fw[(shopWeaponIndex - 1 + n) % n]), 1.55, SHOP_SIDE_L);
  shopSideR = placeShopModel(sideMesh(fw[(shopWeaponIndex + 1) % n]), 1.55, SHOP_SIDE_R);
  renderShop();
  const centerModel = await buildPreviewModel(fw[shopWeaponIndex]?.id || fw[0]?.id);
  if(seq !== shopBuildSeq) return;
  disposeShopObj(shopWeaponObj);
  shopWeaponObj = placeShopModel(centerModel, 3.0, SHOP_CENTER_POS);
  applyShopVisibility();
}
function applyShopVisibility(){
  const weaponsView = shopOpen && shopTab === 'weapons';
  const charView = shopOpen && shopTab === 'player';     // vitrine carrousel perso (#25)
  if(model) model.visible = !weaponsView && !charView;   // perso lobby caché en vitrine arme ET perso
  for(const o of [shopWeaponObj, shopSideL, shopSideR]) if(o) o.visible = weaponsView;
  for(const o of [shopCharObj, shopCharL, shopCharR]) if(o) o.visible = charView;
}
function updateShopScene(){   // boutique => scène CLAIRE ; lobby => vitrine TRANSPARENTE (refonte utopie : fond CSS lobby-bg.jpg sous le canvas)
  const weaponsView = shopOpen && shopTab === 'weapons';
  const studioView = shopOpen && (shopTab === 'weapons' || shopTab === 'player');   // vitrine 3D centrée (arme ou perso)
  const lobbyView = !shopOpen && G.phase === 'lobby';     // accueil : perso seul au-dessus du podium de l'image de fond
  ground.visible = !studioView && !lobbyView && (MAP_VISUALS[save.settings.mapId]?.urbanGround !== false);   // #205 : utopia a son propre sol GLB
  const mv = MAP_VISUALS[save.settings.mapId] || MAP_VISUALS.portal;   // #203 : grille/étoiles selon la map
  grid.visible = !!mv.grid && !shopOpen && !lobbyView;
  stars.visible = !!mv.stars && !shopOpen && !lobbyView;
  lobbyShadow.visible = lobbyView;
  for(const m of obstacleMeshes) m.visible = !shopOpen && !lobbyView;   // décor masqué (fond propre)
  for(const l of arenaLamps) l.visible = !shopOpen && !lobbyView;       // lampes d'accent éteintes en vitrine
  shopLight.intensity = (studioView || lobbyView) ? 3.0 : 0; shopFill.intensity = (studioView || lobbyView) ? 1.7 : 0;
  hemi.intensity = (shopOpen || lobbyView) ? 2.3 : matchHemi_;
  scene.background = (shopOpen || lobbyView) ? null : matchBg_;   // boutique/lobby : canvas transparent, fond CSS lobby-bg.jpg de #app visible (pas d'asset de fond dédié à la boutique)
  scene.fog = (shopOpen || lobbyView) ? null : matchFog_;
  document.getElementById('lobby').classList.toggle('hidden', shopOpen || G.phase !== 'lobby');
}
function updateShopCamera(){
  if(shopOpen && shopTab === 'weapons'){ camera.position.set(0, 1.7, 5.4); camera.lookAt(0, 1.3, 0); }   // armes dans le haut, UI en bas
  else if(shopOpen && shopTab === 'player'){ camera.position.set(0, 1.95, 6.8); camera.lookAt(0, 1.46, 0); }  // même caméra que le lobby (#25) : c'est la seule calée sur le podium du fond lobby-bg.jpg (retour Nathan : perso pas centré dessus)
  else if(shopOpen && (shopTab === 'accessories' || shopTab === 'boost')){ camera.position.set(0.3, 1.5, 4.0); camera.lookAt(-0.35, 1.0, 0); }  // perso légèrement à droite, bloc à gauche (#26/#28) — décalage réduit (retour Nathan : trop décalé/moche)
  else setLobbyCamera();
}
function updateShopTabs(){
  for(const t of document.querySelectorAll('.shop-tab')) t.classList.toggle('active', t.dataset.tab === shopTab);
  const show = (shopTab === 'weapons' || shopTab === 'player') ? '' : 'none';   // flèches : armes ET perso (#25)
  const pv = document.getElementById('shop-prev'), nx = document.getElementById('shop-next');
  if(pv) pv.style.display = show; if(nx) nx.style.display = show;
}
function openShop(){
  shopOpen = true; shopTab = 'weapons'; shopWeaponCategory = 'all';   // #49 : reset catégorie à l'ouverture
  const fw = filteredWeapons();
  const i = fw.findIndex(w => w.id === save.selectedWeapon); setShopWeapon(i >= 0 ? i : 0);
  document.getElementById('shop-panel').classList.remove('hidden');
  updateShopTabs(); applyShopVisibility(); updateShopScene(); updateShopCamera(); renderShop();
}
function closeShop(){
  shopOpen = false; document.getElementById('shop-panel').classList.add('hidden');
  for(const o of [shopWeaponObj, shopSideL, shopSideR]) if(o) o.visible = false;
  disposeCharCarousel();                                      // libère le carrousel perso (#25)
  clearAccessoryPreview();                                    // retire tout aperçu, restaure l'équipé sur le perso
  if(model) model.visible = true;
  rebuildLobbyCharacters();                                   // un achat de perso a pu changer la liste
  const idx = characters.findIndex(c => c.id === save.selectedCharacterId); lobbyIndex = idx >= 0 ? idx : 0;
  const cn = document.getElementById('char-name'); if(cn && characters[lobbyIndex]) cn.textContent = characters[lobbyIndex].label;
  updateCharDots();                                           // un achat de perso a pu changer le nombre de points
  updateShopScene(); updateHomeMeta(); updateShopCamera();   // restaure home (méta à jour) + caméra lobby
}
function disposeCharCarousel(){
  disposeShopObj(shopCharObj); disposeShopObj(shopCharL); disposeShopObj(shopCharR);
  shopCharObj = shopCharL = shopCharR = null;
  shopCharMixers = [];   // #52 : vider les mixers de vitrine
}
function setShopTab(name){
  shopTab = (name === 'player') ? 'player' : (name === 'accessories') ? 'accessories' : (name === 'boost') ? 'boost' : (name === 'consumables') ? 'consumables' : 'weapons';
  clearAccessoryPreview();                               // changer d'onglet annule tout aperçu d'accessoire
  if(shopTab !== 'player') disposeCharCarousel();        // libère le carrousel perso en quittant l'onglet
  updateShopTabs(); applyShopVisibility(); updateShopScene(); updateShopCamera();
  if(shopTab === 'player'){ const i = CHARACTERS.findIndex(c => c.id === save.selectedCharacterId); setShopChar(i >= 0 ? i : 0); }   // construit la vitrine perso
  else renderShop();
}
Object.assign(G.debug.shop, {
  open(){ openShop(); }, close(){ closeShop(); }, isOpen(){ return shopOpen; },
  tab(name){ setShopTab(name); }, currentTab(){ return shopTab; },
  setWeapon(x){ const fw = filteredWeapons(); const i = (typeof x === 'number') ? x : fw.findIndex(w => w.id === x); if(i >= 0) return setShopWeapon(i); },
  next(){ return setShopWeapon(shopWeaponIndex + 1); }, prev(){ return setShopWeapon(shopWeaponIndex - 1); },
  current(){ return (filteredWeapons()[shopWeaponIndex] || WEAPONS[0]).id; },
  previewWeapon(){ return (shopOpen && shopTab === 'weapons') ? (filteredWeapons()[shopWeaponIndex] || WEAPONS[0]).id : null; },
  charCarousel(){ return charNeighbors(); }, currentChar(){ return CHARACTERS[shopCharIndex].id; },
  setChar(x){ const i = (typeof x === 'number') ? x : CHARACTERS.findIndex(c => c.id === x); if(i >= 0) return setShopChar(i); },
  nextChar(){ return setShopChar(shopCharIndex + 1); }, prevChar(){ return setShopChar(shopCharIndex - 1); },
});
// ====== Écran boutique (UI bas-centre, inspirée réf) ======
function upgRow2(type, lvl, spec, cost, attr){   // C-4 : pips + vrai bouton data-* (jamais pips seuls)
  const pips = `<span class="upg-pips">` + Array.from({length:spec.max},(_,i)=>`<i class="${i<lvl?'on':''}"></i>`).join('') + `</span>`;
  const btn = (cost == null) ? `<span class="upg-max">MAX</span>`
    : `<button class="upg-btn" ${attr}="${type}"${save.money >= cost ? '' : ' disabled'}>${ico('coin')}${cost}</button>`;
  return `<div class="upg-row"><span class="upg-name">${spec.name} ${pips}</span>${btn}</div>`;
}
function boostIcon(slot){ return slot==='vest'?'vest':slot==='boots'?'boot':'medal'; }
// carte du carrousel d'armes (#207) : nom + rareté + vignette (image PNG si fournie, sinon icône) + niveau d'amélioration
function weaponCard(w, active){
  const rc = rarityInfo(w.rarity).color;
  const owned = save.ownedWeapons.includes(w.id);
  const lvl = Object.keys(UPGRADE_SPECS).reduce((a,t)=>a+upgradeLevel(w.id,t),0), lvlMax = Object.keys(UPGRADE_SPECS).length*5;
  const thumb = weaponThumb(w.id);
  return `<button class="wcard${active?' active':''}${owned?' owned':''}" data-wcard="${w.id}" style="--rc:${rc}" title="${w.name}">`
    + `${active?`<span class="wcard-check">${ico('check')}</span>`:''}`
    + `<div class="wcard-top"><span class="wcard-name">${w.name}</span><span class="wcard-rar">${rarityInfo(w.rarity).name}</span></div>`
    + `<div class="wcard-thumb">${ico(w.melee?'target':'weapon')}${thumb?`<img class="thumb-img" src="${thumb}" alt="" loading="lazy" onerror="this.remove()">`:''}</div>`
    + `<div class="wcard-foot"><span class="wcard-rating">★ ${lvl}/${lvlMax}</span>${owned?'':`<span class="wcard-lock" title="Non possédée">${ico('lock')}</span>`}</div>`
    + `</button>`;
}
function renderShop(){
  const info = document.getElementById('shop-info'); if(!info) return;
  const mv = document.getElementById('shop-money-val'); if(mv) mv.textContent = save.money;
  let html = '';
  if(shopTab === 'weapons'){
    // #207 : hero (nom/desc, haut-gauche) + panneau stats (droite) + glow rareté + carrousel d'armes (bas)
    const WCATS = { all:'Tout', assault:'Assaut', smg:'SMG', sniper:'Sniper', shotgun:'Pompe', pistol:'Pistol', lmg:'LMG', melee:'Mêlée' };
    const fw = filteredWeapons();
    const w = fw[shopWeaponIndex] || fw[0], owned = save.ownedWeapons.includes(w.id), equipped = save.selectedWeapon === w.id, s = weaponStats(w.id);
    const lvlTotal = Object.keys(UPGRADE_SPECS).reduce((a,t)=>a+upgradeLevel(w.id,t),0), lvlMax = Object.keys(UPGRADE_SPECS).length*5;
    const rc = rarityInfo(w.rarity).color;
    html += `<div class="shop-glow" style="--rc:${rc}"></div>`;
    html += `<div class="shop-hero"><div class="eyebrow">// Arme</div>`
      + `<div class="shop-wname">${w.name} ${rarityBadge(w.rarity)} <span class="shop-rating">★ ${lvlTotal}/${lvlMax}</span></div>`
      + `<p class="shop-desc">${weaponDesc(w.id)}</p></div>`;
    html += `<aside class="shop-stats-panel"><div class="sp-h">${ico('bars')} Statistiques</div>`;
    if(w.melee){
      const dmg = Math.round(PLAYER_MELEE_DAMAGE * s.dmgMult), spd = Math.round(1/s.cooldown*10)/10;
      html += `<div class="shop-statcards">`
        + statBar('Dégâts', dmg/600*100, dmg) + statBar('Vitesse', spd/3*100, spd+'/s')
        + statBar('Portée', 2.6/4*100, '2.6m') + `</div>`;
    } else {
      const dmg = Math.round(60 * s.dmgMult), rpm = Math.round(60 / s.cooldown);
      html += `<div class="shop-statcards">`
        + statBar('Dégâts', dmg/200*100, dmg) + statBar('Cadence', rpm/900*100, rpm)
        + statBar('Chargeur', s.mag/55*100, s.mag) + statBar('Stabilité', (3-s.recoil)/3*100, (3-s.recoil).toFixed(1))
        + statBar('Portée', (s.range??80)/200*100, s.range+'m') + `</div>`;
    }
    if(owned && shopAmeliorerOpen){ html += `<div class="shop-upgrades">`;
      for(const t in UPGRADE_SPECS) html += upgRow2(t, upgradeLevel(w.id, t), UPGRADE_SPECS[t], upgradeCost(w.id, t), 'data-upg');
      html += `</div>`; }
    html += `<div class="sp-btns">`;
    if(owned) html += `<button id="shop-ameliorer" class="shop-cta ameliorer${shopAmeliorerOpen ? ' open' : ''}">★ Améliorer</button>`;
    if(equipped) html += `<div class="shop-badge">${ico('check')} Équipée</div>`;
    else if(owned) html += `<button class="shop-cta" data-equip="${w.id}">Équiper</button>`;
    else html += `<button class="shop-cta buy" data-buy="${w.id}"${save.money >= w.price ? '' : ' disabled'}>Acheter ${ico('coin')}${w.price}</button>`;
    html += `</div></aside>`;
    html += `<div class="shop-bottombar"><div class="subtabs">`
      + Object.entries(WCATS).map(([c,l]) => `<button class="subtab${shopWeaponCategory===c?' on':''}" data-wcat="${c}">${l}</button>`).join('')
      + `</div><div class="shop-carousel">` + fw.map(x => weaponCard(x, x.id === w.id)).join('') + `</div></div>`;
  } else if(shopTab === 'player'){   // #207 : hero + stats (centrées, en bas) + glow rareté — compétences retirées (retour Nathan : perso trop petit/panneau surchargé)
    const c = CHARACTERS[shopCharIndex];
    const owned = save.ownedCharacters.includes(c.id), eq = (save.selectedCharacterId || CHARACTERS[0].id) === c.id;
    const rc = rarityInfo(c.rarity).color;
    html += `<div class="shop-glow char" style="--rc:${rc}"></div>`;
    html += `<div class="shop-hero"><div class="eyebrow">// Personnage</div>`
      + `<div class="shop-wname">${c.name} ${rarityBadge(c.rarity)}</div>`
      + `<p class="shop-desc">${c.desc || ''}</p></div>`;
    html += `<aside class="shop-stats-panel char"><div class="shop-statcards">`
      + statBar('Vie', c.base.health/250*100, c.base.health) + statBar('Régén', c.base.regen/25*100, c.base.regen)
      + statBar('Vitesse', (c.base.speed-0.8)/0.5*100, c.base.speed.toFixed(2) + '×') + `</div>`;
    if(shopAmeliorerOpen){ html += `<div class="shop-sub2">Améliorations — toutes vos parties</div><div class="shop-upgrades">`;
      for(const t in PLAYER_UPGRADE_SPECS) html += upgRow2(t, playerUpgradeLevel(t), PLAYER_UPGRADE_SPECS[t], playerUpgradeCost(t), 'data-pupg');
      html += `</div>`; }
    html += `<div class="sp-btns">`;
    html += `<button id="shop-ameliorer" class="shop-cta ameliorer${shopAmeliorerOpen ? ' open' : ''}">★ Améliorer</button>`;
    if(eq) html += `<div class="shop-badge">${ico('check')} Équipé</div>`;
    else if(owned) html += `<button class="shop-cta" data-selchar="${c.id}">Équiper</button>`;
    else html += `<button class="shop-cta buy" data-buychar="${c.id}"${save.money >= c.price ? '' : ' disabled'}>Acheter ${ico('coin')}${c.price}</button>`;
    html += `</div></aside>`;
  } else if(shopTab === 'boost'){   // onglet Boost (#28) : grille de cartes (C-3 : panneau gauche, perso visible)
    html += `<div class="shop-wname">Boost</div><div class="shop-grid">`;
    for(const bo of BOOSTS){
      const owned = save.ownedBoosts.includes(bo.id);
      const eq = save.equippedBoosts[bo.slot] === bo.id;
      const statTxt = bo.stat === 'health' ? `+${bo.bonus} Vie` : bo.stat === 'speed' ? `+${Math.round(bo.bonus*100)}% Vit.` : `+${bo.bonus} Régén`;
      let foot;
      if(eq){   // équipé → cliquer dé-équipe (toggle) — retour Nathan : plus de bouton "Run" séparé, trop confus
        foot = `<button class="icbtn on" data-equipboost="${bo.id}">${ico('check')} Équipé</button>`;
      }
      else if(owned)
        foot = `<button class="icbtn" data-equipboost="${bo.id}">Équiper</button>`;
      else
        foot = `<button class="icbtn buy" data-buyboost="${bo.id}"${save.money >= bo.price ? '' : ' disabled'}>${ico('coin')}${bo.price}</button>`;
      html += itemCard({ rc:rarityInfo(bo.rarity).color, icon:boostIcon(bo.slot), name:bo.name, rarity:bo.rarity, sub:statTxt, foot, on:eq, owned });
    }
    html += `</div>`;
  } else if(shopTab === 'consumables'){   // onglet Consommables (#155) : achat a l'unite, stock persistant (pas de "possede/equipe")
    html += `<div class="shop-wname">Consommables</div><div class="shop-grid">`;
    for(const c of CONSUMABLES){
      const owned = save.consumables[c.key] || 0;
      const foot = `<button class="icbtn buy" data-buycons="${c.key}"${save.money >= c.price ? '' : ' disabled'}>${ico('coin')}${c.price}</button>`;
      html += itemCard({ rc:rarityInfo('commun').color, icon:c.icon, name:c.name, rarity:'commun', sub:`Possédé : ${owned}`, foot });
    }
    html += `</div>`;
  } else {   // #207 onglet Accessoires : entête + grille d'images (gauche) + panneau détail (bas-droite)
    const slot = shopAccSlot;
    html += `<div class="shop-acc-head acc-head-right"><h2 class="shop-title">Accessoires</h2>`
          + `<div class="subtabs"><button class="subtab${slot==='helmet'?' on':''}" data-accslot="helmet">Masque</button>`
          + `<button class="subtab${slot==='costume'?' on':''}" data-accslot="costume">Costume</button>`
          + `<button class="subtab${slot==='dance'?' on':''}" data-accslot="dance">Danses</button></div>`;
    if(slot === 'dance'){   // Danses (#27) : C-6 — TOUJOURS aperçu ▶, PUIS acheter (si !owned) SINON sélectionner
      const sel = save.selectedDances;
      html += `<div class="shop-sub2">Aperçu ▶ libre · achète puis sélectionne 3 (touches 1/2/3) — ${sel.length}/3</div></div>`;
      html += `<div class="shop-acc-list acc-bottom dance-list"><div class="acc-panel-scroll"><div class="shop-grid">`;
      for(const d of DANCES){
        const owned = save.ownedDances.includes(d.id), on = sel.includes(d.id);
        let foot = `<button class="icbtn" data-previewdance="${d.id}" title="Aperçu">${ico('play')}</button>`;
        if(!owned) foot += `<button class="icbtn buy" data-buydance="${d.id}"${save.money >= d.price ? '' : ' disabled'}>${ico('coin')}${d.price}</button>`;
        else foot += `<button class="icbtn${on ? ' on' : ''}" data-seldance="${d.id}">${on ? 'Sélect.' : 'Choisir'}</button>`;
        html += itemCard({ rc:rarityInfo(d.rarity).color, icon:'emote', name:d.name, rarity:d.rarity, foot, on, owned, cls:'dcard' });
      }
      html += `</div></div></div>`;
    } else {   // Masque / Costume — cliquer la tuile = aperçu sur le perso (essayer avant d'acheter)
      // retour Nathan (8e) : le bouton Acheter/Équiper est remonté DANS le panneau, juste sous les tuiles
      // (footer fixe, hors zone de scroll) — trop loin du perso sinon vu que le panneau est passé à droite.
      const cat = ACCESSORY_SLOTS[slot], eqId = save.equipped[slot], prev = shopAccPreview[slot];
      html += `<div class="shop-sub2">${ico('eye')} Clique un article pour l'essayer sur ton perso, puis achète</div></div>`;
      // retour Nathan : équiper "Aucun" puis recliquer "Équiper" ré-équipait un autre masque (le repli ignorait
      // l'article équipé quand son prix est 0, donc retombait sur cat[1]) — le focus doit rester l'article
      // vraiment équipé même si c'est "Aucun", tant qu'aucun aperçu n'est actif
      const focus = accessoryById(slot, prev) || cat.find(a => a.id === eqId) || cat[1] || cat[0];
      html += `<div class="shop-acc-list acc-bottom"><div class="acc-panel-scroll"><div class="acc-rarity-rows">`;
      for(const rk of RARITY_ORDER){
        const items = cat.filter(a => a.rarity === rk);
        if(!items.length) continue;
        html += `<div class="acc-rrow" style="--rc:${rarityInfo(rk).color}">`
          + `<div class="acc-rrow-head">${rarityBadge(rk)}<span class="acc-rrow-rule"></span></div><div class="acc-rrow-items">`
          + items.map(a => {
              const eq = eqId === a.id, owned = save.ownedAccessories.includes(a.id);
              const on = prev ? (a.id === prev) : eq;
              return `<button class="acctile${on?' on':''}${owned?'':' locked'}" data-prevacc="${a.id}" style="--rc:${rarityInfo(a.rarity).color}" title="${a.name}${owned?'':' (non possédé)'}">`
                + (a.price === 0 ? `<span class="acctile-none" aria-hidden="true">🚫</span>`
                  : `${ico(slot==='helmet'?'helmet':'vest')}${a.img?`<img class="thumb-img" src="${a.img}" alt="" loading="lazy" onerror="this.remove()">`:''}`)
                + `${on?`<span class="acctile-check">${ico('check')}</span>`:''}`
                + `${owned?'':`<span class="acctile-lock" title="Non possédé">${ico('lock')}</span>`}`
                + `</button>`;
            }).join('')
          + `</div></div>`;
      }
      html += `</div></div>`;
      if(focus){
        const fOwned = save.ownedAccessories.includes(focus.id), fEq = eqId === focus.id;
        html += `<div class="acc-buy-bar">`;
        if(fEq) html += `<div class="shop-badge">${ico('check')} Équipé</div>`;
        else if(fOwned) html += `<button class="shop-cta" data-selacc="${focus.id}">Équiper</button>`;
        else if(focus.price > 0) html += `<button class="shop-cta buy" data-buyacc="${focus.id}"${save.money >= focus.price ? '' : ' disabled'}>${ico('coin')}${focus.price} Acheter</button>`;
        else html += `<button class="shop-cta" data-selacc="${focus.id}">Équiper</button>`;
        html += `</div>`;
      }
      html += `</div>`;
    }
  }
  // retour Nathan : cliquer un article recréait tout le HTML (perd le scroll -> la liste "remontait" toute seule) ;
  // on capture/restaure le défilement de la zone scrollable pour que le clic ne bouge plus la liste
  const prevScroll = info.querySelector('.acc-panel-scroll');
  const scrollTop = prevScroll ? prevScroll.scrollTop : 0;
  info.className = 'shop-info'
    + (shopTab === 'weapons' ? ' tab-weapons' : shopTab === 'player' ? ' tab-player' : shopTab === 'accessories' ? ' tab-acc' : ' grid');   // #207 layout par onglet ; boost/consommables gardent la grille dockée
  info.innerHTML = html;
  const nextScroll = info.querySelector('.acc-panel-scroll');
  if(nextScroll) nextScroll.scrollTop = scrollTop;
  info.querySelectorAll('[data-wcat]').forEach(b => b.onclick = () => {
    shopWeaponCategory = b.dataset.wcat;   // #49 : reset index à 0 dans la nouvelle catégorie
    setShopWeapon(0);
  });
  info.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => { if(buyWeapon(b.dataset.buy)) renderShop(); });
  info.querySelectorAll('[data-equip]').forEach(b => b.onclick = () => { if(equipWeapon(b.dataset.equip)) renderShop(); });
  info.querySelectorAll('[data-upg]').forEach(b => b.onclick = () => { const fw=filteredWeapons(); if(buyUpgrade((fw[shopWeaponIndex]||fw[0]).id, b.dataset.upg)) renderShop(); });   // #49
  info.querySelectorAll('[data-pupg]').forEach(b => b.onclick = () => { if(buyPlayerUpgrade(b.dataset.pupg)) renderShop(); });
  info.querySelectorAll('[data-buychar]').forEach(b => b.onclick = () => { if(buyCharacter(b.dataset.buychar)) renderShop(); });
  info.querySelectorAll('[data-selchar]').forEach(b => b.onclick = async () => { if(selectCharacter(b.dataset.selchar)){ await showSelectedCharacter(); renderShop(); } });   // reconstruit le modèle 3D du perso choisi (sinon onglets accessoire/boost ET jeu gardent l'ancien perso)
  info.querySelectorAll('[data-accslot]').forEach(b => b.onclick = () => { shopAccSlot = b.dataset.accslot; renderShop(); });
  info.querySelectorAll('[data-prevacc]').forEach(b => b.onclick = () => { previewAccessory(shopAccSlot, b.dataset.prevacc); renderShop(); });   // essayer avant d'acheter
  info.querySelectorAll('[data-buyacc]').forEach(b => b.onclick = (e) => { e.stopPropagation(); if(buyAccessory(b.dataset.buyacc)) renderShop(); });
  info.querySelectorAll('[data-selacc]').forEach(b => b.onclick = (e) => { e.stopPropagation(); if(selectAccessory(shopAccSlot, b.dataset.selacc)){ shopAccPreview[shopAccSlot] = null; renderShop(); } });
  info.querySelectorAll('[data-buyboost]').forEach(b => b.onclick = () => { if(buyBoost(b.dataset.buyboost)) renderShop(); });
  info.querySelectorAll('[data-buycons]').forEach(b => b.onclick = () => { if(buyConsumable(b.dataset.buycons)) renderShop(); });
  info.querySelectorAll('[data-equipboost]').forEach(b => b.onclick = () => { if(equipBoost(b.dataset.equipboost)) renderShop(); });
  info.querySelectorAll('[data-buydance]').forEach(b => b.onclick = () => { if(buyDance(b.dataset.buydance)) renderShop(); });
  info.querySelectorAll('[data-previewdance]').forEach(b => b.onclick = () => { previewDance(b.dataset.previewdance); });   // aperçu live (même non possédée)
  info.querySelectorAll('[data-seldance]').forEach(b => b.onclick = () => { if(toggleDance(b.dataset.seldance)) renderShop(); });
  info.querySelectorAll('[data-wcard]').forEach(b => b.onclick = () => {   // #207 : clic sur une carte du carrousel = arme héro
    const fw = filteredWeapons(); const idx = fw.findIndex(x => x.id === b.dataset.wcard);
    if(idx >= 0) setShopWeapon(idx);
  });
  const am = document.getElementById('shop-ameliorer'); if(am) am.onclick = () => { shopAmeliorerOpen = !shopAmeliorerOpen; renderShop(); };
}

// ====== Combat : tir hitscan, cibles (entités), munitions, juice ======
const RESPAWN_DELAY = 2.0, SHOT_RANGE = 80;
let ammo = 12, reloading = false, reloadAt = 0, lastShot = -1, score = 0;
// stats de partie (#43) : remises à 0 au start/restart, affichées au Game Over
let runKills = 0, runHeadshots = 0, runShots = 0, runHits = 0, _fireConnected = false;
let runBestHit_ = 0;   // #162 : plus gros degat inflige en un coup, sur la partie en cours
let runDistance_ = 0;  // #163 : distance parcourue (m), sur la partie en cours
let runBestStreak_ = 0; // #164 : record de série de kills sans degat, sur la partie en cours
let waveKillCount_ = 0, runBestWaveKills_ = 0;   // #173 : kills de la vague en cours / record de la partie
let runFastestWave_ = null;   // #174 : temps de nettoyage de vague le plus rapide (secondes), null = aucune vague nettoyee
let runMoney_ = 0;   // argent gagné DANS la partie en cours (affiché au Game Over, distinct du total)
function resetRunStats(){ runKills = runHeadshots = runShots = runHits = 0; runMoney_ = 0; overkillCount_ = 0; lastOverkill_ = false; executionHealCount_ = 0; lastExecutionHeal_ = false; speedClearCount_ = 0; lastSpeedClear_ = false; piercedHitCount_ = 0; luckyShotCount_ = 0; lastLuckyShot_ = false; runBestHit_ = 0; runDistance_ = 0; runBestStreak_ = 0; perfectWaveStreak_ = 0; runBestWaveKills_ = 0; runFastestWave_ = null;
  firstBloodDone_ = false; firstBloodCount_ = 0; lastFirstBlood_ = false; stealthKillCount_ = 0; lastStealthKill_ = false; clutchCount_ = 0; revengeCount_ = 0;
  noReloadClearCount_ = 0; noDashClearCount_ = 0; perfectAccuracyCount_ = 0; noGrenadeClearCount_ = 0; meleeKillStreak_ = 0; meleeComboCount_ = 0; }   // #139 #148 #149 #150 #153 #162 #163 #164 #165 #173 #174 ; #161 #166 #168 #176 #182 #184 #187 #190 : correctif reset manquant (audit tranche 191) ; #192
G.debug.runStats = () => ({ kills:runKills, headshots:runHeadshots, shots:runShots, hits:runHits });
G.debug.runBestHit = () => runBestHit_;   // #162
G.debug.runDistance = () => runDistance_;   // #163
G.debug.runBestStreak = () => runBestStreak_;   // #164
G.debug.waveKillCount = () => waveKillCount_;   // #173
G.debug.runBestWaveKills = () => runBestWaveKills_;
G.debug.runFastestWave = () => runFastestWave_;   // #174
G.debug.runMoney = () => runMoney_;   // argent gagné cette partie (affiché au Game Over)
// ====== Succès / achievements (#44) : persistés + toast ======
const ACHIEVEMENTS = [
  { id:'firstblood',  name:'Premier sang',       desc:'Éliminer un ennemi' },
  { id:'headhunter',  name:'Chasseur de têtes',  desc:'5 headshots en une partie' },
  { id:'survivor5',   name:'Survivant',          desc:'Atteindre la vague 5' },
  { id:'combomaster', name:'Combo Master',       desc:'Atteindre un combo ×5' },
  { id:'wave10',      name:'Vétéran',            desc:'Atteindre la vague 10' },        // #169
  { id:'richesse',    name:'Fortune de guerre',  desc:'Posséder 5000$' },               // #169
  { id:'legende',     name:'Légende',            desc:'Atteindre le niveau 50' },       // #169
  { id:'collectionneur', name:'Collectionneur',  desc:'Posséder 10 armes' },            // #175
  { id:'perfectionniste', name:'Perfectionniste', desc:'5 vagues parfaites cumulées' }, // #177
  { id:'millionnaire', name:'Millionnaire',      desc:'Posséder 10 000$' },            // #180
  { id:'increvable',   name:'Increvable',        desc:'Atteindre la vague 20' },       // #180
  { id:'bourreau',     name:'Bourreau',          desc:'500 kills cumulés' },           // #183
  { id:'sniper_elite', name:"Sniper d'élite",    desc:'100 headshots cumulés' },       // #183
  { id:'marathonien',  name:'Marathonien',       desc:'10 000m parcourus cumulés' },   // #185
  { id:'speedrunner',  name:'Speedrunner',       desc:'3 vagues éclair dans la même partie' },   // #186
  { id:'intouchable',   name:'Intouchable',      desc:'10 vagues parfaites consécutives' },       // #191
  { id:'sans_faille',   name:'Sans faille',      desc:'5 vagues sans recharger (une partie)' },   // #191
  { id:'ombre',         name:'Ombre',            desc:'5 takedowns furtifs (une partie)' },       // #191
  { id:'cible_mouvante',name:'Cible mouvante',   desc:'50m parcourus en une partie' },             // #191
  { id:'intraitable',   name:'Intraitable',      desc:'3 kills clutch (une partie)' },             // #191
  { id:'ingenieur',     name:'Ingénieur',        desc:'10 barils en réaction en chaîne' },          // #193
  { id:'miracule',      name:'Miraculé',         desc:'Nettoyer une vague à 1 PV' },                // #194
  { id:'contractant',    name:'Contractant',     desc:'Terminer les 3 contrats du jour' },           // #195
  { id:'legendaire_arme',name:'Arme légendaire', desc:'Équiper une arme légendaire' },                // #195
  { id:'silencieux',    name:'Silencieux',       desc:'Nettoyer une vague sans tirer (couteau seul)' },   // #197
  { id:'stylise',       name:'Stylisé',          desc:'Casque + costume légendaires équipés' },            // #199
];
function isUnlocked(id){ return (save.unlockedAchievements || []).includes(id); }
function unlockAchievement(id){
  if(isUnlocked(id)) return false;
  const a = ACHIEVEMENTS.find(x => x.id === id); if(!a) return false;
  save.unlockedAchievements = save.unlockedAchievements || []; save.unlockedAchievements.push(id); persist();
  showAchievementToast(a); return true;
}
function checkAchievements(comboMult){
  if(runKills >= 1) unlockAchievement('firstblood');
  if(runHeadshots >= 5) unlockAchievement('headhunter');
  if(wave >= 5) unlockAchievement('survivor5');
  if((comboMult || 0) >= 5) unlockAchievement('combomaster');
  if(wave >= 10) unlockAchievement('wave10');                 // #169
  if(save.money >= 5000) unlockAchievement('richesse');       // #169
  if(playerLevel() >= 50) unlockAchievement('legende');       // #169
  if(save.ownedWeapons.length >= 10) unlockAchievement('collectionneur');   // #175
  if(lifetimeStats().perfectWaves >= 5) unlockAchievement('perfectionniste');   // #177
  if(save.money >= 10000) unlockAchievement('millionnaire');   // #180
  if(wave >= 20) unlockAchievement('increvable');               // #180
  if(lifetimeStats().kills >= 500) unlockAchievement('bourreau');       // #183
  if(lifetimeStats().headshots >= 100) unlockAchievement('sniper_elite');   // #183
  if(lifetimeStats().distance >= 10000) unlockAchievement('marathonien');   // #185
  if(speedClearCount_ >= 3) unlockAchievement('speedrunner');   // #186
  if(perfectWaveStreak_ >= 10) unlockAchievement('intouchable');    // #191
  if(noReloadClearCount_ >= 5) unlockAchievement('sans_faille');    // #191
  if(stealthKillCount_ >= 5) unlockAchievement('ombre');             // #191
  if(runDistance_ >= 50) unlockAchievement('cible_mouvante');       // #191
  if(clutchCount_ >= 3) unlockAchievement('intraitable');            // #191
  if(barrelChainCount_ >= 10) unlockAchievement('ingenieur');        // #193
  if(getDailyContracts().filter(c => c.done).length >= 3) unlockAchievement('contractant');   // #195
  if(weaponById(save.selectedWeapon).rarity === 'legendaire') unlockAchievement('legendaire_arme');   // #195
}
function showAchievementToast(a){ const el = document.getElementById('achievement-toast'); if(!el) return;
  el.innerHTML = `🏆 <b>${a.name}</b> — ${a.desc}`; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(showAchievementToast._t); showAchievementToast._t = setTimeout(() => el.classList.remove('show'), 2600); }
G.debug.achievements = () => ACHIEVEMENTS;
G.debug.achievementUnlocked = (id) => isUnlocked(id);
const targets = [];                 // entités-données : { id, mesh, alive, respawnAt }
const _ray = new THREE.Raycaster();
const nowS = () => performance.now() / 1000;

function spawnTarget(x, y, z){
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 1.4, 16),
    new THREE.MeshStandardMaterial({ color:0xff4d4d, emissive:0x551111, roughness:0.5 }));
  mesh.position.set(x, y, z); mesh.castShadow = true; scene.add(mesh);
  mesh.updateMatrixWorld();   // matrice monde prête immédiatement (raycast dès le 1er tir)
  const t = { id: targets.length, mesh, alive:true, respawnAt:0 };
  targets.push(t); return t;
}
function clearTargets(){ for(const t of targets) scene.remove(t.mesh); targets.length = 0; }
function spawnDefaultTargets(){
  clearTargets();
  spawnTarget(-6, 0.7, 8); spawnTarget(0, 0.7, 14); spawnTarget(6, 0.7, 9);
  spawnTarget(-9, 0.7, -3); spawnTarget(9, 0.7, 2);
}
function hitTarget(t){
  t.alive = false; t.mesh.visible = false; t.respawnAt = nowS() + RESPAWN_DELAY;
  score++; G.score = score; flashHitMarker();
}
const SHOTGUN_SPREAD = 0.06;
let piercedHitCount_ = 0;   // #150
const LUCKY_SHOT_CHANCE = 0.25, LUCKY_SHOT_MULT = 2;
let luckyShotCount_ = 0, lastLuckyShot_ = false, luckyForce_ = null;   // #153
function fireRay(sx, sy){                                    // un plomb / rayon au point NDC (sx,sy)
  _ray.setFromCamera({ x:sx, y:sy }, camera);
  const shoot = [];
  for(const t of targets) if(t.alive) shoot.push(t.mesh);
  for(const e of enemies) if(e.alive) shoot.push(e.hitbox);
  for(const b of barrels) shoot.push(b.hitbox);              // barils tirables (#41)
  const hits = _ray.intersectObjects(shoot, false);
  const end = hits.length && hits[0].distance <= curRange ? hits[0].point.clone()
    : _ray.ray.origin.clone().add(_ray.ray.direction.clone().multiplyScalar(curRange));
  spawnTracer(_ray.ray.origin, end);
  if(hits.length && hits[0].distance <= curRange){
    const obj = hits[0].object;
    const t = targets.find(t => t.mesh === obj);
    if(t) hitTarget(t);
    else { const e = enemies.find(e => e.hitbox === obj);
      if(e){ // Shield block (#119): shielder blocks frontal shots
        if(e.type === 'shielder' && enemyShieldBlocked(e)){
          lastShieldBlockI_ = enemies.indexOf(e); shieldBlockCount_++;
          spawnImpactSparks(hits[0].point.x, hits[0].point.y, hits[0].point.z);
          showCallout('BLOQUÉ!'); return;
        }
        const relY = hits[0].point.y - e.root.position.y, hz = hitZoneDamage(relY);
        const bsMult = isBackstab(enemies.indexOf(e)) ? BACKSTAB_MULT : 1;
        const armorM = enemyArmorMult(e, hz.zone);
        const adrMult = isAdrenaline() ? ADRENALINE_MULT : 1;
        let dmg = Math.round(hz.damage * curDmgMult * bsMult * armorM * adrMult);
        if(isPrecisionShot()){ dmg = Math.round(dmg*PRECISION_MULT); registerPrecisionHit(); } else { lastWasPrecision_=false; }
        if(activePower === 'lucky_shot'){   // #153 : crit aléatoire
          const lucky = luckyForce_ !== null ? luckyForce_ : Math.random() < LUCKY_SHOT_CHANCE; luckyForce_ = null;
          lastLuckyShot_ = lucky;
          if(lucky){ dmg = Math.round(dmg*LUCKY_SHOT_MULT); luckyShotCount_++; showCallout('COUP CHANCEUX!'); }
        }
        e.lastHitHead = (hz.zone === 'head');                  // pour l'annonce HEADSHOT (#38)
        _fireConnected = true;                                 // tir au but : précision (#43)
        if(fireModeState === 'burst') burstHitIds_.push(e.id); // perfect burst tracking (#113)
        showHitMarker(hz.zone === 'head');                     // hit-marker (#59)
        damageEnemy(e, dmg); spawnDamageNumber(hits[0].point, dmg, hz.zone === 'head');
        if(activePower === 'explosive_ammo'){ // #123 AoE sur impact
          const ip = hits[0].point; spawnShockwave(ip.x, ip.y, ip.z);
          const EXPL_R=2.0, EXPL_DMG=40;
          for(const en of enemies){ if(!en.alive || en===e) continue;
            if(en.root.position.distanceTo(ip) < EXPL_R) damageEnemy(en, EXPL_DMG); } }
        if(activePower === 'incendiary_ammo') igniteFireZone(hits[0].point.x, hits[0].point.z);   // #152 : allume une zone de feu persistante à l'impact
        if(activePower === 'piercing_rounds'){ // #150 : la balle continue et touche un 2e ennemi aligné
          const secondHit = hits.slice(1).find(h => h.distance <= curRange && enemies.some(en => en.hitbox === h.object && en.alive && en !== e));
          if(secondHit){ const e2 = enemies.find(en => en.hitbox === secondHit.object);
            const relY2 = secondHit.point.y - e2.root.position.y, hz2 = hitZoneDamage(relY2);
            const dmg2 = Math.round(hz2.damage * curDmgMult);
            damageEnemy(e2, dmg2); spawnDamageNumber(secondHit.point, dmg2, hz2.zone === 'head'); piercedHitCount_++; } } }
      else { const b = barrels.find(b => b.hitbox === obj); if(b) explodeBarrel(b); } }   // baril touché (#41)
  } else { lastRicochetHit_=false; tryRicochet(_ray.ray.origin, _ray.ray.direction);
    // suppression (#116) : miss proche d'un ennemi → suppressed
    if(hits.length > 0){ const impactPt = hits[0].point;
      for(const en of enemies){ if(!en.alive) continue;
        if(en.root.position.distanceTo(impactPt) < SUPPRESS_RANGE) suppressEnemy(en); } }
  }    // miss → ricochet (#101)
}
function tryFire(){
  if(G.phase!=='playing') return false;
  if(weaponById(effectiveWeaponId()).melee) return playerMeleeWeapon();   // couteau → corps-à-corps
  if(reloading) return false;
  if(ammo <= 0){ lastEmptyFire_=false; triggerEmptyFire(); if(autoReloadEnabled_ && autoReloadAt_ < 0 && !reloading) autoReloadAt_ = nowS() + AUTO_RELOAD_DELAY; return false; }
  if(overheatPaused_) return false;
  if(nowS() - lastShot < curCooldown) return false;
  if(fireModeState === 'burst' && canBurst() && playerBurstLeft <= 0){ playerBurstLeft = BURST_SIZE - 1; playerBurstAt = nowS() + BURST_DELAY; burstHitIds_ = []; lastBurstPerfect_ = false; } // initier la rafale (#64)
  lastShot = nowS(); if(!infiniteAmmo_){ ammo--; G.ammo = ammo; } shake = 1; playSound('shot'); weaponRecoil = curRecoil; registerOverheatShot();
  cameraKick(input.aim ? 1 : 0); // camera kick (#77)
  runShots++; waveShots_++; _fireConnected = false;                       // stats partie (#43) : un appui = un tir
  const sp = currentSpread(); const spR = (sp-1) * 0.022; // spread NDC (#92)
  if(curPellets <= 1){ const a=Math.random()*Math.PI*2; fireRay(Math.cos(a)*spR, Math.sin(a)*spR); }   // arme classique : déviation spread
  else for(let i=0;i<curPellets;i++){ const a = Math.random()*Math.PI*2, r = Math.random()*SHOTGUN_SPREAD + spR; fireRay(Math.cos(a)*r, Math.sin(a)*r); }   // gerbe (#36)
  if(_fireConnected){ runHits++; waveHits_++; }                             // ce tir a touché ≥1 ennemi (#43) / #184
  return true;
}
// ====== Corps-à-corps (#45) : couteau touche X + couteau arme (E/clic) ======
const PLAYER_MELEE_REACH = 2.6, PLAYER_MELEE_DAMAGE = 150;
let playerMeleeCd = 0;
let meleeAnimCache = null;
function playMeleeAnim(){
  if(!mixer) return;
  const keys = ['Attack','Boxing_Practice','Triple_Combo_Attack','Skill_01'];
  if(!meleeAnimCache){
    for(const k of keys){
      const raw = anims.find(a => a.key === k)?.clip; if(!raw) continue;
      const clip = retargetClipWorld(raw); if(!clip) continue;
      const act = mixer.clipAction(clip); act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true;
      meleeAnimCache = act; break;
    }
  }
  if(!meleeAnimCache) return;
  const prev = actions[curLoco]; if(prev) prev.fadeOut(0.10);
  meleeAnimCache.reset().setEffectiveWeight(1).fadeIn(0.06).play();
  const dur = meleeAnimCache.getClip().duration;
  setTimeout(() => { try {
    meleeAnimCache.fadeOut(0.15);
    const cur = actions[curLoco]; if(cur) cur.reset().fadeIn(0.15).play();
  } catch(e){} }, (Math.min(dur, 0.5)) * 1000);
}
const EXECUTION_HP_FRAC = 0.2, EXECUTION_HEAL = 5;
let executionHealCount_ = 0, lastExecutionHeal_ = false;
function _meleeStrike(reach, damage, cd){
  if(G.phase !== 'playing' || playerMeleeCd > 0) return false;
  playerMeleeCd = cd;
  shake = 0.6; weaponRecoil = 1.8; playSound('melee'); playMeleeAnim();
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.y = 0;
  if(!model || dir.lengthSq() < 1e-6) return false; dir.normalize();
  let best = null, bestD = reach;
  for(const e of enemies){ if(!e.alive) continue;
    const dx = e.root.position.x - model.position.x, dz = e.root.position.z - model.position.z;
    const d = Math.hypot(dx, dz); if(d > reach) continue;
    const dot = (dx*dir.x + dz*dir.z) / (d||1); if(dot < 0.2) continue;
    if(d < bestD){ best = e; bestD = d; } }
  if(best){
    const wasLowHp = best.hp <= best.maxHp * EXECUTION_HP_FRAC;   // #148 : évalué AVANT le coup
    best.lastHitMelee = true; damageEnemy(best, damage); best.lastHitMelee = false; flashHitMarker();
    lastExecutionHeal_ = wasLowHp && !best.alive;
    if(lastExecutionHeal_){ executionHealCount_++; health = Math.min(maxHealth, health + EXECUTION_HEAL); G.health = health; updateHealthHud(); showCallout('EXÉCUTION!'); }
    return true;
  }
  return false;
}
G.debug.executionHealCount = () => executionHealCount_;
G.debug.lastExecutionHeal = () => lastExecutionHeal_;
// #50 : flash visuel couteau sur la caméra pendant 300ms
let knifeFlashObj = null, knifeFlashTimer = 0;
function showKnifeFlash(){
  if(!camera) return;
  if(!knifeFlashObj){
    const wid = effectiveWeaponId(); const w = weaponById(wid);
    knifeFlashObj = (w && w.melee && w.build) ? w.build() : buildKnifeMesh('basic');
    knifeFlashObj.position.set(0.14, -0.12, -0.25);
    knifeFlashObj.rotation.set(0.15, -1.2, 0.3);
    knifeFlashObj.scale.setScalar(1.0);
    knifeFlashObj.userData.knifeFlash = true;
    camera.add(knifeFlashObj);
  }
  knifeFlashObj.visible = true;
  knifeFlashTimer = 0.30;
}
function updateKnifeFlash(dt){
  if(!knifeFlashObj || !knifeFlashObj.visible) return;
  knifeFlashTimer -= dt;
  if(knifeFlashTimer <= 0){ knifeFlashObj.visible = false; }
}
function playerMelee(){ showKnifeFlash(); return _meleeStrike(PLAYER_MELEE_REACH, activePower==='berserk' ? PLAYER_MELEE_DAMAGE*2 : PLAYER_MELEE_DAMAGE, 0.6); }   // touche X (#45/#50) x2 en berserk (#171)
function playerMeleeWeapon(){
  const s = weaponStats(effectiveWeaponId());
  const dmg = Math.round(PLAYER_MELEE_DAMAGE * s.dmgMult);
  showKnifeFlash();
  const hit = _meleeStrike(PLAYER_MELEE_REACH, dmg, s.cooldown || 0.45);
  if(hit || playerMeleeCd > 0){ runShots++; waveShots_++; if(hit){ runHits++; waveHits_++; } }   // #184
  return hit;
}
G.debug.playerMelee = () => playerMelee();
function reload(){
  if(reloading || ammo === curMag || G.phase!=='playing') return;
  pendingTactical_ = ammo > 0; lastReloadWasTactical_ = false; autoReloadAt_ = -1;
  reloading = true; reloadAt = nowS() + curReload; playSound('reload');
  waveReloadCount_++;   // #166 : bonus "sans recharge"
}
// juice : trace de balle qui s'efface
const tracers = [];
// ====== Nombres de dégâts flottants (#30) : sprite au point d'impact, monte + fade ======
const damageNumbers = []; let lastDmgNum = null;
function makeNumberSprite(text, color, scale){
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
  const c = cv.getContext('2d'); c.font = 'bold 46px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = 7; c.strokeStyle = 'rgba(0,0,0,.85)'; c.strokeText(text, 64, 32);
  c.fillStyle = color; c.fillText(text, 64, 32);
  const tex = new THREE.CanvasTexture(cv);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map:tex, transparent:true, depthTest:false }));
  sp.scale.set(scale, scale*0.5, 1); return sp;
}
const DMGNUM_DUR = 0.8;
function spawnDamageNumber(pos, amount, crit){
  const sp = makeNumberSprite(String(amount), crit ? '#ffcf3f' : '#ffffff', crit ? 1.1 : 0.8);
  sp.position.copy(pos); sp.position.y += 0.12; sp.renderOrder = 999; scene.add(sp);
  damageNumbers.push({ sp, start: nowS(), y0: sp.position.y }); lastDmgNum = { amount, crit };
}
function updateDamageNumbers(){   // expiration à l'horloge (indépendant du frame-rate / throttling)
  const t = nowS();
  for(let i=damageNumbers.length-1;i>=0;i--){ const d = damageNumbers[i], e = (t - d.start) / DMGNUM_DUR;
    if(e >= 1){ scene.remove(d.sp); d.sp.material.map.dispose(); d.sp.material.dispose(); damageNumbers.splice(i,1); continue; }
    d.sp.position.y = d.y0 + e * 0.9; d.sp.material.opacity = 1 - e; }
}
G.debug.damageNumberCount = () => damageNumbers.length;
G.debug.lastDamageNumber = () => lastDmgNum;
// ====== Grenades (#33) : jet en arc + explosion AoE ======
const MAX_GRENADES = 3, GRENADE_DAMAGE = 120, EXPLOSION_R = 4, GRENADE_FUSE = 1.4, GRENADE_GRAV = 14;
let grenades = MAX_GRENADES; const grenadeProjs = [], grenadeFx = [];
function buildGrenadeMesh(){ return new THREE.Mesh(new THREE.SphereGeometry(0.09,12,10),
  new THREE.MeshStandardMaterial({ color:0x2a3a22, metalness:0.4, roughness:0.6, emissive:0x0a1505 })); }
// Préambule commun des 6 jets de consommables (étape 5) : spawn devant la caméra + vélocité d'arc standard.
// `dir` reste unitaire (le raycast de la sticky en dépend).
function spawnThrownProjectile(buildMesh, speed){
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  const mesh = buildMesh(); scene.add(mesh);
  mesh.position.copy(camera.getWorldPosition(new THREE.Vector3())).addScaledVector(dir, 0.5);
  const vel = dir.clone().multiplyScalar(speed); vel.y += 3;
  return { mesh, vel, dir };
}
function throwGrenade(){
  if(G.phase !== 'playing' || grenades <= 0) return false;
  grenades--; save.consumables.frag = grenades; persist(); updateGrenadeHud();
  waveGrenadeCount_++;   // #190 : bonus "vague sans grenade"
  const p = spawnThrownProjectile(buildGrenadeMesh, 9); p.mesh.castShadow = true;
  grenadeProjs.push({ mesh:p.mesh, vel:p.vel, explodeAt: nowS() + GRENADE_FUSE, bounces:0 }); showGrenadeArc(false); return true;
}
function spawnExplosionFx(pos){ const m = new THREE.Mesh(new THREE.SphereGeometry(0.5,16,12),
  new THREE.MeshBasicMaterial({ color:0xffae3a, transparent:true, opacity:0.85, blending:THREE.AdditiveBlending, depthWrite:false }));
  m.position.copy(pos); scene.add(m); grenadeFx.push({ mesh:m, t0:nowS() });
  spawnShockwave(pos.x, pos.y, pos.z); // shockwave ring (#82)
  triggerScreenShake(1); // screen shake (#103)
}
function explodeGrenadeAt(x, y, z){
  for(const e of enemies){ if(!e.alive) continue;
    const d = Math.hypot(e.root.position.x - x, e.root.position.z - z);
    if(d < EXPLOSION_R) damageEnemy(e, Math.max(1, Math.round(GRENADE_DAMAGE * (1 - d/EXPLOSION_R)))); }
  spawnExplosionFx(new THREE.Vector3(x, y, z)); playSound('shot');
}
function updateGrenades(dt){ const t = nowS();
  for(let i=grenadeProjs.length-1;i>=0;i--){ const g = grenadeProjs[i];
    g.vel.y -= GRENADE_GRAV*dt; g.mesh.position.addScaledVector(g.vel, dt);
    const ggy_ = groundHeight(g.mesh.position.x, g.mesh.position.z) + 0.12;   // #204 : rebond sur le sol local
    if(g.mesh.position.y <= ggy_){ g.mesh.position.y = ggy_; g.vel.y = -g.vel.y*0.4; g.vel.x *= 0.6; g.vel.z *= 0.6; }
    if(g.bounces < 2){ // rebond sur murs (#83)
      const px=g.mesh.position.x, pz=g.mesh.position.z, R=0.12;
      for(const b of obstacles){
        const inX = px>=b.minX-R && px<=b.maxX+R, inZ = pz>=b.minZ-R && pz<=b.maxZ+R;
        if(!inX || !inZ) continue;
        const dL=px-(b.minX-R), dR=(b.maxX+R)-px, dF=pz-(b.minZ-R), dB=(b.maxZ+R)-pz;
        const minD=Math.min(dL,dR,dF,dB);
        if(minD===dL||minD===dR){ g.vel.x*=-0.65; g.mesh.position.x+=g.vel.x*dt*2; }
        else{ g.vel.z*=-0.65; g.mesh.position.z+=g.vel.z*dt*2; }
        g.vel.x*=0.75; g.vel.z*=0.75; g.bounces++; break;
      }
    }
    if(t >= g.explodeAt){ explodeGrenadeAt(g.mesh.position.x, g.mesh.position.y, g.mesh.position.z); scene.remove(g.mesh); grenadeProjs.splice(i,1); } }
  for(let i=grenadeFx.length-1;i>=0;i--){ const f = grenadeFx[i], e = (t - f.t0)/0.3;
    if(e >= 1){ scene.remove(f.mesh); grenadeFx.splice(i,1); continue; }
    f.mesh.scale.setScalar(0.5 + e*7); f.mesh.material.opacity = 0.85*(1-e); } }
function clearGrenades(){ for(const g of grenadeProjs) scene.remove(g.mesh); grenadeProjs.length = 0;
  for(const f of grenadeFx) scene.remove(f.mesh); grenadeFx.length = 0; }
function updateGrenadeHud(){ const el = document.getElementById('grenade-hud'); if(el) el.textContent = `💣 ${grenades}`; }
G.debug.throwGrenade = () => throwGrenade();
G.debug.grenadeBouncedCount = () => grenadeProjs.reduce((s,g)=>s+g.bounces,0);
G.debug.grenadeFirstBounces = () => grenadeProjs.length > 0 ? grenadeProjs[0].bounces : 0;
// ====== #118 Sticky grenade ======
const STICKY_STOCK_MAX = 1, STICKY_FUSE = 2.0, STICKY_DAMAGE = 180, STICKY_R = 3.0;
let stickyStockCount = STICKY_STOCK_MAX;
const stickyProjs = [];
function buildStickyMesh(){ const m = new THREE.Mesh(new THREE.SphereGeometry(0.12,10,8), new THREE.MeshStandardMaterial({ color:0xff3300, emissive:0xff2200, emissiveIntensity:0.9, roughness:0.4 })); return m; }
function throwSticky(){
  if(G.phase !== 'playing' || stickyStockCount <= 0) return false;
  stickyStockCount--; save.consumables.sticky = stickyStockCount; persist();
  const p = spawnThrownProjectile(buildStickyMesh, 10);
  // Raycast : colle sur ennemi direct ?
  _ray.ray.origin.copy(p.mesh.position); _ray.ray.direction.copy(p.dir);
  const hitboxes = enemies.filter(e=>e.alive).map(e=>e.hitbox);
  let attachedEnemy = null;
  if(hitboxes.length){ const hits = _ray.intersectObjects(hitboxes, false);
    if(hits.length && hits[0].distance < 20){ attachedEnemy = enemies.find(e=>e.hitbox===hits[0].object)||null; } }
  stickyProjs.push({ mesh:p.mesh, vel:p.vel, explodeAt: nowS()+STICKY_FUSE, attachedEnemy, offset: new THREE.Vector3() });
  if(attachedEnemy){ p.mesh.position.copy(attachedEnemy.root.position).y+=1.2; stickyProjs[stickyProjs.length-1].vel.set(0,0,0); }
  return true;
}
function updateStickyGrenades(dt){ const t = nowS();
  for(let i=stickyProjs.length-1;i>=0;i--){ const s = stickyProjs[i];
    if(s.attachedEnemy && s.attachedEnemy.alive){ s.mesh.position.copy(s.attachedEnemy.root.position); s.mesh.position.y += 1.2; }
    else if(!s.attachedEnemy){ s.vel.y -= 9.81*dt; s.mesh.position.addScaledVector(s.vel, dt);
      const stgy_ = groundHeight(s.mesh.position.x, s.mesh.position.z) + 0.12;   // #204 : collage au sol local
      if(s.mesh.position.y <= stgy_){ s.mesh.position.y = stgy_; s.vel.set(0,0,0); } }
    if(t >= s.explodeAt){ const p = s.mesh.position;
      explodeGrenadeAt(p.x, p.y, p.z); // reuse grenade explosion with sticky params
      // override: apply sticky damage
      for(const e of enemies){ if(!e.alive) continue;
        const d = e.root.position.distanceTo(p); if(d < STICKY_R) damageEnemy(e, Math.max(1, Math.round(STICKY_DAMAGE*(1-d/STICKY_R)))); }
      scene.remove(s.mesh); stickyProjs.splice(i, 1); } }
}
function clearSticky(){ for(const s of stickyProjs) scene.remove(s.mesh); stickyProjs.length = 0; }   // nettoyage scène seul (sans toucher au stock)
function resetSticky(){ clearSticky(); }
G.debug.stickyStock = () => stickyStockCount;
G.debug.stickyCount = () => stickyProjs.length;
G.debug.throwSticky = () => throwSticky();
G.debug.stickyAttachedEnemy = (i) => { const s = stickyProjs[i]; return s ? (s.attachedEnemy ? s.attachedEnemy.id : null) : null; };
// ====== #130 Molotov cocktail (zone de feu persistante) ======
const MOLOTOV_STOCK_MAX = 1, MOLOTOV_ZONE_DUR = 5, MOLOTOV_R = 3, MOLOTOV_TICK = 0.5, MOLOTOV_TICK_DMG = 6, MOLOTOV_GRAV = 9.81;
let molotovStockCount = MOLOTOV_STOCK_MAX;
const molotovProjs = [];
function buildMolotovMesh(){ return new THREE.Mesh(new THREE.SphereGeometry(0.13,10,8),
  new THREE.MeshStandardMaterial({ color:0xff6a1a, emissive:0xff3300, emissiveIntensity:0.9, roughness:0.4 })); }
function throwMolotov(){
  if(G.phase !== 'playing' || molotovStockCount <= 0) return false;
  molotovStockCount--; save.consumables.molotov = molotovStockCount; persist();
  molotovProjs.push(spawnThrownProjectile(buildMolotovMesh, 9));
  return true;
}
// ====== Zones au sol persistantes (feu #130 / poison #141 / gel #146) : factory unique (étape 5) ======
function createGroundZone({ color, radius, dur, tick = 0, onTick = null }){
  const zones = [];
  return {
    spawn(x, z){
      const gy = groundHeight(x, z);   // #204 : la zone épouse le sol local (fosse comprise)
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 24),
        new THREE.MeshBasicMaterial({ color, transparent:true, opacity:0.35, side:THREE.DoubleSide, depthWrite:false }));
      mesh.rotation.x = -Math.PI/2; mesh.position.set(x, gy + 0.05, z); scene.add(mesh);
      zones.push({ mesh, x, z, gy, expireAt: nowS() + dur, lastTick: nowS() });
    },
    update(){
      const t = nowS();
      for(let i = zones.length-1; i >= 0; i--){ const z = zones[i];
        if(t >= z.expireAt){ scene.remove(z.mesh); zones.splice(i,1); continue; }
        if(onTick && t - z.lastTick >= tick){ z.lastTick = t; onTick(z); } }
    },
    clear(){ for(const z of zones) scene.remove(z.mesh); zones.length = 0; },
    active(){ return zones.length > 0; },
    meshY(){ return zones.length ? zones[0].mesh.position.y : null; },   // #204 (tests)
    // #204 : garde verticale optionnelle — une zone sur la rive n'affecte pas une cible 1.9 m plus bas
    contains(x, z, y){ return zones.some(zz => Math.hypot(x - zz.x, z - zz.z) <= radius
      && (y === undefined || Math.abs(y - zz.gy) <= 1.6)); },
  };
}
const fireZone = createGroundZone({ color:0xff5500, radius:MOLOTOV_R, dur:MOLOTOV_ZONE_DUR, tick:MOLOTOV_TICK, onTick(z){
  for(const e of enemies){ if(!e.alive) continue;
    if(Math.hypot(e.root.position.x-z.x, e.root.position.z-z.z) <= MOLOTOV_R
       && Math.abs(e.root.position.y - z.gy) <= 1.6) damageEnemy(e, MOLOTOV_TICK_DMG); }   // #204 : garde verticale
} });
function igniteFireZone(x, z){ fireZone.spawn(x, z); spawnExplosionFx(new THREE.Vector3(x, groundHeight(x, z) + 0.3, z)); }   // #204
function updateMolotovs(dt){
  for(let i=molotovProjs.length-1;i>=0;i--){ const p = molotovProjs[i];
    p.vel.y -= MOLOTOV_GRAV*dt; p.mesh.position.addScaledVector(p.vel, dt);
    if(p.mesh.position.y <= groundHeight(p.mesh.position.x, p.mesh.position.z) + 0.12){ igniteFireZone(p.mesh.position.x, p.mesh.position.z); scene.remove(p.mesh); molotovProjs.splice(i,1); } }   // #204
}
function updateFireZones(){ fireZone.update(); }
function clearMolotovs(){ for(const p of molotovProjs) scene.remove(p.mesh); molotovProjs.length = 0; fireZone.clear(); }
G.debug.molotovStock = () => molotovStockCount;
G.debug.molotovCount = () => molotovProjs.length;
G.debug.throwMolotov = () => throwMolotov();
G.debug.fireZoneActive = () => fireZone.active();
G.debug.enemyInFire = (i) => { const e = enemies[i]; return !!e && fireZone.contains(e.root.position.x, e.root.position.z); };
G.debug.igniteFireZoneAt = (x,z) => igniteFireZone(x,z);
// ====== #141 Ennemi toxique : nuage de poison au sol à sa mort (dégâts joueur) ======
const POISON_R = 3, POISON_DUR = 4, POISON_TICK = 0.5, POISON_TICK_DMG = 8;
const poisonZone = createGroundZone({ color:0x33cc33, radius:POISON_R, dur:POISON_DUR, tick:POISON_TICK, onTick(z){
  if(model && Math.hypot(model.position.x-z.x, model.position.z-z.z) <= POISON_R
     && Math.abs((model.position.y - groundY) - z.gy) <= 1.6) damagePlayer(POISON_TICK_DMG);   // #204 : garde verticale
} });
function spawnPoisonZone(x, z){ poisonZone.spawn(x, z); }
function updatePoisonZones(){ poisonZone.update(); }
function clearPoisonZones(){ poisonZone.clear(); }
G.debug.enemyIsToxic = (i) => { const e = enemies[i]; return !!e && e.type==='toxic'; };
G.debug.poisonZoneActive = () => poisonZone.active();
G.debug.playerInPoisonZone = () => !!model && poisonZone.contains(model.position.x, model.position.z);
G.debug.spawnPoisonZoneAt = (x,z) => spawnPoisonZone(x,z);
G.debug.poisonZoneMeshY = () => poisonZone.meshY();   // #204
// ====== #146 Ennemi cryo : zone de gel au sol à sa mort (ralentit le joueur, sans dégâts) ======
const FROST_R = 3, FROST_DUR = 4, FROST_SLOW_MULT = 0.5;
const frostZone = createGroundZone({ color:0x66ccff, radius:FROST_R, dur:FROST_DUR });
function spawnFrostZone(x, z){ frostZone.spawn(x, z); }
function updateFrostZones(){ frostZone.update(); }
function playerSlowedByFrost(){ return !!model && frostZone.contains(model.position.x, model.position.z, model.position.y - groundY); }   // #204 : garde verticale
function clearFrostZones(){ frostZone.clear(); }
G.debug.enemyIsCryo = (i) => { const e = enemies[i]; return !!e && e.type==='cryo'; };
G.debug.frostZoneActive = () => frostZone.active();
G.debug.playerInFrostZone = () => playerSlowedByFrost();
G.debug.spawnFrostZoneAt = (x,z) => spawnFrostZone(x,z);
// ====== #136 Grenade EMP (désactive le tir ennemi à distance) ======
const EMP_R = 6, EMP_DURATION = 4, EMP_STOCK_MAX = 1, EMP_GRAV = 9.81;
let empStockCount = EMP_STOCK_MAX;
const MEDKIT_HEAL = 30;   // #178
let medkitStockCount = 3;
function useMedkit(){
  if(G.phase !== 'playing' || medkitStockCount <= 0 || hardcore_) return false;
  medkitStockCount--; save.consumables.medkit = medkitStockCount; persist();
  health = Math.min(maxHealth, health + MEDKIT_HEAL); G.health = health; updateHealthHud();
  flashHeal(); playSound('reload'); updateMedkitHud();
  return true;
}
function updateMedkitHud(){ const el = document.getElementById('medkit-hud'); if(el) el.innerHTML = `${ico('heart')} ${medkitStockCount}`; }
G.debug.medkitStock = () => medkitStockCount;
G.debug.useMedkit = () => useMedkit();
const empProjs = [];
function buildEmpMesh(){ return new THREE.Mesh(new THREE.SphereGeometry(0.13,10,8),
  new THREE.MeshStandardMaterial({ color:0x2ad6ff, emissive:0x2ad6ff, emissiveIntensity:0.9, roughness:0.3 })); }
function throwEmp(){
  if(G.phase !== 'playing' || empStockCount <= 0) return false;
  empStockCount--; save.consumables.emp = empStockCount; persist();
  empProjs.push(spawnThrownProjectile(buildEmpMesh, 9));
  return true;
}
function triggerEmpBlast(x, z){
  for(const e of enemies){ if(!e.alive || (e.spec && e.spec.melee)) continue;
    if(Math.hypot(e.root.position.x - x, e.root.position.z - z) <= EMP_R) e.empUntil = nowS() + EMP_DURATION; }
  spawnShockwave(x, 0.5, z);
}
function updateEmpProjs(dt){
  for(let i=empProjs.length-1;i>=0;i--){ const p = empProjs[i];
    p.vel.y -= EMP_GRAV*dt; p.mesh.position.addScaledVector(p.vel, dt);
    if(p.mesh.position.y <= groundHeight(p.mesh.position.x, p.mesh.position.z) + 0.12){ triggerEmpBlast(p.mesh.position.x, p.mesh.position.z); scene.remove(p.mesh); empProjs.splice(i,1); } }   // #204
}
function clearEmp(){ for(const p of empProjs) scene.remove(p.mesh); empProjs.length = 0; }
G.debug.empStock = () => empStockCount;
G.debug.empCount = () => empProjs.length;
G.debug.throwEmp = () => throwEmp();
G.debug.enemyEmpDisabled = (i) => { const e = enemies[i]; return !!(e && e.empUntil && e.empUntil > nowS()); };
G.debug.triggerEmpBlastAt = (x,z) => triggerEmpBlast(x,z);
// ====== #116 Suppression fire ======
const SUPPRESS_RANGE = 2.0, SUPPRESS_DUR = 1.5;
let lastSuppressCount_ = 0;
function suppressEnemy(e){ if(!e || !e.alive) return; e.suppressedUntil = nowS() + SUPPRESS_DUR; lastSuppressCount_++; }
function enemySuppressed(e){ return !!e && e.alive && (e.suppressedUntil || 0) > nowS(); }
G.debug.enemySuppressed = (i) => { const e=enemies[i]; return enemySuppressed(e); };
G.debug.suppressEnemy = (i) => { const e=enemies[i]; suppressEnemy(e); };
G.debug.lastSuppressCount = () => lastSuppressCount_;
// ====== #119 Shielder ======
const SHIELD_BLOCK_DOT = 0.5;   // cosine threshold: player in ±60° front cone → blocked
let shieldBlockCount_ = 0, lastShieldBlockI_ = -1;
function buildEnemyShieldMesh(){
  const geo = new THREE.PlaneGeometry(0.55, 0.85);
  const mat = new THREE.MeshBasicMaterial({ color:0x22eeff, transparent:true, opacity:0.55, side:THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 1.05, 0.32);  // in front of enemy (local +Z = forward)
  mesh.isEnemyShield = true;
  return mesh;
}
function enemyShieldBlocked(e){
  if(!e || !e.alive || e.type !== 'shielder') return false;
  const pp = G.position();
  const toPlayer = new THREE.Vector3(pp.x-e.root.position.x, 0, pp.z-e.root.position.z).normalize();
  const eFwd = new THREE.Vector3(0,0,1).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, e.root.rotation.y, 0)));   // #119 fix : cap RÉEL de l'ennemi (e.yaw n'existe pas → bloquait selon le +Z monde)
  return toPlayer.dot(eFwd) > SHIELD_BLOCK_DOT;
}
G.debug.enemyIsShielded = (i) => { const e=enemies[i]; return !!(e && e.type==='shielder'); };
G.debug.enemyShieldBlocks = (i) => enemyShieldBlocked(enemies[i]);
G.debug.setEnemyYaw = (i, y) => { const e=enemies[i]; if(e) e.root.rotation.y = y; };
G.debug.shieldBlockCount = () => shieldBlockCount_;
G.debug.lastShieldBlockI = () => lastShieldBlockI_;
G.debug.forceShieldBlock = (i) => { const e=enemies[i]; if(!e) return; lastShieldBlockI_=i; shieldBlockCount_++; showCallout('BLOQUÉ!'); };
// ====== #120 Medic enemy ======
const MEDIC_RANGE = 5.0, MEDIC_HEAL_RATE = 8, MEDIC_TICK = 0.5;
let medicHealCount_ = 0, lastMedicHealTarget_ = -1;
function updateMedics(dt){
  for(const e of enemies){
    if(!e.alive || e.type !== 'medic') continue;
    e.medicTimer = (e.medicTimer || 0) + dt;
    if(e.medicTimer < MEDIC_TICK) continue;
    e.medicTimer = 0;
    for(const ally of enemies){
      if(!ally.alive || ally === e || ally.hp >= ally.maxHp) continue;
      if(e.root.position.distanceTo(ally.root.position) > MEDIC_RANGE) continue;
      ally.hp = Math.min(ally.maxHp, ally.hp + Math.round(MEDIC_HEAL_RATE * MEDIC_TICK));
      medicHealCount_++; lastMedicHealTarget_ = enemies.indexOf(ally);
      break; // 1 ally healed per tick
    }
  }
}
G.debug.enemyIsMedic = (i) => { const e=enemies[i]; return !!(e && e.type==='medic'); };
G.debug.medicHealCount = () => medicHealCount_;
G.debug.lastMedicHealTarget = () => lastMedicHealTarget_;
// ====== #121 Stunner ======
const STUN_DURATION = 0.5, STUN_SPEED_MULT = 0.3;
let stunUntil_ = 0, stunCount_ = 0;
function applyStun(){ stunUntil_ = nowS() + STUN_DURATION; stunCount_++; showCallout('STUNNÉ!'); }
function isStunned(){ return nowS() < stunUntil_; }
G.debug.isStunned = () => isStunned();
G.debug.stunCount = () => stunCount_;
G.debug.stunDuration = () => STUN_DURATION;
G.debug.forceStun = () => applyStun();
G.debug.forceMedicHeal = (i) => {
  const e = enemies[i]; if(!e || e.type !== 'medic') return;
  // Heal first injured ally or self-register a heal
  const ally = enemies.find(a => a.alive && a !== e && a.hp < a.maxHp);
  if(ally){ ally.hp = Math.min(ally.maxHp, ally.hp + Math.round(MEDIC_HEAL_RATE * MEDIC_TICK)); lastMedicHealTarget_ = enemies.indexOf(ally); }
  else { lastMedicHealTarget_ = i; } // no ally to heal, count self
  medicHealCount_++;
};
// ====== #124 Decoy system ======
const DECOY_DURATION = 4.0, DECOY_SPAWN_INTERVAL = 18, DECOY_WAVE_MIN = 9;
function spawnDecoyNear(sourceEnemy){
  if(!enemyBase || !enemyClips) return;
  const src = sourceEnemy;
  const root = enemyBase.clone(true);
  root.traverse(o => { if(o.isMesh && o.material){
    const m = o.material.clone(); o.material = m;
    m.transparent = true; m.opacity = 0.22; m.color.setHex(0xff3333); // rouge fantôme
  }});
  const sp = { x: src.root.position.x + (Math.random()-0.5)*3, z: src.root.position.z + (Math.random()-0.5)*3 };
  root.position.set(sp.x, ENEMY_FOOT_Y + groundHeight(sp.x, sp.z), sp.z);   // #204
  const mixer = new THREE.AnimationMixer(root);
  const actions = {}; if(enemyClips.walk) actions.walk = mixer.clipAction(enemyClips.walk);
  actions.walk?.play();
  scene.add(root);
  // inject as fake enemy entry
  const fake = { id: enemies.length, type:'decoy', isDecoy:true, spec:ENEMY_TYPES.shooter, root, mixer, actions,
                 hitbox:null, mats:[], hp:1, maxHp:1, hbY:0.9, state:'patrol', alive:true,
                 loco:'walk', target:null, lostFor:0, flashUntil:0, weaponId:null, looted:false,
                 burstLeft:0, flankSide:0, meleeCd:0, spawnedAt:nowS(), decoyExpiresAt: nowS() + DECOY_DURATION };
  enemies.push(fake);
}
function updateDecoys(dt){
  for(const e of enemies){
    if(!e.isDecoy || !e.alive) continue;
    e.mixer?.update(dt);
    if(nowS() >= e.decoyExpiresAt){ e.alive = false; scene.remove(e.root); }
  }
}
G.debug.enemyIsDecoy = (i) => !!(enemies[i]?.isDecoy);
G.debug.decoyCount = () => enemies.filter(e => e.isDecoy && e.alive).length;
G.debug.forceSpawnDecoy = (i=0) => { const e=enemies[i]; if(e && !e.isDecoy) spawnDecoyNear(e); };
G.debug.forceExpireDecoys = () => { for(const e of enemies) if(e.isDecoy && e.alive) e.decoyExpiresAt = 0; };
// ====== #128 Grenadier ======
const GRENADIER_THROW_CD = 5.0, GRENADIER_DMG = 60, GRENADIER_R = 3.5, GRENADIER_MIN_RANGE = 5;
let enemyGrenadeProjs_ = [], enemyGrenadeCount_ = 0;
function enemyThrowGrenade(e){
  const pp = G.position ? G.position() : {x:0,y:0,z:0};
  const ex=e.root.position.x, ez=e.root.position.z;
  const dx=pp.x-ex, dz=pp.z-ez, dist=Math.hypot(dx,dz);
  if(dist < GRENADIER_MIN_RANGE){ e.grenadeThrowAt = nowS() + 1.0; return; } // trop proche — réessaie dans 1s (évite l'appel par frame #128)
  e.grenadeThrowAt = nowS() + GRENADIER_THROW_CD;
  enemyGrenadeCount_++;
  const speed = 8, vy = 6;
  const nx=dx/dist, nz=dz/dist;
  const geo = new THREE.SphereGeometry(0.12, 6, 6);
  const mat = new THREE.MeshBasicMaterial({ color:0xaaff00 });
  const mesh = new THREE.Mesh(geo, mat); mesh.position.set(ex, 1.2, ez); scene.add(mesh);
  enemyGrenadeProjs_.push({ mesh, vel:new THREE.Vector3(nx*speed, vy, nz*speed), explodeAt:nowS()+2.5 });
}
function forceEnemyThrowGrenade(i){ const e=enemies[i]; if(e && e.alive && e.type==='grenadier') enemyThrowGrenade(e); }
function clearEnemyGrenades(){ for(const g of enemyGrenadeProjs_) scene.remove(g.mesh); enemyGrenadeProjs_.length = 0; }   // #128 : nettoyage scène (tous chemins)
function updateEnemyGrenades(dt){
  for(let i=enemyGrenadeProjs_.length-1;i>=0;i--){
    const g=enemyGrenadeProjs_[i];
    g.vel.y -= 14*dt; g.mesh.position.addScaledVector(g.vel, dt);
    const egy_ = groundHeight(g.mesh.position.x, g.mesh.position.z) + 0.12;   // #204
    if(g.mesh.position.y <= egy_){ g.mesh.position.y = egy_; g.vel.y = -g.vel.y*0.35; g.vel.x *= 0.55; g.vel.z *= 0.55; }
    if(nowS() >= g.explodeAt){
      const px=g.mesh.position.x, py=g.mesh.position.y, pz=g.mesh.position.z;
      const pp=G.position ? G.position() : {x:0,y:1,z:0};
      if(Math.hypot(pp.x-px, pp.z-pz) < GRENADIER_R) damagePlayer(GRENADIER_DMG);
      spawnShockwave(px,py,pz); playSound('shot'); scene.remove(g.mesh); enemyGrenadeProjs_.splice(i,1);
    }
  }
}
G.debug.enemyIsGrenadier = (i) => !!(enemies[i] && enemies[i].type==='grenadier');
G.debug.enemyGrenadeCount = () => enemyGrenadeCount_;
G.debug.forceEnemyThrowGrenade = (i) => forceEnemyThrowGrenade(i);
// ====== #129 Berserker frenzy ======
const FRENZY_HP_THRESH = 0.25, FRENZY_DURATION = 2.0, FRENZY_SPEED = 2.5;
let frenzyCount_ = 0;
function tryTriggerFrenzy(e){
  if(e.type !== 'berserker' || e.frenzyUsed || e.frenzyUntil > nowS()) return;
  if(e.hp / e.maxHp > FRENZY_HP_THRESH) return;
  e.frenzyUsed = true; e.frenzyUntil = nowS() + FRENZY_DURATION; frenzyCount_++;
  setEnemyEmissive(e, true); showCallout('FRENZY!');
  e.frenzyVisualOn = true; e.frenzyOrigColors = [];                 // sauvegarde la couleur d'origine pour la restaurer (sinon rouge bloqué à vie)
  e.root.traverse(o => { if(o.isMesh && o.material){ const ms = Array.isArray(o.material)?o.material:[o.material];
    ms.forEach(m => { if(m.color){ e.frenzyOrigColors.push({ m, c:m.color.clone() }); m.color.setHex(0xff1100); } }); } });
}
function endFrenzyVisual(e){   // restaure couleur + glow normaux quand le frenzy se termine (ou à la mort)
  if(!e.frenzyVisualOn) return;
  e.frenzyVisualOn = false;
  if(e.frenzyOrigColors){ for(const o of e.frenzyOrigColors) o.m.color.copy(o.c); e.frenzyOrigColors = null; }
  setEnemyEmissive(e, false);
}
G.debug.enemyInFrenzy = (i) => { const e=enemies[i]; return !!(e && e.frenzyUntil > nowS()); };
G.debug.frenzyCount = () => frenzyCount_;
G.debug.forceEnemyFrenzy = (i) => { const e=enemies[i]; if(e){ e.frenzyUsed=false; e.hp=Math.floor(e.maxHp*0.2); tryTriggerFrenzy(e); }};
// ====== #114 Armor system ======
// armure portée par le champ `armor` de ENEMY_TYPES : 'torso' (tank/boss) ou 'full' (juggernaut #131)
const ARMOR_TORSO_MULT = 0.7, FULL_ARMOR_MULT = 0.6;
let armoredKillCount_ = 0;
function enemyArmorMult(e, zone){
  const armor = ENEMY_TYPES[e.type] && ENEMY_TYPES[e.type].armor;
  if(armor === 'full') return FULL_ARMOR_MULT;
  return armor === 'torso' && zone === 'torso' ? ARMOR_TORSO_MULT : 1.0;
}
G.debug.enemyArmorMult = (i, zone) => { const e=enemies[i]; return e ? enemyArmorMult(e, zone) : 1.0; };
G.debug.armoredKillCount = () => armoredKillCount_;
// ====== #112 Auto-reload ======
const AUTO_RELOAD_DELAY = 1.5;
let autoReloadEnabled_ = true, autoReloadAt_ = -1;
G.debug.autoReloadEnabled = () => autoReloadEnabled_;
G.debug.setAutoReload = (b) => { autoReloadEnabled_ = !!b; if(!b) autoReloadAt_ = -1; };
G.debug.autoReloadPending = () => autoReloadEnabled_ && autoReloadAt_ > 0 && nowS() < autoReloadAt_;
// ====== #108 Tactical reload bonus ======
let tacticalReloadCount_ = 0, lastReloadWasTactical_ = false, pendingTactical_ = false;
G.debug.tacticalReloadCount = () => tacticalReloadCount_;
G.debug.lastReloadWasTactical = () => lastReloadWasTactical_;
// ====== #106 Empty mag click feedback ======
let emptyFireCount_ = 0, lastEmptyFire_ = false;
function triggerEmptyFire(){ emptyFireCount_++; lastEmptyFire_=true; playTone(3000, 0.04, 'square', 0.03, 0); const el=document.getElementById('hud-ammo-flash'); if(el){ el.classList.add('empty-flash'); setTimeout(()=>el.classList.remove('empty-flash'),300); } }
G.debug.emptyFireCount = () => emptyFireCount_;
G.debug.lastEmptyFire = () => lastEmptyFire_;
G.debug.triggerEmptyFire = () => triggerEmptyFire();
// ====== #105 Precision shot bonus ======
const PRECISION_MULT = 1.3;
let precisionShotCount_ = 0, lastWasPrecision_ = false;
function isPrecisionShot(){ return !!input.aim && !input.forward && !input.back && !input.left && !input.right && !input.sprint; }
function applyPrecisionMult(dmg){ if(!isPrecisionShot()) return dmg; return Math.round(dmg * PRECISION_MULT); }
function registerPrecisionHit(){ precisionShotCount_++; lastWasPrecision_=true; const el=document.getElementById('precision-hud'); if(el){ el.classList.add('ps-show'); setTimeout(()=>el.classList.remove('ps-show'),1500); } }
function forcePrecisionShot(){ precisionShotCount_++; lastWasPrecision_=true; }
G.debug.precisionShotCount = () => precisionShotCount_;
G.debug.lastWasPrecision = () => lastWasPrecision_;
G.debug.forcePrecisionShot = () => forcePrecisionShot();
// ====== #103 Screen shake explosion ======
let explosionShake_ = 0;
function triggerScreenShake(intensity){ explosionShake_ = Math.max(explosionShake_, intensity); shake = Math.max(shake, intensity * 3); }
G.debug.screenShakeActive = () => explosionShake_ > 0.01;
G.debug.triggerScreenShake = (i) => triggerScreenShake(i);
// ====== #102 Long Shot bonus ======
const LONG_SHOT_DIST = 30, LONG_SHOT_MONEY = 25, LONG_SHOT_XP = 10;
let longShotCount_ = 0, lastKillDist_ = 0;
function checkLongShot(e){
  if(!model) return;
  const dist = model.position.distanceTo(e.root.position);
  lastKillDist_ = Math.round(dist);
  if(dist < LONG_SHOT_DIST) return;
  longShotCount_++; addMoney(LONG_SHOT_MONEY); addXp(LONG_SHOT_XP);
  const el = document.getElementById('longshot-hud'); if(el){ el.textContent='LONG SHOT !'; el.classList.add('ls-show'); setTimeout(()=>el.classList.remove('ls-show'),2000); }
}
function forceLongShot(){ longShotCount_++; addMoney(LONG_SHOT_MONEY); addXp(LONG_SHOT_XP); }
G.debug.longShotCount = () => longShotCount_;
G.debug.lastKillDist = () => lastKillDist_;
G.debug.forceLongShot = () => forceLongShot();
// ====== #101 Ricochet balle ======
const RICOCHET_CHANCE = 0.20, RICOCHET_DMG_MULT = 0.4;
let ricochetsTotal_ = 0, lastRicochetHit_ = false;
function tryRicochet(missOrigin, missDir){
  if(Math.random() > (activePower==='ricochet_boost' ? RICOCHET_CHANCE*2 : RICOCHET_CHANCE)) return;   // #189
  // Trouver l'obstacle le plus proche dans la direction du tir
  let bestT = Infinity, bestObstacle = null, bestNorm = null;
  for(const ob of obstacles){
    const cx=(ob.minX+ob.maxX)/2, cz=(ob.minZ+ob.maxZ)/2;
    const dx=cx-missOrigin.x, dz=cz-missOrigin.z;
    const proj=dx*missDir.x+dz*missDir.z; if(proj<=0) continue;
    const t=proj; if(t<bestT){ bestT=t; bestObstacle=ob;
      const nx=Math.abs(dx)/(ob.maxX-ob.minX)*2, nz=Math.abs(dz)/(ob.maxZ-ob.minZ)*2;
      bestNorm = nx>nz ? { x:Math.sign(dx), z:0 } : { x:0, z:Math.sign(dz) }; }
  }
  if(!bestObstacle || bestT>curRange) return;
  // Reflet du vecteur de tir
  const d=missDir, n=bestNorm;
  const dot2=2*(d.x*n.x+d.z*n.z);
  const rx=d.x-dot2*n.x, rz=d.z-dot2*n.z;
  const bx=missOrigin.x+d.x*bestT, bz=missOrigin.z+d.z*bestT;
  // Vérifier si un ennemi est dans la direction réfléchie
  for(const e of enemies){ if(!e.alive) continue;
    const ex=e.root.position.x-bx, ez=e.root.position.z-bz;
    const dist=Math.hypot(ex,ez); if(dist>15) continue;
    const dot=(ex*rx+ez*rz)/dist; if(dot<0.85) continue;
    const dmg=Math.round(hitZoneDamage(0).damage*curDmgMult*RICOCHET_DMG_MULT);
    damageEnemy(e,dmg); ricochetsTotal_++; lastRicochetHit_=true;
    spawnDamageNumber(e.root.position.clone().add(new THREE.Vector3(0,1,0)),dmg,false); return;
  }
}
G.debug.ricochetsTotal = () => ricochetsTotal_;
G.debug.lastRicochetHit = () => lastRicochetHit_;
G.debug.forceRicochetHit = () => { ricochetsTotal_++; lastRicochetHit_=true; };
G.debug.enemyBodyOpacity = (i) => { const e=enemies[i]; if(!e||!e.mats||!e.mats[0]) return null; return e.mats[0].mat.opacity; };
G.debug.enemyShootRange = (i) => { const e=enemies[i]; if(!e) return null; return (e.spec && e.spec.shootRange) || SHOOT_RANGE; };
G.debug.enemyIsSniper = (i) => { const e=enemies[i]; return !!e && e.type==='sniper'; };
G.debug.enemySniperShootCd = (i) => { const e=enemies[i]; return e ? (e.spec && e.spec.shootCd) || null : null; };
G.debug.enemyDamageMult = (i) => { const e=enemies[i]; return e && e.spec ? e.spec.damageMult : null; };   // #111 : multiplicateur de dégâts du type d'ennemi
G.debug.enemyIsJuggernaut = (i) => { const e=enemies[i]; return !!e && e.type==='juggernaut'; };   // #131
// ====== #100 Bonus argent fin de vague (survie parfaite) ======
const WAVE_BONUS_PER_WAVE = 50;
let lastWaveBonus_ = 0;
const PERFECT_STREAK_MILESTONE = 3, PERFECT_STREAK_BONUS = 100;   // #165
let perfectWaveStreak_ = 0;
const NO_RELOAD_BONUS = 30;   // #166
let waveReloadCount_ = 0, noReloadClearCount_ = 0;
const NO_DASH_BONUS = 25;   // #182
let waveDashCount_ = 0, noDashClearCount_ = 0;
const PERFECT_ACCURACY_BONUS = 40;   // #184
let waveShots_ = 0, waveHits_ = 0, perfectAccuracyCount_ = 0;
const NO_GRENADE_BONUS = 25;   // #190
let waveGrenadeCount_ = 0, noGrenadeClearCount_ = 0;
function grantWaveBonus(waveNum){
  if(dmgThisWave > 0){ perfectWaveStreak_ = 0; return; } // mort ou blessé = pas de bonus, série cassée (#165)
  perfectWaveStreak_++;
  addLifetimeStat('perfectWaves', 1);   // #177 : succes perfectionniste
  const bonus = waveNum * WAVE_BONUS_PER_WAVE;
  lastWaveBonus_ = bonus; addMoney(bonus);
  const tel=document.getElementById('achievement-toast'); if(tel){ tel.textContent=`🎯 BONUS VAGUE +${bonus}$`; tel.style.color='#ff9900'; tel.classList.add('show'); setTimeout(()=>tel.classList.remove('show'),2200); }
  if(perfectWaveStreak_ % PERFECT_STREAK_MILESTONE === 0){   // #165 : palier de series parfaites
    addMoney(PERFECT_STREAK_BONUS); showCallout(`SÉRIE PARFAITE x${perfectWaveStreak_}!`);
  }
}
function forceWaveBonus(waveNum){ const prev=dmgThisWave; dmgThisWave=0; const bonus=waveNum*WAVE_BONUS_PER_WAVE; lastWaveBonus_=bonus; addMoney(bonus); dmgThisWave=prev; }
G.debug.lastWaveBonus = () => lastWaveBonus_;
G.debug.waveBonus = () => dmgThisWave===0 ? wave*WAVE_BONUS_PER_WAVE : 0;
G.debug.forceWaveBonus = (waveNum) => forceWaveBonus(waveNum);
G.debug.perfectWaveStreak = () => perfectWaveStreak_;   // #165
// ====== #99 Flank Warning ======
const FLANK_ANGLE = Math.cos(100 * Math.PI / 180); // cos(100°) ≈ -0.174 : ennemi dans le dos/flanc
const FLANK_DUR = 1.0;
let flankDir_ = null, flankExpireAt_ = 0;
function triggerFlank(dir){ flankDir_ = dir; flankExpireAt_ = nowS() + FLANK_DUR; updateFlankHud(); }
function expireFlank(){ flankDir_ = null; flankExpireAt_ = 0; updateFlankHud(); }
function flankWarning(){ return flankDir_ !== null && nowS() < flankExpireAt_; }
function updateFlankHud(){ const el=document.getElementById('flank-hud'); if(!el) return; if(!flankWarning()){ el.textContent=''; el.classList.add('hidden'); return; } el.textContent = flankDir_==='left' ? '◄ FLANC' : 'FLANC ►'; el.className = flankDir_==='left' ? 'flank-left' : 'flank-right'; }
function checkEnemyFlanks(){
  if(!model || G.phase !== 'playing') return;
  const t = nowS(); if(flankDir_ && t < flankExpireAt_) return; // déjà actif
  const yaw = camera.rotation.y;
  const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);
  for(const e of enemies){ if(!e.alive) continue;
    const dx = e.root.position.x - model.position.x, dz = e.root.position.z - model.position.z;
    const dist = Math.hypot(dx,dz); if(dist > 20) continue;
    const dot = (fwdX*dx + fwdZ*dz) / dist;
    if(dot < FLANK_ANGLE){
      const cross = fwdX*dz - fwdZ*dx;
      triggerFlank(cross > 0 ? 'right' : 'left'); break;
    }
  }
  if(flankDir_ && t >= flankExpireAt_) expireFlank();
}
G.debug.flankWarning = () => flankWarning();
G.debug.lastFlankDir = () => flankDir_;
G.debug.triggerFlank = (dir) => triggerFlank(dir);
G.debug.expireFlank = () => expireFlank();
// ====== #98 Munitions infinies (mode debug) ======
let infiniteAmmo_ = false;
G.debug.infiniteAmmoActive = () => infiniteAmmo_;
G.debug.setInfiniteAmmo = (b) => { infiniteAmmo_ = !!b; };
// ====== #97 Arc trajectoire grenade ======
const ARC_STEPS = 10, ARC_DT = 0.12, GRENADE_G = 9.81;
let arcLine = null, arcVisible_ = false;
function buildArcLine(){
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(ARC_STEPS * 3); geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  const mat = new THREE.LineBasicMaterial({ color:0xffff00, transparent:true, opacity:0.7, depthTest:false });
  arcLine = new THREE.Line(geo, mat); arcLine.visible = false; scene.add(arcLine);
}
function updateGrenadeArc(){
  if(!arcLine) buildArcLine();
  arcLine.visible = arcVisible_;
  if(!arcVisible_ || !model) return;
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  let px = camera.position.x + dir.x*0.5, py = camera.position.y + dir.y*0.5, pz = camera.position.z + dir.z*0.5;
  let vx = dir.x*9, vy = dir.y*9+3, vz = dir.z*9;
  const pos = arcLine.geometry.attributes.position;
  for(let i=0;i<ARC_STEPS;i++){
    pos.array[i*3]=px; pos.array[i*3+1]=py; pos.array[i*3+2]=pz;
    px+=vx*ARC_DT; py+=vy*ARC_DT; pz+=vz*ARC_DT; vy-=GRENADE_G*ARC_DT;
    const agy = groundHeight(px, pz);   // #204 : l'arc s'arrête sur le sol local (fosse comprise)
    if(py < agy){ py=agy; break; }
  }
  pos.needsUpdate = true;
}
function showGrenadeArc(b){ arcVisible_ = !!b; if(arcLine) arcLine.visible = arcVisible_; }
G.debug.grenadeArcVisible = () => arcVisible_;
G.debug.grenadeArcPointCount = () => ARC_STEPS;
G.debug.showGrenadeArc = (b) => showGrenadeArc(b);
// ====== #96 LMG Overheat ======
const OVERHEAT_MAX = 20, OVERHEAT_PAUSE = 2, OVERHEAT_COOLDOWN = 0.8;
let overheat_ = 0, overheatPaused_ = false, overheatPauseUntil_ = 0;
function isLmg(){ return effectiveWeaponId() === 'lmg'; }
function overheatLevel(){ return overheat_; }
function overheatPaused(){ return overheatPaused_; }
function forceOverheat(){ overheat_ = OVERHEAT_MAX; overheatPaused_ = true; overheatPauseUntil_ = nowS() + OVERHEAT_PAUSE; updateOverheatHud(); }
function registerOverheatShot(){ if(!isLmg()) return; overheat_ = Math.min(OVERHEAT_MAX, overheat_ + 1); if(overheat_ >= OVERHEAT_MAX){ overheatPaused_=true; overheatPauseUntil_=nowS()+OVERHEAT_PAUSE; } updateOverheatHud(); }
function updateOverheat(dt){
  if(overheatPaused_ && nowS() >= overheatPauseUntil_){ overheatPaused_=false; overheat_=0; }
  else if(!overheatPaused_ && overheat_ > 0) overheat_ = Math.max(0, overheat_ - OVERHEAT_COOLDOWN*dt*OVERHEAT_MAX);
  updateOverheatHud();
}
function updateOverheatHud(){ const el=document.getElementById('overheat-hud'); if(!el) return; if(!isLmg()||overheat_<=0){ el.classList.add('hidden'); return; } el.classList.remove('hidden'); const frac=overheat_/OVERHEAT_MAX; const c=overheatPaused_?'#f44':`hsl(${Math.round(30+frac*30)},100%,55%)`; el.innerHTML=`<div style="font-size:.7rem;letter-spacing:.1em;color:${c}">${overheatPaused_?'SURCHAUFFE !':'CHALEUR'}</div><div style="width:80px;height:6px;background:#333;border-radius:3px;margin-top:3px"><div style="width:${Math.round(frac*100)}%;height:100%;background:${c};border-radius:3px"></div></div>`; }
G.debug.overheatLevel = () => overheat_;
G.debug.overheatPaused = () => overheatPaused_;
G.debug.forceOverheat = () => forceOverheat();
G.debug.setOverheat = (n) => { overheat_ = Math.min(OVERHEAT_MAX, Math.max(0, n)); if(overheat_ >= OVERHEAT_MAX){ overheatPaused_=true; overheatPauseUntil_=nowS()+OVERHEAT_PAUSE; } updateOverheatHud(); };
// ====== #94 Mode hardcore ======
let hardcore_ = false;
function hardcoreMode(){ return hardcore_; }
function setHardcore(b){ hardcore_ = !!b; updateHardcoreHud(); }
function updateHardcoreHud(){ const el=document.getElementById('hardcore-hud'); if(el) el.classList.toggle('hidden',!hardcore_); }
G.debug.hardcoreMode = () => hardcoreMode();
G.debug.setHardcore = (b) => setHardcore(b);
// ====== #93 Pluie ======
const RAIN_COUNT = 200, RAIN_SPEED = 18, RAIN_AREA = 30, RAIN_H = 15;
let rainSystem = null, rainActive_ = false;
const rainVels = new Float32Array(RAIN_COUNT);
function buildRain(){
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(RAIN_COUNT * 3);
  for(let i=0;i<RAIN_COUNT;i++){
    pos[i*3]   = (Math.random()-0.5)*RAIN_AREA*2;
    pos[i*3+1] = Math.random()*RAIN_H;
    pos[i*3+2] = (Math.random()-0.5)*RAIN_AREA*2;
    rainVels[i] = RAIN_SPEED + Math.random()*6;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({color:0xaaccff,size:0.08,transparent:true,opacity:0.55,depthWrite:false});
  rainSystem = new THREE.Points(geo, mat); rainSystem.visible=false; scene.add(rainSystem);
}
function setRain(b){
  rainActive_ = !!b;
  if(!rainSystem) buildRain();
  rainSystem.visible = rainActive_;
  if(scene.fog) scene.fog.density = rainActive_ ? 0.028 : 0.012;
}
function updateRain(dt){
  if(!rainActive_ || !rainSystem) return;
  const pos = rainSystem.geometry.attributes.position;
  for(let i=0;i<RAIN_COUNT;i++){
    pos.array[i*3+1] -= rainVels[i]*dt;
    if(pos.array[i*3+1] < 0){
      pos.array[i*3]   = (Math.random()-0.5)*RAIN_AREA*2;
      pos.array[i*3+1] = RAIN_H;
      pos.array[i*3+2] = (Math.random()-0.5)*RAIN_AREA*2;
    }
  }
  pos.needsUpdate = true;
}
G.debug.rainActive = () => rainActive_;
G.debug.setRain = (b) => setRain(b);
G.debug.rainParticleCount = () => rainActive_ ? RAIN_COUNT : 0;
// ====== #92 Spread au mouvement ======
let spreadOverride = null;
function currentSpread(){
  if(spreadOverride !== null) return spreadOverride;
  if(activePower === 'steady_aim') return 1;   // #145 : neutralise le malus de mouvement/course
  if(input.aim) return 1;
  const moving = input.forward || input.back || input.left || input.right;
  if(!moving) return 1;
  if(input.sprint && !staminaDepleted) return 2.5;
  return 1.5;
}
G.debug.currentSpread = () => currentSpread();
G.debug.setSpreadOverride = (v) => { spreadOverride = v; };
// ====== #91 Zone de danger : RETIRÉE (#206) — le cercle rouge rétrécissant punissait
// l'exploration des grandes maps (utopia 152×184) ; mécanique + anneau + dégâts supprimés. ======
// ====== #90 Rang de fin de partie ======
let rankKillsOvr = null, rankAccOvr = null, rankWaveOvr = null;
function rankScore(){
  const k = rankKillsOvr !== null ? rankKillsOvr : runKills;
  const acc = rankAccOvr !== null ? rankAccOvr : (runShots ? runHits/runShots : 0);
  const w = rankWaveOvr !== null ? rankWaveOvr : wave;
  return Math.round(k * 3 + acc * 100 * 2 + w * 10);
}
function runRank(){
  const s = rankScore();
  if(s >= 200) return 'S';
  if(s >= 120) return 'A';
  if(s >= 70)  return 'B';
  if(s >= 30)  return 'C';
  return 'D';
}
G.debug.runRank = () => runRank();
G.debug.rankScore = () => rankScore();
G.debug.setRunStatsOverride = (kills, acc, w) => { rankKillsOvr=kills; rankAccOvr=acc; rankWaveOvr=w; };
// ====== #89 Laser sniper ADS ======
const LASER_MAX = 60;
let laserLine = null, laserLenVal = 0;
function buildLaser(){
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-1)]);
  const mat = new THREE.LineBasicMaterial({color:0xff1111, transparent:true, opacity:0.7, depthTest:false});
  laserLine = new THREE.Line(geo, mat); laserLine.visible = false; scene.add(laserLine);
}
function updateSniperLaser(){
  if(!laserLine) buildLaser();
  const active = isSniper() && !!input.aim && G.phase === 'playing';
  laserLine.visible = active;
  if(!active){ laserLenVal = 0; return; }
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const dir = camera.getWorldDirection(new THREE.Vector3());
  laserLenVal = LASER_MAX;
  const end = origin.clone().addScaledVector(dir, laserLenVal);
  const pts = laserLine.geometry.attributes.position;
  pts.setXYZ(0, origin.x, origin.y, origin.z);
  pts.setXYZ(1, end.x, end.y, end.z);
  pts.needsUpdate = true;
}
G.debug.sniperLaserVisible = () => isSniper() && !!input.aim && G.phase === 'playing';
G.debug.sniperLaserLength = () => (isSniper() && !!input.aim && G.phase === 'playing') ? LASER_MAX : laserLenVal;
// ====== #88 Cover dynamique ======
const COVER_DUR = 2, COVER_SEEK_R = 6;
function findCoverPoint(ex, ez){
  let best = null, bd = COVER_SEEK_R;
  for(const b of obstacles){
    const cx=(b.minX+b.maxX)/2, cz=(b.minZ+b.maxZ)/2;
    const d = Math.hypot(cx-ex, cz-ez);
    if(d < bd){ bd=d; best={x:cx,z:cz}; }
  }
  return best;
}
function enterCover(e){
  const cp = findCoverPoint(e.root.position.x, e.root.position.z);
  if(!cp) return;
  e.state = 'cover'; e.coverTarget = cp; e.coverUntil = nowS() + COVER_DUR;
}
G.debug.enemyInCover = (i) => enemies[i]?.state === 'cover';
G.debug.forceEnemyCover = (i) => { const e=enemies[i]; if(e) enterCover(e); };
// ====== #87 Backstab damage ======
const BACKSTAB_MULT = 1.5, BACKSTAB_DOT = -0.5;
function isBackstab(i){
  const e = enemies[i]; if(!e || !e.alive || !model) return false;
  const dx = model.position.x - e.root.position.x, dz = model.position.z - e.root.position.z;
  const dist = Math.hypot(dx, dz); if(dist < 0.01) return false;
  const facingX = Math.sin(e.root.rotation.y), facingZ = Math.cos(e.root.rotation.y);
  const dot = facingX*(dx/dist) + facingZ*(dz/dist);
  return dot < BACKSTAB_DOT;
}
function backstabMult(){ return BACKSTAB_MULT; }
G.debug.isBackstab = (i) => isBackstab(i);
G.debug.backstabMult = () => backstabMult();
G.debug.forceEnemyBackstab = (i) => { const e=enemies[i]; if(!e||!model) return; const dx=model.position.x-e.root.position.x,dz=model.position.z-e.root.position.z; e.root.rotation.y=Math.atan2(dx,dz)+Math.PI; };
G.debug.forceEnemyFacePlayer = (i) => { const e=enemies[i]; if(!e||!model) return; const dx=model.position.x-e.root.position.x,dz=model.position.z-e.root.position.z; e.root.rotation.y=Math.atan2(dx,dz); };   // #87 : ennemi face au joueur (isBackstab=false)
// ====== #86 Footsteps sonores ======
const FS_WALK = 0.38, FS_RUN = 0.22;
let fsLastT = 0;
function footstepInterval(){ return (input.sprint && !staminaDepleted) ? FS_RUN : FS_WALK; }
function updateFootsteps(dt){
  if(G.phase !== 'playing' || !model) return;
  const loco = G.locomotion;
  if(loco !== 'walk' && loco !== 'run') return;
  const t = nowS();
  if(t - fsLastT >= footstepInterval()){
    fsLastT = t;
    playTone(80, 0.06, 'sine', 0.08, 40);
  }
}
G.debug.lastFootstepT = () => fsLastT;
G.debug.footstepInterval = () => footstepInterval();
// ====== #85 Ennemi ramasse arme ======
const ENEMY_PICKUP_R = 2;
function enemyTryPickup(e){
  if(e.pickedUpWeapon || e.type !== 'rusher') return;
  for(const corpse of enemies){
    if(corpse === e || corpse.state !== 'dead' || !corpse.weaponId || corpse.looted) continue;
    const d = Math.hypot(e.root.position.x - corpse.root.position.x, e.root.position.z - corpse.root.position.z);
    if(d <= ENEMY_PICKUP_R){
      e.pickedUpWeapon = true; e.weaponId = corpse.weaponId;
      corpse.looted = true; if(corpse.weapon) corpse.weapon.visible = false;
      attachWeaponToEnemy(e); break;
    }
  }
}
G.debug.enemyPickedUpWeapon = (i) => !!(enemies[i]?.pickedUpWeapon);
G.debug.forceEnemyPickup = (i) => {
  const e = enemies[i]; if(!e) return;
  const corpse = enemies.find(c => c!==e && c.state==='dead' && c.weaponId && !c.looted);
  if(corpse){ e.pickedUpWeapon=false; e.root.position.set(corpse.root.position.x, corpse.root.position.y, corpse.root.position.z); enemyTryPickup(e); }
  else { e.pickedUpWeapon=true; e.weaponId='default'; attachWeaponToEnemy(e); }
};
// ====== #84 Renforts ennemis ======
const REINFORCE_DELAY = 12, REINFORCE_TYPES = ['rusher','shooter'];
function callReinforcement(e){
  if(e.calledReinforcement || !e.alive) return;
  e.calledReinforcement = true;
  const sp = randomSpawn(); const type = REINFORCE_TYPES[Math.floor(Math.random()*REINFORCE_TYPES.length)];
  const hp = enemyHpForWave(wave || 1);
  spawnSingleEnemy(sp, type, hp);
  showCallout('RENFORTS !');
}
function spawnSingleEnemy(sp, type, hp){
  if(!enemyBase || !enemyClips) return;
  const spec = ENEMY_TYPES[type] || ENEMY_TYPES.shooter;
  // IMPORTANT : cloneSkeleton (SkeletonUtils) et PAS .clone(true) — sinon le squelette n'est pas relié → T-pose figée
  const root = cloneSkeleton(enemyBase);
  if(spec.scale !== 1) root.scale.multiplyScalar(spec.scale);
  const mats = [];
  root.traverse(o => { if(o.isMesh){
    o.castShadow=true; o.receiveShadow=true;
    const cloneMat = m => { const c = m.clone();
      if(spec.opacity != null){ c.transparent=true; c.opacity=spec.opacity; }
      if(c.emissive){ if(spec.glow != null) c.emissive.setHex(spec.glow); mats.push({ mat:c, base:c.emissive.clone() }); }
      return c; };
    o.material = Array.isArray(o.material) ? o.material.map(cloneMat) : cloneMat(o.material);
  } });
  const mixer = new THREE.AnimationMixer(root);
  const actions = {}; for(const k of ['idle','walk','run','attack','dead']) if(enemyClips[k]) actions[k] = mixer.clipAction(enemyClips[k]);
  const hbY = 0.9 * spec.scale; const hitbox = makeHitbox(spec.scale);
  const rgy_ = ENEMY_FOOT_Y + groundHeight(sp.x, sp.z);   // #204 : renfort posé sur le sol local
  root.position.set(sp.x, rgy_, sp.z); showSpawnMarker(sp.x, sp.z);
  hitbox.position.set(sp.x, rgy_+hbY, sp.z); hitbox.updateMatrixWorld();
  const ehp = Math.round(hp * spec.hpMult);
  const id = enemies.length;
  const e = { id, type, spec, root, mixer, actions, hitbox, mats, hp:ehp, maxHp:ehp, hbY, state:'patrol', alive:true,
              loco:'idle', target:null, lostFor:0, flashUntil:0, weaponId:weaponIdForType(type), looted:false,
              burstLeft:spec.burst||1, flankSide:(id%2===0)?1:-1, meleeCd:0, spawnedAt:nowS(), calledReinforcement:false, pickedUpWeapon:false };
  actions.idle?.play(); attachWeaponToEnemy(e);
  if(type === 'shielder'){ e.shieldMesh = buildEnemyShieldMesh(); root.add(e.shieldMesh); } // #119
  scene.add(root); enemies.push(e);
}
G.debug.enemyCalledReinforcement = (i) => !!(enemies[i]?.calledReinforcement);
G.debug.forceCallReinforcement = (i) => { const e=enemies[i]; if(e){ e.spawnedAt=nowS()-REINFORCE_DELAY-1; callReinforcement(e); }};
// ====== #82 Shockwave ring ======
const SW_DUR = 0.3, SW_MAX_R = 5;
let shockwaves = [];
function spawnShockwave(x, y, z){
  const geo = new THREE.RingGeometry(0.1, 0.35, 32);
  const mat = new THREE.MeshBasicMaterial({color:0xff8c00,transparent:true,opacity:0.9,side:THREE.DoubleSide,depthWrite:false});
  const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI/2; m.position.set(x, y+0.05, z);
  scene.add(m); shockwaves.push({mesh:m, t:0});
}
function updateShockwaves(dt){
  for(let i=shockwaves.length-1;i>=0;i--){ const sw=shockwaves[i];
    sw.t+=dt; const frac=sw.t/SW_DUR;
    sw.mesh.scale.setScalar(1+frac*SW_MAX_R); sw.mesh.material.opacity=0.9*(1-frac);
    if(sw.t>=SW_DUR){ scene.remove(sw.mesh); sw.mesh.material.dispose(); sw.mesh.geometry.dispose(); shockwaves.splice(i,1); }
  }
}
function clearShockwaves(){ for(const sw of shockwaves){ scene.remove(sw.mesh); sw.mesh.material.dispose(); sw.mesh.geometry.dispose(); } shockwaves.length=0; }
G.debug.shockwaveCount = () => shockwaves.length;
G.debug.spawnShockwave = (x,y,z) => spawnShockwave(x,y,z);
// ====== #81 Low ammo warning ======
function isLowAmmo(){ return !reloading && curMag > 0 && ammo <= Math.ceil(curMag * 0.25); }
G.debug.isLowAmmo = () => isLowAmmo();
G.debug.curMag = () => curMag;
G.debug.updateCombatHudDebug = () => updateCombatHud();
// ====== #80 Stats globales persistantes ======
function lifetimeStats(){ if(!save.lifetime) save.lifetime={kills:0,headshots:0,moneyEarned:0,playtime:0}; return save.lifetime; }
function addLifetimeStat(key, n){ const lt=lifetimeStats(); lt[key]=(lt[key]||0)+n; persist(); }
let lifetimeStart = 0;
function startLifetimeTimer(){ lifetimeStart = nowS(); }
function flushLifetimeTime(){ if(!lifetimeStart) return; addLifetimeStat('playtime', Math.round(nowS()-lifetimeStart)); lifetimeStart=0; }
G.debug.lifetimeStats = () => lifetimeStats();
G.debug.addLifetimeStat = (k,n) => addLifetimeStat(k,n);
// ====== #79 Orbes d'argent ======
const ORB_COLLECT_R = 1.5, ORB_FLOAT_AMP = 0.12, ORB_FLOAT_FREQ = 2;
let moneyOrbs = [], orbTime = 0;
const _orbGeo = new THREE.SphereGeometry(0.18, 8, 6);
const _orbMat = new THREE.MeshBasicMaterial({color:0xffd700});
function spawnMoneyOrb(x, z, amount){
  const by = groundHeight(x, z) + 0.4;   // #204 : flotte au-dessus du sol local
  const m = new THREE.Mesh(_orbGeo, _orbMat.clone()); m.position.set(x, by, z);
  scene.add(m); moneyOrbs.push({mesh:m, baseY:by, amount, t:Math.random()*Math.PI*2});
}
function updateMoneyOrbs(dt){
  orbTime += dt; const pp = G.position();
  const r = activePower === 'money_magnet' ? ORB_COLLECT_R * 4 : ORB_COLLECT_R;   // #160
  for(let i=moneyOrbs.length-1;i>=0;i--){ const o=moneyOrbs[i];
    o.t += dt; o.mesh.position.y = o.baseY + Math.sin(o.t*ORB_FLOAT_FREQ*Math.PI*2)*ORB_FLOAT_AMP;
    if(Math.hypot(pp.x-o.mesh.position.x, pp.z-o.mesh.position.z) < r){
      scene.remove(o.mesh); o.mesh.material.dispose(); moneyOrbs.splice(i,1);
    }
  }
}
// (getters debug money_magnet/kevlar/berserk/instant_heal : générés via POWER_DEBUG plus bas)
function clearMoneyOrbs(){ for(const o of moneyOrbs){ scene.remove(o.mesh); o.mesh.material.dispose(); } moneyOrbs.length=0; }
G.debug.moneyOrbCount = () => moneyOrbs.length;
G.debug.spawnMoneyOrb = (x,z,amount) => spawnMoneyOrb(x,z,amount||50);
// ====== #78 Mode semi-auto ======
const SEMI_AUTO_WEAPONS = new Set(['sniper','phantom_sr','pistol','jackal']);   // ids réels catalogue (Specter-P=pistol, Jackal-45=jackal) — #78
let semiAuto = false, firePrev = false;
function isSemiAuto(){ return semiAuto || SEMI_AUTO_WEAPONS.has(effectiveWeaponId()); }
function resetSemiAuto(){ semiAuto = false; firePrev = false; updateSemiAutoHud(); }
function updateSemiAutoHud(){
  const el = document.getElementById('semiauto-hud'); if(!el) return;
  el.classList.toggle('hidden', !isSemiAuto());
}
G.debug.semiAutoMode = () => isSemiAuto();
G.debug.setSemiAuto = (b) => { semiAuto = !!b; updateSemiAutoHud(); };
// ====== #77 Camera kick on fire ======
const KICK_PITCH = 0.026, KICK_DUR = 0.08; // ~1.5°, 80ms
let kickPitch = 0, kickAt = -999, lastKickT = 0;
function cameraKick(adsT){ kickPitch = KICK_PITCH * (adsT > 0.5 ? 0.5 : 1); kickAt = nowS(); lastKickT = kickAt; }
function updateCameraKick(dt){ if(kickPitch <= 0) return;
  const age = nowS() - kickAt; const frac = Math.max(0, 1 - age / KICK_DUR);
  kickPitch = KICK_PITCH * frac; camPitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, camPitch + kickPitch * dt / KICK_DUR)); }
G.debug.cameraKick = () => cameraKick(0);
G.debug.lastCameraKickT = () => lastKickT;
// ====== #76 Countdown inter-vague ======
function waveCountdown(){ return waveState==='cleared' ? Math.max(0, Math.ceil(nextWaveAt - nowS())) : 0; }
function updateWaveCountdown(){
  const el = document.getElementById('wave-countdown'); if(!el) return;
  const cd = waveCountdown();
  if(cd > 0){ el.classList.remove('hidden'); el.textContent = `Prochaine vague dans ${cd}s`; }
  else el.classList.add('hidden');
}
G.debug.waveCountdown = () => waveCountdown();
// ====== #74 Blood screen ======
const BLOOD_THRESHOLD = 20, BLOOD_DUR = 1500;
let bloodTimer = null;
function showBloodScreen(intensity){
  const el = document.getElementById('blood-screen'); if(!el) return;
  el.style.opacity = Math.min(1, intensity).toFixed(2);
  clearTimeout(bloodTimer);
  bloodTimer = setTimeout(() => { el.style.transition='opacity 1s'; el.style.opacity='0';
    setTimeout(()=>{ el.style.transition='opacity .08s'; }, 1000); }, 80);
}
G.debug.showBloodScreen = (i) => showBloodScreen(i);
// ====== #73 Étincelles d'impact ======
const SPARK_COUNT = 5, SPARK_DUR = 0.4, SPARK_SPEED = 4;
let impactSystems = [];
function spawnImpactSparks(x, y, z){
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(SPARK_COUNT * 3);
  const vel = [];
  for(let i=0;i<SPARK_COUNT;i++){
    pos[i*3]=x; pos[i*3+1]=y; pos[i*3+2]=z;
    vel.push(new THREE.Vector3((Math.random()-.5)*SPARK_SPEED,(Math.random()*.5+.2)*SPARK_SPEED,(Math.random()-.5)*SPARK_SPEED));
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  const mat = new THREE.PointsMaterial({color:0xffcc00,size:0.08,transparent:true,opacity:1,depthWrite:false});
  const pts = new THREE.Points(geo,mat); scene.add(pts);
  impactSystems.push({pts,geo,vel,t:0,pos:pos});
}
function updateImpactSparks(dt){
  for(let s=impactSystems.length-1;s>=0;s--){ const sys=impactSystems[s];
    sys.t+=dt; const frac=sys.t/SPARK_DUR; sys.pts.material.opacity=1-frac;
    for(let i=0;i<SPARK_COUNT;i++){
      sys.vel[i].y-=9.8*dt;
      sys.pos[i*3]+=sys.vel[i].x*dt; sys.pos[i*3+1]+=sys.vel[i].y*dt; sys.pos[i*3+2]+=sys.vel[i].z*dt;
    }
    sys.geo.attributes.position.needsUpdate=true;
    if(sys.t>=SPARK_DUR){ scene.remove(sys.pts); sys.pts.material.dispose(); sys.geo.dispose(); impactSystems.splice(s,1); }
  }
}
function clearImpactSparks(){ for(const s of impactSystems){ scene.remove(s.pts); s.pts.material.dispose(); s.geo.dispose(); } impactSystems.length=0; }
G.debug.impactSparkCount = () => impactSystems.length;
G.debug.spawnImpactSparks = (x,y,z) => spawnImpactSparks(x,y,z);
// ====== #72 Streak counter ======
let streakKillsVal = 0;
// ====== #125 Rampage mode ======
const RAMPAGE_KILLS = 10, RAMPAGE_DURATION = 5, RAMPAGE_SPEED = 1.5;
let rampageKills_ = 0, rampageUntil_ = 0;
function rampageActive(){ return nowS() < rampageUntil_; }
function triggerRampage(){ rampageUntil_ = nowS() + RAMPAGE_DURATION; rampageKills_ = 0; showCallout('RAMPAGE!'); playSound('reload'); }
function onRampageKill(){ rampageKills_++; if(rampageKills_ >= RAMPAGE_KILLS && !rampageActive()) triggerRampage(); }
function onRampageReset(){ if(!rampageActive()) rampageKills_ = 0; } // no reset during active rampage
G.debug.rampageActive = () => rampageActive();
G.debug.rampageTimeLeft = () => Math.max(0, rampageUntil_ - nowS());
G.debug.rampageKillCount = () => rampageKills_;
G.debug.triggerRampage = () => triggerRampage();
function onStreakKill(){ streakKillsVal++; if(streakKillsVal > runBestStreak_) runBestStreak_ = streakKillsVal; updateStreakHud(); onRampageKill(); }   // #164
function onStreakReset(){ streakKillsVal = 0; updateStreakHud(); }
function updateStreakHud(){
  const el = document.getElementById('streak-hud'); if(!el) return;
  if(streakKillsVal < 2){ el.classList.add('hidden'); }
  else{ el.classList.remove('hidden'); el.textContent = `🔥 ${streakKillsVal} KILLS`; }
}
G.debug.streakKills = () => streakKillsVal;
// ====== #71 Barre de rechargement ======
function reloadProgress(){ if(!reloading||curReload<=0) return 0; return Math.min(1, 1-(reloadAt-nowS())/curReload); }
function updateReloadBar(){
  const el=document.getElementById('reload-bar'); if(!el) return;
  const p=reloadProgress(); el.classList.toggle('hidden', p<=0||p>=1);
  el.querySelector('circle').style.strokeDashoffset = 100 - p*100;
}
G.debug.reloadProgress = () => reloadProgress();
G.debug.setAmmo = (n) => { ammo = n; G.ammo = n; updateCombatHud(); };
// ====== #70 Marqueurs de spawn ======
const SPAWN_MARK_DUR = 3;
let spawnMarkers = [];
const _smGeo = new THREE.RingGeometry(0.8, 1.2, 24);
const _smMat = new THREE.MeshBasicMaterial({color:0xff2222,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false});
function showSpawnMarker(x, z){
  const m = new THREE.Mesh(_smGeo, _smMat.clone());
  m.rotation.x = -Math.PI/2; m.position.set(x, groundHeight(x, z) + 0.05, z); scene.add(m);   // #204
  spawnMarkers.push({mesh:m, t:0, dur:SPAWN_MARK_DUR});
}
function updateSpawnMarkers(dt){
  for(let i=spawnMarkers.length-1;i>=0;i--){ const s=spawnMarkers[i];
    s.t += dt; const frac = s.t/s.dur;
    s.mesh.material.opacity = frac<0.5 ? frac*2*0.7 : (1-frac)*2*0.7;
    s.mesh.scale.setScalar(0.5 + frac*0.8);
    if(s.t>=s.dur){ scene.remove(s.mesh); s.mesh.material.dispose(); spawnMarkers.splice(i,1); } }
}
function clearSpawnMarkers(){ for(const s of spawnMarkers){ scene.remove(s.mesh); s.mesh.material.dispose(); } spawnMarkers.length=0; }
G.debug.spawnMarkerCount = () => spawnMarkers.length;
G.debug.showSpawnMarker = (x,z) => showSpawnMarker(x,z);
// ====== #69 Grenade fumigène ======
const MAX_SMOKES = 2, SMOKE_FUSE = 1.2, SMOKE_R = 4, SMOKE_DUR = 5, SMOKE_ACC = 0.05;
let smokeStock = MAX_SMOKES, smokeProjs = [], smokeClouds = [];
function buildSmokeMesh(){ return new THREE.Mesh(new THREE.SphereGeometry(0.12,8,6), new THREE.MeshBasicMaterial({color:0xcccccc})); }
function buildCloudMesh(r){ return new THREE.Mesh(new THREE.SphereGeometry(r,12,8), new THREE.MeshBasicMaterial({color:0xaaaaaa,transparent:true,opacity:0.38,depthWrite:false})); }
function throwSmoke(){
  if(G.phase!=='playing'||smokeStock<=0) return false;
  smokeStock--; save.consumables.smoke = smokeStock; persist(); updateSmokeHud();
  const p = spawnThrownProjectile(buildSmokeMesh, 7);
  smokeProjs.push({mesh:p.mesh,vel:p.vel,explodeAt:nowS()+SMOKE_FUSE}); return true;
}
function explodeSmokeAt(x,z){
  const cm=buildCloudMesh(SMOKE_R); cm.position.set(x, groundHeight(x, z) + 1, z); scene.add(cm);   // #204
  smokeClouds.push({mesh:cm,expiresAt:nowS()+SMOKE_DUR,x,z});
}
function enemyInSmoke(i){ const e=enemies[i]; if(!e||!e.alive) return false;
  return smokeClouds.some(c=>Math.hypot(e.root.position.x-c.x,e.root.position.z-c.z)<SMOKE_R); }
function updateSmokes(dt){ const t=nowS();
  for(let i=smokeProjs.length-1;i>=0;i--){ const g=smokeProjs[i];
    g.vel.y-=GRENADE_GRAV*dt; g.mesh.position.addScaledVector(g.vel,dt);
    const sgy_=groundHeight(g.mesh.position.x,g.mesh.position.z)+0.12;   // #204
    if(g.mesh.position.y<=sgy_){g.mesh.position.y=sgy_;g.vel.y=-g.vel.y*0.4;g.vel.x*=0.6;g.vel.z*=0.6;}
    if(t>=g.explodeAt){explodeSmokeAt(g.mesh.position.x,g.mesh.position.z);scene.remove(g.mesh);smokeProjs.splice(i,1);} }
  for(let i=smokeClouds.length-1;i>=0;i--){ const c=smokeClouds[i];
    if(t>=c.expiresAt){scene.remove(c.mesh);smokeClouds.splice(i,1);}
    else{ const frac=Math.max(0,(c.expiresAt-t)/SMOKE_DUR); if(c.mesh.material) c.mesh.material.opacity=0.38*frac; } }
}
function clearSmokes(){ for(const g of smokeProjs) scene.remove(g.mesh); smokeProjs.length=0; for(const c of smokeClouds) scene.remove(c.mesh); smokeClouds.length=0; }
function updateSmokeHud(){ const el=document.getElementById('smoke-hud'); if(el) el.innerHTML=`🌫 <b>${smokeStock}</b>`; }
G.debug.smokeStock=()=>smokeStock; G.debug.smokeCount=()=>smokeClouds.length;
G.debug.throwSmoke=()=>throwSmoke(); G.debug.explodeSmokeAt=(x,z)=>explodeSmokeAt(x,z);
G.debug.enemyInSmoke=(i)=>enemyInSmoke(i);
// ====== #68 Toast level-up ======
let luTimer = null;
function showLevelUpToast(n){
  const el = document.getElementById('levelup-toast'); if(!el) return;
  const title = LEVEL_TITLES[Math.min(9, Math.floor((n-1)/5))];
  el.textContent = `★ NIVEAU ${n}  —  ${title} ★`;
  el.classList.remove('lu-show'); void el.offsetWidth; el.classList.add('lu-show');
  clearTimeout(luTimer); luTimer = setTimeout(() => el.classList.remove('lu-show'), 3000);
}
G.debug.showLevelUpToast = (n) => showLevelUpToast(n);
// ====== #67 Bouclier rechargeable ======
const SHIELD_MAX = 25, SHIELD_REGEN = 8, SHIELD_DELAY = 6;   // affaibli : petit tampon (25) + régén lente/retardée → les ennemis lents percent et font de vrais dégâts
let shieldHpVal = SHIELD_MAX, shieldLastDmg = -999;
function updateShieldHud(){ const el=document.getElementById('shield-fill'); if(el) el.style.width=(shieldHpVal/SHIELD_MAX*100)+'%'; }
function updateShield(dt){
  if(!hardcore_ && shieldHpVal < SHIELD_MAX && nowS() - shieldLastDmg >= SHIELD_DELAY){   // #94 hardcore : pas de régén bouclier (comme updateHealth)
    shieldHpVal = Math.min(SHIELD_MAX, shieldHpVal + SHIELD_REGEN*dt); updateShieldHud(); }
}
function resetShield(){ shieldHpVal = SHIELD_MAX; shieldLastDmg = -999; updateShieldHud(); }
G.debug.shieldHp = () => Math.round(shieldHpVal);
G.debug.maxShield = () => SHIELD_MAX;
G.debug.setShield = (v) => { shieldHpVal = Math.max(0, Math.min(SHIELD_MAX, v)); shieldLastDmg = nowS(); updateShieldHud(); }; // shieldLastDmg=now → la valeur posée ne se régénère pas instantanément (tests déterministes)
// ====== #66 Barres de vie ennemis ======
const EHB_RANGE = 20, EHB_HEIGHT = 2.4;
function updateEnemyHpBars(){
  const container = document.getElementById('enemy-hp-bars'); if(!container) return;
  // sync pool : un div par ennemi
  while(container.children.length < enemies.length){ const d=document.createElement('div'); d.className='ehb'; d.innerHTML='<div class="ehb-track"><div class="ehb-fill"></div></div>'; container.appendChild(d); }
  while(container.children.length > enemies.length) container.removeChild(container.lastChild);
  const W=window.innerWidth, H=window.innerHeight;
  enemies.forEach((e,i)=>{
    const el=container.children[i]; if(!el) return;
    if(!e.alive||!model){ el.style.display='none'; return; }
    const dist = model.position.distanceTo(e.root.position);
    if(dist > EHB_RANGE){ el.style.display='none'; return; }
    const pos3 = e.root.position.clone(); pos3.y += EHB_HEIGHT;
    pos3.project(camera);
    if(pos3.z > 1){ el.style.display='none'; return; }
    const sx=Math.round((pos3.x*0.5+0.5)*W), sy=Math.round((-pos3.y*0.5+0.5)*H);
    el.style.display=''; el.style.left=sx+'px'; el.style.top=sy+'px';
    const frac=Math.max(0,Math.min(1,(e.hp||0)/(e.maxHp||1)));
    const fill=el.querySelector('.ehb-fill'); if(fill){ fill.style.width=(frac*100)+'%'; fill.style.background=frac>0.5?'#4caf50':frac>0.25?'#ff9800':'#f44336'; }
  });
}
G.debug.enemyHpBarFrac = (i) => { const e=enemies[i]; return e ? Math.max(0,Math.min(1,(e.hp||0)/(e.maxHp||1))) : 0; };
// ====== #201 barre de vie du chien de guerre (même pattern que les barres ennemies, un seul élément) ======
function updatePetHpBar(){
  const el = document.getElementById('pet-hp-bar'); if(!el || !model) return;
  if(!pet.visible()){ el.style.display = 'none'; return; }
  const p = pet.pos(), pos3 = new THREE.Vector3(p.x, p.y + EHB_HEIGHT * 0.6, p.z);
  pos3.project(camera);
  if(pos3.z > 1){ el.style.display = 'none'; return; }
  const W = window.innerWidth, H = window.innerHeight;
  const sx = Math.round((pos3.x*0.5+0.5)*W), sy = Math.round((-pos3.y*0.5+0.5)*H);
  el.style.display = ''; el.style.left = sx+'px'; el.style.top = sy+'px';
  const frac = Math.max(0, Math.min(1, pet.hp() / pet.maxHp()));
  const fill = el.querySelector('.ehb-fill'); if(fill){ fill.style.width = (frac*100)+'%'; fill.style.background = frac>0.5?'#4caf50':frac>0.25?'#ff9800':'#f44336'; }
}
// ====== #65 Claymore / mines de proximité ======
const MAX_MINES = 2, MINE_DETECT_R = 2, MINE_EXPLODE_R = 4, MINE_DAMAGE = 200;
let mineStock = MAX_MINES, mines = [];
function buildMineMesh(){ const m = new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.3,0.06,12), new THREE.MeshBasicMaterial({color:0xdd2222})); return m; }
function placeMine(){
  if(G.phase !== 'playing' || mineStock <= 0 || !model) return false;
  mineStock--;
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
  const pos = model.position.clone().addScaledVector(dir, 1.5); pos.y = groundHeight(pos.x, pos.z) + 0.03;   // #204
  const mesh = buildMineMesh(); mesh.position.copy(pos); scene.add(mesh);
  mines.push({ mesh, armed:false, armAt: nowS() + 1.0 }); updateMineHud(); return true;
}
function placeMineFree(){   // #156 : variante loadout, ignore le stock (mineStock inchangé)
  if(G.phase !== 'playing' || !model) return false;
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
  const pos = model.position.clone().addScaledVector(dir, 1.5); pos.y = groundHeight(pos.x, pos.z) + 0.03;   // #204
  const mesh = buildMineMesh(); mesh.position.copy(pos); scene.add(mesh);
  mines.push({ mesh, armed:false, armAt: nowS() + 1.0 }); return true;
}
function explodeMineAt(x, y, z){
  for(const e of enemies){ if(!e.alive) continue;
    const d = Math.hypot(e.root.position.x - x, e.root.position.z - z);
    if(d < MINE_EXPLODE_R){ damageEnemy(e, Math.round(MINE_DAMAGE * (1 - d/MINE_EXPLODE_R * 0.5))); } }
  playSound('shot');
}
function updateMines(){
  const t = nowS();
  for(let i=mines.length-1;i>=0;i--){ const mn = mines[i];
    if(!mn.armed && t >= mn.armAt) mn.armed = true;
    if(!mn.armed) continue;
    for(const e of enemies){ if(!e.alive) continue;
      const d = Math.hypot(e.root.position.x - mn.mesh.position.x, e.root.position.z - mn.mesh.position.z);
      if(d < MINE_DETECT_R){ explodeMineAt(mn.mesh.position.x, mn.mesh.position.y, mn.mesh.position.z); scene.remove(mn.mesh); mines.splice(i,1); updateMineHud(); break; } }
  }
}
function clearMines(){ for(const mn of mines) scene.remove(mn.mesh); mines.length = 0; }
function updateMineHud(){ const el = document.getElementById('mine-hud'); if(el) el.innerHTML = `💣mines <b>${mineStock}</b>`; }
G.debug.mineStock = () => mineStock;
G.debug.mineCount = () => mines.length;
G.debug.placeMine = () => placeMine();
G.debug.explodeMineAt = (i, x, z) => explodeMineAt(x, 0, z);
// ====== #132 Tourelle sentinelle déployable ======
const TURRET_RANGE = 15, TURRET_FIRE_CD = 0.5, TURRET_DMG = 12, TURRET_DURATION = 20, TURRET_COOLDOWN = 25;
let turret = null, turretCooldownUntil = 0;
function buildTurretMesh(){ const m = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 8), new THREE.MeshStandardMaterial({ color:0x556070, emissive:0x223344, emissiveIntensity:0.5, roughness:0.5 })); return m; }
function deployTurret(){
  if(G.phase !== 'playing' || !model || turret || nowS() < turretCooldownUntil) return false;
  const mesh = buildTurretMesh(); mesh.position.copy(model.position); mesh.position.y += 0.45; scene.add(mesh);
  turret = { mesh, expireAt: nowS() + TURRET_DURATION, lastShot: 0 };
  return true;
}
function deployTurretFree(){   // #156 : variante loadout, ignore l'ancien cooldown (mais garde "1 seule active")
  if(G.phase !== 'playing' || !model || turret) return false;
  const mesh = buildTurretMesh(); mesh.position.copy(model.position); mesh.position.y += 0.45; scene.add(mesh);
  turret = { mesh, expireAt: nowS() + TURRET_DURATION, lastShot: 0 };
  return true;
}
function updateTurret(dt){
  if(!turret) return; const t = nowS();
  if(t >= turret.expireAt){ scene.remove(turret.mesh); turret = null; turretCooldownUntil = t + TURRET_COOLDOWN; return; }
  if(t - turret.lastShot < TURRET_FIRE_CD) return;
  let best = null, bestD = TURRET_RANGE;
  for(const e of enemies){ if(!e.alive) continue;
    const d = Math.hypot(e.root.position.x - turret.mesh.position.x, e.root.position.z - turret.mesh.position.z);
    if(d <= bestD){ bestD = d; best = e; } }
  if(best){ damageEnemy(best, TURRET_DMG); turret.lastShot = t; }
}
function clearTurret(){ if(turret){ scene.remove(turret.mesh); turret = null; } }
G.debug.turretActive = () => !!turret;
G.debug.turretCount = () => turret ? 1 : 0;
G.debug.deployTurret = () => deployTurret();
G.debug.turretTimeLeft = () => turret ? Math.max(0, turret.expireAt - nowS()) : 0;
G.debug.turretCooldownLeft = () => Math.max(0, turretCooldownUntil - nowS());
// ====== #64 Mode tir burst/auto ======
const BURST_WEAPONS = new Set(['default','raptor','cyclone']); // armes assaut
const BURST_SIZE = 3, BURST_DELAY = 0.08;
let fireModeState = 'auto', playerBurstLeft = 0, playerBurstAt = 0;
// #113 perfect burst
let burstHitIds_ = [], perfectBurstCount_ = 0, lastBurstPerfect_ = false;
function canBurst(){ return BURST_WEAPONS.has(save.selectedWeapon||'default'); }
function fireModeToggle(){
  if(!canBurst()) return;
  fireModeState = fireModeState === 'auto' ? 'burst' : 'auto';
  playerBurstLeft = 0; updateFiremodeHud();
}
function updateFiremodeHud(){
  const el = document.getElementById('firemode-hud'); if(!el) return;
  el.textContent = fireModeState === 'burst' ? 'BURST' : 'AUTO';
  el.className = fireModeState === 'burst' ? 'burst' : '';
}
function resetFireMode(){ fireModeState = 'auto'; playerBurstLeft = 0; updateFiremodeHud(); }
function updateBurstFire(){
  if(playerBurstLeft > 0 && nowS() >= playerBurstAt){
    tryFire(); playerBurstLeft--; playerBurstAt = nowS() + BURST_DELAY;
    if(playerBurstLeft === 0){ // burst terminé — vérifier perfect burst
      lastBurstPerfect_ = burstHitIds_.length === BURST_SIZE && burstHitIds_.every(id => id === burstHitIds_[0]);
      if(lastBurstPerfect_){ perfectBurstCount_++; addMoney(20); showCallout('PERFECT BURST'); }
      burstHitIds_ = [];
    }
  }
}
G.debug.fireMode = () => fireModeState;
G.debug.fireModeToggle = () => fireModeToggle();
G.debug.perfectBurstCount = () => perfectBurstCount_;
G.debug.lastBurstPerfect = () => lastBurstPerfect_;
G.debug.burstRoundsLeft = () => playerBurstLeft;
// ====== #63 Indicateur direction dégâts ======
const DD_IDS = { top:'dmgdir-top', bot:'dmgdir-bot', lft:'dmgdir-lft', rgt:'dmgdir-rgt' };
const DD_TIMERS = {};
function showDamageDir(angleDeg){
  // angleDeg = angle relatif entre yaw joueur et direction vers l'attaquant (0=devant, 90=droite, 180=derrière, -90=gauche)
  const a = ((angleDeg % 360) + 360) % 360;
  const key = (a >= 315 || a < 45) ? 'top' : (a >= 45 && a < 135) ? 'rgt' : (a >= 135 && a < 225) ? 'bot' : 'lft';
  const el = document.getElementById(DD_IDS[key]); if(!el) return;
  el.classList.remove('dmgdir-show'); void el.offsetWidth; el.classList.add('dmgdir-show');
  clearTimeout(DD_TIMERS[key]); DD_TIMERS[key] = setTimeout(() => el.classList.remove('dmgdir-show'), 800);
}
function damageDirFromEnemy(e){
  if(!model || !e) return;
  const dx = e.root.position.x - model.position.x, dz = e.root.position.z - model.position.z;
  const angleWorld = Math.atan2(dx, dz) * 180 / Math.PI;  // angle vers ennemi (monde)
  const playerYaw = camera ? (camera.rotation.y * 180 / Math.PI) : 0;
  showDamageDir(angleWorld - playerYaw);
}
G.debug.showDamageDir = (deg) => showDamageDir(deg);
// ====== #62 Contrats quotidiens ======
const DAILY_POOL = [
  { id:'kills50',   desc:'Eliminer 50 ennemis',      type:'kills',    target:50,  reward:800  },
  { id:'kills100',  desc:'Eliminer 100 ennemis',     type:'kills',    target:100, reward:1500 },
  { id:'heads20',   desc:'20 headshots',              type:'headshots',target:20,  reward:1000 },
  { id:'heads10',   desc:'10 headshots',              type:'headshots',target:10,  reward:600  },
  { id:'wave10',    desc:'Atteindre la vague 10',     type:'wave',     target:10,  reward:2000 },
  { id:'wave5',     desc:'Atteindre la vague 5',      type:'wave',     target:5,   reward:900  },
  { id:'melee15',   desc:'15 kills au couteau',       type:'melee',    target:15,  reward:1200 },
  { id:'melee5',    desc:'5 kills au couteau',        type:'melee',    target:5,   reward:500  },
];
function dailySeed(){
  const d = new Date(); return d.getFullYear()*10000 + (d.getMonth()+1)*100 + d.getDate();
}
function seededPick(pool, seed, n){
  const arr = [...pool]; const out = [];
  for(let i=0;i<n;i++){ seed=(seed*1664525+1013904223)&0xffffffff; const idx=Math.abs(seed)%arr.length; out.push(arr.splice(idx,1)[0]); }
  return out;
}
function getDailyContracts(){
  const seed = dailySeed(); const key = 'daily_seed';
  if(!save.daily || save.daily[key] !== seed){
    const picked = seededPick(DAILY_POOL, seed, 3);
    save.daily = { [key]:seed, contracts: picked.map(c => ({ id:c.id, progress:0, done:false })) };
    persist();
  }
  return save.daily.contracts.map((s, i) => {
    const def = DAILY_POOL.find(p => p.id === s.id) || DAILY_POOL[i];
    return { id:s.id, desc:def.desc, type:def.type, target:def.target, reward:def.reward, progress:s.progress, done:s.done };
  });
}
function trackDailyKill(type){
  if(!save.daily) return;
  save.daily.contracts.forEach((c, i) => {
    if(c.done) return;
    const def = DAILY_POOL.find(p => p.id === c.id); if(!def || def.type !== type) return;
    c.progress = Math.min(def.target, (c.progress||0) + 1);
    if(c.progress >= def.target){ c.done = true; addMoney(def.reward); showKsBanner(`CONTRAT TERMINÉ +${def.reward}$`, '#ffd54f'); }
  }); persist();
}
function trackDailyWave(w){
  if(!save.daily) return;
  save.daily.contracts.forEach((c, i) => {
    if(c.done) return;
    const def = DAILY_POOL.find(p => p.id === c.id); if(!def || def.type !== 'wave') return;
    if(w >= def.target && !c.done){ c.done = true; c.progress = def.target; addMoney(def.reward); showKsBanner(`CONTRAT TERMINÉ +${def.reward}$`, '#ffd54f'); }
  }); persist();
}
G.debug.dailyContracts = () => getDailyContracts();
G.debug.forceDailyComplete = (i) => {
  getDailyContracts(); // ensure init
  const c = save.daily.contracts[i]; if(!c || c.done) return;
  const def = DAILY_POOL.find(p => p.id === c.id); if(!def) return;
  c.progress = def.target; c.done = true; persist(); addMoney(def.reward);
};
G.debug.dailyContractsDone = () => getDailyContracts().filter(c => c.done).length;
// ====== #60 XP + niveaux ======
const XP_KILL=25, XP_HEAD=25, XP_WAVE=100; // headshot = 25 bonus (total 50)
const LEVEL_TITLES = ['Recrue','Soldat','Caporal','Sergent','Lieutenant','Capitaine','Major','Colonel','Général','Légende'];
function xpForLevel(n){ return 100*n*(n+1)/2; }      // XP cumulé pour atteindre le niveau n+1
function calcLevel(xp){ let l=1; while(l<50 && xp>=xpForLevel(l)) l++; return l; }
function playerLevel(){ return calcLevel(save.xp||0); }
function playerTitle(){ const l=playerLevel(); return LEVEL_TITLES[Math.min(9, Math.floor((l-1)/5))]; }
function xpNextLevel(){ const l=playerLevel(); return xpForLevel(l); }
function addXp(n){
  const lvBefore = playerLevel();
  if(activePower === 'xp_boost') n = n * 2;  // #122 XP boost
  save.xp = (save.xp||0) + n; persist();
  const lvAfter = playerLevel();
  updateXpHud();
  if(lvAfter > lvBefore) showLevelUpToast(lvAfter); // toast level-up (#68)
}
function updateXpHud(){
  const el = document.getElementById('xp-hud'); if(!el) return;
  const xp=save.xp||0, lv=playerLevel(), nxt=xpNextLevel(), prev=xpForLevel(lv-1);
  const frac = lv>=50 ? 1 : Math.max(0, Math.min(1,(xp-prev)/(nxt-prev)));
  const fill = el.querySelector('#xp-fill'); if(fill) fill.style.width = (frac*100)+'%';
  const stars = (save.prestige||0) > 0 ? '★'.repeat(Math.min(save.prestige,5)) + ' ' : '';   // #159
  const label = el.querySelector('#xp-label'); if(label) label.textContent = `Niv. ${lv}  ${stars}${playerTitle()}`;
  const pb = document.getElementById('prestige-btn'); if(pb) pb.classList.toggle('hidden', !canPrestige());
}
G.debug.xpTotal = () => save.xp||0;
G.debug.playerLevel = () => playerLevel();
G.debug.playerTitle = () => playerTitle();
G.debug.addXp = (n) => addXp(n);
// ====== #159 Prestige ======
function canPrestige(){ return playerLevel() >= 50; }
function doPrestige(){
  if(!canPrestige()) return false;
  save.prestige = (save.prestige||0) + 1;
  save.xp = 0;
  persist();
  updateXpHud();
  showKsBanner('PRESTIGE ★' + save.prestige + ' !', '#ffd54f');
  return true;
}
G.debug.prestigeLevel = () => save.prestige || 0;
G.debug.canPrestige = () => canPrestige();
G.debug.doPrestige = () => doPrestige();
document.getElementById('prestige-btn')?.addEventListener('click', () => doPrestige());
// ====== #59 Hit-marker ======
let hmTimer = null;
function showHitMarker(headshot){
  const el = document.getElementById('hit-marker'); if(!el) return;
  el.classList.remove('hidden','hm-show','hm-head');
  void el.offsetWidth;
  el.classList.add('hm-show'); if(headshot) el.classList.add('hm-head');
  clearTimeout(hmTimer); hmTimer = setTimeout(() => el.classList.remove('hm-show','hm-head'), 120);
}
G.debug.showHitMarker = (hs) => showHitMarker(hs);
// ====== #58 Killstreak Rewards ======
const KS_WINDOW = 8, KS_THRESHOLDS = [3, 5, 7];
let ksKillTimes = [], ksAwarded = new Set();
let ksShieldUntil = 0, ksMoneyMultUntil = 0;
function registerKsKill(){
  const t = nowS(); ksKillTimes.push(t);
  ksKillTimes = ksKillTimes.filter(t2 => t - t2 < KS_WINDOW);
  const n = ksKillTimes.length;
  for(const thr of KS_THRESHOLDS){ if(n >= thr && !ksAwarded.has(thr)){ ksAwarded.add(thr); fireKsReward(thr); } }
}
function fireKsReward(thr){
  if(thr === 3){ ammo = curMag; G.ammo = ammo; showKsBanner('TRIPLE KILL  ⚡ Rechargé', '#f0c040'); }
  else if(thr === 5){ ksShieldUntil = nowS() + 5; showKsBanner('RAMPAGE  🛡 Bouclier actif', '#4fc3f7'); }
  else if(thr === 7){ ksMoneyMultUntil = nowS() + 10; showKsBanner('UNSTOPPABLE  💰 ×2 Argent', '#81c784'); }
  // #156 : le palier 10 (frappe aérienne auto) est retiré, remplacé par le système de points loadout
}
// ====== #138 Frappe aérienne (killstreak tier 10) ======
const AIRSTRIKE_TARGETS = 3, AIRSTRIKE_DMG = 150;
let airstrikeHitCount_ = 0;
function triggerAirstrike(){
  const alive = enemies.filter(e => e.alive);
  for(let i = alive.length - 1; i > 0; i--){ const j = Math.floor(Math.random()*(i+1)); [alive[i],alive[j]] = [alive[j],alive[i]]; }
  const targets = alive.slice(0, AIRSTRIKE_TARGETS);
  airstrikeHitCount_ = targets.length;
  for(const e of targets){ spawnExplosionFx(new THREE.Vector3(e.root.position.x, 1, e.root.position.z)); damageEnemy(e, AIRSTRIKE_DMG); }
}
G.debug.triggerAirstrikeNow = () => triggerAirstrike();
G.debug.airstrikeHitCount = () => airstrikeHitCount_;
function showKsBanner(txt, color){
  let el = document.getElementById('ks-banner'); if(!el) return;
  el.textContent = txt; el.style.color = color; el.classList.remove('hidden','ks-pop');
  void el.offsetWidth; el.classList.add('ks-pop');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.add('hidden'), 2000);
}
function ksShieldActive(){ return nowS() < ksShieldUntil; }
function ksMoneyMultiplier(){ return (nowS() < ksMoneyMultUntil) ? 2 : 1; }
function updateKillstreak(){
  const t = nowS(); ksKillTimes = ksKillTimes.filter(t2 => t - t2 < KS_WINDOW);
  if(ksKillTimes.length < KS_THRESHOLDS[0]) ksAwarded.clear();
}
function resetKillstreak(){ ksKillTimes = []; ksAwarded.clear(); ksShieldUntil = 0; ksMoneyMultUntil = 0; }
G.debug.registerKsKill = () => registerKsKill();
G.debug.ksCount = () => { const t = nowS(); return ksKillTimes.filter(t2 => t - t2 < KS_WINDOW).length; };
G.debug.ksRewardFired = (thr) => ksAwarded.has(thr);
G.debug.ksShieldActive = () => ksShieldActive();
G.debug.ksMoneyMult = () => ksMoneyMultiplier();
// ====== #156 Série de points (killstreak loadout à 3 bonus) ======
const LOADOUT_BONUSES = ['turret','mine','airstrike','carepackage','dog'];   // #201 : chien de guerre = 5e bonus
const LOADOUT_THRESHOLDS = { turret:1200, mine:600, airstrike:1800, carepackage:1000, dog:900 };
const LOADOUT_NAMES = { turret:'Tourelle', mine:'Claymore', airstrike:'Frappe aérienne', carepackage:'Caisse', dog:'Chien de guerre' };
const LOADOUT_POINTS_PER_KILL = 100;
let loadoutPoints = { turret:0, mine:0, airstrike:0, carepackage:0, dog:0 };
function registerLoadoutKill(){
  for(const key of save.selectedLoadout) loadoutPoints[key] = (loadoutPoints[key]||0) + LOADOUT_POINTS_PER_KILL;
  updateLoadoutHud();
}
function loadoutReady(key){ return save.selectedLoadout.includes(key) && loadoutPoints[key] >= LOADOUT_THRESHOLDS[key]; }
function toggleLoadoutBonus(key){
  if(!LOADOUT_BONUSES.includes(key)) return false;
  const arr = save.selectedLoadout, i = arr.indexOf(key);
  if(i >= 0) arr.splice(i, 1);
  else { arr.push(key); if(arr.length > 3) arr.shift(); }
  persist(); updateLoadoutHud(); return true;
}
function resetLoadoutPoints(){ loadoutPoints = { turret:0, mine:0, airstrike:0, carepackage:0, dog:0 }; updateLoadoutHud(); }
function updateLoadoutHud(){
  for(const key of LOADOUT_BONUSES){
    const hud = document.getElementById('ls-'+key+'-hud'), fill = document.getElementById('ls-'+key+'-fill');
    if(!hud || !fill) continue;
    const show = G.phase === 'playing' && save.selectedLoadout.includes(key);
    hud.classList.toggle('hidden', !show);
    if(!show) continue;
    const pts = loadoutPoints[key] || 0, thr = LOADOUT_THRESHOLDS[key];
    fill.style.width = Math.min(100, Math.round(pts/thr*100)) + '%';
    fill.classList.toggle('ready', pts >= thr);
  }
}
G.debug.selectedLoadout = () => save.selectedLoadout.slice();
G.debug.toggleLoadoutBonus = (key) => toggleLoadoutBonus(key);
G.debug.loadoutPoints = (key) => loadoutPoints[key] || 0;
G.debug.loadoutThreshold = (key) => LOADOUT_THRESHOLDS[key];
G.debug.loadoutReady = (key) => loadoutReady(key);
G.debug.registerLoadoutKill = () => registerLoadoutKill();
function triggerLoadoutBonus(key){
  if(!loadoutReady(key)) return false;
  if(key === 'airstrike') return openAirstrikeTargeting();   // #156b : ciblage manuel, consommation différée à la confirmation
  let ok = false;
  if(key === 'turret') ok = deployTurretFree();
  else if(key === 'mine') ok = placeMineFree();
  else if(key === 'carepackage'){ if(!model || carePackage) return false;
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
    spawnCarePackage(model.position.x + dir.x*3, model.position.z + dir.z*3); ok = true; }
  else if(key === 'dog'){ pet.summon(); ok = true; }   // #201 : chien de guerre — invocation loadout uniquement (summon() diffère si le GLB charge encore, mais reste garanti)
  if(ok){ loadoutPoints[key] = 0; updateLoadoutHud(); showCallout(LOADOUT_NAMES[key].toUpperCase() + ' PRÊT UTILISÉ !'); }
  return ok;
}
G.debug.triggerLoadoutBonus = (key) => triggerLoadoutBonus(key);
// ====== #156b Ciblage manuel de la frappe aérienne (carte cliquable) ======
const AIRSTRIKE_TARGET_R = 5;
let airstrikeTargeting = false;
function worldToMapCanvas(x, z, cv){ return { x:(x+MAP_HALF)/(MAP_HALF*2)*cv.width, y:(z+MAP_HALF)/(MAP_HALF*2)*cv.height }; }
function mapCanvasToWorld(px, py, cv){ return { x: px/cv.width*(MAP_HALF*2)-MAP_HALF, z: py/cv.height*(MAP_HALF*2)-MAP_HALF }; }
function drawAirstrikeMap(){
  const cv = document.getElementById('airstrike-map-canvas'); if(!cv) return;
  const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#12141a'; ctx.fillRect(0, 0, cv.width, cv.height);
  if(model){ const p = worldToMapCanvas(model.position.x, model.position.z, cv);
    ctx.fillStyle = '#4fc3f7'; ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI*2); ctx.fill(); }
  for(const e of enemies){ if(!e.alive) continue;
    const q = worldToMapCanvas(e.root.position.x, e.root.position.z, cv);
    ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, Math.PI*2); ctx.fill(); }
}
function openAirstrikeTargeting(){
  if(G.phase !== 'playing' || airstrikeTargeting) return false;
  airstrikeTargeting = true;
  document.getElementById('airstrike-map-panel').classList.remove('hidden');
  if(document.pointerLockElement) document.exitPointerLock?.();
  drawAirstrikeMap();
  return true;
}
function closeAirstrikeTargeting(){
  airstrikeTargeting = false;
  document.getElementById('airstrike-map-panel').classList.add('hidden');
  if(G.phase === 'playing') canvasEl.requestPointerLock?.();
}
function confirmAirstrikeTarget(x, z){
  if(!airstrikeTargeting) return false;
  closeAirstrikeTargeting();
  const targets = enemies.filter(e => e.alive && Math.hypot(e.root.position.x - x, e.root.position.z - z) <= AIRSTRIKE_TARGET_R);
  airstrikeHitCount_ = targets.length;
  for(const e of targets){ spawnExplosionFx(new THREE.Vector3(e.root.position.x, 1, e.root.position.z)); damageEnemy(e, AIRSTRIKE_DMG); }
  spawnShockwave(x, 0.5, z);
  loadoutPoints.airstrike = 0; updateLoadoutHud();
  showCallout('FRAPPE AÉRIENNE!');
  return true;
}
document.getElementById('airstrike-map-canvas').addEventListener('click', (e) => {
  const cv = document.getElementById('airstrike-map-canvas'), r = cv.getBoundingClientRect();
  const px = (e.clientX - r.left) * (cv.width / r.width), py = (e.clientY - r.top) * (cv.height / r.height);
  const w = mapCanvasToWorld(px, py, cv);
  confirmAirstrikeTarget(w.x, w.z);
});
G.debug.airstrikeTargetingActive = () => airstrikeTargeting;
G.debug.confirmAirstrikeTargetAt = (x, z) => confirmAirstrikeTarget(x, z);
G.debug.cancelAirstrikeTargeting = () => { if(!airstrikeTargeting) return false; closeAirstrikeTargeting(); return true; };
// ====== #57 Flashbang ======
const MAX_FLASHBANGS = 2, FLASH_FUSE = 1.5, FLASH_BLIND_R = 9, FLASH_BLIND_DUR = 2.0, FLASH_PLAYER_R = 10;
let flashbangs = MAX_FLASHBANGS, flashbangProjs = [], flashScreenT = null;
function buildFlashbangMesh(){ return new THREE.Mesh(new THREE.SphereGeometry(0.12,8,6), new THREE.MeshBasicMaterial({color:0xffffaa})); }
function throwFlashbang(){
  if(G.phase !== 'playing' || flashbangs <= 0) return false;
  flashbangs--; save.consumables.flashbang = flashbangs; persist(); updateFlashbangHud();
  const p = spawnThrownProjectile(buildFlashbangMesh, 8);
  flashbangProjs.push({ mesh:p.mesh, vel:p.vel, explodeAt: nowS() + FLASH_FUSE }); return true;
}
function explodeFlashbangAt(x, y, z){
  const t = nowS();
  for(const e of enemies){ if(!e.alive) continue;
    const d = Math.hypot(e.root.position.x - x, e.root.position.z - z);
    if(d < FLASH_BLIND_R) e.flashedUntil = t + FLASH_BLIND_DUR; }
  if(model){ const pd = Math.hypot(model.position.x - x, model.position.z - z);
    if(pd < FLASH_PLAYER_R) flashPlayerScreen(); }
  playSound('shot');
}
function flashPlayerScreen(){
  const el = document.getElementById('flash-screen'); if(!el) return;
  el.classList.add('show'); clearTimeout(flashScreenT);
  flashScreenT = setTimeout(() => { el.classList.remove('show'); }, 500);
}
function updateFlashbangs(dt){ const t = nowS();
  for(let i=flashbangProjs.length-1;i>=0;i--){ const g = flashbangProjs[i];
    g.vel.y -= GRENADE_GRAV*dt; g.mesh.position.addScaledVector(g.vel, dt);
    const ggy_ = groundHeight(g.mesh.position.x, g.mesh.position.z) + 0.12;   // #204 : rebond sur le sol local
    if(g.mesh.position.y <= ggy_){ g.mesh.position.y = ggy_; g.vel.y = -g.vel.y*0.4; g.vel.x *= 0.6; g.vel.z *= 0.6; }
    if(t >= g.explodeAt){ explodeFlashbangAt(g.mesh.position.x, g.mesh.position.y, g.mesh.position.z); scene.remove(g.mesh); flashbangProjs.splice(i,1); } }
}
function clearFlashbangs(){ for(const g of flashbangProjs) scene.remove(g.mesh); flashbangProjs.length = 0; }
function updateFlashbangHud(){ const el = document.getElementById('flashbang-hud'); if(el) el.innerHTML = `⚡ <b>${flashbangs}</b>`; }
G.debug.throwFlashbang = () => throwFlashbang();
G.debug.flashbangCount = () => flashbangs;
G.debug.explodeFlashbangAt = (x,y,z) => explodeFlashbangAt(x,y,z);
G.debug.enemyBlinded = (i) => { const e = enemies[i]; return !!e && nowS() < (e.flashedUntil||0); };
G.debug.grenadeCount = () => grenades;
G.debug.grenadeProjCount = () => grenadeProjs.length;
G.debug.explodeGrenadeAt = (x,y,z) => explodeGrenadeAt(x,y,z);
// ====== Barils explosifs (#41) : tir -> explosion AoE aux ennemis ======
const BARREL_R = 4, BARREL_DAMAGE = 90;
const BARREL_SPOTS = [{x:8,z:6},{x:-8,z:-4},{x:6,z:-12},{x:-5,z:16}];
const barrels = [];
function buildBarrelMesh(){ const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32,0.32,0.9,16), new THREE.MeshStandardMaterial({ color:0xb02a1e, metalness:0.4, roughness:0.5, emissive:0x300a06 })); body.position.y = 0.45;
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.33,0.33,0.12,16), new THREE.MeshStandardMaterial({ color:0xf0c020, emissive:0x201803 })); stripe.position.y = 0.45;
  g.add(body, stripe); g.traverse(o=>{ if(o.isMesh) o.castShadow = true; }); return g; }
function spawnBarrel(x, z){
  const gy = groundHeight(x, z);   // #204
  const mesh = buildBarrelMesh(); mesh.position.set(x, gy, z); scene.add(mesh);
  const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.4,0.4,1.8,8), new THREE.MeshBasicMaterial({ visible:false }));
  hb.position.set(x, gy + 0.9, z); hb.updateMatrixWorld(); scene.add(hb);
  barrels.push({ mesh, hitbox:hb, x, z }); return barrels.length-1;
}
function clearBarrels(){ for(const b of barrels){ scene.remove(b.mesh); scene.remove(b.hitbox); } barrels.length = 0; }
function spawnBarrels(){ clearBarrels(); for(const s of BARREL_SPOTS) spawnBarrel(s.x, s.z); }
let barrelChainCount_ = 0;
function explodeBarrel(b, isChained){
  for(const e of enemies){ if(!e.alive) continue;
    const d = Math.hypot(e.root.position.x-b.x, e.root.position.z-b.z);
    if(d < BARREL_R) damageEnemy(e, Math.max(1, Math.round(BARREL_DAMAGE*(1-d/BARREL_R)))); }
  spawnExplosionFx(new THREE.Vector3(b.x, 0.6, b.z));
  scene.remove(b.mesh); scene.remove(b.hitbox); const i = barrels.indexOf(b); if(i>=0) barrels.splice(i,1);
  if(isChained) barrelChainCount_++;
  const neighbors = barrels.filter(n => Math.hypot(n.x-b.x, n.z-b.z) < BARREL_R);   // #144 : réaction en chaîne
  for(const n of neighbors) explodeBarrel(n, true);
}
G.debug.barrelChainCount = () => barrelChainCount_;
G.debug.barrelCount = () => barrels.length;
G.debug.explodeBarrelNow = (i) => { if(barrels[i]) explodeBarrel(barrels[i]); };
G.debug.spawnBarrelInFront = (dist=8) => { _ray.setFromCamera({x:0,y:0}, camera);
  const p = _ray.ray.origin.clone().add(_ray.ray.direction.clone().multiplyScalar(dist)); return spawnBarrel(p.x, p.z); };
function spawnTracer(from, to){
  const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color:0xfff1a8, transparent:true, opacity:0.9 }));
  scene.add(line); tracers.push({ line, life:0.08 });
}
function updateTracers(dt){
  for(let i=tracers.length-1;i>=0;i--){
    const tr = tracers[i]; tr.life -= dt;
    tr.line.material.opacity = Math.max(0, tr.life/0.08) * 0.9;
    if(tr.life<=0){ scene.remove(tr.line); tr.line.geometry.dispose(); tr.line.material.dispose(); tracers.splice(i,1); }
  }
}
let hmT = null;
function flashHitMarker(){
  const hm = document.getElementById('hitmarker'); hm.classList.add('show');
  clearTimeout(hmT); hmT = setTimeout(() => hm.classList.remove('show'), 120);
}
function updateCombatHud(){
  const isMelee = weaponById(effectiveWeaponId()).melee;
  const ammoLine = isMelee
    ? `<div class="hud-ammo">${ico('weapon')}<b>⚔</b><span class="mag">MÊLÉE</span></div>`
    : `<div class="hud-ammo${isLowAmmo() ? ' low-ammo' : ''}">${ico('weapon')}<b>${reloading ? '—' : ammo}</b><span class="mag">/ ${curMag}</span></div>`;
  const statusLine = isMelee
    ? `<div class="hud-line${playerMeleeCd > 0 ? ' reload' : ''}">${playerMeleeCd > 0 ? 'Récup…' : 'Score ' + score}</div>`
    : `<div class="hud-line${reloading ? ' reload' : ''}">${reloading ? 'Recharge…' : 'Score ' + score + (wave>=5 ? ` <span style="color:#f80;font-size:0.75em">×${waveScoreMult_().toFixed(1)}</span>` : '')}</div>`; // #126 wave mult badge
  document.getElementById('combat').innerHTML = ammoLine + statusLine;
}
function updateCombat(dt){
  if(G.phase!=='playing') return;
  if(playerMeleeCd > 0) playerMeleeCd -= dt;                 // cooldown couteau (#45)
  if(reloading && nowS() >= reloadAt){ ammo = curMag + (pendingTactical_ ? 1 : 0); reloading = false; G.ammo = ammo; if(pendingTactical_){ lastReloadWasTactical_=true; tacticalReloadCount_++; pendingTactical_=false; } }
  if(autoReloadEnabled_ && autoReloadAt_ > 0 && nowS() >= autoReloadAt_ && !reloading && ammo === 0){ autoReloadAt_ = -1; reload(); }
  updateReloadBar();
  const fireRising = input.fire && !firePrev; firePrev = input.fire;
  const forceAuto = activePower === 'full_auto';   // #154 : neutralise le semi-auto tant que le power est actif
  if(forceAuto ? input.fire : (isSemiAuto() ? fireRising : input.fire)) tryFire(); // semi-auto : rising edge seulement (#78)
  const t = nowS();
  for(const tg of targets){ if(!tg.alive && t >= tg.respawnAt){ tg.alive = true; tg.mesh.visible = true; } }
  updateTracers(dt); updateDamageNumbers(); updateKnifeFlash(dt);   // #50
  const aiming = input.aim && G.phase==='playing';
  document.getElementById('sight').classList.toggle('show', aiming);
  document.getElementById('scope').classList.toggle('show', aiming);
  document.getElementById('crosshair').style.visibility = aiming ? 'hidden' : 'visible';
  updateCombo(); if(comboCount > 0) updateComboHud();                          // combo (#29) : rupture + barre de temps
  updateBossHud();                                                             // barre de vie boss live (#31)
  updateDashHud();                                                             // recharge du dash (#35)
  const pk = nearestPickup(), pe = document.getElementById('pickup-prompt');   // invite de ramassage (#23)
  if(pe){ if(pk){ pe.innerHTML = `<kbd>G</kbd>Ramasser : ${pk.name} ${rarityBadge(pk.rarity)}`; pe.classList.remove('hidden'); }
          else pe.classList.add('hidden'); }
  updateCombatHud();
}
G.debug.tryFire = () => tryFire();
G.debug.reload = () => reload();
G.debug.clearTargets = () => clearTargets();
G.debug.targetsAlive = () => targets.filter(t => t.alive).length;
G.debug.spawnTargetInFront = (dist=8) => {
  _ray.setFromCamera({ x:0, y:0 }, camera);
  const p = _ray.ray.origin.clone().add(_ray.ray.direction.clone().multiplyScalar(dist));
  return spawnTarget(p.x, p.y, p.z).id;
};

// ====== Joueur : vie / dégâts / régénération ======
const BASE_MAX_HEALTH = 100, REGEN_DELAY = 6, BASE_REGEN_RATE = 10;   // régén plus lente (~10 s pour remonter à fond)
let maxHealth = BASE_MAX_HEALTH, regenRate = BASE_REGEN_RATE, speedMult = 1;   // effectifs (selon améliorations #15)
let health = maxHealth, lastDamageAt = -999;
G.health = maxHealth; G.maxHealth = maxHealth;
// ====== Améliorations du perso (#15) ======
// ====== Catalogue de personnages (achat ; stats de base par perso) ======
const CHARACTERS = [
  { id:'perso:blue-soldier', name:'Blue-Soldier', price:0,    rarity:'commun', base:{ health:100, regen:10, speed:1.00 },
    desc:'Soldat d\'élite polyvalent. Fiable au feu comme à la manœuvre.',
    skills:[ { icon:'target', name:'Tireur confirmé', desc:'Entraînement au tir sans faille.' },
             { icon:'shield', name:'Discipline',      desc:'Garde son sang-froid sous le feu.' },
             { icon:'medal',  name:'Polyvalence',     desc:'À l\'aise dans toutes les situations.' } ] },
  { id:'perso:guard', name:'Sentinel', price:1500, rarity:'rare', base:{ health:135, regen:13, speed:1.00 },
    desc:'Garde lourd bardé de blindage. Une muraille qui avance.',
    skills:[ { icon:'heart',  name:'Constitution', desc:'Réserve de vie supérieure à la moyenne.' },
             { icon:'shield', name:'Blindage',     desc:'Encaisse les coups qui achèvent les autres.' },
             { icon:'medal',  name:'Sentinelle',   desc:'Tient sa position coûte que coûte.' } ] },
  { id:'perso:robot', name:'Cyborg', price:3000, rarity:'epique', base:{ health:175, regen:17, speed:1.15 },
    desc:'Un être augmenté, conçu pour survivre dans toutes les conditions.',
    skills:[ { icon:'heart',  name:'Système optimisé', desc:'Régénération de santé améliorée.' },
             { icon:'sprint', name:'Surcharge',        desc:'Augmente temporairement la vitesse.' },
             { icon:'shield', name:'Résistance',       desc:'Réduction des dégâts explosifs.' } ] },
];
function characterById(id){ return CHARACTERS.find(c => c.id === id) || CHARACTERS[0]; }
const PLAYER_UPGRADE_SPECS = {
  health: { name:'Vie',     max:5, baseCost:300, perLevel:20 },
  regen:  { name:'Régén',   max:5, baseCost:250, perLevel:3 },
  speed:  { name:'Vitesse', max:5, baseCost:350, perLevel:0.06 },
};
function playerUpgradeLevel(type){ return (save.playerUpgrades && save.playerUpgrades[type]) || 0; }
function playerUpgradeCost(type){ const l = playerUpgradeLevel(type);
  return l >= PLAYER_UPGRADE_SPECS[type].max ? null : PLAYER_UPGRADE_SPECS[type].baseCost * (l + 1); }
// ====== Boost / équipement à stats (#28) : bonus passifs permanents par slot ======
const BOOSTS = [
  { id:'boost:vest1',  slot:'vest',  name:'Gilet léger',    stat:'health', bonus:25,   price:400,  rarity:'rare' },
  { id:'boost:vest2',  slot:'vest',  name:'Gilet lourd',    stat:'health', bonus:60,   price:1000, rarity:'epique' },
  { id:'boost:boots1', slot:'boots', name:'Bottes',         stat:'speed',  bonus:0.08, price:400,  rarity:'rare' },
  { id:'boost:boots2', slot:'boots', name:'Bottes ailées',  stat:'speed',  bonus:0.18, price:1000, rarity:'epique' },
  { id:'boost:medal1', slot:'medal', name:'Médaille',       stat:'regen',  bonus:5,    price:400,  rarity:'rare' },
  { id:'boost:medal2', slot:'medal', name:"Médaille d'or",  stat:'regen',  bonus:12,   price:1100, rarity:'legendaire' },
];
const BOOST_SLOTS = ['vest','boots','medal'];
// ---- visuels 3D des boosts (#28) : attachés aux os pour qu'on les VOIE sur le perso ----
function buildVestMesh(){ const g=new THREE.Group();
  const mat=new THREE.MeshStandardMaterial({color:0x39414f,metalness:0.45,roughness:0.6});
  const front=new THREE.Mesh(new THREE.BoxGeometry(0.36,0.42,0.10),mat); front.position.set(0,0.02,0.11);
  const back =new THREE.Mesh(new THREE.BoxGeometry(0.36,0.42,0.08),mat); back.position.set(0,0.02,-0.11);
  const strapL=new THREE.Mesh(new THREE.BoxGeometry(0.06,0.42,0.30),mat); strapL.position.set(-0.16,0.02,0);
  const strapR=strapL.clone(); strapR.position.x=0.16;
  g.add(front,back,strapL,strapR); g.traverse(o=>{if(o.isMesh)o.castShadow=true;}); return g; }
function buildBootMesh(){ const g=new THREE.Group();
  const mat=new THREE.MeshStandardMaterial({color:0x2a2f38,metalness:0.3,roughness:0.7});
  const foot =new THREE.Mesh(new THREE.BoxGeometry(0.11,0.08,0.22),mat); foot.position.set(0,-0.02,0.05);
  const ankle=new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.065,0.16,12),mat); ankle.position.set(0,0.07,-0.01);
  g.add(foot,ankle); g.traverse(o=>{if(o.isMesh)o.castShadow=true;}); return g; }
function buildMedalMesh(){ const g=new THREE.Group();
  const gold=new THREE.MeshStandardMaterial({color:0xd2a93b,metalness:0.8,roughness:0.3,emissive:0x3a2c08});
  const disc=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,0.02,16),gold); disc.rotation.x=Math.PI/2; disc.position.set(0,-0.06,0.13);
  const ribbon=new THREE.Mesh(new THREE.BoxGeometry(0.05,0.12,0.01),new THREE.MeshStandardMaterial({color:0x7a1f2b})); ribbon.position.set(0,0.01,0.13);
  g.add(disc,ribbon); g.traverse(o=>{if(o.isMesh)o.castShadow=true;}); return g; }
const BOOST_VISUAL = {
  vest:  { build:buildVestMesh,  attach:[{ name:'Spine2', re:/spine2|spine1|chest|spine/i, off:{x:0,y:0.04,z:0} }] },
  boots: { build:buildBootMesh,  attach:[{ name:'LeftFoot', re:/left.*foot|foot.*l\b|l_foot/i, off:{x:0,y:0,z:0} },
                                          { name:'RightFoot', re:/right.*foot|foot.*r\b|r_foot/i, off:{x:0,y:0,z:0} }] },
  medal: { build:buildMedalMesh, attach:[{ name:'Neck', re:/neck/i, off:{x:0,y:0,z:0} }] },
};
function applyBoosts(root){
  if(!root) return;
  clearBoneTag(root, 'boost');
  for(const slot of BOOST_SLOTS){
    const id = save.equippedBoosts[slot]; if(!id || runBoostOverrides[slot]) continue;   // #53 : pas de visuel si désactivé pour la partie
    const vis = BOOST_VISUAL[slot]; if(!vis) continue;
    for(const at of vis.attach){ const bone = findBoneNamed(root, at.name, at.re); if(bone) attachToBoneWorld(bone, vis.build(), 'boost', at.off); }
  }
}
G.debug.boostAttachedCount = () => { if(!model) return 0; let n=0; model.traverse(o=>{ if(o.userData && o.userData.accSlot==='boost') n++; }); return n; };
function boostById(id){ return BOOSTS.find(b => b.id === id) || null; }
// #53 run-based : désactiver un boost équipé pour la PARTIE EN COURS seulement (reset au restart, non persisté)
let runBoostOverrides = {};
function isBoostRunDisabled(slot){ return !!runBoostOverrides[slot]; }
function unequipBoostRun(slot){ if(!save.equippedBoosts[slot]) return false; runBoostOverrides[slot] = true; applyPlayerStats(); applyBoosts(model); return true; }
function requipBoostRun(slot){ if(!runBoostOverrides[slot]) return false; delete runBoostOverrides[slot]; applyPlayerStats(); applyBoosts(model); return true; }
function resetRunBoosts(){ runBoostOverrides = {}; }
function boostBonuses(){ const acc = { health:0, regen:0, speed:0 };
  for(const slot of BOOST_SLOTS){ if(runBoostOverrides[slot]) continue; const b = boostById(save.equippedBoosts[slot]); if(b) acc[b.stat] += b.bonus; }   // #53 saute les slots désactivés pour la partie
  return acc; }
function buyBoost(id){ const b = boostById(id); if(!b) return false;
  if(save.ownedBoosts.includes(id) || save.money < b.price) return false;
  save.money -= b.price; G.money = save.money; save.ownedBoosts.push(id);
  persist(); updateMoneyHud(); updateHomeMeta(); return true; }
function equipBoost(id){ const b = boostById(id); if(!b || !save.ownedBoosts.includes(id)) return false;
  // toggle : si déjà équipé dans ce slot → déséquiper ; sinon équiper
  if(save.equippedBoosts[b.slot] === id) save.equippedBoosts[b.slot] = null;
  else save.equippedBoosts[b.slot] = id;
  delete runBoostOverrides[b.slot];   // #53 : un (ré)équipement annule un éventuel "✕ Run" résiduel sur ce slot (sinon boost fantôme : équipé mais bonus/visuel inactifs)
  persist(); applyPlayerStats(); applyBoosts(model); return true; }
function applyPlayerStats(){
  const b = characterById(save.selectedCharacterId).base;   // base du perso + améliorations (#15) + boosts (#28)
  const bb = boostBonuses();
  maxHealth = b.health + PLAYER_UPGRADE_SPECS.health.perLevel * playerUpgradeLevel('health') + bb.health;
  regenRate = b.regen  + PLAYER_UPGRADE_SPECS.regen.perLevel  * playerUpgradeLevel('regen')  + bb.regen;
  speedMult = b.speed * (1 + PLAYER_UPGRADE_SPECS.speed.perLevel * playerUpgradeLevel('speed') + bb.speed);
  G.maxHealth = maxHealth;
}
function buyPlayerUpgrade(type){
  const spec = PLAYER_UPGRADE_SPECS[type]; if(!spec) return false;
  const cost = playerUpgradeCost(type);
  if(cost == null || save.money < cost) return false;
  if(!save.playerUpgrades) save.playerUpgrades = {};
  save.money -= cost; G.money = save.money; save.playerUpgrades[type] = playerUpgradeLevel(type) + 1;
  persist(); updateMoneyHud(); updateHomeMeta(); applyPlayerStats(); return true;   // effet immédiat
}
function buyCharacter(id){
  const c = CHARACTERS.find(c => c.id === id); if(!c) return false;
  if(save.ownedCharacters.includes(id) || save.money < c.price) return false;
  save.money -= c.price; G.money = save.money; save.ownedCharacters.push(id);
  persist(); updateMoneyHud(); updateHomeMeta(); return true;
}
function selectCharacter(id){
  if(!CHARACTERS.find(c => c.id === id) || !save.ownedCharacters.includes(id)) return false;
  save.selectedCharacterId = id; persist(); applyPlayerStats(); return true;
}
applyPlayerStats();   // reflète les améliorations sauvegardées dès le chargement
G.debug.playerStats = () => ({ maxHealth, regenRate, speedMult });
G.debug.shop.boostCatalog = () => BOOSTS.map(b => ({ id:b.id, slot:b.slot, name:b.name, stat:b.stat, bonus:b.bonus, price:b.price, rarity:b.rarity }));
G.debug.shop.buyBoost = (id) => buyBoost(id);
G.debug.shop.equipBoost = (id) => equipBoost(id);
G.debug.equippedBoosts = () => Object.assign({}, save.equippedBoosts);
G.debug.boostBonuses = () => boostBonuses();
G.debug.unequipBoost = (slot) => { save.equippedBoosts[slot] = null; persist(); applyPlayerStats(); applyBoosts(model); };
G.debug.unequipBoostRun = (slot) => unequipBoostRun(slot);          // #53 déséquipe pour la partie en cours
G.debug.requipBoostRun = (slot) => requipBoostRun(slot);            // #53 réactive pour la partie en cours
G.debug.runBoostOverrides = () => Object.assign({}, runBoostOverrides);
G.debug.isBoostRunDisabled = (slot) => isBoostRunDisabled(slot);
// ====== #155 Consommables (achat boutique, stock persistant — plus de refill par vague) ======
const CONSUMABLES = [
  { key:'frag',      name:'Grenade frag', icon:'grenade', price:50  },
  { key:'flashbang', name:'Flashbang',     icon:'flash',   price:60  },
  { key:'smoke',     name:'Fumigène',      icon:'smoke',   price:50  },
  { key:'sticky',    name:'Grenade collante', icon:'sticky', price:150 },
  { key:'molotov',   name:'Molotov',       icon:'molotov', price:120 },
  { key:'emp',       name:'EMP',           icon:'emp',     price:150 },
  { key:'medkit',    name:'Trousse de soin', icon:'heart', price:80  },   // #178
];
function buyConsumable(key, qty=1){
  const c = CONSUMABLES.find(c => c.key === key);
  if(!c || qty <= 0) return false;
  const cost = c.price * qty;
  if(save.money < cost) return false;
  save.money -= cost; G.money = save.money;
  save.consumables[key] = (save.consumables[key] || 0) + qty;
  persist(); updateMoneyHud();
  return true;
}
G.debug.consumables = () => Object.assign({}, save.consumables);
G.debug.shop.consumablesCatalog = () => CONSUMABLES.map(c => ({ key:c.key, name:c.name, price:c.price }));
G.debug.shop.buyConsumable = (key, qty) => buyConsumable(key, qty);
G.debug.setConsumableStock = (key, n) => {
  if(!(key in save.consumables)) return false;
  save.consumables[key] = n; persist();
  if(G.phase === 'playing'){
    if(key === 'frag') grenades = n;
    else if(key === 'flashbang') flashbangs = n;
    else if(key === 'smoke') smokeStock = n;
    else if(key === 'sticky') stickyStockCount = n;
    else if(key === 'molotov') molotovStockCount = n;
    else if(key === 'emp') empStockCount = n;
  }
  return true;
};
G.debug.shop.charCatalog = () => CHARACTERS.map(c => ({ id:c.id, name:c.name, price:c.price, base:c.base, rarity:c.rarity }));
G.debug.shop.buyCharacter = (id) => buyCharacter(id);
G.debug.shop.selectCharacter = async (id) => { const ok = selectCharacter(id); if(ok) await showSelectedCharacter(); return ok; };   // reflète le bouton Équiper : sélection + reconstruction du modèle
G.debug.currentModelCharId = () => model ? model.userData.charId : null;   // quel perso le modèle 3D affiche réellement
G.debug.shop.accessoryCatalog = (slot) => (ACCESSORY_SLOTS[slot]||[]).map(a => ({ id:a.id, name:a.name, price:a.price, rarity:a.rarity }));
G.debug.shop.buyAccessory = (id) => buyAccessory(id);
G.debug.shop.selectAccessory = (slot, id) => selectAccessory(slot, id);
G.debug.shop.previewAccessory = (slot, id) => previewAccessory(slot, id);   // essayer avant d'acheter

// ====== Danses / emotes (#27) : clips one-shot jouables en partie (touches 1/2/3) ======
const DANCES = [
  { id:'dance:all_night', name:'All Night',    clip:'All_Night_Dance',      price:0,    rarity:'commun' },
  { id:'dance:boom',      name:'Boom',         clip:'Boom_Dance',           price:0,    rarity:'commun' },
  { id:'dance:groove',    name:'You Groove',   clip:'You_Groove',           price:0,    rarity:'rare' },
  { id:'dance:skill1',    name:'Skill I',      clip:'Skill_01',             price:500,  rarity:'rare' },
  { id:'dance:skill3',    name:'Skill III',    clip:'Skill_03',             price:800,  rarity:'epique' },
  { id:'dance:combo',     name:'Triple Combo', clip:'Triple_Combo_Attack',  price:1200, rarity:'legendaire' },
];
function danceById(id){ return DANCES.find(d => d.id === id) || null; }
function buyDance(id){
  const d = danceById(id); if(!d) return false;
  if(save.ownedDances.includes(id) || save.money < d.price) return false;
  save.money -= d.price; G.money = save.money; save.ownedDances.push(id);
  persist(); updateMoneyHud(); updateHomeMeta(); return true;
}
function toggleDance(id){   // sélectionne/déselectionne (liste ordonnée, max 3 pour les touches 1/2/3)
  if(!danceById(id) || !save.ownedDances.includes(id)) return false;
  const arr = save.selectedDances, i = arr.indexOf(id);
  if(i >= 0) arr.splice(i, 1);
  else { arr.push(id); if(arr.length > 3) arr.shift(); }
  persist(); return true;
}
let previewDanceT = null;
function previewDance(id){   // joue la danse EN LIVE sur le perso de la boutique/lobby (no-op en mode test sans clips)
  const d = danceById(id); if(!d || !model || !anims.length) return false;
  if(!mixer) mixer = new THREE.AnimationMixer(model);
  const raw = anims.find(a => a.key === d.clip)?.clip; if(!raw) return false;
  const clip = retargetClipWorld(raw); if(!clip) return false;
  const act = mixer.clipAction(clip); act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = false;
  mixer.stopAllAction(); act.reset().fadeIn(0.1).play();
  clearTimeout(previewDanceT);
  previewDanceT = setTimeout(() => { if(G.phase === 'lobby') playLobbyIdle(); }, (clip.duration || 2) * 1000);
  return true;
}
function danceClipAction(clipName){
  if(danceActionCache[clipName]) return danceActionCache[clipName];
  const raw = anims.find(a => a.key === clipName)?.clip; if(!raw || !mixer) return null;
  const clip = retargetClipWorld(raw); if(!clip) return null;
  const act = mixer.clipAction(clip); act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = false;
  danceActionCache[clipName] = act; return act;
}
function playDance(slot){
  if(G.phase !== 'playing' || !mixer) return false;
  const id = save.selectedDances[slot]; const d = id && danceById(id); if(!d) return false;
  const act = danceClipAction(d.clip); if(!act) return false;
  const prev = actions[curLoco]; if(prev) prev.fadeOut(0.15);
  act.reset().setEffectiveWeight(1).fadeIn(0.12).play();
  danceAction = act; dancing = true; danceEndAt = nowS() + (act.getClip().duration || 1.5);
  G.locomotion = 'dance'; return true;
}
function endDance(){
  if(!dancing) return; dancing = false;
  if(danceAction) danceAction.fadeOut(0.2); danceAction = null;
  curLoco = 'idle'; if(actions.idle) actions.idle.reset().fadeIn(0.15).play();
  G.locomotion = 'idle';
}
G.debug.shop.danceCatalog = () => DANCES.map(d => ({ id:d.id, name:d.name, price:d.price, rarity:d.rarity }));
G.debug.shop.buyDance = (id) => buyDance(id);
G.debug.shop.toggleDance = (id) => toggleDance(id);
G.debug.selectedDances = () => save.selectedDances.slice();
G.debug.previewDance = (id) => previewDance(id);
G.debug.playDance = (slot) => playDance(slot);
G.debug.isDancing = () => dancing;
function updateHealthHud(){
  const bar = document.getElementById('health-fill'); if(!bar) return;
  const pct = Math.max(0, health) / maxHealth * 100;
  bar.style.width = pct + '%';
  bar.classList.toggle('lo', pct <= 55 && pct > 25);
  bar.classList.toggle('crit', pct <= 25);
}
function flashDamage(){
  const v = document.getElementById('vignette'); v.classList.add('show');
  clearTimeout(v.__t); v.__t = setTimeout(() => v.classList.remove('show'), 220);
}
const SECOND_WIND_INVULN = 2;
let secondWindUsed = false, secondWindInvulnUntil = 0;
function damagePlayer(amount){
  if(G.phase !== 'playing') return;
  if(rampageActive()) return;                              // invincible pendant rampage (#125)
  if(nowS() < secondWindInvulnUntil) return;                // invincibilité post-dernier-souffle (#137)
  if(dashRemaining > 0) return;                             // frames d'invincibilité pendant le dash (#142)
  onStreakReset(); onRampageReset();                                        // tout hit reset le streak (#72), avant guard clauses
  headStreakCount_ = 0;                                  // reset headshot streak (#110)
  amount = Math.round(amount * curDiff().dmg);          // #46 difficulté : dégâts reçus
  if(activePower === 'kevlar') amount = Math.round(amount * 0.7);   // #167 : -30% degats
  if(ksShieldActive()) amount = Math.round(amount * 0.5); // bouclier killstreak #58
  // bouclier rechargeable (#67)
  if(shieldHpVal > 0){ const absorbed = Math.min(shieldHpVal, amount); shieldHpVal -= absorbed; amount -= absorbed; shieldLastDmg = nowS(); updateShieldHud(); }
  if(amount <= 0) return;
  if(!hardcore_ && !secondWindUsed && amount >= health){   // #137 : un coup fatal → survit à 1 PV, une fois par partie
    secondWindUsed = true; health = 1; G.health = health; lastDamageAt = nowS();
    secondWindInvulnUntil = nowS() + SECOND_WIND_INVULN;
    updateHealthHud(); showCallout('DERNIER SOUFFLE!'); playSound('reload');
    return;
  }
  health = Math.max(0, health - amount); G.health = health; lastDamageAt = nowS();
  dmgThisWave += amount;
  if(amount >= BLOOD_THRESHOLD) showBloodScreen(Math.min(1, amount / 50)); // blood screen (#74)
  flashDamage(); updateHealthHud(); playSound('playerHit');
  if(health <= 0) playerDie();
}
function updateHealth(dt){
  if(G.phase !== 'playing') return;
  if(!hardcore_ && health < maxHealth && nowS() - lastDamageAt > REGEN_DELAY){
    const regenMult = activePower === 'regen_boost' ? 2 : 1;   // #147
    health = Math.min(maxHealth, health + regenRate * regenMult * dt); G.health = health; updateHealthHud();
  }
  updateAdrenalineHud();
}
G.debug.damagePlayer = (a) => damagePlayer(a);
G.debug.playerHealth = () => health;
G.debug.forceFallFrom = (y) => { if(!model) return; model.position.y = y; grounded = false; airPeakY_ = null; };   // dégâts de chute : place le joueur en l'air, la gravité fait le reste
G.debug.fallDamageFor = (h) => h <= FALL_SAFE ? 0 : Math.min(FALL_DMG_MAX, Math.round((h - FALL_SAFE) * FALL_DMG_PER_M));   // formule pure (tests)
G.debug.secondWindAvailable = () => !secondWindUsed;
G.debug.secondWindUsed = () => secondWindUsed;
G.debug.secondWindInvulnActive = () => nowS() < secondWindInvulnUntil;
// ====== #134 Adrénaline : bonus dégâts joueur à PV bas ======
const ADRENALINE_THRESHOLD = 0.25, ADRENALINE_MULT = 1.2;
function isAdrenaline(){ return health > 0 && health <= maxHealth * ADRENALINE_THRESHOLD; }
function updateAdrenalineHud(){ const el = document.getElementById('adrenaline-hud'); if(el) el.classList.toggle('hidden', !isAdrenaline()); }
G.debug.adrenalineActive = () => isAdrenaline();
G.debug.adrenalineMult = () => isAdrenaline() ? ADRENALINE_MULT : 1;
// ====== Packs de soin (#32) : drop d'ennemis, ramassage par proximité ======
const HEALTH_DROP_CHANCE = 0.25, HEALTH_PICKUP_R = 1.6, HEALTH_PACK_AMOUNT = 30;
// ====== #117 Ammo packs ======
const AMMO_DROP_CHANCE = 0.20, AMMO_PICKUP_R = 1.5;
const ammoPacks = []; let forceAmmoDrop_ = false;
function buildAmmoPack(){
  const g = new THREE.Group();
  const yel = new THREE.MeshStandardMaterial({ color:0xffcc00, emissive:0xffaa00, emissiveIntensity:0.7, roughness:0.4 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.18,0.05,12), new THREE.MeshStandardMaterial({ color:0x2a2000, roughness:0.7 })); base.position.y = 0.025;
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.14,0.14), yel); box.position.y = 0.22;
  g.add(base, box); g.traverse(o => { if(o.isMesh) o.castShadow = true; }); return g;
}
function spawnAmmoPack(x, z){ const m = buildAmmoPack(); const gy = groundHeight(x, z); m.position.set(x, gy, z); scene.add(m);
  ammoPacks.push({ mesh:m, x, z, gy }); return ammoPacks.length - 1; }   // #204 : posé sur le sol local
function clearAmmoPacks(){ for(const p of ammoPacks) scene.remove(p.mesh); ammoPacks.length = 0; }
function maybeDropAmmo(e){ if(forceAmmoDrop_ || Math.random() < (activePower==='loot_master' ? AMMO_DROP_CHANCE*2 : AMMO_DROP_CHANCE)) spawnAmmoPack(e.root.position.x, e.root.position.z); }   // #188
function updateAmmoPacks(dt){
  if(!model) return; const t = nowS();
  for(let i=ammoPacks.length-1;i>=0;i--){ const p = ammoPacks[i];
    p.mesh.rotation.y += dt * 2.0; p.mesh.position.y = (p.gy || 0) + 0.05 * Math.sin(t*2.5 + i + 1);   // #204 : bob autour du sol local
    const d = Math.hypot(model.position.x - p.x, model.position.z - p.z);
    if(d <= AMMO_PICKUP_R){ ammo = Math.min(curMag, ammo + Math.round(curMag * 0.5)); G.ammo = ammo; flashHeal(); playSound('reload');
      scene.remove(p.mesh); ammoPacks.splice(i, 1); } }
}
G.debug.ammoPackCount = () => ammoPacks.length;
G.debug.spawnAmmoPack = (x,z) => spawnAmmoPack(x,z);
G.debug.forceAmmoDrop = (b) => { forceAmmoDrop_ = !!b; };
// ====== #143 Caisse de ravitaillement (care package) ======
const CARE_PACKAGE_WAVE_INTERVAL = 4, CARE_PACKAGE_PICKUP_R = 1.8, CARE_PACKAGE_MONEY = 150;
const CARE_PACKAGE_REWARDS = ['money', 'grenades', 'ammo', 'bonus_turret', 'bonus_mine', 'bonus_airstrike', 'medkit'];   // #198
let carePackage = null, carePackageForcedReward_ = null;
function buildCarePackageMesh(){
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.6,0.5,0.6), new THREE.MeshStandardMaterial({ color:0x5a5a2a, roughness:0.7 }));
  box.position.y = 0.25; g.add(box); g.traverse(o => { if(o.isMesh) o.castShadow = true; }); return g;
}
function spawnCarePackage(x, z){
  if(carePackage) return;
  const m = buildCarePackageMesh(); m.position.set(x, groundHeight(x, z), z); scene.add(m);   // #204
  carePackage = { mesh:m, x, z };
}
function maybeSpawnCarePackage(w){
  if(w % CARE_PACKAGE_WAVE_INTERVAL !== 0) return;
  const sp = randomSpawn(); spawnCarePackage(sp.x, sp.z);
}
const GRENADE_BUNDLE_BONUS = { frag:3, flashbang:2, smoke:2, sticky:1, molotov:1, emp:1 };   // #155 : bonus fixe (plus de "refill au max")
function grantGrenadeBundle(){
  grenades += GRENADE_BUNDLE_BONUS.frag; save.consumables.frag = grenades; updateGrenadeHud();
  flashbangs += GRENADE_BUNDLE_BONUS.flashbang; save.consumables.flashbang = flashbangs; updateFlashbangHud();
  smokeStock += GRENADE_BUNDLE_BONUS.smoke; save.consumables.smoke = smokeStock; updateSmokeHud();
  stickyStockCount += GRENADE_BUNDLE_BONUS.sticky; save.consumables.sticky = stickyStockCount;
  molotovStockCount += GRENADE_BUNDLE_BONUS.molotov; save.consumables.molotov = molotovStockCount;
  empStockCount += GRENADE_BUNDLE_BONUS.emp; save.consumables.emp = empStockCount;
  persist();
}
function applyCarePackageReward(type){
  if(type === 'money'){ addMoney(CARE_PACKAGE_MONEY); }
  else if(type === 'grenades'){ grantGrenadeBundle(); }
  else if(type === 'ammo'){ ammo = curMag; G.ammo = ammo; }
  else if(type === 'bonus_turret'){ deployTurretFree(); }       // #156 : octroi instantané gratuit, indépendant du palier de points
  else if(type === 'bonus_mine'){ placeMineFree(); }
  else if(type === 'bonus_airstrike'){ triggerAirstrike(); }
  else if(type === 'medkit'){ medkitStockCount += 2; save.consumables.medkit = medkitStockCount; persist(); updateMedkitHud(); }   // #198
  showCallout('RAVITAILLEMENT!'); flashHeal(); playSound('reload');
}
function updateCarePackage(dt){
  if(!carePackage || !model) return;
  if(Math.hypot(model.position.x - carePackage.x, model.position.z - carePackage.z) <= CARE_PACKAGE_PICKUP_R){
    const type = carePackageForcedReward_ || CARE_PACKAGE_REWARDS[Math.floor(Math.random()*CARE_PACKAGE_REWARDS.length)];
    applyCarePackageReward(type);
    scene.remove(carePackage.mesh); carePackage = null; carePackageForcedReward_ = null;
  }
}
function clearCarePackage(){ if(carePackage){ scene.remove(carePackage.mesh); carePackage = null; } }
G.debug.carePackageActive = () => !!carePackage;
G.debug.carePackagePos = () => carePackage ? { x:carePackage.x, z:carePackage.z } : null;
G.debug.spawnCarePackageAt = (x,z) => spawnCarePackage(x,z);
G.debug.forceCarePackageReward = (type) => { carePackageForcedReward_ = type; };
const healthPacks = []; let forceHealthDrop = false;
function buildHealthPack(){
  const g = new THREE.Group();
  const green = new THREE.MeshStandardMaterial({ color:0x2ecf6b, emissive:0x14d06a, emissiveIntensity:0.8, roughness:0.4 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.20,0.06,16), new THREE.MeshStandardMaterial({ color:0x122a1c, roughness:0.7 })); base.position.y = 0.03;
  const v = new THREE.Mesh(new THREE.BoxGeometry(0.10,0.30,0.10), green); v.position.y = 0.30;
  const h = new THREE.Mesh(new THREE.BoxGeometry(0.30,0.10,0.10), green); h.position.y = 0.30;
  g.add(base, v, h); g.traverse(o => { if(o.isMesh) o.castShadow = true; }); return g;
}
function spawnHealthPack(x, z){ const m = buildHealthPack(); const gy = groundHeight(x, z); m.position.set(x, gy, z); scene.add(m);
  healthPacks.push({ mesh:m, x, z, gy }); return healthPacks.length - 1; }   // #204 : posé sur le sol local
function clearHealthPacks(){ for(const p of healthPacks) scene.remove(p.mesh); healthPacks.length = 0; }
function maybeDropHealth(e){ if(forceHealthDrop || e.type === 'boss' || Math.random() < (activePower==='loot_master' ? HEALTH_DROP_CHANCE*2 : HEALTH_DROP_CHANCE)) spawnHealthPack(e.root.position.x, e.root.position.z); }   // #188
function updateHealthPacks(dt){
  if(!model) return; const t = nowS();
  for(let i=healthPacks.length-1;i>=0;i--){ const p = healthPacks[i];
    p.mesh.rotation.y += dt * 1.5; p.mesh.position.y = (p.gy || 0) + 0.06 * Math.sin(t*3 + i);   // #204
    const d = Math.hypot(model.position.x - p.x, model.position.z - p.z);
    if(d <= HEALTH_PICKUP_R && health < maxHealth){
      if(!hardcore_){ health = Math.min(maxHealth, health + HEALTH_PACK_AMOUNT); G.health = health; updateHealthHud(); flashHeal(); playSound('reload'); }
      scene.remove(p.mesh); healthPacks.splice(i, 1); } }
}
function flashHeal(){ const v = document.getElementById('heal-flash'); if(!v) return; v.classList.add('show'); clearTimeout(v.__t); v.__t = setTimeout(() => v.classList.remove('show'), 260); }
G.debug.spawnHealthPack = (x,z) => spawnHealthPack(x,z);
G.debug.healthPackY = (i=0) => healthPacks[i] ? healthPacks[i].mesh.position.y : null;   // #204
G.debug.healthPackCount = () => healthPacks.length;
G.debug.forceHealthDrop = (b) => { forceHealthDrop = !!b; };
G.debug.nearestHealthPack = () => { if(!model||!healthPacks.length) return null; let best=null,bd=1e9;
  for(const p of healthPacks){ const d=Math.hypot(model.position.x-p.x, model.position.z-p.z); if(d<bd){bd=d;best=p;} }
  return best ? { x:best.x, z:best.z, dist:bd } : null; };
// ====== Power-ups temporaires (#34) : orbes droppés, effet temporisé via applyWeaponStats ======
const POWERUPS = { dmgx2:{ name:'×2 Dégâts', color:0xff8a2a }, rapid:{ name:'Tir rapide', color:0x2ad6ff }, slowmo:{ name:'Slow-mo', color:0x9a6aff }, extended_mag:{ name:'Chargeur ×2', color:0x3dff7a, duration:15 }, shield_orb:{ name:'Bouclier Max', color:0x4488ff, instant:true }, xp_boost:{ name:'×2 XP', color:0xdd66ff, duration:12 }, explosive_ammo:{ name:'Balles Explosives', color:0xff4400 }, speed_boost:{ name:'Sprint ×2', color:0x22ffcc, duration:6 }, vampire:{ name:'Vampire', color:0xaa0044, duration:10 }, steady_aim:{ name:'Visée stable', color:0x66e0ff, duration:8 }, regen_boost:{ name:'Régén ×2', color:0x7dffb0, duration:10 }, piercing_rounds:{ name:'Munitions perforantes', color:0xdde6ee, duration:8 }, incendiary_ammo:{ name:'Munitions incendiaires', color:0xff6600, duration:8 }, lucky_shot:{ name:'Tir chanceux', color:0xffd700, duration:10 }, full_auto:{ name:'Full-auto', color:0xff2222, duration:10 }, money_magnet:{ name:'Aimant à argent', color:0xffe15a, duration:8 }, kevlar:{ name:'Kevlar', color:0x8899aa, duration:10 }, berserk:{ name:'Berserk', color:0x661111, duration:10 }, instant_heal:{ name:'Trousse instantanée', color:0x33ff66, instant:true }, radar_boost:{ name:'Radar longue portée', color:0x2ad6ff, duration:12 }, second_wind_refill:{ name:'Second souffle ravivé', color:0xffd700, instant:true }, loot_master:{ name:'Loot Master', color:0xffcc00, duration:10 }, ricochet_boost:{ name:'Ricochet amélioré', color:0xbfd0e0, duration:10 }, nova_blast:{ name:'Vague de choc', color:0xffddaa, instant:true } }; // #95(15s) #122 #123 #127 #133(10s) #145(8s) #147(10s) #150(8s) #152(8s) #153(10s) #154(10s) #160(8s) #167(10s) #171(10s) #172 #179(12s) #181 #188(10s) #189(10s) #200
const POWER_DROP_CHANCE = 0.12, POWER_PICKUP_R = 1.6, POWER_DURATION = 8;
const powerUps = []; let forcePowerDrop = false;
function buildPowerOrb(color){ return new THREE.Mesh(new THREE.IcosahedronGeometry(0.16,0),
  new THREE.MeshStandardMaterial({ color, emissive:color, emissiveIntensity:0.9, roughness:0.3 })); }
function spawnPowerUp(type, x, z){ if(!POWERUPS[type]) type='dmgx2'; const m = buildPowerOrb(POWERUPS[type].color);
  const gy = groundHeight(x, z);   // #204
  m.castShadow = true; m.position.set(x, gy + 0.6, z); scene.add(m); powerUps.push({ mesh:m, x, z, gy, type }); return powerUps.length-1; }
function clearPowerUps(){ for(const p of powerUps) scene.remove(p.mesh); powerUps.length = 0; }
function maybeDropPower(e){ if(forcePowerDrop || e.type==='boss' || Math.random() < (activePower==='loot_master' ? POWER_DROP_CHANCE*2 : POWER_DROP_CHANCE)){   // #188
  const ks = Object.keys(POWERUPS); spawnPowerUp(ks[Math.floor(Math.random()*ks.length)], e.root.position.x, e.root.position.z); } }
const INSTANT_HEAL_AMOUNT = 40;   // #172
const NOVA_RADIUS = 8, NOVA_DAMAGE = 80;   // #200
function activatePower(type){
  if(type === 'shield_orb'){ shieldHpVal = SHIELD_MAX; shieldLastDmg = -999; updateShieldHud(); lastShieldOrbPickup_=true; flashHeal(); playSound('reload'); return; }
  if(type === 'instant_heal'){ if(!hardcore_){ health = Math.min(maxHealth, health + INSTANT_HEAL_AMOUNT); G.health = health; updateHealthHud(); } flashHeal(); playSound('reload'); return; }   // #172
  if(type === 'second_wind_refill'){ secondWindUsed = false; flashHeal(); playSound('reload'); return; }   // #181
  if(type === 'nova_blast'){   // #200
    if(model){ for(const e of enemies){ if(!e.alive) continue;
      const d = Math.hypot(e.root.position.x-model.position.x, e.root.position.z-model.position.z);
      if(d <= NOVA_RADIUS) damageEnemy(e, NOVA_DAMAGE); }
      spawnShockwave(model.position.x, 0.6, model.position.z); }
    flashHeal(); playSound('reload'); return;
  }
  activePower = type; powerExpireAt = nowS() + (POWERUPS[type]?.duration || POWER_DURATION); applyWeaponStats(); updatePowerHud(); flashHeal(); playSound('reload');
}
function updatePowerUps(dt){ if(!model) return; const t = nowS();
  if(activePower && t >= powerExpireAt){ activePower = null; applyWeaponStats(); }
  for(let i=powerUps.length-1;i>=0;i--){ const p = powerUps[i]; p.mesh.rotation.y += dt*2; p.mesh.position.y = (p.gy || 0) + 0.6 + 0.08*Math.sin(t*3+i);   // #204
    if(Math.hypot(model.position.x-p.x, model.position.z-p.z) <= POWER_PICKUP_R){ activatePower(p.type); scene.remove(p.mesh); powerUps.splice(i,1); } }
  updatePowerHud(); }
function updatePowerHud(){ const el = document.getElementById('power-hud'); if(!el) return;
  if(!activePower){ el.classList.add('hidden'); return; }
  const p = POWERUPS[activePower], dur = p.duration || POWER_DURATION, frac = Math.max(0, (powerExpireAt - nowS())/dur);
  el.innerHTML = `<span class="pd" style="background:#${p.color.toString(16).padStart(6,'0')}"></span>${p.name}<div class="pbar" style="width:${Math.round(frac*100)}%"></div>`;
  el.classList.remove('hidden'); }
function resetPower(){ activePower = null; powerExpireAt = 0; updatePowerHud(); }
G.debug.spawnPowerUp = (t,x,z) => spawnPowerUp(t,x,z);
G.debug.powerUpCount = () => powerUps.length;
G.debug.forcePowerDrop = (b) => { forcePowerDrop = !!b; };
G.debug.activePowerUp = () => activePower;
G.debug.powerUpTimeLeft = () => activePower ? Math.max(0, powerExpireAt - nowS()) : 0;
G.debug.liveDamage = () => curDmgMult;
let lastShieldOrbPickup_ = false;
G.debug.lastShieldOrbPickup = () => lastShieldOrbPickup_;
G.debug.spawnShieldOrb = (x,z) => { lastShieldOrbPickup_=false; spawnPowerUp('shield_orb', x, z); };
// ====== Getters debug des power-ups temporisés — GÉNÉRÉS (étape 5) ======
// nom debug (contrat __game FIGÉ) → { type, spawn } ; les noms de spawners gardent leurs irrégularités historiques.
const POWER_DEBUG = {
  extMag:         { type:'extended_mag',    spawn:'spawnExtMag' },          // #95
  xpBoost:        { type:'xp_boost',        spawn:'spawnXpBoost' },         // #122
  explosiveAmmo:  { type:'explosive_ammo',  spawn:'spawnExplosiveAmmo' },   // #123
  speedBoost:     { type:'speed_boost',     spawn:'spawnSpeedBoost' },      // #127
  vampire:        { type:'vampire',         spawn:'spawnVampireOrb' },      // #133
  steadyAim:      { type:'steady_aim',      spawn:'spawnSteadyAim' },       // #145
  regenBoost:     { type:'regen_boost',     spawn:'spawnRegenBoost' },      // #147
  piercingRounds: { type:'piercing_rounds', spawn:'spawnPiercingRounds' },  // #150
  incendiaryAmmo: { type:'incendiary_ammo', spawn:'spawnIncendiaryAmmo' },  // #152
  luckyShot:      { type:'lucky_shot',      spawn:'spawnLuckyShot' },       // #153
  fullAuto:       { type:'full_auto',       spawn:'spawnFullAuto' },        // #154
  moneyMagnet:    { type:'money_magnet',    spawn:'spawnMoneyMagnet' },     // #160
  kevlar:         { type:'kevlar',          spawn:'spawnKevlar' },          // #167
  berserk:        { type:'berserk',         spawn:'spawnBerserk' },         // #171
  radarBoost:     { type:'radar_boost',     spawn:'spawnRadarBoost' },      // #179
  lootMaster:     { type:'loot_master',     spawn:'spawnLootMaster' },      // #188
  ricochetBoost:  { type:'ricochet_boost',  spawn:'spawnRicochetBoost' },   // #189
};
for(const [dbg, def] of Object.entries(POWER_DEBUG)){
  G.debug[dbg + 'Active'] = () => activePower === def.type;
  G.debug[dbg + 'TimeLeft'] = () => activePower === def.type ? Math.max(0, powerExpireAt - nowS()) : 0;
  G.debug[def.spawn] = (x, z) => spawnPowerUp(def.type, x, z);
}
// spawners des power-ups instantanés (pas de Active/TimeLeft)
G.debug.spawnInstantHeal = (x,z) => spawnPowerUp('instant_heal', x, z);             // #172
G.debug.spawnSecondWindRefill = (x,z) => spawnPowerUp('second_wind_refill', x, z);  // #181
G.debug.spawnNovaBlast = (x,z) => spawnPowerUp('nova_blast', x, z);                 // #200
G.debug.piercedHitCount = () => piercedHitCount_;
G.debug.luckyShotCount = () => luckyShotCount_;
G.debug.lastLuckyShot = () => lastLuckyShot_;
G.debug.forceLuckyShot = (b) => { luckyForce_ = !!b; };
G.debug.playerMoveSpeed = () => lastMoveSpeed_;                                 // #127 vitesse effective (inclut le boost)

function playerDie(){
  G.phase = 'dead'; recordScore(); resetCombo(); resetPower(); playSound('gameover');
  flushLifetimeTime(); // lifetime playtime (#80)
  addLifetimeStat('distance', runDistance_);   // #185 : distance cumulee (succes marathonien)
  document.getElementById('pickup-prompt').classList.add('hidden');   // plus d'invite de ramassage à la mort (#23)
  document.getElementById('scope-overlay')?.classList.remove('show'); // lunette sniper masquée à la mort (sinon viseur résiduel sur Game Over/accueil #61)
  if(document.pointerLockElement) document.exitPointerLock?.();
  const accuracy_ = runShots ? Math.round(runHits/runShots*100) : 0;
  const lbRank = submitScore({ score, wave, kills:runKills, headshots:runHeadshots, accuracy:accuracy_ });   // #157 : classement local
  document.getElementById('go-score').innerHTML =          // G-4 tuiles + stats de partie (#43 : kills/headshots/précision)
    `<div class="go-tiles">`
    + `<div class="go-tile"><span>Vague</span><b>${wave}</b></div>`
    + `<div class="go-tile"><span>Score</span><b>${score}</b></div>`
    + `<div class="go-tile"><span>Kills</span><b>${runKills}</b></div>`
    + `<div class="go-tile"><span>Headshots</span><b>${runHeadshots}</b></div>`
    + `<div class="go-tile"><span>Précision</span><b>${accuracy_}%</b></div>`
    + `<div class="go-tile"><span>Meilleur coup</span><b>${runBestHit_}</b></div>`
    + `<div class="go-tile"><span>Distance</span><b>${Math.round(runDistance_)}m</b></div>`
    + `<div class="go-tile"><span>Meilleure série</span><b>${runBestStreak_}</b></div>`
    + `<div class="go-tile"><span>Meilleure vague</span><b>${runBestWaveKills_}</b></div>`
    + `<div class="go-tile"><span>Vague la + rapide</span><b>${runFastestWave_!==null ? Math.round(runFastestWave_)+'s' : '—'}</b></div>`
    + `<div class="go-tile"><span>Record</span><b>${save.bestWave}</b></div>`
    + `<div class="go-tile"><span>Combo max</span><b>x${comboMultiplier(save.bestCombo||0)}</b><em>${save.bestCombo||0}</em></div>`
    + `<div class="go-tile gold"><span>Argent gagné</span><b>+${runMoney_}</b></div></div>`
    + `<div class="go-rank">RANG <span class="go-rank-letter">${runRank()}</span></div>`
    + `<div id="go-leaderboard" class="go-leaderboard"><div class="go-lb-h">// Classement local</div>`
    + save.leaderboard.map((e,i) => `<div class="go-lb-row${(i===lbRank-1)?' gold':''}"><span>#${i+1}</span><b>${e.score}</b><span>Vague ${e.wave}</span><span class="go-lb-date">${new Date(e.date).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'})}</span></div>`).join('')   // #170
    + `</div>`;
  document.getElementById('gameover').classList.remove('hidden');
}
function restartGame(){
  if(trainingActive_){ startTraining(); return; }   // #158 : recommencer en entrainement relance l'entrainement, pas une vraie vague
  document.getElementById('gameover').classList.add('hidden');
  endDance();                                                  // pas de danse résiduelle au restart (#27)
  resetRunBoosts();                                            // #53 : les boosts désactivés "pour la partie" reviennent au restart
  if(model){ model.position.set(playerSpawn.x, groundY + groundHeight(playerSpawn.x, playerSpawn.z), playerSpawn.z); model.rotation.y = 0; velY = 0; grounded = true; doubleJumpAvailable = false; }   // #204 : spawn par map
  applyPlayerStats(); health = maxHealth; G.health = health; lastDamageAt = -999; updateHealthHud();
  resetRunState();       // reset commun startGame/restartGame (étape 4 — source unique)
  updateCombatHud();
  ensureWeapon();                                              // reconstruit le modèle d'arme (retour à la save après loot)
  flushLifetimeTime(); startLifetimeTimer();                   // #80 : comptabilise le run abandonné (no-op si déjà flushé à la mort) puis relance le chrono (sinon temps des runs relancés perdu)
  spawnDefaultTargets();
  G.phase = 'playing';
  updateLoadoutHud();   // affiche les barres du loadout choisi (#156)
  startWave(1);
}
document.getElementById('go-restart').addEventListener('click', restartGame);
G.debug.restart = () => restartGame();

// Retour à l'accueil (depuis le Game Over) : masque les HUD, vide la scène de jeu, réaffiche le menu
function backToHome(){
  document.getElementById('gameover').classList.add('hidden');
  flushLifetimeTime();                                         // #80 : comptabilise le temps de session avant de quitter (sinon perdu via pause→menu)
  resetCombo(); resetPower(); resetRunBoosts();                // #53 : retour menu remet les boosts run à leur état persistant
  resetCallouts();                                             // vide kill-feed + callouts résiduels (sinon persistent dans le lobby)
  for(const id of ['hud','combat','wave-hud','money-hud','healthbar','crosshair','radar','pickup-prompt','combo-hud','boss-hud','grenade-hud','flashbang-hud','power-hud','dash-hud','xp-hud','mine-hud','firemode-hud','shield-bar','smoke-hud','streak-hud','semiauto-hud','enemy-count-hud','overheat-hud','wave-countdown','stamina-hud','hardcore-hud','flank-hud','adrenaline-hud','ls-turret-hud','ls-mine-hud','ls-airstrike-hud','ls-carepackage-hud','ls-dog-hud','pet-hp-bar','training-hud','medkit-hud'])
    document.getElementById(id).classList.add('hidden');
  trainingActive_ = false; infiniteAmmo_ = false;   // #158 : quitter l'entrainement desactive munitions infinies
  clearEnemies(); clearTargets();
  const ehb = document.getElementById('enemy-hp-bars'); if(ehb) ehb.innerHTML = '';   // purge le pool de barres HP (la boucle qui le resynchronise ne tourne plus au lobby)
  lobbyFeatures();   // hooks onLobby() des features enregistrées (registre étape 4)
  setView('third');                                            // bug d'affichage : si on quittait en 1re personne, le viewmodel FPS restait visible dans le lobby
  if(viewModel) viewModel.visible = false;                     // garantie : pas de mains/arme FPS sur la page d'accueil
  if(armsVM) armsVM.visible = false;                           // idem pour les avant-bras bas-poly (mesh distinct de viewModel, meme bug — updateWeapon ne tourne plus au lobby donc sa visibilite n'etait jamais retombee)
  document.getElementById('scope-overlay')?.classList.remove('show'); // pas de viseur sniper résiduel sur l'accueil (#61)
  if(document.pointerLockElement) document.exitPointerLock?.();
  G.phase = 'lobby';
  document.getElementById('lobby').classList.remove('hidden');
  updateShopScene();   // retour vitrine lobby : canvas transparent + décor masqué
  updateHomeMeta(); setLobbyCamera();
  if(characters[lobbyIndex]) previewCharacter(lobbyIndex);
}
document.getElementById('go-menu').addEventListener('click', backToHome);
G.debug.backToHome = () => backToHome();

// ====== Ennemis / IA ======
const ENEMY_COUNT = 3, DETECT_RADIUS = 12, LOSE_RADIUS = DETECT_RADIUS*1.5, LOSE_TIME = 3.0,
      ENEMY_WALK = 1.8, ENEMY_RUN = 4.0, ENEMY_HP = 100,
      ENEMY_R = 0.45, ENEMY_FLASH = 0.08, ENEMY_TURN = 8,
      SHOOT_RANGE = 9, ENEMY_FIRE_CD = 1.3, ENEMY_ACCURACY = 0.55, ENEMY_DAMAGE = 10;
// anti-blocage mur : sonde périodique du déplacement réel pendant une poursuite, pour détecter un
// ennemi plaqué contre un obstacle (trajectoire directe vers la cible bloquée par un mur/canal/bâtiment)
const STUCK_CHECK_S = 0.35, STUCK_EPS = 0.12, STUCK_NUDGE_S = 0.7;
const MAX_PER_WAVE = 7, WAVE_INTERMISSION = 2.5, BOSS_BONUS = 300;   // #31 : bonus à la mort d'un boss
// ====== Types d'ennemis (#11) : rusher (mêlée rapide), shooter (tireur rafale), tank (lourd) ======
// Table unique par type (étape 5) : stats + arme portée/lootable (#23) + couleur radar (#21) + armure (#114/#131).
const ENEMY_TYPES = {
  shooter: { id:'shooter', hpMult:1.0, speedMult:1.0,  scale:1.0,  melee:false, damageMult:1.0, burst:3, glow:null,     weapon:'default', radarColor:'#ffb84d' },
  rusher:  { id:'rusher',  hpMult:0.6, speedMult:1.75, scale:0.9,  melee:true,  damageMult:1.0, burst:1, glow:0x6b1414, weapon:'smg',     radarColor:'#ff5b5b' },
  tank:    { id:'tank',    hpMult:2.6, speedMult:0.55, scale:1.34, melee:false, damageMult:1.8, burst:2, glow:0x3a1250, weapon:'sniper',  radarColor:'#c07bff', armor:'torso' },
  boss:      { id:'boss',      hpMult:8.0, speedMult:0.7,  scale:1.9,  melee:false, damageMult:2.2, burst:3, glow:0xff5a1e, weapon:'sniper', armor:'torso' },   // #31
  bomber:    { id:'bomber',    hpMult:0.5, speedMult:1.9,  scale:0.95, melee:true,  damageMult:1.0, burst:1, glow:0xff1e1e, weapon:'smg' },   // #37 kamikaze
  berserker: { id:'berserker', hpMult:1.5, speedMult:1.8,  scale:1.05, melee:true,  damageMult:2.0, burst:1, glow:0xcc4400 },   // #104 rage
  sniper:    { id:'sniper',   hpMult:0.8, speedMult:0.5,  scale:1.0,  melee:false, damageMult:2.5, burst:1, glow:0xcc0033, shootCd:4.0, shootRange:28 }, // #111 sniper (engage de loin, pas à 9m comme les autres)
  shielder:  { id:'shielder', hpMult:1.2, speedMult:0.7,  scale:1.0,  melee:false, damageMult:1.0, burst:2, glow:0x00aacc },         // #119 bouclier frontal
  medic:     { id:'medic',    hpMult:0.7, speedMult:0.8,  scale:0.95, melee:false, damageMult:0.8, burst:1, glow:0x00cc55 },         // #120 guérisseur
  stunner:   { id:'stunner',  hpMult:0.9, speedMult:1.1,  scale:1.0,  melee:false, damageMult:0.7, burst:2, glow:0xffdd00 },         // #121 éclaire/ralentit le joueur
  grenadier: { id:'grenadier',hpMult:1.2, speedMult:0.7,  scale:1.05, melee:false, damageMult:0.8, burst:1, glow:0xaaff00 },         // #128 lance des grenades
  juggernaut:{ id:'juggernaut',hpMult:5.0, speedMult:0.45, scale:1.5, melee:true,  damageMult:2.2, burst:1, glow:0x888899, armor:'full' },   // #131 élite blindé, armure intégrale, vague 10+
  toxic:     { id:'toxic',    hpMult:0.9, speedMult:0.9,  scale:1.0,  melee:false, damageMult:0.9, burst:2, glow:0x33cc33 },         // #141 nuage de poison à la mort
  cryo:      { id:'cryo',     hpMult:0.9, speedMult:0.9,  scale:1.0,  melee:false, damageMult:0.8, burst:2, glow:0x66ccff },         // #146 zone de gel à la mort
  commander: { id:'commander',hpMult:1.3, speedMult:0.8,  scale:1.1,  melee:false, damageMult:1.0, burst:2, glow:0xffaa00 },         // #151 aura : buffe les dégâts alliés
};
const ENEMY_BURST_GAP = 0.12, MELEE_RANGE = 2.2, MELEE_DAMAGE = 14, MELEE_CD = 0.9;
// arme tenue par type d'ennemi (#23) : sert au mesh ET au loot ramassable — champ `weapon` de ENEMY_TYPES
function weaponIdForType(type){ return (ENEMY_TYPES[type] && ENEMY_TYPES[type].weapon) || 'default'; }
function meshMaxZ(obj){ obj.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(obj); return isFinite(b.max.z) ? b.max.z : 0.45; }
// courbes de progression des vagues (pures) : nombre + PV croissants, plafonnés
function isBossWave(w){ return w > 0 && w % 5 === 0; }                          // #31 : boss tous les 5 niveaux
function enemiesForWave(w){ return isBossWave(w) ? 3 : Math.min(2 + w, MAX_PER_WAVE); }
function enemyHpForWave(w){ return Math.round(ENEMY_HP * Math.pow(1.18, w-1) * curDiff().hp); }   // +18%/vague (exponentiel)
// composition d'une vague (pure) : boss tous les 5 niveaux ; sinon shooter[0], rusher dès v2, tank dès v3
function waveComposition(w){
  if(isBossWave(w)) return ['boss', 'shooter', 'shooter'];                      // boss + 2 sbires (#31)
  const n = enemiesForWave(w), out = [];
  for(let i=0;i<n;i++){
    if(w>=10 && i%4===3) out.push('juggernaut');                                   // v10+ : élite blindé remplace le tank (#131)
    else if(w>=3 && i%4===3) out.push('tank');
    else if(w>=7 && i%6===5) out.push(w%2===0 ? 'cryo' : 'stunner');            // v7+ : alternance cryo (pair) / stunner (impair) (#146/#121)
    else if(w>=8 && i%7===6) out.push(w%2===0 ? 'grenadier' : 'sniper');        // v8+ : alternance grenadier (pair) / sniper (impair) par parité (#128/#111)
    else if(w>=5 && i%7===6) out.push('sniper');                                // sniper v5-7 (#111)
    else if(w>=9 && i%5===4) out.push(w%2===0 ? 'commander' : 'berserker');     // v9+ : alternance commandant (pair) / berserker (impair) (#151/#104)
    else if(w>=6 && i%5===4) out.push('berserker');                             // berserker dès la v6 (#104)
    else if(w>=4 && w<6 && i%5===4) out.push('shielder');                      // shielder v4-5 (slot %5===4 avant berserker) (#119)
    else if(w>=6 && i%3===2) out.push(w%2===0 ? 'toxic' : 'bomber');           // v6+ : alternance toxique (pair) / kamikaze (impair) (#141/#37)
    else if(w>=4 && i%3===2) out.push('bomber');                                // kamikaze dès la v4 (#37)
    else if(w>=6 && i%6===1) out.push('medic');                                 // medic dès la v6, i=1 (#120)
    else if(w>=2 && i%2===1) out.push('rusher');
    else out.push('shooter');
  }
  out[0] = 'shooter';
  return out;
}
G.debug.enemiesForWave = enemiesForWave;
G.debug.enemyHpForWave = enemyHpForWave;
G.debug.waveComposition = waveComposition;
G.debug.isBossWave = isBossWave;
// ====== #140 Ennemi VIP (cible à haute valeur) ======
const VIP_MULT = 2, VIP_MIN_WAVE = 3;
function maybeMarkVip(w){
  if(w < VIP_MIN_WAVE || isBossWave(w)) return;
  const candidates = enemies.filter(e => e.alive && e.type !== 'boss');
  if(!candidates.length) return;
  const e = candidates[Math.floor(Math.random()*candidates.length)];
  e.isVip = true;
  for(const m of e.mats){ m.base.setHex(0xffd700); m.mat.emissive.copy(m.base); }
}
G.debug.enemyIsVip = (i) => { const e = enemies[i]; return !!(e && e.isVip); };
G.debug.forceVip = (i) => { const e = enemies[i]; if(!e) return;
  e.isVip = true; for(const m of e.mats){ m.base.setHex(0xffd700); m.mat.emissive.copy(m.base); } };
let enemyAccOverride = null;                   // pour les tests (précision forcée)
const ENEMY_FOOT_Y = 0;                       // pieds au sol (modèle ennemi centré dans un groupe)
const FLASH_COLOR = new THREE.Color(0xff2222);
const enemies = [];      // { id, root, mixer, actions, hitbox, mats, hp, state, alive, loco, target, lostFor, respawnAt, flashUntil }
let enemyBase = null;    // groupe centré à cloner
let enemyClips = null;   // { idle, walk, run, attack } (AnimationClip retargetés pour le rig ennemi)
// ====== Vagues (mode survie) ======
let wave = 0, waveState = 'active', nextWaveAt = 0, bestWave = save.bestWave;   // record persistant (localStorage, tranche 12)
// #126 wave score multiplier
let lastKillScore_ = 0;
function waveScoreMult_(){ return 1 + Math.floor(wave / 5) * 0.5; }
G.debug.waveScoreMult = () => waveScoreMult_();
G.debug.lastKillScore = () => lastKillScore_;
G.wave = 0; G.bestWave = bestWave;

// décision d'état pure (seuils) — testée isolément
function enemyDecision(dist, state){
  if(dist <= SHOOT_RANGE) return 'shoot';
  if(dist <= DETECT_RADIUS) return 'chase';
  return 'patrol';
}
G.debug.enemyDecision = enemyDecision;

// ligne de vue : le segment (ax,az)->(bx,bz) est-il dégagé d'obstacles ? (Liang-Barsky 2D)
function segHitsAABB(ax, az, bx, bz, b){
  const dx = bx - ax, dz = bz - az; let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dz, dz], q = [ax - b.minX, b.maxX - ax, az - b.minZ, b.maxZ - az];
  for(let i = 0; i < 4; i++){
    if(p[i] === 0){ if(q[i] < 0) return false; }
    else { const r = q[i] / p[i];
      if(p[i] < 0){ if(r > t1) return false; if(r > t0) t0 = r; }
      else { if(r < t0) return false; if(r < t1) t1 = r; } }
  }
  return true;
}
function hasLineOfSight(ax, az, bx, bz){
  for(const b of obstacles) if(segHitsAABB(ax, az, bx, bz, b)) return false;
  return true;
}
// ====== IA #11 : contournement (flank) + mise à couvert (peek) — helpers purs ======
// point d'approche décalé perpendiculairement à la ligne ennemi->joueur (contournement)
function flankTarget(px, pz, ex, ez, side){
  const dx=px-ex, dz=pz-ez, len=Math.hypot(dx,dz)||1, perpx=-dz/len, perpz=dx/len;
  const off = Math.min(4, len*0.5) * (side||1);
  return { x: px + perpx*off, z: pz + perpz*off };
}
function segClear(ax, az, bx, bz, obs){ for(const b of obs) if(segHitsAABB(ax, az, bx, bz, b)) return false; return true; }
// si la vue directe est coupée, renvoie un point latéral qui dégage la ligne de tir (mise à couvert / peek)
function peekTarget(ex, ez, px, pz, obs){
  if(segClear(ex,ez,px,pz,obs)) return { x:ex, z:ez };
  const dx=px-ex, dz=pz-ez, len=Math.hypot(dx,dz)||1, perpx=-dz/len, perpz=dx/len;
  for(const off of [2,-2,4,-4,6,-6]){ const tx=ex+perpx*off, tz=ez+perpz*off; if(segClear(tx,tz,px,pz,obs)) return { x:tx, z:tz }; }
  return { x:px, z:pz };
}
Object.assign(G.debug, { flankTarget, segClear, peekTarget });
// ====== Mini-carte / radar (#21) : blips ennemis autour du joueur, orientés regard ======
const RADAR_RANGE = 28, RADAR_R = 70;
// couleurs radar : champ `radarColor` de ENEMY_TYPES (fallback rouge)
function currentRadarRange(){ return activePower === 'radar_boost' ? RADAR_RANGE * 2 : RADAR_RANGE; }   // #179
// projection pure monde->radar : "haut" = direction face caméra (mêmes axes que la caméra)
function radarBlip(ex, ez, px, pz, yaw, range, radius){
  const dx=ex-px, dz=ez-pz;
  const right = dx*Math.cos(yaw) - dz*Math.sin(yaw);
  const up    = dx*Math.sin(yaw) + dz*Math.cos(yaw);
  const dist = Math.hypot(dx,dz), s = radius/range;
  let bx = right*s, by = up*s; const inRange = dist <= range;
  if(!inRange){ const l = Math.hypot(bx,by)||1; bx = bx/l*radius; by = by/l*radius; }   // clampé au bord
  return { x:bx, y:by, inRange, dist };
}
let radarCtx = null;
function updateRadar(){
  const cv = document.getElementById('radar'); if(!cv || !model) return;
  if(!radarCtx) radarCtx = cv.getContext('2d');
  const rr = currentRadarRange();   // #179 : portee effective (double en radar_boost)
  const ctx = radarCtx, C = cv.width/2, s = RADAR_R/rr;
  const px=model.position.x, pz=model.position.z, cy=camYaw, cos=Math.cos(cy), sin=Math.sin(cy);
  ctx.clearRect(0,0,cv.width,cv.height);
  // anneau + croix
  ctx.strokeStyle='rgba(150,160,175,.30)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.arc(C,C,RADAR_R,0,Math.PI*2); ctx.stroke();
  ctx.strokeStyle='rgba(150,160,175,.13)';
  ctx.beginPath(); ctx.moveTo(C,C-RADAR_R); ctx.lineTo(C,C+RADAR_R); ctx.moveTo(C-RADAR_R,C); ctx.lineTo(C+RADAR_R,C); ctx.stroke();
  // contenu clippé au disque
  ctx.save(); ctx.beginPath(); ctx.arc(C,C,RADAR_R,0,Math.PI*2); ctx.clip();
  // minimap du niveau : obstacles proches (quads gris, orientés regard)
  const toRadar = (wx,wz) => { const dx=wx-px, dz=wz-pz; return [C + (dx*cos - dz*sin)*s, C - (dx*sin + dz*cos)*s]; };
  ctx.fillStyle='rgba(150,170,210,.16)';
  for(const b of obstacles){
    const ocx=(b.minX+b.maxX)/2, ocz=(b.minZ+b.maxZ)/2;
    if(Math.hypot(ocx-px,ocz-pz) > rr + Math.max(b.maxX-b.minX, b.maxZ-b.minZ)) continue;
    const c1=toRadar(b.minX,b.minZ), c2=toRadar(b.maxX,b.minZ), c3=toRadar(b.maxX,b.maxZ), c4=toRadar(b.minX,b.maxZ);
    ctx.beginPath(); ctx.moveTo(c1[0],c1[1]); ctx.lineTo(c2[0],c2[1]); ctx.lineTo(c3[0],c3[1]); ctx.lineTo(c4[0],c4[1]); ctx.closePath(); ctx.fill();
  }
  // ennemis (couleur par type, clamp au bord si hors portée)
  for(const e of enemies){ if(!e.alive) continue;
    const b = radarBlip(e.root.position.x, e.root.position.z, px, pz, cy, rr, RADAR_R);
    ctx.globalAlpha = b.inRange ? 1 : 0.5; ctx.fillStyle = (ENEMY_TYPES[e.type] && ENEMY_TYPES[e.type].radarColor) || '#ff5b5b';
    ctx.beginPath(); ctx.arc(C + b.x, C - b.y, b.inRange ? 4 : 3, 0, Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1; ctx.restore();
  // joueur : triangle vert pointant vers le haut (direction du regard)
  ctx.fillStyle='#7dff9e'; ctx.beginPath(); ctx.moveTo(C,C-6); ctx.lineTo(C-4,C+5); ctx.lineTo(C+4,C+5); ctx.closePath(); ctx.fill();
}
G.debug.radarBlip = radarBlip;
G.debug.radar = {
  blips(){ if(!model) return []; const px=model.position.x, pz=model.position.z, out=[];
    for(const e of enemies){ if(!e.alive) continue; const b=radarBlip(e.root.position.x,e.root.position.z,px,pz,camYaw,currentRadarRange(),RADAR_R);
      out.push({ id:e.id, x:b.x, y:b.y, inRange:b.inRange, type:e.type }); } return out; },
  range(){ return currentRadarRange(); },
  visible(){ const cv=document.getElementById('radar'); return !!cv && !cv.classList.contains('hidden'); },
};
// (getters debug radar_boost/second_wind_refill/loot_master/ricochet_boost/nova_blast : générés via POWER_DEBUG)
function enemyTryShoot(e, dt){
  e.shootCd = (e.shootCd || 0) - dt;
  if(e.shootCd > 0) return;
  if(enemySuppressed(e)) return;  // suppressed (#116)
  if(e.empUntil && nowS() < e.empUntil) return;  // EMP : tir désactivé (#136)
  let from;
  if(e.muzzle){ e.muzzle.updateMatrixWorld(true); from = e.muzzle.getWorldPosition(new THREE.Vector3()); }
  else from = new THREE.Vector3(e.root.position.x, e.root.position.y + 1.4, e.root.position.z);
  const to   = new THREE.Vector3(model.position.x, model.position.y + 1.4, model.position.z);
  spawnTracer(from, to); playSound('enemyShot');                    // traceur (depuis le canon) + son
  if(e.muzzleFlash){ e.muzzleFlash.visible = true; e.muzzleFlashUntil = nowS() + 0.05; }   // flash de bouche bref
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  const smokeAcc = enemyInSmoke(enemies.indexOf(e)) ? SMOKE_ACC : 1;
  const acc = enemyAccOverride != null ? enemyAccOverride
            : ENEMY_ACCURACY * Math.max(0.4, Math.min(1, 1 - dist / SHOOT_RANGE * 0.4)) * smokeAcc;
  if(Math.random() < acc){ damagePlayer(Math.round(ENEMY_DAMAGE * (e.spec ? e.spec.damageMult : 1) * commanderAliveMult())); damageDirFromEnemy(e); if(e.type==='stunner') applyStun(); } // dir indicator (#63) stun (#121) commandant (#151)
  else { // tir manqué → étincelles sur le sol/mur entre ennemi et joueur (#73)
    const pp=G.position(), ex=e.root.position.x, ez=e.root.position.z;
    const t=0.5+Math.random()*0.4;
    spawnImpactSparks(ex+(pp.x-ex)*t, 0.05, ez+(pp.z-ez)*t);
  }
  // rafale (#11) : enchaîne spec.burst cartouches espacées, puis longue pause
  e.burstLeft = (e.burstLeft || 1) - 1;
  if(e.burstLeft > 0) e.shootCd = ENEMY_BURST_GAP;
  else { e.burstLeft = (e.spec && e.spec.burst) || 1; e.shootCd = (e.spec && e.spec.shootCd) || ENEMY_FIRE_CD; }
}
// mêlée (#11) : le rusher frappe au contact, sur cooldown
function enemyMeleeAttack(e, dt){
  e.meleeCd = (e.meleeCd || 0) - dt;
  const dist = Math.hypot(model.position.x - e.root.position.x, model.position.z - e.root.position.z);
  if(e.meleeCd > 0 || dist > MELEE_RANGE) return;
  if(e.type === 'bomber'){ killEnemy(e); return; }             // bomber : explose au contact (#37)
  e.meleeCd = MELEE_CD;
  damagePlayer(Math.round(MELEE_DAMAGE * (e.spec ? e.spec.damageMult : 1) * commanderAliveMult()));
}
function commanderAliveMult(){ return enemies.some(e => e.alive && e.type === 'commander') ? 1.2 : 1; }   // #151
G.debug.enemyIsCommander = (i) => { const e = enemies[i]; return !!e && e.type==='commander'; };
G.debug.commanderAliveMult = () => commanderAliveMult();
G.debug.hasLineOfSight = (ax, az, bx, bz) => hasLineOfSight(ax, az, bx, bz);
G.debug.setEnemyAccuracy = (a) => { enemyAccOverride = a; };
G.debug.forceEnemyShoot = (i) => { const e = enemies[i]; if(e){ e.shootCd = 0; enemyTryShoot(e, 0); } };
G.debug.enemyType = (i) => enemies[i]?.type;
G.debug.enemyBurstSize = (i) => enemies[i]?.spec?.burst;
G.debug.forceEnemyBurst = (i) => { const e = enemies[i]; if(!e || !e.spec) return 0;
  const start = tracers.length; e.burstLeft = e.spec.burst;
  for(let k=0;k<e.spec.burst;k++){ e.shootCd = 0; enemyTryShoot(e, 0); }   // salve complète d'un coup (test)
  return tracers.length - start; };
G.debug.spawnEnemyTypeAt = (i, type, x, z) => {
  const e = enemies[i]; if(!e) return null;
  const spec = ENEMY_TYPES[type] || ENEMY_TYPES.shooter;
  e.type = spec.id; e.spec = spec; e.burstLeft = spec.burst || 1; e.meleeCd = 0; e.weaponId = weaponIdForType(spec.id);  // type invalide (ex. 'ghost' supprimé) → vrai type du spec (shooter)
  e.hp = Math.round(enemyHpForWave(wave || 1) * spec.hpMult); e.maxHp = e.hp;
  e.alive = true; e.state = 'patrol'; e.loco = 'idle'; e.lostFor = 0; e.target = null;
  e.root.position.set(x, ENEMY_FOOT_Y + groundHeight(x, z), z); e.root.rotation.set(0, 0, 0);   // #204
  e.hitbox.position.set(x, ENEMY_FOOT_Y + groundHeight(x, z) + (e.hbY || 0.9), z); e.hitbox.updateMatrixWorld();
  // réapplique l'apparence du type (#107 ghost translucide + glow coloré) — sinon un type changé via debug garderait l'apparence d'origine
  if(spec.glow != null){ for(const m of (e.mats||[])){ m.mat.emissive.setHex(spec.glow); m.base = m.mat.emissive.clone(); } }
  if(spec.opacity != null){ e.root.traverse(o => { if(o.isMesh){ const mm = Array.isArray(o.material)?o.material:[o.material]; mm.forEach(mat => { mat.transparent = true; mat.opacity = spec.opacity; }); } }); }
  // Sync shield mesh (#119)
  if(type === 'shielder' && !e.shieldMesh){ e.shieldMesh = buildEnemyShieldMesh(); e.root.add(e.shieldMesh); }
  if(type !== 'shielder' && e.shieldMesh){ e.shieldMesh.visible = false; }
  if(type === 'shielder' && e.shieldMesh) e.shieldMesh.visible = true;
  return e.id;
};
G.debug.enemyHasWeapon = (i) => !!(enemies[i] && enemies[i].weapon);
G.debug.enemyWeaponId = (i) => enemies[i]?.weaponId;
G.debug.enemyMuzzle = (i) => { const e = enemies[i]; if(!e || !e.muzzle) return null;
  const v = e.muzzle.getWorldPosition(new THREE.Vector3()); return { x:v.x, y:v.y, z:v.z }; };
G.debug.enemyMuzzleFlash = (i) => !!(enemies[i] && enemies[i].muzzleFlash && enemies[i].muzzleFlash.visible);
G.debug.tracerCount = () => tracers.length;
G.debug.lastTracerStart = () => { const tr = tracers[tracers.length-1]; if(!tr) return null;
  const p = tr.line.geometry.attributes.position; return { x:p.getX(0), y:p.getY(0), z:p.getZ(0) }; };

// dégâts localisés : zone d'impact selon la hauteur relative aux pieds de l'ennemi
// ennemi 100 PV (= joueur) : tête = 2 balles, torse = 4, jambes = ~7 (bots plus coriaces)
const HEAD_Y = 1.5, LEGS_Y = 0.6, DMG_HEAD = 60, DMG_TORSO = 25, DMG_LEGS = 15;
function hitZoneDamage(relY){
  if(relY >= HEAD_Y) return { zone:'head', damage:DMG_HEAD };
  if(relY <= LEGS_Y) return { zone:'legs', damage:DMG_LEGS };
  return { zone:'torso', damage:DMG_TORSO };
}
G.debug.hitZoneDamage = hitZoneDamage;

function makeHitbox(scale = 1){
  const hb = new THREE.Mesh(
    new THREE.CylinderGeometry(ENEMY_R*scale, ENEMY_R*scale, 1.8*scale, 8),   // couvre tout le corps (mis à l'échelle du type)
    new THREE.MeshBasicMaterial({ visible:false }));        // non rendu mais raycastable (mesh.visible reste true)
  hb.position.set(0, ENEMY_FOOT_Y + 0.9*scale, 0); scene.add(hb); hb.updateMatrixWorld();
  return hb;
}
function randomSpawn(){
  // anneau autour du joueur, AU-DELÀ du rayon de détection (apparition en patrouille, pas d'aggro instantané)
  // #48 : réessayer jusqu'à 10 fois pour éviter de spawner à l'intérieur d'un obstacle
  const px = model ? model.position.x : 0, pz = model ? model.position.z : 0;
  let best = null, horsObstacle = null;
  for(let attempt = 0; attempt < 12; attempt++){
    const a = Math.random()*Math.PI*2, r = DETECT_RADIUS + 3 + Math.random()*6;
    const x = Math.max(MAP_BOUNDS.minX*0.97, Math.min(MAP_BOUNDS.maxX*0.97, px + Math.cos(a)*r));   // #205 : bornes par map
    const z = Math.max(MAP_BOUNDS.minZ*0.97, Math.min(MAP_BOUNDS.maxZ*0.97, pz + Math.sin(a)*r));
    if(!best) best = { x, z };
    if(pointInObstacle(x, z)) continue;
    if(!inNoSpawnZone(x, z)) return { x, z };            // idéal : ni obstacle, ni intérieur de bâtiment (#203)
    if(!horsObstacle) horsObstacle = { x, z };           // repli : hors obstacle mais en zone interdite
  }
  return horsObstacle || best;
}
function rigHeightOf(obj){
  obj.updateMatrixWorld(true);
  let lo = Infinity, hi = -Infinity; const v = new THREE.Vector3();
  obj.traverse(o => { if(o.isBone){ o.getWorldPosition(v); lo = Math.min(lo, v.y); hi = Math.max(hi, v.y); } });
  return { lo, hi, h:(hi - lo) || 1 };
}
let enemyLabel = '';
async function buildEnemyAssets(playerChar){
  // ennemi = perso "enemie" en priorité ; sinon un perso différent du joueur
  const pick = allCharacters.find(c => /enem/i.test(c.label)) || allCharacters.find(c => c.id !== playerChar.id) || playerChar;
  enemyLabel = pick.label;
  const url = URL.createObjectURL(new Blob([pick.bytes]));
  const gltf = await loader.loadAsync(url); URL.revokeObjectURL(url);
  const inner = gltf.scene;
  inner.traverse(o => { if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
  // ÉCHELLE basée sur le SQUELETTE (la bbox géométrique sous-estime certains modèles skinnés -> géant).
  // Cible = la taille réelle du joueur, pour qu'ils fassent la même taille.
  const targetH = model ? rigHeightOf(model).h : 1.7;
  inner.scale.setScalar(targetH / rigHeightOf(inner).h);
  // poser les pieds (os le plus bas) au sol, bassin centré en X/Z
  inner.updateMatrixWorld(true);
  let lo = Infinity, hips = null; const v = new THREE.Vector3();
  inner.traverse(o => { if(o.isBone){ o.getWorldPosition(v); lo = Math.min(lo, v.y); if(o.name===ROOT_BONE) hips = v.clone(); } });
  if(hips){ inner.position.x -= hips.x; inner.position.z -= hips.z; }
  inner.position.y -= lo;
  const wrapper = new THREE.Group(); wrapper.add(inner);
  enemyBase = wrapper;
  // retarget des 4 rôles contre le rig ennemi (swap temporaire des globals cible)
  const sr = targetRest, srw = targetRestWorld, so = targetBoneOrder;
  targetRest = captureRest(inner); targetRestWorld = captureRestWorld(inner); targetBoneOrder = boneOrder(inner);
  enemyClips = { idle:retargetRole('idle'), walk:retargetRole('walk'), run:retargetRole('run'), attack:retargetRole('attack'), dead:retargetRole('dead') };
  targetRest = sr; targetRestWorld = srw; targetBoneOrder = so;
}
function clearEnemies(){ for(const e of enemies){ scene.remove(e.root); scene.remove(e.hitbox); } enemies.length = 0; clearHealthPacks(); clearAmmoPacks(); clearGrenades(); clearFlashbangs(); clearSmokes(); clearSpawnMarkers(); clearImpactSparks(); clearMoneyOrbs(); clearShockwaves(); clearPowerUps(); clearBarrels(); clearMines(); clearSticky(); clearEnemyGrenades(); clearMolotovs(); clearTurret(); clearEmp(); clearPoisonZones(); clearCarePackage(); clearFrostZones(); }
function createEnemies(count = ENEMY_COUNT, hp = ENEMY_HP, comp = null){
  clearEnemies();
  for(let i=0;i<count;i++){
    const type = (comp && comp[i]) || 'shooter';
    const spec = ENEMY_TYPES[type] || ENEMY_TYPES.shooter;
    const root = cloneSkeleton(enemyBase);
    if(spec.scale !== 1) root.scale.multiplyScalar(spec.scale);     // tank plus grand, rusher plus petit
    const mats = [];
    // matériaux clonés par ennemi (flash indépendant) ; halo emissif coloré = lecture du type
    root.traverse(o => { if(o.isMesh){
      o.castShadow=true; o.receiveShadow=true;
      const cloneMat = m => { const c = m.clone();
        if(spec.opacity != null){ c.transparent=true; c.opacity=spec.opacity; }
        if(c.emissive){ if(spec.glow != null) c.emissive.setHex(spec.glow); mats.push({ mat:c, base:c.emissive.clone() }); }
        return c; };
      o.material = Array.isArray(o.material) ? o.material.map(cloneMat) : cloneMat(o.material);
    } });
    const mixer = new THREE.AnimationMixer(root);
    const actions = {};
    for(const k of ['idle','walk','run','attack','dead']) if(enemyClips[k]) actions[k] = mixer.clipAction(enemyClips[k]);
    const hbY = 0.9 * spec.scale;
    const hitbox = makeHitbox(spec.scale);
    const sp = randomSpawn(); const sgy = ENEMY_FOOT_Y + groundHeight(sp.x, sp.z);   // #204
    root.position.set(sp.x, sgy, sp.z);
    showSpawnMarker(sp.x, sp.z); // marqueur visuel (#70)
    hitbox.position.set(sp.x, sgy + hbY, sp.z); hitbox.updateMatrixWorld(); // prêt au raycast dès la 1re frame
    const ehp = Math.round(hp * spec.hpMult);
    const e = { id:i, type, spec, root, mixer, actions, hitbox, mats, hp:ehp, maxHp:ehp, hbY, state:'patrol', alive:true,
                loco:'idle', target:null, lostFor:0, flashUntil:0, weaponId:weaponIdForType(type), looted:false,
                burstLeft:spec.burst || 1, flankSide:(i%2===0)?1:-1, meleeCd:0, spawnedAt:nowS(), calledReinforcement:false, pickedUpWeapon:false };
    actions.idle?.play();
    attachWeaponToEnemy(e);                       // no-op si le template n'est pas encore prêt
    if(spec.opacity != null && e.weapon){         // ghost (#107) : l'arme aussi doit être translucide (sinon arme opaque flottante)
      e.weapon.traverse(o => { if(o.isMesh){ const mm = Array.isArray(o.material) ? o.material : [o.material];
        mm.forEach(m => { m.transparent = true; m.opacity = spec.opacity; }); } });
    }
    if(type === 'shielder'){ e.shieldMesh = buildEnemyShieldMesh(); root.add(e.shieldMesh); } // #119
    scene.add(root); enemies.push(e);
  }
}
function updateEnemies(dt){
  if(G.phase!=='playing' || !model) return;
  const px = model.position.x, pz = model.position.z;
  for(const e of enemies){
    if(e.isDecoy) continue; // géré par updateDecoys (#124)
    if(e.state === 'dead'){
      if(!e.frozenPose){
        e.mixer.update(dt);
        const da = e.actions.dead;
        const animDone = da && (da.paused || (da.time > 0 && da.time >= da.getClip().duration - 0.05));
        if(animDone || !da){
          // Capture pose BEFORE stopAllAction so we freeze the last anim frame, not T-pose
          const pose = [];
          e.root.traverse(o => { if(o.isBone) pose.push({ bone:o, p:o.position.clone(), q:o.quaternion.clone() }); });
          e.frozenPose = pose;
          e.mixer.stopAllAction();
        }
      } else {
        for(const fp of e.frozenPose){ fp.bone.position.copy(fp.p); fp.bone.quaternion.copy(fp.q); }
      }
      e.root.updateMatrixWorld(true);
      let lo = Infinity; const bp = new THREE.Vector3();
      e.root.traverse(o => { if(o.isBone){ o.getWorldPosition(bp); if(bp.y < lo) lo = bp.y; } });
      if(isFinite(lo)) e.root.position.y += (ENEMY_FOOT_Y + groundHeight(e.root.position.x, e.root.position.z) + 0.05 - lo);   // #204 : cadavre posé sur le sol local (fosse comprise)
      continue;
    }
    if(e.frenzyVisualOn && nowS() >= e.frenzyUntil) endFrenzyVisual(e); // #129 : fin du frenzy → couleur/glow normaux restaurés (plus de rouge bloqué)
    if(e.flashedUntil && nowS() < e.flashedUntil){ e.mixer.update(dt); setEnemyLoco(e,'idle'); continue; } // aveuglé (#57)
    if(!e.calledReinforcement && (e.type==='shooter'||e.type==='tank') && nowS()-e.spawnedAt >= REINFORCE_DELAY) callReinforcement(e); // renforts (#84)
    if(!e.isDecoy && !e.spawnedDecoy && e.type==='shooter' && wave>=DECOY_WAVE_MIN && nowS()-e.spawnedAt>=DECOY_SPAWN_INTERVAL){ e.spawnedDecoy=true; spawnDecoyNear(e); } // décoy (#124)
    if(e.type==='grenadier' && e.state!=='dead' && (!e.grenadeThrowAt || nowS() >= e.grenadeThrowAt)){ enemyThrowGrenade(e); } // grenadier (#128)
    if(!e.pickedUpWeapon && e.type==='rusher') enemyTryPickup(e); // pickup arme (#85)
    const dx = px - e.root.position.x, dz = pz - e.root.position.z;
    const dist = Math.hypot(dx, dz);
    const los = hasLineOfSight(e.root.position.x, e.root.position.z, px, pz);
    const spec = e.spec || ENEMY_TYPES.shooter, ex = e.root.position.x, ez = e.root.position.z;
    let desired = 'idle';
    if(spec.melee){
      // RUSHER : poursuite agressive avec contournement, frappe au contact
      if(e.state === 'melee'){ if(dist > MELEE_RANGE*1.4) e.state = 'chase'; }
      else if(e.state === 'chase'){
        if(dist <= MELEE_RANGE) e.state = 'melee';
        else if(dist > LOSE_RADIUS){ e.lostFor += dt; if(e.lostFor >= LOSE_TIME){ e.state = 'patrol'; e.lostFor = 0; pickPatrol(e); } }
        else e.lostFor = 0;
      } else { // patrol
        if(dist <= DETECT_RADIUS){ e.state = 'chase'; e.lostFor = 0; }
      }
      if(e.state === 'chase'){
        let tx = px, tz = pz;
        if(dist > MELEE_RANGE*1.5){ const f = flankTarget(px, pz, ex, ez, e.flankSide); tx = f.x; tz = f.z; }   // contournement
        const fsm = (e.frenzyUntil && nowS()<e.frenzyUntil) ? FRENZY_SPEED : 1; // frenzy (#129)
        moveToward(e, tx, tz, ENEMY_RUN*spec.speedMult*fsm, dt); desired = 'run';
      } else if(e.state === 'melee'){ faceToward(e, px, pz, dt); enemyMeleeAttack(e, dt); desired = 'attack'; }
      else { if(!e.target || Math.hypot(e.target.x - ex, e.target.z - ez) < 0.6) pickPatrol(e);
        moveToward(e, e.target.x, e.target.z, ENEMY_WALK*spec.speedMult, dt); desired = 'walk'; }
    } else {
      // RANGED (shooter/tank/sniper) : transitions à hystérésis + mise à couvert si vue coupée + tir en rafale
      const sr = spec.shootRange || SHOOT_RANGE;            // #111 : portée d'engagement (sniper = 28m)
      const detR = Math.max(DETECT_RADIUS, sr);             // détecte au moins jusqu'à sa portée de tir
      const loseR = Math.max(LOSE_RADIUS, sr*1.3);
      if(e.state === 'cover'){
        if(nowS() >= e.coverUntil){ e.state = 'chase'; }
        else if(e.coverTarget){ moveToward(e, e.coverTarget.x, e.coverTarget.z, ENEMY_RUN*spec.speedMult, dt); desired='run'; }
      } else if(e.state === 'shoot'){
        if(dist > sr*1.25 || !los) e.state = 'chase';
      } else if(e.state === 'chase'){
        if(dist <= sr && los) e.state = 'shoot';
        else if(dist > loseR){ e.lostFor += dt; if(e.lostFor >= LOSE_TIME){ e.state = 'patrol'; e.lostFor = 0; pickPatrol(e); } }
        else e.lostFor = 0;
      } else { // patrol
        if(dist <= detR){ e.state = 'chase'; e.lostFor = 0; }
      }
      if(e.state === 'chase'){
        let tx = px, tz = pz;
        if(!los){ const c = peekTarget(ex, ez, px, pz, obstacles); tx = c.x; tz = c.z; }   // se repositionne autour du couvert
        moveToward(e, tx, tz, ENEMY_RUN*spec.speedMult, dt); desired = 'run';
      } else if(e.state === 'shoot'){ faceToward(e, px, pz, dt); enemyTryShoot(e, dt); desired = 'idle'; }   // tire debout (pas d'anim mêlée)
      else { if(!e.target || Math.hypot(e.target.x - ex, e.target.z - ez) < 0.6) pickPatrol(e);
        moveToward(e, e.target.x, e.target.z, ENEMY_WALK*spec.speedMult, dt); desired = 'walk'; }
    }
    clampEnemy(e);
    // #205 : les ennemis restent dans les bornes de la map (poursuite/flank aux abords du bord)
    e.root.position.x = Math.max(MAP_BOUNDS.minX, Math.min(MAP_BOUNDS.maxX, e.root.position.x));
    e.root.position.z = Math.max(MAP_BOUNDS.minZ, Math.min(MAP_BOUNDS.maxZ, e.root.position.z));
    // #204 : suivi du sol — marche trop haute = mur (revert vers ex/ez de début de frame, la
    // déviation anti-blocage fera longer la paroi) ; montée ≤ STEP_UP_MAX instantanée ;
    // descente lissée à ENEMY_DESCENT_SPEED (pas de gravité ennemie, suffisant pour 1.92 m).
    let egh = ENEMY_FOOT_Y + groundHeight(e.root.position.x, e.root.position.z);
    if(egh - e.root.position.y > STEP_UP_MAX){
      e.root.position.x = ex; e.root.position.z = ez;
      egh = ENEMY_FOOT_Y + groundHeight(ex, ez);
    }
    if(egh >= e.root.position.y) e.root.position.y = egh;
    else e.root.position.y = Math.max(egh, e.root.position.y - ENEMY_DESCENT_SPEED*dt);
    setEnemyLoco(e, desired);
    e.hitbox.position.set(e.root.position.x, e.root.position.y + (e.hbY || 0.9), e.root.position.z);
    e.hitbox.updateMatrixWorld();
    if(e.muzzleFlashUntil && nowS() >= e.muzzleFlashUntil){ if(e.muzzleFlash) e.muzzleFlash.visible = false; e.muzzleFlashUntil = 0; }
    e.mixer.update(dt);
  }
}
G.debug.enemyCount = () => enemies.length;
G.debug.enemyAlive = () => enemies.filter(e=>e.alive).length;
G.debug.enemyState = (i) => enemies[i]?.state;
G.debug.enemyLoco  = (i) => enemies[i]?.loco;
G.debug.enemyBoneSig = (i) => { const e=enemies[i]; if(!e) return null; let s=0,n=0; e.root.traverse(o=>{ if(o.isBone){ s+=o.quaternion.x+o.quaternion.y+o.quaternion.z+o.quaternion.w+o.position.x+o.position.y+o.position.z; n++; } }); return n?+(s.toFixed(4)):null; }; // signature pose : change si l'anim joue
G.debug.enemyAnimDiag = (i) => { const e = enemies[i]; if(!e) return null;
  const da = e.actions.dead;
  return { frozen: !!e.frozenPose, loco: e.loco, state: e.state,
    dead: da ? { time: da.time, paused: da.paused, enabled: da.enabled, weight: da.getEffectiveWeight(), duration: da.getClip().duration } : null,
    actions: Object.entries(e.actions).filter(([k,a]) => !!a).map(([k,a]) => ({ key:k, enabled:a.enabled, weight:+a.getEffectiveWeight().toFixed(3) })) }; };
G.debug.enemyHp    = (i) => enemies[i]?.hp;
G.debug.enemyPos   = (i) => { const e = enemies[i]; return e ? { x:e.root.position.x, y:e.root.position.y, z:e.root.position.z } : null; };
G.debug.enemyLabel  = () => enemyLabel;
G.debug.enemyHasClip = (role) => !!(enemyClips && enemyClips[role]);
G.debug.enemyHeight = () => enemies[0] ? rigHeightOf(enemies[0].root).h : 0;
G.debug.playerHeight = () => model ? rigHeightOf(model).h : 0;

function faceDir(e, vx, vz, dt){
  const target = Math.atan2(vx, vz);
  let a = e.root.rotation.y;
  let diff = ((target - a + Math.PI) % (Math.PI*2)) - Math.PI;
  e.root.rotation.y = a + diff*Math.min(1, dt*ENEMY_TURN);
}
function moveToward(e, tx, tz, spd, dt){
  // anti-blocage mur (#204) : si l'ennemi n'a quasi pas avancé depuis la dernière sonde alors qu'il
  // se déplace, sa trajectoire directe est bloquée par un obstacle (mur/canal/façade) — la simple
  // repousse AABB (clampEnemy) ne fait que le recoller au même point tant que la cible visée reste
  // droit derrière l'obstacle. On dévie alors temporairement à 90° pour longer l'obstacle et le contourner.
  e.stuckT_ = (e.stuckT_ || 0) + dt;
  if(e.stuckT_ >= STUCK_CHECK_S){
    const moved = Math.hypot(e.root.position.x - (e.stuckX_ ?? e.root.position.x), e.root.position.z - (e.stuckZ_ ?? e.root.position.z));
    if(moved < STUCK_EPS) e.unstuckUntil_ = nowS() + STUCK_NUDGE_S;
    e.stuckX_ = e.root.position.x; e.stuckZ_ = e.root.position.z; e.stuckT_ = 0;
  }
  let dx = tx - e.root.position.x, dz = tz - e.root.position.z;
  if(e.unstuckUntil_ && nowS() < e.unstuckUntil_){
    const side = e.flankSide || 1;
    const perpX = -dz, perpZ = dx;   // perpendiculaire à la direction visée (longe l'obstacle)
    dx += perpX * side; dz += perpZ * side;
  } else if(e.unstuckUntil_){
    e.unstuckUntil_ = 0;
  }
  const len = Math.hypot(dx, dz) || 1;
  e.root.position.x += (dx/len)*spd*dt;
  e.root.position.z += (dz/len)*spd*dt;
  faceDir(e, dx/len, dz/len, dt);
}
function pickPatrol(e){
  // Patrouille dans un rayon 12-20u autour du joueur : corrige les vagues vides (ennemis qui s'éloignaient aux coins)
  // sans être trop agressif (DETECT_RADIUS=12, donc certains cibles sont hors portée, certaines dedans)
  const px = model ? model.position.x : 0, pz = model ? model.position.z : 0;
  const r = DETECT_RADIUS + Math.random() * 8, a = Math.random() * Math.PI * 2;
  e.target = {
    x: Math.max(-MAP_HALF*0.85, Math.min(MAP_HALF*0.85, px + Math.cos(a)*r)),
    z: Math.max(-MAP_HALF*0.85, Math.min(MAP_HALF*0.85, pz + Math.sin(a)*r))
  };
}
function faceToward(e, tx, tz, dt){
  const dx = tx - e.root.position.x, dz = tz - e.root.position.z;
  const len = Math.hypot(dx, dz) || 1;
  faceDir(e, dx/len, dz/len, dt);
}
function clampEnemy(e){
  e.root.position.x = Math.max(-MAP_HALF, Math.min(MAP_HALF, e.root.position.x));
  e.root.position.z = Math.max(-MAP_HALF, Math.min(MAP_HALF, e.root.position.z));
  for(const b of obstacles){
    const o = pushOutCircleAABB(e.root.position.x, e.root.position.z, ENEMY_R, b);
    e.root.position.x = o.x; e.root.position.z = o.z;
  }
}
function setEnemyLoco(e, state){
  if(e.loco === state) return;
  const next = e.actions[state] || e.actions.idle;
  const prev = e.actions[e.loco];
  if(next){ next.reset().play(); if(prev && prev!==next) prev.crossFadeTo(next, 0.2, false); }
  e.loco = state;
}
G.debug.spawnEnemyAt = (x, z) => {
  const e = enemies[0]; if(!e) return null;
  e.root.position.set(x, ENEMY_FOOT_Y + groundHeight(x, z), z); e.root.rotation.set(0,0,0);   // #204
  e.hp = ENEMY_HP; e.alive = true; e.state='patrol'; e.loco='idle'; e.lostFor=0; e.target=null;
  e.hitbox.position.set(x, ENEMY_FOOT_Y + groundHeight(x, z) + (e.hbY || 0.9), z); e.hitbox.updateMatrixWorld();
  return e.id;
};
G.debug.moveEnemy = (i, x, z) => { const e = enemies[i]; if(e){ const gy = ENEMY_FOOT_Y + groundHeight(x, z); e.root.position.set(x, gy, z); e.state='patrol'; e.lostFor=0; e.hitbox.position.set(x, gy + (e.hbY || 0.9), z); e.hitbox.updateMatrixWorld(); } };   // #204

function setEnemyEmissive(e, on){
  for(const m of e.mats) m.mat.emissive.copy(on ? FLASH_COLOR : m.base);
}
const OVERKILL_THRESHOLD = 50, OVERKILL_BONUS = 25;
let overkillCount_ = 0, lastOverkill_ = false;
function damageEnemy(e, amount = DMG_TORSO){
  if(!e || !e.alive) return;
  if(amount > runBestHit_) runBestHit_ = amount;   // #162 : meilleur coup de la partie
  e.lastOverkillFlag = (amount - e.hp) >= OVERKILL_THRESHOLD;   // #139 : excédent avant application des dégâts
  e.hp -= amount; playSound('hit');                    // #129 : le berserker en frenzy est désormais TUABLE (plus d'invincibilité)
  if(activePower === 'vampire' && !hardcore_ && model){ health = Math.min(maxHealth, health + Math.round(amount * 0.2)); G.health = health; updateHealthHud(); } // #133 lifesteal
  tryTriggerFrenzy(e);                                 // #129 : vérifie si frenzy se déclenche
  if(e.hp <= 0){ killEnemy(e); return; }
  if(e.state === 'patrol') e.state = 'chase';   // touché => s'aggrave et se retourne/fonce vers le joueur
  e.lostFor = 0;
  if(e.hp < e.maxHp * 0.5 && e.state !== 'cover') enterCover(e); // cover dynamique (#88)
}
// ====== Combo / killstreak (#29) : enchaîner des kills monte un multiplicateur argent/score ======
const COMBO_WINDOW = 3.5;
let comboCount = 0, comboExpireAt = 0;
function comboMultiplier(n){ return Math.min(5, 1 + Math.floor(n/3)); }
function comboTimeFrac(){ return comboCount > 0 ? Math.max(0, (comboExpireAt - nowS()) / COMBO_WINDOW) : 0; }
// ====== Boss (#31) : barre de vie + helpers ======
function bossEnemy(){ return enemies.find(e => e.type === 'boss' && e.alive) || null; }
function bossHpFrac(){ const b = bossEnemy(); return b ? Math.max(0, b.hp / b.maxHp) : 0; }
function updateBossHud(){ const el = document.getElementById('boss-hud'); if(!el) return;
  const b = bossEnemy(); if(!b){ el.classList.add('hidden'); return; }
  document.getElementById('boss-fill').style.width = Math.round(bossHpFrac()*100) + '%'; el.classList.remove('hidden'); }
G.debug.bossAlive = () => !!bossEnemy();
G.debug.bossHpFrac = () => bossHpFrac();
G.debug.forceWave = (w) => startWave(w);
function registerKill(){
  comboCount++; comboExpireAt = nowS() + COMBO_WINDOW;
  if(comboCount > (save.bestCombo || 0)){ save.bestCombo = comboCount; persist(); }
  return comboMultiplier(comboCount);
}
function breakCombo(){ if(comboCount){ comboCount = 0; updateComboHud(); } }
function resetCombo(){ comboCount = 0; comboExpireAt = 0; updateComboHud(); }
function updateCombo(){ if(comboCount > 0 && nowS() >= comboExpireAt) breakCombo(); }
let comboPulseT = null;
function updateComboHud(pulse){
  const el = document.getElementById('combo-hud'); if(!el) return;
  if(comboCount <= 0){ el.classList.add('hidden'); return; }
  const mult = comboMultiplier(comboCount);
  el.innerHTML = `<div class="cm">x${mult}</div><div class="cc">COMBO ${comboCount}</div><div class="cbar" style="width:${Math.round(comboTimeFrac()*100)}%"></div>`;
  el.classList.remove('hidden');
  if(pulse){ el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
    clearTimeout(comboPulseT); comboPulseT = setTimeout(() => el.classList.remove('pulse'), 240); }
}
G.debug.comboMultiplier = (n) => comboMultiplier(n);
G.debug.combo = () => comboCount;
G.debug.comboMult = () => comboMultiplier(comboCount);
G.debug.comboTimeLeft = () => comboCount > 0 ? Math.max(0, comboExpireAt - nowS()) : 0;
G.debug.bestCombo = () => save.bestCombo || 0;
// ====== Kamikaze (#37) : explosion AoE au joueur ======
const BOMBER_R = 3.5, BOMBER_DAMAGE = 35;
function explodeBomber(e){
  if(!e || e.exploded) return; e.exploded = true;
  if(model){ const d = Math.hypot(model.position.x - e.root.position.x, model.position.z - e.root.position.z);
    if(d < BOMBER_R) damagePlayer(Math.max(1, Math.round(BOMBER_DAMAGE * (1 - d/BOMBER_R)))); }
  spawnExplosionFx(new THREE.Vector3(e.root.position.x, 1, e.root.position.z));
}
G.debug.explodeBomberNow = (i) => { const e = enemies[i]; if(e) killEnemy(e); };
// ====== Annonces de kill (#38) : HEADSHOT / multi-kill / BOSS DOWN ======
const MULTIKILL_WINDOW = 1.2; const killTimes = []; let lastCalloutText = null, calloutT = null;
function showCallout(text){ lastCalloutText = text; const el = document.getElementById('kill-callout'); if(!el) return;
  el.textContent = text; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(calloutT); calloutT = setTimeout(() => el.classList.remove('show'), 1000); }
function killCallout(e){
  const t = nowS(); killTimes.push(t); while(killTimes.length && t - killTimes[0] > MULTIKILL_WINDOW) killTimes.shift();
  const n = killTimes.length;
  registerKillForStreak(!!e.lastHitHead);
  if(e.type === 'boss') showCallout('BOSS DOWN');
  else if(n >= 2) showCallout(n===2 ? 'DOUBLE KILL' : n===3 ? 'TRIPLE KILL' : 'MULTI KILL !');
  else if(e.lastHitHead) showCallout('HEADSHOT');
}
function resetCallouts(){ killTimes.length = 0; lastCalloutText = null; headStreakCount_ = 0; const el = document.getElementById('kill-callout'); if(el) el.classList.remove('show'); resetKillFeed(); resetChallenges(); }
G.debug.lastCallout = () => lastCalloutText;
// ====== #110 Headshot streak ======
const HS_STREAK_BONUS = 10, HS_STREAK_MIN = 3;
let headStreakCount_ = 0;
function registerKillForStreak(isHead){
  if(isHead){ headStreakCount_++; if(headStreakCount_ >= HS_STREAK_MIN){ addMoney(HS_STREAK_BONUS); showCallout('HEADSHOT STREAK ' + headStreakCount_ + '!'); } }
  else headStreakCount_ = 0;
}
G.debug.headStreakCount = () => headStreakCount_;
G.debug.headStreakBonus = () => HS_STREAK_BONUS;
G.debug.resetHeadStreak = () => { headStreakCount_ = 0; };
// ====== #54 Kill Feed ======
const KF_COLORS = { rusher:'#ff6b35', shooter:'#4fc3f7', tank:'#81c784', bomber:'#ffb300', boss:'#ce93d8' };
const KF_LABELS = { rusher:'Rusher', shooter:'Shooter', tank:'Tank', bomber:'Bomber', boss:'Boss' };
const KF_MAX = 5, KF_LIFE = 4000, KF_FADE = 500;
function addKillFeedEntry(e){
  const feed = document.getElementById('kill-feed'); if(!feed) return;
  const isHead = !!e.lastHitHead, isBoss = e.type === 'boss';
  const label = KF_LABELS[e.type] || 'Ennemi';
  const prefix = isBoss ? 'BOSS DOWN · ' : isHead ? 'HEADSHOT · ' : '';
  const div = document.createElement('div');
  div.className = 'kf-entry';
  div.style.setProperty('--kf-color', KF_COLORS[e.type] || '#fff');
  div.textContent = '☠ ' + prefix + label;
  feed.prepend(div);
  while(feed.children.length > KF_MAX){ feed.removeChild(feed.lastChild); }
  setTimeout(() => {
    div.classList.add('fade-out');
    setTimeout(() => { if(div.parentNode) div.parentNode.removeChild(div); }, KF_FADE);
  }, KF_LIFE);
}
function resetKillFeed(){ const f = document.getElementById('kill-feed'); if(f) f.innerHTML = ''; }
G.debug.killFeedCount = () => { const f = document.getElementById('kill-feed'); return f ? f.children.length : 0; };
G.debug.lastKillFeedText = () => { const f = document.getElementById('kill-feed'); return f && f.firstChild ? f.firstChild.textContent : ''; };
// ====== #55 Challenges ======
const CHALLENGES = [
  { id:'kills_5',        desc:'Tuer 5 ennemis',        target:5,  reward:150, type:'kills' },
  { id:'kills_10',       desc:'Tuer 10 ennemis',       target:10, reward:300, type:'kills' },
  { id:'headshots_2',    desc:'2 headshots',           target:2,  reward:200, type:'headshots' },
  { id:'headshots_5',    desc:'5 headshots',           target:5,  reward:400, type:'headshots' },
  { id:'wave_3',         desc:'Atteindre la vague 3',  target:3,  reward:250, type:'wave' },
  { id:'wave_5',         desc:'Atteindre la vague 5',  target:5,  reward:500, type:'wave' },
  { id:'no_damage_wave', desc:'Vague sans dégâts',     target:1,  reward:350, type:'nodmg' },
  { id:'melee_3',        desc:'3 kills au couteau',    target:3,  reward:300, type:'melee' },
];
let sessionChallenges = [];
let dmgThisWave = 0;
let challengeMeleeKills = 0;
let challengeToastT = null;
function initChallenges(){
  const pool = [...CHALLENGES].sort(() => Math.random() - 0.5);
  sessionChallenges = pool.slice(0, 3).map(def => ({ def, progress:0, done:false }));
  dmgThisWave = 0; challengeMeleeKills = 0;
  updateChallengesHud();
}
function checkChallenges(type, value){
  if(!sessionChallenges.length) return;
  for(const c of sessionChallenges){
    if(c.done || c.def.type !== type) continue;
    c.progress = Math.max(c.progress, value);
    if(c.progress >= c.def.target) completeChallenge(c);
  }
  updateChallengesHud();
}
function completeChallenge(c){
  c.done = true; c.progress = c.def.target;
  addMoney(c.def.reward);
  const el = document.getElementById('challenge-toast'); if(!el) return;
  el.textContent = '✓ Défi : ' + c.def.desc + ' +' + c.def.reward + '$';
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(challengeToastT);
  challengeToastT = setTimeout(() => el.classList.remove('show'), 2500);
}
function updateChallengesHud(){
  const el = document.getElementById('challenges-hud'); if(!el) return;
  if(!sessionChallenges.length){ el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = '<div class="ch-title">Défis</div>' + sessionChallenges.map(c => {
    const frac = Math.min(1, c.progress / c.def.target);
    return `<div class="ch-entry${c.done?' done':''}">${c.done?'✓ ':''}${c.def.desc}<div class="ch-bar" style="width:${Math.round(frac*100)}%"></div></div>`;
  }).join('');
}
function resetChallenges(){
  sessionChallenges = []; dmgThisWave = 0; challengeMeleeKills = 0;
  const el = document.getElementById('challenges-hud'); if(el) el.classList.add('hidden');
}
G.debug.challengeCount    = () => sessionChallenges.length;
G.debug.challengeDone     = (i) => sessionChallenges[i]?.done ?? false;
G.debug.challengeProgress = (i) => { const c = sessionChallenges[i]; return c ? {progress:c.progress, target:c.def.target} : null; };
G.debug.challengeReward   = (i) => sessionChallenges[i]?.def.reward ?? 0;
G.debug.challengeIds      = () => sessionChallenges.map(c => c.def.id);
G.debug.forceCompleteChallenge = (i) => { const c = sessionChallenges[i]; if(c && !c.done) completeChallenge(c); updateChallengesHud(); };
function killEnemy(e){
  const wasStealthKill_ = e.state === 'patrol' && !!e.lastHitMelee;   // #168 : capturer avant l'ecrasement de e.state ci-dessous ; !! : lastHitMelee est undefined pour un ennemi jamais frappé au couteau
  if(e.type === 'bomber') explodeBomber(e);                    // explose à la mort (#37)
  if(e.type === 'toxic') spawnPoisonZone(e.root.position.x, e.root.position.z);   // nuage de poison à la mort (#141)
  if(e.type === 'cryo') spawnFrostZone(e.root.position.x, e.root.position.z);     // zone de gel à la mort (#146)
  const prevAction = e.actions[e.loco];                        // action de locomotion en cours (avant bascule en 'dead')
  e.alive = false; e.state = 'dead'; e.loco = 'dead';
  e.frozenPose = null;
  if(e.muzzleFlash){ e.muzzleFlash.visible = false; e.muzzleFlashUntil = 0; }
  endFrenzyVisual(e);                                           // #129 : restaure couleur d'origine si mort en frenzy (corps pas rouge vif)
  setEnemyEmissive(e, false); e.flashUntil = 0;                 // fin du flash rouge bloqué (corps propre)
  if(e.hitbox && e.hitbox.parent) e.hitbox.parent.remove(e.hitbox);  // hitbox off (corps non ciblable / traversable)
  if(e.shieldMesh) e.shieldMesh.visible = false;                     // bouclier masqué à la mort (#119)
  if(e.actions.dead){
    const dead = e.actions.dead;
    dead.reset().setLoop(THREE.LoopOnce, 1); dead.clampWhenFinished = true; dead.enabled = true; dead.setEffectiveWeight(1);
    dead.play();
    // crossfade DEPUIS la pose vivante en cours -> évite le saut "se met debout" (snap vers la frame 0 de l'anim de mort)
    if(prevAction && prevAction !== dead){
      prevAction.crossFadeTo(dead, 0.18, false);
      // filet de sécurité : certaines transitions (mort en plein milieu d'une autre transition déjà en fondu,
      // ex. mêlée 'attack' interrompue) laissent le crossfade three.js ne jamais totalement retomber à poids 0 ;
      // ça se voit comme l'anim précédente (souvent l'attaque en boucle) qui continue de jouer sous le cadavre.
      // On force la coupure après la durée du fondu, quoi qu'il arrive.
      setTimeout(() => { prevAction.enabled = false; }, 220);
    }
    // coupe les autres actions (ni la précédente ni dead) sans reset() (qui rebasculerait en T-pose)
    Object.values(e.actions).forEach(a => { if(a && a !== dead && a !== prevAction) a.enabled = false; });
  } else {
    // No dead clip: freeze current animated pose immediately (not T-pose)
    const pose = [];
    e.root.traverse(o => { if(o.isBone) pose.push({ bone:o, p:o.position.clone(), q:o.quaternion.clone() }); });
    e.frozenPose = pose;
  }
  if(ENEMY_TYPES[e.type] && ENEMY_TYPES[e.type].armor) armoredKillCount_++;    // armor system (#114)
  const mult = registerKill();                        // combo (#29) : multiplicateur argent/score
  const wm = waveScoreMult_();                        // multiplicateur de vague (#126)
  const killScore = Math.round(mult * wm); lastKillScore_ = killScore;
  score += killScore; G.score = score; runKills++; if(e.lastHitHead) runHeadshots++;   // stats partie (#43)
  checkChallenges('kills', runKills); if(e.lastHitHead) checkChallenges('headshots', runHeadshots);
  if(e.lastHitMelee){ challengeMeleeKills++; checkChallenges('melee', challengeMeleeKills); }
  flashHitMarker(); playSound('enemyDie');
  const vipMult = e.isVip ? VIP_MULT : 1;                          // #140 : cible VIP
  addMoney(Math.round(MONEY_PER_KILL * mult * curDiff().money * vipMult));   // argent par kill × combo × difficulté (#46) × VIP
  if(e.type === 'boss') addMoney(BOSS_BONUS);          // gros bonus à la mort d'un boss (#31)
  maybeDropHealth(e);                                  // chance de pack de soin (#32 ; boss garanti)
  maybeDropAmmo(e);                                    // chance de pack de munitions (#117)
  maybeDropPower(e);                                   // chance de power-up (#34 ; boss garanti)
  updateComboHud(true);                               // true = pulse (HUD enrichi en T3)
  const isLastEnemy_ = !enemies.some(en => en.alive && !en.isDecoy);   // #176 : capture avant checkWaveCleared
  if(isLastEnemy_ && health < maxHealth * 0.2){ clutchCount_++; addMoney(CLUTCH_MONEY); addXp(CLUTCH_XP); showCallout('CLUTCH!'); }
  checkWaveCleared(); updateWaveHud(); updateBossHud(); // vague : un mort de moins + barre boss (#31)
  killCallout(e);                                       // annonce HEADSHOT/multi-kill/BOSS DOWN (#38)
  if(e.isVip) showCallout('VIP ÉLIMINÉ!');              // #140
  addKillFeedEntry(e);                                  // journal kill (#54)
  registerKsKill();                                     // récompenses killstreak (#58)
  registerLoadoutKill();                                 // points série de killstreak loadout (#156)
  addXp((XP_KILL + (e.lastHitHead ? XP_HEAD : 0)) * vipMult);      // XP par kill (#60) × VIP (#140)
  onStreakKill();                                         // streak counter (#72)
  spawnMoneyOrb(e.root.position.x, e.root.position.z, MONEY_PER_KILL); // orbe argent (#79)
  addLifetimeStat('kills', 1); if(e.lastHitHead) addLifetimeStat('headshots', 1); // lifetime stats (#80)
  trackDailyKill('kills'); if(e.lastHitHead) trackDailyKill('headshots'); if(e.lastHitMelee) trackDailyKill('melee'); // contrats (#62)
  checkLongShot(e);                                           // long shot bonus (#102)
  lastOverkill_ = !!e.lastOverkillFlag;
  if(lastOverkill_){ overkillCount_++; addMoney(OVERKILL_BONUS); showCallout('OVERKILL!'); }   // #139
  lastFirstBlood_ = !firstBloodDone_;                          // #161 : premier kill de la vague
  if(lastFirstBlood_){ firstBloodDone_ = true; firstBloodCount_++; addMoney(FIRST_BLOOD_MONEY); addXp(FIRST_BLOOD_XP); showCallout('PREMIER SANG!'); }
  lastStealthKill_ = wasStealthKill_;                          // #168 : takedown furtif
  if(lastStealthKill_){ stealthKillCount_++; addMoney(STEALTH_MONEY); addXp(STEALTH_XP); showCallout('INFILTRATION!'); }
  waveKillCount_++; if(waveKillCount_ > runBestWaveKills_) runBestWaveKills_ = waveKillCount_;   // #173
  if(nowS() - lastDamageAt < 1){ revengeCount_++; addMoney(REVENGE_MONEY); showCallout('REVANCHE!'); }   // #187
  if(e.lastHitMelee) meleeKillStreak_++; else meleeKillStreak_ = 0;   // #192
  if(meleeKillStreak_ === 3){ meleeComboCount_++; addMoney(MELEE_COMBO_BONUS); showCallout('BOUCHERIE!'); meleeKillStreak_ = 0; }
  // #191/#193/#195 : APRÈS tous les compteurs de ce kill (stealthKillCount_/clutchCount_/etc.) — sinon les succès
  // qui en dépendent se débloquent avec un kill de retard, voire jamais si c'est le dernier kill de la partie
  checkAchievements(mult);                             // succès (#44)
}
G.debug.overkillCount = () => overkillCount_;
G.debug.lastOverkill = () => lastOverkill_;
G.debug.forceOverkill = (i) => { const e = enemies[i]; if(e) damageEnemy(e, e.hp + OVERKILL_THRESHOLD + 10); };
const FIRST_BLOOD_MONEY = 15, FIRST_BLOOD_XP = 20;   // #161
let firstBloodDone_ = false, firstBloodCount_ = 0, lastFirstBlood_ = false;
G.debug.firstBloodCount = () => firstBloodCount_;
G.debug.lastWasFirstBlood = () => lastFirstBlood_;
const STEALTH_MONEY = 20, STEALTH_XP = 15;   // #168
let stealthKillCount_ = 0, lastStealthKill_ = false;
G.debug.stealthKillCount = () => stealthKillCount_;
G.debug.lastStealthKill = () => lastStealthKill_;
const CLUTCH_MONEY = 30, CLUTCH_XP = 25;   // #176
let clutchCount_ = 0;
G.debug.clutchCount = () => clutchCount_;
const REVENGE_MONEY = 20;   // #187
let revengeCount_ = 0;
G.debug.revengeCount = () => revengeCount_;
const MELEE_COMBO_BONUS = 35;   // #192
let meleeKillStreak_ = 0, meleeComboCount_ = 0;
G.debug.meleeKillStreak = () => meleeKillStreak_;
G.debug.meleeComboCount = () => meleeComboCount_;
// ====== Wave director : enchaîne les vagues, tient le record ======
let waveStartTime = 0;
function startWave(w){
  if(trainingActive_) return;   // #158 : aucune vague en mode entrainement
  wave = w; G.wave = w; checkAchievements();          // succès (#44) : survivant à la vague 5
  if(w > bestWave){ bestWave = w; G.bestWave = bestWave; save.bestWave = w; persist(); }   // record persistant
  createEnemies(enemiesForWave(w), enemyHpForWave(w), waveComposition(w));   // nettoie les corps + crée la vague (composition par type)
  maybeMarkVip(w);                                                          // marque un ennemi VIP (#140)
  // #156 : plus d'auto-spawn caisse toutes les 4 vagues, remplacé par la touche loadout I
  dmgThisWave = 0; waveState = 'active'; spawnBarrels();    // barils (#41) ; reset dmgThisWave (#55) ; plus de refill grenades par vague (#155)
  firstBloodDone_ = false;   // #161 : reactive le bonus premier sang pour cette vague
  waveReloadCount_ = 0;      // #166 : reactive le bonus sans recharge pour cette vague
  waveKillCount_ = 0;        // #173 : compteur de kills de cette vague
  waveDashCount_ = 0;        // #182 : reactive le bonus vague sans dash pour cette vague
  waveShots_ = 0; waveHits_ = 0;   // #184 : compteurs de precision de cette vague
  waveGrenadeCount_ = 0;   // #190 : reactive le bonus vague sans grenade pour cette vague
  waveStartTime = nowS();                                                   // #149 : chrono du bonus vague éclair
  checkChallenges('wave', w);
  updateWaveHud(); updateBossHud(); showWaveBanner(w, isBossWave(w));
}
G.debug.waveElapsed = () => nowS() - waveStartTime;
G.debug.ageWaveStart = (seconds) => { waveStartTime -= seconds; };   // #149 : recule artificiellement le chrono (test déterministe)
const SPEED_CLEAR_THRESHOLD = 15, SPEED_CLEAR_BONUS = 100;
let speedClearCount_ = 0, lastSpeedClear_ = false;
function checkWaveCleared(){
  if(trainingActive_) return;   // #158 : aucune progression de vague en entrainement
  if(waveState !== 'active' || enemies.some(e => e.alive && !e.isDecoy)) return; // decoys excluded (#124)
  waveState = 'cleared'; nextWaveAt = nowS() + WAVE_INTERMISSION;
  if(dmgThisWave === 0) checkChallenges('nodmg', 1);
  grantWaveBonus(wave);                                                            // bonus survie parfaite (#100)
  addMoney(Math.round(MONEY_PER_WAVE * wave * curDiff().money)); recordScore();   // bonus de vague × difficulté (#46)
  addXp(XP_WAVE * wave);                                                           // XP par vague (#60)
  trackDailyWave(wave);                                                             // contrats vague (#62)
  const clearTime_ = nowS() - waveStartTime;                                        // #149/#174
  lastSpeedClear_ = clearTime_ < SPEED_CLEAR_THRESHOLD;               // #149 : vague éclair
  if(lastSpeedClear_){ speedClearCount_++; addMoney(SPEED_CLEAR_BONUS); showCallout('VAGUE ÉCLAIR!'); }
  if(runFastestWave_ === null || clearTime_ < runFastestWave_) runFastestWave_ = clearTime_;   // #174
  if(waveReloadCount_ === 0){ noReloadClearCount_++; addMoney(NO_RELOAD_BONUS); showCallout('SANS RECHARGE!'); }   // #166
  if(waveDashCount_ === 0){ noDashClearCount_++; addMoney(NO_DASH_BONUS); showCallout('SANG-FROID!'); }   // #182
  if(waveShots_ >= 5 && waveHits_ === waveShots_){ perfectAccuracyCount_++; addMoney(PERFECT_ACCURACY_BONUS); showCallout('PRÉCISION TOTALE!'); }   // #184
  if(waveGrenadeCount_ === 0){ noGrenadeClearCount_++; addMoney(NO_GRENADE_BONUS); showCallout('ÉCONOME!'); }   // #190
  if(health === 1) unlockAchievement('miracule');   // #194
  if(waveKillCount_ > 0 && waveShots_ === 0) unlockAchievement('silencieux');   // #197
  if(accessoryItemById(save.equipped.helmet)?.rarity === 'legendaire' && accessoryItemById(save.equipped.costume)?.rarity === 'legendaire') unlockAchievement('stylise');   // #199
  showWaveBanner('Vague ' + wave + ' terminée !');
}
G.debug.speedClearCount = () => speedClearCount_;
G.debug.noReloadClearCount = () => noReloadClearCount_;   // #166
G.debug.waveReloadCount = () => waveReloadCount_;
G.debug.noDashClearCount = () => noDashClearCount_;   // #182
G.debug.waveDashCount = () => waveDashCount_;
G.debug.perfectAccuracyCount = () => perfectAccuracyCount_;   // #184
G.debug.waveShots = () => waveShots_;
G.debug.waveHits = () => waveHits_;
G.debug.noGrenadeClearCount = () => noGrenadeClearCount_;   // #190
G.debug.waveGrenadeCount = () => waveGrenadeCount_;
G.debug.lastSpeedClear = () => lastSpeedClear_;
function updateWaves(dt){
  if(G.phase !== 'playing' || trainingActive_) return;
  if(waveState === 'cleared' && nowS() >= nextWaveAt) startWave(wave + 1);
  updateWaveCountdown(); // countdown inter-vague (#76)
}
function updateEnemyCountHud(){
  const el = document.getElementById('enemy-count-hud'); if(!el) return;
  const alive = enemies.filter(e => e.alive).length;
  if(G.phase !== 'playing' || waveState === 'cleared' || alive === 0){ el.classList.add('hidden'); return; }
  el.classList.remove('hidden'); el.textContent = '✕ ' + alive + (alive > 1 ? ' Ennemis' : ' Ennemi');
}
G.debug.hudEnemyCountVisible = () => { const el=document.getElementById('enemy-count-hud'); return el ? !el.classList.contains('hidden') : false; };
function updateWaveHud(){
  const el = document.getElementById('wave-hud'); if(!el) return;
  if(waveState === 'cleared'){ el.innerHTML = `<b>Vague ${wave}</b> · terminée`; updateEnemyCountHud(); return; }
  const remaining = enemies.filter(e => e.alive).length;
  el.innerHTML = `<b>Vague ${wave}</b> · ${remaining} ennemi${remaining > 1 ? 's' : ''}`;
  updateEnemyCountHud();
}
let waveBannerT = null;
function showWaveBanner(nOrText, isBoss){
  const el = document.getElementById('wave-banner'); if(!el) return;
  const title = el.querySelector('.wb-title'), sub = el.querySelector('.wb-sub');
  if(typeof nOrText === 'number'){
    if(title) title.textContent = `VAGUE ${nOrText}`;
    if(sub) sub.textContent = isBoss ? '⚠ BOSS ⚠' : (nOrText===1 ? 'BONNE CHANCE !' : `${nOrText} ENNEMIS`);
  } else {
    if(title) title.textContent = nOrText; if(sub) sub.textContent='';
  }
  el.classList.remove('wb-show'); void el.offsetWidth; el.classList.add('wb-show');
  clearTimeout(waveBannerT); waveBannerT = setTimeout(() => el.classList.remove('wb-show'), 2500);
}
G.debug.showWaveBanner = (n, isBoss) => showWaveBanner(n, !!isBoss);
G.debug.waveState = () => waveState;
G.debug.forceNextWave = () => startWave(wave + 1);
G.debug.killAllEnemies = () => { for(const e of enemies) if(e.alive) killEnemy(e); };
G.debug.damageEnemy = (i, amount) => damageEnemy(enemies[i], amount);
G.debug.setEnemyLastHitHead = (i, v) => { if(enemies[i]) enemies[i].lastHitHead = !!v; };
G.debug.corpseCount = () => enemies.filter(e => e.state === 'dead').length;
G.debug.enemyLowestY = (i) => { const e = enemies[i]; if(!e) return null; e.root.updateMatrixWorld(true);
  let lo = Infinity; const v = new THREE.Vector3(); e.root.traverse(o => { if(o.isBone){ o.getWorldPosition(v); if(v.y < lo) lo = v.y; } }); return isFinite(lo) ? lo : null; };
G.debug.enemyEmissiveIsBase = (i) => { const e = enemies[i]; if(!e || !e.mats[0]) return null;
  return e.mats[0].mat.emissive.getHex() === e.mats[0].base.getHex(); };
G.debug.enemyHitboxActive = (i) => !!(enemies[i] && enemies[i].hitbox && enemies[i].hitbox.parent);
G.debug.setPitch = (p) => { camPitch = p; clampPitch(); };
G.debug.spawnEnemyInFront = (dist=8) => {
  _ray.setFromCamera({ x:0, y:0 }, camera);
  const p = _ray.ray.origin.clone().add(_ray.ray.direction.clone().multiplyScalar(dist));
  return G.debug.spawnEnemyAt(p.x, p.z);
};

// ====== Arme (modèle + attache main + viewmodel) ======
const WEAPON_DIR = 'artefact/weapons/';   // GLB rangé sous artefact/weapons/AR-15/ ; findGlbInDir descend 1 niveau (→ AR-15/)
let weaponSource = 'primitive', weaponTemplate = null, heldWeapon = null, viewModel = null;
let handBoneName = null, weaponRecoil = 0, cameraInScene = false;
function buildWeaponMesh(){
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color:0x2a2d33, metalness:0.7, roughness:0.4 });
  const dark  = new THREE.MeshStandardMaterial({ color:0x14151a, metalness:0.5, roughness:0.6 });
  const body   = new THREE.Mesh(new THREE.BoxGeometry(0.06,0.10,0.40), steel); body.position.set(0,0,0.02);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.020,0.020,0.34,10), steel); barrel.rotation.x = Math.PI/2; barrel.position.set(0,0.012,0.30);
  const stock  = new THREE.Mesh(new THREE.BoxGeometry(0.05,0.08,0.15), dark); stock.position.set(0,-0.01,-0.22);
  const grip   = new THREE.Mesh(new THREE.BoxGeometry(0.045,0.13,0.06), dark); grip.position.set(0,-0.10,-0.03); grip.rotation.x = 0.30;
  const mag    = new THREE.Mesh(new THREE.BoxGeometry(0.04,0.14,0.05), dark); mag.position.set(0,-0.12,0.07); mag.rotation.x = -0.12;
  g.add(body,barrel,stock,grip,mag);
  g.traverse(o=>{ if(o.isMesh) o.castShadow = true; });
  return g;   // +Z = canon vers l'avant, longueur ~0.5
}
function buildSmgMesh(){   // mitraillette compacte (~0.4)
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color:0x303338, metalness:0.6, roughness:0.5 });
  const dark  = new THREE.MeshStandardMaterial({ color:0x111216, metalness:0.4, roughness:0.7 });
  const body   = new THREE.Mesh(new THREE.BoxGeometry(0.06,0.11,0.26), steel); body.position.set(0,0,0.0);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016,0.016,0.18,10), steel); barrel.rotation.x = Math.PI/2; barrel.position.set(0,0.01,0.20);
  const grip   = new THREE.Mesh(new THREE.BoxGeometry(0.045,0.12,0.06), dark); grip.position.set(0,-0.10,-0.02); grip.rotation.x = 0.25;
  const mag    = new THREE.Mesh(new THREE.BoxGeometry(0.035,0.16,0.05), dark); mag.position.set(0,-0.14,0.04);
  g.add(body,barrel,grip,mag);
  g.traverse(o=>{ if(o.isMesh) o.castShadow = true; });
  return g;
}
function buildSniperMesh(){   // fusil de précision long (~0.7)
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color:0x23262b, metalness:0.7, roughness:0.35 });
  const dark  = new THREE.MeshStandardMaterial({ color:0x0e0f12, metalness:0.5, roughness:0.6 });
  const body   = new THREE.Mesh(new THREE.BoxGeometry(0.05,0.09,0.46), steel); body.position.set(0,0,0.02);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.018,0.5,10), steel); barrel.rotation.x = Math.PI/2; barrel.position.set(0,0.01,0.42);
  const scope  = new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,0.14,10), dark); scope.rotation.x = Math.PI/2; scope.position.set(0,0.08,0.04);
  const stock  = new THREE.Mesh(new THREE.BoxGeometry(0.045,0.08,0.18), dark); stock.position.set(0,-0.01,-0.26);
  const grip   = new THREE.Mesh(new THREE.BoxGeometry(0.04,0.12,0.055), dark); grip.position.set(0,-0.09,-0.05); grip.rotation.x = 0.3;
  g.add(body,barrel,scope,stock,grip);
  g.traverse(o=>{ if(o.isMesh) o.castShadow = true; });
  return g;
}
function buildShotgunMesh(){   // fusil à pompe (#36) : canon large + pompe + crosse bois
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color:0x33373e, metalness:0.6, roughness:0.5 });
  const wood  = new THREE.MeshStandardMaterial({ color:0x5a3a1e, roughness:0.7 });
  const body   = new THREE.Mesh(new THREE.BoxGeometry(0.06,0.10,0.40), steel); body.position.set(0,0,0.02);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026,0.026,0.40,10), steel); barrel.rotation.x = Math.PI/2; barrel.position.set(0,0.02,0.30);
  const pump   = new THREE.Mesh(new THREE.BoxGeometry(0.05,0.05,0.10), wood); pump.position.set(0,-0.05,0.18);
  const stock  = new THREE.Mesh(new THREE.BoxGeometry(0.05,0.09,0.18), wood); stock.position.set(0,-0.02,-0.22);
  g.add(body,barrel,pump,stock);
  g.traverse(o=>{ if(o.isMesh) o.castShadow = true; });
  return g;
}
function buildPistolMesh(){
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color:0x2a2d33, metalness:0.85, roughness:0.25 });
  const dark  = new THREE.MeshStandardMaterial({ color:0x14151a, metalness:0.4, roughness:0.7 });
  const body   = new THREE.Mesh(new THREE.BoxGeometry(0.052,0.095,0.17), steel); body.position.set(0,0.006,0.03);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.013,0.013,0.16,8), steel); barrel.rotation.x=Math.PI/2; barrel.position.set(0,0.026,0.12);
  const grip   = new THREE.Mesh(new THREE.BoxGeometry(0.040,0.11,0.055), dark); grip.position.set(0,-0.106,-0.01); grip.rotation.x=0.15;
  const slide  = new THREE.Mesh(new THREE.BoxGeometry(0.045,0.028,0.14), steel); slide.position.set(0,0.068,0.04);
  g.add(body,barrel,grip,slide);
  g.traverse(o=>{ if(o.isMesh) o.castShadow=true; });
  return g;
}
function buildLmgMesh(){
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color:0x252830, metalness:0.7, roughness:0.5 });
  const dark  = new THREE.MeshStandardMaterial({ color:0x14151a, metalness:0.4, roughness:0.7 });
  const body   = new THREE.Mesh(new THREE.BoxGeometry(0.08,0.12,0.55), steel); body.position.set(0,0,0.04);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.018,0.55,10), steel); barrel.rotation.x=Math.PI/2; barrel.position.set(0,0.022,0.40);
  const bipod1 = new THREE.Mesh(new THREE.CylinderGeometry(0.006,0.006,0.18,5), dark); bipod1.position.set(-0.04,-0.12,0.32); bipod1.rotation.z=0.3;
  const bipod2 = new THREE.Mesh(new THREE.CylinderGeometry(0.006,0.006,0.18,5), dark); bipod2.position.set(0.04,-0.12,0.32); bipod2.rotation.z=-0.3;
  const drum   = new THREE.Mesh(new THREE.CylinderGeometry(0.055,0.055,0.045,16), dark); drum.rotation.x=Math.PI/2; drum.position.set(0,-0.09,0.06);
  const stock  = new THREE.Mesh(new THREE.BoxGeometry(0.055,0.09,0.20), dark); stock.position.set(0,-0.01,-0.29);
  g.add(body,barrel,bipod1,bipod2,drum,stock);
  g.traverse(o=>{ if(o.isMesh) o.castShadow=true; });
  return g;
}
// #50 : buildKnifeMesh(variant) — 3 designs distincts
function buildKnifeMesh(variant){
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color:0xbec8d5, metalness:0.95, roughness:0.10 });
  const dark  = new THREE.MeshStandardMaterial({ color:0x18191f, metalness:0.3, roughness:0.7 });
  const bronze= new THREE.MeshStandardMaterial({ color:0x8b5e1c, metalness:0.8, roughness:0.2 });
  const purple= new THREE.MeshStandardMaterial({ color:0x7a00ff, metalness:0.95, roughness:0.05, emissive:new THREE.Color(0x3300aa), emissiveIntensity:0.4 });
  if(variant === 'bowie'){   // Bowie sanglante — lame large + crossguard en T + manche en os
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.032,0.012,0.28), steel); blade.position.set(0,0.018,0.18);
    const clip  = new THREE.Mesh(new THREE.BoxGeometry(0.008,0.006,0.06), steel); clip.position.set(-0.010,0.027,0.28); clip.rotation.z=0.4;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.080,0.018,0.016), bronze); guard.position.set(0,0.012,0.035);
    const handle= new THREE.Mesh(new THREE.CylinderGeometry(0.016,0.013,0.12,8), dark); handle.rotation.x=Math.PI/2; handle.position.set(0,0.010,-0.062);
    g.add(blade,clip,guard,handle);
  } else if(variant === 'phantom'){   // Lame Fantôme — dague effilée, lueur violette
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.010,0.32,6), purple); blade.rotation.x=Math.PI/2; blade.position.set(0,0.018,0.20);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.056,0.012,0.012), purple); guard.position.set(0,0.015,0.040);
    const handle= new THREE.Mesh(new THREE.CylinderGeometry(0.011,0.009,0.10,6), dark); handle.rotation.x=Math.PI/2; handle.position.set(0,0.012,-0.050);
    const wrap  = new THREE.Mesh(new THREE.CylinderGeometry(0.013,0.011,0.10,6), purple); wrap.rotation.x=Math.PI/2; wrap.position.set(0,0.012,-0.050); wrap.scale.x=0.3;
    g.add(blade,guard,handle,wrap);
  } else {   // 'basic' — couteau standard
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.022,0.010,0.25), steel); blade.position.set(0,0.018,0.16);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.064,0.016,0.014), steel); guard.position.set(0,0.016,0.035);
    const handle= new THREE.Mesh(new THREE.CylinderGeometry(0.012,0.010,0.11,8), dark); handle.rotation.x=Math.PI/2; handle.position.set(0,0.012,-0.05);
    g.add(blade,guard,handle);
  }
  g.traverse(o=>{ if(o.isMesh) o.castShadow=true; });
  return g;
}
// ====== Nouvelles armes primitives (#49) ======
function buildRaptorMesh(){   // Raptor X5 — fusil assault carré, silencieux
  const g = new THREE.Group();
  const steel= new THREE.MeshStandardMaterial({ color:0x2a2e38, metalness:0.8, roughness:0.4 });
  const tan  = new THREE.MeshStandardMaterial({ color:0x7a6c5a, roughness:0.5 });
  const body  = new THREE.Mesh(new THREE.BoxGeometry(0.056,0.10,0.38), steel); body.position.set(0,0,0.02);
  const barrel= new THREE.Mesh(new THREE.CylinderGeometry(0.013,0.013,0.38,8), steel); barrel.rotation.x=Math.PI/2; barrel.position.set(0,0.025,0.30);
  const supp  = new THREE.Mesh(new THREE.CylinderGeometry(0.020,0.018,0.12,8), tan); supp.rotation.x=Math.PI/2; supp.position.set(0,0.025,0.46);
  const foregrip= new THREE.Mesh(new THREE.BoxGeometry(0.04,0.09,0.05), tan); foregrip.position.set(0,-0.085,0.16); foregrip.rotation.x=0.2;
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.048,0.07,0.16), tan); stock.position.set(0,-0.01,-0.24);
  g.add(body,barrel,supp,foregrip,stock); g.traverse(o=>{ if(o.isMesh) o.castShadow=true; }); return g;
}
function buildCycloneMesh(){   // Cyclone MK3 — assault futuriste, chargeur courbe
  const g = new THREE.Group();
  const steel= new THREE.MeshStandardMaterial({ color:0x1a1e26, metalness:0.9, roughness:0.3 });
  const oran = new THREE.MeshStandardMaterial({ color:0xff6600, emissive:new THREE.Color(0xaa3300), emissiveIntensity:0.3, metalness:0.5, roughness:0.3 });
  const body  = new THREE.Mesh(new THREE.BoxGeometry(0.058,0.11,0.42), steel); body.position.set(0,0,0.02);
  const barrel= new THREE.Mesh(new THREE.CylinderGeometry(0.014,0.014,0.42,8), steel); barrel.rotation.x=Math.PI/2; barrel.position.set(0,0.028,0.32);
  const rail  = new THREE.Mesh(new THREE.BoxGeometry(0.010,0.012,0.40), oran); rail.position.set(0,0.062,0.06);
  const mag   = new THREE.Mesh(new THREE.BoxGeometry(0.048,0.12,0.058), steel); mag.position.set(0,-0.11,-0.01); mag.rotation.x=-0.25;
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.050,0.08,0.18), steel); stock.position.set(0,-0.008,-0.26);
  g.add(body,barrel,rail,mag,stock); g.traverse(o=>{ if(o.isMesh) o.castShadow=true; }); return g;
}
function buildStorm9Mesh(){   // Storm-9 — SMG compact
  const g = new THREE.Group();
  const steel= new THREE.MeshStandardMaterial({ color:0x3a3d48, metalness:0.75, roughness:0.45 });
  const dark = new THREE.MeshStandardMaterial({ color:0x14151a, metalness:0.4, roughness:0.7 });
  const body  = new THREE.Mesh(new THREE.BoxGeometry(0.052,0.09,0.28), steel); body.position.set(0,0,0.02);
  const barrel= new THREE.Mesh(new THREE.CylinderGeometry(0.010,0.010,0.22,8), steel); barrel.rotation.x=Math.PI/2; barrel.position.set(0,0.020,0.22);
  const mag   = new THREE.Mesh(new THREE.BoxGeometry(0.044,0.10,0.045), dark); mag.position.set(0,-0.09,-0.02); mag.rotation.x=-0.15;
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.030,0.008,0.14), steel); stock.position.set(0,-0.004,-0.20); stock.rotation.x=-0.1;
  g.add(body,barrel,mag,stock); g.traverse(o=>{ if(o.isMesh) o.castShadow=true; }); return g;
}
function buildPhantomSrMesh(){   // Phantom L115 — sniper lourd
  const g = new THREE.Group();
  const steel= new THREE.MeshStandardMaterial({ color:0x1c2030, metalness:0.85, roughness:0.3 });
  const dark = new THREE.MeshStandardMaterial({ color:0x0a0a10, metalness:0.4, roughness:0.7 });
  const body  = new THREE.Mesh(new THREE.BoxGeometry(0.060,0.10,0.48), steel); body.position.set(0,0,0.04);
  const barrel= new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,0.60,10), steel); barrel.rotation.x=Math.PI/2; barrel.position.set(0,0.012,0.52);
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.026,0.026,0.18,10), dark); scope.rotation.x=Math.PI/2; scope.position.set(0,0.095,0.06);
  const lens1 = new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,0.015,10), new THREE.MeshStandardMaterial({color:0x0044ff,metalness:1,roughness:0})); lens1.rotation.x=Math.PI/2; lens1.position.set(0,0.095,0.155);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.046,0.09,0.22), dark); stock.position.set(0,-0.02,-0.30);
  const bipo1 = new THREE.Mesh(new THREE.CylinderGeometry(0.006,0.006,0.16,5), dark); bipo1.position.set(-0.03,-0.14,0.38); bipo1.rotation.z=0.25;
  const bipo2 = new THREE.Mesh(new THREE.CylinderGeometry(0.006,0.006,0.16,5), dark); bipo2.position.set( 0.03,-0.14,0.38); bipo2.rotation.z=-0.25;
  g.add(body,barrel,scope,lens1,stock,bipo1,bipo2); g.traverse(o=>{ if(o.isMesh) o.castShadow=true; }); return g;
}
function buildBreacherMesh(){   // Breacher MK2 — shotgun semi-auto
  const g = new THREE.Group();
  const steel= new THREE.MeshStandardMaterial({ color:0x2e3240, metalness:0.65, roughness:0.55 });
  const wood = new THREE.MeshStandardMaterial({ color:0x4e3015, roughness:0.75 });
  const body  = new THREE.Mesh(new THREE.BoxGeometry(0.065,0.11,0.44), steel); body.position.set(0,0,0.02);
  const barrel= new THREE.Mesh(new THREE.CylinderGeometry(0.028,0.028,0.44,10), steel); barrel.rotation.x=Math.PI/2; barrel.position.set(0,0.024,0.30);
  const mag   = new THREE.Mesh(new THREE.CylinderGeometry(0.040,0.038,0.08,8), steel); mag.rotation.x=Math.PI/2; mag.position.set(0,-0.08,-0.04);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.052,0.09,0.18), wood); stock.position.set(0,-0.02,-0.26);
  const pump  = new THREE.Mesh(new THREE.BoxGeometry(0.054,0.050,0.10), wood); pump.position.set(0,-0.055,0.18);
  g.add(body,barrel,mag,stock,pump); g.traverse(o=>{ if(o.isMesh) o.castShadow=true; }); return g;
}
function buildJackalMesh(){   // Jackal-45 — pistolet lourd
  const g = new THREE.Group();
  const steel= new THREE.MeshStandardMaterial({ color:0x1e2128, metalness:0.9, roughness:0.2 });
  const dark = new THREE.MeshStandardMaterial({ color:0x0e0e14, metalness:0.4, roughness:0.7 });
  const body  = new THREE.Mesh(new THREE.BoxGeometry(0.056,0.10,0.20), steel); body.position.set(0,0.005,0.04);
  const barrel= new THREE.Mesh(new THREE.CylinderGeometry(0.016,0.016,0.18,8), steel); barrel.rotation.x=Math.PI/2; barrel.position.set(0,0.030,0.14);
  const comp  = new THREE.Mesh(new THREE.BoxGeometry(0.048,0.024,0.06), steel); comp.position.set(0,0.043,0.20);
  const grip  = new THREE.Mesh(new THREE.BoxGeometry(0.044,0.12,0.060), dark); grip.position.set(0,-0.11,-0.02); grip.rotation.x=0.12;
  g.add(body,barrel,comp,grip); g.traverse(o=>{ if(o.isMesh) o.castShadow=true; }); return g;
}
// auto-découverte d'un .glb dans un dossier (1 niveau de sous-dossiers) — convention assets (#39)
async function findGlbInDir(dir){
  try {
    const entries = await listDir(dir);
    const direct = entries.filter(isGlb); if(direct.length) return dir + direct[0];
    for(const d of entries.filter(h => h.endsWith('/'))){
      try { const sub = (await listDir(dir + d)).filter(isGlb); if(sub.length) return dir + d + sub[0]; } catch(e){}
    }
  } catch(e){}
  return null;
}
async function findWeaponGlb(){ return findGlbInDir(WEAPON_DIR); }
const WEAPON_LEN = 0.62;   // longueur cible du fusil (m)
async function loadWeaponTemplate(weaponId = save.selectedWeapon){
  const w = weaponById(weaponId);
  if(w.glb && !window.__FAST_WEAPON__){                    // seul le fusil de départ a un vrai GLB (tests : évitent le 13 Mo)
    const url = await findWeaponGlb();
    if(url){ try {
      const g = await loader.loadAsync(url);
      g.scene.updateMatrixWorld(true);                     // matrices à jour avant la mesure (bbox fiable)
      const box = new THREE.Box3().setFromObject(g.scene), s = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxd = Math.max(s.x, s.y, s.z) || 1, sc = WEAPON_LEN / maxd;
      g.scene.scale.setScalar(sc);
      g.scene.position.sub(center.multiplyScalar(sc));     // recentrer à l'origine
      g.scene.traverse(o=>{ if(o.isMesh) o.castShadow = true; });
      // axe le plus long = canon ; on le ramène sur +Z (convention du primitive)
      const wrap = new THREE.Group();
      if(s.x >= s.y && s.x >= s.z) g.scene.rotation.y = -Math.PI/2;       // +X -> +Z
      else if(s.y >= s.x && s.y >= s.z) g.scene.rotation.x = Math.PI/2;   // +Y -> +Z
      wrap.add(g.scene);
      weaponSource = 'glb'; return wrap;
    } catch(e){} }
  }
  weaponSource = 'primitive'; return w.build();            // smg/sniper (ou repli) : primitive propre à l'arme
}
let equippedWeaponId = null;
async function ensureWeapon(){
  if(heldWeapon && equippedWeaponId === effectiveWeaponId()){ for(const e of enemies) attachWeaponToEnemy(e); return; }
  if(heldWeapon && heldWeapon.parent) heldWeapon.parent.remove(heldWeapon);   // modèle (ré)attaché plus bas
  heldWeapon = null;
  const weaponChanged = (equippedWeaponId !== effectiveWeaponId());
  if(weaponChanged || !weaponTemplate){           // ne recharge le template (ni le GLB 13 Mo) que si l'arme a changé
    if(viewModel && viewModel.parent) viewModel.parent.remove(viewModel);
    viewModel = null; weaponMuzzleZ = null;
    weaponTemplate = await loadWeaponTemplate(effectiveWeaponId());
    equippedWeaponId = effectiveWeaponId();
  }
  if(model && !heldWeapon) attachWeaponToHand(weaponTemplate);
  for(const e of enemies) attachWeaponToEnemy(e);   // rattrape les ennemis créés avant le chargement
}
function attachWeaponToHand(template){
  if(!model || heldWeapon) return;
  let hand = null;
  model.traverse(o => { if(o.isBone && o.name === 'RightHand') hand = o; });
  if(!hand) model.traverse(o => { if(o.isBone && /righthand|hand_r|rhand/i.test(o.name)) hand = o; });
  if(!hand) return;
  handBoneName = hand.name;
  heldWeapon = template.clone();
  const ws = new THREE.Vector3(); hand.getWorldScale(ws);
  heldWeapon.scale.multiplyScalar(1 / (ws.x || 1));   // garde la normalisation du template
  heldWeapon.position.set(0.0, 0.02, 0.08);
  heldWeapon.rotation.set(Math.PI/2, 0, 0);
  hand.add(heldWeapon);
  if(!viewModel) viewModel = buildViewModel(template);
}
// ====== Arme des ennemis (clone du même template, attachée à RightHand) ======
let weaponMuzzleZ = null;
function weaponBarrelZ(){
  if(weaponMuzzleZ != null) return weaponMuzzleZ;
  if(!weaponTemplate) return 0.45;
  weaponTemplate.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(weaponTemplate);
  weaponMuzzleZ = isFinite(box.max.z) ? box.max.z : 0.45;
  return weaponMuzzleZ;
}
function makeMuzzleFlash(){
  const mat = new THREE.MeshBasicMaterial({ color:0xffd060, transparent:true, opacity:0.95,
    blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), mat);
  m.visible = false; return m;       // normale = +Z (canon) -> fait face au joueur quand l'ennemi tire
}
function attachWeaponToEnemy(e){
  if(!e || !e.alive || e.weapon || !weaponTemplate) return;
  let hand = null;
  e.root.traverse(o => { if(o.isBone && o.name === 'RightHand') hand = o; });
  if(!hand) e.root.traverse(o => { if(o.isBone && /righthand|hand_r|rhand/i.test(o.name)) hand = o; });
  if(!hand) return;
  const wpn = weaponById(e.weaponId || 'default').build();   // arme variée selon le type (#23), primitive légère
  const barrelZ = meshMaxZ(wpn);               // longueur du canon en repère LOCAL (mesuré avant transform/attache)
  const ws = new THREE.Vector3(); hand.getWorldScale(ws);
  wpn.scale.multiplyScalar(1 / (ws.x || 1));   // garde la normalisation du template
  wpn.position.set(0.0, 0.02, 0.08);
  wpn.rotation.set(Math.PI/2, 0, 0);
  wpn.traverse(o => { if(o.isMesh) o.castShadow = true; });
  hand.add(wpn);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, barrelZ); wpn.add(muzzle);
  const flash = makeMuzzleFlash(); muzzle.add(flash);
  wpn.updateMatrixWorld(true);
  e.weapon = wpn; e.muzzle = muzzle; e.muzzleFlash = flash; e.muzzleFlashUntil = 0;
}
function buildViewModel(template){
  const grp = new THREE.Group();
  const wpn = template.clone(); grp.add(wpn);   // l'arme
  grp.traverse(o=>{ if(o.isMesh) o.castShadow = false; });
  if(!cameraInScene){ scene.add(camera); cameraInScene = true; }
  camera.add(grp);
  grp.position.set(0.12, -0.11, -0.34);   // bas-droite devant la caméra
  grp.rotation.set(0.05, Math.PI + 0.12, 0); // canon vers l'avant, légèrement tourné (naturel)
  grp.visible = false;
  if(!armsVM) armsVM = buildArmsViewModel();
  return grp;
}
let armsVM = null;
function buildArmsViewModel(){
  // avant-bras + gants tactiques low-poly, en espace caméra (devant l'objectif), qui tiennent l'arme
  const g = new THREE.Group();
  const sleeve = new THREE.MeshStandardMaterial({ color:0x5b6347, roughness:0.95, metalness:0.0, emissive:0x14160e }); // manche olive (se distingue de l'arme)
  const glove  = new THREE.MeshStandardMaterial({ color:0x33363c, roughness:0.7, metalness:0.2,  emissive:0x0a0b0d }); // gant gris foncé
  const arm = (geo, mat, pos, rot) => { const m = new THREE.Mesh(geo, mat); m.position.set(...pos); m.rotation.set(...rot); return m; };
  // bras droit (main sur la poignée) : remonte du bas-droite
  const rFore = arm(new THREE.CylinderGeometry(0.036, 0.052, 0.26, 10), sleeve, [0.155,-0.205,-0.20], [-0.85, 0.25, 0.35]);
  const rHand = arm(new THREE.BoxGeometry(0.06,0.08,0.10), glove, [0.105,-0.115,-0.31], [-0.5,0.1,0.2]);
  // bras gauche (main sur le garde-main, plus en avant)
  const lFore = arm(new THREE.CylinderGeometry(0.032, 0.046, 0.24, 10), sleeve, [-0.03,-0.185,-0.27], [-1.0, -0.2, -0.3]);
  const lHand = arm(new THREE.BoxGeometry(0.052,0.07,0.085), glove, [0.02,-0.095,-0.42], [-0.4,-0.1,-0.15]);
  g.add(rFore, rHand, lFore, lHand);
  g.traverse(o=>{ if(o.isMesh) o.castShadow = false; });
  camera.add(g); g.visible = false;
  return g;
}
const FOV_BASE = 55, FOV_ADS = 42, FOV_SCOPE = 20, ADS_LERP = 10;
const SNIPER_IDS = new Set(['sniper','phantom_sr']); // Eclipse SR, Phantom L115
function isSniper(){ return SNIPER_IDS.has(effectiveWeaponId()||'default'); }   // #61/#89 : tient compte de l'arme lootée (matchWeaponId) comme isSemiAuto/isLmg
const VM_HIP = new THREE.Vector3(0.12, -0.11, -0.34);   // pose hanche (arme visible en bas-droite)
const VM_ADS = new THREE.Vector3(0.05, -0.26, -0.30);   // pose visée : l'arme plonge -> centre dégagé pour le viseur
let adsT = 0;
function updateWeapon(dt){
  if(weaponRecoil > 0) weaponRecoil = Math.max(0, weaponRecoil - dt*6);
  const aimNow = (G.phase === 'playing' && input.aim) ? 1 : 0;
  adsT += (aimNow - adsT) * Math.min(1, dt*ADS_LERP);
  const scopeOn = isSniper() && adsT > 0.5;
  if(viewModel){
    viewModel.visible = (view === 'first' && G.phase === 'playing' && !scopeOn);
    viewModel.position.lerpVectors(VM_HIP, VM_ADS, adsT);
    viewModel.position.z += weaponRecoil * 0.06;
    viewModel.rotation.set(0.05 + weaponRecoil*0.18 + 0.25*adsT, Math.PI + 0.12*(1-adsT), 0);
  }
  if(armsVM){
    armsVM.visible = (view === 'first' && G.phase === 'playing' && !scopeOn);
    armsVM.position.copy(viewModel.position).sub(VM_HIP);
  }
  if(heldWeapon) heldWeapon.rotation.z = weaponRecoil * 0.2;
  const targetFov = scopeOn ? FOV_SCOPE : FOV_ADS;
  camera.fov = FOV_BASE + (targetFov - FOV_BASE) * adsT; camera.updateProjectionMatrix();
  const scopeEl = document.getElementById('scope-overlay');
  if(scopeEl){ if(scopeOn) scopeEl.classList.add('show'); else scopeEl.classList.remove('show'); }
}
G.debug.sniperScopeActive = () => isSniper() && !!input.aim;
G.debug.forceEquipWeapon = (id) => { save.selectedWeapon = id; persist(); applyWeaponStats(); };
G.debug.weapon = {
  held(){ return !!heldWeapon; }, handBone(){ return handBoneName; }, source(){ return weaponSource; },
  viewmodelVisible(){ return !!(viewModel && viewModel.visible); }, recoil(){ return weaponRecoil; },
  armsVisible(){ return !!(armsVM && armsVM.visible); },
  aiming(){ return !!input.aim; }, adsProgress(){ return adsT; },
  sightVisible(){ return document.getElementById('sight').classList.contains('show'); },
  equippedId(){ return equippedWeaponId; }
};

// ====== Loot d'arme (run-based #23) : ramasser l'arme d'un cadavre pour la partie en cours ======
const PICKUP_R = 2.5;
let matchWeaponId = null;
function effectiveWeaponId(){ return matchWeaponId || save.selectedWeapon; }   // arme du loot (partie) sinon arme de la save
function resetMatchWeapon(){ matchWeaponId = null; }
function nearestPickup(){
  if(!model) return null;
  const px = model.position.x, pz = model.position.z; let best = null, bd = PICKUP_R;
  for(const e of enemies){
    if(e.state !== 'dead' || !e.weaponId || e.looted) continue;
    const d = Math.hypot(px - e.root.position.x, pz - e.root.position.z);
    if(d <= bd){ bd = d; best = e; }
  }
  if(!best) return null;
  const w = weaponById(best.weaponId);
  return { enemyId:best.id, weaponId:best.weaponId, name:w.name, rarity:w.rarity, dist:bd };
}
function pickupWeapon(){
  const p = nearestPickup(); if(!p) return false;
  matchWeaponId = p.weaponId;
  const e = enemies[p.enemyId]; if(e){ e.looted = true; if(e.weapon) e.weapon.visible = false; }   // cadavre vidé (arme prise)
  applyWeaponStats(); ammo = curMag; G.ammo = ammo; reloading = false;   // stats immédiates (le modèle 3D suit, async)
  ensureWeapon(); playSound('reload'); updateCombatHud();
  return true;
}
G.debug.nearestPickup = () => nearestPickup();
G.debug.pickupWeapon = () => pickupWeapon();
G.debug.matchWeapon = () => matchWeaponId;
G.debug.setMatchWeapon = (id) => { matchWeaponId = id; };   // debug : simule une arme lootée (test #61/#89 loot)

// ====== Audio : voir src/game/audio.js ======
G.debug.audio = {
  init(){ initAudio(); }, play(type){ playSound(type); }, muted(){ return isMuted(); }, setMuted(b){ setMuted(b); },
  count(){ return soundCount(); }, last(){ return lastSound(); },
  state(){ return audioState(); }
};

// ====== Assistance de visée (douce, horizontale uniquement) ======
const AIM_ASSIST_ANGLE = 0.18, AIM_ASSIST_RANGE = 30, AIM_ASSIST_GAIN = 6;
function updateAimAssist(dt){
  if(!input.aim || !model || G.phase !== 'playing') return;
  let bestDiff = null, bestAng = AIM_ASSIST_ANGLE;
  for(const e of enemies){
    if(!e.alive) continue;
    const dx = e.root.position.x - model.position.x, dz = e.root.position.z - model.position.z;
    if(Math.hypot(dx, dz) > AIM_ASSIST_RANGE) continue;
    const yawTo = Math.atan2(dx, dz);
    const diff = ((yawTo - camYaw + Math.PI) % (Math.PI*2)) - Math.PI;
    if(Math.abs(diff) < bestAng){ bestAng = Math.abs(diff); bestDiff = diff; }
  }
  if(bestDiff !== null) camYaw += bestDiff * Math.min(1, dt * AIM_ASSIST_GAIN * (1 - bestAng/AIM_ASSIST_ANGLE));
}

// ====== Pet compagnon — chien (spec 2026-07-03) ======
const pet = initPet({
  THREE, scene, loader,
  getPlayerPos: () => model ? model.position : { x:0, y:0, z:0 },
  enemies, damageEnemy,
  obstacles, MAP_HALF, pushOutCircleAABB,
  groundHeight,   // #204 : le chien suit le sol à hauteur variable
  MAP_BOUNDS,     // #205 : bornes par map
  registerFeature,
});
G.debug.petLoaded = () => pet.loaded();
G.debug.petVisible = () => pet.visible();
G.debug.petPos = () => pet.pos();
G.debug.petState = () => pet.state();
G.debug.petAttackCount = () => pet.attackCount();
G.debug.petSetPos = (x, z) => pet.setPos(x, z);
G.debug.petClips = () => pet.clips();
G.debug.petSummon = () => pet.summon();
G.debug.petHp = () => pet.hp();
G.debug.petMaxHp = () => pet.maxHp();
G.debug.petDamage = (n) => pet.damage(n);
G.debug.petDespawnTimeLeft = () => pet.despawnTimeLeft();
G.debug.petForceDespawn = () => pet.forceDespawn();
G.debug.petHeight = () => pet.heightM();

// ====== Boucle ======
const clock = new THREE.Clock();
function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if(G.phase==='playing' && !paused){ updateController(dt); updateCombat(dt); updateEnemies(dt * enemyTimeScale()); updateWaves(dt); updateHealth(dt); updateHealthPacks(dt); updateGrenades(dt); updateFlashbangs(dt); updateSmokes(dt); updateSpawnMarkers(dt); updateImpactSparks(dt); updateMoneyOrbs(dt); updateShockwaves(dt); updatePowerUps(dt); updateAimAssist(dt); updateCamera(dt); updateWeapon(dt); updateSniperLaser(); updateRain(dt); updateOverheat(dt); updateGrenadeArc(); checkEnemyFlanks(); updateRadar(); updateKillstreak(); updateBurstFire(); updateMines(); updateEnemyHpBars(); updatePetHpBar(); updateShield(dt); updateFootsteps(dt); updateEnemyCountHud(); updateAmmoPacks(dt); updateStickyGrenades(dt); updateMedics(dt); updateDecoys(dt); updateEnemyGrenades(dt); updateMolotovs(dt); updateFireZones(dt); updateTurret(dt); updateEmpProjs(dt); updatePoisonZones(dt); updateCarePackage(dt); updateFrostZones(); updateFeatures(dt); }
  else if(G.phase==='lobby'){                                    // turntable : arme en vitrine, sinon perso
    if(shopOpen && shopTab==='weapons'){ if(shopWeaponObj) shopWeaponObj.rotation.y += dt*0.8; }
    else if(shopOpen && shopTab==='player'){ if(shopCharObj) shopCharObj.rotation.y += dt*0.7; }   // perso centré tourne (#25)
    else if(model){ model.rotation.y += dt*0.6; }
  }
  if(mixer) mixer.update(dt);
  if(shopOpen && shopTab==='player') shopCharMixers.forEach(mx => mx.update(dt));   // #52 : persos vitrine animés
  renderer.render(scene, camera);
}
animate();
G.booted = true;

addEventListener('resize', () => {
  camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
