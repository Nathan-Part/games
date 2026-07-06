import { test, expect } from '@playwright/test';
import { trackErrors, startPlaying, faceEnemyForMelee, alignTwoEnemies } from './helpers.js';

test('persos : par defaut seul Blue-Soldier est jouable au lobby (les autres s achetent)', async ({ page }) => {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.characters?.length >= 1 && window.__game.phase === 'lobby', null, { timeout:20000 });
  const labels = await page.evaluate(() => __game.characters.map(c => c.label.toLowerCase()));
  expect(labels).toEqual(['blue-soldier']);   // seul le perso possédé par défaut (Sentinel/Cyborg à acheter)
});

test('boutique : catalogue d armes avec prix croissants', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const cat = await page.evaluate(() => __game.debug.shop.catalog());
  const ids = cat.map(w => w.id);
  expect(ids).toContain('default'); expect(ids).toContain('smg'); expect(ids).toContain('sniper');
  expect(cat.find(w => w.id === 'default').price).toBe(0);
  expect(cat.find(w => w.id === 'sniper').price).toBeGreaterThan(cat.find(w => w.id === 'smg').price);
});

test('boutique : catalogue contient pistolet, mitrailleuse et couteau avec categories', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const cat = await page.evaluate(() => __game.debug.shop.catalog());
  const ids = cat.map(w => w.id);
  expect(ids).toContain('pistol');
  expect(ids).toContain('lmg');
  expect(ids).toContain('knife');
  expect(cat.every(w => w.category)).toBe(true);       // toutes les armes ont une catégorie
  expect(cat.find(w => w.id === 'knife').melee).toBe(true);
});

test('couteau : acheter + equiper -> tryFire fait des degats mêlée sans consommer de balle', async ({ page }) => {
  test.setTimeout(60000);
  await startPlaying(page);
  await page.evaluate(() => {
    __game.debug.save.addMoney(2000);
    __game.debug.setEnemyAccuracy(0);
  });
  // #50 : 'knife' est gratuite et déjà possédée ; 'combat_knife' est achetable (650)
  expect(await page.evaluate(() => __game.debug.shop.buy('combat_knife'))).toBe(true);
  expect(await page.evaluate(() => __game.debug.shop.equip('combat_knife'))).toBe(true);
  // Pose le joueur à (0,0), tourne yaw=0, spawne ennemi à (0,2) = 2u devant (+Z)
  await page.evaluate(() => {
    __game.debug.setPos(0, 0); __game.debug.setYaw(0); __game.debug.setPitch(0);
    __game.debug.setView('first');
    __game.debug.moveEnemy(0, 0, 2);    // enemies[0] à 2u devant le joueur
    __game.debug.setPaused(true);
  });
  const hp0 = await page.evaluate(() => __game.debug.enemyHp(0));
  expect(await page.evaluate(() => __game.debug.tryFire())).toBe(true);
  await page.evaluate(() => __game.debug.setPaused(false));
  const hp1 = await page.evaluate(() => __game.debug.enemyHp(0));
  expect(hp1).toBeLessThan(hp0);                      // dégâts infligés par le couteau
});

test('boutique : l arme de depart garde les stats actuelles (compat)', async ({ page }) => {
  await startPlaying(page);
  const s = await page.evaluate(() => __game.debug.weaponStats());
  expect(s.mag).toBe(12); expect(s.cooldown).toBeCloseTo(0.12, 5); expect(s.dmgMult).toBe(1);
});

test('boutique : acheter une arme debite l argent et la rend possedee (persiste)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(1000); });
  expect(await page.evaluate(() => __game.debug.shop.buy('smg'))).toBe(true);
  expect(await page.evaluate(() => __game.money)).toBe(300);
  expect(await page.evaluate(() => __game.debug.save.get().ownedWeapons)).toContain('smg');
  await page.reload(); await page.waitForFunction(() => window.__game?.booted);
  expect(await page.evaluate(() => __game.debug.save.get().ownedWeapons)).toContain('smg');
});

test('boutique : achat refuse si pas assez d argent', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(100); });
  expect(await page.evaluate(() => __game.debug.shop.buy('sniper'))).toBe(false);
  expect(await page.evaluate(() => __game.money)).toBe(100);
  expect(await page.evaluate(() => __game.debug.save.get().ownedWeapons)).not.toContain('sniper');
});

test('boutique : equiper une arme change les stats (persiste)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(2000);
    __game.debug.shop.buy('sniper'); __game.debug.shop.equip('sniper'); });
  const s = await page.evaluate(() => __game.debug.weaponStats());
  expect(s.dmgMult).toBe(3); expect(s.mag).toBe(5);
  expect(await page.evaluate(() => __game.debug.save.get().selectedWeapon)).toBe('sniper');
});

test('boutique : equiper le sniper tue un ennemi (tete) en une balle', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await page.evaluate(() => { __game.debug.setView('first'); __game.debug.setPitch(0);
    __game.debug.save.addMoney(2000); __game.debug.shop.buy('sniper'); __game.debug.shop.equip('sniper'); });
  await page.waitForTimeout(120);
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8));
  expect(await page.evaluate(() => __game.debug.enemyHp(0))).toBe(100);
  expect(await page.evaluate(() => __game.debug.tryFire())).toBe(true);
  expect(await page.evaluate(() => __game.debug.enemyHp(0))).toBeLessThanOrEqual(0);  // 60*3=180 >= 100
});

test('boutique : equiper une autre arme reconstruit le modele au lancement', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.weapon?.held?.() === true, null, { timeout:20000 });
  await page.evaluate(() => { __game.debug.save.addMoney(1000); __game.debug.shop.buy('smg'); __game.debug.shop.equip('smg'); });
  await page.evaluate(() => __game.debug.backToHome());
  await page.waitForFunction(() => window.__game.phase === 'lobby', null, { timeout:5000 });
  await page.evaluate(() => __game.debug.start(0));
  await page.waitForFunction(() => window.__game.phase === 'playing', null, { timeout:20000 });
  await page.waitForFunction(() => window.__game.debug.weapon?.held?.() === true, null, { timeout:20000 });
  expect(await page.evaluate(() => __game.debug.weapon.equippedId())).toBe('smg');
});

test('boutique3d : ouvre plein ecran, masque le perso, montre l arme ; fermer restaure', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.debug?.modelVisible?.() === true, null, { timeout:20000 });  // lobby chargé (perso visible)
  await page.locator('#btn-shop').click();
  await expect(page.locator('#shop-panel')).toBeVisible();
  expect(await page.evaluate(() => __game.debug.shop.isOpen())).toBe(true);
  expect(await page.evaluate(() => __game.debug.shop.previewWeapon())).not.toBeNull();   // arme en vitrine
  expect(await page.evaluate(() => __game.debug.modelVisible())).toBe(false);             // perso masqué
  await page.locator('#shop-close').click();
  await expect(page.locator('#shop-panel')).toBeHidden();
  expect(await page.evaluate(() => __game.debug.shop.isOpen())).toBe(false);
  expect(await page.evaluate(() => __game.debug.modelVisible())).toBe(true);              // perso restauré
});

test('boutique3d : le carrousel change l arme affichee', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });   // vitrine en primitive (évite le GLB 13 Mo)
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await page.locator('#btn-shop').click();
  const a = await page.evaluate(() => __game.debug.shop.current());
  await page.locator('#shop-next').click();
  const b = await page.evaluate(() => __game.debug.shop.current());
  expect(b).not.toBe(a);
  expect(await page.evaluate(() => __game.debug.shop.previewWeapon())).toBe(b);
});

test('boutique3d : onglet Personnage montre les ameliorations perso (apres ★)', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });   // vitrine en primitive (évite le GLB lourd)
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await page.locator('#btn-shop').click();
  await page.locator('.shop-tab[data-tab="player"]').click();
  expect(await page.evaluate(() => __game.debug.shop.currentTab())).toBe('player');
  await page.locator('#shop-ameliorer').click();                       // déplie les améliorations joueur
  await expect(page.locator('#shop-info [data-pupg="health"]')).toBeVisible();
});

test('boutique3d : acheter via la vitrine puis equiper', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });   // vitrine en primitive (évite le GLB 13 Mo)
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(2000); });
  await page.locator('#btn-shop').click();
  await page.evaluate(() => __game.debug.shop.setWeapon('sniper'));
  await page.locator('#shop-info [data-buy="sniper"]').click();
  await expect(page.locator('#shop-info [data-equip="sniper"]')).toBeVisible();
  expect(await page.evaluate(() => __game.debug.save.get().ownedWeapons)).toContain('sniper');
});

test('boutique3d : ameliorer l arme possedee depuis l onglet Armes', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });   // vitrine en primitive (évite le GLB 13 Mo)
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(1000); });
  await page.locator('#btn-shop').click();   // arme equipee 'default' (possedee) affichee d'office
  await page.locator('#shop-ameliorer').click();   // déplie les améliorations
  await page.locator('#shop-info [data-upg="damage"]').click();
  expect(await page.evaluate(() => __game.debug.save.get().weaponUpgrades.default.damage)).toBe(1);
});

test('boutique3d : ameliorer le perso depuis l onglet Personnage', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });   // vitrine en primitive (évite le GLB 13 Mo)
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(1000); });
  await page.locator('#btn-shop').click();
  await page.locator('.shop-tab[data-tab="player"]').click();
  await page.locator('#shop-ameliorer').click();                       // déplie les améliorations joueur (carrousel #25)
  await page.locator('#shop-info [data-pupg="health"]').click();
  expect(await page.evaluate(() => __game.debug.save.get().playerUpgrades.health)).toBe(1);
});

test('upgrade : ameliorer les degats augmente le multiplicateur', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(1000); });
  const d0 = await page.evaluate(() => __game.debug.weaponStats().dmgMult);
  expect(await page.evaluate(() => __game.debug.shop.upgrade('default','damage'))).toBe(true);
  expect(await page.evaluate(() => __game.debug.weaponStats().dmgMult)).toBeGreaterThan(d0);
});

test('upgrade : achat debite et persiste, chargeur +20%', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(1000); __game.debug.shop.upgrade('default','mag'); });
  expect(await page.evaluate(() => __game.money)).toBe(750);
  expect(await page.evaluate(() => __game.debug.weaponStats().mag)).toBe(14);   // round(12*1.2)
  await page.reload(); await page.waitForFunction(() => window.__game?.booted);
  expect(await page.evaluate(() => __game.debug.save.get().weaponUpgrades.default.mag)).toBe(1);
});

test('upgrade : cout croissant et niveau plafonne', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(100000); });
  const c0 = await page.evaluate(() => __game.debug.shop.upgradeCost('default','damage'));
  await page.evaluate(() => __game.debug.shop.upgrade('default','damage'));
  const c1 = await page.evaluate(() => __game.debug.shop.upgradeCost('default','damage'));
  expect(c1).toBeGreaterThan(c0);
  for(let i=0;i<6;i++) await page.evaluate(() => __game.debug.shop.upgrade('default','damage'));
  expect(await page.evaluate(() => __game.debug.save.get().weaponUpgrades.default.damage)).toBe(5);  // max
  expect(await page.evaluate(() => __game.debug.shop.upgrade('default','damage'))).toBe(false);
});

test('upgrade : sans amelioration = stats de base (compat)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  const s = await page.evaluate(() => __game.debug.weaponStats('default'));
  expect(s.dmgMult).toBe(1); expect(s.mag).toBe(12);
});

test('perso : ameliorer la vie augmente la vie max', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(1000); });
  expect(await page.evaluate(() => __game.debug.playerStats().maxHealth)).toBe(100);
  expect(await page.evaluate(() => __game.debug.shop.playerUpgrade('health'))).toBe(true);
  expect(await page.evaluate(() => __game.debug.playerStats().maxHealth)).toBe(120);
});

test('perso : ameliorer la vitesse augmente le multiplicateur (debite, persiste)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(1000); __game.debug.shop.playerUpgrade('speed'); });
  expect(await page.evaluate(() => __game.debug.playerStats().speedMult)).toBeGreaterThan(1);
  expect(await page.evaluate(() => __game.money)).toBe(650);
  await page.reload(); await page.waitForFunction(() => window.__game?.booted);
  expect(await page.evaluate(() => __game.debug.save.get().playerUpgrades.speed)).toBe(1);
});

test('perso : sans amelioration = stats de base (compat)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  const s = await page.evaluate(() => __game.debug.playerStats());
  expect(s.maxHealth).toBe(100); expect(s.regenRate).toBe(10); expect(s.speedMult).toBe(1);
});

test('perso : ameliorer la vie donne plus de PV en partie', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(1000);
    __game.debug.shop.playerUpgrade('health'); __game.debug.shop.playerUpgrade('health'); });  // +40
  await page.evaluate(() => __game.debug.restart());   // relance la partie => PV pleins au nouveau max
  expect(await page.evaluate(() => __game.health)).toBe(140);
});

test('boutique3d : la touche fleche change l arme, Echap ferme', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });   // vitrine en primitive (évite le GLB 13 Mo)
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await page.locator('#btn-shop').click();
  const a = await page.evaluate(() => __game.debug.shop.current());
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => page.evaluate(() => __game.debug.shop.current())).not.toBe(a);
  await page.keyboard.press('Escape');
  await expect(page.locator('#shop-panel')).toBeHidden();
});

test('accueil : le perso joue une anim idle (pas en T-pose)', async ({ page }) => {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.debug?.lobbyAnimated?.() === true, null, { timeout:30000 });
});

test('boutique3d : le bouton Ameliorer deplie les ameliorations de l arme', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await page.locator('#btn-shop').click();   // arme equipee 'default' (possedee) affichee d'office
  await expect(page.locator('#shop-info [data-upg="damage"]')).toBeHidden();
  await page.locator('#shop-ameliorer').click();
  await expect(page.locator('#shop-info [data-upg="damage"]')).toBeVisible();
});

test('boutique3d : la vitrine affiche les stats de l arme (degats, chargeur)', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await page.locator('#btn-shop').click();
  await expect(page.locator('#shop-info')).toContainText('Dégâts');
  await expect(page.locator('#shop-info')).toContainText('Chargeur');
});

test('persos : catalogue (Blue-Soldier gratuit, Sentinel/Cyborg payants, Cyborg > Sentinel)', async ({ page }) => {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.booted);
  const cat = await page.evaluate(() => __game.debug.shop.charCatalog());
  const byName = n => cat.find(c => c.name === n);
  expect(byName('Blue-Soldier').price).toBe(0);
  expect(byName('Cyborg').price).toBeGreaterThan(byName('Sentinel').price);   // Cyborg plus cher
  expect(byName('Cyborg').base.health).toBeGreaterThan(byName('Sentinel').base.health);   // meilleures stats
  expect(byName('Cyborg').base.speed).toBeGreaterThan(byName('Blue-Soldier').base.speed);
});

test('persos : acheter et equiper un perso change les stats de base', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.playerStats().maxHealth)).toBe(100);   // Blue-Soldier
  await page.evaluate(() => { __game.debug.save.addMoney(5000); __game.debug.shop.buyCharacter('perso:robot'); __game.debug.shop.selectCharacter('perso:robot'); });
  expect(await page.evaluate(() => __game.debug.save.get().ownedCharacters)).toContain('perso:robot');
  expect(await page.evaluate(() => __game.debug.playerStats().maxHealth)).toBe(175);   // Cyborg base
  expect(await page.evaluate(() => __game.debug.playerStats().speedMult)).toBeGreaterThan(1);
});

test('persos : achat refuse si pas assez d argent ; non possede non equipable', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(100); });
  expect(await page.evaluate(() => __game.debug.shop.buyCharacter('perso:guard'))).toBe(false);
  expect(await page.evaluate(() => __game.debug.shop.selectCharacter('perso:guard'))).toBe(false);   // non possédé
  expect(await page.evaluate(() => __game.debug.save.get().ownedCharacters)).not.toContain('perso:guard');
});

test('persos : la vitrine (onglet Personnage) montre le perso centre et permet d acheter/equiper', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(5000); });
  await page.locator('#btn-shop').click();
  await page.locator('.shop-tab[data-tab="player"]').click();
  await page.evaluate(() => __game.debug.shop.setChar('perso:robot'));        // centre le carrousel sur Cyborg
  await expect(page.locator('#shop-info')).toContainText('Cyborg');           // carte du perso centré
  const html = await page.evaluate(() => document.getElementById('shop-info').innerHTML);
  expect(html).toMatch(/#9aa3b2|#4f9dff|#b066ff|#ffb02e/);                    // badge rareté
  await page.locator('#shop-info [data-buychar="perso:robot"]').click();      // acheter Cyborg
  expect(await page.evaluate(() => __game.debug.save.get().ownedCharacters)).toContain('perso:robot');
  await page.locator('#shop-info [data-selchar="perso:robot"]').click();      // équiper
  expect(await page.evaluate(() => __game.debug.save.get().selectedCharacterId)).toBe('perso:robot');
});

// ====== Tranche 26 : accessoires (casque/costume) ======

test('accessoires : catalogue casque/costume (none gratuit, prix croissants, rarete)', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const keys = await page.evaluate(() => __game.debug.shop.rarities().map(r => r.id));
  for(const slot of ['helmet','costume']){
    const cat = await page.evaluate(s => __game.debug.shop.accessoryCatalog(s), slot);
    expect(cat[0].price).toBe(0);                                  // « Aucun » gratuit
    expect(cat[cat.length-1].price).toBeGreaterThan(cat[1].price); // payants croissants
    for(const a of cat) expect(keys).toContain(a.rarity);
  }
});

test('accessoires : acheter+equiper un masque (persiste)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(2000); });
  expect(await page.evaluate(() => __game.debug.shop.buyAccessory('helm:insect'))).toBe(true);
  expect(await page.evaluate(() => __game.debug.shop.selectAccessory('helmet','helm:insect'))).toBe(true);
  expect(await page.evaluate(() => __game.debug.playerAccessory('helmet'))).toBe('helm:insect');
  await page.reload(); await page.waitForFunction(() => window.__game?.booted);
  expect(await page.evaluate(() => __game.debug.save.get().equipped.helmet)).toBe('helm:insect');
});

test('accessoires : equiper un costume ; retrait avec none', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(2000); __game.debug.shop.buyAccessory('cost:insect'); });
  expect(await page.evaluate(() => __game.debug.shop.selectAccessory('costume','cost:insect'))).toBe(true);
  expect(await page.evaluate(() => __game.debug.playerAccessory('costume'))).toBe('cost:insect');
  expect(await page.evaluate(() => __game.debug.shop.selectAccessory('costume','cost:none'))).toBe(true);
  expect(await page.evaluate(() => __game.debug.playerAccessory('costume'))).toBe('cost:none');
});

test('accessoires : achat refuse sans argent ; non possede non equipable', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(50); });
  expect(await page.evaluate(() => __game.debug.shop.buyAccessory('helm:skull-soldier'))).toBe(false);
  expect(await page.evaluate(() => __game.debug.shop.selectAccessory('helmet','helm:skull-soldier'))).toBe(false);
});

// ====== Tranche 27 : danses / emotes ======

test('danse : catalogue (gratuites + payantes, rarete)', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const keys = await page.evaluate(() => __game.debug.shop.rarities().map(r => r.id));
  const cat = await page.evaluate(() => __game.debug.shop.danceCatalog());
  expect(cat.some(d => d.price === 0)).toBe(true);                 // au moins une gratuite
  expect(cat.some(d => d.price > 0)).toBe(true);                   // au moins une payante
  for(const d of cat) expect(keys).toContain(d.rarity);
});

test('danse : acheter et selectionner (persiste)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(2000); });
  expect(await page.evaluate(() => __game.debug.shop.buyDance('dance:skill1'))).toBe(true);
  expect(await page.evaluate(() => __game.debug.shop.toggleDance('dance:skill1'))).toBe(true);
  expect(await page.evaluate(() => __game.debug.selectedDances())).toContain('dance:skill1');
  await page.reload(); await page.waitForFunction(() => window.__game?.booted);
  expect(await page.evaluate(() => __game.debug.save.get().selectedDances)).toContain('dance:skill1');
});

test('danse : jouer en partie fige la loco puis revient au mouvement', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.playDance(0))).toBe(true);
  expect(await page.evaluate(() => __game.debug.isDancing())).toBe(true);
  expect(await page.evaluate(() => __game.locomotion)).toBe('dance');
  await page.evaluate(() => __game.debug.setInput({ forward:true }));
  await page.waitForFunction(() => __game.debug.isDancing() === false, null, { timeout:5000 });
});

test('danse : la touche 1 declenche une danse en jeu', async ({ page }) => {
  await startPlaying(page);
  await page.keyboard.press('Digit1');
  expect(await page.evaluate(() => __game.debug.isDancing())).toBe(true);
});

test('danse : non possedee non assignable ; achat sans argent refuse', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(50); });
  expect(await page.evaluate(() => __game.debug.shop.toggleDance('dance:combo'))).toBe(false);
  expect(await page.evaluate(() => __game.debug.shop.buyDance('dance:combo'))).toBe(false);
});

test('danse : sous-onglet boutique achete et selectionne', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(2000); });
  await page.locator('#btn-shop').click();
  await page.locator('.shop-tab[data-tab="accessories"]').click();
  await page.locator('#shop-info [data-accslot="dance"]').click();
  await expect(page.locator('#shop-info')).toContainText('Skill I');
  await page.locator('#shop-info [data-buydance="dance:skill1"]').click();
  expect(await page.evaluate(() => __game.debug.save.get().ownedDances)).toContain('dance:skill1');
  await page.locator('#shop-info [data-seldance="dance:skill1"]').click();          // bouton Sélectionner
  expect(await page.evaluate(() => __game.debug.save.get().selectedDances)).toContain('dance:skill1');
});

// ====== Tranche 28 : boost / équipement à stats ======

test('boost : catalogue (3 slots, rarete, bonus)', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const keys = await page.evaluate(() => __game.debug.shop.rarities().map(r => r.id));
  const cat = await page.evaluate(() => __game.debug.shop.boostCatalog());
  const slots = new Set(cat.map(b => b.slot));
  expect(slots.has('vest')).toBe(true); expect(slots.has('boots')).toBe(true); expect(slots.has('medal')).toBe(true);
  for(const b of cat){ expect(keys).toContain(b.rarity); expect(b.bonus).toBeGreaterThan(0); }
});

test('boost : equiper un gilet augmente la vie max (persiste)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  const base = await page.evaluate(() => __game.debug.playerStats().maxHealth);   // 100 (Blue-Soldier)
  await page.evaluate(() => { __game.debug.save.addMoney(2000); __game.debug.shop.buyBoost('boost:vest2'); __game.debug.shop.equipBoost('boost:vest2'); });
  expect(await page.evaluate(() => __game.debug.playerStats().maxHealth)).toBe(base + 60);
  await page.reload(); await page.waitForFunction(() => window.__game?.booted);
  expect(await page.evaluate(() => __game.debug.save.get().equippedBoosts.vest)).toBe('boost:vest2');
});

test('boost : cumul multi-slots (vie + vitesse)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  const h0 = await page.evaluate(() => __game.debug.playerStats().maxHealth);
  const s0 = await page.evaluate(() => __game.debug.playerStats().speedMult);
  await page.evaluate(() => { __game.debug.save.addMoney(2000);
    __game.debug.shop.buyBoost('boost:vest1'); __game.debug.shop.equipBoost('boost:vest1');
    __game.debug.shop.buyBoost('boost:boots1'); __game.debug.shop.equipBoost('boost:boots1'); });
  expect(await page.evaluate(() => __game.debug.playerStats().maxHealth)).toBe(h0 + 25);
  expect(await page.evaluate(() => __game.debug.playerStats().speedMult)).toBeGreaterThan(s0);
});

test('boost : refus si non possede ou sans argent', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(50); });
  expect(await page.evaluate(() => __game.debug.shop.equipBoost('boost:vest1'))).toBe(false);
  expect(await page.evaluate(() => __game.debug.shop.buyBoost('boost:vest1'))).toBe(false);
});

test('consommables : nouveau save a le stock de depart (#155)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  const c = await page.evaluate(() => __game.debug.consumables());
  expect(c).toEqual({ frag:12, flashbang:8, smoke:6, sticky:4, molotov:4, emp:3, medkit:3 });   // medkit ajouté par #178
});

test('consommables : acheter debite l argent et incremente le stock sauvegarde', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(1000); });
  expect(await page.evaluate(() => __game.debug.shop.buyConsumable('frag'))).toBe(true);
  expect(await page.evaluate(() => __game.debug.consumables().frag)).toBe(13);
  expect(await page.evaluate(() => __game.money)).toBe(950);
});

test('consommables : achat refuse si argent insuffisant (aucun debit)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(10); });
  expect(await page.evaluate(() => __game.debug.shop.buyConsumable('emp'))).toBe(false);
  expect(await page.evaluate(() => __game.debug.consumables().emp)).toBe(3);
  expect(await page.evaluate(() => __game.money)).toBe(10);
});

test('consommables : achat sans plafond (stock accumulable)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(10000); });
  for(let i=0;i<20;i++) await page.evaluate(() => __game.debug.shop.buyConsumable('frag'));
  expect(await page.evaluate(() => __game.debug.consumables().frag)).toBe(32);   // 12 + 20
});

test('consommables : cle inconnue refusee', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(1000); });
  expect(await page.evaluate(() => __game.debug.shop.buyConsumable('inexistant'))).toBe(false);
});

test('boost : sans boost = stats de base (compat #15)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.playerStats().maxHealth)).toBe(100);
  expect(await page.evaluate(() => __game.debug.boostBonuses())).toEqual({ health:0, regen:0, speed:0 });
});

test('boost : onglet boutique achete et equipe', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(3000); });
  await page.locator('#btn-shop').click();
  await page.locator('.shop-tab[data-tab="boost"]').click();
  await expect(page.locator('#shop-info')).toContainText('Gilet');
  await page.locator('#shop-info [data-buyboost="boost:vest2"]').click();
  expect(await page.evaluate(() => __game.debug.save.get().ownedBoosts)).toContain('boost:vest2');
  await page.locator('#shop-info [data-equipboost="boost:vest2"]').click();
  expect(await page.evaluate(() => __game.debug.save.get().equippedBoosts.vest)).toBe('boost:vest2');
});

// ====== Tranche 26 : onglet Accessoires (remplace l'onglet Skins) ======

test('accessoires : onglet boutique (sous-onglets) achete et equipe', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(3000); });
  await page.locator('#btn-shop').click();
  await page.locator('.shop-tab[data-tab="accessories"]').click();
  await expect(page.locator('#shop-info')).toContainText('Insectoïde');              // sous-onglet Masque par défaut
  await page.locator('#shop-info [data-buyacc="helm:insect"]').first().click();
  expect(await page.evaluate(() => __game.debug.save.get().ownedAccessories)).toContain('helm:insect');
  await page.locator('#shop-info [data-selacc="helm:insect"]').first().click();
  expect(await page.evaluate(() => __game.debug.save.get().equipped.helmet)).toBe('helm:insect');
  await page.locator('#shop-info [data-accslot="costume"]').click();                 // sous-onglet Costume
  await expect(page.locator('#shop-info')).toContainText('Carapace Insecte');
});

test('skins : systeme retire (plus aucune reference)', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  expect(await page.evaluate(() => typeof __game.debug.shop.skinCatalog)).toBe('undefined');
  expect(await page.evaluate(() => typeof __game.debug.playerSkin)).toBe('undefined');
  expect(await page.locator('[data-tab="skins"]').count()).toBe(0);
});

// ====== Tranche 24 : système de rareté (socle) ======

test('rarete : 4 paliers ordonnes (commun<rare<epique<legendaire)', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const r = await page.evaluate(() => __game.debug.shop.rarities());
  expect(r.map(x => x.id)).toEqual(['commun','rare','epique','legendaire']);
  expect(r.map(x => x.tier)).toEqual([0,1,2,3]);
  expect(r.map(x => x.name)).toEqual(['Commun','Rare','Épique','Légendaire']);
  expect(new Set(r.map(x => x.color)).size).toBe(4);   // couleurs distinctes
});

test('rarete : chaque item de catalogue a une rarete connue', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const data = await page.evaluate(() => ({
    keys: __game.debug.shop.rarities().map(x => x.id),
    w: __game.debug.shop.catalog(), c: __game.debug.shop.charCatalog(),
    h: __game.debug.shop.accessoryCatalog('helmet'), o: __game.debug.shop.accessoryCatalog('costume'),
  }));
  for (const list of [data.w, data.c, data.h, data.o])
    for (const it of list) expect(data.keys).toContain(it.rarity);
  expect(data.w.find(w => w.id === 'sniper').rarity).toBe('epique');
  expect(data.c.find(c => c.name === 'Cyborg').rarity).toBe('epique');
  expect(data.h.find(a => a.id === 'helm:skull-ram').rarity).toBe('legendaire');
});

test('rarete : le badge rend la couleur et le nom du palier', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const rare = await page.evaluate(() => __game.debug.shop.rarityBadge('rare'));
  expect(rare).toContain('#4f9dff'); expect(rare).toContain('Rare');
  const leg = await page.evaluate(() => __game.debug.shop.rarityBadge('legendaire'));
  expect(leg).toContain('#ffb02e'); expect(leg).toContain('Légendaire');
});

test('rarete : la boutique affiche la couleur de rarete (armes + perso)', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await page.locator('#btn-shop').click();
  await expect(page.locator('#shop-info')).toContainText('Viper-AR');       // #49 : arme renommée (Viper-AR = fusil d'assaut par défaut)
  let html = await page.evaluate(() => document.getElementById('shop-info').innerHTML);
  expect(html).toContain('#9aa3b2');                                        // default = commun
  await page.locator('.shop-tab[data-tab="player"]').click();
  await page.evaluate(() => __game.debug.shop.setChar('perso:robot'));      // carrousel centré sur Cyborg (#25)
  await expect(page.locator('#shop-info')).toContainText('Cyborg');
  html = await page.evaluate(() => document.getElementById('shop-info').innerHTML);
  expect(html).toMatch(/#9aa3b2|#4f9dff|#b066ff/);                          // un badge de rareté perso
});

// ====== Tranche 25 : personnages en vitrine 3D (carrousel) ======

test('carrousel perso : charCarousel donne centre + voisins, nav cyclique', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const cat = await page.evaluate(() => __game.debug.shop.charCatalog().map(c => c.id));
  await page.evaluate(() => __game.debug.shop.setChar(0));
  const c = await page.evaluate(() => __game.debug.shop.charCarousel());
  expect(c.center).toBe(cat[0]); expect(c.right).toBe(cat[1]); expect(c.left).toBe(cat[cat.length-1]);
  await page.evaluate(() => __game.debug.shop.nextChar());
  expect(await page.evaluate(() => __game.debug.shop.currentChar())).toBe(cat[1]);
  await page.evaluate(() => __game.debug.shop.prevChar());
  expect(await page.evaluate(() => __game.debug.shop.currentChar())).toBe(cat[0]);
});

test('vitrine perso : onglet Personnage montre 3 persos + fleches (carrousel)', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });   // mannequins (pas de GLB)
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await page.locator('#btn-shop').click();
  await page.locator('.shop-tab[data-tab="player"]').click();
  expect(await page.evaluate(() => __game.debug.shop.currentTab())).toBe('player');
  await expect(page.locator('#shop-prev')).toBeVisible();                         // flèches désormais visibles
  await page.waitForFunction(() => __game.debug.shopCharObjCount() === 3, null, { timeout:10000 });
});

test('vitrine perso : le perso central a une taille correcte, pas geant (vrai GLB)', async ({ page }) => {
  test.setTimeout(90000);                                                          // charge de vrais modèles (lourds)
  await page.goto('/game.html');                                                  // PAS de FAST → vrais GLB (teste l'échelle squelette)
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:30000 });
  await page.locator('#btn-shop').click();
  await page.locator('.shop-tab[data-tab="player"]').click();
  await page.waitForFunction(() => __game.debug.shopCharObjCount() === 3 && __game.debug.shopCharCenterSize() > 0, null, { timeout:60000 });
  const h = await page.evaluate(() => __game.debug.shopCharCenterSize());
  expect(h).toBeGreaterThan(1.2); expect(h).toBeLessThan(3.0);                     // ~1.8 m, pas géant
});

// ====== Tranche 39 : aperçu d'article extensible ======

test('apercu : kind resolu par champ (chaine de repli)', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const k = (o) => page.evaluate(x => __game.debug.itemPreviewKind(x), o);
  expect(await k({ assetDir:'artefact/x/' })).toBe('glb');
  expect(await k({ modelUrl:'x.glb' })).toBe('glb');
  expect(await k({ build:true })).toBe('build');
  expect(await k({ previewImg:'i.png' })).toBe('image');
  expect(await k({})).toBe('placeholder');
});

test('apercu : armes existantes ont la bonne source', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  expect(await page.evaluate(() => __game.debug.shopPreviewKind('default'))).toBe('glb');
  expect(await page.evaluate(() => __game.debug.shopPreviewKind('smg'))).toBe('build');
});

test('apercu : une image placeholder devient un plan image', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const img = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  expect(await page.evaluate(u => __game.debug.buildItemPreviewIsImage({ previewImg:u }), img)).toBe(true);
});

// ====== #49 — Armes avec catégories ======

test('#49 armes : catalogue contient au moins 12 armes', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const count = await page.evaluate(() => __game.debug.shop.catalog().length);
  expect(count).toBeGreaterThanOrEqual(12);
});

test('#49 armes : chaque arme a un id, nom, categorie, rarete', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const catalog = await page.evaluate(() => __game.debug.shop.catalog());
  for(const w of catalog){
    expect(w.id).toBeTruthy();
    expect(w.name).toBeTruthy();
    expect(typeof w.category).toBe('string');
    expect(['commun','rare','epique','legendaire']).toContain(w.rarity);
  }
});

test('#49 armes : plusieurs shotguns dans le catalogue', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const catalog = await page.evaluate(() => __game.debug.shop.catalog());
  const shotguns = catalog.filter(w => w.category === 'shotgun');
  expect(shotguns.length).toBeGreaterThanOrEqual(2);
});

test('#49 armes : plusieurs assault rifles dans le catalogue', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const catalog = await page.evaluate(() => __game.debug.shop.catalog());
  const assaults = catalog.filter(w => w.category === 'assault');
  expect(assaults.length).toBeGreaterThanOrEqual(2);
});

// ====== #53 — Boost toggle équiper/déséquiper ======

test('#53 boost : equipBoost toggle - equiper augmente les stats, re-cliquer les reduit', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  await page.evaluate(() => {
    __game.debug.save.reset();
    __game.debug.save.live().ownedBoosts.push('boost:vest1');
  });
  const healthBase = await page.evaluate(() => __game.debug.playerStats().maxHealth);
  await page.evaluate(() => __game.debug.shop.equipBoost('boost:vest1'));
  const healthWith = await page.evaluate(() => __game.debug.playerStats().maxHealth);
  expect(healthWith).toBeGreaterThan(healthBase);
  // Re-cliquer dé-équipe
  await page.evaluate(() => __game.debug.shop.equipBoost('boost:vest1'));
  const healthWithout = await page.evaluate(() => __game.debug.playerStats().maxHealth);
  expect(healthWithout).toBeLessThan(healthWith);
  expect(healthWithout).toBe(healthBase);
});

test('#53 boost : desequiper via unequipBoost retire le boost de la save', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  await page.evaluate(() => {
    __game.debug.save.reset();
    const s = __game.debug.save.live();
    s.ownedBoosts.push('boost:vest1');
    s.equippedBoosts.vest = 'boost:vest1';
  });
  await page.evaluate(() => __game.debug.unequipBoost('vest'));
  const saveBoost = await page.evaluate(() => __game.debug.save.live().equippedBoosts.vest);
  expect(saveBoost).toBeFalsy();
});

// ====== #53b — boosts déséquipables PAR PARTIE (run-based) ======

test('#53b boost run : unequipBoostRun desactive le bonus pour la partie, restart le restaure', async ({ page }) => {
  await startPlaying(page);
  // acheter + équiper le 1er boost du catalogue
  const bo = await page.evaluate(() => {
    const cat = __game.debug.shop.boostCatalog();
    const b = cat[0];
    __game.debug.save.addMoney(b.price + 1000);
    __game.debug.shop.buyBoost(b.id);
    __game.debug.shop.equipBoost(b.id);
    return b;
  });
  // équipé persistant + bonus présent
  const eq1 = await page.evaluate((slot) => __game.debug.equippedBoosts()[slot], bo.slot);
  expect(eq1).toBe(bo.id);
  const bonusBefore = await page.evaluate((stat) => __game.debug.boostBonuses()[stat], bo.stat);
  expect(bonusBefore).toBeGreaterThan(0);
  // désactiver pour la partie
  await page.evaluate((slot) => __game.debug.unequipBoostRun(slot), bo.slot);
  const disabled = await page.evaluate((slot) => __game.debug.isBoostRunDisabled(slot), bo.slot);
  expect(disabled).toBe(true);
  const bonusRun = await page.evaluate((stat) => __game.debug.boostBonuses()[stat], bo.stat);
  expect(bonusRun).toBeLessThan(bonusBefore);   // bonus retiré pour la partie
  // mais l'équipement persistant est INTACT
  const eq2 = await page.evaluate((slot) => __game.debug.equippedBoosts()[slot], bo.slot);
  expect(eq2).toBe(bo.id);
  // restart → override remis à zéro, bonus restauré
  await page.evaluate(() => __game.debug.restart());
  await page.waitForTimeout(100);
  const disabledAfter = await page.evaluate((slot) => __game.debug.isBoostRunDisabled(slot), bo.slot);
  expect(disabledAfter).toBe(false);
  const bonusAfter = await page.evaluate((stat) => __game.debug.boostBonuses()[stat], bo.stat);
  expect(bonusAfter).toBe(bonusBefore);
});

// ====== Tranche #207 : refonte boutique (armes/perso/accessoires façon maquettes) ======

test('#207 armes : hero (desc) + carrousel de cartes + glow de rareté', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.backToHome());
  await page.evaluate(() => { __game.debug.shop.open(); __game.debug.shop.tab('weapons'); });
  // layout par onglet : #shop-info porte la classe tab-weapons
  expect(await page.evaluate(() => document.getElementById('shop-info').classList.contains('tab-weapons'))).toBe(true);
  // le carrousel a une carte par arme de la catégorie "Tout"
  const nWeapons = await page.evaluate(() => __game.debug.shop.catalog().length);
  const nCards = await page.evaluate(() => document.querySelectorAll('#shop-info .shop-carousel .wcard').length);
  expect(nCards).toBe(nWeapons);
  // description de l'arme héro (Viper-AR par défaut)
  await expect(page.locator('#shop-info .shop-hero .shop-desc')).toContainText("Fusil d'assaut");
  // lueur de rareté présente, teintée par la couleur de rareté (--rc)
  expect(await page.evaluate(() => document.querySelectorAll('#shop-info .shop-glow').length)).toBe(1);
  expect(await page.evaluate(() => document.querySelector('#shop-info .shop-glow').style.getPropertyValue('--rc'))).toBeTruthy();
});

test('#207 armes : cliquer une carte du carrousel change l arme héro', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.backToHome());
  await page.evaluate(() => { __game.debug.shop.open(); __game.debug.shop.tab('weapons'); });
  await page.locator('#shop-info .shop-carousel .wcard[data-wcard="sniper"]').click();
  await expect(page.locator('#shop-info .shop-hero .shop-wname')).toContainText('Eclipse');
  expect(await page.evaluate(() => __game.debug.shop.previewWeapon())).toBe('sniper');
});

test('accessoires : la tuile masque affiche l image PNG + bouton acheter/équiper sous le perso (pas de panneau détail)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.backToHome());
  await page.evaluate(() => { __game.debug.shop.open(); __game.debug.shop.tab('accessories'); });
  expect(await page.evaluate(() => document.getElementById('shop-info').classList.contains('tab-acc'))).toBe(true);
  // la tuile "Insectoïde" affiche l'image réelle (mask/insect-viber)
  const src = await page.evaluate(() => {
    const card = document.querySelector('#shop-info .shop-acc-list [data-prevacc="helm:insect"] img.thumb-img');
    return card ? card.getAttribute('src') : null;
  });
  expect(src).toContain('insect-viber');
  // retour Nathan (4e) : plus de panneau détail (nom/desc/bonus) — juste Acheter/Équiper sous le perso
  expect(await page.evaluate(() => document.querySelector('#shop-info .shop-acc-detail'))).toBeNull();
  await expect(page.locator('#shop-info .acc-buy-bar')).toBeVisible();
});

test('perso : hero desc + stats centrées (compétences retirées, retour Nathan)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.backToHome());
  await page.evaluate(() => { __game.debug.shop.open(); __game.debug.shop.tab('player'); });
  expect(await page.evaluate(() => document.getElementById('shop-info').classList.contains('tab-player'))).toBe(true);
  await expect(page.locator('#shop-info .shop-hero .shop-desc')).not.toBeEmpty();
  expect(await page.evaluate(() => document.querySelector('#shop-info .shop-skills'))).toBeNull();
  expect(await page.evaluate(() => document.querySelectorAll('#shop-info .shop-stats-panel.char .statbar').length)).toBe(3);
});
