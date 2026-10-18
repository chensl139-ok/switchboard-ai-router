// Commands are rebuilt from the current session on every search. No credentials,
// recent activity, or tenant-specific results are stored in browser storage.
export const shortcutLabel=(key,platform=globalThis.navigator?.userAgentData?.platform||globalThis.navigator?.platform||'')=>`${/mac|iphone|ipad/i.test(platform)?'⌘':'Ctrl'} ${key}`;
export const pageCommands=[
 ['overview','概览','控制台 dashboard'],['providers','服务商与模型','provider 配置 订阅'],
 ['models','模型目录','model 搜索'],['routing','路由策略','fallback 备用 故障转移'],
 ['playground','模型实验室 · 对话','chat 测试'],['media','模型实验室 · 媒体','图片 音频 视频 视觉'],
 ['keys','API Key 管理','密钥 key'],['connect','接入向导','codex claude 客户端'],
 ['api','API 文档','curl 协议 openapi'],['logs','请求日志','log 调用链'],
 ['analytics','用量分析','token 成本 统计'],['prices','模型价格','price 定价'],
 ['members','成员与角色','组织 用户'],['audit','组织审计','操作记录'],
 ['subscription','组织订阅','套餐 权益'],['account','账户与租户','密码 飞书 安全']
];

export function findCommands(query,allowed,models=[]){
 const words=String(query||'').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 const pages=pageCommands.filter(([id])=>allowed(id)).map(([id,label,terms])=>({id,label,detail:'页面',terms,kind:'page'}));
 const candidates=[...pages,...(words.length&&allowed('playground')?models.map(model=>({...model,kind:'model',detail:'在实验室中测试',terms:'模型 运行 测试'})):[])];
 return candidates.filter(item=>words.every(word=>`${item.label} ${item.terms||''}`.toLocaleLowerCase().includes(word))).slice(0,24);
}

export function mountCommandMenu({trigger,canOpen,models,loadModels,navigate,runModel}){
 const dialog=document.createElement('dialog');dialog.className='command-menu';dialog.setAttribute('aria-label','搜索页面与模型');
 dialog.innerHTML='<div class="command-search"><input type="search" id="command-query" aria-label="搜索页面与模型" placeholder="搜索页面、功能或模型…" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="command-results"><button type="button" aria-label="关闭搜索">Esc</button></div><div id="command-results" class="command-results" role="listbox" aria-label="搜索结果"></div><p class="command-help">↑ ↓ 选择<span>Enter 打开</span><span>⌘ / Ctrl K 搜索</span></p>';
 document.body.append(dialog);
 const input=dialog.querySelector('input'),list=dialog.querySelector('.command-results');
 let hits=[],index=0,previous,epoch=0;
 function select(next){
  index=Math.max(0,Math.min(next,hits.length-1));
  list.querySelectorAll('[role=option]').forEach((node,i)=>node.setAttribute('aria-selected',String(i===index)));
  if(hits.length){input.setAttribute('aria-activedescendant',`command-result-${index}`);list.children[index]?.scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');
 }
 function choose(item){
  if(!item)return;
  // Recheck access at activation, as an asynchronous tenant switch can finish
  // while the dialog is open.
  if(!canOpen(item.kind==='model'?'playground':item.id)){refresh();return;}
  dialog.close();
  if(item.kind==='model'){
   const current=models().find(model=>model.id===item.id);
   if(current)runModel(current); // Never reuse a model from another tenant.
  }else navigate(item.id);
 }
 function refresh(){
  hits=findCommands(input.value,canOpen,models());list.replaceChildren();
  if(!hits.length){const empty=document.createElement('p');empty.textContent='没有匹配的页面或已配置模型';list.append(empty);}
  hits.forEach((item,i)=>{
   const row=document.createElement('button');row.type='button';row.id=`command-result-${i}`;row.setAttribute('role','option');row.tabIndex=-1;
   const title=document.createElement('span'),detail=document.createElement('small');title.textContent=item.label;detail.textContent=item.detail;row.append(title,detail);
   row.onpointermove=()=>select(i);row.onclick=()=>choose(item);list.append(row);
  });select(0);
 }
 function open(){
  if(!canOpen('overview'))return;previous=document.activeElement;input.value='';if(!dialog.open)dialog.showModal();refresh();input.focus();
  const request=++epoch;
  // Shared models are immediate. Refresh only this user's private model list on
  // demand; never keep a background subscription-catalog polling loop.
  if(loadModels)void loadModels().then(()=>{if(dialog.open&&epoch===request)refresh();}).catch(()=>{});
 }
 trigger.onclick=open;dialog.querySelector('button').onclick=()=>dialog.close();
 input.oninput=refresh;
 input.onkeydown=event=>{if(event.isComposing||event.keyCode===229)return;if(['ArrowDown','ArrowUp','Enter'].includes(event.key)){event.preventDefault();if(event.key==='Enter')choose(hits[index]);else select(index+(event.key==='ArrowDown'?1:-1));}};
 dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
 dialog.addEventListener('close',()=>{epoch++;hits=[];list.replaceChildren();input.value='';previous?.isConnected&&previous.focus();});
 document.addEventListener('keydown',event=>{
  if(event.isComposing||event.keyCode===229)return;
  const typing=event.target.closest?.('input,textarea,select,[contenteditable=true]');
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'||event.key==='/'&&!typing){
   if(document.querySelector('dialog[open]')&&!dialog.open)return;
   event.preventDefault();open();
  }
 });
 return {close:()=>dialog.open&&dialog.close()};
}
