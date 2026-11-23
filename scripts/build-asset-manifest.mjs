// Generates asset-manifest.json: the list of files in every asset folder.
// The game reads folder listings to discover characters, animations and models;
// static hosts such as GitHub Pages don't provide listings, so listDir() falls back to this file.
// Usage: node scripts/build-asset-manifest.mjs
import { readdirSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';

const ROOTS = ['perso', 'animation', 'artefact', 'decor', 'pets', 'assets'];
const manifest = {};

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter(e => !e.name.startsWith('.'))
    .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0)); // same order as python -m http.server
  // same shape as a server listing: URL-encoded names, folders end with "/"
  manifest[dir + '/'] = entries.map(e => encodeURIComponent(e.name) + (e.isDirectory() ? '/' : ''));
  for (const e of entries) if (e.isDirectory()) walk(posix.join(dir, e.name));
}

for (const root of ROOTS) {
  try { walk(root); } catch (err) { if (err.code !== 'ENOENT') throw err; }
}
writeFileSync('asset-manifest.json', JSON.stringify(manifest, null, 1) + '\n');
console.log(`asset-manifest.json: ${Object.keys(manifest).length} folders`);
