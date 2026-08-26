import { chromium } from 'playwright';
const browser = await chromium.launch();

const mobile = await browser.newContext({ viewport: { width: 390, height: 1600 } });
const mp = await mobile.newPage();
await mp.goto('http://localhost:3012/', { waitUntil: 'networkidle' });
await mp.waitForTimeout(1500);
let count = await mp.locator('[data-ref="page-landing-why-table"]').count();
console.log('mobile table count', count);
if (count) {
  const mtable = mp.locator('[data-ref="page-landing-why-table"]');
  await mtable.scrollIntoViewIfNeeded();
  await mp.waitForTimeout(600);
  await mtable.screenshot({ path: '/tmp/compare-mobile.png' });
}

const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const dp = await desktop.newPage();
await dp.goto('http://localhost:3012/', { waitUntil: 'networkidle' });
await dp.waitForTimeout(1500);
count = await dp.locator('[data-ref="page-landing-why-table"]').count();
console.log('desktop table count', count);
if (count) {
  const dtable = dp.locator('[data-ref="page-landing-why-table"]');
  await dtable.scrollIntoViewIfNeeded();
  await dp.waitForTimeout(600);
  await dtable.screenshot({ path: '/tmp/compare-desktop.png' });
}

await browser.close();
