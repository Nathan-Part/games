// Filet de sécurité animation : détecte toute régression qui figerait les anims (T-pose / boucle plantée)
const { test, expect } = require('@playwright/test');
async function startPlaying(page){
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.characters?.length >= 1, null, { timeout:20000 });
  await page.evaluate(() => { window.__FAST_WEAPON__ = true; });
  await page.evaluate(() => __game.debug.start(0));
  await page.waitForFunction(() => window.__game.phase === 'playing', null, { timeout:20000 });
}
test('ANIM : un ennemi normal anime (os bougent dans le temps)', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 4, 4));
  const s1 = await page.evaluate(() => __game.debug.enemyBoneSig(0));
  await page.waitForTimeout(600);
  const s2 = await page.evaluate(() => __game.debug.enemyBoneSig(0));
  expect(errs).toEqual([]);
  expect(s1).not.toBeNull();
  expect(s2).not.toBe(s1);
});
test('ANIM : un renfort (#84) anime ET la boucle survit (pas d erreur JS)', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await startPlaying(page);
  const before = await page.evaluate(() => __game.debug.enemyCount());
  await page.evaluate(() => __game.debug.forceCallReinforcement(0));
  await page.waitForTimeout(200);
  const r1 = await page.evaluate(i => __game.debug.enemyBoneSig(i), before);
  await page.waitForTimeout(600);
  const r2 = await page.evaluate(i => __game.debug.enemyBoneSig(i), before);
  expect(errs).toEqual([]);
  expect(r2).not.toBe(r1);
});
test('ANIM : l animation de mort joue (os bougent apres le kill)', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 4, 4));
  await page.waitForTimeout(100);
  const alive = await page.evaluate(() => __game.debug.enemyBoneSig(0));
  await page.evaluate(() => __game.debug.damageEnemy(0, 99999));
  const d1 = await page.evaluate(() => __game.debug.enemyBoneSig(0));
  await page.waitForTimeout(300);
  const d2 = await page.evaluate(() => __game.debug.enemyBoneSig(0));
  await page.waitForTimeout(600);
  const d3 = await page.evaluate(() => __game.debug.enemyBoneSig(0));
  expect(errs).toEqual([]);
  expect(await page.evaluate(() => __game.debug.enemyState(0))).toBe('dead');
  expect(alive === d1 && d1 === d2 && d2 === d3).toBe(false); // tout identique = aucune anim (T-pose figée) = bug
});
