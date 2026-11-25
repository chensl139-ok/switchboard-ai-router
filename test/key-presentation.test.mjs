import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {keyPresentation,summarizeKeys,matchesKeyFilter,keyQuotaProgress,renderApiKeys} from '../public/api-keys.js';

const NOW=Date.parse('2026-11-01T00:00:00Z'),DAY=86400000;
const key=(id,values={})=>({id,name:'App '+id,preview:'srk_preview…1234',status:'active',enabled:true,startsAt:null,expiresAt:null,requests:3,totalLimit:10,dailyUsed:2,dailyLimit:5,rpmLimit:null,successes:2,failures:1,...values});
const at=delta=>new Date(NOW+delta).toISOString();

test('将到期采用未来 7 天闭区间，排除过期/停用且不混淆未生效',()=>{
 assert.deepEqual(keyPresentation(key('unlimited'),NOW),{status:'active',expiring:false,daysLeft:null});
 assert.deepEqual(keyPresentation(key('soon',{expiresAt:at(1)}),NOW),{status:'active',expiring:true,daysLeft:1});
 assert.equal(keyPresentation(key('week',{expiresAt:at(7*DAY)}),NOW).expiring,true);
 assert.equal(keyPresentation(key('later',{expiresAt:at(7*DAY+1)}),NOW).expiring,false);
 assert.deepEqual(keyPresentation(key('expired',{expiresAt:at(0)}),NOW),{status:'expired',expiring:false,daysLeft:null});
 assert.equal(keyPresentation(key('off',{enabled:false,expiresAt:at(DAY)}),NOW).expiring,false);
 const future=key('scheduled',{status:'scheduled',startsAt:at(DAY),expiresAt:at(2*DAY)});
 assert.deepEqual(keyPresentation(future,NOW),{status:'scheduled',expiring:true,daysLeft:2});
 assert.equal(keyPresentation(future,NOW+DAY).status,'active');
 assert.equal(keyPresentation(future,NOW+2*DAY).status,'expired');
 assert.equal(keyPresentation(key('invalid',{expiresAt:'invalid'}),NOW).expiring,false);
});

test('统计仅聚合给定个人列表，状态和搜索交集不改变总计',()=>{
 const keys=[key('a'),key('b',{name:'Production',expiresAt:at(DAY)}),key('c',{enabled:false}),key('d',{startsAt:at(DAY),expiresAt:at(3*DAY)})];
 assert.deepEqual(summarizeKeys(keys,NOW),{total:4,active:2,expiring:2});
 assert.deepEqual(summarizeKeys([],NOW),{total:0,active:0,expiring:0});
 assert.deepEqual(keys.filter(k=>matchesKeyFilter(k,'  pROD ','active',NOW)).map(k=>k.id),['b']);
 assert.deepEqual(keys.filter(k=>matchesKeyFilter(k,'srk_','expiring',NOW)).map(k=>k.id),['b','d']);
 assert.equal(matchesKeyFilter(keys[2],'c','disabled',NOW),true);
 assert.equal(matchesKeyFilter(keys[0],'','expired',NOW),false);
 assert.equal(matchesKeyFilter(keys[0],'missing','all',NOW),false);
 assert.equal(matchesKeyFilter(keys[0],'a','unexpected',NOW),false);
 assert.equal(keys.length,4);
});

test('额度进度覆盖无限额、零用量、超额及下调限额，始终在 0–100%',()=>{
 assert.deepEqual(keyQuotaProgress(3,10),{percent:30,remaining:7});
 assert.deepEqual(keyQuotaProgress(0,10),{percent:0,remaining:10});
 assert.deepEqual(keyQuotaProgress(20,10),{percent:100,remaining:0});
 assert.deepEqual(keyQuotaProgress(-5,10),{percent:0,remaining:10});
 for(const limit of [null,undefined,0,NaN])assert.deepEqual(keyQuotaProgress(5,limit),{percent:null,remaining:null});
 assert.deepEqual(keyQuotaProgress(1,3),{percent:33,remaining:2});
});

function installPage(t,keys){
 const elements=new Map(),cards=keys.map(k=>({dataset:{keyId:k.id},style:{},hidden:false}));
 const element=()=>({value:'',textContent:'',hidden:false,addEventListener(name,fn){this[name]=fn;},insertAdjacentHTML(){},showModal(){this.open=true;},close(){this.open=false;},reset(){}});
 const container={innerHTML:'',querySelector(selector){if(selector==='#legacy-key')return null;if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);},querySelectorAll(selector){return selector==='[data-search]'?cards:[];}};
 container.querySelector('#key-form').elements=Object.fromEntries(['name','startsAt','expiresAt','totalLimit','dailyLimit','rpmLimit','enabled'].map(name=>[name,element()]));
 const globals={document:{querySelector:()=>container},location:{origin:'http://127.0.0.1:3100'}};
 for(const [name,value] of Object.entries(globals)){
  const original=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{configurable:true,value});
  t.after(()=>original?Object.defineProperty(globalThis,name,original):delete globalThis[name]);
 }
 return {container,cards};
}
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

test('密钥页面联动搜索/状态、无匹配/清除入口，同时保留私有权限和 UTC 文案',async t=>{
 const keys=[key('active'),key('off',{enabled:false,status:'disabled'})],{container,cards}=installPage(t,keys);
 await renderApiKeys({api:async()=>({keys,legacyAvailable:false}),esc,toast(){},isCurrent:()=>true});
 assert.match(container.innerHTML,/class="key-summary"/);assert.match(container.innerHTML,/class="key-progress"/);
 assert.match(container.innerHTML,/其他成员与管理员不可见/);assert.match(container.innerHTML,/UTC 零点（北京时间 08:00）重置/);
 assert.match(container.innerHTML,/href="#connect"/);assert.match(container.innerHTML,/id="key-no-match"[^>]*hidden/);
 const search=container.querySelector('#key-search'),status=container.querySelector('#key-status');
 status.value='disabled';status.change();assert.deepEqual(cards.map(c=>c.hidden),[true,false]);assert.deepEqual(cards.map(c=>c.style.display),['none','']);assert.equal(container.querySelector('#key-count').textContent,'1');
 search.value='missing';search.input();assert.deepEqual(cards.map(c=>c.hidden),[true,true]);assert.equal(container.querySelector('#key-no-match').hidden,false);
 container.querySelector('#key-reset-filter').onclick();assert.equal(search.value,'');assert.equal(status.value,'all');assert.deepEqual(cards.map(c=>c.hidden),[false,false]);assert.equal(container.querySelector('#key-no-match').hidden,true);
});

test('空列表仍展示个人空状态，恶意名称/ID 只作为转义文本',async t=>{
 const {container}=installPage(t,[]);
 await renderApiKeys({api:async()=>({keys:[],legacyAvailable:false}),esc,toast(){},isCurrent:()=>true});
 assert.match(container.innerHTML,/尚无个人密钥/);
 container.querySelector('#key-status').value='all';container.querySelector('#key-search').input();assert.equal(container.querySelector('#key-no-match').hidden,true);
 await renderApiKeys({api:async()=>({keys:[key('id"<unsafe>',{name:'<script>bad</script>',preview:'<img onerror="bad">'})],legacyAvailable:false}),esc,toast(){},isCurrent:()=>true});
 assert.ok(!container.innerHTML.includes('<script>'));assert.ok(!container.innerHTML.includes('<img onerror='));assert.match(container.innerHTML,/data-key-id="id&quot;&lt;unsafe&gt;"/);
});

test('保留 CRUD/限制字段/一次明文清理及安全环境变量模板',()=>{
 const source=readFileSync(new URL('../public/api-keys.js',import.meta.url),'utf8');
 for(const path of ['/api/keys/update','/api/keys/toggle','/api/keys/delete','/api/keys/legacy'])assert.ok(source.includes(path));
 for(const field of ['startsAt','expiresAt','totalLimit','dailyLimit','rpmLimit'])assert.ok(source.includes(`name="${field}"`));
 assert.match(source,/修改配额不会重置已用次数/);
 assert.match(source,/完整密钥仅在创建时展示这一次/);
 assert.match(source,/querySelector\('#created-token'\)\.value=''/);
 assert.match(source,/token:'\$ROUTER_API_KEY',model:'auto',tokenVariable:true/);
 assert.match(source,/Authorization: Bearer \$ROUTER_API_KEY/);
});
