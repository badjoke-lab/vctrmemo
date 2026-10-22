import {createOwnerProbe,generateSecret} from './probe-core.mjs';
// Synthetic traffic only. Never reads the user's notes or localStorage.
const host=window.webxdc;
const panel=document.createElement('section');
panel.id='vector-owner-probe';
panel.innerHTML='<details><summary>Vector本人2端末・通信診断（開発用）</summary>'+
'<p>実際のメモは送信しません。同じVectorアカウントの2端末で、同一のMini Appメッセージを開いて試してください。</p>'+
'<p><strong>注意：</strong>Mini Appはチャット参加者と通信する仕組みです。自分だけのチャットであることを確認してください。Mini Appには参加者一覧の認証機能がありません。</p>'+
'<label for="vector-probe-key">一時テスト鍵（64桁）</label>'+
'<input id="vector-probe-key" type="text" autocomplete="off" spellcheck="false" placeholder="64文字の一時テスト鍵">'+
'<div class="probe-controls"><button id="vector-probe-generate">鍵を生成</button><button id="vector-probe-copy">鍵をコピー</button>'+
'<button id="vector-probe-connect">接続</button><button id="vector-probe-ping" disabled>通信テスト送信</button>'+
'<button id="vector-probe-close" disabled>切断</button></div>'+
'<p id="vector-probe-status" role="status" aria-live="polite">通信未開始です。</p>'+
'<p class="probe-footnote">これは本人専用同期を保証するものではありません。暗号化したランダム識別子のみをIrohで送ります。別端末への履歴保存・データ復旧は対象外です。</p></details>';
const style=document.createElement('style');
style.textContent='#vector-owner-probe{position:fixed;right:10px;bottom:12px;z-index:15000;width:min(360px,calc(100vw - 20px));padding:12px;border:1px solid #668a78;border-radius:12px;background:#14281e;color:#ecf6ed;box-shadow:0 6px 20px #0008;font:12px/1.5 system-ui}'+
'#vector-owner-probe summary{cursor:pointer;font-weight:650;font-size:13px}#vector-owner-probe p{margin:8px 0}#vector-owner-probe label{display:block;margin-top:9px}'+
'#vector-probe-key{box-sizing:border-box;width:100%;padding:8px;background:#092015;color:white;border:1px solid #6d8a7e;border-radius:5px;font-size:12px}'+
'#vector-owner-probe .probe-controls{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}'+
'#vector-owner-probe button{background:#254936;border:1px solid #789484;border-radius:6px;color:white;padding:6px;cursor:pointer}'+
'#vector-owner-probe button:disabled{opacity:.45;cursor:not-allowed}#vector-owner-probe .probe-footnote{font-size:11px;color:#d7c6a7}';
document.head.append(style);document.body.append(panel);
const $=id=>document.getElementById(id);
const status=s=>{$('vector-probe-status').textContent=s;};
const probe=createOwnerProbe(host,{onStatus:status});
$('vector-probe-generate').addEventListener('click',()=>{
  $('vector-probe-key').value=generateSecret();
  status('一時テスト鍵を生成しました。自分のもう一方の端末に安全に入力してください。');
});
$('vector-probe-copy').addEventListener('click',async()=>{
  const key=$('vector-probe-key').value.trim();
  if(!/^[0-9a-f]{64}$/i.test(key)){status('先に鍵を生成してください。');return;}
  try{await navigator.clipboard.writeText(key);status('鍵をコピーしました。チャットには貼らず、自分の端末に直接移してください。');}
  catch{status('コピー権限がありません。鍵欄から手動でコピーしてください。');}
});
$('vector-probe-connect').addEventListener('click',async()=>{
  if(!confirm('自分だけのチャットで、同じアカウントの2端末に限る通信診断です。実際のメモは送信しません。接続しますか？'))return;
  try{
    await probe.connect($('vector-probe-key').value.trim());
    $('vector-probe-key').value='';
    $('vector-probe-connect').disabled=true;$('vector-probe-ping').disabled=false;$('vector-probe-close').disabled=false;
  }catch(e){status('接続失敗: '+e.message);}
});
$('vector-probe-ping').addEventListener('click',async()=>{
  try{await probe.ping();}catch(e){status('送信失敗: '+e.message);}
});
$('vector-probe-close').addEventListener('click',()=>{
  probe.close();$('vector-probe-connect').disabled=false;$('vector-probe-ping').disabled=true;$('vector-probe-close').disabled=true;
});
