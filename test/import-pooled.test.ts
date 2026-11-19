/**
 * 把 SqliteRepo 的**真实导入路径**跑在「有连接池语义」的数据库上。
 *
 * 为什么需要这一层：`repo.integration` 用的是串行化的假 driver，
 * 所有语句天然落在一条连接上，所以它永远看不到连接池导致的 code 5 与事务交错。
 * 这里把每次 execute 随机派给两条连接之一，用来钉住：
 *   - 导入不再报 `(code: 5) database is locked`
 *   - BEGIN/COMMIT 成组，事务体不会被打断
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { SqliteRepo } from "../src/data/sqlite/repo.ts";
import { createAsyncRunner, type AsyncRunner } from "./sqliteRunner.ts";

/**
 * 带连接池语义的 driver：
 * - 顺序调用时复用同一连接（sqlx 的默认行为）；
 * - 并发调用时会开第二条连接。
 * 写锁记在连接上，另一条连接写入即 BUSY —— 和真实 sqlx 一致。
 */
function createPooledDatabase(runner: AsyncRunner) {
  const conns = [{ holdsWrite: false, busy: false }];
  const log: string[] = [];

  function acquire(): number {
    const idle = conns.findIndex((c) => !c.busy);
    if (idle >= 0) {
      conns[idle]!.busy = true;
      return idle;
    }
    conns.push({ holdsWrite: false, busy: true });
    return conns.length - 1;
  }

  async function run(sql: string, params: unknown[], mode: "select" | "execute") {
    const conn = acquire();
    const upper = sql.trim().toUpperCase();
    log.push(`c${conn} ${upper.split("\n")[0]?.slice(0, 40) ?? ""}`);
    try {
      await new Promise((r) => setTimeout(r, 0));
      if (upper.startsWith("BEGIN")) {
        if (conns.some((c, i) => c.holdsWrite && i !== conn)) {
          throw new Error("error returned from database: (code: 5) database is locked");
        }
        conns[conn]!.holdsWrite = true;
      } else if (upper.startsWith("COMMIT") || upper.startsWith("ROLLBACK")) {
        conns[conn]!.holdsWrite = false;
      } else if (mode === "execute") {
        const holder = conns.findIndex((c) => c.holdsWrite);
        if (holder >= 0 && holder !== conn) {
          throw new Error("error returned from database: (code: 5) database is locked");
        }
      }
      return await runner.asyncRun(sql, params, mode);
    } finally {
      const c = conns[conn];
      if (c) c.busy = false;
    }
  }

  return {
    log,
    async execute(sql: string, params?: unknown[]) {
      const r = await run(sql, params ?? [], "execute");
      return { rowsAffected: r.changes };
    },
    async select<T>(sql: string, params?: unknown[]): Promise<T> {
      const r = await run(sql, params ?? [], "select");
      return r.rows as T;
    },
    async close() {
      runner.close();
    },
  };
}

let runner: AsyncRunner | null = null;
let repo: SqliteRepo;
let db: ReturnType<typeof createPooledDatabase>;

beforeEach(async () => {
  runner = await createAsyncRunner();
  db = createPooledDatabase(runner);
  repo = new SqliteRepo(db as unknown as ConstructorParameters<typeof SqliteRepo>[0]);
  await repo.init();
});

afterEach(() => {
  runner?.close();
  runner = null;
});

describe("导入在连接池语义下也能成功", () => {
  it("正常导入不报 code 5，词和义项都落库", async () => {
    const plan = await repo.planImport("abandon 放弃\nability 能力\nabsorb 吸收", new Date());
    const r = await repo.commitImport(plan, new Date());

    expect(r.insertedWords).toBe(3);

    const hits = await repo.search("abandon");
    expect(hits.length).toBe(1);
    expect(hits[0]?.headword).toBe("abandon");
  });

  it("两次导入并发时不会互相打断（事务整段占闸门）", async () => {
    const a = await repo.planImport("abandon 放弃", new Date());
    const b = await repo.planImport("ability 能力", new Date());
    const results = await Promise.allSettled([
      repo.commitImport(a, new Date()),
      repo.commitImport(b, new Date()),
    ]);
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      const reason = (failed[0] as PromiseRejectedResult).reason;
      console.log("FAILED REASON:", String(reason));
      console.log("LOG TAIL:", JSON.stringify((db as unknown as { log: string[] }).log.slice(-14), null, 0));
    }
    expect(failed).toEqual([]);
  });

  it("同一条词重复导入走追加义项，不会因为锁再失败", async () => {
    const first = await repo.planImport("abandon 放弃", new Date());
    await repo.commitImport(first, new Date());

    const second = await repo.planImport("abandon 抛弃", new Date());
    const r2 = await repo.commitImport(second, new Date());
    expect(r2.appendedSenses).toBeGreaterThanOrEqual(1);
  });
});