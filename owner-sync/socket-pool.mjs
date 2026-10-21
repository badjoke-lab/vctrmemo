// Minimal NIP-01 websocket transport. Successful publish requires relay OK=true.
export class SocketPool {
  constructor(WebSocketImpl=globalThis.WebSocket){
    if(!WebSocketImpl)throw Error('WebSocket unavailable');
    this.Ws=WebSocketImpl;
    this.connected=new Map();
    this.opening=new Map();
    this.subscriptions=new Map();
    this.acks=new Map();
    this.stopped=false;
  }
  async socket(url){
    if(this.stopped)throw Error('Transport closed');
    const connected=this.connected.get(url);
    if(connected&&connected.readyState===this.Ws.OPEN)return connected;
    if(this.opening.has(url))return this.opening.get(url);
    const promise=new Promise((resolve,reject)=>{
      let ws,settled=false;
      const timer=setTimeout(()=>fail(Error('WebSocket timeout '+url)),9000);
      const cleanup=()=>clearTimeout(timer);
      const fail=err=>{if(settled)return;settled=true;cleanup();try{ws?.close()}catch{};reject(err)};
      try{ws=new this.Ws(url)}catch(err){fail(err);return;}
      ws.addEventListener('open',()=>{
        if(settled)return;settled=true;cleanup();
        this.connected.set(url,ws);resolve(ws);
        for(const entry of this.subscriptions.values())if(entry.urls.has(url)){
          ws.send(JSON.stringify(['REQ',entry.id,entry.filter]));
        }
      });
      ws.addEventListener('error',()=>{if(!settled)fail(Error('WebSocket error '+url));});
      ws.addEventListener('message',msg=>{
        let frame;try{frame=JSON.parse(String(msg.data))}catch{return;}
        if(!Array.isArray(frame))return;
        if(frame[0]==='EVENT'){
          const subscription=this.subscriptions.get(frame[1]);
          if(subscription&&subscription.urls.has(url))subscription.callbacks.onevent?.(frame[2]);
        }
        if(frame[0]==='OK'){
          const byUrl=this.acks.get(url),pending=byUrl?.get(frame[1]);
          if(!pending)return;
          byUrl.delete(frame[1]);
          clearTimeout(pending.timer);
          if(frame[2]===true)pending.resolve(frame[1]);
          else pending.reject(Error('Relay rejected change: '+String(frame[3]).slice(0,120)));
        }
      });
      ws.addEventListener('close',()=>{
        if(this.connected.get(url)===ws)this.connected.delete(url);
        const waiting=this.acks.get(url);
        if(waiting){for(const a of waiting.values()){clearTimeout(a.timer);a.reject(Error('Relay disconnected'));}waiting.clear();}
        if(!settled){fail(Error('Socket closed during handshake'));return;}
        if(!this.stopped&&[...this.subscriptions.values()].some(e=>e.urls.has(url))){
          setTimeout(()=>{if(!this.stopped)this.socket(url).catch(()=>{});},2500);
        }
      });
    });
    this.opening.set(url,promise);
    try{return await promise;}finally{this.opening.delete(url);}
  }
  subscribeMany(urls,filters,callbacks){
    if(this.stopped)throw Error('Transport closed');
    if(!Array.isArray(filters)||filters.length!==1)throw Error('Exactly one filter required');
    const id='vc'+Math.random().toString(36).slice(2,14);
    const entry={id,urls:new Set(urls),filter:filters[0],callbacks};
    this.subscriptions.set(id,entry);
    for(const url of urls)this.socket(url).catch(()=>{});
    return {close:()=>{
      this.subscriptions.delete(id);
      for(const url of urls){
        const ws=this.connected.get(url);
        if(ws?.readyState===this.Ws.OPEN)ws.send(JSON.stringify(['CLOSE',id]));
      }
    }};
  }
  publish(urls,event){
    if(this.stopped)throw Error('Transport closed');
    return urls.map(async url=>{
      const ws=await this.socket(url);
      return new Promise((resolve,reject)=>{
        let byUrl=this.acks.get(url);
        if(!byUrl){byUrl=new Map();this.acks.set(url,byUrl);}
        const timer=setTimeout(()=>{byUrl.delete(event.id);reject(Error('Relay confirmation timeout '+url));},8500);
        byUrl.set(event.id,{resolve,reject,timer});
        try{ws.send(JSON.stringify(['EVENT',event]));}
        catch(err){clearTimeout(timer);byUrl.delete(event.id);reject(err);}
      });
    });
  }
  close(urls){
    this.stopped=true;
    this.subscriptions.clear();
    for(const url of urls){
      const ws=this.connected.get(url);
      try{ws?.close()}catch{}
      this.connected.delete(url);
    }
  }
}
