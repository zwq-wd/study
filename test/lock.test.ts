/**
 * 锁竞争 / 事务隔离回归测试。
 *
 * 三次真实踩过的坑，一次钉死一条：
 * 1. 不串行 → BEGIN 与后续语句被派到不同连接 → `(code: 5) database is locked`；
 * 2. 外层串行 + 内层又串行 → 自锁，导入按钮点了没反应；
 * 3. 用全局 depth 做重入判断 → 并发时 A 持锁中，B 误以为自己也在事务体内，
 *    直接插队 → 再撞 code 5。
 *
 * 现在的设计：事务**整段**占一把不可重入的锁，事务体内的语句走
 * 绕过锁的直连通道（directExecutor）—— 既不插队，也不自锁。
 */
import { describe, expect, it } from "vitest";
import { isBusyError, directExecutor, runExclusive } from "../src/data/sqlite/db.ts";
import { withTransaction, type Executor } from "../src/data/sqlite/tx.ts";

const BUSY = "error returned from database: (code: 5) database is locked";

/**
 * 按 sqlx 真实行为模拟连接池：复用一条空闲连接，只有并发时才开第二条。
 * 写锁记在连接上，另一条连接写入即 BUSY。
 */
class PoolSim implements Executor {
  log: string[] = [];
  private conns = [{ holdsWrite: false, busy: false }];

  private acquire(): number {
    const idle = this.conns.findIndex((c) => !c.busy);
    if (idle >= 0) {
      this.conns[idle]!.busy = true;
      return idle;
    }
    this.conns.push({ holdsWrite: false, busy: true });
    return this.conns.length - 1;
  }

  async execute(sql: string): Promise<unknown> {
    const conn = this.acquire();
    const upper = sql.trim().toUpperCase();
    this.log.push(`c${conn} ${upper}`);
    try {
      await new Promise((r) => setTimeout(r, 1));
      if (upper.startsWith("BEGIN")) {
        if (this.conns.some((c, i) => c.holdsWrite && i !== conn)) throw new Error(BUSY);
        this.conns[conn]!.holdsWrite = true;
        return undefined;
      }
      if (upper.startsWith("COMMIT") || upper.startsWith("ROLLBACK")) {
        this.conns[conn]!.holdsWrite = false;
        return undefined;
      }
      const holder = this.conns.findIndex((c) => c.holdsWrite);
      if (holder >= 0 && holder !== conn) throw new Error(BUSY);
      return undefined;
    } finally {
      const c = this.conns[conn];
      if (c) c.busy = false;
    }
  }

  async select<T>(): Promise<T> {
    return [] as unknown as T;
  }
}

/** 模拟 SerialDatabase：普通调用排队，inner 是直连通道。 */
function guardedOf(pool: PoolSim) {
  const guarded = {
    inner: pool,
    execute: (sql: string) => runExclusive(() => pool.execute(sql)),
    select: <T>() => runExclusive(() => pool.select<T>()),
  };
  return guarded;
}

describe("isBusyError", () => {
  it("认出 code 5 与裸消息", () => {
    expect(isBusyError(new Error(BUSY))).toBe(true);
    expect(isBusyError("database is locked")).toBe(true);
  });

  it("不误判其它错误", () => {
    expect(isBusyError(new Error("UNIQUE constraint failed"))).toBe(false);
    expect(isBusyError(null)).toBe(false);
  });
});

describe("directExecutor：取到绕过互斥锁的直连通道", () => {
  it("带 inner 的代理 → 返回 inner", () => {
    const pool = new PoolSim();
    const g = guardedOf(pool);
    expect(directExecutor(g)).toBe(pool);
  });

  it("普通 driver（无 inner）→ 返回自身", () => {
    const pool = new PoolSim();
    expect(directExecutor(pool)).toBe(pool);
  });
});

describe("withTransaction：不自锁，且事务整段连续", () => {
  it("事务体里多次 execute 不会卡住", async () => {
    const pool = new PoolSim();
    const g = guardedOf(pool);

    const out = await Promise.race([
      withTransaction(g, async (tx) => {
        await tx.execute("INSERT INTO words VALUES (1)");
        await tx.execute("INSERT INTO senses VALUES (1)");
        return "done";
      }),
      new Promise((r) => setTimeout(() => r("DEADLOCK"), 3000)),
    ]);

    expect(out).toBe("done");
    expect(pool.log).toEqual([
      "c0 BEGIN IMMEDIATE",
      "c0 INSERT INTO WORDS VALUES (1)",
      "c0 INSERT INTO SENSES VALUES (1)",
      "c0 COMMIT",
    ]);
  });

  it("两个并发事务不交叉（整段占锁，不是语句级）", async () => {
    const pool = new PoolSim();
    const g = guardedOf(pool);

    const results = await Promise.all([
      withTransaction(g, async (tx) => {
        await tx.execute("INSERT INTO a VALUES (1)");
        return "a";
      }),
      withTransaction(g, async (tx) => {
        await tx.execute("INSERT INTO b VALUES (2)");
        return "b";
      }),
    ]);

    expect(results).toEqual(["a", "b"]);
    expect(pool.log).toEqual([
      "c0 BEGIN IMMEDIATE",
      "c0 INSERT INTO A VALUES (1)",
      "c0 COMMIT",
      "c0 BEGIN IMMEDIATE",
      "c0 INSERT INTO B VALUES (2)",
      "c0 COMMIT",
    ]);
  });

  it("事务体抛错 → ROLLBACK 且原错误照抛", async () => {
    const pool = new PoolSim();
    const g = guardedOf(pool);
    await expect(
      withTransaction(g, async (tx) => {
        await tx.execute("INSERT INTO a VALUES (1)");
        throw new Error("UNIQUE constraint failed: words.norm");
      }),
    ).rejects.toThrow(/UNIQUE/);
    expect(pool.log).toContain("c0 ROLLBACK");
  });
});

describe("根因：不串行时并发事务会撞上 code 5", () => {
  it("两个裸事务并发 → 至少一个 BUSY", async () => {
    const pool = new PoolSim();
    const naive = async (): Promise<void> => {
      await pool.execute("BEGIN IMMEDIATE");
      await pool.execute("INSERT INTO t VALUES (1)");
      await pool.execute("COMMIT");
    };
    const results = await Promise.allSettled([naive(), naive()]);
    const failed = results.filter((r) => r.status === "rejected");
    expect(failed.length).toBeGreaterThan(0);
    expect(isBusyError((failed[0] as PromiseRejectedResult).reason)).toBe(true);
  });
});