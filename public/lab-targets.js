import {modelCapabilities} from './model-capability.js';
export function isPersonalTarget(target){if(target==='personal-auto')return true;try{const value=JSON.parse(target);return Array.isArray(value)&&String(value[0]).startsWith('chatgpt-plan:');}catch{return false;}}
export function labChoices(state){
 const shared=(state.providers||[]).filter(provider=>provider.enabled&&(provider.hasKey||provider.hasMeteredKey));
 const personal=(state.personalProviders||[]).filter(provider=>provider.enabled&&provider.connected&&provider.planEnabled);
 return [...shared,...personal].flatMap(provider=>(provider.models||[]).map(model=>({id:JSON.stringify([provider.id,model]),providerId:provider.id,model,label:provider.name+(provider.private?'（个人订阅）':'')+' / '+(provider.modelNames?.[model]||model),...(provider.private?{subscriptionId:provider.subscriptionId}:{})}))).filter(choice=>modelCapabilities(choice.model).chat);
}
export function planLabRequest(choice,messages){
 if(!choice?.subscriptionId)throw Error('当前订阅不可用，请在服务商与模型中重新连接；不会回退到其他服务商');
 if(!Array.isArray(messages)||!messages.length||messages.length>40)throw Error('个人订阅支持最多 40 条上下文消息，请新建对话');
 let length=0;
 const input=messages.map(message=>{if(!['user','assistant','developer'].includes(message.role)||typeof message.content!=='string'||!message.content.trim()||message.tool_calls?.length)throw Error('当前订阅连接仅支持文本对话，请新建对话移除图片或工具上下文');length+=message.content.length;return {role:message.role,content:message.content};});
 if(length>100000)throw Error('个人订阅上下文过长，请新建对话');
 return {id:choice.subscriptionId,model:choice.model,messages:input};
}
