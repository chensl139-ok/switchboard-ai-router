import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { ChatRequest, RequestLog } from '@shared/api.interface';
import type { Candidate, StoredConfig, StoredProvider } from './router.types';
export function chooseRoutes(config: StoredConfig, input: ChatRequest, logs: RequestLog[], sequence: number): Candidate[] {
  const {settings} = config;
  const available: StoredProvider[] = config.providers.filter((p: StoredProvider) => p.enabled && p.secret && p.model);
  const explicit: boolean = !!input.model && input.model !== 'auto';
  if (input.upstream_model && !explicit) throw new BadRequestException('指定模型时必须指定服务商 ID');
  if (explicit) {
    const provider: StoredProvider | undefined = available.find((p: StoredProvider) => p.id === input.model);
    if (!provider) throw new BadRequestException('指定服务商未启用或不存在');
    const model: string = input.upstream_model || provider.model;
    if (!provider.models.includes(model)) throw new BadRequestException('该模型未加入服务商可切换列表');
    return [{provider, model, reason: '显式指定服务商与模型'}];
  }
  let ordered: StoredProvider[] = [...available].sort((a: StoredProvider, b: StoredProvider) =>
    a.priority - b.priority || a.id.localeCompare(b.id));
  let reason = '按默认服务商和优先级选择';
  if (settings.mode === 'manual') ordered = ordered.filter((p: StoredProvider) => p.id === settings.active);
  else {
    // Three recent failures open a 60-second circuit. No speculative paid probe is sent.
    ordered = ordered.filter((p: StoredProvider) => {
      const recent: RequestLog[] = logs.filter((l: RequestLog) => l.providerId === p.id && l.model === p.model).slice(0, 3);
      return !(recent.length === 3 && recent.every((l: RequestLog) => l.status >= 400)
        && Date.now() - Date.parse(recent[0].time) < 60000);
    });
  }
  if (settings.mode === 'weighted' && ordered.length) {
    const sum: number = ordered.reduce((n: number, p: StoredProvider) => n + p.weight, 0);
    let cursor: number = sequence % sum;
    let selected: StoredProvider = ordered[0];
    for (const p of ordered) { if (cursor < p.weight) {selected = p; break;} cursor -= p.weight; }
    ordered = [selected, ...ordered.filter((p: StoredProvider) => p.id !== selected.id)];
    reason = '按服务商权重轮询';
  } else if (settings.mode === 'latency') {
    const score = (p: StoredProvider): number => {
      const samples: RequestLog[] = logs.filter((l: RequestLog) => l.providerId === p.id && l.model === p.model
        && l.status === 200 && Date.now() - Date.parse(l.time) < 3600000).slice(0, 20);
      return samples.length >= 3 ? samples.reduce((n: number, l: RequestLog) => n + l.latency, 0) / samples.length : Infinity;
    };
    ordered.sort((a: StoredProvider, b: StoredProvider) => score(a) - score(b) || a.priority - b.priority);
    reason = '最近一小时至少 3 次成功调用的平均耗时；无样本按优先级';
  } else {
    ordered.sort((a: StoredProvider, b: StoredProvider) =>
      Number(b.id === settings.active) - Number(a.id === settings.active));
  }
  const candidates: Candidate[] = ordered.map((provider: StoredProvider) => ({provider, model: provider.model, reason}));
  if (settings.mode === 'rules') {
    const text: string = [...input.messages].reverse().find((m) => m.role === 'user')?.content.toLowerCase() || '';
    const rule = settings.rules.find((r) => r.keywords.some((word: string) => text.includes(word.toLowerCase())));
    if (rule) {
      const provider: StoredProvider | undefined = ordered.find((p: StoredProvider) => p.id === rule.providerId);
      if (provider && provider.models.includes(rule.model)) {
        candidates.unshift({provider, model: rule.model, reason: `匹配规则：${rule.name}`});
      }
    }
  }
  const unique: Candidate[] = candidates.filter((c: Candidate, index: number, all: Candidate[]) =>
    all.findIndex((v: Candidate) => v.provider.id === c.provider.id && v.model === c.model) === index);
  if (!unique.length) throw new ServiceUnavailableException('没有可用路由：请启用服务商、选择默认模型，或等待熔断冷却');
  return unique.slice(0, settings.mode === 'manual' ? 1 : settings.maxAttempts);
}
