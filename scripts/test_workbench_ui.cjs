const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const button=name=>page.getByRole('button',{name,exact:true});
 async function download(name){const p=page.waitForEvent('download');await button(name).click();const stream=await(await p).createReadStream();const a=[];for await(const b of stream)a.push(b);return Buffer.concat(a).toString();}
 await page.goto('http://localhost:5173');await page.getByText('让文字带上你的笔迹').waitFor();
 assert.equal(await page.getByLabel('作品名称').inputValue(),'我的手写作品');
 await page.getByLabel('作品名称').fill('英语与中文练习');await page.getByLabel('作品名称').press('Tab');
 assert.equal(JSON.parse(await download('保存')).name,'英语与中文练习');
 await button('字帖工坊').click();await page.getByRole('dialog').waitFor();
 await page.getByRole('button',{name:/^基础字帖/}).click();
 const labels=(await download('下载标注顺序')).replaceAll('\n','');assert.equal([...labels].filter(c=>c==='8').length,5);
 assert.equal(new Set([...labels].filter(c=>/\p{Script=Han}/u.test(c))).size,300);
 await page.screenshot({path:'/tmp/ink-workbook.png'});
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
 assert.ok(await button('字帖工坊').evaluate(n=>document.activeElement===n));
 await button('字帖工坊').click();await page.getByRole('button',{name:/^进阶字帖/}).click();
 const advanced=(await download('下载标注顺序')).replaceAll('\n','');assert.equal(new Set([...advanced].filter(c=>/\p{Script=Han}/u.test(c))).size,2500);
 await button('关闭字帖工坊').click();
 await page.locator('#write-step > summary').click();assert.equal(await page.locator('#write-step').evaluate(n=>n.open),false);
 await page.getByRole('navigation',{name:'编辑步骤'}).getByRole('button',{name:/排版/}).click();assert.equal(await page.locator('#write-step').evaluate(n=>n.open),true);
 await page.setViewportSize({width:1024,height:768});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 for(const box of await page.locator('.header-tools button').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right};})))assert.ok(box.left>=0&&box.right<=1024);
 assert.deepEqual(errors,[]);console.log('PASS: brand/rename persistence, standalone basic/advanced workbook without a profile, Escape/focus, workflow navigation and 1024px layout');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
