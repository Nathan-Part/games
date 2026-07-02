import { test, expect } from '@playwright/test';
import { trackErrors, startPlaying, faceEnemyForMelee, alignTwoEnemies, meleeKillWhenReady } from './helpers.js';

test('save : l argent persiste au rechargement (round-trip localStorage)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(100); });
  await page.reload();
  await page.waitForFunction(() => window.__game?.booted);
  expect(await page.evaluate(() => __game.money)).toBe(100);
});

test('save : tuer un ennemi rapporte de l argent (par kill)', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  const rates = await page.evaluate(() => __game.debug.save.rates());
  // 1er kill hors mesure : consomme le bonus premier sang de la vague (#161) ; précision 0 → pas de dégât reçu (revanche #187)
  await page.evaluate(() => { __game.debug.setEnemyAccuracy(0); __game.debug.moveEnemy(0, 0, 5); __game.debug.damageEnemy(0, 1000); });
  await page.waitForTimeout(1100);   // #187 : laisse passer la fenêtre revanche (kill <1s après un dégât)
  const before = await page.evaluate(() => __game.money);
  // 2e kill isolé : dégâts exacts (pas d'overkill #139), courte portée (pas de long shot #102), combo encore x1
  await page.evaluate(() => { __game.debug.moveEnemy(1, 2, 5); __game.debug.damageEnemy(1, __game.debug.enemyHp(1)); });
  const after = await page.evaluate(() => __game.money);
  expect(after - before).toBe(rates.perKill);
});

test('save : nettoyer une vague rapporte un bonus (par vague)', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  const rates = await page.evaluate(() => __game.debug.save.rates());
  // neutralise les bonus de fin de vague pour isoler le bonus par-vague :
  await page.evaluate(() => { __game.debug.setShield(0); __game.debug.damagePlayer(1); }); // pas de survie parfaite (#100) ni vague parfaite (#165)
  await page.evaluate(() => __game.debug.ageWaveStart(20));                                 // pas de vague éclair (#149)
  await page.evaluate(() => { __game.debug.setPitch(1.4); __game.debug.tryFire(); __game.debug.reload(); __game.debug.dash(); }); // 1 tir raté (pas de précision totale #184) + recharge (pas de #166) + dash (pas de #182)
  // 1er kill hors mesure : consomme le bonus premier sang (#161)
  await page.evaluate(() => { __game.debug.setEnemyAccuracy(0); __game.debug.moveEnemy(0, 0, 5); __game.debug.damageEnemy(0, __game.debug.enemyHp(0)); });
  await page.waitForTimeout(1100);   // #187 : revanche = kill <1s après un dégât reçu → on laisse passer la fenêtre
  const before = await page.evaluate(() => __game.money);
  await page.evaluate(() => { __game.debug.moveEnemy(1, 0, 5); __game.debug.moveEnemy(2, 2, 5); __game.debug.killAllEnemies(); }); // 2 kills restants (combo x1, x2), courte portée
  const after = await page.evaluate(() => __game.money);
  // (1+2)×perKill (combo #29) + bonus de vague + ÉCONOME #190 (vague nettoyée sans grenade, +25 stable)
  expect(after - before).toBe((1 + 2) * rates.perKill + rates.perWave * 1 + 25);
});

test('save : une sauvegarde corrompue retombe sur les valeurs par defaut', async ({ page }) => {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.booted);
  await page.evaluate(() => localStorage.setItem('cod-save-v1', '{pas du json'));
  await page.reload();
  await page.waitForFunction(() => window.__game?.booted);
  expect(await page.evaluate(() => __game.money)).toBe(0);
  expect(await page.evaluate(() => __game.debug.save.get().bestWave)).toBe(0);
});

test('save : le HUD affiche l argent en jeu', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(250); });
  await expect(page.locator('#money-hud')).toBeVisible();
  await expect(page.locator('#money-hud')).toContainText('250');
});

test('save : le record (meilleure vague) persiste au rechargement', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await page.evaluate(() => __game.debug.forceNextWave());     // atteint la vague 2
  expect(await page.evaluate(() => __game.bestWave)).toBe(2);
  await page.reload();
  await page.waitForFunction(() => window.__game?.booted);
  expect(await page.evaluate(() => __game.debug.save.get().bestWave)).toBe(2);
  expect(await page.evaluate(() => __game.bestWave)).toBe(2);  // record rechargé depuis la save
});

test('save : le perso choisi est memorise (persiste au rechargement)', async ({ page }) => {
  await page.addInitScript(() => { if(!localStorage.getItem('cod-save-v1')) localStorage.setItem('cod-save-v1', JSON.stringify({ ownedCharacters:['perso:blue-soldier','perso:guard','perso:robot'] })); });  // 3 persos possédés (slider)
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.characters?.length >= 2 && window.__game.phase === 'lobby', null, { timeout:20000 });
  const name0 = (await page.locator('#char-name').textContent()).trim();
  await page.locator('#next').click();
  await expect.poll(async () => (await page.locator('#char-name').textContent()).trim()).not.toBe(name0);
  const chosen = (await page.locator('#char-name').textContent()).trim();
  await page.reload();
  await page.waitForFunction(() => window.__game?.characters?.length >= 2 && window.__game.phase === 'lobby', null, { timeout:20000 });
  await expect.poll(async () => (await page.locator('#char-name').textContent()).trim()).toBe(chosen);  // rouvre sur le perso choisi
});

// ====== Tranche 43 : stats de partie ======

test('stats partie : kills/headshots comptes et affiches au Game Over', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.runStats().kills)).toBe(0);
  await page.evaluate(() => { __game.debug.save.addMoney(2000); __game.debug.shop.buy('sniper'); __game.debug.shop.equip('sniper'); });
  await page.evaluate(() => { __game.debug.setView('first'); __game.debug.setPitch(0); });
  await page.waitForTimeout(150);
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8));
  await page.evaluate(() => __game.debug.tryFire());
  expect(await page.evaluate(() => __game.debug.runStats().kills)).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => __game.debug.runStats().headshots)).toBeGreaterThanOrEqual(1);
  await page.evaluate(() => { __game.debug.setShield(0); __game.debug.damagePlayer(9999); }); // 1er coup fatal → dernier souffle (#137)
  await page.waitForTimeout(2200);                                                            // invincibilité post-dernier-souffle (2 s)
  await page.evaluate(() => { __game.debug.setShield(0); __game.debug.damagePlayer(9999); }); // mort réelle
  await expect(page.locator('#go-score')).toContainText('Kills');
});

test('stats partie : reset au restart', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnEnemyAt(0,3); __game.debug.damageEnemy(0,99999); });
  expect(await page.evaluate(() => __game.debug.runStats().kills)).toBeGreaterThan(0);
  await page.evaluate(() => __game.debug.restart());
  expect(await page.evaluate(() => __game.debug.runStats().kills)).toBe(0);
});

// ====== Tranche 44 : succès ======

test('succes : premier sang + survivant', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('firstblood'))).toBe(false);
  await page.evaluate(() => { __game.debug.spawnEnemyAt(0,3); __game.debug.damageEnemy(0,99999); });
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('firstblood'))).toBe(true);
  await page.evaluate(() => __game.debug.forceWave(5));
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('survivor5'))).toBe(true);
});

test('succes : persistent apres reload', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnEnemyAt(0,3); __game.debug.damageEnemy(0,99999); });
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('firstblood'))).toBe(true);
  await page.reload(); await page.waitForFunction(() => window.__game?.booted);
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('firstblood'))).toBe(true);
});

// ====== #55 — Challenges ======

test('#55 challenges : HUD présent dans le DOM', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  expect(await page.locator('#challenges-hud').count()).toBe(1);
});

test('#55 challenges : 3 challenges créés au start', async ({ page }) => {
  await startPlaying(page);
  const count = await page.evaluate(() => __game.debug.challengeCount());
  expect(count).toBe(3);
});

test('#55 challenges : forceCompleteChallenge credite l argent', async ({ page }) => {
  await startPlaying(page);
  const moneyBefore = await page.evaluate(() => __game.money);
  const reward = await page.evaluate(() => __game.debug.challengeReward(0));
  await page.evaluate(() => __game.debug.forceCompleteChallenge(0));
  const moneyAfter = await page.evaluate(() => __game.money);
  expect(moneyAfter).toBe(moneyBefore + reward);
});

test('#55 challenges : challenge marque done apres forceComplete', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forceCompleteChallenge(0));
  const done = await page.evaluate(() => __game.debug.challengeDone(0));
  expect(done).toBe(true);
});

test('#55 challenges : reset au restart => 3 nouveaux challenges', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.restart());
  await page.waitForFunction(() => window.__game.phase === 'playing', null, {timeout:20000});
  const count = await page.evaluate(() => __game.debug.challengeCount());
  expect(count).toBe(3);
});

test('#55 challenges : HUD visible en playing', async ({ page }) => {
  await startPlaying(page);
  await expect(page.locator('#challenges-hud')).toBeVisible();
});

// ====== #60 — XP + niveaux ======

test('#60 xp : niveau initial = 1', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  const lv = await page.evaluate(() => __game.debug.playerLevel());
  expect(lv).toBe(1);
});

test('#60 xp : addXp augmente le total', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => __game.debug.addXp(200));
  const xp = await page.evaluate(() => __game.debug.xpTotal());
  expect(xp).toBeGreaterThanOrEqual(200);
});

test('#60 xp : suffisamment d xp = niveau 2', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => __game.debug.addXp(100)); // 100 XP = level 2
  const lv = await page.evaluate(() => __game.debug.playerLevel());
  expect(lv).toBeGreaterThanOrEqual(2);
});

test('#60 xp : playerTitle retourne une chaine', async ({ page }) => {
  await startPlaying(page);
  const t = await page.evaluate(() => __game.debug.playerTitle());
  expect(typeof t).toBe('string');
  expect(t.length).toBeGreaterThan(0);
});

test('#60 xp : kill en jeu donne de l xp', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  const before = await page.evaluate(() => __game.debug.xpTotal());
  await page.evaluate(() => __game.debug.spawnEnemyInFront());
  await page.evaluate(() => __game.debug.damageEnemy(0, 9999));
  const after = await page.evaluate(() => __game.debug.xpTotal());
  expect(after).toBeGreaterThan(before);
});

// ====== #62 — Contrats quotidiens ======

test('#62 daily : dailyContracts retourne 3 contrats', async ({ page }) => {
  await startPlaying(page);
  const contracts = await page.evaluate(() => __game.debug.dailyContracts());
  expect(contracts).toHaveLength(3);
});

test('#62 daily : chaque contrat a id, desc, target, reward, progress, done', async ({ page }) => {
  await startPlaying(page);
  const c = await page.evaluate(() => __game.debug.dailyContracts()[0]);
  expect(typeof c.id).toBe('string');
  expect(typeof c.desc).toBe('string');
  expect(c.target).toBeGreaterThan(0);
  expect(c.reward).toBeGreaterThan(0);
  expect(typeof c.progress).toBe('number');
  expect(typeof c.done).toBe('boolean');
});

test('#62 daily : forceDailyComplete complete un contrat', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forceDailyComplete(0));
  const done = await page.evaluate(() => __game.debug.dailyContracts()[0].done);
  expect(done).toBe(true);
});

test('#62 daily : forceDailyComplete donne de l argent', async ({ page }) => {
  await startPlaying(page);
  const before = await page.evaluate(() => __game.money);
  await page.evaluate(() => __game.debug.forceDailyComplete(0));
  const after = await page.evaluate(() => __game.money);
  expect(after).toBeGreaterThan(before);
});

// ====== #68 — Toast level-up ======

test('#68 lvlup : showLevelUpToast debug disponible', async ({ page }) => {
  await startPlaying(page);
  const ok = await page.evaluate(() => typeof __game.debug.showLevelUpToast === 'function');
  expect(ok).toBe(true);
});

test('#68 lvlup : toast visible apres showLevelUpToast', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.showLevelUpToast(5));
  const vis = await page.evaluate(() => document.getElementById('levelup-toast').classList.contains('lu-show'));
  expect(vis).toBe(true);
});

test('#68 lvlup : toast contient le numero de niveau', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.showLevelUpToast(12));
  const txt = await page.evaluate(() => document.getElementById('levelup-toast').textContent);
  expect(txt).toContain('12');
});

test('#68 lvlup : addXp suffisant declenche le toast', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => __game.debug.addXp(200)); // assez pour monter au niveau 2
  const vis = await page.evaluate(() => document.getElementById('levelup-toast').classList.contains('lu-show'));
  expect(vis).toBe(true);
});

// ====== #79 — Orbes d'argent ======

test('#79 moneyorb : moneyOrbCount initial = 0', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.moneyOrbCount())).toBe(0);
});

test('#79 moneyorb : spawnMoneyOrb cree un orbe', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnMoneyOrb(5, 5, 50));
  expect(await page.evaluate(() => __game.debug.moneyOrbCount())).toBe(1);
});

test('#79 moneyorb : orbe collecte quand joueur proche', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setPos(0, 0); __game.debug.spawnMoneyOrb(0, 0, 50); });
  // attendre un frame de collecte
  await page.waitForFunction(() => __game.debug.moneyOrbCount() === 0, null, { timeout: 5000 });
  expect(await page.evaluate(() => __game.debug.moneyOrbCount())).toBe(0);
});

// ====== #80 — Stats globales persistantes ======

test('#80 lifestats : lifetimeStats() retourne un objet', async ({ page }) => {
  await startPlaying(page);
  const s = await page.evaluate(() => __game.debug.lifetimeStats());
  expect(typeof s).toBe('object');
  expect(typeof s.kills).toBe('number');
});

test('#80 lifestats : addLifetimeStat incremente kills', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.addLifetimeStat('kills', 5); });
  expect(await page.evaluate(() => __game.debug.lifetimeStats().kills)).toBe(5);
});

test('#80 lifestats : kill ennemi incremente kills global', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => { __game.debug.spawnEnemyAt(0, 3); __game.debug.damageEnemy(0, 9999); });
  expect(await page.evaluate(() => __game.debug.lifetimeStats().kills)).toBeGreaterThan(0);
});

// ====== #90 — Rang de fin de partie ======

test('#90 rang : runRank() retourne une lettre valide', async ({ page }) => {
  await startPlaying(page);
  const rank = await page.evaluate(() => __game.debug.runRank());
  expect(['S','A','B','C','D']).toContain(rank);
});

test('#90 rang : rankScore() retourne un nombre >= 0', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.rankScore())).toBeGreaterThanOrEqual(0);
});

test('#90 rang : rang S avec 20 kills, precision 90%, vague 5', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => {
    for(let i=0;i<20;i++) __game.debug.addLifetimeStat('kills',0); // dummy
    window.__testKills=20; window.__testAcc=0.9; window.__testWave=5;
    __game.debug.setRunStatsOverride(20, 0.9, 5);
  });
  const rank = await page.evaluate(() => __game.debug.runRank());
  expect(rank).toBe('S');
});

// ====== #157 — Classement local (leaderboard) ======

test('#157 : leaderboard() est vide sur une save neuve', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.leaderboard())).toEqual([]);
});

test('#157 : submitScore insere une entree, triee par score decroissant', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => __game.debug.submitScore({score:100, wave:2, kills:5, headshots:1, accuracy:50}));
  await page.evaluate(() => __game.debug.submitScore({score:300, wave:4, kills:10, headshots:3, accuracy:60}));
  const lb = await page.evaluate(() => __game.debug.leaderboard());
  expect(lb.length).toBe(2);
  expect(lb[0].score).toBe(300);
  expect(lb[1].score).toBe(100);
});

test('#157 : seules les 5 meilleures entrees sont conservees', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  for (const s of [50, 200, 10, 400, 300, 150]) {
    await page.evaluate((sc) => __game.debug.submitScore({score:sc, wave:1, kills:0, headshots:0, accuracy:0}), s);
  }
  const lb = await page.evaluate(() => __game.debug.leaderboard());
  expect(lb.length).toBe(5);
  expect(lb.map(e => e.score)).toEqual([400, 300, 200, 150, 50]);
});

test('#157 : une entree plus faible que le top 5 plein n est pas ajoutee et retourne -1', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  for (const s of [500, 400, 300, 200, 100]) {
    await page.evaluate((sc) => __game.debug.submitScore({score:sc, wave:1, kills:0, headshots:0, accuracy:0}), s);
  }
  const rank = await page.evaluate(() => __game.debug.submitScore({score:50, wave:1, kills:0, headshots:0, accuracy:0}));
  expect(rank).toBe(-1);
  expect(await page.evaluate(() => __game.debug.leaderboard().length)).toBe(5);
});

test('#157 : clearLeaderboard vide le tableau et persiste', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.submitScore({score:100, wave:1, kills:0, headshots:0, accuracy:0}));
  await page.evaluate(() => __game.debug.clearLeaderboard());
  expect(await page.evaluate(() => __game.debug.leaderboard())).toEqual([]);
  expect(await page.evaluate(() => __game.debug.save.get().leaderboard)).toEqual([]);
});

test('#157 : mourir soumet automatiquement une entree au classement', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => __game.debug.damagePlayer(9999)); // 1er hit = dernier souffle (#137)
  await page.waitForTimeout(2200); // laisse expirer l'invulnerabilite post-dernier-souffle
  await page.evaluate(() => __game.debug.damagePlayer(9999)); // 2e hit = mort reelle
  await page.waitForFunction(() => window.__game.phase === 'dead');
  const lb = await page.evaluate(() => __game.debug.leaderboard());
  expect(lb.length).toBe(1);
  expect(lb[0].wave).toBeGreaterThanOrEqual(1);
});

test('#157 : le panneau Game Over affiche le classement', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.damagePlayer(9999));
  await page.waitForTimeout(2200);
  await page.evaluate(() => __game.debug.damagePlayer(9999));
  await page.waitForFunction(() => window.__game.phase === 'dead');
  const html = await page.evaluate(() => document.getElementById('go-score').innerHTML);
  expect(html).toContain('go-leaderboard');
});

test('#157 : l accueil affiche le meilleur score du classement', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.submitScore({score:777, wave:3, kills:1, headshots:0, accuracy:10}); __game.debug.backToHome(); });
  await page.waitForFunction(() => window.__game.phase === 'lobby');
  const text = await page.evaluate(() => document.getElementById('intel-bestscore')?.textContent);
  expect(text).toBe('777');
});

// ====== #159 — Prestige ======

test('#159 : prestigeLevel demarre a 0, canPrestige faux sous le niveau 50', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.prestigeLevel())).toBe(0);
  await page.evaluate(() => __game.debug.addXp(500));
  expect(await page.evaluate(() => __game.debug.canPrestige())).toBe(false);
});

test('#159 : canPrestige devient vrai au niveau 50', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => __game.debug.addXp(1000000));
  expect(await page.evaluate(() => __game.debug.playerLevel())).toBe(50);
  expect(await page.evaluate(() => __game.debug.canPrestige())).toBe(true);
});

test('#159 : doPrestige au niveau 50 reussit et remet le niveau a 1', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => __game.debug.addXp(1000000));
  const ok = await page.evaluate(() => __game.debug.doPrestige());
  expect(ok).toBe(true);
  expect(await page.evaluate(() => __game.debug.prestigeLevel())).toBe(1);
  expect(await page.evaluate(() => __game.debug.playerLevel())).toBe(1);
});

test('#159 : doPrestige sous le niveau 50 echoue et ne change rien', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => __game.debug.addXp(100));
  const ok = await page.evaluate(() => __game.debug.doPrestige());
  expect(ok).toBe(false);
  expect(await page.evaluate(() => __game.debug.prestigeLevel())).toBe(0);
});

test('#159 : doPrestige ne touche pas argent/armes possedees', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(500); });
  await page.evaluate(() => __game.debug.addXp(1000000));
  await page.evaluate(() => __game.debug.doPrestige());
  const s = await page.evaluate(() => __game.debug.save.get());
  expect(s.money).toBeGreaterThanOrEqual(500);
  expect(s.ownedWeapons).toContain('default');
});

test('#159 : deux prestiges successifs cumulent le compteur', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => __game.debug.addXp(1000000));
  await page.evaluate(() => __game.debug.doPrestige());
  await page.evaluate(() => __game.debug.addXp(1000000));
  await page.evaluate(() => __game.debug.doPrestige());
  expect(await page.evaluate(() => __game.debug.prestigeLevel())).toBe(2);
});

test('#159 : le titre XP affiche les etoiles de prestige', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => { __game.debug.addXp(1000000); __game.debug.doPrestige(); });
  const label = await page.evaluate(() => document.getElementById('xp-label').textContent);
  expect(label).toContain('★');
});

test('#159 : le bouton prestige n apparait qu au niveau 50', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => document.getElementById('prestige-btn').classList.contains('hidden'))).toBe(true);
  await page.evaluate(() => __game.debug.addXp(1000000));
  expect(await page.evaluate(() => document.getElementById('prestige-btn').classList.contains('hidden'))).toBe(false);
});

test('#159 : l accueil affiche le compteur de prestige', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.addXp(1000000); __game.debug.doPrestige(); __game.debug.backToHome(); });
  await page.waitForFunction(() => window.__game.phase === 'lobby');
  const text = await page.evaluate(() => document.getElementById('intel-prestige').textContent);
  expect(text).toBe('★1');
});

// ====== #162 — Meilleur coup ======

test('#162 : runBestHit demarre a 0', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.runBestHit())).toBe(0);
});

test('#162 : runBestHit suit le plus gros coup, ne redescend pas', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'tank', 4, 4));
  await page.evaluate(() => __game.debug.damageEnemy(0, 50));
  expect(await page.evaluate(() => __game.debug.runBestHit())).toBe(50);
  await page.evaluate(() => __game.debug.damageEnemy(0, 20));
  expect(await page.evaluate(() => __game.debug.runBestHit())).toBe(50);
});

test('#162 : restart remet runBestHit a 0', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'tank', 4, 4));
  await page.evaluate(() => __game.debug.damageEnemy(0, 50));
  expect(await page.evaluate(() => __game.debug.runBestHit())).toBe(50);
  await page.evaluate(() => __game.debug.restart());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.runBestHit())).toBe(0);
});

// ====== #163 — Distance parcourue ======

test('#163 : runDistance demarre a 0', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.runDistance())).toBe(0);
});

test('#163 : avancer augmente runDistance', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setInput({forward:true}));
  await page.waitForTimeout(600);
  await page.evaluate(() => __game.debug.setInput({}));
  expect(await page.evaluate(() => __game.debug.runDistance())).toBeGreaterThan(0.3);
});

test('#163 : restart remet runDistance a 0', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setInput({forward:true}));
  await page.waitForTimeout(600);
  await page.evaluate(() => __game.debug.setInput({}));
  expect(await page.evaluate(() => __game.debug.runDistance())).toBeGreaterThan(0.3);
  await page.evaluate(() => __game.debug.restart());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.runDistance())).toBe(0);
});

// ====== #164 — Meilleure serie ======

test('#164 : runBestStreak demarre a 0', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.runBestStreak())).toBe(0);
});

test('#164 : une serie de kills porte le record, un hit recu ne le fait pas redescendre', async ({ page }) => {
  await startPlaying(page);
  for (let i = 0; i < 3; i++) {
    await page.evaluate((i) => __game.debug.spawnEnemyTypeAt(i, 'shooter', 4, 4+i), i);
    await page.evaluate((i) => __game.debug.damageEnemy(i, 99999), i);
  }
  expect(await page.evaluate(() => __game.debug.streakKills())).toBe(3);
  expect(await page.evaluate(() => __game.debug.runBestStreak())).toBe(3);
  await page.evaluate(() => { __game.debug.setShield(0); __game.debug.damagePlayer(5); }); // reset de la serie courante
  expect(await page.evaluate(() => __game.debug.streakKills())).toBe(0);
  expect(await page.evaluate(() => __game.debug.runBestStreak())).toBe(3); // le record est conserve
});

test('#164 : restart remet runBestStreak a 0', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 4, 4));
  await page.evaluate(() => __game.debug.damageEnemy(0, 99999));
  expect(await page.evaluate(() => __game.debug.runBestStreak())).toBe(1);
  await page.evaluate(() => __game.debug.restart());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.runBestStreak())).toBe(0);
});

// ====== #169 — Nouveaux succes ======

test('#169 : achievements() inclut les 3 nouveaux ids', async ({ page }) => {
  await startPlaying(page);
  const ids = await page.evaluate(() => __game.debug.achievements().map(a => a.id));
  expect(ids).toContain('wave10');
  expect(ids).toContain('richesse');
  expect(ids).toContain('legende');
});

test('#169 : atteindre la vague 10 debloque wave10', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('wave10'))).toBe(false);
  await page.evaluate(() => __game.debug.forceWave(10));
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('wave10'))).toBe(true);
});

test('#169 : posseder 5000$ debloque richesse', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('richesse'))).toBe(false);
  await page.evaluate(() => { __game.debug.save.addMoney(5000); __game.debug.spawnEnemyTypeAt(0,'shooter',4,4); __game.debug.damageEnemy(0, 99999); });
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('richesse'))).toBe(true);
});

test('#169 : atteindre le niveau 50 debloque legende', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('legende'))).toBe(false);
  await page.evaluate(() => { __game.debug.addXp(1000000); __game.debug.spawnEnemyTypeAt(0,'shooter',4,4); __game.debug.damageEnemy(0, 99999); });
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('legende'))).toBe(true);
});

// ====== #170 — Date sur le classement local ======

test('#170 : chaque ligne du classement affiche une date JJ/MM', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.damagePlayer(9999));
  await page.waitForTimeout(2200);
  await page.evaluate(() => __game.debug.damagePlayer(9999));
  await page.waitForFunction(() => window.__game.phase === 'dead');
  const html = await page.evaluate(() => document.getElementById('go-score').innerHTML);
  expect(html).toMatch(/go-lb-date">\d{2}\/\d{2}</);
});

// ====== #173 — Meilleure vague ======

test('#173 : waveKillCount et runBestWaveKills demarrent a 0', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.waveKillCount())).toBe(0);
  expect(await page.evaluate(() => __game.debug.runBestWaveKills())).toBe(0);
});

test('#173 : 3 kills dans la meme vague portent les deux compteurs a 3', async ({ page }) => {
  await startPlaying(page);
  for (let i = 0; i < 3; i++) {
    await page.evaluate((i) => __game.debug.spawnEnemyTypeAt(i, 'shooter', 4, 4+i), i);
    await page.evaluate((i) => __game.debug.damageEnemy(i, 99999), i);
  }
  expect(await page.evaluate(() => __game.debug.waveKillCount())).toBe(3);
  expect(await page.evaluate(() => __game.debug.runBestWaveKills())).toBe(3);
});

test('#173 : une nouvelle vague avec moins de kills garde le record mais reset le compteur courant', async ({ page }) => {
  await startPlaying(page);
  for (let i = 0; i < 3; i++) {
    await page.evaluate((i) => __game.debug.spawnEnemyTypeAt(i, 'shooter', 4, 4+i), i);
    await page.evaluate((i) => __game.debug.damageEnemy(i, 99999), i);
  }
  await page.evaluate(() => __game.debug.forceNextWave());
  expect(await page.evaluate(() => __game.debug.waveKillCount())).toBe(0);
  expect(await page.evaluate(() => __game.debug.runBestWaveKills())).toBe(3);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 4, 4));
  await page.evaluate(() => __game.debug.damageEnemy(0, 99999));
  expect(await page.evaluate(() => __game.debug.waveKillCount())).toBe(1);
  expect(await page.evaluate(() => __game.debug.runBestWaveKills())).toBe(3);
});

// ====== #174 — Vague la plus rapide ======

test('#174 : runFastestWave demarre a null', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.runFastestWave())).toBeNull();
});

test('#174 : nettoyer une vague renseigne un temps positif', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(50);
  const t = await page.evaluate(() => __game.debug.runFastestWave());
  expect(t).toBeGreaterThanOrEqual(0);
});

test('#174 : une vague plus lente ne remonte pas le record', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.ageWaveStart(20)); // vague 1 "vieille" de 20s -> temps de clear ~20s
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(50);
  const t1 = await page.evaluate(() => __game.debug.runFastestWave());
  expect(t1).toBeGreaterThanOrEqual(19);
  await page.evaluate(() => __game.debug.forceNextWave());
  await page.evaluate(() => __game.debug.ageWaveStart(30)); // vague 2 plus lente (30s)
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(50);
  const t2 = await page.evaluate(() => __game.debug.runFastestWave());
  expect(t2).toBeCloseTo(t1, 0);
});

// ====== #175 — Succes Collectionneur ======

test('#175 : achievements() inclut collectionneur', async ({ page }) => {
  await startPlaying(page);
  const ids = await page.evaluate(() => __game.debug.achievements().map(a => a.id));
  expect(ids).toContain('collectionneur');
});

test('#175 : posseder 10 armes debloque collectionneur', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('collectionneur'))).toBe(false);
  await page.evaluate(() => {
    const s = __game.debug.save.live();
    s.ownedWeapons = ['w1','w2','w3','w4','w5','w6','w7','w8','w9','w10'];
    __game.debug.spawnEnemyTypeAt(0,'shooter',4,4); __game.debug.damageEnemy(0, 99999);
  });
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('collectionneur'))).toBe(true);
});

// ====== #177 — Succes Perfectionniste ======

test('#177 : achievements() inclut perfectionniste', async ({ page }) => {
  await startPlaying(page);
  const ids = await page.evaluate(() => __game.debug.achievements().map(a => a.id));
  expect(ids).toContain('perfectionniste');
});

test('#177 : lifetimeStats().perfectWaves s incremente a chaque vague parfaite', async ({ page }) => {
  await startPlaying(page);
  const before = await page.evaluate(() => __game.debug.lifetimeStats().perfectWaves || 0);
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(50);
  const after = await page.evaluate(() => __game.debug.lifetimeStats().perfectWaves || 0);
  expect(after).toBe(before + 1);
});

test('#177 : 5 vagues parfaites cumulees debloquent perfectionniste', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('perfectionniste'))).toBe(false);
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => __game.debug.killAllEnemies());
    await page.waitForTimeout(50);
    await page.evaluate(() => __game.debug.forceNextWave());
    await page.waitForTimeout(50);
  }
  expect(await page.evaluate(() => __game.debug.lifetimeStats().perfectWaves)).toBeGreaterThanOrEqual(5);
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('perfectionniste'))).toBe(true);
});

// ====== #180 — Succes Millionnaire + Increvable ======

test('#180 : achievements() inclut millionnaire et increvable', async ({ page }) => {
  await startPlaying(page);
  const ids = await page.evaluate(() => __game.debug.achievements().map(a => a.id));
  expect(ids).toContain('millionnaire');
  expect(ids).toContain('increvable');
});

test('#180 : posseder 10000$ debloque millionnaire', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('millionnaire'))).toBe(false);
  await page.evaluate(() => { __game.debug.save.addMoney(10000); __game.debug.spawnEnemyTypeAt(0,'shooter',4,4); __game.debug.damageEnemy(0, 99999); });
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('millionnaire'))).toBe(true);
});

test('#180 : atteindre la vague 20 debloque increvable', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('increvable'))).toBe(false);
  await page.evaluate(() => __game.debug.forceWave(20));
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('increvable'))).toBe(true);
});

// ====== #183 — Succes Bourreau + Sniper d'elite ======

test('#183 : achievements() inclut bourreau et sniper_elite', async ({ page }) => {
  await startPlaying(page);
  const ids = await page.evaluate(() => __game.debug.achievements().map(a => a.id));
  expect(ids).toContain('bourreau');
  expect(ids).toContain('sniper_elite');
});

test('#183 : 500 kills cumules debloquent bourreau', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('bourreau'))).toBe(false);
  await page.evaluate(() => {
    __game.debug.addLifetimeStat('kills', 500);
    __game.debug.spawnEnemyTypeAt(0,'shooter',4,4); __game.debug.damageEnemy(0, 99999);
  });
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('bourreau'))).toBe(true);
});

test('#183 : 100 headshots cumules debloquent sniper_elite', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('sniper_elite'))).toBe(false);
  await page.evaluate(() => {
    __game.debug.addLifetimeStat('headshots', 100);
    __game.debug.spawnEnemyTypeAt(0,'shooter',4,4); __game.debug.damageEnemy(0, 99999);
  });
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('sniper_elite'))).toBe(true);
});

// ====== #185 — Succes Marathonien ======

test('#185 : achievements() inclut marathonien', async ({ page }) => {
  await startPlaying(page);
  const ids = await page.evaluate(() => __game.debug.achievements().map(a => a.id));
  expect(ids).toContain('marathonien');
});

test('#185 : mourir avec de la distance parcourue incremente lifetimeStats().distance', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setInput({forward:true}));
  await page.waitForTimeout(600);
  await page.evaluate(() => __game.debug.setInput({}));
  const before = await page.evaluate(() => __game.debug.lifetimeStats().distance || 0);
  await page.evaluate(() => { __game.debug.damagePlayer(9999); });
  await page.waitForTimeout(2200);
  await page.evaluate(() => { __game.debug.damagePlayer(9999); });
  await page.waitForFunction(() => window.__game.phase === 'dead');
  const after = await page.evaluate(() => __game.debug.lifetimeStats().distance || 0);
  expect(after).toBeGreaterThan(before);
});

test('#185 : 10000m cumules debloquent marathonien', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('marathonien'))).toBe(false);
  await page.evaluate(() => {
    __game.debug.addLifetimeStat('distance', 10000);
    __game.debug.spawnEnemyTypeAt(0,'shooter',4,4); __game.debug.damageEnemy(0, 99999);
  });
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('marathonien'))).toBe(true);
});

// ====== #186 — Succes Speedrunner ======

test('#186 : achievements() inclut speedrunner', async ({ page }) => {
  await startPlaying(page);
  const ids = await page.evaluate(() => __game.debug.achievements().map(a => a.id));
  expect(ids).toContain('speedrunner');
});

test('#186 : 3 vagues eclair dans la meme partie debloquent speedrunner', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('speedrunner'))).toBe(false);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => __game.debug.killAllEnemies());
    await page.waitForTimeout(50);
    await page.evaluate(() => __game.debug.forceNextWave());
    await page.waitForTimeout(50);
  }
  expect(await page.evaluate(() => __game.debug.speedClearCount())).toBeGreaterThanOrEqual(3);
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('speedrunner'))).toBe(true);
});

// ====== #191 — Succes (lot 4) ======

test('#191 : achievements() inclut les 5 nouveaux ids', async ({ page }) => {
  await startPlaying(page);
  const ids = await page.evaluate(() => __game.debug.achievements().map(a => a.id));
  for (const id of ['intouchable', 'sans_faille', 'ombre', 'cible_mouvante', 'intraitable']) expect(ids).toContain(id);
});

test('#191 : 10 vagues parfaites consecutives debloquent intouchable', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => __game.debug.killAllEnemies());
    await page.waitForTimeout(50);
    await page.evaluate(() => __game.debug.forceNextWave());
    await page.waitForTimeout(50);
  }
  expect(await page.evaluate(() => __game.debug.perfectWaveStreak())).toBeGreaterThanOrEqual(10);
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('intouchable'))).toBe(true);
});

test('#191 : 5 vagues sans recharger debloquent sans_faille', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => __game.debug.killAllEnemies());
    await page.waitForTimeout(50);
    await page.evaluate(() => __game.debug.forceNextWave());
    await page.waitForTimeout(50);
  }
  expect(await page.evaluate(() => __game.debug.noReloadClearCount())).toBeGreaterThanOrEqual(5);
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('sans_faille'))).toBe(true);
});

test('#191 : 5 takedowns furtifs debloquent ombre', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => {
    __game.debug.save.reset();
    __game.debug.setView('first'); __game.debug.setPitch(0); __game.debug.setYaw(0); __game.debug.setPos(0,0);
  });
  for (let i = 0; i < 5; i++) await meleeKillWhenReady(page);
  expect(await page.evaluate(() => __game.debug.stealthKillCount())).toBeGreaterThanOrEqual(5);
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('ombre'))).toBe(true);
});

test('#191 : 50m parcourus debloquent cible_mouvante', async ({ page }) => {
  test.setTimeout(240000);
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  // Le temps de JEU (dt clampé à 0,05/frame) s'écoule très lentement en temps réel sous SwiftShader, et le
  // ratio se dégrade encore avec la durée du test (rendu logiciel sous charge soutenue) — pas de budget de
  // temps fixe fiable. On téléporte le joueur entre deux extrémités opposées de la map (le saut de setPos,
  // hors updateController, n'est PAS compté dans runDistance_ — capturé frame par frame depuis la position du
  // DÉBUT de cette frame ; setStamina(100) réarme aussi staminaDepleted, sinon le sprint reste bloqué en marche
  // après le premier épuisement) et on scrute avec un plafond très large, sortie dès que le seuil est atteint.
  for (let leg = 0; leg < 30; leg++) {
    const faceForward = leg % 2 === 0;
    await page.evaluate((fwd) => {
      __game.debug.setPos(0, fwd ? -20 : 20);
      __game.debug.setYaw(fwd ? 0 : Math.PI);
      __game.debug.setStamina(100);
      __game.debug.setInput({forward:true, sprint:true});
    }, faceForward);
    await page.waitForTimeout(6000);
    if (await page.evaluate(() => __game.debug.runDistance()) >= 55) break;
  }
  await page.evaluate(() => __game.debug.setInput({}));
  expect(await page.evaluate(() => __game.debug.runDistance())).toBeGreaterThanOrEqual(50);
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0,'shooter',4,4); __game.debug.damageEnemy(0, 99999); });
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('cible_mouvante'))).toBe(true);
});

test('#191 : 3 kills clutch debloquent intraitable', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  const maxHp = await page.evaluate(() => __game.maxHealth);
  for (let i = 0; i < 3; i++) {
    // tuer 3+ ennemis d'un coup (boucle ci-dessous) declenche le bouclier killstreak (#58, -50% degats 5s) :
    // sans attendre son expiration, le damagePlayer() du cycle suivant est absorbe de moitie et ne descend
    // pas les PV assez bas -> le seuil clutch (<20%) n'est jamais atteint pour ce kill
    await page.waitForFunction(() => !window.__game.debug.ksShieldActive(), null, { timeout: 10000 });
    const hp = await page.evaluate(() => __game.debug.playerHealth());
    const dmg = Math.max(1, hp - Math.round(maxHp * 0.1));   // ramene les PV a ~10% du max, sans jamais depasser les PV courants (evite second souffle/mort)
    await page.evaluate((d) => { __game.debug.setShield(0); __game.debug.damagePlayer(d); }, dmg);
    const n = await page.evaluate(() => __game.debug.enemyCount());
    for (let j = 0; j < n; j++) await page.evaluate((j) => __game.debug.damageEnemy(j, 99999), j);
    await page.evaluate(() => { __game.debug.useMedkit(); __game.debug.useMedkit(); });   // remonte les PV avant le prochain cycle
    await page.evaluate(() => __game.debug.forceNextWave());
    await page.waitForFunction(() => window.__game.debug.enemyAlive() > 0, null, { timeout: 10000 });   // attend le spawn réel de la vague suivante (sinon enemyCount lit des cadavres)
  }
  expect(await page.evaluate(() => __game.debug.clutchCount())).toBeGreaterThanOrEqual(3);
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('intraitable'))).toBe(true);
});

// ====== #193 — Succes Ingenieur ======

test('#193 : achievements() inclut ingenieur', async ({ page }) => {
  await startPlaying(page);
  const ids = await page.evaluate(() => __game.debug.achievements().map(a => a.id));
  expect(ids).toContain('ingenieur');
});

test('#193 : 10 barils en chaine debloquent ingenieur', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('ingenieur'))).toBe(false);
  // explodeBarrelNow(0) viserait un baril de MAP (spawnBarrels en pose 4 aux indices 0-3, loin du joueur) → on capture l'indice réel du 1er baril empilé
  const first = await page.evaluate(() => __game.debug.spawnBarrelInFront(8));
  await page.evaluate(() => { for (let i = 0; i < 10; i++) __game.debug.spawnBarrelInFront(8); });
  await page.evaluate((i) => __game.debug.explodeBarrelNow(i), first);
  expect(await page.evaluate(() => __game.debug.barrelChainCount())).toBeGreaterThanOrEqual(10);
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0,'shooter',4,4); __game.debug.damageEnemy(0, 99999); });
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('ingenieur'))).toBe(true);
});

// ====== #194 — Succes Miracule ======

test('#194 : achievements() inclut miracule', async ({ page }) => {
  await startPlaying(page);
  const ids = await page.evaluate(() => __game.debug.achievements().map(a => a.id));
  expect(ids).toContain('miracule');
});

test('#194 : nettoyer une vague a 1 PV debloque miracule', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('miracule'))).toBe(false);
  await page.evaluate(() => __game.debug.damagePlayer(9999));   // dernier souffle -> PV = 1
  expect(await page.evaluate(() => __game.debug.playerHealth())).toBe(1);
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('miracule'))).toBe(true);
});

test('#194 : nettoyer une vague a PV normaux ne debloque pas miracule', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('miracule'))).toBe(false);
});

// ====== #195 — Succes (lot 5) ======

test('#195 : achievements() inclut contractant et legendaire_arme', async ({ page }) => {
  await startPlaying(page);
  const ids = await page.evaluate(() => __game.debug.achievements().map(a => a.id));
  expect(ids).toContain('contractant');
  expect(ids).toContain('legendaire_arme');
});

test('#195 : terminer les 3 contrats du jour debloque contractant', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('contractant'))).toBe(false);
  const n = (await page.evaluate(() => __game.debug.dailyContracts())).length;
  for (let i = 0; i < n; i++) await page.evaluate((i) => __game.debug.forceDailyComplete(i), i);
  expect(await page.evaluate(() => __game.debug.dailyContractsDone())).toBe(n);
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0,'shooter',4,4); __game.debug.damageEnemy(0, 99999); });
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('contractant'))).toBe(true);
});

test('#195 : equiper une arme legendaire debloque legendaire_arme', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(5000); });
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('legendaire_arme'))).toBe(false);
  await page.evaluate(() => { __game.debug.shop.buy('phantom_sr'); __game.debug.shop.equip('phantom_sr'); });
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0,'shooter',4,4); __game.debug.damageEnemy(0, 99999); });
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('legendaire_arme'))).toBe(true);
});

// ====== #196 — Compteur de succes sur l accueil ======

test('#196 : accueil affiche 0/N sur une save neuve', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.backToHome(); });
  await page.waitForFunction(() => window.__game.phase === 'lobby');
  const total = await page.evaluate(() => __game.debug.achievements().length);
  const text = await page.evaluate(() => document.getElementById('intel-achievements').textContent);
  expect(text).toBe(`0/${total}`);
});

test('#196 : le compteur reflete un succes debloque', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.spawnEnemyTypeAt(0,'shooter',4,4); __game.debug.damageEnemy(0, 99999); });
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('firstblood'))).toBe(true);
  await page.evaluate(() => __game.debug.backToHome());
  await page.waitForFunction(() => window.__game.phase === 'lobby');
  const total = await page.evaluate(() => __game.debug.achievements().length);
  const text = await page.evaluate(() => document.getElementById('intel-achievements').textContent);
  expect(text).toBe(`1/${total}`);
});

// ====== #197 — Succes Silencieux ======

test('#197 : achievements() inclut silencieux', async ({ page }) => {
  await startPlaying(page);
  const ids = await page.evaluate(() => __game.debug.achievements().map(a => a.id));
  expect(ids).toContain('silencieux');
});

test('#197 : nettoyer une vague uniquement au couteau debloque silencieux', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => {
    __game.debug.save.reset();
    __game.debug.setView('first'); __game.debug.setPitch(0); __game.debug.setYaw(0); __game.debug.setPos(0,0);
  });
  const n = await page.evaluate(() => __game.debug.enemyCount());
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 0, 2));
    await page.evaluate(() => __game.debug.playerMelee());
    await page.waitForTimeout(700);
  }
  // la boucle ne tue que l'indice 0 : les ennemis 1..n-1 de la vague restent vivants — le succès n'est évalué
  // qu'à la FIN de vague → on achève les restants sans aucun tir (killAllEnemies ne compte pas comme un tir)
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => __game.debug.waveShots())).toBe(0);
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('silencieux'))).toBe(true);
});

test('#197 : un tir a distance dans la vague empeche silencieux', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => __game.debug.tryFire());   // au moins 1 tir trace (waveShots_ > 0), touche ou non
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => __game.debug.waveShots())).toBeGreaterThan(0);
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('silencieux'))).toBe(false);
});

// ====== #199 — Succes Stylise ======

test('#199 : achievements() inclut stylise', async ({ page }) => {
  await startPlaying(page);
  const ids = await page.evaluate(() => __game.debug.achievements().map(a => a.id));
  expect(ids).toContain('stylise');
});

test('#199 : casque + costume legendaires debloquent stylise, un seul ne suffit pas', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(10000); });
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('stylise'))).toBe(false);
  // le succès n'est évalué qu'à la FIN d'une vague (checkWaveCleared) → il faut nettoyer une vague après chaque équipement
  await page.evaluate(() => { __game.debug.shop.buyAccessory('helm:halo'); __game.debug.shop.selectAccessory('helmet', 'helm:halo'); });
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('stylise'))).toBe(false);   // casque seul, pas assez
  await page.evaluate(() => __game.debug.forceNextWave());
  await page.waitForFunction(() => window.__game.debug.enemyAlive() > 0, null, { timeout:10000 });   // vague suivante active
  await page.evaluate(() => { __game.debug.shop.buyAccessory('cost:wings'); __game.debug.shop.selectAccessory('costume', 'cost:wings'); });
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => __game.debug.achievementUnlocked('stylise'))).toBe(true);
});
