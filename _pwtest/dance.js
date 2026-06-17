const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ headless:true, channel:'chromium',
    args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport:{width:900,height:760} });
  await p.goto('http://localhost:8123/sentinel-viewer.html', { waitUntil:'load' });
  await p.waitForSelector('#overlay.hidden', { timeout:30000 });
  await sleep(800);
  await p.mouse.move(450,380); for(let i=0;i<6;i++){ await p.mouse.wheel(0,220); await sleep(50); }
  await p.click('.body-btn[data-body="cyborg"]'); await sleep(900);
  await p.click('.anim-btn[data-key="All_Night_Dance"]'); await sleep(800);
  for(let i=0;i<4;i++){ await sleep(300); await p.screenshot({path:`dance_${i}.png`}); }
  await b.close();
})();
