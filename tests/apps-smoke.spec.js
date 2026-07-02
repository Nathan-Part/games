import { test, expect } from '@playwright/test';
import { trackErrors } from './helpers.js';

// Smoke tests des apps annexes : elles doivent booter sans erreur JS
// (couvre notamment les imports des modules partagés src/shared/*).

test('app.html boote sans erreur (retargeting + galerie partagée)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/app.html');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(2500); // laisse le chargement anims/persos démarrer
  expect(errors).toEqual([]);
});

test('studio.html boote sans erreur (galerie partagée)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/studio.html');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});
