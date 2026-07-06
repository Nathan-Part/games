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

test('utopia : stele collidee, spawn degage, canaux infranchissables', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(0, 0))).toBe(true);       // #204 : stele de l'amphitheatre au centre
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(0, 3))).toBe(false);      // #204 : spawn joueur (0,3) degage
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-12.8, -6.8))).toBe(true); // canal X nord-ouest
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(12.8, 6.8))).toBe(true);   // canal X sud-est
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(5.44, 12.8))).toBe(true);  // canal Y sud
});

test('utopia : rez-de-chaussee visitable par les angles de loggia (vitres/noyau pleins)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  // batiment ouest-nord, centre (-16.64, -10.4), facade vers +x, entrees aux 2 angles
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-12.3, -5.4))).toBe(false);   // entree angle sud
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-12.3, -15.7))).toBe(false);  // entree angle nord
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-12.28, -10.4))).toBe(true);  // vitre avant pleine au centre
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-21.32, -10.4))).toBe(true);  // vitre arriere
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-19.52, -10.4))).toBe(true);  // noyau ascenseur
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-18.54, -16.25))).toBe(true); // salle vitree d'angle (fermee)
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-14.6, -13))).toBe(false);    // interieur circulable
  // batiment est-nord (miroir rotY=pi) : entree d'angle cote rue aussi
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(12.3, -15.4))).toBe(false);   // entree angle (est)
});

test('utopia : les interieurs de batiments sont interdits au spawn ennemi', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => window.__game.debug.noSpawnZoneCount())).toBe(0);       // portal : aucune zone
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  expect(await page.evaluate(() => window.__game.debug.noSpawnZoneCount())).toBe(8);       // #205 : 8 lobbys proteges (map complete)
  expect(await page.evaluate(() => window.__game.debug.inNoSpawnZone(-14.6, -13))).toBe(true);  // interieur NW
  expect(await page.evaluate(() => window.__game.debug.inNoSpawnZone(0, 0))).toBe(false);       // place libre
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

// ====== #205 map utopia complete (esplanade entiere, 8 batiments, tour, fog/ombres par map) ======
test('205 utopia complete : 8 lobbys, batiments exterieurs presents (BatG0 = toit #206)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  expect(await page.evaluate(() => window.__game.debug.noSpawnZoneCount())).toBe(8);
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-12.28, 31.2))).toBe(true);  // vitre avant pleine BatG0
  expect(await page.evaluate(() => window.__game.debug.groundHeightAt(-16.64, 31.2))).toBeCloseTo(9.64, 2);   // #206 : toit praticable
  expect(await page.evaluate(() => window.__game.debug.inNoSpawnZone(-16.64, 31.2))).toBe(true);    // empreinte BatG0 protegee
});

// ====== #206bis : bug remonte par Nathan ("bloque, ne peut pas avancer" sur le toit) ======
// Cause racine (reproduite en mouvement reel, pas en teleportation) : approcher la cage
// d'escalier PAR LE COTE fait sauter groundHeight de 0 a plusieurs metres d'un coup (> STEP_UP_MAX),
// ce qui annule tout le deplacement de la frame en boucle = mur invisible. Fix : garde-corps solide
// sur le flanc EXTERIEUR de chaque escalier (le joueur bute normalement dessus au lieu du a-coup).
test('206bis : garde-corps solide sur le flanc exterieur de l escalier (evite le mur invisible)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  // BatG0 (-16.64,31.2,m=1) : flanc exterieur x = cx + m*stairOut = -23.94, mi-hauteur de la rampe z=30.32
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-23.94, 30.32))).toBe(true);
  // le couloir de la rampe reste libre (approche frontale toujours praticable)
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-23, 30.32))).toBe(false);
});

// ====== #206 : toits accessibles des 4 batiments exterieurs (escalier code + zones moteur) ======
test('206 toits : rampe praticable, toit a 9.64, parapet garde-corps moteur, angles condamnes', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  // BatG0 (-16.64, 31.2, m=+1) : escalier au dos (x [-23.94,-22.16]), depart cote place z=24.24
  expect(await page.evaluate(() => window.__game.debug.groundHeightAt(-23, 24.24))).toBeCloseTo(0, 2);       // pied de rampe
  const mid = await page.evaluate(() => window.__game.debug.groundHeightAt(-23, 30.32));                     // mi-rampe
  expect(mid).toBeGreaterThan(4);
  expect(mid).toBeLessThan(6);
  expect(await page.evaluate(() => window.__game.debug.groundHeightAt(-22.5, 37.5))).toBeCloseTo(9.64, 2);   // palier d'arrivee (encoche)
  expect(await page.evaluate(() => window.__game.debug.groundHeightAt(-16.64, 31.2))).toBeCloseTo(9.64, 2);  // toit
  expect(await page.evaluate(() => window.__game.debug.groundHeightAt(-16.64, 38.0))).toBeCloseTo(10.32, 2); // bande parapet nord = marche infranchissable
  expect(await page.evaluate(() => window.__game.debug.groundHeightAt(-11.7, 31.2))).toBeCloseTo(10.32, 2);  // bande parapet facade
  // angles de loggia condamnes par jardinieres (sinon mur moteur invisible)
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-12.04, 36.2))).toBe(true);
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-12.04, 26.2))).toBe(true);
  // symetrie : les 3 autres batiments exterieurs ont aussi leur toit
  expect(await page.evaluate(() => window.__game.debug.groundHeightAt(16.64, 31.2))).toBeCloseTo(9.64, 2);
  expect(await page.evaluate(() => window.__game.debug.groundHeightAt(16.64, -31.2))).toBeCloseTo(9.64, 2);
  expect(await page.evaluate(() => window.__game.debug.groundHeightAt(-16.64, -31.2))).toBeCloseTo(9.64, 2);
  expect(await page.evaluate(() => window.__game.debug.utopiaRoofCount())).toBe(4);
  // personne ne spawn sur la rampe ; les batiments du coeur gardent leur RdC a +0.104
  expect(await page.evaluate(() => window.__game.debug.inNoSpawnZone(-23, 31.2))).toBe(true);
  expect(await page.evaluate(() => window.__game.debug.groundHeightAt(-16.64, 10.4))).toBeCloseTo(0.104, 3);
});

// ====== #206ter : bug remonte par Nathan ("marcher sur la riviere ne doit pas etre possible") ======
// Cause racine : les segments generes (extract205.py) sont troues au droit de chaque pont sur une
// largeur plus grande que le garde-corps du pont (z=+-1.84) — un couloir d'~1.4 m restait ouvert
// (ni obstacle, ni zone de sol) de chaque cote, permettant de marcher sur l'eau a hauteur 0.
test('206ter : le couloir riviere pres des ponts est bouche (plus de marche sur l eau)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  // pont central (x 40.19-50.59, rail a z=+-1.84) : le couloir z in [1.84,3.2) est desormais bloque
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(45, 3))).toBe(true);
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(45, -3))).toBe(true);
  // le pont lui-meme reste praticable (zone arch inchangee)
  expect(await page.evaluate(() => window.__game.debug.groundHeightAt(45, 0))).toBeCloseTo(0.852, 2);
});

// ====== #206 : tuile map illustree ======
test('206 tuile map : la carte utopia porte background.png, pas les autres', async ({ page }) => {
  await page.goto('/game.html#map');
  await page.waitForFunction(() => window.__game?.characters?.length >= 1, null, {timeout:20000});
  const utopia = page.locator('#map-grid [data-map="utopia"]');
  await expect(utopia).toHaveClass(/has-img/);
  expect(await utopia.evaluate(el => el.style.backgroundImage)).toContain('background.png');
  const portal = page.locator('#map-grid [data-map="portal"]');
  await expect(portal).not.toHaveClass(/has-img/);
});

// ====== #206 : portes RDC des 4 batiments du coeur (baie frontale exterieure decoupee) ======
test('206 portes : baie franchissable cote exterieur, vitre pleine au centre, 4 baies decoupees', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  // batiment est-nord (16.64, 10.4) : porte a z = 10.4 + [2.19, 4.28] sur la facade x=12.28
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(12.28, 13.5))).toBe(false);   // dans la baie
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(12.28, 10.4))).toBe(true);    // vitre pleine au droit du centre
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(12.28, 11.5))).toBe(true);    // grand pan cote centre
  // batiment est-sud (16.64, -10.4) : porte symetrique (cote oppose au centre de la place)
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(12.28, -13.5))).toBe(false);
  // batiment ouest-nord (-16.64, 10.4) : facade a x=-12.28
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-12.28, 13.5))).toBe(false);
  // l'interieur derriere la porte reste praticable (RdC +0.104)
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(13.5, 13.5))).toBe(false);
  expect(await page.evaluate(() => window.__game.debug.groundHeightAt(13.5, 13.5))).toBeCloseTo(0.104, 3);
  // 4 baies vitrees decoupees visuellement (clipping par instance)
  expect(await page.evaluate(() => window.__game.debug.utopiaDoorCount())).toBe(4);
});

test('205 utopia complete : fog/ombres/far par map, tour collidee, decor pose', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => window.__game.debug.shadowHalfGet())).toBe(20);                  // portal : historique
  await page.evaluate(() => window.__game.debug.setMapId('utopia'));
  expect(await page.evaluate(() => window.__game.debug.shadowHalfGet())).toBe(100);
  expect(await page.evaluate(() => window.__game.debug.decorPropCount())).toBeGreaterThanOrEqual(13); // 8 batiments + sol/place/riviere/collines/vegetation/avenue/tour/plaza/passerelles/drone
  expect(await page.evaluate(() => window.__game.debug.pointInObstacle(-57.6, 0))).toBe(true);      // emprise de la tour SW
});
