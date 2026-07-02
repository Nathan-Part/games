// Audio (synthèse Web Audio, aucun fichier).
// Seule dépendance externe : le volume des réglages, injecté via bindAudioVolume().
let actx = null, masterGain = null, muted = false; const soundLog = [];
let volumeSource = () => 1;

export function bindAudioVolume(fn){ volumeSource = fn; }

export function initAudio(){
  if(actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = actx.createGain(); masterGain.gain.value = muted ? 0 : volumeSource(); masterGain.connect(actx.destination);
  } catch(e){ actx = null; }
}
export function resumeAudio(){ try { if(actx && actx.state === 'suspended') actx.resume(); } catch(e){} }

function tone(freq, dur, type, vol, glideTo){
  const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
  o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
  if(glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(masterGain); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol, filterFreq){
  const n = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(1, n, actx.sampleRate);
  const d = buf.getChannelData(0); for(let i=0;i<n;i++) d[i] = (Math.random()*2-1);
  const src = actx.createBufferSource(); src.buffer = buf;
  const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq || 1800;
  const g = actx.createGain(), t = actx.currentTime;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(masterGain); src.start(t); src.stop(t + dur);
}

export function playSound(type){
  if(muted || !actx) return;
  soundLog.push(type);
  try {
    switch(type){
      case 'shot':      noise(0.08, 0.6, 2200); tone(180, 0.07, 'square', 0.25, 60); break;
      case 'enemyShot': noise(0.07, 0.35, 1200); tone(120, 0.07, 'square', 0.18, 50); break;
      case 'hit':       tone(900, 0.06, 'triangle', 0.4, 1300); break;
      case 'enemyDie':  tone(220, 0.35, 'sawtooth', 0.45, 60); noise(0.18, 0.3, 700); break;
      case 'playerHit': tone(110, 0.18, 'sine', 0.6, 70); break;
      case 'gameover':  tone(440, 0.9, 'sine', 0.5, 90); break;
      case 'reload':    noise(0.03, 0.3, 2500); setTimeout(() => { try{ noise(0.03, 0.3, 2500); }catch(e){} }, 120); break;
      case 'melee':     noise(0.09, 0.10, 5000); tone(90, 0.12, 'sawtooth', 0.35, 180); break;
    }
  } catch(e){}
}

// ton brut sécurisé (clic à vide #106, footsteps #86)
export function playTone(freq, dur, type, vol, glideTo){ if(muted || !actx) return; try{ tone(freq, dur, type, vol, glideTo); }catch(e){} }

export function setMuted(b){ muted = !!b; if(masterGain) masterGain.gain.value = muted ? 0 : volumeSource(); }
export function isMuted(){ return muted; }
export function applyVolume(){ if(masterGain && !muted) masterGain.gain.value = volumeSource(); }   // mute prioritaire
export function audioGain(){ return masterGain ? masterGain.gain.value : null; }
export function audioState(){ return actx ? actx.state : 'none'; }
export function soundCount(){ return soundLog.length; }
export function lastSound(){ return soundLog[soundLog.length-1] || null; }
