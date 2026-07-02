// Helpers partagés par tous les fichiers de tests (extraits de l'ancien game.spec.js).

// Collecte les erreurs console/page pour les assertions « pas d'erreur ».
export function trackErrors(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  return errors;
}

export async function startPlaying(page){
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; }); // arme primitive (rapide) sauf test dédié
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.characters?.length >= 1, null, {timeout:20000});
  await page.evaluate(() => __game.debug.start(0));
  await page.waitForFunction(() => window.__game.phase === 'playing', null, {timeout:20000});
}

// Place l'ennemi 0 à portée de mêlée face au joueur, les autres au loin (#148).
export async function faceEnemyForMelee(page){
  await page.evaluate(() => {
    for(let i=0;i<3;i++) __game.debug.moveEnemy(i,40,40);
    __game.debug.setPos(0,0); __game.debug.setYaw(0); __game.debug.setPitch(0); __game.debug.setView('first');
    __game.debug.moveEnemy(0,0,2); __game.debug.setPaused(true);
  });
}

// Aligne les ennemis 0 et 1 devant le joueur (tests de tir traversant #150).
export async function alignTwoEnemies(page){
  await page.evaluate(() => {
    __game.debug.setPos(0,0); __game.debug.setYaw(0); __game.debug.setPitch(0); __game.debug.setView('first');
    __game.debug.moveEnemy(0,0,3); __game.debug.moveEnemy(1,0,6); __game.debug.moveEnemy(2,40,40);
    __game.debug.setPaused(true);
  });
}

// Respawn l'ennemi 0 à portée de couteau puis frappe, en réessayant jusqu'à ce que le cooldown
// couteau (0,6s de temps de JEU, dt clampé) soit retombé. Sous SwiftShader le temps réel nécessaire
// varie fortement avec la charge CPU (observé de ~1,5s à ~3,5s+) — un délai fixe est donc fragile ;
// on scrute au lieu de deviner un délai. Retourne true dès qu'un coup porte (throw si jamais atteint).
export async function meleeKillWhenReady(page, { tries = 60, intervalMs = 200 } = {}){
  for (let i = 0; i < tries; i++) {
    const hit = await page.evaluate(() => {
      __game.debug.spawnEnemyTypeAt(0, 'shooter', 0, 2);
      return __game.debug.playerMelee();
    });
    if (hit) return true;
    await page.waitForTimeout(intervalMs);
  }
  throw new Error('meleeKillWhenReady: cooldown couteau jamais retombé après ' + (tries * intervalMs) + 'ms');
}
