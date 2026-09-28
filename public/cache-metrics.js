const validCount=value=>Number.isSafeInteger(value)&&value>=0;

// Cache hit rate is cached input tokens / all input tokens, never request count.
export function cacheHitMetrics(usage){
 if(!usage||typeof usage!=='object')return null;
 let input=usage.prompt_tokens??usage.input_tokens;
 const detailed=usage.prompt_tokens_details?.cached_tokens??usage.input_tokens_details?.cached_tokens;
 const reported=usage.prompt_cache_hit_tokens;
 if(detailed!==undefined&&reported!==undefined&&detailed!==reported)return null;
 let cached=detailed??reported;
 if(cached===undefined&&usage.cache_read_input_tokens!==undefined){
  cached=usage.cache_read_input_tokens;
  const creation=usage.cache_creation_input_tokens??0;
  input=validCount(input)&&validCount(cached)&&validCount(creation)?input+cached+creation:null;
 }
 if(!validCount(input)||!validCount(cached)||input===0||cached>input)return null;
 if(usage.prompt_cache_miss_tokens!==undefined&&(!validCount(usage.prompt_cache_miss_tokens)||cached+usage.prompt_cache_miss_tokens!==input))return null;
 return {inputTokens:input,cachedTokens:cached,rate:cached/input*100};
}

export function cacheHitLabel(metrics){
 if(!metrics)return '未提供';
 if(metrics.cachedTokens===0)return `上游未命中（0/${metrics.inputTokens} tokens）`;
 return `${metrics.cachedTokens}/${metrics.inputTokens} tokens（${metrics.rate.toFixed(1)}%）`;
}
