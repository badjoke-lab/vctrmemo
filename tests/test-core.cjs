'use strict';
const assert = require('node:assert/strict');
const {Engine,flatten} = require('../sync-core.js');
const example = () => ({schema:1,pages:[{id:'p1',title:'Start',icon:'◈',deleted:false,blocks:[{id:'b1',type:'text',text:'hello',checked:false}]}],tasks:[{id:'t1',title:'task',status:'未着手',priority:'中',due:'',deleted:false}]});
function pair(){const one=example(),two=structuredClone(one);return {a:Engine.fromState(one),b:Engine.fromState(two)};}
function fork(engine){return new Engine(engine.export().ops);}
// Same baseline produces the same operations, to avoid seed-only conflicts.
{
 const {a,b}=pair();const aIDs=a.export().ops.map(op=>op.id).sort();const bIDs=b.export().ops.map(op=>op.id).sort();
 assert.deepEqual(aIDs,bIDs);assert.equal(a.conflicts.length,0);
}
// Concurrent modifications to different fields and independent blocks are both preserved.
{
 const {a,b}=pair();
 let sa=a.project(),sb=b.project();
 const beforeA=structuredClone(sa),beforeB=structuredClone(sb);
 sa.pages[0].title='Alpha';a.capture(sa,beforeA);
 sb.tasks[0].due='2026-12-01';b.capture(sb,beforeB);
 a.merge(b.export().ops);b.merge(a.export().ops);
 assert.equal(a.project().pages[0].title,'Alpha');
 assert.equal(b.project().tasks[0].due,'2026-12-01');
 assert.equal(a.conflicts.length,0);
}
// Conflict survives merge, can be explicitly resolved, and converges after re-sharing.
{
 const {a,b}=pair();
 let sa=a.project(),sb=b.project();
 const beforeA=structuredClone(sa),beforeB=structuredClone(sb);
 sa.pages[0].blocks[0].text='A version';a.capture(sa,beforeA);
 sb.pages[0].blocks[0].text='B version';b.capture(sb,beforeB);
 const opsA=a.export().ops,opsB=b.export().ops;
 a.merge(opsB);b.merge(opsA);
 assert.equal(a.conflicts.length,1);assert.equal(b.conflicts.length,1);
 assert.deepEqual(a.conflicts[0].versions.map(v=>v.value),b.conflicts[0].versions.map(v=>v.value));
 const selected=a.conflicts[0].versions.find(v=>v.value==='A version');
 assert(a.resolve(a.conflicts[0].key,selected.id));
 b.merge(a.export().ops);
 assert.equal(b.conflicts.length,0);
 assert.equal(b.project().pages[0].blocks[0].text,'A version');
}
// A block removal remains removed after late receipt of earlier operations.
{
 const {a,b}=pair();const sa=a.project(),before=structuredClone(sa);
 sa.pages[0].blocks.splice(0,1);a.capture(sa,before);
 b.merge(a.export().ops);
 assert.deepEqual(b.project().pages[0].blocks,[]);
}
// A new page doesn't lose its blocks, and duplicate messages are idempotent.
{
 const {a,b}=pair();const sa=a.project(),before=structuredClone(sa);
 sa.pages.push({id:'p2',title:'New',icon:'◈',blocks:[{id:'b2',text:'second',type:'text',checked:false}],deleted:false});
 a.capture(sa,before);const ops=a.export().ops;
 b.merge(ops);const opCount=b.export().ops.length;b.merge(ops);
 assert.equal(b.export().ops.length,opCount);
 assert.equal(b.project().pages.find(p=>p.id==='p2').blocks[0].text,'second');
}
console.log('vctrmemo sync engine: all 5 scenarios passed');
