/**
 * 数据库连接（开发文档 §8.5）
 *
 * 三个 PRAGMA 必须在**每次建立连接后**单独执行，不能放进迁移文件：
 * - journal_mode 是数据库持久属性，设一次即可，重复执行无害
 * - foreign_keys 是**每连接**属性，放进迁移只会影响迁移那一瞬间的连接，之后全 OFF
 * - busy_timeout 防瞬时锁冲突直接报错
 */
import Database from "@tauri-apps/plugin-sql";

export const DB_URL = "sqlite:wordpacer.db";

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await Database.load(DB_URL);
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
