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
  // v0.9: Each new transfer is labeled for per-transfer gap diagnosis.
  // Older v0.3-v0.8 messages without metadata remain readable.
  function trackedBatches(ops,limit=128000,id,actor='') {
    if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(id))throw Error('転送IDが不正です。');
    if(actor!=='' && (typeof actor!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(actor)))throw Error('送信元IDが不正です。');
    if(!Number.isFinite(limit)||limit<600)throw Error('分割送信できない上限です。');
    // Reserve a conservative 256-byte envelope (id <= 64, part <= 12000).
    const parts=batches(ops,limit-256);
    if(parts.length>12000)throw Error('分割数が多すぎます。');
    const out=parts.map((part,index)=>({
      ...part,
      payload:{...part.payload,transfer:{id,actor,index,total:parts.length}}
    }));
    if(out.some(update=>bytes(update)>limit))throw Error('転送サイズを超えています。');
    return out;
  }
  class Tracker {
    constructor(maxTransfers=16){
      this.maxTransfers=Math.max(1,Math.min(Number(maxTransfers)||16,64));
      this.transfers=new Map();
    }
    accept(payload){
      if(!payload || payload.kind!==KIND || !Array.isArray(payload.ops))return null;
      const m=payload.transfer;
      if(m===undefined)return {legacy:true};
      if(!m || typeof m.id!=='string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(m.id) ||
         typeof m.actor!=='string'||(m.actor!==''&&!/^[a-zA-Z0-9_-]{1,64}$/.test(m.actor)) ||
         !Number.isInteger(m.index)||!Number.isInteger(m.total)||
         m.total<1||m.total>12000||m.index<0||m.index>=m.total)return {invalid:true};
      let entry=this.transfers.get(m.id);
      if(!entry){
        if(this.transfers.size>=this.maxTransfers)this.transfers.delete(this.transfers.keys().next().value);
        entry={id:m.id,actor:m.actor,total:m.total,parts:new Map()};
        this.transfers.set(m.id,entry);
      }
      if(entry.total!==m.total||entry.actor!==m.actor)return {invalid:true};
      const signature=JSON.stringify(payload.ops.map(op=>op?.id));
      const before=entry.parts.get(m.index);
      if(before!==undefined && before!==signature)return {invalid:true};
      entry.parts.set(m.index,signature);
      const received=entry.parts.size;
      if(received===entry.total && entry.actor){
        // This sender always retransmits its *whole* operation history.
        // Retire older partial transfers only when every actually observed
        // old operation ID is present in this complete newer transfer.
        const newIds=new Set([...entry.parts.values()].flatMap(v=>JSON.parse(v)));
        for(const old of [...this.transfers.values()]){
          if(old===entry||old.actor!==entry.actor||old.parts.size===old.total)continue;
          const observed=[...old.parts.values()].flatMap(v=>JSON.parse(v));
          if(observed.every(id=>newIds.has(id)))this.transfers.delete(old.id);
        }
      }
      return {id:m.id,received,total:m.total,missing:m.total-received,complete:received===m.total,duplicate:before!==undefined};
    }
    pending(){
      return [...this.transfers.values()].filter(x=>x.parts.size<x.total)
        .map(x=>({id:x.id,received:x.parts.size,total:x.total,missing:x.total-x.parts.size}));
    }
    latest(){
      const last=[...this.transfers.values()].at(-1);
      return last?{id:last.id,received:last.parts.size,total:last.total,complete:last.parts.size===last.total}:null;
    }
  }
  return {KIND,batches,trackedBatches,Tracker,Sender,bytes};
});
