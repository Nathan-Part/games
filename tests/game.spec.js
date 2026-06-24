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
  await page.keyboard.press('f');                         // F = recharger
  await page.waitForFunction(() => __game.ammo === 12, null, { timeout:5000 });
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
  expect(await page.evaluate(() => __game.debug.enemyHp(0))).toBe(120);   // enemyHpForWave(2)
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
  expect(await page.evaluate(() => __game.health)).toBe(100);
  await page.evaluate(() => __game.debug.damagePlayer(40));
  expect(await page.evaluate(() => __game.health)).toBe(60);
  await page.waitForFunction(() => __game.health > 60, null, { timeout:12000 }); // régén après le délai (6 s)
});

test('à 0 PV : Game Over, puis Rejouer remet la partie à zéro', async ({ page }) => {
  await startPlaying(page);
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
  await page.evaluate(() => __game.debug.killAllEnemies());       // 3 kills + bonus vague 1
  const after = await page.evaluate(() => __game.money);
  expect(after - before).toBe(3 * rates.perKill + rates.perWave * 1);
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
  await expect(page.locator('#shop-info')).toContainText('Visière');                 // sous-onglet Casque par défaut
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
  await page.waitForFunction(() => __game.debug.enemyState(0) === 'melee', null, { timeout:5000 });
  await page.waitForFunction(() => __game.health < 100, null, { timeout:5000 });
});

test('types : un tank est coriace (PV+) et frappe fort', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  await page.evaluate(() => { __game.debug.setEnemyAccuracy(1); __game.debug.spawnEnemyTypeAt(0,'tank',16,0); });
  expect(await page.evaluate(() => __game.debug.enemyHp(0))).toBeGreaterThan(200);
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
  await expect(page.locator('#shop-info')).toContainText('Fusil');          // onglet Armes (défaut)
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
  await expect(page.locator('#pickup-prompt')).toContainText('Sniper');
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
