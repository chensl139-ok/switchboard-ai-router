// Browser-side generation timings use one monotonic clock throughout.
export function createLabTiming(now=()=>performance.now()){
 const started=now();let first=null,blocks=0;
 return {
  observe(hasOutput){if(hasOutput){first??=now();blocks++;}return {ttft:first===null?null:Math.round(first-started),blocks};},
  finish(outputTokens){const ended=now(),durationMs=Math.round(ended-started),ttft=first===null?null:Math.round(first-started);
   const generationMs=first===null?0:Math.max(0,ended-first);
   // Burst-delivered or buffered responses cannot support honest per-token speed.
   const measurable=blocks>=3&&Number.isFinite(outputTokens)&&outputTokens>1&&generationMs>=50;
   return {durationMs,ttft,blocks,tpot:measurable?Math.round(generationMs/(outputTokens-1)):null,tps:measurable?outputTokens/(generationMs/1000):null};
  }
 };
}
