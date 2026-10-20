/* vctrmemo v0.3: size-aware, paced WebXDC operation transfer.
 * A successful sendUpdate call is NOT an acknowledgement from recipients.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VctrTransfer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KIND = 'vctrmemo-ops-v2';
  const SUMMARY = 'vctrmemo変更を共有';
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  function wrap(ops) {return {payload:{kind:KIND,ops},summary:SUMMARY};}
  function batches(ops, limit=128000) {
    if (!Array.isArray(ops)) throw Error('変更履歴が不正です。');
    if (!Number.isFinite(limit) || limit<300) throw Error('送信サイズの上限が小さすぎます。');
    const fixed = bytes(wrap([]));
    const results=[];
    let group=[], used=fixed;
    for (const op of ops) {
      const cost=bytes(op);
      if (fixed+cost>limit) throw Error('単独の変更が送信上限を超えています。文章を短く分けるか、JSONバックアップを利用してください。');
      const additional=cost+(group.length ? 1 : 0);
      if (used+additional>limit) {
        results.push(wrap(group));group=[];used=fixed;
      }
      group.push(op);used+=cost+(group.length>1 ? 1 : 0);
    }
    if (group.length) results.push(wrap(group));
    // Defense in depth: measure actual UTF-8 size of the entire sendUpdate object.
    if (results.some(b => bytes(b)>limit)) throw Error('同期データのサイズ判定に失敗しました。');
    return results;
  }
  function Sender(host, opts={}) {
    if (!host || typeof host.sendUpdate!=='function')throw Error('Vectorの送信機能がありません。');
    const delay=Number(host.sendUpdateInterval);
    const interval=Number.isFinite(delay)&&delay>=0 ? delay : 10000;
    const scheduler=opts.schedule || ((fn,ms)=>setTimeout(fn,ms));
    const cancelSchedule=opts.cancel || (id=>clearTimeout(id));
    let timer=null, active=false, done=0, total=0, stopped=false;
    const notify=(kind,error)=>opts.onStatus?.({kind,done,total,error});
    return {
      get active(){return active;},
      start(messages){
        if(active)throw Error('共有処理を実行中です。');
        if(!Array.isArray(messages)||!messages.length)throw Error('送信する変更がありません。');
        active=true;stopped=false;done=0;total=messages.length;
        const step=()=>{
          if(stopped)return;
          timer=null;
          try {host.sendUpdate(messages[done],'');done++;notify('sent');}
          catch(err){active=false;notify('failed',err);return;}
          if(done===total){active=false;notify('finished');}
          else timer=scheduler(step,interval);
        };
        step();
      },
      stop(){
        stopped=true;
        if(timer!==null)cancelSchedule(timer);
        timer=null;
        if(active){active=false;notify('stopped');}
      }
    };
  }
  return {KIND,batches,Sender,bytes};
});
