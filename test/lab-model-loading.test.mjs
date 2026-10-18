import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {labChoices,isPersonalTarget} from '../public/lab-targets.js';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const playground=readFileSync(new URL('../public/playground.js',import.meta.url),'utf8');
const pageSource=app.slice(app.indexOf('async function renderPage(root){'),app.indexOf('\nfunction render(){'));
const updateSource=playground.slice(playground.indexOf(' function refreshPersonalModels(providers){'),playground.indexOf('\n return {updatePersonalProviders:refreshPersonalModels}'));
const shared={id:'shared',name:'组织 API',enabled:true,hasKey:true,models:['gpt-4.1']};
const personal={id:'chatgpt-plan:one',name:'ChatGPT',enabled:true,connected:true,planEnabled:true,private:true,subscriptionId:'one',models:['gpt-5']};

function pageHarness(){
 let finish,fail;
 const pending=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
 const mounted=[],updates=[],notices=[],root={isConnected:true};
 const context={tab:'playground',profile:{tenantId:'one',role:'member',chatgptPlan:true},state:{providers:[shared],personalProviders:[personal]},
  pageLoader:{load:async()=>({renderPlayground:options=>{mounted.push(options);return {updatePersonalProviders:value=>updates.push(value)};}})},
  api:()=>pending,toast:notice=>notices.push(notice),pageTabs:()=>'',isManager:()=>false,token:'',esc:String,
  render:()=>assert.fail('Catalog loading must not rerender the page'),navigate(){},labTarget:JSON.stringify([personal.id,'gpt-5'])};
 runInNewContext(pageSource+';this.renderPage=renderPage;',context);
 return {context,root,mounted,updates,notices,finish,fail};
}

test('组织对话不等待个人目录，保留缓存与指定个人模型并仅局部更新',{timeout:1000},async()=>{
 const h=pageHarness();await h.context.renderPage(h.root);
 assert.equal(h.mounted.length,1);assert.equal(h.mounted[0].personalLoading,true);
 assert.equal(h.mounted[0].initialTarget,JSON.stringify([personal.id,'gpt-5']));
 assert.equal(h.context.state.personalProviders[0],personal);assert.equal(h.updates.length,0);
 h.finish({providers:[personal]});await new Promise(setImmediate);
 assert.equal(h.mounted.length,1);assert.deepEqual(h.updates,[[personal]]);
});

test('离开实验室后迟到目录不修改页面或当前状态',{timeout:1000},async()=>{
 const h=pageHarness();await h.context.renderPage(h.root);
 h.root.isConnected=false;h.context.tab='providers';const previous=h.context.state.personalProviders;
 h.finish({providers:[]});await new Promise(setImmediate);
 assert.deepEqual(h.updates,[]);assert.equal(h.context.state.personalProviders,previous);
});

test('个人目录失败不清空缓存或阻断组织实验室',{timeout:1000},async()=>{
 const h=pageHarness();await h.context.renderPage(h.root);
 h.fail(Error('upstream timeout'));await new Promise(setImmediate);
 assert.equal(h.mounted.length,1);assert.equal(h.context.state.personalProviders[0],personal);
 assert.deepEqual(h.updates,[null]);assert.match(h.notices[0],/不影响组织 API 模型/);
});

function updateHarness(){
 const target=JSON.stringify([personal.id,'gpt-5']),state={providers:[shared],personalProviders:[]},choices=labChoices(state);
 const status={hidden:false},select={value:target,selectedIndex:0,options:[{value:target,textContent:'个人订阅模型加载中…'}],replaceChildren(...options){this.options=options;}};
 let labels=0;
 const history=[{content:'正在生成的回答',status:'生成中'}],controller={abort:()=>assert.fail('Do not abort a generation')};
 const context={state,choices,settings:{target},root:{isConnected:true},personalLoading:true,history,controller,draft:'尚未发送的草稿',
  labChoices,isPersonalTarget,selectedChoice:()=>choices.find(choice=>choice.id===context.settings.target),targetLabel:()=>{labels++;},
  Option:class{constructor(text,value){this.textContent=text;this.value=value;}},
  $:selector=>{assert.ok(['#lab-personal-status','#lab-model'].includes(selector),'No access to messages or composer');return selector==='#lab-model'?select:status;}};
 runInNewContext(updateSource+';this.update=refreshPersonalModels;',context);
 return {context,status,select,history,controller,get labels(){return labels;}};
}

test('目录到达只替换选项，保留个人目标、草稿与正在生成的消息',()=>{
 const h=updateHarness(),target=h.context.settings.target;h.context.update([personal]);
 assert.equal(h.select.value,target);assert.ok(h.select.options.some(option=>option.value===target));
 assert.equal(h.context.settings.target,target);assert.equal(h.context.draft,'尚未发送的草稿');
 assert.equal(h.context.history,h.history);assert.equal(h.context.controller,h.controller);
 assert.equal(h.status.hidden,true);assert.equal(h.labels,1);assert.equal(h.context.personalLoading,false);
});

test('目录失败移除加载中提示，不替换目标或改变组织选项',()=>{
 const h=updateHarness(),choices=h.context.choices.slice(),target=h.select.value;h.context.update(null);
 assert.equal(h.select.value,target);assert.deepEqual(h.context.choices,choices);assert.match(h.select.options[0].textContent,/暂不可用/);
 assert.match(h.status.textContent,/组织模型仍可正常使用/);assert.equal(h.context.personalLoading,false);
});

test('过期实验室的局部更新直接忽略',()=>{
 const h=updateHarness();h.context.root.isConnected=false;h.context.update([personal]);
 assert.equal(h.context.state.personalProviders.length,0);assert.equal(h.labels,0);assert.equal(h.context.personalLoading,true);
});
