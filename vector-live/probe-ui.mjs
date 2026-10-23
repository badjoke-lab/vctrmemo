import {createOwnerProbe} from './probe-core.mjs';
// Zero-setup diagnostic: opens from an .xdc URL in Vector Notes.
// Never reads user notes, databases, local persistent data, or private keys.
const panel=document.createElement('section');
panel.id='owner-probe-v2';
panel.innerHTML=`
  <h2>Vector 2端末・自動通信診断</h2>
  <p>接続や鍵の入力は不要です。同じVectorアカウントのもう一方の端末で、Notesに送信した<strong>同じMini Appの投稿</strong>を開いてください。</p>
  <p id="owner-probe-result" role="status" aria-live="polite">自動診断を開始しています…</p>
  <p id="owner-probe-count"></p>
  <p class="footnote">これは通信経路だけの試験です。送るのはランダムなテスト信号と公開アカウント識別子だけです。メモや秘密鍵は送信しません。応答は同じアカウントの実機であることを暗号学的に証明するものではありません。</p>
`;
const style=document.createElement('style');
style.textContent=`
#owner-probe-v2{box-sizing:border-box;max-width:690px;margin:24px auto 0;background:#12251d;color:#ecf6ef;border:1px solid #668775;border-radius:16px;padding:20px;font:15px/1.55 system-ui}
#owner-probe-v2 h2{font-size:20px;margin:0 0 12px}
#owner-probe-v2 p{margin:10px 0}
#owner-probe-result{padding:12px;border:1px solid #75947f;border-radius:8px;font-weight:650;white-space:pre-wrap}
#owner-probe-v2 .footnote{font-size:12px;color:#d7c8a6}
`;
document.head.append(style);document.body.append(panel);
const result=document.getElementById('owner-probe-result');
const counter=document.getElementById('owner-probe-count');
let lastSuccess=false;
function onStatus(message,info){
  const success=info.acked>0;
  if(success)lastSuccess=true;
  // Keep the success visible while periodic pings continue.
  result.textContent=lastSuccess?'通信成功：別の実行環境から応答を受信しました。':message;
  result.style.borderColor=lastSuccess?'#65c39d':'#75947f';
  counter.textContent='送信 '+info.sent+' 回 / 応答 '+info.acked+' 回 / 受信 '+info.received+' 回';
}
try{
  const probe=createOwnerProbe(window.webxdc,{onStatus});
  probe.connect();
  window.addEventListener('pagehide',()=>probe.close(),{once:true});
}catch(error){
  result.textContent='診断を開始できません: '+String(error.message||error);
}
