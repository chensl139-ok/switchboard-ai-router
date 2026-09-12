import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ChatRequest, ChatResponse, GatewayModels, ModelsResult, RouterState } from '@shared/api.interface';
import { RouterStore } from './router.store';
import { RouterCrypto } from './router.crypto';
import { RouterUpstream, UpstreamError, validateBaseUrl } from './router.upstream';
import { chooseRoutes } from './router.policy';
import { chatSchema, parse, providerSchema, settingsSchema } from './router.validation';
import type { Candidate, Snapshot, StoredProvider } from './router.types';
const revisionSchema = z.number().int().min(1);
const keySchema = z.string().max(4096).optional();
const openaiResponse = z.object({id: z.string(), model: z.string().optional(),
  choices: z.array(z.object({index: z.number().optional(), message: z.object({
    content: z.string().nullable().optional(), reasoning_content: z.string().optional()}),
    finish_reason: z.string().nullable().optional()})).min(1),
  usage: z.object({prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(),
    total_tokens: z.number().optional()}).optional()});
const anthropicResponse = z.object({id: z.string(), model: z.string(), stop_reason: z.string().nullable(),
  content: z.array(z.object({type: z.string(), text: z.string().optional()})),
  usage: z.object({input_tokens: z.number(), output_tokens: z.number()})});
@Injectable()
export class RouterService {
  private readonly logger = new Logger(RouterService.name);
  constructor(private readonly store: RouterStore, private readonly crypto: RouterCrypto,
    private readonly upstream: RouterUpstream) {}
  async state(): Promise<RouterState> {
    const {config, revision}: Snapshot = await this.store.load();
    return {revision, providers: config.providers.map(({secret, ...p}: StoredProvider) => ({...p, hasKey: !!secret})),
      settings: config.settings, audit: config.audit, logs: await this.store.logs()};
  }
  async saveProvider(input: unknown, actor: string): Promise<RouterState> {
    const body = parse(z.object({revision: revisionSchema, provider: providerSchema,
      apiKey: keySchema, clearKey: z.boolean().optional()}), input);
    const snapshot: Snapshot = await this.store.load();
    const old: StoredProvider | undefined = snapshot.config.providers.find((p: StoredProvider) => p.id === body.provider.id);
    const baseUrl: string = validateBaseUrl(body.provider.baseUrl);
    if (old?.secret && !body.apiKey && !body.clearKey && (old.baseUrl !== baseUrl
      || old.protocol !== body.provider.protocol)) throw new BadRequestException('更换地址或协议时请重新输入密钥');
    const models: string[] = [...new Set([...body.provider.models, ...(body.provider.model ? [body.provider.model] : [])])];
    const provider: StoredProvider = {id: body.provider.id, name: body.provider.name, baseUrl,
      protocol: body.provider.protocol, model: body.provider.model || models[0] || '', models,
      priority: body.provider.priority, weight: body.provider.weight, enabled: body.provider.enabled,
      secret: body.clearKey ? undefined : body.apiKey ? this.crypto.encrypt(body.apiKey) : old?.secret};
    if (provider.enabled && (!provider.secret || !provider.model)) throw new BadRequestException('启用前请填写密钥并至少选择一个模型');
    if (!old && snapshot.config.providers.length >= 30) throw new BadRequestException('最多配置 30 个服务商');
    if (old) snapshot.config.providers[snapshot.config.providers.indexOf(old)] = provider;
    else snapshot.config.providers.push(provider);
    if (!snapshot.config.settings.active && provider.enabled) snapshot.config.settings.active = provider.id;
    const referenced: boolean = snapshot.config.settings.rules.some((r) => r.providerId === provider.id && !models.includes(r.model));
    if (referenced) throw new BadRequestException('该模型被任务规则引用，请先修改规则');
    await this.store.save(snapshot.config, body.revision, '保存服务商', provider.name, actor);
    return this.state();
  }
  async saveSettings(input: unknown, actor: string): Promise<RouterState> {
    const body = parse(z.object({revision: revisionSchema, settings: settingsSchema}), input);
    const {config}: Snapshot = await this.store.load();
    if (body.settings.active && !config.providers.some((p: StoredProvider) =>
      p.id === body.settings.active && p.enabled && p.secret && p.model)) throw new BadRequestException('默认服务商尚未启用');
    if (body.settings.mode === 'manual' && !body.settings.active) throw new BadRequestException('固定模式必须先选择默认服务商');
    for (const rule of body.settings.rules) {
      if (!config.providers.some((p: StoredProvider) => p.id === rule.providerId && p.enabled && p.models.includes(rule.model))) {
        throw new BadRequestException(`规则「${rule.name}」的服务商或模型不可用`);
      }
    }
    config.settings = body.settings;
    await this.store.save(config, body.revision, '更新路由策略', body.settings.mode, actor);
    return this.state();
  }
  async switchModel(input: unknown, actor: string): Promise<RouterState> {
    const body = parse(z.object({revision: revisionSchema, id: z.string(), model: z.string(), activate: z.boolean().optional()}), input);
    const {config}: Snapshot = await this.store.load();
    const p: StoredProvider | undefined = config.providers.find((v: StoredProvider) => v.id === body.id);
    if (!p?.models.includes(body.model)) throw new BadRequestException('请选择已保存的模型');
    if (body.activate && (!p.enabled || !p.secret)) throw new BadRequestException('服务商尚未启用');
    p.model = body.model;
    if (body.activate) config.settings.active = p.id;
    await this.store.save(config, body.revision, body.activate ? '切换默认路由' : '切换模型', `${p.name} / ${p.model}`, actor);
    return this.state();
  }
  async models(input: unknown): Promise<ModelsResult> {
    const body = parse(z.object({id: z.string().optional(), baseUrl: z.string().optional(),
      protocol: z.enum(['openai', 'anthropic']).optional(), apiKey: keySchema}), input);
    await this.store.rate('model-list', 20);
    const {config}: Snapshot = await this.store.load();
    const old: StoredProvider | undefined = config.providers.find((p: StoredProvider) => p.id === body.id);
    const baseUrl: string = validateBaseUrl(body.baseUrl || old?.baseUrl || '');
    const protocol = body.protocol || old?.protocol || 'openai';
    if (!body.apiKey && old?.secret && (baseUrl !== old.baseUrl || protocol !== old.protocol)) {
      throw new BadRequestException('地址或协议已改变，请重新输入密钥');
    }
    const key: string = body.apiKey || (old?.secret ? this.crypto.decrypt(old.secret) : '');
    if (!key) throw new BadRequestException('请先输入 API Key');
    const gemini: boolean = baseUrl === 'https://generativelanguage.googleapis.com/v1beta/openai';
    const headers: Record<string, string> = gemini ? {'x-goog-api-key': key} : protocol === 'anthropic'
      ? {'x-api-key': key, 'anthropic-version': '2023-06-01'} : {authorization: `Bearer ${key}`};
    const endpoint: string = gemini ? 'https://generativelanguage.googleapis.com/v1beta/models' : baseUrl + '/models';
    const items = new Map<string, {id: string; name: string}>();
    const seen = new Set<string>();
    let cursor = '';
    const signal: AbortSignal = AbortSignal.timeout(25000);
    for (let page = 0; page < 100; page++) {
      const url: URL = new URL(endpoint);
      if (gemini) {url.searchParams.set('pageSize', '1000'); if (cursor) url.searchParams.set('pageToken', cursor);}
      else if (protocol === 'anthropic') {url.searchParams.set('limit', '1000'); if (cursor) url.searchParams.set('after_id', cursor);}
      else if (cursor) url.searchParams.set('after', cursor);
      let raw: unknown;
      try {raw = await this.upstream.request(url.toString(), {method: 'GET', headers}, signal);}
      catch (error) {throw new HttpException(error instanceof UpstreamError ? error.message + '，请检查密钥和列表接口' : '获取模型失败', 502);}
      const data = parse(z.object({data: z.array(z.object({id: z.string(), display_name: z.string().optional()})).optional(),
        models: z.array(z.object({name: z.string(), displayName: z.string().optional()})).optional(),
        has_more: z.boolean().optional(), last_id: z.string().optional(), nextPageToken: z.string().optional()}), raw);
      if (gemini) {
        if (!data.models) throw new BadRequestException('模型列表格式无效');
        for (const m of data.models) items.set(m.name.replace(/^models\//, ''), {id: m.name.replace(/^models\//, ''), name: m.displayName || m.name});
      } else {
        if (!data.data) throw new BadRequestException('服务商未返回模型列表');
        for (const m of data.data) items.set(m.id, {id: m.id, name: m.display_name || m.id});
      }
      const next: string | undefined = gemini ? data.nextPageToken : data.has_more ? data.last_id || data.data?.at(-1)?.id : '';
      if (!next && !data.has_more) return {items: [...items.values()].sort((a, b) => a.id.localeCompare(b.id))};
      if (!next || seen.has(next)) throw new BadRequestException('分页异常，未获取完整模型列表');
      seen.add(next); cursor = next;
    }
    throw new BadRequestException('超过模型分页上限，未获取完整列表');
  }
  async gatewayModels(): Promise<GatewayModels> {
    const {config}: Snapshot = await this.store.load();
    return {object: 'list', data: [{id: 'auto', object: 'model', owned_by: 'router'},
      ...config.providers.filter((p: StoredProvider) => p.enabled && p.secret && p.model)
        .map((p: StoredProvider): GatewayModels['data'][number] => ({id: p.id, object: 'model', owned_by: p.name}))]};
  }
  private async complete(candidate: Candidate, input: ChatRequest, signal: AbortSignal): Promise<ChatResponse> {
    const p: StoredProvider = candidate.provider;
    validateBaseUrl(p.baseUrl);
    const key: string = this.crypto.decrypt(p.secret || '');
    const headers: Record<string, string> = {'content-type': 'application/json'};
    let payload: Record<string, unknown> = {model: candidate.model, messages: input.messages, stream: false,
      max_tokens: input.max_tokens, ...(input.temperature !== undefined ? {temperature: input.temperature} : {})};
    if (p.protocol === 'anthropic') {
      headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01';
      payload = {...payload, system: input.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n'),
        messages: input.messages.filter((m) => m.role !== 'system')};
    } else headers.authorization = `Bearer ${key}`;
    const raw: unknown = await this.upstream.request(p.baseUrl + (p.protocol === 'anthropic' ? '/messages' : '/chat/completions'),
      {method: 'POST', headers, data: payload}, signal);
    let content: string; let id: string; let finish: string; let prompt: number; let completion: number;
    if (p.protocol === 'anthropic') {
      const out = anthropicResponse.safeParse(raw);
      if (!out.success) throw new UpstreamError(502, '上游响应格式无效');
      content = out.data.content.filter((c) => c.type === 'text').map((c) => c.text || '').join('');
      id = out.data.id; finish = out.data.stop_reason === 'max_tokens' ? 'length' : 'stop';
      prompt = out.data.usage.input_tokens; completion = out.data.usage.output_tokens;
    } else {
      const out = openaiResponse.safeParse(raw);
      if (!out.success) throw new UpstreamError(502, '上游响应格式无效');
      content = out.data.choices[0].message.content || ''; id = out.data.id;
      finish = out.data.choices[0].finish_reason || 'stop';
      prompt = out.data.usage?.prompt_tokens || 0; completion = out.data.usage?.completion_tokens || 0;
    }
    return {id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: candidate.model,
      choices: [{index: 0, message: {role: 'assistant', content}, finish_reason: finish}],
      usage: {prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion},
      routing: {providerId: p.id, reason: candidate.reason, attempts: 1}};
  }
  async chat(raw: unknown, abort?: AbortSignal): Promise<ChatResponse> {
    const input: ChatRequest = parse(chatSchema, raw);
    if (Buffer.byteLength(JSON.stringify(input)) > 256 * 1024) throw new HttpException('请求超过 256 KB', 413);
    const {config}: Snapshot = await this.store.load();
    await this.store.rate('chat', config.settings.requestsPerMinute);
    const logs = await this.store.logs();
    const sequence: number = config.settings.mode === 'weighted' ? await this.store.sequence() : 0;
    const candidates: Candidate[] = chooseRoutes(config, input, logs, sequence);
    const lease: string = await this.store.acquire(config.settings.concurrency);
    const deadline: AbortSignal = AbortSignal.timeout(config.settings.timeoutMs);
    const signal: AbortSignal = abort ? AbortSignal.any([abort, deadline]) : deadline;
    const requestId: string = randomUUID();
    try {
      for (let index = 0; index < candidates.length; index++) {
        if (signal.aborted) throw new HttpException('请求超时或已取消', 504);
        const candidate: Candidate = candidates[index];
        const started: number = Date.now();
        try {
          const result: ChatResponse = await this.complete(candidate, input, signal);
          result.routing.attempts = index + 1;
          await this.store.record({id: requestId, time: new Date().toISOString(), providerId: candidate.provider.id,
            provider: candidate.provider.name, model: candidate.model, status: 200, latency: Date.now() - started,
            tokens: result.usage.total_tokens, reason: candidate.reason});
          return result;
        } catch (error) {
          const status: number = error instanceof UpstreamError ? error.status : 502;
          await this.store.record({id: requestId, time: new Date().toISOString(), providerId: candidate.provider.id,
            provider: candidate.provider.name, model: candidate.model, status, latency: Date.now() - started,
            tokens: 0, reason: candidate.reason});
          if (![401, 403, 408, 429, 500, 502, 503, 504, 529].includes(status) || index === candidates.length - 1 || signal.aborted) {
            this.logger.warn(`upstream_failed requestId=${requestId} status=${status}`);
            throw new HttpException(`模型调用失败（${status}），请求编号 ${requestId}，请检查日志、额度和模型权限`, signal.aborted ? 504 : 502);
          }
        }
      }
      throw new HttpException('无可用路由', 503);
    } finally {await this.store.release(lease);}
  }
}
