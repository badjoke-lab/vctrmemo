// Browser-only offline recovery. Requires the original #k= private link.
// Never uploads a backup to GitHub, Vector or a Nostr relay.
// The backup contains a complete causal history (including deleted records
// and unresolved concurrent versions), encrypted independently of Nostr.
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
const FORMAT='vctrmemo-owner-encrypted-backup';
const DOMAIN='vctrmemo:portable-backup:v1';
export const MAX_PLAINTEXT=8*1024*1024;
export const MAX_FILE_BYTES=12*1024*1024;
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const bytesFromHex=str=>{
  if(typeof str!=='string'||!/^[a-f0-9]{64}$/i.test(str))throw Error('Invalid private workspace key');
  return Uint8Array.from(str.match(/../g),h=>parseInt(h,16));
};
function base64(bytes){
  let out='';
  for(let i=0;i<bytes.length;i+=32768)
    out+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(out);
}
function unbase64(value,max){
  if(typeof value!=='string'||value.length===0||value.length>Math.ceil(max*4/3)+4
     ||value.length%4===1||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw Error('Invalid encrypted backup encoding');
  const binary=atob(value);
  if(binary.length>max)throw Error('Encrypted backup is too large');
  return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
const sha256=async bytes=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
async function derive(secret){
  const raw=bytesFromHex(secret);
  const master=await crypto.subtle.importKey('raw',raw,'HKDF',false,['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'HKDF',salt:enc.encode(DOMAIN),info:enc.encode('offline-file:AES-256-GCM'),hash:'SHA-256'},
    master,{name:'AES-GCM',length:256},false,['encrypt','decrypt']
  );
}
export function validateCompleteHistory(ops,Sync){
  if(!Array.isArray(ops)||ops.length<1||ops.length>12000)
    throw Error('Invalid backup history length');
  const ids=new Set();
  for(const op of ops){
    if(!Sync.isValidOp(op)||ids.has(op.id))throw Error('Invalid or duplicate backup operation');
    ids.add(op.id);
  }
  for(const op of ops)for(const id of op.pred)
    if(!ids.has(id))throw Error('Backup is missing predecessor '+id);
  return ops;
}
export async function sealPortableBackup(sync,secret,Sync){
  if(sync?.version!==2)throw Error('Invalid backup version');
  const ops=validateCompleteHistory(sync.ops,Sync);
  const plain=enc.encode(JSON.stringify({version:1,ops}));
  if(plain.length>MAX_PLAINTEXT)throw Error('Backup exceeds 8 MiB; export JSON locally');
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await derive(secret);
  const encrypted=new Uint8Array(await crypto.subtle.encrypt(
    {name:'AES-GCM',iv,additionalData:enc.encode(DOMAIN)},key,plain
  ));
  const payload={
    format:FORMAT,version:1,algorithm:'AES-256-GCM',
    savedAt:new Date().toISOString(),operations:ops.length,
    sha256:await sha256(plain),nonce:base64(iv),ciphertext:base64(encrypted)
  };
  return JSON.stringify(payload);
}
export async function openPortableBackup(contents,secret,Sync){
  if(typeof contents!=='string'||contents.length>MAX_FILE_BYTES)
    throw Error('Invalid or oversized encrypted backup');
  let file;
  try{file=JSON.parse(contents);}catch{throw Error('Backup is not valid JSON');}
  if(file?.format!==FORMAT||file.version!==1||file.algorithm!=='AES-256-GCM'
      ||!Number.isInteger(file.operations)||file.operations<1||file.operations>12000
      ||typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256))
    throw Error('Unsupported or invalid encrypted backup');
  const iv=unbase64(file.nonce,12);
  if(iv.length!==12)throw Error('Invalid backup nonce');
  const encrypted=unbase64(file.ciphertext,MAX_PLAINTEXT+16);
  let plain;
  try{
    const key=await derive(secret);
    plain=new Uint8Array(await crypto.subtle.decrypt(
      {name:'AES-GCM',iv,additionalData:enc.encode(DOMAIN)},key,encrypted
    ));
  }catch{throw Error('復号できません。元の秘密鍵付きURLが必要です。ファイルを変更しないでください。');}
  if(plain.length>MAX_PLAINTEXT||await sha256(plain)!==file.sha256)
    throw Error('Backup integrity check failed');
  let decoded;
  try{decoded=JSON.parse(dec.decode(plain));}
  catch{throw Error('Invalid decrypted backup payload');}
  if(decoded?.version!==1||!Array.isArray(decoded.ops)||decoded.ops.length!==file.operations)
    throw Error('Backup history count mismatch');
  return {ops:validateCompleteHistory(decoded.ops,Sync),savedAt:file.savedAt};
}
// Preflight in memory. Live editor must remain the ONLY durable writer.
// Full validation occurs before dispatching one synchronous apply event.
export function preparePortableRestore(current,incoming,Sync){
  if(!current||current.version!==2)throw Error('Current workspace unavailable');
  if(!Array.isArray(current.ops)||current.ops.length>12000)
    throw Error('Current history invalid');
  validateCompleteHistory(incoming,Sync);
  const known=new Map();
  for(const op of current.ops){
    if(!Sync.isValidOp(op))throw Error('Current history contains invalid operation');
    const serialized=JSON.stringify(op);
    if(known.has(op.id)&&known.get(op.id)!==serialized)
      throw Error('Current operation ID conflict');
    known.set(op.id,serialized);
  }
  const changes=[];
  for(const op of incoming){
    const old=known.get(op.id),serialized=JSON.stringify(op);
    if(old!==undefined&&old!==serialized)throw Error('Conflicting operation ID');
    if(old===undefined){known.set(op.id,serialized);changes.push(op);}
  }
  if(known.size>12000)throw Error('History capacity exceeded; restore aborted');
  const ids=new Set(known.keys());
  for(const op of [...current.ops,...changes])for(const predecessor of op.pred)
    if(!ids.has(predecessor))throw Error('Unresolved local predecessor; restore aborted');
  // A backup from a different #k= workspace cannot be decrypted because the
  // derived AES key differs. The local actor ID and counter are never imported.
  return {changes,count:incoming.length,total:known.size};
}
