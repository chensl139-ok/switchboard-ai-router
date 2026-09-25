import test from 'node:test';
import assert from 'node:assert/strict';
import {modelCapabilities} from '../public/model-capability.js';

test('自动对话路由与实验室共用媒体模型分类',()=>{
 for(const model of ['moss-speech','moss-tts-1.0-pro','moss-voice-generator-1.0','moss-transcribe-1.0','moss-vl-1.0','moss-vl-1.0-2026-07-08','gpt-image-2','Wan2.2-T2V','text-embedding-3-large','bge-reranker']){
  assert.equal(modelCapabilities(model).chat,false,model);
 }
 for(const model of ['deepseek-v4.1-flash','qwen3-vl-8b-instruct','claude-fable-5'])assert.equal(modelCapabilities(model).chat,true,model);
 assert.equal(modelCapabilities('moss-vl-1.0').vision,true);
 assert.equal(modelCapabilities('moss-vl-1.0').mediaOnly,true);
});
