import {randomUUID} from 'node:crypto';
import {clientResponse,protocolError} from './protocols.mjs';
export function createClientStream(kind,emit){
 const ids={id:(kind==='responses'?'resp_':kind==='messages'?'msg_':'cmpl_')+randomUUID(),messageId:'msg_'+randomUUID(),toolIds:[],forceMessage:true};
 let started=false,sequence=0,model='',created=Math.floor(Date.now()/1000),text='',finish='stop',usage={},native=false;
 const calls=new Map();
 const typed=(type,data={})=>emit(type,{type,...data,...(kind==='responses'?{sequence_number:sequence++}:{})});
 const chatData=()=>({id:ids.id,created,model,choices:[{index:0,message:{role:'assistant',content:text,...(calls.size?{tool_calls:[...calls.values()].map(t=>({id:t.id,type:'function',function:{name:t.name,arguments:t.args||'{}'}}))}:{})},finish_reason:finish}],usage});
 async function start(chunk){
  if(started)return;started=true;model=chunk.model||'auto';created=chunk.created||created;
  if(kind==='messages'){await typed('message_start',{message:{id:ids.id,type:'message',role:'assistant',model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:0,output_tokens:0}}});await typed('content_block_start',{index:0,content_block:{type:'text',text:''}});}
  if(kind==='responses'){
   const response={...clientResponse('responses',chatData(),ids),status:'in_progress',output:[],usage:null};
   await typed('response.created',{response});await typed('response.in_progress',{response});
   await typed('response.output_item.added',{output_index:0,item:{id:ids.messageId,type:'message',role:'assistant',status:'in_progress',content:[]}});
   await typed('response.content_part.added',{item_id:ids.messageId,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[],logprobs:[]}});
  }
 }
 return {
  async nativeEvent(event){native=true;await emit(event.type,event);},
  async push(chunk){
   if(native)return;
   if(kind==='chat'){await emit(null,chunk);return;}
   await start(chunk);if(chunk.usage)usage=chunk.usage;
   const choice=chunk.choices?.[0];if(!choice)return;if(choice.finish_reason)finish=choice.finish_reason;
   const delta=choice.delta||{};
   if(typeof delta.content==='string'){
    text+=delta.content;
    if(kind==='messages')await typed('content_block_delta',{index:0,delta:{type:'text_delta',text:delta.content}});
    if(kind==='responses')await typed('response.output_text.delta',{item_id:ids.messageId,output_index:0,content_index:0,delta:delta.content,logprobs:[]});
    if(kind==='completions')await emit(null,{id:ids.id,object:'text_completion',created,model,choices:[{index:0,text:delta.content,logprobs:null,finish_reason:null}]});
   }
   for(const tool of delta.tool_calls||[]){
    if(kind==='completions')throw protocolError('传统 Completions 不支持工具调用',502);
    const index=tool.index??0;let current=calls.get(index);
    if(!current){current={id:tool.id||'call_'+randomUUID(),name:tool.function?.name||'',args:'',outputIndex:calls.size+1};calls.set(index,current);ids.toolIds.push('fc_'+randomUUID());
     if(kind==='messages')await typed('content_block_start',{index:current.outputIndex,content_block:{type:'tool_use',id:current.id,name:current.name,input:{}}});
     if(kind==='responses')await typed('response.output_item.added',{output_index:current.outputIndex,item:{id:ids.toolIds[current.outputIndex-1],type:'function_call',call_id:current.id,name:current.name,arguments:'',status:'in_progress'}});
    }
    if(tool.function?.arguments){current.args+=tool.function.arguments;
     if(kind==='messages')await typed('content_block_delta',{index:current.outputIndex,delta:{type:'input_json_delta',partial_json:tool.function.arguments}});
     if(kind==='responses')await typed('response.function_call_arguments.delta',{item_id:ids.toolIds[current.outputIndex-1],output_index:current.outputIndex,delta:tool.function.arguments});
    }
   }
  },
  async finish(result){
   if(native)return;
   if(kind==='chat'){await emit(null,'[DONE]');return;}
   await start({model:result.model});if(result.usage)usage=result.usage;
   if(kind==='completions'){await emit(null,{...clientResponse('completions',chatData(),ids),choices:[{index:0,text:'',finish_reason:finish,logprobs:null}]});await emit(null,'[DONE]');return;}
   if(kind==='messages'){
    for(const t of calls.values()){try{JSON.parse(t.args||'{}');}catch{throw protocolError('上游工具参数不是有效 JSON',502);}}
    await typed('content_block_stop',{index:0});for(const t of calls.values())await typed('content_block_stop',{index:t.outputIndex});
    await typed('message_delta',{delta:{stop_reason:calls.size?'tool_use':finish==='length'?'max_tokens':'end_turn',stop_sequence:null},usage:{input_tokens:usage.prompt_tokens||0,output_tokens:usage.completion_tokens||0}});await typed('message_stop');return;
   }
   const response=clientResponse('responses',chatData(),ids);
   await typed('response.output_text.done',{item_id:ids.messageId,output_index:0,content_index:0,text,logprobs:[]});
   await typed('response.content_part.done',{item_id:ids.messageId,output_index:0,content_index:0,part:response.output[0].content[0]});
   await typed('response.output_item.done',{output_index:0,item:response.output[0]});
   for(const t of calls.values()){
    await typed('response.function_call_arguments.done',{item_id:ids.toolIds[t.outputIndex-1],output_index:t.outputIndex,name:t.name,arguments:t.args||'{}'});
    await typed('response.output_item.done',{output_index:t.outputIndex,item:response.output[t.outputIndex]});
   }
   await typed(response.status==='incomplete'?'response.incomplete':'response.completed',{response});
  },
 };
}
