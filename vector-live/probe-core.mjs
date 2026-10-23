// Synthetic-only auto probe for Vector WebXDC realtime (Iroh).
// NO notes, workspace history, personal sync keys, or persisted storage.
// Vector's selfAddr is a host-provided claim, NOT a cryptographic device proof.
const PROTOCOL='vctrmemo-owner-realtime-diagnostic-v2';
const ENCODER=new TextEncoder();
const DECODER=new TextDecoder();
const MAX_PACKET=1024;
const randomHex=(cryptoApi,bytes)=>Array.from(cryptoApi.getRandomValues(new Uint8Array(bytes)),x=>x.toString(16).padStart(2,'0')).join('');
const validHex=(s,len)=>typeof s==='string'&&new RegExp('^[a-f0-9]{'+len+'}$').test(s);
const isObject=x=>!!x&&typeof x==='object'&&!Array.isArray(x);

export function createOwnerProbe(host,{cryptoApi=globalThis.crypto,onStatus=()=>{},intervalMs=5000}={}){
  if(!cryptoApi||typeof cryptoApi.getRandomValues!=='function')throw Error('安全なランダム識別子を生成できません。');
  const deviceId=randomHex(cryptoApi,12);
  const owner=host?.selfAddr;
  let channel=null,interval=null,initial=null,pending=new Set(),ackPeers=new Set(),pingPeers=new Set();
  let sent=0,acked=0,received=0;
  const note=(status)=>onStatus(status,{connected:!!channel,sent,acked,received,peers:ackPeers.size,deviceId});
  const pack=(type,nonce)=>ENCODER.encode(JSON.stringify({v:2,p:PROTOCOL,type,owner,deviceId,nonce}));
  const unpack=(bytes)=>{
    const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    if(data.byteLength>MAX_PACKET||data.byteLength===0)return null;
    const msg=JSON.parse(DECODER.decode(data));
    if(!isObject(msg)||msg.v!==2||msg.p!==PROTOCOL)return null;
    if(!['ping','ack'].includes(msg.type))return null;
    if(msg.owner!==owner||msg.deviceId===deviceId||!validHex(msg.deviceId,24)||!validHex(msg.nonce,24))return null;
    return msg;
  };
  const send=(type,nonce)=>{
    if(!channel)throw Error('通信がまだ接続されていません。');
    channel.send(pack(type,nonce));
  };
  function receive(data){
    try{
      const msg=unpack(data);
      if(!msg)return;
      if(msg.type==='ping'){
        const key=msg.deviceId+':'+msg.nonce;
        if(!pingPeers.has(key)){pingPeers.add(key);received++;}
        // Only a synthetic random challenge is echoed. No user content is read.
        send('ack',msg.nonce);
        note('別の実行環境からのテスト信号を受信しました。応答を送信しました。');
      }else if(pending.has(msg.nonce)){
        pending.delete(msg.nonce);
        ackPeers.add(msg.deviceId);
        acked++;
        note('通信成功：別の実行環境から応答を受信しました。');
      }
    }catch{
      // Ignore malformed, old-version, and unrelated realtime traffic.
    }
  }
  function ping(){
    if(!channel)return;
    const nonce=randomHex(cryptoApi,12);
    pending.add(nonce);
    // Bound outstanding challenges even if no other device ever responds.
    if(pending.size>16)pending.delete(pending.values().next().value);
    sent++;
    try{send('ping',nonce);note(acked?'通信成功：別の実行環境との接続を確認しました。':'別端末からの応答を待っています…');}
    catch(e){note('再試行中：'+String(e.message||e));}
  }
  function connect(){
    if(channel)throw Error('既に通信診断を実行しています。');
    if(typeof owner!=='string'||!owner||owner==='unknown')throw Error('Vectorアカウントの識別子を取得できません。');
    if(typeof host?.joinRealtimeChannel!=='function')throw Error('このVectorにはリアルタイム通信APIがありません。');
    const ch=host.joinRealtimeChannel();
    if(!ch||typeof ch.setListener!=='function'||typeof ch.send!=='function')throw Error('Vectorの通信APIが使用できません。');
    channel=ch;
    channel.setListener(receive);
    note('自動診断を開始しました。同じNotesの投稿をもう一方の端末でも開いてください。');
    initial=setTimeout(ping,700);
    interval=setInterval(ping,intervalMs);
  }
  function close(){
    clearTimeout(initial);clearInterval(interval);initial=null;interval=null;
    try{channel?.leave?.();}catch{}
    channel=null;pending.clear();pingPeers.clear();
    note('通信診断を終了しました。');
  }
  return {
    get state(){return {connected:!!channel,sent,acked,received,peers:ackPeers.size,owner,deviceId};},
    connect,ping,close
  };
}
