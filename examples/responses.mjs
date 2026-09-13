import OpenAI from 'openai';
const apiKey=process.env.ROUTER_API_KEY;if(!apiKey)throw Error('请设置 ROUTER_API_KEY');
const client=new OpenAI({baseURL:process.env.ROUTER_BASE_URL||'http://127.0.0.1:3000/v1',apiKey});
const content=[{type:'input_text',text:process.env.PROMPT||'你好'}];
if(process.env.IMAGE_URL)content.push({type:'input_image',image_url:process.env.IMAGE_URL});
const stream=await client.responses.create({model:process.env.MODEL||'auto',input:[{role:'user',content}],max_output_tokens:512,stream:true,store:false});
for await(const event of stream){if(event.type==='response.output_text.delta')process.stdout.write(event.delta);if(event.type==='error'||event.type==='response.failed')throw Error('生成失败');}
process.stdout.write('\n');
