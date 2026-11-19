/**
 * 事务封装（开发文档 §8.4）
 *
 * plugin-sql 的事务接口较薄：BEGIN → 语句 → COMMIT，失败 ROLLBACK。
 * **业务层不手写 BEGIN**，一律走这里。
 *
 * ── 为什么 fn 会拿到一个 tx 参数 ─────────────────────────────────
 * 事务能成立要同时满足三件事：
 *   1. 整段事务占住互斥锁（别的事务不能把语句插进来）；
 *   2. 事务体里的语句**绕过**那把锁（否则等自己 → 死锁）；
 *   3. 这些语句落在同一条连接上（靠 1 保证：同一时刻只有一条语句在飞）。
 *
 * 第 2 条不能靠「全局 depth 标记」——并发时 A 持锁等 IO，B 看到 depth>0
 * 就以为自己也在事务体内，直接插队，重新撞上 code 5（v0.6.2 的真实故障）。
 * 也不能靠「调用方继续用外层 db」——那个 db 的 execute 还会去排队。
 *
 * 所以做成**显式**的：fn 收到的 tx 是直连通道，事务体里必须用它，
 * 用外层 db 就会自己等自己。类型上 tx 就是 Executor，写错了编译器会提醒。
 *
 * 历史三次踩坑：不串行（code 5）→ 两层串行（死锁）→ 全局 depth（并发插队）。
 */
import type Database from "@tauri-apps/plugin-sql";
import { directExecutor, withSerialDb } from "./db.ts";

/** 一个能执行语句的最小接口，方便单测替换。 */
export interface Executor {
  execute(sql: string, values?: unknown[]): Promise<unknown>;
  select<T>(sql: string, values?: unknown[]): Promise<T>;
}

let txSeq = 0;

/**
 * 在一个事务里跑 fn。
 *
 * `fn` 收到的 `tx` 是绕过互斥锁的直连通道 —— **事务体里所有语句都必须用它**。
 * 整段占锁，所以别的事务不可能插进来。
 *
 * BUSY 时整段重试，因此 fn 必须幂等（当前三个调用点都是）。
 */
export function withTransaction<T>(
  db: Executor,
  fn: (tx: Executor) => Promise<T>,
): Promise<T> {
  txSeq += 1;
  const conn = directExecutor(db);

  return withSerialDb(async () => {
    await conn.execute("BEGIN IMMEDIATE");
    try {
      const out = await fn(conn);
      await conn.execute("COMMIT");
      return out;
    } catch (err) {
      try {
        await conn.execute("ROLLBACK");
      } catch {
        // 回滚失败时不要盖掉原始错误
      }
      throw err;
    }
  });
}

/** 开过多少个事务（测试用）。 */
export function transactionSeq(): number {
  return txSeq;
}

export type Db = Database;