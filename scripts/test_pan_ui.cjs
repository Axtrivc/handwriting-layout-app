const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {canvasPoint}=require('./browser_canvas.cjs');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:1500,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const button=name=>page.getByRole('button',{name,exact:true});
 async function download(name){const wait=page.waitForEvent('download');await button(name).click();const stream=await(await wait).createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);return Buffer.concat(chunks);}
 const save=async()=>JSON.parse((await download('保存')).toString());
 const view=()=>page.locator('.canvas-viewport').evaluate(n=>({x:Number(n.dataset.viewX),y:Number(n.dataset.viewY),scale:Number(n.dataset.viewScale)}));
 async function drag(x,y,dx,dy){const point=await canvasPoint(page,x,y);await page.mouse.move(...point);await page.mouse.down();await page.mouse.move(point[0]+dx,point[1]+dy,{steps:10});await page.mouse.up();}
 await page.goto('http://localhost:5173');
 const source=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=400;c.height=300;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,400,300);ctx.fillStyle='black';ctx.fillRect(60,60,10,10);return c.toDataURL();});
 await page.locator('.upload-area input').setInputFiles({name:'pan.png',mimeType:'image/png',buffer:Buffer.from(source.split(',')[1],'base64')});
 await page.getByText('400×300 · 0 字',{exact:true}).waitFor();
 const initial=await save(),png=await download('导出 PNG'),before=await view();
 await drag(30,30,65,40);const after=await view();assert.equal(after.x-before.x,65);assert.equal(after.y-before.y,40);
 assert.deepEqual((await save()).pages,initial.pages);assert.deepEqual(await download('导出 PNG'),png,'panning must not change exported pixels');
 await button('+ 添加文本框').click();const textBefore=(await save()).pages[0].textObjects[0],textView=await view();
 await drag(textBefore.x+5,textBefore.y+5,25,15);const textAfter=(await save()).pages[0].textObjects[0];
 assert.ok(Math.abs(textAfter.x-textBefore.x-25)<1);assert.deepEqual(await view(),textView,'normal text drag moves only text');
 await button('拖动画布').click();assert.equal(await button('拖动画布').getAttribute('aria-pressed'),'true');
 await drag(textAfter.x+5,textAfter.y+5,-30,-20);assert.equal((await view()).x-textView.x,-30);
 assert.deepEqual((await save()).pages[0].textObjects[0],textAfter,'hand tool must not move text');
 await page.getByLabel('框选模式',{exact:true}).check();await page.waitForFunction(()=>document.querySelector('[title^="开启后按住鼠标左键"]')?.getAttribute('aria-pressed')==='false');
 await drag(20,20,80,80);await button('预览清除 (1)').waitFor();
 await button('拖动画布').click();const selectedView=await view();await drag(50,50,25,30);assert.equal((await view()).x-selectedView.x,25);
 await button('拖动画布').click();
 await page.route('**/clean-region',r=>r.fulfill({json:{image:source.split(',')[1],mime:'image/png',processed:1,changed:true}}));
 const pending=page.waitForRequest(r=>r.url().endsWith('/clean-region'));await button('预览清除 (1)').click();const rect=(await pending).postDataJSON().regions[0];
 for(const [key,value] of Object.entries({x:20,y:20,width:80,height:80}))assert.ok(Math.abs(rect[key]-value)<2,JSON.stringify(rect));
 await button('取消预览').click();await page.getByTitle('清空已框选区域').click();
 await page.getByLabel('选区工具',{exact:true}).selectOption('brush');await drag(60,60,15,15);await button('预览清除 (1)').waitFor();
 await button('拖动画布').click();await drag(60,60,-20,-20);await button('预览清除 (1)').waitFor();
 await button('拖动画布').click();await drag(80,80,10,10);await button('预览清除 (2)').waitFor();
 await page.keyboard.down('Space');const point=await canvasPoint(page,50,50);await page.mouse.move(...point);await page.mouse.down();await page.mouse.move(point[0]+10,point[1]+10,{steps:5});
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();await page.keyboard.up('Space');
 assert.equal(await page.locator('.konvajs-content').evaluate(n=>n.parentElement.style.cursor),'crosshair');
 assert.deepEqual(errors,[]);console.log('PASS: direct paper drag, unchanged document/export, text drag isolation, hand tool over text/selection, original selection coordinates, brush resume and blur recovery');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
