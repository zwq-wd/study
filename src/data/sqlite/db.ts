/**
 * 数据库连接（开发文档 §8.5）
 *
 * 三个 PRAGMA 必须在**每次建立连接后**单独执行，不能放进迁移文件：
 * - journal_mode 是数据库持久属性，设一次即可，重复执行无害
 * - foreign_keys 是**每连接**属性，放进迁移只会影响迁移那一瞬间的连接，之后全 OFF
 * - busy_timeout 防瞬时锁冲突直接报错
 *
 * ── 为什么要包一层串行代理（v0.6.1）───────────────────────────────
 * plugin-sql 底下是 sqlx 的连接池（默认最多 10 条）。每次 execute/select 都是
 * 「取一条 → 跑 → 归还」，**连续两条语句不保证落在同一条连接上**。
 *
 * 这会直接毁掉多语句事务：`BEGIN IMMEDIATE` 在连接 A 上拿到写锁后 A 归还进池，
 * 锁仍在 A 身上；下一条语句若被派给连接 B，B 处于 autocommit，直接写入 →
 * 立刻 `SQLITE_BUSY (code 5): database is locked`。这就是导入失败的那条报错。
 *
 * 关键点：busy_timeout 只会等**别人**，不会等**自己池子里**那条握着锁的连接，
 * 所以调大超时没用；重试也没用 —— 只要 BEGIN 和后面的语句还落在不同连接上，
 * 每轮重试都会以同样的方式失败。
 *
 * 真正的修法：让同一时刻只有一条语句在飞。这样池里只会用到一条连接，
 * BEGIN 与它后面的语句必然复用同一条 —— 事务语义才真的成立。
 * 代价可以忽略（单用户桌面应用，一次一屏的操作），换来的是事务真的生效。
 */
import Database from "@tauri-apps/plugin-sql";

export const DB_URL = "sqlite:wordpacer.db";

/**
 * 全局串行闸门。
 *
 * 保证两件事：
 * 1. 同一时刻只有一条语句在飞 → 连接池只会用到一条连接 → 事务语义成立；
 * 2. 多个调用方（比如游戏页那几个 Promise.all 查询）不会同时抢写锁。
 */
let gate: Promise<unknown> = Promise.resolve();

export function serializeDb<T>(fn: () => Promise<T>): Promise<T> {
  const run = gate.then(fn, fn);
  gate = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

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
async function serialized<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await serializeDb(fn);
    } catch (err) {
      const delay = RETRY_DELAYS[attempt];
      if (delay === undefined || !isBusyError(err)) throw err;
      await sleep(delay);
    }
  }
}

/**
 * 串行代理：`path` 与真实实例一致，execute / select 先排队再转发。
 *
 * 这里用「持有真实实例并转发」而不是继承，是因为 Database 的 execute/select
 * 都只依赖 this.path 去调 IPC —— 转发语义更清楚，也不会误伤 close()。
 */
class SerialDatabase extends Database {
  constructor(private readonly inner: Database) {
    super(inner.path);
  }

  override execute(
    sql: string,
    values?: unknown[],
  ): Promise<{ rowsAffected: number; lastInsertId?: number }> {
    return serialized(() => this.inner.execute(sql, values));
  }

  override select<T>(sql: string, values?: unknown[]): Promise<T> {
    return serialized(() => this.inner.select<T>(sql, values));
  }
}

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      // load 会触发 Rust 侧的连接与迁移；拿到的实例带着解析后的真实路径。
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
