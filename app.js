(() => {
  'use strict';
  // Move existing local notes to the new product key without deleting the old copy.
  const STORAGE_KEY = 'vctrmemo-v2'; // Keep v0.2 local data compatible.
  const V1_STORAGE_KEY = 'vctrmemo-v1';
  const LEGACY_STORAGE_KEY = 'vector-workspace-prototype-v1';
  const STATUS = ['未着手','進行中','完了'];
  const PRIORITY = ['低','中','高'];
  const ICONS = ['◈','▦','✦','▤','◎','⬡'];
  const $ = (id) => document.getElementById(id);
  const uid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id-'+Date.now()+'-'+Math.random().toString(36).slice(2));
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stamp = () => Date.now();
  const makeBlock = (type='text', text='') => ({id:uid(), type, text, targetId:'', viewMode:'table', viewLimit:0, checked:false});
  const defaults = () => ({
    schema:1,
    pages:[
      {id:'welcome',title:'はじめに',icon:'✦',updatedAt:1,deleted:false,blocks:[
        {id:'w1',type:'heading',text:'自分の情報は、自分の手元に。',checked:false},
        {id:'w2',type:'text',text:'vctrmemo は、ページやタスクを端末内で管理できるメモアプリの試作品です。v0.9 では、Vectorで共有した分割履歴の受信状況と不足を確認できます。',checked:false},
        {id:'w3',type:'subheading',text:'できること',checked:false},
        {id:'w4',type:'todo',text:'ページを新規作成・編集する',checked:false},
        {id:'w5',type:'todo',text:'タスクをテーブル・カンバンで管理する',checked:false},
        {id:'w6',type:'todo',text:'JSON形式でエクスポートしバックアップする',checked:false},
        {id:'w7',type:'quote',text:'実験段階です。端末内の保存データは暗号化されていません。機密情報の保存には使わないでください。',checked:false}]},
      {id:'notes',title:'アイデアノート',icon:'◈',updatedAt:1,deleted:false,blocks:[
        {id:'n1',type:'heading',text:'つくりたいもの',checked:false},
        {id:'n2',type:'text',text:'ここから新しいプロジェクトを始めましょう。',checked:false}]},
      {id:'meeting',title:'ミーティングメモ',icon:'▤',updatedAt:1,deleted:false,blocks:[
        {id:'m1',type:'subheading',text:'議題',checked:false},
        {id:'m2',type:'todo',text:'目的と次のアクションを決める',checked:false}]}
    ],
    databases:[{id:'db_default',title:'データベース',icon:'▦',updatedAt:1,deleted:false}],
    dbColumns:[],
    tasks:[
      {id:'task-1',title:'ページとデータベースの設計',status:'完了',priority:'高',due:'',updatedAt:1,deleted:false},
      {id:'task-2',title:'WebXDCでの動作検証',status:'進行中',priority:'高',due:'',updatedAt:1,deleted:false},
      {id:'task-3',title:'共同編集エンジンを選定',status:'未着手',priority:'中',due:'',updatedAt:1,deleted:false},
      {id:'task-4',title:'バックアップの復元検証',status:'未着手',priority:'中',due:'',updatedAt:1,deleted:false}
    ]
  });
  const validate = (value) => value && value.schema === 1 && Array.isArray(value.pages) && Array.isArray(value.tasks) && value.pages.every(p=>p&&typeof p.id==='string'&&Array.isArray(p.blocks)) && value.tasks.every(t=>t&&typeof t.id==='string');
  let state, engine;
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if(stored?.sync?.version===2 && Array.isArray(stored.sync.ops)) {
      engine = new VctrSync.Engine(stored.sync.ops, stored.sync.actor, stored.sync.counter);
      state = engine.project();
    } else {
      let older = null;
      try { older = JSON.parse(localStorage.getItem(V1_STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)); }catch{}
      state = validate(older) ? older : defaults();
      engine = VctrSync.Engine.fromState(state);
    }
  }catch(err){console.error('vctrmemo storage issue',err);state=defaults();engine=VctrSync.Engine.fromState(state);}
  let baseline = structuredClone(state);
  let incomingQueue = [];
  const transferTracker=new VctrTransfer.Tracker();
  let replayFinished=false;
  let view = 'home';
  let dbMode = 'table';
  let filterField = 'all', filterQuery = '', sortField = 'none', sortDirection = 'asc';
  let pickerFor = null;
  let toastTimer;
  const livePages = () => state.pages.filter(p => !p.deleted && !p.taskId);
  const DEFAULT_DB = VctrSync.DEFAULT_DATABASE_ID || 'db_default';
  const liveDatabases = () => (state.databases||[]).filter(d=>!d.deleted);
  const getDatabase = id => liveDatabases().find(d=>d.id===id);
  const archivedDatabases = () => (state.databases||[]).filter(d=>d.deleted && d.id!==DEFAULT_DB);
  const liveTasks = (dbId) => state.tasks.filter(t => !t.deleted && (!dbId || (t.dbId||DEFAULT_DB)===dbId));
  const liveColumns = (dbId) => (state.dbColumns||[]).filter(c=>!c.deleted && (!dbId || (c.dbId||DEFAULT_DB)===dbId));
  const customValue = (t,id) => String(t.properties?.[id]??'');
  const taskValue = (t,id) => id.startsWith('custom:')?customValue(t,id.slice(7)):String(t[id]??'');
  function visibleTasks(dbId){
    let tasks=liveTasks(dbId);const q=filterQuery.trim().toLocaleLowerCase();
    const validFields=new Set(fieldOptions(true,dbId).map(([field])=>field));
    const selectedFilter=validFields.has(filterField)?filterField:'all';
    const selectedSort=sortField==='none'||validFields.has(sortField)?sortField:'none';
    if(q)tasks=tasks.filter(t=>{
      if(selectedFilter==='all')return [t.title,t.status,t.priority,t.due,...liveColumns(dbId).map(c=>customValue(t,c.id))].some(v=>String(v).toLocaleLowerCase().includes(q));
      return taskValue(t,selectedFilter).toLocaleLowerCase().includes(q);
    });
    if(selectedSort!=='none')tasks=[...tasks].sort((a,b)=>{
      const col=liveColumns(dbId).find(c=>selectedSort==='custom:'+c.id);
      const va=taskValue(a,selectedSort),vb=taskValue(b,selectedSort);
      const cmp=col?.type==='number'?((Number(va)||0)-(Number(vb)||0)):va.localeCompare(vb,'ja',{numeric:true});
      return (sortDirection==='desc'?-1:1)*cmp;
    });
    return tasks;
  }
  const getPage = id => state.pages.find(p=>p.id===id && !p.deleted);
  const getTaskFromView = id => typeof id==='string' && id.startsWith('task:') ? getTask(id.slice(5)) : null;
  const getTask = id => state.tasks.find(t=>t.id===id && !t.deleted);
  function toast(message) { const node=$('toast');node.textContent=message;node.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('show'),3300); }
  function persist(remote=false) {
    try {
      if(!remote)engine.capture(state,baseline);
      baseline=structuredClone(state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({sync:engine.export()}));
      $('save-state').textContent='● 端末保存済み';
      updateConflictButton();
      updateSyncState();
    } catch(e) { $('save-state').textContent='● 保存エラー';toast('端末への保存に失敗しました。JSONを書き出してください。'); console.error(e); }
  }
  function updateSyncState(){
    const node=$('sync-state');if(!node)return;
    const missing=engine.missingPredecessors().length;
    const pending=transferTracker.pending();
    const latest=transferTracker.latest();
    if(missing){
      node.textContent='⚠ 履歴不足 '+missing;
      node.title='この端末の履歴に参照先が届いていない変更があります。送信元で変更を再共有してください。';
      return;
    }
    if(pending.length){
      const lost=pending.reduce((n,t)=>n+t.missing,0);
      node.textContent='⚠ 未受信 '+lost+'分割';
      node.title='この端末では分割メッセージの一部が未受信です。送信元に「変更を共有」を再実行してもらってください。';
      return;
    }
    if(latest?.complete){
      node.textContent='● この端末で分割受信完了';
      node.title='この端末が認識した直近転送の全分割を取得しました。他の端末への到達確認ではありません。';
    }else if(window.webxdc?.setUpdateListener){
      node.textContent=replayFinished?'● Vector受信待機':'○ Vector履歴を読込中';
      node.title='履歴の再生状況です。通信到達・暗号化保存の保証ではありません。';
    }else{
      node.textContent='○ Web版（共有なし）';
      node.title='ブラウザ版ではVectorの送受信を利用できません。';
    }
  }
  function updateConflictButton(){
    const node=$('show-conflicts');
    if(!node)return;
    node.hidden=engine.conflicts.length===0;
    node.textContent='⚠ 競合 '+engine.conflicts.length+' 件';
  }
  function showConflicts(){
    const dialog=$('conflict-backdrop');
    const content=$('conflict-list');
    content.replaceChildren();
    engine.conflicts.forEach(c=>{
      const wrap=document.createElement('section');wrap.className='conflict-item';
      const heading=document.createElement('h3');
      const kind=({B:'ブロック',P:'ページ',T:'タスク',C:'追加列',V:'セル'})[c.parts[0]]||'項目';
      heading.textContent=kind+' '+c.parts.slice(1,-1).join(' / ')+' / '+c.parts.at(-1);
      const help=document.createElement('p');help.textContent='別々に変更された内容です。残す内容を選ぶと、他の候補は履歴に残ります。';
      wrap.append(heading,help);
      c.versions.forEach(v=>{
        const btn=button('', 'conflict-choice',()=>{
          if(!confirm('選択した内容を採用して競合を解消しますか？'))return;
          engine.resolve(c.key,v.id);
          state=engine.project();baseline=structuredClone(state);persist(true);render();showConflicts();
          toast('競合を解消しました。同期を送信すると他の参加者にも反映されます。');
        });
        const val=document.createElement('pre');
        val.textContent=typeof v.value==='string'?v.value:JSON.stringify(v.value);
        btn.append(val);wrap.append(btn);
      });
      content.append(wrap);
    });
    if(!engine.conflicts.length){const p=document.createElement('p');p.textContent='現在、競合はありません。';content.append(p);}
    dialog.classList.remove('hidden');
  }
  function isEditing(){
    const a=document.activeElement;
    return !!a && (a.isContentEditable || (a.tagName==='INPUT' && a.id!=='search-input') || a.tagName==='TEXTAREA');
  }
  function flushIncoming(){
    if(!incomingQueue.length || isEditing())return;
    const list=incomingQueue;incomingQueue=[];
    let added=0;
    for(const ops of list)added+=engine.merge(ops);
    if(added){state=engine.project();baseline=structuredClone(state);persist(true);render();toast('共有された変更を取り込みました。');}
    updateSyncState();
  }
  document.addEventListener('focusout',()=>setTimeout(flushIncoming,0));
  function touchPage(p) { p.updatedAt=stamp();persist(); }
  function touchTask(t) { t.updatedAt=stamp();persist(); }
  const button = (label, cls, onClick, title) => {const el=document.createElement('button');el.type='button';el.textContent=label;el.className=cls||'';if(title)el.title=title;el.addEventListener('click',onClick);return el;};
  function setView(next){ view=next; pickerFor=null;render();closeSidebar(); }
  function createDatabase(){
    const input=prompt('データベースの名前（最大80文字）','新しいデータベース');
    if(!input?.trim())return;
    const db={id:uid(),title:input.trim().slice(0,80),icon:'▦',deleted:false,updatedAt:stamp()};
    state.databases.push(db);persist();setView('db:'+db.id);
  }
  function pageTree(){
    const pages=livePages(), ids=new Set(pages.map(p=>p.id)), byParent=new Map();
    pages.forEach(p=>{const parent=p.parentId!==p.id&&ids.has(p.parentId)?p.parentId:'';
      if(!byParent.has(parent))byParent.set(parent,[]);
      byParent.get(parent).push(p);
    });
    const out=[],visited=new Set();
    function walk(parent,depth){
      for(const p of byParent.get(parent)||[]){
        if(visited.has(p.id))continue;
        visited.add(p.id);out.push({page:p,depth});walk(p.id,depth+1);
      }
    }
    walk('',0);
    // A remote update could create an invalid parent cycle: keep those pages visible.
    pages.forEach(p=>{if(!visited.has(p.id)){visited.add(p.id);out.push({page:p,depth:0});}});
    return out;
  }
  function descendants(id){
    const found=new Set([id]);let changed=true;
    while(changed){changed=false;livePages().forEach(p=>{if(!found.has(p.id)&&found.has(p.parentId)){found.add(p.id);changed=true;}});}
    return found;
  }
  function renderSidebar() {
    const nav=$('pages-list');nav.replaceChildren();
    nav.appendChild(navButton('home','⌂','Overview','概要'));
    const dbSection=document.createElement('div');dbSection.className='sidebar-section-label';dbSection.textContent='DATABASES';
    dbSection.append(button('＋','plus',createDatabase,'データベースを追加'));nav.appendChild(dbSection);
    liveDatabases().forEach(db=>nav.appendChild(navButton('db:'+db.id,db.icon||'▦',db.title,String(liveTasks(db.id).length))));
    if(archivedDatabases().length){
      const archived=document.createElement('div');archived.className='sidebar-section-label';archived.textContent='ARCHIVED DATABASES';
      nav.appendChild(archived);
      for(const db of archivedDatabases()){
        const holder=document.createElement('div');holder.className='archived-db-entry';
        const name=document.createElement('span');name.textContent=db.title;
        const restore=button('復元','subtle-button',()=>{
          db.deleted=false;persist();render();toast('データベースを復元しました。');
        },'データを残したまま復元');
        holder.append(name,restore);nav.appendChild(holder);
      }
    }
    const label=document.createElement('div');label.className='sidebar-section-label';label.style.paddingTop='16px';label.textContent='PAGES';nav.appendChild(label);
    pageTree().forEach(({page,depth})=>{const item=navButton(page.id,page.icon,page.title,'');
      item.classList.add('tree-item');item.style.paddingLeft=(12+Math.min(depth,8)*15)+'px';
      item.dataset.depth=String(depth);nav.appendChild(item);
    });
  }
  function navButton(id,icon,name,meta) {
    const task=getTaskFromView(view);
    const active=view===id || (id==='db:'+DEFAULT_DB && view==='tasks') || (task && id==='db:'+(task.dbId||DEFAULT_DB));
    const b=button('','page-link'+(active?' active':''),()=>setView(id));
    const i=document.createElement('span');i.className='page-icon';i.textContent=icon;
    const t=document.createElement('span');t.className='page-name';t.textContent=name;
    b.append(i,t);
    if(meta){const c=document.createElement('small');c.textContent=meta;b.append(c);}
    return b;
  }
  const intro = (label,title,desc) => `<div class="eyebrow">${escapeHtml(label)}</div><h1 class="hero-title">${escapeHtml(title)}</h1><p class="hero-desc">${escapeHtml(desc)}</p>`;
  function renderHome(root){
    root.innerHTML=intro('LOCAL-FIRST NOTES','考える。つくる。共有する。','ページ、データベース、タスクをひとつの場所に。端末内に保存する、シンプルなメモアプリの試作品です。');
    const metrics=document.createElement('section');metrics.className='metric-strip';metrics.innerHTML=`<div class="metric"><b>${livePages().length}</b><span>ページ</span></div><div class="metric"><b>${liveTasks().length}</b><span>タスク</span></div><div class="metric"><b>${liveTasks().filter(t=>t.status==='完了').length}</b><span>完了</span></div>`;root.append(metrics);
    const heading=document.createElement('div');heading.className='section-top';heading.innerHTML='<h2>ページ</h2>';heading.append(button('＋ 新しいページ','primary-button',createPage));root.append(heading);
    const cards=document.createElement('div');cards.className='cards';
    livePages().forEach(p=>{const card=button('','page-card',()=>setView(p.id));card.innerHTML=`<span class="card-icon">${escapeHtml(p.icon)}</span><span class="card-title">${escapeHtml(p.title||'無題')}</span><span class="card-detail">${p.blocks.length} ブロック · クリックして開く</span>`;cards.append(card);});root.append(cards);
    const tasksHead=document.createElement('div');tasksHead.className='section-top';tasksHead.innerHTML='<h2>作業の状況</h2>';tasksHead.append(button('データベースを開く →','subtle-button',()=>setView('tasks')));root.append(tasksHead);
    const stat=document.createElement('div');stat.className='info-note';stat.textContent=`進行中 ${liveTasks().filter(t=>t.status==='進行中').length} 件 ／ 未着手 ${liveTasks().filter(t=>t.status==='未着手').length} 件。ページもタスクも端末内に保存されます。`;root.append(stat);
  }
  function createPage(parentId=''){if(typeof parentId!=='string')parentId='';const p={id:uid(),title:'無題',parentId:'',icon:ICONS[Math.floor(Math.random()*ICONS.length)],updatedAt:stamp(),deleted:false,blocks:[makeBlock('text','')]};p.parentId=typeof parentId==='string'?parentId:'';state.pages.push(p);persist();setView(p.id);const input=$('doc-title');if(input){input.focus();input.select();}}
  function renderDoc(root,page) {
    const header=document.createElement('div');header.className='eyebrow';header.textContent='PAGE / DOCUMENT';root.append(header);
    const path=document.createElement('div');path.className='page-parent-path';
    let parent=getPage(page.parentId),guard=new Set([page.id]);
    const chain=[];
    while(parent&&!guard.has(parent.id)){chain.unshift(parent);guard.add(parent.id);parent=getPage(parent.parentId);}
    for(const entry of chain){path.append(button(entry.title+' /','subtle-button',()=>setView(entry.id)));}
    root.append(path);
    const top=document.createElement('div');top.className='doc-header';
    const title=document.createElement('input');title.id='doc-title';title.className='doc-title';title.value=page.title;title.placeholder='ページのタイトル';title.setAttribute('aria-label','ページのタイトル');
    title.addEventListener('input',()=>{page.title=title.value.slice(0,200);touchPage(page);$('crumb-page').textContent=page.title||'無題';const link=[...$('pages-list').querySelectorAll('button')].find(b=>b.classList.contains('active'));if(link){link.querySelector('.page-name').textContent=page.title||'無題';}});
    const actions=document.createElement('div');actions.className='doc-actions';actions.append(button('複製','subtle-button',()=>{const p={...structuredClone(page),id:uid(),title:page.title+' のコピー',updatedAt:stamp(),blocks:page.blocks.map(b=>({...b,id:uid()}))};state.pages.push(p);persist();setView(p.id);}));actions.append(button('＋ 子ページ','subtle-button',()=>createPage(page.id)));
    const parentSelect=document.createElement('select');parentSelect.id='parent-select';parentSelect.className='task-select';
    const opts=[{id:'',title:'最上位へ移動'},...livePages().filter(p=>!descendants(page.id).has(p.id))];
    for(const opt of opts){const o=document.createElement('option');o.value=opt.id;o.textContent=opt.title;parentSelect.append(o);}
    parentSelect.value=page.parentId||'';
    parentSelect.setAttribute('aria-label','親ページ');
    parentSelect.addEventListener('change',()=>{page.parentId=parentSelect.value;touchPage(page);render();});
    actions.append(parentSelect);
    actions.append(button('削除' ,'subtle-button danger',()=>{if(!confirm('このページを削除しますか？ JSONバックアップがない場合、復元できません。'))return;page.deleted=true;touchPage(page);setView('home');}));top.append(title,actions);root.append(top);
    const backlinks=livePages().filter(p=>p.id!==page.id && p.blocks.some(b=>b.type==='link'&&b.targetId===page.id));
    if(backlinks.length){const related=document.createElement('div');related.className='backlinks';related.append(document.createTextNode('このページへのリンク: '));for(const p of backlinks)related.append(button(p.title||'無題','subtle-button',()=>setView(p.id)));root.append(related);}
    const hint=document.createElement('p');hint.className='doc-hint';hint.textContent='入力は自動保存されます。Enterで新しいブロック、Shift+Enterで改行。';root.append(hint);
    const editor=document.createElement('div');editor.className='editor';editor.id='editor';root.append(editor);
    renderBlocks(editor,page);
  }
  function renderBlocks(editor,page) {
    editor.replaceChildren();
    page.blocks.forEach((block,i)=>{
      const row=document.createElement('div');row.className='block-row';row.dataset.blockId=block.id;
      const tools=document.createElement('div');tools.className='block-tools';
      tools.append(button('＋','small-icon',()=>{pickerFor=pickerFor===block.id?null:block.id;renderBlocks(editor,page);},'この下にブロックを挿入'));
      tools.append(button('×','small-icon',()=>{page.blocks.splice(i,1);touchPage(page);renderBlocks(editor,page);},'ブロックを削除'));
      row.append(tools);
      if(block.type==='link'){
        const controls=document.createElement('div');controls.className='page-link-block';
        const picker=document.createElement('select');picker.className='task-select';picker.setAttribute('aria-label','リンク先ページ');
        const empty=document.createElement('option');empty.value='';empty.textContent='リンク先を選択';picker.append(empty);
        for(const dest of livePages()){const option=document.createElement('option');option.value=dest.id;option.textContent=dest.title||'無題';picker.append(option);}
        if(block.targetId && !getPage(block.targetId)){const missing=document.createElement('option');missing.value=block.targetId;missing.textContent='削除済みまたは不明なページ';picker.append(missing);}
        picker.value=block.targetId||'';
        picker.addEventListener('change',()=>{block.targetId=picker.value;touchPage(page);renderBlocks(editor,page);});
        controls.append(picker);
        const dest=getPage(block.targetId);
        controls.append(button(dest?'↗ '+(dest.title||'無題'):'リンク先なし','page-link-open',()=>{if(dest)setView(dest.id);},'ページを開く'));
        row.append(controls);editor.append(row);
        if(pickerFor===block.id)editor.append(blockPicker(editor,page,i+1));
        return;
      }
      if(block.type==='database'){
        row.classList.add('database-block-row');
        const controls=document.createElement('div');controls.className='database-embed-controls';
        const picker=document.createElement('select');picker.className='task-select';picker.setAttribute('aria-label','埋め込みデータベース');
        const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='データベースを選択';picker.append(placeholder);
        for(const db of liveDatabases()){const option=document.createElement('option');option.value=db.id;option.textContent=db.title;picker.append(option);}
        if(block.targetId&&!getDatabase(block.targetId)){const missing=document.createElement('option');missing.value=block.targetId;missing.textContent='削除済みのデータベース';picker.append(missing);}
        picker.value=block.targetId||'';
        picker.addEventListener('change',()=>{block.targetId=picker.value;touchPage(page);renderBlocks(editor,page);});
        controls.append(picker);row.append(controls);
        const db=getDatabase(block.targetId);
        if(db){
          const controlsView=document.createElement('div');controlsView.className='embed-view-settings';
          const mode=fieldSelector(block.viewMode||'table',[['table','テーブル'],['board','カンバン']],value=>{
            block.viewMode=value;touchPage(page);renderBlocks(editor,page);
          });
          mode.setAttribute('aria-label','埋め込み表示形式');
          const limit=fieldSelector(String(block.viewLimit||0),[['0','すべて'],['5','5件'],['10','10件'],['20','20件']],value=>{
            block.viewLimit=Number(value);touchPage(page);renderBlocks(editor,page);
          });
          limit.setAttribute('aria-label','埋め込み表示件数');
          controlsView.append(mode,limit);controls.append(controlsView);
          const embed=document.createElement('div');
          renderTasks(embed,db,true,block,page);
          row.append(embed);
        }else{
          const missing=document.createElement('p');missing.className='doc-hint';
          missing.textContent=block.targetId?'リンク先のデータベースが見つかりません。':'埋め込むデータベースを選んでください。';
          row.append(missing);
        }
        editor.append(row);
        if(pickerFor===block.id)editor.append(blockPicker(editor,page,i+1));
        return;
      }
      if(block.type==='todo'){
        const check=document.createElement('input');check.type='checkbox';check.className='todo-check';check.checked=!!block.checked;check.setAttribute('aria-label','チェック');check.addEventListener('change',()=>{block.checked=check.checked;touchPage(page);edit.style.textDecoration=check.checked?'line-through':'none';edit.style.color=check.checked?'#687d71':'';});row.append(check);
      }
      const edit=document.createElement('div');edit.className='block-edit '+(block.type==='text'?'':block.type);edit.contentEditable='true';edit.textContent=block.text;edit.setAttribute('role','textbox');edit.setAttribute('aria-multiline','true');edit.dataset.placeholder=block.type==='text'?'入力を開始…':'内容を入力…';
      if(block.checked){edit.style.textDecoration='line-through';edit.style.color='#687d71';}
      edit.addEventListener('input',()=>{block.text=edit.innerText.replace(/\r/g,'').slice(0,30000);touchPage(page);});
      edit.addEventListener('keydown',e=>{
        if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();const next=makeBlock();page.blocks.splice(page.blocks.findIndex(b=>b.id===block.id)+1,0,next);touchPage(page);renderBlocks(editor,page);focusBlock(next.id);}
        if(e.key==='Backspace' && !edit.innerText && page.blocks.length>1){e.preventDefault();const idx=page.blocks.findIndex(b=>b.id===block.id);page.blocks.splice(idx,1);touchPage(page);renderBlocks(editor,page);focusBlock(page.blocks[Math.max(0,idx-1)].id);}
      });
      row.append(edit);editor.append(row);
      if(pickerFor===block.id)editor.append(blockPicker(editor,page,i+1));
    });
    editor.append(button('＋ ブロックを追加','add-block',()=>{pickerFor=pickerFor==='end'?null:'end';renderBlocks(editor,page);}));
    if(pickerFor==='end')editor.append(blockPicker(editor,page,page.blocks.length));
  }
  function blockPicker(editor,page,index){
    const wrap=document.createElement('div');wrap.className='block-picker';
    [['text','テキスト'],['heading','見出し H1'],['subheading','見出し H2'],['todo','チェック'],['quote','引用'],['code','コード'],['link','ページへのリンク'],['database','データベースを埋め込む']].forEach(([type,label])=>wrap.append(button(label,'',()=>{
      const b=makeBlock(type);if(type==='database')b.targetId=DEFAULT_DB;page.blocks.splice(index,0,b);pickerFor=null;touchPage(page);renderBlocks(editor,page);if(type!=='database')focusBlock(b.id);
    })));
    return wrap;
  }
  function focusBlock(id){requestAnimationFrame(()=>{const node=[...document.querySelectorAll('.block-row')].find(el=>el.dataset.blockId===id)?.querySelector('.block-edit');if(node)node.focus();});}
  function taskSelect(value,options,onChange){
    const s=document.createElement('select');s.className='task-select';
    options.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;s.append(o);});s.value=options.includes(value)?value:options[0];s.addEventListener('change',()=>onChange(s.value));return s;
  }
  function fieldOptions(extraAll=false,dbId){
    return [...(extraAll?[['all','全項目']]:[]),['title','名前'],['status','ステータス'],['priority','優先度'],['due','期限'],
      ...liveColumns(dbId).map(c=>['custom:'+c.id,c.name])];
  }
  function fieldSelector(value,options,onChange,id){
    const el=document.createElement('select');el.className='task-select';if(id)el.id=id;
    for(const [v,label] of options){const o=document.createElement('option');o.value=v;o.textContent=label;el.append(o);}
    el.value=options.some(([v])=>v===value)?value:options[0][0];el.addEventListener('change',()=>onChange(el.value));return el;
  }
  function chooseRelationDatabase(current=''){
    const available=liveDatabases();
    if(!available.length){toast('参照先のデータベースがありません。');return null;}
    const choices=available.map((db,i)=>(i+1)+': '+db.title).join('\n');
    const initial=String(Math.max(0,available.findIndex(db=>db.id===current))+1 || 1);
    const result=prompt('参照先データベースの番号を入力してください\n'+choices,initial);
    if(result===null)return null;
    const n=Number(result);
    return Number.isInteger(n)&&n>0&&n<=available.length?available[n-1].id:null;
  }
  function isCompatibleColumnValue(raw,type,targetDbId=''){
    if(type==='relation')return raw==='' || (!!getDatabase(targetDbId)&&liveTasks(targetDbId).some(t=>t.id===raw));
    if(raw==='')return true;
    if(type==='text')return true;
    if(type==='number')return raw.trim()!=='' && Number.isFinite(Number(raw));
    if(type==='date'){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return false;
      const d=new Date(raw+'T00:00:00Z');return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10)===raw;
    }
    return type==='checkbox' && (raw==='true'||raw==='false');
  }
  function editColumn(col){
    const name=prompt('列の名前を編集（最大80文字）',col.name);
    if(name===null)return;
    if(!name.trim()){toast('列名は空にできません。');return;}
    if(['backlink','rollup'].includes(col.type)){
      col.name=name.trim().slice(0,80);persist();render();return;
    }
    const type=prompt('列の種類: text / number / date / checkbox / relation',col.type);
    if(type===null)return;
    if(!['text','number','date','checkbox','relation'].includes(type)){toast('対応していない列の種類です。');return;}
    const target=type==='relation'?chooseRelationDatabase(col.targetDbId||''):'';
    if(type==='relation'&&!target){toast('参照先が選択されていません。');return;}
    const linked=liveColumns().some(c=>['backlink','rollup'].includes(c.type)&&c.sourceColumnId===col.id);
    if(linked&&(type!=='relation'||target!==col.targetDbId)){
      toast('この列には逆参照・集計列があります。参照先の変更はできません。');return;
    }
    const changedTarget=(col.targetDbId||'')!==target || col.type!==type;
    const invalid=changedTarget?liveTasks(col.dbId||DEFAULT_DB).filter(t=>!isCompatibleColumnValue(customValue(t,col.id),type,target)):[];

    if(invalid.length){toast('変更できません。既存の '+invalid.length+' 件の値が '+type+' 形式に合いません。');return;}
    col.name=name.trim().slice(0,80);col.type=type;col.targetDbId=target;persist();render();toast('列設定を保存しました。');
  }
  function addRollupColumn(dbId,name){
    const sources=liveColumns().filter(c=>c.type==='relation'&&c.targetDbId===dbId&&getDatabase(c.dbId));
    if(!sources.length){toast('このデータベースを参照するリレーション列が必要です。');return;}
    const index=prompt('集計するリレーション列の番号を選択\n'+sources.map((c,i)=>(i+1)+': '+(getDatabase(c.dbId)?.title||'')+' / '+c.name).join('\n'),'1');
    if(index===null)return;
    const source=sources[Number(index)-1];if(!source){toast('選択が不正です。');return;}
    const op=prompt('集計方法: count（件数） / sum（数値合計）','count');
    if(op===null)return;
    if(!['count','sum'].includes(op)){toast('count または sum を選択してください。');return;}
    let rollupFieldId='';
    if(op==='sum'){
      const numeric=liveColumns(source.dbId||DEFAULT_DB).filter(c=>c.type==='number');
      if(!numeric.length){toast('参照元に数値型の列が必要です。');return;}
      const n=prompt('合計する数値列の番号を選択\n'+numeric.map((c,i)=>(i+1)+': '+c.name).join('\n'),'1');
      if(n===null)return;
      const chosen=numeric[Number(n)-1];if(!chosen){toast('選択が不正です。');return;}
      rollupFieldId=chosen.id;
    }
    state.dbColumns.push({id:uid(),dbId,name,type:'rollup',sourceColumnId:source.id,sourceDbId:source.dbId||DEFAULT_DB,rollupOp:op,rollupFieldId,deleted:false});
    persist();render();
  }
  function addColumn(dbId=DEFAULT_DB){
    const name=prompt('追加する列の名前（最大80文字）');if(!name?.trim())return;
    const type=prompt('列の種類: text / number / date / checkbox / relation / rollup','text');
    if(!['text','number','date','checkbox','relation','rollup'].includes(type)){toast('対応していない列の種類です。');return;}
    if(type==='rollup'){addRollupColumn(dbId,name.trim().slice(0,80));return;}
    const targetDbId=type==='relation'?chooseRelationDatabase():'';
    if(type==='relation'&&!targetDbId){toast('参照先が選択されていません。');return;}
    const col={id:uid(),dbId,name:name.trim().slice(0,80),type,targetDbId,deleted:false};
    state.dbColumns.push(col);
    if(type==='relation'){
      const origin=getDatabase(dbId)?.title||'データベース';
      state.dbColumns.push({id:uid(),dbId:targetDbId,name:(origin+' ← '+col.name).slice(0,80),
        type:'backlink',sourceColumnId:col.id,sourceDbId:dbId,deleted:false});
    }
    persist();render();
  }
  function setCustom(t,col,value){
    if(!t.properties)t.properties={};
    t.properties[col.id]=String(value).slice(0,500);touchTask(t);
  }
  function columnCell(t,col){
    const td=document.createElement('td');const raw=customValue(t,col.id);
    if(col.type==='backlink'){
      td.className='derived-cell';
      const matches=VctrSync.backlinksFor(state,t.id,col.sourceColumnId);
      if(!matches.length){td.textContent='—';return td;}
      for(const item of matches)td.append(button(item.task.title||'無題','derived-link',()=>setView('task:'+item.task.id),'参照元レコードへ移動'));
      return td;
    }
    if(col.type==='rollup'){
      td.className='derived-cell';
      const value=VctrSync.rollupFor(state,t.id,col);
      td.textContent=value===null?'設定を確認':String(value);
      return td;
    }
    const input=document.createElement('input');input.setAttribute('aria-label',col.name);input.dataset.columnId=col.id;
    input.className=col.type==='checkbox'?'task-check':'task-input';
    if(col.type==='relation'){
      const select=document.createElement('select');select.className='task-select relation-select';
      select.dataset.columnId=col.id;select.setAttribute('aria-label',col.name);
      const blank=document.createElement('option');blank.value='';blank.textContent='未設定';select.append(blank);
      for(const target of liveTasks(col.targetDbId)){
        const opt=document.createElement('option');opt.value=target.id;opt.textContent=target.title;select.append(opt);
      }
      if(raw && !liveTasks(col.targetDbId).some(x=>x.id===raw)){
        const gone=document.createElement('option');gone.value=raw;gone.textContent='参照先が存在しません ('+raw.slice(0,24)+')';select.append(gone);
      }
      select.value=raw;select.addEventListener('change',()=>setCustom(t,col,select.value));
      td.append(select);return td;
    }
    if(col.type==='checkbox'){input.type='checkbox';input.checked=raw==='true';input.addEventListener('change',()=>setCustom(t,col,input.checked?'true':'false'));}
    else{
      input.type=col.type;input.value=raw;
      const listener=col.type==='text'?'input':'change';
      input.addEventListener(listener,()=>setCustom(t,col,input.value));
    }
    td.append(input);return td;
  }
  function renderTasks(root,db,embedded=false,block=null,ownerPage=null){
    if(!db)return;
    if(embedded){
      root.className='embedded-database';
      const heading=document.createElement('div');heading.className='embedded-database-header';
      heading.append(button('▦ '+db.title,'subtle-button',()=>setView('db:'+db.id),'データベースを開く'));
      root.replaceChildren(heading);
    }else{
      root.innerHTML=intro('STRUCTURED THINKING',db.title,'このデータベースのレコードだけを表示します。ページにも埋め込めます。');
      const actions=document.createElement('div');actions.className='db-title-actions';
      const rename=button('名前を変更','subtle-button',()=>{
        const name=prompt('データベース名（最大80文字）',db.title);
        if(!name?.trim())return;
        db.title=name.trim().slice(0,80);persist();render();
      });
      actions.append(rename);
      if(db.id!==DEFAULT_DB)actions.append(button('アーカイブ','subtle-button danger',()=>{
        if(!confirm('「'+db.title+'」をアーカイブしますか？ レコード '+liveTasks(db.id).length+'件と列・変更履歴は残ります。左側から復元できます。'))return;
        db.deleted=true;persist();setView('home');
      }));
      root.append(actions);
    }
    const displayMode=embedded?(block?.viewMode==='board'?'board':'table'):dbMode;
    const countLimit=embedded?([5,10,20].includes(block?.viewLimit)?block.viewLimit:0):0;
    const tabs=document.createElement('div');tabs.className='db-tabs';
    if(!embedded){
      tabs.append(button('▦ テーブル','db-tab'+(displayMode==='table'?' active':''),()=>{dbMode='table';render();}));
      tabs.append(button('▥ カンバン','db-tab'+(displayMode==='board'?' active':''),()=>{dbMode='board';render();}));
    }
    tabs.append(button('＋ 列を追加','db-tab',()=>addColumn(db.id)));root.append(tabs);
    const toolbar=document.createElement('div');toolbar.className='db-toolbar';
    const filter=fieldSelector(filterField,fieldOptions(true,db.id),value=>{filterField=value;render();},embedded?null:'filter-field');
    const q=document.createElement('input');if(!embedded)q.id='filter-query';q.className='task-input';q.placeholder='含まれる文字で絞り込み';q.value=filterQuery;
    q.addEventListener('change',()=>{filterQuery=q.value.slice(0,200);render();});
    q.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();q.blur();}});
    const sort=fieldSelector(sortField,[['none','並び替えなし'],...fieldOptions(false,db.id)],value=>{sortField=value;render();},embedded?null:'sort-field');
    const order=fieldSelector(sortDirection,[['asc','昇順'],['desc','降順']],value=>{sortDirection=value;render();},embedded?null:'sort-direction');
    toolbar.append(filter,q,sort,order);root.append(toolbar);
    if(displayMode==='table')renderTable(root,db.id,countLimit);else renderBoard(root,db.id,countLimit);
    const bottom=document.createElement('div');bottom.className='add-row';
    bottom.append(button('＋ 新しいタスク','primary-button',()=>{
      state.tasks.push({id:uid(),dbId:db.id,title:'新しいタスク',status:'未着手',priority:'中',due:'',properties:{},updatedAt:stamp(),deleted:false});
      persist();render();
    }));root.append(bottom);
  }
  function renderTable(root,dbId,limit=0){
    const wrap=document.createElement('div');wrap.className='task-table-wrap';const table=document.createElement('table');table.className='task-table';
    const thead=document.createElement('thead'),hdr=document.createElement('tr');
    for(const title of ['名前','ステータス','優先度','期限']){const th=document.createElement('th');th.textContent=title;hdr.append(th);}
    for(const c of liveColumns(dbId)){
      const th=document.createElement('th');const label=document.createElement('span');label.textContent=c.name+' ';
      th.append(label,button('⚙','column-settings',()=>editColumn(c),'列設定を編集'),button('×','column-delete',()=>{
        if(c.type==='relation'&&liveColumns().some(x=>['backlink','rollup'].includes(x.type)&&x.sourceColumnId===c.id)){
          toast('逆参照・集計列を先に非表示にしてください。');return;
        }
        if(!confirm('列「'+c.name+'」を非表示にしますか？ 値は履歴に残ります。'))return;
        c.deleted=true;persist();render();
      },'列を非表示'));
      hdr.append(th);
    }
    const end=document.createElement('th');hdr.append(end);thead.append(hdr);table.append(thead);
    const tbody=document.createElement('tbody');(limit?visibleTasks(dbId).slice(0,limit):visibleTasks(dbId)).forEach(t=>{
      const tr=document.createElement('tr');
      const cell1=document.createElement('td');const name=document.createElement('input');name.className='task-input';name.value=t.title;name.setAttribute('aria-label','タスク名');name.addEventListener('input',()=>{t.title=name.value.slice(0,400);touchTask(t);});cell1.append(name,button('↗','record-open',()=>setView('task:'+t.id),'詳細ページを開く'));
      const cell2=document.createElement('td');cell2.append(taskSelect(t.status,STATUS,v=>{t.status=v;touchTask(t);}));
      const cell3=document.createElement('td');cell3.append(taskSelect(t.priority,PRIORITY,v=>{t.priority=v;touchTask(t);}));
      const cell4=document.createElement('td');const date=document.createElement('input');date.type='date';date.className='task-date';date.value=t.due||'';date.setAttribute('aria-label','期限');date.addEventListener('change',()=>{t.due=date.value;touchTask(t);});cell4.append(date);
      tr.append(cell1,cell2,cell3,cell4);
      for(const col of liveColumns(dbId))tr.append(columnCell(t,col));
      const cell5=document.createElement('td');cell5.append(button('×','row-delete',()=>{if(!confirm('このタスクを削除しますか？'))return;t.deleted=true;touchTask(t);render();},'削除'));
      tr.append(cell5);tbody.append(tr);
    });table.append(tbody);wrap.append(table);root.append(wrap);
    const count=document.createElement('p');count.className='result-count';count.textContent=(limit?Math.min(limit,visibleTasks(dbId).length):visibleTasks(dbId).length)+' / '+liveTasks(dbId).length+' 件を表示';root.append(count);
  }
  function renderBoard(root,dbId,limit=0){
    const board=document.createElement('div');board.className='board';
    STATUS.forEach(status=>{
      const lane=document.createElement('div');lane.className='board-lane';const items=(limit?visibleTasks(dbId).slice(0,limit):visibleTasks(dbId)).filter(t=>t.status===status);
      const head=document.createElement('div');head.className='lane-header';head.innerHTML=`<span>${escapeHtml(status)}</span><small>${items.length}</small>`;lane.append(head);
      items.forEach(t=>{const card=document.createElement('div');card.className='board-card';const title=document.createElement('div');title.className='board-card-title';title.textContent=t.title;const meta=document.createElement('div');meta.className='board-card-meta';meta.textContent='優先度 '+t.priority+(t.due?' · '+t.due:'')+liveColumns(dbId).map(c=>{
          const raw=customValue(t,c.id),related=c.type==='relation'?getTask(raw):null;
          const derived=c.type==='rollup'?VctrSync.rollupFor(state,t.id,c):
            c.type==='backlink'?VctrSync.backlinksFor(state,t.id,c.sourceColumnId).length:null;
          return ' · '+c.name+': '+(derived!==null?derived:(related?related.title:raw));
        }).join('');card.append(title,button('詳細を開く ↗','record-open',()=>setView('task:'+t.id)),meta,taskSelect(t.status,STATUS,v=>{t.status=v;touchTask(t);render();}));lane.append(card);});
      if(!items.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='タスクなし';lane.append(empty);}board.append(lane);
    });root.append(board);
  }
  function renderTaskDetail(root,task){
    // A stable document ID means different devices will attach edits to one task page.
    // The task title and properties remain authoritative in the task record.
    let page=state.pages.find(p=>!p.deleted && p.taskId===task.id);
    if(!page){
      page={id:'taskdoc_'+task.id,title:task.title,icon:'▦',parentId:'',taskId:task.id,
        updatedAt:stamp(),deleted:false,blocks:[]};
      state.pages.push(page);persist();
    }
    const back=document.createElement('div');back.className='record-back';
    back.append(button('← データベースへ戻る','subtle-button',()=>setView('db:'+(task.dbId||DEFAULT_DB))));root.append(back);
    const kicker=document.createElement('div');kicker.className='eyebrow';kicker.textContent='DATABASE / RECORD';root.append(kicker);
    const title=document.createElement('input');title.className='doc-title';title.id='record-title';
    title.setAttribute('aria-label','タスク名');title.value=task.title;
    title.addEventListener('input',()=>{task.title=title.value.slice(0,400);touchTask(task);$('crumb-page').textContent=task.title||'無題';});root.append(title);
    const fields=document.createElement('div');fields.className='record-fields';
    function field(label,control){const wrap=document.createElement('label');wrap.className='record-field';
      const text=document.createElement('span');text.textContent=label;wrap.append(text,control);return wrap;}
    fields.append(field('ステータス',taskSelect(task.status,STATUS,v=>{task.status=v;touchTask(task);})),
      field('優先度',taskSelect(task.priority,PRIORITY,v=>{task.priority=v;touchTask(task);}))); 
    const date=document.createElement('input');date.className='task-date';date.type='date';date.value=task.due||'';
    date.addEventListener('change',()=>{task.due=date.value;touchTask(task);});fields.append(field('期限',date));
    for(const col of liveColumns(task.dbId||DEFAULT_DB)){const cell=columnCell(task,col);fields.append(field(col.name,cell.firstChild));}
    root.append(fields);
    const referring=VctrSync.backlinksFor(state,task.id);
    if(referring.length){
      const section=document.createElement('section');section.className='record-references';
      const h=document.createElement('h3');h.textContent='このレコードを参照しているレコード（'+referring.length+'件）';section.append(h);
      for(const item of referring)section.append(button((item.task.title||'無題')+' · '+item.column.name,'derived-link',()=>setView('task:'+item.task.id)));
      root.append(section);
    }
    const heading=document.createElement('h2');heading.className='record-description';heading.textContent='本文';root.append(heading);
    const help=document.createElement('p');help.className='doc-hint';help.textContent='このタスク固有のページです。メモ、チェックリスト、他ページへのリンクを追加できます。';root.append(help);
    const editor=document.createElement('div');editor.className='editor';editor.id='editor';root.append(editor);
    renderBlocks(editor,page);
  }
  function render(){
    let db=view==='tasks'?getDatabase(DEFAULT_DB):view.startsWith('db:')?getDatabase(view.slice(3)):null;
    let task=getTaskFromView(view),page=getPage(view);
    if(view!=='home'&&!db&&!page&&!task){view='home';db=null;task=null;page=null;}
    renderSidebar();
    $('crumb-page').textContent=view==='home'?'Overview':db?.title||task?.title||page?.title||'Overview';
    const root=$('content-area');root.replaceChildren();
    if(view==='home')renderHome(root);
    else if(db)renderTasks(root,db);
    else if(task)renderTaskDetail(root,task);
    else renderDoc(root,page);
  }
  function openSidebar(){$('sidebar').classList.add('open');$('mobile-shade').classList.add('show');}
  function closeSidebar(){$('sidebar').classList.remove('open');$('mobile-shade').classList.remove('show');}
  function openSearch(){ $('search-backdrop').classList.remove('hidden');$('search-input').value='';renderSearch('');$('search-input').focus(); }
  function closeSearch(){$('search-backdrop').classList.add('hidden');}
  function renderSearch(q){
    const out=$('search-results');out.replaceChildren();let matches=0;const needle=q.trim().toLocaleLowerCase();
    const add=(icon,title,sub,target)=>{const b=button('','search-item',()=>{setView(target);closeSearch();});const i=document.createElement('span');i.textContent=icon;const desc=document.createElement('span');const strong=document.createElement('strong');strong.textContent=title;const small=document.createElement('small');small.textContent=sub;desc.append(strong,small);b.append(i,desc);out.append(b);matches++;};
    livePages().forEach(p=>{if(!needle||(p.title+' '+p.blocks.map(b=>b.text).join(' ')).toLocaleLowerCase().includes(needle))add(p.icon,p.title,'ページ',p.id);});
    liveDatabases().forEach(d=>{if(!needle||d.title.toLocaleLowerCase().includes(needle))add('▦',d.title,'データベース','db:'+d.id);});
    liveTasks().forEach(t=>{if(!needle||t.title.toLocaleLowerCase().includes(needle))add('▦',t.title,'タスク · '+t.status,'task:'+t.id);});
    if(!matches){const empty=document.createElement('div');empty.className='empty';empty.textContent='一致する結果がありません。';out.append(empty);}
  }
  function download(filename,text){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.download=filename;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},2000);}
  function exportData(){download('vctrmemo-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({...state,sync:engine.export(),exportedAt:new Date().toISOString()},null,2));toast('変更履歴を含むJSONバックアップを書き出しました。');}
  function mergeRecords(local,remote){const m=new Map(local.map(x=>[x.id,x]));for(const x of remote){if(!x||typeof x.id!=='string')continue;const prev=m.get(x.id);if(!prev||Number(x.updatedAt)>Number(prev.updatedAt))m.set(x.id,structuredClone(x));}return [...m.values()];}
  function mergeState(received){
    if(!validate(received))return false;
    const staged=structuredClone(state);
    staged.pages=mergeRecords(staged.pages,received.pages);
    staged.tasks=mergeRecords(staged.tasks,received.tasks);
    staged.dbColumns=mergeRecords(staged.dbColumns||[],received.dbColumns||[]);
    staged.databases=mergeRecords(staged.databases||[],received.databases||[]);
    const trial=new VctrSync.Engine(engine.export().ops,engine.actor,engine.counter);
    trial.capture(staged,state);
    engine=trial;state=trial.project();baseline=structuredClone(state);
    persist(true);render();return true;
  }
  $('new-page').addEventListener('click',createPage);
  $('search-toggle').addEventListener('click',openSearch);
  $('search-close').addEventListener('click',closeSearch);
  $('search-input').addEventListener('input',e=>renderSearch(e.target.value));
  $('search-backdrop').addEventListener('click',e=>{if(e.target===$('search-backdrop'))closeSearch();});
  document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openSearch();}if(e.key==='Escape')closeSearch();});
  $('export-json').addEventListener('click',exportData);
  $('import-json').addEventListener('click',()=>$('import-file').click());
  $('import-file').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try {
      if(file.size>8*1024*1024)throw new Error('ファイルサイズが大きすぎます');
      const parsed=JSON.parse(await file.text());
      if(!validate(parsed))throw new Error('バックアップ形式が不正です');
      const imported=parsed.sync?.version===2 ? parsed.sync.ops : null;
      if(parsed.sync && (!Array.isArray(imported)||imported.length>12000 || !imported.every(VctrSync.isValidOp))){
        throw new Error('同期履歴に不正な変更があります。取込を中止しました。');
      }
      if(imported){
        const seen=new Map();
        for(const op of imported){
          if(seen.has(op.id)&&JSON.stringify(seen.get(op.id))!==JSON.stringify(op))throw new Error('同じIDに異なる変更が含まれます');
          seen.set(op.id,op);
        }
      }
      const summary='ページ '+parsed.pages.filter(p=>!p.deleted).length+'件・レコード '+parsed.tasks.filter(t=>!t.deleted).length+'件・履歴 '+(imported?.length??'なし')+'件';
      if(!confirm('バックアップ取込: '+summary+'。\n現在のデータと統合します。競合があれば内容を確認してください。よろしいですか？'))return;
      if(imported){
        const trial=new VctrSync.Engine(engine.export().ops,engine.actor,engine.counter);
        const existing=new Map(trial.export().ops.map(op=>[op.id,JSON.stringify(op)]));
        for(const op of imported)if(existing.has(op.id)&&existing.get(op.id)!==JSON.stringify(op))throw new Error('既存履歴とIDが衝突しています');
        trial.merge(imported);
        engine=trial;state=engine.project();baseline=structuredClone(state);persist(true);render();
      }else mergeState(parsed);
      toast('バックアップを取り込みました。');
    }
    catch(err){toast('インポート失敗: '+err.message);}finally{$('import-file').value='';}
  });
  $('open-sidebar').addEventListener('click',openSidebar);$('close-sidebar').addEventListener('click',closeSidebar);$('mobile-shade').addEventListener('click',closeSidebar);
  $('show-conflicts').addEventListener('click',showConflicts);
  $('close-conflicts').addEventListener('click',()=>$('conflict-backdrop').classList.add('hidden'));
  $('conflict-backdrop').addEventListener('click',e=>{if(e.target===$('conflict-backdrop'))e.target.classList.add('hidden');});
  const host=window.webxdc;
  let transfer=null;
  const probe=new VctrTransfer.Probe(uid());
  function setProbeStatus(message){
    const status=$('probe-status');
    if(status)status.textContent=message;
    $('probe-reply').hidden=!probe.hasRequest;
  }
  function sendProbe(update){
    if(!host||typeof host.sendUpdate!=='function'){
      setProbeStatus('Web版では通信できません。Vectorのチャットで開いてください。');
      return false;
    }
    if(transfer?.active){
      setProbeStatus('変更履歴の送信が終わってから通信テストを実行してください。');
      return false;
    }
    try{host.sendUpdate(update,'');return true;}
    catch(err){console.warn('vctrmemo connectivity probe failed',err);setProbeStatus('送信に失敗しました。もう一度試してください。');return false;}
  }
  $('probe-send').addEventListener('click',()=>{
    if(!host||typeof host.sendUpdate!=='function'){
      setProbeStatus('Web版では通信できません。Vectorのチャットで開いてください。');return;
    }
    if(transfer?.active){setProbeStatus('共有処理の完了後に実行してください。');return;}
    const request=probe.start(uid());
    if(sendProbe(request))setProbeStatus('テスト送信済み。相手が「受信確認を返す」を押すとここに表示されます。');
  });
  $('probe-reply').addEventListener('click',()=>{
    if(transfer?.active){setProbeStatus('共有処理の完了後に応答してください。');return;}
    const ack=probe.response();
    if(!ack)return;
    if(sendProbe(ack))setProbeStatus('受信確認を送信しました。相手の画面で応答を確認してください。');
  });
  if(host&&typeof host.setUpdateListener==='function'&&typeof host.sendUpdate==='function'){
    document.body.classList.add('vector-host');
    try{
      const replay=host.setUpdateListener(update=>{
        const payload=update?.payload;
        if(payload?.kind===VctrTransfer.PROBE_KIND){
          const event=probe.accept(payload);
          if(event?.kind==='request')setProbeStatus('通信テストを受信しました。「受信確認を返す」を押してください。');
          if(event?.kind==='ack')setProbeStatus('別のアプリ実行環境から受信確認: '+event.count+'件（相手側で受信）');
          return;
        }
        if(payload?.kind==='workspace-snapshot-v1')return; // Old format is not causally safe.
        if(payload?.kind!=='vctrmemo-ops-v2'||!Array.isArray(payload.ops)||payload.ops.length>12000)return;
        const receipt=transferTracker.accept(payload);
        if(receipt?.invalid){console.warn('Rejected inconsistent transfer metadata');return;}
        incomingQueue.push(payload.ops);
        flushIncoming();
        updateSyncState();
      },0);
      if(replay&&typeof replay.then==='function')replay.then(()=>{
        replayFinished=true;updateSyncState();
      }).catch(err=>{console.warn('WebXDC replay error',err);updateSyncState();});
    }catch(err){console.warn('WebXDC listener error',err);}
  }
  $('sync-now').addEventListener('click',()=>{
    if(!host||typeof host.sendUpdate!=='function'){toast('ブラウザ版では同期できません。Vector内で開いてください。');return;}
    if(transfer?.active){toast('現在、分割送信中です。完了するまで操作しないでください。');return;}
    flushIncoming();
    const maxSize=Number(host.sendUpdateMaxSize)>0 ? Number(host.sendUpdateMaxSize) : 128000;
    let parts;
    try { parts=VctrTransfer.trackedBatches(engine.export().ops,maxSize,uid(),engine.actor); }
    catch(err){toast('共有できません: '+err.message);return;}
    if(!parts.length){toast('共有する変更履歴がありません。');return;}
    if(!confirm('このチャットの参加者にページ・タスクの変更履歴を '+parts.length+' 件に分けて送信します。すべての内容が共有されます。送信しますか？'))return;
    const syncBtn=$('sync-now');
    syncBtn.disabled=true;
    transfer=new VctrTransfer.Sender(host,{onStatus:({kind,done,total,error})=>{
      if(kind==='sent')syncBtn.textContent='送信 '+done+'/'+total;
      if(kind==='finished'){
        syncBtn.disabled=false;syncBtn.textContent='↗ 変更を共有';
        toast('WebXDCへ '+total+' 件の送信を呼び出しました。相手の受信確認ではありません。');
      }
      if(kind==='failed'||kind==='stopped'){
        syncBtn.disabled=false;syncBtn.textContent='↗ 変更を共有';
        toast('送信は '+done+'/'+total+' 件で停止しました。再度「変更を共有」を押すと全履歴を再送できます。');
        if(error)console.error('vctrmemo transfer error',error);
      }
    }});
    transfer.start(parts);
  });
  persist(true);render();updateSyncState();
})();
