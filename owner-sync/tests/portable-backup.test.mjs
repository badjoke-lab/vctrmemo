import test from 'node:test';
import assert from 'node:assert/strict';
import Sync from '../../sync-core.js';
import {newSecret} from '../codec.mjs';
import {sealPortableBackup,openPortableBackup,preparePortableRestore,validateCompleteHistory} from '../portable-backup.mjs';

function fixture(){
 const data={schema:1,pages:[{id:'page',title:'機密メモ 日本語',parentId:'',icon:'◈',taskId:'',
     deleted:false,_pos:1000,blocks:[{id:'b1',text:'秘密情報',type:'text',checked:false,deleted:false,_pos:1000}]}],
     tasks:[],databases:[],dbColumns:[]};
 const e=Sync.Engine.fromState(structuredClone(data));
 for(let i=0;i<100;i++)e.change(JSON.stringify(['B','page','b1','text']),'本文 '+i+'。 長い日本語テスト\n'.repeat(8));
 return e;
}
test('private key-bound file: entire history decrypts offline and preserves conflicts',async()=>{
 const original=fixture(),secret=newSecret();
 const file=await sealPortableBackup(original.export(),secret,Sync);
 assert.doesNotMatch(file,/機密メモ|秘密情報|長い日本語テスト/);
 const meta=JSON.parse(file);
 assert.equal(meta.version,1);
 assert.equal(meta.operations,original.ops.size);
 const fresh=Sync.Engine.fromState({schema:1,pages:[],tasks:[],databases:[],dbColumns:[]});
 const ownActor=fresh.actor;
 const imported=await openPortableBackup(file,secret,Sync);
 const plan=preparePortableRestore(fresh.export(),imported.ops,Sync);
 assert.ok(plan.changes.length>100);
 assert.ok(plan.total<=12000);
 fresh.merge(plan.changes);
 assert.equal(fresh.actor,ownActor,'do not import the original device identity');
 assert.deepEqual(fresh.project().pages.find(p=>p.id==='page')?.blocks[0]?.text,
                  original.project().pages.find(p=>p.id==='page')?.blocks[0]?.text);
 assert.deepEqual(fresh.missingPredecessors(),[]);
 assert.equal(preparePortableRestore(fresh.export(),imported.ops,Sync).changes.length,0);
 // Concurrent writes from two offline devices survive as separate versions.
 original.change(JSON.stringify(['P','page','title']),'PCの別編集');
 const alternate=fixture();
 alternate.change(JSON.stringify(['P','page','title']),'スマホの別編集');
 const conflict=Sync.Engine.fromState({schema:1,pages:[],tasks:[],databases:[],dbColumns:[]});
 conflict.merge([...original.export().ops,...alternate.export().ops.filter(o=>!o.id.startsWith('i_'))]);
 assert.ok(conflict.conflicts.length>0);
 const conflictFile=await sealPortableBackup(conflict.export(),secret,Sync);
 const recovered=await openPortableBackup(conflictFile,secret,Sync);
 const rebuilt=new Sync.Engine(recovered.ops);
 assert.deepEqual(rebuilt.conflicts,conflict.conflicts);
});
test('wrong secret and tampering reject before any state mutation',async()=>{
 const source=fixture(),secret=newSecret(),wrong=newSecret();
 const backup=await sealPortableBackup(source.export(),secret,Sync);
 await assert.rejects(()=>openPortableBackup(backup,wrong,Sync),/復号できません/);
 const object=JSON.parse(backup);
 object.ciphertext=object.ciphertext.slice(0,100)+(object.ciphertext[100]==='A'?'B':'A')+object.ciphertext.slice(101);
 await assert.rejects(()=>openPortableBackup(JSON.stringify(object),secret,Sync));
 object.ciphertext=JSON.parse(backup).ciphertext;
 object.sha256='0'.repeat(64);
 await assert.rejects(()=>openPortableBackup(JSON.stringify(object),secret,Sync),/integrity/);
 await assert.rejects(()=>openPortableBackup('{',secret,Sync),/valid JSON/);
});
test('malformed history, partial causal chain, cross-record ID collision and limit reject atomically',async()=>{
 const original=fixture().export(),secret=newSecret();
 const missing=structuredClone(original);
 const target=missing.ops.find(op=>op.pred.length);
 missing.ops=missing.ops.filter(op=>op.id!==target.pred[0]);
 await assert.rejects(()=>sealPortableBackup(missing,secret,Sync),/missing predecessor/);
 const clone=structuredClone(original);
 clone.ops.push(structuredClone(clone.ops[0]));
 await assert.rejects(()=>sealPortableBackup(clone,secret,Sync),/duplicate/);
 const current=structuredClone(original); // force an actual same-ID collision
 const altered=structuredClone(original);
 altered.ops.at(-1).value='different value';
 assert.throws(()=>preparePortableRestore(current,altered.ops,Sync),/Conflicting operation ID/);
 const one=original.ops.at(-1);
 assert.throws(()=>validateCompleteHistory(Array.from({length:12001},(_,i)=>({...one,id:'a_overflow_'+i,pred:[]})),Sync),/length/);
 const incomplete=structuredClone(current);
 const missingCurrentId=incomplete.ops.find(op=>op.pred.length).pred[0];
 incomplete.ops=incomplete.ops.filter(op=>op.id!==missingCurrentId);
 assert.throws(()=>preparePortableRestore(incomplete,original.ops.slice(0,1),Sync),/Unresolved local predecessor|missing predecessor/);
});
