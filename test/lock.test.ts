/**
 * 锁竞争回归测试（SQLITE_BUSY / code 5）。
 *
 * 用户导入时看到 `error returned from database: (code: 5) database is locked`。
 * 根因：plugin-sql 底下是连接池，`BEGIN IMMEDIATE` 和它后面的语句可能落在
 * **不同连接**上 —— 写锁在前一条连接身上，后一条连接直接写入，立刻 BUSY。
 *
 * 下面用一个按 sqlx 真实行为建模的假池子把两种情形都钉死：
 * - 并发时（没串行）→ 池里出现第二条连接 → 事务必然失败；
 * - 串行时 → 池里永远只有一条连接 → 事务生效。
 */
import { describe, expect, it } from "vitest";
import { isBusyError } from "../src/data/sqlite/db.ts";
import { withTransaction, type Executor } from "../src/data/sqlite/tx.ts";

const BUSY = "error returned from database: (code: 5) database is locked";

/**
 * 按 sqlx 的真实行为模拟：**复用一个空闲连接**，只有在语句并发时才会开出第二条。
 * 每条连接有自己的事务深度（autocommit 时深度为 0）。
 */
class PoolSim implements Executor {
  log: string[] = [];
  /** 相连连接：每项是该连接的未提交写锁标记 */
  private conns: Array<{ holdsWrite: boolean; busy: boolean }> = [
    { holdsWrite: false, busy: false },
  ];
  failOnceAt = -1;
  private calls = 0;

  private acquire(): number {
    const idle = this.conns.findIndex((c) => !c.busy);
    if (idle >= 0) {
      this.conns[idle]!.busy = true;
      return idle;
    }
    // 没有空闲连接 → 池子开一条新的
    this.conns.push({ holdsWrite: false, busy: true });
    return this.conns.length - 1;
  }

  private release(i: number): void {
    const c = this.conns[i];
    if (c) c.busy = false;
  }

  async execute(sql: string): Promise<unknown> {
    const conn = this.acquire();
    this.calls += 1;
    const upper = sql.trim().toUpperCase();
    this.log.push(`c${conn} ${upper}`);
    try {
      if (this.calls === this.failOnceAt) throw new Error(BUSY);
      await new Promise((r) => setTimeout(r, 1)); // 模拟 IPC 往返

      if (upper.startsWith("BEGIN")) {
        if (this.conns.some((c) => c.holdsWrite && c !== this.conns[conn])) throw new Error(BUSY);
        this.conns[conn]!.holdsWrite = true;
        return undefined;
      }
      if (upper.startsWith("COMMIT") || upper.startsWith("ROLLBACK")) {
        this.conns[conn]!.holdsWrite = false;
        return undefined;
      }
      // 普通写入：只有握着写锁的那条连接写得进去
      const holder = this.conns.findIndex((c) => c.holdsWrite);
      if (holder >= 0 && holder !== conn) throw new Error(BUSY);
      return undefined;
    } finally {
      this.release(conn);
    }
  }

  async select<T>(): Promise<T> {
    return [] as unknown as T;
  }
}

/** 不串行的「裸」事务：模拟修复前的行为，应该稳定重现 code 5。 */
async function naiveTransaction(pool: PoolSim): Promise<void> {
  await pool.execute("BEGIN IMMEDIATE");
  await pool.execute("INSERT INTO words(headword) VALUES (1)");
  await pool.execute("COMMIT");
}

describe("isBusyError：认出 plugin-sql 包出来的 code 5", () => {
  it("认得出用户实际看到的那句", () => {
    expect(isBusyError(new Error(BUSY))).toBe(true);
  });

  it("也认裸字符串与 SQLITE_BUSY", () => {
    expect(isBusyError("database is locked")).toBe(true);
    expect(isBusyError(new Error("SQLITE_BUSY"))).toBe(true);
  });

  it("不把别的错误当成锁冲突", () => {
    expect(isBusyError(new Error("UNIQUE constraint failed: words.norm"))).toBe(false);
    expect(isBusyError(new Error("no such table: words"))).toBe(false);
    expect(isBusyError(null)).toBe(false);
  });
});

describe("根因：不串行时，第二个并发事务会撞上 code 5", () => {
  it("两个 naive 事务并发 → 至少一个 BUSY（这就是导入失败的场景）", async () => {
    const pool = new PoolSim();
    const results = await Promise.allSettled([naiveTransaction(pool), naiveTransaction(pool)]);

    const failed = results.filter((r) => r.status === "rejected");
    expect(failed.length).toBeGreaterThan(0);
    // 失败原因必须是锁冲突，而不是别的错
    const reason = (failed[0] as PromiseRejectedResult).reason;
    expect(isBusyError(reason)).toBe(true);
  });
});

describe("修复：withTransaction 串行化后，事务真的落在一条连接上", () => {
  it("两个并发事务都成功", async () => {
    const pool = new PoolSim();
    const results = await Promise.all([
      withTransaction(pool, async () => {
        await pool.execute("INSERT INTO a VALUES (1)");
        return "a";
      }),
      withTransaction(pool, async () => {
        await pool.execute("INSERT INTO b VALUES (2)");
        return "b";
      }),
    ]);

    expect(results).toEqual(["a", "b"]);
    // 全程只该用到一条连接：c0
    expect(pool.log.every((l) => l.startsWith("c0 "))).toBe(true);
  });

  it("事务体的语句不会被别的事务插进来", async () => {
    const pool = new PoolSim();
    await Promise.all([
      withTransaction(pool, async () => {
        await pool.execute("INSERT INTO a VALUES (1)");
      }),
      withTransaction(pool, async () => {
        await pool.execute("INSERT INTO b VALUES (2)");
      }),
    ]);

    // BEGIN/COMMIT/INSERT 必须成组出现，绝不能 BEGIN A / BEGIN B / ... 交替
    expect(pool.log).toEqual([
      "c0 BEGIN IMMEDIATE",
      "c0 INSERT INTO A VALUES (1)",
      "c0 COMMIT",
      "c0 BEGIN IMMEDIATE",
      "c0 INSERT INTO B VALUES (2)",
      "c0 COMMIT",
    ]);
  });

  it("事务体抛错时会 ROLLBACK，并把原错误抛出去", async () => {
    const pool = new PoolSim();
    await expect(
      withTransaction(pool, async () => {
        await pool.execute("INSERT INTO a VALUES (1)");
        throw new Error("UNIQUE constraint failed: words.norm");
      }),
    ).rejects.toThrow(/UNIQUE/);

    expect(pool.log).toContain("c0 ROLLBACK");
  });
});
