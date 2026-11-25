import test from 'node:test';
import assert from 'node:assert/strict';
import {messageBranchDraft,conversationDocument,createConversationClient} from '../public/conversations.js';

const source=()=>({record:{title:'原会话'},settings:{target:'auto',maxTokens:8192},messages:[{role:'user',content:'第一问'},{role:'assistant',content:'第一答'},{role:'user',content:'第二问'},{role:'assistant',content:'第二答'},{role:'user',content:'第三问'}],draft:'原来未发送的草稿'});
test('编辑和重试仅复制目标问题之前的上下文，不覆盖原件',()=>{
 const entry=source(),before=structuredClone(entry);
 const edited=messageBranchDraft(entry,{index:2,kind:'edit',text:'修改后的第二问'});
 assert.deepEqual(edited.messages,entry.messages.slice(0,2));assert.equal(edited.draft,'修改后的第二问');assert.match(edited.title,/编辑/);
 const retry=messageBranchDraft(entry,{index:3,kind:'retry'});assert.equal(retry.draft,'第二问');assert.deepEqual(retry.messages,entry.messages.slice(0,2));assert.match(retry.title,/重试/);
 retry.settings.target='changed';assert.deepEqual(entry,before);
 assert.deepEqual(messageBranchDraft(entry,{index:1,kind:'retry'}).messages,[]);
});
test('分支拒绝空文本、错误索引、缺失素材与工具上下文',()=>{
 for(const options of [{index:-1},{index:99},{index:2.5},{index:0,kind:'retry'},{index:1,kind:'edit',text:'x'},{index:0,kind:'edit',text:' '}])assert.throws(()=>messageBranchDraft(source(),options));
 for(const patch of [{missingAttachments:true},{tool_calls:true},{video:{}},{tool_calls:[{id:'x'}]}]){const entry=source();Object.assign(entry.messages[0],patch);assert.throws(()=>messageBranchDraft(entry,{index:3,kind:'retry'}),/素材|工具/);}
 const entry=source();entry.messages[2].content=[{type:'text',text:'图片问题'}];assert.throws(()=>messageBranchDraft(entry,{index:3,kind:'retry'}),/素材/);
});
test('Markdown和文本包含草稿，默认不导出思考；JSON仍是完整备份',()=>{
 const row={title:'A / B\n<标题>',status:'stopped',messages:[{role:'user',content:'问题'},{role:'assistant',content:'```js\nlet x = 1;\n```',reasoning_content:'隐藏思考',missingAttachments:true,tool_calls:true}],draft:'未保存草稿',localSaveError:{message:'offline'}};
 const markdown=conversationDocument(row);assert.match(markdown.filename,/\.md$/);assert.doesNotMatch(markdown.filename,/[\/\n<>]/);assert.match(markdown.text,/未发送草稿/);assert.match(markdown.text,/尚未保存/);assert.match(markdown.text,/```js/);assert.doesNotMatch(markdown.text,/隐藏思考/);
 assert.match(conversationDocument(row,'markdown',{includeReasoning:true}).text,/隐藏思考/);
 const plain=conversationDocument(row,'text');assert.match(plain.filename,/\.txt$/);assert.match(plain.text,/【你】/);assert.match(plain.text,/素材未持久保存/);
 const json=conversationDocument(row,'json');assert.deepEqual(JSON.parse(json.text),row);assert.throws(()=>conversationDocument(row,'html'));
});
test('分支先检查源revision，冲突或取消不创建新会话',async t=>{
 let revision=1,posted=0,allowed=true;const record={id:'source',title:'原件',messages:source().messages,draft:'',settings:{target:'auto'},status:'completed',revision:1};
 const fetcher=async(url,options)=>{if(options.method==='POST'){posted++;return {ok:true,json:async()=>({...JSON.parse(options.body),id:'copy',revision:1,status:'idle'})};}return {ok:true,json:async()=>({...structuredClone(record),revision})};};
 const client=createConversationClient({tenantId:'t',userId:'u',fetcher});t.after(()=>client.dispose());const entry=await client.load('source');
 await assert.rejects(client.branchMessage(entry,{index:3,kind:'retry'},{isCurrent:()=>false}),/取消/);assert.equal(posted,0);
 revision=2;await assert.rejects(client.branchMessage(entry,{index:3,kind:'retry'},{isCurrent:()=>allowed}),error=>error.status===409);assert.equal(posted,0);assert.equal(entry.messages[3].content,'第二答');
});
test('消息分支成功后保留原草稿与回复，不发送生成请求',async t=>{
 const record={id:'source',title:'原件',messages:source().messages,draft:'原草稿',settings:{target:'auto'},status:'completed',revision:1};const routes=[];
 const client=createConversationClient({tenantId:'t',fetcher:async(url,options)=>{routes.push(url);return {ok:true,json:async()=>options.method==='POST'?{...JSON.parse(options.body),id:'copy',revision:1,status:'idle'}:structuredClone(record)};}});t.after(()=>client.dispose());
 const entry=await client.load('source'),copy=await client.branchMessage(entry,{index:2,kind:'edit',text:'新问题'});assert.equal(copy.id,'copy');assert.equal(copy.draft,'新问题');assert.equal(entry.draft,'原草稿');assert.equal(entry.messages.length,5);assert.ok(routes.every(url=>!url.includes('/run/')));
});
