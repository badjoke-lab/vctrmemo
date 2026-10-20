/* vctrmemo v0.2: small offline sync prototype (MV-register per field).
 * Does NOT implement collaborative character-level CRDT editing.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VctrSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PAGE_FIELDS = ['title','icon','deleted','_pos'];
  const BLOCK_FIELDS = ['type','text','checked','deleted','_pos'];
  const TASK_FIELDS = ['title','status','priority','due','deleted','_pos'];
  const MAX_OPS = 12000;
  const encode = JSON.stringify;
  const uid = () => globalThis.crypto?.randomUUID?.() || 'a'+Date.now().toString(36)+Math.random().toString(36).slice(2);
  function hash(s, seed) { let h = seed >>> 0; for (let i=0;i<s.length;i++){h=Math.imul(h ^ s.charCodeAt(i),16777619)>>>0;}return h.toString(36); }
  function initId(key, value) { const s=key+'\u001e'+encode(value);return 'i_'+hash(s,2166136261)+'_'+hash(s,0x9e3779b1); }
  const key = (...parts) => encode(parts);
  const safeCopy = value => JSON.parse(encode(value));
  const pos = n => (n+1)*1000;
  function initializePositions(records){
    records.forEach((record,i) => {if (!Number.isFinite(record._pos)) record._pos=pos(i);});
  }
  function fillInsertedPositions(items) {
    for(let i=0;i<items.length;i++){
      if(Number.isFinite(items[i]._pos))continue;
      const before = items.slice(0,i).reverse().find(x=>Number.isFinite(x._pos));
      const after = items.slice(i+1).find(x=>Number.isFinite(x._pos));
      if(before && after) items[i]._pos = (before._pos+after._pos)/2;
      else if(before) items[i]._pos = before._pos+1000;
      else if(after) items[i]._pos = after._pos-1000;
      else items[i]._pos = pos(i);
    }
  }
  function prepare(state){
    if(!state || !Array.isArray(state.pages) || !Array.isArray(state.tasks))throw Error('データ形式が不正です');
    fillInsertedPositions(state.pages);
    fillInsertedPositions(state.tasks);
    for(const p of state.pages){if(!Array.isArray(p.blocks))p.blocks=[];fillInsertedPositions(p.blocks);}
  }
  function flatten(state){
    prepare(state);
    const fields = new Map();
    for(const p of state.pages){
      if(typeof p.id!=='string')continue;
      for(const f of PAGE_FIELDS) fields.set(key('P',p.id,f),p[f]??(f==='deleted'?false:''));
      for(const b of p.blocks)if(typeof b.id==='string'){
        for(const f of BLOCK_FIELDS) fields.set(key('B',p.id,b.id,f),b[f]??(f==='deleted'||f==='checked'?false:''));
      }
    }
    for(const t of state.tasks)if(typeof t.id==='string'){
      for(const f of TASK_FIELDS)fields.set(key('T',t.id,f),t[f]??(f==='deleted'?false:''));
    }
    return fields;
  }
  function parseKey(k){
    try{
      const p=JSON.parse(k);
      if(!Array.isArray(p)||!['P','B','T'].includes(p[0]))return null;
      const fields=p[0]==='P'?PAGE_FIELDS:p[0]==='B'?BLOCK_FIELDS:TASK_FIELDS;
      if(p.length !== (p[0]==='B'?4:3))return null;
      if(!p.slice(1,-1).every(v=>typeof v==='string' && v.length>0 && v.length<=128))return null;
      if(!fields.includes(p.at(-1)))return null;
      return p;
    }catch{return null;}
  }
  function isValidOp(op){
    if(!op || typeof op!=='object'||Array.isArray(op)||typeof op.id!=='string'||op.id.length>100||!/^[a-zA-Z0-9_-]+$/.test(op.id))return false;
    if(typeof op.key!=='string'||op.key.length>450||!parseKey(op.key))return false;
    if(!Array.isArray(op.pred)||op.pred.length>64||!op.pred.every(id=>typeof id==='string'&&id.length<=100&&/^[a-zA-Z0-9_-]+$/.test(id)))return false;
    const parts=parseKey(op.key),field=parts.at(-1),v=op.value;
    if(field==='deleted'||field==='checked')return typeof v==='boolean';
    if(field==='_pos')return typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<1e12;
    if(typeof v!=='string')return false;
    if(field==='text')return v.length<=30000;
    if(field==='title')return v.length<=400;
    if(field==='icon')return v.length<=15;
    if(field==='type')return ['text','heading','subheading','todo','quote','code'].includes(v);
    if(field==='status')return ['未着手','進行中','完了'].includes(v);
    if(field==='priority')return ['低','中','高'].includes(v);
    if(field==='due')return v===''||/^\d{4}-\d\d-\d\d$/.test(v);
    return false;
  }
  class Engine {
    constructor(ops=[],actor=uid(),counter=0){
      this.actor=actor.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,50) || uid();
      this.counter=Number.isSafeInteger(counter)&&counter>=0?counter:0;
      this.ops=new Map();
      this.add(ops);
      this.recompute();
    }
    static fromState(state){
      const engine=new Engine();
      for(const [k,v] of flatten(state)){
        const op={id:initId(k,v),key:k,pred:[],value:safeCopy(v)};
        engine.ops.set(op.id,op);
      }
      engine.recompute();
      return engine;
    }
    add(incoming){
      if(!Array.isArray(incoming))return 0;
      if(incoming.length>MAX_OPS)return 0;
      let added=0;
      for(const op of incoming){
        if(!isValidOp(op))continue;
        if(this.ops.size>=MAX_OPS)break;
        if(this.ops.has(op.id))continue;
        this.ops.set(op.id,safeCopy(op));added++;
      }
      return added;
    }
    recompute(){
      const keys=new Map();
      for(const op of this.ops.values()){
        if(!keys.has(op.key))keys.set(op.key,[]);
        keys.get(op.key).push(op);
      }
      this.heads=new Map();
      this.values=new Map();
      this.conflicts=[];
      for(const [k,ops] of keys){
        const shadowed=new Set();
        for(const op of ops)for(const id of op.pred)shadowed.add(id);
        const live=ops.filter(op=>!shadowed.has(op.id)).sort((a,b)=>a.id.localeCompare(b.id));
        if(!live.length)continue;
        this.heads.set(k,live.map(op=>op.id));
        const winning=live[live.length-1];
        this.values.set(k,safeCopy(winning.value));
        if(live.length>1 && new Set(live.map(op=>encode(op.value))).size>1){
          this.conflicts.push({key:k,parts:parseKey(k),versions:live.map(op=>({id:op.id,value:safeCopy(op.value)}))});
        }
      }
    }
    capture(state,baseline){
      const next=flatten(state),previous=flatten(baseline);
      for(const [k,v] of next){
        if(!previous.has(k)||encode(v)!==encode(previous.get(k)))this.change(k,v);
      }
      for(const [k] of previous){
        if(next.has(k))continue;
        const parts=parseKey(k);if(!parts)continue;
        if(parts.at(-1)!=='deleted'){
          const tombstone=key(...parts.slice(0,-1),'deleted');
          if(!next.has(tombstone))this.change(tombstone,true);
        }
      }
      this.recompute();
    }
    change(k,v){
      if(!isValidOp({id:'probe',key:k,pred:[],value:v}))throw Error('無効な変更');
      const pred=this.heads?.get(k)||[];
      // Local causal successor of all currently observed heads.
      const op={id:'a_'+this.actor+'_'+(++this.counter).toString(36),key:k,pred:pred.slice(0,64),value:safeCopy(v)};
      this.ops.set(op.id,op);
      // Immediately recompute to ensure consecutive changes chain correctly.
      this.recompute();
      return op;
    }
    merge(incoming){const added=this.add(incoming);if(added)this.recompute();return added;}
    resolve(k,versionId){
      const c=this.conflicts.find(c=>c.key===k),selected=c?.versions.find(v=>v.id===versionId);
      if(!selected)return false;
      this.change(k,selected.value);
      return true;
    }
    project(){
      const pages=new Map(),tasks=new Map(),blocks=new Map();
      for(const [k,v] of this.values){
        const p=parseKey(k);if(!p)continue;
        if(p[0]==='P'){
          if(!pages.has(p[1]))pages.set(p[1],{id:p[1],title:'無題',icon:'◈',deleted:false,blocks:[],_pos:0,updatedAt:1});
          pages.get(p[1])[p[2]]=v;
        }else if(p[0]==='T'){
          if(!tasks.has(p[1]))tasks.set(p[1],{id:p[1],title:'無題',status:'未着手',priority:'中',due:'',deleted:false,_pos:0,updatedAt:1});
          tasks.get(p[1])[p[2]]=v;
        }else{
          const k2=p[1]+'\u0000'+p[2];
          if(!blocks.has(k2))blocks.set(k2,{pageId:p[1],id:p[2],text:'',type:'text',checked:false,deleted:false,_pos:0});
          blocks.get(k2)[p[3]]=v;
        }
      }
      for(const b of blocks.values()){
        const page=pages.get(b.pageId);
        if(page && !b.deleted){const {pageId,...clean}=b;page.blocks.push(clean);}
      }
      const sort=(a,b)=>(a._pos||0)-(b._pos||0)||a.id.localeCompare(b.id);
      for(const p of pages.values())p.blocks.sort(sort);
      return {schema:1,pages:[...pages.values()].sort(sort),tasks:[...tasks.values()].sort(sort)};
    }
    export(){return {version:2,actor:this.actor,counter:this.counter,ops:[...this.ops.values()]};}
  }
  return {Engine,flatten,parseKey,isValidOp};
});
