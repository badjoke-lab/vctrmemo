// Live relay smoke test: publishes one synthetic, encrypted operation.
// No user content, passwords or Vector keys are used.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {SocketPool} from '../socket-pool.mjs';
import {newSecret} from '../codec.mjs';
import {ownerRelay,RELAYS} from '../relay.mjs';
const secret=newSecret();
let done,fail;
const received=new Promise((resolve,reject)=>{done=resolve;fail=reject});
const subject={id:'a_live_sync_'+Date.now().toString(36),key:JSON.stringify(['P','demo','title']),pred:[],value:'synthetic-ci-only'};
const sender=await ownerRelay({secret,relays:RELAYS,pool:new SocketPool(WebSocket)});
const receiver=await ownerRelay({secret,relays:RELAYS,pool:new SocketPool(WebSocket),onOperation:op=>{
  if(op.id===subject.id)done(op);
}});
let outcome;
try{
  receiver.start();
  await new Promise(r=>setTimeout(r,2000));
  outcome=await Promise.race([
    (async()=>{await sender.publish(subject);return received;})(),
    new Promise((_,reject)=>setTimeout(()=>reject(Error('Live relay smoke test timed out')),20000))
  ]);
  assert.deepEqual(outcome,subject);
  console.log('owner sync LIVE relay: encrypted event transmitted and decrypted by second independent client PASS');
}finally{sender.stop();receiver.stop();}
