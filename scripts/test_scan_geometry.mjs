import assert from 'node:assert/strict';
import { createEmptyProject, DEFAULT_TEXT_STYLE, serializeProject, deserializeProject } from '../packages/shared/dist/index.js';
import { transformTexts, colorSourceForPage, colorSourceAfterOperation, colorSourceAfterUndo } from '../apps/web/src/lib/scanGeometry.ts';
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

function applyBackground(page,operation,afterImage,correctedColor) {
 const beforeImage=page.backgroundImage;
 const beforeColorSource=colorSourceForPage(page)??null;
 return {...page,backgroundImage:afterImage,
  colorSource:colorSourceAfterOperation(page,operation,beforeImage,correctedColor),
  cleanHistory:[...page.cleanHistory,{operation,beforeImage,afterImage,regions:[],beforeColorSource,
   ...(correctedColor?{scanColorSource:correctedColor}:{})}].slice(-10)};
}
function undoBackground(page) {
 const last=page.cleanHistory.at(-1);
 return {...page,backgroundImage:last.beforeImage,colorSource:colorSourceAfterUndo(page),cleanHistory:page.cleanHistory.slice(0,-1)};
}
const original=createEmptyProject().pages[0];original.backgroundImage='raw-color';
const scanned=applyBackground(original,'scan','scan-bw','aligned-color');
assert.equal(colorSourceForPage(scanned),'aligned-color');
assert.equal(colorSourceForPage(undoBackground(scanned)),undefined,'undoing the first scan restores the absent color source');
const repaired=applyBackground(scanned,'clean','reference-repair','reference-color');
assert.equal(colorSourceForPage(repaired),'reference-color');
assert.equal(colorSourceForPage(undoBackground(repaired)),'aligned-color','undoing reference repair restores the prior source');
let cleaned=scanned;
for(let i=0;i<10;i++) cleaned=applyBackground(cleaned,'clean',`clean-${i}`);
assert.equal(cleaned.cleanHistory.length,10);
assert.equal(cleaned.cleanHistory.some(entry=>entry.operation==='scan'),false,'the scan has left the bounded history');
assert.equal(colorSourceForPage(cleaned),'aligned-color','page asset survives ten cleanups');
const saved=deserializeProject(serializeProject({...p,pages:[cleaned],activePageId:cleaned.id}));
assert.ok(saved.ok);assert.equal(colorSourceForPage(saved.project.pages[0]),'aligned-color','page asset survives save/load');
let undone=saved.project.pages[0];
for(let i=0;i<10;i++) {
 undone=undoBackground(undone);
 assert.equal(colorSourceForPage(undone),'aligned-color',`cleanup undo ${i+1} preserves color source`);
}
assert.equal(undone.cleanHistory.length,0);assert.equal(undone.backgroundImage,'scan-bw');
assert.equal(colorSourceAfterUndo(page),null,'legacy scan undo derives the prior empty source from history');
for(const mutate of [bad=>{bad.pages[0].colorSource=42},bad=>{bad.pages[0].cleanHistory[0].beforeColorSource=42}]) {
 const bad=structuredClone(p);mutate(bad);assert.equal(deserializeProject(JSON.stringify(bad)).ok,false);
}
console.log('PASS: text geometry/inverse, persistent color assets, bounded cleanup undo, reference/scan undo, save/load and validation');
