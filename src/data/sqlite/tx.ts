/**
 * 事务封装（开发文档 §8.4）
 *
 * plugin-sql 的事务接口较薄：BEGIN → 语句 → COMMIT，失败 ROLLBACK。
 * **业务层不手写 BEGIN**，一律走这里。
 */
import type Database from "@tauri-apps/plugin-sql";

/** 一个能执行语句的最小接口，方便单测替换。 */
export interface Executor {
  execute(sql: string, values?: unknown[]): Promise<unknown>;
  select<T>(sql: string, values?: unknown[]): Promise<T>;
}

let txSeq = 0;

/**
 * 在一个事务里跑 fn。
 *
 * 注意：plugin-sql 的 execute 走的是同一个 sqlx 连接池，`BEGIN` 与后续语句
 * 未必落在同一条连接上。所以这里用「单连接语义」的保守写法：
 * - 先 BEGIN IMMEDIATE 拿写锁
 * - 失败一定 ROLLBACK
 * - 成功 COMMIT
 * 如果未来实测发现 BEGIN 不生效（见 §8.5 的风险提示），
 * 退化方案是「不依赖事务，改为应用层级联 + 幂等重试」，见 repo.ts 的 deleteWord。
 */
export async function withTransaction<T>(
  db: Executor,
  fn: () => Promise<T>,
): Promise<T> {
  txSeq += 1;
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
}

export type Db = Database;
