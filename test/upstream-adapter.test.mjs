import test from 'node:test';
import assert from 'node:assert/strict';
import {createUpstreamAdapter} from '../upstream-adapter.mjs';

const adapter=createUpstreamAdapter({unseal:value=>value==='metered'?'metered-token':'subscription-token'});
const input={messages:[{role:'user',content:'ping'}],max_tokens:8,thinking_mode:'auto'};

test('按模型协议选择上游路径、鉴权头和负载',()=>{
 const base={baseUrl:'https://example.com/v1',model:'test-model',routeSecret:'subscription'};
 const chat=adapter.requestFor({...base,protocol:'openai'},input);
 assert.equal(chat.url,'https://example.com/v1/chat/completions');
 assert.equal(chat.options.headers.authorization,'Bearer subscription-token');
 assert.equal(JSON.parse(chat.options.body).model,'test-model');
 const responses=adapter.requestFor({...base,protocol:'responses',routeSecret:'metered'},input);
 assert.equal(responses.url,'https://example.com/v1/responses');
 assert.equal(responses.options.headers.authorization,'Bearer metered-token');
 assert.equal(JSON.parse(responses.options.body).max_output_tokens,8);
 const anthropic=adapter.requestFor({...base,protocol:'anthropic',routeSecret:'metered',anthropicAuth:'bearer'},input);
 assert.equal(anthropic.url,'https://example.com/v1/messages');
 assert.equal(anthropic.options.headers.authorization,'Bearer metered-token');
 assert.equal(anthropic.options.headers['anthropic-version'],'2023-06-01');
 assert.equal(JSON.parse(anthropic.options.body).max_tokens,8);
});
