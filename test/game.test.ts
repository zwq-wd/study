import { describe, expect, it } from "vitest";
import type { SenseRow, WordRow } from "../src/data/types.ts";
import {
  BOWL_SATIETY,
  DIFFICULTY_PROFILES,
  MAX_PENDING_BOWLS,
  NO_REPEAT_WINDOW,
  SATIETY_MAX,
  SATIETY_PER_SLOT,
  WORDS_PER_BOWL,
  drainPerSecond,
} from "../src/domain/game/config.ts";
import {
  answer,
  eatBowl,
  giveUp,
  formatDuration,
  satietyRatio,
  startGame,
  tick,
} from "../src/domain/game/hunger.ts";
import { bowlProgressLine, pickLine } from "../src/domain/game/lines.ts";
import { buildGamePool, toPoolEntry } from "../src/domain/game/pool.ts";
import {
  buildQuestion,
  headwordsTooSimilar,
  meaningsTooSimilar,
  nextEntry,
  type BuildQuestionInput,
} from "../src/domain/game/quiz.ts";
import type { DistractorCandidate, GameQuestion, GameState, QuizPoolEntry } from "../src/domain/game/types.ts";

// ---------------------------------------------------------------------------
// 手写工厂：只填被测函数真正读的字段。
// 这里追求的是「读测试的人一眼看出这条用例关心的数据是什么」，
// 而不是把整张表铺开 —— 与 todayWords.test.ts 的 row() 同一取舍。
// ---------------------------------------------------------------------------

function row(id: number, headword: string): WordRow {
  return {
    id,
    headword,
    norm: headword.toLowerCase(),
    phonetic: null,
    source: null,
    note: null,
    example_json: null,
    status: "learning",
    fsrs_state: 2,
    fsrs_due: 0,
    fsrs_due_day: "2026-11-15",
    fsrs_stability: 0.66,
    fsrs_difficulty: 5,
    fsrs_reps: 2,
    fsrs_lapses: 0,
    fsrs_scheduled_days: 1,
    fsrs_last_review: null,
    created_at: 0,
    updated_at: 0,
  };
}

function sense(id: number, meaning: string, layer: number, sort: number): SenseRow {
  return { id, word_id: 1, meaning_cn: meaning, layer, origin: "manual", sort, created_at: 0 };
}

/** 词条 + 义项。buildGamePool 只看 id / headword 与 L1 释义。 */
type WordWithSenses = WordRow & { senses?: readonly SenseRow[] };

function word(id: number, headword: string, meanings: readonly string[]): WordWithSenses {
  return { ...row(id, headword), senses: meanings.map((m, i) => sense(id * 100 + i, m, 1, i)) };
}

const entryOf = (wordId: number, headword: string, meaning: string): QuizPoolEntry => ({
  wordId,
  headword,
  meanings: [meaning],
});

const cand = (wordId: number, headword: string, meaningCn: string): DistractorCandidate => ({
  wordId,
  headword,
  meaningCn,
});

const idsOf = (entries: readonly QuizPoolEntry[]): number[] => entries.map((e) => e.wordId);
const sortedIds = (entries: readonly QuizPoolEntry[]): number[] => [...idsOf(entries)].sort((a, b) => a - b);

/** 永远返回 0 的 rng：洗牌退化成「确定性的重排」，便于断言「选谁不受随机影响」。 */
const zeroRng = (): number => 0;

/** 给定序列的 rng：精确控制第几次抽到哪个候选，出题用例靠它复现。 */
function seqRng(values: readonly number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i += 1;
    return v ?? 0;
  };
}

/**
 * 饱食度是浮点累减出来的（1.666.../秒），比较一律留 1e-6 余量。
 * 产品要的是「12 秒掉一格」，不是某一帧的二进制尾数。
 */
const EPS = 1e-6;
function expectSatiety(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThan(EPS);
}

/** buildQuestion 的成功分支：把 null 收窄掉，后面的断言不必写一堆 ?. */
function expectQuestion(input: BuildQuestionInput): GameQuestion {
  const q = buildQuestion(input);
  if (q === null) throw new Error("buildQuestion 返回 null —— 这个候选池本该凑得出 4 个选项");
  return q;
}

/** 连打 n 勺（每题答对），返回最终状态。 */
function fillBowls(state: GameState, scoops: number): GameState {
  let s = state;
  for (let i = 0; i < scoops; i++) s = answer(s, true);
  return s;
}

describe("startGame：开局满格，永远不做死亡惩罚累加", () => {
  it("满食 100 / phase playing / 计数全 0 / 打饭机上是空碗", () => {
    const s = startGame("normal");
    expect(s.satiety).toBe(SATIETY_MAX);
    expect(s.satiety).toBe(100);
    expect(s.phase).toBe("playing");
    expect(s.graceMsLeft).toBe(0);
    expect(s.elapsedMs).toBe(0);
    expect(s.serving.words).toBe(0);
    expect(s.pending).toEqual([]);
    expect(s.bowlsMade).toBe(0);
    expect(s.served).toBe(0);
    expect(s.correct).toBe(0);
    expect(s.wrong).toBe(0);
    expect(s.streak).toBe(0);
    expect(s.bestStreak).toBe(0);
    expect(s.lastVerdict).toBeNull();
    expect(s.lastBowlDone).toBe(false);
    expect(s.lastFill).toBe(0);
  });

  it("三档开局一模一样，只有 difficulty 不同（难度只改饿的速度）", () => {
    for (const d of ["easy", "normal", "hard"] as const) {
      const s = startGame(d);
      expect(s.difficulty).toBe(d);
      expect(s.satiety).toBe(100);
    }
  });
});

describe("tick 掉速：一格 = 20 点，三档只差在「一格多少秒」", () => {
  it("易档：喂 12000ms 掉一格（100 → 80），误差 < 1e-6", () => {
    const s = tick(startGame("easy"), 12_000);
    expectSatiety(s.satiety, 80);
    expect(s.phase).toBe("playing");
    expect(s.elapsedMs).toBe(12_000);
  });

  it("中档：喂 8000ms 掉一格（100 → 80），误差 < 1e-6", () => {
    const s = tick(startGame("normal"), 8_000);
    expectSatiety(s.satiety, 80);
    expect(s.phase).toBe("playing");
  });

  it("难档：喂 5000ms 掉一格（100 → 80），误差 < 1e-6", () => {
    const s = tick(startGame("hard"), 5_000);
    expectSatiety(s.satiety, 80);
    expect(s.phase).toBe("playing");
  });

  it("掉速与常量自洽：drainPerSecond = 每格点数 / 每格秒数", () => {
    for (const d of ["easy", "normal", "hard"] as const) {
      expect(drainPerSecond(d)).toBeCloseTo(
        SATIETY_PER_SLOT / (DIFFICULTY_PROFILES[d].msPerSlot / 1000),
        12,
      );
    }
  });

  it("是连续掉，不是每格一跳（半格 = 10 点）", () => {
    expectSatiety(tick(startGame("easy"), 6_000).satiety, 90);
    expectSatiety(tick(startGame("normal"), 4_000).satiety, 90);
    expectSatiety(tick(startGame("hard"), 2_500).satiety, 90);
  });

  it("按 rAF 的节奏分帧喂，结果与一次喂完一致（累加不能漂）", () => {
    let s = startGame("easy");
    for (let i = 0; i < 120; i++) s = tick(s, 100);
    expectSatiety(s.satiety, 80);
    expect(s.elapsedMs).toBe(12_000);
  });

  it("tick 不改动入参 state（每次转换返回新对象）", () => {
    const s = startGame("normal");
    const snapshot = { ...s, serving: { ...s.serving } };
    tick(s, 8_000);
    expect(s).toEqual(snapshot);
  });
});

describe("tick 归零：先进宽限期（还能救），不是直接 over", () => {
  it("易档：60s 见底 → grace，宽限期正好 12s", () => {
    const s = tick(startGame("easy"), 60_000);
    expect(s.satiety).toBe(0);
    expect(s.phase).toBe("grace");
    expect(s.graceMsLeft).toBe(DIFFICULTY_PROFILES.easy.graceMs);
  });

  it("中档：40s 见底 → grace（10s）", () => {
    const s = tick(startGame("normal"), 40_000);
    expect(s.phase).toBe("grace");
    expect(s.graceMsLeft).toBe(10_000);
  });

  it("难档：25s 见底 → grace（8s）", () => {
    const s = tick(startGame("hard"), 25_000);
    expect(s.phase).toBe("grace");
    expect(s.graceMsLeft).toBe(8_000);
  });

  it("饿过头也不会出现负饱食度", () => {
    const s = tick(startGame("hard"), 60_000);
    expect(s.satiety).toBe(0);
  });

  it("grace 期间饱食度钉在 0，不继续往下掉", () => {
    const grace = tick(startGame("normal"), 40_000);
    const later = tick(grace, 3_000);
    expect(later.phase).toBe("grace");
    expect(later.satiety).toBe(0);
  });
});

describe("tick 宽限期倒数完 → over", () => {
  it("差 1ms 还在 grace，再喂 1ms 才 over", () => {
    const grace = tick(startGame("easy"), 60_000);
    const almostDead = tick(grace, 11_999);
    expect(almostDead.phase).toBe("grace");
    const over = tick(almostDead, 1);
    expect(over.phase).toBe("over");
    expect(over.graceMsLeft).toBe(0);
  });

  it("一次喂超过宽限期也只 over 一次，存活时长照样记账", () => {
    const over = tick(tick(startGame("hard"), 25_000), 99_999);
    expect(over.phase).toBe("over");
    expect(over.elapsedMs).toBe(25_000 + 99_999);
  });
});

// ---------------------------------------------------------------------------
// 打饭机：5 个词 = 1 碗
// ---------------------------------------------------------------------------

describe("打饭机：答对一勺，五勺一碗", () => {
  it("WORDS_PER_BOWL = 5，一碗正好一格饱食度", () => {
    expect(WORDS_PER_BOWL).toBe(5);
    expect(BOWL_SATIETY).toBe(SATIETY_PER_SLOT);
  });

  it("答对 1..4 勺：碗里累加，饱食度不动、不出碗", () => {
    let s = startGame("normal");
    for (let n = 1; n <= 4; n++) {
      s = answer(s, true);
      expect(s.serving.words).toBe(n);
      expect(s.lastFill).toBe(n);
      expect(s.pending).toEqual([]);
      expect(s.served).toBe(0);
      expect(s.satiety).toBe(100);
    }
  });

  it("第 5 勺：打满一碗，碗端到台上排队，名额清零并换新碗", () => {
    const s = fillBowls(startGame("normal"), 5);
    expect(s.bowlsMade).toBe(1);
    expect(s.pending).toHaveLength(1);
    expect(s.serving.words).toBe(0);
    expect(s.serving.id).toBe(2);
    expect(s.lastBowlDone).toBe(true);
    expect(s.lastFill).toBe(WORDS_PER_BOWL);
  });

  it("答错不推进饭量、不出碗，只记错", () => {
    const before = fillBowls(startGame("normal"), 3);
    const after = answer({ ...before, satiety: 50 }, false);
    expect(after.serving.words).toBe(3);
    expect(after.pending).toEqual([]);
    expect(after.wrong).toBe(1);
    expect(after.streak).toBe(0);
    expect(after.lastBowlDone).toBe(false);
    // 答错不扣血（刻意设计）
    expect(after.satiety).toBe(50);
  });

  it("饱食度满了也照样能打碗：碗先摆在台上，等饿了再吃", () => {
    const s = fillBowls(startGame("normal"), 10); // 两碗
    expect(s.bowlsMade).toBe(2);
    expect(s.pending).toHaveLength(2);
    expect(s.served).toBe(0);
    // 饿了就能端走一碗
    const eaten = eatBowl({ ...s, satiety: 40 });
    expect(eaten.served).toBe(1);
    expect(eaten.satiety).toBe(60);
  });
});

describe("eatBowl：端一碗吃，+20 饱食度、served+1", () => {
  it("饿了就能吃：扣掉队首、回 20 点", () => {
    const made = fillBowls(startGame("normal"), 5);
    const hungry: GameState = { ...made, satiety: 40 };
    const eaten = eatBowl(hungry);
    expect(eaten.served).toBe(1);
    expect(eaten.satiety).toBe(60);
    expect(eaten.pending).toHaveLength(0);
  });

  it("吃满就吃不下了：饱食度 100 时 eatBowl 原样返回", () => {
    const made = fillBowls(startGame("normal"), 5);
    expect(made.satiety).toBe(100);
    expect(eatBowl(made)).toEqual(made);
  });

  it("没碗时 eatBowl 是空操作", () => {
    const s = startGame("normal");
    expect(eatBowl(s)).toEqual(s);
  });

  it("封顶 100：90 吃一碗只到 100", () => {
    const made = fillBowls(startGame("normal"), 5);
    const eaten = eatBowl({ ...made, satiety: 90 });
    expect(eaten.satiety).toBe(100);
  });

  it("宽限期吃一碗能救回来：退出 grace、回到 playing（光回血不回 playing 会被倒计时吃掉）", () => {
    const grace = tick(startGame("hard"), 25_000);
    expect(grace.phase).toBe("grace");
    const withBowl: GameState = { ...grace, pending: [1] };
    const eaten = eatBowl(withBowl);
    expect(eaten.satiety).toBe(20);
    expect(eaten.served).toBe(1);
    expect(eaten.pending).toHaveLength(0);
    // 关键：必须真的脱离宽限期，否则宽限期照常倒数、照样 over
    expect(eaten.phase).toBe("playing");
    expect(eaten.graceMsLeft).toBe(0);
    // 救回来之后走的是正常计时：掉到 0 才会再进 grace
    const later = tick(eaten, 3_000);
    expect(later.phase).toBe("playing");
    expect(later.satiety).toBeGreaterThan(0);
  });
});

describe("打满的碗不会在 answer 里被偷偷吃掉", () => {
  // 吃是有演出的（肥鱼端碗、吃白饭那段动画），必须由 UI 播完再调 eatBowl。
  // 如果 answer 顺手吃掉，UI 再调一次 eatBowl 就会一碗吃两次 —— 这条锁住它。
  it("第 5 勺只把碗打上台面，served 不动、饱食度不动", () => {
    let s = fillBowls(startGame("normal"), 4);
    s = { ...s, satiety: 40 };
    s = answer(s, true);
    expect(s.bowlsMade).toBe(1);
    expect(s.pending).toHaveLength(1);
    expect(s.served).toBe(0);
    expect(s.satiety).toBe(40);
  });

  it("打满之后由 UI 调 eatBowl 才真的吃到", () => {
    let s = fillBowls(startGame("normal"), 4);
    s = { ...s, satiety: 40 };
    s = answer(s, true);
    const eaten = eatBowl(s);
    expect(eaten.served).toBe(1);
    expect(eaten.satiety).toBe(60);
    expect(eaten.pending).toHaveLength(0);
  });

  it("连打两碗：两碗都在台面上排队，等 UI 一碗一碗吃", () => {
    let s = fillBowls(startGame("normal"), 10);
    expect(s.bowlsMade).toBe(2);
    expect(s.pending).toHaveLength(2);
    expect(s.served).toBe(0);
  });
});

describe("碗队列上限：MAX_PENDING_BOWLS", () => {
  it("超过上限时丢最早的，只保留最近几碗", () => {
    const limit = MAX_PENDING_BOWLS;
    let s = startGame("normal");
    s = fillBowls(s, WORDS_PER_BOWL * (limit + 2));
    expect(s.pending.length).toBeLessThanOrEqual(limit);
    expect(s.bowlsMade).toBe(limit + 2);
  });
});

describe("bestStreak：记录历史最高，不随 streak 归零回落", () => {
  it("连对 3 → 错 1 → 再连对 2，bestStreak 仍是 3", () => {
    let s = startGame("normal");
    s = fillBowls(s, 3);
    expect(s.streak).toBe(3);
    s = answer(s, false);
    expect(s.streak).toBe(0);
    expect(s.bestStreak).toBe(3);
    s = fillBowls(s, 2);
    expect(s.streak).toBe(2);
    expect(s.bestStreak).toBe(3);
    expect(s.correct).toBe(5);
    expect(s.wrong).toBe(1);
  });
});

describe("tick 的非法输入与终局：不推进、不伤害", () => {
  it("0 / 负数 / NaN / Infinity → 状态原样返回", () => {
    const s = tick(startGame("normal"), 8_000);
    expect(tick(s, 0)).toEqual(s);
    expect(tick(s, -1_000)).toEqual(s);
    expect(tick(s, Number.NaN)).toEqual(s);
    expect(tick(s, Number.POSITIVE_INFINITY)).toEqual(s);
  });

  it("over 之后 tick 不再推进（结算页的时间要冻结）", () => {
    const over = tick(tick(startGame("hard"), 25_000), 8_000);
    expect(over.phase).toBe("over");
    expect(tick(over, 5_000)).toEqual(over);
  });

  it("over 之后 answer 也不再改判", () => {
    const over = tick(tick(startGame("hard"), 25_000), 8_000);
    expect(answer(over, true)).toEqual(over);
  });

  it("giveUp 把它直接变成 over，且不再走时间", () => {
    const s = giveUp(startGame("normal"));
    expect(s.phase).toBe("over");
    expect(tick(s, 5_000)).toEqual(s);
    expect(giveUp(s)).toEqual(s);
  });

  it("satietyRatio 钳在 0..1，formatDuration 是 M:SS", () => {
    expect(satietyRatio({ ...startGame("normal"), satiety: 50 })).toBeCloseTo(0.5, 9);
    expect(satietyRatio({ ...startGame("normal"), satiety: -10 })).toBe(0);
    expect(satietyRatio({ ...startGame("normal"), satiety: 200 })).toBe(1);
    expect(formatDuration(75_000)).toBe("1:15");
    expect(formatDuration(0)).toBe("0:00");
  });
});

// ---------------------------------------------------------------------------
// 台词挑选（新加的纯函数）
// ---------------------------------------------------------------------------

describe("pickLine：优先挑没说过的那句", () => {
  const lines = ["a", "b", "c"];

  it("recent 为空时能挑到第一句（rng=0）", () => {
    const p = pickLine(lines, [], zeroRng, 4);
    expect(p.text).toBe("a");
    expect(p.recent).toContain(0);
  });

  it("已经说过的不再挑：窗口内只剩没说的", () => {
    for (let i = 0; i < 3; i++) {
      const p = pickLine(lines, [0, 1], () => i / 3, 4);
      expect(p.text).toBe("c");
    }
  });

  it("全说过 → 退回全集，不返回空串", () => {
    const p = pickLine(lines, [0, 1, 2], zeroRng, 4);
    expect(p.text).toBe("a");
  });

  it("窗口只保留最后 window 条", () => {
    const p = pickLine(lines, [], zeroRng, 2);
    expect(p.recent.length).toBeLessThanOrEqual(2);
  });

  it("空台词组 → 空串（调用方据此不显示气泡）", () => {
    expect(pickLine([], [0], zeroRng).text).toBe("");
  });
});

describe("bowlProgressLine：按这一碗装到第几勺报进度", () => {
  const lines = ["1/5", "2/5", "3/5", "4/5"];

  it("第 1..4 勺各说各的", () => {
    expect(bowlProgressLine(lines, 1)).toBe("1/5");
    expect(bowlProgressLine(lines, 2)).toBe("2/5");
    expect(bowlProgressLine(lines, 3)).toBe("3/5");
    expect(bowlProgressLine(lines, 4)).toBe("4/5");
  });

  it("越界会钳住，不返回 undefined", () => {
    expect(bowlProgressLine(lines, 0)).toBe("1/5");
    expect(bowlProgressLine(lines, 99)).toBe("4/5");
    expect(bowlProgressLine([], 3)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 以下为 v1 起就有的出题 / 池子逻辑，未受「打饭机」改版影响
// ---------------------------------------------------------------------------

describe("buildGamePool：错词 ∪ 新词，去重后洗牌", () => {
  it("同一个 wordId 只出现一次，且保留错词那一份", () => {
    const missed = [word(7, "abandon", ["放弃"])];
    const fresh = [word(7, "ABANDON-DUP", ["丢弃"]), word(8, "ability", ["能力"])];

    const pool = buildGamePool(missed, fresh, 0, zeroRng);

    expect(idsOf(pool.entries).filter((id) => id === 7)).toEqual([7]);
    const kept = pool.entries.find((e) => e.wordId === 7);
    expect(kept?.headword).toBe("abandon");
    expect(pool.fromMissed).toBe(1);
    expect(pool.fromNew).toBe(1);
  });

  it("没有 L1 释义的词被丢掉", () => {
    const l2Only: WordWithSenses = { ...row(1, "abandon"), senses: [sense(11, "放弃", 2, 0)] };
    const noSenses: WordWithSenses = { ...row(2, "ability") };
    const blankL1: WordWithSenses = { ...row(3, "calf"), senses: [sense(31, "   ", 1, 0)] };
    const ok = word(4, "desert", ["沙漠"]);

    const pool = buildGamePool([l2Only, noSenses, blankL1], [ok], 0, zeroRng);

    expect(idsOf(pool.entries)).toEqual([4]);
    expect(pool.fromMissed).toBe(0);
    expect(pool.fromNew).toBe(1);
  });

  it("L1 有多条义项时只取 sort 最小的那条", () => {
    const w: WordWithSenses = {
      ...row(5, "firm"),
      senses: [sense(51, "结实的", 1, 9), sense(50, "公司", 1, 1), sense(52, "L2 补充", 2, 0)],
    };
    const e = toPoolEntry(w);
    expect(e?.meanings).toEqual(["公司"]);
    expect(toPoolEntry({ ...row(6, "ghost") })).toBeNull();
  });

  it("limit 生效：只取前 limit 个", () => {
    const missed = Array.from({ length: 5 }, (_, i) => word(i + 1, "w" + String(i + 1), ["义" + String(i + 1)]));
    const pool = buildGamePool(missed, [], 3, zeroRng);
    expect(pool.entries).toHaveLength(3);
    expect(sortedIds(pool.entries)).toEqual([1, 2, 3]);
  });

  it("limit = 0 / 负数 / NaN 当作不设上限", () => {
    const missed = Array.from({ length: 5 }, (_, i) => word(i + 1, "w" + String(i + 1), ["义" + String(i + 1)]));
    expect(buildGamePool(missed, [], 0, zeroRng).entries).toHaveLength(5);
    expect(buildGamePool(missed, [], -3, zeroRng).entries).toHaveLength(5);
    expect(buildGamePool(missed, [], Number.NaN, zeroRng).entries).toHaveLength(5);
  });

  it("rng 固定时顺序完全可复现，且确实洗过", () => {
    const missed = Array.from({ length: 4 }, (_, i) => word(i + 1, "w" + String(i + 1), ["义" + String(i + 1)]));
    const a = buildGamePool(missed, [], 0, zeroRng);
    const b = buildGamePool(missed, [], 0, zeroRng);
    expect(idsOf(a.entries)).toEqual(idsOf(b.entries));
    expect(idsOf(a.entries)).not.toEqual([1, 2, 3, 4]);
    expect(sortedIds(a.entries)).toEqual([1, 2, 3, 4]);
  });

  it("空输入 → 空池子", () => {
    const pool = buildGamePool([], [], 10, zeroRng);
    expect(pool.entries).toEqual([]);
    expect(pool.fromMissed).toBe(0);
    expect(pool.fromNew).toBe(0);
  });
});

describe("nextEntry：顺序游标 + 最近几题不重复，走到末尾循环回 0", () => {
  const pool: QuizPoolEntry[] = [1, 2, 3, 4, 5, 6].map((id) => entryOf(id, "w" + String(id), "义" + String(id)));

  it("最近出过的词会被跳过（窗口 = 3）", () => {
    expect(NO_REPEAT_WINDOW).toBe(3);
    const r = nextEntry(pool, 2, [3, 4, 5]);
    expect(r.entry?.wordId).toBe(6);
    expect(r.cursor).toBe(0);
  });

  it("窗口只算最近 3 题", () => {
    const r = nextEntry(pool, 0, [1, 2, 3, 4]);
    expect(r.entry?.wordId).toBe(1);
    expect(r.cursor).toBe(1);
  });

  it("池子只有 1 个词：退化但不崩", () => {
    const single = [entryOf(9, "solo", "独自")];
    const r = nextEntry(single, 0, []);
    expect(r.entry?.wordId).toBe(9);
    const forced = nextEntry(single, 0, [9]);
    expect(forced.entry?.wordId).toBe(9);
  });

  it("空池子 → null", () => {
    expect(nextEntry([], 3, [1, 2])).toEqual({ entry: null, cursor: 0 });
  });
});

describe("meaningsTooSimilar / headwordsTooSimilar：防「两个正确答案」的闸门", () => {
  it("「放弃」vs「抛弃」只共享 1 个「弃」→ false", () => {
    expect(meaningsTooSimilar("放弃", "抛弃")).toBe(false);
  });

  it("包含关系 → true", () => {
    expect(meaningsTooSimilar("放弃", "放弃；抛弃")).toBe(true);
    expect(meaningsTooSimilar("放弃；抛弃", "放弃")).toBe(true);
  });

  it("共享 >= 2 个连续汉字 → true", () => {
    expect(meaningsTooSimilar("放弃", "放弃希望")).toBe(true);
  });

  it("毫不相干 / 空串 → false", () => {
    expect(meaningsTooSimilar("苹果", "天空")).toBe(false);
    expect(meaningsTooSimilar("", "放弃")).toBe(false);
  });

  it("abandon vs abandoned → true；abandon vs ability → false", () => {
    expect(headwordsTooSimilar("abandon", "abandoned")).toBe(true);
    expect(headwordsTooSimilar("abandon", "ability")).toBe(false);
    expect(headwordsTooSimilar("apple", "app")).toBe(false);
  });
});

describe("buildQuestion：四选一、恰好一个正确答案；凑不齐就返回 null", () => {
  const abandon = entryOf(1, "abandon", "放弃");
  const candidates: DistractorCandidate[] = [
    cand(2, "apple", "苹果"),
    cand(3, "banana", "香蕉"),
    cand(4, "sky", "天空"),
    cand(5, "river", "河流"),
  ];
  const fourPicks = (): (() => number) => seqRng([0.1, 0.35, 0.65, 0.9]);

  it("英→中：题面是 headword，选项是中文释义", () => {
    const q = expectQuestion({ entry: abandon, candidates, direction: "en2cn", rng: fourPicks() });
    expect(q.prompt).toBe("abandon");
    expect(q.options).toHaveLength(4);
    expect(q.options.filter((o) => o.correct)).toHaveLength(1);
    expect(q.options[q.correctIndex]?.text).toBe("放弃");
  });

  it("中→英：题面是中文释义，不是 headword", () => {
    const q = expectQuestion({ entry: abandon, candidates, direction: "cn2en", rng: fourPicks() });
    expect(q.prompt).toBe("放弃");
    expect(q.prompt).not.toBe(q.options[q.correctIndex]?.text);
    expect(q.options[q.correctIndex]?.text).toBe("abandon");
  });

  it("同一个词条自己的释义不会变成干扰项", () => {
    const selfFirst: DistractorCandidate[] = [
      cand(1, "abandon", "丢弃"),
      cand(2, "apple", "苹果"),
      cand(3, "banana", "香蕉"),
      cand(5, "river", "河流"),
    ];
    const q = expectQuestion({ entry: abandon, candidates: selfFirst, direction: "en2cn", rng: fourPicks() });
    expect(q.options.map((o) => o.text)).not.toContain("丢弃");
  });

  it("候选池全是同义释义 → null", () => {
    const synonyms: DistractorCandidate[] = [
      cand(2, "abandon-syn", "放弃；抛弃"),
      cand(3, "desert", "放弃希望"),
      cand(4, "quit", "放弃掉"),
      cand(5, "giveup", "放弃"),
    ];
    expect(buildQuestion({ entry: abandon, candidates: synonyms, direction: "en2cn", rng: fourPicks() })).toBeNull();
  });

  it("空候选池 / 正确项文本为空 → null（不崩）", () => {
    expect(buildQuestion({ entry: abandon, candidates: [], direction: "en2cn" })).toBeNull();
    expect(buildQuestion({ entry: entryOf(1, "abandon", ""), candidates, direction: "en2cn", rng: zeroRng })).toBeNull();
  });
});