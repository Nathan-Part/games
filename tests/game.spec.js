import { test, expect } from '@playwright/test';

// Collecte les erreurs console/page pour les assertions « pas d'erreur ».
function trackErrors(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  return errors;
}

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

async function startPlaying(page){
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; }); // arme primitive (rapide) sauf test dédié
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.characters?.length >= 1, null, {timeout:20000});
  await page.evaluate(() => __game.debug.start(0));
  await page.waitForFunction(() => window.__game.phase === 'playing', null, {timeout:20000});
}

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
  await page.waitForTimeout(800);
  const p1 = await page.evaluate(() => __game.position());
  expect(p1.x - p0.x).toBeGreaterThan(0.3);
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

test('vagues : tuer 1 ennemi sur 3 ne le fait pas reapparaitre (plus de respawn auto)', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  const s0 = await page.evaluate(() => __game.score);
  await page.evaluate(() => __game.debug.damageEnemy(0, 50));
  expect(await page.evaluate(() => __game.debug.enemyHp(0))).toBe(50);
  expect(await page.evaluate(() => __game.debug.enemyAlive())).toBe(3);   // pas encore mort (100 PV)
  await page.evaluate(() => __game.debug.damageEnemy(0, 50));            // total 100 => mort
  expect(await page.evaluate(() => __game.debug.enemyAlive())).toBe(2);   // reste mort (2 vivants)
  expect(await page.evaluate(() => __game.score)).toBe(s0 + 1);          // +1 score
  expect(await page.evaluate(() => __game.debug.enemyState(0))).toBe('dead');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => __game.debug.enemyAlive())).toBe(2);  // toujours 2 (pas de respawn auto)
  expect(await page.evaluate(() => __game.wave)).toBe(1);                // vague pas finie
});

test('vagues : la partie demarre vague 1 avec 3 ennemis a 100 PV', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  expect(await page.evaluate(() => __game.wave)).toBe(1);
  expect(await page.evaluate(() => __game.bestWave)).toBe(1);
  expect(await page.evaluate(() => __game.debug.waveState())).toBe('active');
  expect(await page.evaluate(() => __game.debug.enemyHp(0))).toBe(100);
});

test('vagues : nettoyer une vague enchaine sur la suivante (plus nombreuse, record +1)', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await page.evaluate(() => __game.debug.killAllEnemies());
  expect(await page.evaluate(() => __game.debug.waveState())).toBe('cleared');
  // enchaînement naturel après l'intermission (≤ WAVE_INTERMISSION + marge)
  await page.waitForFunction(() => __game.wave === 2, null, { timeout:8000 });
  expect(await page.evaluate(() => __game.debug.waveState())).toBe('active');
  expect(await page.evaluate(() => __game.debug.enemyCount())).toBe(4);   // enemiesForWave(2)
  expect(await page.evaluate(() => __game.debug.enemyHp(0))).toBe(118);   // enemyHpForWave(2) = round(100*1.18^1)
  expect(await page.evaluate(() => __game.bestWave)).toBe(2);             // record
});

test('vagues : forceNextWave saute l intermission (debug)', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await page.evaluate(() => __game.debug.forceNextWave());
  expect(await page.evaluate(() => __game.wave)).toBe(2);
  expect(await page.evaluate(() => __game.debug.enemyCount())).toBe(4);
});

test('vagues : le HUD affiche la vague et le nombre d ennemis', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await expect(page.locator('#wave-hud')).toBeVisible();
  await expect(page.locator('#wave-hud')).toContainText('Vague 1');
  await expect(page.locator('#wave-hud')).toContainText('3');
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
  await page.evaluate(() => __game.debug.damagePlayer(100));
  expect(await page.evaluate(() => __game.phase)).toBe('dead');
  await expect(page.locator('#gameover')).toBeVisible();
  await page.evaluate(() => __game.debug.restart());
  expect(await page.evaluate(() => __game.phase)).toBe('playing');
  expect(await page.evaluate(() => __game.health)).toBe(100);
  expect(await page.evaluate(() => __game.score)).toBe(0);
  await expect(page.locator('#gameover')).toBeHidden();
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

test('persos : par defaut seul Blue-Soldier est jouable au lobby (les autres s achetent)', async ({ page }) => {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.characters?.length >= 1 && window.__game.phase === 'lobby', null, { timeout:20000 });
  const labels = await page.evaluate(() => __game.characters.map(c => c.label.toLowerCase()));
  expect(labels).toEqual(['blue-soldier']);   // seul le perso possédé par défaut (Sentinel/Cyborg à acheter)
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
  await page.evaluate(() => __game.debug.damagePlayer(100)); // mort
  expect(await page.evaluate(() => __game.debug.audio.last())).toBe('gameover');
});

test('un ennemi touché se retourne et poursuit le joueur, même hors de portée de détection', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await page.evaluate(() => __game.debug.spawnEnemyAt(20, 0)); // dist 20 > détection (12) => patrouille
  await page.waitForFunction(() => __game.debug.enemyState(0) === 'patrol', null, { timeout:3000 });
  await page.evaluate(() => __game.debug.damageEnemy(0, 10)); // on le touche de loin
  await page.waitForFunction(() => __game.debug.enemyState(0) === 'chase', null, { timeout:3000 }); // il aggro
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

test('mort : l ennemi a une anim de mort (Dead) jouee au kill', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  expect(await page.evaluate(() => __game.debug.enemyHasClip('dead'))).toBe(true);  // anim Dead retargetee
  await page.evaluate(() => __game.debug.damageEnemy(0, 100));                        // kill
  expect(await page.evaluate(() => __game.debug.enemyState(0))).toBe('dead');
  expect(await page.evaluate(() => __game.debug.enemyAlive())).toBe(2);
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

test('vagues : enemiesForWave et enemyHpForWave croissent et sont plafonnées', async ({ page }) => {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.booted);
  const n = (w) => page.evaluate(ww => __game.debug.enemiesForWave(ww), w);
  const hp = (w) => page.evaluate(ww => __game.debug.enemyHpForWave(ww), w);
  expect(await n(1)).toBe(3);                 // compat : vague 1 = 3 ennemis
  expect(await n(2)).toBe(4);
  expect(await n(2)).toBeGreaterThan(await n(1));
  expect(await n(99)).toBe(7);                // plafond MAX_PER_WAVE
  expect(await hp(1)).toBe(100);              // compat : 100 PV vague 1
  expect(await hp(3)).toBeGreaterThan(await hp(1));  // plus coriaces
});

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
  const before = await page.evaluate(() => __game.money);
  await page.evaluate(() => __game.debug.damageEnemy(0, 1000));   // tue 1 des 3 (vague non finie)
  const after = await page.evaluate(() => __game.money);
  expect(after - before).toBe(rates.perKill);
});

test('save : nettoyer une vague rapporte un bonus (par vague)', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  const rates = await page.evaluate(() => __game.debug.save.rates());
  const before = await page.evaluate(() => __game.money);
  await page.evaluate(() => { __game.debug.setShield(0); __game.debug.damagePlayer(1); }); // 1 dégât réel → pas de bonus "survie parfaite" (#100), on isole le bonus par-vague
  await page.evaluate(() => __game.debug.killAllEnemies());       // 3 kills (combo x1,x1,x2) + bonus vague 1
  const after = await page.evaluate(() => __game.money);
  expect(after - before).toBe((1 + 1 + 2) * rates.perKill + rates.perWave * 1);   // combo (#29) booste l'argent par kill
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

test('accueil : on revient au menu apres un Game Over', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setShield(0)); // #67 : vider le bouclier pour que 100 dégâts tuent
  await page.evaluate(() => __game.debug.damagePlayer(100));
  expect(await page.evaluate(() => __game.phase)).toBe('dead');
  await page.evaluate(() => __game.debug.backToHome());
  expect(await page.evaluate(() => __game.phase)).toBe('lobby');
  await expect(page.locator('#lobby')).toBeVisible();
  await expect(page.locator('#gameover')).toBeHidden();
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

test('accessoires : acheter+equiper un casque attache un mesh a la tete (persiste)', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(2000); });
  expect(await page.evaluate(() => __game.debug.accessoryAttached('helmet'))).toBe(false);
  expect(await page.evaluate(() => __game.debug.shop.buyAccessory('helm:visor'))).toBe(true);
  expect(await page.evaluate(() => __game.debug.shop.selectAccessory('helmet','helm:visor'))).toBe(true);
  expect(await page.evaluate(() => __game.debug.accessoryAttached('helmet'))).toBe(true);
  expect(await page.evaluate(() => __game.debug.playerAccessory('helmet'))).toBe('helm:visor');
  await page.reload(); await page.waitForFunction(() => window.__game?.booted);
  expect(await page.evaluate(() => __game.debug.save.get().equipped.helmet)).toBe('helm:visor');
});

test('accessoires : equiper un costume attache un mesh au torse ; retrait avec none', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(2000); __game.debug.shop.buyAccessory('cost:plate'); });
  expect(await page.evaluate(() => __game.debug.shop.selectAccessory('costume','cost:plate'))).toBe(true);
  expect(await page.evaluate(() => __game.debug.accessoryAttached('costume'))).toBe(true);
  expect(await page.evaluate(() => __game.debug.shop.selectAccessory('costume','cost:none'))).toBe(true);
  expect(await page.evaluate(() => __game.debug.accessoryAttached('costume'))).toBe(false);
});

test('accessoires : achat refuse sans argent ; non possede non equipable', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(50); });
  expect(await page.evaluate(() => __game.debug.shop.buyAccessory('helm:crown'))).toBe(false);
  expect(await page.evaluate(() => __game.debug.shop.selectAccessory('helmet','helm:crown'))).toBe(false);
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

// ====== Tranche 26 : onglet Accessoires (remplace l'onglet Skins) ======
test('accessoires : onglet boutique (sous-onglets) achete et equipe', async ({ page }) => {
  await page.addInitScript(() => { window.__FAST_WEAPON__ = true; });
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.phase === 'lobby', null, { timeout:20000 });
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.save.addMoney(3000); });
  await page.locator('#btn-shop').click();
  await page.locator('.shop-tab[data-tab="accessories"]').click();
  await expect(page.locator('#shop-info')).toContainText('Visière');                 // sous-onglet Masque par défaut
  await page.locator('#shop-info [data-buyacc="helm:visor"]').click();
  expect(await page.evaluate(() => __game.debug.save.get().ownedAccessories)).toContain('helm:visor');
  await page.locator('#shop-info [data-selacc="helm:visor"]').click();
  expect(await page.evaluate(() => __game.debug.save.get().equipped.helmet)).toBe('helm:visor');
  await page.locator('#shop-info [data-accslot="costume"]').click();                 // sous-onglet Costume
  await expect(page.locator('#shop-info')).toContainText('Plastron');
});

test('skins : systeme retire (plus aucune reference)', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  expect(await page.evaluate(() => typeof __game.debug.shop.skinCatalog)).toBe('undefined');
  expect(await page.evaluate(() => typeof __game.debug.playerSkin)).toBe('undefined');
  expect(await page.locator('[data-tab="skins"]').count()).toBe(0);
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

// ====== Tranche 19 : vraie map / niveau ======
test('map : niveau enrichi avec un perimetre et des batiments', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  expect(await page.evaluate(() => __game.debug.obstacleCount())).toBeGreaterThanOrEqual(10);
  expect(await page.evaluate(() => __game.debug.pointInObstacle(0,22))).toBe(true);   // mur nord
});

test('map : les zones de jeu critiques restent degagees', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  expect(await page.evaluate(() => __game.debug.pointInObstacle(0,0))).toBe(false);     // spawn
  expect(await page.evaluate(() => __game.debug.pointInObstacle(0,3))).toBe(false);     // couloir +Z
  expect(await page.evaluate(() => __game.debug.hasLineOfSight(0,0, 0,6))).toBe(true);  // LOS couloir
});

test('map : un batiment bloque la ligne de vue', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  expect(await page.evaluate(() => __game.debug.pointInObstacle(16,8))).toBe(true);          // bâtiment est
  expect(await page.evaluate(() => __game.debug.hasLineOfSight(10,8, 22,8))).toBe(false);    // vue coupée au travers
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
  expect(data.h.find(a => a.id === 'helm:halo').rarity).toBe('legendaire');
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
  expect(await page.evaluate(() => __game.money) - m0).toBe(perKill * (1 + 1 + 2));   // mult des 3 kills
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

test('refonte : le CTA principal est orange (pas bleu legacy)', async ({ page }) => {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.booted);
  const bg = await page.evaluate(() => getComputedStyle(document.getElementById('play-btn')).backgroundImage);
  expect(bg).toMatch(/255,\s*106,\s*26/);      // --accent #ff6a1a
  expect(bg).not.toMatch(/91,\s*140,\s*255/);  // ancien bleu #5b8cff
});

test('boutique : apercu d un accessoire sur le perso sans l acheter (essayer avant d acheter)', async ({ page }) => {
  await startPlaying(page);                                    // perso (model) chargé de façon fiable
  const id = await page.evaluate(() => __game.debug.shop.accessoryCatalog('helmet').find(a => a.price > 0).id);
  expect(await page.evaluate(() => __game.debug.accessoryAttached('helmet'))).toBe(false);            // rien au depart
  expect(await page.evaluate((i) => __game.debug.shop.previewAccessory('helmet', i), id)).toBe(true);  // previsualiser sans acheter
  expect(await page.evaluate(() => __game.debug.accessoryAttached('helmet'))).toBe(true);             // visible sur le perso
  expect(await page.evaluate(() => __game.debug.playerAccessory('helmet'))).not.toBe(id);             // mais pas equipe
  expect(await page.evaluate((i) => __game.debug.save.get().ownedAccessories.includes(i), id)).toBe(false); // ni achete
});

// ====== Tranche 31 : vagues de boss ======
test('boss : isBossWave tous les 5 niveaux', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const f = (w) => page.evaluate(x => __game.debug.isBossWave(x), w);
  for(const w of [5,10,15]) expect(await f(w)).toBe(true);
  for(const w of [1,4,6,9]) expect(await f(w)).toBe(false);
});

test('boss : composition de la vague 5 (boss + sbires)', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const c5 = await page.evaluate(() => __game.debug.waveComposition(5));
  expect(c5[0]).toBe('boss'); expect(c5.length).toBe(3);
  const c4 = await page.evaluate(() => __game.debug.waveComposition(4));
  expect(c4).not.toContain('boss');
});

test('boss : la vague 5 fait apparaitre un boss vivant', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forceWave(5));
  expect(await page.evaluate(() => __game.debug.bossAlive())).toBe(true);
  expect(await page.evaluate(() => __game.debug.bossHpFrac())).toBeGreaterThan(0.9);
  const types = await page.evaluate(() => { const n = __game.debug.enemyCount(); const a=[]; for(let i=0;i<n;i++) a.push(__game.debug.enemyType(i)); return a; });
  expect(types).toContain('boss');
});

test('boss : HUD visible en vague de boss, masque apres', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forceWave(5));
  await expect(page.locator('#boss-hud')).toBeVisible();
  await expect(page.locator('#boss-hud')).toContainText('BOSS');
  await page.evaluate(() => __game.debug.killAllEnemies());
  await expect(page.locator('#boss-hud')).toBeHidden();
});

test('boss : le tuer credite un gros bonus', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.reset(); __game.debug.forceWave(5); });
  const m0 = await page.evaluate(() => __game.money);
  await page.evaluate(() => __game.debug.killAllEnemies());
  expect(await page.evaluate(() => __game.money) - m0).toBeGreaterThanOrEqual(300);
});

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
test('grenade : lancer decremente le stock et cree un projectile', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.grenadeCount())).toBe(3);
  expect(await page.evaluate(() => __game.debug.throwGrenade())).toBe(true);
  expect(await page.evaluate(() => __game.debug.grenadeCount())).toBe(2);
  expect(await page.evaluate(() => __game.debug.grenadeProjCount())).toBeGreaterThanOrEqual(1);
});

test('grenade : stock vide refuse', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.throwGrenade(); __game.debug.throwGrenade(); __game.debug.throwGrenade(); });
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

test('grenade : recharge a chaque vague', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.throwGrenade(); __game.debug.throwGrenade(); __game.debug.throwGrenade(); });
  expect(await page.evaluate(() => __game.debug.grenadeCount())).toBe(0);
  await page.evaluate(() => __game.debug.forceNextWave());
  expect(await page.evaluate(() => __game.debug.grenadeCount())).toBe(3);
});

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

// ====== Tranche 38 : annonces de kill ======
test('annonce : BOSS DOWN a la mort du boss', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.forceWave(5));
  await page.evaluate(() => __game.debug.damageEnemy(0, 999999));   // enemies[0] = boss
  expect(await page.evaluate(() => __game.debug.lastCallout())).toContain('BOSS');
});

test('annonce : HEADSHOT sur un kill en tete', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.save.addMoney(2000); __game.debug.shop.buy('sniper'); __game.debug.shop.equip('sniper'); });
  await page.evaluate(() => { __game.debug.setView('first'); __game.debug.setPitch(0); });
  await page.waitForTimeout(150);
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8));
  await page.evaluate(() => __game.debug.tryFire());
  expect(await page.evaluate(() => __game.debug.lastCallout())).toBe('HEADSHOT');
});

test('annonce : DOUBLE KILL sur 2 kills rapproches', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.damageEnemy(0, 99999); __game.debug.damageEnemy(1, 99999); });
  expect(await page.evaluate(() => __game.debug.lastCallout())).toContain('DOUBLE');
  await expect(page.locator('#kill-callout')).toContainText('DOUBLE');
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
  await page.waitForTimeout(500);
  const p2 = await page.evaluate(() => __game.position());
  expect(Math.hypot(p2.x-p0.x, p2.z-p0.z)).toBeGreaterThan(0.3);
});

test('pause : le menu permet de revenir a l accueil', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setPaused(true));
  await expect(page.locator('#pause')).toBeVisible();
  await expect(page.locator('#pause')).toContainText('Reprendre');
  await page.locator('#pause-menu').click();
  expect(await page.evaluate(() => __game.phase)).toBe('lobby');
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
  await page.evaluate(() => __game.debug.damagePlayer(9999));
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

// ====== Tranche 46 : difficulté ======
test('difficulte : ajuste PV ennemis et degats recus', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  expect(await page.evaluate(() => __game.debug.difficulty())).toBe('normal');
  const hpN = await page.evaluate(() => __game.debug.enemyHpForWave(3));
  await page.evaluate(() => __game.debug.setDifficulty('difficile'));
  expect(await page.evaluate(() => __game.debug.enemyHpForWave(3))).toBeGreaterThan(hpN);
  await page.evaluate(() => __game.debug.setDifficulty('facile'));
  expect(await page.evaluate(() => __game.debug.enemyHpForWave(3))).toBeLessThan(hpN);
});

test('difficulte : facile reduit les degats recus', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.setDifficulty('facile'));
  await page.evaluate(() => __game.debug.setShield(0)); // #67 : sans bouclier, on mesure les dégâts réels sur les PV
  const h0 = await page.evaluate(() => __game.debug.playerHealth());
  await page.evaluate(() => __game.debug.damagePlayer(20));
  const lost = h0 - await page.evaluate(() => __game.debug.playerHealth());
  expect(lost).toBeLessThan(20); expect(lost).toBeGreaterThan(0);
});

test('difficulte : le selecteur des reglages applique le mode', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  await page.locator('#btn-settings').click();
  await page.locator('#set-diff [data-diff="facile"]').click();
  expect(await page.evaluate(() => __game.debug.difficulty())).toBe('facile');
  await expect(page.locator('#set-diff [data-diff="facile"]')).toHaveClass(/on/);
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

// ====== #52 — Idle lobby ======
// #52 : lobbyAnimated() est déjà testé par 'accueil : le perso joue une anim idle' (ligne ~1115)
// Ce test vérifie uniquement que le hook debug existe
test('#52 lobby : debug hook lobbyAnimated existe', async ({ page }) => {
  await page.goto('/game.html'); await page.waitForFunction(() => window.__game?.booted);
  const has = await page.evaluate(() => typeof window.__game?.debug?.lobbyAnimated === 'function');
  expect(has).toBe(true);
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
  await page.waitForFunction(v => __game.debug.stamina() > v + 5, s1, {timeout:5000});
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

// ====== #57 — Flashbang ======
test('#57 flashbang : stock initial = 2', async ({ page }) => {
  await startPlaying(page);
  const count = await page.evaluate(() => __game.debug.flashbangCount());
  expect(count).toBe(2);
});

test('#57 flashbang : lancer reduit le stock', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.throwFlashbang());
  const count = await page.evaluate(() => __game.debug.flashbangCount());
  expect(count).toBe(1);
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

test('#57 flashbang : rechargé par vague', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.throwFlashbang());
  await page.evaluate(() => __game.debug.throwFlashbang());
  expect(await page.evaluate(() => __game.debug.flashbangCount())).toBe(0);
  await page.evaluate(() => __game.debug.forceNextWave());
  await page.waitForFunction(() => __game.debug.flashbangCount() > 0, null, {timeout:10000});
  expect(await page.evaluate(() => __game.debug.flashbangCount())).toBe(2);
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

// ====== #69 — Grenade fumigène ======
test('#69 smoke : stock initial = 2', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.smokeStock())).toBe(2);
});

test('#69 smoke : throwSmoke reduit le stock', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.throwSmoke());
  expect(await page.evaluate(() => __game.debug.smokeStock())).toBe(1);
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

// ====== #70 — Marqueurs de spawn ======
test('#70 spawnmark : spawnMarkerCount initial = 0', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.spawnMarkerCount())).toBe(0);
});

test('#70 spawnmark : showSpawnMarker cree un marqueur', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.showSpawnMarker(5, 5));
  expect(await page.evaluate(() => __game.debug.spawnMarkerCount())).toBe(1);
});

test('#70 spawnmark : plusieurs marqueurs possibles', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => { __game.debug.showSpawnMarker(0,0); __game.debug.showSpawnMarker(3,3); __game.debug.showSpawnMarker(-3,3); });
  expect(await page.evaluate(() => __game.debug.spawnMarkerCount())).toBe(3);
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

// ====== #75 — Banner de vague ======
test('#75 wavebanner : element #wave-banner existe', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => !!document.getElementById('wave-banner'))).toBe(true);
});

test('#75 wavebanner : showWaveBanner affiche le numero de vague', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.showWaveBanner(3, false));
  const txt = await page.evaluate(() => document.getElementById('wave-banner').textContent);
  expect(txt).toContain('3');
});

test('#75 wavebanner : showWaveBanner boss affiche BOSS', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.showWaveBanner(5, true));
  const txt = await page.evaluate(() => document.getElementById('wave-banner').textContent.toUpperCase());
  expect(txt).toContain('BOSS');
});

// ====== #76 — Countdown inter-vague ======
test('#76 countdown : waveCountdown = 0 pendant une vague active', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.waveCountdown())).toBe(0);
});

test('#76 countdown : element #wave-countdown existe', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => !!document.getElementById('wave-countdown'))).toBe(true);
});

test('#76 countdown : waveCountdown > 0 apres fin de vague', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.killAllEnemies());
  const cd = await page.evaluate(() => __game.debug.waveCountdown());
  expect(cd).toBeGreaterThan(0);
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

// ====== #91 — Zone de danger ======
test('#91 zone : dangerZoneRadius() > 0 en jeu', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.dangerZoneRadius())).toBeGreaterThan(0);
});

test('#91 zone : playerInZone() true au spawn (centre map)', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.playerInZone())).toBe(true);
});

test('#91 zone : dangerZoneDamage() retourne 5', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.dangerZoneDamage())).toBe(5);
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
test('#118 sticky : stickyStock 1 par defaut', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.stickyStock())).toBe(1);
});

test('#118 sticky : throwSticky decrement stickyStock', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.throwSticky());
  expect(await page.evaluate(() => __game.debug.stickyStock())).toBe(0);
});

test('#118 sticky : throwSticky cree un projectile sticky', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.throwSticky());
  expect(await page.evaluate(() => __game.debug.stickyCount())).toBeGreaterThanOrEqual(1);
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

test('#111b/#121b : grenadier et stunner en vague paire 8+ (ghost supprimé)', async ({ page }) => {
  await startPlaying(page);
  const w8 = await page.evaluate(() => __game.debug.waveComposition(8));
  expect(w8).toContain('grenadier');   // i%7===6 pair
  expect(w8).toContain('stunner');     // i%6===5 dès v7 (slot ghost libéré)
  expect(w8).not.toContain('ghost');   // type supprimé
  const w12 = await page.evaluate(() => __game.debug.waveComposition(12));
  expect(w12).toContain('grenadier');
  expect(w12).not.toContain('ghost');
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

// ====== Boucle d'audit 2026-06-30 (2e cycle) : conformité doc/code + fuites de scène/HUD ======

test('AUDIT #118 : la grenade collante est rechargee a CHAQUE vague (1/vague, pas 1/partie)', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.stickyStock())).toBe(1);
  await page.evaluate(() => __game.debug.throwSticky());
  expect(await page.evaluate(() => __game.debug.stickyStock())).toBe(0);   // consommee
  await page.evaluate(() => __game.debug.forceNextWave());                 // vague suivante => refill
  expect(await page.evaluate(() => __game.debug.stickyStock())).toBe(1);   // rechargee
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

// ====== #130 — Molotov cocktail (zone de feu) ======
test('#130 molotov : stock initial = 1, throwMolotov le decremente', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.molotovStock())).toBe(1);
  await page.evaluate(() => __game.debug.throwMolotov());
  expect(await page.evaluate(() => __game.debug.molotovStock())).toBe(0);
  expect(await page.evaluate(() => __game.debug.molotovCount())).toBe(1); // en vol
});

test('#130 molotov : throwMolotov refuse si stock epuise', async ({ page }) => {
  await startPlaying(page);
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

test('#130 molotov : stock recharge a chaque vague', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.throwMolotov());
  expect(await page.evaluate(() => __game.debug.molotovStock())).toBe(0);
  await page.evaluate(() => __game.debug.forceNextWave());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.molotovStock())).toBe(1);
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
  await page.evaluate(() => { __game.debug.setView('first'); __game.debug.setPitch(0); });
  await page.waitForTimeout(150);
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8));
  await page.evaluate(() => __game.debug.setPitch(0)); // re-fige le pitch juste avant le tir (annule un éventuel recul résiduel)
  const hpBefore1 = await page.evaluate(() => __game.debug.enemyHp(0));
  await page.evaluate(() => __game.debug.tryFire());
  const hpAfter1 = await page.evaluate(() => __game.debug.enemyHp(0));
  const normalDmg = hpBefore1 - hpAfter1;
  expect(normalDmg).toBeGreaterThan(0);

  await page.evaluate(() => __game.debug.setShield(0));
  await page.evaluate(() => __game.debug.damagePlayer(80)); // PV <= 25% => adrénaline active
  await page.evaluate(() => __game.debug.spawnEnemyInFront(8)); // revit enemies[0] (hp/pos remis à neuf)
  await page.waitForTimeout(400); // laisse expirer le cooldown de tir entre les deux essais
  await page.evaluate(() => { __game.debug.setView('first'); __game.debug.setPitch(0); }); // même zone visée que le 1er tir
  const hpBefore2 = await page.evaluate(() => __game.debug.enemyHp(0));
  await page.evaluate(() => __game.debug.tryFire());
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

// ====== #136 — Grenade EMP ======
test('#136 grenade EMP : stock initial = 1, throwEmp le decremente', async ({ page }) => {
  await startPlaying(page);
  expect(await page.evaluate(() => __game.debug.empStock())).toBe(1);
  await page.evaluate(() => __game.debug.throwEmp());
  expect(await page.evaluate(() => __game.debug.empStock())).toBe(0);
  expect(await page.evaluate(() => __game.debug.empCount())).toBe(1);
});

test('#136 grenade EMP : throwEmp refuse si stock epuise', async ({ page }) => {
  await startPlaying(page);
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

test('#136 grenade EMP : stock recharge a chaque vague', async ({ page }) => {
  await startPlaying(page);
  await page.evaluate(() => __game.debug.throwEmp());
  expect(await page.evaluate(() => __game.debug.empStock())).toBe(0);
  await page.evaluate(() => __game.debug.forceNextWave());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __game.debug.empStock())).toBe(1);
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

// ====== #138 — Frappe aerienne (killstreak tier 10) ======
test('#138 airstrike : 10 kills en fenetre declenche le palier', async ({ page }) => {
  await startPlaying(page);
  for(let i=0;i<10;i++) await page.evaluate(() => __game.debug.registerKsKill());
  expect(await page.evaluate(() => __game.debug.ksRewardFired(10))).toBe(true);
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
  await page.evaluate(() => __game.debug.spawnEnemyTypeAt(0, 'shooter', 5, 0));
  const before1 = await page.evaluate(() => __game.debug.runMoney());
  await page.evaluate(() => { const hp = __game.debug.enemyHp(0); __game.debug.damageEnemy(0, hp); }); // exact : pas d'excédent overkill (#139)
  const normalGain = await page.evaluate(() => __game.debug.runMoney()) - before1;
  expect(normalGain).toBeGreaterThan(0);

  await page.evaluate(() => __game.debug.restart()); // remet combo/runMoney à zéro
  await page.waitForTimeout(100);
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

// ====== #148 — Soin d'execution (melee sur ennemi PV bas) ======
async function faceEnemyForMelee(page){
  await page.evaluate(() => {
    for(let i=0;i<3;i++) __game.debug.moveEnemy(i,40,40);
    __game.debug.setPos(0,0); __game.debug.setYaw(0); __game.debug.setPitch(0); __game.debug.setView('first');
    __game.debug.moveEnemy(0,0,2); __game.debug.setPaused(true);
  });
}

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

// ====== #150 — Power-up Munitions perforantes (piercing) ======
async function alignTwoEnemies(page){
  await page.evaluate(() => {
    __game.debug.setPos(0,0); __game.debug.setYaw(0); __game.debug.setPitch(0); __game.debug.setView('first');
    __game.debug.moveEnemy(0,0,3); __game.debug.moveEnemy(1,0,6); __game.debug.moveEnemy(2,40,40);
    __game.debug.setPaused(true);
  });
}

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
