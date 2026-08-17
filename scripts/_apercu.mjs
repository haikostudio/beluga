import path from 'node:path'; import crypto from 'node:crypto'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const D='/root/haikodev/data';
const db=require(path.join(D,'../node_modules/better-sqlite3'))(path.join(D,'haikodev.db'));
const c=crypto.randomBytes(24).toString('hex');
const e=crypto.createHash('sha256').update(c).digest('hex');
db.prepare('INSERT INTO sessions (token,created_at,expires_at,label) VALUES (?,?,?,?)').run(e,Date.now(),Date.now()+3600000,'aperçu langues');
db.close();
const { chromium } = await import('playwright');
const n=await chromium.launch({channel:'chrome'});
const ctx=await n.newContext({viewport:{width:1400,height:900}});
await ctx.addCookies([{name:'haikodev_session',value:c,domain:'localhost',path:'/'}]);
const p=await ctx.newPage();
await p.goto('http://localhost:7102',{waitUntil:'domcontentloaded',timeout:20000});
await p.waitForTimeout(7000);
for (const l of ['de','zh','fr']) {
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  if (!(await p.$('[data-langue-menu]'))) await p.click('button[aria-label="Menu"]');
  await p.waitForSelector('[data-langue-menu]');
  await p.click('[data-langue-menu]'); await p.waitForTimeout(500);
  await p.click(`[data-langue-choix="${l}"]`); await p.waitForTimeout(1500);
  console.log(l, '→ entêtes:', JSON.stringify(await p.$$eval('[data-column] h2', t=>t.map(x=>x.textContent.trim()))));
  /* Un débordement horizontal : une traduction plus longue qui casse la mise en page. */
  const deborde = await p.evaluate(()=>{
    const trop=[];
    for (const el of document.querySelectorAll('button, h2, [data-column] h2, header *')) {
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) trop.push((el.textContent||'').trim().slice(0,40));
    }
    return trop.slice(0,8);
  });
  console.log('   débordements:', deborde.length ? JSON.stringify(deborde) : 'aucun');
  if (l!=='fr') await p.screenshot({path:`/tmp/langue-${l}.png`});
}
await n.close();
const db2=require(path.join(D,'../node_modules/better-sqlite3'))(path.join(D,'haikodev.db'));
db2.prepare('DELETE FROM sessions WHERE token=?').run(e); db2.close();
