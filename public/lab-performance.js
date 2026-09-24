// Browser-side timings use one monotonic clock throughout. The upstream only
// reports total output tokens, not per-token timestamps, so decoding TPS/TPOT
// cannot be inferred from the spacing of SSE frames.
export function createLabTiming(now=()=>performance.now()){
 const started=now();let first=null,blocks=0;
 return {
  observe(hasOutput){if(hasOutput){first??=now();blocks++;}return {ttft:first===null?null:Math.round(first-started),blocks};},
  finish(outputTokens){const ended=now(),durationMs=Math.round(ended-started),ttft=first===null?null:Math.round(first-started);
   // End-to-end output throughput is measurable even for buffered streams and
   // reasoning models; decoding speed is not, so TPOT deliberately stays null.
   const tps=Number.isInteger(outputTokens)&&outputTokens>0&&durationMs>0?outputTokens/(durationMs/1000):null;
   return {durationMs,ttft,blocks,tpot:null,tps};
  }
 };
}
