// Découverte des assets (listing HTTP) + galerie de personnages partagée.
import { dbAll, dbGet, dbPut } from '../shared/db.js';

export const ANIM_DIR = 'animation/', PERSO_DIR = 'perso/';

// jolis libellés / icônes dérivés du nom de fichier d'animation
const ICONS = [
  [/walk|march/i, '🚶'], [/run|course|sprint/i, '🏃'], [/dance|danse/i, '💃'],
  [/box|punch|combo|attack|attaque/i, '🥊'], [/skill|comp/i, '✨'], [/alert/i, '⚠️'],
  [/agree|gesture|approuv/i, '👍'], [/idle|wait/i, '🧍'],
];
export const iconFor = s => (ICONS.find(([re]) => re.test(s)) || [null, '▶'])[1];
export function animKeyFromFile(fname) {
  const base = decodeURIComponent(fname).replace(/\.glb$/i, '');
  const m = base.match(/_Animation_(.+?)_withSkin$/i) || base.match(/_Animation_(.+)$/i);
  return (m ? m[1] : base);
}
export const prettyLabel = k => k.replace(/[_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();

// ====== Découverte par listing de dossier (serveur HTTP) ======
// 1) listing HTML du serveur (Apache, python -m http.server) ;
// 2) repli sur asset-manifest.json (généré par scripts/build-asset-manifest.mjs) pour les
//    hébergeurs statiques sans listing de dossiers, comme GitHub Pages.
let manifestPromise = null;
function loadAssetManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(new URL('asset-manifest.json', document.baseURI))
      .then(r => (r.ok ? r.json() : null)).catch(() => null);
  }
  return manifestPromise;
}
function manifestKey(url) {
  const root = new URL('./', document.baseURI).href;
  const abs = new URL(url, document.baseURI).href;
  if (!abs.startsWith(root)) return null;
  let rel = decodeURIComponent(abs.slice(root.length));
  if (rel && !rel.endsWith('/')) rel += '/';
  return rel;
}
export async function listDir(url) {
  let status = 'erreur réseau';
  try {
    const res = await fetch(url);
    status = 'HTTP ' + res.status;
    if (res.ok) {
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const links = [...doc.querySelectorAll('a')]
        .map(a => a.getAttribute('href'))
        .filter(h => h && !h.startsWith('/') && !h.startsWith('?') && !h.includes('://') && h !== '../');
      if (links.length) return links;
    }
  } catch (e) { /* pas de listing : on tente le manifeste */ }
  const manifest = await loadAssetManifest();
  const key = manifestKey(url);
  if (manifest && key !== null && Array.isArray(manifest[key])) return manifest[key];
  throw new Error('Listing indisponible pour ' + url + ' (' + status + ', absent du manifeste)');
}
export const isGlb = h => /\.glb$/i.test(h);
export const isImg = h => /\.(png|jpe?g|webp|gif)$/i.test(h);

export async function urlToDataURL(url){ try{ const blob=await (await fetch(url)).blob();
  return await new Promise(r=>{ const fr=new FileReader(); fr.onload=()=>r(fr.result); fr.onerror=()=>r(''); fr.readAsDataURL(blob); }); }catch(e){ return ''; } }

// Ajoute les persos de /perso à la galerie partagée (idempotent : seulement si absents)
export async function seedPersosToGallery() {
  let dirs;
  try { dirs = (await listDir(PERSO_DIR)).filter(h => h.endsWith('/')); } catch (e) { return; }
  for (const d of dirs) {
    const pid = decodeURIComponent(d.replace(/\/$/, ''));
    const id = 'perso:' + pid;
    if (await dbGet(id)) continue;
    let files; try { files = await listDir(PERSO_DIR + d); } catch (e) { continue; }
    const glb = files.find(isGlb); if (!glb) continue;
    const img = files.find(isImg);
    try {
      const bytes = await (await fetch(PERSO_DIR + d + glb)).arrayBuffer();
      const thumb = img ? await urlToDataURL(PERSO_DIR + d + img) : '';
      await dbPut({ id, name: prettyLabel(pid), format: 'glb', bytes, thumb, ts: 0, source: 'perso', date: 'dossier /perso' });
    } catch (e) { console.warn('seed perso KO', d, e); }
  }
}

// Personnages = enregistrements de la galerie (perso auto-ajoutés + sauvegardes studio)
export async function loadCharactersFromGallery() {
  const recs = await dbAll();
  recs.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return recs.map(r => ({ id: String(r.id), label: r.name || 'modèle', thumbUrl: r.thumb || null, bytes: r.bytes, gameReady: !!r.gameReady }));
}
