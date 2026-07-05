// Pet compagnon — chien de guerre (spec 2026-07-05). Devenu un bonus du système de loadout (#156) :
// n'apparaît QUE via invocation (loadout sélectionné + points au seuil + touche 4, ou __game.debug.petSummon()
// en direct pour les tests qui exercent le comportement du chien plutôt que le câblage loadout).
// Mode __FAST_PET__ = primitive (pattern __FAST_WEAPON__) sauf le test dédié au GLB réel.
import { test, expect } from '@playwright/test';
import { startPlaying } from './helpers.js';

async function startWithFastPet(page){
  await page.addInitScript(() => { window.__FAST_PET__ = true; });
  await startPlaying(page);
}

test('chien non invoque par defaut (aucun compagnon permanent)', async ({ page }) => {
  await startWithFastPet(page);
  expect(await page.evaluate(() => __game.debug.petVisible())).toBe(false);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.petVisible())).toBe(false);
});

test('invocation via le loadout (selection + seuil de points + touche 4)', async ({ page }) => {
  await startWithFastPet(page);
  const res = await page.evaluate(() => {
    __game.debug.toggleLoadoutBonus('dog');                       // ajoute 'dog' aux 3 slots (ejecte le plus ancien)
    for(let i=0;i<9;i++) __game.debug.registerLoadoutKill();      // 9 x 100 = 900 pts = seuil du chien
    const ready = __game.debug.loadoutReady('dog');
    const ok = __game.debug.triggerLoadoutBonus('dog');
    return { ready, ok };
  });
  expect(res.ready).toBe(true);
  expect(res.ok).toBe(true);
  expect(await page.evaluate(() => __game.debug.petVisible())).toBe(true);
  expect(await page.evaluate(() => __game.debug.petHp())).toBe(await page.evaluate(() => __game.debug.petMaxHp()));
});

test('chien invoque : suit le joueur', async ({ page }) => {
  await startWithFastPet(page);
  const d0 = await page.evaluate(() => {
    __game.debug.petSummon();
    for(let i=0;i<5;i++) __game.debug.moveEnemy(i, 40, 40);   // aucun ennemi a portee de detection
    __game.debug.setPos(0, 0);
    __game.debug.petSetPos(6, 6);
    const p = __game.position(), q = __game.debug.petPos();
    return Math.hypot(p.x - q.x, p.z - q.z);
  });
  await page.waitForFunction((d0) => {
    const p = __game.position(), q = __game.debug.petPos();
    return Math.hypot(p.x - q.x, p.z - q.z) < d0 - 3;
  }, d0, { timeout: 30000 });
  expect(await page.evaluate(() => __game.debug.petState())).toBe('follow');
});

test('chien invoque : attaque un ennemi proche et lui inflige des degats', async ({ page }) => {
  await startWithFastPet(page);
  const hp0 = await page.evaluate(() => {
    __game.debug.petSummon();
    __game.debug.setEnemyAccuracy(0);
    __game.debug.setPos(-6, 0);
    for(let i=1;i<5;i++) __game.debug.moveEnemy(i, 40, 40);
    __game.debug.spawnEnemyTypeAt(0, 'shooter', 4.8, 0);
    __game.debug.petSetPos(4, 0);
    return __game.debug.enemyHp(0);
  });
  await page.waitForFunction(() => __game.debug.petAttackCount() > 0, null, { timeout: 15000 });
  await page.waitForFunction(
    (hp0) => !__game.debug.enemyAlive(0) || __game.debug.enemyHp(0) < hp0,
    hp0, { timeout: 5000 });
});

test('chien invoque : peut mourir (PV a 0 -> disparait)', async ({ page }) => {
  await startWithFastPet(page);
  await page.evaluate(() => __game.debug.petSummon());
  expect(await page.evaluate(() => __game.debug.petVisible())).toBe(true);
  await page.evaluate(() => __game.debug.petDamage(9999));   // simule la riposte cumulee (deterministe, sans depenre du timing de combat)
  expect(await page.evaluate(() => __game.debug.petHp())).toBe(0);
  expect(await page.evaluate(() => __game.debug.petVisible())).toBe(false);
});

test('chien invoque : disparait tout seul si le timer de despawn expire sans avoir ete tue', async ({ page }) => {
  await startWithFastPet(page);
  await page.evaluate(() => __game.debug.petSummon());
  expect(await page.evaluate(() => __game.debug.petVisible())).toBe(true);
  await page.evaluate(() => __game.debug.petForceDespawn());
  await page.waitForFunction(() => __game.debug.petVisible() === false, null, { timeout: 5000 });
  expect(await page.evaluate(() => __game.debug.petHp())).toBeGreaterThan(0);   // disparu, pas tue
});

test('chien invoque : masque au retour menu, plus invoque automatiquement au restart', async ({ page }) => {
  await startWithFastPet(page);
  await page.evaluate(() => __game.debug.petSummon());
  expect(await page.evaluate(() => __game.debug.petVisible())).toBe(true);
  await page.evaluate(() => __game.debug.backToHome());
  expect(await page.evaluate(() => __game.debug.petVisible())).toBe(false);
  await page.evaluate(() => __game.debug.start(0));
  await page.waitForFunction(() => window.__game.phase === 'playing', null, { timeout: 20000 });
  expect(await page.evaluate(() => __game.debug.petVisible())).toBe(false);   // ne revient plus tout seul (#156/#201)
});

test('chien : le GLB reel expose Walk_Cycle/Attack_Paw et une taille coherente (~moitie du joueur)', async ({ page }) => {
  await startPlaying(page);                                    // PAS de __FAST_PET__ : vrai chargement
  await page.waitForFunction(() => __game.debug.petLoaded(), null, { timeout: 30000 });
  const clips = await page.evaluate(() => __game.debug.petClips());
  expect(clips).toContain('Walk_Cycle');
  expect(clips).toContain('Attack_Paw');
  await page.evaluate(() => __game.debug.petSummon());
  const h = await page.evaluate(() => __game.debug.petHeight());
  expect(h).toBeGreaterThan(0.9 * 0.6);   // tolerance large : rig reel, pas une primitive exacte
  expect(h).toBeLessThan(0.9 * 1.4);
});
