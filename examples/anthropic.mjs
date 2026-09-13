import Anthropic from '@anthropic-ai/sdk';
const apiKey=process.env.ROUTER_API_KEY;if(!apiKey)throw Error('请设置 ROUTER_API_KEY');
const client=new Anthropic({baseURL:process.env.ROUTER_BASE_URL||'http://127.0.0.1:3000',apiKey,authToken:null});
const content=[{type:'text',text:process.env.PROMPT||'请简要描述图片；若无图片，请打个招呼。'}];
if(process.env.IMAGE_URL)content.push({type:'image',source:{type:'url',url:process.env.IMAGE_URL}});
const stream=client.messages.stream({model:process.env.MODEL||'auto',max_tokens:512,messages:[{role:'user',content}]});
stream.on('text',text=>process.stdout.write(text));await stream.finalMessage();process.stdout.write('\n');
