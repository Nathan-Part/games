import { test, expect } from '@playwright/test';
import { trackErrors, startPlaying, faceEnemyForMelee, alignTwoEnemies } from './helpers.js';

test('vagues : tuer 1 ennemi sur 3 ne le fait pas reapparaitre (plus de respawn auto)', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  const s0 = await page.evaluate(() => __game.score);
  await page.evaluate(() => __game.debug.damageEnemy(0, 50));
  expect(await page.evaluate(() => __game.debug.enemyHp(0))).toBe(50);
  expect(await page.evaluate(() => __game.debug.enemyAlive())).toBe(3);   // pas encore mort (100 PV)
  await page.evaluate(() => __game.debug.damageEnemy(0, 50));            // total 100 => mort
  expect(await page.evaluate(() => __game.debug.enemyAlive())).toBe(2);   // reste mort (2 vivants)
  expect(await page.evaluate(() => __game.score)).toBe(s0 + 1);          // +1 score
  expect(await page.evaluate(() => __game.debug.enemyState(0))).toBe('dead');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => __game.debug.enemyAlive())).toBe(2);  // toujours 2 (pas de respawn auto)
  expect(await page.evaluate(() => __game.wave)).toBe(1);                // vague pas finie
});

test('vagues : la partie demarre vague 1 avec 3 ennemis a 100 PV', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  expect(await page.evaluate(() => __game.wave)).toBe(1);
  expect(await page.evaluate(() => __game.bestWave)).toBe(1);
  expect(await page.evaluate(() => __game.debug.waveState())).toBe('active');
  expect(await page.evaluate(() => __game.debug.enemyHp(0))).toBe(100);
});

test('vagues : nettoyer une vague enchaine sur la suivante (plus nombreuse, record +1)', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await page.evaluate(() => __game.debug.killAllEnemies());
  expect(await page.evaluate(() => __game.debug.waveState())).toBe('cleared');
  // enchaînement naturel après l'intermission (≤ WAVE_INTERMISSION + marge)
  await page.waitForFunction(() => __game.wave === 2, null, { timeout:8000 });
  expect(await page.evaluate(() => __game.debug.waveState())).toBe('active');
  expect(await page.evaluate(() => __game.debug.enemyCount())).toBe(4);   // enemiesForWave(2)
  expect(await page.evaluate(() => __game.debug.enemyHp(0))).toBe(118);   // enemyHpForWave(2) = round(100*1.18^1)
  expect(await page.evaluate(() => __game.bestWave)).toBe(2);             // record
});

test('vagues : forceNextWave saute l intermission (debug)', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await page.evaluate(() => __game.debug.forceNextWave());
  expect(await page.evaluate(() => __game.wave)).toBe(2);
  expect(await page.evaluate(() => __game.debug.enemyCount())).toBe(4);
});

test('vagues : le HUD affiche la vague et le nombre d ennemis', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await expect(page.locator('#wave-hud')).toBeVisible();
  await expect(page.locator('#wave-hud')).toContainText('Vague 1');
  await expect(page.locator('#wave-hud')).toContainText('3');
});

test('vagues : enemiesForWave et enemyHpForWave croissent et sont plafonnées', async ({ page }) => {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.booted);
  const n = (w) => page.evaluate(ww => __game.debug.enemiesForWave(ww), w);
  const hp = (w) => page.evaluate(ww => __game.debug.enemyHpForWave(ww), w);
  expect(await n(1)).toBe(3);                 // compat : vague 1 = 3 ennemis
  expect(await n(2)).toBe(4);
  expect(await n(2)).toBeGreaterThan(await n(1));
  expect(await n(99)).toBe(7);                // plafond MAX_PER_WAVE
  expect(await hp(1)).toBe(100);              // compat : 100 PV vague 1
  expect(await hp(3)).toBeGreaterThan(await hp(1));  // plus coriaces
});

// ====== Tranche 31 : vagues de boss ======

test('boss : isBossWave tous les 5 niveaux', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const f = (w) => page.evaluate(x => __game.debug.isBossWave(x), w);
  for(const w of [5,10,15]) expect(await f(w)).toBe(true);
  for(const w of [1,4,6,9]) expect(await f(w)).toBe(false);
});

test('boss : composition de la vague 5 (boss + sbires)', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const c5 = await page.evaluate(() => __game.debug.waveComposition(5));
  expect(c5[0]).toBe('boss'); expect(c5.length).toBe(3);
  const c4 = await page.evaluate(() => __game.debug.waveComposition(4));
  expect(c4).not.toContain('boss');
});

test('boss : la vague 5 fait apparaitre un boss vivant', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forceWave(5));
  expect(await page.evaluate(() => __game.debug.bossAlive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.bossHpFrac())).toBeGreaterThan(0.9);
  const types = await page.evaluate(() => { const n = __game.debug.enemyCount(); const a=[]; for(let i=0;i<n;i++) a.push(__game.debug.enemyType(i)); return a; });
  expect(types).toContain('boss');
});

test('boss : HUD visible en vague de boss, masque apres', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forceWave(5));
  await expect(page.locator('#boss-hud')).toBeVisible();
  await expect(page.locator('#boss-hud')).toContainText('BOSS');
  await page.evaluate(() => __game.debug.killAllEnemies());
  await expect(page.locator('#boss-hud')).toBeHidden();
});

test('boss : le tuer credite un gros bonus', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.forceWave(5); });
  const m0 = await page.evaluate(() => __game.money);
  await page.evaluate(() => __game.debug.killAllEnemies());
  expect(await page.evaluate(() => __game.money) - m0).toBeGreaterThanOrEqual(300);
});

// ====== Tranche 46 : difficulté ======

test('difficulte : ajuste PV ennemis et degats recus', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  expect(await page.evaluate(() => __game.debug.difficulty())).toBe('normal');
  const hpN = await page.evaluate(() => __game.debug.enemyHpForWave(3));
  await page.evaluate(() => __game.debug.setDifficulty('difficile'));
  expect(await page.evaluate(() => __game.debug.enemyHpForWave(3))).toBeGreaterThan(hpN);
  await page.evaluate(() => __game.debug.setDifficulty('facile'));
  expect(await page.evaluate(() => __game.debug.enemyHpForWave(3))).toBeLessThan(hpN);
});

test('difficulte : facile reduit les degats recus', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setDifficulty('facile'));
  await page.evaluate(() => __game.debug.setShield(0)); // #67 : sans bouclier, on mesure les dégâts réels sur les PV
  const h0 = await page.evaluate(() => __game.debug.playerHealth());
  await page.evaluate(() => __game.debug.damagePlayer(20));
  const lost = h0 - await page.evaluate(() => __game.debug.playerHealth());
  expect(lost).toBeLessThan(20); expect(lost).toBeGreaterThan(0);
});

test('difficulte : le selecteur des reglages applique le mode', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  await page.locator('#btn-settings').click();
  await page.locator('#set-diff [data-diff="facile"]').click();
  expect(await page.evaluate(() => __game.debug.difficulty())).toBe('facile');
  await expect(page.locator('#set-diff [data-diff="facile"]')).toHaveClass(/on/);
});

// ====== #70 — Marqueurs de spawn ======

test('#70 spawnmark : spawnMarkerCount initial = 0', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.spawnMarkerCount())).toBe(0);
});

test('#70 spawnmark : showSpawnMarker cree un marqueur', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.showSpawnMarker(5, 5));
  expect(await page.evaluate(() => __game.debug.spawnMarkerCount())).toBe(1);
});

test('#70 spawnmark : plusieurs marqueurs possibles', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.showSpawnMarker(0,0); __game.debug.showSpawnMarker(3,3); __game.debug.showSpawnMarker(-3,3); });
  expect(await page.evaluate(() => __game.debug.spawnMarkerCount())).toBe(3);
});

// ====== #75 — Banner de vague ======

test('#75 wavebanner : element #wave-banner existe', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => !!document.getElementById('wave-banner'))).toBe(true);
});

test('#75 wavebanner : showWaveBanner affiche le numero de vague', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.showWaveBanner(3, false));
  const txt = await page.evaluate(() => document.getElementById('wave-banner').textContent);
  expect(txt).toContain('3');
});

test('#75 wavebanner : showWaveBanner boss affiche BOSS', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.showWaveBanner(5, true));
  const txt = await page.evaluate(() => document.getElementById('wave-banner').textContent.toUpperCase());
  expect(txt).toContain('BOSS');
});

// ====== #76 — Countdown inter-vague ======

test('#76 countdown : waveCountdown = 0 pendant une vague active', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.waveCountdown())).toBe(0);
});

test('#76 countdown : element #wave-countdown existe', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => !!document.getElementById('wave-countdown'))).toBe(true);
});

test('#76 countdown : waveCountdown > 0 apres fin de vague', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.killAllEnemies());
  const cd = await page.evaluate(() => __game.debug.waveCountdown());
  expect(cd).toBeGreaterThan(0);
});

// ====== #91 — Zone de danger : RETIRÉE (#206, demande explicite — le cercle rouge punissait
// l'exploration des grandes maps). Régression : l'API debug ne doit plus exister. ======

test('#206 zone de danger retirée : plus d\'anneau ni de dégâts hors zone', async ({ page }) => {
  await startPlaying(page);
  const gone = await page.evaluate(() => ({
    mesh: typeof __game.debug.dzMeshActive,
    radius: typeof __game.debug.dangerZoneRadius,
    dmg: typeof __game.debug.dangerZoneDamage,
  }));
  expect(gone).toEqual({ mesh: 'undefined', radius: 'undefined', dmg: 'undefined' });
});
