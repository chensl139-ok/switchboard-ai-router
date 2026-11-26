// Account-scoped conversation persistence. No chat transport or tool execution here.
export const conversationDefaults={target:'auto',transport:'sse',thinking:'auto',showThinking:true,maxTokens:8192,tools:'[]'};
const clone=value=>JSON.parse(JSON.stringify(value));
const bytes=value=>new TextEncoder().encode(value).length;
const messageFields=['reasoning_content','label','status','route','stats','durationMs','outputTokens','tool_calls'];
const settingFields=Object.keys(conversationDefaults);

export function conversationMessages(messages){
 return messages.map(message=>{
  const parts=Array.isArray(message.content)?message.content:null;
  const missing=!!message.missingAttachments||!!message.video||!!parts?.some(part=>part.type!=='text');
  const result={role:message.role,content:typeof message.content==='string'?message.content:parts?parts.filter(part=>part.type==='text').map(part=>part.text||'').join('\n'):''};
  for(const key of messageFields)if(message[key]!==undefined)result[key]=clone(message[key]);
  if(missing)result.missingAttachments=true;
  return result;
 });
}
export function conversationPayload(entry,{validate=true,settings=entry.settings}={}){
 const payload={messages:conversationMessages(entry.messages),draft:entry.draft||'',settings:Object.fromEntries(settingFields.filter(key=>settings?.[key]!==undefined).map(key=>[key,settings[key]]))};
 if(validate){
  if(bytes(payload.draft)>64*1024)throw Error('草稿超过 64 KiB，尚未保存；请缩短草稿或导出本地副本。');
  if(bytes(JSON.stringify({...payload,title:entry.record?.title||''}))>1024*1024)throw Error('会话超过 1 MiB，尚未保存；请导出或另建会话，不会截断内容。');
 }
 return payload;
}
export const emptyConversation=entry=>!entry.messages.length&&!entry.draft.trim()&&(!entry.record.title||entry.record.title==='新对话');
export function conversationBlockReason(entry){
 if(!entry)return '正在加载会话';
 if(entry.deleted)return '会话已删除';
 if(entry.deleting)return '正在删除会话，请稍候';
 if(entry.error)return `${entry.conflict?'会话冲突':'尚未保存'}：${entry.error.message}。请导出、重新加载或另存分支。`;
 if(entry.starting)return '正在保存并取得运行权限，请稍候';
 if(entry.record.archived)return '此会话已归档，请取消归档或另存分支。';
 if(entry.record.status==='running'&&!entry.run)return entry.record.leaseUntil>Date.now()?'其他页面仍在生成，本会话暂时只读。':'运行租约已过期，请确认后恢复；不会自动重放请求。';
 if(entry.messages.some(message=>message.missingAttachments))return '素材未保存在服务器，无法继续原上下文。可另建纯文本会话（丢失素材）。';
 if(entry.messages.some(message=>message.tool_calls===true||message.tool_calls?.length||message.status==='等待工具结果'||message.role==='tool'))return '工具上下文未还原，不能继续。可另建纯文本会话；此页面不执行工具。';
 return '';
}

export function messageBranchDraft(entry,{index,kind='edit',text}={}){
 if(!Number.isInteger(index)||index<0||index>=entry.messages.length)throw Error('消息已改变，请重新选择');
 if(!['edit','retry'].includes(kind))throw Error('分支操作无效');
 let userIndex=index;
 if(kind==='retry'){if(entry.messages[index].role!=='assistant')throw Error('请选择要重试的助手回复');while(userIndex>=0&&entry.messages[userIndex].role!=='user')userIndex--;}
 const message=entry.messages[userIndex];
 if(!message||message.role!=='user'||typeof message.content!=='string')throw Error('这条消息包含未保存素材，不能直接编辑或重试');
 const prefix=conversationMessages(entry.messages.slice(0,userIndex));
 if([...prefix,message].some(row=>row.missingAttachments||row.video||row.tool_calls===true||row.tool_calls?.length||row.status==='等待工具结果'))throw Error('上下文包含缺失素材或工具，请先明确另建纯文本会话');
 const draft=kind==='retry'?message.content:text;
 if(typeof draft!=='string'||!draft.trim())throw Error('请输入消息内容');
 return {title:(entry.record.title||'对话').slice(0,165).replace(/[\uD800-\uDBFF]$/,'')+' · '+(kind==='retry'?'重试':'编辑'),messages:prefix,draft,settings:clone(entry.settings)};
}

export function conversationDocument(record,format='markdown',{includeReasoning=false}={}){
 if(!['json','markdown','text'].includes(format))throw Error('不支持的导出格式');
 const title=String(record.title||'未命名对话'),name=title.replace(/[\\/\u0000-\u001f\u007f:*?"<>|]/g,'_').slice(0,80).replace(/[\uD800-\uDBFF]$/,'');
 const extension={json:'json',markdown:'md',text:'txt'}[format],type={json:'application/json',markdown:'text/markdown',text:'text/plain'}[format];
 if(format==='json')return {text:JSON.stringify(record,null,2),filename:`会话-${name}.${extension}`,type};
 const md=format==='markdown',heading=value=>md?String(value).replace(/[\\`*_{}[\]<>#]/g,'\\$&'):String(value),parts=[md?'# '+heading(title):title];
 if(record.localSaveError)parts.push('注意：包含尚未保存到服务器的本地内容。');
 if(['running','interrupted','failed','stopped'].includes(record.status))parts.push('记录状态：'+record.status+'；内容可能未完成。');
 for(const message of record.messages||[]){const label=message.role==='user'?'你':message.label||'助手';parts.push(md?'## '+heading(label):'【'+label+'】',String(message.content||''));if(includeReasoning&&message.reasoning_content)parts.push(md?'### 思考内容':'【思考内容】',String(message.reasoning_content));if(message.missingAttachments)parts.push('[素材未持久保存]');if(message.tool_calls)parts.push('[工具上下文未包含在此文档中]');}
 if(record.draft)parts.push(md?'## 未发送草稿':'【未发送草稿】',record.draft);
 return {text:parts.join('\n\n')+'\n',filename:`会话-${name}.${extension}`,type};
}
export const formatConversationBytes=value=>value>=1048576?(value/1048576).toFixed(2)+' MiB':value>=1024?(value/1024).toFixed(1)+' KiB':Math.max(0,value)+' B';

export async function conversationRequest(tenantId,route='',data,{fetcher=globalThis.fetch}={}){
 const response=await fetcher('/api/account/conversations'+route,{method:data===undefined?'GET':'POST',credentials:'same-origin',headers:{'content-type':'application/json',...(tenantId?{'X-Tenant-ID':tenantId}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 let body;try{body=await response.json();}catch{throw Object.assign(Error('会话响应无法解析，请刷新确认保存状态'),{status:response.ok?undefined:response.status});}
 if(!response.ok){const error=Error(body.error?.message||`会话操作失败（HTTP ${response.status}）`);error.status=response.status;throw error;}
 return body;
}

export function createConversationClient({tenantId,userId,fetcher=globalThis.fetch,now=Date.now,timers=globalThis}={}){
 const entries=new Map(),listeners=new Set();let chain=Promise.resolve(),disposed=false,localSequence=0;
 const notify=entry=>{for(const listener of listeners)listener(entry);};
 const request=(route,data)=>conversationRequest(tenantId,route,data,{fetcher});
 const clearRunTimers=entry=>{if(!entry.run)return;timers.clearInterval(entry.run.renewTimer);timers.clearTimeout(entry.run.outputTimer);};
 const fail=(entry,error)=>{entry.error=error;entry.conflict=error.status===409;clearRunTimers(entry);entry.run?.onFailure?.(error);notify(entry);};
 const enqueue=(entry,task,{allowError=false}={})=>{
  const work=chain.then(async()=>{if(disposed)throw Error('账户会话已关闭');if(entry?.deleted)throw Error('会话已删除');if(entry?.error&&!allowError)throw entry.error;return task();});
  chain=work.catch(()=>{});
  return work.catch(error=>{if(entry&&!disposed&&!entry.deleted)fail(entry,error);throw error;});
 };
 const restoredStatuses=(messages,status)=>{if(status!=='running')for(const message of messages)if(message.status==='生成中')message.status='已停止';return messages;};
 const adopt=(entry,record,version)=>{
  if(entry.deleted)return entry;
  if(entry.id!==record.id){entries.delete(entry.id);entry.id=record.id;entries.set(entry.id,entry);}
  entry.record=record;restoredStatuses(entry.messages,record.status);entry.isNew=false;entry.savedVersion=version;notify(entry);return entry;
 };
 const fromRecord=record=>({id:record.id,record,messages:restoredStatuses(clone(record.messages||[]),record.status),draft:record.draft||'',settings:{...conversationDefaults,...record.settings},version:0,savedVersion:0,isNew:false,error:null,conflict:false,run:null,pendingImages:[],pendingVideo:null});
 const local=(settings=conversationDefaults,seed={})=>{
  const id=`local-${now()}-${++localSequence}`;
  const entry=fromRecord({id,title:seed.title||'新对话',status:'idle',revision:0,pinned:false,archived:false,messages:seed.messages||[],draft:seed.draft||'',settings:{...settings}});
  entry.isNew=true;entry.version=1;entries.set(id,entry);notify(entry);return entry;
 };
 const readOnly=entry=>entry.deleting||entry.deleted||entry.starting||entry.record.archived||(entry.record.status==='running'&&!entry.run);
 const checkpoint=entry=>{
  if(!entry.run||entry.run.finishing)return Promise.resolve(entry);
  if(entry.run.checkpoint)return entry.run.checkpoint;
  const run=entry.run;
  timers.clearTimeout(run.outputTimer);run.outputTimer=null;
  const work=enqueue(entry,async()=>{
   if(entry.run!==run)throw Error('运行状态已改变，请重新加载');
   const version=entry.version,payload=conversationPayload(entry,{settings:run.settings});
   const record=await request('/run/checkpoint',{id:run.id,expectedRevision:entry.record.revision,runId:run.runId,...payload});
   run.lastCheckpoint=now();run.revision=record.revision;return adopt(entry,record,version);
  });
  run.checkpoint=work.finally(()=>{run.checkpoint=null;});return run.checkpoint;
 };
 const flush=(entry,{force=false}={})=>{
  timers.clearTimeout(entry.draftTimer);entry.draftTimer=null;
  if(entry.deleted||entry.deleting)return Promise.resolve(entry);
  if(entry.run)return checkpoint(entry);
  return enqueue(entry,async()=>{
   if(entry.deleting)return entry;
   if(entry.isNew&&!force&&emptyConversation(entry))return entry;
   if(entry.version===entry.savedVersion&&!entry.isNew)return entry;
   if(entry.record.archived||(entry.record.status==='running'&&!entry.run))throw Error('此会话只读，未保存的内容可以导出或另存分支');
   const version=entry.version,payload=conversationPayload(entry),creating=entry.isNew;
   try{
    const record=await request(creating?'':'/update',creating?{title:entry.record.title,...payload}:{id:entry.id,expectedRevision:entry.record.revision,...payload});
    if(!record?.id||!Number.isInteger(record.revision))throw Error('保存响应不完整，请刷新确认');
    entry.createUncertain=false;return adopt(entry,record,version);
   }catch(error){if(creating&&(!error.status||error.status>=500))entry.createUncertain=true;throw error;}
  });
 };
 const change=(entry,patch)=>{
  if(readOnly(entry))return false;
  Object.assign(entry,patch);entry.version++;notify(entry);
  timers.clearTimeout(entry.draftTimer);
  if(!entry.error)entry.draftTimer=timers.setTimeout(()=>{entry.draftTimer=null;void flush(entry).catch(()=>{});},500);
  return true;
 };
 const load=(id,{reload=false}={})=>{
  const old=entries.get(id);if(old&&!reload)return Promise.resolve(old);
  if(old?.run||old?.starting)return Promise.reject(Error('请先停止本页生成再重新加载'));
  return enqueue(null,async()=>{
   const record=await request('/item?id='+encodeURIComponent(id));
   const entry=fromRecord(record);
   if(old){timers.clearTimeout(old.draftTimer);if(old.error||old.version!==old.savedVersion)entry.backup={...clone(old.record),...conversationPayload(old,{validate:false})};else entry.backup=old.backup;}
   entries.set(id,entry);notify(entry);return entry;
  });
 };
 const start=async(entry,{messages,draft='',settings=entry.settings,onFailure}={})=>{
  if(entry.run||entry.starting)throw Error('本会话正在生成');
  if(conversationBlockReason(entry))throw Error(conversationBlockReason(entry));
  // Flush before setting starting: ordinary update must still be allowed here.
  const pending=flush(entry,{force:true});entry.starting=true;notify(entry);
  try{
   await pending;
   return await enqueue(entry,async()=>{
    const capturedSettings=clone(settings),capturedMessages=conversationMessages(messages);
    const payload=conversationPayload({...entry,messages,draft,settings:capturedSettings});
    const record=await request('/run/start',{id:entry.id,expectedRevision:entry.record.revision,...payload});
    entry.messages=messages;entry.draft=draft;entry.settings=capturedSettings;entry.version++;
    entry.run={owner:userId,tenantId,id:record.id,runId:record.runId,revision:record.revision,messages:capturedMessages,settings:capturedSettings,onFailure,lastCheckpoint:now()};
    entry.run.renewTimer=timers.setInterval(()=>{if(entry.run&&!entry.error)void checkpoint(entry).catch(()=>{});},25000);
    adopt(entry,record,entry.version);return entry.run;
   });
  }finally{entry.starting=false;notify(entry);}
 };
 const output=entry=>{
  if(!entry.run||entry.error)return;
  entry.version++;
  if(entry.run.outputTimer||entry.run.checkpoint)return;
  entry.run.outputTimer=timers.setTimeout(()=>{if(entry.run){entry.run.outputTimer=null;void checkpoint(entry).catch(()=>{});}},Math.max(0,5000-(now()-entry.run.lastCheckpoint)));
 };
 const finish=async(entry,status)=>{
  const run=entry.run;if(!run)return;run.finishing=true;clearRunTimers(entry);timers.clearTimeout(entry.draftTimer);
  try{return await enqueue(entry,async()=>{
   const version=entry.version,payload=conversationPayload(entry,{settings:run.settings});
   const record=await request('/run/finish',{id:run.id,expectedRevision:entry.record.revision,runId:run.runId,...payload,status});
   return adopt(entry,record,version);
  });}finally{entry.run=null;notify(entry);if(!disposed&&!entry.error&&entry.version!==entry.savedVersion)void flush(entry).catch(()=>{});}
 };
 const update=async(entry,patch)=>{
  if(entry.deleting||entry.deleted)throw Error('会话正在删除或已删除');
  if(entry.run||entry.record.status==='running')throw Error('运行中的会话不能修改，请先停止或恢复');
  await flush(entry,{force:true});
  return enqueue(entry,async()=>adopt(entry,await request('/update',{id:entry.id,expectedRevision:entry.record.revision,...patch}),entry.savedVersion));
 };
 const recover=entry=>enqueue(entry,async()=>{
  if(entry.run||entry.record.status!=='running'||entry.record.leaseUntil>now())throw Error('仅可恢复租约已过期的运行');
  return adopt(entry,await request('/run/recover',{id:entry.id,expectedRevision:entry.record.revision}),entry.savedVersion);
 });
 const remove=entry=>{
  if(entry.deleted)return Promise.resolve();
  if(entry.deletePromise)return entry.deletePromise;
  if(entry.run||entry.starting||entry.record.status==='running')return Promise.reject(Error('请先停止生成或恢复过期会话'));
  entry.deleting=true;timers.clearTimeout(entry.draftTimer);entry.draftTimer=null;notify(entry);
  const work=enqueue(entry,async()=>{
   if(entry.isNew&&entry.createUncertain)throw Error('创建结果尚未确认。请先导出本地副本并刷新列表核对；不能确认服务器记录已删除。');
   if(!entry.isNew)try{await request('/delete',{id:entry.id,expectedRevision:entry.record.revision});}catch(error){if(error.status!==404)throw error;}
   entry.deleted=true;entry.error=null;entries.delete(entry.id);notify(entry);
  },{allowError:true});
  entry.deletePromise=work.finally(()=>{entry.deleting=false;entry.deletePromise=null;notify(entry);});return entry.deletePromise;
 };
 const branch=async(entry,{textOnly=false}={})=>{
  let messages=conversationMessages(entry.messages);
  if(textOnly)messages=messages.filter(message=>['user','assistant'].includes(message.role)).map(({missingAttachments,tool_calls,...message})=>({...message,...(message.status==='等待工具结果'?{status:'完成'}:{})}));
  const copy=local({...entry.settings},{title:`${entry.record.title||'对话'} · ${textOnly?'纯文本':'分支'}`,messages,draft:entry.draft});
  try{await flush(copy,{force:true});}catch(error){error.localEntry=copy;throw error;}return copy;
 };
 const branchMessage=async(entry,options,{isCurrent=()=>true}={})=>{
  if(entry.run||entry.starting||entry.record.status==='running')throw Error('请先结束当前生成');
  const localVersion=entry.version,seed=messageBranchDraft(entry,options);
  const current=()=>isCurrent()&&entry.version===localVersion;
  if(!current())throw Error('操作已取消，未发送模型请求');
  await flush(entry);
  if(!current())throw Error('会话已切换或消息已改变，请重新操作');
  const revision=entry.record.revision,latest=await enqueue(null,()=>request('/item?id='+encodeURIComponent(entry.id)));
  if(latest.revision!==revision){const error=Object.assign(Error('源会话已在其他页面修改，请先重新加载'),{status:409});fail(entry,error);throw error;}
  if(!current())throw Error('操作已取消，未发送模型请求');
  const copy=local(seed.settings,seed);await flush(copy,{force:true});return copy;
 };
 const importHistory=historyId=>enqueue(null,async()=>{const record=await request('/import',{historyId});const cached=entries.get(record.id);if(cached)return cached;const entry=fromRecord(record);entries.set(entry.id,entry);return entry;});
 const exportEntry=entry=>({...clone(entry.record),...conversationPayload(entry,{validate:false}),...(entry.error?{localSaveError:{message:entry.error.message,status:entry.error.status}}:{})});
 return {entries,local,load,change,flush,start,output,checkpoint,finish,update,recover,remove,branch,branchMessage,importHistory,exportEntry,readOnly,
  list:params=>enqueue(null,()=>request('?'+new URLSearchParams({q:'',archived:'false',page:'1',limit:'20',...params}))),
  subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
  dispose(){disposed=true;for(const entry of entries.values()){timers.clearTimeout(entry.draftTimer);clearRunTimers(entry);}listeners.clear();},
 };
}

// Optional adapter for hosts; playground supplies message/composer callbacks.
export function mountConversations(root,{client,entry,initialConversationId,onSelect,onBeforeSelect,onConversationChange,onLoading,onStateChange,onError}={}){
 const canvas=root.querySelector('.chat-canvas');
 const layout=document.createElement('div');layout.className='conversation-layout';
 const toggle=document.createElement('button');toggle.type='button';toggle.className='conversation-mobile-toggle';toggle.textContent='会话列表';toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','conversation-rail');
 const rail=document.createElement('aside');rail.id='conversation-rail';rail.className='conversation-rail';rail.setAttribute('aria-label','持久会话');
 rail.innerHTML='<div class="conversation-toolbar"><strong>我的会话</strong><button type="button" data-new>新建</button></div><input type="search" aria-label="搜索会话" placeholder="搜索会话"><select aria-label="归档筛选"><option value="false">当前会话</option><option value="true">已归档</option><option value="all">全部会话</option></select><div class="conversation-list" role="list"></div><div class="conversation-toolbar"><button type="button" data-prev>上一页</button><span data-count></span><button type="button" data-next>下一页</button><button type="button" data-refresh>刷新</button></div><p class="conversation-list-state" role="status"></p>';
 const workspace=document.createElement('div');workspace.className='conversation-workspace';
 const toolbar=document.createElement('div');toolbar.className='conversation-toolbar';
 toolbar.innerHTML='<strong data-title></strong><button type="button" data-export>导出</button><button type="button" data-branch>另存分支</button><details class="conversation-more"><summary>会话管理</summary><div><button type="button" data-rename>重命名</button><button type="button" data-pin>置顶</button><button type="button" data-archive>归档</button><button type="button" data-reload>重新加载</button><button type="button" data-delete class="danger-text">删除会话</button></div></details><button type="button" data-backup hidden>导出本地副本</button><button type="button" data-text hidden>另建纯文本会话</button><button type="button" data-recover hidden>恢复会话</button>';
 const saveState=document.createElement('p');saveState.className='conversation-save-state';saveState.setAttribute('role','status');
 const capacity=document.createElement('div');capacity.className='conversation-capacity';capacity.innerHTML='<span data-capacity-label>正在读取存储用量…</span><progress max="100" value="0" aria-label="个人会话存储使用率"></progress><small>包括已归档会话；不会自动清理。</small>';rail.append(capacity);
 const currentSize=document.createElement('small');currentSize.className='conversation-size';currentSize.setAttribute('aria-live','polite');
 const exportDialog=document.createElement('dialog');exportDialog.className='conversation-export-dialog';exportDialog.innerHTML='<form method="dialog"><h2>导出对话</h2><p>直接导出当前内容，不会调用模型。未保存的草稿也会包含。</p><label>文件格式<select name="format"><option value="markdown">Markdown 文档</option><option value="text">纯文本</option><option value="json">JSON 完整备份</option></select></label><label class="check"><input type="checkbox" name="reasoning"> 包含思考内容（Markdown / 文本）</label><p class="muted">JSON 保留原有完整备份信息；请妥善保存导出文件。</p><div class="dialog-actions"><button value="cancel">取消</button><button type="button" class="primary" data-download>下载文件</button></div></form>';root.append(exportDialog);
 canvas.before(layout);layout.append(toggle,rail,workspace);workspace.append(toolbar,saveState,currentSize,canvas);
 let current=entry,page=1,pages=1,epoch=0,openEpoch=0,searchTimer=null,destroyed=false,lastId,refreshTimer=null,usage=null,exportSource=null;
 const list=rail.querySelector('.conversation-list'),listState=rail.querySelector('.conversation-list-state'),search=rail.querySelector('input'),filter=rail.querySelector('select');
 const error=err=>{if(destroyed)return;listState.textContent=err.message;onError?.(err);};
 const action=fn=>async()=>{try{await fn();}catch(err){error(err);}};
 const downloadFile=doc=>{const url=URL.createObjectURL(new Blob([doc.text],{type:doc.type+';charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=doc.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const download=(data,name)=>downloadFile({...conversationDocument(data,'json'),filename:`会话-${name}.json`});
 exportDialog.querySelector('[data-download]').onclick=()=>{if(!exportSource||destroyed)return;const form=exportDialog.querySelector('form');downloadFile(conversationDocument(client.exportEntry(exportSource),form.elements.format.value,{includeReasoning:form.elements.reasoning.checked}));exportDialog.close();};
 exportDialog.onclose=()=>{exportSource=null;};
 const redraw=()=>{
  if(destroyed||!current)return;
  toolbar.querySelector('[data-title]').textContent=current.record.title||'新对话';
  const blocked=conversationBlockReason(current),dirty=current.version!==current.savedVersion;
  saveState.dataset.state=current.conflict?'conflict':current.error?'error':dirty?'unsaved':'saved';
  saveState.textContent=blocked||(current.isNew&&emptyConversation(current)?'尚未开始 · 输入消息后自动保存':current.run?'正在生成 · 检查点自动保存':dirty?'未保存 · 正在同步':'已保存');
  const payload=conversationPayload(current,{validate:false}),localBytes=bytes(JSON.stringify({title:current.record.title||'',...payload})),draftBytes=bytes(payload.draft);
  currentSize.textContent=`已保存 ${formatConversationBytes(current.record.bytes||0)} · 当前内容 ${formatConversationBytes(localBytes)} / 1 MiB · 草稿 ${formatConversationBytes(draftBytes)} / 64 KiB${dirty?'（待同步）':''}`;
  currentSize.classList.toggle('capacity-warning',localBytes>=1048576*.8||draftBytes>=65536*.8);
  if(usage){const percent=Math.min(100,usage.bytes/usage.limits.bytes*100);capacity.querySelector('[data-capacity-label]').textContent=`${usage.count} / ${usage.limits.count} 个会话 · ${formatConversationBytes(usage.bytes)} / ${formatConversationBytes(usage.limits.bytes)}`;capacity.querySelector('progress').value=percent;capacity.classList.toggle('capacity-warning',percent>=80||usage.count/usage.limits.count>=.8);}
  const running=current.record.status==='running'||!!current.starting||current.deleting||current.deleted;
  toolbar.querySelector('[data-delete]').textContent=current.deleting?'正在删除…':current.isNew?'丢弃草稿':'删除会话';
  for(const key of ['rename','pin','archive','delete'])toolbar.querySelector(`[data-${key}]`).disabled=running;
  toolbar.querySelector('[data-pin]').textContent=current.record.pinned?'取消置顶':'置顶';
  toolbar.querySelector('[data-archive]').textContent=current.record.archived?'取消归档':'归档';
  toolbar.querySelector('[data-reload]').disabled=!!current.run||!!current.starting||current.isNew;
  toolbar.querySelector('[data-recover]').hidden=!running||!!current.run||current.record.leaseUntil>Date.now();
  toolbar.querySelector('[data-text]').hidden=!current.messages.some(message=>message.missingAttachments||message.tool_calls===true||message.tool_calls?.length||message.status==='等待工具结果');
  toolbar.querySelector('[data-backup]').hidden=!current.backup;
  const id=current.isNew?null:current.id;if(id!==lastId){lastId=id;onConversationChange?.(id);}
  for(const row of list.children){row.classList.toggle('is-active',row.dataset.id===current.id);row.querySelector('button')?.setAttribute('aria-current',row.dataset.id===current.id?'true':'false');}
 };
 const select=value=>{if(destroyed)return;onBeforeSelect?.();current=value;client.current=value;onSelect?.(value);redraw();layout.classList.remove('is-open');toggle.setAttribute('aria-expanded','false');};
 const refresh=async()=>{
  const generation=++epoch;listState.textContent='正在加载…';
  try{
   const result=await client.list({q:search.value.trim(),archived:filter.value,page:String(page)});
   if(destroyed||generation!==epoch)return;
   page=result.page;pages=result.pages;usage=result.usage||null;list.replaceChildren();
   const localRows=[...client.entries.values()].filter(value=>!value.deleted&&(value.isNew||value.error||value.version!==value.savedVersion)&&(!emptyConversation(value)||value.error)&&!result.items.some(row=>row.id===value.id)&&(filter.value==='all'||String(!!value.record.archived)===filter.value)&&(!search.value.trim()||`${value.record.title} ${value.draft}`.includes(search.value.trim()))).map(value=>({...value.record,id:value.id,title:`${value.record.title||'新对话'} · 本地未保存`}));
   for(const row of [...localRows,...result.items]){const article=document.createElement('div');article.className='conversation-row';article.dataset.id=row.id;article.setAttribute('role','listitem');const button=document.createElement('button');button.type='button';button.textContent=`${row.pinned?'置顶 · ':''}${row.title||'新对话'}${row.status==='running'?' · 生成中':''}`;button.onclick=action(()=>open(row.id));article.append(button);list.append(article);}
   rail.querySelector('[data-count]').textContent=`${result.total} 条 · ${page}/${pages}`;rail.querySelector('[data-prev]').disabled=page<=1;rail.querySelector('[data-next]').disabled=page>=pages;listState.textContent=result.items.length?'':'暂无会话';redraw();
  }catch(err){if(generation===epoch)error(err);}
 };
 const open=async(id,{reload=false}={})=>{const generation=++openEpoch;onLoading?.(true);try{const value=await client.load(id,{reload});if(!destroyed&&generation===openEpoch)select(value);return value;}finally{if(!destroyed&&generation===openEpoch)onLoading?.(false);}};
 const newConversation=()=>{openEpoch++;onLoading?.(false);if(current.isNew&&emptyConversation(current)&&!current.error&&!current.deleting)return;select(client.local({...current.settings}));};
 toggle.onclick=()=>{const expanded=layout.classList.toggle('is-open');toggle.setAttribute('aria-expanded',String(expanded));};
 rail.querySelector('[data-new]').onclick=newConversation;
 rail.querySelector('[data-refresh]').onclick=()=>void refresh();
 rail.querySelector('[data-prev]').onclick=()=>{page--;void refresh();};rail.querySelector('[data-next]').onclick=()=>{page++;void refresh();};
 search.oninput=()=>{epoch++;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{page=1;void refresh();},250);};filter.onchange=()=>{page=1;void refresh();};
 const mutation=fn=>action(async()=>{await fn(current);toolbar.querySelector('.conversation-more').open=false;redraw();onSelect?.(current);await refresh();});
 toolbar.querySelector('[data-rename]').onclick=mutation(async value=>{const title=prompt('会话名称',value.record.title||'');if(title?.trim())await client.update(value,{title:title.trim()});});
 toolbar.querySelector('[data-pin]').onclick=mutation(value=>client.update(value,{pinned:!value.record.pinned}));
 toolbar.querySelector('[data-archive]').onclick=mutation(value=>client.update(value,{archived:!value.record.archived}));
 toolbar.querySelector('[data-delete]').onclick=action(async()=>{
  const value=current;if(value.deleting||value.deleted)return;
  if(!confirm(`${value.isNew?'丢弃草稿':'删除'}“${value.record.title||'新对话'}”？此操作不可撤销。`))return;
  await client.remove(value);if(destroyed)return;
  if(current===value){select(client.local({...value.settings}));const empty=current;try{const rows=await client.list({archived:filter.value,q:search.value.trim(),limit:'1'});if(!destroyed&&current===empty&&emptyConversation(empty)&&rows.items.length)await open(rows.items[0].id);}catch(err){error(err);}}
  toolbar.querySelector('.conversation-more').open=false;await refresh();
 });
 toolbar.querySelector('[data-export]').onclick=()=>{exportSource=current;exportDialog.querySelector('form').reset();exportDialog.showModal();};
 toolbar.querySelector('[data-backup]').onclick=()=>download(current.backup,`${current.id}-本地副本`);
 const fork=textOnly=>action(async()=>{if(textOnly&&!confirm('仅保留文字，素材与工具调用上下文将丢失。新建纯文本会话？'))return;try{select(await client.branch(current,{textOnly}));}catch(err){if(err.localEntry)select(err.localEntry);throw err;}await refresh();});
 toolbar.querySelector('[data-branch]').onclick=fork(false);toolbar.querySelector('[data-text]').onclick=fork(true);
 toolbar.querySelector('[data-reload]').onclick=action(async()=>{if(!confirm('重新加载服务器版本？未保存内容将保留为可导出的本地副本。'))return;await open(current.id,{reload:true});});
 toolbar.querySelector('[data-recover]').onclick=mutation(async value=>{if(confirm('上游可能仍在执行，恢复不会停止上游，也不会重发请求。确认恢复为中断状态？'))await client.recover(value);});
 const unsubscribe=client.subscribe(value=>{if(destroyed)return;if(value===current){redraw();onStateChange?.(value);}clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>void refresh(),700);});
 const leaseTimer=setInterval(()=>{if(current?.record.status==='running')redraw();},1000);
 const ready=initialConversationId?open(initialConversationId).catch(err=>{error(err);throw err;}):Promise.resolve(select(entry));
 void ready.catch(()=>{});void refresh();
 return {ready,open,newConversation,refresh,select,get current(){return current;},destroy(){destroyed=true;if(exportDialog.open)exportDialog.close();openEpoch++;epoch++;unsubscribe();clearTimeout(searchTimer);clearTimeout(refreshTimer);clearInterval(leaseTimer);}};
}
