// Opt-in browser-only E2EE synchronization for a new, isolated workspace.
// Opening one private URL on both devices uses the same 256-bit secret from
// the URL fragment. The secret never reaches the HTTP server or Nostr relay.
import {ownerRelay} from './relay.mjs';
import {readStorage} from './merge.mjs';
import {snapshotParts,SnapshotInbox} from './snapshot.mjs';
import {sealPortableBackup,openPortableBackup,preparePortableRestore,MAX_FILE_BYTES} from './portable-backup.mjs';
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
<button id="owner-snapshot" type="button">復旧用の暗号化スナップショットを保存</button>
<div><button id="owner-save-file" type="button">暗号化バックアップをファイル保存</button>
<button id="owner-load-file" type="button">暗号化バックアップから復元</button>
<button id="owner-recovery-mode" type="button">安全な復元専用画面を開く</button>
<input id="owner-backup-file" type="file" accept=".vctrmemo,.json,application/json" hidden></div>
<p class="owner-warning">暗号化ファイルはリレー不要で復元できますが、<strong>元の秘密鍵付きURLも必要</strong>です。ファイルとURLは別々の安全な場所に保管してください。</p>
<p id="owner-sync-state" role="status" aria-live="polite">暗号化同期へ接続しています…</p>
<p class="owner-warning"><strong>専用URLには復号鍵が含まれます。</strong> URLを知った人は閲覧・変更できます。Vectorの<strong>自分宛てNotesだけ</strong>に貼り、他人へ転送しないでください。この実験版はVector内のMini Appではなく、ブラウザで動作します。外部Nostrリレーへ暗号文を保存します。既存の端末内メモは同期・転送されません。</p>
</details>`;
// Place outside #content-area: render() replaces that node's children on edits.
// On small screens this section belongs in the document flow, never on top of
// the editable blocks or the Android on-screen keyboard.
panel.querySelector('details').open=!matchMedia('(max-width:800px)').matches;
const style=document.createElement('style');
style.textContent=`#owner-sync-panel{position:fixed;right:12px;bottom:12px;z-index:9000;max-width:min(380px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow-y:auto;box-sizing:border-box;background:#15241f;color:#f2f6f2;border:1px solid #5c8274;padding:12px;border-radius:12px;font:13px system-ui;box-shadow:0 8px 22px #0007}
#owner-sync-panel summary{cursor:pointer;font-weight:600}
#owner-sync-panel p{line-height:1.45;margin:10px 0}
#owner-sync-panel button{font:inherit;padding:7px;margin:4px 5px 4px 0;background:#244339;border:1px solid #60806e;color:white;border-radius:5px;cursor:pointer}
#owner-sync-panel .owner-warning{font-size:11px;color:#cabb9d}
@media(max-width:800px){
  #owner-sync-panel{position:static;max-width:none;max-height:none;overflow:visible;width:auto;z-index:auto;margin:10px 16px 0;padding:10px 12px;box-shadow:none}
  #owner-sync-panel summary{min-height:28px;display:list-item;line-height:28px}
  #owner-sync-panel button{max-width:100%;white-space:normal}
}`;
document.head.append(style);
const main=document.querySelector('main.main'),content=document.getElementById('content-area');
if(!main||!content)throw Error('Owner-sync layout unavailable');
main.insertBefore(panel,content);
const $=id=>document.getElementById(id),status=t=>{$('owner-sync-state').textContent=t};
let client=null,period=null,flushing=false,publishing=false,pending=[],published=new Set(),room='',stopped=false,connecting=false;
let deviceId='',receiptsQueued=new Set(),receiptsSent=new Set(),receiptsByPeer=new Map(),receipting=false;
let resendCursor=0,lastResendAt=0,lastNeedAt=0,repairing=false,asking=false;
let composing=false,replayReplying=false;
let snapshotPublishing=false,connectedAt=0,lastSnapshotAttemptAt=0;
const snapshotInbox=new SnapshotInbox(Sync),snapshotRequests=new Map();
const replayRequests=new Map();
const snapshotKey=()=> 'vctrmemo-owner-snapshot-'+room;
function lastSnapshot(){
  try{return JSON.parse(localStorage.getItem(snapshotKey())||'null');}catch{return null;}
}
// Does not overwrite local data. Uses the exact same AES-GCM signed event
// transport as ordinary operations, after complete SHA-256 verification.
async function publishSnapshot({manual=false,requested=false}={}){
  if(!client||stopped||snapshotPublishing){
    if(manual)status('現在同期できません。再開後にスナップショットを保存してください。');
    return;
  }
  snapshotPublishing=true;lastSnapshotAttemptAt=Date.now();
  const button=$('owner-snapshot');button.disabled=true;
  try{
    const sync=readStorage(localStorage,STORAGE).sync;
    const plan=await snapshotParts(sync,Sync);
    const previous=lastSnapshot();
    if(!manual&&!requested&&previous?.id===plan.id)return;
    // A peer requesting recovery may have missed every old relay event.
    // Re-send the complete snapshot even when its hash has not changed.
    if(manual)status('復旧用の暗号化履歴を '+plan.count+' 分割で保存しています…');
    for(const part of plan.parts){
      if(stopped||!client)throw Error('同期を停止したため中断しました');
      await client.publish(part);
    }
    localStorage.setItem(snapshotKey(),JSON.stringify({id:plan.id,at:Date.now(),opCount:sync.ops.length}));
    if(manual)status('暗号化スナップショット '+plan.count+' 分割をリレーが受理しました（永続保管の保証はありません）');
  }catch(err){
    if(manual)status('スナップショット保存失敗: '+err.message);
    console.warn('Owner-sync snapshot publish failed',err);
  }finally{snapshotPublishing=false;button.disabled=false;}
}
function autoSnapshot(){
  if(!client||stopped||snapshotPublishing||Date.now()-connectedAt<90000||Date.now()-lastSnapshotAttemptAt<5*60*1000)return;
  try{
    const sync=readStorage(localStorage,STORAGE).sync;
    const latest=lastSnapshot();
    if(!sync.ops.some(op=>op.id.startsWith('a_')))return;
    if(latest && (sync.ops.length-latest.opCount<50||Date.now()-latest.at<30*60*1000))return;
    void publishSnapshot();
  }catch(err){console.warn('Owner-sync automatic snapshot deferred',err);}
}
function respondSnapshotRequest(device){
  if(!client||stopped||device===deviceId)return;
  if(Date.now()-(snapshotRequests.get(device)||0)<120000)return;
  snapshotRequests.set(device,Date.now());
  void publishSnapshot({requested:true});
}
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
// A focused field is not an unfinished edit. Waiting for blur caused
// "sync resumes only after I tap elsewhere" on Android and desktop.
document.addEventListener('compositionstart',()=>{composing=true;},true);
document.addEventListener('compositionend',()=>{composing=false;setTimeout(flushRemote,0);},true);
async function announceRejoin(){
  if(!client||stopped)return;
  try{await client.publish({type:'rejoin-v1',device:deviceId,sentAt:Date.now()});}
  catch(err){console.warn('Owner-sync rejoin request will be retried by relay/history recovery',err);}
}
async function replayRecentTo(device){
  if(!client||stopped||replayReplying||device===deviceId)return;
  // Rate-limit unsolicited peer catch-up and never echo a replay response.
  if(Date.now()-(replayRequests.get(device)||0)<10000)return;
  replayRequests.set(device,Date.now());
  replayReplying=true;
  try{
    const sync=readStorage(localStorage,STORAGE).sync;
    const prefix='a_'+sync.actor+'_';
    // The tail establishes missing-predecessor links to older offline edits.
    const own=sync.ops.filter(op=>op.id.startsWith(prefix)).slice(-40);
    for(let i=0;i<own.length;i+=20)await client.publishBatch(own.slice(i,i+20));
  }catch(err){console.warn('Owner-sync reconnect history replay failed',err);}
  finally{replayReplying=false;}
}
function savePublished(){localStorage.setItem('vctrmemo-owner-published-'+room,JSON.stringify([...published].slice(-12000)));}
async function flushRemote(){
  if(stopped||flushing||!pending.length||composing)return;
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
  if(payload?.type==='snapshot-part-v1'){
    void snapshotInbox.accept(payload).then(result=>{
      if(!result||stopped)return;
      // Reuse the editor's single writer. A snapshot never replaces the
      // workspace or its local actor; it merges the complete operation log.
      pending.push(...result.ops);
      status('復旧用履歴 '+result.ops.length+'件の整合性を検証しました。画面へ統合しています…');
      void flushRemote();
    }).catch(err=>console.warn('Invalid encrypted snapshot ignored',err));
    return;
  }
  if(payload?.type==='rejoin-v1'){
    if(typeof payload.device==='string'&&/^[a-f0-9-]{36}$/.test(payload.device)){
      void replayRecentTo(payload.device);
      // Replay of stale relay history must not trigger full snapshot floods.
      if(Number.isSafeInteger(payload.sentAt)&&Math.abs(Date.now()-payload.sentAt)<90000)
        respondSnapshotRequest(payload.device);
    }
    return;
  }
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
  pending.push(...changes);setTimeout(flushRemote,0);
}
async function tick(){
  if(!client||stopped)return;
  void requestMissing();
  if(publishing)return;
  await flushRemote();
  void flushReceipts(); // peer acknowledgements must never block unsent edits
  // Both local sending and incoming merges can occur with a focused editor;
  // only an active IME composition suspends incoming DOM updates.
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
  if(!next.length){autoSnapshot();return;}
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
    resendCursor=0;lastResendAt=Date.now();lastNeedAt=0;asking=false;repairing=false;lastReceiptAt.clear();replayRequests.clear();
    const saved=JSON.parse(localStorage.getItem('vctrmemo-owner-published-'+room)||'[]');
    published=new Set(Array.isArray(saved)?saved:[]);
    instance.start();client=instance;connectedAt=Date.now();
    status('暗号化同期に接続しました。ほかの端末も同じURLで開いてください。');
    period=setInterval(tick,1200);
    // A reconnect actively asks the still-online peer to replay recent edits
    // rather than waiting for the relay's old-event subscription/history.
    void announceRejoin();
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
$('owner-snapshot').onclick=()=>{void publishSnapshot({manual:true});};
$('owner-recovery-mode').onclick=()=>{
  const url=new URL(location.href);
  url.searchParams.set('recovery','1');
  window.open(url.href,'_blank','noopener,noreferrer');
};
// Local, offline recovery never calls the relay and never changes the
// currently opened editor. It needs the exact same private #k= URL on a
// replacement device, without requiring either original device to be online.
$('owner-save-file').onclick=async()=>{
  if(composing){status('日本語変換を確定してからバックアップを保存してください。');return;}
  const btn=$('owner-save-file');btn.disabled=true;
  try{
    const sync=readStorage(localStorage,STORAGE).sync;
    const data=await sealPortableBackup(sync,SECRET,Sync);
    const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;
    link.download='vctrmemo-encrypted-'+new Date().toISOString().slice(0,10)+'.vctrmemo';
    document.body.append(link);link.click();
    setTimeout(()=>{link.remove();URL.revokeObjectURL(url);},10000);
    status('暗号化バックアップを保存しました（'+sync.ops.length+'件）。秘密鍵付きURLも必要です。');
  }catch(err){status('バックアップ失敗: '+String(err.message||err));}
  finally{btn.disabled=false;}
};
$('owner-load-file').onclick=()=>{if(!composing)$('owner-backup-file').click();else status('日本語変換を確定してから復元してください。');};
$('owner-backup-file').onchange=async()=>{
  const input=$('owner-backup-file'),file=input.files?.[0],btn=$('owner-load-file');
  if(!file)return;
  btn.disabled=true;
  try{
    if(composing)throw Error('日本語変換中には復元できません');
    if(file.size>MAX_FILE_BYTES)throw Error('ファイルが大きすぎます');
    const backup=await openPortableBackup(await file.text(),SECRET,Sync);
    const current=readStorage(localStorage,STORAGE).sync;
    const plan=preparePortableRestore(current,backup.ops,Sync);
    if(!plan.changes.length){
      status('復元確認：すべての履歴が既に保存されています（'+plan.count+'件）。');
      return;
    }
    if(!confirm('暗号化ファイルを検証しました（'+plan.count+'件）。既存データを消さず、未登録の履歴'+plan.changes.length+'件を追加しますか？'))return;
    // This is the ONLY durable writer for both relay sync and local recovery.
    const detail={ops:plan.changes,applied:false,error:'',missing:0};
    document.dispatchEvent(new CustomEvent('vctrmemo-owner-apply',{detail}));
    if(!detail.applied||detail.missing)throw Error(detail.error||'履歴の復元が完了しませんでした');
    status('暗号化バックアップから復元しました。履歴 '+plan.changes.length+' 件を追加し、元データは保持しました。');
  }catch(err){
    status('復元に失敗: '+String(err.message||err)+'（元のメモは維持）');
    console.warn('Owner portable recovery rejected',err);
  }finally{btn.disabled=false;input.value='';}
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
document.addEventListener('focusout',()=>setTimeout(flushRemote,0));
connect();
