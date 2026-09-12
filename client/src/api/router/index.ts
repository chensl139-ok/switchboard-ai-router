import axios, {type AxiosAdapter} from 'axios';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { ChatRequest, ChatResponse, ModelQuery, ModelsResult, RouterState, SaveProviderRequest,
  SaveSettingsRequest, SwitchModelRequest } from '@shared/api.interface';
async function request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  let actualData: unknown;
  // Keep toolkit CSRF/base-path behavior, but redact bodies before its telemetry interceptors run.
  const nativeAdapter: AxiosAdapter = axios.getAdapter('xhr');
  const adapter: AxiosAdapter = async (config) => {
    try {
      const response = await nativeAdapter(config);
      actualData = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      response.config.data = '[redacted]';
      return {...response, data: JSON.stringify({redacted: true})};
    } catch (error) {
      if (axios.isAxiosError(error) && error.config) error.config.data = '[redacted]';
      throw error;
    }
  };
  try {
    const response = await axiosForBackend<T>({url: `/api/router/${path}`, method, data, signal, adapter, timeout: 35000});
    if (response.status === 403) throw new Error('没有路由管理权限，请联系应用管理员');
    return actualData as T;
  } catch (error) {
    if (axios.isCancel(error)) throw new Error('请求已取消');
    if (axios.isAxiosError<{error?: {message?: string}}>(error)) {
      if (error.response?.status === 403) throw new Error('没有路由管理权限，请联系应用管理员');
      throw new Error(error.response?.data?.error?.message || '网络请求失败，请稍后重试');
    }
    throw error;
  }
}
export const getState = (): Promise<RouterState> => request('GET', 'state');
export const saveProvider = (data: SaveProviderRequest): Promise<RouterState> => request('POST', 'providers', data);
export const saveSettings = (data: SaveSettingsRequest): Promise<RouterState> => request('PATCH', 'settings', data);
export const switchModel = (data: SwitchModelRequest): Promise<RouterState> => request('PATCH', 'model', data);
export const models = (data: ModelQuery): Promise<ModelsResult> => request('POST', 'models', data);
export const chat = (data: ChatRequest, signal: AbortSignal): Promise<ChatResponse> => request('POST', 'chat', data, signal);
