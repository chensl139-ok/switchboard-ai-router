import test from 'node:test';
import assert from 'node:assert/strict';
import {favoriteModels,safeTaskURL,taskReplay} from '../public/workspace.js';
import {modelWorkspaceTarget} from '../public/lab-targets.js';

const provider={id:'p',name:'示例',enabled:true,hasKey:true,protocol:'openai',baseUrl:'https://example.test/v1',models:['gpt-5','flux-image','moss-ttsd','unknown-thing']};
test('工作台模型入口保留精确目标，不启动未知或禁用能力',()=>{
 const target=modelWorkspaceTarget(provider,'gpt-5');assert.equal(target,'playground?'+new URLSearchParams({target:'["p","gpt-5"]'}));
 assert.equal(modelWorkspaceTarget({...provider,enabled:false},'gpt-5'),null);
 assert.equal(modelWorkspaceTarget({...provider,hasKey:false},'gpt-5'),null);
 assert.equal(modelWorkspaceTarget(provider,'not-configured'),null);
 assert.equal(modelWorkspaceTarget(undefined,'gpt-5'),null);
 const privateProvider={...provider,id:'chatgpt-plan:x',private:true,connected:true,planEnabled:true};assert.match(modelWorkspaceTarget(privateProvider,'gpt-5'),/^playground\?/);
 assert.equal(modelWorkspaceTarget({...privateProvider,connected:false},'gpt-5'),null);
});
test('收藏仅从当前可见服务商解析，失效模型保留不可用状态',()=>{
 const favorites=['not-json','["p","gpt-5"]','["missing","secret"]','["p","removed"]'];
 const rows=favoriteModels({providers:[provider]},favorites);assert.equal(rows.length,2);assert.ok(rows[0].route);assert.equal(rows[1].route,null);
 assert.equal(favoriteModels({providers:[]},favorites).length,0);
});
test('创作回填只提取文字参数，不自动恢复上传素材',()=>{
 assert.deepEqual(taskReplay({kind:'image',model:'p::flux',result:JSON.stringify({prompt:'画一座山',size:'1024x1024',apiKey:'secret'})}),{kind:'image',model:'p::flux',prompt:'画一座山',size:'1024x1024',missing:false});
 assert.equal(taskReplay({kind:'transcription',result:'{}'}).missing,true);
 assert.equal(taskReplay({kind:'video',result:'not-json'}).missing,true);
 assert.equal(taskReplay({kind:'invalid'}).kind,'image');
});
test('媒体结果地址拒绝脚本、凭据和浏览器临时资源',()=>{
 for(const value of ['javascript:alert(1)','data:image/png;base64,abc','blob:https://test/123','https://user:pass@example.test/a','file:///tmp/a','invalid'])assert.equal(safeTaskURL(value),null);
 assert.equal(safeTaskURL('https://example.test/a.png'),'https://example.test/a.png');
});
