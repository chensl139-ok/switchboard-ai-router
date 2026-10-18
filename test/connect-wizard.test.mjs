import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inferAgentProtocol,eligibleModels,claudeCodeSnippets,codexSnippets,genericSnippets} from '../public/connect.js';

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
