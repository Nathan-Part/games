import { test, expect } from '@playwright/test';
import { trackErrors, startPlaying, faceEnemyForMelee, alignTwoEnemies } from './helpers.js';

// ====== Tranche 34 : power-ups ======

test('power : drop force a la mort', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.forcePowerDrop(true); __game.debug.spawnEnemyAt(0,3); __game.debug.damageEnemy(0,99999); });
  expect(await page.evaluate(() => __game.debug.powerUpCount())).toBeGreaterThanOrEqual(1);
});

test('power : ramasser x2 degats double le multiplicateur', async ({ page }) => {
  await startPlaying(page);
  const d0 = await page.evaluate(() => __game.debug.liveDamage());
  const pos = await page.evaluate(() => __game.position());
  await page.evaluate(p => __game.debug.spawnPowerUp('dmgx2', p.x, p.z), pos);
  await page.waitForFunction(() => __game.debug.activePowerUp() === 'dmgx2', null, { timeout:3000 });
  expect(await page.evaluate(() => __game.debug.liveDamage())).toBeCloseTo(d0 * 2, 3);
});

test('power : un seul actif a la fois (le dernier remplace)', async ({ page }) => {
  await startPlaying(page);
  const pos = await page.evaluate(() => __game.position());
  await page.evaluate(p => __game.debug.spawnPowerUp('dmgx2', p.x, p.z), pos);
  await page.waitForFunction(() => __game.debug.activePowerUp() === 'dmgx2', null, { timeout:3000 });
  await page.evaluate(p => __game.debug.spawnPowerUp('rapid', p.x, p.z), pos);
  await page.waitForFunction(() => __game.debug.activePowerUp() === 'rapid', null, { timeout:3000 });
});

test('power : l effet expire', async ({ page }) => {
  test.setTimeout(30000);
  await startPlaying(page);
  const d0 = await page.evaluate(() => __game.debug.liveDamage());
  const pos = await page.evaluate(() => __game.position());
  await page.evaluate(p => __game.debug.spawnPowerUp('dmgx2', p.x, p.z), pos);
  await page.waitForFunction(() => __game.debug.activePowerUp() === 'dmgx2', null, { timeout:3000 });
  await page.waitForFunction(() => __game.debug.activePowerUp() === null, null, { timeout:12000 });   // ~8 s
  expect(await page.evaluate(() => __game.debug.liveDamage())).toBeCloseTo(d0, 3);
});

// ====== Tranche 42 : power-up slow-mo ======

test('slowmo : ralentit le temps ennemi le temps du power-up', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.enemyTimeScale())).toBe(1);
  const pos = await page.evaluate(() => __game.position());
  const d0 = await page.evaluate(() => __game.debug.liveDamage());
  await page.evaluate(p => __game.debug.spawnPowerUp('slowmo', p.x, p.z), pos);
  await page.waitForFunction(() => __game.debug.activePowerUp() === 'slowmo', null, { timeout:3000 });
  expect(await page.evaluate(() => __game.debug.enemyTimeScale())).toBeLessThan(1);
  expect(await page.evaluate(() => __game.debug.liveDamage())).toBeCloseTo(d0, 3);
});

// ====== #95 — Extended Mag power-up ======

test('#95 extmag : extMagActive() false par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.extMagActive())).toBe(false);
});

test('#95 extmag : spawnExtMag() puis collecte double curMag', async ({ page }) => {
  await startPlaying(page);
  const baseMag = await page.evaluate(() => __game.debug.curMag());
  await page.evaluate(() => __game.debug.spawnExtMag(0, 0));
  await page.evaluate(() => __game.debug.setPos(0, 0));
  await page.waitForTimeout(500);
  const newMag = await page.evaluate(() => __game.debug.curMag());
  expect(newMag).toBe(baseMag * 2);
  expect(await page.evaluate(() => __game.debug.extMagActive())).toBe(true);
});

test('#95 extmag : extMagTimeLeft() proche de 15s apres collecte', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnExtMag(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(500);
  const tl = await page.evaluate(() => __game.debug.extMagTimeLeft());
  expect(tl).toBeGreaterThan(0);
  // durée annoncée = 15s ; après ~0.5s de collecte il doit rester nettement plus que 8s
  expect(tl).toBeGreaterThan(12);
});

// ====== #109 — Shield orb power-up ======

test('#109 shield orb : lastShieldOrbPickup() false par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.lastShieldOrbPickup())).toBe(false);
});

test('#109 shield orb : spawnShieldOrb puis collecte recharge le bouclier', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(0));
  await page.evaluate(() => __game.debug.spawnShieldOrb(0, 0));
  await page.evaluate(() => __game.debug.setPos(0, 0));
  await page.waitForTimeout(400);
  const max = await page.evaluate(() => __game.debug.maxShield());
  expect(await page.evaluate(() => __game.debug.shieldHp())).toBe(max);   // l'orbe recharge au max (25 désormais)
  expect(await page.evaluate(() => __game.debug.lastShieldOrbPickup())).toBe(true);
});

test('#109 shield orb : spawnShieldOrb incremente powerUpCount', async ({ page }) => {
  await startPlaying(page);
  const before = await page.evaluate(() => __game.debug.powerUpCount());
  await page.evaluate(() => __game.debug.spawnShieldOrb(50, 50));
  expect(await page.evaluate(() => __game.debug.powerUpCount())).toBe(before + 1);
});

// ====== #122 — XP boost power-up ======

test('#122 xp_boost : spawnXpBoost cree un power-up ramassable', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnXpBoost(0, 0));
  await page.evaluate(() => __game.debug.setPos(0, 0));
  await page.waitForTimeout(300);
  const active = await page.evaluate(() => __game.debug.activePowerUp());
  expect(active).toBe('xp_boost');
});

test('#122 xp_boost : addXp x2 quand actif', async ({ page }) => {
  await startPlaying(page);
  const xpBefore = await page.evaluate(() => __game.debug.xpTotal());
  await page.evaluate(() => {
    __game.debug.spawnXpBoost(0, 0);
    __game.debug.setPos(0, 0);
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => __game.debug.addXp(100));
  const xpAfter = await page.evaluate(() => __game.debug.xpTotal());
  expect(xpAfter - xpBefore).toBeGreaterThanOrEqual(150); // at least 100 xp (non-boosted) but should be 200
});

test('#122 xp_boost : xpBoostActive retourne true quand actif', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnXpBoost(0, 0));
  await page.evaluate(() => __game.debug.setPos(0, 0));
  await page.waitForTimeout(300);
  const boosted = await page.evaluate(() => __game.debug.xpBoostActive());
  expect(boosted).toBe(true);
});

// ====== #123 — Explosive ammo power-up ======

test('#123 explosive_ammo : spawnExplosiveAmmo puis pickup active le power', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnExplosiveAmmo(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  const active = await page.evaluate(() => __game.debug.explosiveAmmoActive());
  expect(active).toBe(true);
});

test('#123 explosive_ammo : tir sur ennemi cause degats AoE a un ennemi proche', async ({ page }) => {
  await startPlaying(page);
  // Activer les munitions explosives
  await page.evaluate(() => { __game.debug.spawnExplosiveAmmo(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  // Spawn ennemi 0 droit devant la caméra, ennemi 1 très proche
  const pos0 = await page.evaluate(() => {
    __game.debug.spawnEnemyInFront(4); // devant la caméra courante
    return __game.debug.enemyPos(0);
  });
  await page.evaluate((p) => __game.debug.spawnEnemyTypeAt(1, 'shooter', p.x + 0.7, p.z), pos0);
  await page.waitForTimeout(100);
  const hp1Before = await page.evaluate(() => __game.debug.enemyHp(0));
  const hp2Before = await page.evaluate(() => __game.debug.enemyHp(1));
  await page.evaluate(() => __game.debug.tryFire());
  await page.waitForTimeout(200);
  const hp1After = await page.evaluate(() => __game.debug.enemyHp(0));
  const hp2After = await page.evaluate(() => __game.debug.enemyHp(1));
  // l'ennemi 0 est touché directement (le tir a bien atteint sa cible)
  expect(hp1After).toBeLessThan(hp1Before);
  // PREUVE de l'AoE : l'ennemi 1, JAMAIS visé directement (0.7m < R=2m), prend aussi des dégâts
  expect(hp2After).toBeLessThan(hp2Before);
});

test('#123 explosive_ammo : explosiveAmmoTimeLeft > 0 quand actif', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnExplosiveAmmo(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  const tl = await page.evaluate(() => __game.debug.explosiveAmmoTimeLeft());
  expect(tl).toBeGreaterThan(0);
});

// ====== #127 — Speed boost power-up ======

test('#127 speed_boost : spawnSpeedBoost puis pickup active le power', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnSpeedBoost(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  const active = await page.evaluate(() => __game.debug.speedBoostActive());
  expect(active).toBe(true);
});

test('#127 speed_boost : speedBoostTimeLeft > 0 quand actif', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnSpeedBoost(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  const tl = await page.evaluate(() => __game.debug.speedBoostTimeLeft());
  expect(tl).toBeGreaterThan(0);
});

test('#127 speed_boost : la vitesse effective est doublee (x2) quand actif', async ({ page }) => {
  await startPlaying(page);
  // vitesse normale (marche, sans boost)
  await page.evaluate(() => { __game.debug.setPos(0, 0); __game.debug.setInput({ forward: true }); });
  await page.waitForTimeout(200);
  const baseSpeed = await page.evaluate(() => __game.debug.playerMoveSpeed());
  await page.evaluate(() => __game.debug.setInput({}));
  expect(baseSpeed).toBeGreaterThan(0);
  // activer le boost puis re-mesurer
  await page.evaluate(() => { __game.debug.spawnSpeedBoost(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300); // pickup
  expect(await page.evaluate(() => __game.debug.speedBoostActive())).toBe(true);
  await page.evaluate(() => { __game.debug.setPos(0, 0); __game.debug.setInput({ forward: true }); });
  await page.waitForTimeout(200);
  const boostedSpeed = await page.evaluate(() => __game.debug.playerMoveSpeed());
  await page.evaluate(() => __game.debug.setInput({}));
  // ratio exactement 2 (même mode de marche, seul le boost change)
  expect(boostedSpeed / baseSpeed).toBeCloseTo(2, 1);
});

// ====== #133 — Orbe vampire (lifesteal) ======

test('#133 vampire : spawnVampireOrb puis pickup active le power', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnVampireOrb(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.vampireActive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.vampireTimeLeft())).toBeGreaterThan(0);
});

test('#133 vampire : damageEnemy soigne le joueur pendant l effet actif', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnVampireOrb(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  await page.evaluate(() => __game.debug.damagePlayer(40)); // baisse les PV pour laisser de la marge au heal
  const hpBefore = await page.evaluate(() => __game.debug.playerHealth());
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0, 'shooter', 3, 0); __game.debug.damageEnemy(0, 50); });
  const hpAfter = await page.evaluate(() => __game.debug.playerHealth());
  expect(hpAfter).toBeGreaterThan(hpBefore);
});

test('#133 vampire : pas de heal hors effet actif', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.damagePlayer(40));
  const hpBefore = await page.evaluate(() => __game.debug.playerHealth());
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0, 'shooter', 3, 0); __game.debug.damageEnemy(0, 50); });
  const hpAfter = await page.evaluate(() => __game.debug.playerHealth());
  expect(hpAfter).toBe(hpBefore);
});

test('#133 vampire : pas de heal en mode hardcore', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setHardcore(true));
  await page.evaluate(() => { __game.debug.spawnVampireOrb(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  await page.evaluate(() => __game.debug.damagePlayer(40));
  const hpBefore = await page.evaluate(() => __game.debug.playerHealth());
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0, 'shooter', 3, 0); __game.debug.damageEnemy(0, 50); });
  const hpAfter = await page.evaluate(() => __game.debug.playerHealth());
  expect(hpAfter).toBe(hpBefore);
  await page.evaluate(() => __game.debug.setHardcore(false));
});

// ====== #145 — Power-up Visee stable (spread nul) ======

test('#145 steady aim : spawn puis pickup active le power', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnSteadyAim(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.steadyAimActive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.steadyAimTimeLeft())).toBeGreaterThan(0);
});

test('#145 steady aim : neutralise le malus de spread en course', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setInput({forward:true, sprint:true}));
  const spreadNormal = await page.evaluate(() => __game.debug.currentSpread());
  expect(spreadNormal).toBeGreaterThan(1);
  await page.evaluate(() => { __game.debug.spawnSteadyAim(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  await page.evaluate(() => __game.debug.setInput({forward:true, sprint:true}));
  expect(await page.evaluate(() => __game.debug.currentSpread())).toBe(1);
});

// ====== #147 — Power-up Regen boost ======

test('#147 regen boost : spawn puis pickup active le power', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnRegenBoost(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.regenBoostActive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.regenBoostTimeLeft())).toBeGreaterThan(0);
});

test('#147 regen boost : la regeneration est plus rapide avec le power actif', async ({ page }) => {
  test.setTimeout(45000);
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(0));
  await page.evaluate(() => __game.debug.damagePlayer(50));
  await page.waitForTimeout(7500); // REGEN_DELAY=6s + un peu de regen
  const hpNormal = await page.evaluate(() => __game.debug.playerHealth());

  await page.evaluate(() => __game.debug.restart());
  await page.waitForTimeout(100);
  await page.evaluate(() => __game.debug.setShield(0));
  await page.evaluate(() => __game.debug.damagePlayer(50));
  await page.evaluate(() => { __game.debug.spawnRegenBoost(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(7500);
  const hpBoosted = await page.evaluate(() => __game.debug.playerHealth());
  expect(hpBoosted).toBeGreaterThan(hpNormal);
});

// ====== #150 — Power-up Munitions perforantes (piercing) ======

test('#150 piercing : spawn puis pickup active le power', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnPiercingRounds(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.piercingRoundsActive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.piercingRoundsTimeLeft())).toBeGreaterThan(0);
});

test('#150 piercing : un tir aligne blesse les 2 ennemis quand le power est actif', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnPiercingRounds(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  await alignTwoEnemies(page);
  const hp0Before = await page.evaluate(() => __game.debug.enemyHp(0));
  const hp1Before = await page.evaluate(() => __game.debug.enemyHp(1));
  await page.evaluate(() => __game.debug.tryFire());
  const hp0After = await page.evaluate(() => __game.debug.enemyHp(0));
  const hp1After = await page.evaluate(() => __game.debug.enemyHp(1));
  expect(hp0After).toBeLessThan(hp0Before);
  expect(hp1After).toBeLessThan(hp1Before);
});

test('#150 piercing : sans le power, seul le 1er ennemi aligne est touche', async ({ page }) => {
  await startPlaying(page);
  await alignTwoEnemies(page);
  const hp0Before = await page.evaluate(() => __game.debug.enemyHp(0));
  const hp1Before = await page.evaluate(() => __game.debug.enemyHp(1));
  await page.evaluate(() => __game.debug.tryFire());
  const hp0After = await page.evaluate(() => __game.debug.enemyHp(0));
  const hp1After = await page.evaluate(() => __game.debug.enemyHp(1));
  expect(hp0After).toBeLessThan(hp0Before);
  expect(hp1After).toBe(hp1Before);
});

test('#150 piercing : piercedHitCount incremente quand un 2e ennemi est perfore', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnPiercingRounds(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  await alignTwoEnemies(page);
  const before = await page.evaluate(() => __game.debug.piercedHitCount());
  await page.evaluate(() => __game.debug.tryFire());
  const after = await page.evaluate(() => __game.debug.piercedHitCount());
  expect(after).toBe(before + 1);
});

// ====== #152 — Power-up Munitions incendiaires ======

test('#152 incendiary : spawn puis pickup active le power', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnIncendiaryAmmo(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.incendiaryAmmoActive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.incendiaryAmmoTimeLeft())).toBeGreaterThan(0);
});

test('#152 incendiary : un impact sur un ennemi allume une zone de feu active', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnIncendiaryAmmo(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { __game.debug.setView('first'); __game.debug.setPitch(0); });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => __game.debug.fireZoneActive())).toBe(false);
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8));
  await page.evaluate(() => __game.debug.tryFire());
  expect(await page.evaluate(() => __game.debug.fireZoneActive())).toBe(true);
});

test('#152 incendiary : sans le power, aucune zone de feu n est allumee par un tir', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setView('first'); __game.debug.setPitch(0); });
  await page.waitForTimeout(150);
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8));
  await page.evaluate(() => __game.debug.tryFire());
  expect(await page.evaluate(() => __game.debug.fireZoneActive())).toBe(false);
});

// ====== #153 — Power-up Tir chanceux (crit aleatoire) ======

test('#153 lucky shot : spawn puis pickup active le power', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnLuckyShot(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.luckyShotActive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.luckyShotTimeLeft())).toBeGreaterThan(0);
});

test('#153 lucky shot : forceLuckyShot(true) double les degats du tir suivant', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setView('first'); __game.debug.setPitch(0); });
  await page.waitForTimeout(150);
  await page.evaluate(() => { __game.debug.spawnLuckyShot(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { __game.debug.setView('first'); __game.debug.setPitch(0); });
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8));
  const hpBefore1 = await page.evaluate(() => __game.debug.enemyHp(0));
  await page.evaluate(() => __game.debug.forceLuckyShot(false));
  await page.evaluate(() => __game.debug.tryFire());
  const normalDmg = hpBefore1 - (await page.evaluate(() => __game.debug.enemyHp(0)));

  await page.evaluate(() => __game.debug.spawnEnemyInFront(8)); // revit enemies[0] à PV pleins
  await page.waitForTimeout(400); // laisse expirer le cooldown de tir
  await page.evaluate(() => __game.debug.setPitch(0)); // annule un eventuel recul residuel (meme zone visee)
  const hpBefore2 = await page.evaluate(() => __game.debug.enemyHp(0));
  await page.evaluate(() => __game.debug.forceLuckyShot(true));
  await page.evaluate(() => __game.debug.tryFire());
  const luckyDmg = hpBefore2 - (await page.evaluate(() => __game.debug.enemyHp(0)));
  expect(luckyDmg).toBe(normalDmg * 2);
  expect(await page.evaluate(() => __game.debug.lastLuckyShot())).toBe(true);
});

test('#153 lucky shot : luckyShotCount incremente uniquement sur un crit reel', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setView('first'); __game.debug.setPitch(0); });
  await page.waitForTimeout(150);
  await page.evaluate(() => { __game.debug.spawnLuckyShot(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { __game.debug.setView('first'); __game.debug.setPitch(0); });
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8));
  const before = await page.evaluate(() => __game.debug.luckyShotCount());
  await page.evaluate(() => __game.debug.forceLuckyShot(false));
  await page.evaluate(() => __game.debug.tryFire());
  expect(await page.evaluate(() => __game.debug.luckyShotCount())).toBe(before);
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8));
  await page.waitForTimeout(400);
  await page.evaluate(() => __game.debug.forceLuckyShot(true));
  await page.evaluate(() => __game.debug.tryFire());
  expect(await page.evaluate(() => __game.debug.luckyShotCount())).toBe(before + 1);
});

// ====== #154 — Power-up Full-auto override ======

test('#154 full auto : spawn puis pickup active le power', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnFullAuto(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.fullAutoActive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.fullAutoTimeLeft())).toBeGreaterThan(0);
});

test('#154 full auto : maintenir le tir en semi-auto ne tire qu une fois SANS le power', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setSemiAuto(true));
  const ammoBefore = await page.evaluate(() => __game.ammo);
  await page.evaluate(() => __game.debug.setInput({fire:true}));
  await page.waitForTimeout(600);
  await page.evaluate(() => __game.debug.setInput({}));
  const ammoAfter = await page.evaluate(() => __game.ammo);
  expect(ammoBefore - ammoAfter).toBe(1); // 1 seul coup malgre le maintien (semi-auto)
});

test('#154 full auto : maintenir le tir en semi-auto tire plusieurs fois AVEC le power actif', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setSemiAuto(true));
  await page.evaluate(() => { __game.debug.spawnFullAuto(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  const ammoBefore = await page.evaluate(() => __game.ammo);
  await page.evaluate(() => __game.debug.setInput({fire:true}));
  await page.waitForTimeout(600);
  await page.evaluate(() => __game.debug.setInput({}));
  const ammoAfter = await page.evaluate(() => __game.ammo);
  expect(ammoBefore - ammoAfter).toBeGreaterThan(1); // plusieurs coups malgre le semi-auto (override)
});

// ====== #160 — Power-up Aimant a argent ======

test('#160 : spawn puis pickup active le power money_magnet', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnMoneyMagnet(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.moneyMagnetActive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.moneyMagnetTimeLeft())).toBeGreaterThan(0);
});

test('#160 : un orbe a 4m est collecte avec l aimant actif, pas sans', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setPos(0, 0));
  await page.evaluate(() => __game.debug.spawnMoneyOrb(4, 0, 10));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.moneyOrbCount())).toBe(1);   // hors du rayon normal (1.5m) -> pas collecte
  await page.evaluate(() => { __game.debug.spawnMoneyMagnet(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.moneyOrbCount())).toBe(0);   // dans le rayon elargi (6m) -> collecte
});

// ====== #167 — Power-up Kevlar ======

test('#167 : spawn puis pickup active le power kevlar', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnKevlar(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.kevlarActive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.kevlarTimeLeft())).toBeGreaterThan(0);
});

test('#167 : kevlar reduit les degats recus de 30%', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(0));
  const hpBefore = await page.evaluate(() => __game.debug.playerHealth());
  await page.evaluate(() => { __game.debug.spawnKevlar(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  await page.evaluate(() => __game.debug.damagePlayer(100));
  const hpAfter = await page.evaluate(() => __game.debug.playerHealth());
  expect(hpBefore - hpAfter).toBeCloseTo(70, 0);
});

// ====== #171 — Power-up Berserk ======

test('#171 : spawn puis pickup active le power berserk', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnBerserk(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.berserkActive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.berserkTimeLeft())).toBeGreaterThan(0);
});

test('#171 : melee normal inflige les degats de base (sans berserk)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => {
    for(let i=0;i<3;i++) __game.debug.moveEnemy(i,40,40);
    __game.debug.spawnEnemyTypeAt(0, 'juggernaut', 0, 2);   // gros pool de PV pour mesurer le degat sans tuer
    __game.debug.setPos(0,0); __game.debug.setYaw(0); __game.debug.setPitch(0); __game.debug.setView('first');
    __game.debug.setPaused(true);
  });
  const hp0 = await page.evaluate(() => __game.debug.enemyHp(0));
  await page.evaluate(() => __game.debug.playerMelee());
  const hpAfter = await page.evaluate(() => __game.debug.enemyHp(0));
  expect(hp0 - hpAfter).toBe(150);
});

test('#171 : berserk double les degats au couteau', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => {
    for(let i=0;i<3;i++) __game.debug.moveEnemy(i,40,40);
    __game.debug.spawnEnemyTypeAt(0, 'juggernaut', 0, 2);
    __game.debug.setPos(0,0); __game.debug.setYaw(0); __game.debug.setPitch(0); __game.debug.setView('first');
    __game.debug.spawnBerserk(0, 0);
  });
  await page.waitForTimeout(300);
  const hp0 = await page.evaluate(() => __game.debug.enemyHp(0));
  await page.evaluate(() => { __game.debug.setPaused(true); __game.debug.playerMelee(); });
  const hpAfter = await page.evaluate(() => __game.debug.enemyHp(0));
  expect(hp0 - hpAfter).toBe(300);
});

// ====== #172 — Power-up Trousse instantanee ======

test('#172 : pickup restaure 40 PV (plafonne au max)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setShield(0); __game.debug.damagePlayer(50); });
  const hpBefore = await page.evaluate(() => __game.debug.playerHealth());
  await page.evaluate(() => { __game.debug.spawnInstantHeal(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  const hpAfter = await page.evaluate(() => __game.debug.playerHealth());
  expect(hpAfter - hpBefore).toBe(40);
});

test('#172 : en hardcore, le pickup ne change pas les PV', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setHardcore(true); __game.debug.setShield(0); __game.debug.damagePlayer(50); });
  const hpBefore = await page.evaluate(() => __game.debug.playerHealth());
  await page.evaluate(() => { __game.debug.spawnInstantHeal(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  const hpAfter = await page.evaluate(() => __game.debug.playerHealth());
  expect(hpAfter).toBe(hpBefore);
});

// ====== #179 — Power-up Radar longue portee ======

test('#179 : spawn puis pickup active le power radar_boost', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnRadarBoost(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.radarBoostActive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.radarBoostTimeLeft())).toBeGreaterThan(0);
});

test('#179 : radar.range() double pendant le power', async ({ page }) => {
  await startPlaying(page);
  const rangeBefore = await page.evaluate(() => __game.debug.radar.range());
  expect(rangeBefore).toBe(28);
  await page.evaluate(() => { __game.debug.spawnRadarBoost(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.radar.range())).toBe(56);
});

test('#179 : un ennemi a portee intermediaire n apparait inRange qu avec le power actif', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setPos(0,0); __game.debug.spawnEnemyTypeAt(0,'shooter',40,0); });
  const before = (await page.evaluate(() => __game.debug.radar.blips())).find(b => b.id === 0);
  expect(before.inRange).toBe(false);
  await page.evaluate(() => { __game.debug.spawnRadarBoost(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  const after = (await page.evaluate(() => __game.debug.radar.blips())).find(b => b.id === 0);
  expect(after.inRange).toBe(true);
});

// ====== #181 — Power-up Second souffle ravive ======

test('#181 : pickup reactive secondWindUsed a false apres consommation', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.damagePlayer(9999));   // consomme le dernier souffle
  expect(await page.evaluate(() => __game.debug.secondWindUsed())).toBe(true);
  await page.evaluate(() => { __game.debug.spawnSecondWindRefill(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.secondWindUsed())).toBe(false);
});

// ====== #188 — Power-up Loot Master ======

test('#188 : spawn puis pickup active le power loot_master', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnLootMaster(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.lootMasterActive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.lootMasterTimeLeft())).toBeGreaterThan(0);
});

test('#188 : forceHealthDrop reste prioritaire pendant loot_master (pas de crash, pack toujours cree)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnLootMaster(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  await page.evaluate(() => __game.debug.forceHealthDrop(true));
  const before = await page.evaluate(() => __game.debug.healthPackCount());
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0,'shooter',4,4); __game.debug.damageEnemy(0, 99999); });
  const after = await page.evaluate(() => __game.debug.healthPackCount());
  expect(after).toBeGreaterThan(before);
});

// ====== #189 — Power-up Ricochet ameliore ======

test('#189 : spawn puis pickup active le power ricochet_boost', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnRicochetBoost(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.ricochetBoostActive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.ricochetBoostTimeLeft())).toBeGreaterThan(0);
});

// ====== #200 — Power-up Vague de choc ======

test('#200 : un ennemi proche subit 80 degats au ramassage', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => {
    for(let i=0;i<3;i++) __game.debug.moveEnemy(i,40,40);
    __game.debug.spawnEnemyTypeAt(0, 'juggernaut', 4, 0);
    __game.debug.setPos(0,0);
  });
  const hp0 = await page.evaluate(() => __game.debug.enemyHp(0));
  await page.evaluate(() => __game.debug.spawnNovaBlast(0, 0));
  await page.waitForTimeout(300);
  const hp1 = await page.evaluate(() => __game.debug.enemyHp(0));
  expect(hp0 - hp1).toBe(80);
});

test('#200 : un ennemi hors de portee n est pas affecte', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => {
    for(let i=0;i<3;i++) __game.debug.moveEnemy(i,40,40);
    __game.debug.spawnEnemyTypeAt(0, 'juggernaut', 20, 0);
    __game.debug.setPos(0,0);
  });
  const hp0 = await page.evaluate(() => __game.debug.enemyHp(0));
  await page.evaluate(() => __game.debug.spawnNovaBlast(0, 0));
  await page.waitForTimeout(300);
  const hp1 = await page.evaluate(() => __game.debug.enemyHp(0));
  expect(hp1).toBe(hp0);
});
