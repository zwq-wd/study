import { Rating, State, createEmptyCard } from "ts-fsrs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, normalizeConfig, type SchedulerConfig } from "../src/domain/scheduler/config.ts";
import { isGraduated, settle } from "../src/domain/scheduler/review.ts";
import { newWordCard } from "../src/domain/scheduler/newWord.ts";
import { toCard } from "../src/domain/scheduler/card.ts";
import type { WordRow } from "../src/data/types.ts";

const BASE = new Date(2026, 0, 1, 4, 0, 0, 0); // 2026-01-01 04:00 本地
const cfg: SchedulerConfig = { ...DEFAULT_CONFIG };

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

describe("newWordCard（§5.5 录入即计一次 Good）", () => {
  it("新词入库 → State.Review，due 是 4 天后", () => {
    const card = newWordCard(BASE, cfg);
    expect(card.state).toBe(State.Review);
    expect(card.scheduled_days).toBe(4);
    expect(card.reps).toBe(1);
  });

  it("不会停留在 Learning 状态（enable_short_term 已关）", () => {
    const card = newWordCard(BASE, cfg);
    expect(card.state).not.toBe(State.Learning);
    expect(card.state).not.toBe(State.New);
  });
});

describe("settle（§5.8 单卡结算）", () => {
  it("Review→Good 推进间隔", () => {
    const first = newWordCard(BASE, cfg);
    const at = first.due;
    const out = settle(first, Rating.Good, at, cfg);
    expect(out.card.state).toBe(State.Review);
    expect(out.card.reps).toBe(2);
    expect(out.card.scheduled_days).toBeGreaterThan(first.scheduled_days);
  });

  it("Review→Again 增加 lapses 且降低 stability", () => {
    const first = newWordCard(BASE, cfg);
    const out = settle(first, Rating.Again, first.due, cfg);
    expect(out.card.lapses).toBe(1);
    expect(out.card.stability).toBeLessThan(first.stability);
  });

  it("逾期复习：FSRS 按实际经过天数重算（R 低 → 稳定度涨幅大 → 间隔更长）", () => {
    // 注意：开发文档 §5.4 写的是「逾期后 Good 的间隔应短于按时 Good」，
    // 实测 ts-fsrs 5.4.2 的行为相反 —— FSRS-6 的 next_recall_stability 里
    // e^(w10·(1−R)) − 1 在 R 低时更大，所以「隔久了还记得」会给出更长的间隔。
    // 这里按库的真实行为断言，并在 README 的风险登记里记下这条偏差。
    const wide = { ...cfg, maximumInterval: 3650 }; // 放开上限，避免都被夹到 50
    const card = newWordCard(BASE, wide);
    const onTime = settle(card, Rating.Good, card.due, wide);
    const late = settle(card, Rating.Good, addDays(card.due, 30), wide);
    expect(late.card.stability).toBeGreaterThan(onTime.card.stability);
    expect(late.card.scheduled_days).toBeGreaterThan(onTime.card.scheduled_days);
  });

  it("间隔被 maximum_interval 夹住（ts-fsrs 会多算 1 天，应用层兜回）", () => {
    let card = newWordCard(BASE, cfg);
    let now = card.due;
    for (let i = 0; i < 8; i++) {
      card = settle(card, Rating.Good, now, cfg).card;
      now = card.due;
      expect(card.scheduled_days).toBeLessThanOrEqual(cfg.maximumInterval);
    }
  });

  it("不改动传入的 card（ts-fsrs 是不可变的）", () => {
    const card = newWordCard(BASE, cfg);
    const before = JSON.stringify(card);
    settle(card, Rating.Good, card.due, cfg);
    expect(JSON.stringify(card)).toBe(before);
  });

  it("系统时间回拨：now < last_review 时标记 clockBack 且不判毕业", () => {
    const card = newWordCard(BASE, cfg);
    const back = new Date(BASE.getTime() - 86_400_000);
    const out = settle(card, Rating.Good, back, cfg);
    expect(out.clockBack).toBe(true);
    expect(out.graduated).toBe(false);
  });

  it("日志带回状态迁移信息", () => {
    const card = newWordCard(BASE, cfg);
    const out = settle(card, Rating.Good, card.due, cfg);
    expect(out.log.rating).toBe(Rating.Good);
    expect(out.log.state).toBe(State.Review);
    expect(typeof out.log.due).toBe("number");
    expect(out.log.stability).toBeGreaterThan(0);
  });
});

describe("毕业判定（§5.6）", () => {
  const reviewCard = (over: { scheduled_days: number; reps: number; lapses?: number }) => ({
    ...createEmptyCard(BASE),
    state: State.Review,
    stability: 100,
    difficulty: 5,
    scheduled_days: over.scheduled_days,
    reps: over.reps,
    lapses: over.lapses ?? 0,
    due: BASE,
  });

  it("间隔够长但复习次数不够 → 不毕业（防止上限一夹就毕业）", () => {
    expect(isGraduated(reviewCard({ scheduled_days: 90, reps: 2 }), cfg)).toBe(false);
  });

  it("复习次数够但间隔不够 → 不毕业", () => {
    expect(isGraduated(reviewCard({ scheduled_days: 50, reps: 6 }), cfg)).toBe(false);
  });

  it("两个条件都满足 → 毕业", () => {
    expect(isGraduated(reviewCard({ scheduled_days: 90, reps: 4 }), cfg)).toBe(true);
  });

  it("lapses 达阈值 → 强制毕业", () => {
    expect(isGraduated(reviewCard({ scheduled_days: 5, reps: 2, lapses: 6 }), cfg)).toBe(true);
  });

  it("非 Review 状态不毕业", () => {
    const card = { ...reviewCard({ scheduled_days: 90, reps: 4 }), state: State.New };
    expect(isGraduated(card, cfg)).toBe(false);
  });

  it("备考期默认参数下，maxInterval=50 < graduateInterval=90，自然毕业永不触发", () => {
    // 模拟连续 Good 直到顶到上限
    let card = newWordCard(BASE, cfg);
    let now = card.due;
    for (let i = 0; i < 6; i++) {
      card = settle(card, Rating.Good, now, cfg).card;
      now = card.due;
      expect(card.scheduled_days).toBeLessThanOrEqual(cfg.maximumInterval);
      expect(isGraduated(card, cfg)).toBe(false);
    }
  });
});

describe("toCard（§5.8 行 ↔ Card）", () => {
  const baseRow: WordRow = {
    id: 1,
    headword: "abandon",
    norm: "abandon",
    phonetic: null,
    source: null,
    note: null,
    example_json: null,
    status: "learning",
    fsrs_state: 2,
    fsrs_due: BASE.getTime(),
    fsrs_due_day: "2026-01-01",
    fsrs_stability: 10,
    fsrs_difficulty: 5,
    fsrs_reps: 3,
    fsrs_lapses: 1,
    fsrs_scheduled_days: 10,
    fsrs_last_review: BASE.getTime(),
    created_at: 0,
    updated_at: 0,
  };

  it("字段一一对应", () => {
    const card = toCard(baseRow, BASE);
    expect(card.state).toBe(State.Review);
    expect(card.stability).toBe(10);
    expect(card.reps).toBe(3);
    expect(card.lapses).toBe(1);
    expect(card.scheduled_days).toBe(10);
  });

  it("elapsed_days 与 learning_steps 传 0（deprecated，由库自己算）", () => {
    const card = toCard(baseRow, BASE);
    expect(card.elapsed_days).toBe(0);
    expect(card.learning_steps).toBe(0);
  });

  it("损坏数据兜底：Review 但 stability=0 → 当作新卡", () => {
    const broken = { ...baseRow, fsrs_stability: 0 };
    expect(toCard(broken, BASE).state).toBe(State.New);
  });

  it("没有 last_review 时不瞎编一个", () => {
    const noReview = { ...baseRow, fsrs_last_review: null };
    expect(toCard(noReview, BASE).last_review).toBeUndefined();
  });
});

describe("normalizeConfig", () => {
  it("空输入 → 全部默认值", () => {
    expect(normalizeConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it("越界值夹到边界", () => {
    expect(normalizeConfig({ sessionLimit: 10 }).sessionLimit).toBe(60);
    expect(normalizeConfig({ sessionLimit: 9999 }).sessionLimit).toBe(300);
    expect(normalizeConfig({ requestRetention: 0.5 }).requestRetention).toBe(0.8);
  });

  it("保留率允许小数，其余取整", () => {
    expect(normalizeConfig({ requestRetention: 0.88 }).requestRetention).toBe(0.88);
    expect(normalizeConfig({ sessionLimit: 100.7 }).sessionLimit).toBe(101);
  });

  it("字符串数字也能收（从数据库/导入 JSON 来的）", () => {
    expect(normalizeConfig({ sessionLimit: "120" }).sessionLimit).toBe(120);
    expect(normalizeConfig({ enableAgainButton: "true" }).enableAgainButton).toBe(true);
  });

  it("非法值回落默认", () => {
    expect(normalizeConfig({ sessionLimit: "abc" }).sessionLimit).toBe(DEFAULT_CONFIG.sessionLimit);
  });
});
