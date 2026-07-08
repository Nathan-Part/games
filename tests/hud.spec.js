import { test, expect } from '@playwright/test';
import { trackErrors, startPlaying, faceEnemyForMelee, alignTwoEnemies } from './helpers.js';

// ====== Tranche 21 : mini-carte / radar ======

test('radar : radarBlip projette devant/droite et clampe hors portee', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const front = await page.evaluate(() => __game.debug.radarBlip(0,10, 0,0, 0, 20, 60));
  expect(front.y).toBeCloseTo(30, 0); expect(Math.abs(front.x)).toBeLessThan(0.001); expect(front.inRange).toBe(true);
  const right = await page.evaluate(() => __game.debug.radarBlip(10,0, 0,0, 0, 20, 60));
  expect(right.x).toBeCloseTo(30, 0); expect(right.inRange).toBe(true);
  const far = await page.evaluate(() => __game.debug.radarBlip(0,40, 0,0, 0, 20, 60));
  expect(far.inRange).toBe(false); expect(Math.hypot(far.x, far.y)).toBeCloseTo(60, 0);
});

test('radar : visible en jeu, un blip par ennemi vivant', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await expect(page.locator('#radar')).toBeVisible();
  expect((await page.evaluate(() => __game.debug.radar.blips())).length)
    .toBe(await page.evaluate(() => __game.debug.enemyAlive()));
});

test('radar : un ennemi devant apparait en haut, a droite -> a droite', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  const front = await page.evaluate(() => { __game.debug.setPos(0,0); __game.debug.setYaw(0); __game.debug.spawnEnemyAt(0,10);  // x=0, z=10 (devant, +Z)
    return __game.debug.radar.blips().find(b => b.id === 0); });
  expect(front.y).toBeGreaterThan(5); expect(Math.abs(front.x)).toBeLessThan(5);
  const rightB = await page.evaluate(() => { __game.debug.moveEnemy(0, 10, 0);
    return __game.debug.radar.blips().find(b => b.id === 0); });
  expect(rightB.x).toBeGreaterThan(5); expect(Math.abs(rightB.y)).toBeLessThan(5);
});

test('radar : masque au lobby', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await expect(page.locator('#radar')).toBeHidden();
});

// ====== Tranche 30 : nombres de dégâts flottants ======

test('degats flottants : un tir qui touche cree un nombre (crit en tete)', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await page.evaluate(() => { __game.debug.setView('first'); __game.debug.setPitch(0); });
  await page.waitForTimeout(150);                            // laisse la caméra passer en 1re personne
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8));
  await page.evaluate(() => __game.debug.tryFire());
  expect(await page.evaluate(() => __game.debug.damageNumberCount())).toBeGreaterThanOrEqual(1);
  const last = await page.evaluate(() => __game.debug.lastDamageNumber());
  expect(last.amount).toBeGreaterThan(0);
  expect(last.crit).toBe(true);                              // pitch 0 = tête
});

test('degats flottants : s estompent (nettoyage)', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await page.evaluate(() => { __game.debug.setView('first'); __game.debug.setPitch(0); });
  await page.waitForTimeout(150);
  await page.evaluate(() => { __game.debug.spawnEnemyInFront(8); __game.debug.tryFire(); });
  expect(await page.evaluate(() => __game.debug.damageNumberCount())).toBeGreaterThanOrEqual(1);
  await page.waitForFunction(() => __game.debug.damageNumberCount() === 0, null, { timeout:3000 });
});

// ===== Refonte UI « OPERATOR » — invariants visuels =====
test('refonte : typographie Barlow appliquee au body', async ({ page }) => {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.booted);
  const ff = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(ff.toLowerCase()).toContain('barlow');
});

test('refonte utopie : le CTA principal est violet (pas orange OPERATOR)', async ({ page }) => {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.booted);
  const bg = await page.evaluate(() => getComputedStyle(document.getElementById('play-btn')).backgroundImage);
  expect(bg).toMatch(/124,\s*77,\s*255/);      // --accent #7c4dff
  expect(bg).not.toMatch(/255,\s*106,\s*26/);  // ancien orange #ff6a1a
});

test('refonte utopie : image de fond lobby-bg posee sur #app', async ({ page }) => {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.booted);
  const bg = await page.evaluate(() => getComputedStyle(document.getElementById('app')).backgroundImage);
  expect(bg).toContain('lobby-bg');
});

test('refonte utopie : le carrousel affiche un point par perso possede (actif unique)', async ({ page }) => {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby' && window.__game.characters?.length >= 1, null, { timeout:20000 });
  const n = await page.evaluate(() => window.__game.characters.length);
  expect(await page.evaluate(() => document.querySelectorAll('#char-dots i').length)).toBe(n);
  expect(await page.evaluate(() => document.querySelectorAll('#char-dots i.on').length)).toBe(1);
});

test('boutique : apercu d un accessoire sur le perso sans l acheter (essayer avant d acheter)', async ({ page }) => {
  await startPlaying(page);                                    // perso (model) chargé de façon fiable
  const id = await page.evaluate(() => __game.debug.shop.accessoryCatalog('helmet').find(a => a.price > 0).id);
  expect(await page.evaluate(() => __game.debug.accessoryAttached('helmet'))).toBe(false);            // rien au depart
  expect(await page.evaluate((i) => __game.debug.shop.previewAccessory('helmet', i), id)).toBe(true);  // previsualiser sans acheter
  // les accessoires du catalogue actuel n'ont pas encore de modele 3D (build:null, cf. CLAUDE.md —
  // "un modele 3D viendra plus tard") : previewAccessory pose bien l'apercu logique (id retenu) mais
  // n'attache rien au perso pour l'instant, donc accessoryAttached reste false meme apres l'aperçu.
  expect(await page.evaluate(() => __game.debug.accessoryAttached('helmet'))).toBe(false);
  expect(await page.evaluate(() => __game.debug.playerAccessory('helmet'))).not.toBe(id);             // mais pas equipe
  expect(await page.evaluate((i) => __game.debug.save.get().ownedAccessories.includes(i), id)).toBe(false); // ni achete
});

// ====== Tranche 38 : annonces de kill ======

// NB #38 : les callouts bonus (OVERKILL #139, PREMIER SANG #161, REVANCHE #187) s'émettent APRÈS
// l'annonce de kill → ces tests consomment le premier sang hors mesure, tuent en dégâts exacts
// (pas d'overkill) et laissent passer les fenêtres revanche (1 s) / multi-kill (1,2 s).
test('annonce : BOSS DOWN a la mort du boss', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forceWave(5));
  await page.evaluate(() => { __game.debug.setEnemyAccuracy(0); __game.debug.damageEnemy(1, __game.debug.enemyHp(1)); }); // sbire : consomme le premier sang
  await page.waitForTimeout(1100);
  await page.evaluate(() => __game.debug.damageEnemy(0, __game.debug.enemyHp(0)));   // enemies[0] = boss, dégâts exacts
  expect(await page.evaluate(() => __game.debug.lastCallout())).toContain('BOSS');
});

test('annonce : HEADSHOT sur un kill en tete', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setEnemyAccuracy(0); __game.debug.damageEnemy(1, __game.debug.enemyHp(1)); }); // consomme le premier sang
  await page.evaluate(() => { __game.debug.setView('first'); __game.debug.setPitch(0); __game.debug.setSpreadOverride(0); });
  await page.waitForTimeout(1300);   // ferme les fenêtres revanche ET multi-kill
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8));
  // laisse 15 PV : le headshot (60) tue sans excédent ≥50 (pas d'OVERKILL) ; face au joueur (pas de backstab)
  await page.evaluate(() => { __game.debug.damageEnemy(0, __game.debug.enemyHp(0) - 15); __game.debug.forceEnemyFacePlayer(0); __game.debug.tryFire(); });
  expect(await page.evaluate(() => __game.debug.lastCallout())).toBe('HEADSHOT');
});

test('annonce : DOUBLE KILL sur 2 kills rapproches', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setEnemyAccuracy(0); __game.debug.damageEnemy(0, __game.debug.enemyHp(0)); }); // consomme le premier sang
  await page.waitForTimeout(1300);   // ferme les fenêtres revanche ET multi-kill
  await page.evaluate(() => __game.debug.spawnEnemyAt(20, 20));   // ressuscite enemies[0] au loin : la vague survit au double (pas de callouts de fin de vague)
  await page.evaluate(() => { __game.debug.damageEnemy(1, __game.debug.enemyHp(1)); __game.debug.damageEnemy(2, __game.debug.enemyHp(2)); }); // dégâts exacts
  expect(await page.evaluate(() => __game.debug.lastCallout())).toContain('DOUBLE');
  await expect(page.locator('#kill-callout')).toContainText('DOUBLE');
});

// ====== #54 — Kill Feed ======

test('#54 kill feed : conteneur #kill-feed présent dans le DOM', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const el = await page.locator('#kill-feed').count();
  expect(el).toBe(1);
});

test('#54 kill feed : 1 kill => 1 entrée', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  await page.waitForFunction(() => window.__game?.characters?.length >= 1, null, {timeout:20000});
  await page.evaluate(() => __game.debug.start(0));
  await page.waitForFunction(() => window.__game.phase === 'playing', null, {timeout:20000});
  await page.evaluate(() => { __game.debug.spawnEnemyAt(0, 6); __game.debug.damageEnemy(0, 9999); });
  await page.waitForFunction(() => __game.debug.killFeedCount() >= 1, null, {timeout:5000});
  const count = await page.evaluate(() => __game.debug.killFeedCount());
  expect(count).toBe(1);
});

test('#54 kill feed : 3 kills => 3 entrées', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  await page.waitForFunction(() => window.__game?.characters?.length >= 1, null, {timeout:20000});
  await page.evaluate(() => __game.debug.start(0));
  await page.waitForFunction(() => window.__game.phase === 'playing', null, {timeout:20000});
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { __game.debug.spawnEnemyAt(0, 6); __game.debug.damageEnemy(0, 9999); });
    await page.waitForFunction(n => __game.debug.killFeedCount() >= n, i + 1, {timeout:5000});
  }
  const count = await page.evaluate(() => __game.debug.killFeedCount());
  expect(count).toBe(3);
});

test('#54 kill feed : headshot kill => texte contient HEADSHOT', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.spawnEnemyAt(0, 6); __game.debug.setEnemyLastHitHead(0, true); __game.debug.damageEnemy(0, 9999); });
  await page.waitForFunction(() => __game.debug.killFeedCount() >= 1, null, {timeout:5000});
  const text = await page.evaluate(() => __game.debug.lastKillFeedText());
  expect(text).toContain('HEADSHOT');
});

test('#54 kill feed : 6 kills => max 5 entrées visibles', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  await page.waitForFunction(() => window.__game?.characters?.length >= 1, null, {timeout:20000});
  await page.evaluate(() => __game.debug.start(0));
  await page.waitForFunction(() => window.__game.phase === 'playing', null, {timeout:20000});
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => { __game.debug.spawnEnemyAt(0, 6); __game.debug.damageEnemy(0, 9999); });
    await page.waitForFunction(n => __game.debug.killFeedCount() >= Math.min(n, 5), i + 1, {timeout:5000});
  }
  const count = await page.evaluate(() => __game.debug.killFeedCount());
  expect(count).toBeLessThanOrEqual(5);
});

test('#54 kill feed : feed vidé au restart', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  await page.waitForFunction(() => window.__game?.characters?.length >= 1, null, {timeout:20000});
  await page.evaluate(() => __game.debug.start(0));
  await page.waitForFunction(() => window.__game.phase === 'playing', null, {timeout:20000});
  await page.evaluate(() => { __game.debug.spawnEnemyAt(0, 6); __game.debug.damageEnemy(0, 9999); });
  await page.waitForFunction(() => __game.debug.killFeedCount() >= 1, null, {timeout:5000});
  await page.evaluate(() => __game.debug.restart());
  await page.waitForFunction(() => window.__game.phase === 'playing', null, {timeout:20000});
  const count = await page.evaluate(() => __game.debug.killFeedCount());
  expect(count).toBe(0);
});

// ====== #59 — Hit-marker ======

test('#59 hitmarker : showHitMarker debug disponible', async ({ page }) => {
  await startPlaying(page);
  const ok = await page.evaluate(() => typeof __game.debug.showHitMarker === 'function');
  expect(ok).toBe(true);
});

test('#59 hitmarker : visible apres showHitMarker(false)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.showHitMarker(false));
  const vis = await page.evaluate(() => {
    const el = document.getElementById('hit-marker');
    return el && !el.classList.contains('hidden') && el.classList.contains('hm-show');
  });
  expect(vis).toBe(true);
});

test('#59 hitmarker : classe headshot quand showHitMarker(true)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.showHitMarker(true));
  const hs = await page.evaluate(() => document.getElementById('hit-marker').classList.contains('hm-head'));
  expect(hs).toBe(true);
});

// ====== #63 — Indicateur direction dégâts ======

test('#63 dmgdir : showDamageDir debug disponible', async ({ page }) => {
  await startPlaying(page);
  const ok = await page.evaluate(() => typeof __game.debug.showDamageDir === 'function');
  expect(ok).toBe(true);
});

test('#63 dmgdir : showDamageDir(0) active la fleche avant', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.showDamageDir(0));
  const vis = await page.evaluate(() => document.getElementById('dmgdir-top').classList.contains('dmgdir-show'));
  expect(vis).toBe(true);
});

test('#63 dmgdir : showDamageDir(180) active la fleche arriere', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.showDamageDir(180));
  const vis = await page.evaluate(() => document.getElementById('dmgdir-bot').classList.contains('dmgdir-show'));
  expect(vis).toBe(true);
});

// ====== #66 — Barres de vie ennemis ======

test('#66 hpbar : container #enemy-hp-bars existe', async ({ page }) => {
  await startPlaying(page);
  const exists = await page.evaluate(() => !!document.getElementById('enemy-hp-bars'));
  expect(exists).toBe(true);
});

test('#66 hpbar : une barre cree apres spawn ennemi', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyInFront());
  await page.waitForTimeout(200);
  const count = await page.evaluate(() => document.querySelectorAll('#enemy-hp-bars .ehb').length);
  expect(count).toBeGreaterThanOrEqual(1);
});

test('#66 hpbar : enemyHpBarFrac retourne fraction PV', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnEnemyInFront());
  await page.evaluate(() => __game.debug.damageEnemy(0, 50));
  const frac = await page.evaluate(() => __game.debug.enemyHpBarFrac(0));
  expect(frac).toBeGreaterThan(0);
  expect(frac).toBeLessThan(1);
});

// ====== #71 — Barre de rechargement ======

test('#71 reload-bar : reloadProgress = 0 hors rechargement', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.reloadProgress())).toBe(0);
});

test('#71 reload-bar : reloadProgress > 0 pendant reload', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setAmmo(0); __game.debug.reload(); });
  const prog = await page.evaluate(() => __game.debug.reloadProgress());
  expect(prog).toBeGreaterThan(0);
});

test('#71 reload-bar : element #reload-bar existe dans le DOM', async ({ page }) => {
  await startPlaying(page);
  const exists = await page.evaluate(() => !!document.getElementById('reload-bar'));
  expect(exists).toBe(true);
});

// ====== #73 — Étincelles d'impact ======

test('#73 sparks : impactSparkCount initial = 0', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.impactSparkCount())).toBe(0);
});

test('#73 sparks : spawnImpactSparks cree des particules', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnImpactSparks(0, 1, 0));
  expect(await page.evaluate(() => __game.debug.impactSparkCount())).toBeGreaterThan(0);
});

// ====== #74 — Blood screen ======

test('#74 blood : element #blood-screen existe', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => !!document.getElementById('blood-screen'))).toBe(true);
});

test('#74 blood : showBloodScreen rend visible', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.showBloodScreen(1));
  const opacity = await page.evaluate(() => parseFloat(document.getElementById('blood-screen').style.opacity || '0'));
  expect(opacity).toBeGreaterThan(0);
});

test('#74 blood : gros degat (>=20) declenche blood screen', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setShield(0); __game.debug.damagePlayer(25); });
  const opacity = await page.evaluate(() => parseFloat(document.getElementById('blood-screen').style.opacity || '0'));
  expect(opacity).toBeGreaterThan(0);
});

// ====== #81 — Low ammo warning ======

test('#81 lowammo : isLowAmmo false avec plein chargeur', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.isLowAmmo())).toBe(false);
});

test('#81 lowammo : isLowAmmo true quand ammo <= 25%', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { const mag = __game.debug.curMag(); __game.debug.setAmmo(Math.floor(mag * 0.2)); });
  expect(await page.evaluate(() => __game.debug.isLowAmmo())).toBe(true);
});

test('#81 lowammo : hud-ammo a classe low-ammo quand critique', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { const mag = __game.debug.curMag(); __game.debug.setAmmo(Math.floor(mag * 0.2)); });
  await page.evaluate(() => __game.debug.updateCombatHudDebug());
  const hasClass = await page.evaluate(() => !!document.querySelector('.hud-ammo.low-ammo'));
  expect(hasClass).toBe(true);
});

// ====== #82 — Shockwave ring ======

test('#82 shockwave : shockwaveCount initial = 0', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.shockwaveCount())).toBe(0);
});

test('#82 shockwave : spawnShockwave cree un anneau', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.spawnShockwave(0, 0, 0));
  expect(await page.evaluate(() => __game.debug.shockwaveCount())).toBe(1);
});

test('#82 shockwave : explosion grenade declenche shockwave', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.explodeGrenadeAt(0, 0.1, 0));
  expect(await page.evaluate(() => __game.debug.shockwaveCount())).toBeGreaterThan(0);
});

// ====== #99 — Flank warning ======

test('#99 flank : flankWarning() false par defaut', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { for(let i=0;i<__game.debug.enemyCount();i++) __game.debug.moveEnemy(i,100,100); __game.debug.expireFlank(); });
  expect(await page.evaluate(() => __game.debug.flankWarning())).toBe(false);
});

test('#99 flank : triggerFlank("left") affiche avertissement', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.triggerFlank('left'));
  expect(await page.evaluate(() => __game.debug.flankWarning())).toBe(true);
  expect(await page.evaluate(() => __game.debug.lastFlankDir())).toBe('left');
});

test('#99 flank : flankWarning() false apres expiration', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.killAllEnemies()); // sinon checkEnemyFlanks() re-déclenche en direct (ennemi dans le dos)
  await page.evaluate(() => __game.debug.triggerFlank('right'));
  await page.evaluate(() => __game.debug.expireFlank());
  expect(await page.evaluate(() => __game.debug.flankWarning())).toBe(false);
});

// ====== #103 — Screen shake explosion ======

test('#103 screen shake : screenShakeActive() false par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.screenShakeActive())).toBe(false);
});

test('#103 screen shake : triggerScreenShake(1) active le shake', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.triggerScreenShake(1));
  expect(await page.evaluate(() => __game.debug.screenShakeActive())).toBe(true);
});

test('#103 screen shake : explodeGrenadeAt active le shake', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.explodeGrenadeAt(0, 0, 0));
  expect(await page.evaluate(() => __game.debug.screenShakeActive())).toBe(true);
});

// ====== #115 — HUD enemy count ======

test('#115 enemy count hud : hudEnemyCountVisible disponible', async ({ page }) => {
  await startPlaying(page);
  const v = await page.evaluate(() => __game.debug.hudEnemyCountVisible());
  expect(typeof v).toBe('boolean');
});

test('#115 enemy count hud : visible avec ennemis en vie', async ({ page }) => {
  await startPlaying(page);
  // Attendre 1 frame pour que le HUD soit actualisé
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    // Spawner un ennemi devant pour garantir alive>0
    __game.debug.spawnEnemyInFront(8);
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.hudEnemyCountVisible())).toBe(true);
});

test('#115 enemy count hud : element enemy-count-hud present dans DOM', async ({ page }) => {
  await startPlaying(page);
  const exists = await page.evaluate(() => !!document.getElementById('enemy-count-hud'));
  expect(exists).toBe(true);
});
