'use strict';
const assert=require('node:assert/strict');
const {Engine}=require('../sync-core.js');
const {batches,trackedBatches,Tracker,bytes}=require('../transfer.js');
const base={schema:1,pages:[{id:'p1',title:'初期ページ',icon:'◈',deleted:false,blocks:[]}],tasks:[]};
const source=Engine.fromState(base);
for(let i=0;i<45;i++)source.change(JSON.stringify(['B','p1','b'+i,'text']),'🐾日本語'.repeat(65));
const limit=1800;
const parts=trackedBatches(source.export().ops,limit,'transfer_first','senderA');
assert(parts.length>3);
assert(parts.every(p=>bytes(p)<=limit));
for(let i=0;i<parts.length;i++){
 assert.equal(parts[i].payload.transfer.index,i);
 assert.equal(parts[i].payload.transfer.total,parts.length);
 assert.equal(parts[i].payload.transfer.actor,'senderA');
}
const tracker=new Tracker();
const destination=new Engine([],'recipient');
const omitted=2;
for(const [index,part] of [...parts].reverse().entries()){
 if(part.payload.transfer.index===omitted)continue;
 const status=tracker.accept(part.payload);
 assert(!status.invalid);
 destination.merge(part.payload.ops);
}
assert.equal(tracker.pending().length,1);
assert.equal(tracker.pending()[0].missing,1);
const dup=tracker.accept(parts[0].payload);
assert.equal(dup.duplicate,true);
assert.equal(tracker.pending()[0].missing,1);
const corrupt=structuredClone(parts[0].payload);
corrupt.transfer.total=3;
assert.equal(tracker.accept(corrupt).invalid,true);
const corruptIndex=structuredClone(parts[0].payload);
corruptIndex.transfer.index=99999;
assert.equal(tracker.accept(corruptIndex).invalid,true);
const oldMessage=batches(source.export().ops,limit)[0].payload;
assert.equal(tracker.accept(oldMessage).legacy,true);
// Full re-share uses a new ID, carries all prior operations, and clears the
// obsolete incomplete message group from the same actor.
const second=trackedBatches(source.export().ops,limit,'transfer_repair','senderA');
for(const part of second.slice().reverse()){
 tracker.accept(part.payload);
 destination.merge(part.payload.ops);
}
assert.equal(tracker.pending().length,0);
assert.equal(tracker.latest().complete,true);
assert.deepEqual(destination.project(),source.project());
assert.equal(destination.missingPredecessors().length,0);
// Missing predecessor IDs must be detected even without chunk metadata.
const first=source.export().ops.find(op=>op.key===JSON.stringify(['B','p1','b1','text']));
const changed=new Engine(source.export().ops,'author2');
changed.change(JSON.stringify(['B','p1','b1','text']),'書き換え');
const latest=changed.export().ops.at(-1);
assert(latest.pred.includes(first.id));
const partial=new Engine(changed.export().ops.filter(op=>op.id!==first.id),'partial');
assert(partial.missingPredecessors().includes(first.id));
partial.merge([first]);
assert.equal(partial.missingPredecessors().length,0);
assert.throws(()=>trackedBatches(source.export().ops,300,'x','a'),/上限/);
assert.throws(()=>trackedBatches(source.export().ops,limit,'bad id','a'),/転送ID/);
console.log('vctrmemo v0.9 transfer: tracked parts, gap detection, duplicate handling, causality gaps, whole-history repair PASS');
