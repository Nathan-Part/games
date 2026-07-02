// Retargeting d'animations en espace-monde — module commun à game.html et app.html.
// L'algorithme est insensible aux différences d'axes locaux entre rigs (quaternions monde).
import * as THREE from 'three';

// Pose de repos locale de chaque os { name: { q, p } }.
export function captureRest(root) {
  const map = {};
  root.traverse(o => { if (o.isBone) map[o.name] = { q: o.quaternion.clone(), p: o.position.clone() }; });
  return map;
}

// Quaternions monde de la pose de repos { name: q }.
export function captureRestWorld(root) {
  root.updateMatrixWorld(true);
  const map = {}; const q = new THREE.Quaternion();
  root.traverse(o => { if (o.isBone) { o.getWorldQuaternion(q); map[o.name] = q.clone(); } });
  return map;
}

// Liste ordonnée des os (parents avant enfants) { name, parent }.
export function boneOrder(root) {
  const list = [];
  root.traverse(o => { if (o.isBone) list.push({ name: o.name, parent: (o.parent && o.parent.isBone) ? o.parent.name : null }); });
  return list;
}

// Applique un clip du rig source au rig cible décrit par ctx :
// { sourceModel, sourceBoneByName, sourceRest, sourceRestWorld,
//   targetRest, targetRestWorld, targetBoneOrder, rootBone }
export function retargetClipWorld(raw, ctx) {
  const { sourceModel, sourceBoneByName, sourceRest, sourceRestWorld,
          targetRest, targetRestWorld, targetBoneOrder, rootBone } = ctx;
  const dur = raw.duration;
  const n = Math.max(2, Math.round(dur * 30) + 1);
  const srcMixer = new THREE.AnimationMixer(sourceModel);
  srcMixer.clipAction(raw).play();

  const samples = {}; for (const b of targetBoneOrder) samples[b.name] = [];
  const times = [];
  const qWsrc = new THREE.Quaternion(), tmp = new THREE.Quaternion();
  const tgtWorld = {};

  for (let f = 0; f < n; f++) {
    const t = (f / (n - 1)) * dur;
    times.push(t);
    srcMixer.setTime(t);
    sourceModel.updateMatrixWorld(true);
    for (const b of targetBoneOrder) {
      const sBone = sourceBoneByName[b.name];
      const sRW = sourceRestWorld[b.name], tRW = targetRestWorld[b.name];
      if (!sBone || !sRW || !tRW) { samples[b.name].push(null); continue; }
      sBone.getWorldQuaternion(qWsrc);
      tmp.copy(qWsrc).multiply(sRW.clone().invert()).multiply(tRW);     // qWsrc · sRW⁻¹ · tRW
      tgtWorld[b.name] = tmp.clone();
      const localQ = b.parent && tgtWorld[b.parent]
        ? tgtWorld[b.parent].clone().invert().multiply(tmp)
        : tmp.clone();
      samples[b.name].push(localQ);
    }
  }
  srcMixer.stopAllAction();

  const tracks = [];
  const timesArr = Float32Array.from(times);
  for (const name in samples) {
    const arr = samples[name];
    if (!arr.length || arr.some(q => !q)) continue;
    const vals = new Float32Array(arr.length * 4);
    for (let i = 0; i < arr.length; i++) { const q = arr[i]; vals[i*4]=q.x; vals[i*4+1]=q.y; vals[i*4+2]=q.z; vals[i*4+3]=q.w; }
    tracks.push(new THREE.QuaternionKeyframeTrack(name + '.quaternion', timesArr, vals));
  }
  // bassin : seulement le rebond vertical, recentré X/Z (anim sur place)
  const hp = raw.tracks.find(tt => tt.name === rootBone + '.position');
  const sP = sourceRest[rootBone]?.p, tP = targetRest[rootBone]?.p;
  if (hp && sP && tP) {
    const ratio = sP.y ? tP.y / sP.y : 1;
    const vals = Float32Array.from(hp.values);
    for (let i = 0; i < vals.length; i += 3) { vals[i] = tP.x; vals[i+1] = tP.y + (vals[i+1] - sP.y) * ratio; vals[i+2] = tP.z; }
    tracks.push(new THREE.VectorKeyframeTrack(rootBone + '.position', Array.from(hp.times), vals));
  }
  return new THREE.AnimationClip(raw.name, raw.duration, tracks);
}
