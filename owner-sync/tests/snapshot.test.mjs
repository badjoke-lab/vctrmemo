import test from 'node:test';
import assert from 'node:assert/strict';
import Sync from '../../sync-core.js';
import {openWorkspace,newSecret} from '../codec.mjs';
import {snapshotParts,SnapshotInbox,PART_BYTES} from '../snapshot.mjs';

const base={
  schema:1,pages:[{id:'p',title:'日本語スナップショット検査',icon:'◈',
    parentId:'',taskId:'',deleted:false,_pos:1000,
    blocks:[{id:'b',type:'text',text:'出発',checked:false,deleted:false,_pos:1000}]}],
  tasks:[],databases:[],dbColumns:[]
};
const key=JSON.stringify(['B','p','b','text']);
function build(){
  const engine=Sync.Engine.fromState(structuredClone(base));
  for(let i=0;i<110;i++)engine.change(key,'一行目\n'+('日本語の本文 '+i+'。').repeat(28));
  return engine;
}
test('snapshot: full encrypted multipart history is verified, reversible and merges without replacing actors',async()=>{
  const source=build();
  const plan=await snapshotParts(source.export(),Sync);
  assert.ok(plan.count>1);
  assert.ok(plan.bytes>PART_BYTES);
  assert.ok(plan.parts.every((part,i)=>part.index===i&&part.id===plan.id&&part.count===plan.count));
  const secret=newSecret(),sender=await openWorkspace(secret),receiver=await openWorkspace(secret);
  const incoming=new SnapshotInbox(Sync);
  const encrypted=await Promise.all(plan.parts.map(part=>sender.seal(part)));
  assert.ok(encrypted.every(text=>!text.includes('日本語')));
  let restored=null;
  for(const item of [...encrypted].reverse()){
    const decoded=await receiver.unseal(item);
    const result=await incoming.accept(decoded);
    if(result)restored=result;
  }
  assert.ok(restored);
  assert.equal(restored.id,plan.id);
  assert.deepEqual(restored.ops,source.export().ops);
  const target=Sync.Engine.fromState(structuredClone(base));
  const actor=target.actor;
  target.merge(restored.ops);
  assert.equal(target.actor,actor,'incoming snapshot cannot replace the current device actor');
  assert.deepEqual(target.project(),source.project());
  assert.deepEqual(target.missingPredecessors(),[]);
  assert.equal(await incoming.accept(plan.parts[0]),null,'completed snapshot may not be applied twice');
});
test('snapshot: missing, duplicate, mismatched and tampered parts never apply',async()=>{
  const plan=await snapshotParts(build().export(),Sync);
  const inbox=new SnapshotInbox(Sync);
  for(const part of plan.parts.slice(0,-1))assert.equal(await inbox.accept(part),null);
  assert.equal(await inbox.accept(plan.parts[0]),null,'duplicate part pending must not complete');
  // The complete final part has to match the complete digest.
  const tampered={...plan.parts.at(-1),data:'QUJD'+plan.parts.at(-1).data.slice(4)};
  assert.equal(await inbox.accept(tampered),null);
  assert.equal(await inbox.accept(plan.parts.at(-1)),null,'snapshot with mismatched previous part is reset');
  const fresh=new SnapshotInbox(Sync);
  assert.equal(await fresh.accept({...plan.parts[0],count:plan.count+1}),null);
  assert.equal(await fresh.accept({...plan.parts[0],index:-1}),null);
  assert.equal(await fresh.accept({...plan.parts[0],data:'!!!!'}),null);
  let restored=null;
  for(const part of plan.parts){
    const value=await fresh.accept(part);if(value)restored=value;
  }
  assert.ok(restored);
});
test('snapshot: incomplete causal history and duplicate operation IDs are rejected before publication',async()=>{
  const state=build().export();
  assert.ok(state.ops.length>100);
  const missing=structuredClone(state);
  const target=missing.ops.find(op=>op.pred?.length);
  missing.ops=missing.ops.filter(op=>op.id!==target.pred[0]);
  await assert.rejects(()=>snapshotParts(missing,Sync),/Incomplete snapshot history/);
  const duplicate=structuredClone(state);
  duplicate.ops.push(structuredClone(duplicate.ops.at(-1)));
  await assert.rejects(()=>snapshotParts(duplicate,Sync),/duplicated snapshot operation/);
  const oversized=structuredClone(state);
  oversized.ops=[...oversized.ops,...Array.from({length:12001},(_,i)=>({...target,id:'a_overflow_'+i,pred:[]}))];
  await assert.rejects(()=>snapshotParts(oversized,Sync),/Invalid snapshot operation count/);
  const normal=await snapshotParts(state,Sync);
  assert.ok(normal.parts.every(p=>p.data.length<=9000));
});
console.log('SNAPSHOT: encrypted multipart, SHA-256 integrity, shuffled & incomplete parts, causal validation PASS');
