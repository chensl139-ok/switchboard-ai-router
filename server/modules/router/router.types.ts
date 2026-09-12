import type { AuditEntry, Provider, RoutingSettings } from '@shared/api.interface';
export interface StoredProvider extends Omit<Provider, 'hasKey'> { secret?: string }
export interface StoredConfig { providers: StoredProvider[]; settings: RoutingSettings; audit: AuditEntry[] }
export interface Snapshot { config: StoredConfig; revision: number }
export interface Candidate { provider: StoredProvider; model: string; reason: string }
export const defaultConfig = (): StoredConfig => ({
  providers: [
    ['siliconflow', '硅基流动', 'https://api.siliconflow.cn/v1', 'openai'],
    ['deepseek', 'DeepSeek', 'https://api.deepseek.com/v1', 'openai'],
    ['openai', 'OpenAI', 'https://api.openai.com/v1', 'openai'],
    ['anthropic', 'Anthropic', 'https://api.anthropic.com/v1', 'anthropic'],
    ['gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', 'openai'],
    ['qwen', '阿里云百炼', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai'],
  ].map((row: string[]): StoredProvider => ({
    id: row[0], name: row[1], baseUrl: row[2], protocol: row[3] === 'anthropic' ? 'anthropic' : 'openai',
    model: '', models: [], enabled: false, priority: 50, weight: 1,
  })),
  settings: { mode: 'fallback', active: '', rules: [], timeoutMs: 25000, maxAttempts: 3,
    requestsPerMinute: 60, concurrency: 5 }, audit: [],
});
