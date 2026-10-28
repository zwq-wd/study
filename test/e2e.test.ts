/**
 * 端到端验证：用真实 SqliteRepo + 真实 SQLite 走完一整条产品流程。
 *
 * 这不是单元测试，是「你自己用两周会发生什么」的模拟：
 * 录入 38 行 → 查询 → 会话 → 逐卡结算 → 导出 → 删库 → 导入。
 */
import { afterEach, describe, expect, it } from "vitest";
import { Rating } from "ts-fsrs";
import { SqliteRepo } from "../src/data/sqlite/repo.ts";
import { createFakeDatabase, createAsyncRunner, type AsyncRunner } from "./sqliteRunner.ts";
import { buildSession } from "../src/domain/scheduler/session.ts";
import { dayKey } from "../src/domain/time.ts";
import { parseBundleText } from "../src/domain/export.ts";

type AnyDb = ConstructorParameters<typeof SqliteRepo>[0];

let runner: AsyncRunner | null = null;

async function open(): Promise<SqliteRepo> {
  runner = await createAsyncRunner();
  const r = new SqliteRepo(createFakeDatabase(runner) as unknown as AnyDb);
  await r.init();
  return r;
}

afterEach(() => {
  runner?.close();
  runner = null;
});

const SAMPLE = `abandon 放弃；抛弃
abstract 抽象的
accommodate 容纳
accompany 陪伴
accumulate 积累
accurate 准确的
accuse 指责
achieve 实现
acknowledge 承认
acquire 获得
adapt 适应
adequate 充足的
adjust 调整
admire 钦佩
adopt 采用；收养
advantage 优势
advocate 提倡
affect 影响
afford 负担得起
aggressive 好斗的
alternative 替代的
ambitious 有雄心的
analyze 分析
annual 每年的
anxious 焦虑的
appreciate 欣赏；感激
approach 方法
appropriate 适当的
approve 批准
argue 争论
arise 出现
assess 评估
assume 假定
attach 附上
attempt 尝试
attitude 态度
attract 吸引
abandon 放弃`;

describe("端到端：录入 → 查询 → 复习 → 备份", () => {
  it("完整走一遍", async () => {
    const repo = await open();
    const t0 = new Date(2026, 9, 27, 10, 0, 0); // 2026-10-27 10:00 本地

    // ---------- 1. 粘贴录入（两步：预览 → 导入）
    const plan = await repo.planImport(SAMPLE, t0);
    expect(plan.summary.errors).toBe(0);
    // 38 行里 abandon 出现两次 → 新增 37，重复 1
    expect(plan.summary.newWords).toBe(37);
    expect(plan.summary.duplicates).toBe(1);
    expect(plan.summary.noMeaning).toBe(0);

    const committed = await repo.commitImport(plan, t0);
    expect(committed.insertedWords).toBe(37);

    // ---------- 2. 查询：「背过没有」
    const found = await repo.search("abandon");
    expect(found).toHaveLength(1);
    expect(found[0]?.firstMeaning).toBe("放弃");
    expect(found[0]?.lastReviewDay).toBe("2026-10-27");
    expect(found[0]?.fsrs_due_day).toBe("2026-10-31"); // 4 天后

    const cn = await repo.search("焦虑");
    expect(cn.map((h) => h.norm)).toEqual(["anxious"]);

    // 查不到 = 没背过
    expect(await repo.search("serendipity")).toEqual([]);

    // ---------- 3. 当天打开：还没到期
    const today = dayKey(t0, 4);
    expect(today).toBe("2026-10-27");
    expect(await repo.countDue(today)).toBe(0);
    let stats = await repo.stats(today);
    expect(stats.total).toBe(37);
    expect(stats.learning).toBe(37);
    expect(stats.graduated).toBe(0);
    expect(stats.dueToday).toBe(0);
    expect(stats.nextDueInDays).toBe(4);

    // ---------- 4. 四天后打开：37 张到期
    const t1 = new Date(2026, 9, 31, 21, 0, 0);
    const day1 = dayKey(t1, 4);
    expect(day1).toBe("2026-10-31");
    const due = await repo.listDue(day1);
    expect(due.length).toBe(37);

    // 全部给 Good
    const cfg = await repo.config();
    const pick = buildSession(due, cfg.sessionLimit, false);
    expect(pick.picked.length).toBe(37);
    expect(pick.deferred).toBe(0);

    const sessionId = "s-e2e-1";
    await repo.startSession(sessionId, t1, pick.picked.length, pick.deferred);
    for (const w of pick.picked) {
      await repo.settleWord(w.id, Rating.Good, t1, sessionId);
    }
    await repo.updateSession(sessionId, { shown: pick.picked.length, again: 0 });
    await repo.endSession(sessionId, t1);

    // 复习完 → 今天的到期清零，下次推到 31 天后
    expect(await repo.countDue(day1)).toBe(0);
    stats = await repo.stats(day1);
    expect(stats.dueToday).toBe(0);
    const w = await repo.getWordByNorm("abandon");
    expect(w?.fsrs_reps).toBe(2);
    expect(w?.fsrs_scheduled_days).toBeGreaterThanOrEqual(30);

    // ---------- 5. 导出
    const bundle = await repo.exportAll();
    expect(bundle.words).toHaveLength(37);
    expect(bundle.version).toBe(1);

    // 走一遍真实文件序列化 + 解析
    const text = JSON.stringify(bundle, null, 2);
    const parsed = parseBundleText(text);
    expect(parsed.words).toHaveLength(37);

    // ---------- 6. 换一台机器：全新库导入
    const repo2 = await open();
    const imported = await repo2.importAll(parsed, "replace");
    expect(imported.insertedWords).toBe(37);

    const again = await repo2.exportAll();
    expect(again.words.map((x) => x.norm).sort()).toEqual(bundle.words.map((x) => x.norm).sort());

    // 记忆状态也带过去了
    const restored = again.words.find((x) => x.norm === "abandon");
    expect(restored?.fsrs.reps).toBe(2);
    expect(restored?.senses.map((s) => s.meaningCn).sort()).toEqual(["抛弃", "放弃"]);

    // 导入后统计一致
    const s2 = await repo2.stats(day1);
    expect(s2.total).toBe(37);
    expect(s2.dueToday).toBe(0);
  });

  it("隔一个月没打开：不崩，按逾期最久优先，超上限的顺延", async () => {
    const repo = await open();
    const t0 = new Date(2026, 8, 1, 10, 0, 0); // 2026-09-01
    const plan = await repo.planImport(SAMPLE, t0);
    await repo.commitImport(plan, t0);

    // 把上限调到下限 60，造 37 个词不足以触发顺延；这里再把 30 个词塞进去凑到 67
    const extra = Array.from({ length: 30 }, (_, i) => `extra${i} 额外${i}`).join("\n");
    const p2 = await repo.planImport(extra, t0);
    await repo.commitImport(p2, t0);

    // 一个月后打开
    const t1 = new Date(2026, 9, 27, 10, 0, 0);
    const today = dayKey(t1, 4);
    const due = await repo.listDue(today);
    expect(due.length).toBe(67);

    const cfg = await repo.config();
    expect(cfg.sessionLimit).toBe(150); // 默认上限比 67 大，所以没有顺延
    const pick = buildSession(due, cfg.sessionLimit, false);
    expect(pick.picked.length).toBe(67);
    expect(pick.deferred).toBe(0);

    // 逾期最久优先：所有词 due 都是 2026-09-05，此时按 stability / id
    expect(due[0]?.fsrs_due_day).toBe("2026-09-05");
    expect(due[0]?.id).toBeLessThan(due[1]?.id ?? Number.MAX_SAFE_INTEGER);

    const stats = await repo.stats(today);
    expect(stats.dueToday).toBe(67);
    expect(stats.maxOverdueDays).toBeGreaterThan(40);
  });
});
