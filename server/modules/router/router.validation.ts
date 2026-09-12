import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
export const providerSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/).refine((v: string) => v !== 'auto'),
  name: z.string().trim().min(1).max(60), baseUrl: z.string().url().max(2048),
  protocol: z.enum(['openai', 'anthropic']), model: z.string().trim().max(200),
  models: z.array(z.string().trim().min(1).max(200)).max(500),
  enabled: z.boolean(), priority: z.number().int().min(0).max(100),
  weight: z.number().int().min(1).max(100), hasKey: z.boolean().optional(),
});
export const settingsSchema = z.object({
  mode: z.enum(['manual', 'fallback', 'weighted', 'latency', 'rules']), active: z.string().max(40),
  rules: z.array(z.object({id: z.string().min(1).max(60), name: z.string().min(1).max(60),
    keywords: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
    providerId: z.string().max(40), model: z.string().max(200)})).max(30),
  timeoutMs: z.number().int().min(3000).max(25000), maxAttempts: z.number().int().min(1).max(5),
  requestsPerMinute: z.number().int().min(1).max(1000), concurrency: z.number().int().min(1).max(20),
});
export const chatSchema = z.object({
  model: z.string().min(1).max(250).default('auto'), upstream_model: z.string().min(1).max(200).optional(),
  messages: z.array(z.object({role: z.enum(['user', 'assistant', 'system']),
    content: z.string().max(100000)}).strict()).min(1).max(100),
  max_tokens: z.number().int().min(1).max(16384).default(2048),
  temperature: z.number().min(0).max(2).optional(), stream: z.literal(false).optional(),
}).strict();
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const out = schema.safeParse(input);
  if (!out.success) throw new BadRequestException(out.error.issues.map((i: z.core.$ZodIssue) =>
    `${i.path.join('.')}: ${i.message}`).join('; '));
  return out.data;
}
