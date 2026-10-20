'use strict';
const assert=require('node:assert/strict');
const {Engine,isValidOp}=require('../sync-core.js');
const previous=()=>({schema:1,pages:[{id:'p',title:'親',icon:'◈',deleted:false,blocks:[]}],tasks:[{id:'t',title:'作業',status:'未着手',priority:'中',due:'',deleted:false}]});
const original=Engine.fromState(previous());
const oldData=original.export().ops;
// Existing v0.3 operation logs and task records remain loadable.
const a=new Engine(oldData,'actorA');const b=new Engine(oldData,'actorB');
assert.equal(a.project().pages[0].parentId,'');
assert.deepEqual(a.project().dbColumns,[]);
const aa=a.project(),bb=b.project(),a0=structuredClone(aa),b0=structuredClone(bb);
aa.pages.push({id:'child',title:'子',icon:'◈',parentId:'p',deleted:false,blocks:[]});
aa.dbColumns.push({id:'col',name:'費用',type:'number',deleted:false});
a.capture(aa,a0);
bb.tasks[0].properties={col:'123.50'};
b.capture(bb,b0);
a.merge(b.export().ops);b.merge(a.export().ops);
for(const engine of [a,b]){
  const s=engine.project();
  assert.equal(s.pages.find(p=>p.id==='child').parentId,'p');
  assert.equal(s.dbColumns.find(c=>c.id==='col').name,'費用');
  assert.equal(s.tasks[0].properties.col,'123.50');
  assert.equal(engine.conflicts.length,0);
}
// Deleting a custom column retains its historical cell values, but hides the definition.
const before=structuredClone(a.project()),changed=a.project();
changed.dbColumns[0].deleted=true;a.capture(changed,before);b.merge(a.export().ops);
assert.equal(b.project().dbColumns[0].deleted,true);
assert.equal(b.project().tasks[0].properties.col,'123.50');
assert.equal(isValidOp({id:'test',key:JSON.stringify(['P','p','parentId']),pred:[],value:'child'}),true);
assert.equal(isValidOp({id:'test',key:JSON.stringify(['C','col','type']),pred:[],value:'checkbox'}),true);
assert.equal(isValidOp({id:'test',key:JSON.stringify(['C','col','type']),pred:[],value:'evil-type'}),false);
assert.equal(isValidOp({id:'test',key:JSON.stringify(['V','t','col','value']),pred:[],value: 'x'.repeat(501)}),false);
console.log('vctrmemo v0.4: v0.3 compatibility, hierarchy, custom columns, cross-client merge, soft delete, op validation PASS');
