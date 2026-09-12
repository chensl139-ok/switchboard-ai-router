import React, {useEffect, useRef, useState} from 'react';
import {Send, Square, Trash2} from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Label } from '@client/src/components/ui/label';
import { Textarea } from '@client/src/components/ui/textarea';
import { NativeSelect, NativeSelectOption, NativeSelectOptGroup } from '@client/src/components/ui/native-select';
import type { ChatMessage, RouterState } from '@shared/api.interface';
import {router} from '@client/src/api';
interface PlaygroundProps {state: RouterState; refresh: () => void}
const Playground: React.FC<PlaygroundProps> = ({state, refresh}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState('');const [model, setModel] = useState('auto');
  const [maxTokens, setMaxTokens] = useState(2048);const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');const [routing, setRouting] = useState('');
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {bottom.current?.scrollIntoView({behavior: 'smooth', block: 'nearest'});}, [messages]);
  const send = async (): Promise<void> => {
    if (abort.current || !prompt.trim()) return;
    const original: string = prompt;
    const history: ChatMessage[] = [...messages, {role: 'user', content: prompt.trim()}];
    if (history.length > 100) {setError('对话达到 100 条上限，请清空后开始新对话');return;}
    const controller: AbortController = new AbortController();abort.current = controller;
    setBusy(true);setError('');setMessages(history);setPrompt('');
    try {
      const target: string[] = model === 'auto' ? ['auto'] : JSON.parse(model);
      const response = await router.chat({model: target[0], ...(target[1] ? {upstream_model: target[1]} : {}),
        messages: history, max_tokens: maxTokens, stream: false}, controller.signal);
      setMessages([...history, {role: 'assistant', content: response.choices[0].message.content || '（返回空文本，请检查输出长度或模型类型）'}]);
      setRouting(`${response.routing.providerId} / ${response.model} · ${response.routing.reason} · ${response.usage.total_tokens} tokens`);
    } catch(e) {
      setMessages(history.slice(0, -1));setPrompt(original);setError(e instanceof Error ? e.message : '请求失败');
    } finally {abort.current = null;setBusy(false);refresh();}
  };
  return <div className="grid gap-5 lg:grid-cols-[250px_1fr]"><div className="rounded-xl border bg-card p-5 space-y-5 self-start">
    <h3 className="font-semibold">运行参数</h3><Label className="grid gap-2">服务商 / 模型<NativeSelect className="max-w-52" value={model} disabled={busy} onChange={(e) => setModel(e.target.value)}>
      <NativeSelectOption value="auto">auto · 跟随路由策略</NativeSelectOption>{state.providers.filter((p) => p.enabled && p.hasKey).map((p) =>
        <NativeSelectOptGroup key={p.id} label={p.name}><NativeSelectOption value={JSON.stringify([p.id])}>跟随当前模型</NativeSelectOption>
          {p.models.map((m: string) => <NativeSelectOption key={m} value={JSON.stringify([p.id, m])}>{m}</NativeSelectOption>)}</NativeSelectOptGroup>)}
    </NativeSelect></Label><Label className="grid gap-2">最大输出 Tokens<Input type="number" min={1} max={16384} disabled={busy} value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} /></Label>
    <p className="text-xs leading-6 text-muted-foreground">使用真实 API，费用由服务商收取。对话仅保存在当前页面内存，服务端仅保留调用元数据。</p>
    <Button variant="outline" disabled={busy} onClick={() => {setMessages([]);setRouting('');}}><Trash2 />清空对话</Button>
    </div><div className="rounded-xl border bg-card p-5"><div className="h-[440px] overflow-y-auto space-y-4">
      {!messages.length && <div className="grid h-full place-content-center text-center text-muted-foreground"><h3 className="text-xl text-foreground">把想法交给模型</h3><p className="mt-3 text-sm">选择模型，开始一次真实对话。</p></div>}
      {messages.map((m: ChatMessage, index: number) => <div key={index} className={`rounded-lg p-4 whitespace-pre-wrap break-words text-sm leading-7 ${m.role === 'user' ? 'ml-10 bg-primary/10' : 'mr-4 bg-muted/50'}`}>
        <div className="mb-1 text-xs text-muted-foreground">{m.role === 'user' ? '你' : '模型'}</div>{m.content}</div>)}
      {busy && <p className="text-sm text-muted-foreground animate-pulse">模型生成中…</p>}<div ref={bottom} />
    </div>{routing && <p className="my-3 text-xs text-muted-foreground break-words">{routing}</p>}{error && <p role="alert" className="my-3 text-sm text-destructive">{error}</p>}
    <div className="mt-4 flex items-end gap-3"><Textarea aria-label="聊天消息" value={prompt} disabled={busy} placeholder="Enter 发送，Shift+Enter 换行" onChange={(e) => setPrompt(e.target.value)}
      onKeyDown={(e) => {if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {e.preventDefault();if (!e.repeat) void send();}}} />
      {busy ? <Button variant="outline" onClick={() => abort.current?.abort()}><Square />停止</Button> : <Button onClick={send} disabled={!prompt.trim()}><Send />发送</Button>}
    </div></div></div>;
};
export default Playground;
