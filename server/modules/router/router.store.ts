import { ConflictException, HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { routerConfig, routerEvent, routerLease, routerRate } from '@server/database/schema';
import type { RequestLog } from '@shared/api.interface';
import { defaultConfig, type Snapshot, type StoredConfig } from './router.types';
@Injectable()
export class RouterStore {
  private readonly logger = new Logger(RouterStore.name);
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}
  async load(): Promise<Snapshot> {
    await this.db.insert(routerConfig).values({createdBy: null, updatedBy: null, key: 'global', value: JSON.stringify(defaultConfig())})
      .onConflictDoNothing();
    const rows = await this.db.select().from(routerConfig).where(eq(routerConfig.key, 'global')).limit(1);
    if (!rows[0]) throw new Error('Router configuration missing');
    const config: StoredConfig = JSON.parse(rows[0].value);
    return {config, revision: rows[0].revision};
  }
  async save(config: StoredConfig, revision: number, action: string, target: string, actor: string): Promise<void> {
    config.audit.unshift({time: new Date().toISOString(), action, target});
    config.audit = config.audit.slice(0, 200);
    const changed = await this.db.update(routerConfig).set({value: JSON.stringify(config),
      revision: sql`${routerConfig.revision} + 1`, updatedAt: new Date(), updatedBy: actor})
      .where(and(eq(routerConfig.key, 'global'), eq(routerConfig.revision, revision)))
      .returning({key: routerConfig.key});
    if (!changed.length) throw new ConflictException('配置已被其他会话修改，请刷新后重新操作');
  }
  async logs(): Promise<RequestLog[]> {
    const rows = await this.db.select().from(routerEvent).where(eq(routerEvent.kind, 'request'))
      .orderBy(desc(routerEvent.createdAt), desc(routerEvent.id)).limit(500);
    return rows.map((r: typeof routerEvent.$inferSelect): RequestLog => JSON.parse(r.payload));
  }
  async record(log: RequestLog): Promise<void> {
    // Observability failure must never retry an already successful paid model request.
    try { await this.db.insert(routerEvent).values({createdBy: null, updatedBy: null, kind: 'request', payload: JSON.stringify(log)}); }
    catch { this.logger.error(`request_log_write_failed requestId=${log.id}`); }
  }
  async rate(bucket: string, limit: number): Promise<void> {
    const key: string = `${bucket}:${Math.floor(Date.now() / 60000)}`;
    const rows = await this.db.insert(routerRate).values({createdBy: null, updatedBy: null, key, used: 1}).onConflictDoUpdate({
      target: routerRate.key, set: {used: sql`${routerRate.used} + 1`},
      setWhere: lt(routerRate.used, limit),
    }).returning({used: routerRate.used});
    if (!rows.length) throw new HttpException('请求过于频繁，请一分钟后重试', 429);
  }
  async sequence(): Promise<number> {
    const rows = await this.db.insert(routerRate).values({createdBy: null, updatedBy: null, key: 'round-robin', used: 1}).onConflictDoUpdate({
      target: routerRate.key, set: {used: sql`(${routerRate.used} % 1000000) + 1`},
    }).returning({used: routerRate.used});
    return rows[0].used - 1;
  }
  async acquire(maximum: number): Promise<string> {
    const leaseId: string = randomUUID();
    for (let slot = 0; slot < maximum; slot++) {
      const rows = await this.db.insert(routerLease).values({createdBy: null, updatedBy: null, slot, leaseId,
        expiresAt: new Date(Date.now() + 90000)}).onConflictDoUpdate({target: routerLease.slot,
        set: {leaseId, expiresAt: new Date(Date.now() + 90000)},
        setWhere: lt(routerLease.expiresAt, new Date()),
      }).returning({slot: routerLease.slot});
      if (rows.length) return leaseId;
    }
    throw new HttpException('并发请求已满，请稍后重试', 429);
  }
  async release(leaseId: string): Promise<void> {
    try { await this.db.update(routerLease).set({expiresAt: new Date(0)}).where(eq(routerLease.leaseId, leaseId)); }
    catch { this.logger.error('lease_release_failed; lease expires automatically'); }
  }
  async cleanup(): Promise<void> {
    // Retention applies only to operational metadata; configuration is never deleted here.
    await this.db.delete(routerEvent).where(lt(routerEvent.createdAt, new Date(Date.now() - 30 * 86400000)));
    await this.db.delete(routerRate).where(and(lt(routerRate.createdAt, new Date(Date.now() - 86400000)),
      sql`${routerRate.key} <> 'round-robin'`));
  }
}
