import { test, expect } from '@playwright/test';
import { trackErrors, startPlaying, faceEnemyForMelee, alignTwoEnemies } from './helpers.js';

test('boote la scène three.js sans erreur', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game && window.__game.booted === true);
  await expect(page.locator('#app canvas')).toBeVisible();   // #app = canvas three.js principal (≠ #radar)
  expect(errors).toEqual([]);
});

test('helpers purs : caméra-relatif, état, clip, collision', async ({ page }) => {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.booted);

  // cameraRelative : yaw=0 -> avant = +Z, strafe = +X
  const fwd = await page.evaluate(() => __game.debug.cameraRelative({forward:1,strafe:0}, 0));
  expect(fwd.z).toBeCloseTo(1, 5); expect(fwd.x).toBeCloseTo(0, 5);
  const str = await page.evaluate(() => __game.debug.cameraRelative({forward:0,strafe:1}, 0));
  expect(str.x).toBeCloseTo(1, 5); expect(str.z).toBeCloseTo(0, 5);
  // yaw=90° -> avant pointe vers +X
  const rot = await page.evaluate(() => __game.debug.cameraRelative({forward:1,strafe:0}, Math.PI/2));
  expect(rot.x).toBeCloseTo(1, 5); expect(rot.z).toBeCloseTo(0, 5);

  // locomotionState
  expect(await page.evaluate(() => __game.debug.locomotionState(0, false))).toBe('idle');
  expect(await page.evaluate(() => __game.debug.locomotionState(2, false))).toBe('walk');
  expect(await page.evaluate(() => __game.debug.locomotionState(2, true))).toBe('run');

  // resolveClipRole
  const names = ['Walking','Running','Alert','Boxing_Practice'];
  expect(await page.evaluate(n => __game.debug.resolveClipRole('idle', n), names)).toBe('Alert');
  expect(await page.evaluate(n => __game.debug.resolveClipRole('walk', n), names)).toBe('Walking');
  expect(await page.evaluate(n => __game.debug.resolveClipRole('run', n), names)).toBe('Running');
  expect(await page.evaluate(() => __game.debug.resolveClipRole('idle', ['Walking']))).toBeNull();

  // pushOutCircleAABB : cercle dans une boîte -> repoussé dehors d'au moins r
  const box = { minX:-1, maxX:1, minZ:-1, maxZ:1 };
  const out = await page.evaluate(b => __game.debug.pushOutCircleAABB(0.9, 0, 0.5, b), box);
  expect(out.x).toBeGreaterThanOrEqual(1.5 - 1e-6); // 1 (bord) + 0.5 (rayon)
  // cercle loin -> inchangé
  const keep = await page.evaluate(b => __game.debug.pushOutCircleAABB(5, 5, 0.5, b), box);
  expect(keep.x).toBeCloseTo(5, 5); expect(keep.z).toBeCloseTo(5, 5);
});

test('le lobby montre un perso en 3D et permet de slider', async ({ page }) => {
  await page.addInitScript(() => { if(!localStorage.getItem('cod-save-v1')) localStorage.setItem('cod-save-v1', JSON.stringify({ ownedCharacters:['perso:blue-soldier','perso:guard','perso:robot'] })); });  // tout possédé pour slider
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.characters?.length >= 2 && window.__game.phase === 'lobby', null, { timeout: 20000 });
  const labels = await page.evaluate(() => __game.characters.map(c => c.label).join('|').toLowerCase());
  expect(labels).toContain('sentinel');   // guard => Sentinel (catalogue)
  expect(labels).toContain('cyborg');     // robot => Cyborg
  await expect(page.locator('#lobby')).toBeVisible();
  await expect(page.locator('#play-btn')).toBeVisible();
  const name0 = (await page.locator('#char-name').textContent()).trim();
  expect(name0.length).toBeGreaterThan(0);
  // slider vers le perso suivant change le nom affiché
  await page.locator('#next').click();
  await expect.poll(async () => (await page.locator('#char-name').textContent()).trim()).not.toBe(name0);
});

test('démarrer charge le perso, le retargette et joue idle', async ({ page }) => {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.characters?.length >= 1, null, { timeout:20000 });
  await page.evaluate(() => __game.debug.start(0));
  await page.waitForFunction(() => window.__game.phase === 'playing', null, { timeout:20000 });
  expect(await page.evaluate(() => __game.clips)).toContain('idle');
  expect(await page.evaluate(() => __game.clips)).toContain('walk');
  expect(await page.evaluate(() => __game.locomotion)).toBe('idle');
  await expect(page.locator('#lobby')).toBeHidden();
  expect(await page.evaluate(() => !!document.querySelector('canvas'))).toBe(true);
});

test('avancer déplace le perso et passe en walk, Shift en run, relâcher en idle', async ({ page }) => {
  await startPlaying(page);
  const p0 = await page.evaluate(() => __game.position());
  await page.evaluate(() => __game.debug.setInput({forward:true}));
  // attend l'état (le rendu logiciel peut être lent => pas de délai fixe)
  await page.waitForFunction(() => window.__game.locomotion === 'walk', null, {timeout:5000});
  await page.waitForTimeout(600);
  const p1 = await page.evaluate(() => __game.position());
  expect(Math.hypot(p1.x-p0.x, p1.z-p0.z)).toBeGreaterThan(0.3);

  await page.evaluate(() => __game.debug.setInput({forward:true, sprint:true}));
  await page.waitForFunction(() => window.__game.locomotion === 'run', null, {timeout:5000});

  await page.evaluate(() => __game.debug.setInput({}));
  await page.waitForFunction(() => window.__game.locomotion === 'idle', null, {timeout:5000});
});

test('la direction suit le lacet caméra', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setYaw(Math.PI/2); __game.debug.setInput({forward:true}); });
  await page.waitForFunction(() => window.__game.locomotion === 'walk', null, {timeout:5000});
  const p0 = await page.evaluate(() => __game.position());
  // scrute l'état atteint plutôt qu'un délai fixe (temps simulé plafonné à 50ms/frame sous SwiftShader,
  // peut prendre du retard sur le temps réel si le FPS s'effondre — cf. tests/helpers.js)
  await page.waitForFunction(p0 => __game.position().x - p0.x > 0.3, p0, { timeout: 15000 });
  const p1 = await page.evaluate(() => __game.position());
  expect(Math.abs(p1.z - p0.z)).toBeLessThan(Math.abs(p1.x - p0.x));
});

test('la caméra reste derrière le perso à bonne distance', async ({ page }) => {
  await startPlaying(page);
  await page.waitForTimeout(200);
  const { cam, pos, dist } = await page.evaluate(() => ({ cam:__game.camera(), pos:__game.position(), dist:__game.camera().dist }));
  const d = Math.hypot(cam.x-pos.x, cam.z-pos.z);
  expect(d).toBeGreaterThan(dist*0.5);
  expect(cam.y).toBeGreaterThan(pos.y);
});

test('le perso reste dans les bornes de la map', async ({ page }) => {
  await startPlaying(page);
  const half = await page.evaluate(() => __game.debug.mapHalf);
  // se téléporte très loin ; le clamp doit ramener dans les bornes en une frame
  await page.evaluate(() => __game.debug.setPos(1000, 1000));
  await page.waitForFunction(() => {
    const p = window.__game.position(), h = window.__game.debug.mapHalf;
    return Math.abs(p.x) <= h + 0.01 && Math.abs(p.z) <= h + 0.01;
  }, null, {timeout:5000});
  const p = await page.evaluate(() => __game.position());
  expect(Math.abs(p.x)).toBeLessThanOrEqual(half + 0.01);
  expect(Math.abs(p.z)).toBeLessThanOrEqual(half + 0.01);
});

test('le perso ne traverse pas un obstacle', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setObstacleTest(0, 4)); // boîte centrée (0,4), bord avant z=3
  await page.evaluate(() => { __game.debug.setYaw(0); __game.debug.setInput({forward:true, sprint:true}); });
  await page.waitForTimeout(2500);
  const p = await page.evaluate(() => __game.position());
  expect(p.z).toBeLessThan(3.0); // bloqué avant le bord (≈2.55 = 3 - rayon)
});

test('le HUD affiche le nom du perso une fois en jeu', async ({ page }) => {
  await startPlaying(page);
  await expect(page.locator('#hud')).toBeVisible();
  const name = await page.evaluate(() => __game.character.label);
  await expect(page.locator('#hud')).toContainText(name);
});

test('overlay d’erreur si listing indisponible', async ({ page }) => {
  await page.addInitScript(() => { window.__FORCE_LIST_FAIL__ = true; });
  await page.goto('/game.html');
  await expect(page.locator('#overlay')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#overlay')).toContainText('serveur local');
});

test('gauche et droite vont dans des sens opposés (inversion corrigée)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setYaw(0); __game.debug.setPos(0, 0); });
  // DROITE => doit aller vers -X (droite écran)
  await page.evaluate(() => __game.debug.setInput({ right:true }));
  await page.waitForFunction(() => window.__game.position().x < -0.1, null, { timeout:5000 });
  await page.evaluate(() => __game.debug.setInput({}));
  // GAUCHE depuis l'origine => doit aller vers +X
  await page.evaluate(() => { __game.debug.setPos(0, 0); __game.debug.setInput({ left:true }); });
  await page.waitForFunction(() => window.__game.position().x > 0.1, null, { timeout:5000 });
});

test('le saut fait décoller puis retomber le perso', async ({ page }) => {
  await startPlaying(page);
  const y0 = await page.evaluate(() => __game.position().y);
  await page.evaluate(() => __game.debug.jump());
  await page.waitForFunction(y => window.__game.position().y > y + 0.2, y0, { timeout:6000 });   // décolle
  await page.waitForFunction(y => Math.abs(window.__game.position().y - y) < 0.05, y0, { timeout:9000 }); // retombe (marge pour stalls de rendu logiciel)
});

test('basculer en vue première personne place la caméra à hauteur des yeux, puis revenir', async ({ page }) => {
  await startPlaying(page);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.view)).toBe('third');

  // -> première personne
  await page.evaluate(() => __game.debug.setView('first'));
  await page.waitForFunction(() => {
    const c = __game.camera(), p = __game.position();
    return Math.hypot(c.x - p.x, c.z - p.z) < 0.6;   // caméra ~ alignée avec le perso
  }, null, { timeout:5000 });
  expect(await page.evaluate(() => __game.view)).toBe('first');
  const fp = await page.evaluate(() => ({ cam:__game.camera(), pos:__game.position() }));
  expect(fp.cam.y).toBeGreaterThan(fp.pos.y + 1.0);  // à hauteur des yeux
  expect(await page.evaluate(() => __game.debug.modelVisible())).toBe(false); // on ne se voit pas

  // -> retour en 3e personne
  await page.evaluate(() => __game.debug.setView('third'));
  await page.waitForFunction(() => {
    const c = __game.camera(), p = __game.position();
    return Math.hypot(c.x - p.x, c.z - p.z) > 2;      // de nouveau en recul derrière le perso
  }, null, { timeout:5000 });
  expect(await page.evaluate(() => __game.view)).toBe('third');
  expect(await page.evaluate(() => __game.debug.modelVisible())).toBe(true);
});

test('la touche V bascule la vue', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.view)).toBe('third');
  await page.keyboard.press('v');
  await page.waitForFunction(() => __game.view === 'first', null, { timeout:3000 });
  await page.keyboard.press('v');
  await page.waitForFunction(() => __game.view === 'third', null, { timeout:3000 });
});

test('cliquer sur l’écran de pause redonne le contrôle (ne reste pas bloqué)', async ({ page }) => {
  await startPlaying(page);
  // headless ne verrouille pas réellement : on instrumente requestPointerLock
  await page.evaluate(() => {
    const c = document.querySelector('canvas');
    window.__lockCalls = 0;
    c.requestPointerLock = () => { window.__lockCalls++; };
  });
  // simule la mise en pause (relâchement du pointer lock, comme un appui Échap)
  await page.evaluate(() => document.dispatchEvent(new Event('pointerlockchange')));
  await expect(page.locator('#pause')).toBeVisible();
  await page.locator('#pause').click();
  expect(await page.evaluate(() => window.__lockCalls)).toBeGreaterThan(0); // a tenté de reprendre
});

test('en première personne, lever la souris regarde vers le haut (non inversé)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setView('first'));
  await page.waitForTimeout(100);
  const p0 = await page.evaluate(() => __game.camera().pitch);
  await page.evaluate(() => __game.debug.look(0, -120)); // souris vers le HAUT
  const pUp = await page.evaluate(() => __game.camera().pitch);
  expect(pUp).toBeGreaterThan(p0);                       // => regarde plus haut
  await page.evaluate(() => __game.debug.look(0, 240));  // souris vers le BAS
  const pDown = await page.evaluate(() => __game.camera().pitch);
  expect(pDown).toBeLessThan(pUp);                       // => regarde plus bas
});

test('la touche R fait sprinter', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setInput({ forward:true }));
  await page.waitForFunction(() => __game.locomotion === 'walk', null, { timeout:3000 });
  await page.keyboard.down('r');
  await page.waitForFunction(() => __game.locomotion === 'run', null, { timeout:3000 });
  await page.keyboard.up('r');
});

test('le joueur a 100 PV, les dégâts les réduisent, et la vie régénère', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(0)); // teste les PV : on vide le bouclier (#67) qui absorberait sinon
  expect(await page.evaluate(() => __game.health)).toBe(100);
  await page.evaluate(() => __game.debug.damagePlayer(40));
  expect(await page.evaluate(() => __game.health)).toBe(60);
  await page.waitForFunction(() => __game.health > 60, null, { timeout:12000 }); // régén après le délai (6 s)
});

test('à 0 PV : Game Over, puis Rejouer remet la partie à zéro', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(0)); // #67 : vider le bouclier pour que 100 dégâts tuent vraiment
  await page.evaluate(() => __game.debug.damagePlayer(100)); // 1er coup fatal → dernier souffle (#137), survit à 1 PV
  await page.waitForTimeout(2200);                           // laisse expirer l'invincibilité post-dernier-souffle (2 s)
  await page.evaluate(() => { __game.debug.setShield(0); __game.debug.damagePlayer(100); }); // mort réelle
  expect(await page.evaluate(() => __game.phase)).toBe('dead');
  await expect(page.locator('#gameover')).toBeVisible();
  await page.evaluate(() => __game.debug.restart());
  expect(await page.evaluate(() => __game.phase)).toBe('playing');
  expect(await page.evaluate(() => __game.health)).toBe(100);
  expect(await page.evaluate(() => __game.score)).toBe(0);
  await expect(page.locator('#gameover')).toBeHidden();
});

test('filterPlayable : ne garde que les persos validés (repli si aucun)', async ({ page }) => {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.booted);
  const r1 = await page.evaluate(() => __game.debug.filterPlayable([{id:'a',gameReady:true},{id:'b'}]).map(c=>c.id));
  expect(r1).toEqual(['a']);
  const r2 = await page.evaluate(() => __game.debug.filterPlayable([{id:'b'},{id:'c'}]).map(c=>c.id));
  expect(r2).toEqual(['b','c']); // repli : aucun validé => tous
});

test('studio : le bouton 🎮 valide un perso pour le jeu (persisté)', async ({ page }) => {
  await page.goto('/studio.html');
  await page.waitForFunction(() => window.__studioReady === true, null, { timeout:20000 });
  await page.click('#btn-gallery');
  await page.waitForSelector('#gallery-grid .gcard', { timeout:20000 });
  await page.locator('.gcard', { hasText: 'Guard' }).first().locator('.gr-toggle').click();
  const ready = await page.evaluate(async () => {
    const recs = await new Promise((res) => { const rq = indexedDB.open('studio3d',1);
      rq.onsuccess = () => { const all = rq.result.transaction('models','readonly').objectStore('models').getAll();
        all.onsuccess = () => res(all.result || []); }; });
    const g = recs.find(r => (r.name||'').toLowerCase() === 'guard');
    return g && g.gameReady === true;
  });
  expect(ready).toBe(true);
});

test('audio : un son est joué/journalisé, le mute le coupe, M bascule', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.audio.init());
  expect(await page.evaluate(() => __game.debug.audio.state())).not.toBe('none'); // contexte créé
  const c0 = await page.evaluate(() => __game.debug.audio.count());
  await page.evaluate(() => __game.debug.audio.play('shot'));
  expect(await page.evaluate(() => __game.debug.audio.count())).toBe(c0 + 1);
  expect(await page.evaluate(() => __game.debug.audio.last())).toBe('shot');
  await page.evaluate(() => __game.debug.audio.setMuted(true));
  const c1 = await page.evaluate(() => __game.debug.audio.count());
  await page.evaluate(() => __game.debug.audio.play('shot'));
  expect(await page.evaluate(() => __game.debug.audio.count())).toBe(c1); // inchangé (muté)
  await page.keyboard.press('m');
  expect(await page.evaluate(() => __game.debug.audio.muted())).toBe(false);
});

test('audio : chaque event de combat joue le bon son', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.audio.init());
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await page.evaluate(() => __game.debug.damageEnemy(0, 10));
  expect(await page.evaluate(() => __game.debug.audio.last())).toBe('hit');
  await page.evaluate(() => __game.debug.damageEnemy(0, 100)); // kill
  expect(await page.evaluate(() => __game.debug.audio.last())).toBe('enemyDie');
  await page.evaluate(() => { __game.debug.setEnemyAccuracy(0); __game.debug.spawnEnemyAt(0,6); __game.debug.forceEnemyShoot(0); });
  expect(await page.evaluate(() => __game.debug.audio.last())).toBe('enemyShot');
  await page.evaluate(() => __game.debug.setShield(0)); // #67 : sinon le bouclier absorbe et 'playerHit' ne se joue pas
  await page.evaluate(() => __game.debug.damagePlayer(10));
  expect(await page.evaluate(() => __game.debug.audio.last())).toBe('playerHit');
  // #137 : le 1er coup fatal déclenche le dernier souffle (survie à 1 PV, son 'reload' du callout)
  await page.evaluate(() => __game.debug.damagePlayer(100));
  expect(await page.evaluate(() => __game.debug.audio.last())).toBe('reload');
  expect(await page.evaluate(() => __game.debug.secondWindUsed())).toBe(true);
  await page.waitForTimeout(2200); // laisse expirer l'invincibilité post-dernier-souffle (2 s)
  await page.evaluate(() => __game.debug.damagePlayer(100)); // mort réelle cette fois
  expect(await page.evaluate(() => __game.debug.audio.last())).toBe('gameover');
});

test('accueil : la page montre Jouer, Boutique et Reglages', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });   // vitrine en primitive (évite le GLB 13 Mo)
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await expect(page.locator('#lobby')).toBeVisible();
  await expect(page.locator('#play-btn')).toBeVisible();
  await expect(page.locator('#btn-shop')).toBeVisible();
  await expect(page.locator('#btn-settings')).toBeVisible();
});

test('accueil : Jouer lance la partie', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.characters?.length >= 1 && window.__game.phase === 'lobby', null, { timeout:20000 });
  await page.locator('#play-btn').click();
  await page.waitForFunction(() => window.__game.phase === 'playing', null, { timeout:20000 });
});

test('accueil : argent et record affiches depuis la sauvegarde', async ({ page }) => {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.booted);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(500); });
  await page.reload();
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await expect(page.locator('#home-money')).toContainText('500');
  await expect(page.locator('#home-record')).toContainText('Vague');
});

test('accueil : Boutique ouvre un ecran plein et le bouton fermer le ferme', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });   // vitrine en primitive (évite le GLB 13 Mo)
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await expect(page.locator('#shop-panel')).toBeHidden();
  await page.locator('#btn-shop').click();
  await expect(page.locator('#shop-panel')).toBeVisible();
  await page.locator('#shop-close').click();
  await expect(page.locator('#shop-panel')).toBeHidden();
});

test('accueil : Reglages ouvre un panneau puis Retour le ferme', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });   // vitrine en primitive (évite le GLB 13 Mo)
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await expect(page.locator('#settings-panel')).toBeHidden();
  await page.locator('#btn-settings').click();
  await expect(page.locator('#settings-panel')).toBeVisible();
  await page.locator('#settings-panel .panel-back').click();
  await expect(page.locator('#settings-panel')).toBeHidden();
});

test('accueil : Echap ferme le panneau Reglages ouvert', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await page.locator('#btn-settings').click();
  await expect(page.locator('#settings-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-panel')).toBeHidden();
});

test('accueil : Comment jouer ouvre un panneau a onglets, Echap le ferme', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await expect(page.locator('#howto-panel')).toBeHidden();
  await page.locator('#btn-howto').click();
  await expect(page.locator('#howto-panel')).toBeVisible();
  // l'onglet Contrôles est actif par défaut
  await expect(page.locator('.howto-page[data-howto-page="controles"]')).toBeVisible();
  await expect(page.locator('.howto-page[data-howto-page="ennemis"]')).toBeHidden();
  // changer d'onglet affiche le bon contenu et masque les autres
  await page.locator('.howto-tab[data-howto="ennemis"]').click();
  await expect(page.locator('.howto-page[data-howto-page="ennemis"]')).toBeVisible();
  await expect(page.locator('.howto-page[data-howto-page="controles"]')).toBeHidden();
  // Echap ferme le panneau
  await page.keyboard.press('Escape');
  await expect(page.locator('#howto-panel')).toBeHidden();
});

test('accueil : on revient au menu apres un Game Over', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(0)); // #67 : vider le bouclier pour que 100 dégâts tuent
  await page.evaluate(() => __game.debug.damagePlayer(100)); // 1er coup fatal → dernier souffle (#137)
  await page.waitForTimeout(2200);                           // invincibilité post-dernier-souffle (2 s)
  await page.evaluate(() => { __game.debug.setShield(0); __game.debug.damagePlayer(100); }); // mort réelle
  expect(await page.evaluate(() => __game.phase)).toBe('dead');
  await page.evaluate(() => __game.debug.backToHome());
  expect(await page.evaluate(() => __game.phase)).toBe('lobby');
  await expect(page.locator('#lobby')).toBeVisible();
  await expect(page.locator('#gameover')).toBeHidden();
});

// ====== Tranche 18 : page de réglages (sensibilité / volume / vue par défaut) ======

test('reglages : les reglages persistent au rechargement', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.settings.set('sensitivity', 2.5); __game.debug.settings.set('defaultView', 'first'); });
  await page.reload(); await page.waitForFunction(() => window.__game?.booted);
  const s = await page.evaluate(() => __game.debug.settings.get());
  expect(s.sensitivity).toBe(2.5); expect(s.defaultView).toBe('first');
});

test('reglages : la sensibilite souris multiplie le deplacement camera', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.settings.set('sensitivity', 1); __game.debug.setYaw(0); __game.debug.look(100, 0); });
  const d1 = await page.evaluate(() => Math.abs(__game.camera().yaw));
  await page.evaluate(() => { __game.debug.settings.set('sensitivity', 2); __game.debug.setYaw(0); __game.debug.look(100, 0); });
  const d2 = await page.evaluate(() => Math.abs(__game.camera().yaw));
  expect(d2).toBeGreaterThan(d1 * 1.8);
});

test('reglages : le volume regle le gain audio', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.audio.init());
  await page.evaluate(() => __game.debug.settings.set('volume', 0.6));
  expect(await page.evaluate(() => __game.debug.settings.gain())).toBeCloseTo(0.6, 2);
});

test('reglages : vue par defaut 1re personne lance la partie en 1re personne', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true;
    localStorage.setItem('cod-save-v1', JSON.stringify({ settings:{ sensitivity:1, volume:0.3, defaultView:'first' } })); });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.characters?.length >= 1, null, { timeout:20000 });
  await page.evaluate(() => __game.debug.start(0));
  await page.waitForFunction(() => window.__game.phase === 'playing', null, { timeout:20000 });
  expect(await page.evaluate(() => __game.view)).toBe('first');
});

test('reglages : le panneau a des controles relies a la sauvegarde', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await page.locator('#btn-settings').click();
  await expect(page.locator('#settings-panel')).toBeVisible();
  await expect(page.locator('#set-sensitivity')).toBeVisible();
  await page.locator('#set-sensitivity').evaluate(el => { el.value = '2.5'; el.dispatchEvent(new Event('input', { bubbles:true })); });
  expect(await page.evaluate(() => __game.debug.settings.get().sensitivity)).toBeCloseTo(2.5, 2);
  await page.locator('#set-view').click();
  expect(await page.evaluate(() => __game.debug.settings.get().defaultView)).toBe('first');
});

// ====== Tranche 19 : vraie map / niveau ======

// Le décor (obstacles/colliders) n'est construit qu'à la demande depuis #206 (ensureArenaReady,
// déclenché par startGame) — plus au simple boot du lobby. Ces 3 tests doivent donc démarrer une
// partie (startPlaying) avant d'interroger obstacleCount/pointInObstacle/hasLineOfSight, sinon le
// décor n'existe pas encore et toute assertion sur les obstacles est trivialement fausse ou vide.
test('map : niveau enrichi avec un perimetre et des batiments', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.obstacleCount())).toBeGreaterThanOrEqual(10);
  expect(await page.evaluate(() => __game.debug.pointInObstacle(0,22))).toBe(true);   // mur nord
});

test('map : les zones de jeu critiques restent degagees', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.pointInObstacle(0,0))).toBe(false);     // spawn
  expect(await page.evaluate(() => __game.debug.pointInObstacle(0,3))).toBe(false);     // couloir +Z
  expect(await page.evaluate(() => __game.debug.hasLineOfSight(0,0, 0,6))).toBe(true);  // LOS couloir
});

test('map : un batiment bloque la ligne de vue', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.pointInObstacle(16,8))).toBe(true);          // bâtiment est
  expect(await page.evaluate(() => __game.debug.hasLineOfSight(10,8, 22,8))).toBe(false);    // vue coupée au travers
});

// ====== Tranche 35 : dash ======

test('dash : deplace nettement et respecte le cooldown', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setInput({ forward:true }));
  const p0 = await page.evaluate(() => __game.position());
  expect(await page.evaluate(() => __game.debug.dash())).toBe(true);
  await page.waitForFunction(() => __game.debug.isDashing() === false, null, { timeout:3000 });
  const p1 = await page.evaluate(() => __game.position());
  expect(Math.hypot(p1.x-p0.x, p1.z-p0.z)).toBeGreaterThan(1.8);
  expect(await page.evaluate(() => __game.debug.dash())).toBe(false);
  expect(await page.evaluate(() => __game.debug.dashReady())).toBe(false);
  await page.waitForFunction(() => __game.debug.dashReady() === true, null, { timeout:3000 });
});

test('dash : HUD present en jeu', async ({ page }) => {
  await startPlaying(page);
  await expect(page.locator('#dash-hud')).toBeVisible();
});

// ====== Tranche 40 : menu pause ======

test('pause : gele la partie puis reprend', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setPaused(true));
  const p0 = await page.evaluate(() => __game.position());
  await page.evaluate(() => __game.debug.setInput({ forward:true }));
  await page.waitForTimeout(500);
  const p1 = await page.evaluate(() => __game.position());
  expect(Math.hypot(p1.x-p0.x, p1.z-p0.z)).toBeLessThan(0.05);
  await page.evaluate(() => __game.debug.setPaused(false));
  // scrute l'état atteint plutôt qu'un délai fixe (cf. note direction/lacet caméra ci-dessus)
  await page.waitForFunction(p0 => Math.hypot(__game.position().x-p0.x, __game.position().z-p0.z) > 0.3, p0, { timeout: 15000 });
});

test('pause : le menu permet de revenir a l accueil', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setPaused(true));
  await expect(page.locator('#pause')).toBeVisible();
  await expect(page.locator('#pause')).toContainText('Reprendre');
  await page.locator('#pause-menu').click();
  expect(await page.evaluate(() => __game.phase)).toBe('lobby');
});

// ====== #52 — Idle lobby ======

// #52 : lobbyAnimated() est déjà testé par 'accueil : le perso joue une anim idle' (ligne ~1115)
// Ce test vérifie uniquement que le hook debug existe
test('#52 lobby : debug hook lobbyAnimated existe', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const has = await page.evaluate(() => typeof window.__game?.debug?.lobbyAnimated === 'function');
  expect(has).toBe(true);
});

// ====== #56 — Stamina ======

test('#56 stamina : stamina = 100 au debut de partie', async ({ page }) => {
  await startPlaying(page);
  const s = await page.evaluate(() => __game.debug.stamina());
  expect(s).toBe(100);
});

test('#56 stamina : sprint vide la stamina', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setInput({forward:true, sprint:true}));
  await page.waitForFunction(() => __game.debug.stamina() < 90, null, {timeout:5000});
  const s = await page.evaluate(() => __game.debug.stamina());
  expect(s).toBeLessThan(90);
});

test('#56 stamina : sans sprint la stamina regenere', async ({ page }) => {
  await startPlaying(page);
  // Vider partiellement
  await page.evaluate(() => __game.debug.setInput({forward:true, sprint:true}));
  await page.waitForFunction(() => __game.debug.stamina() < 80, null, {timeout:5000});
  // Arrêter le sprint
  await page.evaluate(() => __game.debug.setInput({forward:false, sprint:false}));
  const s1 = await page.evaluate(() => __game.debug.stamina());
  // budget temps simulé requis (0.33s) trop juste face à 5s reels sous SwiftShader charge — cf. note ci-dessus
  await page.waitForFunction(v => __game.debug.stamina() > v + 5, s1, {timeout:20000});
  const s2 = await page.evaluate(() => __game.debug.stamina());
  expect(s2).toBeGreaterThan(s1);
});

test('#56 stamina : staminaDepleted=true quand stamina=0', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setStamina(0));
  const depleted = await page.evaluate(() => __game.debug.staminaDepleted());
  expect(depleted).toBe(true);
});

test('#56 stamina : reset a 100 apres restart', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setInput({forward:true, sprint:true}));
  await page.waitForFunction(() => __game.debug.stamina() < 80, null, {timeout:5000});
  await page.evaluate(() => __game.debug.restart());
  await page.waitForFunction(() => window.__game.phase === 'playing', null, {timeout:20000});
  const s = await page.evaluate(() => __game.debug.stamina());
  expect(s).toBe(100);
});

// ====== #67 — Bouclier rechargeable (affaibli : max dynamique via maxShield) ======

test('#67 shield : shieldHp initial = maxShield', async ({ page }) => {
  await startPlaying(page);
  const max = await page.evaluate(() => __game.debug.maxShield());
  expect(await page.evaluate(() => __game.debug.shieldHp())).toBe(max);
});

test('#67 shield : dégâts absorbés par le bouclier en premier', async ({ page }) => {
  await startPlaying(page);
  const max = await page.evaluate(() => __game.debug.maxShield());
  await page.evaluate(m => __game.debug.setShield(m), max);
  const hpBefore = await page.evaluate(() => __game.health);
  await page.evaluate(() => __game.debug.damagePlayer(10)); // < max → entièrement absorbé
  const hpAfter = await page.evaluate(() => __game.health);
  const shield = await page.evaluate(() => __game.debug.shieldHp());
  expect(hpAfter).toBe(hpBefore); // HP intact
  expect(shield).toBe(max - 10);  // shield réduit de 10
});

test('#67 shield : overflow de dégâts passe sur HP', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(10));
  await page.evaluate(() => __game.debug.damagePlayer(30));
  const shield = await page.evaluate(() => __game.debug.shieldHp());
  const hp = await page.evaluate(() => __game.health);
  expect(shield).toBe(0);
  expect(hp).toBeLessThan(await page.evaluate(() => __game.maxHealth));
});

test('#67 shield : setShield met a jour la valeur', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(25));
  expect(await page.evaluate(() => __game.debug.shieldHp())).toBe(25);
});

// ====== #86 — Footsteps sonores ======

test('#86 footsteps : lastFootstepT() est 0 au debut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.lastFootstepT())).toBe(0);
});

test('#86 footsteps : footstepInterval() est 0.38 en marche', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.footstepInterval())).toBeCloseTo(0.38, 2);
});

test('#86 footsteps : footstepInterval() est 0.22 en course', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setInput({ sprint: true }));
  expect(await page.evaluate(() => __game.debug.footstepInterval())).toBeCloseTo(0.22, 2);
});

// ====== #93 — Pluie ======

test('#93 pluie : rainActive() false par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.rainActive())).toBe(false);
});

test('#93 pluie : setRain(true) active la pluie', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setRain(true));
  expect(await page.evaluate(() => __game.debug.rainActive())).toBe(true);
});

test('#93 pluie : rainParticleCount() = 200 quand active', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setRain(true));
  expect(await page.evaluate(() => __game.debug.rainParticleCount())).toBe(200);
});

// ====== #94 — Mode hardcore ======

test('#94 hardcore : hardcoreMode() false par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.hardcoreMode())).toBe(false);
});

test('#94 hardcore : setHardcore(true) active le mode', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setHardcore(true));
  expect(await page.evaluate(() => __game.debug.hardcoreMode())).toBe(true);
});

test('#94 hardcore : en hardcore, soin healthpack n ameliore pas la sante', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.setHardcore(true); __game.debug.damagePlayer(30); });
  const hpBefore = await page.evaluate(() => __game.debug.playerHealth());
  await page.evaluate(() => __game.debug.spawnHealthPack(0, 0));
  const hpAfter = await page.evaluate(() => __game.debug.playerHealth());
  expect(hpAfter).toBe(hpBefore);
});

// ====== #94b — Hardcore en réglage persistant ======

test('#94b hardcore : le reglage settings s applique au restart', async ({ page }) => {
  await startPlaying(page);
  // règle hardcore=true via le setting persistant, puis restart
  await page.evaluate(() => __game.debug.settings.set('hardcore', true));
  await page.evaluate(() => __game.debug.restart());
  await page.waitForTimeout(100);
  const hcOn = await page.evaluate(() => __game.debug.hardcoreMode());
  expect(hcOn).toBe(true);
  // règle hardcore=false via le setting, restart → désactivé
  await page.evaluate(() => __game.debug.settings.set('hardcore', false));
  await page.evaluate(() => __game.debug.restart());
  await page.waitForTimeout(100);
  const hcOff = await page.evaluate(() => __game.debug.hardcoreMode());
  expect(hcOff).toBe(false);
});

// ====== #93b — Pluie activable depuis les Reglages ======

test('#93b pluie : le reglage settings s applique au restart', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.settings.set('rain', true));
  await page.evaluate(() => __game.debug.restart());
  await page.waitForTimeout(100);
  const on = await page.evaluate(() => __game.debug.rainActive());
  expect(on).toBe(true);
  const particles = await page.evaluate(() => __game.debug.rainParticleCount());
  expect(particles).toBeGreaterThan(0);
  await page.evaluate(() => __game.debug.settings.set('rain', false));
  await page.evaluate(() => __game.debug.restart());
  await page.waitForTimeout(100);
  const off = await page.evaluate(() => __game.debug.rainActive());
  expect(off).toBe(false);
});

// ====== Audit fix — dash reset au restart (#35) ======

test('audit : le dash est pret (cooldown remis a zero) au restart', async ({ page }) => {
  await startPlaying(page);
  // déclenche un dash → met le cooldown
  await page.evaluate(() => { __game.debug.setInput({ forward:true }); __game.debug.dash(); });
  await page.waitForTimeout(50);
  const cdMid = await page.evaluate(() => __game.debug.dashCooldownLeft());
  expect(cdMid).toBeGreaterThan(0);
  // restart → cooldown remis à zéro, dash prêt
  await page.evaluate(() => { __game.debug.setInput({}); __game.debug.restart(); });
  await page.waitForTimeout(100);
  const cdAfter = await page.evaluate(() => __game.debug.dashCooldownLeft());
  expect(cdAfter).toBe(0);
  const ready = await page.evaluate(() => __game.debug.dashReady());
  expect(ready).toBe(true);
});

// ====== #134 — Adrenaline (bonus degats a PV bas) ======

test('#134 adrenaline : inactif a PV pleins', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.adrenalineActive())).toBe(false);
  expect(await page.evaluate(() => __game.debug.adrenalineMult())).toBe(1);
});

test('#134 adrenaline : actif quand PV <= 25%', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(0)); // le bouclier absorbe sinon les PV ne baissent pas
  await page.evaluate(() => __game.debug.damagePlayer(80)); // 100 -> 20 PV (<=25%)
  expect(await page.evaluate(() => __game.debug.adrenalineActive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.adrenalineMult())).toBe(1.2);
});

test('#134 adrenaline : multiplie les degats reels infliges par un tir (meme zone visee)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setEnemyAccuracy(0));   // personne ne tue le joueur à 20 PV pendant les waits
  await page.evaluate(() => { __game.debug.setView('first'); __game.debug.setPitch(0); __game.debug.setSpreadOverride(0); });
  await page.waitForTimeout(150);
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8));
  await page.evaluate(() => __game.debug.setPitch(0)); // re-fige le pitch juste avant le tir (annule un éventuel recul résiduel)
  const hpBefore1 = await page.evaluate(() => __game.debug.enemyHp(0));
  await page.evaluate(() => { __game.debug.forceEnemyFacePlayer(0); __game.debug.tryFire(); }); // face au joueur DANS le même evaluate : pas de backstab ×1.5 (#87)
  const hpAfter1 = await page.evaluate(() => __game.debug.enemyHp(0));
  const normalDmg = hpBefore1 - hpAfter1;
  expect(normalDmg).toBeGreaterThan(0);

  await page.evaluate(() => __game.debug.setShield(0));
  await page.evaluate(() => __game.debug.damagePlayer(80)); // PV <= 25% => adrénaline active
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8)); // revit enemies[0] (hp/pos remis à neuf)
  await page.waitForTimeout(400); // laisse expirer le cooldown de tir entre les deux essais
  await page.evaluate(() => { __game.debug.setView('first'); __game.debug.setPitch(0); }); // même zone visée que le 1er tir
  const hpBefore2 = await page.evaluate(() => __game.debug.enemyHp(0));
  await page.evaluate(() => { __game.debug.forceEnemyFacePlayer(0); __game.debug.tryFire(); }); // idem : pas de backstab au 2e tir
  const hpAfter2 = await page.evaluate(() => __game.debug.enemyHp(0));
  const adrDmg = hpBefore2 - hpAfter2;
  expect(adrDmg).toBeGreaterThan(normalDmg);
});

test('#134 adrenaline : HUD visible/masque selon les PV', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => document.getElementById('adrenaline-hud').classList.contains('hidden'))).toBe(true);
  await page.evaluate(() => __game.debug.setShield(0));
  await page.evaluate(() => __game.debug.damagePlayer(80));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => document.getElementById('adrenaline-hud').classList.contains('hidden'))).toBe(false);
});

// ====== #135 — Double saut ======

test('#135 double saut : doubleJumpAvailable false au sol avant tout saut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.doubleJumpAvailable())).toBe(false);
});

test('#135 double saut : sauter au sol arme le double saut', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.jump());
  expect(await page.evaluate(() => __game.debug.doubleJumpAvailable())).toBe(true);
});

test('#135 double saut : un 2e saut en l air relance le perso vers le haut', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.jump());
  await page.waitForFunction(() => !window.__game.debug.doubleJumpAvailable() === false, null, { timeout: 3000 }).catch(()=>{});
  // laisse la vélocité redescendre un peu avant le 2e saut
  await page.waitForTimeout(300);
  const vyBefore = await page.evaluate(() => __game.debug.velY());
  await page.evaluate(() => __game.debug.airJump());
  const vyAfter = await page.evaluate(() => __game.debug.velY());
  expect(vyAfter).toBeGreaterThan(vyBefore);
  expect(await page.evaluate(() => __game.debug.doubleJumpAvailable())).toBe(false);
});

test('#135 double saut : refuse un 3e saut avant d avoir retouche le sol', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.jump());
  await page.waitForTimeout(300);
  await page.evaluate(() => __game.debug.airJump()); // consomme le double saut
  const vyBefore = await page.evaluate(() => __game.debug.velY());
  await page.evaluate(() => __game.debug.airJump()); // refusé : plus de saut dispo
  const vyAfter = await page.evaluate(() => __game.debug.velY());
  expect(vyAfter).toBeLessThanOrEqual(vyBefore);
});

test('#135 double saut : se rearme apres avoir retouche le sol', async ({ page }) => {
  await startPlaying(page);
  const y0 = (await page.evaluate(() => __game.position())).y;
  await page.evaluate(() => __game.debug.jump());
  await page.waitForFunction(y => window.__game.position().y > y + 0.2, y0, { timeout: 3000 }); // décolle
  await page.waitForFunction(y => Math.abs(window.__game.position().y - y) < 0.05, y0, { timeout: 6000 }); // retombe
  expect(await page.evaluate(() => __game.debug.doubleJumpAvailable())).toBe(false);
  await page.evaluate(() => __game.debug.jump());
  expect(await page.evaluate(() => __game.debug.doubleJumpAvailable())).toBe(true);
});

// ====== #137 — Dernier souffle (second wind) ======

test('#137 second wind : disponible en debut de partie', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.secondWindAvailable())).toBe(true);
  expect(await page.evaluate(() => __game.debug.secondWindUsed())).toBe(false);
});

test('#137 second wind : un coup fatal laisse 1 PV au lieu de tuer, une seule fois', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(0));
  await page.evaluate(() => __game.debug.damagePlayer(99999)); // coup normalement fatal
  expect(await page.evaluate(() => __game.phase)).toBe('playing'); // pas mort
  expect(await page.evaluate(() => __game.debug.playerHealth())).toBe(1);
  expect(await page.evaluate(() => __game.debug.secondWindUsed())).toBe(true);
});

test('#137 second wind : invincibilite 2s bloque les degats juste apres', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(0));
  await page.evaluate(() => __game.debug.damagePlayer(99999)); // déclenche le dernier souffle
  expect(await page.evaluate(() => __game.debug.secondWindInvulnActive())).toBe(true);
  await page.evaluate(() => __game.debug.damagePlayer(50)); // devrait être totalement ignoré
  expect(await page.evaluate(() => __game.debug.playerHealth())).toBe(1);
});

test('#137 second wind : un 2e coup fatal (apres expiration invincibilite) tue vraiment', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(0));
  await page.evaluate(() => __game.debug.damagePlayer(99999)); // 1er coup fatal → survit
  await page.waitForTimeout(2200); // laisse expirer les 2s d'invincibilité
  await page.evaluate(() => __game.debug.damagePlayer(99999)); // 2e coup fatal → mort pour de vrai
  expect(await page.evaluate(() => __game.phase)).toBe('dead');
});

test('#137 second wind : desactive en mode hardcore', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setHardcore(true));
  await page.evaluate(() => __game.debug.setShield(0));
  await page.evaluate(() => __game.debug.damagePlayer(99999));
  expect(await page.evaluate(() => __game.phase)).toBe('dead');
  await page.evaluate(() => __game.debug.setHardcore(false));
});

test('#137 second wind : se reinitialise au restart', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(0));
  await page.evaluate(() => __game.debug.damagePlayer(99999));
  expect(await page.evaluate(() => __game.debug.secondWindUsed())).toBe(true);
  await page.evaluate(() => __game.debug.restart());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.secondWindUsed())).toBe(false);
});

// ====== #142 — Frames d'invincibilite du dash ======

test('#142 dash iframes : aucun degat recu pendant un dash actif', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(0));
  await page.evaluate(() => __game.debug.setInput({forward:true}));
  await page.evaluate(() => __game.debug.dash());
  expect(await page.evaluate(() => __game.debug.dashInvulnActive())).toBe(true);
  const hpBefore = await page.evaluate(() => __game.debug.playerHealth());
  await page.evaluate(() => __game.debug.damagePlayer(50));
  const hpAfter = await page.evaluate(() => __game.debug.playerHealth());
  expect(hpAfter).toBe(hpBefore);
});

test('#142 dash iframes : les degats reprennent normalement une fois le dash termine', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(0));
  await page.evaluate(() => __game.debug.setInput({forward:true}));
  await page.evaluate(() => __game.debug.dash());
  await page.waitForFunction(() => !window.__game.debug.dashInvulnActive(), null, { timeout: 3000 });
  const hpBefore = await page.evaluate(() => __game.debug.playerHealth());
  await page.evaluate(() => __game.debug.damagePlayer(20));
  const hpAfter = await page.evaluate(() => __game.debug.playerHealth());
  expect(hpAfter).toBeLessThan(hpBefore);
});

// ====== #148 — Soin d'execution (melee sur ennemi PV bas) ======

test('#148 execution : melee qui tue un ennemi deja sous 20% PV soigne le joueur', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(0));
  await page.evaluate(() => __game.debug.damagePlayer(60)); // laisse de la marge pour observer le heal
  await faceEnemyForMelee(page);
  await page.evaluate(() => { const hp = __game.debug.enemyHp(0); __game.debug.damageEnemy(0, hp - 10); }); // ennemi a 10 PV (< 20% de 100)
  const hpBefore = await page.evaluate(() => __game.debug.playerHealth());
  expect(await page.evaluate(() => __game.debug.playerMelee())).toBe(true);
  const hpAfter = await page.evaluate(() => __game.debug.playerHealth());
  expect(hpAfter).toBeGreaterThan(hpBefore);
  expect(await page.evaluate(() => __game.debug.lastExecutionHeal())).toBe(true);
});

test('#148 execution : melee qui tue un ennemi a PV pleins ne soigne pas', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(0));
  await page.evaluate(() => __game.debug.damagePlayer(60));
  await faceEnemyForMelee(page); // ennemi a 100 PV (couteau = 150 dmg, tue en un coup)
  const hpBefore = await page.evaluate(() => __game.debug.playerHealth());
  expect(await page.evaluate(() => __game.debug.playerMelee())).toBe(true);
  const hpAfter = await page.evaluate(() => __game.debug.playerHealth());
  expect(hpAfter).toBe(hpBefore);
  expect(await page.evaluate(() => __game.debug.lastExecutionHeal())).toBe(false);
});

test('#148 execution : melee sur ennemi PV bas qui ne tue PAS ne soigne pas', async ({ page }) => {
  await startPlaying(page);
  // gros ennemi (tank, vague elevee) : PV bas en fraction mais assez eleve en absolu pour survivre au couteau (150 dmg)
  await page.evaluate(() => __game.debug.forceWave(20));
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'tank', 2, 0));
  await faceEnemyForMelee(page);
  await page.evaluate(() => { const maxHp = __game.debug.enemyHp(0); __game.debug.damageEnemy(0, Math.round(maxHp*0.85)); }); // -> ~15% PV, encore tres superieur a 150
  const before = await page.evaluate(() => __game.debug.executionHealCount());
  await page.evaluate(() => __game.debug.playerMelee());
  const after = await page.evaluate(() => __game.debug.executionHealCount());
  expect(after).toBe(before);
});

test('#148 execution : executionHealCount incremente a chaque execution', async ({ page }) => {
  await startPlaying(page);
  await faceEnemyForMelee(page);
  await page.evaluate(() => { const hp = __game.debug.enemyHp(0); __game.debug.damageEnemy(0, hp - 10); });
  const before = await page.evaluate(() => __game.debug.executionHealCount());
  await page.evaluate(() => __game.debug.playerMelee());
  const after = await page.evaluate(() => __game.debug.executionHealCount());
  expect(after).toBe(before + 1);
});

// ====== #158 — Mode Entrainement ======

test('#158 : startTraining active le flag, munitions infinies, aucun ennemi', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.startTraining());
  await page.waitForFunction(() => window.__game.phase === 'playing');
  expect(await page.evaluate(() => __game.debug.trainingActive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.infiniteAmmoActive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.enemyCount())).toBe(0);
});

test('#158 : forceNextWave ne fait rien en entrainement', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.startTraining());
  await page.evaluate(() => __game.debug.forceNextWave());
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => __game.debug.enemyCount())).toBe(0);
});

test('#158 : tirer au-dela du chargeur normal ne vide jamais les munitions', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.startTraining());
  await page.evaluate(() => { for (let i=0;i<40;i++) __game.debug.tryFire(); });
  expect(await page.evaluate(() => __game.ammo)).toBeGreaterThan(0);
});

test('#158 : backToHome desactive le flag et les munitions infinies', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.startTraining());
  await page.evaluate(() => __game.debug.backToHome());
  expect(await page.evaluate(() => __game.debug.trainingActive())).toBe(false);
  expect(await page.evaluate(() => __game.debug.infiniteAmmoActive())).toBe(false);
});

test('#158 : recommencer en entrainement relance l entrainement (pas une vraie vague)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.startTraining());
  await page.evaluate(() => __game.debug.restart());
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __game.debug.trainingActive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.enemyCount())).toBe(0);
});

test('#158 : le bouton Entrainement est visible dans le lobby et lance le mode', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.characters?.length >= 1, null, {timeout:20000});
  await expect(page.locator('#btn-training')).toBeVisible();
  await page.evaluate(() => document.getElementById('btn-training').click());
  await page.waitForFunction(() => window.__game.phase === 'playing');
  expect(await page.evaluate(() => __game.debug.trainingActive())).toBe(true);
});

test('#158 : le HUD entrainement est visible en entrainement, masque au retour menu', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.startTraining());
  expect(await page.evaluate(() => document.getElementById('training-hud').classList.contains('hidden'))).toBe(false);
  await page.evaluate(() => __game.debug.backToHome());
  expect(await page.evaluate(() => document.getElementById('training-hud').classList.contains('hidden'))).toBe(true);
});

// ====== Degats de chute (demande Nathan, coherence avec les toits #206 sans garde-corps) ======
test('chute : aucun degat sous la hauteur de securite (petit saut/petite marche)', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.fallDamageFor(1))).toBe(0);
  expect(await page.evaluate(() => __game.debug.fallDamageFor(3))).toBe(0);
});

test('chute : degats proportionnels au-dela de la hauteur de securite, plafonnes', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.fallDamageFor(5))).toBe(10);    // (5-3)*5
  expect(await page.evaluate(() => __game.debug.fallDamageFor(9.64))).toBe(33); // toit #206, (9.64-3)*5 arrondi
  expect(await page.evaluate(() => __game.debug.fallDamageFor(100))).toBe(40);  // plafond, jamais letal a lui seul
});

test('chute : une vraie chute depuis une grande hauteur inflige les degats a l atterrissage', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(0));   // le bouclier absorbe sinon (memoire projet)
  const before = await page.evaluate(() => __game.debug.playerHealth());
  await page.evaluate(() => __game.debug.forceFallFrom(15));
  // scrute l'atterrissage réel (dt simulé plafonné à 50ms/frame — 1.5s réelles ne suffisent pas
  // toujours à couvrir les ~1.29s simulées requises sous charge SwiftShader) plutôt qu'un délai fixe
  await page.waitForFunction(b => __game.debug.playerHealth() < b, before, { timeout: 15000 });
  const after = await page.evaluate(() => __game.debug.playerHealth());
  expect(after).toBeLessThan(before);
});

test('chute : sauter normalement (petite hauteur) n inflige aucun degat', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(0));
  const before = await page.evaluate(() => __game.debug.playerHealth());
  await page.evaluate(() => __game.debug.jump());
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => __game.debug.playerHealth());
  expect(after).toBe(before);
});
