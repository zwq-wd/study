/**
 * 复习结算在「事务持锁」状态下不能卡住。
 *
 * 真实故障：`settleWord` 的事务体里，`review_logs` 那条 INSERT 还用着外层的
 * `db.execute`（而不是事务给的 `tx`）。外层 db 的 execute 会去排队等锁，
 * 而锁正被这个事务拿着 —— 于是永远等不到，复习页「我记到了 / 背对了」
 * 点下去没反应，`advanceLockRef` 也一直不释放。
 *
 * 这里用「持锁时若还在排队就直接报错」的假 driver 把这种写法钉死：
 * 一旦有人又把 db.execute 写回事务体，测试会立刻失败而不是卡住。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Rating } from "ts-fsrs";
import { SqliteRepo } from "../src/data/sqlite/repo.ts";
import { createAsyncRunner, type AsyncRunner } from "./sqliteRunner.ts";

/**
 * 模拟「事务持锁 + 外层排队」的死锁，但把它变成**立刻失败**而不是挂住：
 * 如果有人用外层 db 在持锁期间发语句，直接抛错。
 */
function createReentryDetectingDb(runner: AsyncRunner) {
  let lockHeld = false;

  const outer = {
    async execute(sql: string, params?: unknown[]) {
      const upper = sql.trim().toUpperCase();
      if (lockHeld && !upper.startsWith("BEGIN") && !upper.startsWith("COMMIT") && !upper.startsWith("ROLLBACK")) {
        throw new Error("REENTRY: 事务持锁期间不能用外层 db 发语句（会死锁）");
      }
      return runner.asyncRun(sql, params ?? [], "execute");
    },
    async select<T>(sql: string, params?: unknown[]): Promise<T> {
      const r = await runner.asyncRun(sql, params ?? [], "select");
      return r.rows as T;
    },
    inner: {
      async execute(sql: string, params?: unknown[]) {
        const upper = sql.trim().toUpperCase();
        if (upper.startsWith("BEGIN")) lockHeld = true;
        if (upper.startsWith("COMMIT") || upper.startsWith("ROLLBACK")) lockHeld = false;
        return runner.asyncRun(sql, params ?? [], "execute");
      },
      async select<T>(sql: string, params?: unknown[]): Promise<T> {
        const r = await runner.asyncRun(sql, params ?? [], "select");
        return r.rows as T;
      },
    },
    async close() {
      runner.close();
    },
  };

  return outer;
}

let runner: AsyncRunner | null = null;
let repo: SqliteRepo;

beforeEach(async () => {
  runner = await createAsyncRunner();
  const db = createReentryDetectingDb(runner);
  repo = new SqliteRepo(db as unknown as ConstructorParameters<typeof SqliteRepo>[0]);
  await repo.init();
});

afterEach(() => {
  runner?.close();
  runner = null;
});

describe("复习结算不会卡住", () => {
  it("settleWord 全程只用事务通道，不触发重入", async () => {
    const plan = await repo.planImport("abandon 放弃", new Date());
    await repo.commitImport(plan, new Date());

    const hits = await repo.search("abandon");
    const wordId = hits[0]?.id;
    expect(wordId).toBeTypeOf("number");

    // 若事务体里出现 db.execute，这里会抛 REENTRY 而不是挂住
    const res = await repo.settleWord(wordId as number, Rating.Good, new Date(), null);
    expect(res.nextDueDay).toBeTruthy();
  });

  it("连续结算多张也都能返回（复习页逐张推进）", async () => {
    const plan = await repo.planImport("abandon 放弃\nability 能力\nabsorb 吸收", new Date());
    await repo.commitImport(plan, new Date());

    const ids: number[] = [];
    for (const h of ["abandon", "ability", "absorb"]) {
      const hits = await repo.search(h);
      if (hits[0]?.id !== undefined) ids.push(hits[0].id);
    }
    expect(ids.length).toBe(3);

    for (const id of ids) {
      const r = await repo.settleWord(id, Rating.Good, new Date(), null);
      expect(r.nextDueDay).toBeTruthy();
    }
  });
});
