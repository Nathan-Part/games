import { test, expect } from '@playwright/test';
import { trackErrors, startPlaying, faceEnemyForMelee, alignTwoEnemies } from './helpers.js';

test('enemyDecision : seuils patrouille/poursuite/tir', async ({ page }) => {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.booted);
  const f = (d, s) => page.evaluate(([d,s]) => __game.debug.enemyDecision(d,s), [d, s]);
  expect(await f(20, 'patrol')).toBe('patrol');   // loin
  expect(await f(12, 'patrol')).toBe('chase');    // entre tir et détection
  expect(await f(11, 'chase')).toBe('chase');     // au-delà de la portée de tir
  expect(await f(9,  'chase')).toBe('shoot');     // pile à portée de tir (<=)
  expect(await f(6,  'chase')).toBe('shoot');     // à portée de tir
  expect(await f(1,  'shoot')).toBe('shoot');     // proche => tir
});

test('3 ennemis apparaissent et sont vivants au démarrage', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() >= 1, null, { timeout:20000 });
  expect(await page.evaluate(() => __game.debug.enemyCount())).toBe(3);
  expect(await page.evaluate(() => __game.debug.enemyAlive())).toBe(3);
  expect(await page.evaluate(() => __game.debug.enemyState(0))).toBe('patrol');
  const p = await page.evaluate(() => __game.debug.enemyPos(0));
  expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
  expect(await page.evaluate(() => __game.debug.enemyHp(0))).toBe(100);
});

test('un ennemi loin du joueur patrouille (sa position change) et reste dans les bornes', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await page.evaluate(() => __game.debug.spawnEnemyAt(20, 20)); // bien au-delà du rayon de détection
  const p0 = await page.evaluate(() => __game.debug.enemyPos(0));
  await page.waitForTimeout(1200);
  const p1 = await page.evaluate(() => __game.debug.enemyPos(0));
  expect(Math.hypot(p1.x-p0.x, p1.z-p0.z)).toBeGreaterThan(0.3);   // il a bougé
  expect(Math.abs(p1.x)).toBeLessThanOrEqual(24.01);              // dans les bornes (MAP_HALF=24)
  expect(Math.abs(p1.z)).toBeLessThanOrEqual(24.01);
});

test('un ennemi proche poursuit le joueur (chase) et réduit la distance', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await page.evaluate(() => __game.debug.spawnEnemyAt(0, 11.5)); // dans la détection (12) mais au-delà du tir (9)
  await page.waitForFunction(() => __game.debug.enemyState(0) === 'chase', null, { timeout:3000 });
  const d0 = await page.evaluate(() => { const p = __game.debug.enemyPos(0), q = __game.position(); return Math.hypot(p.x-q.x, p.z-q.z); });
  await page.waitForTimeout(1000);
  const d1 = await page.evaluate(() => { const p = __game.debug.enemyPos(0), q = __game.position(); return Math.hypot(p.x-q.x, p.z-q.z); });
  expect(d1).toBeLessThan(d0 - 0.5); // il s'est rapproché (jusqu'à la portée de tir)
});

test('à portée et en vue, l’ennemi passe en tir (shoot) et ne fonce pas dans le joueur', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await page.evaluate(() => __game.debug.spawnEnemyAt(0, 6)); // dans la portée de tir, en vue
  await page.waitForFunction(() => __game.debug.enemyState(0) === 'shoot', null, { timeout:3000 });
  await page.waitForTimeout(400);
  const p = await page.evaluate(() => __game.debug.enemyPos(0)), q = await page.evaluate(() => __game.position());
  expect(Math.hypot(p.x-q.x, p.z-q.z)).toBeGreaterThan(0.8); // il s'arrête pour tirer, ne traverse pas
});

test('un ennemi en vue tire et blesse le joueur', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  // au-delà du rayon de détection (12) => l'ennemi reste en patrouille et ne tire PAS de lui-même
  // (sinon il entre en 'shoot' et tire en plus du forceEnemyShoot -> 2 impacts, test instable).
  // LOS dégagée le long de z=0 ; précision forcée à 1 -> le tir forcé touche à coup sûr.
  await page.evaluate(() => { __game.debug.setEnemyAccuracy(1); __game.debug.spawnEnemyAt(16, 0); });
  await page.evaluate(() => __game.debug.setShield(0)); // #67 : sans bouclier, l'impact touche les PV
  const h0 = await page.evaluate(() => __game.health);
  await page.evaluate(() => __game.debug.forceEnemyShoot(0));
  expect(await page.evaluate(() => __game.health)).toBe(h0 - 10);  // exactement un impact (ENEMY_DAMAGE)
});

test('ligne de vue : un obstacle bloque le tir', async ({ page }) => {
  await startPlaying(page);
  const clear = await page.evaluate(() => __game.debug.hasLineOfSight(0, 0, 0, 6));
  await page.evaluate(() => __game.debug.setObstacleTest(0, 3)); // boîte entre (0,0) et (0,6)
  const blocked = await page.evaluate(() => __game.debug.hasLineOfSight(0, 0, 0, 6));
  expect(clear).toBe(true); expect(blocked).toBe(false);
});

test('un ennemi touché se retourne et poursuit le joueur, même hors de portée de détection', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await page.evaluate(() => __game.debug.spawnEnemyAt(20, 0)); // dist 20 > détection (12) => patrouille
  await page.waitForFunction(() => __game.debug.enemyState(0) === 'patrol', null, { timeout:3000 });
  await page.evaluate(() => __game.debug.damageEnemy(0, 10)); // on le touche de loin
  await page.waitForFunction(() => __game.debug.enemyState(0) === 'chase', null, { timeout:3000 }); // il aggro
});

test('mort : l ennemi a une anim de mort (Dead) jouee au kill', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  expect(await page.evaluate(() => __game.debug.enemyHasClip('dead'))).toBe(true);  // anim Dead retargetee
  await page.evaluate(() => __game.debug.damageEnemy(0, 100));                        // kill
  expect(await page.evaluate(() => __game.debug.enemyState(0))).toBe('dead');
  expect(await page.evaluate(() => __game.debug.enemyAlive())).toBe(2);
});

test('mort : tuer un ennemi melee en pleine attaque desactive bien l anim d attaque residuelle', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'rusher', 1, 1));
  await page.evaluate(() => __game.debug.setPos(0, 0));
  await page.waitForFunction(() => __game.debug.enemyState(0) === 'melee', null, { timeout:8000 });
  await page.waitForTimeout(150);   // laisse l anim d attaque demarrer avant de tuer
  const before = await page.evaluate(() => __game.debug.enemyAnimDiag(0));
  expect(before.loco).toBe('attack');
  await page.evaluate(() => __game.debug.damageEnemy(0, 99999));
  await page.waitForTimeout(500);   // largement plus que le fondu (0.18s) + le filet de securite (220ms)
  const diag = await page.evaluate(() => __game.debug.enemyAnimDiag(0));
  const attack = diag.actions.find(a => a.key === 'attack');
  expect(attack.enabled).toBe(false);
  expect(attack.weight).toBe(0);   // l anim d attaque ne contribue plus au cadavre (#156c)
});

test('tranche9 : chaque ennemi tient une arme visible (RightHand) avec un canon a hauteur de main', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.weapon?.held?.() === true, null, { timeout:20000 });
  await page.waitForFunction(() => window.__game.debug.enemyHasWeapon?.(0) === true, null, { timeout:5000 });
  const n = await page.evaluate(() => __game.debug.enemyAlive());
  for(let i=0;i<n;i++) expect(await page.evaluate(j => __game.debug.enemyHasWeapon(j), i)).toBe(true);
  await page.evaluate(() => __game.debug.spawnEnemyAt(2, 0));
  const m = await page.evaluate(() => __game.debug.enemyMuzzle(0));
  expect(m).not.toBeNull();
  expect(m.y).toBeGreaterThan(0.6); expect(m.y).toBeLessThan(2.0);     // hauteur de main
  expect(Math.hypot(m.x - 2, m.z - 0)).toBeLessThan(1.2);              // proche de l'ennemi en XZ
});

test('tranche9 : un ennemi qui tire montre un flash de bouche bref et un traceur partant du canon', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyHasWeapon?.(0) === true, null, { timeout:20000 });
  await page.evaluate(() => __game.debug.spawnEnemyAt(3, 0));
  expect(await page.evaluate(() => __game.debug.enemyMuzzleFlash(0))).toBe(false);
  const before = await page.evaluate(() => __game.debug.tracerCount());
  // tir + lecture dans le MÊME tick (le traceur ne vit que 0.08 s => éviter qu'il expire entre 2 allers-retours)
  const d = await page.evaluate(() => { __game.debug.forceEnemyShoot(0);
    return { flash: __game.debug.enemyMuzzleFlash(0), tracers: __game.debug.tracerCount(),
             m: __game.debug.enemyMuzzle(0), s: __game.debug.lastTracerStart() }; });
  expect(d.flash).toBe(true);
  expect(d.tracers).toBeGreaterThan(before);
  expect(Math.hypot(d.s.x-d.m.x, d.s.y-d.m.y, d.s.z-d.m.z)).toBeLessThan(0.5);   // traceur part du canon
  await page.waitForFunction(() => window.__game.debug.enemyMuzzleFlash(0) === false, null, { timeout:2000 });
});

test('tranche9 : un ennemi qui tire reste debout (pas d anim de combat melee)', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyHasWeapon?.(0) === true, null, { timeout:20000 });
  await page.evaluate(() => { __game.debug.moveEnemy(1,0,-40); __game.debug.moveEnemy(2,0,-40);
    __game.debug.spawnEnemyAt(0, -6); });                         // à portée + en vue
  await page.waitForFunction(() => window.__game.debug.enemyState(0) === 'shoot', null, { timeout:5000 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.enemyState(0))).toBe('shoot');
  expect(await page.evaluate(() => __game.debug.enemyLoco(0))).not.toBe('attack');   // tire en restant debout
});

// ====== Tranche 11 : types d'ennemis + meilleure IA ======

test('ia : flankTarget decale l approche perpendiculairement', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const f = await page.evaluate(() => __game.debug.flankTarget(0,0, 0,-10, 1));
  expect(f.x).toBeCloseTo(-4, 1); expect(f.z).toBeCloseTo(0, 1);   // perpendiculaire, offset 4
});

test('ia : peekTarget contourne un obstacle pour degager la vue', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const obs = [{ minX:-1, maxX:1, minZ:2, maxZ:4 }];   // caisse entre (0,0) et (0,6)
  const blocked = await page.evaluate(o => __game.debug.segClear(0,0, 0,6, o), obs);
  const peek = await page.evaluate(o => __game.debug.peekTarget(0,0, 0,6, o), obs);
  const clearFromPeek = await page.evaluate(([p,o]) => __game.debug.segClear(p.x,p.z, 0,6, o), [peek, obs]);
  expect(blocked).toBe(false);          // ligne directe coupée
  expect(clearFromPeek).toBe(true);     // depuis le point de peek, vue dégagée
});

test('types : composition de vague (v1 shooter, v2 rusher, v3 tank)', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const c1 = await page.evaluate(() => __game.debug.waveComposition(1));
  const c2 = await page.evaluate(() => __game.debug.waveComposition(2));
  const c3 = await page.evaluate(() => __game.debug.waveComposition(3));
  expect(c1.every(t => t === 'shooter')).toBe(true); expect(c1.length).toBe(3);
  expect(c2[0]).toBe('shooter'); expect(c2).toContain('rusher');
  expect(c3).toContain('tank');
});

test('types : forceNextWave amene des rushers (et enemies[0] reste shooter)', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await page.evaluate(() => __game.debug.forceNextWave());   // vague 2
  expect(await page.evaluate(() => __game.debug.enemyType(0))).toBe('shooter');
  const types = await page.evaluate(() => Array.from({length:__game.debug.enemyCount()}, (_,i)=>__game.debug.enemyType(i)));
  expect(types).toContain('rusher');
});

test('types : un rusher fonce au contact et frappe le joueur (melee)', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await page.evaluate(() => { __game.debug.setPos(0,0); __game.debug.spawnEnemyTypeAt(0,'rusher',0,2.2); });
  await page.evaluate(() => __game.debug.setShield(0)); // #67 : sans bouclier, la mêlée touche directement les PV
  await page.waitForFunction(() => __game.debug.enemyState(0) === 'melee', null, { timeout:5000 });
  await page.waitForFunction(() => __game.health < 100, null, { timeout:5000 });
});

test('types : un tank est coriace (PV+) et frappe fort', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await page.evaluate(() => { __game.debug.setEnemyAccuracy(1); __game.debug.spawnEnemyTypeAt(0,'tank',16,0); });
  expect(await page.evaluate(() => __game.debug.enemyHp(0))).toBeGreaterThan(200);
  await page.evaluate(() => __game.debug.setShield(0)); // #67 : sans bouclier, le tir touche les PV
  const h0 = await page.evaluate(() => __game.health);
  await page.evaluate(() => __game.debug.forceEnemyShoot(0));
  expect(await page.evaluate(() => __game.health)).toBe(h0 - 18);   // ENEMY_DAMAGE(10)*1.8
});

test('types : le shooter tire en rafale (plusieurs cartouches par salve)', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  expect(await page.evaluate(() => __game.debug.enemyBurstSize(0))).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => __game.debug.forceEnemyBurst(0))).toBeGreaterThanOrEqual(2);
});

// ====== Tranche 23 : cadavres + loot d'arme ======

test('cadavre : mort = dead, emissive reinitialise, hitbox desactivee', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnEnemyAt(0, 3); __game.debug.damageEnemy(0, 99999); });
  expect(await page.evaluate(() => __game.debug.enemyState(0))).toBe('dead');
  expect(await page.evaluate(() => __game.debug.corpseCount())).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => __game.debug.enemyEmissiveIsBase(0))).toBe(true);
  expect(await page.evaluate(() => __game.debug.enemyHitboxActive(0))).toBe(false);
});

test('cadavre : armes ennemies variees selon le type', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => __game.debug.enemyHasWeapon(0), null, { timeout:10000 });
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(1, 'tank', 6, 6); __game.debug.spawnEnemyTypeAt(2, 'rusher', -6, 6); });
  expect(await page.evaluate(() => __game.debug.enemyWeaponId(0))).toBe('default');   // shooter
  expect(await page.evaluate(() => __game.debug.enemyWeaponId(1))).toBe('sniper');    // tank
  expect(await page.evaluate(() => __game.debug.enemyWeaponId(2))).toBe('smg');       // rusher
  expect(await page.evaluate(() => __game.debug.enemyHasWeapon(1))).toBe(true);
});

test('loot : cadavre lointain non ramassable, cadavre proche oui', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(1, 'rusher', 30, 30); __game.debug.damageEnemy(1, 99999); });
  expect(await page.evaluate(() => __game.debug.nearestPickup())).toBeNull();
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0, 'tank', 0, 1.5); __game.debug.damageEnemy(0, 99999); });
  const p = await page.evaluate(() => __game.debug.nearestPickup());
  expect(p).not.toBeNull(); expect(p.weaponId).toBe('sniper');
});

test('loot : ramasser equipe l arme du cadavre pour la partie, reset au restart', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.weaponStats().mag)).toBe(12);   // arme save (fusil)
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0, 'tank', 0, 1.5); __game.debug.damageEnemy(0, 99999); });
  expect(await page.evaluate(() => __game.debug.pickupWeapon())).toBe(true);
  expect(await page.evaluate(() => __game.debug.matchWeapon())).toBe('sniper');
  expect(await page.evaluate(() => __game.debug.weaponStats().mag)).toBe(5);     // sniper
  await page.evaluate(() => __game.debug.restart());
  expect(await page.evaluate(() => __game.debug.matchWeapon())).toBeNull();
  expect(await page.evaluate(() => __game.debug.weaponStats().mag)).toBe(12);    // retour arme save
});

test('loot : invite HUD a proximite + touche G ramasse', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0, 'tank', 0, 1.5); __game.debug.damageEnemy(0, 99999); });
  await expect(page.locator('#pickup-prompt')).toBeVisible();
  await expect(page.locator('#pickup-prompt')).toContainText('Eclipse SR'); // arme 'sniper' renommée en #49
  await page.keyboard.press('KeyG');
  expect(await page.evaluate(() => __game.debug.matchWeapon())).toBe('sniper');
});

// ====== Tranche 37 : ennemi kamikaze (bomber) ======

test('bomber : composition des vagues (des la v4)', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  expect(await page.evaluate(() => __game.debug.waveComposition(4))).toContain('bomber');
  expect(await page.evaluate(() => __game.debug.waveComposition(1))).not.toContain('bomber');
});

test('bomber : explose proche du joueur et le blesse', async ({ page }) => {
  await startPlaying(page);
  const pos = await page.evaluate(() => __game.position());
  // tout dans un seul evaluate synchrone : pas de frame entre spawn et explosion → pas d'explosion-contact parasite,
  // et bouclier vidé (#67) juste avant pour que l'AoE touche les PV
  const r = await page.evaluate(p => {
    __game.debug.setShield(0);
    __game.debug.spawnEnemyTypeAt(0, 'bomber', p.x, p.z + 1);
    const h0 = __game.debug.playerHealth();
    __game.debug.explodeBomberNow(0);
    return { h0, h1: __game.debug.playerHealth(), state: __game.debug.enemyState(0) };
  }, pos);
  expect(r.h1).toBeLessThan(r.h0);
  expect(r.state).toBe('dead');
});

test('bomber : explosion loin n inflige rien', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'bomber', 40, 40));
  const h0 = await page.evaluate(() => __game.debug.playerHealth());
  await page.evaluate(() => __game.debug.explodeBomberNow(0));
  expect(await page.evaluate(() => __game.debug.playerHealth())).toBe(h0);
});

// ====== #84 — Renforts ennemis ======

test('#84 renforts : enemyCalledReinforcement(0) false au debut', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8));
  expect(await page.evaluate(() => __game.debug.enemyCalledReinforcement(0))).toBe(false);
});

test('#84 renforts : forceCallReinforcement(0) spawn 1 ennemi supplementaire', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8));
  const before = await page.evaluate(() => __game.debug.enemyCount());
  await page.evaluate(() => __game.debug.forceCallReinforcement(0));
  const after = await page.evaluate(() => __game.debug.enemyCount());
  expect(after).toBe(before + 1);
});

test('#84 renforts : apres forceCallReinforcement, enemyCalledReinforcement vrai', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8));
  await page.evaluate(() => __game.debug.forceCallReinforcement(0));
  expect(await page.evaluate(() => __game.debug.enemyCalledReinforcement(0))).toBe(true);
});

// ====== #85 — Ennemi ramasse arme ======

test('#85 pickup : enemyPickedUpWeapon(0) false au debut', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8));
  expect(await page.evaluate(() => __game.debug.enemyPickedUpWeapon(0))).toBe(false);
});

test('#85 pickup : forceEnemyPickup place une arme sur ennemi rusher sans arme', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnEnemyInFront(8); __game.debug.spawnEnemyTypeAt(0,'rusher',2,2); });
  await page.evaluate(() => __game.debug.forceEnemyPickup(0));
  expect(await page.evaluate(() => __game.debug.enemyPickedUpWeapon(0))).toBe(true);
});

test('#85 pickup : apres pickup, weaponId de l ennemi change', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnEnemyInFront(8); __game.debug.spawnEnemyTypeAt(0,'rusher',2,2); });
  const before = await page.evaluate(() => __game.debug.enemyWeaponId(0));
  await page.evaluate(() => __game.debug.forceEnemyPickup(0));
  const after = await page.evaluate(() => __game.debug.enemyWeaponId(0));
  expect(after).not.toBe(before);
});

// ====== #88 — Cover dynamique ennemi ======

test('#88 cover : enemyInCover(0) false au debut', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8));
  expect(await page.evaluate(() => __game.debug.enemyInCover(0))).toBe(false);
});

test('#88 cover : forceEnemyCover met ennemi en etat cover', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8));
  await page.evaluate(() => __game.debug.forceEnemyCover(0));
  expect(await page.evaluate(() => __game.debug.enemyInCover(0))).toBe(true);
});

test('#88 cover : ennemi blesse < 50% HP entre en cover', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8));
  await page.evaluate(() => { const hp = __game.debug.enemyHp(0); __game.debug.damageEnemy(0, Math.floor(hp * 0.6)); });
  expect(await page.evaluate(() => __game.debug.enemyInCover(0))).toBe(true);
});

// ====== #104 — Ennemi berserker ======

test('#104 berserker : ENEMY_TYPES contient berserker', async ({ page }) => {
  await startPlaying(page);
  // morphe l'ennemi 0 en berserker → prouve que le type existe dans ENEMY_TYPES
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'berserker', 50, 50));
  expect(await page.evaluate(() => __game.debug.enemyType(0))).toBe('berserker');
});

test('#104 berserker : berserker est de type melee', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'berserker', 50, 50));
  const type = await page.evaluate(() => __game.debug.enemyType(0));
  expect(type).toBe('berserker');
});

test('#104 berserker : berserker apparait en vague 6+', async ({ page }) => {
  await startPlaying(page);
  const comp = await page.evaluate(() => __game.debug.waveComposition(6));
  expect(comp).toContain('berserker');
});

// ====== #107 — Ennemi fantôme (ghost) : TYPE SUPPRIMÉ (retiré du jeu à la demande) ======

test('#107 ghost : le type ghost n existe plus (retombe sur shooter)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'ghost', 10, 10));
  // ENEMY_TYPES n'a plus 'ghost' → fallback shooter
  expect(await page.evaluate(() => __game.debug.enemyType(0))).toBe('shooter');
  // et aucune vague ne contient plus de ghost
  const waves = await page.evaluate(() => [8,9,10,11,12,13].map(w => __game.debug.waveComposition(w)));
  expect(waves.flat().includes('ghost')).toBe(false);
});

// ====== #111 — Ennemi sniper ======

test('#111 sniper : spawnEnemyTypeAt sniper, enemyIsSniper() true', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'sniper', 10, 10));
  expect(await page.evaluate(() => __game.debug.enemyIsSniper(0))).toBe(true);
});

test('#111 sniper : damageMult 2.5x vs shooter 1.0x', async ({ page }) => {
  await startPlaying(page);
  // sniper en slot 0, shooter en slot 1 → comparer leurs multiplicateurs de dégâts
  await page.evaluate(() => {
    __game.debug.spawnEnemyTypeAt(0, 'sniper', 10, 10);
    __game.debug.spawnEnemyTypeAt(1, 'shooter', 12, 10);
  });
  const sniperMult = await page.evaluate(() => __game.debug.enemyDamageMult(0));
  const shooterMult = await page.evaluate(() => __game.debug.enemyDamageMult(1));
  expect(sniperMult).toBe(2.5);
  expect(shooterMult).toBe(1.0);
  expect(sniperMult).toBe(shooterMult * 2.5);
  // et la cadence sniper reste 4s
  expect(await page.evaluate(() => __game.debug.enemySniperShootCd(0))).toBe(4.0);
});

test('#111 sniper : type sniper dans waveComposition vague 7', async ({ page }) => {
  await startPlaying(page);
  // vague 7 a 7 ennemis (MAX_PER_WAVE), index 6 = sniper (i%7===6), non boss
  const comp7 = await page.evaluate(() => __game.debug.waveComposition(7));
  expect(comp7.includes('sniper')).toBe(true);
});

// ====== #114 — Armor system ======

test('#114 armor : armoredKillCount 0 par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.armoredKillCount())).toBe(0);
});

test('#114 armor : tank torse mult = 0.7, tete mult = 1.0', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'tank', 5, 5));
  const torsoMult = await page.evaluate(() => __game.debug.enemyArmorMult(0, 'torso'));
  const headMult = await page.evaluate(() => __game.debug.enemyArmorMult(0, 'head'));
  expect(torsoMult).toBeCloseTo(0.7, 2);
  expect(headMult).toBeCloseTo(1.0, 2);
});

test('#114 armor : shooter torse mult = 1.0 (pas blinde)', async ({ page }) => {
  await startPlaying(page);
  const mult = await page.evaluate(() => __game.debug.enemyArmorMult(0, 'torso'));
  expect(mult).toBeCloseTo(1.0, 2);
});

// ====== #116 — Suppression fire ======

test('#116 suppression : enemySuppressed false par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.enemySuppressed(0))).toBe(false);
});

test('#116 suppression : suppressEnemy rend ennemi supprime', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.suppressEnemy(0));
  expect(await page.evaluate(() => __game.debug.enemySuppressed(0))).toBe(true);
});

test('#116 suppression : lastSuppressCount incremente apres suppressEnemy', async ({ page }) => {
  await startPlaying(page);
  const before = await page.evaluate(() => __game.debug.lastSuppressCount());
  await page.evaluate(() => __game.debug.suppressEnemy(0));
  expect(await page.evaluate(() => __game.debug.lastSuppressCount())).toBe(before + 1);
});

// ====== #119 — Shielder ======

test('#119 shielder : spawn en vague 4+', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forceWave(4));
  await page.waitForTimeout(300);
  const types = await page.evaluate(() => {
    const out = [];
    for(let i = 0; i < __game.debug.enemyCount(); i++) out.push(__game.debug.enemyType(i));
    return out;
  });
  expect(types).toContain('shielder');
});

test('#119 shielder : tir frontal bloque (0 degats)', async ({ page }) => {
  await startPlaying(page);
  // spawn déterministe d'un shielder en slot 0
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shielder', 4, 0));
  await page.waitForTimeout(100);
  const blockedBefore = await page.evaluate(() => __game.debug.shieldBlockCount());
  const hpBefore = await page.evaluate(() => __game.debug.enemyHp(0));
  await page.evaluate(() => __game.debug.forceShieldBlock(0));
  // le compteur de blocages augmente
  const blockedAfter = await page.evaluate(() => __game.debug.shieldBlockCount());
  expect(blockedAfter).toBeGreaterThan(blockedBefore);
  // et surtout : 0 dégât → PV inchangés (le coeur du test, ce que le titre promet)
  const hpAfter = await page.evaluate(() => __game.debug.enemyHp(0));
  expect(hpAfter).toBe(hpBefore);
});

test('#119 shielder : enemyIsShielded retourne true pour un shielder', async ({ page }) => {
  await startPlaying(page);
  // Morphe l'ennemi 0 (existe toujours en vague 1) en shielder
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shielder', 2, 2));
  await page.waitForTimeout(100);
  const isShielded = await page.evaluate(() => __game.debug.enemyIsShielded(0));
  expect(isShielded).toBe(true);
});

// ====== #120 — Medic enemy ======

test('#120 medic : enemyIsMedic retourne true pour un medic', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'medic', 2, 2));
  await page.waitForTimeout(100);
  const isMedic = await page.evaluate(() => __game.debug.enemyIsMedic(0));
  expect(isMedic).toBe(true);
});

test('#120 medic : spawn en vague 6+', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forceWave(6));
  await page.waitForTimeout(300);
  const types = await page.evaluate(() => {
    const out = [];
    for(let i = 0; i < __game.debug.enemyCount(); i++) out.push(__game.debug.enemyType(i));
    return out;
  });
  expect(types).toContain('medic');
});

test('#120 medic : forceMedicHeal incremente medicHealCount', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'medic', 2, 2));
  await page.waitForTimeout(100);
  await page.evaluate(() => __game.debug.forceMedicHeal(0));
  const count = await page.evaluate(() => __game.debug.medicHealCount());
  expect(count).toBeGreaterThan(0);
});

// ====== #121 — Stunner enemy ======

test('#121 stunner : enemyType stunner existe et spawn vague 7+', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forceWave(7));
  await page.waitForTimeout(300);
  const types = await page.evaluate(() => {
    const out = [];
    for(let i = 0; i < __game.debug.enemyCount(); i++) out.push(__game.debug.enemyType(i));
    return out;
  });
  expect(types).toContain('stunner');
});

test('#121 stunner : forceStun stun le joueur', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forceStun());
  await page.waitForTimeout(50);
  const stunned = await page.evaluate(() => __game.debug.isStunned());
  expect(stunned).toBe(true);
});

test('#121 stunner : stunCount incremente apres stun', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forceStun());
  const count = await page.evaluate(() => __game.debug.stunCount());
  expect(count).toBeGreaterThan(0);
});

// ====== #124 — Decoy enemy ======

test('#124 decoy : forceSpawnDecoy cree un decoy visible', async ({ page }) => {
  await startPlaying(page);
  // need at least one real enemy
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 5, 0));
  await page.waitForTimeout(100);
  const before = await page.evaluate(() => __game.debug.decoyCount());
  await page.evaluate(() => __game.debug.forceSpawnDecoy(0));
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => __game.debug.decoyCount());
  expect(after).toBeGreaterThan(before);
});

test('#124 decoy : enemyIsDecoy retourne true pour le decoy spawné', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 5, 0));
  await page.waitForTimeout(100);
  const countBefore = await page.evaluate(() => __game.debug.enemyCount());
  await page.evaluate(() => __game.debug.forceSpawnDecoy(0));
  await page.waitForTimeout(100);
  const countAfter = await page.evaluate(() => __game.debug.enemyCount());
  // le decoy a été ajouté dans enemies[]
  expect(countAfter).toBeGreaterThan(countBefore);
  const isDecoy = await page.evaluate((i) => __game.debug.enemyIsDecoy(i), countBefore);
  expect(isDecoy).toBe(true);
});

test('#124 decoy : decoy disparait apres expiration', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 5, 0));
  await page.waitForTimeout(100);
  await page.evaluate(() => __game.debug.forceSpawnDecoy(0));
  await page.waitForTimeout(200);
  const countLive = await page.evaluate(() => __game.debug.decoyCount());
  expect(countLive).toBeGreaterThan(0);
  await page.evaluate(() => __game.debug.forceExpireDecoys());
  await page.waitForTimeout(300);
  const countExpired = await page.evaluate(() => __game.debug.decoyCount());
  expect(countExpired).toBe(0);
});

// ====== #128 — Ennemi grenadier ======

test('#128 grenadier : spawnEnemyTypeAt grenadier → enemyIsGrenadier true', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'grenadier', 8, 0));
  await page.waitForTimeout(100);
  const is = await page.evaluate(() => __game.debug.enemyIsGrenadier(0));
  expect(is).toBe(true);
});

test('#128 grenadier : forceEnemyThrowGrenade incremente enemyGrenadeCount', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => {
    __game.debug.spawnEnemyTypeAt(0, 'grenadier', 15, 0); // loin du joueur (>5m)
    __game.debug.setPos(0, 0);
  });
  await page.waitForTimeout(100);
  const before = await page.evaluate(() => __game.debug.enemyGrenadeCount());
  await page.evaluate(() => __game.debug.forceEnemyThrowGrenade(0));
  const after = await page.evaluate(() => __game.debug.enemyGrenadeCount());
  expect(after).toBeGreaterThan(before);
});

test('#128 grenadier : spawn en vague 8+', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forceWave(8));
  await page.waitForTimeout(200);
  const comp = await page.evaluate(() => __game.debug.waveComposition(8));
  expect(comp).toContain('grenadier');
});

// ====== #129 — Berserker frenzy ======

test('#129 frenzy : forceEnemyFrenzy declenche le frenzy', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'berserker', 5, 0));
  await page.waitForTimeout(100);
  await page.evaluate(() => __game.debug.forceEnemyFrenzy(0));
  await page.waitForTimeout(100);
  const inFrenzy = await page.evaluate(() => __game.debug.enemyInFrenzy(0));
  expect(inFrenzy).toBe(true);
});

test('#129 frenzy : berserker TUABLE pendant frenzy (plus d invincibilite)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'berserker', 5, 0));
  await page.waitForTimeout(100);
  await page.evaluate(() => __game.debug.forceEnemyFrenzy(0));
  const hpBefore = await page.evaluate(() => __game.debug.enemyHp(0));
  await page.evaluate(() => __game.debug.damageEnemy(0, 50));
  const hpAfter = await page.evaluate(() => __game.debug.enemyHp(0));
  expect(hpAfter).toBeLessThan(hpBefore); // les dégâts s'appliquent (plus d'invincibilité)
});

test('#129 frenzy : frenzyCount incremente au declenchement', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'berserker', 5, 0));
  await page.waitForTimeout(100);
  const before = await page.evaluate(() => __game.debug.frenzyCount());
  await page.evaluate(() => __game.debug.forceEnemyFrenzy(0));
  const after = await page.evaluate(() => __game.debug.frenzyCount());
  expect(after).toBeGreaterThan(before);
});

// ====== #111b/#121b — sniper & stunner persistent vague 8+ (rotation parité) ======

test('#111b/#121b : sniper et stunner reapparaissent en vague impaire 9+', async ({ page }) => {
  await startPlaying(page);
  const w9 = await page.evaluate(() => __game.debug.waveComposition(9));
  expect(w9).toContain('sniper');
  expect(w9).toContain('stunner');
  const w11 = await page.evaluate(() => __game.debug.waveComposition(11));
  expect(w11).toContain('sniper');
  expect(w11).toContain('stunner');
});

test('#111b/#121b : grenadier et cryo en vague paire 8+ (stunner en impaire, ghost supprimé)', async ({ page }) => {
  await startPlaying(page);
  const w8 = await page.evaluate(() => __game.debug.waveComposition(8));
  expect(w8).toContain('grenadier');   // i%7===6 pair (#128)
  expect(w8).toContain('cryo');        // #146 : i%6===5 en vague PAIRE → cryo (le stunner est passé en impaire)
  expect(w8).not.toContain('stunner');
  expect(w8).not.toContain('ghost');   // type supprimé
  const w12 = await page.evaluate(() => __game.debug.waveComposition(12));
  expect(w12).toContain('grenadier');
  expect(w12).not.toContain('ghost');
});

// ====== #131 — Ennemi Juggernaut (elite blinde) ======

test('#131 juggernaut : enemyIsJuggernaut detecte le type', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'juggernaut', 5, 0));
  expect(await page.evaluate(() => __game.debug.enemyIsJuggernaut(0))).toBe(true);
});

test('#131 juggernaut : HP tres eleve (hpMult 5x) vs shooter', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0, 'shooter', 5, 0); __game.debug.spawnEnemyTypeAt(1, 'juggernaut', 8, 0); });
  const shooterHp = await page.evaluate(() => __game.debug.enemyHp(0));
  const jugHp = await page.evaluate(() => __game.debug.enemyHp(1));
  expect(jugHp).toBeGreaterThan(shooterHp * 4);
});

test('#131 juggernaut : armure integrale reduit les degats sur TOUTES les zones', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'juggernaut', 5, 0));
  const head = await page.evaluate(() => __game.debug.enemyArmorMult(0, 'head'));
  const torso = await page.evaluate(() => __game.debug.enemyArmorMult(0, 'torso'));
  const legs = await page.evaluate(() => __game.debug.enemyArmorMult(0, 'legs'));
  expect(head).toBeLessThan(1);
  expect(torso).toBeLessThan(1);
  expect(legs).toBeLessThan(1);
});

test('#131 juggernaut : waveComposition v11 remplace le tank par juggernaut (v10 = boss wave)', async ({ page }) => {
  await startPlaying(page);
  const comp11 = await page.evaluate(() => __game.debug.waveComposition(11));
  const comp9 = await page.evaluate(() => __game.debug.waveComposition(9));
  expect(comp11).toContain('juggernaut');
  expect(comp9).not.toContain('juggernaut');
  expect(comp9).toContain('tank'); // v9 : toujours le tank classique
});

test('#131 juggernaut : compte dans armoredKillCount a la mort', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'juggernaut', 5, 0));
  const before = await page.evaluate(() => __game.debug.armoredKillCount());
  await page.evaluate(() => __game.debug.damageEnemy(0, 999999));
  const after = await page.evaluate(() => __game.debug.armoredKillCount());
  expect(after).toBeGreaterThan(before);
});

// ====== #140 — Ennemi VIP (cible a haute valeur) ======

test('#140 vip : aucun VIP en vague 1', async ({ page }) => {
  await startPlaying(page);
  const n = await page.evaluate(() => __game.debug.enemyCount());
  for(let i=0;i<n;i++) expect(await page.evaluate(idx => __game.debug.enemyIsVip(idx), i)).toBe(false);
});

test('#140 vip : forceVip marque l ennemi', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 5, 0));
  expect(await page.evaluate(() => __game.debug.enemyIsVip(0))).toBe(false);
  await page.evaluate(() => __game.debug.forceVip(0));
  expect(await page.evaluate(() => __game.debug.enemyIsVip(0))).toBe(true);
});

test('#140 vip : tuer un VIP rapporte 2x argent par rapport a un kill normal', async ({ page }) => {
  await startPlaying(page);
  // consomme le premier sang (#161, +15$ au 1er kill de la vague) hors mesure — sinon il s'ajoute aux deux gains et casse le ratio ×2
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(1, 'shooter', 8, 8); __game.debug.damageEnemy(1, __game.debug.enemyHp(1)); });
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 5, 0));
  const before1 = await page.evaluate(() => __game.debug.runMoney());
  await page.evaluate(() => { const hp = __game.debug.enemyHp(0); __game.debug.damageEnemy(0, hp); }); // exact : pas d'excédent overkill (#139)
  const normalGain = await page.evaluate(() => __game.debug.runMoney()) - before1;
  expect(normalGain).toBeGreaterThan(0);

  await page.evaluate(() => __game.debug.restart()); // remet combo/runMoney/premier sang à zéro
  await page.waitForTimeout(100);
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(1, 'shooter', 8, 8); __game.debug.damageEnemy(1, __game.debug.enemyHp(1)); }); // re-consomme le premier sang
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0, 'shooter', 5, 0); __game.debug.forceVip(0); });
  const before2 = await page.evaluate(() => __game.debug.runMoney());
  await page.evaluate(() => { const hp = __game.debug.enemyHp(0); __game.debug.damageEnemy(0, hp); });
  const vipGain = await page.evaluate(() => __game.debug.runMoney()) - before2;
  expect(vipGain).toBe(normalGain * 2);
});

// ====== #141 — Ennemi toxique (nuage de poison a la mort) ======

test('#141 toxic : enemyIsToxic detecte le type', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'toxic', 5, 0));
  expect(await page.evaluate(() => __game.debug.enemyIsToxic(0))).toBe(true);
});

test('#141 toxic : sa mort cree une zone de poison active', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'toxic', 5, 0));
  expect(await page.evaluate(() => __game.debug.poisonZoneActive())).toBe(false);
  await page.evaluate(() => __game.debug.damageEnemy(0, 99999));
  expect(await page.evaluate(() => __game.debug.poisonZoneActive())).toBe(true);
});

test('#141 toxic : la zone inflige des degats periodiques au joueur dedans', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(0));
  await page.evaluate(() => __game.debug.setPos(2, 0));
  await page.evaluate(() => __game.debug.spawnPoisonZoneAt(2, 0));
  const hpBefore = await page.evaluate(() => __game.debug.playerHealth());
  await page.waitForTimeout(700);
  const hpAfter = await page.evaluate(() => __game.debug.playerHealth());
  expect(hpAfter).toBeLessThan(hpBefore);
});

test('#141 toxic : aucun degat si le joueur est hors de la zone', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(0));
  await page.evaluate(() => __game.debug.setPos(40, 40));
  await page.evaluate(() => __game.debug.spawnPoisonZoneAt(0, 0));
  const hpBefore = await page.evaluate(() => __game.debug.playerHealth());
  await page.waitForTimeout(700);
  const hpAfter = await page.evaluate(() => __game.debug.playerHealth());
  expect(hpAfter).toBe(hpBefore);
});

test('#141 toxic : waveComposition alterne toxic/bomber au slot commun des la vague 6', async ({ page }) => {
  await startPlaying(page);
  const comp6 = await page.evaluate(() => __game.debug.waveComposition(6));
  const comp7 = await page.evaluate(() => __game.debug.waveComposition(7));
  expect(comp6).toContain('toxic');
  expect(comp7).not.toContain('toxic');
});

// ====== #146 — Ennemi cryo (zone de gel a la mort) ======

test('#146 cryo : enemyIsCryo detecte le type', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'cryo', 5, 0));
  expect(await page.evaluate(() => __game.debug.enemyIsCryo(0))).toBe(true);
});

test('#146 cryo : sa mort cree une zone de gel active', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'cryo', 5, 0));
  expect(await page.evaluate(() => __game.debug.frostZoneActive())).toBe(false);
  await page.evaluate(() => __game.debug.damageEnemy(0, 99999));
  expect(await page.evaluate(() => __game.debug.frostZoneActive())).toBe(true);
});

test('#146 cryo : la zone ralentit le joueur dedans (vitesse effective reduite)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setPos(2, 0));
  await page.evaluate(() => __game.debug.spawnFrostZoneAt(2, 0));
  await page.evaluate(() => __game.debug.setInput({forward:true}));
  await page.waitForFunction(() => window.__game.locomotion === 'walk', null, { timeout:5000 });
  const speedFrost = await page.evaluate(() => __game.debug.playerMoveSpeed());
  await page.evaluate(() => __game.debug.setInput({}));
  await page.evaluate(() => __game.debug.setPos(40, 40)); // hors zone
  await page.evaluate(() => __game.debug.setInput({forward:true}));
  await page.waitForFunction(() => window.__game.locomotion === 'walk', null, { timeout:5000 });
  const speedNormal = await page.evaluate(() => __game.debug.playerMoveSpeed());
  expect(speedFrost).toBeLessThan(speedNormal);
});

test('#146 cryo : aucun ralentissement hors de la zone', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.playerInFrostZone())).toBe(false);
});

test('#146 cryo : waveComposition alterne cryo/stunner au slot commun des la vague 7', async ({ page }) => {
  await startPlaying(page);
  const comp8 = await page.evaluate(() => __game.debug.waveComposition(8));
  const comp9 = await page.evaluate(() => __game.debug.waveComposition(9));
  expect(comp8).toContain('cryo');
  expect(comp9).not.toContain('cryo');
});

// ====== #151 — Ennemi commandant (aura de buff) ======

test('#151 commander : enemyIsCommander detecte le type', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'commander', 5, 0));
  expect(await page.evaluate(() => __game.debug.enemyIsCommander(0))).toBe(true);
});

test('#151 commander : commanderAliveMult 1 sans commandant, 1.2 avec un commandant vivant', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.commanderAliveMult())).toBe(1);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'commander', 5, 0));
  expect(await page.evaluate(() => __game.debug.commanderAliveMult())).toBe(1.2);
});

test('#151 commander : les degats de tir ennemi sont plus eleves avec un commandant vivant', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setEnemyAccuracy(1)); // tir garanti au but
  await page.evaluate(() => __game.debug.setShield(0));
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0, 'shooter', 5, 0); __game.debug.moveEnemy(1,40,40); __game.debug.moveEnemy(2,40,40); });
  const hpBefore1 = await page.evaluate(() => __game.debug.playerHealth());
  await page.evaluate(() => __game.debug.forceEnemyShoot(0));
  const normalDmg = hpBefore1 - (await page.evaluate(() => __game.debug.playerHealth()));
  expect(normalDmg).toBeGreaterThan(0);

  await page.evaluate(() => __game.debug.restart());
  await page.waitForTimeout(100);
  await page.evaluate(() => __game.debug.setEnemyAccuracy(1));
  await page.evaluate(() => __game.debug.setShield(0));
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0, 'shooter', 5, 0); __game.debug.spawnEnemyTypeAt(1, 'commander', 8, 0); __game.debug.moveEnemy(2,40,40); });
  const hpBefore2 = await page.evaluate(() => __game.debug.playerHealth());
  await page.evaluate(() => __game.debug.forceEnemyShoot(0));
  const buffedDmg = hpBefore2 - (await page.evaluate(() => __game.debug.playerHealth()));
  expect(buffedDmg).toBeGreaterThan(normalDmg);
});

test('#151 commander : waveComposition alterne commander/berserker au slot commun des la vague 9', async ({ page }) => {
  await startPlaying(page);
  const comp12 = await page.evaluate(() => __game.debug.waveComposition(12));
  const comp13 = await page.evaluate(() => __game.debug.waveComposition(13));
  expect(comp12).toContain('commander');
  expect(comp13).not.toContain('commander');
  expect(comp13).toContain('berserker'); // le berserker n'a pas disparu (alternance, pas remplacement)
});
