import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createOwnerProbe,codecFor,generateSecret} from '../probe-core.mjs';
const random=webcrypto;
const secret=generateSecret(random);
const messages=[];
const channels=[];
function host(identity){
  return {
    selfAddr:identity,
    joinRealtimeChannel(){
      const channel={listener:null,closed:false,
        setListener(fn){this.listener=fn;},
        send(bytes){
          assert.ok(bytes instanceof Uint8Array);
          messages.push(new Uint8Array(bytes));
          for(const ch of channels)if(!ch.closed && ch.listener){
            queueMicrotask(()=>ch.listener(new Uint8Array(bytes)));
          }
        },
        leave(){this.closed=true;}
      };
      channels.push(channel);
      return channel;
    }
  };
}
const reportA=[],reportB=[];
const a=createOwnerProbe(host('npub-same-account'),{cryptoApi:random,onStatus:s=>reportA.push(s)});
const b=createOwnerProbe(host('npub-same-account'),{cryptoApi:random,onStatus:s=>reportB.push(s)});
const intruder=createOwnerProbe(host('npub-unrelated-user'),{cryptoApi:random});
await a.connect(secret);
await b.connect(secret);
await intruder.connect(secret);
await a.ping();
for(let i=0;i<70 && a.state.acked===0;i++)await new Promise(resolve=>setTimeout(resolve,10));
assert.equal(a.state.acked,1,'ack must come from different client context');
assert.equal(b.state.received,1,'same owner account gets ping');
assert.equal(intruder.state.received,0,'different selfAddr must not receive verified ping');
assert.equal(intruder.state.acked,0);
assert.equal(messages.length,2,'test consists of ping + ack only');
const ownCipher=await codecFor(secret,random);
for(const ciphertext of messages){
  const decoded=await ownCipher.decode(ciphertext);
  assert.ok(['ping','ack'].includes(decoded.type));
  assert.equal(JSON.stringify(decoded).includes('page'),false);
  assert.equal(JSON.stringify(decoded).includes('tasks'),false);
}
const notKey=await codecFor(generateSecret(random),random);
await assert.rejects(()=>notKey.decode(messages[0]),/鍵/);
const wrong=createOwnerProbe(host('npub-same-account'),{cryptoApi:random});
await wrong.connect(generateSecret(random));
await a.ping();
for(let i=0;i<40 && a.state.acked<2;i++)await new Promise(resolve=>setTimeout(resolve,10));
assert.equal(a.state.acked,2);
assert.equal(wrong.state.received,0,'client without pairing secret cannot participate');
const c=codecFor('oops',random);
await assert.rejects(c,/64桁/);
a.close();b.close();intruder.close();wrong.close();
assert.equal(channels.every(c=>c.closed),true);
console.log('Vector owner realtime MOCK: matching identity and shared secret; encrypted echo-safe ping, cross-client ACK, wrong identity/key blocked PASS');
