import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createSSRApp} from 'vue';
import {renderToString} from 'vue/server-renderer';

test('Vue 模型对比界面可构建并安全显示模型名称',async()=>{
 const vite=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});
 try{
  const {default:Component}=await vite.ssrLoadModule('/public/ModelCompare.vue');
  const choices=[{id:'one',providerId:'mosi',model:'model-1',label:'moss / model-1',protocol:'openai',channel:'subscription'},{id:'two',providerId:'mosi',model:'model-2',label:'<script>alert(1)</script>',protocol:'anthropic',channel:'metered'}];
  const html=await renderToString(createSSRApp(Component,{choices,onSwitch(){}}));
  assert.match(html,/多模型|开始对比/);
  assert.match(html,/moss \/ model-1/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/);
 }finally{await vite.close();}
});
