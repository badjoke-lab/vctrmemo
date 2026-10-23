// Browser-only bootstrap. The URL fragment is the 256-bit workspace secret.
// This file never ships in Vector's isolated .xdc package.
const $=id=>document.getElementById(id);
const secure=globalThis.isSecureContext && globalThis.crypto?.subtle;
const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
const parseHash=hash=>/^#k=([a-f0-9]{64})$/i.exec(hash)?.[1]?.toLowerCase()||null;
const root=document.createElement('div');
root.id='owner-link-bootstrap';
root.setAttribute('role','status');
root.style.cssText='position:fixed;z-index:20000;bottom:10px;left:10px;background:#152b20;color:#f1faf4;border:1px solid #658570;border-radius:8px;padding:8px 12px;font:12px system-ui';
root.textContent='個人用ワークスペースを準備中…';
document.body.append(root);
try{
  if(!secure)throw Error('HTTPS環境が必要です。');
  let secret=parseHash(location.hash);
  if(location.hash && !secret)throw Error('URLの同期鍵が不正です。データは変更していません。');
  if(!secret){
    secret=hex(crypto.getRandomValues(new Uint8Array(32)));
    // Fragment is never included in HTTPS requests to GitHub Pages.
    history.replaceState(null,'',location.pathname+location.search+'#k='+secret);
  }
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('vctrmemo:scoped-local:v1:'+secret)));
  const room=hex(digest);
  window.__vctrmemo_owner_storage_key='vctrmemo-synced-v1-'+room;
  window.__vctrmemo_owner_secret=secret; // In-memory only; never saved to localStorage.
  // Explicitly isolate this opt-in synced workspace from existing vctrmemo-v2 notes.
  await import('./app.js');
  await import('../owner-sync.js');
  root.remove();
}catch(error){
  root.textContent='開始できません: '+String(error.message||error);
  console.error('vctrmemo linked workspace startup failed',error);
}
