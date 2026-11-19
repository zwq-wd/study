/**
 * 事务封装（开发文档 §8.4）
 *
 * plugin-sql 的事务接口较薄：BEGIN → 语句 → COMMIT，失败 ROLLBACK。
 * **业务层不手写 BEGIN**，一律走这里。
 *
 * 事务能不能真的生效，取决于「BEGIN 和它后面的语句是否落在同一条连接上」。
 * plugin-sql 本身做不到（见 db.ts 顶部的注释与 test/lock.test.ts），
 * 所以 db.ts 给 Database 套了全局串行代理：同一时刻只有一条语句在飞。
 * 这里只需要老老实实按 BEGIN / COMMIT / ROLLBACK 走，就会真的在一个事务里。
 *
 * 额外补一层 BUSY 重试：即便队列已经串行，外部进程（备份工具、另一个实例）
 * 仍可能短暂占着写锁，这时按退避重试，而不是把 `code 5` 直接抛给用户。
 */
import type Database from "@tauri-apps/plugin-sql";
import { isBusyError, serializeDb } from "./db.ts";

/** 一个能执行语句的最小接口，方便单测替换。 */
export interface Executor {
  execute(sql: string, values?: unknown[]): Promise<unknown>;
  select<T>(sql: string, values?: unknown[]): Promise<T>;
}

/** 退避序列（毫秒）：约 2s，够跨过别的写入方一次 commit。 */
const RETRY_DELAYS = [20, 40, 80, 160, 320, 640, 640] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

let txSeq = 0;

/**
 * 在一个事务里跑 fn。
 *
 * `fn` 必须只在事务体内调用 ExecuteStatement（用传进来的 db）。
 * 它**必须是幂等的**：BUSY 重试会把整段再跑一次。
 */
export async function withTransaction<T>(db: Executor, fn: () => Promise<T>): Promise<T> {
  txSeq += 1;

  for (let attempt = 0; ; attempt++) {
    try {
      return await serializeDb(async () => {
        await db.execute("BEGIN IMMEDIATE");
        try {
          const out = await fn();
          await db.execute("COMMIT");
          return out;
        } catch (err) {
          try {
            await db.execute("ROLLBACK");
          } catch {
            // 回滚失败时不要盖掉原始错误
          }
          throw err;
        }
      });
    } catch (err) {
      const delay = RETRY_DELAYS[attempt];
      if (delay === undefined || !isBusyError(err)) throw err;
      await sleep(delay);
    }
  }
}

/** 开过多少个事务（测试用）。 */
export function transactionSeq(): number {
  return txSeq;
}

export type Db = Database;
