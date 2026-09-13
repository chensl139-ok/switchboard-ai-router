import OpenAI from 'openai';
const apiKey=process.env.ROUTER_API_KEY;if(!apiKey)throw Error('请设置 ROUTER_API_KEY 为产品中创建的租户 Key');
const client=new OpenAI({baseURL:process.env.ROUTER_BASE_URL||'http://127.0.0.1:3000/v1',apiKey});
const model=process.env.MODEL||'auto';
const messages=[{role:'user',content:'请调用 add 工具计算 15 加 27，然后告诉我结果。'}];
const tools=[{type:'function',function:{name:'add',description:'Add two numbers',parameters:{type:'object',properties:{a:{type:'number'},b:{type:'number'}},required:['a','b'],additionalProperties:false}}}];
for(let round=0;round<3;round++){
 const result=await client.chat.completions.create({model,messages,tools,max_tokens:512});const message=result.choices[0].message;messages.push(message);
 if(!message.tool_calls?.length){console.log(message.content);break;}
 for(const call of message.tool_calls){
  // Only an explicitly registered local tool is executed. Never eval model output.
  if(call.function.name!=='add')throw Error('未知工具');
  const args=JSON.parse(call.function.arguments);if(!Number.isFinite(args.a)||!Number.isFinite(args.b))throw Error('工具参数无效');
  messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify({result:args.a+args.b})});
 }
}
