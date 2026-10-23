// Encrypted owner sync over Nostr (browser only). Independent of Vector identity.
import {finalizeEvent,getPublicKey,verifyEvent} from 'nostr-tools';
import {SocketPool} from './socket-pool.mjs';
import {openWorkspace} from './codec.mjs';
export const RELAYS=['wss://relay.primal.net','wss://relay.ditto.pub','wss://offchain.pub'];
const KIND=10312; // Regular event kind, not replaceable; one encrypted change/event.
export async function ownerRelay({secret,relays=RELAYS,pool=new SocketPool(),onOperation=()=>{}}){
  const box=await openWorkspace(secret);
  const pubkey=getPublicKey(box.signingKey);
  const seenEvents=new Set();
  let subscription=null;
  let closed=false;
  const filter={kinds:[KIND],authors:[pubkey],'#d':[box.room],limit:5000};
  async function emit(payload){
    if(closed)throw Error('Transport closed');
    const ciphertext=await box.seal(payload);
    const event=finalizeEvent({kind:KIND,created_at:Math.floor(Date.now()/1000),tags:[['d',box.room]],content:ciphertext},box.signingKey);
    if(!verifyEvent(event))throw Error('Signing failed');
    const promises=pool.publish(relays,event);
    await Promise.any(Array.from(promises));
    return event.id;
  }
  const subscriptionOpts={
    onevent:async event=>{
      if(closed||seenEvents.has(event.id)||event.pubkey!==pubkey||event.kind!==KIND)return;
      if(!event.tags?.some(tag=>tag[0]==='d'&&tag[1]===box.room)||!verifyEvent(event))return;
      seenEvents.add(event.id);
      try{await onOperation(await box.unseal(event.content));}
      catch(err){console.warn('Ignored malformed encrypted owner-sync event',err);}
    }
  };
  return {
    room:box.room,
    pubkey,
    start(){
      if(closed)throw Error('Transport closed');
      if(subscription)return;
      subscription=pool.subscribeMany(relays,[filter],subscriptionOpts);
    },
    async publish(op){
      return emit(op);
    },
    async publishBatch(ops){
      if(!Array.isArray(ops)||ops.length===0||ops.length>20)throw Error('Invalid batch size (1-20)');
      return emit({batch:ops});
    },
    stop(){
      closed=true;
      try{subscription?.close();}catch{}
      pool.close(relays);
    }
  };
}
