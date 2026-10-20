'use strict';
const assert=require('node:assert/strict');
const {Engine}=require('../sync-core.js');
const {batches,Sender,bytes}=require('../transfer.js');
const source={schema:1,pages:[{id:'p1',title:'テスト',icon:'◈',deleted:false,blocks:[]}],tasks:[]};
const a=Engine.fromState(source), b=Engine.fromState(source);
for(let i=0;i<250;i++){
  a.change(JSON.stringify(['B','p1','block'+i,'text']),('日本語🌸abcdefghi').repeat(30));
}
const parts=batches(a.export().ops,2000);
assert(parts.length>1,'must be split');
assert(parts.every(p=>bytes(p)<=2000),'bytes must not exceed limit');
assert(parts.every(p=>p.payload.kind==='vctrmemo-ops-v2'));
const ids=parts.flatMap(p=>p.payload.ops.map(o=>o.id));
assert.equal(ids.length,a.export().ops.length);
assert.equal(new Set(ids).size,ids.length);
for(const p of parts.reverse())b.merge(p.payload.ops);
for(const p of parts)b.merge(p.payload.ops);
assert.deepEqual(b.project(),a.project());
assert.equal(b.conflicts.length,0);
assert.throws(()=>batches([{id:'huge',value:'🌸'.repeat(150000)}],2000),/単独の変更/);
assert.deepEqual(batches([],500),[]);
// Pacing and partial failure can be recovered by idempotent replay.
{
  const wire=[],scheduled=[];
  const host={sendUpdateInterval:40,sendUpdate(m){wire.push(m);}};
  const statuses=[];
  const s=new Sender(host,{schedule:(fn,ms)=>{scheduled.push({fn,ms});return scheduled.length;},cancel:()=>{},onStatus:x=>statuses.push(x)});
  const batch=[{payload:{ops:[1]}},{payload:{ops:[2]}},{payload:{ops:[3]}}];
  s.start(batch);assert.equal(wire.length,1);assert(s.active);assert.equal(scheduled[0].ms,40);
  scheduled.shift().fn();assert.equal(wire.length,2);
  scheduled.shift().fn();assert.equal(wire.length,3);
  assert.equal(s.active,false);assert.equal(statuses.at(-1).kind,'finished');
}
{
  let calls=0;const statuses=[];
  const host={sendUpdateInterval:0,sendUpdate(){if(++calls===2)throw Error('simulated');}};
  const jobs=[];
  const s=new Sender(host,{schedule:fn=>{jobs.push(fn);return 1;},cancel:()=>{},onStatus:x=>statuses.push(x)});
  s.start([{},{}]);jobs.shift()();
  assert.equal(s.active,false);assert.equal(statuses.at(-1).kind,'failed');assert.equal(statuses.at(-1).done,1);
  s.start([{},{}]);while(jobs.length)jobs.shift()();
  assert.equal(statuses.at(-1).kind,'finished');
}
console.log('vctrmemo transfer: batching, UTF-8 sizes, reordering, pacing, failure/retry passed');
