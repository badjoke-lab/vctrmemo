// Offline, two-stage recovery page: NO app.js, NO relay, NO auto-save.
// Neither the original notes nor the live workspace is touched until the
// user explicitly confirms a fully verified and previewed import.
import {openPortableBackup,preparePortableRestore,validateCompleteHistory,MAX_FILE_BYTES} from './portable-backup.mjs';

const key=window.__vctrmemo_owner_storage_key;
const secret=window.__vctrmemo_owner_secret;
const Sync=window.VctrSync;
if(!key||!secret||!Sync||!crypto?.subtle)throw Error('Recovery prerequisites unavailable');

const page=document.createElement('main');
page.id='owner-recovery-mode';
page.style.cssText='box-sizing:border-box;max-width:820px;margin:24px auto;padding:24px;font:15px/1.65 system-ui;color:#e9f2ec;background:#16251f;border-radius:12px;border:1px solid #608574';
const title=document.createElement('h1');
title.textContent='vctrmemo — オフライン復元専用';
const explain=document.createElement('p');
explain.textContent='この画面はNostrリレーに接続せず、ファイル選択だけでは保存データを書き換えません。暗号化バックアップを検証・確認してから、明示的に復元を確定してください。';
const warning=document.createElement('p');
warning.textContent='元の秘密鍵付きURLと暗号化ファイルの両方が必要です。元のMacやスマホを使う必要はありません。';
const input=document.createElement('input');
input.id='owner-recovery-file';
input.type='file';input.accept='.vctrmemo,application/json';
const details=document.createElement('section');
details.id='owner-recovery-details';
details.setAttribute('role','status');
details.setAttribute('aria-live','polite');
details.textContent='未選択：この端末の保存データは変更されていません。';
details.style.cssText='white-space:pre-wrap;margin:16px 0;padding:12px;background:#23382f;border-radius:8px';
// Optional local-only content preview. Never write titles or body text to
// URLs, relay events, logs or telemetry. textContent prevents HTML injection.
const preview=document.createElement('details');
preview.id='owner-recovery-preview';
preview.hidden=true;
const previewHeading=document.createElement('summary');
previewHeading.textContent='復元されるページ・文章の内容を確認する（この端末だけに表示）';
const previewBody=document.createElement('div');
previewBody.id='owner-recovery-preview-body';
previewBody.style.cssText='margin-top:12px;padding:12px;background:#23382f;border-radius:8px';
preview.append(previewHeading,previewBody);
const commit=document.createElement('button');
commit.id='owner-recovery-commit';commit.type='button';commit.disabled=true;
commit.textContent='検証済みの履歴をこの端末に復元する';
commit.style.cssText='padding:11px 16px;border-radius:8px;background:#417963;color:white;font:inherit;border:0;cursor:pointer';
const back=document.createElement('a');
back.id='owner-recovery-back';back.textContent='通常のメモ画面へ戻る（同期は通常画面で再開）';
const normal=new URL(location.href);
normal.searchParams.delete('recovery');
back.href=normal.href;
back.style.cssText='display:block;color:#bfe8d8;margin-top:18px';
page.append(title,explain,warning,input,details,preview,commit,back);
document.body.replaceChildren(page);

let pending=null;
function status(message){details.textContent=message;}
function renderPreview(project){
  previewBody.replaceChildren();
  const active=project.pages.filter(p=>!p.deleted);
  for(const page of active.slice(0,25)){
    const section=document.createElement('section');
    const heading=document.createElement('h3');
    heading.textContent=String(page.title||'無題');
    heading.style.cssText='font-size:15px;margin:12px 0 4px';
    section.append(heading);
    const excerpts=(page.blocks||[]).filter(b=>!b.deleted&&typeof b.text==='string'&&b.text.trim()).slice(0,3);
    for(const b of excerpts){
      const p=document.createElement('p');
      p.textContent=b.text.slice(0,180)+(b.text.length>180?'…':'');
      p.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;margin:2px 0 7px;color:#d0e3d8';
      section.append(p);
    }
    previewBody.append(section);
  }
  if(active.length>25){
    const more=document.createElement('p');
    more.textContent='ほかに'+(active.length-25)+'ページあります。';
    previewBody.append(more);
  }
  const tasks=(project.tasks||[]).filter(t=>!t.deleted);
  if(tasks.length){
    const label=document.createElement('h3');label.textContent='タスク（最大10件）';previewBody.append(label);
    for(const task of tasks.slice(0,10)){
      const p=document.createElement('p');
      p.textContent=String(task.title||'無題');
      previewBody.append(p);
    }
  }
  preview.hidden=false;
  preview.open=false;
}
function validSaved(raw){
  if(raw===null)return new Sync.Engine();
  let existing;
  try{existing=JSON.parse(raw);}catch{throw Error('この端末の既存データを読めません。元データを変更せず中止します。');}
  if(existing?.sync?.version!==2||typeof existing.sync.actor!=='string'
    ||!Number.isSafeInteger(existing.sync.counter)||existing.sync.counter<0)
    throw Error('この端末の既存履歴の形式が不正です。変更せず中止します。');
  validateCompleteHistory(existing.sync.ops,Sync);
  const engine=new Sync.Engine(existing.sync.ops,existing.sync.actor,existing.sync.counter);
  if(engine.ops.size!==existing.sync.ops.length||engine.missingPredecessors().length)
    throw Error('この端末の保存履歴が不完全です。変更せず中止します。');
  return engine;
}
input.addEventListener('change',async()=>{
  pending=null;commit.disabled=true;
  preview.hidden=true;preview.open=false;previewBody.replaceChildren();
  const file=input.files?.[0];
  if(!file){status('ファイルは選択されていません。');return;}
  try{
    if(file.size>MAX_FILE_BYTES)throw Error('バックアップが大きすぎます。');
    const backup=await openPortableBackup(await file.text(),secret,Sync);
    // Preflight against the actual browser storage, without ever writing.
    const before=localStorage.getItem(key);
    const engine=validSaved(before);
    const plan=preparePortableRestore(engine.export(),backup.ops,Sync);
    if(engine.merge(plan.changes)!==plan.changes.length||engine.missingPredecessors().length)
      throw Error('全編集履歴を復元できません。');
    const project=engine.project();
    renderPreview(project);
    const existingCount=before===null?0:JSON.parse(before).sync.ops.length;
    pending={before,encoded:JSON.stringify({sync:engine.export()}),changes:plan.changes.length};
    status('検証成功：暗号化・改ざん検査・履歴整合性が正常です。\n'
      +'ファイル内の編集履歴：'+backup.ops.length+'件\n'
      +'この端末の既存履歴：'+existingCount+'件\n'
      +'追加する履歴：'+plan.changes.length+'件\n'
      +'復元後のページ：'+project.pages.filter(p=>!p.deleted).length+'件\n'
      +'復元後のタスク：'+project.tasks.filter(t=>!t.deleted).length+'件\n'
      +'未解決の編集競合：'+engine.conflicts.length+'件\n'
      +'ここまでは保存データを変更していません。');
    if(plan.changes.length){
      commit.disabled=false;
    }else{
      status(details.textContent+'\n追加の必要はありません。既存データには触れていません。');
    }
  }catch(err){
    pending=null;commit.disabled=true;
    preview.hidden=true;previewBody.replaceChildren();
    status('復元前検査で中止しました：'+String(err.message||err)+'\n既存データは変更していません。');
  }
});
commit.addEventListener('click',()=>{
  if(!pending)return;
  commit.disabled=true;
  try{
    // Synchronous check-then-commit: another tab may have edited in between.
    // Never overwrite concurrent changes using an outdated preflight.
    const actual=localStorage.getItem(key);
    if(actual!==pending.before)throw Error('別のタブで履歴が変更されました。ファイルを選び直してください。');
    if(!window.confirm('検証済み履歴'+pending.changes+'件を、この端末のワークスペースへ追加しますか？')){commit.disabled=false;return;}
    localStorage.setItem(key,pending.encoded);
    if(localStorage.getItem(key)!==pending.encoded)throw Error('端末への保存を確認できませんでした。');
    status('オフライン復元完了。編集履歴'+pending.changes+'件を保存しました。\n元のバックアップは消さないでください。通常のメモ画面へ戻ると同期を開始できます。');
    pending=null;
  }catch(err){
    pending=null;
    status('復元を中止しました：'+String(err.message||err)+'\n元のバックアップは保管してください。');
  }
});
