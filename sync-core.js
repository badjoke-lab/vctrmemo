/* vctrmemo v0.2: small offline sync prototype (MV-register per field).
 * Does NOT implement collaborative character-level CRDT editing.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VctrSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PAGE_FIELDS = ['title','icon','parentId','taskId','deleted','_pos'];
  const BLOCK_FIELDS = ['type','text','targetId','viewMode','viewLimit','checked','deleted','_pos'];
  const TASK_FIELDS = ['title','status','priority','due','dbId','deleted','_pos'];
  const COLUMN_FIELDS = ['name','type','dbId','targetDbId','sourceColumnId','sourceDbId','rollupOp','rollupFieldId','deleted','_pos'];
  const DATABASE_FIELDS = ['title','icon','deleted','_pos'];
  const DEFAULT_DATABASE_ID = 'db_default';
  const CELL_FIELDS = ['value'];
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
    if(!Array.isArray(state.dbColumns))state.dbColumns=[];
    if(!Array.isArray(state.databases))state.databases=[];
    if(!state.databases.some(d=>d.id===DEFAULT_DATABASE_ID))state.databases.unshift({id:DEFAULT_DATABASE_ID,title:'データベース',icon:'▦',deleted:false});
    fillInsertedPositions(state.databases);
    fillInsertedPositions(state.dbColumns);
    for(const c of state.dbColumns){
      if(typeof c.dbId!=='string'||!c.dbId)c.dbId=DEFAULT_DATABASE_ID;
      if(typeof c.targetDbId!=='string')c.targetDbId='';
      for(const field of ['sourceColumnId','sourceDbId','rollupOp','rollupFieldId'])if(typeof c[field]!=='string')c[field]='';
    }
    for(const t of state.tasks){
      if(!t.properties || typeof t.properties!=='object' || Array.isArray(t.properties))t.properties={};
      if(typeof t.dbId!=='string'||!t.dbId)t.dbId=DEFAULT_DATABASE_ID;
    }
    for(const p of state.pages){
      if(typeof p.taskId!=='string')p.taskId='';
      if(!Array.isArray(p.blocks))p.blocks=[];
      for(const b of p.blocks){
        if(typeof b.targetId!=='string')b.targetId='';
        if(typeof b.viewMode!=='string'||!['table','board'].includes(b.viewMode))b.viewMode='table';
        if(![0,5,10,20].includes(b.viewLimit))b.viewLimit=0;
      }
      fillInsertedPositions(p.blocks);
    }
  }
  function flatten(state){
    prepare(state);
    const fields = new Map();
    for(const d of state.databases)if(typeof d.id==='string')for(const f of DATABASE_FIELDS)fields.set(key('D',d.id,f),d[f]??(f==='deleted'?false:''));
    for(const p of state.pages){
      if(typeof p.id!=='string')continue;
      for(const f of PAGE_FIELDS) fields.set(key('P',p.id,f),p[f]??(f==='deleted'?false:''));
      for(const b of p.blocks)if(typeof b.id==='string'){
        for(const f of BLOCK_FIELDS) fields.set(key('B',p.id,b.id,f),b[f]??(f==='deleted'||f==='checked'?false:''));
      }
    }
    for(const t of state.tasks)if(typeof t.id==='string'){
      for(const f of TASK_FIELDS)fields.set(key('T',t.id,f),t[f]??(f==='deleted'?false:''));
      for(const [colId,value] of Object.entries(t.properties||{})){
        if(typeof colId==='string' && colId.length<=128)fields.set(key('V',t.id,colId,'value'),String(value??''));
      }
    }
    for(const c of state.dbColumns)if(typeof c.id==='string'){
      for(const f of COLUMN_FIELDS)fields.set(key('C',c.id,f),c[f]??(f==='deleted'?false:''));
    }
    return fields;
  }
  function parseKey(k){
    try{
      const p=JSON.parse(k);
      if(!Array.isArray(p)||!['P','B','T','C','V','D'].includes(p[0]))return null;
      const fields=({P:PAGE_FIELDS,B:BLOCK_FIELDS,T:TASK_FIELDS,C:COLUMN_FIELDS,V:CELL_FIELDS,D:DATABASE_FIELDS})[p[0]];
      if(p.length !== (['B','V'].includes(p[0])?4:3))return null;
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
    if(field==='viewLimit')return parts[0]==='B'&&[0,5,10,20].includes(v);
    if(typeof v!=='string')return false;
    if(field==='text')return v.length<=30000;
    if(field==='name')return v.length>0&&v.length<=80;
    if(['parentId','taskId','targetId','dbId','targetDbId','sourceColumnId','sourceDbId','rollupFieldId'].includes(field))return v.length<=128;
    if(field==='viewMode')return parts[0]==='B'&&['table','board'].includes(v);
    if(field==='rollupOp')return parts[0]==='C'&&['','count','sum'].includes(v);
    if(field==='value')return v.length<=500;
    if(field==='title')return v.length<=400;
    if(field==='icon')return v.length<=15;
    if(field==='type')return (parts[0]==='C'?['text','number','date','checkbox','relation','backlink','rollup']:['text','heading','subheading','todo','quote','code','link','database']).includes(v);
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
        if(parts[0]==='V'){this.change(k,'');continue;}
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
      const pages=new Map(),tasks=new Map(),blocks=new Map(),columns=new Map(),databases=new Map(),cells=[];
      for(const [k,v] of this.values){
        const p=parseKey(k);if(!p)continue;
        if(p[0]==='P'){
          if(!pages.has(p[1]))pages.set(p[1],{id:p[1],title:'無題',icon:'◈',parentId:'',taskId:'',deleted:false,blocks:[],_pos:0,updatedAt:1});
          pages.get(p[1])[p[2]]=v;
        }else if(p[0]==='T'){
          if(!tasks.has(p[1]))tasks.set(p[1],{id:p[1],title:'無題',status:'未着手',priority:'中',due:'',deleted:false,properties:{},_pos:0,updatedAt:1});
          tasks.get(p[1])[p[2]]=v;
        }else if(p[0]==='D'){
          if(!databases.has(p[1]))databases.set(p[1],{id:p[1],title:'データベース',icon:'▦',deleted:false,_pos:0});
          databases.get(p[1])[p[2]]=v;
        }else if(p[0]==='C'){
          if(!columns.has(p[1]))columns.set(p[1],{id:p[1],name:'列',type:'text',dbId:DEFAULT_DATABASE_ID,targetDbId:'',sourceColumnId:'',sourceDbId:'',rollupOp:'',rollupFieldId:'',deleted:false,_pos:0});
          columns.get(p[1])[p[2]]=v;
        }else if(p[0]==='V'){
          cells.push({taskId:p[1],columnId:p[2],value:v});
        }else{
          const k2=p[1]+'\u0000'+p[2];
          if(!blocks.has(k2))blocks.set(k2,{pageId:p[1],id:p[2],text:'',targetId:'',viewMode:'table',viewLimit:0,type:'text',checked:false,deleted:false,_pos:0});
          blocks.get(k2)[p[3]]=v;
        }
      }
      for(const {taskId,columnId,value} of cells){
        if(tasks.has(taskId))tasks.get(taskId).properties[columnId]=value;
      }
      for(const b of blocks.values()){
        const page=pages.get(b.pageId);
        if(page && !b.deleted){const {pageId,...clean}=b;page.blocks.push(clean);}
      }
      if(!databases.has(DEFAULT_DATABASE_ID))databases.set(DEFAULT_DATABASE_ID,{id:DEFAULT_DATABASE_ID,title:'データベース',icon:'▦',deleted:false,_pos:0});
      for(const t of tasks.values())if(!t.dbId)t.dbId=DEFAULT_DATABASE_ID;
      for(const c of columns.values())if(!c.dbId)c.dbId=DEFAULT_DATABASE_ID;
      const sort=(a,b)=>(a._pos||0)-(b._pos||0)||a.id.localeCompare(b.id);
      for(const p of pages.values())p.blocks.sort(sort);
      return {schema:1,pages:[...pages.values()].sort(sort),tasks:[...tasks.values()].sort(sort),dbColumns:[...columns.values()].sort(sort),databases:[...databases.values()].sort(sort)};
    }
    missingPredecessors(){
      const missing=new Set();
      for(const op of this.ops.values())for(const id of op.pred||[]){
        if(!this.ops.has(id))missing.add(id);
      }
      return [...missing].sort();
    }
    export(){return {version:2,actor:this.actor,counter:this.counter,ops:[...this.ops.values()]};}
  }
  // Computed backlinks never copy or mutate source cells; they derive from the
  // original relation's single target ID and remain stable across sync merges.
  function backlinksFor(state,targetId,sourceColumnId=''){
    const target=(state.tasks||[]).find(t=>t.id===targetId && !t.deleted);
    if(!target)return [];
    const dbId=target.dbId||DEFAULT_DATABASE_ID;
    const cols=(state.dbColumns||[]).filter(c=>!c.deleted && c.type==='relation' && c.targetDbId===dbId && (!sourceColumnId||c.id===sourceColumnId));
    const out=[];
    for(const col of cols){
      for(const source of state.tasks||[]){
        if(source.deleted || (source.dbId||DEFAULT_DATABASE_ID)!==(col.dbId||DEFAULT_DATABASE_ID))continue;
        if(source.properties?.[col.id]===targetId)out.push({task:source,column:col});
      }
    }
    return out;
  }
  function rollupFor(state,targetId,col){
    if(!col || col.type!=='rollup')return null;
    const source=(state.dbColumns||[]).find(c=>c.id===col.sourceColumnId && !c.deleted && c.type==='relation');
    const target=(state.tasks||[]).find(t=>t.id===targetId && !t.deleted);
    if(!source || !target || source.targetDbId!==(target.dbId||DEFAULT_DATABASE_ID))return null;
    const links=backlinksFor(state,targetId,source.id);
    if(col.rollupOp==='count')return links.length;
    if(col.rollupOp!=='sum')return null;
    const metric=(state.dbColumns||[]).find(c=>c.id===col.rollupFieldId && !c.deleted && c.type==='number' && (c.dbId||DEFAULT_DATABASE_ID)===(source.dbId||DEFAULT_DATABASE_ID));
    if(!metric)return null;
    return links.reduce((sum,entry)=>{
      const raw=entry.task.properties?.[metric.id];
      if(raw===undefined||raw===null||raw==='')return sum;
      const n=Number(raw);
      return Number.isFinite(n)?sum+n:sum;
    },0);
  }
  return {Engine,flatten,parseKey,isValidOp,DEFAULT_DATABASE_ID,backlinksFor,rollupFor};
});
