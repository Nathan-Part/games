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
  await expect(page.locator('canvas')).toBeVisible();
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
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.characters?.length >= 2 && window.__game.phase === 'lobby', null, { timeout: 20000 });
  const labels = await page.evaluate(() => __game.characters.map(c => c.label).join('|').toLowerCase());
  expect(labels).toContain('guard');
  expect(labels).toContain('robot');
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
  await page.waitForFunction(y => window.__game.position().y > y + 0.2, y0, { timeout:3000 });   // décolle
  await page.waitForFunction(y => Math.abs(window.__game.position().y - y) < 0.05, y0, { timeout:5000 }); // retombe
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
  const a = await page.evaluate(() => __game.debug.tryFire());
  const b = await page.evaluate(() => __game.debug.tryFire());   // immédiat => bloqué par le cooldown
  expect(a).toBe(true);
  expect(b).toBe(false);
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
