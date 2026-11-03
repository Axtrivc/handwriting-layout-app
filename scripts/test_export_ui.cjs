const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {execFileSync}=require('node:child_process');
const {canvasPoint}=require('./browser_canvas.cjs');
const fixture=execFileSync('services/api/.venv/bin/python',['-c','import sys; sys.path.insert(0,"services/api/scripts"); from test_inpaint import CleanupTests; CleanupTests().fixture()[1].save(sys.stdout.buffer,format="PNG")']);
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1400,height:1000}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:5173');
 await page.locator('.upload-area input').setInputFiles({name:'scan.png',mimeType:'image/png',buffer:fixture});
 await page.getByText('300×140 · 0 字',{exact:true}).waitFor();
 await page.locator('canvas').first().waitFor();
 async function download(name){
  const promise=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();
  const stream=await(await promise).createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);return Buffer.concat(chunks);
 }
 const a=await download('导出 PNG');assert.equal(a.readUInt32BE(16),300);assert.equal(a.readUInt32BE(20),140);
 await page.mouse.move(...await canvasPoint(page,40,40));await page.mouse.wheel(0,-400);await page.waitForTimeout(100);
 await page.keyboard.down('Space');await page.mouse.down();await page.mouse.move(...await canvasPoint(page,100,65),{steps:10});await page.mouse.up();await page.keyboard.up('Space');
 const b=await download('导出 PNG');assert.deepEqual(a,b,'viewport zoom/pan must not affect pixels');
 await page.getByTitle('导出倍率').selectOption('2');const large=await download('导出 PNG');assert.equal(large.readUInt32BE(16),600);assert.equal(large.readUInt32BE(20),280);
 await page.getByTitle('导出倍率').selectOption('1');
 const pdf1=await download('页 PDF');
 await page.getByTitle('导出倍率').selectOption('2');const pdf2=await download('页 PDF');
 const boxPattern=/\/MediaBox\s*\[([^\]]+)\]/;
 assert.equal(pdf1.toString('latin1').match(boxPattern)[1],pdf2.toString('latin1').match(boxPattern)[1],'resolution must not change PDF paper size');
 await page.getByTitle('导出倍率').selectOption('1');
 await page.getByTitle('复制此页').click();
 await page.waitForTimeout(200);
 const duplicate=await download('导出 PNG');assert.deepEqual(duplicate,a,'duplicate page background is preserved');
 const visible=await page.locator('.canvas-viewport').evaluate(node=>{
  const c=node.querySelector('canvas'),ratio=c.width/c.clientWidth;
  const x=(Number(node.dataset.viewX)+5*Number(node.dataset.viewScale))*ratio;
  const y=(Number(node.dataset.viewY)+5*Number(node.dataset.viewScale))*ratio;
  return Array.from(c.getContext('2d').getImageData(x,y,1,1).data);
 });assert.equal(visible[3],255,'duplicate background must decode in editor');
 await download('保存');assert.equal(await page.locator('.dirty-dot').count(),0);
 await page.locator('summary').click();
 await page.getByPlaceholder('新档案名称（如：我的笔迹）').fill('测试档案');
 await page.getByRole('button',{name:'新建',exact:true}).click();assert.equal(await page.locator('.dirty-dot').count(),1,'profile edits must mark dirty');
 // Use the renderer directly to inspect rotation and deterministic naturalness.
 const render=await page.evaluate(async()=>{
  const {renderPageOffscreen}=await import('/src/lib/offscreenRender.ts');
  const {createEmptyProject,DEFAULT_TEXT_STYLE}=await import('/@fs/workspace/handwriting-layout-app/packages/shared/src/index.ts');
  const p=createEmptyProject();const page=p.pages[0];page.originalWidth=300;page.originalHeight=200;
  page.textObjects=[{id:'t',text:'MMMM',x:110,y:30,style:{...DEFAULT_TEXT_STYLE,fontSize:30,rotation:90},zIndex:0,naturalnessSeed:42,renderMode:'font',handwritingProfileId:null}];
  const options={profiles:[],activeProfileId:null,naturalness:p.settings.naturalness,naturalnessEnabled:false};
  const c=await renderPageOffscreen(page,options);const data=c.getContext('2d').getImageData(0,0,300,200).data;
  let minX=300,maxX=0,minY=200,maxY=0;for(let y=0;y<200;y++)for(let x=0;x<300;x++)if(data[(y*300+x)*4]<150){minX=Math.min(x,minX);maxX=Math.max(x,maxX);minY=Math.min(y,minY);maxY=Math.max(y,maxY);}
  options.naturalnessEnabled=true;const one=(await renderPageOffscreen(page,options)).toDataURL();const two=(await renderPageOffscreen(page,options)).toDataURL();
  return {width:maxX-minX,height:maxY-minY,stable:one===two};
 });
 assert.ok(render.height>render.width*2,'rotation must be drawn, not ignored');assert.ok(render.stable);
 await page.getByRole('button',{name:'+ 新页',exact:true}).click();
 await page.getByRole('button',{name:'+ 添加文本框',exact:true}).click();
 const blankPage=await download('导出 PNG');
 const hasText=await page.evaluate(async data=>{
  const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();
  const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
  return ctx.getImageData(0,0,c.width,c.height).data.some((value,i)=>i%4===0 && value<150);
 },blankPage.toString('base64'));
 assert.ok(hasText,'blank pages can be edited and exported without a background upload');
 assert.deepEqual(errors,[]);console.log('PASS: viewport-independent PNG, 2x size, page duplication, dirty profiles, rotation and stable rendering');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
