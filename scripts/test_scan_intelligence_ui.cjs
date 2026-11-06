const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const python = process.platform === 'win32' ? 'services/api/.venv/Scripts/python.exe' : 'services/api/.venv/bin/python';
const fixture=execFileSync(python,['-c','import sys;sys.path.insert(0,"services/api/scripts");from test_deskew import page_fixture;page_fixture(5).save(sys.stdout.buffer,format="PNG")']);
const ref=execFileSync(python,['-c','import sys;sys.path.insert(0,"services/api/scripts");from test_reference_restore import reference_fixture;reference_fixture().save(sys.stdout.buffer,format="PNG")']);
const annotated=execFileSync(python,['-c','import sys;sys.path.insert(0,"services/api/scripts");from test_reference_restore import reference_fixture;from PIL import ImageDraw;im=reference_fixture();ImageDraw.Draw(im).rectangle((200,240,390,290),fill="black");im.save(sys.stdout.buffer,format="PNG")']);
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{
 const page=await browser.newPage({viewport:{width:1500,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());const button=name=>page.getByRole('button',{name,exact:true});
 async function save(){const p=page.waitForEvent('download');await button('保存').click();const stream=await(await p).createReadStream();const a=[];for await(const c of stream)a.push(c);const text=Buffer.concat(a).toString();const {deserializeProject}=await import('../packages/shared/dist/index.js');return deserializeProject(text).project;}
 async function load(project){const p=page.waitForEvent('filechooser');await page.getByTitle('加载项目 JSON').click();await(await p).setFiles({name:'geometry.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});await button('加载').waitFor();}
 async function reference(buffer,name){const chooser=page.waitForEvent('filechooser');await button('原卷对照修复').click();await(await chooser).setFiles({name,mimeType:'image/png',buffer});}
 await page.goto('http://localhost:5173');await page.locator('.upload-area input').setInputFiles({name:'skew.png',mimeType:'image/png',buffer:fixture});await page.getByText('700×900 · 0 字',{exact:true}).waitFor();
 await button('+ 添加文本框').click();await page.getByLabel('文字内容').fill('Aligned text');const original=await save();
 await button('预览扫描').click();await button('应用扫描').waitFor();await page.getByText(/已校正 .*完整保留页面边界/).waitFor();
 assert.deepEqual((await save()).pages,original.pages,'preview must not commit geometry');
 await button('查看原图').click();await button('查看扫描效果').click();await button('应用扫描').click();const corrected=await save();
 const history=corrected.pages[0].cleanHistory.at(-1);assert.ok(Math.abs(history.scanTransform.rotation+5)<.4);assert.ok(history.scanColorSource.startsWith('data:image/png'));
 const beforeText=original.pages[0].textObjects[0], afterText=corrected.pages[0].textObjects[0];assert.ok(Math.abs(afterText.style.rotation-beforeText.style.rotation-history.scanTransform.rotation)<1e-8);
 assert.ok(Math.abs(afterText.style.fontSize-beforeText.style.fontSize*history.scanTransform.scale)<1e-8);
 await page.getByTitle('撤销 (Ctrl+Z)',{exact:true}).click();const textUndo=(await save()).pages[0].textObjects[0];
 assert.equal(textUndo.style.rotation,afterText.style.rotation);assert.equal(textUndo.style.fontSize,afterText.style.fontSize);
 await page.getByTitle('重做 (Ctrl+Y)',{exact:true}).click();assert.deepEqual((await save()).pages[0].textObjects[0],afterText);
 const pending=page.waitForRequest(r=>r.url().endsWith('/clean-region'));await button('自动去红蓝笔（预览）').click();assert.equal((await pending).postDataJSON().colorSource,history.scanColorSource.split(',')[1]);await page.getByText(/未检测到红蓝笔迹/).waitFor();
 await load(corrected);await button('↶ 撤销扫描').click();await page.waitForFunction(src=>document.querySelector('.page-item.is-active img')?.getAttribute('src')===src,original.pages[0].backgroundImage);
 const restored=await save();for(const k of ['fontSize','rotation','letterSpacing'])assert.ok(Math.abs(restored.pages[0].textObjects[0].style[k]-beforeText.style[k])<1e-8);
 await page.locator('.upload-area input').setInputFiles({name:'covered.png',mimeType:'image/png',buffer:annotated});
 await page.waitForFunction(src=>document.querySelector('.page-item.is-active img')?.getAttribute('src')===src,`data:image/png;base64,${annotated.toString('base64')}`);
 await reference(ref,'original.png');await button('应用清除').waitFor();await page.getByText(/已按参考原卷恢复页面/).waitFor();
 await button('应用清除').click();const referenceRestored=await save();assert.equal(referenceRestored.pages[0].cleanHistory.at(-1).scanColorSource,referenceRestored.pages[0].backgroundImage);
 const pixels=await page.evaluate(async src=>{const im=new Image();im.src=src;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);const d=ctx.getImageData(200,240,190,50).data;let white=0,black=0;for(let i=0;i<d.length;i+=4){if(d[i]>200)white++;if(d[i]<40)black++;}return{white,black};},referenceRestored.pages[0].backgroundImage);
 assert.ok(pixels.white>4000&&pixels.black>100,'recover printed text underneath black annotation, not just fill white');
 await reference(fixture,'wrong.png');await page.getByText(/参考原卷无法可靠对齐/).waitFor();assert.equal((await save()).pages[0].backgroundImage,referenceRestored.pages[0].backgroundImage);
 assert.deepEqual(errors,[]);console.log('PASS: deskew preview/commit/inverse after reload, text/history/color alignment, reference recovery of hidden print and wrong-page rejection');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
