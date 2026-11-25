import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {inferAgentProtocol,eligibleModels,claudeCodeSnippets,codexSnippets,genericSnippets,connectKeyPolicy,createConnectVerifier,renderConnect} from '../public/connect.js';

const ORIGIN='http://127.0.0.1:3100';
const state=providers=>({providers});

const deepseek={id:'deepseek',name:'DeepSeek',protocol:'openai',enabled:true,hasKey:true,model:'deepseek-chat',models:['deepseek-chat','deepseek-reasoner'],modelProtocols:{}};
const anthropic={id:'anthropic',name:'Anthropic',protocol:'anthropic',enabled:true,hasKey:true,model:'claude-sonnet-4-5',models:['claude-sonnet-4-5','claude-haiku-4-5'],modelProtocols:{}};
const openai={id:'openai',name:'OpenAI',protocol:'openai',enabled:true,hasKey:true,model:'gpt-5.1',models:['gpt-5.1','gpt-5-mini'],modelProtocols:{}};
const mixed={id:'sf',name:'硅基流动',protocol:'openai',enabled:true,hasKey:true,model:'Qwen/Qwen3-8B',models:['Qwen/Qwen3-8B','FunAudioLLM/CosyVoice2-0.5B','zai-org/GLM-4.6'],modelProtocols:{}};
const disabled={id:'off',name:'停用',protocol:'openai',enabled:false,hasKey:true,model:'deepseek-chat',models:['deepseek-chat'],modelProtocols:{}};
const noKey={id:'nokey',name:'无密钥',protocol:'openai',enabled:true,hasKey:false,hasMeteredKey:false,model:'deepseek-chat',models:['deepseek-chat'],modelProtocols:{}};

test('协议推断：显式配置优先，其次按名称，最后回退服务商协议',()=>{
 assert.equal(inferAgentProtocol({protocol:'openai',modelProtocols:{}},'claude-sonnet-4-5'),'anthropic');
 assert.equal(inferAgentProtocol({protocol:'openai',modelProtocols:{}},'gpt-5.1'),'responses');
 assert.equal(inferAgentProtocol({protocol:'openai',modelProtocols:{}},'o4-mini'),'responses');
 assert.equal(inferAgentProtocol({protocol:'openai',modelProtocols:{}},'deepseek-chat'),'openai');
 assert.equal(inferAgentProtocol({protocol:'anthropic',modelProtocols:{}},'deepseek-chat'),'anthropic');
 assert.equal(inferAgentProtocol({protocol:'openai',modelProtocols:{'deepseek-chat':'responses'}},'deepseek-chat'),'responses');
});

test('客户端协议与上游协议解耦，三种客户端共用全部对话模型目录',()=>{
 const s=state([deepseek,anthropic,openai,mixed]);
 const claude=eligibleModels(s,'claude');
 assert.ok(claude.some(o=>o.value==='deepseek::deepseek-chat'));
 assert.ok(claude.some(o=>o.value==='anthropic::claude-sonnet-4-5'));
 const codex=eligibleModels(s,'codex');
 assert.deepEqual(codex,claude);
 assert.deepEqual(eligibleModels(s,'generic'),claude);
 assert.ok(!codex.some(o=>o.value==='sf::FunAudioLLM/CosyVoice2-0.5B'));
 const generic=eligibleModels(state([deepseek,mixed]),'generic');
 assert.ok(generic.some(o=>o.value==='deepseek::deepseek-chat'));
 assert.ok(!generic.some(o=>o.value==='sf::FunAudioLLM/CosyVoice2-0.5B'),'媒体模型不进通用客户端列表');
});

test('停用或无密钥的服务商不出现在候选中',()=>{
 const s=state([disabled,noKey,anthropic]);
 assert.deepEqual(eligibleModels(s,'claude').map(o=>o.value),['anthropic::claude-sonnet-4-5','anthropic::claude-haiku-4-5']);
 assert.equal(eligibleModels(state([disabled]),'generic').length,0);
 assert.equal(eligibleModels(null,'claude').length,0);
});

test('Claude Code 片段：根地址不带 /v1，settings.json 可解析',()=>{
 const s=claudeCodeSnippets({origin:ORIGIN,token:'srk_test_123',model:'anthropic::claude-sonnet-4-5'});
 assert.match(s.env,/export ANTHROPIC_BASE_URL="http:\/\/127\.0\.0\.1:3100"$/m);
 assert.doesNotMatch(s.env,/ANTHROPIC_BASE_URL="[^"]*\/v1"/);
 assert.match(s.env,/export ANTHROPIC_AUTH_TOKEN="srk_test_123"/);
 assert.match(s.env,/export ANTHROPIC_MODEL="anthropic::claude-sonnet-4-5"/);
 const parsed=JSON.parse(s.settings);
 assert.equal(parsed.env.ANTHROPIC_AUTH_TOKEN,'srk_test_123');
 assert.equal(parsed.env.ANTHROPIC_MODEL,'anthropic::claude-sonnet-4-5');
 assert.match(s.verify,/x-api-key: srk_test_123/);
 assert.match(s.verify,/anthropic-version: 2023-06-01/);
 assert.ok(!s.verify.includes('Bearer'),'Messages 验证使用 x-api-key，与 API 文档一致');
});

test('Codex 片段：base_url 带 /v1，wire_api 为 responses',()=>{
 const s=codexSnippets({origin:ORIGIN,token:'srk_test_abc',model:'openai::gpt-5.1'});
 assert.match(s.config,/base_url = "http:\/\/127\.0\.0\.1:3100\/v1"/);
 assert.match(s.config,/wire_api = "responses"/);
 assert.match(s.config,/model = "openai::gpt-5\.1"/);
 assert.match(s.config,/env_key = "SWITCHBOARD_API_KEY"/);
 assert.match(s.config,/requires_openai_auth = false/);
 assert.match(s.config,/supports_websockets = false/);
 assert.match(s.env,/export SWITCHBOARD_API_KEY="srk_test_abc"/);
 assert.match(s.verify,/\/v1\/responses/);
});

test('无 Key 明文时使用占位符，通用片段带 /v1 和 auto 提示',()=>{
 const s=genericSnippets({origin:ORIGIN,token:'',model:'auto'});
 assert.match(s.client,/在此粘贴平台_API_Key/);
 assert.match(s.client,/Base URL： http:\/\/127\.0\.0\.1:3100\/v1/);
 assert.match(s.curl,/Bearer 在此粘贴平台_API_Key/);
 const c=claudeCodeSnippets({origin:ORIGIN,token:'',model:'anthropic::claude-haiku-4-5'});
 assert.match(c.env,/ANTHROPIC_AUTH_TOKEN="在此粘贴平台_API_Key"/);
});

const shell=(script,env={})=>execFileSync('/bin/sh',['-c',script],{encoding:'utf8',env:{NODE:process.execPath,ROUTER_API_KEY:'fixture-variable',...env}});
const shellArgs=command=>JSON.parse(shell(`curl() { "$NODE" -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' -- "$@"; }\n${command}`));

test('三类配置对引号、反斜杠、换行、美元变量和命令替换分别安全编码',()=>{
 const origin=`https://router.invalid/a'"\\$HOME/$(printf attacked)/\`printf attacked\`\nnext`;
 const token=`fixture_'"\\$ROUTER_API_KEY_$(printf attacked)_\`printf attacked\`\nend`;
 const model=`provider::m'"\\$HOME/$(printf attacked)/\`printf attacked\`\n\t\u007f`;
 const args={origin,token,model},claude=claudeCodeSnippets(args),codex=codexSnippets(args),generic=genericSnippets(args);
 const env=JSON.parse(shell(`claude() { "$NODE" -e 'process.stdout.write(JSON.stringify([process.env.ANTHROPIC_BASE_URL,process.env.ANTHROPIC_AUTH_TOKEN,process.env.ANTHROPIC_MODEL]))'; }\n${claude.env}`));
 assert.deepEqual(env,[origin,token,model]);
 assert.equal(JSON.parse(shell(`${codex.env}\n"$NODE" -e 'process.stdout.write(JSON.stringify(process.env.SWITCHBOARD_API_KEY))'`)),token);
 assert.deepEqual(JSON.parse(claude.settings).env,{ANTHROPIC_BASE_URL:origin,ANTHROPIC_AUTH_TOKEN:token,ANTHROPIC_MODEL:model});
 assert.equal(JSON.parse(codex.config.match(/^model = (.+)$/m)[1]),model);
 assert.equal(JSON.parse(codex.config.match(/^base_url = (.+)$/m)[1]),origin+'/v1');
 assert.match(codex.config,/\\u007f/);
 for(const [command,path,header] of [[claude.verify,'messages','x-api-key: '],[codex.verify,'responses','Authorization: Bearer '],[generic.curl,'chat/completions','Authorization: Bearer ']]){
  const argv=shellArgs(command);
  assert.equal(argv[1],origin+'/v1/'+path);
  assert.equal(argv[argv.indexOf('-H')+1],header+token);
  assert.equal(JSON.parse(argv[argv.indexOf('-d')+1]).model,model);
 }
});

test('ROUTER_API_KEY 只有显式模板模式才展开，粘贴的同名字符串仍为字面值',()=>{
 for(const builder of [claudeCodeSnippets,codexSnippets,genericSnippets]){
  const args={origin:ORIGIN,token:'$ROUTER_API_KEY',model:'auto'};
  const literal=builder(args),variable=builder({...args,tokenVariable:true});
  const literalArgs=shellArgs(literal.verify||literal.curl),variableArgs=shellArgs(variable.verify||variable.curl);
  assert.ok(literalArgs.includes((builder===claudeCodeSnippets?'x-api-key: ':'Authorization: Bearer ')+'$ROUTER_API_KEY'));
  assert.ok(variableArgs.includes((builder===claudeCodeSnippets?'x-api-key: ':'Authorization: Bearer ')+'fixture-variable'));
 }
});

test('新建 Key 默认不加限额，有效期和日限额均可选且严格校验',()=>{
 const now=Date.parse('2026-11-01T00:00:00Z');
 assert.deepEqual(connectKeyPolicy({name:' dedicated '},now),{name:'dedicated',enabled:true});
 assert.deepEqual(connectKeyPolicy({name:'tool',expiresAt:'2026-11-02T00:00:00Z',dailyLimit:'100'},now),{name:'tool',enabled:true,expiresAt:'2026-11-02T00:00:00.000Z',dailyLimit:100});
 for(const dailyLimit of ['0','-1','1.5','1000000001','bad'])assert.throws(()=>connectKeyPolicy({name:'tool',dailyLimit},now),/日限额/);
 for(const expiresAt of ['invalid','2026-11-01T00:00:00Z','2026-10-01T00:00:00Z'])assert.throws(()=>connectKeyPolicy({name:'tool',expiresAt},now),/有效期/);
 assert.throws(()=>connectKeyPolicy({name:' '}),/名称/);
});

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const listing=rows=>Response.json({data:rows});
const fixtureKey='fixture-readonly-key';
const fixedModel='deepseek::deepseek-chat';
function verifierHarness(overrides={}){
 const states=[],requests=[];
 const verifier=createConnectVerifier({origin:ORIGIN,tenantId:'tenant-a',onState:s=>states.push(s),fetcher:async(url,options)=>{requests.push({url,options});return listing([{id:fixedModel}]);},...overrides});
 return {verifier,states,requests};
}

test('只读验证用实际 Key 和组织头，禁 Cookie/缓存/重定向且不做生成调用',async()=>{
 const {verifier,states,requests}=verifierHarness();
 await verifier.verify({token:fixtureKey,model:fixedModel});
 assert.equal(requests.length,1);
 const {url,options}=requests[0];
 assert.equal(url,ORIGIN+'/v1/models');assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');
 assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(options.body,undefined);
 assert.equal(options.headers.Authorization,'Bearer '+fixtureKey);assert.equal(options.headers['X-Tenant-ID'],'tenant-a');
 assert.equal(states.at(-1).status,'success');assert.equal(states.at(-1).requestId,options.headers['X-Request-ID']);
 assert.ok(options.signal instanceof AbortSignal);assert.ok(!JSON.stringify(states).includes(fixtureKey));
});

test('固定模型必须完整命中返回 data，auto 必须有非媒体对话候选',async()=>{
 for(const [model,rows,expected] of [
  [fixedModel,[{id:'deepseek'}],'error'],[fixedModel,[{id:fixedModel}],'success'],
  ['auto',[{id:'auto'}],'error'],['auto',[],'error'],
  ['auto',[{id:'auto'},{id:'media::flux'},{id:'alias',upstream_model:'FunAudioLLM/CosyVoice2-0.5B'}],'error'],
  ['auto',[{id:'gpt-5',callable:false}],'error'],
  ['auto',[{id:'model',upstream_model:'deepseek-chat'}],'success'],
  ['auto',[{id:'anthropic::claude-sonnet-4-5'}],'success']
 ]){
  const {verifier,states}=verifierHarness({fetcher:async()=>listing(rows)});
  await verifier.verify({token:fixtureKey,model});assert.equal(states.at(-1).status,expected);
 }
 const {verifier,states}=verifierHarness({fetcher:async()=>Response.json({models:[{id:fixedModel}]})});
 await verifier.verify({token:fixtureKey,model:fixedModel});assert.match(states.at(-1).message,/格式无效/);
});

test('鉴权/权限/限流/网络错误不反射 Key 或服务端错误正文，只显示友好状态和请求 ID',async()=>{
 for(const status of [400,401,403,429,500]){
  const {verifier,states}=verifierHarness({fetcher:async()=>new Response(fixtureKey,{status,headers:{'x-request-id':fixtureKey}})});
  await verifier.verify({token:fixtureKey,model:fixedModel});assert.equal(states.at(-1).status,'error');
  assert.ok(states.at(-1).requestId);assert.ok(!JSON.stringify(states).includes(fixtureKey));
 }
 const {verifier,states}=verifierHarness({fetcher:async()=>{throw new Error(fixtureKey);}});
 await verifier.verify({token:fixtureKey,model:fixedModel});assert.match(states.at(-1).message,/网络/);assert.ok(!JSON.stringify(states).includes(fixtureKey));
});

test('缺少 Key、模型、组织及不合法 Key 不发网络请求',async()=>{
 const {verifier,requests}=verifierHarness();
 for(const token of ['', 'Bearer fixture', ' fixture', 'fixture\nkey'])await verifier.verify({token,model:fixedModel});
 await verifier.verify({token:fixtureKey,model:''});assert.equal(requests.length,0);
 const missing=verifierHarness({tenantId:''});await missing.verifier.verify({token:fixtureKey,model:fixedModel});assert.equal(missing.requests.length,0);
});

test('改变 Key/模型/工具立即失效，忽略晚到结果和已离开的页面',async()=>{
 const pending=deferred(),requests=[],states=[];let current=true;
 const verifier=createConnectVerifier({origin:ORIGIN,tenantId:'tenant-a',isCurrent:()=>current,onState:s=>states.push(s),fetcher:(_,options)=>{requests.push(options);return pending.promise;}});
 const first=verifier.verify({token:fixtureKey,model:fixedModel});
 verifier.invalidate();assert.equal(states.at(-1).status,'idle');assert.equal(requests[0].signal.aborted,true);
 pending.resolve(listing([{id:fixedModel}]));await first;assert.equal(states.at(-1).status,'idle');
 const late=deferred();const leaving=verifierHarness({isCurrent:()=>current,fetcher:()=>late.promise});
 const work=leaving.verifier.verify({token:fixtureKey,model:fixedModel});current=false;
 late.resolve(listing([{id:fixedModel}]));await work;assert.equal(leaving.states.at(-1).status,'checking');
 verifier.dispose();const count=states.length;await verifier.verify({token:fixtureKey,model:fixedModel});assert.equal(states.length,count);
});

test('超时会终止请求并允许重试，旧请求不能覆盖新结果',async()=>{
 const pending=deferred(),requests=[];let count=0;
 const {verifier,states}=verifierHarness({timeoutMs:5,fetcher:(_,options)=>{requests.push(options);return ++count===1?pending.promise:Promise.resolve(listing([{id:fixedModel}]));}});
 await verifier.verify({token:fixtureKey,model:fixedModel});assert.match(states.at(-1).message,/超时/);assert.equal(requests[0].signal.aborted,true);
 await verifier.verify({token:fixtureKey,model:fixedModel});assert.equal(states.at(-1).status,'success');const last=states.at(-1);
 pending.resolve(listing([]));await Promise.resolve();assert.equal(states.at(-1),last);
});

test('较慢的旧 JSON 解析不得覆盖后发验证',async()=>{
 const body=deferred();let count=0;
 const {verifier,states}=verifierHarness({fetcher:async()=>++count===1?{ok:true,status:200,json:()=>body.promise}:listing([{id:fixedModel}])});
 const first=verifier.verify({token:'fixture-old',model:fixedModel});await Promise.resolve();
 await verifier.verify({token:'fixture-new',model:fixedModel});body.resolve({data:[]});await first;
 assert.equal(states.at(-1).status,'success');
});

function connectNode(){
 const node={dataset:{},value:'',disabled:false,textContent:'',nodes:new Map(),dataNodes:[],focus(){},scrollIntoView(){}};
 Object.defineProperty(node,'innerHTML',{get(){return this.html||'';},set(html){
  this.html=html;this.nodes=new Map();this.dataNodes=[];
  for(const tag of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)){
   const attrs=tag[2],id=attrs.match(/\bid="([^"]+)"/),datasets=[...attrs.matchAll(/\bdata-([\w-]+)="([^"]*)"/g)];
   if(!id&&!datasets.length)continue;
   const child=connectNode();child.disabled=/\bdisabled\b/.test(attrs);child.attributes=attrs;
   for(const [,name,value] of datasets)child.dataset[name.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
   if(id){this.nodes.set(id[1],child);if(tag[1]==='select')child.value='auto';}
   if(datasets.length)this.dataNodes.push(child);
   if(tag[1]==='form'){child.elements=Object.fromEntries(['name','expiresAt','dailyLimit'].map(name=>[name,connectNode()]));child.button=connectNode();}
  }
 }});
 node.querySelector=function(selector){
  if(selector==='button')return this.button;
  if(selector==='#connect-new-key button')return this.querySelector('#connect-new-key')?.button;
  if(this.nodes.has(selector.slice(1)))return this.nodes.get(selector.slice(1));
  for(const child of this.nodes.values()){const result=child.querySelector(selector);if(result)return result;}
  return null;
 };
 node.querySelectorAll=function(selector){
  const name=selector.slice(6,-1).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
  return [...this.dataNodes.filter(child=>name in child.dataset),...[...this.nodes.values()].flatMap(child=>child.querySelectorAll(selector))];
 };
 return node;
}
const htmlEscape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function connectDOM(t,fetcher=async()=>listing([{id:fixedModel}])){
 const root=connectNode(),toasts=[],clipboard=[];
 const globals={document:{querySelector:selector=>selector==='#content'?root:null},location:{origin:ORIGIN},navigator:{clipboard:{writeText:async value=>{clipboard.push(value);}}},fetch:fetcher};
 for(const [name,value] of Object.entries(globals)){
  const original=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{configurable:true,value});
  t.after(()=>original?Object.defineProperty(globalThis,name,original):delete globalThis[name]);
 }
 return {root,toasts,clipboard,render:api=>renderConnect({api:api|| (async path=>path==='/api/state'?state([deepseek,anthropic]):{keys:[]}),tenantId:'tenant-a',esc:htmlEscape,toast:message=>toasts.push(message)})};
}

test('五步页面支持无 Key 模板和密码输入，默认脱敏，复制取内存真实值',async t=>{
 const {root,clipboard,toasts,render}=connectDOM(t);await render();
 assert.equal([...root.innerHTML.matchAll(/class="panel connect-step"/g)].length,5);
 assert.match(root.querySelector('#connect-token').attributes,/type="password"/);
 assert.match(root.innerHTML,/个人订阅不通过业务 API Key/);
 assert.match(root.innerHTML,/不证明剩余额度、上游健康或推理可用/);
 await root.querySelector('#connect-copy-config').onclick();assert.match(clipboard.at(-1),/在此粘贴平台_API_Key/);
 const input=root.querySelector('#connect-token'),secret='fixture-ui-secret-$HOME';input.value=secret;input.oninput();
 assert.equal(root.querySelector('#connect-token'),input,'输入不重建密码框，保留焦点');
 assert.ok(!root.innerHTML.includes(secret));assert.ok(!root.querySelector('#connect-config').innerHTML.includes(secret));
 await root.querySelector('#connect-copy-config').onclick();assert.ok(clipboard.at(-1).includes('fixture-ui-secret-\\$HOME'));
 root.querySelector('#connect-reveal').onclick();assert.ok(root.querySelector('#connect-config').innerHTML.includes('fixture-ui-secret-'));
 root.querySelector('#connect-clear-key').onclick();assert.equal(input.value,'');assert.equal(root.querySelector('#connect-check').disabled,true);
 assert.ok(!root.querySelector('#connect-config').innerHTML.includes('fixture-ui-secret-'));
 assert.ok(!JSON.stringify(toasts).includes(secret));
});

test('UI 的 Key、模型和工具变更立即取消旧验证，未复制按钮不发请求',async t=>{
 const requests=[],pending=deferred();
 const {root,render}=connectDOM(t,async(url,options)=>{requests.push({url,options});return requests.length===1?pending.promise:listing([{id:fixedModel},{id:'anthropic::claude-sonnet-4-5'}]);});
 await render();assert.equal(requests.length,0);
 const input=root.querySelector('#connect-token');input.value=fixtureKey;input.oninput();
 const work=root.querySelector('#connect-check').onclick();assert.equal(root.querySelector('#connect-status').dataset.status,'checking');
 input.value='fixture-other';input.oninput();assert.equal(root.querySelector('#connect-status').dataset.status,'idle');assert.equal(requests[0].options.signal.aborted,true);
 pending.resolve(listing([{id:fixedModel}]));await work;assert.equal(root.querySelector('#connect-status').dataset.status,'idle');
 await root.querySelector('#connect-check').onclick();assert.equal(root.querySelector('#connect-status').dataset.status,'success');
 const select=root.querySelector('#connect-model');select.value=fixedModel;select.onchange();assert.equal(root.querySelector('#connect-status').dataset.status,'idle');
 await root.querySelector('#connect-check').onclick();assert.equal(root.querySelector('#connect-status').dataset.status,'success');
 root.querySelectorAll('[data-connect-tool]').find(b=>b.dataset.connectTool==='codex').onclick();assert.equal(root.querySelector('#connect-status').dataset.status,'idle');
 assert.equal(root.querySelector('#connect-token').value,'fixture-other');assert.equal(requests.length,3);
});

test('页面创建 Key 复用现有 API、保留可选限制和一次明文，离开后不回写',async t=>{
 const {root,render,clipboard}=connectDOM(t),calls=[];
 await render(async(path,body)=>{calls.push({path,body});return body?{token:fixtureKey,key:{name:body.name,status:'active',enabled:true}}:path==='/api/state'?state([deepseek]):{keys:[]};});
 const form=root.querySelector('#connect-new-key');form.elements.name.value='dedicated';form.elements.dailyLimit.value='120';form.elements.expiresAt.value='2099-12-31T00:00';
 await form.onsubmit({preventDefault(){}});
 assert.equal(calls.at(-1).path,'/api/keys');assert.equal(calls.at(-1).body.dailyLimit,120);assert.ok(calls.at(-1).body.expiresAt.endsWith('Z'));assert.equal(calls.at(-1).body.totalLimit,undefined);
 assert.equal(root.querySelector('#connect-token').value,fixtureKey);assert.match(root.querySelector('#connect-key-banner').textContent,/仅在本页展示这一次/);
 await root.querySelector('#connect-copy-key').onclick();assert.equal(clipboard.at(-1),fixtureKey);
 assert.ok(!root.querySelector('#connect-config').innerHTML.includes(fixtureKey));
 const slow=deferred();const cleanup=await render(async(path,body)=>body?slow.promise:path==='/api/state'?state([deepseek]):{keys:[]});
 const next=root.querySelector('#connect-new-key'),submit=next.onsubmit({preventDefault(){}});cleanup();slow.resolve({token:'fixture-late',key:{name:'late'}});await submit;
 assert.equal(root.querySelector('#connect-token').value,'');
});

test('目录/Key 权限不可用时仍提供模板及粘贴入口，不使用浏览器持久化或原始错误',async t=>{
 const {root,render}=connectDOM(t);await render(async()=>{throw new Error(fixtureKey);});
 assert.equal(root.querySelector('#connect-new-key'),null);assert.ok(root.querySelector('#connect-token'));assert.match(root.innerHTML,/复制模板/);
 assert.match(root.querySelector('#connect-config').innerHTML,/在此粘贴平台_API_Key/);assert.ok(!root.innerHTML.includes(fixtureKey));
 const source=readFileSync(new URL('../public/connect.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/localStorage|sessionStorage|console\.|location\.(?:search|hash)\s*=/);
});
