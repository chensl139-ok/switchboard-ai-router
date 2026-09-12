import React, {useCallback, useEffect, useState} from 'react';
import {Activity, Boxes, FlaskConical, GitBranch, Code2, RefreshCw, Plus, ShieldCheck, Settings2, ArrowUpRight} from 'lucide-react';
import {useAuth, ROLE_SUBJECT} from '@lark-apaas/client-toolkit/auth';
import {resolveAppUrl} from '@lark-apaas/client-toolkit/utils/resolveAppUrl';
import {Button} from '@client/src/components/ui/button';
import {NativeSelect, NativeSelectOption} from '@client/src/components/ui/native-select';
import type { Provider, RouterState } from '@shared/api.interface';
import {router} from '@client/src/api';
import ProviderEditor from './ProviderEditor';
import RoutingEditor, {routeModes} from './RoutingEditor';
import Playground from './Playground';
const emptyProvider: Provider = {id:'',name:'',baseUrl:'https://',protocol:'openai',model:'',models:[],enabled:true,priority:50,weight:1,hasKey:false};
const nav = [{id:'overview',title:'路由控制台',icon:Activity},{id:'providers',title:'服务商管理',icon:Boxes},
  {id:'routing',title:'路由策略',icon:GitBranch},{id:'playground',title:'模型实验室',icon:FlaskConical},
  {id:'logs',title:'请求与审计',icon:Activity},{id:'api',title:'API 接入',icon:Code2}];
const RouterPage: React.FC = () => {
  const {ability, isLoading} = useAuth();
  const [state, setState] = useState<RouterState | null>(null);const [tab, setTab] = useState('overview');
  const [error, setError] = useState('');const [editing, setEditing] = useState<Provider | null>(null);
  const [busy, setBusy] = useState(false);
  const allowed: boolean = !isLoading && ability.can('router_admin', ROLE_SUBJECT);
  const refresh = useCallback(async (): Promise<void> => {
    try {setState(await router.getState());setError('');}catch(e){setError(e instanceof Error ? e.message : '加载失败');}
  }, []);
  useEffect(() => {if (allowed) void refresh();}, [allowed, refresh]);
  const switchModel = async (p: Provider, model: string, activate = false): Promise<void> => {
    if (!state) return;setBusy(true);
    try {setState(await router.switchModel({revision:state.revision,id:p.id,model,activate}));setError('');}
    catch(e){setError(e instanceof Error ? e.message : '切换失败');}finally{setBusy(false);}
  };
  if (isLoading) return <div className="p-12 text-muted-foreground">正在验证平台身份…</div>;
  if (!allowed) return <div className="mx-auto max-w-xl p-12 space-y-4"><ShieldCheck className="size-10 text-primary" /><h1 className="text-2xl font-semibold">需要路由管理员权限</h1><p>请使用应用创建者的飞书账号登录，或由管理员在妙搭权限面板分配角色。</p></div>;
  const active: Provider | undefined = state?.providers.find((p: Provider) => p.id === state.settings.active);
  const good = state?.logs.filter((l) => l.status === 200) || [];
  const cards = state && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-ai-section-type="card-list">{state.providers.map((p: Provider) =>
    <div key={p.id} className={`rounded-xl border bg-card p-5 space-y-5 ${state.settings.active === p.id ? 'border-primary' : ''}`}>
      <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{p.name}</h3><span className={`rounded-md px-2 py-1 text-xs ${p.enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
        {state.settings.active === p.id ? '默认路由' : p.enabled ? '已启用' : p.hasKey ? '已配置 · 未启用' : '待配置'}</span></div>
      <NativeSelect className="max-w-full" aria-label={`${p.name}当前模型`} value={p.model} disabled={busy || !p.models.length} onChange={(e) => void switchModel(p, e.target.value)}>
        {!p.models.length && <NativeSelectOption value="">请先添加模型</NativeSelectOption>}{p.models.map((m: string) => <NativeSelectOption key={m} value={m}>{m}</NativeSelectOption>)}
      </NativeSelect><div className="flex items-center justify-between gap-2"><Button variant="outline" onClick={() => setEditing(p)}><Settings2 />配置</Button>
        <Button variant="ghost" disabled={busy || !p.enabled || !p.hasKey || state.settings.active === p.id} onClick={() => void switchModel(p, p.model, true)}>设为默认<ArrowUpRight /></Button></div>
      <p className="text-xs text-muted-foreground">{p.models.length} 个模型 · 优先级 {p.priority} · 权重 {p.weight}</p>
    </div>)}</div>;
  return <div className="min-h-screen bg-muted/20 text-foreground"><aside className="border-b bg-card p-5 lg:fixed lg:inset-y-0 lg:w-60 lg:border-r">
    <div className="flex items-center gap-3 text-primary"><GitBranch className="size-8" /><div><div className="text-xl font-bold tracking-tight">Switchboard</div><div className="text-xs text-muted-foreground">AI 智能路由平台</div></div></div>
    <nav className="mt-8 flex gap-2 overflow-x-auto lg:grid">{nav.map((n) => <Button key={n.id} variant={tab === n.id ? 'secondary' : 'ghost'} className="justify-start shrink-0" onClick={() => setTab(n.id)}><n.icon />{n.title}</Button>)}</nav>
    <p className="mt-10 hidden text-xs text-muted-foreground lg:block">妙搭原生登录 · 加密存储<br />平台数据库 · 全局请求保护</p>
  </aside><main className="lg:ml-60"><header className="flex items-center justify-between gap-4 border-b bg-card px-6 py-4"><span className="text-sm text-muted-foreground">工作空间 / {nav.find((n) => n.id === tab)?.title}</span><Button variant="ghost" onClick={refresh}><RefreshCw />刷新</Button></header>
    <div className="mx-auto max-w-7xl space-y-7 p-5 md:p-9"><div className="flex items-center justify-between gap-4"><div><p className="text-xs font-semibold tracking-widest text-primary">YOUR MODELS. ONE GATEWAY.</p><h1 className="mt-3 text-3xl font-semibold tracking-tight">{tab === 'overview' ? '让每一次调用，都有最优路径。' : nav.find((n) => n.id === tab)?.title}</h1><p className="mt-3 text-sm text-muted-foreground">统一连接、灵活分流，让模型调用可控、可观测。</p></div>
    {tab === 'providers' && <Button onClick={() => setEditing(emptyProvider)}><Plus />接入服务商</Button>}</div>
    {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}
    {!state && !error && <p>正在加载配置…</p>}
    {state && tab === 'overview' && <><div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-ai-section-type="card-stat">
      {[['可用服务商',state.providers.filter((p) => p.enabled && p.hasKey).length],['最近请求尝试',state.logs.length],['尝试成功率',state.logs.length ? Math.round(good.length/state.logs.length*100)+'%' : '—'],['平均完成耗时',good.length ? Math.round(good.reduce((n,l)=>n+l.latency,0)/good.length)+' ms' : '—']].map(([name,value]) =>
        <div key={name} className="rounded-xl border bg-card p-5"><p className="text-xs text-muted-foreground">{name}</p><p className="mt-4 text-3xl font-semibold">{value}</p></div>)}</div>
      <div className="rounded-xl bg-primary p-7 text-primary-foreground"><p className="text-xs tracking-wider opacity-70">ACTIVE ROUTE / {routeModes.find((m) => m.id === state.settings.mode)?.name}</p><h2 className="mt-4 text-2xl font-semibold">{active?.name || '连接第一个模型'}</h2><p className="mt-2 text-sm opacity-80">{active?.model || '先配置服务商密钥与模型，并开启启用开关。'}</p><Button className="mt-5" variant="secondary" onClick={() => setTab('routing')}>配置路由策略<GitBranch /></Button></div>{cards}</>}
    {state && tab === 'providers' && cards}
    {state && tab === 'routing' && <RoutingEditor key={state.revision} state={state} saved={setState} />}
    {state && tab === 'playground' && <Playground state={state} refresh={refresh} />}
    {state && tab === 'logs' && <div className="space-y-7"><section className="rounded-xl border bg-card p-5"><h2 className="mb-4 font-semibold">请求日志 · 最近 500 次尝试</h2>
      {!state.logs.length && <p className="py-8 text-center text-muted-foreground">尚无调用记录</p>}{state.logs.map((l, index) => <div key={`${l.id}-${index}`} className="border-b py-4 text-sm last:border-0"><div className="flex flex-wrap items-center justify-between gap-3"><strong>{l.provider} / {l.model}</strong><span className={l.status === 200 ? 'text-primary' : 'text-destructive'}>{l.status} · {l.latency} ms · {l.tokens} tokens</span></div><p className="mt-2 text-xs text-muted-foreground">{new Date(l.time).toLocaleString()} · {l.reason} · {l.id}</p></div>)}</section>
      <section className="rounded-xl border bg-card p-5"><h2 className="mb-4 font-semibold">配置审计 · 最近 200 次修改</h2>{state.audit.map((a,index) => <p key={index} className="border-b py-3 text-sm">{new Date(a.time).toLocaleString()} · {a.action} · {a.target}</p>)}</section></div>}
    {tab === 'api' && <section className="rounded-xl border bg-card p-6 space-y-5"><h2 className="text-xl font-semibold">统一 API 调用</h2><p className="text-sm text-muted-foreground">在妙搭应用的开放 API 管理中创建调用密钥。管理端使用飞书身份；对外请求由妙搭网关校验 API Key。</p>
      <pre className="overflow-auto rounded-lg bg-foreground p-5 text-xs leading-7 text-background">{`POST ${resolveAppUrl('/openapi/v1/chat/completions')}\nContent-Type: application/json\n\n{\n  "model": "auto",\n  "messages": [{"role": "user", "content": "你好"}],\n  "stream": false\n}`}</pre>
      <p className="text-sm leading-7 text-muted-foreground">model 使用服务商路由 ID 或 auto；upstream_model 可固定该服务商已保存的某个模型。SSE/WebSocket 通过仓库附带的独立实时网关部署，妙搭托管入口目前使用标准 HTTP。</p></section>}
    </div></main>{state && editing && <ProviderEditor provider={editing} revision={state.revision} close={() => setEditing(null)} saved={setState} />}</div>;
};
export default RouterPage;
