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

test('专用增强模型保持可发现但不混入对话、TTS、图片或视频生成',async()=>{
 const {catalogSnapshot}=await import('../public/model-catalog.js');
 const models=['moss-speech-enhance','moss-image-prompt-enhancer-1.0','provider::moss-image-enhance','org/audio-enhancement-v1','video-enhancer-v2','enhance'];
 for(const model of models){const cap=modelCapabilities(model);assert.ok(cap.enhancement,model);for(const key of ['chat','image','speech','transcription','video','mediaOnly'])assert.equal(cap[key],false,model+':'+key);}
 assert.equal(modelCapabilities('chat-enhanced-v2').chat,true);
 assert.equal(modelCapabilities('enhance::gpt-4.1').enhancement,'');
 assert.equal(modelCapabilities('enhance/gpt-4.1').enhancement,'');
 assert.equal(modelCapabilities('moss-speech').speech,true);
 const rows=catalogSnapshot({providers:[{id:'moss',name:'MOSS',models,enabled:true,hasKey:true}]}).rows;
 assert.equal(rows.length,models.length);assert.match(rows.find(row=>row.id==='moss-speech-enhance').kindLabel,/音频增强/);assert.ok(rows.every(row=>row.kind==='other'));
});
