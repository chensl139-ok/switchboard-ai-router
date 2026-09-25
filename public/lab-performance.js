// All measurements use the same monotonic browser clock. SSE frames can contain
// several tokens, so frame intervals must never be presented as per-token time.
export function createLabTiming(now=()=>performance.now()){
 const started=now();let firstByte=null,first=null,last=null,blocks=0;
 return {
  markFirstByte(){firstByte??=now();},
  observe(hasOutput){if(hasOutput){const at=now();firstByte??=at;first??=at;last=at;blocks++;}return {ttft:first===null?null:Math.round(first-started),blocks};},
  finish(outputTokens,{streamed=false}={}){const ended=now(),durationMs=Math.round(ended-started),ttft=first===null?null:Math.round(first-started),ttfb=firstByte===null?null:Math.round(firstByte-started);
   const tps=Number.isInteger(outputTokens)&&outputTokens>0&&durationMs>0?outputTokens/(durationMs/1000):null;
   // The final visible output event, not the [DONE] marker, ends generation.
   // Upstream usage supplies token count; browser stream timing supplies the span.
   const tpot=streamed&&blocks>1&&last-first>=20&&Number.isInteger(outputTokens)&&outputTokens>1?(last-first)/(outputTokens-1):null;
   return {durationMs,ttfb,ttft,blocks,tpot,tps};
  }
 };
}
