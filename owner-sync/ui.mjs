// Opt-in browser-only E2EE synchronization for a new, isolated workspace.
// Opening one private URL on both devices uses the same 256-bit secret from
// the URL fragment. The secret never reaches the HTTP server or Nostr relay.
import {ownerRelay} from './relay.mjs';
import {readStorage} from './merge.mjs';
const STORAGE=window.__vctrmemo_owner_storage_key;
const SECRET=window.__vctrmemo_owner_secret;
const Sync=window.VctrSync;
if(!STORAGE||!/^[a-f0-9]{64}$/.test(SECRET||'')||!Sync||!isSecureContext)throw Error('Open this synced workspace from the secure private link');
const panel=document.createElement('section');
panel.id='owner-sync-panel';
panel.innerHTML=`<details open><summary>本人の端末間同期（ブラウザ実験版）</summary>
<p>この端末とスマホで<strong>同じ専用URL</strong>を開くと自動同期します。別アカウントや手動の鍵入力は不要です。</p>
<button id="owner-copy-link" type="button">自分専用URLをコピー</button>
<button id="owner-disconnect" type="button">同期を停止</button>
<p id="owner-sync-state" role="status" aria-live="polite">暗号化同期へ接続しています…</p>
<p class="owner-warning"><strong>専用URLには復号鍵が含まれます。</strong> URLを知った人は閲覧・変更できます。Vectorの<strong>自分宛てNotesだけ</strong>に貼り、他人へ転送しないでください。この実験版はVector内のMini Appではなく、ブラウザで動作します。外部Nostrリレーへ暗号文を保存します。既存の端末内メモは同期・転送されません。</p>
</details>`;
Object.assign(panel.style,{position:'fixed',right:'12px',bottom:'12px',zIndex:9000,maxWidth:'min(380px,calc(100vw - 24px))',background:'#15241f',color:'#f2f6f2',border:'1px solid #5c8274',padding:'12px',borderRadius:'12px',font:'13px system-ui',boxShadow:'0 8px 22px #0007'});
const style=document.createElement('style');
style.textContent=`#owner-sync-panel summary{cursor:pointer;font-weight:600}#owner-sync-panel p{line-height:1.45;margin:10px 0}#owner-sync-panel button{font:inherit;padding:7px;margin:4px 5px 4px 0;background:#244339;border:1px solid #60806e;color:white;border-radius:5px;cursor:pointer}#owner-sync-panel .owner-warning{font-size:11px;color:#cabb9d}`;
document.head.append(style);document.body.append(panel);
const $=id=>document.getElementById(id),status=t=>{$('owner-sync-state').textContent=t};
let client=null,period=null,flushing=false,publishing=false,pending=[],published=new Set(),room='',stopped=false,connecting=false;
let deviceId='',receiptsQueued=new Set(),receiptsSent=new Set(),receiptsByPeer=new Map(),receipting=false;
let resendCursor=0,lastResendAt=0,lastNeedAt=0,repairing=false,asking=false;
const lastReceiptAt=new Map();
const peerConfirmed=id=>[...receiptsByPeer.values()].some(ids=>ids.has(id));
const receiptKey=()=> 'vctrmemo-owner-receipts-'+room;
function saveReceipts(){localStorage.setItem(receiptKey(),JSON.stringify([...receiptsSent].slice(-12000)));}
function queueReceipt(ids){
  for(const id of ids)if(!receiptsSent.has(id))receiptsQueued.add(id);
}
function showConfirmation(){
  try{
    const stored=readStorage(localStorage,STORAGE);
    const local=stored.sync.ops.filter(op=>op.id.startsWith('a_'+stored.sync.actor+'_'));
    const confirmed=local.filter(op=>[...receiptsByPeer.values()].some(ids=>ids.has(op.id))).length;
    status('暗号化変更をリレーが受理 ('+published.size+'/'+stored.sync.ops.length+'件)・他端末の適用確認 '+confirmed+'/'+local.length+'件');
  }catch(err){status('確認状態を取得できません: '+err.message);}
}
async function flushReceipts(){
  if(!client||stopped||receipting||!receiptsQueued.size)return;
  receipting=true;
  const ids=[...receiptsQueued].slice(0,20);
  try{
    await client.publish({type:'applied-v1',device:deviceId,ids});
    ids.forEach(id=>{receiptsQueued.delete(id);receiptsSent.add(id);lastReceiptAt.set(id,Date.now());});
    saveReceipts();
  }catch(err){console.warn('Owner-sync receipt retry pending',err);}
  finally{receipting=false;}
}
const validIds=ids=>Array.isArray(ids)&&ids.length>0&&ids.length<=20&&ids.every(id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(id));
async function requestMissing(){
  if(!client||stopped||asking||Date.now()-lastNeedAt<5000)return;
  let missing;
  try{
    const stored=readStorage(localStorage,STORAGE).sync;
    missing=new Sync.Engine(stored.ops,stored.actor,stored.counter).missingPredecessors();
  }catch(err){console.warn('Cannot inspect owner-sync missing history',err);return;}
  if(!missing.length)return;
  asking=true;lastNeedAt=Date.now();
  try{await client.publish({type:'need-v1',device:deviceId,ids:missing.slice(0,20)});}
  catch(err){console.warn('Owner-sync history repair request failed',err);}
  finally{asking=false;}
}
async function respondMissing(ids){
  if(!client||stopped||repairing||!validIds(ids))return;
  repairing=true;
  try{
    const sync=readStorage(localStorage,STORAGE).sync;
    const byId=new Map(sync.ops.map(op=>[op.id,op]));
    // Include the requested predecessors AND preceding chain; a single
    // lost relay event often contains 20 consecutive text mutations.
    const queue=ids.slice(),ops=[],seen=new Set();
    for(let i=0;i<queue.length&&ops.length<80;i++){
      const id=queue[i];
      if(seen.has(id))continue;
      seen.add(id);
      const op=byId.get(id);
      if(!op)continue;
      ops.push(op);
      for(const predecessor of op.pred||[])if(!seen.has(predecessor))queue.push(predecessor);
    }
    ops.reverse();
    for(let i=0;i<ops.length;i+=20)await client.publishBatch(ops.slice(i,i+20));
  }catch(err){console.warn('Owner-sync history repair reply failed',err);}
  finally{repairing=false;}
}
const editing=()=>{
  const a=document.activeElement;
  return a&&((a.isContentEditable)||(['INPUT','TEXTAREA'].includes(a.tagName)));
};
function savePublished(){localStorage.setItem('vctrmemo-owner-published-'+room,JSON.stringify([...published].slice(-12000)));}
async function flushRemote(){
  if(stopped||flushing||!pending.length||editing())return;
  flushing=true;
  try{
    // App.js is the ONLY writer of workspace operations. Applying a relay
    // message directly to localStorage leaves the running editor stale and can
    // erase remote history on its next keystroke.
    const batch=pending.slice();
    const detail={ops:batch,applied:false,error:'',missing:0};
    document.dispatchEvent(new CustomEvent('vctrmemo-owner-apply',{detail}));
    if(!detail.applied)throw Error(detail.error||'Application did not confirm local commit');
    for(const op of batch)published.add(op.id);
    savePublished();
    pending.splice(0,batch.length);
    // Receipt confirms that THIS browser has durably committed the change,
    // not merely that a relay accepted the ciphertext. Missing predecessors
    // must be recovered before claiming a complete application.
    if(!detail.missing){
      const saved=readStorage(localStorage,STORAGE).sync;
      const localPrefix='a_'+saved.actor+'_';
      // When an out-of-order predecessor finally arrives, acknowledge ALL
      // recovered peer operations, not only those from the final relay packet.
      queueReceipt(saved.ops.filter(op=>op.id.startsWith('a_')&&!op.id.startsWith(localPrefix)).map(op=>op.id));
      // If our earlier receipt was lost, respond again to a retransmitted op.
      for(const op of batch){
        if(!op.id.startsWith('a_')||op.id.startsWith(localPrefix)||!receiptsSent.has(op.id))continue;
        if(Date.now()-(lastReceiptAt.get(op.id)||0)<6000)continue;
        receiptsSent.delete(op.id);
        lastReceiptAt.set(op.id,Date.now());
        queueReceipt([op.id]);
      }
    }
    if(detail.missing)void requestMissing();
    status(detail.missing?'受信した変更を端末に保存・履歴不足 '+detail.missing+'件（修復要求中）':'受信した変更を端末に保存・画面を更新しました');
  }catch(err){
    status('受信処理を保留: '+err.message);console.error(err);
  }finally{flushing=false;}
}
function inbound(payload){
  if(payload?.type==='need-v1'){
    if(payload.device!==deviceId && validIds(payload.ids))void respondMissing(payload.ids);
    return;
  }
  if(payload?.type==='applied-v1'){
    if(typeof payload.device!=='string'||!/^[a-f0-9-]{36}$/.test(payload.device)||!Array.isArray(payload.ids)||payload.ids.length>20||payload.ids.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id)))return;
    if(payload.device!==deviceId){
      let known=receiptsByPeer.get(payload.device);
      if(!known){known=new Set();receiptsByPeer.set(payload.device,known);}
      payload.ids.forEach(id=>known.add(id));
      showConfirmation();
    }
    return;
  }
  const changes=payload?.batch===undefined?[payload]:payload.batch;
  if(!Array.isArray(changes)||changes.length<1||changes.length>20||!changes.every(Sync.isValidOp))return;
  // Persist first, then mark as acknowledged. Reject entire malformed batch.
  pending.push(...changes);setTimeout(flushRemote,250);
}
async function tick(){
  if(!client||stopped)return;
  void requestMissing();
  if(publishing)return;
  await flushRemote();
  void flushReceipts(); // peer acknowledgements must never block unsent edits
  // Sending local, already-persisted operations must NEVER wait for focus to leave
  // a contenteditable. Incoming merges/reloads remain deferred until editing ends.
  let stored;
  try{stored=readStorage(localStorage,STORAGE);}catch(err){status(err.message);return;}
  const unsent=stored.sync.ops.filter(op=>Sync.isValidOp(op)&&!published.has(op.id));
  // Fresh user edits must not sit behind ~138 built-in initialization fields.
  // Preserve causal order within each class; predecessors can be recovered.
  let next=[...unsent.filter(op=>op.id.startsWith('a_')),...unsent.filter(op=>!op.id.startsWith('a_'))].slice(0,20);
  if(!next.length && Date.now()-lastResendAt>=6000){
    // A relay OK confirms storage on that relay, NOT delivery to the other
    // device. Retry unconfirmed local edits in bounded round-robin batches.
    const prefix='a_'+stored.sync.actor+'_';
    const unconfirmed=stored.sync.ops.filter(op=>op.id.startsWith(prefix)&&published.has(op.id)&&!peerConfirmed(op.id));
    if(unconfirmed.length){
      next=Array.from({length:Math.min(20,unconfirmed.length)},(_,i)=>unconfirmed[(resendCursor+i)%unconfirmed.length]);
      resendCursor=(resendCursor+next.length)%unconfirmed.length;
      lastResendAt=Date.now();
    }
  }
  if(!next.length)return;
  publishing=true;
  try{
    await client.publishBatch(next);
    for(const op of next)published.add(op.id);
    savePublished();
    showConfirmation();
  }
  catch(err){status('送信失敗・再試行します: '+err.message);}
  finally{publishing=false;}
}
async function connect(){
  if(connecting||client)return;
  connecting=true;
  stopped=false;
  $('owner-disconnect').textContent='同期を停止';
  try{
    const instance=await ownerRelay({secret:SECRET,onOperation:inbound});
    room=instance.room;
    const idKey='vctrmemo-owner-device-'+room;
    const prior=localStorage.getItem(idKey);
    deviceId=prior&&/^[a-f0-9-]{36}$/.test(prior)?prior:crypto.randomUUID();
    localStorage.setItem(idKey,deviceId);
    const priorReceipts=JSON.parse(localStorage.getItem(receiptKey())||'[]');
    receiptsSent=new Set(Array.isArray(priorReceipts)?priorReceipts:[]);
    receiptsQueued=new Set();receiptsByPeer=new Map();
    resendCursor=0;lastResendAt=Date.now();lastNeedAt=0;asking=false;repairing=false;lastReceiptAt.clear();
    const saved=JSON.parse(localStorage.getItem('vctrmemo-owner-published-'+room)||'[]');
    published=new Set(Array.isArray(saved)?saved:[]);
    instance.start();client=instance;
    status('暗号化同期に接続しました。ほかの端末も同じURLで開いてください。');
    period=setInterval(tick,1200);
    await tick();
  }catch(err){status('接続エラー: '+err.message);console.error(err);}
  finally{connecting=false;}
}
$('owner-copy-link').onclick=async()=>{
  try{
    await navigator.clipboard.writeText(location.href);
    status('専用URLをコピーしました。Vectorの自分宛てNotesにだけ貼ってください。');
  }catch{status('コピーできません。ブラウザのアドレスバーから専用URLをコピーしてください。');}
};
$('owner-disconnect').onclick=()=>{
  if(stopped){
    status('暗号化同期を再接続しています…');
    connect();
    return;
  }
  stopped=true;
  clearInterval(period);period=null;
  client?.stop();client=null;
  $('owner-disconnect').textContent='同期を再開';
  status('同期を一時停止中です。再開するには「同期を再開」を押してください。');
};
document.addEventListener('focusout',()=>setTimeout(flushRemote,200));
connect();
