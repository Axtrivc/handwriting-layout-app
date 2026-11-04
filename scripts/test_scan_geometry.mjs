import assert from 'node:assert/strict';
import { createEmptyProject, DEFAULT_TEXT_STYLE, serializeProject, deserializeProject } from '../packages/shared/dist/index.js';
import { transformTexts, colorSourceForPage } from '../apps/web/src/lib/scanGeometry.ts';
import { HistoryStore } from '../apps/web/src/lib/historyStore.ts';
const p=createEmptyProject(), page=p.pages[0];
const text={id:'t',text:'恢复',x:40,y:75,style:{...DEFAULT_TEXT_STYLE,rotation:7,letterSpacing:2},zIndex:1,naturalnessSeed:42,renderMode:'font',handwritingProfileId:null};
const transform={rotation:-7,scale:.85};
const moved=transformTexts([text],page,transform);
const restored=transformTexts(moved,page,transform,true)[0];
for(const field of ['x','y']) assert.ok(Math.abs(restored[field]-text[field])<1e-9);
for(const field of ['fontSize','rotation','letterSpacing','blur']) assert.ok(Math.abs(restored.style[field]-text.style[field])<1e-9);
assert.notEqual(moved[0].x,text.x);assert.equal(moved[0].style.rotation,0);
const history=new HistoryStore();history.push(page.id,[text]);history.push('other',[text]);
history.mapSnapshots(page.id,snapshot=>transformTexts(snapshot,page,transform));
assert.deepEqual(history.undo(page.id,moved),moved,'old text undo snapshots follow corrected page geometry');
history.mapSnapshots(page.id,snapshot=>transformTexts(snapshot,page,transform,true));
const redone=history.redo(page.id,[text]);assert.ok(Math.abs(redone[0].x-text.x)<1e-9);
assert.deepEqual(history.undo('other',[text]),[text],'other page histories remain intact');
page.textObjects=moved;
page.cleanHistory=[{operation:'scan',beforeImage:'old',afterImage:'new',regions:[],scanTransform:transform,scanColorSource:'aligned-color'}];
assert.equal(colorSourceForPage(page),'aligned-color');
const loaded=deserializeProject(serializeProject(p));assert.ok(loaded.ok);assert.deepEqual(loaded.project.pages[0].cleanHistory,page.cleanHistory);
for(const invalid of [{rotation:NaN,scale:1},{rotation:90,scale:1},{rotation:3,scale:0}]) {
 const bad=structuredClone(p);bad.pages[0].cleanHistory[0].scanTransform=invalid;
 assert.equal(deserializeProject(JSON.stringify(bad)).ok,false);
}
console.log('PASS: text geometry/inverse, aligned color history, save/load and malformed transform rejection');
