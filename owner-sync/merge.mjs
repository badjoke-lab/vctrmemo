// Pure merge boundary: received encrypted operations cannot become arbitrary JS.
export function mergeWorkspaceOps(current,changes,Sync){
  if(!current||current.version!==2||!Array.isArray(current.ops))throw Error('Local history is unavailable');
  if(!Array.isArray(changes)||changes.length>12000)throw Error('Too many operations');
  const existing=new Map();
  for(const op of current.ops) {
    if(!Sync.isValidOp(op))throw Error('Invalid local operation');
    existing.set(op.id,JSON.stringify(op));
  }
  const accepted=[];
  for(const op of changes){
    if(!Sync.isValidOp(op))throw Error('Invalid remote operation');
    const serialized=JSON.stringify(op);
    if(existing.has(op.id)){
      if(existing.get(op.id)!==serialized)throw Error('Conflicting operation ID');
      continue;
    }
    existing.set(op.id,serialized);
    accepted.push(op);
  }
  if(!accepted.length)return {changed:false,sync:current};
  const engine=new Sync.Engine(current.ops,current.actor,current.counter);
  if(engine.merge(accepted)!==accepted.length)throw Error('Merge rejected operations');
  if(engine.missingPredecessors().length) {
    // Gaps can be transient while relay history catches up; keep operations,
    // but never claim this represents a complete synchronized workspace.
  }
  return {changed:true,sync:engine.export(),missing:engine.missingPredecessors().length};
}
export function readStorage(storage,key='vctrmemo-v2'){
  let item;
  try{item=JSON.parse(storage.getItem(key)||'null');}
  catch{throw Error('Invalid local backup. Do not overwrite it.');}
  if(!item||!item.sync||item.sync.version!==2||!Array.isArray(item.sync.ops))throw Error('Missing local workspace');
  return item;
}
