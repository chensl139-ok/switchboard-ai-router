export type RouteMode = 'manual' | 'fallback' | 'weighted' | 'latency' | 'rules';
export interface Provider {
  id: string; name: string; baseUrl: string; protocol: 'openai' | 'anthropic';
  model: string; models: string[]; enabled: boolean; priority: number; weight: number;
  hasKey: boolean;
}
export interface Rule {
  id: string; name: string; keywords: string[]; providerId: string; model: string;
}
export interface RoutingSettings {
  mode: RouteMode; active: string; rules: Rule[];
  timeoutMs: number; maxAttempts: number; requestsPerMinute: number; concurrency: number;
}
export interface AuditEntry { time: string; action: string; target: string }
export interface RequestLog {
  id: string; time: string; providerId: string; provider: string; model: string;
  status: number; latency: number; tokens: number; reason: string;
}
export interface RouterState {
  revision: number; providers: Provider[]; settings: RoutingSettings;
  audit: AuditEntry[]; logs: RequestLog[];
}
export interface SaveProviderRequest {
  revision: number; provider: Provider; apiKey?: string; clearKey?: boolean;
}
export interface ModelQuery {
  id?: string; baseUrl?: string; protocol?: 'openai' | 'anthropic'; apiKey?: string;
}
export interface ModelItem { id: string; name: string }
export interface ModelsResult { items: ModelItem[] }
export interface SaveSettingsRequest { revision: number; settings: RoutingSettings }
export interface SwitchModelRequest { revision: number; id: string; model: string; activate?: boolean }
export interface ChatMessage { role: 'user' | 'assistant' | 'system'; content: string }
export interface ChatRequest {
  model?: string; upstream_model?: string; messages: ChatMessage[];
  max_tokens?: number; temperature?: number; stream?: boolean;
}
export interface ChatResponse {
  id: string; object: 'chat.completion'; created: number; model: string;
  choices: {index: number; message: {role: 'assistant'; content: string}; finish_reason: string}[];
  usage: {prompt_tokens: number; completion_tokens: number; total_tokens: number};
  routing: {providerId: string; reason: string; attempts: number};
}
export interface GatewayModels { object: 'list'; data: {id: string; object: 'model'; owned_by: string}[] }
