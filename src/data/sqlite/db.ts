/**
 * 数据库连接（开发文档 §8.5）
 *
 * 三个 PRAGMA 必须在**每次建立连接后**单独执行，不能放进迁移文件：
 * - journal_mode 是数据库持久属性，设一次即可，重复执行无害
 * - foreign_keys 是**每连接**属性，放进迁移只会影响迁移那一瞬间的连接，之后全 OFF
 * - busy_timeout 防瞬时锁冲突直接报错
 *
 * ── 为什么要串行（v0.6.1 起）──────────────────────────────────────
 * plugin-sql 底下是 sqlx 的连接池（默认最多 10 条）。每次 execute/select 都是
 * 「取一条 → 跑 → 归还」，**连续两条语句不保证落在同一条连接上**。
 *
 * 这会直接毁掉多语句事务：`BEGIN IMMEDIATE` 在连接 A 上拿到写锁后 A 归还进池，
 * 锁仍在 A 身上；下一条语句若被派给连接 B，B 处于 autocommit，直接写入 →
 * 立刻 `SQLITE_BUSY (code 5): database is locked`。
 *
 * 关键点：busy_timeout 只会等**别人**，不会等**自己池子里**那条握着锁的连接。
 * 所以让同一时刻只有一条语句在飞 —— 池里就只会用到一条连接，
 * BEGIN 与它后面的语句才会落在同一条上。
 *
 * ── 为什么不能靠「重入计数」（v0.6.3）────────────────────────────
 * v0.6.2 用了一个全局 depth 标记来放行「事务体里的调用」。这在**并发**时是错的：
 * 事务 A 正持着闸门在 await，此时事务 B 进来，看到 depth > 0 就以为自己也在
 * 事务体内，直接放行 —— B 的 BEGIN 于是插进 A 的事务中间，重新撞上 code 5。
 *
 * 正确做法：事务**整段**占住一把不可重入的互斥锁，并且事务体里的语句走
 * **绕过这把锁**的直连通道（拿到内层 Database 直接执行）。
 * 这样既不互相插队，也不会自锁。
 */
import Database from "@tauri-apps/plugin-sql";

export const DB_URL = "sqlite:wordpacer.db";

/**
 * 不可重入的互斥锁。
 *
 * 它只保护「谁在用连接」这一件事，不做重入判断 —— 重入由调用方用
 * bypassMutex 的直连通道解决（见 withTransaction）。
 */
let chain: Promise<unknown> = Promise.resolve();

export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** 兼容旧名字（测试里用过）。 */
export const serializeDb = runExclusive;

/** 一条语句失败后是否值得重试（锁冲突 = 值得）。 */
const BUSY_PATTERN = /code:\s*5\b|database is locked|SQLITE_BUSY/i;

export function isBusyError(err: unknown): boolean {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : typeof err === "object" && err !== null
          ? String((err as { message?: unknown }).message ?? "")
          : "";
  return BUSY_PATTERN.test(message);
}

/** 退避序列（毫秒）：约 2s，够跨过别的写入方一次 commit。 */
const RETRY_DELAYS = [20, 40, 80, 160, 320, 640, 640] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 排队 + 遇锁退避重试。 */
export async function withSerialDb<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await runExclusive(fn);
    } catch (err) {
      const delay = RETRY_DELAYS[attempt];
      if (delay === undefined || !isBusyError(err)) throw err;
      await sleep(delay);
    }
  }
}

/** 串行代理：普通语句走互斥锁，另提供绕过锁的直连通道给事务用。 */
class SerialDatabase extends Database {
  constructor(readonly inner: Database) {
    super(inner.path);
  }

  override execute(
    sql: string,
    values?: unknown[],
  ): Promise<{ rowsAffected: number; lastInsertId?: number }> {
    return withSerialDb(() => this.inner.execute(sql, values));
  }

  override select<T>(sql: string, values?: unknown[]): Promise<T> {
    return runExclusive(() => this.inner.select<T>(sql, values));
  }
}

/**
 * 取这个 Executor 的「直连通道」。
 *
 * 事务已经占住互斥锁了，它内部的语句**必须**绕过锁，否则会等自己。
 * 对测试用的假 driver（不带 SerialDatabase 结构），直接返回它本身 ——
 * 假 driver 内部不排队，在持锁状态下直接调用是安全的。
 */
export function directExecutor<T>(db: T): T {
  const inner = (db as unknown as { inner?: unknown }).inner;
  if (inner !== undefined && typeof inner === "object" && inner !== null) {
    return inner as T;
  }
  return db;
}

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const inner = await Database.load(DB_URL);
      const db = new SerialDatabase(inner);
      await db.execute("PRAGMA journal_mode = WAL");
      await db.execute("PRAGMA foreign_keys = ON");
      await db.execute("PRAGMA busy_timeout = 5000");
      return db;
    })();
  }
  return dbPromise;
}

/** 导出前调用，保证 .db 单文件自洽（§4.6 / §8.4）。 */
export async function checkpoint(): Promise<void> {
  const db = await getDb();
  await db.execute("PRAGMA wal_checkpoint(TRUNCATE)");
}

/** 测试用：丢弃缓存的连接。 */
export function resetDbCache(): void {
  dbPromise = null;
}
