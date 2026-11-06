// Requires a running API + Vite, Playwright and Chromium. Set PLAYWRIGHT_MODULE
// and CHROMIUM_PATH when using tools installed outside this repository.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { execFileSync } = require('node:child_process');
const { canvasPoint } = require('./browser_canvas.cjs');
const python = process.platform === 'win32' ? 'services/api/.venv/Scripts/python.exe' : 'services/api/.venv/bin/python';
const fixture = execFileSync(python, ['-c',
  'import sys; sys.path.insert(0,"services/api/scripts"); from test_inpaint import CleanupTests; CleanupTests().fixture((175,175,175),"dashed")[1].save(sys.stdout.buffer,format="PNG")']);
(async () => {
 const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page = await browser.newPage({viewport:{width:1400,height:1000}});
 const errors=[]; page.on('pageerror',err=>errors.push(err.message));
 await page.goto('http://localhost:5173');
 await page.locator('.upload-area input').setInputFiles({name:'cleanup.png',mimeType:'image/png',buffer:fixture});
 await page.getByText('300×140 · 0 字',{exact:true}).waitFor();
 await page.locator('canvas').first().waitFor();
 await page.getByLabel('框选模式',{exact:true}).check();
 await page.mouse.move(...await canvasPoint(page,100,38));await page.mouse.down();await page.mouse.move(...await canvasPoint(page,170,98),{steps:10});await page.mouse.up();
 await page.getByRole('button',{name:'预览清除 (1)',exact:true}).click();
 await page.getByRole('button',{name:'应用清除',exact:true}).waitFor();
 await page.getByRole('button',{name:'查看原图',exact:true}).click();
 await page.getByRole('button',{name:'查看清除效果',exact:true}).click();
 await page.getByRole('button',{name:'取消预览',exact:true}).click();
 await page.getByRole('button',{name:'预览清除 (1)',exact:true}).click();
 await page.getByRole('button',{name:'应用清除',exact:true}).click();
 await page.getByRole('button',{name:'↶ 撤销清除',exact:true}).click();
 await page.waitForTimeout(200);
 if(await page.getByRole('button',{name:'↶ 撤销清除',exact:true}).count()) throw Error('Undo did not clear history');
 console.log('PASS: select, preview, compare, cancel, apply, undo');
 // Text history: first edit can be undone and redone.
 await page.getByLabel('框选模式',{exact:true}).uncheck();
 await page.getByRole('button',{name:'+ 添加文本框',exact:true}).click();
 if(await page.locator('.text-list li.is-active').count() !== 1) throw Error('text not added');
 await page.locator('.app-brand').click();
 await page.keyboard.press('Control+z');
 if(await page.locator('.text-list').innerText() !== '暂无文本，点击上方添加') throw Error('first undo failed');
 await page.keyboard.press('Control+y');
 if(!(await page.locator('.text-list').innerText()).includes('文本')) throw Error('redo failed');
 console.log('PASS: first text edit undo/redo');
 // Zoom at the origin, then resize the existing selection without drawing another.
 await page.getByLabel('框选模式',{exact:true}).check();
 await page.mouse.move(...await canvasPoint(page,1,1)); await page.mouse.wheel(0,-100);
 await page.waitForTimeout(100);
 await page.mouse.move(...await canvasPoint(page,100,38));await page.mouse.down();await page.mouse.move(...await canvasPoint(page,170,98),{steps:10});await page.mouse.up();
 await page.mouse.move(...await canvasPoint(page,170,98));await page.mouse.down();await page.mouse.move(...await canvasPoint(page,175,103),{steps:10});await page.mouse.up();
 const requestPromise=page.waitForRequest(r=>r.url().endsWith('/clean-region'));
 await page.getByRole('button',{name:'预览清除 (1)',exact:true}).click();
 const request=await requestPromise;
 const regions=request.postDataJSON().regions;
 if(regions.length!==1 || Math.abs(regions[0].x-100)>2 || Math.abs(regions[0].width-75)>3) throw Error('zoom/resize coordinates: '+JSON.stringify(regions));
 await page.getByRole('button',{name:'取消预览',exact:true}).click();
 console.log('PASS: zoom coordinates and transform does not create extra selection');
 let release;
 const delay = new Promise(resolve=>release=resolve);
 await page.route('**/clean-region', async route=>{ await delay; await route.continue(); });
 const pending=page.waitForRequest(r=>r.url().endsWith('/clean-region'));
 await page.getByRole('button',{name:'预览清除 (1)',exact:true}).click();
 await pending;
 const aborted=page.waitForEvent('requestfailed',r=>r.url().endsWith('/clean-region'));
 await page.getByRole('button',{name:'+ 新页',exact:true}).click();
 release(); await aborted; await page.waitForTimeout(200);
 if(await page.getByRole('button',{name:'应用清除',exact:true}).count()) throw Error('stale result leaked to new page');
 console.log('PASS: delayed cleanup cancelled after switching pages');
 if(errors.length) throw Error(errors.join('\n'));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
