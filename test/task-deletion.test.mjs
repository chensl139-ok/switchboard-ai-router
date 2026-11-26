import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderTasks} from '../public/workspace.js';

const HISTORY='/api/account/lab-history';
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const unescape=value=>value.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
const task=(id,extra={})=>({id,area:'media',kind:'image',title:`作品 ${id}`,model:'test-model',status:'completed',updatedAt:'2026-11-01T00:00:00Z',result:JSON.stringify({prompt:`prompt ${id}`}),...extra});
const A=task('A',{kind:'video',status:'running',requestId:'upstream-A'}),B=task('B');
const pageResult=(items,page=1,pages=1,total=items.length)=>({items,page,pages,total});
const httpError=status=>Object.assign(new Error(`HTTP ${status}`),{status});
const turn=()=>new Promise(setImmediate);

class Element {
 constructor(tag,document,attributes={}){this.tagName=tag.toUpperCase();this.document=document;this.attributes=attributes;this.children=[];this.parentElement=null;this.listeners={};this.open=false;}
 get dataset(){return Object.fromEntries(Object.entries(this.attributes).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),value]));}
 get isConnected(){return this===this.document.body||Boolean(this.parentElement?.isConnected);}
 get disabled(){return Object.hasOwn(this.attributes,'disabled');}
 set disabled(value){this.document.mutations++;if(value)this.attributes.disabled='';else delete this.attributes.disabled;}
 get classList(){return {add:name=>{this.attributes.class=[this.attributes.class,name].filter(Boolean).join(' ');this.document.mutations++;}};}
 get value(){return this._value??this.attributes.value??(this.tagName==='SELECT'?this.querySelector('option')?.value??'':'');}
 set value(value){this._value=value;this.document.mutations++;}
 get elements(){return Object.fromEntries(this.querySelectorAll('input, select').map(node=>[node.attributes.name,node]));}
 get textContent(){return this.children.map(child=>typeof child==='string'?child:child.textContent).join('');}
 set textContent(value){this.replaceChildren(String(value));}
 get innerHTML(){return this.children.map(child=>typeof child==='string'?esc(child):child.outerHTML).join('');}
 get outerHTML(){return `<${this.tagName.toLowerCase()}${Object.entries(this.attributes).map(([key,value])=>` ${key}="${esc(value)}"`).join('')}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;}
 set innerHTML(html){
  this.replaceChildren();const stack=[this];
  for(const token of html.match(/<[^>]+>|[^<]+/g)||[]){
   if(token.startsWith('</')){assert.equal(stack.at(-1).tagName,token.slice(2,-1).trim().toUpperCase());stack.pop();}
   else if(token.startsWith('<')){
    const tag=token.match(/^<([\w-]+)/)[1],attributes={};
    for(const match of token.slice(tag.length+1,-1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attributes[match[1]]=unescape(match[2]??match[3]??match[4]??'');
    const node=new Element(tag,this.document,attributes);stack.at(-1).append(node);
    if(!['input','img','br','hr','source','meta','link'].includes(tag)&&!token.endsWith('/>'))stack.push(node);
   }else stack.at(-1).append(unescape(token));
  }
  assert.equal(stack.length,1,'test DOM must parse the complete production markup');
 }
 append(...nodes){for(const node of nodes){if(typeof node!=='string'){if(node.parentElement)node.remove();node.parentElement=this;}this.children.push(node);}this.document.mutations++;}
 contains(node){return node===this||this.children.some(child=>typeof child!=='string'&&child.contains(node));}
 replaceChildren(...nodes){for(const child of [...this.children])if(typeof child!=='string')child.remove();this.children=[];this.append(...nodes);}
 remove(){if(!this.parentElement)return;if(this.contains(this.document.activeElement))this.document.activeElement=this.document.body;const parent=this.parentElement;parent.children.splice(parent.children.indexOf(this),1);this.parentElement=null;this.document.mutations++;}
 matches(selector){
  return selector.split(',').some(part=>{
   let simple=part.trim();if(simple.includes(':not(:disabled)')){if(this.disabled)return false;simple=simple.replace(':not(:disabled)','');}
   const id=simple.match(/^#([\w-]+)/);if(id){if(this.attributes.id!==id[1])return false;simple=simple.slice(id[0].length);}
   const tag=simple.match(/^[a-z][\w-]*/i);if(tag){if(this.tagName!==tag[0].toUpperCase())return false;simple=simple.slice(tag[0].length);}
   for(const match of simple.matchAll(/\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]/g)){if(!Object.hasOwn(this.attributes,match[1])||(match[2]!==undefined&&this.attributes[match[1]]!==match[2]))return false;}
   assert.equal(simple.replace(/\[[^\]]+\]/g,''),'',`unsupported selector: ${selector}`);return true;
  });
 }
 closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
 querySelectorAll(selector){
  const result=[];
  const matches=node=>selector.split(',').some(part=>{const pieces=part.trim().split(/\s+/);if(!node.matches(pieces.pop()))return false;let ancestor=node.parentElement;while(pieces.length){const next=pieces.pop();while(ancestor&&!ancestor.matches(next))ancestor=ancestor.parentElement;if(!ancestor)return false;ancestor=ancestor.parentElement;}return true;});
  const walk=node=>{for(const child of node.children)if(typeof child!=='string'){if(matches(child))result.push(child);walk(child);}};walk(this);return result;
 }
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
 addEventListener(type,listener){(this.listeners[type]??=[]).push(listener);}
 emit(type){
  const event={type,target:this,currentTarget:null,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
  for(let node=this;node;node=node.parentElement){event.currentTarget=node;for(const listener of [node['on'+type],...(node.listeners[type]||[])])if(listener){const result=listener(event);if(result?.then)result.catch(error=>this.document.eventErrors.push(error));}}
  return event;
 }
 click(){
  const button=this.closest('button');if(button?.disabled)return false;
  assert.ok(this.isConnected,'only connected nodes receive user clicks');
  const modal=this.document.body.querySelectorAll('dialog').find(node=>node.open);
  assert.ok(!modal||modal.contains(this),'a modal prevents clicking background cards/filters');
  (button||this).focus();const event=this.emit('click');
  if(!event.defaultPrevented&&button?.attributes.type==='submit')button.closest('form')?.emit('submit');return true;
 }
 focus(){if(this.isConnected&&!this.disabled){this.document.activeElement=this;this.document.mutations++;}}
 showModal(){this.returnFocus=this.document.activeElement;this.open=true;this.document.mutations++;this.querySelector('button')?.focus();}
 close(){if(!this.open)return;this.open=false;this.document.mutations++;if(this.returnFocus?.isConnected&&!this.returnFocus.disabled)this.returnFocus.focus();else this.document.activeElement=this.document.body;this.onclose?.();}
}

function taskDOM(){
 const document={mutations:0,eventErrors:[],createElement(tag){return new Element(tag,this);},querySelector(selector){return this.body.querySelector(selector);}};
 document.body=new Element('body',document);document.activeElement=document.body;
 const root=new Element('main',document,{id:'content'});document.body.append(root);
 return {document,root};
}

function controlledAPI(){
 const requests=[];
 const api=(path,body)=>{
  const url=new URL(path,'https://test.invalid');
  const kind=url.pathname===HISTORY+'/delete'?'delete':url.pathname===HISTORY+'/item'?'item':url.pathname==='/v1/video/status'?'remote':url.pathname===HISTORY?(body?'save':'list'):'unexpected';
  const request={path,body:body===undefined?undefined:structuredClone(body),query:url.searchParams,kind,settled:false};requests.push(request);
  assert.notEqual(kind,'unexpected',`unexpected generation/upstream operation: ${path}`);
  return new Promise((resolve,reject)=>{for(const [name,finish] of Object.entries({resolve,reject}))request[name]=value=>{assert.equal(request.settled,false,'each API response settles once');request.settled=true;finish(value);};});
 };
 return {api,requests,calls:kind=>requests.filter(request=>request.kind===kind),pending(kind){const matches=requests.filter(request=>request.kind===kind&&!request.settled);assert.equal(matches.length,1,`expected one pending ${kind} request`);return matches[0];}};
}

async function withTasks(run,{items=[A,B],role='member',initialFilters={},initialPage=pageResult(items)}={}){
 const previous=Object.fromEntries(['document','FormData','confirm'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const {document,root}=taskDOM(),api=controlledAPI();let cleanup,current=true,disposed=false;
 const h={...api,document,root,confirmations:[],confirmResult:true,deleted:[],navigations:[],
  get form(){return root.querySelector('#task-filters');},get dialog(){return root.querySelector('#task-detail');},get status(){return root.querySelector('#task-list-status').textContent;},
  $(selector){const node=root.querySelector(selector);assert.ok(node,`missing ${selector}`);return node;},
  card(id){return root.querySelectorAll('[data-task-card]').find(node=>node.dataset.taskCard===id)??null;},
  cardIds(){return root.querySelectorAll('[data-task-card]').map(node=>node.dataset.taskCard);},
  async flush(){await turn();assert.deepEqual(document.eventErrors,[]);},
  async respond(kind,value){api.pending(kind).resolve(value);await this.flush();},
  async reject(kind,error){api.pending(kind).reject(error);await this.flush();},
  async open(row){this.card(row.id).querySelector('[data-task-id]').click();assert.equal(api.pending('item').query.get('id'),row.id);await this.respond('item',row);assert.equal(this.dialog.open,true);assert.equal(this.$('#task-detail-title').textContent,row.title);},
  close(){this.$('#task-detail-close').click();assert.equal(this.dialog.open,false);},
  deleteButton(entry,id='A'){return entry==='card'?this.card(id).querySelector('[data-task-delete]'):this.$('#task-delete');},
  refresh(){this.form.querySelector('button[type=submit]').click();},
  async finishDelete(items=[B]){await this.respond('delete',{ok:true});await this.respond('list',pageResult(items));},
  leave(mode){
   if(mode==='cleanup'){cleanup();disposed=true;}else if(mode==='isCurrent')current=false;
   else if(mode==='disconnected'){root.remove();document.body.append(document.createElement('main'));}
   else assert.fail(`unknown navigation mode ${mode}`);
    if(mode!=='disconnected')root.innerHTML='<p id="task-list-status">NEW PAGE</p><div id="task-cards">NEW CARDS</div><div id="task-detail-title">NEW TITLE</div><div id="task-detail-body">NEW BODY</div><div id="task-detail-actions">NEW ACTIONS</div><p id="task-detail-error">NEW ERROR</p>';
   return {mutations:document.mutations,html:document.body.innerHTML,focus:document.activeElement,calls:api.requests.length,deleted:[...this.deleted]};
  },
  assertUntouched(snapshot){assert.equal(document.mutations,snapshot.mutations);assert.equal(document.body.innerHTML,snapshot.html);assert.equal(document.activeElement,snapshot.focus);assert.equal(api.requests.length,snapshot.calls);assert.deepEqual(this.deleted,snapshot.deleted);}
 };
 globalThis.document=document;
 globalThis.FormData=class{constructor(form){this.entries=Object.entries(form.elements).map(([name,input])=>[name,input.value]);}[Symbol.iterator](){return this.entries[Symbol.iterator]();}};
 globalThis.confirm=message=>{h.confirmations.push(message);return h.confirmResult;};
 try{
  const rendering=renderTasks({api:api.api,esc,profile:{role},navigate:route=>h.navigations.push(route),isCurrent:()=>current,initialFilters,onDelete:id=>h.deleted.push(id)});
  api.pending('list').resolve(initialPage);cleanup=await rendering;await h.flush();await run(h);
  assert.deepEqual(document.eventErrors,[]);assert.equal(api.requests.filter(request=>!request.settled).length,0,'settle every controlled response before restoring globals');
 }finally{
  try{if(!disposed)cleanup?.();}finally{for(const [key,descriptor] of Object.entries(previous))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 }
}

for(const entry of ['card','detail']){
 test(`${entry}: cancelling confirmation makes no API call or UI change`,async()=>withTasks(async h=>{
  if(entry==='detail')await h.open(A);
  h.confirmResult=false;const calls=h.requests.length,status=h.status;
  h.deleteButton(entry).click();await h.flush();
  assert.equal(h.confirmations.length,1);assert.equal(h.requests.length,calls);assert.equal(h.status,status);
  assert.deepEqual(h.cardIds(),['A','B']);assert.deepEqual(h.deleted,[]);assert.deepEqual(h.navigations,[]);
  assert.equal(h.deleteButton(entry).disabled,false);assert.equal(h.dialog.open,entry==='detail');
 }));

 for(const outcome of ['ok','404'])test(`${entry}: ${outcome} removes only local history and calls onDelete once`,async()=>withTasks(async h=>{
  if(entry==='detail')await h.open(A);
  h.deleteButton(entry).click();assert.deepEqual(h.pending('delete').body,{id:'A'});
  if(outcome==='404')await h.reject('delete',httpError(404));else await h.respond('delete',{ok:true});
  assert.deepEqual(h.cardIds(),['B']);assert.equal(h.dialog.open,false);assert.deepEqual(h.deleted,['A']);
  assert.match(h.status,/记录已删除/);await h.respond('list',pageResult([B]));
  assert.deepEqual(h.cardIds(),['B']);assert.deepEqual(h.deleted,['A']);assert.equal(h.calls('remote').length,0);assert.equal(h.calls('save').length,0);assert.deepEqual(h.navigations,[]);
  assert.equal(h.document.activeElement,h.card('B').querySelector('[data-task-id]'));
 }));

 test(`${entry}: a double click sends one request and locks both entries while pending`,async()=>withTasks(async h=>{
  if(entry==='detail')await h.open(A);
  const button=h.deleteButton(entry);assert.equal(button.click(),true);assert.equal(button.click(),false);
  assert.equal(h.calls('delete').length,1);assert.equal(h.confirmations.length,1);
  for(const selector of ['[data-task-id]','[data-task-delete]'])assert.equal(h.card('A').querySelector(selector).disabled,true);
  assert.equal(h.card('B').querySelector('[data-task-delete]').disabled,false);
  if(entry==='detail')for(const action of h.$('#task-detail-actions').querySelectorAll('button'))assert.equal(action.disabled,true);
  assert.match(h.status,/正在删除/);await h.finishDelete();
 }));
}

for(const status of ['running','submitted','completed'])test(`${status}: confirmation explains local-only deletion and warns about active billing`,async()=>withTasks(async h=>{
 h.confirmResult=false;h.deleteButton('card').click();const message=h.confirmations[0];
 for(const text of ['作品 A','仅删除本地记录','不取消上游任务','不退款','不删除外部媒体文件','平台请求日志','用量记录'])assert.ok(message.includes(text),text);
 if(status==='completed')assert.doesNotMatch(message,/上游可能继续执行并计费/);else assert.match(message,/仍在处理中或已提交，上游可能继续执行并计费/);
 assert.equal(h.calls('delete').length,0);
},{items:[task('A',{status})]}));

const failures=[
 ['HTTP 500',()=>({error:httpError(500)})],
 ['network error',()=>({error:new TypeError('Failed to fetch')})],
 ['missing response',()=>({value:undefined})],
 ['null response',()=>({value:null})],
 ['missing ok',()=>({value:{}})],
 ['false ok',()=>({value:{ok:false}})],
 ['non-boolean ok',()=>({value:{ok:'true'}})]
];
for(const entry of ['card','detail'])for(const [name,failure] of failures)test(`${entry}: ${name} retains the record and permits a confirmed retry`,async()=>withTasks(async h=>{
 if(entry==='detail')await h.open(A);
 h.deleteButton(entry).click();const outcome=failure();
 if(outcome.error)await h.reject('delete',outcome.error);else await h.respond('delete',outcome.value);
 assert.deepEqual(h.cardIds(),['A','B']);assert.deepEqual(h.deleted,[]);assert.equal(h.calls('list').length,1);
 assert.match(h.status,/删除未确认，请刷新核对后重试/);assert.doesNotMatch(h.status,/记录已删除/);
 if(outcome.error)assert.ok(h.status.includes(outcome.error.message));else assert.match(h.status,/服务器未确认删除结果/);
 assert.equal(h.card('A').querySelector('[data-task-delete]').disabled,false);assert.equal(h.card('A').querySelector('[data-task-id]').disabled,false);
 if(entry==='detail'){
  assert.equal(h.dialog.open,true);assert.equal(h.$('#task-detail-error').textContent,h.status);
  for(const action of h.$('#task-detail-actions').querySelectorAll('button'))assert.equal(action.disabled,false);
 }
 h.deleteButton(entry).click();assert.equal(h.calls('delete').length,2);assert.equal(h.confirmations.length,2);
 if(entry==='detail')assert.equal(h.$('#task-detail-error').textContent,'');
 await h.finishDelete();assert.deepEqual(h.deleted,['A']);assert.deepEqual(h.cardIds(),['B']);
 assert.equal(h.calls('remote').length,0);assert.equal(h.calls('save').length,0);
}));

for(const entry of ['card','detail'])test(`viewer: ${entry} can delete own history but cannot generate, replay or refresh upstream`,async()=>withTasks(async h=>{
 assert.equal(h.root.querySelector('#tasks-create'),null);await h.open(A);
 assert.equal(h.root.querySelector('#task-replay'),null);assert.equal(h.root.querySelector('#task-refresh-remote'),null);
 assert.equal(h.$('#task-export').disabled,false);assert.equal(h.$('#task-delete').disabled,false);
 if(entry==='card')h.close();h.deleteButton(entry).click();await h.finishDelete();
 assert.deepEqual(h.deleted,['A']);assert.deepEqual(h.navigations,[]);
 assert.ok(h.requests.every(request=>request.path.startsWith('/api/account/lab-history')));
 assert.equal(h.calls('remote').length,0);assert.equal(h.calls('save').length,0);
},{role:'viewer'}));

test('card title opens details, delete is a sibling button, and special IDs survive delegation',async()=>withTasks(async h=>{
 const row=task('id / & " <x>',{title:'作品 <标题> & "quoted"'}),card=h.card(row.id);
 assert.equal(card.tagName,'ARTICLE');assert.equal(card.querySelector('[data-task-delete]').closest('[data-task-id]'),null);
 assert.equal(card.querySelector('h3').textContent,row.title);card.querySelector('h3').click();
 assert.equal(h.pending('item').query.get('id'),row.id);await h.respond('item',row);
 assert.equal(h.$('#task-detail-title').textContent,row.title);h.close();
 h.deleteButton('card',row.id).click();assert.deepEqual(h.pending('delete').body,{id:row.id});
 await h.finishDelete([]);assert.deepEqual(h.deleted,[row.id]);assert.equal(h.calls('item').length,1);
},{items:[task('id / & " <x>',{title:'作品 <标题> & "quoted"'})]}));

for(const timing of ['during deletion','after refresh'])test(`a list response started before deletion is ignored ${timing}`,async()=>withTasks(async h=>{
 h.refresh();const oldList=h.pending('list');h.deleteButton('card').click();
 if(timing==='during deletion'){
  oldList.resolve(pageResult([task('A',{title:'STALE A'}),task('B',{title:'STALE B'})]));await h.flush();
  assert.match(h.status,/正在删除/);assert.equal(h.card('A').querySelector('[data-task-delete]').disabled,true);assert.equal(h.card('B').querySelector('h3').textContent,B.title);
 }
 await h.respond('delete',{ok:true});
 const freshList=h.calls('list').at(-1);freshList.resolve(pageResult([B]));await h.flush();
 const snapshot=h.root.innerHTML;
 if(timing==='after refresh'){oldList.resolve(pageResult([A,B]));await h.flush();}
 assert.equal(h.root.innerHTML,snapshot);assert.deepEqual(h.cardIds(),['B']);assert.deepEqual(h.deleted,['A']);
}));

test('even a post-delete stale list cannot resurrect a deleted ID or invoke its old button',async()=>withTasks(async h=>{
 const oldButton=h.deleteButton('card');oldButton.click();await h.respond('delete',{ok:true});
 await h.respond('list',pageResult([A,B]));assert.deepEqual(h.cardIds(),['B']);assert.equal(oldButton.isConnected,false);
 h.refresh();await h.respond('list',pageResult([A,B]));assert.deepEqual(h.cardIds(),['B']);
 assert.equal(h.calls('delete').length,1);assert.deepEqual(h.deleted,['A']);
}));

for(const outcome of ['resolve','reject'])test(`late detail ${outcome} cannot reopen a deleted record`,async()=>withTasks(async h=>{
 h.card('A').querySelector('[data-task-id]').click();const detail=h.pending('item');assert.equal(h.dialog.open,true);
 h.close();h.deleteButton('card').click();await h.finishDelete();const snapshot=h.root.innerHTML;
 detail[outcome](outcome==='resolve'?A:new Error('late detail failure'));await h.flush();
 assert.equal(h.dialog.open,false);assert.equal(h.root.innerHTML,snapshot);assert.deepEqual(h.cardIds(),['B']);assert.deepEqual(h.deleted,['A']);
}));

for(const entry of ['card','detail'])test(`deleting A from ${entry} does not close or disable B opened while the delete is pending`,async()=>withTasks(async h=>{
 if(entry==='detail')await h.open(A);h.deleteButton(entry).click();if(entry==='detail')h.close();
 await h.open(B);const title=h.$('#task-detail-title').textContent,body=h.$('#task-detail-body').innerHTML;
 await h.finishDelete();assert.equal(h.dialog.open,true);assert.equal(h.$('#task-detail-title').textContent,title);assert.equal(h.$('#task-detail-body').innerHTML,body);
 assert.equal(h.$('#task-delete').disabled,false);assert.equal(h.$('#task-export').disabled,false);assert.deepEqual(h.deleted,['A']);
 h.$('#task-delete').click();assert.deepEqual(h.pending('delete').body,{id:'B'});await h.finishDelete([]);assert.deepEqual(h.deleted,['A','B']);
}));

async function startRemote(h,stage){
 await h.open(A);h.$('#task-refresh-remote').click();
 assert.deepEqual(h.pending('remote').body,{requestId:'upstream-A'});assert.equal(h.$('#task-refresh-remote').disabled,true);assert.equal(h.$('#task-delete').disabled,false);
 if(stage==='save'){
  await h.respond('remote',{status:'Succeed',results:{videos:[{url:'https://example.test/video.mp4'}]}});
  assert.deepEqual(h.pending('save').body,{id:'A',area:'media',kind:'video',model:A.model,title:A.title,status:'completed',requestId:'upstream-A',result:JSON.stringify({prompt:'prompt A',videos:[{url:'https://example.test/video.mp4'}],remoteStatus:'Succeed'}),error:''});
 }
 return h.pending(stage);
}

for(const stage of ['remote','save'])for(const outcome of ['resolve','reject'])test(`late ${stage} ${outcome} after deletion cannot save/re-render/reload A or disturb B`,async()=>withTasks(async h=>{
 const pending=await startRemote(h,stage);h.$('#task-delete').click();await h.finishDelete();await h.open(B);
 const snapshot=h.root.innerHTML,count=h.requests.length;
 pending[outcome](outcome==='reject'?new Error('late upstream failure'):stage==='remote'?{status:'Succeed',results:{videos:[]}}:{...A,status:'completed'});await h.flush();
 assert.equal(h.requests.length,count);assert.equal(h.root.innerHTML,snapshot);assert.equal(h.dialog.open,true);assert.equal(h.$('#task-detail-title').textContent,B.title);
 assert.deepEqual(h.cardIds(),['B']);assert.equal(h.calls('save').length,stage==='save'?1:0);assert.deepEqual(h.deleted,['A']);
}));

for(const stage of ['remote','save'])test(`${stage} completion during an unconfirmed delete is invalidated even if deletion fails`,async()=>withTasks(async h=>{
 const pending=await startRemote(h,stage);h.$('#task-delete').click();
 pending.resolve(stage==='remote'?{status:'Succeed'}:{...A,title:'MUST NOT REPLACE A',status:'completed'});await h.flush();
 assert.equal(h.$('#task-detail-title').textContent,A.title);assert.equal(h.calls('save').length,stage==='save'?1:0);assert.equal(h.calls('list').length,1);
 await h.reject('delete',httpError(500));assert.equal(h.dialog.open,true);assert.equal(h.$('#task-delete').disabled,false);assert.equal(h.$('#task-refresh-remote').disabled,false);
 h.$('#task-delete').click();await h.finishDelete();assert.deepEqual(h.deleted,['A']);
}));

test('normal remote refresh updates the original history ID before reloading the list',async()=>withTasks(async h=>{
 await startRemote(h,'save');const updated={...A,status:'completed',result:JSON.stringify({videos:['https://example.test/video.mp4']})};
 await h.respond('save',updated);assert.equal(h.dialog.open,true);assert.equal(h.root.querySelector('#task-refresh-remote'),null);assert.equal(h.$('#task-detail-body').querySelector('video').src,'https://example.test/video.mp4');
 await h.respond('list',pageResult([updated,B]));assert.deepEqual(h.cardIds(),['A','B']);assert.equal(h.calls('save').length,1);assert.deepEqual(h.deleted,[]);
}));

for(const mode of ['cleanup','isCurrent','disconnected'])for(const stage of ['list','item','delete','remote','save'])test(`${mode}: pending ${stage} success must not touch the new DOM`,async()=>withTasks(async h=>{
 let pending;
 if(stage==='list'){h.refresh();pending=h.pending('list');}
 else if(stage==='item'){h.card('A').querySelector('[data-task-id]').click();pending=h.pending('item');}
 else if(stage==='delete'){await h.open(A);h.$('#task-delete').click();pending=h.pending('delete');}
 else pending=await startRemote(h,stage);
 const snapshot=h.leave(mode);
 pending.resolve(stage==='list'?pageResult([A,B]):stage==='delete'?{ok:true}:stage==='remote'?{status:'Succeed'}:A);await h.flush();h.assertUntouched(snapshot);
}));

for(const stage of ['list','item','delete','remote','save'])test(`isCurrent=false: pending ${stage} error must not report into the new DOM`,async()=>withTasks(async h=>{
 let pending;
 if(stage==='list'){h.refresh();pending=h.pending('list');}
 else if(stage==='item'){h.card('A').querySelector('[data-task-id]').click();pending=h.pending('item');}
 else if(stage==='delete'){h.deleteButton('card').click();pending=h.pending('delete');}
 else pending=await startRemote(h,stage);
 const snapshot=h.leave('isCurrent');pending.reject(new Error('old page failure'));await h.flush();h.assertUntouched(snapshot);
}));

test('failed post-delete refresh keeps other cards and distinguishes confirmed deletion from a delete failure',async()=>withTasks(async h=>{
 await h.open(A);h.$('#task-delete').click();await h.respond('delete',{ok:true});const survivor=h.card('B');
 await h.reject('list',new Error('list is offline'));assert.equal(h.card('B'),survivor);assert.deepEqual(h.cardIds(),['B']);assert.equal(h.dialog.open,false);
 assert.match(h.status,/记录已删除，但列表刷新失败：list is offline/);assert.doesNotMatch(h.status,/删除未确认/);assert.deepEqual(h.deleted,['A']);assert.equal(survivor.querySelector('[data-task-delete]').disabled,false);
 h.refresh();await h.respond('list',pageResult([B]));assert.deepEqual(h.cardIds(),['B']);assert.equal(h.calls('delete').length,1);
 h.deleteButton('card','B').click();assert.deepEqual(h.pending('delete').body,{id:'B'});await h.finishDelete([]);assert.deepEqual(h.deleted,['A','B']);
}));

test('ordinary list-refresh failure is not reported as confirmed deletion',async()=>withTasks(async h=>{
 h.refresh();await h.reject('list',new Error('ordinary list failure'));
 assert.equal(h.status,'ordinary list failure');assert.deepEqual(h.cardIds(),[]);assert.deepEqual(h.deleted,[]);assert.equal(h.calls('delete').length,0);
 h.refresh();await h.respond('list',pageResult([A,B]));assert.deepEqual(h.cardIds(),['A','B']);
}));

test('server pagination, search/status/order filters and page clamping survive deletion',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 await withTasks(async h=>{
  const query='视频 & model/1';assert.equal(h.form.elements.q.value,query);assert.equal(h.calls('list')[0].query.get('q'),query);
  assert.equal(h.$('#task-prev').disabled,true);assert.equal(h.$('#task-prev').click(),false);assert.equal(h.$('#task-next').disabled,false);
  h.$('#task-next').click();assert.equal(h.pending('list').query.get('page'),'2');await h.respond('list',pageResult([A],2,2,13));assert.equal(h.$('#task-next').disabled,true);
  h.form.elements.status.value='running';h.form.elements.order.value='oldest';h.form.elements.status.emit('change');
  assert.equal(h.pending('list').query.get('page'),'1');await h.respond('list',pageResult([B],1,2,13));
  h.$('#task-next').click();await h.respond('list',pageResult([A],2,2,13));
  h.deleteButton('card').click();await h.respond('delete',{ok:true});
  const params=h.pending('list').query;assert.deepEqual(Object.fromEntries(params),{q:query,status:'running',order:'oldest',area:'media',page:'2',limit:'12'});
  const remaining=Array.from({length:12},(_,index)=>task(`remaining-${index}`));await h.respond('list',pageResult(remaining,1,1,12));
  assert.equal(h.cardIds().length,12);assert.equal(h.$('#task-page').textContent,'1 / 1');assert.equal(h.$('#task-prev').disabled,true);assert.equal(h.$('#task-next').disabled,true);
  h.refresh();assert.equal(h.pending('list').query.get('page'),'1');assert.equal(h.pending('list').query.get('status'),'running');await h.respond('list',pageResult(remaining));
  const before=h.requests.length;h.form.elements.q.value='first';h.form.elements.q.emit('input');t.mock.timers.tick(200);
  h.form.elements.q.value='new & query';h.form.elements.q.emit('input');t.mock.timers.tick(249);assert.equal(h.requests.length,before);t.mock.timers.tick(1);
  assert.equal(h.pending('list').query.get('q'),'new & query');assert.equal(h.pending('list').query.get('page'),'1');await h.respond('list',pageResult([]));
 },{items:[B],initialFilters:{q:'视频 & model/1'},initialPage:pageResult([B],1,2,13)});
});

test('refresh rebuilds the row map: delete confirmation uses the newly returned status/title',async()=>withTasks(async h=>{
 const updated=task('A',{title:'最新标题',status:'submitted'});h.refresh();await h.respond('list',pageResult([updated]));
 h.confirmResult=false;h.deleteButton('card').click();assert.match(h.confirmations[0],/最新标题/);assert.match(h.confirmations[0],/上游可能继续执行并计费/);assert.equal(h.calls('delete').length,0);
},{items:[task('A',{title:'旧标题',status:'completed'})]}));

for(const entry of ['card','detail'])test(`${entry}: deleting the last record renders an empty state and restores focus to refresh`,async()=>withTasks(async h=>{
 if(entry==='detail')await h.open(A);h.deleteButton(entry).click();await h.finishDelete([]);
 assert.deepEqual(h.cardIds(),[]);assert.match(h.$('#task-cards').textContent,/暂无匹配的创作记录/);assert.match(h.status,/记录已删除 · 0 条个人创作记录/);
 assert.equal(h.$('#task-page').textContent,'1 / 1');assert.equal(h.$('#task-prev').disabled,true);assert.equal(h.$('#task-next').disabled,true);assert.equal(h.dialog.open,false);
 assert.equal(h.document.activeElement,h.form.querySelector('button[type=submit]'));assert.deepEqual(h.deleted,['A']);
},{items:[A]}));
