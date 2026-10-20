'use strict';
const assert=require('node:assert/strict');
const {Engine,isValidOp,DEFAULT_DATABASE_ID}=require('../sync-core.js');
const legacy={schema:1,pages:[{id:'p',title:'レポート',icon:'◈',deleted:false,blocks:[]}],tasks:[{id:'t1',title:'旧タスク',status:'未着手',priority:'中',due:'',deleted:false}],dbColumns:[]};
const oldOps=Engine.fromState(legacy).export().ops.filter(op=>{
 const k=JSON.parse(op.key);return k[0]!=='D'&& !['dbId','targetDbId','viewMode','viewLimit'].includes(k.at(-1));
});
const alice=new Engine(oldOps,'alice07'),bob=new Engine(oldOps,'bob07');
assert.equal(alice.project().tasks[0].dbId,DEFAULT_DATABASE_ID);
let a=alice.project(),a0=structuredClone(a);
a.databases.push({id:'contacts',title:'取引先',icon:'▦',deleted:false});
a.tasks.push({id:'contact-a',dbId:'contacts',title:'Alpha',status:'未着手',priority:'中',due:'',deleted:false});
a.dbColumns.push({id:'related',dbId:DEFAULT_DATABASE_ID,name:'関連先',type:'relation',targetDbId:'contacts',deleted:false});
a.tasks.find(t=>t.id==='t1').properties.related='contact-a';
a.pages[0].blocks.push({id:'embed',type:'database',targetId:'contacts',viewMode:'board',viewLimit:5,text:'',checked:false});
alice.capture(a,a0);
let b=bob.project(),b0=structuredClone(b);b.tasks[0].status='完了';bob.capture(b,b0);
alice.merge(bob.export().ops);bob.merge(alice.export().ops);
for(const e of [alice,bob]){
 const state=e.project();
 const col=state.dbColumns.find(c=>c.id==='related');
 assert.equal(col.type,'relation');assert.equal(col.targetDbId,'contacts');
 assert.equal(state.tasks.find(t=>t.id==='t1').properties.related,'contact-a');
 assert.equal(state.tasks.find(t=>t.id==='t1').status,'完了');
 assert.equal(state.pages[0].blocks[0].viewMode,'board');
 assert.equal(state.pages[0].blocks[0].viewLimit,5);
 assert.equal(e.conflicts.length,0);
}
const op=(parts,value)=>isValidOp({id:'v7',key:JSON.stringify(parts),pred:[],value});
assert.equal(op(['C','related','type'],'relation'),true);
assert.equal(op(['C','related','targetDbId'],'contacts'),true);
assert.equal(op(['B','p','embed','viewMode'],'board'),true);
assert.equal(op(['B','p','embed','viewMode'],'unsafe'),false);
assert.equal(op(['B','p','embed','viewLimit'],5),true);
assert.equal(op(['B','p','embed','viewLimit'],8),false);
assert.equal(op(['B','p','embed','viewLimit'],'5'),false);
// A removed target should not erase the original relationship ID.
a=alice.project();a0=structuredClone(a);a.tasks.find(t=>t.id==='contact-a').deleted=true;alice.capture(a,a0);
assert.equal(alice.project().tasks.find(t=>t.id==='t1').properties.related,'contact-a');
console.log('vctrmemo v0.7: relation, embedded view persistence, old logs, distributed convergence, dangling references PASS');
