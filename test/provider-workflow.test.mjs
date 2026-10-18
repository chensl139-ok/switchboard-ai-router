import test from 'node:test';
import assert from 'node:assert/strict';
import {providerCards,providerHealth} from '../public/provider-ui.js';
import {catalogSnapshot,filterCatalog,catalogPage,renderModelCatalog} from '../public/model-catalog.js';
import {planProviderCards} from '../public/plan-connections.js';

const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const provider={id:'demo',name:'Example',baseUrl:'https://example.test/v1',protocol:'openai',model:'chat-a',models:['chat-a','gpt-image-1'],enabled:true,hasKey:true};
const cache={baseUrl:provider.baseUrl,protocol:provider.protocol,models:[{id:'chat-a',name:'Chat A'},{id:'chat-b',name:'Chat B'}]};

test('provider rows retain model switching, configuration and ordered management with escaped labels',()=>{
 const html=providerCards({state:{providers:[{...provider,name:'<Example>'},{...provider,id:'second'}],active:'demo',logs:[]},esc:escape,isManager:true,manage:true});
 for(const selector of ['data-provider-card','data-provider-model="demo"','data-edit="demo"','data-switch="demo"','data-provider-move="down"','data-provider-delete="demo"','data-provider-health="demo"'])assert(html.includes(selector));
 assert.match(html,/data-provider-move="up" data-provider-id="demo" disabled/);
 assert.match(html,/data-provider-move="down" data-provider-id="second" disabled/);
 assert.match(html,/&lt;Example>/);assert(!html.includes('<Example>'));
 assert.match(html,/class="provider-more"/);
 const member=providerCards({state:{providers:[provider],logs:[]},esc:escape,isManager:false,manage:true});
 assert(!member.includes('data-provider-delete'));
 assert.match(member,/data-provider-model="demo" disabled/);
});

test('provider health accepts numeric SQLite values and ignores missing latency samples',()=>{
 const health=providerHealth(provider,[{provider_id:'demo',status:'200',latency:'120'},{provider_id:'demo',status:200,latency:undefined}]);
 assert.equal(health.label,'健康');assert.match(health.detail,/100% · 120 ms/);assert(!health.detail.includes('NaN'));
});

test('catalog refresh failures preserve configured models and valid cached choices without leaking private routes',()=>{
 const personal={id:'private-own',name:'ChatGPT',private:true,enabled:true,models:['own-model'],modelNames:{'own-model':'My model'}};
 const state={providers:[provider],personalProviders:[personal],catalog:{demo:cache},logs:[]};
 const snapshot=catalogSnapshot(state,{providers:[{providerId:'demo',status:'error',error:'HTTP 401',models:[]},{providerId:'foreign',status:'ok',models:[{id:'invisible'}]}]});
 assert.equal(snapshot.errors.length,1);
 assert.deepEqual(snapshot.rows.map(row=>row.id),['chat-a','chat-b','gpt-image-1','own-model']);
 assert.equal(snapshot.rows.find(row=>row.id==='chat-b').registered,false);
 assert.equal(snapshot.rows.find(row=>row.id==='gpt-image-1').kind,'media');
 const own=snapshot.rows.at(-1);assert.equal(own.routeId,null);assert.equal(own.name,'My model');assert.equal(own.private,true);
 const changed=catalogSnapshot({...state,providers:[{...provider,baseUrl:'https://new.example/v1'}]});
 assert(!changed.rows.some(row=>row.id==='chat-b'),'a prior provider endpoint cache is not reused');
});

test('model catalog combines filters and renders bounded pages after large discovery',()=>{
 const snapshot=catalogSnapshot({providers:[provider],logs:[]},{providers:[{providerId:'demo',status:'ok',models:Array.from({length:105},(_,index)=>({id:'chat-'+index,name:'Chat '+index}))}]});
 const chat=filterCatalog(snapshot.rows,{search:' EXAMPLE ',kind:'chat',status:'available',provider:'demo'});
 assert.equal(chat.length,105);
 assert.equal(catalogPage(chat).rows.length,40);
 const last=catalogPage(chat,99);assert.equal(last.page,3);assert.equal(last.rows.length,25);assert.equal(last.start,81);assert.equal(last.end,105);
 assert.equal(catalogPage([],9).page,1);assert.equal(catalogPage([],9).start,0);
 assert.equal(filterCatalog(snapshot.rows,{kind:'media',status:'registered'}).length,1);
});

test('personal provider rows never gain shared routing or deletion controls',()=>{
 const html=planProviderCards([{id:'private-own',subscriptionId:'own',name:'ChatGPT',accountLabel:'own@example.test',models:['chat-a'],modelNames:{},enabled:true,connected:true,model:'chat-a'}],escape);
 assert.match(html,/provider-row personal-provider-card/);
 assert.match(html,/data-plan-run="own"/);assert.match(html,/data-plan-disconnect="own"/);
 assert(!html.includes('data-switch'));assert(!html.includes('data-provider-delete'));assert(!html.includes('data-provider-model'));
});

test('catalog ignores an async refresh when its view has been left',async()=>{
 let resolveDiscovery,saved=0,toasted=0;
 const elements=new Map();
 for(const id of ['catalog-search','catalog-provider','catalog-kind','catalog-registration','catalog-status','catalog-errors'])elements.set('#'+id,{value:'',textContent:'',innerHTML:''});
 const refresh={disabled:false,textContent:'',addEventListener(type,handler){this.handler=handler;}};
 elements.set('#discover-all',refresh);
 const workspace={querySelector:selector=>elements.get(selector)};
 const list={isConnected:true,innerHTML:'',closest:()=>workspace};elements.set('#catalog-list',list);
 const root={querySelector:selector=>elements.get(selector),insertAdjacentHTML(){},contains:()=>true};
 const previous=globalThis.document;globalThis.document={querySelector:()=>root};
 try{
  renderModelCatalog({state:{providers:[provider],logs:[]},api:()=>new Promise(resolve=>{resolveDiscovery=resolve;}),esc:escape,toast:()=>toasted++,isManager:true,onSaved:()=>saved++});
  assert.match(list.innerHTML,/chat-a/);
  const pending=refresh.handler({currentTarget:refresh});
  list.isConnected=false;
  resolveDiscovery({total:1,errors:0,providers:[]});await pending;
  assert.equal(saved,0);assert.equal(toasted,0);
 }finally{globalThis.document=previous;}
});
