import WebSocket from 'ws';
const targets=['wss://relay.primal.net','wss://relay.ditto.pub','wss://offchain.pub','wss://nos.lol','wss://relay.damus.io'];
const probe=endpoint=>new Promise(resolve=>{
 let completed=false,opened=false;
 const settle=(kind,error='')=>{if(completed)return;completed=true;clearTimeout(timeout);try{ws.close();}catch{}resolve({endpoint,opened,kind,error});};
 const timeout=setTimeout(()=>settle('timeout'),9000);
 let ws;
 try{
   ws=new WebSocket(endpoint,{handshakeTimeout:8500});
   ws.on('open',()=>{
     opened=true;
     try{ws.send(JSON.stringify(['REQ','vctrdiag',{'kinds':[1],'limit':1}]));}
     catch(e){settle('send_error',String(e.message));}
   });
   ws.on('message',raw=>{
     let msg;try{msg=JSON.parse(raw.toString())}catch{}
     if(Array.isArray(msg))settle('protocol_message',String(msg[0]));
   });
   ws.on('error',error=>settle('socket_error',String(error.message)));
   ws.on('close',()=>settle('close'));
 }catch(e){settle('constructor_error',String(e.message))}
});
const results=await Promise.all(targets.map(probe));
console.log(JSON.stringify(results,null,2));
console.log('Open sockets:',results.filter(x=>x.opened).length+'/'+targets.length);
