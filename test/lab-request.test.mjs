import test from 'node:test';
import assert from 'node:assert/strict';
import {buildExperimentRequest,experimentResult,runExperiment} from '../public/lab-request.ts';

const choice={providerId:'mosi',model:'claude-haiku-4-5'};

test('模型实验请求固定选择服务商与模型，拒绝无效参数',()=>{
 assert.deepEqual(buildExperimentRequest(choice,' 你好 ',8),{model:'mosi',upstream_model:'claude-haiku-4-5',messages:[{role:'user',content:'你好'}],max_tokens:8});
 assert.throws(()=>buildExperimentRequest(choice,' ',8));
 assert.throws(()=>buildExperimentRequest(choice,'x',0));
 assert.throws(()=>buildExperimentRequest(choice,'x',1.5));
});

test('模型实验结果保留文字、思考、工具及真实用量',()=>{
 assert.deepEqual(experimentResult({model:'claude-haiku-4-5',choices:[{message:{content:[{type:'text',text:'答复'}],reasoning_content:'推理',tool_calls:[{id:'call_1'}]}}],usage:{prompt_tokens:3,completion_tokens:4,total_tokens:7}},42),{content:'答复',reasoning:'推理',toolCalls:[{id:'call_1'}],elapsedMs:42,model:'claude-haiku-4-5',usage:{input:3,output:4,total:7}});
 assert.throws(()=>experimentResult({choices:[]},1));
});

test('模型实验发送单独请求，透传鉴权并显示上游错误',async()=>{
 let request;
 const fetcher=async(url,options)=>{request={url,options};return Response.json({choices:[{message:{content:'ok'}}],usage:{}},{status:200});};
 const result=await runExperiment(choice,'ping',8,{token:'test-token',tenantId:'tenant-1',fetcher});
 assert.equal(request.url,'/api/chat');
 assert.equal(request.options.headers.authorization,'Bearer test-token');
 assert.equal(request.options.headers['X-Tenant-ID'],'tenant-1');
 assert.equal(JSON.parse(request.options.body).upstream_model,choice.model);
 assert.equal(result.content,'ok');
 assert.equal(result.usage.total,null);
 await assert.rejects(runExperiment(choice,'ping',8,{fetcher:async()=>Response.json({error:{message:'上游限流'}},{status:502})}),/上游限流/);
});
