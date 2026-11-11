/**
 * 集成测试：SqliteRepo 跑在**真实 SQLite** 上（见 test/sqliteRunner.ts）。
 *
 * 覆盖：迁移建表、默认设置落库、录入（新增/追加/重复）、查询、单卡结算、
 * 会话上限顺延、导出 → 导入 round-trip。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Rating } from "ts-fsrs";
import { SqliteRepo } from "../src/data/sqlite/repo.ts";
import { createFakeDatabase, createAsyncRunner, type AsyncRunner } from "./sqliteRunner.ts";

// 测试替身的类型与 plugin-sql 的 Database 不同构，这里显式放宽
type AnyDb = ConstructorParameters<typeof SqliteRepo>[0];

let runner: AsyncRunner | null = null;
let repo: SqliteRepo;

async function freshRepo(): Promise<SqliteRepo> {
  runner = await createAsyncRunner();
  const db = createFakeDatabase(runner) as unknown as AnyDb;
  const r = new SqliteRepo(db);
  await r.init();
  return r;
}

const at = (iso: string) => new Date(iso);

beforeEach(async () => {
  repo = await freshRepo();
});

afterEach(() => {
  runner?.close();
  runner = null;
});

describe("设置初始化", () => {
  it("首次启动写入全部默认值", async () => {
    const s = await repo.loadSettings();
    expect(s["request_retention"]).toBe("0.85");
    expect(s["session_limit"]).toBe("150");
    expect(s["maximum_interval"]).toBe("50");
    expect(s["graduate_interval"]).toBe("90");
    expect(s["min_reps_to_graduate"]).toBe("4");
    expect(s["graduation_on_lapses"]).toBe("6");
    expect(s["day_boundary_hour"]).toBe("4");
    // 「显示不会按钮」开关已退役（§4.3.2 改成两步流程），新库不再写这个键
    expect(s["enable_again_button"]).toBeUndefined();
  });

  it("config() 还原成 SchedulerConfig", async () => {
    const cfg = await repo.config();
    expect(cfg.requestRetention).toBe(0.85);
    expect(cfg.sessionLimit).toBe(150);
    expect(cfg.maximumInterval).toBe(50);
  });

  it("saveSettings 后 config 跟着变（缓存失效）", async () => {
    await repo.saveSettings({ session_limit: "80" });
    expect((await repo.config()).sessionLimit).toBe(80);
  });
});

describe("录入（真实 SQL）", () => {
  it("新词入库：words + senses + 一条 Good 日志", async () => {
    const plan = await repo.planImport("abandon 放弃；抛弃\nabstract 抽象的", new Date());
    expect(plan.summary.newWords).toBe(2);

    const r = await repo.commitImport(plan, at("2026-10-27T10:00:00+08:00"));
    expect(r.insertedWords).toBe(2);
    expect(r.appendedSenses).toBe(0);

    const w = await repo.getWordByNorm("abandon");
    expect(w).not.toBeNull();
    expect(w?.headword).toBe("abandon");
    expect(w?.senses.map((s) => s.meaning_cn).sort()).toEqual(["抛弃", "放弃"]);
    // 录入即计一次 Good → State.Review，不是 New
    expect(w?.fsrs_state).toBe(2);
    expect(w?.fsrs_reps).toBe(1);
    // due_day 已按边界小时算好（4 天后）
    expect(w?.fsrs_due_day).toBe("2026-10-31");
  });

  it("已存在 + 新意思 → 追加 L2 义项，且不覆盖 L1", async () => {
    const p1 = await repo.planImport("abandon 放弃", at("2026-10-27T10:00:00+08:00"));
    await repo.commitImport(p1, at("2026-10-27T10:00:00+08:00"));

    const p2 = await repo.planImport("abandon 放纵", at("2026-10-27T10:05:00+08:00"));
    expect(p2.summary.appendSenses).toBe(1);
    await repo.commitImport(p2, at("2026-10-27T10:05:00+08:00"));

    const w = await repo.getWordByNorm("abandon");
    expect(w?.senses).toHaveLength(2);
    expect(w?.senses.map((s) => s.layer).sort()).toEqual([1, 2]);
  });

  it("已存在 + 相同意思 → 不重复插入", async () => {
    const p = await repo.planImport("abandon 放弃", at("2026-10-27T10:00:00+08:00"));
    await repo.commitImport(p, at("2026-10-27T10:00:00+08:00"));

    const p2 = await repo.planImport("abandon 放弃", at("2026-10-27T10:05:00+08:00"));
    expect(p2.summary.duplicates).toBe(1);
    await repo.commitImport(p2, at("2026-10-27T10:05:00+08:00"));

    const w = await repo.getWordByNorm("abandon");
    expect(w?.senses).toHaveLength(1);
  });

  it("错误行不入库", async () => {
    const plan = await repo.planImport("放弃 abandon\nabstract 抽象的", new Date());
    expect(plan.summary.errors).toBe(1);
    const r = await repo.commitImport(plan, new Date());
    expect(r.insertedWords).toBe(1);
    expect(await repo.getWordByNorm("abandon")).toBeNull();
  });

  it("批量 50 行一次落库（多值 INSERT 不被参数上限卡住）", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `word${i} 释义${i}`).join("\n");
    const plan = await repo.planImport(lines, new Date());
    expect(plan.summary.newWords).toBe(50);
    const r = await repo.commitImport(plan, new Date());
    expect(r.insertedWords).toBe(50);
    const hits = await repo.search("word", { limit: 200 });
    expect(hits.length).toBe(50);
  });
});

describe("查询", () => {
  beforeEach(async () => {
    const plan = await repo.planImport(
      "abandon 放弃；抛弃\nabstract 抽象的\naccommodate 容纳",
      new Date(),
    );
    await repo.commitImport(plan, at("2026-10-27T10:00:00+08:00"));
  });

  it("按英文前缀查（大小写不敏感）", async () => {
    const hits = await repo.search("ABAN");
    expect(hits.map((h) => h.norm)).toEqual(["abandon"]);
  });

  it("按中文查", async () => {
    const hits = await repo.search("抽象");
    expect(hits.map((h) => h.norm)).toEqual(["abstract"]);
  });

  it("结果行带首条 L1 释义与最后复习日", async () => {
    const hits = await repo.search("abandon");
    expect(hits[0]?.firstMeaning).toMatch(/放弃|抛弃/);
    expect(hits[0]?.lastReviewDay).toBe("2026-10-27");
  });

  it("查不到 = 没背过", async () => {
    expect(await repo.search("zebra")).toEqual([]);
  });

  it("LIKE 特殊字符不会炸", async () => {
    expect(await repo.search("%")).toEqual([]);
    expect(await repo.search("_")).toEqual([]);
  });
});

describe("单卡结算", () => {
  beforeEach(async () => {
    const plan = await repo.planImport("abandon 放弃", new Date());
    await repo.commitImport(plan, at("2026-10-27T10:00:00+08:00"));
  });

  it("Good 推进 due_day，并写一条 review_log", async () => {
    const w = await repo.getWordByNorm("abandon");
    const before = w!.fsrs_due_day;
    const r = await repo.settleWord(w!.id, Rating.Good, at("2026-10-31T10:00:00+08:00"), "s1");
    expect(r.nextDueDay).not.toBe(before);
    expect(r.graduated).toBe(false);

    const after = await repo.getWordByNorm("abandon");
    expect(after?.fsrs_reps).toBe(2);
  });

  it("Again 增加 lapses", async () => {
    const w = await repo.getWordByNorm("abandon");
    await repo.settleWord(w!.id, Rating.Again, at("2026-10-31T10:00:00+08:00"), "s1");
    const after = await repo.getWordByNorm("abandon");
    expect(after?.fsrs_lapses).toBe(1);
  });

  it("结算不存在的词条 → 明确报错", async () => {
    await expect(repo.settleWord(9999, Rating.Good, new Date(), null)).rejects.toThrow(/词条不存在/);
  });
});

describe("首页统计与会话", () => {
  it("空库：四个数字都是 0，nextDueInDays 为 null", async () => {
    const s = await repo.stats("2026-10-27");
    expect(s.total).toBe(0);
    expect(s.dueToday).toBe(0);
    expect(s.deferred).toBe(0);
    expect(s.nextDueInDays).toBeNull();
  });

  it("listDue 只取 learning 且 due_day <= today", async () => {
    const plan = await repo.planImport("a 甲\nb 乙", new Date());
    await repo.commitImport(plan, at("2026-10-27T10:00:00+08:00"));
    // due 是 4 天后（2026-10-31），今天不该到期
    expect((await repo.listDue("2026-10-27")).length).toBe(0);
    expect((await repo.listDue("2026-10-31")).length).toBe(2);
  });

  it("stats 的 nextDueInDays 指向未来的最早到期日", async () => {
    const plan = await repo.planImport("a 甲", new Date());
    await repo.commitImport(plan, at("2026-10-27T10:00:00+08:00"));
    const s = await repo.stats("2026-10-27");
    expect(s.nextDueInDays).toBe(4);
  });

  it("会话开始/更新/结束都能落库", async () => {
    await repo.startSession("s-1", new Date(), 10, 3);
    await repo.updateSession("s-1", { shown: 5, again: 1 });
    await repo.endSession("s-1", new Date());
    const db = (repo as unknown as { db: { select: <T>(s: string) => Promise<T> } }).db;
    const rows = await db.select<Array<{ shown: number; ended_at: number | null }>>(
      "SELECT shown, ended_at FROM sessions WHERE id = 's-1'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.shown).toBe(5);
    expect(rows[0]?.ended_at).not.toBeNull();
  });
});

describe("导出 → 导入", () => {
  it("round-trip 数据完全一致", async () => {
    const plan = await repo.planImport("abandon 放弃；抛弃\nabstract 抽象的", new Date());
    await repo.commitImport(plan, at("2026-10-27T10:00:00+08:00"));

    const bundle = await repo.exportAll();
    expect(bundle.words).toHaveLength(2);
    expect(bundle.settings["request_retention"]).toBe("0.85");

    const r2 = await freshRepo();
    const res = await r2.importAll(bundle, "replace");
    expect(res.insertedWords).toBe(2);

    const again = await r2.exportAll();
    expect(again.words.map((w) => w.norm).sort()).toEqual(bundle.words.map((w) => w.norm).sort());
    expect(again.words.find((w) => w.norm === "abandon")?.senses.length).toBe(2);
  });

  it("导出不含 ai_ 前缀的设置（红线：API Key 不入库）", async () => {
    await repo.saveSettings({ ai_api_key: "sk-should-not-export" });
    const bundle = await repo.exportAll();
    expect(JSON.stringify(bundle)).not.toContain("sk-should-not-export");
  });

  it("merge 模式按 norm 合并，已存在的以导入为准", async () => {
    const p1 = await repo.planImport("abandon 放弃", new Date());
    await repo.commitImport(p1, at("2026-10-27T10:00:00+08:00"));

    const bundle = await repo.exportAll();
    const first = bundle.words[0];
    expect(first).toBeDefined();
    if (first) first.senses = [{ meaningCn: "改过的释义", layer: 1, origin: "manual" }];

    const res = await repo.importAll(bundle, "merge");
    expect(res.skipped).toBe(1);

    const w = await repo.getWordByNorm("abandon");
    expect(w?.senses[0]?.meaning_cn).toBe("改过的释义");
  });

  it("replace 模式先清空", async () => {
    const p1 = await repo.planImport("abandon 放弃\nabstract 抽象的", new Date());
    await repo.commitImport(p1, at("2026-10-27T10:00:00+08:00"));

    const bundle = await repo.exportAll();
    bundle.words = bundle.words.filter((w) => w.norm === "abandon");

    await repo.importAll(bundle, "replace");
    expect((await repo.search("", { limit: 100 })).map((h) => h.norm)).toEqual(["abandon"]);
  });
});

describe("维护操作", () => {
  it("addSense 追加 L2 义项", async () => {
    const p = await repo.planImport("abandon 放弃", new Date());
    await repo.commitImport(p, new Date());
    const w = await repo.getWordByNorm("abandon");
    await repo.addSense(w!.id, "放纵", "manual");
    const after = await repo.getWordByNorm("abandon");
    expect(after?.senses.map((s) => s.layer).sort()).toEqual([1, 2]);
  });

  it("resetWord 重置为可复习状态", async () => {
    const p = await repo.planImport("abandon 放弃", new Date());
    await repo.commitImport(p, at("2026-10-01T10:00:00+08:00"));
    const w = await repo.getWordByNorm("abandon");
    await repo.resetWord(w!.id, at("2026-10-27T10:00:00+08:00"));
    const after = await repo.getWordByNorm("abandon");
    expect(after?.status).toBe("learning");
    expect(after?.fsrs_lapses).toBe(0);
    expect(after?.fsrs_reps).toBe(0);
  });

  /**
   * 「立即排入下次会话」不能只是按钮上的一句承诺。
   * listDue 只取 fsrs_due_day <= 今天，所以 due 必须就是今天 —— 用 newWordCard
   * （due = now + 4 天）会让重新激活的词 4 天后才出现。
   */
  it("resetWord 之后当天就能被 listDue 排到", async () => {
    const p = await repo.planImport("abandon 放弃", new Date());
    await repo.commitImport(p, at("2026-10-01T10:00:00+08:00"));
    const w = await repo.getWordByNorm("abandon");

    await repo.resetWord(w!.id, at("2026-10-27T10:00:00+08:00"));

    const due = await repo.listDue("2026-10-27");
    expect(due.map((r) => r.norm)).toContain("abandon");
  });

  it("resetWord 清掉毕业状态，已毕业的词能回到队列", async () => {
    const p = await repo.planImport("abandon 放弃", new Date());
    await repo.commitImport(p, at("2026-10-01T10:00:00+08:00"));
    const w = await repo.getWordByNorm("abandon");
    await repo.updateWord(w!.id, { status: "graduated" });
    expect(await repo.listDue("2026-10-27")).toEqual([]);

    await repo.resetWord(w!.id, at("2026-10-27T10:00:00+08:00"));

    expect((await repo.listDue("2026-10-27")).map((r) => r.norm)).toEqual(["abandon"]);
  });

  it("备份时间记录与天数计算", async () => {
    expect(await repo.daysSinceBackup(new Date())).toBeNull();
    await repo.markBackupDone(at("2026-10-20T10:00:00+08:00"));
    expect(await repo.daysSinceBackup(at("2026-10-27T10:00:00+08:00"))).toBe(7);
  });

  it("updateWord 只改白名单字段", async () => {
    const p = await repo.planImport("abandon 放弃", new Date());
    await repo.commitImport(p, new Date());
    const w = await repo.getWordByNorm("abandon");
    await repo.updateWord(w!.id, { note: "词根 ban = 禁止" });
    expect((await repo.getWordByNorm("abandon"))!.note).toBe("词根 ban = 禁止");
  });
});

/**
 * 重新复习的取词：今天标过 Again 的词。
 *
 * 这里用真实 SQLite 跑，因为要验证的是**日键 + 边界小时的区间换算**
 * 在 SQL 里真的成立（epoch ms 比较），而不是一个能过的纯函数。
 */
describe("listMissedToday（重新复习取词）", () => {
  const day1 = "2026-11-01";
  const day2 = "2026-11-02";

  async function seed(): Promise<void> {
    const p = await repo.planImport("abandon 放弃\nabstract 抽象的\naccommodate 容纳", new Date());
    await repo.commitImport(p, at("2026-10-28T10:00:00+08:00"));
  }

  it("没有断错时返回空", async () => {
    await seed();
    expect(await repo.listMissedToday(day1)).toEqual([]);
  });

  it("只有标了 Again 的词进来，Good 的不进来", async () => {
    await seed();
    const a = await repo.getWordByNorm("abandon");
    const b = await repo.getWordByNorm("abstract");
    await repo.settleWord(a!.id, Rating.Again, at("2026-11-01T10:00:00+08:00"), null);
    await repo.settleWord(b!.id, Rating.Good, at("2026-11-01T10:00:00+08:00"), null);

    const missed = await repo.listMissedToday(day1);
    expect(missed.map((w) => w.norm)).toEqual(["abandon"]);
  });

  it("只认当天：昨天的 Again 不出现在今天", async () => {
    await seed();
    const a = await repo.getWordByNorm("abandon");
    await repo.settleWord(a!.id, Rating.Again, at("2026-11-01T10:00:00+08:00"), null);

    expect(await repo.listMissedToday(day2)).toEqual([]);
  });

  it("同一天 Again 多次只出现一次（EXISTS 不是 JOIN 笛卡尔积）", async () => {
    await seed();
    const a = await repo.getWordByNorm("abandon");
    await repo.settleWord(a!.id, Rating.Again, at("2026-11-01T10:00:00+08:00"), null);
    await repo.settleWord(a!.id, Rating.Again, at("2026-11-01T11:00:00+08:00"), null);
    await repo.settleWord(a!.id, Rating.Again, at("2026-11-01T12:00:00+08:00"), null);

    const missed = await repo.listMissedToday(day1);
    expect(missed).toHaveLength(1);
    expect(missed[0]?.norm).toBe("abandon");
  });

  it("边界小时生效：凌晨 2 点算前一天，不算今天", async () => {
    await seed();
    const a = await repo.getWordByNorm("abandon");
    // 11-02 凌晨 2 点，按 day_boundary_hour=4 属于 11-01
    await repo.settleWord(a!.id, Rating.Again, at("2026-11-02T02:00:00+08:00"), null);

    expect((await repo.listMissedToday(day1)).map((w) => w.norm)).toEqual(["abandon"]);
    expect(await repo.listMissedToday(day2)).toEqual([]);
  });

  it("边界之后：04:00 整算新的一天", async () => {
    await seed();
    const a = await repo.getWordByNorm("abandon");
    await repo.settleWord(a!.id, Rating.Again, at("2026-11-02T04:00:00+08:00"), null);

    expect(await repo.listMissedToday(day1)).toEqual([]);
    expect((await repo.listMissedToday(day2)).map((w) => w.norm)).toEqual(["abandon"]);
  });

  it("只读：查完不改变任何 FSRS 字段", async () => {
    await seed();
    const a = await repo.getWordByNorm("abandon");
    await repo.settleWord(a!.id, Rating.Again, at("2026-11-01T10:00:00+08:00"), null);
    const before = await repo.getWordByNorm("abandon");

    await repo.listMissedToday(day1);
    await repo.listMissedToday(day1);

    const after = await repo.getWordByNorm("abandon");
    expect(after?.fsrs_lapses).toBe(before?.fsrs_lapses);
    expect(after?.fsrs_reps).toBe(before?.fsrs_reps);
    expect(after?.fsrs_due_day).toBe(before?.fsrs_due_day);
    expect(after?.fsrs_stability).toBe(before?.fsrs_stability);
  });
});

/**
 * 「今日新词」的取词：今天录入的词。
 *
 * 和 listMissedToday 一样跑真实 SQLite —— 要验证的是 created_at 的 epoch 毫秒
 * 比较与边界小时的区间换算在 SQL 里真的成立，而不是一个能过的纯函数。
 */
describe("今日新词 listTodayNewWords", () => {
  const day1 = "2026-10-27";
  const day2 = "2026-10-28";

  function rawDb(): { select: <T>(sql: string) => Promise<T> } {
    return (repo as unknown as { db: { select: <T>(sql: string) => Promise<T> } }).db;
  }

  async function countLogs(): Promise<number> {
    const rows = await rawDb().select<Array<{ n: number }>>("SELECT COUNT(*) AS n FROM review_logs");
    return rows[0]?.n ?? 0;
  }

  /** 在指定时刻录入，created_at 就是那个时刻（commitImport 用 now 落 created_at）。 */
  async function seed(atIso: string, raw: string): Promise<void> {
    const p = await repo.planImport(raw, new Date(atIso));
    await repo.commitImport(p, new Date(atIso));
  }

  it("没有任何词时返回空数组", async () => {
    expect(await repo.listTodayNewWords(day1)).toEqual([]);
  });

  it("今天录入的取得到，昨天录入的取不到", async () => {
    await seed("2026-10-26T10:00:00+08:00", "abstract 抽象的");
    await seed("2026-10-27T10:00:00+08:00", "abandon 放弃");

    expect((await repo.listTodayNewWords(day1)).map((w) => w.norm)).toEqual(["abandon"]);
    expect((await repo.listTodayNewWords("2026-10-26")).map((w) => w.norm)).toEqual(["abstract"]);
  });

  /**
   * 断言方向是刻意的：02:00 < day_boundary_hour = 4，按 dayRange 落在**前一天**的区间里。
   * 契约说「按 day_boundary_hour 划界」，就必须和 listMissedToday 的边界用例
   * 走同一条时间轴 —— 否则两个「今天」会互相打架。
   */
  it("边界小时生效：凌晨 2 点录入的词算前一天", async () => {
    await seed("2026-10-28T02:00:00+08:00", "abandon 放弃");

    expect((await repo.listTodayNewWords(day1)).map((w) => w.norm)).toEqual(["abandon"]);
    expect(await repo.listTodayNewWords(day2)).toEqual([]);
  });

  it("边界之后：04:00 整算新的一天", async () => {
    await seed("2026-10-28T04:00:00+08:00", "abandon 放弃");

    expect(await repo.listTodayNewWords(day1)).toEqual([]);
    expect((await repo.listTodayNewWords(day2)).map((w) => w.norm)).toEqual(["abandon"]);
  });

  it("按录入时间正序返回", async () => {
    await seed("2026-10-27T09:00:00+08:00", "abandon 放弃");
    await seed("2026-10-27T11:00:00+08:00", "abstract 抽象的");

    expect((await repo.listTodayNewWords(day1)).map((w) => w.norm)).toEqual(["abandon", "abstract"]);
  });

  it("只读：查完 FSRS 字段与 review_logs 都不变", async () => {
    await seed("2026-10-27T10:00:00+08:00", "abandon 放弃");
    const before = await repo.getWordByNorm("abandon");
    const logsBefore = await countLogs();

    await repo.listTodayNewWords(day1);
    await repo.listTodayNewWords(day1);

    const after = await repo.getWordByNorm("abandon");
    expect(before).not.toBeNull();
    expect(after?.status).toBe(before?.status);
    expect(after?.fsrs_state).toBe(before?.fsrs_state);
    expect(after?.fsrs_due).toBe(before?.fsrs_due);
    expect(after?.fsrs_reps).toBe(before?.fsrs_reps);
    expect(after?.fsrs_lapses).toBe(before?.fsrs_lapses);
    expect(after?.fsrs_last_review).toBe(before?.fsrs_last_review);
    expect(await countLogs()).toBe(logsBefore);
  });
});
