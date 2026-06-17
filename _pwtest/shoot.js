const { chromium } = require('playwright');

const URL = 'http://localhost:8123/sentinel-viewer.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--enable-webgl']
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 760 } });

  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror:' + e.message));

  await page.goto(URL, { waitUntil: 'load' });

  // attendre la fin du chargement (overlay caché)
  try {
    await page.waitForSelector('#overlay.hidden', { timeout: 30000 });
  } catch (e) { errors.push('overlay never hidden (chargement échoué)'); }
  await sleep(1000);

  // dézoomer pour voir tout le corps (molette sur le centre du canvas)
  await page.mouse.move(450, 380);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 220); await sleep(60); }
  await sleep(400);

  async function shoot(tag, frames = 4, gap = 220) {
    for (let i = 0; i < frames; i++) {
      await sleep(gap);
      await page.screenshot({ path: `shot_${tag}_${i}.png` });
    }
  }
  async function clickBody(b) {
    await page.click(`.body-btn[data-body="${b}"]`);
    await sleep(400);
    try { await page.waitForSelector('#overlay.hidden', { timeout: 15000 }); } catch {}
    await sleep(500);
  }
  async function clickAnim(k) {
    await page.click(`.anim-btn[data-key="${k}"]`);
    await sleep(600);
  }

  // 1) Sentinel walking (référence native)
  await clickAnim('Walking');
  await shoot('sentinel_walk');

  // 2) Cyborg walking (retargeté)
  await clickBody('cyborg');
  await clickAnim('Walking');
  await shoot('cyborg_walk');

  // 3) Cyborg boxe (le pire cas signalé)
  await clickAnim('Boxing_Practice');
  await shoot('cyborg_boxe');

  // 4) Sentinel boxe (pour comparer)
  await clickBody('sentinel');
  await clickAnim('Boxing_Practice');
  await shoot('sentinel_boxe');

  console.log('ERRORS:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
  await browser.close();
})();
