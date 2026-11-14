#!/usr/bin/env node
// Audit the RELEASED Vector v0.5.1 host, not an older development commit.
// This reports compatibility blockers. It does NOT establish a live session.
const tag='v0.5.1';
const base='https://raw.githubusercontent.com/VectorPrivacy/Vector/'+tag+'/';
const paths={
  miniapps:'docs/miniapps/README.md',
  peers:'crates/vector-core/src/db/miniapps.rs',
  host:'src-tauri/src/miniapps/commands.rs',
  sdk:'crates/vector-sdk/Cargo.toml'
};
async function load(path){
  const response=await fetch(base+path,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Cannot check pinned Vector source '+path+': '+response.status);
  return response.text();
}
const sources=Object.fromEntries(await Promise.all(
  Object.entries(paths).map(async ([name,path])=>[name,await load(path)])
));
const discoveryStart=sources.peers.indexOf('pub fn get_active_peer_advertisements_in(');
const discoveryEnd=sources.peers.indexOf('pub fn peer_signal_is_current(',discoveryStart);
if(discoveryStart<0||discoveryEnd<0)throw Error('Vector v0.5.1 peer discovery source changed');
const discovery=sources.peers.slice(discoveryStart,discoveryEnd);
const hostCode=sources.host;
const sdkVersion=/^version = "([^"]+)"/m.exec(sources.sdk)?.[1];
const flags={
  realtime_api:sources.miniapps.includes('webxdc.joinRealtimeChannel()'),
  realtime_not_persistent:sources.miniapps.includes('nothing on it is stored'),
  send_update_not_shared:sources.miniapps.includes("updates aren't shared with other players yet"),
  self_npub_excluded:discovery.includes('npub != ?2'),
  peer_grouped_by_npub:discovery.includes('GROUP BY npub'),
  peer_left_grouped_by_npub:discovery.includes('l.npub = e.npub'),
  get_updates_stub:hostCode.includes('pub async fn miniapp_get_updates(') && hostCode.includes('Ok("[]".to_string())'),
  send_update_stub:hostCode.includes('TODO: Store the update and broadcast to other participants'),
  sdk_at_release_0110:sdkVersion==='0.11.0'
};
const result={
  source:'VectorPrivacy/Vector',tag,checked_files:paths,
  vector_sdk_in_tag:sdkVersion,
  capabilities:flags,
  conclusion:'vctrmemo Vector Mini App owner-to-owner synchronization is NOT verified on v0.5.1. Never infer it from a fake channel test.',
  user_data_read:false
};
console.log(JSON.stringify(result,null,2));
if(Object.values(flags).some(v=>v!==true)){
  console.error('Vector v0.5.1 host assumptions changed; re-audit before publishing diagnostic');
  process.exitCode=2;
}
