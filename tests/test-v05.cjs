'use strict';
const assert=require('node:assert/strict');
const {Engine,isValidOp}=require('../sync-core.js');
const original={schema:1,pages:[{id:'guide',title:'ガイド',icon:'◈',deleted:false,blocks:[{id:'old',type:'text',text:'過去版',checked:false}]}],tasks:[{id:'t1',title:'タスク',status:'未着手',priority:'中',due:'',deleted:false}]};
const legacy=Engine.fromState(original).export();
// Old logs without page.taskId or block.targetId remain valid; new fields normalize without data loss.
const client1=new Engine(legacy.ops,'alice'),client2=new Engine(legacy.ops,'bob');
let x=client1.project(), base=structuredClone(x);
assert.equal(x.pages[0].taskId,'');
assert.equal(x.pages[0].blocks[0].targetId,'');
x.pages.push({id:'reference',title:'参照先',icon:'◈',taskId:'',deleted:false,blocks:[]});
x.pages[0].blocks.push({id:'link-block',type:'link',text:'',targetId:'reference',checked:false});
x.pages.push({id:'taskdoc_t1',title:'タスク',icon:'▦',parentId:'',taskId:'t1',deleted:false,blocks:[{id:'memo-block',type:'text',text:'個別メモ',targetId:'',checked:false}]});
client1.capture(x,base);
let y=client2.project(), previous=structuredClone(y);
y.dbColumns.push({id:'cost',name:'費用',type:'text',deleted:false});
y.tasks[0].properties.cost='123.45';
client2.capture(y,previous);
client1.merge(client2.export().ops);client2.merge(client1.export().ops);
for(const client of [client1,client2]){
  const s=client.project();
  assert.equal(s.pages.find(p=>p.id==='guide').blocks.find(b=>b.id==='link-block').targetId,'reference');
  assert.equal(s.pages.find(p=>p.taskId==='t1').blocks[0].text,'個別メモ');
  assert.equal(s.tasks[0].properties.cost,'123.45');
  assert.equal(client.conflicts.length,0);
}
// Editing a column schema has a stable identity; cell values are not rewritten.
y=client2.project();previous=structuredClone(y);
y.dbColumns[0].name='見積額';y.dbColumns[0].type='number';
client2.capture(y,previous);client1.merge(client2.export().ops);
assert.equal(client1.project().dbColumns[0].type,'number');
assert.equal(client1.project().dbColumns[0].name,'見積額');
assert.equal(client1.project().tasks[0].properties.cost,'123.45');
for(const field of ['taskId','targetId']) {
  const key=field==='taskId'?['P','p',field]:['B','p','b',field];
  assert.equal(isValidOp({id:'a',key:JSON.stringify(key),pred:[],value:'reference'}),true);
  assert.equal(isValidOp({id:'a',key:JSON.stringify(key),pred:[],value:'x'.repeat(129)}),false);
}
assert.equal(isValidOp({id:'a',key:JSON.stringify(['B','p','b','type']),pred:[],value:'link'}),true);
assert.equal(isValidOp({id:'a',key:JSON.stringify(['B','p','b','type']),pred:[],value:'script'}),false);
console.log('vctrmemo v0.5: old history, task document, page links, rename/type and cross-client convergence PASS');
