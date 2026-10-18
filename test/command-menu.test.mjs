import test from 'node:test';
import assert from 'node:assert/strict';
import {findCommands} from '../public/command-menu.js';

test('全局搜索按当前权限列出页面，支持协议/客户端别名',()=>{
 const member=id=>!['routing','audit','members','subscription','prices'].includes(id);
 assert.deepEqual(findCommands('key',member).map(row=>row.id),['keys']);
 assert.deepEqual(findCommands('codex',member).map(row=>row.id),['connect']);
 assert.equal(findCommands('路由策略',member).length,0);
 assert.deepEqual(findCommands('路由策略',()=>true).map(row=>row.id),['routing']);
 assert.equal(findCommands('',()=>false).length,0);
});

test('模型搜索仅使用传入的当前租户目录；只读角色不提供模型操作',()=>{
 const own=[{id:'["moss","test-model"]',label:'MOSS / test-model'},{id:'["chatgpt-plan:mine","gpt-test"]',label:'ChatGPT 订阅 / gpt-test'}];
 assert.equal(findCommands('moss',()=>true,own)[0].kind,'model');
 assert.equal(findCommands('gpt-test',()=>true,own)[0].id,own[1].id);
 assert.equal(findCommands('gpt-test',id=>id!=='playground',own).length,0);
 assert.equal(findCommands('gpt-test',()=>true,[]).length,0);
 assert.equal(findCommands('',()=>true,own).some(item=>item.kind==='model'),false);
 assert.equal(findCommands('MOSS test',()=>true,own).length,1);
});
