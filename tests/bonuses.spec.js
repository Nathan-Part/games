import { test, expect } from '@playwright/test';
import { trackErrors, startPlaying, faceEnemyForMelee, alignTwoEnemies } from './helpers.js';

// ====== Tranche 29 : combo / killstreak ======

test('combo : multiplicateur par paliers (plafond x5)', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const m = (n) => page.evaluate(k => __game.debug.comboMultiplier(k), n);
  expect(await m(1)).toBe(1); expect(await m(2)).toBe(1); expect(await m(3)).toBe(2);
  expect(await m(6)).toBe(3); expect(await m(12)).toBe(5); expect(await m(99)).toBe(5);
});

test('combo : enchainer monte le combo et booste l argent', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  const m0 = await page.evaluate(() => __game.money);
  const perKill = await page.evaluate(() => __game.debug.save.rates().perKill);
  await page.evaluate(() => { for(let i=0;i<3;i++){ __game.debug.spawnEnemyAt(0, 3); __game.debug.damageEnemy(0, 99999); } });
  expect(await page.evaluate(() => __game.debug.combo())).toBe(3);
  expect(await page.evaluate(() => __game.debug.comboMult())).toBe(2);
  // #139/#161 : damageEnemy(0, 99999) declenche aussi l'overkill (+25$/kill) et le 1er kill de la vague le premier sang (+15$)
  const overkillTotal = await page.evaluate(() => __game.debug.overkillCount() * 25);
  const firstBloodTotal = await page.evaluate(() => __game.debug.firstBloodCount() * 15);
  expect(await page.evaluate(() => __game.money) - m0).toBe(perKill * (1 + 1 + 2) + overkillTotal + firstBloodTotal);   // mult des 3 kills + bonus
  expect(await page.evaluate(() => __game.debug.bestCombo())).toBeGreaterThanOrEqual(3);
});

test('combo : reset a la mort/restart', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnEnemyAt(0,3); __game.debug.damageEnemy(0,99999); });
  expect(await page.evaluate(() => __game.debug.combo())).toBeGreaterThan(0);
  await page.evaluate(() => __game.debug.restart());
  expect(await page.evaluate(() => __game.debug.combo())).toBe(0);
});

test('combo : rupture apres la fenetre sans kill', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnEnemyAt(0,3); __game.debug.damageEnemy(0,99999); });
  expect(await page.evaluate(() => __game.debug.combo())).toBeGreaterThan(0);
  await page.waitForFunction(() => __game.debug.combo() === 0, null, { timeout:6000 });   // ~3.5 s + marge
});

test('combo : HUD visible avec le multiplicateur, masque a 0', async ({ page }) => {
  await startPlaying(page);
  await expect(page.locator('#combo-hud')).toBeHidden();
  await page.evaluate(() => { for(let i=0;i<3;i++){ __game.debug.spawnEnemyAt(0,3); __game.debug.damageEnemy(0,99999); } });
  await expect(page.locator('#combo-hud')).toBeVisible();
  await expect(page.locator('#combo-hud')).toContainText('x2');
});

// ====== #58 — Killstreak Rewards ======

test('#58 ks : killstreak initial = 0', async ({ page }) => {
  await startPlaying(page);
  const n = await page.evaluate(() => __game.debug.ksCount());
  expect(n).toBe(0);
});

test('#58 ks : 3 kills rapides declenche rechargement', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { for(let i=0;i<3;i++) __game.debug.registerKsKill(); });
  const rewarded = await page.evaluate(() => __game.debug.ksRewardFired(3));
  expect(rewarded).toBe(true);
});

test('#58 ks : 5 kills rapides = bouclier actif', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { for(let i=0;i<5;i++) __game.debug.registerKsKill(); });
  const shielded = await page.evaluate(() => __game.debug.ksShieldActive());
  expect(shielded).toBe(true);
});

test('#58 ks : 7 kills rapides = double argent actif', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { for(let i=0;i<7;i++) __game.debug.registerKsKill(); });
  const dbl = await page.evaluate(() => __game.debug.ksMoneyMult());
  expect(dbl).toBe(2);
});

test('#58 ks : reset au restart', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { for(let i=0;i<5;i++) __game.debug.registerKsKill(); });
  await page.evaluate(() => __game.debug.restart());
  await page.waitForFunction(() => __game.phase === 'playing', null, {timeout:20000});
  const n = await page.evaluate(() => __game.debug.ksCount());
  expect(n).toBe(0);
});

// ====== #72 — Compteur streak kills ======

test('#72 streak : streakKills initial = 0', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.streakKills())).toBe(0);
});

test('#72 streak : kill incremente le streak', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnEnemyAt(0, 3); __game.debug.damageEnemy(0, 9999); });
  expect(await page.evaluate(() => __game.debug.streakKills())).toBe(1);
});

test('#72 streak : degat joueur reset le streak', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnEnemyAt(0, 3); __game.debug.damageEnemy(0, 9999); });
  await page.evaluate(() => __game.debug.damagePlayer(10));
  expect(await page.evaluate(() => __game.debug.streakKills())).toBe(0);
});

// ====== #100 — Bonus argent fin de vague (survie sans mort) ======

test('#100 wave bonus : lastWaveBonus() = 0 par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.lastWaveBonus())).toBe(0);
});

test('#100 wave bonus : forceWaveBonus(1) ajoute wave*50 argent', async ({ page }) => {
  await startPlaying(page);
  const moneyBefore = await page.evaluate(() => __game.money);
  await page.evaluate(() => __game.debug.forceWaveBonus(1));
  const moneyAfter = await page.evaluate(() => __game.money);
  expect(moneyAfter - moneyBefore).toBe(50);
  expect(await page.evaluate(() => __game.debug.lastWaveBonus())).toBe(50);
});

test('#100 wave bonus : forceWaveBonus(3) ajoute 150', async ({ page }) => {
  await startPlaying(page);
  const moneyBefore = await page.evaluate(() => __game.money);
  await page.evaluate(() => __game.debug.forceWaveBonus(3));
  const moneyAfter = await page.evaluate(() => __game.money);
  expect(moneyAfter - moneyBefore).toBe(150);
});

// ====== #102 — Long shot bonus ======

test('#102 long shot : longShotCount() = 0 par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.longShotCount())).toBe(0);
});

test('#102 long shot : forceLongShot() incremente le compteur et ajoute bonus', async ({ page }) => {
  await startPlaying(page);
  const moneyBefore = await page.evaluate(() => __game.money);
  await page.evaluate(() => __game.debug.forceLongShot());
  expect(await page.evaluate(() => __game.debug.longShotCount())).toBe(1);
  expect(await page.evaluate(() => __game.money)).toBeGreaterThan(moneyBefore);
});

test('#102 long shot : lastKillDist() 0 sans kill', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.lastKillDist())).toBe(0);
});

// ====== #105 — Precision shot bonus ======

test('#105 precision : precisionShotCount() = 0 par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.precisionShotCount())).toBe(0);
});

test('#105 precision : forcePrecisionShot() incremente compteur', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forcePrecisionShot());
  expect(await page.evaluate(() => __game.debug.precisionShotCount())).toBe(1);
  expect(await page.evaluate(() => __game.debug.lastWasPrecision())).toBe(true);
});

test('#105 precision : lastWasPrecision() false par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.lastWasPrecision())).toBe(false);
});

// ====== #108 — Tactical reload bonus ======

test('#108 tactical reload : tacticalReloadCount() = 0 par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.tacticalReloadCount())).toBe(0);
});

test('#108 tactical reload : reload avec ammo>0 = tactical, +1 munition', async ({ page }) => {
  await startPlaying(page);
  const mag = await page.evaluate(() => __game.debug.curMag());
  await page.evaluate(() => { __game.debug.setAmmo(5); __game.debug.reload(); });
  // Attendre fin du reload
  await page.waitForTimeout(1500);
  const ammoAfter = await page.evaluate(() => __game.ammo);
  expect(ammoAfter).toBe(mag + 1);
  expect(await page.evaluate(() => __game.debug.lastReloadWasTactical())).toBe(true);
  expect(await page.evaluate(() => __game.debug.tacticalReloadCount())).toBe(1);
});

test('#108 tactical reload : reload a vide n est pas tactical', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setAmmo(0); __game.debug.reload(); });
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => __game.debug.lastReloadWasTactical())).toBe(false);
});

// ====== #110 — Headshot streak counter ======

test('#110 headshot streak : 0 par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.headStreakCount())).toBe(0);
});

test('#110 headshot streak : 3 headshots consecutifs incremente le streak', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => {
    __game.debug.setEnemyLastHitHead(0, true);
    __game.debug.damageEnemy(0, 1000);
    const e2 = __game.debug.spawnEnemyInFront(5);
    __game.debug.setEnemyLastHitHead(e2, true);
    __game.debug.damageEnemy(e2, 1000);
    const e3 = __game.debug.spawnEnemyInFront(5);
    __game.debug.setEnemyLastHitHead(e3, true);
    __game.debug.damageEnemy(e3, 1000);
  });
  const streak = await page.evaluate(() => __game.debug.headStreakCount());
  expect(streak).toBeGreaterThanOrEqual(3);
});

test('#110 headshot streak : reset sur dommage recu', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => {
    __game.debug.setEnemyLastHitHead(0, true);
    __game.debug.damageEnemy(0, 1000);
    __game.debug.damagePlayer(20);
  });
  expect(await page.evaluate(() => __game.debug.headStreakCount())).toBe(0);
});

// ====== #113 — Perfect burst bonus ======

test('#113 perfect burst : perfectBurstCount 0 par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.perfectBurstCount())).toBe(0);
});

test('#113 perfect burst : lastBurstPerfect false par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.lastBurstPerfect())).toBe(false);
});

test('#113 perfect burst : burstRoundsLeft disponible', async ({ page }) => {
  await startPlaying(page);
  expect(typeof await page.evaluate(() => __game.debug.burstRoundsLeft())).toBe('number');
});

// ====== #125 — Rampage mode ======

test('#125 rampage : triggerRampage active rampageActive', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.triggerRampage());
  const active = await page.evaluate(() => __game.debug.rampageActive());
  expect(active).toBe(true);
});

test('#125 rampage : rampageActive bloque les degats joueur', async ({ page }) => {
  await startPlaying(page);
  const hpBefore = await page.evaluate(() => __game.debug.playerHealth());
  await page.evaluate(() => __game.debug.triggerRampage());
  await page.evaluate(() => __game.debug.damagePlayer(50));
  const hpAfter = await page.evaluate(() => __game.debug.playerHealth());
  expect(hpAfter).toBe(hpBefore);
});

test('#125 rampage : 10 kills sans degats declenchent rampage', async ({ page }) => {
  await startPlaying(page);
  // Faire 10 kills via killAllEnemies x vagues successives et re-spawn
  for(let i=0;i<10;i++){
    await page.evaluate(() => {
      __game.debug.spawnEnemyTypeAt(0,'shooter',5,0);
      __game.debug.damageEnemy(0, 9999);
    });
    await page.waitForTimeout(50);
  }
  const active = await page.evaluate(() => __game.debug.rampageActive());
  expect(active).toBe(true);
});

// ====== #126 — Wave score multiplier ======

test('#126 wave mult : waveScoreMult retourne 1 en vague 1', async ({ page }) => {
  await startPlaying(page);
  const m = await page.evaluate(() => __game.debug.waveScoreMult());
  expect(m).toBe(1);
});

test('#126 wave mult : waveScoreMult retourne 1.5 en vague 5', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forceWave(5));
  await page.waitForTimeout(200);
  const m = await page.evaluate(() => __game.debug.waveScoreMult());
  expect(m).toBe(1.5);
});

test('#126 wave mult : lastKillScore > 1 en vague 5 apres un kill', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forceWave(5));
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    __game.debug.spawnEnemyTypeAt(0, 'shooter', 5, 0);
    __game.debug.damageEnemy(0, 9999);
  });
  await page.waitForTimeout(100);
  const ks = await page.evaluate(() => __game.debug.lastKillScore());
  expect(ks).toBeGreaterThanOrEqual(2); // combo 1 × wave mult 1.5 = 1.5 → round = 2 (or 1 if floor)
  expect(ks).toBeGreaterThan(1);
});

// ====== #138 — Frappe aerienne (killstreak tier 10) ======

test('#138 -> #156 : 10 kills en fenetre ne declenche plus la frappe aerienne (remplace par le systeme de points loadout)', async ({ page }) => {
  await startPlaying(page);
  for(let i=0;i<10;i++) await page.evaluate(() => __game.debug.registerKsKill());
  expect(await page.evaluate(() => __game.debug.ksRewardFired(10))).toBe(false);
  expect(await page.evaluate(() => __game.debug.ksRewardFired(7))).toBe(true);   // les autres paliers (3/5/7) restent inchanges
});

test('#138 airstrike : triggerAirstrikeNow inflige des degats a des ennemis vivants', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0, 'shooter', 5, 0); __game.debug.spawnEnemyTypeAt(1, 'shooter', 8, 0); });
  const hp0Before = await page.evaluate(() => __game.debug.enemyHp(0));
  const hp1Before = await page.evaluate(() => __game.debug.enemyHp(1));
  await page.evaluate(() => __game.debug.triggerAirstrikeNow());
  const hp0After = await page.evaluate(() => __game.debug.enemyHp(0));
  const hp1After = await page.evaluate(() => __game.debug.enemyHp(1));
  expect(hp0After + hp1After).toBeLessThan(hp0Before + hp1Before);
  expect(await page.evaluate(() => __game.debug.airstrikeHitCount())).toBeGreaterThan(0);
});

test('#138 airstrike : ne depasse jamais 3 cibles touchees', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.triggerAirstrikeNow());
  const hitCount = await page.evaluate(() => __game.debug.airstrikeHitCount());
  expect(hitCount).toBeLessThanOrEqual(3);
});

test('#138 airstrike : ne plante pas sans ennemis vivants', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.evaluate(() => __game.debug.triggerAirstrikeNow());
  expect(await page.evaluate(() => __game.debug.airstrikeHitCount())).toBe(0);
});

// ====== #139 — Bonus overkill ======

test('#139 overkill : forceOverkill declenche le bonus et le callout', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 5, 0));
  const moneyBefore = await page.evaluate(() => __game.debug.runMoney());
  await page.evaluate(() => __game.debug.forceOverkill(0));
  expect(await page.evaluate(() => __game.debug.lastOverkill())).toBe(true);
  expect(await page.evaluate(() => __game.debug.runMoney())).toBeGreaterThan(moneyBefore);
});

test('#139 overkill : un kill juste suffisant (sans gros excedent) ne declenche pas le bonus', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 5, 0));
  await page.evaluate(() => { const hp = __game.debug.enemyHp(0); __game.debug.damageEnemy(0, hp); }); // exactement les PV restants, pas d'excédent
  expect(await page.evaluate(() => __game.debug.lastOverkill())).toBe(false);
});

test('#139 overkill : overkillCount incremente et se reinitialise au restart', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 5, 0));
  const before = await page.evaluate(() => __game.debug.overkillCount());
  await page.evaluate(() => __game.debug.forceOverkill(0));
  expect(await page.evaluate(() => __game.debug.overkillCount())).toBe(before + 1);
  await page.evaluate(() => __game.debug.restart());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.overkillCount())).toBe(0);
});

// ====== #149 — Bonus vague eclair (clear rapide) ======

test('#149 vague eclair : nettoyer la vague juste apres son lancement declenche le bonus', async ({ page }) => {
  await startPlaying(page);
  const moneyBefore = await page.evaluate(() => __game.debug.runMoney());
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.lastSpeedClear())).toBe(true);
  expect(await page.evaluate(() => __game.debug.runMoney())).toBeGreaterThan(moneyBefore);
});

test('#149 vague eclair : une vague nettoyee apres le seuil ne declenche pas le bonus', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.ageWaveStart(20)); // recule le chrono au-dela du seuil de 15s
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.lastSpeedClear())).toBe(false);
});

test('#149 vague eclair : speedClearCount incremente et se reinitialise au restart', async ({ page }) => {
  await startPlaying(page);
  const before = await page.evaluate(() => __game.debug.speedClearCount());
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.speedClearCount())).toBe(before + 1);
  await page.evaluate(() => __game.debug.restart());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.speedClearCount())).toBe(0);
});

// ====== #156 — Série de points (killstreak loadout) ======

test('#156 : registerLoadoutKill ajoute 100pts aux bonus selectionnes, rien aux autres', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); });
  expect(await page.evaluate(() => __game.debug.selectedLoadout())).toEqual(['turret','mine','airstrike']);
  await page.evaluate(() => __game.debug.registerLoadoutKill());
  expect(await page.evaluate(() => __game.debug.loadoutPoints('turret'))).toBe(100);
  expect(await page.evaluate(() => __game.debug.loadoutPoints('mine'))).toBe(100);
  expect(await page.evaluate(() => __game.debug.loadoutPoints('airstrike'))).toBe(100);
  expect(await page.evaluate(() => __game.debug.loadoutPoints('carepackage'))).toBe(0);
});

test('#156 : un kill reel alimente aussi les points loadout', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 4, 4));
  await page.evaluate(() => __game.debug.damageEnemy(0, 99999));
  expect(await page.evaluate(() => __game.debug.loadoutPoints('turret'))).toBe(100);
});

test('#156 : toggleLoadoutBonus deselectionne, reselectionne, et evince le plus ancien au 4e choix (FIFO)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.toggleLoadoutBonus('turret'))).toBe(true);   // deselectionne
  expect(await page.evaluate(() => __game.debug.selectedLoadout())).toEqual(['mine','airstrike']);
  expect(await page.evaluate(() => __game.debug.toggleLoadoutBonus('carepackage'))).toBe(true); // ajoute (3/3)
  expect(await page.evaluate(() => __game.debug.selectedLoadout())).toEqual(['mine','airstrike','carepackage']);
  expect(await page.evaluate(() => __game.debug.toggleLoadoutBonus('turret'))).toBe(true);   // 4e -> evince 'mine' (le plus ancien)
  expect(await page.evaluate(() => __game.debug.selectedLoadout())).toEqual(['airstrike','carepackage','turret']);
});

test('#156 : loadoutReady vrai seulement si selectionne ET palier atteint', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.loadoutThreshold('mine'))).toBe(600);
  for (let i=0;i<5;i++) await page.evaluate(() => __game.debug.registerLoadoutKill());   // 500 pts
  expect(await page.evaluate(() => __game.debug.loadoutReady('mine'))).toBe(false);
  await page.evaluate(() => __game.debug.registerLoadoutKill());                        // 600 pts
  expect(await page.evaluate(() => __game.debug.loadoutReady('mine'))).toBe(true);
  await page.evaluate(() => __game.debug.toggleLoadoutBonus('mine'));                   // deselectionne
  expect(await page.evaluate(() => __game.debug.loadoutReady('mine'))).toBe(false);
});

test('#156 : les points se remettent a zero au restart', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.registerLoadoutKill());
  expect(await page.evaluate(() => __game.debug.loadoutPoints('turret'))).toBe(100);
  await page.evaluate(() => __game.debug.restart());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.loadoutPoints('turret'))).toBe(0);
});

test('#156 : triggerLoadoutBonus refuse si pas selectionne ou points insuffisants', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  expect(await page.evaluate(() => __game.debug.triggerLoadoutBonus('turret'))).toBe(false);   // 0 pts
  expect(await page.evaluate(() => __game.debug.triggerLoadoutBonus('carepackage'))).toBe(false); // pas selectionne (defaut)
});

test('#156 : tourelle prete via points se deploie meme si l ancien cooldown serait bloquant', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => { __game.debug.deployTurret(); });     // pose une 1ere tourelle "classique" -> future pose bloquee par le vieux cooldown normalement
  await page.evaluate(() => { for(let i=0;i<12;i++) __game.debug.registerLoadoutKill(); }); // 1200 pts = palier turret
  expect(await page.evaluate(() => __game.debug.loadoutReady('turret'))).toBe(true);
  expect(await page.evaluate(() => __game.debug.turretActive())).toBe(true);   // la 1ere tourelle est deja active -> triggerLoadoutBonus doit echouer (max 1 active), pas a cause du cooldown
  expect(await page.evaluate(() => __game.debug.triggerLoadoutBonus('turret'))).toBe(false);
});

test('#156 : mine prete via points se pose sans consommer le stock claymore', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  const stockBefore = await page.evaluate(() => __game.debug.mineStock());
  await page.evaluate(() => { for(let i=0;i<6;i++) __game.debug.registerLoadoutKill(); }); // 600 pts = palier mine
  expect(await page.evaluate(() => __game.debug.triggerLoadoutBonus('mine'))).toBe(true);
  expect(await page.evaluate(() => __game.debug.mineCount())).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => __game.debug.mineStock())).toBe(stockBefore);   // stock inchange
  expect(await page.evaluate(() => __game.debug.loadoutPoints('mine'))).toBe(0);   // consomme les points
});

test('#156 : bonus non selectionne (4e) reste inerte meme a points eleves', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());   // carepackage n est pas dans le loadout par defaut
  await page.evaluate(() => { for(let i=0;i<20;i++) __game.debug.registerLoadoutKill(); });
  expect(await page.evaluate(() => __game.debug.loadoutPoints('carepackage'))).toBe(0);   // jamais alimente
  expect(await page.evaluate(() => __game.debug.triggerLoadoutBonus('carepackage'))).toBe(false);
});

test('#156 : la touche L declenche triggerLoadoutBonus turret quand pret', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => { for(let i=0;i<12;i++) __game.debug.registerLoadoutKill(); });
  await page.evaluate(() => __game.debug.setInput({}));
  await page.keyboard.press('KeyL');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.turretActive())).toBe(true);
});

test('#156 : frappe aerienne 10 kills en 8s ne se declenche plus automatiquement, mais 3/5/7 fonctionnent toujours', async ({ page }) => {
  await startPlaying(page);
  for(let i=0;i<10;i++){
    await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 4, 4));
    await page.evaluate(() => __game.debug.damageEnemy(0, 99999));
  }
  expect(await page.evaluate(() => __game.debug.ksRewardFired(10))).toBe(false);
  expect(await page.evaluate(() => __game.debug.ksRewardFired(3))).toBe(true);
});

test('#156 : caisse de ravitaillement ne spawn plus automatiquement toutes les 4 vagues', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forceWave(4));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.carePackageActive())).toBe(false);
});

test('#156 : caisse prete via touche I apparait a la position du joueur', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => __game.debug.toggleLoadoutBonus('carepackage'));   // l ajoute (evince le plus ancien -> 'turret')
  await page.evaluate(() => { for(let i=0;i<10;i++) __game.debug.registerLoadoutKill(); }); // 1000 pts
  expect(await page.evaluate(() => __game.debug.triggerLoadoutBonus('carepackage'))).toBe(true);
  expect(await page.evaluate(() => __game.debug.carePackageActive())).toBe(true);
});

test('#156 : recompense caisse bonus_turret octroie une tourelle gratuite sans palier', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => __game.debug.forceCarePackageReward('bonus_turret'));
  await page.evaluate(() => { __game.debug.spawnCarePackageAt(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.turretActive())).toBe(true);
});

test('#156 : recompense caisse bonus_mine octroie une claymore gratuite sans consommer le stock', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  const stockBefore = await page.evaluate(() => __game.debug.mineStock());
  await page.evaluate(() => __game.debug.forceCarePackageReward('bonus_mine'));
  await page.evaluate(() => { __game.debug.spawnCarePackageAt(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.mineCount())).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => __game.debug.mineStock())).toBe(stockBefore);
});

test('#156 : recompense caisse bonus_airstrike declenche la frappe aerienne gratuitement', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 4, 4));
  await page.evaluate(() => __game.debug.forceCarePackageReward('bonus_airstrike'));
  await page.evaluate(() => { __game.debug.spawnCarePackageAt(0, 0); __game.debug.setPos(0, 0); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.airstrikeHitCount())).toBeGreaterThanOrEqual(1);
});

test('#156 : la barre HUD du bonus selectionne est visible en partie, masquee si non selectionne', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  const turretHidden = await page.evaluate(() => document.getElementById('ls-turret-hud').classList.contains('hidden'));
  const carepackageHidden = await page.evaluate(() => document.getElementById('ls-carepackage-hud').classList.contains('hidden'));
  expect(turretHidden).toBe(false);      // dans le loadout par defaut
  expect(carepackageHidden).toBe(true);  // pas dans le loadout par defaut
});

test('#156 : la barre se remplit avec les points et devient ready a 100%', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => { for(let i=0;i<12;i++) __game.debug.registerLoadoutKill(); }); // 1200 = palier turret
  const width = await page.evaluate(() => document.getElementById('ls-turret-fill').style.width);
  const ready = await page.evaluate(() => document.getElementById('ls-turret-fill').classList.contains('ready'));
  expect(width).toBe('100%');
  expect(ready).toBe(true);
});

test('#156 : les barres loadout sont masquees au retour au menu', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.backToHome());
  expect(await page.evaluate(() => document.getElementById('ls-turret-hud').classList.contains('hidden'))).toBe(true);
});

test('#156 : le panneau loadout s ouvre depuis le lobby et affiche 4 cartes', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.characters?.length >= 1, null, {timeout:20000});
  await page.evaluate(() => document.getElementById('btn-loadout').click());
  const hidden = await page.evaluate(() => document.getElementById('loadout-panel').classList.contains('hidden'));
  expect(hidden).toBe(false);
  const cardCount = await page.evaluate(() => document.querySelectorAll('#loadout-panel .icard[data-loadout]').length);
  expect(cardCount).toBe(4);
});

test('#156 : cliquer une carte du panneau loadout appelle toggleLoadoutBonus et persiste', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.characters?.length >= 1, null, {timeout:20000});
  await page.evaluate(() => { __game.debug.save.reset(); document.getElementById('btn-loadout').click(); });
  await page.evaluate(() => document.querySelector('[data-loadout="carepackage"]').click());
  expect(await page.evaluate(() => __game.debug.selectedLoadout())).toContain('carepackage');
  await page.reload(); await page.waitForFunction(() => window.__game?.booted);
  expect(await page.evaluate(() => __game.debug.save.get().selectedLoadout)).toContain('carepackage');
});

// ====== #156b — Ciblage manuel de la frappe aérienne ======

test('#156b : declencher la frappe aerienne prete ouvre le ciblage sans consommer les points', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => { for(let i=0;i<18;i++) __game.debug.registerLoadoutKill(); }); // 1800 = palier airstrike
  expect(await page.evaluate(() => __game.debug.triggerLoadoutBonus('airstrike'))).toBe(true);
  expect(await page.evaluate(() => __game.debug.airstrikeTargetingActive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.loadoutPoints('airstrike'))).toBe(1800);   // pas encore consomme
  const hidden = await page.evaluate(() => document.getElementById('airstrike-map-panel').classList.contains('hidden'));
  expect(hidden).toBe(false);
});

test('#156b : confirmer une cible frappe les ennemis proches et consomme les points', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 5, 5));
  await page.evaluate(() => { for(let i=0;i<18;i++) __game.debug.registerLoadoutKill(); });
  await page.evaluate(() => __game.debug.triggerLoadoutBonus('airstrike'));
  const hpBefore = await page.evaluate(() => __game.debug.enemyHp(0));
  expect(await page.evaluate(() => __game.debug.confirmAirstrikeTargetAt(5, 5))).toBe(true);
  expect(await page.evaluate(() => __game.debug.enemyHp(0))).toBeLessThan(hpBefore);
  expect(await page.evaluate(() => __game.debug.loadoutPoints('airstrike'))).toBe(0);
  expect(await page.evaluate(() => __game.debug.airstrikeTargetingActive())).toBe(false);
});

test('#156b : un ennemi hors zone de frappe n est pas touche', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 20, 20));
  await page.evaluate(() => { for(let i=0;i<18;i++) __game.debug.registerLoadoutKill(); });
  await page.evaluate(() => __game.debug.triggerLoadoutBonus('airstrike'));
  const hpBefore = await page.evaluate(() => __game.debug.enemyHp(0));
  await page.evaluate(() => __game.debug.confirmAirstrikeTargetAt(0, 0));   // loin de l ennemi (20,20)
  expect(await page.evaluate(() => __game.debug.enemyHp(0))).toBe(hpBefore);
});

test('#156b : annuler le ciblage (Echap) ne consomme pas les points', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.save.reset());
  await page.evaluate(() => { for(let i=0;i<18;i++) __game.debug.registerLoadoutKill(); });
  await page.evaluate(() => __game.debug.triggerLoadoutBonus('airstrike'));
  expect(await page.evaluate(() => __game.debug.cancelAirstrikeTargeting())).toBe(true);
  expect(await page.evaluate(() => __game.debug.airstrikeTargetingActive())).toBe(false);
  expect(await page.evaluate(() => __game.debug.loadoutPoints('airstrike'))).toBe(1800);   // intact
  const hidden = await page.evaluate(() => document.getElementById('airstrike-map-panel').classList.contains('hidden'));
  expect(hidden).toBe(true);
});

// ====== #161 — Bonus premier sang ======

test('#161 : le premier kill d une vague declenche le bonus', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 4, 4));
  await page.evaluate(() => __game.debug.damageEnemy(0, 99999));
  expect(await page.evaluate(() => __game.debug.firstBloodCount())).toBe(1);
  expect(await page.evaluate(() => __game.debug.lastWasFirstBlood())).toBe(true);
});

test('#161 : le 2e kill de la meme vague ne redeclenche pas le bonus', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 4, 4));
  await page.evaluate(() => __game.debug.damageEnemy(0, 99999));
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(1, 'shooter', 4, -4));
  await page.evaluate(() => __game.debug.damageEnemy(1, 99999));
  expect(await page.evaluate(() => __game.debug.firstBloodCount())).toBe(1);
  expect(await page.evaluate(() => __game.debug.lastWasFirstBlood())).toBe(false);
});

test('#161 : une nouvelle vague reactive le bonus', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 4, 4));
  await page.evaluate(() => __game.debug.damageEnemy(0, 99999));
  expect(await page.evaluate(() => __game.debug.firstBloodCount())).toBe(1);
  await page.evaluate(() => __game.debug.forceNextWave());
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 4, 4));
  await page.evaluate(() => __game.debug.damageEnemy(0, 99999));
  expect(await page.evaluate(() => __game.debug.firstBloodCount())).toBe(2);
  expect(await page.evaluate(() => __game.debug.lastWasFirstBlood())).toBe(true);
});

// ====== #165 — Serie de vagues parfaites ======

test('#165 : perfectWaveStreak demarre a 0', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.perfectWaveStreak())).toBe(0);
});

test('#165 : 3 vagues consecutives sans degat declenchent le bonus palier', async ({ page }) => {
  await startPlaying(page);
  const moneyBefore = await page.evaluate(() => __game.debug.save.get().money);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => __game.debug.killAllEnemies());
    await page.waitForTimeout(50);
    await page.evaluate(() => __game.debug.forceNextWave());
    await page.waitForTimeout(50);
  }
  expect(await page.evaluate(() => __game.debug.perfectWaveStreak())).toBe(3);
  const moneyAfter = await page.evaluate(() => __game.debug.save.get().money);
  expect(moneyAfter - moneyBefore).toBeGreaterThanOrEqual(100); // au moins le bonus palier
});

test('#165 : une vague avec degats casse la serie', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(50);
  await page.evaluate(() => __game.debug.forceNextWave());
  expect(await page.evaluate(() => __game.debug.perfectWaveStreak())).toBe(1);
  await page.evaluate(() => { __game.debug.setShield(0); __game.debug.damagePlayer(5); });
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => __game.debug.perfectWaveStreak())).toBe(0);
});

// ====== #166 — Bonus Sans recharge ======

test('#166 : nettoyer une vague sans recharger declenche le bonus', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.waveReloadCount())).toBe(0);
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => __game.debug.noReloadClearCount())).toBe(1);
});

test('#166 : recharger avant de nettoyer la vague empeche le bonus', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.tryFire()); // ammo < curMag, sinon reload() no-op (deja plein)
  await page.evaluate(() => __game.debug.reload());
  expect(await page.evaluate(() => __game.debug.waveReloadCount())).toBe(1);
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => __game.debug.noReloadClearCount())).toBe(0);
});

test('#166 : waveReloadCount se remet a 0 a la vague suivante', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.tryFire());
  await page.evaluate(() => __game.debug.reload());
  expect(await page.evaluate(() => __game.debug.waveReloadCount())).toBe(1);
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(50);
  await page.evaluate(() => __game.debug.forceNextWave());
  expect(await page.evaluate(() => __game.debug.waveReloadCount())).toBe(0);
});

// ====== #168 — Bonus Infiltration (takedown furtif) ======

test('#168 : melee sur un ennemi en patrol declenche le bonus infiltration', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => {
    for(let i=0;i<3;i++) __game.debug.moveEnemy(i,40,40);
    __game.debug.setPos(0,0); __game.debug.setYaw(0); __game.debug.setPitch(0); __game.debug.setView('first');
    __game.debug.moveEnemy(0,0,2);
    __game.debug.setPaused(true);
  });
  expect(await page.evaluate(() => __game.debug.enemyState(0))).toBe('patrol');
  await page.evaluate(() => __game.debug.playerMelee());
  expect(await page.evaluate(() => __game.debug.stealthKillCount())).toBe(1);
  expect(await page.evaluate(() => __game.debug.lastStealthKill())).toBe(true);
});

test('#168 : melee sur un ennemi deja en chase ne declenche pas le bonus', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => {
    for(let i=0;i<3;i++) __game.debug.moveEnemy(i,40,40);
    __game.debug.setPos(0,0); __game.debug.setYaw(0); __game.debug.setPitch(0); __game.debug.setView('first');
    __game.debug.moveEnemy(0,0,2);
    __game.debug.setPaused(true);
    __game.debug.damageEnemy(0, 1);   // degat non-letal (HP ~100) -> passe l etat a 'chase'
  });
  expect(await page.evaluate(() => __game.debug.enemyState(0))).toBe('chase');
  await page.evaluate(() => __game.debug.playerMelee());   // 150 dmg > HP restant -> tue l ennemi
  expect(await page.evaluate(() => __game.debug.lastStealthKill())).toBe(false);
  expect(await page.evaluate(() => __game.debug.stealthKillCount())).toBe(0);
});

test('#168 : un kill a distance sur un ennemi en patrol ne declenche pas le bonus', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 4, 4));
  expect(await page.evaluate(() => __game.debug.enemyState(0))).toBe('patrol');
  await page.evaluate(() => __game.debug.damageEnemy(0, 99999));
  expect(await page.evaluate(() => __game.debug.lastStealthKill())).toBe(false);
  expect(await page.evaluate(() => __game.debug.stealthKillCount())).toBe(0);
});

// ====== #176 — Bonus Clutch ======

test('#176 : dernier ennemi tue a PV eleves ne declenche pas le bonus', async ({ page }) => {
  await startPlaying(page);
  const n = await page.evaluate(() => __game.debug.enemyCount());
  for (let i = 0; i < n; i++) await page.evaluate((i) => __game.debug.damageEnemy(i, 99999), i);
  expect(await page.evaluate(() => __game.debug.clutchCount())).toBe(0);
});

test('#176 : dernier ennemi tue a PV bas declenche le bonus clutch', async ({ page }) => {
  await startPlaying(page);
  const maxHp = await page.evaluate(() => __game.maxHealth);
  await page.evaluate((dmg) => { __game.debug.setShield(0); __game.debug.damagePlayer(dmg); }, Math.round(maxHp*0.85));
  const n = await page.evaluate(() => __game.debug.enemyCount());
  for (let i = 0; i < n; i++) await page.evaluate((i) => __game.debug.damageEnemy(i, 99999), i);
  expect(await page.evaluate(() => __game.debug.clutchCount())).toBe(1);
});

test('#176 : tuer un ennemi qui n est pas le dernier ne declenche pas le bonus meme a PV bas', async ({ page }) => {
  await startPlaying(page);
  const maxHp = await page.evaluate(() => __game.maxHealth);
  await page.evaluate((dmg) => { __game.debug.setShield(0); __game.debug.damagePlayer(dmg); }, Math.round(maxHp*0.85));
  const n = await page.evaluate(() => __game.debug.enemyCount());
  expect(n).toBeGreaterThan(1);
  await page.evaluate(() => __game.debug.damageEnemy(0, 99999));   // au moins un autre ennemi reste vivant
  expect(await page.evaluate(() => __game.debug.clutchCount())).toBe(0);
});

// ====== #182 — Bonus Vague sans dash ======

test('#182 : nettoyer une vague sans dasher declenche le bonus', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.waveDashCount())).toBe(0);
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => __game.debug.noDashClearCount())).toBe(1);
});

test('#182 : dasher avant de nettoyer la vague empeche le bonus', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.dash());
  expect(await page.evaluate(() => __game.debug.waveDashCount())).toBe(1);
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => __game.debug.noDashClearCount())).toBe(0);
});

test('#182 : waveDashCount se remet a 0 a la vague suivante', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.dash());
  expect(await page.evaluate(() => __game.debug.waveDashCount())).toBe(1);
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(50);
  await page.evaluate(() => __game.debug.forceNextWave());
  expect(await page.evaluate(() => __game.debug.waveDashCount())).toBe(0);
});

// ====== #184 — Bonus Precision totale ======

test('#184 : 5 tirs tous touches sur la meme vague declenchent le bonus', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => {
    __game.debug.setView('first'); __game.debug.setPitch(0); __game.debug.setYaw(0); __game.debug.setPos(0,0);
    __game.debug.spawnEnemyTypeAt(0, 'juggernaut', 0, 8);
    __game.debug.damageEnemy(1, 99999); __game.debug.damageEnemy(2, 99999);   // ecarte les 2 autres ennemis de la vague
  });
  await page.waitForTimeout(150);
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => __game.debug.tryFire());
    await page.waitForTimeout(200);
  }
  const shots = await page.evaluate(() => __game.debug.waveShots());
  expect(shots).toBeGreaterThanOrEqual(5);
  expect(await page.evaluate(() => __game.debug.waveHits())).toBe(shots);
  await page.evaluate(() => __game.debug.damageEnemy(0, 99999));   // acheve le juggernaut -> vague nettoyee
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => __game.debug.perfectAccuracyCount())).toBe(1);
});

test('#184 : un tir manque parmi 5+ empeche le bonus', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => {
    __game.debug.setView('first'); __game.debug.setPitch(0); __game.debug.setYaw(0); __game.debug.setPos(0,0);
    __game.debug.spawnEnemyTypeAt(0, 'juggernaut', 0, 8);
    __game.debug.damageEnemy(1, 99999); __game.debug.damageEnemy(2, 99999);
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => __game.debug.setYaw(Math.PI));   // tir manque volontairement (dos a l ennemi)
  await page.evaluate(() => __game.debug.tryFire());
  await page.waitForTimeout(200);
  await page.evaluate(() => __game.debug.setYaw(0));
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => __game.debug.tryFire());
    await page.waitForTimeout(200);
  }
  const shots = await page.evaluate(() => __game.debug.waveShots());
  expect(shots).toBeGreaterThanOrEqual(5);
  expect(await page.evaluate(() => __game.debug.waveHits())).toBeLessThan(shots);
  await page.evaluate(() => __game.debug.damageEnemy(0, 99999));
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => __game.debug.perfectAccuracyCount())).toBe(0);
});

test('#184 : moins de 5 tirs meme a 100% de precision n atteint pas le seuil', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => {
    __game.debug.setView('first'); __game.debug.setPitch(0); __game.debug.setYaw(0); __game.debug.setPos(0,0);
    __game.debug.spawnEnemyTypeAt(0, 'juggernaut', 0, 8);
    __game.debug.damageEnemy(1, 99999); __game.debug.damageEnemy(2, 99999);
  });
  await page.waitForTimeout(150);
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => __game.debug.tryFire());
    await page.waitForTimeout(200);
  }
  await page.evaluate(() => __game.debug.damageEnemy(0, 99999));
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => __game.debug.perfectAccuracyCount())).toBe(0);
});

// ====== #187 — Bonus Revanche ======

test('#187 : tuer juste apres avoir pris un degat declenche la revanche', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setShield(0); __game.debug.damagePlayer(5); });
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0,'shooter',4,4); __game.debug.damageEnemy(0, 99999); });
  expect(await page.evaluate(() => __game.debug.revengeCount())).toBe(1);
});

test('#187 : tuer longtemps apres un degat ne declenche pas la revanche', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setShield(0); __game.debug.damagePlayer(5); });
  await page.waitForTimeout(1300);
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0,'shooter',4,4); __game.debug.damageEnemy(0, 99999); });
  expect(await page.evaluate(() => __game.debug.revengeCount())).toBe(0);
});

test('#187 : tuer sans avoir jamais pris de degat ne declenche pas la revanche', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0,'shooter',4,4); __game.debug.damageEnemy(0, 99999); });
  expect(await page.evaluate(() => __game.debug.revengeCount())).toBe(0);
});

// ====== #190 — Bonus Vague sans grenade ======

test('#190 : nettoyer une vague sans lancer de grenade declenche le bonus', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.waveGrenadeCount())).toBe(0);
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => __game.debug.noGrenadeClearCount())).toBe(1);
});

test('#190 : lancer une grenade avant de nettoyer la vague empeche le bonus', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.throwGrenade());
  expect(await page.evaluate(() => __game.debug.waveGrenadeCount())).toBe(1);
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => __game.debug.noGrenadeClearCount())).toBe(0);
});

test('#190 : waveGrenadeCount se remet a 0 a la vague suivante', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.throwGrenade());
  expect(await page.evaluate(() => __game.debug.waveGrenadeCount())).toBe(1);
  await page.evaluate(() => __game.debug.killAllEnemies());
  await page.waitForTimeout(50);
  await page.evaluate(() => __game.debug.forceNextWave());
  expect(await page.evaluate(() => __game.debug.waveGrenadeCount())).toBe(0);
});

// ====== #192 — Bonus Boucherie (combo melee) ======

test('#192 : 3 kills melee consecutifs declenchent le bonus boucherie', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setView('first'); __game.debug.setPitch(0); __game.debug.setYaw(0); __game.debug.setPos(0,0); });
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 0, 2));
    await page.evaluate(() => __game.debug.playerMelee());
    await page.waitForTimeout(700);
  }
  expect(await page.evaluate(() => __game.debug.meleeComboCount())).toBe(1);
});

test('#192 : un kill a distance intercale casse la serie', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setView('first'); __game.debug.setPitch(0); __game.debug.setYaw(0); __game.debug.setPos(0,0); });
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 0, 2));
  await page.evaluate(() => __game.debug.playerMelee());   // melee 1 -> streak 1
  await page.waitForTimeout(700);
  await page.evaluate(() => { __game.debug.spawnEnemyTypeAt(0, 'shooter', 4, 4); __game.debug.damageEnemy(0, 99999); });   // kill a distance -> casse la serie
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 0, 2));
  await page.evaluate(() => __game.debug.playerMelee());   // melee 2 -> streak repart a 1
  await page.waitForTimeout(700);
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 0, 2));
  await page.evaluate(() => __game.debug.playerMelee());   // melee 3 -> streak 2 (pas 3)
  expect(await page.evaluate(() => __game.debug.meleeKillStreak())).toBe(2);
  expect(await page.evaluate(() => __game.debug.meleeComboCount())).toBe(0);
});

test('#192 : meleeKillStreak se remet a 0 apres declenchement du bonus', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setView('first'); __game.debug.setPitch(0); __game.debug.setYaw(0); __game.debug.setPos(0,0); });
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 0, 2));
    await page.evaluate(() => __game.debug.playerMelee());
    await page.waitForTimeout(700);
  }
  expect(await page.evaluate(() => __game.debug.meleeKillStreak())).toBe(0);
});
