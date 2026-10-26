import test from 'node:test';
import assert from 'node:assert/strict';
import Sync from '../../sync-core.js';
import {newSecret} from '../codec.mjs';
import {ownerRelay} from '../relay.mjs';
import {snapshotParts,SnapshotInbox} from '../snapshot.mjs';
import {mergeWorkspaceOps} from '../merge.mjs';

// A fresh browser sees NO old operation events. Only the peer's new snapshot
// is routed to it; delivery intentionally omits and reorders one part.
class Bus{constructor(){this.pool=new Set();}}
class Pool{
  constructor(bus){this.bus=bus;this.listeners=[];bus.pool.add(this);}
  subscribeMany(_relays,_filters,handlers){
    this.listeners.push(handlers);
    return {close:()=>{this.listeners=this.listeners.filter(x=>x!==handlers);}};
  }
  publish(_relays,event){
    return [Promise.all([...this.bus.pool].flatMap(p=>p.listeners.map(h=>h.onevent(event)))).then(()=>event.id)];
  }
  close(){this.listeners=[];}
}
test('new device reconstructs old edits from encrypted multipart events with loss and reorder',async()=>{
  const secret=newSecret(),bus=new Bus();
  const doc={schema:1,pages:[{id:'restored',title:'古い端末',icon:'◈',parentId:'',taskId:'',deleted:false,_pos:1000,
    blocks:[{id:'body',text:'',type:'text',deleted:false,checked:false,_pos:1000}]}],tasks:[],dbColumns:[],databases:[]};
  const source=Sync.Engine.fromState(structuredClone(doc));
  const k=JSON.stringify(['B','restored','body','text']);
  for(let i=0;i<125;i++)source.change(k,'長期間のオフラインメモ '+i+'。'.repeat(300));
  const plan=await snapshotParts(source.export(),Sync);
  assert.ok(plan.count>2);
  const target=Sync.Engine.fromState({schema:1,pages:[],tasks:[]});
  const ownActor=target.actor;
  const inbox=new SnapshotInbox(Sync);
  let successful=0;
  const sender=await ownerRelay({secret,relays:['wss://fake.invalid'],pool:new Pool(bus)});
  const receiver=await ownerRelay({secret,relays:['wss://fake.invalid'],pool:new Pool(bus),
    onOperation:async p=>{
      if(p?.type!=='snapshot-part-v1')return;
      const result=await inbox.accept(p);
      if(result){
        const merge=mergeWorkspaceOps(target.export(),result.ops,Sync);
        assert.equal(merge.missing,0);
        target.merge(result.ops);
        successful++;
      }
    }});
  sender.start();
  receiver.start();
  const missing=plan.parts[2];
  for(const part of plan.parts.toReversed())if(part.index!==missing.index)await sender.publish(part);
  assert.equal(successful,0,'missing part must never modify a workspace');
  assert.equal(target.project().pages.some(p=>p.id==='restored'),false);
  await sender.publish(missing);
  assert.equal(successful,1);
  assert.equal(target.actor,ownActor);
  assert.deepEqual(target.project().pages.find(p=>p.id==='restored')?.blocks[0]?.text,
    source.project().pages.find(p=>p.id==='restored')?.blocks[0]?.text);
  assert.deepEqual(target.missingPredecessors(),[]);
  for(const part of plan.parts)await sender.publish(part);
  assert.equal(successful,1,'duplicates must be ignored');
  sender.stop();receiver.stop();
});
console.log('SNAPSHOT RELAY: fresh device repairs 125 offline edits over signed encrypted events PASS');
