export interface CacheHitMetrics {inputTokens:number;cachedTokens:number;rate:number}
export function cacheHitMetrics(usage:unknown):CacheHitMetrics|null;
export function cacheHitLabel(metrics:CacheHitMetrics|null):string;
