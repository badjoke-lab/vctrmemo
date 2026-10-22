#!/usr/bin/env node
// Read-only audit. A successful exit means the known blockers were observed,
// NOT that same-owner Iroh sync is supported in Vector.
const sha='20efc172693c3556a7d9b61715effc306536f46a';
const base='https://raw.githubusercontent.com/VectorPrivacy/Vector/'+sha+'/';
const paths={
  notes:'src/main.js',
  peers:'src-tauri/src/db/miniapps.rs',
  signal:'src-tauri/src/commands/realtime.rs',
  host:'src-tauri/src/miniapps/commands.rs'
};
async function fetchPinned(path){
  const r=await fetch(base+path,{signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('Cannot inspect Vector pinned source: '+path+' '+r.status);
  return r.text();
}
const xs=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([key,path])=>[key,await fetchPinned(path)])));
const between=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i+a.length);if(i<0||j<0)throw Error('Vector changed: '+a);return s.slice(i,j)};
const noteFound=xs.notes.includes('Encrypted Notes to Self') && xs.notes.includes('const fNotes = strOpenChat === strPubkey');
const discovery=between(xs.peers,'pub fn get_active_peer_advertisements(', 'pub fn peer_signal_is_current(');
const excludesSelf=discovery.includes('AND npub != ?2');
const groupsByUser=discovery.includes('GROUP BY npub');
const leftByUser=discovery.includes('AND l.npub = e.npub') && discovery.includes("AND l.content = 'peer-left'");
const liveCurrency=xs.peers.slice(xs.peers.indexOf('pub fn peer_signal_is_current('));
const mergesUserDevices=liveCurrency.includes('AND npub = ?2');
const discoveryRequiresChat=xs.signal.includes('pub async fn send_webxdc_peer_advertisement(') && xs.signal.includes('PublicKey::from_bech32(receiver.as_str())');
const historyStub=xs.host.includes('pub async fn miniapp_get_updates(') && xs.host.includes('Ok("[]".to_string())');
const sendStub=xs.host.includes('TODO: Store the update and broadcast to other participants');
const result={
  schema:1,source_sha:sha,notes_to_self:noteFound,
  owner_2device_realtime_discovery:{
    excludes_own_npub:excludesSelf,
    grouped_by_npub_not_device:groupsByUser,
    peer_left_affects_same_npub:leftByUser,
    signal_currentness_by_npub:mergesUserDevices,
    peer_discovery_chat_addressed:discoveryRequiresChat
  },
  persistent_webxdc_history:{
    get_updates_stub:historyStub,
    send_update_store_broadcast_stub:sendStub
  },
  conclusions:{
    notes_to_self_exists:noteFound,
    iroh_same_identity_multi_device_robustness_verified:false,
    offline_owner_sync_implemented_by_host:false,
    miniapp_owner_2device_sync_ready:false
  },
  evidence_urls:Object.fromEntries(Object.entries(paths).map(([key,path])=>[key,'https://github.com/VectorPrivacy/Vector/blob/'+sha+'/'+path]))
};
if(!noteFound||!excludesSelf||!groupsByUser||!leftByUser||!mergesUserDevices||!discoveryRequiresChat||!historyStub||!sendStub){
  console.error('Pinned source no longer matches expected capabilities. Re-review before shipping.');
  process.exitCode=2;
}
console.log(JSON.stringify(result,null,2));
