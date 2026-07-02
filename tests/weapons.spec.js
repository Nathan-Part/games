import { test, expect } from '@playwright/test';
import { trackErrors, startPlaying, faceEnemyForMelee, alignTwoEnemies } from './helpers.js';

test('tirer sur une cible devant => score +1 et la cible disparaît', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.clearTargets());
  expect(await page.evaluate(() => __game.debug.targetsAlive())).toBe(0);
  await page.evaluate(() => __game.debug.spawnTargetInFront(8));
  expect(await page.evaluate(() => __game.debug.targetsAlive())).toBe(1);
  const score0 = await page.evaluate(() => __game.score);
  const fired = await page.evaluate(() => __game.debug.tryFire());
  expect(fired).toBe(true);
  expect(await page.evaluate(() => __game.score)).toBe(score0 + 1);
  expect(await page.evaluate(() => __game.debug.targetsAlive())).toBe(0);
});

test('rater (aucune cible) ne score pas', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.clearTargets());
  const score0 = await page.evaluate(() => __game.score);
  const fired = await page.evaluate(() => __game.debug.tryFire());
  expect(fired).toBe(true);                                       // un tir part bien
  expect(await page.evaluate(() => __game.score)).toBe(score0);   // mais aucun hit
});

test('le cooldown limite la cadence de tir', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.clearTargets());
  // deux tirs dans le MÊME tick (un seul evaluate) => vraiment « immédiats »,
  // sans dépendre du timing des aller-retours Playwright (cooldown = 0.12 s).
  const [a, b] = await page.evaluate(() => [__game.debug.tryFire(), __game.debug.tryFire()]);
  expect(a).toBe(true);    // 1er tir part
  expect(b).toBe(false);   // 2e bloqué par le cooldown
});

test('munitions : se vident en tirant, et la recharge les refait', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.clearTargets());
  await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    for(let i=0;i<30 && __game.ammo>0;i++){ __game.debug.tryFire(); await sleep(140); } // > cooldown
  });
  expect(await page.evaluate(() => __game.ammo)).toBe(0);
  expect(await page.evaluate(() => __game.debug.tryFire())).toBe(false); // à vide, plus de tir
  await page.evaluate(() => __game.debug.reload());
  await page.waitForFunction(() => __game.ammo > 0, null, { timeout:5000 });
});

test('viser rapproche la caméra', async ({ page }) => {
  await startPlaying(page);
  await page.waitForTimeout(200);
  const d0 = await page.evaluate(() => __game.camera().dist);
  await page.evaluate(() => __game.debug.setInput({ aim:true }));
  await page.waitForFunction(d => window.__game.camera().dist < d - 0.5, d0, { timeout:5000 });
});

test('la touche A (KeyQ azerty) permet de viser', async ({ page }) => {
  await startPlaying(page);
  await page.waitForTimeout(200);
  const d0 = await page.evaluate(() => __game.camera().dist);
  await page.keyboard.down('q');                          // 'A' sur AZERTY = code KeyQ
  await page.waitForFunction(d => window.__game.camera().dist < d - 0.5, d0, { timeout:5000 });
  await page.keyboard.up('q');
});

test('la touche E tire (consomme une munition)', async ({ page }) => {
  await startPlaying(page);
  const a0 = await page.evaluate(() => __game.ammo);
  await page.keyboard.down('e');
  await page.waitForFunction(a => window.__game.ammo < a, a0, { timeout:3000 });
  await page.keyboard.up('e');
});

test('la touche F recharge (et R ne recharge plus)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    for(let i=0;i<3;i++){ __game.debug.tryFire(); await sleep(140); }
  });
  const a0 = await page.evaluate(() => __game.ammo);
  expect(a0).toBeLessThan(12);
  const full = await page.evaluate(() => __game.debug.curMag());
  await page.keyboard.press('f');                         // F = recharger
  // recharger avec ammo>0 donne +1 (bonus rechargement tactique #108)
  await page.waitForFunction(f => __game.ammo === f + 1, full, { timeout:5000 });
});

test('tirer sur un ennemi devant lui inflige des dégâts', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  // vue 1re personne, regard horizontal => le rayon passe à hauteur du hitbox
  await page.evaluate(() => { __game.debug.setView('first'); __game.debug.setPitch(0); });
  await page.waitForTimeout(120);
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8));
  const hp0 = await page.evaluate(() => __game.debug.enemyHp(0));   // 100
  const fired = await page.evaluate(() => __game.debug.tryFire());
  expect(fired).toBe(true);
  const hp1 = await page.evaluate(() => __game.debug.enemyHp(0));
  // tir à hauteur des yeux = tête (60 dégâts) : touché mais PAS tué en 1 balle (bots coriaces)
  expect(hp1).toBeLessThan(hp0);
  expect(hp1).toBeGreaterThan(0);
});

test('l’ennemi fait à peu près la taille du joueur (pas géant) et utilise le modèle enemie', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  const eh = await page.evaluate(() => __game.debug.enemyHeight());
  const ph = await page.evaluate(() => __game.debug.playerHeight());
  expect(eh).toBeGreaterThan(ph*0.8);   // pas nain
  expect(eh).toBeLessThan(ph*1.25);     // pas géant (avant fix : ~1.8x => échouait)
  expect((await page.evaluate(() => __game.debug.enemyLabel())).toLowerCase()).toContain('enem');
});

test('hitZoneDamage : tête/torse/jambes', async ({ page }) => {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.booted);
  const z = (y) => page.evaluate(yy => __game.debug.hitZoneDamage(yy), y);
  expect((await z(1.7)).zone).toBe('head');  expect((await z(1.7)).damage).toBe(60);
  expect((await z(1.0)).zone).toBe('torso'); expect((await z(1.0)).damage).toBe(25);
  expect((await z(0.3)).zone).toBe('legs');  expect((await z(0.3)).damage).toBe(15);
});

test('arme : chargee depuis artefact (GLB) et tenue a la main droite', async ({ page }) => {
  // ce test charge le VRAI GLB (pas de flag arme-rapide)
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.characters?.length >= 1, null, { timeout:20000 });
  await page.evaluate(() => __game.debug.start(0));
  await page.waitForFunction(() => window.__game.phase === 'playing', null, { timeout:20000 });
  await page.waitForFunction(() => window.__game.debug.weapon?.held?.() === true, null, { timeout:30000 });
  expect(await page.evaluate(() => __game.debug.weapon.source())).toBe('glb');
  expect(await page.evaluate(() => __game.debug.weapon.handBone())).toBe('RightHand');
});

test('arme : viewmodel visible en 1re personne seulement', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.weapon?.held?.() === true, null, { timeout:20000 });
  expect(await page.evaluate(() => __game.debug.weapon.viewmodelVisible())).toBe(false);
  await page.evaluate(() => __game.debug.setView('first'));
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => __game.debug.weapon.viewmodelVisible())).toBe(true);
  await page.evaluate(() => __game.debug.setView('third'));
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => __game.debug.weapon.viewmodelVisible())).toBe(false);
});

test('arme : tirer provoque un recul', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.weapon?.held?.() === true, null, { timeout:20000 });
  expect(await page.evaluate(() => __game.debug.weapon.recoil())).toBeLessThan(0.2);
  await page.evaluate(() => __game.debug.tryFire());
  expect(await page.evaluate(() => __game.debug.weapon.recoil())).toBeGreaterThan(0.5);
});

test('visee : l arme passe en position ADS et revient', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.weapon?.held?.() === true, null, { timeout:30000 });
  await page.evaluate(() => __game.debug.setView('first'));
  expect(await page.evaluate(() => __game.debug.weapon.adsProgress())).toBeLessThan(0.2);
  await page.evaluate(() => __game.debug.setInput({ aim:true }));
  await page.waitForFunction(() => __game.debug.weapon.adsProgress() > 0.6, null, { timeout:3000 });
  await page.evaluate(() => __game.debug.setInput({}));
  await page.waitForFunction(() => __game.debug.weapon.adsProgress() < 0.2, null, { timeout:3000 });
});

test('visee : le viseur s affiche en visee', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.weapon?.held?.() === true, null, { timeout:30000 });
  expect(await page.evaluate(() => __game.debug.weapon.sightVisible())).toBe(false);
  await page.evaluate(() => __game.debug.setInput({ aim:true }));
  await page.waitForFunction(() => __game.debug.weapon.sightVisible() === true, null, { timeout:3000 });
  await page.evaluate(() => __game.debug.setInput({}));
  await page.waitForFunction(() => __game.debug.weapon.sightVisible() === false, null, { timeout:3000 });
});

test('assistance : viser pres d un ennemi aligne le lacet horizontalement', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await page.evaluate(() => { __game.debug.moveEnemy(1,0,-40); __game.debug.moveEnemy(2,0,-40);
    __game.debug.setYaw(0); __game.debug.spawnEnemyAt(Math.sin(0.14)*12, Math.cos(0.14)*12); });
  const y0 = await page.evaluate(() => __game.camera().yaw);
  await page.evaluate(() => __game.debug.setInput({ aim:true }));
  await page.waitForTimeout(700);
  const y1 = await page.evaluate(() => __game.camera().yaw);
  expect(y1).toBeGreaterThan(y0 + 0.03);     // s est rapproche de l ennemi (~0.14)
  expect(y1).toBeLessThanOrEqual(0.16);
});

test('assistance : ennemi hors du cone => aucune aide', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await page.evaluate(() => { __game.debug.moveEnemy(1,0,-40); __game.debug.moveEnemy(2,0,-40);
    __game.debug.setYaw(0); __game.debug.spawnEnemyAt(Math.sin(0.6)*12, Math.cos(0.6)*12); }); // ~34deg => hors cone
  await page.evaluate(() => __game.debug.setInput({ aim:true }));
  const y0 = await page.evaluate(() => __game.camera().yaw);
  await page.waitForTimeout(500);
  const y1 = await page.evaluate(() => __game.camera().yaw);
  expect(Math.abs(y1 - y0)).toBeLessThan(0.02);
});

// ====== Tranche 36 : fusil à pompe ======

test('shotgun : nouvelle arme avec plombs', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const cat = await page.evaluate(() => __game.debug.shop.catalog());
  expect(cat.find(w => w.id === 'shotgun')).toBeTruthy();
  expect(await page.evaluate(() => __game.debug.weaponStats('shotgun').pellets)).toBeGreaterThan(1);
  expect(await page.evaluate(() => __game.debug.weaponStats('default').pellets)).toBe(1);
});

test('shotgun : tirer lache plusieurs plombs et fait mal', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.addMoney(2000); __game.debug.shop.buy('shotgun'); __game.debug.shop.equip('shotgun'); });
  await page.evaluate(() => { __game.debug.setView('first'); __game.debug.setPitch(0); });
  await page.waitForTimeout(150);
  await page.evaluate(() => __game.debug.spawnEnemyInFront(4));
  const hp0 = await page.evaluate(() => __game.debug.enemyHp(0));
  const tracers = await page.evaluate(() => { __game.debug.tryFire(); return __game.debug.tracerCount(); });
  expect(tracers).toBeGreaterThanOrEqual(5);
  expect(await page.evaluate(() => __game.debug.enemyHp(0))).toBeLessThan(hp0);
});

// ====== Tranche 45 : corps-à-corps ======

test('melee : coup blesse un ennemi proche devant', async ({ page }) => {
  await startPlaying(page);
  // Placement déterministe : joueur à l'origine, ennemi 0 à 2u devant, jeu en pause
  await page.evaluate(() => {
    for(let i=0;i<3;i++) __game.debug.moveEnemy(i,40,40);
    __game.debug.setPos(0,0); __game.debug.setYaw(0); __game.debug.setPitch(0); __game.debug.setView('first');
    __game.debug.moveEnemy(0,0,2);  // ennemi 0 à 2u devant le joueur
    __game.debug.setPaused(true);
  });
  const hp0 = await page.evaluate(() => __game.debug.enemyHp(0));
  expect(await page.evaluate(() => __game.debug.playerMelee())).toBe(true);
  expect(await page.evaluate(() => __game.debug.enemyHp(0))).toBeLessThan(hp0);
});

test('melee : rien si aucun ennemi a portee', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { for(let i=0;i<3;i++) __game.debug.moveEnemy(i,40,40); });
  expect(await page.evaluate(() => __game.debug.playerMelee())).toBe(false);
});

// ====== #50 — Couteaux multiples ======

test('#50 couteaux : au moins 3 armes melee dans le catalogue', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const catalog = await page.evaluate(() => __game.debug.shop.catalog());
  const knives = catalog.filter(w => w.category === 'melee');
  expect(knives.length).toBeGreaterThanOrEqual(3);
});

test('#50 couteaux : knife (id=knife) est possede par defaut', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const owned = await page.evaluate(() => __game.debug.save.get().ownedWeapons);
  expect(owned).toContain('knife');
});

test('#50 couteaux : le premier couteau est gratuit (price=0)', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const catalog = await page.evaluate(() => __game.debug.shop.catalog());
  const freeKnife = catalog.find(w => w.category === 'melee' && w.id === 'knife');
  expect(freeKnife).toBeTruthy();
  expect(freeKnife.price).toBe(0);
});

// ====== #61 — Sniper scope ======

test('#61 scope : sniperScopeActive = false sans visée', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.shop.setWeapon('sniper'));
  const active = await page.evaluate(() => __game.debug.sniperScopeActive());
  expect(active).toBe(false);
});

test('#61 scope : sniperScopeActive = true en ADS avec sniper', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forceEquipWeapon('sniper'));
  await page.evaluate(() => __game.debug.setInput({ aim: true }));
  const active = await page.evaluate(() => __game.debug.sniperScopeActive());
  expect(active).toBe(true);
});

test('#61 scope : pas de scope avec arme non-sniper', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setInput({ aim: true }));
  await page.waitForTimeout(300);
  const active = await page.evaluate(() => __game.debug.sniperScopeActive());
  expect(active).toBe(false);
});

// ====== #64 — Mode tir burst/auto ======

test('#64 burst : fireMode initial = auto', async ({ page }) => {
  await startPlaying(page);
  const mode = await page.evaluate(() => __game.debug.fireMode());
  expect(mode).toBe('auto');
});

test('#64 burst : fireModeToggle bascule en burst', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.fireModeToggle());
  const mode = await page.evaluate(() => __game.debug.fireMode());
  expect(mode).toBe('burst');
});

test('#64 burst : second toggle revient en auto', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.fireModeToggle());
  await page.evaluate(() => __game.debug.fireModeToggle());
  const mode = await page.evaluate(() => __game.debug.fireMode());
  expect(mode).toBe('auto');
});

test('#64 burst : pas de toggle pour arme non-assaut', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forceEquipWeapon('sniper'));
  await page.evaluate(() => __game.debug.fireModeToggle());
  const mode = await page.evaluate(() => __game.debug.fireMode());
  expect(mode).toBe('auto'); // toujours auto (sniper non éligible)
});

// ====== #77 — Camera kick ======

test('#77 camkick : cameraKick debug disponible', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => typeof __game.debug.cameraKick)).toBe('function');
});

test('#77 camkick : lastCameraKickT = 0 au depart', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.lastCameraKickT())).toBe(0);
});

test('#77 camkick : lastCameraKickT > 0 apres cameraKick', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.cameraKick());
  expect(await page.evaluate(() => __game.debug.lastCameraKickT())).toBeGreaterThan(0);
});

// ====== #78 — Mode semi-auto ======

test('#78 semiauto : semiAutoMode disponible', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => typeof __game.debug.semiAutoMode)).toBe('function');
});

test('#78 semiauto : setSemiAuto(true) active le mode', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setSemiAuto(true));
  expect(await page.evaluate(() => __game.debug.semiAutoMode())).toBe(true);
});

test('#78 semiauto : setSemiAuto(false) desactive le mode', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setSemiAuto(true); __game.debug.setSemiAuto(false); });
  expect(await page.evaluate(() => __game.debug.semiAutoMode())).toBe(false);
});

// ====== #87 — Backstab damage ======

test('#87 backstab : backstabMult() retourne 1.5', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.backstabMult())).toBeCloseTo(1.5, 2);
});

test('#87 backstab : isBackstab faux si ennemi face au joueur', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyInFront(5));
  await page.waitForTimeout(100);
  // oriente l'ennemi pour qu'il regarde le joueur → ce n'est PAS un backstab
  await page.evaluate(() => __game.debug.forceEnemyFacePlayer(0));
  const result = await page.evaluate(() => __game.debug.isBackstab(0));
  expect(result).toBe(false);
  // contrôle inverse : dos tourné → backstab vrai (garantit que le test discrimine)
  await page.evaluate(() => __game.debug.forceEnemyBackstab(0));
  expect(await page.evaluate(() => __game.debug.isBackstab(0))).toBe(true);
});

test('#87 backstab : forceEnemyBackstab rend isBackstab vrai', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyInFront(5));
  await page.evaluate(() => __game.debug.forceEnemyBackstab(0));
  expect(await page.evaluate(() => __game.debug.isBackstab(0))).toBe(true);
});

// ====== #89 — Laser sniper ADS ======

test('#89 laser : sniperLaserVisible() false au debut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.sniperLaserVisible())).toBe(false);
});

test('#89 laser : laser visible quand sniper equipe + ADS', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.forceEquipWeapon('sniper'); __game.debug.setInput({ aim: true }); });
  expect(await page.evaluate(() => __game.debug.sniperLaserVisible())).toBe(true);
});

test('#89 laser : sniperLaserLength() = 60m en ADS sniper', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.forceEquipWeapon('sniper'); __game.debug.setInput({ aim: true }); });
  // la roadmap #89 spécifie un rayon de 60 m
  expect(await page.evaluate(() => __game.debug.sniperLaserLength())).toBe(60);
});

// ====== #92 — Spread au mouvement ======

test('#92 spread : currentSpread() = 1 en immobile/ADS', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setInput({ aim: true }));
  expect(await page.evaluate(() => __game.debug.currentSpread())).toBeCloseTo(1, 2);
});

test('#92 spread : currentSpread() = 1.5 en marche', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setInput({ forward: true, sprint: false }));
  expect(await page.evaluate(() => __game.debug.currentSpread())).toBeCloseTo(1.5, 2);
});

test('#92 spread : currentSpread() = 2.5 en course', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setInput({ forward: true, sprint: true }));
  expect(await page.evaluate(() => __game.debug.currentSpread())).toBeCloseTo(2.5, 2);
});

// ====== #96 — LMG Overheat ======

test('#96 overheat : overheatLevel() = 0 par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.overheatLevel())).toBe(0);
});

test('#96 overheat : forceOverheat() bloque le tir', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.forceEquipWeapon('lmg'); __game.debug.forceOverheat(); });
  const fired = await page.evaluate(() => __game.debug.tryFire());
  expect(fired).toBe(false);
  expect(await page.evaluate(() => __game.debug.overheatPaused())).toBe(true);
});

test('#96 overheat : setOverheat(20) sur LMG declenche overheat', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.forceEquipWeapon('lmg'); __game.debug.setOverheat(20); });
  expect(await page.evaluate(() => __game.debug.overheatPaused())).toBe(true);
  expect(await page.evaluate(() => __game.debug.overheatLevel())).toBe(20);
});

// ====== #98 — Munitions infinies ======

test('#98 inf ammo : infiniteAmmoActive() false par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.infiniteAmmoActive())).toBe(false);
});

test('#98 inf ammo : setInfiniteAmmo(true) puis tir ne consomme pas ammo', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setInfiniteAmmo(true));
  const ammoBefore = await page.evaluate(() => __game.ammo);
  await page.evaluate(() => __game.debug.tryFire());
  const ammoAfter = await page.evaluate(() => __game.ammo);
  expect(ammoAfter).toBe(ammoBefore);
});

test('#98 inf ammo : setInfiniteAmmo(false) retablit consommation normale', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setInfiniteAmmo(true); __game.debug.setInfiniteAmmo(false); });
  const ammoBefore = await page.evaluate(() => __game.ammo);
  await page.evaluate(() => __game.debug.tryFire());
  const ammoAfter = await page.evaluate(() => __game.ammo);
  expect(ammoAfter).toBe(ammoBefore - 1);
});

// ====== #101 — Ricochet balle ======

test('#101 ricochet : ricochetsTotal() = 0 par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.ricochetsTotal())).toBe(0);
});

test('#101 ricochet : forceRicochetHit() incremente le compteur', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forceRicochetHit());
  expect(await page.evaluate(() => __game.debug.ricochetsTotal())).toBe(1);
  expect(await page.evaluate(() => __game.debug.lastRicochetHit())).toBe(true);
});

test('#101 ricochet : lastRicochetHit() false avant tout ricochet', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.lastRicochetHit())).toBe(false);
});

// ====== #106 — Empty mag click feedback ======

test('#106 empty fire : emptyFireCount() = 0 par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.emptyFireCount())).toBe(0);
});

test('#106 empty fire : triggerEmptyFire() incremente compteur', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.triggerEmptyFire());
  expect(await page.evaluate(() => __game.debug.emptyFireCount())).toBe(1);
  expect(await page.evaluate(() => __game.debug.lastEmptyFire())).toBe(true);
});

test('#106 empty fire : tir avec ammo=0 declenche emptyFire', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setAmmo(0));
  await page.evaluate(() => __game.debug.tryFire());
  expect(await page.evaluate(() => __game.debug.emptyFireCount())).toBe(1);
});

// ====== #112 — Auto-reload ======

test('#112 auto-reload : active par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.autoReloadEnabled())).toBe(true);
});

test('#112 auto-reload : setAutoReload(false) desactive', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setAutoReload(false));
  expect(await page.evaluate(() => __game.debug.autoReloadEnabled())).toBe(false);
});

test('#112 auto-reload : mag vide declenche auto-reload apres 1.5s', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => {
    __game.debug.setAutoReload(true);
    __game.debug.setAmmo(0);
    __game.debug.tryFire(); // trigger autoReloadAt_
  });
  expect(await page.evaluate(() => __game.debug.autoReloadPending())).toBe(true);
  // Après 4.5s (1.5s délai + ~2s reload) le chargeur doit être rechargé
  await page.waitForTimeout(4500);
  const ammo = await page.evaluate(() => __game.ammo);
  expect(ammo).toBeGreaterThan(0);
});
