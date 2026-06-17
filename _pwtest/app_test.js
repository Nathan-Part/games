const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ headless:true, channel:'chromium',
    args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport:{width:900,height:760} });
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror:'+e.message));
  await p.goto('http://localhost:8123/app.html', { waitUntil:'load' });
  let loaded = true;
  try { await p.waitForSelector('#overlay.hidden', { timeout:30000 }); }
  catch { loaded = false; }

  // que contient l'UI ? (découverte)
  const persos = await p.$$eval('.body-btn', els => els.map(e => e.dataset.char));
  const animCount = await p.$$eval('.anim-btn', els => els.length);
  console.log('LOADED:', loaded, '| persos:', JSON.stringify(persos), '| anims:', animCount);

  if (loaded) {
    await p.mouse.move(450,380); for(let i=0;i<7;i++){ await p.mouse.wheel(0,220); await sleep(50); }
    // perso 0, boxe
    await p.click('.anim-btn[data-key="Boxing_Practice"]'); await sleep(900);
    await p.screenshot({ path:'app_p0_boxe.png' });
    // perso 1 si présent, danse
    if (persos[1]) {
      await p.click(`.body-btn[data-char="${persos[1]}"]`); await sleep(1000);
      try { await p.waitForSelector('#overlay.hidden', { timeout:15000 }); } catch {}
      await p.click('.anim-btn[data-key="All_Night_Dance"]'); await sleep(900);
      await p.screenshot({ path:'app_p1_dance.png' });
    }
  } else {
    await p.screenshot({ path:'app_error.png' });
  }
  console.log('ERRORS:', errs.length ? JSON.stringify(errs) : 'none');
  await b.close();
})();
