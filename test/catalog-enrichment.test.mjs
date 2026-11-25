import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogSnapshot,catalogPriceSummary,filterCatalog,catalogPage,renderModelCatalog} from '../public/model-catalog.js';

const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const provider={id:'p',name:'Provider',baseUrl:'https://example.test/v1',protocol:'openai',models:['gpt-5','claude-sonnet','image-model'],enabled:true,hasKey:true};
const now=Date.parse('2026-11-01T00:00:00Z');
const quote={currency:'USD',inputPerMillion:0,outputPerMillion:3,perRequest:0.01,source:'openrouter-reference',referenceModel:'vendor/model',observedAt:'2026-10-01T00:00:00Z',expiresAt:'2026-10-08T00:00:00Z'};

test('catalog uses explicit model protocols before shared inference and provider fallback',()=>{
 const state={providers:[{...provider,models:[...provider.models,'plain','vendor/moss-vl-1.0'],modelProtocols:{'gpt-5':'openai','claude-sonnet':'responses',plain:'invalid'}}]};
 const rows=catalogSnapshot(state).rows;
 assert.deepEqual(rows.map(row=>row.protocol),['openai','responses','openai','openai','responses']);
 assert.equal(rows[0].protocolLabel,'OpenAI Chat Completions');
 assert.deepEqual(rows[2].capabilities,['图片生成']);
 assert.deepEqual(rows.at(-1).capabilities,['视觉理解 · 非对话']);
 const inferred=catalogSnapshot({providers:[provider]}).rows;
 assert.equal(inferred[0].protocol,'responses');assert.equal(inferred[1].protocol,'anthropic');
 assert.equal(catalogSnapshot({providers:[{...provider,protocol:'anthropic',models:['plain']}]}).rows[0].protocol,'anthropic');
});

test('catalog quotes preserve known zero, missing rates, currencies and real billing units',()=>{
 const summary=price=>catalogPriceSummary({...provider,prices:{m:price}},'m',now);
 assert.equal(summary(undefined).known,false);assert.deepEqual(summary(undefined).lines,['价格未知']);
 const token=summary(quote);assert.equal(token.known,true);assert.match(token.lines[0],/USD \/ 百万 Tokens · 输入 0 \/ 输出 3/);assert.match(token.lines[1],/0.01 USD \/ 请求/);
 for(const value of [null,undefined,'',NaN,-1]){
  const unknown=summary({...quote,inputPerMillion:value});assert.equal(unknown.known,false);assert.match(unknown.lines[0],/输入 未知/);
 }
 for(const [billingUnit,key,unit] of [['image','perImage','张图片'],['video','perVideo','个视频'],['audio','perThousandChars','千字符']]){
  const media=summary({billingUnit,[key]:0,currency:'CNY',source:'manual',expiresAt:null});
  assert.equal(media.known,true);assert.deepEqual(media.lines,[`CNY 0 / ${unit}`]);assert.equal(media.validity,'长期有效');assert.doesNotMatch(media.lines.join(' '),/Token/);
 }
 const unsupported=summary({billingUnit:'subscription',currency:'USD',inputPerMillion:5,outputPerMillion:10});
 assert.equal(unsupported.known,false);assert.deepEqual(unsupported.lines,['计价单位未知']);
 const cached=summary({...quote,cachedInputPerMillion:0});assert.match(cached.lines[1],/缓存读 0 \/ 写 未知/);
});

test('reference review deadlines are distinct from expiry and schedules remain base quotes',()=>{
 const summarize=price=>catalogPriceSummary({...provider,prices:{m:price}},'m',now);
 const reference=summarize(quote);assert.equal(reference.expired,true);assert.match(reference.validity,/复核已逾期/);assert.match(reference.source,/OpenRouter 参考价 · vendor\/model/);assert.match(reference.notice,/复核期限非上游承诺有效期/);assert.match(reference.notice,/采集于/);
 const manual=summarize({...quote,source:'manual'});assert.match(manual.validity,/已过期/);assert.doesNotMatch(manual.validity,/复核/);
 assert.match(summarize({...quote,expiresAt:'2026-12-01T00:00:00Z'}).validity,/复核截至/);
 assert.match(summarize({...quote,expiresAt:null}).validity,/未设复核期限/);
 assert.match(summarize({...quote,expiresAt:'bad-date'}).validity,/期限无效/);
 const scheduled={...quote,periods:[{inputPerMillion:99}],timeZone:'UTC'};
 const before=structuredClone(scheduled),result=summarize(scheduled);assert.match(result.notice,/基础价.*1 个分时时段（UTC）/);assert.match(result.lines[0],/输入 0/);assert.deepEqual(scheduled,before);
});

test('private subscriptions never acquire public routes or per-token prices; failed discovery keeps enriched pages',()=>{
 const own={...provider,id:'own',private:true,prices:{'gpt-5':quote}};
 const cached=Array.from({length:85},(_,index)=>({id:'model-'+index}));
 const state={providers:[{...provider,prices:{'gpt-5':quote}}],personalProviders:[own],catalog:{p:{baseUrl:provider.baseUrl,protocol:provider.protocol,models:cached}}};
 const snapshot=catalogSnapshot(state,{providers:[{providerId:'p',status:'error',error:'HTTP 401',models:[]}]});
 assert.equal(snapshot.errors.length,1);assert.equal(snapshot.rows.length,91);
 for(const row of snapshot.rows.filter(row=>row.private)){assert.equal(row.routeId,null);assert.equal(row.price.known,false);assert.match(row.price.lines[0],/不折算单 Token/);}
 const available=filterCatalog(snapshot.rows,{provider:'p',status:'available'});assert.equal(available.length,85);assert.equal(catalogPage(available,3).rows.length,5);
 assert.equal(snapshot.rows.find(row=>row.providerId==='p'&&row.id==='gpt-5').price.known,true);
});

test('catalog renders escaped enrichment, filtering and model registration without price calls',async()=>{
 const elements=new Map();
 for(const id of ['catalog-search','catalog-provider','catalog-kind','catalog-registration','catalog-status','catalog-errors'])elements.set('#'+id,{value:'',textContent:'',innerHTML:''});
 const workspace={querySelector:selector=>elements.get(selector)};
 const list={isConnected:true,innerHTML:'',closest:()=>workspace};elements.set('#catalog-list',list);
 const root={querySelector:selector=>elements.get(selector),insertAdjacentHTML(){},contains:()=>true};
 const previous=globalThis.document;globalThis.document={querySelector:()=>root};
 const dangerous='<img src=x onerror="bad()">';
 const p={...provider,name:dangerous,prices:{'gpt-5':{...quote,source:dangerous,currency:dangerous}}};
 const state={providers:[p],catalog:{p:{baseUrl:p.baseUrl,protocol:p.protocol,models:[{id:'gpt-5'},{id:'new-model',name:dangerous}]}}};
 const calls=[];let saved;
 try{
  renderModelCatalog({state,esc,toast:()=>{},isManager:true,onSaved:value=>saved=value,api:async(url,body)=>{calls.push([url,body]);return {providers:[{...p,models:[...p.models,'new-model']}],catalog:state.catalog};}});
  for(const className of ['catalog-summary','catalog-protocol','catalog-price','tag'])assert.ok(list.innerHTML.includes(className));
  assert.match(list.innerHTML,/已记录价格 1/);assert.match(list.innerHTML,/参考价格/);assert.ok(list.innerHTML.includes(esc(dangerous)));assert.ok(!list.innerHTML.includes(dangerous));assert.equal(calls.length,0);
  const button={disabled:false,dataset:{registerProvider:'p',registerModel:'new-model'}};
  await list.onclick({target:{closest:selector=>selector==='[data-register-provider]'?button:null}});
  assert.deepEqual(calls,[['/api/models/register',{providerId:'p',model:'new-model'}]]);assert.ok(saved.providers[0].models.includes('new-model'));assert.match(list.innerHTML,/data-copy-route="p::new-model"/);
  elements.get('#catalog-search').value='not-found';elements.get('#catalog-search').oninput();assert.match(list.innerHTML,/没有匹配的模型/);
 }finally{globalThis.document=previous;}
});
