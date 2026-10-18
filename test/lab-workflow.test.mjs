import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationSnapshot} from '../public/lab-history-format.js';
import {resumeConversation} from '../public/lab-history-client.js';

const record=(messages,status='completed')=>({area:'chat',status,result:conversationSnapshot(messages)});

test('完整文本历史继续为独立对话，保留路由、正文和性能数据',()=>{
 const row=record([
  {role:'user',content:'解释路由'},
  {role:'assistant',content:'选择可用的服务商。',status:'完成',label:'模型 A',route:{providerId:'a',model:'model-a'},stats:{ttft:120},reasoning_content:'已检查上下文'},
 ]);
 const before=JSON.stringify(row),restored=resumeConversation(row);
 assert.equal(restored.draft,'');
 assert.equal(restored.messages.length,2);
 assert.equal(restored.messages[1].content,'选择可用的服务商。');
 assert.equal(restored.messages[1].route.model,'model-a');
 assert.equal(restored.messages[1].stats.ttft,120);
 assert.equal(restored.messages[1].thinkingOpen,false);
 assert.equal(JSON.stringify(row),before);
});

test('失败和停止的最后一轮恢复为草稿，不把失败回复放进继续的上下文',()=>{
 for(const status of ['失败','已停止']){
  const restored=resumeConversation(record([
   {role:'user',content:'第一轮'},
   {role:'assistant',content:'已完成',status:'完成'},
   {role:'user',content:'请继续'},
   {role:'assistant',content:'部分输出',status},
  ],status==='失败'?'failed':'stopped'));
  assert.equal(restored.messages.length,2);
  assert.equal(restored.draft,'请继续');
 }
});

test('图片、工具、截断与旧版记录不能被当成完整上下文恢复',()=>{
 const image=record([{role:'user',content:[{type:'text',text:'描述图片'},{type:'image_url',image_url:{url:'data:image/png;base64,AA'}}]}]);
 assert.throws(()=>resumeConversation(image),/未保存的图片或工具上下文/);
 const tool=record([{role:'assistant',content:'',tool_calls:[{id:'a',function:{name:'weather',arguments:'{}'}}]}]);
 assert.throws(()=>resumeConversation(tool),/未保存的图片或工具上下文/);
 const clipped={status:'completed',result:JSON.stringify({version:2,truncated:true,messages:[{role:'user',content:'部分文本'}]})};
 assert.throws(()=>resumeConversation(clipped),/未完整保存/);
 assert.throws(()=>resumeConversation({status:'completed',result:'{"messages":[]}'}),/未完整保存/);
});

test('处理中、空白和损坏的历史返回可操作的说明',()=>{
 assert.throws(()=>resumeConversation(record([{role:'user',content:'你好'}],'running')),/仍在生成/);
 assert.throws(()=>resumeConversation(record([])),/没有可继续/);
 assert.throws(()=>resumeConversation({status:'completed',result:'bad json'}),/格式不完整/);
 assert.throws(()=>resumeConversation(record([{role:'system',content:'不支持的上下文'}])),/消息类型/);
 assert.throws(()=>resumeConversation(record([{role:'assistant',content:'回复中',status:'生成中'}])),/尚未完成/);
});
