import React, {useState} from 'react';
import { Loader2, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Textarea } from '@client/src/components/ui/textarea';
import { Label } from '@client/src/components/ui/label';
import { Switch } from '@client/src/components/ui/switch';
import { NativeSelect, NativeSelectOption } from '@client/src/components/ui/native-select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@client/src/components/ui/dialog';
import type { Provider, ModelItem, RouterState } from '@shared/api.interface';
import {router} from '@client/src/api';
interface ProviderEditorProps {provider: Provider; revision: number; close: () => void; saved: (state: RouterState) => void}
const ProviderEditor: React.FC<ProviderEditorProps> = ({provider, revision, close, saved}) => {
  const [draft, setDraft] = useState<Provider>(provider);
  const [apiKey, setApiKey] = useState('');
  const [modelsText, setModelsText] = useState(provider.models.join('\n'));
  const [items, setItems] = useState<ModelItem[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [fetched, setFetched] = useState(false);
  const patch = (value: Partial<Provider>): void => {setDraft({...draft, ...value});};
  const getModels = async (): Promise<void> => {
    setFetching(true);setError('');setFetched(false);setItems([]);
    try {const result = await router.models({id: draft.id, baseUrl: draft.baseUrl, protocol: draft.protocol, apiKey});
      setItems(result.items);setFetched(true);
    } catch (e) {setError(e instanceof Error ? e.message : '获取失败');} finally {setFetching(false);}
  };
  const save = async (): Promise<void> => {
    setBusy(true);setError('');
    try {
      const models: string[] = [...new Set(modelsText.split('\n').map((m: string) => m.trim()).filter(Boolean))];
      const next: Provider = {...draft, models, model: draft.model || models[0] || ''};
      saved(await router.saveProvider({revision, provider: next, apiKey, clearKey}));close();
    } catch (e) {setError(e instanceof Error ? e.message : '保存失败');} finally {setBusy(false);}
  };
  return <Dialog open onOpenChange={(open: boolean) => {if (!open && !busy && !fetching) close();}}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader>
      <DialogTitle>配置服务商</DialogTitle><DialogDescription>一份密钥，多模型切换。保存并启用后即可调用。</DialogDescription>
    </DialogHeader><div className="grid gap-4 sm:grid-cols-2">
      <Label className="grid gap-2">路由 ID<Input value={draft.id} disabled={!!provider.id || fetching} onChange={(e) => patch({id: e.target.value})} /></Label>
      <Label className="grid gap-2">显示名称<Input value={draft.name} onChange={(e) => patch({name: e.target.value})} /></Label>
      <Label className="grid gap-2 sm:col-span-2">Base URL<Input value={draft.baseUrl} disabled={fetching} onChange={(e) => {patch({baseUrl: e.target.value});setItems([]);}} /></Label>
      <Label className="grid gap-2">协议<NativeSelect value={draft.protocol} disabled={fetching} onChange={(e) => patch({protocol: e.target.value === 'anthropic' ? 'anthropic' : 'openai'})}>
        <NativeSelectOption value="openai">OpenAI 兼容</NativeSelectOption><NativeSelectOption value="anthropic">Anthropic Messages</NativeSelectOption>
      </NativeSelect></Label>
      <Label className="grid gap-2">API Key<Input type="password" autoComplete="new-password" value={apiKey} disabled={fetching} placeholder={draft.hasKey ? '已保存，留空不修改' : '输入 API Key'} onChange={(e) => setApiKey(e.target.value)} /></Label>
      <Label className="grid gap-2 sm:col-span-2">可切换模型（每行一个 ID）<Textarea rows={4} value={modelsText} onChange={(e) => setModelsText(e.target.value)} /></Label>
      <Label className="grid gap-2 sm:col-span-2">当前模型<Input value={draft.model} placeholder="留空自动选择列表第一个模型" onChange={(e) => patch({model: e.target.value})} /></Label>
      <Label className="grid gap-2">回退优先级（越小越优先）<Input type="number" min={0} max={100} value={draft.priority} onChange={(e) => patch({priority: Number(e.target.value)})} /></Label>
      <Label className="grid gap-2">轮询权重<Input type="number" min={1} max={100} value={draft.weight} onChange={(e) => patch({weight: Number(e.target.value)})} /></Label>
    </div><div className="rounded-xl border bg-muted/30 p-4 space-y-3">
      <Button variant="outline" disabled={fetching || busy || clearKey} onClick={getModels}>{fetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}获取所有模型</Button>
      <Input aria-label="搜索模型" placeholder="搜索名称或 ID" value={query} onChange={(e) => setQuery(e.target.value)} />
      {fetched && <p className="text-xs text-muted-foreground">获取 {items.length} 个模型，点击加入列表；非聊天模型暂不支持对话调用。</p>}
      <div className="max-h-44 overflow-y-auto space-y-1">{items.filter((m: ModelItem) => (m.id + m.name).toLowerCase().includes(query.toLowerCase())).map((m: ModelItem) =>
        <Button key={m.id} variant="ghost" className="w-full justify-start text-left" onClick={() => {
          setModelsText([...new Set([...modelsText.split('\n').filter(Boolean), m.id])].join('\n'));
          if (!draft.model) patch({model: m.id});
        }}><Plus className="shrink-0" /><span className="truncate">{m.id}</span></Button>)}</div>
    </div><div className="flex items-center justify-between gap-4"><Label htmlFor="enabled">启用此服务商</Label>
      <Switch id="enabled" checked={draft.enabled} onCheckedChange={(enabled: boolean) => patch({enabled})} /></div>
    <div className="flex items-center justify-between gap-4"><Label htmlFor="clear-key">清除已保存密钥</Label>
      <Switch id="clear-key" checked={clearKey} onCheckedChange={(value: boolean) => {setClearKey(value);if (value) patch({enabled: false});}} /></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={busy || fetching} onClick={save}>{busy && <Loader2 className="animate-spin" />}保存配置</Button>
    </DialogContent></Dialog>;
};
export default ProviderEditor;
