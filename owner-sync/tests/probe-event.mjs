import WebSocket from 'ws';
import {finalizeEvent,getPublicKey,verifyEvent} from 'nostr-tools';
import {newSecret,openWorkspace} from '../codec.mjs';
const secret=newSecret(),box=await openWorkspace(secret),pubkey=getPublicKey(box.signingKey);
const content=await box.seal({id:'a_probe_1',key:'["P","demo","title"]',pred:[],value:'synthetic-only'});
const event=finalizeEvent({kind:10312,created_at:Math.floor(Date.now()/1000),tags:[['d',box.room]],content},box.signingKey);
if(!verifyEvent(event))throw Error('Cannot verify self-signed event');
const urls=['wss://relay.primal.net','wss://relay.ditto.pub','wss://offchain.pub'];
const one=url=>new Promise(resolve=>{
 let ws,done=false;const frames=[];
 const complete=why=>{if(done)return;done=true;clearTimeout(timer);try{ws?.close()}catch{};resolve({url,why,frames})};
 const timer=setTimeout(()=>complete('timeout'),10000);
 try{
   ws=new WebSocket(url,{handshakeTimeout:8000});
   ws.on('open',()=>{
     ws.send(JSON.stringify(['REQ','diag',{kinds:[10312],authors:[pubkey],'#d':[box.room],limit:3}]));
     setTimeout(()=>{if(!done&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(['EVENT',event]));},400);
   });
   ws.on('message',m=>{
     try{
       const v=JSON.parse(m.toString());
       frames.push({type:v[0],id:v[1],ok:v[2],reason:v[3]});
       if(frames.length>8)frames.shift();
       if(v[0]==='OK'&&v[1]===event.id&&!v[2])complete('rejected');
       if(v[0]==='EVENT'&&v[2]?.id===event.id)complete('delivered');
     }catch(e){frames.push({parse:String(e)})}
   });
   ws.on('error',e=>complete('socket_error:'+e.message));
   ws.on('close',()=>complete('close'));
 }catch(e){complete('constructor_error:'+e.message)}
});
const results=await Promise.all(urls.map(one));
console.log(JSON.stringify(results,null,2));
if(results.some(r=>r.why==='delivered'))console.log('NIP-01 direct signed encrypted EVENT publish+receive SUCCESS');
else console.warn('NIP-01 direct signed encrypted EVENT not delivered by probed relays');
