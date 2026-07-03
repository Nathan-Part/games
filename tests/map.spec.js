import { test, expect } from '@playwright/test';
import { startPlaying } from './helpers.js';

const FIXTURE_GLB = 'artefact/weapons/AR-15/Meshy_AI_HADES_7_Tactical_Rifl_0621110957_texture.glb';

test('addProp charge un modele valide, ajoute un collider et est retrouvable via pointInObstacle', async ({ page }) => {
  await startPlaying(page);
  const before = await page.evaluate(() => window.__game.debug.obstacleCount());
  const ok = await page.evaluate(async (url) => {
    const mesh = await window.__game.debug.testAddProp(url, { x: 50, z: 50, collider: { w: 2, d: 2 } });
    return !!mesh;
  }, FIXTURE_GLB);
  const after = await page.evaluate(() => window.__game.debug.obstacleCount());
  expect(ok).toBe(true);
  expect(after).toBe(before + 1);
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(50, 50))).toBe(true);
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(0, 0))).toBe(false);
});

test('addProp sur une URL invalide ne jette pas et n\'ajoute pas de collider', async ({ page }) => {
  await startPlaying(page);
  const before = await page.evaluate(() => window.__game.debug.obstacleCount());
  const result = await page.evaluate(async () => {
    return await window.__game.debug.testAddProp('decor/does-not-exist.glb', { x: 60, z: 60, collider: { w: 2, d: 2 } });
  });
  const after = await page.evaluate(() => window.__game.debug.obstacleCount());
  expect(result).toBeNull();
  expect(after).toBe(before);
});

test('addBackdropProp charge un modele mais n\'ajoute jamais de collider', async ({ page }) => {
  await startPlaying(page);
  const before = await page.evaluate(() => window.__game.debug.obstacleCount());
  const ok = await page.evaluate(async (url) => {
    const mesh = await window.__game.debug.testAddBackdropProp(url, { x: 100, z: 100 });
    return !!mesh;
  }, FIXTURE_GLB);
  const after = await page.evaluate(() => window.__game.debug.obstacleCount());
  expect(ok).toBe(true);
  expect(after).toBe(before);
});
