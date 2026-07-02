// Helpers purs du jeu (aucun état de module) — testés via __game.debug.
import * as THREE from 'three';

export function worldPos(o){ const v=new THREE.Vector3(); o.getWorldPosition(v); return {x:v.x,y:v.y,z:v.z}; }

export function cameraRelative(input, yaw){
  const f = input.forward||0, s = input.strafe||0;
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  // avant = (sin,cos) ; droite = (cos,-sin)
  return { x: sin*f + cos*s, z: cos*f - sin*s };
}

const WALK_EPS = 0.05;
export function locomotionState(speed, sprint){
  if (speed < WALK_EPS) return 'idle';
  return sprint ? 'run' : 'walk';
}

const ROLE_RE = { idle:/alert|idle|wait/i, walk:/walk|march/i, run:/run|sprint|course/i, attack:/attack|combat|punch|hit|skill/i, dead:/dead|death|die|mort/i };
export function resolveClipRole(role, names){
  const re = ROLE_RE[role]; if (!re) return null;
  return names.find(n => re.test(n)) || null;
}

export function pushOutCircleAABB(px, pz, r, box){
  const cx = Math.max(box.minX, Math.min(px, box.maxX));
  const cz = Math.max(box.minZ, Math.min(pz, box.maxZ));
  const dx = px - cx, dz = pz - cz;
  const d2 = dx*dx + dz*dz;
  if (d2 >= r*r) return { x:px, z:pz };           // pas de pénétration
  if (d2 > 1e-12){                                 // dehors en distance, on pousse le long de la normale
    const d = Math.sqrt(d2); const nx = dx/d, nz = dz/d;
    return { x: cx + nx*r, z: cz + nz*r };
  }
  // centre dans la boîte : pousser sur l'axe de moindre pénétration
  const pen = [
    { v: px - box.minX + r, x: box.minX - r, z: pz }, // vers -X
    { v: box.maxX - px + r, x: box.maxX + r, z: pz }, // vers +X
    { v: pz - box.minZ + r, x: px, z: box.minZ - r }, // vers -Z
    { v: box.maxZ - pz + r, x: px, z: box.maxZ + r }, // vers +Z
  ].sort((a,b)=>a.v-b.v)[0];
  return { x: pen.x, z: pen.z };
}
