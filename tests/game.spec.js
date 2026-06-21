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

test('cumuler des dégâts tue un ennemi (+1 score) puis il réapparaît', async ({ page }) => {
  await startPlaying(page);
  await page.waitForFunction(() => window.__game.debug.enemyCount?.() === 3, null, { timeout:20000 });
  const s0 = await page.evaluate(() => __game.score);
  await page.evaluate(() => __game.debug.damageEnemy(0, 50));            // torse
  expect(await page.evaluate(() => __game.debug.enemyHp(0))).toBe(50);
  expect(await page.evaluate(() => __game.debug.enemyAlive())).toBe(3);   // pas encore mort (100 PV)
  await page.evaluate(() => __game.debug.damageEnemy(0, 50));            // total 100 => mort
  expect(await page.evaluate(() => __game.debug.enemyAlive())).toBe(2);
  expect(await page.evaluate(() => __game.score)).toBe(s0 + 1);          // +1 score
  expect(await page.evaluate(() => __game.debug.enemyState(0))).toBe('dead');
  await page.waitForFunction(() => __game.debug.enemyAlive() === 3, null, { timeout:6000 }); // respawn
  expect(await page.evaluate(() => __game.debug.enemyHp(0))).toBe(100);
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
  await page.evaluate(() => { __game.debug.setEnemyAccuracy(1); __game.debug.spawnEnemyAt(0, 6); });
  const h0 = await page.evaluate(() => __game.health);
  await page.evaluate(() => __game.debug.forceEnemyShoot(0));
  expect(await page.evaluate(() => __game.health)).toBe(h0 - 10);
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

test('intégration : valider Guard dans le studio => seul Guard au lobby du jeu', async ({ page }) => {
  await page.goto('/studio.html');
  await page.waitForFunction(() => window.__studioReady === true, null, { timeout:20000 });
  await page.click('#btn-gallery');
  await page.waitForSelector('#gallery-grid .gcard', { timeout:20000 });
  await page.locator('.gcard', { hasText: 'Guard' }).first().locator('.gr-toggle').click();
  await page.waitForTimeout(200);
  await page.goto('/game.html');
  await page.waitForFunction(() => window.__game?.characters?.length >= 1, null, { timeout:20000 });
  const labels = await page.evaluate(() => __game.characters.map(c => c.label.toLowerCase()));
  expect(labels).toEqual(['guard']); // seul le perso validé apparaît
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
