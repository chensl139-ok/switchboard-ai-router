// An isolated, loopback-only workspace. No real upstream requests or credentials.
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createPlatform} from '../platform.mjs';

const dir=mkdtempSync(path.join(tmpdir(),'switchboard-demo-'));
const admin=randomBytes(32).toString('hex'),gateway=randomBytes(32).toString('hex');
const answer='## A resilient model gateway\n\nSwitchboard keeps the application endpoint stable while selecting a compatible upstream.\n\n1. **Preferred model** handles the first attempt.\n2. **Backup model** is used if that attempt fails before output starts.\n3. **Another provider** protects against a provider outage.\n\n```python\nresponse = client.chat.completions.create(\n    model="auto",\n    messages=[{"role": "user", "content": "Hello"}]\n)\n```\n\n> This is a simulated response from the isolated demo. No paid model was called.';
const app=createPlatform({dir,admin,gateway,oauthConfig:[],fetcher:async(url,options={})=>{
 const target=new URL(url);
 if(!target.hostname.endsWith('.example.invalid'))throw Error('Demo blocks all external upstreams');
 const request=JSON.parse(options.body||'{}');
 if(target.pathname.endsWith('/models'))return Response.json({data:['gpt-4.1-mini','gpt-4.1','deepseek-chat'].map(id=>({id}))});
 const usage={prompt_tokens:42,completion_tokens:135,total_tokens:177};
 if(!request.stream)return Response.json({id:'demo',object:'chat.completion',model:request.model,choices:[{index:0,message:{role:'assistant',content:answer},finish_reason:'stop'}],usage});
 const encoder=new TextEncoder();let index=0;
 return new Response(new ReadableStream({async pull(controller){
  if(options.signal?.aborted){controller.error(new Error('Aborted'));return;}
  await new Promise(resolve=>setTimeout(resolve,25));
  if(index<answer.length){const content=answer.slice(index,index+24);index+=24;controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:null}]})+'\n\n'));}
  else{controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}],usage})+'\n\ndata: [DONE]\n\n'));controller.close();}
 }}),{headers:{'content-type':'text/event-stream'}});
}});
await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+app.address().port;
let cookie='';
const post=async(route,data)=>{
 const response=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify(data)});
 if(!response.ok)throw Error(`Demo setup failed: ${route} (${response.status})`);
 if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
 return response.json();
};
await post('/api/account/setup',{bootstrapToken:admin,name:'Demo Owner',email:'demo@example.invalid',password:'demo-workspace-only-2026'});
for(const [id,name,models] of [['atlas','Atlas AI',['gpt-4.1-mini','gpt-4.1']],['harbor','Harbor AI',['deepseek-chat','deepseek-reasoner']],['northstar','Northstar',['qwen-plus']]]){
 await post('/api/provider',{id,name,baseUrl:`https://${id}.example.invalid/v1`,protocol:'openai',model:models[0],models,apiKey:'demo-not-a-real-key',enabled:true});
}
await post('/api/routing',{active:'atlas',strategy:'fallback',routing:{maxAttempts:3,timeoutMs:60000,requestsPerMinute:120,concurrency:10}});
const key=await post('/api/keys',{name:'Product assistant'});
await post('/api/keys',{name:'Engineering tools'});
if(!key.token)throw Error('Demo key was not created');
for(let i=0;i<6;i++){
 const response=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+key.token,'content-type':'application/json'},body:JSON.stringify({model:'auto',messages:[{role:'user',content:'Demo request'}]})});
 if(!response.ok)throw Error(`Demo gateway validation failed (${response.status})`);
 await response.json();
}
console.log(JSON.stringify({url:base,email:'demo@example.invalid',password:'demo-workspace-only-2026',mode:'Isolated demo: all upstreams are simulated. Ctrl+C removes temporary data.'}));
let closing=false;const close=()=>{if(closing)return;closing=true;app.close(()=>{rmSync(dir,{recursive:true,force:true});process.exit(0);});app.closeAllConnections();};
process.on('SIGINT',close);process.on('SIGTERM',close);
