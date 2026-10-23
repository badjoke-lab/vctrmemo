import assert from 'node:assert/strict';
import {newSecret} from '../codec.mjs';
import {ownerRelay} from '../relay.mjs';
import {mergeWorkspaceOps} from '../merge.mjs';
import Sync from '../../sync-core.js';
const secret=newSecret(),badSecret=newSecret();
class FakePool {
  constructor(bus){this.bus=bus;this.listeners=[];this.bus.add(this);}
  subscribeMany(_relays,_filters,cb){this.listeners.push(cb);return {close:()=>this.listeners.splice(this.listeners.indexOf(cb),1)};}
  publish(_relays,event){for(const pool of this.bus)for(const listener of pool.listeners)listener.onevent(event);return [Promise.resolve(event.id)];}
  close(){this.listeners=[];}
}
const bus=new Set(),pA=new FakePool(bus),pB=new FakePool(bus),pBad=new FakePool(bus);
const local={schema:1,pages:[],tasks:[]};
const a=Sync.Engine.fromState(local),b=Sync.Engine.fromState(local);
let receivedA=0,receivedB=0,receivedBad=0;
const receiverA=await ownerRelay({secret,pool:pA,relays:['wss://local.invalid'],onOperation:async op=>{
  const ops=Array.isArray(op.batch)?op.batch:[op];
  const merged=mergeWorkspaceOps(a.export(),ops,Sync);
  if(merged.changed){a.merge(ops);receivedA+=ops.length;}
}});
const receiverB=await ownerRelay({secret,pool:pB,relays:['wss://local.invalid'],onOperation:async op=>{
  const ops=Array.isArray(op.batch)?op.batch:[op];
  const merged=mergeWorkspaceOps(b.export(),ops,Sync);
  if(merged.changed){b.merge(ops);receivedB+=ops.length;}
}});
const other=await ownerRelay({secret:badSecret,pool:pBad,relays:['wss://local.invalid'],onOperation:()=>receivedBad++});
receiverA.start();receiverB.start();other.start();
const op1=a.change(JSON.stringify(['P','page-A','title']),'スマホで追加したページ');
await receiverA.publish(op1);
await new Promise(r=>setTimeout(r,20));
assert.equal(b.project().pages.find(p=>p.id==='page-A').title,'スマホで追加したページ');
const op2=b.change(JSON.stringify(['P','page-A','icon']),'◈');
await receiverB.publish(op2);
await new Promise(r=>setTimeout(r,20));
assert.equal(a.project().pages.find(p=>p.id==='page-A').icon,'◈');
assert.equal(receivedBad,0);
const first=mergeWorkspaceOps(a.export(),[op1],Sync);
assert.equal(first.changed,false,'duplicate must not change history');
assert.throws(()=>mergeWorkspaceOps(a.export(),[{...op1,value:'tampered'}],Sync),/Conflicting/);
assert.ok(receivedA>=1 && receivedB>=1,'bidirectional delivery');
const batch=[];
for(let i=0;i<20;i++)batch.push(a.change(JSON.stringify(['P','page-A','title']),'一括変更 '+i));
await receiverA.publishBatch(batch);
await new Promise(r=>setTimeout(r,40));
assert.equal(b.project().pages.find(p=>p.id==='page-A').title,'一括変更 19','20 encrypted ops must merge atomically');
await assert.rejects(receiverA.publishBatch([]),/Invalid batch size/);
await assert.rejects(receiverA.publishBatch(Array(21).fill(batch[0])),/Invalid batch size/);
receiverA.stop();receiverB.stop();other.stop();
console.log('owner sync: two-client signed encrypted relay, bidirectional merge, third-key isolation, duplicate rejection PASS');
