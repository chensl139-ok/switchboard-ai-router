<script setup lang="ts">
import {computed, onBeforeUnmount, ref} from 'vue';
import {runExperiment, type ExperimentChoice, type ExperimentResult} from './lab-request.ts';

const props=defineProps<{choices: ExperimentChoice[]; token?: string; tenantId?: string; onSwitch: () => void; onMedia?: () => void}>();
type RunItem={choice: ExperimentChoice; status: '等待中' | '运行中' | '完成' | '失败' | '已停止'; result?: ExperimentResult; error?: string};
const selected=ref(props.choices.slice(0,2).map(choice=>choice.id));
const prompt=ref(''),maxTokens=ref(1024),busy=ref(false),error=ref(''),items=ref<RunItem[]>([]),lastRun=ref<unknown>(null);
const choiceMap=computed(()=>new Map(props.choices.map(choice=>[choice.id,choice])));
let controller: AbortController | null=null;
onBeforeUnmount(()=>controller?.abort());

function addModel(){const next=props.choices.find(choice=>!selected.value.includes(choice.id));if(next&&selected.value.length<4){selected.value.push(next.id);clearResults();}}
function removeModel(){if(selected.value.length>2){selected.value.pop();clearResults();}}
function clearResults(){items.value=[];lastRun.value=null;error.value='';}
function switchView(){controller?.abort();props.onSwitch();}
function stop(){controller?.abort();}
function saveResults(){if(!lastRun.value)return;const blob=new Blob([JSON.stringify(lastRun.value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='model-comparison-'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function run(){
 if(busy.value)return;
 if(selected.value.length<2||new Set(selected.value).size!==selected.value.length){error.value='请选择至少两个不同的模型';return;}
 if(!prompt.value.trim()||prompt.value.length>10000){error.value='请输入 1–10000 个字符的问题';return;}
 if(!Number.isInteger(maxTokens.value)||maxTokens.value<1||maxTokens.value>131072){error.value='最大输出 Tokens 需为 1–131072';return;}
 const choices=selected.value.map(id=>choiceMap.value.get(id));
 if(choices.some(choice=>!choice)){error.value='模型列表已变化，请重新选择';return;}
 items.value=choices.map(choice=>({choice:choice!,status:'等待中'}));error.value='';lastRun.value=null;busy.value=true;
 const request=new AbortController();controller=request;let next=0;
 async function worker(){while(next<items.value.length&&!request.signal.aborted){const item=items.value[next++];item.status='运行中';try{item.result=await runExperiment(item.choice,prompt.value,maxTokens.value,{token:props.token,tenantId:props.tenantId,signal:request.signal});item.status='完成';}catch(cause){item.status=request.signal.aborted?'已停止':'失败';item.error=cause instanceof Error?cause.message:String(cause);}}}
 try{await Promise.all([worker(),worker()]);if(request.signal.aborted)for(const item of items.value)if(item.status==='等待中')item.status='已停止';lastRun.value={createdAt:new Date().toISOString(),prompt:prompt.value,maxTokens:maxTokens.value,results:items.value.map(item=>({providerId:item.choice.providerId,model:item.choice.model,status:item.status,...(item.result?{result:item.result}:{}),...(item.error?{error:item.error}:{})}))};}
 finally{if(controller===request)controller=null;busy.value=false;}
}
</script>

<template>
 <div class="heading lab-heading"><div><div class="eyebrow">YOUR MODELS. ONE GATEWAY.</div><h1>模型实验室</h1><p>在同一工作区测试对话与媒体模型；调用设置仅影响本次实验。</p></div></div>
 <div class="lab-nav-row compare-nav-row"><div class="page-tabs" role="tablist" aria-label="模型实验室视图"><button type="button" role="tab" aria-selected="false" @click="switchView">对话</button><button v-if="props.onMedia" type="button" role="tab" aria-selected="false" @click="props.onMedia?.()">媒体</button><button type="button" role="tab" aria-selected="true" class="selected">多模型对比</button></div><span class="lab-model-count">同一问题 · 独立调用 · 并排评估</span></div>
 <div class="panel compare-controls"><label>测试问题<textarea v-model="prompt" rows="2" maxlength="10000" placeholder="输入同一道测试问题，再选择下方模型" :disabled="busy"></textarea></label><div class="compare-actions"><label>最大输出 Tokens<input v-model.number="maxTokens" type="number" min="1" max="131072" :disabled="busy"></label><button type="button" :disabled="busy || selected.length>=Math.min(4,choices.length)" @click="addModel">＋ 添加模型</button><button type="button" :disabled="busy || selected.length<=2" @click="removeModel">－ 移除模型</button><button class="primary" type="button" :disabled="busy || choices.length<2" @click="run">开始对比</button><button v-if="busy" type="button" @click="stop">停止</button><button type="button" :disabled="!lastRun" @click="saveResults">导出结果</button></div><p v-if="error" class="lab-error" role="alert">{{error}}</p><p class="muted">每个模型单独计费；最多比较 4 个模型，每次最多并发 2 个请求。问题与结果仅保留在当前页面内存中。</p></div>
 <div class="compare-grid"><article v-for="(id,index) in selected" :key="index" class="panel compare-card"><label>模型 {{index+1}}<select v-model="selected[index]" :disabled="busy" @change="clearResults"><option v-for="choice in choices" :key="choice.id" :value="choice.id">{{choice.label}}</option></select></label><div class="compare-result"><template v-if="items[index]?.status==='完成' && items[index].result"><div class="compare-metrics"><span>耗时 {{items[index].result!.elapsedMs}} ms</span><span>输入 {{items[index].result!.usage.input??'未知'}} tokens</span><span>输出 {{items[index].result!.usage.output??'未知'}} tokens</span></div><details v-if="items[index].result!.reasoning"><summary>思考内容</summary><pre>{{items[index].result!.reasoning}}</pre></details><pre class="compare-output">{{items[index].result!.content||'(无文字输出)'}}</pre><p v-if="items[index].result!.toolCalls.length" class="muted">返回 {{items[index].result!.toolCalls.length}} 个工具调用</p></template><p v-else class="muted">{{items[index]?.status||'等待测试'}}{{items[index]?.error?'：'+items[index].error:''}}</p></div></article></div>
</template>
