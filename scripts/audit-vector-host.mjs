#!/usr/bin/env node
// Read-only audit of Vector's Mini App host implementation.
// This NEVER sends user data and does not enable application synchronization.
'use strict';
const upstream='20efc172693c3556a7d9b61715effc306536f46a';
const base='https://raw.githubusercontent.com/VectorPrivacy/Vector/'+upstream+'/';
const paths={
  desktop:'src-tauri/src/miniapps/commands.rs',
  android:'src-tauri/src/android/miniapp_jni.rs',
  bridge:'src-tauri/src/miniapps/scheme.rs',
  docs:'docs/miniapps/README.md'
};
const read=async path=>{
  const response=await fetch(base+path,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Upstream fetch failed '+path+': '+response.status);
  return response.text();
};
function section(source,from,to){
  const a=source.indexOf(from);
  if(a<0)throw Error('Upstream section not found: '+from);
  const b=source.indexOf(to,a+from.length);
  if(b<0)throw Error('Upstream boundary not found: '+to);
  return source.slice(a,b);
}
function verify(label,condition){
  if(!condition)throw Error('Upstream implementation changed; re-audit required: '+label);
}
async function audit(){
  const [desktop,android,bridge,docs]=await Promise.all(Object.values(paths).map(read));
  const receive=section(desktop,'pub async fn miniapp_get_updates(', 'pub async fn miniapp_send_update(');
  const send=section(desktop,'pub async fn miniapp_send_update(', 'pub async fn miniapp_list_open(');
  const androidSend=section(android,'Java_io_vectorapp_miniapp_MiniAppIpc_sendUpdateNative(', 'Java_io_vectorapp_miniapp_MiniAppIpc_getUpdatesNative(');
  const androidReceive=section(android,'Java_io_vectorapp_miniapp_MiniAppIpc_getUpdatesNative(', 'Java_io_vectorapp_miniapp_MiniAppIpc_joinRealtimeChannelNative(');
  const partition=section(desktop,'async fn miniapp_storage_partition(', 'fn get_miniapp_base_url(');
  verify('desktop: returns empty stored updates',receive.includes('Ok("[]".to_string())'));
  verify('desktop: sendUpdate does not persist/broadcast',send.includes('TODO: Store the update and broadcast'));
  verify('android: update delivery not implemented',androidSend.includes('TODO: Store update and broadcast'));
  verify('android: update retrieval not implemented',androidReceive.includes('TODO: Implement actual update retrieval'));
  verify('android: returns empty updates',androidReceive.includes('env.new_string("[]")'));
  verify('unlisted apps: content hash partition',partition.includes('file_hash[..32.min(file_hash.len())]'));
  verify('marketplace IDs get special stable partition',partition.includes('Some(id) if super::marketplace::is_safe_app_id(&id)'));
  verify('Mini Apps do not have general network access',docs.includes('**No network access**'));
  verify('bridge delegates update to miniapp_send_update',bridge.includes("'miniapp_send_update'"));
  verify('bridge delegates history to miniapp_get_updates',bridge.includes("'miniapp_get_updates'"));
  const result={
    schema:1,
    upstream_repository:'VectorPrivacy/Vector',
    source_sha:upstream,
    checked_utc:new Date().toISOString(),
    results:{
      webxdc_desktop_updates:'stub',
      webxdc_android_updates:'stub',
      webxdc_chat_transport_safe_for_personal_sync:false,
      miniapp_external_http_available:false,
      standalone_miniapp_same_user_device_sync:'not_provided',
      unlisted_app_storage_partition:'xdc_content_hash',
      marketplace_app_storage_partition:'stable_marketplace_app_id_if_registered',
      automatic_personal_multi_device_sync_verified:false
    },
    decision:'BLOCK PERSONAL AUTO-SYNC: require a verified owner-only transport and a persistent app storage identity',
    source_paths:paths,
    limitations:'Static official source audit only. Vector runtime devices and relay delivery have not been tested.'
  };
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
audit().catch(e=>{console.error(e.stack||String(e));process.exitCode=2;});
