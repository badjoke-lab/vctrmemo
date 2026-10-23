// Opt-in browser-only E2EE synchronization for a new, isolated workspace.
// Opening one private URL on both devices uses the same 256-bit secret from
// the URL fragment. The secret never reaches the HTTP server or Nostr relay.
import {ownerRelay} from './relay.mjs';
import {mergeWorkspaceOps,readStorage} from './merge.mjs';
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
let client=null,period=null,flushing=false,publishing=false,reloadTimer=null,pending=[],published=new Set(),room='',stopped=false;
const editing=()=>{
  const a=document.activeElement;
  return a&&((a.isContentEditable)||(['INPUT','TEXTAREA'].includes(a.tagName)));
};
function savePublished(){localStorage.setItem('vctrmemo-owner-published-'+room,JSON.stringify([...published].slice(-12000)));}
async function flushRemote(){
  if(flushing||!pending.length||editing())return;
  flushing=true;
  try{
    const now=readStorage(localStorage,STORAGE);
    const result=mergeWorkspaceOps(now.sync,pending,Sync);
    if(result.changed){
      localStorage.setItem(STORAGE,JSON.stringify({...now,sync:result.sync}));
      status(result.missing?'受信済み・不足履歴の取得待ち':'受信した変更履歴を統合しました');
      clearTimeout(reloadTimer);
      reloadTimer=setTimeout(()=>{if(!editing())location.reload();},1200);
    }
    for(const op of pending)published.add(op.id);
    savePublished();pending=[];
  }catch(err){
    status('受信処理を保留: '+err.message);console.error(err);
  }finally{flushing=false;}
}
function inbound(payload){
  const changes=payload?.batch===undefined?[payload]:payload.batch;
  if(!Array.isArray(changes)||changes.length<1||changes.length>20||!changes.every(Sync.isValidOp))return;
  // Persist first, then mark as acknowledged. Reject entire malformed batch.
  pending.push(...changes);setTimeout(flushRemote,250);
}
async function tick(){
  if(!client||publishing||stopped)return;
  await flushRemote();
  if(editing()||pending.length)return;
  let stored;
  try{stored=readStorage(localStorage,STORAGE);}catch(err){status(err.message);return;}
  const next=stored.sync.ops.filter(op=>Sync.isValidOp(op)&&!published.has(op.id)).slice(0,20);
  if(!next.length)return;
  publishing=true;
  try{
    await client.publishBatch(next);
    for(const op of next)published.add(op.id);
    savePublished();
    status('暗号化した変更を送信済み ('+published.size+'/'+stored.sync.ops.length+'件)');
  }
  catch(err){status('送信失敗・再試行します: '+err.message);}
  finally{publishing=false;}
}
async function connect(){
  try{
    const instance=await ownerRelay({secret:SECRET,onOperation:inbound});
    room=instance.room;
    const saved=JSON.parse(localStorage.getItem('vctrmemo-owner-published-'+room)||'[]');
    published=new Set(Array.isArray(saved)?saved:[]);
    instance.start();client=instance;
    status('暗号化同期に接続しました。ほかの端末も同じURLで開いてください。');
    period=setInterval(tick,1200);
    await tick();
  }catch(err){status('接続エラー: '+err.message);console.error(err);}
}
$('owner-copy-link').onclick=async()=>{
  try{
    await navigator.clipboard.writeText(location.href);
    status('専用URLをコピーしました。Vectorの自分宛てNotesにだけ貼ってください。');
  }catch{status('コピーできません。ブラウザのアドレスバーから専用URLをコピーしてください。');}
};
$('owner-disconnect').onclick=()=>{
  stopped=true;client?.stop();client=null;clearInterval(period);
  status('同期を停止しました。過去の暗号文やURLのアクセス権は取り消せません。');
};
document.addEventListener('focusout',()=>setTimeout(flushRemote,500));
connect();
