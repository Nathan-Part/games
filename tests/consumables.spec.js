import { test, expect } from '@playwright/test';
import { trackErrors, startPlaying, faceEnemyForMelee, alignTwoEnemies } from './helpers.js';

// ====== Tranche 32 : packs de soin ======

test('soin : drop force a la mort', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.forceHealthDrop(true); __game.debug.spawnEnemyAt(0,3); __game.debug.damageEnemy(0,99999); });
  expect(await page.evaluate(() => __game.debug.healthPackCount())).toBeGreaterThanOrEqual(1);
});

test('soin : ramasser un pack au contact soigne et le retire', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(0)); // #67 : sans bouclier, les 50 dégâts baissent vraiment les PV
  await page.evaluate(() => __game.debug.damagePlayer(50));
  const h0 = await page.evaluate(() => __game.debug.playerHealth());
  const pos = await page.evaluate(() => __game.position());
  await page.evaluate(p => __game.debug.spawnHealthPack(p.x, p.z), pos);
  await page.waitForFunction(h => __game.debug.playerHealth() > h, h0, { timeout:3000 });
  expect(await page.evaluate(() => __game.debug.healthPackCount())).toBe(0);
});

test('soin : plein de vie = pas de ramassage', async ({ page }) => {
  await startPlaying(page);   // PV plein
  const pos = await page.evaluate(() => __game.position());
  await page.evaluate(p => __game.debug.spawnHealthPack(p.x, p.z), pos);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.healthPackCount())).toBe(1);   // reste (PV plein)
});

test('soin : pack trop loin ne soigne pas', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.damagePlayer(40));
  await page.evaluate(() => __game.debug.spawnHealthPack(60, 60));            // loin
  const before = await page.evaluate(() => __game.debug.playerHealth());
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => __game.debug.playerHealth())).toBeLessThanOrEqual(before + 2);  // régén lente seule, pas le pack
  expect(await page.evaluate(() => __game.debug.healthPackCount())).toBe(1);
});

// ====== Tranche 33 : grenades ======

test('grenade -> #155 : lancer decremente le stock persistant et cree un projectile', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.grenadeCount())).toBe(12);   // stock de depart (#155)
  expect(await page.evaluate(() => __game.debug.throwGrenade())).toBe(true);
  expect(await page.evaluate(() => __game.debug.grenadeCount())).toBe(11);
  expect(await page.evaluate(() => __game.debug.grenadeProjCount())).toBeGreaterThanOrEqual(1);
});

test('grenade : stock vide refuse', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setConsumableStock('frag', 1));
  await page.evaluate(() => __game.debug.throwGrenade());
  expect(await page.evaluate(() => __game.debug.grenadeCount())).toBe(0);
  expect(await page.evaluate(() => __game.debug.throwGrenade())).toBe(false);
});

test('grenade : explosion inflige des degats de zone', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnEnemyAt(0, 3); });
  const hp0 = await page.evaluate(() => __game.debug.enemyHp(0));
  await page.evaluate(() => __game.debug.explodeGrenadeAt(0, 0.5, 3));
  expect(await page.evaluate(() => __game.debug.enemyHp(0))).toBeLessThan(hp0);
});

test('grenade -> #155 : le stock n est plus recharge a chaque vague (persistant)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.throwGrenade(); __game.debug.throwGrenade(); __game.debug.throwGrenade(); });
  expect(await page.evaluate(() => __game.debug.grenadeCount())).toBe(9);   // 12 - 3
  await page.evaluate(() => __game.debug.forceNextWave());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.grenadeCount())).toBe(9);   // stock inchange
});

// ====== Tranche 41 : barils explosifs ======

test('baril : presents en jeu + explosion AoE', async ({ page }) => {
  await startPlaying(page);
  const n0 = await page.evaluate(() => __game.debug.barrelCount());
  expect(n0).toBeGreaterThan(0);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(1, 'shooter', 8, 6));
  const hp0 = await page.evaluate(() => __game.debug.enemyHp(1));
  await page.evaluate(() => __game.debug.explodeBarrelNow(0));
  expect(await page.evaluate(() => __game.debug.enemyHp(1))).toBeLessThan(hp0);
  expect(await page.evaluate(() => __game.debug.barrelCount())).toBe(n0 - 1);
});

test('baril : tirer dessus le fait exploser', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { for(let i=0;i<3;i++) __game.debug.moveEnemy(i, 40, 40); __game.debug.setView('first'); __game.debug.setPitch(0); });
  await page.waitForTimeout(150);
  const n0 = await page.evaluate(() => __game.debug.barrelCount());
  await page.evaluate(() => __game.debug.spawnBarrelInFront(8));
  expect(await page.evaluate(() => __game.debug.barrelCount())).toBe(n0 + 1);
  await page.evaluate(() => __game.debug.tryFire());
  expect(await page.evaluate(() => __game.debug.barrelCount())).toBe(n0);
});

// ====== #57 — Flashbang ======

test('#57 -> #155 : flashbang stock initial = 8 (persistant)', async ({ page }) => {
  await startPlaying(page);
  const count = await page.evaluate(() => __game.debug.flashbangCount());
  expect(count).toBe(8);
});

test('#57 flashbang : lancer reduit le stock', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.throwFlashbang());
  const count = await page.evaluate(() => __game.debug.flashbangCount());
  expect(count).toBe(7);
});

test('#57 flashbang : explosion aveugle les ennemis proches', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyAt(0, 5));
  await page.evaluate(() => __game.debug.explodeFlashbangAt(0, 1, 5));
  const blinded = await page.evaluate(() => __game.debug.enemyBlinded(0));
  expect(blinded).toBe(true);
});

test('#57 flashbang : ennemi loin non aveugle', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyAt(0, 30));
  await page.evaluate(() => __game.debug.explodeFlashbangAt(0, 1, 0));
  const blinded = await page.evaluate(() => __game.debug.enemyBlinded(0));
  expect(blinded).toBe(false);
});

test('#57 -> #155 : flashbang n est plus recharge par vague (stock persistant)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.throwFlashbang());
  await page.evaluate(() => __game.debug.throwFlashbang());
  expect(await page.evaluate(() => __game.debug.flashbangCount())).toBe(6);   // 8 - 2
  await page.evaluate(() => __game.debug.forceNextWave());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.flashbangCount())).toBe(6);   // stock inchange
});

// ====== #65 — Claymore / mines ======

test('#65 mine : stock initial = 2', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.mineStock())).toBe(2);
});

test('#65 mine : placeMine reduit le stock', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.placeMine());
  expect(await page.evaluate(() => __game.debug.mineStock())).toBe(1);
});

test('#65 mine : mineCount augmente apres pose', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.placeMine());
  expect(await page.evaluate(() => __game.debug.mineCount())).toBe(1);
});

test('#65 mine : explosion tue ennemi proche', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyAt(0, 2));
  await page.evaluate(() => __game.debug.explodeMineAt(0, 1, 2));
  const dead = await page.evaluate(() => __game.debug.enemyState(0) === 'dead');
  expect(dead).toBe(true);
});

// ====== #69 — Grenade fumigène ======

test('#69 -> #155 : smoke stock initial = 6 (persistant)', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.smokeStock())).toBe(6);
});

test('#69 smoke : throwSmoke reduit le stock', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.throwSmoke());
  expect(await page.evaluate(() => __game.debug.smokeStock())).toBe(5);
});

test('#69 smoke : explodeSmokeAt cree un nuage', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.explodeSmokeAt(0, 0));
  expect(await page.evaluate(() => __game.debug.smokeCount())).toBe(1);
});

test('#69 smoke : ennemi dans fumee = in smoke true', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyAt(0, 0));
  await page.evaluate(() => __game.debug.explodeSmokeAt(0, 0));
  expect(await page.evaluate(() => __game.debug.enemyInSmoke(0))).toBe(true);
});

// ====== #83 — Rebond grenade sur les murs ======

test('#83 bounce : grenadeBouncedCount initial 0', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.grenadeBouncedCount())).toBe(0);
});

test('#83 bounce : grenade spawne avec bounces=0', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.throwGrenade());
  const b = await page.evaluate(() => __game.debug.grenadeBouncedCount());
  expect(b).toBe(0);
});

test('#83 bounce : grenadeFirstBounces() est 0 au depart', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.throwGrenade());
  const first = await page.evaluate(() => __game.debug.grenadeFirstBounces());
  expect(first).toBe(0);
});

// ====== #97 — Arc trajectoire grenade ======

test('#97 arc grenade : grenadeArcVisible() false sans input grenade', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.grenadeArcVisible())).toBe(false);
});

test('#97 arc grenade : showGrenadeArc(true) rend l arc visible avec 10 points', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.showGrenadeArc(true));
  expect(await page.evaluate(() => __game.debug.grenadeArcVisible())).toBe(true);
  expect(await page.evaluate(() => __game.debug.grenadeArcPointCount())).toBe(10);
});

test('#97 arc grenade : throwGrenade() masque l arc', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.showGrenadeArc(true));
  await page.evaluate(() => __game.debug.throwGrenade());
  expect(await page.evaluate(() => __game.debug.grenadeArcVisible())).toBe(false);
});

// ====== #117 — Ammo pack drop ======

test('#117 ammo pack : ammoPackCount 0 par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.ammoPackCount())).toBe(0);
});

test('#117 ammo pack : spawnAmmoPack incremente ammoPackCount', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnAmmoPack(10, 10));
  expect(await page.evaluate(() => __game.debug.ammoPackCount())).toBe(1);
});

test('#117 ammo pack : ramassage recharge les munitions', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => {
    __game.debug.setAmmo(0);
    __game.debug.spawnAmmoPack(0, 0);
    __game.debug.setPos(0, 0);
  });
  await page.waitForTimeout(400);
  const ammo = await page.evaluate(() => __game.ammo);
  expect(ammo).toBeGreaterThan(0);
});

// ====== #118 — Sticky grenade ======

test('#118 -> #155 : stickyStock 4 par defaut (persistant)', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.stickyStock())).toBe(4);
});

test('#118 sticky : throwSticky decrement stickyStock', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.throwSticky());
  expect(await page.evaluate(() => __game.debug.stickyStock())).toBe(3);
});

test('#118 sticky : throwSticky cree un projectile sticky', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.throwSticky());
  expect(await page.evaluate(() => __game.debug.stickyCount())).toBeGreaterThanOrEqual(1);
});

// ====== #97b — Arc de grenade au maintien de B ======

test('#97b arc grenade : maintenir B affiche l arc, relacher lance la grenade', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.canvas && __game.canvas.focus && __game.canvas.focus());
  // s'assurer d'avoir des grenades
  const stock = await page.evaluate(() => __game.debug.grenadeCount());
  expect(stock).toBeGreaterThan(0);
  // maintenir B → arc visible
  await page.keyboard.down('b');
  await page.waitForTimeout(120);
  const arcOn = await page.evaluate(() => __game.debug.grenadeArcVisible());
  expect(arcOn).toBe(true);
  const projBefore = await page.evaluate(() => __game.debug.grenadeProjCount());
  // relâcher B → grenade lancée + arc masqué
  await page.keyboard.up('b');
  await page.waitForTimeout(120);
  const arcOff = await page.evaluate(() => __game.debug.grenadeArcVisible());
  expect(arcOff).toBe(false);
  const projAfter = await page.evaluate(() => __game.debug.grenadeProjCount());
  expect(projAfter).toBeGreaterThan(projBefore);
});

// ====== #130 — Molotov cocktail (zone de feu) ======

test('#130 -> #155 : molotov stock initial = 4 (persistant), throwMolotov le decremente', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.molotovStock())).toBe(4);
  await page.evaluate(() => __game.debug.throwMolotov());
  expect(await page.evaluate(() => __game.debug.molotovStock())).toBe(3);
  expect(await page.evaluate(() => __game.debug.molotovCount())).toBe(1); // en vol
});

test('#130 molotov : throwMolotov refuse si stock epuise', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setConsumableStock('molotov', 1));
  await page.evaluate(() => __game.debug.throwMolotov());
  const ok = await page.evaluate(() => __game.debug.throwMolotov());
  expect(ok).toBe(false);
  expect(await page.evaluate(() => __game.debug.molotovCount())).toBe(1);
});

test('#130 molotov : igniteFireZoneAt cree une zone active detectee par enemyInFire', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 2, 0));
  await page.evaluate(() => __game.debug.igniteFireZoneAt(2, 0));
  expect(await page.evaluate(() => __game.debug.fireZoneActive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.enemyInFire(0))).toBe(true);
});

test('#130 molotov : un ennemi hors zone n est pas affecte', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 30, 30));
  await page.evaluate(() => __game.debug.igniteFireZoneAt(0, 0));
  expect(await page.evaluate(() => __game.debug.enemyInFire(0))).toBe(false);
});

test('#130 molotov : la zone inflige des degats periodiques a l ennemi dedans', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 1, 0));
  const hpBefore = await page.evaluate(() => __game.debug.enemyHp(0));
  await page.evaluate(() => __game.debug.igniteFireZoneAt(1, 0));
  await page.waitForTimeout(700); // > 1 tick (0.5s)
  const hpAfter = await page.evaluate(() => __game.debug.enemyHp(0));
  expect(hpAfter).toBeLessThan(hpBefore);
});

test('#130 -> #155 : molotov n est plus recharge par vague (stock persistant)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.throwMolotov());
  expect(await page.evaluate(() => __game.debug.molotovStock())).toBe(3);   // 4 - 1
  await page.evaluate(() => __game.debug.forceNextWave());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.molotovStock())).toBe(3);   // stock inchange
});

// ====== #132 — Tourelle sentinelle deployable ======

test('#132 turret : deployTurret cree une tourelle active', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.turretActive())).toBe(false);
  const ok = await page.evaluate(() => __game.debug.deployTurret());
  expect(ok).toBe(true);
  expect(await page.evaluate(() => __game.debug.turretActive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.turretCount())).toBe(1);
});

test('#132 turret : refuse un second deploiement tant qu une tourelle est active', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.deployTurret());
  const ok2 = await page.evaluate(() => __game.debug.deployTurret());
  expect(ok2).toBe(false);
  expect(await page.evaluate(() => __game.debug.turretCount())).toBe(1);
});

test('#132 turret : tire automatiquement sur un ennemi proche et lui inflige des degats', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 3, 0));
  const hpBefore = await page.evaluate(() => __game.debug.enemyHp(0));
  await page.evaluate(() => __game.debug.deployTurret());
  await page.waitForTimeout(700); // > 1 tick (0.5s)
  const hpAfter = await page.evaluate(() => __game.debug.enemyHp(0));
  expect(hpAfter).toBeLessThan(hpBefore);
});

test('#132 turret : ignore un ennemi hors de portee', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 50, 50));
  const hpBefore = await page.evaluate(() => __game.debug.enemyHp(0));
  await page.evaluate(() => __game.debug.deployTurret());
  await page.waitForTimeout(700);
  const hpAfter = await page.evaluate(() => __game.debug.enemyHp(0));
  expect(hpAfter).toBe(hpBefore);
});

// ====== #136 — Grenade EMP ======

test('#136 -> #155 : grenade EMP stock initial = 3 (persistant), throwEmp le decremente', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.empStock())).toBe(3);
  await page.evaluate(() => __game.debug.throwEmp());
  expect(await page.evaluate(() => __game.debug.empStock())).toBe(2);
  expect(await page.evaluate(() => __game.debug.empCount())).toBe(1);
});

test('#136 grenade EMP : throwEmp refuse si stock epuise', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setConsumableStock('emp', 1));
  await page.evaluate(() => __game.debug.throwEmp());
  const ok = await page.evaluate(() => __game.debug.throwEmp());
  expect(ok).toBe(false);
});

test('#136 grenade EMP : triggerEmpBlastAt desactive le tir d un ennemi shooter proche', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 3, 0));
  expect(await page.evaluate(() => __game.debug.enemyEmpDisabled(0))).toBe(false);
  await page.evaluate(() => __game.debug.triggerEmpBlastAt(3, 0));
  expect(await page.evaluate(() => __game.debug.enemyEmpDisabled(0))).toBe(true);
});

test('#136 grenade EMP : un ennemi hors rayon n est pas affecte', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 40, 40));
  await page.evaluate(() => __game.debug.triggerEmpBlastAt(0, 0));
  expect(await page.evaluate(() => __game.debug.enemyEmpDisabled(0))).toBe(false);
});

test('#136 -> #155 : grenade EMP n est plus rechargee par vague (stock persistant)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.throwEmp());
  expect(await page.evaluate(() => __game.debug.empStock())).toBe(2);   // 3 - 1
  await page.evaluate(() => __game.debug.forceNextWave());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.empStock())).toBe(2);   // stock inchange
});

// ====== #143 — Caisse de ravitaillement (care package) ======

test('#143 care package : aucune caisse en vague non multiple de 4', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forceWave(5));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.carePackageActive())).toBe(false);
});

test('#143 care package : spawnCarePackageAt cree une caisse active a la position donnee', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnCarePackageAt(3, 3));
  expect(await page.evaluate(() => __game.debug.carePackageActive())).toBe(true);
  const pos = await page.evaluate(() => __game.debug.carePackagePos());
  expect(pos.x).toBeCloseTo(3, 1);
  expect(pos.z).toBeCloseTo(3, 1);
});

test('#143 care package : ramassage par proximite applique la recompense argent et retire la caisse', async ({ page }) => {
  await startPlaying(page);
  const moneyBefore = await page.evaluate(() => __game.debug.runMoney());
  await page.evaluate(() => __game.debug.forceCarePackageReward('money'));
  await page.evaluate(() => { __game.debug.spawnCarePackageAt(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.carePackageActive())).toBe(false);
  expect(await page.evaluate(() => __game.debug.runMoney())).toBeGreaterThan(moneyBefore);
});

test('#143 care package : ramassage recompense munitions recharge le chargeur', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.tryFire()); // consomme au moins 1 munition
  const ammoAfterFire = await page.evaluate(() => __game.ammo);
  await page.evaluate(() => __game.debug.forceCarePackageReward('ammo'));
  await page.evaluate(() => { __game.debug.spawnCarePackageAt(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.ammo)).toBeGreaterThan(ammoAfterFire);
});

test('#143 care package : aucune caisse ne plante la boucle de jeu', async ({ page }) => {
  await startPlaying(page);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => __game.phase)).toBe('playing');
});

// ====== #144 — Reaction en chaine des barils ======

// Note : la map a déjà 4 barils par défaut (BARREL_SPOTS) → on raisonne en delta, pas en compte absolu.
test('#144 barils chaine : un baril voisin proche explose aussi', async ({ page }) => {
  await startPlaying(page);
  const before = await page.evaluate(() => __game.debug.barrelCount());
  const idx = await page.evaluate(() => { __game.debug.spawnBarrelInFront(5); return __game.debug.spawnBarrelInFront(5); }); // 2 barils quasi au meme endroit
  expect(await page.evaluate(() => __game.debug.barrelCount())).toBe(before + 2);
  await page.evaluate(i => __game.debug.explodeBarrelNow(i), idx);
  expect(await page.evaluate(() => __game.debug.barrelCount())).toBe(before); // les 2 nouveaux ont explose en chaine
});

test('#144 barils chaine : un baril eloigne (hors rayon) n explose pas', async ({ page }) => {
  await startPlaying(page);
  const before = await page.evaluate(() => __game.debug.barrelCount());
  const closeIdx = await page.evaluate(() => __game.debug.spawnBarrelInFront(5));
  await page.evaluate(() => __game.debug.spawnBarrelInFront(40)); // hors du rayon BARREL_R=4 du 1er
  expect(await page.evaluate(() => __game.debug.barrelCount())).toBe(before + 2);
  await page.evaluate(i => __game.debug.explodeBarrelNow(i), closeIdx);
  expect(await page.evaluate(() => __game.debug.barrelCount())).toBe(before + 1); // seul l'eloigne (+ les defauts) reste
});

test('#144 barils chaine : barrelChainCount incremente uniquement pour les explosions en cascade', async ({ page }) => {
  await startPlaying(page);
  const before = await page.evaluate(() => __game.debug.barrelChainCount());
  const idx = await page.evaluate(() => { __game.debug.spawnBarrelInFront(5); return __game.debug.spawnBarrelInFront(5); });
  await page.evaluate(i => __game.debug.explodeBarrelNow(i), idx);
  const after = await page.evaluate(() => __game.debug.barrelChainCount());
  expect(after).toBe(before + 1); // 1 seule explosion en cascade (le 1er declenchement n'est pas compte)
});

// ====== #178 — Consommable Trousse de soin ======

test('#178 : stock par defaut est 3', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.medkitStock())).toBe(3);
});

test('#178 : useMedkit restaure 30 PV et decremente le stock', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setShield(0); __game.debug.damagePlayer(50); });
  const hpBefore = await page.evaluate(() => __game.debug.playerHealth());
  const stockBefore = await page.evaluate(() => __game.debug.medkitStock());
  expect(await page.evaluate(() => __game.debug.useMedkit())).toBe(true);
  const hpAfter = await page.evaluate(() => __game.debug.playerHealth());
  expect(hpAfter - hpBefore).toBe(30);
  expect(await page.evaluate(() => __game.debug.medkitStock())).toBe(stockBefore - 1);
});

test('#178 : useMedkit a stock 0 echoue, PV inchanges', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setShield(0); __game.debug.damagePlayer(50); for(let i=0;i<10;i++) __game.debug.useMedkit(); });
  expect(await page.evaluate(() => __game.debug.medkitStock())).toBe(0);
  const hpBefore = await page.evaluate(() => __game.debug.playerHealth());
  expect(await page.evaluate(() => __game.debug.useMedkit())).toBe(false);
  expect(await page.evaluate(() => __game.debug.playerHealth())).toBe(hpBefore);
});

test('#178 : en hardcore useMedkit echoue sans consommer le stock', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setHardcore(true); __game.debug.setShield(0); __game.debug.damagePlayer(50); });
  const stockBefore = await page.evaluate(() => __game.debug.medkitStock());
  expect(await page.evaluate(() => __game.debug.useMedkit())).toBe(false);
  expect(await page.evaluate(() => __game.debug.medkitStock())).toBe(stockBefore);
});

test('#178 : la touche Z declenche useMedkit', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setShield(0); __game.debug.damagePlayer(50); });
  const stockBefore = await page.evaluate(() => __game.debug.medkitStock());
  await page.evaluate(() => __game.debug.setInput({}));
  await page.keyboard.press('KeyZ');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.medkitStock())).toBe(stockBefore - 1);
});

test('#178 : achat en boutique incremente le stock persiste', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(1000); });
  const before = await page.evaluate(() => __game.debug.save.get().consumables.medkit);
  expect(await page.evaluate(() => __game.debug.shop.buyConsumable('medkit'))).toBe(true);
  const after = await page.evaluate(() => __game.debug.save.get().consumables.medkit);
  expect(after).toBe(before + 1);
});

// ====== #198 — Caisse de ravitaillement : recompense trousses de soin ======

test('#198 : recompense medkit octroie +2 trousses de soin', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  const before = await page.evaluate(() => __game.debug.medkitStock());
  await page.evaluate(() => __game.debug.forceCarePackageReward('medkit'));
  await page.evaluate(() => { __game.debug.spawnCarePackageAt(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.medkitStock())).toBe(before + 2);
});
