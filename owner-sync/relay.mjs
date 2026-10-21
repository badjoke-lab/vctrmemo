// Encrypted owner sync over Nostr (browser only). Independent of Vector identity.
import {SimplePool,finalizeEvent,getPublicKey,verifyEvent} from 'nostr-tools';
import {openWorkspace} from './codec.mjs';
export const RELAYS=['wss://relay.damus.io','wss://nos.lol'];
const KIND=10312; // Regular event kind, not replaceable; one encrypted change/event.
export async function ownerRelay({secret,relays=RELAYS,pool=new SimplePool(),onOperation=()=>{}}){
  const box=await openWorkspace(secret);
  const pubkey=getPublicKey(box.signingKey);
  const seenEvents=new Set();
  let subscription=null;
  let closed=false;
  const filter={kinds:[KIND],authors:[pubkey],'#d':[box.room],limit:5000};
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
      if(closed)throw Error('Transport closed');
      const ciphertext=await box.seal(op);
      const event=finalizeEvent({kind:KIND,created_at:Math.floor(Date.now()/1000),tags:[['d',box.room]],content:ciphertext},box.signingKey);
      if(!verifyEvent(event))throw Error('Signing failed');
      const promises=pool.publish(relays,event);
      await Promise.any(Array.from(promises));
      return event.id;
    },
    stop(){
      closed=true;
      try{subscription?.close();}catch{}
      pool.close(relays);
    }
  };
}
