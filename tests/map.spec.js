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

test('si le chargement du decor echoue totalement, l\'arene de secours prend le relais', async ({ page }) => {
  await page.addInitScript(() => { window.__FORCE_DECOR_FAIL__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.characters?.length >= 1, null, {timeout:20000});
  const obstacleCount = await page.evaluate(() => window.__game.debug.obstacleCount());
  expect(obstacleCount).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__game.debug.mapHalf)).toBe(24);
});

test('zone portail + ruines : colliders et emplacement du portail', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => window.__game.debug.obstacleCount())).toBeGreaterThanOrEqual(10);
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-1.8, -9.5))).toBe(true);   // colonne portail
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-6, 4))).toBe(true);        // bloc de ruine
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(0, 0))).toBe(false);        // spawn joueur degage
});

test('zone foret : arbres et rochers bloquent le passage', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-16, 16))).toBe(true);   // tronc d'arbre
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-10, 15))).toBe(true);   // rocher
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-16.6, 16.6))).toBe(false); // clairiere a cote
});

test('exterieur du chateau : mur et tour bloquent, restent dans les bornes MAP_HALF', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(17, 6))).toBe(true);    // mur
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(18, -2))).toBe(true);   // tour
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(19.5, -2))).toBe(true);  // toujours dans la tour
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(23.5, -2))).toBe(false); // au-dela de la tour et du mur d'enceinte (mur : x 21.2-22.8)
});

test('ambiance nuit : fond violet fonce, grille masquee', async ({ page }) => {
  await startPlaying(page);
  const theme = await page.evaluate(() => window.__game.debug.mapTheme());
  expect(theme.bg).toBe('#0a0a16');
  expect(theme.gridVisible).toBe(false);
});

test('decor lointain : aucun collider ajoute, compteur backdrop incremente', async ({ page }) => {
  await startPlaying(page);
  const obstacles = await page.evaluate(() => window.__game.debug.obstacleCount());
  const backdrop = await page.evaluate(() => window.__game.debug.decorBackdropCount());
  expect(backdrop).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-35, 0))).toBe(false);   // cite futuriste hors bornes, jamais bloquant
});

test('indicateur de chargement au boot puis masque une fois le lobby pret', async ({ page }) => {
  await page.goto('/game.html');
  await expect(page.locator('#boot-loading')).toBeVisible();
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, {timeout:20000});
  await expect(page.locator('#boot-loading')).toBeHidden();
});

// ====== #201 multi-map (registre MAPS + reconstruction a chaud) ======
test('mapList expose au moins 2 maps (portal + urban)', async ({ page }) => {
  await startPlaying(page);
  const list = await page.evaluate(() => window.__game.debug.mapList());
  expect(list).toContain('portal');
  expect(list).toContain('urban');
});

test('setMapId("urban") bascule vers l ancienne arene (grille visible, decor portail absent)', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => window.__game.debug.mapId())).toBe('portal');
  const ok = await page.evaluate(() => window.__game.debug.setMapId('urban'));
  expect(ok).toBe(true);
  expect(await page.evaluate(() => window.__game.debug.mapId())).toBe('urban');
  expect(await page.evaluate(() => window.__game.debug.mapTheme().gridVisible)).toBe(true);
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-5, 6))).toBe(true);     // caisse arene urbaine
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-1.8, -9.5))).toBe(false); // colonne portail absente
});

test('setMapId("portal") revient au decor thematique (grille masquee)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => window.__game.debug.setMapId('urban'));
  await page.evaluate(() => window.__game.debug.setMapId('portal'));
  expect(await page.evaluate(() => window.__game.debug.mapTheme().gridVisible)).toBe(false);
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-1.8, -9.5))).toBe(true);  // colonne portail de retour
});

test('le choix de map est persiste (save.settings.mapId)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => window.__game.debug.setMapId('urban'));
  expect(await page.evaluate(() => window.__game.debug.save.raw().settings.mapId)).toBe('urban');
});

// ====== #203 map utopia (cite utopique, derivee de map_utopia.blend) ======
test('mapList contient utopia et setMapId("utopia") bascule + persiste', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => window.__game.debug.mapList())).toContain('utopia');
  expect(await page.evaluate(() => window.__game.debug.setMapId('utopia'))).toBe(true);
  expect(await page.evaluate(() => window.__game.debug.mapId())).toBe('utopia');
  expect(await page.evaluate(() => window.__game.debug.save.raw().settings.mapId)).toBe('utopia');
});

test('utopia : pad central et allee degages, canaux infranchissables', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(0, 0))).toBe(false);      // pad spawn
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(0, 2))).toBe(false);      // allee centrale
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-12.8, -6.8))).toBe(true); // canal X nord-ouest
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(12.8, 6.8))).toBe(true);   // canal X sud-est
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(5.44, 12.8))).toBe(true);  // canal Y sud
});

test('utopia : rez-de-chaussee visitable (porte ouverte, vitres/noyau pleins)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  // batiment ouest-nord, centre (-16.64, -10.4), facade vers +x, porte centree
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-12.28, -10.4))).toBe(false); // seuil de porte
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-12.28, -14))).toBe(true);    // vitre avant (segment)
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-21.32, -10.4))).toBe(true);  // vitre arriere
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-19.52, -10.4))).toBe(true);  // noyau ascenseur
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-14.6, -13))).toBe(false);    // interieur circulable
  // batiment est-nord (miroir rotY=pi) : porte cote rue aussi
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(12.28, -10.4))).toBe(false);  // seuil de porte est
});

test('utopia : parterres/pots/kiosques en cover, enceinte fermee', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-10.8, -11.2))).toBe(true); // parterre fleuri
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(3.44, 10.4))).toBe(true);   // pot
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-9.84, 4.4))).toBe(true);   // kiosque
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(0, 22))).toBe(true);        // enceinte nord
  expect(await page.evaluate(() => window.__game.debug.obstacleCount())).toBeGreaterThanOrEqual(50);
});

test('utopia : decor GLB pose (batiments+place+drone)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  expect(await page.evaluate(() => window.__game.debug.decorPropCount())).toBeGreaterThanOrEqual(6);
});

test('utopia : theme jour (fond clair, grille masquee, etoiles eteintes)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  const theme = await page.evaluate(() => window.__game.debug.mapTheme());
  expect(theme.bg).toBe('#bfdcff');
  expect(theme.gridVisible).toBe(false);
  expect(await page.evaluate(() => window.__game.debug.starsVisible())).toBe(false);
});

test('utopia : si le decor echoue, fallback arene urbaine', async ({ page }) => {
  await page.addInitScript(() => { window.__FORCE_DECOR_FAIL__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, {timeout:20000});
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  expect(await page.evaluate(() => window.__game.debug.mapId())).toBe('utopia');
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-5, 6))).toBe(true);        // caisse arene urbaine
});
