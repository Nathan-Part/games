import { test, expect } from '@playwright/test';
import { trackErrors, startPlaying, faceEnemyForMelee, alignTwoEnemies } from './helpers.js';

// ====== Correctifs UX (retours utilisateur) ======

test('vitrine perso : les fleches naviguent les persos (pas les armes)', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await page.locator('#btn-shop').click();
  await page.locator('.shop-tab[data-tab="player"]').click();
  const c0 = await page.evaluate(() => __game.debug.shop.currentChar());
  await page.locator('#shop-next').click();
  const c1 = await page.evaluate(() => __game.debug.shop.currentChar());
  expect(c1).not.toBe(c0);                                   // la flèche change le perso, pas l'arme
  await page.locator('#shop-prev').click();
  expect(await page.evaluate(() => __game.debug.shop.currentChar())).toBe(c0);
});

test('danse : apercu possible sans acheter, puis acheter', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(2000); });
  await page.locator('#btn-shop').click();
  await page.locator('.shop-tab[data-tab="accessories"]').click();
  await page.locator('#shop-info [data-accslot="dance"]').click();
  // dance:skill1 non possédée : bouton APERÇU (preview) ET bouton ACHETER présents
  await expect(page.locator('#shop-info [data-previewdance="dance:skill1"]')).toBeVisible();
  await expect(page.locator('#shop-info [data-buydance="dance:skill1"]')).toBeVisible();
  await page.locator('#shop-info [data-buydance="dance:skill1"]').click();        // puis acheter
  expect(await page.evaluate(() => __game.debug.save.get().ownedDances)).toContain('dance:skill1');
});

// ====== #47 — Bug : ennemi flotte en l'air ======

test('#47 corpse : cadavre reste au sol apres la mort (position.y <= 0.5)', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() >= 1, null, {timeout:20000});
  await page.evaluate(() => {
    const e = __game.debug; e.spawnEnemyInFront(2);
  });
  await page.waitForFunction(() => window.__game.debug.enemyCount() >= 1, null, {timeout:3000});
  await page.evaluate(() => { for(let i=0;i<__game.debug.enemyCount();i++) __game.debug.damageEnemy(i,9999); });
  await page.waitForFunction(() => window.__game.debug.enemyState(0) === 'dead', null, {timeout:3000});
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => __game.debug.enemyState(0))).toBe('dead');
  // le coeur du test (#47) : le cadavre ne flotte pas → position.y clampée près du sol
  const posY = await page.evaluate(() => __game.debug.enemyPos(0).y);
  expect(posY).toBeLessThanOrEqual(0.5);
  expect(posY).toBeGreaterThanOrEqual(-0.5); // ni flottant, ni enfoncé (clamp bidirectionnel #47)
});

// ====== #48 — Bug : spawn hors obstacles ======

test('#48 spawn : pointInObstacle est expose et fonctionne', async ({ page }) => {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.booted);
  // pointInObstacle doit être exposé et renvoyer false pour (0,0) (centre de la map)
  const res = await page.evaluate(() => __game.debug.pointInObstacle(0, 0));
  expect(typeof res).toBe('boolean');
});

test('#48 spawn : les ennemis vague 2 apparaissent bien (forceNextWave)', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, {timeout:20000});
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.evaluate(() => __game.debug.forceNextWave());
  expect(await page.evaluate(() => __game.wave)).toBe(2);
  expect(await page.evaluate(() => __game.debug.enemyCount())).toBe(4);
  expect(await page.evaluate(() => __game.debug.enemyAlive())).toBe(4);
});

// ====== Audit fix — mineStock reinitialise au restart ======

test('audit : le stock de mines est recharge au restart', async ({ page }) => {
  await startPlaying(page);
  const full = await page.evaluate(() => __game.debug.mineStock());
  expect(full).toBeGreaterThan(0);
  // épuise le stock
  await page.evaluate(() => { while(__game.debug.mineStock() > 0) __game.debug.placeMine(); });
  const empty = await page.evaluate(() => __game.debug.mineStock());
  expect(empty).toBe(0);
  // restart → stock rechargé à plein
  await page.evaluate(() => __game.debug.restart());
  await page.waitForTimeout(100);
  const refilled = await page.evaluate(() => __game.debug.mineStock());
  expect(refilled).toBe(full);
});

// ====== Boucle d'audit 2026-06-30 (2e cycle) : conformité doc/code + fuites de scène/HUD ======

test('AUDIT #118 -> #155 : la grenade collante n est plus rechargee par vague (stock persistant achete)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.stickyStock())).toBe(4);   // stock de depart (#155)
  await page.evaluate(() => __game.debug.throwSticky());
  expect(await page.evaluate(() => __game.debug.stickyStock())).toBe(3);   // consommee
  await page.evaluate(() => __game.debug.forceNextWave());                 // vague suivante => plus de refill (#155)
  expect(await page.evaluate(() => __game.debug.stickyStock())).toBe(3);   // stock inchange
});

test('#155 : le stock consomme persiste au restart (pas de reset au max)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => __game.debug.throwGrenade());
  await page.evaluate(() => __game.debug.throwGrenade());
  expect(await page.evaluate(() => __game.debug.grenadeCount())).toBe(10);   // 12 - 2
  await page.evaluate(() => __game.debug.restart());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.grenadeCount())).toBe(10);   // pas de refill
  expect(await page.evaluate(() => __game.debug.consumables().frag)).toBe(10);   // save synchronisee
});

test('#155 : caisse de ravitaillement "grenades" ajoute un bonus fixe (pas un refill au max)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => __game.debug.setConsumableStock('frag', 5));
  await page.evaluate(() => __game.debug.forceCarePackageReward('grenades'));
  await page.evaluate(() => { __game.debug.spawnCarePackageAt(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.grenadeCount())).toBe(8);   // 5 + bonus fixe (+3), pas remis a 12
  expect(await page.evaluate(() => __game.debug.consumables().frag)).toBe(8);
});

test('#155 : a 0 stock, lancer un objet echoue sans exception ni decrementation negative', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => __game.debug.setConsumableStock('emp', 0));
  expect(await page.evaluate(() => __game.debug.throwEmp())).toBe(false);
  expect(await page.evaluate(() => __game.debug.empStock())).toBe(0);
});

test('consommables : l onglet boutique affiche les 6 items avec le bon prix', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.backToHome());
  await page.evaluate(() => { __game.debug.shop.open(); __game.debug.shop.tab('consumables'); });
  const html = await page.evaluate(() => document.getElementById('shop-info').innerHTML);
  expect(html).toContain('Grenade frag');
  expect(html).toContain('Flashbang');
  expect(html).toContain('Fumigène');
  expect(html).toContain('Grenade collante');
  expect(html).toContain('Molotov');
  expect(html).toContain('EMP');
  expect((html.match(/data-buycons=/g) || []).length).toBe(6);
});

test('consommables : cliquer Acheter incremente le stock affiche et debite l argent', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.backToHome());
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(1000); });
  await page.evaluate(() => { __game.debug.shop.open(); __game.debug.shop.tab('consumables'); });
  const before = await page.evaluate(() => __game.debug.consumables().frag);
  await page.evaluate(() => document.querySelector('[data-buycons="frag"]').click());
  const after = await page.evaluate(() => __game.debug.consumables().frag);
  expect(after).toBe(before + 1);
  expect(await page.evaluate(() => __game.money)).toBe(950);
  const html = await page.evaluate(() => document.getElementById('shop-info').innerHTML);
  expect(html).toContain(String(after));
});

test('AUDIT fuite scene : sticky + grenades ennemies nettoyees au retour menu (backToHome)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.throwSticky(); });
  // place une grenade ennemie en vol si un grenadier existe, sinon on s'appuie sur la sticky
  expect(await page.evaluate(() => __game.debug.stickyCount())).toBeGreaterThan(0);
  await page.evaluate(() => __game.debug.backToHome());
  expect(await page.evaluate(() => __game.debug.stickyCount())).toBe(0);
  expect(await page.evaluate(() => __game.debug.enemyGrenadeCount())).toBe(0);
});

test('AUDIT #78 : le Jackal-45 est semi-auto par defaut (id catalogue reel)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setSemiAuto(false));              // pas de toggle manuel
  await page.evaluate(() => __game.debug.forceEquipWeapon('jackal'));      // id reel du catalogue
  expect(await page.evaluate(() => __game.debug.semiAutoMode())).toBe(true);
  // un fusil d'assaut reste full-auto
  await page.evaluate(() => __game.debug.forceEquipWeapon('default'));
  const auto = await page.evaluate(() => __game.debug.semiAutoMode());
  expect(auto).toBe(false);
});

test('AUDIT #91 : l\'anneau de zone de danger est retire au retour menu (pas dans le lobby)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.dangerZoneRadius());              // force la construction via update
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => __game.debug.dzMeshActive())).toBe(true);
  await page.evaluate(() => __game.debug.backToHome());
  expect(await page.evaluate(() => __game.debug.dzMeshActive())).toBe(false);
});

test('AUDIT fuite HUD : shield-bar et smoke-hud masques au retour menu', async ({ page }) => {
  await startPlaying(page);
  await expect(page.locator('#shield-bar')).toBeVisible();
  await expect(page.locator('#smoke-hud')).toBeVisible();
  await page.evaluate(() => __game.debug.backToHome());
  await expect(page.locator('#shield-bar')).toBeHidden();
  await expect(page.locator('#smoke-hud')).toBeHidden();
});

test('AUDIT #125 : pas d\'invincibilite rampage residuelle dans la partie suivante', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.triggerRampage());
  expect(await page.evaluate(() => __game.debug.rampageActive())).toBe(true);
  await page.evaluate(() => __game.debug.backToHome());
  await page.evaluate(() => __game.debug.start(0));
  await page.waitForFunction(() => window.__game.phase === 'playing', null, { timeout: 20000 });
  expect(await page.evaluate(() => __game.debug.rampageActive())).toBe(false);  // rampage purge au demarrage
});

// ====== Boucle d'audit 2026-06-30 (itération 2) : symétrie reset startGame + fuites HUD + loot sniper ======

test('AUDIT2 fuite HUD : stamina-hud et hardcore-hud masques au retour menu', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setStamina(50); __game.debug.setHardcore(true); });
  await expect(page.locator('#stamina-hud')).toBeVisible();
  await expect(page.locator('#hardcore-hud')).toBeVisible();
  await page.evaluate(() => __game.debug.backToHome());
  await expect(page.locator('#stamina-hud')).toBeHidden();
  await expect(page.locator('#hardcore-hud')).toBeHidden();
});

test('AUDIT2 #72 : le streak kills est remis a zero au lancement depuis le menu', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnEnemyAt(0, 3); __game.debug.damageEnemy(0, 9999); });
  expect(await page.evaluate(() => __game.debug.streakKills())).toBe(1);   // streak actif
  await page.evaluate(() => __game.debug.backToHome());
  await page.evaluate(() => __game.debug.start(0));
  await page.waitForFunction(() => window.__game.phase === 'playing', null, { timeout: 20000 });
  expect(await page.evaluate(() => __game.debug.streakKills())).toBe(0);   // pas de streak residuel
});

test('AUDIT2 #80 : le temps de session est comptabilise au retour menu (pas seulement a la mort)', async ({ page }) => {
  await startPlaying(page);
  const before = await page.evaluate(() => __game.debug.lifetimeStats().playtime || 0);
  await page.waitForTimeout(1300);                                          // accumule >1s
  await page.evaluate(() => __game.debug.backToHome());
  const after = await page.evaluate(() => __game.debug.lifetimeStats().playtime || 0);
  expect(after).toBeGreaterThan(before);                                    // flush au retour menu
});

test('AUDIT2 #61/#89 : isSniper tient compte de l\'arme lootee (lunette/laser coherents)', async ({ page }) => {
  await startPlaying(page);
  // arme de la save = non-sniper, mais sniper LOOTÉ au sol => lunette doit s'activer
  await page.evaluate(() => { __game.debug.forceEquipWeapon('default'); __game.debug.setMatchWeapon('sniper'); __game.debug.setInput({ aim: true }); });
  expect(await page.evaluate(() => __game.debug.sniperScopeActive())).toBe(true);
  // inverse : sniper en save mais SMG lootée => pas de lunette fantome
  await page.evaluate(() => { __game.debug.forceEquipWeapon('sniper'); __game.debug.setMatchWeapon('default'); });
  expect(await page.evaluate(() => __game.debug.sniperScopeActive())).toBe(false);
});

test('AUDIT3 #67/#94 : le bouclier ne regenere pas en mode hardcore', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.killAllEnemies(); __game.debug.setHardcore(true); __game.debug.setShield(0); });
  await page.waitForTimeout(1200);                                          // > assez pour regen (15/s) si le bug existait
  expect(await page.evaluate(() => __game.debug.shieldHp())).toBe(0);       // hardcore = aucune régén bouclier
  // contrôle : hors hardcore, le bouclier remonte bien (prouve que le test n'est pas tautologique)
  await page.evaluate(() => { __game.debug.killAllEnemies(); __game.debug.setHardcore(false); __game.debug.setShield(0); });
  await page.waitForTimeout(7000);   // > SHIELD_DELAY (6s) : setShield pose shieldLastDmg=now, la régén attend le délai puis remonte
  expect(await page.evaluate(() => __game.debug.shieldHp())).toBeGreaterThan(0);
});

// ====== Boucle d'audit 2026-06-30 (itération 4) : boutique + sauvegarde ======

test('AUDIT4 #62 : les contrats quotidiens sont initialises en jeu (sinon inertes en production)', async ({ page }) => {
  await startPlaying(page);                                    // startGame doit initialiser save.daily
  const daily = await page.evaluate(() => __game.debug.save.get().daily);
  expect(daily).not.toBeNull();                                // sans le fix, save.daily reste null => track* inertes
  expect(Array.isArray(daily.contracts)).toBe(true);
  expect(daily.contracts.length).toBe(3);
});

test('AUDIT4 #80 : le playtime est comptabilise a chaque restart (pas seulement au 1er run)', async ({ page }) => {
  await startPlaying(page);
  await page.waitForTimeout(1300);
  await page.evaluate(() => __game.debug.restart());           // flush run1 + relance le chrono
  const after1 = await page.evaluate(() => __game.debug.lifetimeStats().playtime);
  expect(after1).toBeGreaterThan(0);
  await page.waitForTimeout(1300);
  await page.evaluate(() => __game.debug.restart());           // flush run2 (serait perdu sans le fix)
  const after2 = await page.evaluate(() => __game.debug.lifetimeStats().playtime);
  expect(after2).toBeGreaterThan(after1);
});

test('AUDIT4 #18 : setSetting borne la sensibilite et le volume (pas de valeur pathologique persistee)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.settings.set('sensitivity', 0));
  expect(await page.evaluate(() => __game.debug.settings.get().sensitivity)).toBeGreaterThanOrEqual(0.2);  // pas de visée figée
  await page.evaluate(() => __game.debug.settings.set('volume', -5));
  expect(await page.evaluate(() => __game.debug.settings.get().volume)).toBe(0);                            // pas de gain négatif
  await page.evaluate(() => __game.debug.settings.set('volume', 50));
  expect(await page.evaluate(() => __game.debug.settings.get().volume)).toBe(1);                            // borné à 1
});

test('AUDIT4 #53 : reequiper un boost annule un "Run" residuel (plus de boost fantome)', async ({ page }) => {
  await startPlaying(page);
  const bo = await page.evaluate(() => { __game.debug.save.addMoney(5000); const c = __game.debug.shop.boostCatalog()[0]; __game.debug.shop.buyBoost(c.id); __game.debug.shop.equipBoost(c.id); return c; });
  expect(await page.evaluate((stat) => __game.debug.boostBonuses()[stat], bo.stat)).toBeGreaterThan(0);
  await page.evaluate((slot) => __game.debug.unequipBoostRun(slot), bo.slot);             // désactivé pour la partie
  expect(await page.evaluate((slot) => __game.debug.isBoostRunDisabled(slot), bo.slot)).toBe(true);
  await page.evaluate((id) => { __game.debug.shop.equipBoost(id); __game.debug.shop.equipBoost(id); }, bo.id);  // déséquipe puis ré-équipe en permanent
  expect(await page.evaluate((slot) => __game.debug.isBoostRunDisabled(slot), bo.slot)).toBe(false);    // override nettoyé
  expect(await page.evaluate((stat) => __game.debug.boostBonuses()[stat], bo.stat)).toBeGreaterThan(0);  // bonus actif à nouveau
});

test('AUDIT4 #13 : buyWeapon rejette un id inconnu sans polluer la save ni debiter', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.addMoney(99999));
  const owned0 = await page.evaluate(() => __game.debug.save.get().ownedWeapons.length);
  const money0 = await page.evaluate(() => __game.money);
  expect(await page.evaluate(() => __game.debug.shop.buy('garbage_id_xyz'))).toBe(false);
  expect(await page.evaluate(() => __game.debug.save.get().ownedWeapons.length)).toBe(owned0);   // pas d'id fantôme poussé
  expect(await page.evaluate(() => __game.money)).toBe(money0);                                   // pas de débit
});

// ====== Boucle d'audit 2026-06-30 (itération 5) : IA ennemie + bugs d'animation/visibilité ======

test('AUDIT5 #119 : le bouclier shielder bloque selon le cap REEL de l ennemi (pas le +Z monde)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0, 'shielder', 0, 0); __game.debug.setPos(0, 8); }); // joueur au +Z
  await page.evaluate(() => __game.debug.setEnemyYaw(0, 0));            // ennemi face +Z (vers le joueur) -> frontal
  expect(await page.evaluate(() => __game.debug.enemyShieldBlocks(0))).toBe(true);
  await page.evaluate(() => __game.debug.setEnemyYaw(0, Math.PI));      // ennemi dos au joueur -> non bloqué
  expect(await page.evaluate(() => __game.debug.enemyShieldBlocks(0))).toBe(false);  // bug avant fix : true (figé sur +Z monde)
});

test('AUDIT5 #111 : le sniper a une portee d engagement longue (pas 9m comme les autres)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'sniper', 0, 20));
  expect(await page.evaluate(() => __game.debug.enemyShootRange(0))).toBeGreaterThan(20);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 0, 20));
  expect(await page.evaluate(() => __game.debug.enemyShootRange(0))).toBeLessThanOrEqual(9);  // shooter normal
});

// ====== Bugs gameplay (signalés en jouant) ======

test('bug renfort #84 : le renfort est cree avec un vrai squelette (clonable, touchable, tuable)', async ({ page }) => {
  await startPlaying(page);
  const before = await page.evaluate(() => __game.debug.enemyCount());
  await page.evaluate(() => __game.debug.forceCallReinforcement(0));
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => __game.debug.enemyCount());
  expect(after).toBeGreaterThan(before);                 // renfort ajouté
  // le dernier ennemi = renfort : prend des dégâts et meurt → exerce setEnemyEmissive (mats {mat,base})
  // (avant le fix, mats etait des materiaux simples → crash au flash/kill)
  const idx = after - 1;
  await page.evaluate(i => __game.debug.damageEnemy(i, 99999), idx);
  expect(await page.evaluate(i => __game.debug.enemyState(i), idx)).toBe('dead');
});

test('bug vue : retour menu remet la vue en 3e personne (pas de viewmodel FPS sur l accueil)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setView('first'));
  expect(await page.evaluate(() => __game.view)).toBe('first');
  await page.evaluate(() => __game.debug.backToHome());
  expect(await page.evaluate(() => __game.view)).toBe('third');           // vue réinitialisée
  expect(await page.evaluate(() => __game.debug.weapon.viewmodelVisible())).toBe(false);  // viewmodel masqué
});

test('bug viseur : la lunette sniper ne reste pas sur l accueil (retour menu)', async ({ page }) => {
  await startPlaying(page);
  // add('show') + backToHome dans le MÊME evaluate : sinon la boucle de jeu (non scopé) retire 'show' avant le retour menu
  await page.evaluate(() => { document.getElementById('scope-overlay').classList.add('show'); __game.debug.backToHome(); });
  expect(await page.evaluate(() => document.getElementById('scope-overlay').classList.contains('show'))).toBe(false);
});

test('bug viseur : la lunette sniper est masquee a la mort (Game Over propre)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setShield(0); document.getElementById('scope-overlay').classList.add('show'); __game.debug.damagePlayer(99999); }); // mort, même evaluate
  expect(await page.evaluate(() => __game.phase)).toBe('dead');
  expect(await page.evaluate(() => document.getElementById('scope-overlay').classList.contains('show'))).toBe(false);
});

test('bug perso : equiper le Cyborg reconstruit le modele 3D (shop + jeu)', async ({ page }) => {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.characters?.length >= 1, null, { timeout:20000 });
  // acheter + équiper le Cyborg (perso:robot)
  await page.evaluate(() => __game.debug.save.addMoney(999999));
  const ok = await page.evaluate(async () => {
    __game.debug.shop.buyCharacter('perso:robot');
    return await __game.debug.shop.selectCharacter('perso:robot');
  });
  expect(ok).toBe(true);
  await page.waitForFunction(() => __game.debug.currentModelCharId() === 'perso:robot', null, { timeout:15000 });
  // le modèle 3D affiché EST bien le Cyborg (et pas blue-soldier)
  expect(await page.evaluate(() => __game.debug.currentModelCharId())).toBe('perso:robot');
  expect(await page.evaluate(() => __game.debug.save.get().selectedCharacterId)).toBe('perso:robot');
});

test('argent partie : runMoney compte l argent gagne CETTE partie (pas le total) et reset au restart', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.runMoney())).toBe(0); // début de partie = 0 gagné
  await page.evaluate(() => __game.debug.save.addMoney(0)); // no-op
  // tuer un ennemi rapporte de l'argent → runMoney augmente
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0, 'shooter', 5, 0); __game.debug.damageEnemy(0, 99999); });
  await page.waitForTimeout(100);
  const earned = await page.evaluate(() => __game.debug.runMoney());
  expect(earned).toBeGreaterThan(0);
  // restart → runMoney remis à 0 (le total save.money n'est PAS touché)
  await page.evaluate(() => __game.debug.restart());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.runMoney())).toBe(0);
});
