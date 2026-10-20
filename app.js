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
  const makeBlock = (type='text', text='') => ({id:uid(), type, text, checked:false});
  const defaults = () => ({
    schema:1,
    pages:[
      {id:'welcome',title:'はじめに',icon:'✦',updatedAt:1,deleted:false,blocks:[
        {id:'w1',type:'heading',text:'自分の情報は、自分の手元に。',checked:false},
        {id:'w2',type:'text',text:'vctrmemo は、ページやタスクを端末内で管理できるメモアプリの試作品です。v0.3 では、端末内での編集と分割送信による手動共有を試せます。',checked:false},
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
  let view = 'home';
  let dbMode = 'table';
  let pickerFor = null;
  let toastTimer;
  const livePages = () => state.pages.filter(p => !p.deleted);
  const liveTasks = () => state.tasks.filter(t => !t.deleted);
  const getPage = id => state.pages.find(p=>p.id===id && !p.deleted);
  const getTask = id => state.tasks.find(t=>t.id===id && !t.deleted);
  function toast(message) { const node=$('toast');node.textContent=message;node.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('show'),3300); }
  function persist(remote=false) {
    try {
      if(!remote)engine.capture(state,baseline);
      baseline=structuredClone(state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({sync:engine.export()}));
      $('save-state').textContent='● 端末保存済み';
      updateConflictButton();
    } catch(e) { $('save-state').textContent='● 保存エラー';toast('端末への保存に失敗しました。JSONを書き出してください。'); console.error(e); }
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
      const kind=c.parts[0]==='B'?'ブロック':c.parts[0]==='P'?'ページ':'タスク';
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
  }
  document.addEventListener('focusout',()=>setTimeout(flushIncoming,0));
  function touchPage(p) { p.updatedAt=stamp();persist(); }
  function touchTask(t) { t.updatedAt=stamp();persist(); }
  const button = (label, cls, onClick, title) => {const el=document.createElement('button');el.type='button';el.textContent=label;el.className=cls||'';if(title)el.title=title;el.addEventListener('click',onClick);return el;};
  function setView(next){ view=next; pickerFor=null;render();closeSidebar(); }
  function renderSidebar() {
    const nav=$('pages-list');nav.replaceChildren();
    nav.appendChild(navButton('home','⌂','Overview','概要'));
    nav.appendChild(navButton('tasks','▦','データベース',String(liveTasks().length)));
    const label=document.createElement('div');label.className='sidebar-section-label';label.style.paddingTop='16px';label.textContent='PAGES';nav.appendChild(label);
    livePages().forEach(p=>nav.appendChild(navButton(p.id,p.icon,p.title,'')));
  }
  function navButton(id,icon,name,meta) {
    const b=button('','page-link'+(view===id?' active':''),()=>setView(id));
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
  function createPage(){const p={id:uid(),title:'無題',icon:ICONS[Math.floor(Math.random()*ICONS.length)],updatedAt:stamp(),deleted:false,blocks:[makeBlock('text','')]};state.pages.push(p);persist();setView(p.id);const input=$('doc-title');if(input){input.focus();input.select();}}
  function renderDoc(root,page) {
    const header=document.createElement('div');header.className='eyebrow';header.textContent='PAGE / DOCUMENT';root.append(header);
    const top=document.createElement('div');top.className='doc-header';
    const title=document.createElement('input');title.id='doc-title';title.className='doc-title';title.value=page.title;title.placeholder='ページのタイトル';title.setAttribute('aria-label','ページのタイトル');
    title.addEventListener('input',()=>{page.title=title.value.slice(0,200);touchPage(page);$('crumb-page').textContent=page.title||'無題';const link=[...$('pages-list').querySelectorAll('button')].find(b=>b.classList.contains('active'));if(link){link.querySelector('.page-name').textContent=page.title||'無題';}});
    const actions=document.createElement('div');actions.className='doc-actions';actions.append(button('複製','subtle-button',()=>{const p={...structuredClone(page),id:uid(),title:page.title+' のコピー',updatedAt:stamp(),blocks:page.blocks.map(b=>({...b,id:uid()}))};state.pages.push(p);persist();setView(p.id);}));actions.append(button('削除','subtle-button danger',()=>{if(!confirm('このページを削除しますか？ JSONバックアップがない場合、復元できません。'))return;page.deleted=true;touchPage(page);setView('home');}));top.append(title,actions);root.append(top);
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
    [['text','テキスト'],['heading','見出し H1'],['subheading','見出し H2'],['todo','チェック'],['quote','引用'],['code','コード']].forEach(([type,label])=>wrap.append(button(label,'',()=>{
      const b=makeBlock(type);page.blocks.splice(index,0,b);pickerFor=null;touchPage(page);renderBlocks(editor,page);focusBlock(b.id);
    })));
    return wrap;
  }
  function focusBlock(id){requestAnimationFrame(()=>{const node=[...document.querySelectorAll('.block-row')].find(el=>el.dataset.blockId===id)?.querySelector('.block-edit');if(node)node.focus();});}
  function taskSelect(value,options,onChange){
    const s=document.createElement('select');s.className='task-select';
    options.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;s.append(o);});s.value=options.includes(value)?value:options[0];s.addEventListener('change',()=>onChange(s.value));return s;
  }
  function renderTasks(root){
    root.innerHTML=intro('STRUCTURED THINKING','データベース','表形式とカンバン形式を切り替えて管理できます。ステータスや優先度を変更すると自動保存します。');
    const tabs=document.createElement('div');tabs.className='db-tabs';
    tabs.append(button('▦ テーブル','db-tab'+(dbMode==='table'?' active':''),()=>{dbMode='table';render();}));
    tabs.append(button('▥ カンバン','db-tab'+(dbMode==='board'?' active':''),()=>{dbMode='board';render();}));root.append(tabs);
    if(dbMode==='table')renderTable(root);else renderBoard(root);
    const bottom=document.createElement('div');bottom.className='add-row';bottom.append(button('＋ 新しいタスク','primary-button',()=>{state.tasks.push({id:uid(),title:'新しいタスク',status:'未着手',priority:'中',due:'',updatedAt:stamp(),deleted:false});persist();render();}));root.append(bottom);
  }
  function renderTable(root){
    const wrap=document.createElement('div');wrap.className='task-table-wrap';const table=document.createElement('table');table.className='task-table';table.innerHTML='<thead><tr><th style="width:40%">名前</th><th>ステータス</th><th>優先度</th><th>期限</th><th></th></tr></thead>';
    const tbody=document.createElement('tbody');liveTasks().forEach(t=>{
      const tr=document.createElement('tr');
      const cell1=document.createElement('td');const name=document.createElement('input');name.className='task-input';name.value=t.title;name.setAttribute('aria-label','タスク名');name.addEventListener('input',()=>{t.title=name.value.slice(0,400);touchTask(t);});cell1.append(name);
      const cell2=document.createElement('td');cell2.append(taskSelect(t.status,STATUS,v=>{t.status=v;touchTask(t);}));
      const cell3=document.createElement('td');cell3.append(taskSelect(t.priority,PRIORITY,v=>{t.priority=v;touchTask(t);}));
      const cell4=document.createElement('td');const date=document.createElement('input');date.type='date';date.className='task-date';date.value=t.due||'';date.setAttribute('aria-label','期限');date.addEventListener('change',()=>{t.due=date.value;touchTask(t);});cell4.append(date);
      const cell5=document.createElement('td');cell5.append(button('×','row-delete',()=>{if(!confirm('このタスクを削除しますか？'))return;t.deleted=true;touchTask(t);render();},'削除'));
      tr.append(cell1,cell2,cell3,cell4,cell5);tbody.append(tr);
    });table.append(tbody);wrap.append(table);root.append(wrap);
  }
  function renderBoard(root){
    const board=document.createElement('div');board.className='board';
    STATUS.forEach(status=>{
      const lane=document.createElement('div');lane.className='board-lane';const items=liveTasks().filter(t=>t.status===status);
      const head=document.createElement('div');head.className='lane-header';head.innerHTML=`<span>${escapeHtml(status)}</span><small>${items.length}</small>`;lane.append(head);
      items.forEach(t=>{const card=document.createElement('div');card.className='board-card';const title=document.createElement('div');title.className='board-card-title';title.textContent=t.title;const meta=document.createElement('div');meta.className='board-card-meta';meta.textContent='優先度 '+t.priority+(t.due?' · '+t.due:'');card.append(title,meta,taskSelect(t.status,STATUS,v=>{t.status=v;touchTask(t);render();}));lane.append(card);});
      if(!items.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='タスクなし';lane.append(empty);}board.append(lane);
    });root.append(board);
  }
  function render(){
    renderSidebar();
    const page=getPage(view);$('crumb-page').textContent=view==='home'?'Overview':view==='tasks'?'データベース':page?.title||'Overview';
    if(view!=='home'&&view!=='tasks'&&!page)view='home';
    const root=$('content-area');root.replaceChildren();
    if(view==='home')renderHome(root);
    else if(view==='tasks')renderTasks(root);
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
    liveTasks().forEach(t=>{if(!needle||t.title.toLocaleLowerCase().includes(needle))add('▦',t.title,'タスク · '+t.status,'tasks');});
    if(!matches){const empty=document.createElement('div');empty.className='empty';empty.textContent='一致する結果がありません。';out.append(empty);}
  }
  function download(filename,text){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.download=filename;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},2000);}
  function exportData(){download('vctrmemo-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({...state,sync:engine.export(),exportedAt:new Date().toISOString()},null,2));toast('変更履歴を含むJSONバックアップを書き出しました。');}
  function mergeRecords(local,remote){const m=new Map(local.map(x=>[x.id,x]));for(const x of remote){if(!x||typeof x.id!=='string')continue;const prev=m.get(x.id);if(!prev||Number(x.updatedAt)>Number(prev.updatedAt))m.set(x.id,structuredClone(x));}return [...m.values()];}
  function mergeState(received){if(!validate(received))return false;state.pages=mergeRecords(state.pages,received.pages);state.tasks=mergeRecords(state.tasks,received.tasks);persist();render();return true;}
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
      if(!confirm('JSONバックアップを取り込みます。競合が発生した場合は内容を確認できます。よろしいですか？'))return;
      if(parsed.sync?.version===2&&Array.isArray(parsed.sync.ops)){
        engine.merge(parsed.sync.ops);state=engine.project();baseline=structuredClone(state);persist(true);render();
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
  if(host&&typeof host.setUpdateListener==='function'&&typeof host.sendUpdate==='function'){
    document.body.classList.add('vector-host');
    try{
      host.setUpdateListener(update=>{
        const payload=update?.payload;
        if(payload?.kind==='workspace-snapshot-v1')return; // Old format is not causally safe.
        if(payload?.kind!=='vctrmemo-ops-v2'||!Array.isArray(payload.ops)||payload.ops.length>12000)return;
        incomingQueue.push(payload.ops);
        flushIncoming();
      },0);
    }catch(err){console.warn('WebXDC listener error',err);}
  }
  $('sync-now').addEventListener('click',()=>{
    if(!host||typeof host.sendUpdate!=='function'){toast('ブラウザ版では同期できません。Vector内で開いてください。');return;}
    if(transfer?.active){toast('現在、分割送信中です。完了するまで操作しないでください。');return;}
    flushIncoming();
    const maxSize=Number(host.sendUpdateMaxSize)>0 ? Number(host.sendUpdateMaxSize) : 128000;
    let parts;
    try { parts=VctrTransfer.batches(engine.export().ops,maxSize); }
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
  persist(true);render();
})();
