// Tranche #204 : moteur « sol à hauteur variable » — groundHeight(x,z) suivie par joueur,
// ennemis, chien et objets au sol ; amphithéâtre enfoncé de la map utopia (fond −1.92,
// 3 gradins, 4 escaliers-rampes, stèle collidée au centre, spawn joueur (0,3)).
import { test, expect } from '@playwright/test';
import { startPlaying } from './helpers.js';

const gh = (page, x, z) => page.evaluate(([x, z]) => window.__game.debug.groundHeightAt(x, z), [x, z]);
const toUtopia = async (page) => {
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  await page.evaluate(() => window.__game.debug.restart());   // repositionne le joueur au spawn de la map
};

test('204 groundHeight utopia : fond, gradins, rampe, rive, RdC', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  expect(await gh(page, 2, 2)).toBeCloseTo(-1.744, 2);          // socle du médaillon (#205 : fond +0.176, r≤3.44)
  expect(await gh(page, 4, 4)).toBeCloseTo(-1.92, 2);           // fond nu (hors socle)
  expect(await gh(page, 5.4, 5.4)).toBeCloseTo(-1.44, 2);       // gradin 1 (diagonale, r≈7.64)
  expect(await gh(page, 5.8, 5.8)).toBeCloseTo(-0.96, 2);       // gradin 2 (r≈8.20)
  expect(await gh(page, 6.3, 6.3)).toBeCloseTo(-0.48, 2);       // gradin 3 (r≈8.91)
  expect(await gh(page, 12, 0)).toBe(0);                        // rive (au-delà du trou r=9.18)
  const ramp = await gh(page, 8.1, 0);                          // rampe est, mi-pente
  expect(ramp).toBeGreaterThan(-1.6); expect(ramp).toBeLessThan(-0.4);
  expect(await gh(page, 0, -8.1)).toBeGreaterThan(-1.6);        // rampe nord aussi (axe z)
  expect(await gh(page, 0, -8.1)).toBeLessThan(-0.4);
  expect(await gh(page, -16.64, -10.4)).toBeCloseTo(0.104, 3);  // RdC bâtiment (terrasse +0.104)
});

test('204 groundHeight : nul sur portal et urban, et hors amphithéâtre en utopia', async ({ page }) => {
  await startPlaying(page);
  expect(await gh(page, 2, 2)).toBe(0);                         // portal (map par défaut)
  expect(await gh(page, 8.1, 0)).toBe(0);
  await page.evaluate(() => window.__game.debug.setMapId('urban'));
  expect(await gh(page, 2, 2)).toBe(0);
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  expect(await gh(page, 20, 20)).toBe(0);                       // coin de place, loin de l'amphi
});

test('204 utopia : stèle collidée au centre, spawn joueur dégagé, canaux intacts', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(0, 0))).toBe(true);        // stèle
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(0, 3))).toBe(false);       // spawn
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-12.8, -6.8))).toBe(true); // canal
  expect(await page.evaluate(() => window.__game.debug.playerSpawnPoint())).toEqual({ x: 0, z: 3 });
});

test('204 fallback utopia (décor KO) : groundHeight nul partout, spawn origine', async ({ page }) => {
  await page.addInitScript(() => { window.__FORCE_DECOR_FAIL__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout: 20000 });
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  expect(await page.evaluate(() => window.__game.debug.groundHeightAt(2, 2))).toBe(0);
  expect(await page.evaluate(() => window.__game.debug.playerSpawnPoint())).toEqual({ x: 0, z: 0 });
});

// ====== Joueur ======

test('204 joueur : spawn utopia au fond de l\'amphithéâtre, y suit le sol via setPos', async ({ page }) => {
  await startPlaying(page);
  await toUtopia(page);
  const p = await page.evaluate(() => window.__game.position());
  expect(Math.hypot(p.x - 0, p.z - 3)).toBeLessThan(0.6);                 // spawn (0,3)
  expect(await page.evaluate(() => window.__game.debug.playerFootY())).toBeCloseTo(-1.744, 1);   // #205 : sur le socle du médaillon
  await page.evaluate(() => window.__game.debug.setPos(12, 0));           // rive
  expect(await page.evaluate(() => window.__game.debug.playerFootY())).toBeCloseTo(0, 1);
  await page.evaluate(() => window.__game.debug.setPos(5.8, 5.8));        // gradin 2
  expect(await page.evaluate(() => window.__game.debug.playerFootY())).toBeCloseTo(-0.96, 1);
});

test('204 joueur : descente à pied rive→fond par paliers, remontée par la rampe est', async ({ page }) => {
  await startPlaying(page);
  await toUtopia(page);
  // avant = (sin(yaw), cos(yaw)) : yaw -PI/2 = vers -x (le centre depuis la rive est)
  await page.evaluate(() => { const d = window.__game.debug;
    d.setPos(11, 0); d.setYaw(-Math.PI/2); d.setInput({ forward: true }); });
  await page.waitForFunction(() => window.__game.debug.playerFootY() < -1.8, null, { timeout: 20000 });
  await page.evaluate(() => window.__game.debug.setInput({ forward: false }));
  // remontée : du fond vers l'est par la rampe (yaw +PI/2 = vers +x)
  await page.evaluate(() => { const d = window.__game.debug;
    d.setPos(2, 0); d.setYaw(Math.PI / 2); d.setInput({ forward: true }); });
  await page.waitForFunction(() => window.__game.debug.playerFootY() > -0.1, null, { timeout: 20000 });
  await page.evaluate(() => window.__game.debug.setInput({ forward: false }));
});

test('204 joueur : saut depuis la rive vers la fosse atterrit sur une surface basse', async ({ page }) => {
  await startPlaying(page);
  await toUtopia(page);
  await page.evaluate(() => { const d = window.__game.debug;
    d.setPos(10, 3); d.setYaw(-Math.PI/2); d.setInput({ forward: true }); d.jump(); });
  await page.waitForFunction(() => window.__game.debug.playerFootY() < -0.4
    && window.__game.debug.velY() === 0, null, { timeout: 20000 });        // retombé sur une surface basse
  await page.evaluate(() => window.__game.debug.setInput({ forward: false }));
});

// ====== Ennemis & chien ======

test('204 ennemis : spawn/moveEnemy suivent le sol', async ({ page }) => {
  await startPlaying(page);
  await toUtopia(page);
  await page.evaluate(() => window.__game.debug.spawnEnemyTypeAt(0, 'shooter', 4, -4));
  expect((await page.evaluate(() => window.__game.debug.enemyPos(0))).y).toBeCloseTo(-1.92, 1);
  await page.evaluate(() => window.__game.debug.moveEnemy(0, 14, 0));
  expect((await page.evaluate(() => window.__game.debug.enemyPos(0))).y).toBeCloseTo(0, 1);
});

test('204 ennemis : la poursuite descend dans la fosse (y suit en continu)', async ({ page }) => {
  await startPlaying(page);
  await toUtopia(page);
  await page.evaluate(() => { const d = window.__game.debug;
    d.setEnemyAccuracy(0); d.spawnEnemyTypeAt(0, 'rusher', 11, 1); d.setPos(0, 3); });
  await page.waitForFunction(() => {
    const p = window.__game.debug.enemyPos(0); return p && p.y < -1.0;
  }, null, { timeout: 10000 });
});

test('204 chien : le pet se pose sur le sol de la fosse et de la rive', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_PET__ = true; });
  await startPlaying(page);
  await toUtopia(page);
  await page.evaluate(() => window.__game.debug.petSummon());
  await page.waitForFunction(() => window.__game.debug.petVisible(), null, { timeout: 15000 });
  await page.evaluate(() => window.__game.debug.petSetPos(12, 0));
  const yRive = (await page.evaluate(() => window.__game.debug.petPos())).y;
  await page.evaluate(() => window.__game.debug.petSetPos(4, 4));   // fond nu (le socle #205 couvre r≤3.44)
  const yFond = (await page.evaluate(() => window.__game.debug.petPos())).y;
  expect(yRive - yFond).toBeCloseTo(1.92, 1);
});

// ====== Objets au sol ======

test('204 objets : pack de soin et zone de poison posés au fond de la fosse', async ({ page }) => {
  await startPlaying(page);
  await toUtopia(page);
  await page.evaluate(() => window.__game.debug.spawnHealthPack(4, -4));
  expect(await page.evaluate(() => window.__game.debug.healthPackY(0))).toBeLessThan(-1.5);
  await page.evaluate(() => window.__game.debug.spawnPoisonZoneAt(4, -4));
  expect(await page.evaluate(() => window.__game.debug.poisonZoneMeshY())).toBeCloseTo(-1.87, 1);
});

test('204 objets : sur portal, packs et zones restent au niveau 0 (régression)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => window.__game.debug.spawnHealthPack(2, -2));
  const y = await page.evaluate(() => window.__game.debug.healthPackY(0));
  expect(y).toBeGreaterThan(-0.1); expect(y).toBeLessThan(0.2);
  await page.evaluate(() => window.__game.debug.spawnPoisonZoneAt(2, -2));
  expect(await page.evaluate(() => window.__game.debug.poisonZoneMeshY())).toBeCloseTo(0.05, 2);
});

// ====== Tranche #205 : map utopia complète (bornes, ponts en arche, collines, rivière) ======

test('205 groundHeight : ponts en arche et collines en grilles', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  const apex = await gh(page, 45.39, 0);                    // sommet du pont Central
  expect(apex).toBeGreaterThan(0.7); expect(apex).toBeLessThan(1.0);
  const end = await gh(page, 40.6, 0);                      // proche de l'extrémité ouest du tablier
  expect(end).toBeGreaterThan(0.1); expect(end).toBeLessThan(0.45);
  const hill = await gh(page, -32, 69.6);                   // cœur de la colline SO (grille)
  expect(hill).toBeGreaterThan(3);
  expect(await gh(page, -32, 40)).toBe(0);                  // esplanade hors grille
  expect(await gh(page, 57.6, 0)).toBeCloseTo(0.176, 2);    // médaillon plat du rond-point est
});

test('205 rivière : eau infranchissable hors ponts, tablier libre, vitres collidées', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(48.17, -20.8))).toBe(true); // eau (segment du méandre)
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(45.39, 0))).toBe(false);    // tablier du pont Central
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(45.39, 1.8))).toBe(true);   // garde-corps vitré du pont
});

test('205 bornes par map : utopia large (clampé), portal historique', async ({ page }) => {
  await startPlaying(page);
  expect((await page.evaluate(() => window.__game.debug.mapBoundsGet())).maxX).toBe(24);
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  expect(await page.evaluate(() => window.__game.debug.mapBoundsGet()))
    .toEqual({ minX: -76.3, maxX: 76.3, minZ: -92.3, maxZ: 92.3 });
  await page.evaluate(() => window.__game.debug.restart());
  await page.evaluate(() => window.__game.debug.setPos(70, 0));            // rive est, au-delà de la rivière
  expect(await page.evaluate(() => window.__game.debug.playerFootY())).toBeCloseTo(0, 1);
  await page.evaluate(() => window.__game.debug.setPos(100, 0));           // hors bornes → clamp à la frame suivante
  await page.waitForFunction(() => window.__game.position().x <= 76.31, null, { timeout: 5000 });
});
