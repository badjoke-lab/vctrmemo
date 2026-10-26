// Deterministic convergence exercise: >100 edits, offline queues, duplicates,
 // out-of-order Nostr delivery, conflict resolution and tombstone preservation.
import assert from 'node:assert/strict';
import Sync from '../../sync-core.js';
import {mergeWorkspaceOps} from '../merge.mjs';

const P=(id,field)=>JSON.stringify(['P',id,field]);
const B=(id,field)=>JSON.stringify(['B','stress-page',id,field]);
const base={
  schema:1,
  pages:[{
    id:'stress-page',title:'Starting title',icon:'◈',parentId:'',
    taskId:'',deleted:false,_pos:1000,
    blocks:[
      {id:'main',type:'text',text:'',checked:false,deleted:false,_pos:1000},
      {id:'other',type:'text',text:'',checked:false,deleted:false,_pos:2000},
      {id:'removed',type:'text',text:'remove me',checked:false,deleted:false,_pos:3000}
    ]
  }],
  tasks:[],dbColumns:[],databases:[]
};
const seed=Sync.Engine.fromState(structuredClone(base));
const alice=new Sync.Engine(seed.export().ops,'alice',0);
const bob=new Sync.Engine(seed.export().ops,'bob',0);

// Neither device sees the other's 120 edits until the offline phase ends.
for(let i=0;i<120;i++){
  alice.change(B('main','text'),'Alice '+i);
  bob.change(B('other','text'),'Bob '+i);
}
alice.change(P('stress-page','title'),'Title by Alice');
bob.change(P('stress-page','title'),'Title by Bob');
alice.change(B('removed','deleted'),true);
bob.change(B('new','type'),'text');
bob.change(B('new','text'),'New content from Bob');
bob.change(B('new','_pos'),4000);

const fromAlice=alice.export().ops.filter(op=>op.id.startsWith('a_alice_'));
const fromBob=bob.export().ops.filter(op=>op.id.startsWith('a_bob_'));
assert.ok(fromAlice.length>=120 && fromBob.length>=120);

// The last text edit arrives before its predecessor, so receiving just one
// payload is NOT evidence that the workspace has fully synchronized.
let recvBob=new Sync.Engine(bob.export().ops,bob.actor,bob.counter);
const future=fromAlice.find(op=>op.value==='Alice 119');
assert.ok(future);
const gap=mergeWorkspaceOps(recvBob.export(),[future],Sync);
assert.ok(gap.missing>0,'missing predecessor must be detected');
recvBob=new Sync.Engine(gap.sync.ops,gap.sync.actor,gap.sync.counter);
assert.ok(recvBob.missingPredecessors().length>0);

// Resume after disconnect: deliver the remaining operations in reverse batch
// order, with repeated deliveries. Neither missing edits nor duplicates may
// silently change the result.
const scrambled=fromAlice.filter(op=>op.id!==future.id).reverse();
for(let offset=0;offset<scrambled.length;offset+=20){
  const batch=scrambled.slice(offset,offset+20);
  const result=mergeWorkspaceOps(recvBob.export(),batch,Sync);
  recvBob=new Sync.Engine(result.sync.ops,result.sync.actor,result.sync.counter);
  const repeat=mergeWorkspaceOps(recvBob.export(),batch,Sync);
  assert.equal(repeat.changed,false,'duplicate relay replay is idempotent');
}
assert.deepEqual(recvBob.missingPredecessors(),[],'recovered offline history');

let recvAlice=new Sync.Engine(alice.export().ops,alice.actor,alice.counter);
for(let i=0;i<fromBob.length;i+=20){
  const result=mergeWorkspaceOps(recvAlice.export(),fromBob.slice(i,i+20),Sync);
  recvAlice=new Sync.Engine(result.sync.ops,result.sync.actor,result.sync.counter);
}
assert.deepEqual(recvAlice.missingPredecessors(),[]);
assert.deepEqual(recvAlice.project(),recvBob.project(),'all data converges across peers');
const page=recvAlice.project().pages.find(p=>p.id==='stress-page');
assert.equal(page.blocks.find(b=>b.id==='main')?.text,'Alice 119');
assert.equal(page.blocks.find(b=>b.id==='other')?.text,'Bob 119');
assert.equal(page.blocks.some(b=>b.id==='removed'),false,'deletion preserved');
assert.equal(page.blocks.find(b=>b.id==='new')?.text,'New content from Bob');

const conflictA=recvAlice.conflicts.find(c=>c.key===P('stress-page','title'));
const conflictB=recvBob.conflicts.find(c=>c.key===P('stress-page','title'));
assert.ok(conflictA && conflictB,'concurrent title edits must be exposed');
assert.deepEqual(new Set(conflictA.versions.map(v=>v.value)),new Set(['Title by Alice','Title by Bob']));
assert.equal(recvAlice.resolve(conflictA.key,conflictA.versions.find(v=>v.value==='Title by Bob').id),true);
const resolution=recvAlice.export().ops.filter(op=>!recvBob.ops.has(op.id));
assert.equal(resolution.length,1);
const post=mergeWorkspaceOps(recvBob.export(),resolution,Sync);
recvBob=new Sync.Engine(post.sync.ops,post.sync.actor,post.sync.counter);
assert.deepEqual(recvAlice.project(),recvBob.project());
assert.equal(recvBob.project().pages.find(p=>p.id==='stress-page').title,'Title by Bob');
assert.equal(recvBob.conflicts.filter(c=>c.key===P('stress-page','title')).length,0);

// An incoming operation ID that changes meaning is a hard error.
assert.throws(()=>mergeWorkspaceOps(recvBob.export(),[{...future,value:'MUTATED'}],Sync),/Conflicting operation ID/);
assert.equal(new Set(recvBob.export().ops.map(op=>op.id)).size,recvBob.export().ops.length);
console.log('stress: 240+ offline edits, out-of-order + duplicate relay batches, deletion, concurrency, resolution and convergence PASS');
