import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createOwnerProbe} from '../probe-core.mjs';
const channels=[],messages=[];
function host(identity){
  return {selfAddr:identity,joinRealtimeChannel(){
    const ch={closed:false,listener:null,
      setListener(fn){this.listener=fn;},
      send(bytes){
        assert.ok(bytes instanceof Uint8Array,'WebXDC byte payload');
        messages.push(new Uint8Array(bytes));
        for(const peer of channels)if(!peer.closed&&peer.listener)
          queueMicrotask(()=>peer.listener(new Uint8Array(bytes)));
      },
      leave(){this.closed=true;}
    };
    channels.push(ch);return ch;
  }};
}
async function until(fn,ms=500){
  const limit=Date.now()+ms;
  while(!fn()&&Date.now()<limit)await new Promise(r=>setTimeout(r,5));
  assert.ok(fn(),'did not receive expected cross-client signal');
}
const statsA=[],statsB=[],statsOther=[];
const a=createOwnerProbe(host('npub-same-owner'),{cryptoApi:webcrypto,onStatus:(s,v)=>statsA.push({s,v}),intervalMs:100});
const b=createOwnerProbe(host('npub-same-owner'),{cryptoApi:webcrypto,onStatus:(s,v)=>statsB.push({s,v}),intervalMs:100});
const other=createOwnerProbe(host('npub-different-user'),{cryptoApi:webcrypto,onStatus:(s,v)=>statsOther.push({s,v}),intervalMs:100});
try{
  a.connect();other.connect();
  assert.equal(a.state.acked,0,'one live owner device must not count as success');
  a.ping();
  await new Promise(r=>setTimeout(r,20));
  assert.equal(a.state.acked,0,'other account cannot ACK owner');
  b.connect();
  a.ping();b.ping();
  await until(()=>a.state.acked>0&&b.state.acked>0);
  assert.ok(a.state.received>0&&b.state.received>0,'each owner client responds to the other');
  assert.equal(other.state.acked,0,'nonmatching account receives no accepted ACK');
  assert.equal(other.state.received,0);
  assert.notEqual(a.state.deviceId,b.state.deviceId);
  assert.ok(statsA.some(x=>x.s.includes('通信成功')));
  assert.ok(statsB.some(x=>x.s.includes('通信成功')));
  const packets=messages.map(buf=>JSON.parse(new TextDecoder().decode(buf)));
  assert.ok(packets.some(p=>p.type==='ping')&&packets.some(p=>p.type==='ack'));
  for(const p of packets){
    assert.equal(p.p,'vctrmemo-owner-realtime-diagnostic-v2');
    assert.ok(['ping','ack'].includes(p.type));
    assert.match(p.nonce,/^[a-f0-9]{24}$/);
    assert.match(p.deviceId,/^[a-f0-9]{24}$/);
    assert.equal('content' in p,false);
    assert.equal('page' in p,false);
    assert.equal('tasks' in p,false);
    assert.equal('secret' in p,false);
  }
  // Malformed traffic and loopback do not count as another verified peer.
  const count=a.state.acked;
  const original=channels[0].listener;
  original(new TextEncoder().encode('garbage'));
  original(new TextEncoder().encode(JSON.stringify({v:2,p:'vctrmemo-owner-realtime-diagnostic-v2',type:'ack',owner:a.state.owner,deviceId:a.state.deviceId,nonce:'a'.repeat(24)})));
  assert.equal(a.state.acked,count);
  a.close();b.close();other.close();
  assert.ok(channels.every(c=>c.closed));
  assert.ok(!a.state.connected);
  console.log('Vector owner auto probe: no manual key; two clients exchange synthetic ping and ACK; solo/other-user cannot count; malformed and loopback rejected PASS');
}catch(e){a.close();b.close();other.close();throw e;}
