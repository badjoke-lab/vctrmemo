// Vector v0.5.1 compatibility diagnostic; no personal memo data or keys.
import {createOwnerProbe} from './probe-core.mjs';

const el=(tag,id,content)=>{
  const node=document.createElement(tag);
  if(id)node.id=id;
  if(content!==undefined)node.textContent=content;
  return node;
};
const panel=el('main','vctrmemo-v051-probe');
const heading=el('h1',null,'vctrmemo / Vector v0.5.1 接続診断');
const explanation=el('p',null,'PC・スマホで、VectorのNotesに投稿した同じMini Appを開いてください。別々に投稿したアプリ同士は接続しません。');
const purpose=el('p',null,'検査するのは端末間の一時通信だけです。メモ本文・編集履歴・秘密鍵・バックアップは読み込みも送信もしません。');
const hostState=el('p','probe-host','Vector通信API：未確認');
const peerState=el('p','probe-peer','別端末との通信：未確認');
peerState.setAttribute('role','status');
peerState.setAttribute('aria-live','polite');
const counters=el('p','probe-counters','送信 0 / 応答 0 / 受信 0');
const actions=el('div','probe-actions');
const send=el('button','probe-send','診断信号を送る');
send.type='button';
const restart=el('button','probe-restart','接続をやり直す');
restart.type='button';
const copy=el('button','probe-copy','結果をコピー');
copy.type='button';
actions.append(send,restart,copy);
const report=el('textarea','probe-report','');
report.readOnly=true;
report.rows=8;
report.setAttribute('aria-label','個人情報を含まない診断結果');
const note=el('p','probe-warning','この診断で「成功」と表示されても、本人認証・暗号化バックアップ・オフライン同期ができた意味ではありません。Vector WebXDCのリアルタイム通信は永続保存されません。');
const style=el('style');
style.textContent=`
#vctrmemo-v051-probe{max-width:740px;margin:12px auto;padding:18px;border:1px solid #688875;border-radius:16px;background:#12251d;color:#edf6f0;font:15px/1.55 system-ui}
#vctrmemo-v051-probe h1{font-size:19px;line-height:1.35;margin:0 0 14px}
#vctrmemo-v051-probe p{margin:10px 0}
#probe-host,#probe-peer{padding:10px;border:1px solid #718f7a;border-radius:9px;overflow-wrap:anywhere}
#probe-peer[data-ok="1"]{border-color:#61d6a1}
#probe-actions{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}
#probe-actions button{padding:10px 12px;min-height:42px;flex:1;border:1px solid #71917d;border-radius:8px;color:#eef8f1;background:#24543e;font:inherit;cursor:pointer}
#probe-actions button:disabled{opacity:.5;cursor:default}
#probe-report{box-sizing:border-box;width:100%;border-radius:8px;background:#09170f;color:#dcebe1;border:1px solid #678a77;font:12px/1.5 monospace;padding:10px}
#probe-warning{color:#e7cba1;font-size:13px}
`;
document.head.append(style);
panel.append(heading,explanation,purpose,hostState,peerState,counters,actions,report,note);
document.body.append(panel);

let probe=null;
let completed=false;
let lastError='';
let data={connected:false,sent:0,acked:0,received:0,peers:0};
const host=window.webxdc;
const apiPresent=typeof host?.joinRealtimeChannel==='function';
const selfPresent=typeof host?.selfAddr==='string'&&host.selfAddr.trim().length>0&&host.selfAddr!=='unknown';
hostState.textContent=apiPresent&&selfPresent?
  'Vector通信API：利用可能（アカウント識別子を取得）':
  'Vector通信API：利用不可（Mini App内から開いているか確認してください）';
function reportText(){
  return [
    'vctrmemo Vector v0.5.1 connectivity check',
    'Probe: v051-20261115-v1',
    'Host API present: '+apiPresent,
    'Host identity available: '+selfPresent,
    'Channel connected: '+!!data.connected,
    'Sent: '+data.sent,
    'Acknowledged: '+data.acked,
    'Received: '+data.received,
    'Peers: '+data.peers,
    'Cross-device handshake: '+(completed?'YES':'NOT CONFIRMED'),
    'Last error: '+(lastError||'none'),
    'Content tested: random challenges only; no notes or keys'
  ].join('\n');
}
function refresh(message,stats){
  if(stats)data=stats;
  completed=completed||!!data.acked;
  if(completed)peerState.textContent='通信成功：別の実行環境と信号を往復しました。';
  else peerState.textContent='別端末との通信：'+message;
  peerState.dataset.ok=completed?'1':'0';
  counters.textContent='送信 '+data.sent+' / 応答 '+data.acked+' / 受信 '+data.received+' / 相手 '+data.peers;
  send.disabled=!data.connected;
  report.value=reportText();
}
function start(){
  completed=false;
  lastError='';
  if(probe){probe.close();probe=null;}
  try{
    probe=createOwnerProbe(host,{onStatus:refresh,intervalMs:5000});
    probe.connect();
    refresh('通信チャンネルを開きました。もう一方の端末を待っています…',probe.state);
  }catch(error){
    lastError=String(error?.message||error).slice(0,200);
    data={connected:false,sent:0,acked:0,received:0,peers:0};
    refresh('開始できません：'+lastError,data);
  }
}
send.onclick=()=>{
  try{probe?.ping();}
  catch(error){lastError=String(error?.message||error).slice(0,200);refresh('送信に失敗しました',probe?.state);}
};
restart.onclick=start;
copy.onclick=async()=>{
  try{
    await navigator.clipboard.writeText(reportText());
    copy.textContent='コピーしました';
  }catch{
    report.focus();report.select();
    copy.textContent='下の結果を手動でコピーしてください';
  }
};
window.addEventListener('pagehide',()=>{probe?.close();probe=null;},{once:true});
start();
