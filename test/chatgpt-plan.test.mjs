import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {ChatGPTPlan,planRequest,readPlanStream} from '../chatgpt-plan.mjs';
import {Accounts} from '../accounts.mjs';
import {createPlatform} from '../platform.mjs';
import {streamChat} from '../public/stream-client.js';
import {labChoices,isPersonalTarget,planLabRequest} from '../public/lab-targets.js';
import {planProviderCards} from '../public/plan-connections.js';

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'fixture-key',alg:'RS256',use:'sig'};
const caller={userId:'user1',tenantId:'tenant1',sessionHash:'session1',role:'member'};
const jwt=claims=>{const parts=[{alg:'RS256',kid:jwk.kid},claims].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url'));return [...parts,sign('RSA-SHA256',Buffer.from(parts.join('.')),privateKey).toString('base64url')].join('.');};
const stream=(...events)=>new Response(events.map(event=>'data: '+JSON.stringify(event)+'\r\n\r\n').join(''),{headers:{'content-type':'text/event-stream'}});
function fixture(t){
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-plan-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let now=2000000000000,valid=true,auth,grant='resource.invoke chatgpt.tokens.use.direct',claims={},refreshes=0,revokes=0,modelCalls=0,response=()=>stream({type:'response.output_text.delta',delta:'你好'},{type:'response.completed',response:{id:'resp_ok',model:'fixture-model',status:'completed',usage:{output_tokens:2}}});
 const fetcher=async(url,options={})=>{
  if(url.endsWith('jwks.json'))return Response.json({keys:[jwk]});
  if(url.endsWith('/oauth/token')){
   const form=new URLSearchParams(options.body);assert.equal(form.get('client_id'),'oaiapp_fixture');assert.equal(form.get('resource'),'https://api.openai.com/v1');
   if(form.get('grant_type')==='authorization_code'){
    assert.equal(form.get('redirect_uri'),auth.searchParams.get('redirect_uri'));assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'),auth.searchParams.get('code_challenge'));
    return Response.json({access_token:'private-access',refresh_token:'private-refresh',token_type:'Bearer',expires_in:3600,scope:grant,id_token:jwt({iss:'https://auth.openai.com',aud:'oaiapp_fixture',sub:'account1',email:'person@fixture.invalid',iat:now/1000,exp:now/1000+3600,nonce:auth.searchParams.get('nonce'),...claims})});
   }
   assert.equal(form.has('scope'),false);refreshes++;return Response.json({access_token:'rotated-access',refresh_token:'rotated-refresh',token_type:'Bearer',expires_in:3600,scope:grant});
  }
  if(url.endsWith('/oauth/revoke')){revokes++;return new Response('',{status:200});}
  if(url.endsWith('/models')){modelCalls++;assert.match(options.headers.authorization,/^Bearer (private-access|rotated-access)$/);return Response.json({models:[{slug:'fixture-model',display_name:'Fixture',visibility:'list'},{slug:'hidden',visibility:'hidden'}]});}
  if(url.endsWith('/responses')){assert.deepEqual(JSON.parse(options.body),planRequest('fixture-model',[{role:'user',content:'hi'}]));return response();}
  throw Error('Unexpected fixture URL');
 };
 const plan=new ChatGPTPlan(dir,'x'.repeat(64),{fetcher,now:()=>now,sessionValid:()=>valid});t.after(()=>plan.close());
 const authorize=()=>{const start=plan.start(caller,'http://127.0.0.1:3110/api/account/chatgpt/callback');const result=plan.authorize(new URL(start.url).searchParams.get('ticket'));auth=new URL(result.url);return result;};
 const callback=()=>plan.callback(new URLSearchParams({state:auth.searchParams.get('state'),code:'fixture-code',client_id:'oaiapp_fixture'}),auth.searchParams.get('state'));
 return {plan,dir,authorize,callback,fetcher,setValid:value=>valid=value,setClaims:value=>claims=value,setGrant:value=>grant=value,setResponse:value=>response=value,advance:ms=>now+=ms,counts:()=>({refreshes,revokes,modelCalls})};
}

test('OAuth registration validates PKCE, one-use state, issuer identity and encrypted owner-only storage',async t=>{
 const f=fixture(t),start=f.authorize();assert.equal(new URL(start.url).searchParams.get('client_id'),'dynamic_agent_client');assert.equal(new URL(start.url).searchParams.get('agent_name_hint'),'Switchboard');
 await f.callback();await assert.rejects(f.callback(),/校验失败/);
 const [account]=f.plan.status(caller).accounts;assert.equal(account.planEnabled,true);assert.equal(account.connected,true);assert.equal(f.plan.status({...caller,userId:'other'}).accounts.length,0);assert.equal(f.plan.status({...caller,tenantId:'other'}).accounts.length,0);
 const disk=readFileSync(path.join(f.dir,'chatgpt-plan.json'),'utf8');assert(!disk.includes('private-access'));assert(!disk.includes('private-refresh'));assert(!disk.includes('id_token'));assert.equal(statSync(f.plan.file).mode&0o777,0o600);
 await assert.rejects(f.plan.models({...caller,userId:'other'},account.id),error=>error.status===404);
 const renewed=new URL(f.plan.start(caller,'http://127.0.0.1:5555/api/account/chatgpt/callback',account.id).url);const auth=new URL(f.plan.authorize(renewed.searchParams.get('ticket')).url);assert.equal(auth.searchParams.get('client_id'),'oaiapp_fixture');assert.equal(auth.searchParams.has('agent_name_hint'),false);
});

test('OAuth requires matching browser cookie, active original session, no duplicate params or replay',async t=>{
 const f=fixture(t);f.authorize();await assert.rejects(f.plan.callback(new URLSearchParams({state:'wrong'}),'wrong'),/校验失败/);f.setValid(false);await assert.rejects(f.callback(),error=>error.status===401);assert.equal(f.plan.status(caller).accounts.length,0);
 f.setValid(true);const auth=new URL(f.authorize().url),state=auth.searchParams.get('state');await assert.rejects(f.plan.callback(new URLSearchParams([['state',state],['state',state]]),state),/参数无效/);
 await assert.rejects(f.plan.callback(new URLSearchParams({state,error:'access_denied'}),state),/取消/);assert.equal(f.counts().refreshes,0);
});

test('OAuth identity failure revokes issued credentials; identity-only grant cannot infer',async t=>{
 const f=fixture(t);f.setClaims({aud:'someone-else'});f.authorize();await assert.rejects(f.callback(),/身份校验失败/);assert.equal(f.counts().revokes,1);assert.equal(f.plan.status(caller).accounts.length,0);
 f.setClaims({});f.setGrant('openid profile');f.authorize();await f.callback();const [account]=f.plan.status(caller).accounts;assert.equal(account.planEnabled,false);await assert.rejects(f.plan.models(caller,account.id),error=>error.status===403);
});

test('Expired, wrong nonce, wrong issuer and unsigned identities are never accepted',async t=>{
 const f=fixture(t);for(const claims of [{exp:1},{nonce:'wrong'},{iss:'https://malicious.invalid'}]){f.setClaims(claims);f.authorize();await assert.rejects(f.callback(),/身份校验失败/);}
 const token=Buffer.from(JSON.stringify({alg:'none',kid:jwk.kid})).toString('base64url')+'.'+Buffer.from('{}').toString('base64url')+'.';await assert.rejects(f.plan.identity(token,'oaiapp_fixture'),/身份校验失败/);
});

test('Model catalog is account-scoped, filtered, cached and inference follows official Responses contract',async t=>{
 const f=fixture(t);f.authorize();await f.callback();const id=f.plan.status(caller).accounts[0].id;
 assert.deepEqual(await f.plan.models(caller,id),[{id:'fixture-model',name:'Fixture'}]);await f.plan.models(caller,id);assert.equal(f.counts().modelCalls,1);
 const result=await f.plan.chat(caller,{id,model:'fixture-model',messages:[{role:'user',content:'hi'}]});assert.equal(result.text,'你好');assert.equal(result.usage.output_tokens,2);
 await assert.rejects(f.plan.chat(caller,{id,model:'hidden',messages:[{role:'user',content:'hi'}]}),/不支持/);
});

test('Personal provider projection excludes credentials and shared routing, preserves selected model',async t=>{
 const f=fixture(t);f.authorize();await f.callback();const id=f.plan.status(caller).accounts[0].id;
 const [provider]=await f.plan.providers(caller);assert.equal(provider.id,'chatgpt-plan:'+id);assert.equal(provider.private,true);assert.equal(provider.enabled,true);assert.equal(provider.protocol,'responses');assert.equal(provider.model,'fixture-model');
 assert(!JSON.stringify(provider).includes('private-access'));assert(!Object.hasOwn(provider,'hasKey'));assert(!Object.hasOwn(provider,'sealed'));assert.deepEqual(await f.plan.providers({...caller,userId:'other'}),[]);assert.deepEqual(await f.plan.providers({...caller,tenantId:'other'}),[]);
 await f.plan.selectModel(caller,id,'fixture-model');assert.equal(f.plan.own(caller,id).selectedModel,'fixture-model');await assert.rejects(f.plan.selectModel(caller,id,'hidden'),/不支持/);
 await f.plan.disconnect(caller,id);assert.equal((await f.plan.providers(caller))[0].enabled,false);
});

test('Unified lab choices distinguish OAuth from API, and never reroute an unavailable personal target',()=>{
 const personal={id:'chatgpt-plan:account1',subscriptionId:'account1',name:'ChatGPT',private:true,enabled:true,connected:true,planEnabled:true,models:['gpt-6.1-sol'],modelNames:{'gpt-6.1-sol':'GPT-6.1-Sol'}};
 const shared={id:'shared',name:'Shared',enabled:true,hasKey:true,models:['gpt-4o']},choices=labChoices({providers:[shared],personalProviders:[personal]});assert.equal(choices.length,2);assert.equal(choices[0].subscriptionId,undefined);assert.match(choices[1].label,/个人订阅/);assert(isPersonalTarget(choices[1].id));assert(!isPersonalTarget(choices[0].id));
 const payload=planLabRequest(choices[1],[{role:'user',content:'hi'}]);assert.deepEqual(payload,{id:'account1',model:'gpt-6.1-sol',messages:[{role:'user',content:'hi'}]});assert(!Object.hasOwn(payload,'allow_fallback'));assert(!Object.hasOwn(payload,'max_tokens'));
 assert.throws(()=>planLabRequest(undefined,[{role:'user',content:'hi'}]),/不会回退/);assert.throws(()=>planLabRequest(choices[1],[{role:'user',content:[{type:'image_url'}]}]),/仅支持文本/);assert.throws(()=>planLabRequest(choices[1],Array.from({length:41},()=>({role:'user',content:'hi'}))),/40/);
 assert.equal(labChoices({providers:[],personalProviders:[{...personal,enabled:false}]}).length,0);
 const escape=value=>String(value).replaceAll('<','&lt;').replaceAll('"','&quot;');const html=planProviderCards([{...personal,accountLabel:'<script>bad',model:'gpt-6.1-sol'}],escape);assert(!html.includes('<script>'));assert(html.includes('在实验室对话'));assert(!html.includes('data-switch='));assert(!html.includes('data-provider-delete='));
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');assert(!source.includes('data-tab="connections"'));assert(!source.includes('renderPlanConnections'));
 const panel=readFileSync(new URL('../public/plan-connections.js',import.meta.url),'utf8');assert(panel.includes('JSON.stringify(state.personalProviders)!==JSON.stringify(result.providers)'),'unchanged polling does not recreate controls');
});

test('Subscription events are emitted incrementally before the completion event',async()=>{
 const seen=[];let resume,started;const ready=new Promise(resolve=>started=resolve),wait=new Promise(resolve=>resume=resolve),encoder=new TextEncoder();
 const response=new Response(new ReadableStream({async start(controller){controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"live"}\n\n'));await wait;controller.enqueue(encoder.encode('data: {"type":"response.completed","response":{"status":"completed"}}\n\n'));controller.close();}}));
 const result=readPlanStream(response,{onDelta:delta=>{seen.push(delta.content);started();}});await ready;assert.deepEqual(seen,['live']);resume();assert.equal((await result).text,'live');
});

test('Unified lab SSE uses session-scoped subscription endpoint, handles errors and hides connections from shared state',async t=>{
 const f=fixture(t);f.authorize();await f.callback();const id=f.plan.status(caller).accounts[0].id,admin='x'.repeat(64),accounts=new Accounts(f.dir,admin);
 const ownerToken=await accounts.setup({bootstrapToken:admin,name:'Owner',email:'owner@fixture.invalid',password:'fixture-password-1234'}),owner=accounts.resolve(ownerToken);
 f.plan.save({...f.plan.state,accounts:f.plan.state.accounts.map(record=>({...record,userId:owner.userId,tenantId:owner.tenantId}))});
 const invite=accounts.invite(owner,{email:'member@fixture.invalid',role:'member'}),memberToken=await accounts.register({email:'member@fixture.invalid',name:'Member',password:'fixture-password-1234',inviteCode:invite.code});
 const app=createPlatform({dir:f.dir,admin,gateway:'g'.repeat(64),desktopAuth:'d'.repeat(64),oauthConfig:[],planFetcher:f.fetcher});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{app.closeAllConnections();app.close(resolve);}));
 const base='http://127.0.0.1:'+app.address().port,headers={cookie:'sr_session='+ownerToken,'content-type':'application/json'},nativeFetch=globalThis.fetch;
 const providers=await(await nativeFetch(base+'/api/account/chatgpt/providers',{headers})).json();assert.equal(providers.providers[0].subscriptionId,id);
 const memberHeaders={...headers,cookie:'sr_session='+memberToken};assert.deepEqual((await(await nativeFetch(base+'/api/account/chatgpt/providers',{headers:memberHeaders})).json()).providers,[]);
 assert.equal((await nativeFetch(base+'/api/account/chatgpt/chat/stream',{method:'POST',headers:memberHeaders,body:JSON.stringify({id,model:'fixture-model',messages:[{role:'user',content:'hi'}]})})).status,404);
 const sharedState=await(await nativeFetch(base+'/api/state',{headers})).json();assert(!sharedState.providers.some(provider=>provider.id.startsWith('chatgpt-plan:')));
 assert.equal((await nativeFetch(base+'/api/account/chatgpt/chat/stream',{method:'POST',headers,body:JSON.stringify({id,model:'fixture-model',messages:[{role:'user',content:'hi'}],max_tokens:100})})).status,400);
 globalThis.fetch=(url,options)=>nativeFetch(new URL(url,base),{...options,headers:{...options.headers,cookie:'sr_session='+ownerToken}});t.after(()=>globalThis.fetch=nativeFetch);
 const updates=[];const result=await streamChat('sse','',{id,model:'fixture-model',messages:[{role:'user',content:'hi'}]},value=>updates.push(value.content),new AbortController().signal,'default',()=>{},'/api/account/chatgpt/chat/stream');
 assert.equal(result.content,'你好');assert.equal(result.outputTokens,2);assert.equal(result.route.provider,'ChatGPT 订阅');assert.equal(result.route.fallback,false);assert(updates.includes('你好'));
 f.setResponse(()=>stream({type:'response.output_text.delta',delta:'partial'},{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}));
 await assert.rejects(streamChat('sse','',{id,model:'fixture-model',messages:[{role:'user',content:'hi'}]},()=>{},new AbortController().signal,'default',()=>{},'/api/account/chatgpt/chat/stream'),/上限/);
});

test('Rotating refresh is serialized and persisted before reuse',async t=>{
 const f=fixture(t);f.authorize();await f.callback();const id=f.plan.status(caller).accounts[0].id;f.advance(3600000);
 assert.deepEqual(await Promise.all([f.plan.access(caller,id),f.plan.access(caller,id),f.plan.access(caller,id)]),['rotated-access','rotated-access','rotated-access']);assert.equal(f.counts().refreshes,1);
 const restored=new ChatGPTPlan(f.dir,'x'.repeat(64),{fetcher:f.fetcher,now:()=>2000003600000,sessionValid:()=>true});assert.equal(await restored.access(caller,id),'rotated-access');restored.close();
 await f.plan.disconnect(caller,id);assert.equal(f.plan.status(caller).accounts[0].connected,false);assert(!readFileSync(f.plan.file,'utf8').includes('rotated-refresh'));await assert.rejects(f.plan.access(caller,id),error=>error.status===403);
});

test('Personal routing executes private models and cross-provider failover without lending credentials',async t=>{
 const f=fixture(t);f.authorize();await f.callback();const admin='x'.repeat(64),accounts=new Accounts(f.dir,admin);
 const ownerToken=await accounts.setup({bootstrapToken:admin,name:'Owner',email:'owner@fixture.invalid',password:'fixture-password-1234'}),owner=accounts.resolve(ownerToken);
 const id=f.plan.state.accounts[0].id,providerId='chatgpt-plan:'+id;
 f.plan.save({...f.plan.state,accounts:f.plan.state.accounts.map(record=>({...record,userId:owner.userId,tenantId:owner.tenantId}))});
 const invite=accounts.invite(owner,{email:'member@fixture.invalid',role:'member'}),memberToken=await accounts.register({email:'member@fixture.invalid',name:'Member',password:'fixture-password-1234',inviteCode:invite.code});
 let failures=0,partial=false;const calls=[];
 const planFetcher=async(url,options)=>{
  if(url.endsWith('/models'))return Response.json({models:['fixture-model','alternate'].map(slug=>({slug,visibility:'list'}))});
  if(url.endsWith('/responses')){const input=JSON.parse(options.body);assert.deepEqual(Object.keys(input),['model','input','store','stream']);calls.push(input.model);
   if(partial)return stream({type:'response.output_text.delta',delta:'partial'},{type:'response.failed'});
   if(failures-->0)return Response.json({error:'quota'},{status:429});
   return stream({type:'response.output_text.delta',delta:'private-ok'},{type:'response.completed',response:{status:'completed',model:input.model,usage:{input_tokens:2,output_tokens:3,total_tokens:5}}});
  }return f.fetcher(url,options);
 };
 const fetcher=async()=>{calls.push('shared');return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:'shared-ok'}}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:2,completion_tokens:3,total_tokens:5}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});};
 const app=createPlatform({dir:f.dir,admin,gateway:'g'.repeat(64),desktopAuth:'d'.repeat(64),oauthConfig:[],planFetcher,fetcher});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{app.closeAllConnections();app.close(resolve);}));
 const base='http://127.0.0.1:'+app.address().port,nativeFetch=globalThis.fetch,headers={cookie:'sr_session='+ownerToken,'content-type':'application/json'};
 const post=(endpoint,data,h=headers)=>nativeFetch(base+endpoint,{method:'POST',headers:h,body:JSON.stringify(data)});
 assert.equal((await post('/api/provider',{id:'shared',name:'Shared',baseUrl:'https://shared.fixture.invalid/v1',protocol:'openai',enabled:true,apiKey:'shared-key',model:'shared-model',models:['shared-model']})).status,200);
 const policy={strategy:'fallback',active:providerId,rules:[],routing:{maxAttempts:3,timeoutMs:10000,requestsPerMinute:100,concurrency:5,currency:'USD'}};
 assert.equal((await post('/api/account/chatgpt/routing',policy)).status,200);
 const configuration=await(await nativeFetch(base+'/api/account/chatgpt/routing',{headers})).json();assert.equal(configuration.personalRouting,true);assert(!JSON.stringify(configuration).includes('private-access'));assert(!JSON.stringify(configuration).includes('shared-key'));assert(!Object.hasOwn(configuration.providers.find(p=>p.id==='shared'),'secret'));
 const preview=await(await post('/api/account/chatgpt/routing/preview',{model:'auto'})).json();assert.deepEqual(preview.candidates.slice(0,3).map(p=>p.model),['fixture-model','alternate','shared-model']);
 const customDraft={...policy,routing:{...policy.routing,primaryModel:'alternate',backupMode:'selected',backups:[{providerId:'shared',model:'shared-model'}]}};
 const ownPreview=await(await post('/api/account/chatgpt/routing/preview',{model:'auto',policy:customDraft})).json();assert.equal(ownPreview.draft,true);assert.deepEqual(ownPreview.candidates.map(p=>p.model),['alternate','shared-model']);
 const unchanged=await(await nativeFetch(base+'/api/account/chatgpt/routing',{headers})).json();assert.notEqual(unchanged.routing.primaryModel,'alternate','预览不得保存个人草稿');
 globalThis.fetch=(url,options)=>nativeFetch(new URL(url,base),{...options,headers:{...options.headers,cookie:'sr_session='+ownerToken}});t.after(()=>globalThis.fetch=nativeFetch);
 const chat=()=>streamChat('sse','',{model:'auto',messages:[{role:'user',content:'hi'}]},()=>{},new AbortController().signal,'default',()=>{},'/api/account/chatgpt/route/stream');
 let result=await chat();assert.equal(result.content,'private-ok');assert.equal(result.route.providerId,providerId);assert.equal(result.outputTokens,3);
 calls.length=0;failures=1;result=await chat();assert.deepEqual(calls,['fixture-model','alternate']);assert.equal(result.route.model,'alternate');assert.equal(result.route.attempt,2);
 calls.length=0;failures=2;result=await chat();assert.deepEqual(calls,['fixture-model','alternate','shared']);assert.equal(result.content,'shared-ok');assert.equal(result.route.attempt,3);
 calls.length=0;partial=true;await assert.rejects(chat());assert.deepEqual(calls,['fixture-model']);partial=false;
 const memberHeaders={...headers,cookie:'sr_session='+memberToken};assert.equal((await post('/api/account/chatgpt/routing',policy,memberHeaders)).status,400);
 const memberConfig=await(await nativeFetch(base+'/api/account/chatgpt/routing',{headers:memberHeaders})).json();assert(!memberConfig.providers.some(p=>p.private));
 const sharedConfig=await(await nativeFetch(base+'/api/state',{headers})).json();assert.notEqual(sharedConfig.active,providerId);assert(!sharedConfig.providers.some(p=>p.private));
 assert.equal(configuration.inherited,false);
 // Save only active: later organization changes must flow through untouched fields.
 assert.equal((await post('/api/account/chatgpt/routing',{strategy:sharedConfig.strategy,active:providerId,rules:sharedConfig.rules,routing:sharedConfig.routing})).status,200);
 assert.equal((await post('/api/routing',{strategy:'weighted',active:'shared',routing:{...sharedConfig.routing,maxAttempts:4}})).status,200);
 const inheritedChange=await(await nativeFetch(base+'/api/account/chatgpt/routing',{headers})).json();assert.equal(inheritedChange.strategy,'weighted');assert.equal(inheritedChange.routing.maxAttempts,4);assert.equal(inheritedChange.active,providerId);
 assert.equal((await post('/api/account/chatgpt/routing/inherit',{})).status,200);
 const restored=await(await nativeFetch(base+'/api/account/chatgpt/routing',{headers})).json();assert.equal(restored.inherited,true);assert.equal(restored.active,'shared');
 calls.length=0;const external=await post('/v1/chat/completions',{model:'auto',stream:true,messages:[{role:'user',content:'hi'}]},{'content-type':'application/json',authorization:'Bearer '+'g'.repeat(64)});await external.text();assert.deepEqual(calls,['shared']);
});

test('Revocation failures still clear local credentials and report unconfirmed remote revocation',async t=>{
 const f=fixture(t);f.authorize();await f.callback();const id=f.plan.status(caller).accounts[0].id,original=f.plan.fetcher;f.plan.fetcher=(url,options)=>url.endsWith('/revoke')?Promise.reject(Error('secret upstream details')):original(url,options);
 assert.deepEqual(await f.plan.disconnect(caller,id),{ok:true,revoked:false});assert.equal(f.plan.own(caller,id).sealed,null);
});

test('A disconnect while refresh is in flight cannot resurrect credentials',async t=>{
 const f=fixture(t);f.authorize();await f.callback();const id=f.plan.status(caller).accounts[0].id;f.advance(3600000);let release,entered;const ready=new Promise(resolve=>entered=resolve),pause=new Promise(resolve=>release=resolve),original=f.plan.fetcher;
 f.plan.fetcher=async(url,options)=>{if(url.endsWith('/token')){entered();await pause;}return original(url,options);};
 const refresh=f.plan.access(caller,id);await ready;await f.plan.disconnect(caller,id);release();await assert.rejects(refresh,/取消/);assert.equal(f.plan.own(caller,id).sealed,null);assert.equal(f.counts().revokes,2);
});

test('Only completed SSE succeeds; failures, incomplete streams and truncation remain errors',async()=>{
 for(const response of [stream({type:'response.output_text.delta',delta:'partial'}),stream({type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}),stream({type:'response.incomplete',response:{status:'incomplete'}}),stream({type:'response.completed',response:{status:'failed'}})])await assert.rejects(readPlanStream(response));
 const encoder=new TextEncoder(),events='data: {"type":"response.output_text.delta","delta":"ok"}\r\n\r\ndata: {"type":"response.completed","response":{"status":"completed"}}\r\n\r\n';
 const byteStream=new ReadableStream({start(controller){for(const char of events)controller.enqueue(encoder.encode(char));controller.close();}});assert.equal((await readPlanStream(new Response(byteStream))).text,'ok');
});

test('Unsupported inputs and viewer authorization are rejected',async t=>{
 const f=fixture(t);assert.throws(()=>f.plan.start({...caller,role:'viewer'},'http://127.0.0.1:3110/api/account/chatgpt/callback'),error=>error.status===403);assert.throws(()=>f.plan.start(caller,'https://remote.invalid/callback'),/本机/);
 assert.throws(()=>planRequest('model',[{role:'system',content:'x'}]));assert.throws(()=>planRequest('model',[{role:'user',content:[{type:'image'}]}]));
 assert.deepEqual(Object.keys(planRequest('model',[{role:'user',content:'hi'}])),['model','input','store','stream']);
 await assert.rejects(f.plan.json(Response.json({error:'invalid token'},{status:401})),error=>error.status===403&&/重新连接/.test(error.message));
});

test('A newer authorization supersedes an in-flight callback and revokes its credentials',async t=>{
 const f=fixture(t);f.authorize();let entered,release;const ready=new Promise(resolve=>entered=resolve),pause=new Promise(resolve=>release=resolve),original=f.plan.fetcher;
 f.plan.fetcher=async(url,options)=>{if(url.endsWith('/token')){entered();await pause;}return original(url,options);};
 const pending=f.callback();await ready;f.plan.start(caller,'http://127.0.0.1:3110/api/account/chatgpt/callback');release();await assert.rejects(pending,/替代/);assert.equal(f.plan.status(caller).accounts.length,0);assert.equal(f.counts().revokes,1);
});

test('Auth transactions expire; a logout during exchange cannot save credentials',async t=>{
 const f=fixture(t);f.authorize();f.advance(600001);await assert.rejects(f.callback(),/过期/);
 f.authorize();const original=f.plan.fetcher;f.plan.fetcher=async(url,options)=>{const value=await original(url,options);if(url.endsWith('/token'))f.setValid(false);return value;};
 await assert.rejects(f.callback(),error=>error.status===401);assert.equal(f.plan.status(caller).accounts.length,0);assert.equal(f.counts().revokes,1);
});

test('Platform isolates subscription routes from public API keys and non-desktop servers',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-plan-http-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const admin='a'.repeat(64),accounts=new Accounts(dir,admin);const token=await accounts.setup({bootstrapToken:admin,name:'Owner',email:'owner@fixture.invalid',password:'fixture-password-1234'});
 const app=createPlatform({dir,admin,gateway:'g'.repeat(64),desktopAuth:'d'.repeat(64),oauthConfig:[]});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{app.closeAllConnections();app.close(resolve);}));const base='http://127.0.0.1:'+app.address().port;
 assert.equal((await fetch(base+'/api/account/chatgpt/status')).status,401);
 assert.equal((await fetch(base+'/api/account/chatgpt/status',{headers:{authorization:'Bearer '+admin}})).status,401);
 const headers={cookie:'sr_session='+token,'content-type':'application/json'};const status=await(await fetch(base+'/api/account/chatgpt/status',{headers})).json();assert.deepEqual(status.accounts,[]);
 assert.equal((await(await fetch(base+'/api/account/me',{headers})).json()).chatgptPlan,true);
 assert.equal((await fetch(base+'/api/account/chatgpt/start',{method:'POST',headers:{...headers,origin:'https://evil.invalid'},body:'{}'})).status,403);
 const start=await(await fetch(base+'/api/account/chatgpt/start',{method:'POST',headers,body:'{}'})).json();const auth=await fetch(start.url,{redirect:'manual'});assert.equal(new URL(auth.headers.get('location')).host,'auth.openai.com');assert.match(auth.headers.get('set-cookie'),/HttpOnly/);
 const callback=await fetch(base+'/api/account/chatgpt/callback?state=invalid&code=must-not-remain-in-url',{redirect:'manual'});assert.equal(callback.status,303);assert.equal(callback.headers.get('location'),'/api/account/chatgpt/result');
 const resultCookie=callback.headers.getSetCookie().find(cookie=>cookie.startsWith('sr_chatgpt_result=')).split(';')[0],result=await fetch(base+'/api/account/chatgpt/result',{headers:{cookie:resultCookie}});assert.match(await result.text(),/授权校验失败/);assert(!result.headers.has('set-cookie')||!result.headers.get('set-cookie').includes('sr_session='));
 const web=createPlatform({dir,admin,gateway:'g'.repeat(64),oauthConfig:[]});await new Promise(resolve=>web.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{web.closeAllConnections();web.close(resolve);}));assert.equal((await fetch('http://127.0.0.1:'+web.address().port+'/api/account/chatgpt/status',{headers})).status,404);
});
