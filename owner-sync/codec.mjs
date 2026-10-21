// Owner-only relay codec. Data keys never leave the device in plaintext.
// Experimental browser/Node module; NOT usable inside Vector's WebXDC sandbox.
const te=new TextEncoder(),td=new TextDecoder();
const MAX_BYTES=24*1024;
const domain=te.encode('vctrmemo:owner-sync:v1');
const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
const unhex=s=>new Uint8Array(s.match(/../g).map(x=>parseInt(x,16)));
const b64=b=>btoa(Array.from(b,x=>String.fromCharCode(x)).join(''));
const unb64=s=>{if(!/^[A-Za-z0-9+/]*={0,2}$/.test(s)||s.length>50000)throw Error('Bad ciphertext encoding');return Uint8Array.from(atob(s),x=>x.charCodeAt(0));};
const concat=(a,b)=>new Uint8Array([...a,...b]);
export function newSecret(){return hex(crypto.getRandomValues(new Uint8Array(32)));}
export async function openWorkspace(secret){
  if(typeof secret!=='string'||!/^[a-f0-9]{64}$/i.test(secret))throw Error('Pairing secret must be 64 hexadecimal characters');
  const raw=unhex(secret.toLowerCase());
  const material=await crypto.subtle.importKey('raw',raw,'HKDF',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'HKDF',salt:domain,info:te.encode('aes-gcm-private-ops'),hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const room='vctr-'+hex(new Uint8Array(await crypto.subtle.digest('SHA-256',concat(domain,raw)))).slice(0,32);
  const aad=te.encode('vctrmemo:owner-sync:v1:'+room);
  return {
    room,
    signingKey:raw, // Device pairing secret grants full read/write authority; protect it.
    async seal(op){
      const plaintext=te.encode(JSON.stringify({schema:1,room,op}));
      if(plaintext.length>MAX_BYTES)throw Error('Change too large for relay');
      const iv=crypto.getRandomValues(new Uint8Array(12));
      const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,plaintext));
      return JSON.stringify({v:1,iv:b64(iv),ct:b64(ciphertext)});
    },
    async unseal(content){
      if(typeof content!=='string'||content.length>50000)throw Error('Invalid encrypted event');
      const encoded=JSON.parse(content);
      if(encoded.v!==1||typeof encoded.iv!=='string'||typeof encoded.ct!=='string')throw Error('Invalid version');
      const iv=unb64(encoded.iv);
      if(iv.length!==12)throw Error('Invalid nonce');
      const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad},key,unb64(encoded.ct));
      if(plaintext.byteLength>MAX_BYTES)throw Error('Oversized change');
      const data=JSON.parse(td.decode(plaintext));
      if(data.schema!==1||data.room!==room||!data.op||typeof data.op!=='object')throw Error('Wrong workspace');
      return data.op;
    }
  };
}
