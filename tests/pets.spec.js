// Pet compagnon — chien (spec 2026-07-03). Machine à états idle/follow/chase/attack,
// suit le joueur, attaque les ennemis proches avec Attack_Paw. Mode __FAST_PET__ = primitive
// (pattern __FAST_WEAPON__) sauf le test dédié au GLB réel.
import { test, expect } from '@playwright/test';
import { startPlaying } from './helpers.js';

async function startWithFastPet(page){
  await page.addInitScript(() => { window.__FAST_PET__ = true; });
  await startPlaying(page);
}

test('pet : apparaît en partie près du joueur', async ({ page }) => {
  await startWithFastPet(page);
  expect(await page.evaluate(() => __game.debug.petLoaded())).toBe(true);
  expect(await page.evaluate(() => __game.debug.petVisible())).toBe(true);
  const d = await page.evaluate(() => {
    const p = __game.position(), q = __game.debug.petPos();
    return Math.hypot(p.x - q.x, p.z - q.z);
  });
  expect(d).toBeLessThan(4);
});

test('pet : suit le joueur quand il est loin', async ({ page }) => {
  await startWithFastPet(page);
  const d0 = await page.evaluate(() => {
    for(let i=0;i<5;i++) __game.debug.moveEnemy(i, 40, 40);   // aucun ennemi à portée de détection
    __game.debug.setPos(0, 0);
    __game.debug.petSetPos(6, 6);
    const p = __game.position(), q = __game.debug.petPos();
    return Math.hypot(p.x - q.x, p.z - q.z);
  });
  // SwiftShader tourne à quelques fps (dt clampé 0,05) → le temps de JEU s'écoule bien plus
  // lentement que le temps réel : on vérifie un rapprochement net (≥3 m), pas l'arrivée complète.
  await page.waitForFunction((d0) => {
    const p = __game.position(), q = __game.debug.petPos();
    return Math.hypot(p.x - q.x, p.z - q.z) < d0 - 3;
  }, d0, { timeout: 30000 });
  expect(await page.evaluate(() => __game.debug.petState())).toBe('follow');
  expect(await page.evaluate(() => __game.debug.petAttackCount())).toBe(0);
});

test('pet : attaque un ennemi proche et lui inflige des dégâts', async ({ page }) => {
  await startWithFastPet(page);
  const hp0 = await page.evaluate(() => {
    __game.debug.setEnemyAccuracy(0);
    __game.debug.setPos(-6, 0);                                // joueur à l'écart
    for(let i=1;i<5;i++) __game.debug.moveEnemy(i, 40, 40);
    __game.debug.spawnEnemyTypeAt(0, 'shooter', 4.8, 0);       // cible à portée de détection du pet
    __game.debug.petSetPos(4, 0);
    return __game.debug.enemyHp(0);
  });
  await page.waitForFunction(() => __game.debug.petAttackCount() > 0, null, { timeout: 15000 });
  await page.waitForFunction(
    (hp0) => !__game.debug.enemyAlive(0) || __game.debug.enemyHp(0) < hp0,
    hp0, { timeout: 5000 });
});

test('pet : masqué au retour menu, replacé au restart', async ({ page }) => {
  await startWithFastPet(page);
  await page.evaluate(() => __game.debug.backToHome());
  expect(await page.evaluate(() => __game.debug.petVisible())).toBe(false);
  await page.evaluate(() => __game.debug.start(0));
  await page.waitForFunction(() => window.__game.phase === 'playing', null, { timeout: 20000 });
  expect(await page.evaluate(() => __game.debug.petVisible())).toBe(true);
  const d = await page.evaluate(() => {
    const p = __game.position(), q = __game.debug.petPos();
    return Math.hypot(p.x - q.x, p.z - q.z);
  });
  expect(d).toBeLessThan(4);
});

test('pet : le GLB réel expose Walk_Cycle et Attack_Paw', async ({ page }) => {
  await startPlaying(page);                                    // PAS de __FAST_PET__ : vrai chargement
  await page.waitForFunction(() => __game.debug.petLoaded(), null, { timeout: 30000 });
  const clips = await page.evaluate(() => __game.debug.petClips());
  expect(clips).toContain('Walk_Cycle');
  expect(clips).toContain('Attack_Paw');
});
