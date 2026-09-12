import { BadRequestException, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { Agent } from 'node:https';
import { lookup } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import type { AxiosRequestConfig } from 'axios';
export class UpstreamError extends Error {
  constructor(public readonly status: number, message: string) {super(message);}
}
export function publicAddress(address: string): boolean {
  if (isIP(address) === 6) return /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:db8:/i.test(address);
  if (isIP(address) !== 4) return false;
  const [a, b]: number[] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0))
    || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19, 51].includes(b))
    || (a === 203 && b === 0));
}
export function validateBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch {throw new BadRequestException('Base URL 格式无效');}
  const defaults: string[] = ['api.siliconflow.cn', 'api.deepseek.com', 'api.openai.com', 'api.anthropic.com',
    'generativelanguage.googleapis.com', 'dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com'];
  const allowed: string[] = [...defaults, ...(process.env.ROUTER_ALLOWED_HOSTS || '').split(',').map((s: string) => s.trim())];
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password
      || url.search || url.hash || !allowed.includes(url.hostname)) {
    throw new BadRequestException('仅支持 HTTPS 已允许的服务商域名；自定义域名需加入 ROUTER_ALLOWED_HOSTS');
  }
  return url.toString().replace(/\/$/, '');
}
@Injectable()
export class RouterUpstream {
  constructor(private readonly http: HttpService) {}
  async request(url: string, options: AxiosRequestConfig, signal: AbortSignal): Promise<unknown> {
    const safeLookup: LookupFunction = (hostname, opts, callback) => {
      lookup(hostname, {all: true}, (error, addresses) => {
        if (error) return callback(error, '');
        if (!addresses.length || addresses.some((a) => !publicAddress(a.address))) {
          return callback(new Error('Private upstream address blocked'), '');
        }
        const first = addresses[0];
        callback(null, opts.all ? addresses : first.address, first.family);
      });
    };
    const agent: Agent = new Agent({lookup: safeLookup});
    try {
      const response = await this.http.axiosRef.request<unknown>({...options, url, signal,
        httpsAgent: agent, proxy: false, maxRedirects: 0, timeout: 25000,
        maxContentLength: 4 * 1024 * 1024, maxBodyLength: 256 * 1024,
        validateStatus: () => true});
      if (response.status >= 300) throw new UpstreamError(response.status, `上游 HTTP ${response.status}`);
      return response.data;
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      throw new UpstreamError(signal.aborted ? 504 : 502, signal.aborted ? '请求已超时或取消' : '上游连接失败');
    } finally {agent.destroy();}
  }
}
