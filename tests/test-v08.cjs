'use strict';
const assert=require('node:assert/strict');
const {Engine,isValidOp,backlinksFor,rollupFor,DEFAULT_DATABASE_ID}=require('../sync-core.js');
const original={
 schema:1,
 pages:[{id:'p',title:'ページ',icon:'◈',deleted:false,blocks:[]}],
 databases:[{id:DEFAULT_DATABASE_ID,title:'タスク',deleted:false},{id:'clients',title:'取引先',deleted:false}],
 dbColumns:[
  {id:'client',dbId:DEFAULT_DATABASE_ID,name:'取引先',type:'relation',targetDbId:'clients',deleted:false},
  {id:'price',dbId:DEFAULT_DATABASE_ID,name:'金額',type:'number',deleted:false}
 ],
 tasks:[
  {id:'a',dbId:DEFAULT_DATABASE_ID,title:'A',status:'未着手',priority:'中',due:'',properties:{client:'buyer',price:'12.5'},deleted:false},
  {id:'b',dbId:DEFAULT_DATABASE_ID,title:'B',status:'未着手',priority:'中',due:'',properties:{client:'buyer',price:'19.5'},deleted:false},
  {id:'buyer',dbId:'clients',title:'取引先1',status:'未着手',priority:'中',due:'',properties:{},deleted:false}
 ]
};
const old=Engine.fromState(structuredClone(original)).export();
// Simulate a v0.7 log: no computed metadata keys.
const oldOps=old.ops.filter(o=>!['sourceColumnId','sourceDbId','rollupOp','rollupFieldId'].includes(JSON.parse(o.key).at(-1)));
const alice=new Engine(oldOps,'alice08'),bob=new Engine(oldOps,'bob08');
assert.deepEqual(backlinksFor(alice.project(),'buyer').map(e=>e.task.id).sort(),['a','b']);
let state=alice.project(),before=structuredClone(state);
state.dbColumns.push({id:'reverse',dbId:'clients',name:'逆参照',type:'backlink',sourceColumnId:'client',sourceDbId:DEFAULT_DATABASE_ID,deleted:false});
state.dbColumns.push({id:'count',dbId:'clients',name:'件数',type:'rollup',sourceColumnId:'client',sourceDbId:DEFAULT_DATABASE_ID,rollupOp:'count',deleted:false});
state.dbColumns.push({id:'amount',dbId:'clients',name:'合計',type:'rollup',sourceColumnId:'client',sourceDbId:DEFAULT_DATABASE_ID,rollupOp:'sum',rollupFieldId:'price',deleted:false});
alice.capture(state,before);
let remote=bob.project(),remoteBefore=structuredClone(remote);
remote.tasks.push({id:'c',dbId:DEFAULT_DATABASE_ID,title:'C',status:'未着手',priority:'中',due:'',properties:{client:'buyer',price:'8'},deleted:false});
bob.capture(remote,remoteBefore);
alice.merge(bob.export().ops);bob.merge(alice.export().ops);
for(const engine of [alice,bob]){
 const x=engine.project();
 assert.equal(backlinksFor(x,'buyer','client').length,3);
 assert.equal(rollupFor(x,'buyer',x.dbColumns.find(c=>c.id==='count')),3);
 assert.equal(rollupFor(x,'buyer',x.dbColumns.find(c=>c.id==='amount')),40);
 assert.equal(engine.conflicts.length,0);
}
state=alice.project();before=structuredClone(state);state.tasks.find(t=>t.id==='c').deleted=true;
alice.capture(state,before);
assert.equal(rollupFor(alice.project(),'buyer',alice.project().dbColumns.find(c=>c.id==='count')),2);
assert.equal(rollupFor(alice.project(),'buyer',alice.project().dbColumns.find(c=>c.id==='amount')),32);
state=alice.project();before=structuredClone(state);state.databases.find(d=>d.id==='clients').deleted=true;alice.capture(state,before);
bob.merge(alice.export().ops);
assert.equal(bob.project().databases.find(d=>d.id==='clients').deleted,true);
assert.equal(bob.project().tasks.find(t=>t.id==='buyer').title,'取引先1');
state=bob.project();before=structuredClone(state);state.databases.find(d=>d.id==='clients').deleted=false;bob.capture(state,before);alice.merge(bob.export().ops);
assert.equal(alice.project().databases.find(d=>d.id==='clients').deleted,false);
assert.equal(alice.project().tasks.find(t=>t.id==='buyer').deleted,false);
const valid=(p,v)=>isValidOp({id:'probe',key:JSON.stringify(p),pred:[],value:v});
for(const f of ['sourceColumnId','sourceDbId','rollupFieldId'])assert.equal(valid(['C','x',f],'identifier'),true);
assert.equal(valid(['C','x','rollupOp'],'count'),true);
assert.equal(valid(['C','x','rollupOp'],'sum'),true);
assert.equal(valid(['C','x','rollupOp'],'eval'),false);
assert.equal(valid(['C','x','type'],'backlink'),true);
assert.equal(valid(['C','x','type'],'rollup'),true);
console.log('vctrmemo v0.8: derived reverse links, count/sum, deleted record exclusion, archive/restore convergence PASS');
