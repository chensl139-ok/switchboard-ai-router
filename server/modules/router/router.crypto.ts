import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
@Injectable()
export class RouterCrypto {
  private key(): Buffer {
    const raw: string = process.env.ROUTER_MASTER_KEY || '';
    const key: Buffer = Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new ServiceUnavailableException('服务端加密主密钥未配置');
    return key;
  }
  encrypt(value: string): string {
    const iv: Buffer = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64');
  }
  decrypt(value: string): string {
    try {
      const data: Buffer = Buffer.from(value, 'base64');
      const cipher = createDecipheriv('aes-256-gcm', this.key(), data.subarray(0, 12));
      cipher.setAuthTag(data.subarray(-16));
      return Buffer.concat([cipher.update(data.subarray(12, -16)), cipher.final()]).toString('utf8');
    } catch { throw new ServiceUnavailableException('密钥无法解密，请检查主密钥或重新保存 API Key'); }
  }
}
