// Browser-preview-only owner sync. Never bundled into .xdc.
// The pairing secret is an independent workspace key, NOT a Vector login key.
import {newSecret} from './codec.mjs';
import {ownerRelay} from './relay.mjs';
import {mergeWorkspaceOps,readStorage} from './merge.mjs';
const STORAGE='vctrmemo-v2',PAIR='vctrmemo-owner-pairing-v1';
const Sync=window.VctrSync;
if(!Sync||!window.isSecureContext)throw Error('Owner sync requires secure HTTPS and VctrSync');
const panel=document.createElement('section');
panel.id='owner-sync-panel';
panel.innerHTML=`<details><summary>本人の端末間同期（ブラウザ実験版）</summary>
<p>Vector内のMini Appでは動きません。最初に1台で鍵を作り、別の端末に同じ鍵を入力して接続します。追加アカウントは不要です。</p>
<input id="owner-sync-secret" type="password" spellcheck="false" autocomplete="off" placeholder="64文字の同期鍵" aria-label="同期鍵">
<div class="owner-actions"><button id="owner-new-key">新規同期鍵</button><button id="owner-copy-key">鍵をコピー</button><button id="owner-connect">同期開始</button><button id="owner-disconnect">切断</button></div>
<p id="owner-sync-state" role="status">未接続</p>
<p class="owner-warning">同期鍵を知る人は内容を復号・変更できます。鍵はURLやチャットへ貼らないでください。リレーには暗号文だけを送りますが、送信時刻・件数は見えます。保存先は外部の公開Nostrリレーです。</p>
</details>`;
Object.assign(panel.style,{position:'fixed',right:'12px',bottom:'12px',zIndex:9000,maxWidth:'min(380px,calc(100vw - 24px))',background:'#15241f',color:'#f2f6f2',border:'1px solid #5c8274',padding:'12px',borderRadius:'12px',font:'13px system-ui',boxShadow:'0 8px 22px #0007'});
const style=document.createElement('style');
style.textContent=`#owner-sync-panel summary{cursor:pointer;font-weight:600}#owner-sync-panel p{line-height:1.45;margin:10px 0}#owner-sync-secret{width:100%;box-sizing:border-box;background:#061812;color:white;padding:8px;border:1px solid #668c7c;border-radius:6px}#owner-sync-panel .owner-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}#owner-sync-panel button{font:inherit;padding:6px;background:#244339;border:1px solid #60806e;color:white;border-radius:5px;cursor:pointer}#owner-sync-panel .owner-warning{font-size:11px;color:#cabb9d}`;
document.head.append(style);document.body.append(panel);
const $=id=>document.getElementById(id),status=t=>{$('owner-sync-state').textContent=t};
let client=null,period=null,flushing=false,publishing=false,reloadTimer=null,pending=[],known=new Set(),published=new Set(),room='';
const editing=()=>{const a=document.activeElement;return a&&((a.isContentEditable)||['INPUT','TEXTAREA'].includes(a.tagName)&&a.id!=='owner-sync-secret');};
function savePublished(){localStorage.setItem('vctrmemo-owner-published-'+room,JSON.stringify([...published].slice(-12000)));}
async function flushRemote(){
  if(flushing||!pending.length||editing())return;
  flushing=true;
  try{
    const now=readStorage(localStorage,STORAGE);
    const result=mergeWorkspaceOps(now.sync,pending,Sync);
    if(result.changed){
      // Preserve the original key and object format. No silent destructive migration.
      localStorage.setItem(STORAGE,JSON.stringify({...now,sync:result.sync}));
      status(result.missing?'受信しました（履歴不足あり）':'暗号化した変更を受信・統合しました');
      clearTimeout(reloadTimer);
      reloadTimer=setTimeout(()=>{if(!editing())location.reload();},1200);
    }
    pending=[];
  }catch(err){status('受信を保留: '+err.message);console.error(err);}
  finally{flushing=false;}
}
function inbound(op){
  if(!Sync.isValidOp(op))return;
  known.add(op.id);published.add(op.id);savePublished();
  pending.push(op);setTimeout(flushRemote,500);
}
async function tick(){
  if(!client||publishing)return;
  await flushRemote();
  if(editing()||pending.length)return;
  let stored;
  try{stored=readStorage(localStorage,STORAGE);}catch(err){status(err.message);return;}
  const next=stored.sync.ops.find(op=>Sync.isValidOp(op)&&!published.has(op.id));
  if(!next)return;
  publishing=true;
  try{await client.publish(next);published.add(next.id);savePublished();status('同期中・暗号化送信済み '+published.size+' 件');}
  catch(err){status('送信できません。再試行します: '+err.message);}
  finally{publishing=false;}
}
async function connect(secret,interactive=false){
  if(client){client.stop();client=null;}
  const normalized=secret.trim().toLowerCase();
  if(!/^[0-9a-f]{64}$/.test(normalized)){status('同期鍵は64桁の16進数です');return;}
  if(interactive&&!confirm('この端末の個人メモの変更履歴を暗号化して公開Nostrリレーへ同期します。鍵を持つ他端末でも読めるようになります。開始しますか？'))return;
  try{
    const instance=await ownerRelay({secret:normalized,onOperation:inbound});
    room=instance.room;
    known=new Set();published=new Set(JSON.parse(localStorage.getItem('vctrmemo-owner-published-'+room)||'[]'));
    instance.start();client=instance;
    localStorage.setItem(PAIR,normalized);
    $('owner-sync-secret').value=normalized;
    status('同期接続済み（'+room.slice(0,14)+'…）。他端末にも同じ鍵を設定してください。');
    clearInterval(period);period=setInterval(tick,1200);await tick();
  }catch(err){status('同期接続に失敗: '+err.message);console.error(err);}
}
$('owner-new-key').onclick=()=>{$('owner-sync-secret').value=newSecret();status('新規同期鍵を生成しました。コピーし、同期開始を押してください。');};
$('owner-copy-key').onclick=async()=>{try{await navigator.clipboard.writeText($('owner-sync-secret').value);status('同期鍵をコピーしました。安全な方法で自分の他端末に渡してください。');}catch{status('鍵をコピーできません。手動で控えてください。');}};
$('owner-connect').onclick=()=>connect($('owner-sync-secret').value,true);
$('owner-disconnect').onclick=()=>{client?.stop();client=null;clearInterval(period);localStorage.removeItem(PAIR);$('owner-sync-secret').value='';status('同期を停止しました。暗号文や過去に共有した鍵は回収されません。');};
document.addEventListener('focusout',()=>setTimeout(flushRemote,500));
const saved=localStorage.getItem(PAIR);
if(saved)connect(saved,false);
