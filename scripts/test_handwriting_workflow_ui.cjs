const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {canvasPoint} = require('./browser_canvas.cjs');
const python = process.platform === 'win32' ? 'services/api/.venv/Scripts/python.exe' : 'services/api/.venv/bin/python';
const fixture=execFileSync(python,['-c','import sys;sys.path.insert(0,"services/api/scripts");from test_color_cleanup import ColorTests;ColorTests().fixture().save(sys.stdout.buffer,format="PNG")']);
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try {
 const page=await browser.newPage({viewport:{width:1500,height:1100}}); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const button=name=>page.getByRole('button',{name,exact:true});
 async function save(){const p=page.waitForEvent('download');await button('保存').click();const stream=await(await p).createReadStream();const a=[];for await(const b of stream)a.push(b);const text=Buffer.concat(a).toString();const {deserializeProject}=await import('../packages/shared/dist/index.js');return deserializeProject(text).project;}
 async function drag(a,b){await page.mouse.move(...await canvasPoint(page,...a));await page.mouse.down();await page.mouse.move(...await canvasPoint(page,...b),{steps:10});await page.mouse.up();}
 await page.goto('http://localhost:5173');
 await page.locator('.upload-area input').setInputFiles({name:'color.png',mimeType:'image/png',buffer:fixture});
 await page.getByText('300×200 · 0 字',{exact:true}).waitFor();
 const original=(await save()).pages[0].backgroundImage;
 await page.getByLabel('框选模式',{exact:true}).check();await drag([30,20],[100,110]);
 // Four side handles independently change one dimension only.
 await drag([65,20],[65,15]);await drag([100,62.5],[110,62.5]);await drag([70,110],[70,120]);await drag([30,67.5],[25,67.5]);
 const request=page.waitForRequest(r=>r.url().endsWith('/clean-region'));
 await button('预览清除 (1)').click();const region=(await request).postDataJSON().regions[0];
 for(const [k,v] of Object.entries({x:25,y:15,width:85,height:105}))assert.ok(Math.abs(region[k]-v)<3,JSON.stringify(region));
 await button('取消预览').click();await page.getByTitle('清空已框选区域').click();
 await page.getByLabel('选区工具',{exact:true}).selectOption('brush');await page.getByLabel('画笔像素数',{exact:true}).fill('1');
 assert.equal(await page.getByLabel('画笔粗细',{exact:true}).inputValue(),'1');
 await button('自动去红蓝笔（预览）').click();await button('应用清除').waitFor();
 assert.equal((await save()).pages[0].backgroundImage,original);
 await button('应用清除').click();const cleaned=await save();assert.notEqual(cleaned.pages[0].backgroundImage,original);
 await button('↶ 撤销清除').click();await page.waitForFunction(s=>document.querySelector('.page-item.is-active img')?.getAttribute('src')===s,original);
 await button('预览扫描').click();await button('应用扫描').click();
 const autoRequest=page.waitForRequest(r=>r.url().endsWith('/clean-region'));
 await button('自动去红蓝笔（预览）').click();assert.equal((await autoRequest).postDataJSON().colorSource,original.split(',')[1]);
 await button('应用清除').click();
 await button('＋ 添加手写文字').click();await page.getByLabel('文字内容').fill('Hello 123');
 const project=await save();const text=project.pages[0].textObjects[0];assert.equal(text.text,'Hello 123');assert.equal(text.style.fontFamily,'Caveat, cursive');
 assert.ok(await page.evaluate(()=>document.fonts.check('32px Caveat')));
 const pending=page.waitForEvent('download');await button('导出 PNG').click();const stream=await(await pending).createReadStream();const chunks=[];for await(const b of stream)chunks.push(b);assert.ok(Buffer.concat(chunks).length>1000);
 await button('我的字迹 / 采样字帖').click();assert.ok(await page.locator('#handwriting-profiles').evaluate(n=>n.open));
 assert.deepEqual(errors,[]);console.log('PASS: four side handles, 1px brush, color auto preview/undo/history source, handwritten overlay and export, sample entry');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
