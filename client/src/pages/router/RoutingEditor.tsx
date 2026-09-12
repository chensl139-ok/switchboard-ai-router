import React, {useState} from 'react';
import { Plus, Trash2, Check } from 'lucide-react';
import type { RouterState, RoutingSettings, Rule, RouteMode } from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Label } from '@client/src/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@client/src/components/ui/native-select';
import {router} from '@client/src/api';
export const routeModes: {id: RouteMode; name: string; description: string}[] = [
  {id: 'manual', name: '固定模型', description: '只使用默认服务商的当前模型，失败即返回错误。'},
  {id: 'fallback', name: '故障转移', description: '优先默认服务商，遇到限流或故障按优先级回退。'},
  {id: 'weighted', name: '加权轮询', description: '按服务商权重分配请求，失败时尝试其他路由。'},
  {id: 'latency', name: '最低延迟', description: '使用最近一小时至少 3 个成功样本的平均耗时，无样本按优先级。'},
  {id: 'rules', name: '任务规则', description: '按最后一条用户消息匹配关键词，规则从上到下，未命中按默认路由。'},
];
interface RoutingEditorProps {state: RouterState; saved: (value: RouterState) => void}
const RoutingEditor: React.FC<RoutingEditorProps> = ({state, saved}) => {
  const [settings, setSettings] = useState<RoutingSettings>(state.settings);
  const [busy, setBusy] = useState(false);const [error, setError] = useState('');
  const patch = (value: Partial<RoutingSettings>): void => setSettings({...settings, ...value});
  const changeRule = (index: number, value: Partial<Rule>): void => patch({rules: settings.rules.map((r: Rule, i: number) => i === index ? {...r, ...value} : r)});
  return <div className="space-y-6"><div className="grid gap-3 md:grid-cols-3">{routeModes.map((mode) =>
    <button key={mode.id} onClick={() => patch({mode: mode.id})} className={`rounded-xl border p-5 text-left transition-colors ${settings.mode === mode.id ? 'border-primary bg-primary/5' : 'bg-card hover:border-primary/40'}`}>
      <h3 className="flex items-center gap-2 font-semibold">{mode.name}{settings.mode === mode.id && <Check className="size-4 text-primary" />}</h3>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{mode.description}</p></button>)}</div>
    <div className="rounded-xl border bg-card p-6 space-y-5"><h3 className="font-semibold">请求保护与默认路由</h3>
      <Label className="grid gap-2">默认服务商<NativeSelect value={settings.active} onChange={(e) => patch({active: e.target.value})}>
        <NativeSelectOption value="">请选择</NativeSelectOption>{state.providers.filter((p) => p.enabled).map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.name} · {p.model}</NativeSelectOption>)}
      </NativeSelect></Label><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {([{key:'timeoutMs', label:'总超时（毫秒）', min:3000,max:25000},{key:'maxAttempts',label:'最多尝试次数',min:1,max:5},
          {key:'requestsPerMinute',label:'全局每分钟请求上限',min:1,max:1000},{key:'concurrency',label:'全局并发上限',min:1,max:20}] as const).map((field) =>
          <Label key={field.key} className="grid gap-2">{field.label}<Input type="number" min={field.min} max={field.max} value={settings[field.key]} onChange={(e) => patch({[field.key]: Number(e.target.value)})} /></Label>)}
      </div><p className="text-xs text-muted-foreground">自动模式连续 3 次失败后熔断 60 秒。回退共用总超时；固定和显式指定模式不会跨平台重试。</p></div>
    <div className="rounded-xl border bg-card p-6 space-y-4"><div className="flex justify-between gap-4"><h3 className="font-semibold">任务规则 · 按顺序匹配</h3>
      <Button variant="outline" onClick={() => patch({rules: [...settings.rules, {id: crypto.randomUUID(), name: '', keywords: [], providerId: '', model: ''}]})}><Plus />添加规则</Button></div>
      {settings.rules.length === 0 && <p className="text-sm text-muted-foreground">尚未设置规则。例如：关键词「代码、SQL」匹配专用编程模型。</p>}
      {settings.rules.map((rule: Rule, index: number) => <div key={rule.id} className="grid gap-3 rounded-lg bg-muted/40 p-4 md:grid-cols-2">
        <Input aria-label="规则名称" placeholder="规则名称" value={rule.name} onChange={(e) => changeRule(index, {name: e.target.value})} />
        <Input aria-label="匹配关键词" placeholder="关键词，用逗号分隔" value={rule.keywords.join(',')} onChange={(e) => changeRule(index, {keywords: e.target.value.split(/[,，]/)})} />
        <NativeSelect aria-label="规则服务商" value={rule.providerId} onChange={(e) => changeRule(index, {providerId: e.target.value, model: state.providers.find((p) => p.id === e.target.value)?.model || ''})}>
          <NativeSelectOption value="">选择服务商</NativeSelectOption>{state.providers.filter((p) => p.enabled).map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.name}</NativeSelectOption>)}
        </NativeSelect><NativeSelect aria-label="规则模型" value={rule.model} onChange={(e) => changeRule(index, {model: e.target.value})}>
          <NativeSelectOption value="">选择模型</NativeSelectOption>{state.providers.find((p) => p.id === rule.providerId)?.models.map((m: string) => <NativeSelectOption key={m} value={m}>{m}</NativeSelectOption>)}
        </NativeSelect><Button variant="ghost" onClick={() => patch({rules: settings.rules.filter((r: Rule) => r.id !== rule.id)})}><Trash2 />移除规则</Button>
      </div>)}</div>{error && <p role="alert" className="text-destructive">{error}</p>}
    <Button disabled={busy} onClick={async () => {setBusy(true);setError('');try {saved(await router.saveSettings({revision: state.revision, settings}));}
      catch(e){setError(e instanceof Error ? e.message : '保存失败');}finally{setBusy(false);}}}>保存路由策略</Button>
  </div>;
};
export default RoutingEditor;
