const priceFields=['inputPerMillion','outputPerMillion','cachedInputPerMillion','perRequest'];
const minute=value=>{if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))throw fail('时段时间须为 HH:mm');const [h,m]=value.split(':').map(Number);return h*60+m;};
const includesMinute=(start,end,m)=>start<end?m>=start&&m<end:m>=start||m<end;
const fail=message=>Object.assign(new Error(message),{status:400});
export function validatePrice(input,source='manual'){
 if(!input||!['USD','CNY'].includes(input.currency))throw fail('价格币种须为 USD 或 CNY');
 for(const field of ['inputPerMillion','outputPerMillion','cachedInputPerMillion','perRequest'])if(input[field]!==undefined&&(!Number.isFinite(input[field])||input[field]<0||input[field]>1000000))throw fail('价格须为非负有限数值');
 if(input.inputPerMillion===undefined||input.outputPerMillion===undefined)throw fail('需同时填写输入与输出价格');
 const observedAt=new Date().toISOString();const expiresAt=input.expiresAt||new Date(Date.now()+(source==='openrouter'?7:30)*86400000).toISOString();
 if(!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=Date.now())throw fail('价格有效期需晚于当前时间');
 let periods=[];const timeZone=input.timeZone||'Asia/Shanghai';try{new Intl.DateTimeFormat('en',{timeZone}).format();}catch{throw fail('无效的 IANA 时区');}
 if(input.periods!==undefined){if(!Array.isArray(input.periods)||input.periods.length>8)throw fail('最多配置 8 个价格时段');const occupied=new Set();periods=input.periods.map(row=>{if(!row||!['peak','offpeak'].includes(row.kind))throw fail('时段类型须为高峰或空闲');const start=minute(row.start),end=minute(row.end);if(start===end)throw fail('开始与结束时间不能相同；全天价格请使用基础价格');for(let m=0;m<1440;m++)if(includesMinute(start,end,m)){if(occupied.has(m))throw fail('价格时段不能重叠（包括跨午夜时段）');occupied.add(m);}const rate=validatePrice({...Object.fromEntries(priceFields.map(k=>[k,row[k]])),currency:input.currency,expiresAt},source);return {kind:row.kind,start:row.start,end:row.end,...Object.fromEntries(priceFields.filter(k=>rate[k]!==undefined).map(k=>[k,rate[k]]))};});}
 return {timeZone,periods,currency:input.currency,inputPerMillion:input.inputPerMillion,outputPerMillion:input.outputPerMillion,...(input.cachedInputPerMillion!==undefined?{cachedInputPerMillion:input.cachedInputPerMillion}:{}),perRequest:input.perRequest||0,source,observedAt,expiresAt};
}
export function openRouterPrice(row){
 const p=row?.pricing;if(!p)return null;
 const values=[p.prompt,p.completion,p.request??'0'];
 if(values.some(v=>typeof v!=='string'||v.trim()===''||!Number.isFinite(Number(v))||Number(v)<0))return null;
 const cache=p.input_cache_read;const cachedInputPerMillion=typeof cache==='string'&&cache.trim()!==''&&Number.isFinite(Number(cache))&&Number(cache)>=0?Number(cache)*1000000:undefined;
 return validatePrice({cachedInputPerMillion,currency:'USD',inputPerMillion:Number(p.prompt)*1000000,outputPerMillion:Number(p.completion)*1000000,perRequest:Number(p.request||0)},'openrouter');
}
export function usablePrice(price,currency,now=Date.now()){return !!price&&price.currency===currency&&Number.isFinite(price.inputPerMillion)&&Number.isFinite(price.outputPerMillion)&&price.inputPerMillion>=0&&price.outputPerMillion>=0&&Date.parse(price.expiresAt)>now;}
export function priceAt(price,now=Date.now()){
 if(!price?.periods?.length)return price;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:price.timeZone||'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now));
 const m=Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);
 const period=price.periods.find(p=>includesMinute(minute(p.start),minute(p.end),m));
 return period?{...price,...period,cachedInputPerMillion:period.cachedInputPerMillion,periods:[],periodLabel:period.kind==='peak'?'高峰':'空闲'}:{...price,periods:[],periodLabel:'基础'};
}
export function priceEstimate(price,inputTokens,outputTokens,cachedInputTokens=0,now=Date.now()){price=priceAt(price,now);return ((inputTokens-cachedInputTokens)*price.inputPerMillion+cachedInputTokens*(price.cachedInputPerMillion??price.inputPerMillion)+outputTokens*price.outputPerMillion)/1000000+(price.perRequest||0);}
export function usageCost(provider,model,usage,now=Date.now()){
 const price=priceAt(provider.prices?.[model],now);
 if(!usage?.known||usage.cacheUsageInvalid||usage.cacheCreationTokens>0||!price||!usablePrice(price,price.currency,now)||(usage.cachedInputTokens>0&&!Number.isFinite(price.cachedInputPerMillion)))return {estimatedCost:null,currency:price?.currency||null,priceSource:price?.source||null};
 return {estimatedCost:priceEstimate(price,usage.inputTokens,usage.outputTokens,usage.cachedInputTokens||0),currency:price.currency,priceSource:price.source};
}

export function normalizeUsage(raw){
 const valid=n=>Number.isSafeInteger(n)&&n>=0;
 const known=valid(raw?.prompt_tokens)&&valid(raw?.completion_tokens);
 const cached=raw?.prompt_tokens_details?.cached_tokens??raw?.prompt_cache_hit_tokens;
 const creation=raw?.prompt_tokens_details?.cache_creation_tokens;
 const cacheUsageInvalid=(cached!==undefined&&(!valid(cached)||cached>raw?.prompt_tokens))||(creation!==undefined&&(!valid(creation)||creation+(cached||0)>raw?.prompt_tokens));
 return {known,cachedInputTokens:valid(cached)?cached:0,cacheCreationTokens:valid(creation)?creation:0,cacheUsageInvalid,inputTokens:valid(raw?.prompt_tokens)?raw.prompt_tokens:0,outputTokens:valid(raw?.completion_tokens)?raw.completion_tokens:0,totalTokens:valid(raw?.total_tokens)?raw.total_tokens:known?raw.prompt_tokens+raw.completion_tokens:0};
}
