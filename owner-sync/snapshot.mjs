// Encrypted relay snapshot payloads, prior to transport encryption.
// This module NEVER handles the pairing secret or publishes to the network.
// A snapshot is a complete causal operation log, not a replacement state:
// the receiver merges it through the ordinary single-writer editor path.
//
// Public Nostr relays may prune any or all parts. A valid snapshot helps a
// new device catch up but must never be treated as a durable cloud backup.
const te=new TextEncoder(),td=new TextDecoder('utf-8',{fatal:true});
export const PART_BYTES=6000;
export const MAX_SNAPSHOT_BYTES=4*1024*1024;
export const MAX_PARTS=700;
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const digest=async bytes=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
const to64=bytes=>btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
const from64=s=>{
  if(typeof s!=='string'||s.length<1||s.length>9000||!/^[A-Za-z0-9+/]+={0,2}$/.test(s))throw Error('Invalid snapshot encoding');
  return Uint8Array.from(atob(s),x=>x.charCodeAt(0));
};
function validateHistory(ops,Sync){
  if(!Array.isArray(ops)||ops.length===0||ops.length>12000)throw Error('Invalid snapshot operation count');
  const ids=new Set();
  for(const op of ops){
    if(!Sync.isValidOp(op)||ids.has(op.id))throw Error('Invalid or duplicated snapshot operation');
    ids.add(op.id);
  }
  for(const op of ops)for(const predecessor of op.pred)if(!ids.has(predecessor))throw Error('Incomplete snapshot history');
  return ops;
}
export async function snapshotParts(sync,Sync){
  if(!sync||sync.version!==2)throw Error('Invalid workspace history');
  const ops=validateHistory(sync.ops,Sync);
  const bytes=te.encode(JSON.stringify({version:1,ops}));
  if(bytes.length>MAX_SNAPSHOT_BYTES)throw Error('Snapshot too large; export JSON locally');
  const count=Math.ceil(bytes.length/PART_BYTES);
  if(count>MAX_PARTS)throw Error('Snapshot requires too many parts');
  const id=await digest(bytes);
  const parts=[];
  for(let index=0;index<count;index++){
    const data=to64(bytes.slice(index*PART_BYTES,(index+1)*PART_BYTES));
    parts.push({type:'snapshot-part-v1',id,index,count,data});
  }
  return {id,count,bytes:bytes.length,parts};
}
export class SnapshotInbox{
  constructor(Sync,{maxPending=3}={}){
    this.Sync=Sync;
    this.maxPending=maxPending;
    this.pending=new Map();
    this.complete=new Set();
  }
  async accept(payload){
    if(payload?.type!=='snapshot-part-v1'||typeof payload.id!=='string'||!/^[0-9a-f]{64}$/.test(payload.id)
      ||!Number.isInteger(payload.index)||!Number.isInteger(payload.count)
      ||payload.count<1||payload.count>MAX_PARTS||payload.index<0||payload.index>=payload.count)return null;
    if(this.complete.has(payload.id))return null;
    let bytes;
    try{bytes=from64(payload.data);}
    catch{return null;}
    if(bytes.length<1||bytes.length>PART_BYTES)return null;
    let record=this.pending.get(payload.id);
    // A malformed/old count must not poison later valid replay of part 0.
    if(record&&record.count!==payload.count){this.pending.delete(payload.id);record=null;}
    if(!record){
      // Keep the number of incomplete snapshots bounded; newest arrives last.
      while(this.pending.size>=this.maxPending)this.pending.delete(this.pending.keys().next().value);
      record={count:payload.count,parts:new Map(),size:0};
      this.pending.set(payload.id,record);
    }
    const previous=record.parts.get(payload.index);
    if(previous){
      if(previous.length!==bytes.length||previous.some((b,i)=>b!==bytes[i]))this.pending.delete(payload.id);
      return null;
    }
    record.parts.set(payload.index,bytes);
    record.size+=bytes.length;
    if(record.size>MAX_SNAPSHOT_BYTES){this.pending.delete(payload.id);return null;}
    if(record.parts.size!==record.count)return null;
    // Remove before awaiting digest: overlapping relay callbacks cannot race
    // to apply the same completed snapshot twice.
    this.pending.delete(payload.id);
    const joined=new Uint8Array(record.size);
    let offset=0;
    for(let i=0;i<record.count;i++){
      const part=record.parts.get(i);
      if(!part)return null;
      joined.set(part,offset);offset+=part.length;
    }
    try{
      if(await digest(joined)!==payload.id)return null;
      const decoded=JSON.parse(td.decode(joined));
      if(decoded?.version!==1)return null;
      const ops=validateHistory(decoded.ops,this.Sync);
      this.complete.add(payload.id);
      while(this.complete.size>24)this.complete.delete(this.complete.values().next().value);
      return {id:payload.id,ops};
    }catch{return null;}
  }
}
