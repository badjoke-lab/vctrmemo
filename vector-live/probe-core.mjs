// Synthetic-only authenticated peer probe for Vector's WebXDC Iroh realtime API.
// No workspace operations or personal pages are ever transmitted.
const textEncoder=new TextEncoder();
const textDecoder=new TextDecoder();
const PREFIX='vctrmemo:vector-owner-probe:v1';
const hex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
const fromHex=s=>Uint8Array.from(s.match(/../g),x=>parseInt(x,16));
const b64=bytes=>btoa(Array.from(bytes,x=>String.fromCharCode(x)).join(''));
const fromB64=s=>Uint8Array.from(atob(s),x=>x.charCodeAt(0));
export function generateSecret(cryptoApi=globalThis.crypto){
  return hex(cryptoApi.getRandomValues(new Uint8Array(32)));
}
export async function codecFor(secret,cryptoApi=globalThis.crypto){
  if(typeof secret!=='string'||!/^[a-f0-9]{64}$/i.test(secret))throw Error('64桁の同期テスト鍵が必要です。');
  if(!cryptoApi?.subtle)throw Error('このVector環境はWeb Crypto APIに対応していません。');
  const bytes=fromHex(secret.toLowerCase());
  const material=await cryptoApi.subtle.importKey('raw',bytes,'HKDF',false,['deriveKey']);
  const key=await cryptoApi.subtle.deriveKey({
    name:'HKDF',salt:textEncoder.encode(PREFIX),info:textEncoder.encode('probe-packets'),hash:'SHA-256'
  },material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const room=hex(new Uint8Array(await cryptoApi.subtle.digest('SHA-256',bytes))).slice(0,24);
  const aad=textEncoder.encode(PREFIX+room);
  return {
    room,
    async encode(payload){
      const iv=cryptoApi.getRandomValues(new Uint8Array(12));
      const input=textEncoder.encode(JSON.stringify({v:1,room,...payload}));
      if(input.byteLength>4000)throw Error('診断メッセージが長すぎます。');
      const cipher=new Uint8Array(await cryptoApi.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,input));
      return textEncoder.encode(JSON.stringify({v:1,room,iv:b64(iv),cipher:b64(cipher)}));
    },
    async decode(bytes){
      if(!(bytes instanceof Uint8Array)||bytes.length>8000)throw Error('不正なパケットです。');
      const packet=JSON.parse(textDecoder.decode(bytes));
      if(packet.v!==1||packet.room!==room||typeof packet.iv!=='string'||typeof packet.cipher!=='string')throw Error('鍵が一致しません。');
      const iv=fromB64(packet.iv);
      if(iv.length!==12)throw Error('IVが不正です。');
      const plain=await cryptoApi.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad},key,fromB64(packet.cipher));
      const parsed=JSON.parse(textDecoder.decode(plain));
      if(parsed.v!==1||parsed.room!==room)throw Error('通信先が一致しません。');
      return parsed;
    }
  };
}
export function createOwnerProbe(host,{cryptoApi=globalThis.crypto,onStatus=()=>{}}={}){
  const deviceId=generateSecret(cryptoApi).slice(0,20);
  let channel=null,codec=null,pending=null,acked=0,received=0;
  const owner=host?.selfAddr;
  const note=s=>onStatus(s,{acked,received,deviceId});
  async function process(data){
    try{
      const packet=await codec.decode(data instanceof Uint8Array?data:new Uint8Array(data));
      if(packet.owner!==owner||packet.deviceId===deviceId||typeof packet.deviceId!=='string')return;
      if(!['ping','ack'].includes(packet.type)||typeof packet.nonce!=='string'||!/^[0-9a-f]{24}$/.test(packet.nonce))return;
      if(packet.type==='ping'){
        received++;
        channel.send(await codec.encode({type:'ack',owner,deviceId,nonce:packet.nonce}));
        note('別の実行環境からテストを受信。受信確認を返しました。');
      }else if(packet.nonce===pending){
        pending=null;acked++;
        note('別の実行環境から受信確認を取得しました（'+acked+'件）。');
      }
    }catch{
      // Wrong-key peers in the same chat receive only ciphertext; ignore.
    }
  }
  return {
    get state(){return {connected:!!channel,acked,received,owner,deviceId};},
    async connect(secret){
      if(channel)throw Error('既に接続しています。');
      if(!owner||typeof owner!=='string')throw Error('Vectorの本人識別子（selfAddr）がありません。');
      if(typeof host.joinRealtimeChannel!=='function')throw Error('Vectorにリアルタイム通信APIがありません。');
      codec=await codecFor(secret,cryptoApi);
      const candidate=host.joinRealtimeChannel();
      if(!candidate||typeof candidate.setListener!=='function'||typeof candidate.send!=='function')throw Error('通信APIの形式が未対応です。');
      channel=candidate;
      channel.setListener(process);
      note('Irohリアルタイム通信に参加しました。相手の端末でも同じMini Appとテスト鍵を開いてください。');
    },
    async ping(){
      if(!channel||!codec)throw Error('未接続です。');
      pending=hex(cryptoApi.getRandomValues(new Uint8Array(12)));
      channel.send(await codec.encode({type:'ping',owner,deviceId,nonce:pending}));
      note('暗号化したテストを送信しました。相手端末の返答を確認中です。');
      return pending;
    },
    close(){
      try{channel?.leave?.();}finally{channel=null;codec=null;pending=null;}
      note('通信テストを終了しました。');
    }
  };
}
