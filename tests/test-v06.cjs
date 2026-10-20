'use strict';
const assert=require('node:assert/strict');
const {Engine,isValidOp,DEFAULT_DATABASE_ID}=require('../sync-core.js');
const before={schema:1,pages:[{id:'p',title:'ノート',icon:'◈',deleted:false,blocks:[]}],tasks:[{id:'old',title:'従来のタスク',status:'未着手',priority:'中',due:'',deleted:false,properties:{legacy:'10'}}],dbColumns:[{id:'legacy',name:'旧列',type:'number',deleted:false}]};
// Simulate true historical v0.5 operations without the new D and dbId fields.
const ops=Engine.fromState(before).export().ops.filter(op=>{
  const p=JSON.parse(op.key);return p[0]!=='D' && p[p.length-1]!=='dbId';
});
const clientA=new Engine(ops,'v06clientA'),clientB=new Engine(ops,'v06clientB');
for(const e of [clientA,clientB]){
  const snapshot=e.project();
  assert.equal(snapshot.databases.filter(d=>!d.deleted).length,1);
  assert.equal(snapshot.tasks[0].dbId,DEFAULT_DATABASE_ID);
  assert.equal(snapshot.dbColumns[0].dbId,DEFAULT_DATABASE_ID);
  assert.equal(snapshot.tasks[0].properties.legacy,'10');
}
const stateA=clientA.project(),baseA=structuredClone(stateA);
stateA.databases.push({id:'research',title:'研究',icon:'▦',deleted:false});
stateA.tasks.push({id:'r1',dbId:'research',title:'調査',status:'進行中',priority:'高',due:'',deleted:false,properties:{cost:'42'}});
stateA.dbColumns.push({id:'cost',dbId:'research',name:'費用',type:'number',deleted:false});
stateA.pages[0].blocks.push({id:'embed',type:'database',targetId:'research',text:'',checked:false});
clientA.capture(stateA,baseA);
const stateB=clientB.project(),baseB=structuredClone(stateB);
stateB.tasks[0].due='2026-12-09';
clientB.capture(stateB,baseB);
clientA.merge(clientB.export().ops);clientB.merge(clientA.export().ops);
for(const engine of [clientA,clientB]){
  const x=engine.project();
  assert.equal(x.databases.find(d=>d.id==='research').title,'研究');
  assert.equal(x.pages[0].blocks[0].type,'database');
  assert.equal(x.pages[0].blocks[0].targetId,'research');
  assert.equal(x.tasks.find(t=>t.id==='old').dbId,DEFAULT_DATABASE_ID);
  assert.equal(x.tasks.find(t=>t.id==='old').due,'2026-12-09');
  assert.equal(x.tasks.find(t=>t.id==='r1').dbId,'research');
  assert.equal(x.dbColumns.find(c=>c.id==='legacy').dbId,DEFAULT_DATABASE_ID);
  assert.equal(x.dbColumns.find(c=>c.id==='cost').dbId,'research');
  assert.equal(engine.conflicts.length,0);
}
const check=(path,value)=>isValidOp({id:'a',key:JSON.stringify(path),pred:[],value});
assert.ok(check(['D','research','title'],'研究'));
assert.ok(check(['D','research','deleted'],false));
assert.ok(check(['T','r1','dbId'],'research'));
assert.ok(check(['C','cost','dbId'],'research'));
assert.ok(check(['B','p','embed','type'],'database'));
assert.equal(check(['T','r1','dbId'],'x'.repeat(129)),false);
assert.equal(check(['D','research','title'],123),false);
console.log('vctrmemo v0.6: legacy migration, separate databases, embedded database ID, cross-client convergence PASS');
