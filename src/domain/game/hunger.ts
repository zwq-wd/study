/**
 * 游戏模式 · 饥饿状态机（纯函数）
 *
 * 全部转换都是 (state, 输入) → 新 state：
 *   - startGame  开局
 *   - tick       走过了一段时间（由 UI 的 rAF 提供 elapsedMs）
 *   - answer     答了一道题
 *   - eatBowl    肥鱼吃掉一碗（由 UI 在吃白饭动画开始时调用）
 *   - giveUp     主动结束
 *
 * v2 的「打饭机」口径：
 *   答对 1 个词 → 打饭机往碗里掉一串饭（serving.words +1）
 *   攒满 WORDS_PER_BOWL 个 → 这一碗打满，端到旁边排队（pending 末尾）
 *   只要场上有打满的碗、且饱食度没满 → 肥鱼就端一碗吃（served +1，饱食度 +20）
 *   饱食度满了 → 碗只摆着不吃（不能囤满挂机，但也不扣）
 *
 * 这里不读时钟、不读数据库、不碰 window —— 和 src/domain 其余部分同一条约束
 * （AGENTS.md 硬性约束 1）。所以整套饥饿逻辑可以在 vitest 里零时钟测试。
 */
import {
  BOWL_SATIETY,
  DIFFICULTY_PROFILES,
  MAX_PENDING_BOWLS,
  SATIETY_MAX,
  WORDS_PER_BOWL,
  drainPerSecond,
} from "./config.ts";
import type { Difficulty, GameState } from "./types.ts";

/** 开局：满格开始、打饭机上是一只空碗，永远不做死亡惩罚累加。 */
export function startGame(difficulty: Difficulty): GameState {
  return {
    phase: "playing",
    difficulty,
    satiety: SATIETY_MAX,
    graceMsLeft: 0,
    elapsedMs: 0,
    serving: { words: 0, id: 1 },
    pending: [],
    bowlsMade: 0,
    served: 0,
    correct: 0,
    wrong: 0,
    streak: 0,
    bestStreak: 0,
    lastVerdict: null,
    lastBowlDone: false,
    lastFill: 0,
  };
}

/**
 * 推进一段时间。
 *
 * 只有 playing / grace 会走时间；over 与 idle 原样返回。
 * playing 期间饱食度掉到 0 → 立刻转入 grace（宽限期），**不是**直接死。
 * grace 期间仍是「还能救」的状态：屏幕底部开始被咬缺口，吃一碗饭立刻回血。
 */
export function tick(state: GameState, elapsedMs: number): GameState {
  if (state.phase !== "playing" && state.phase !== "grace") return state;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return state;

  const drained = (drainPerSecond(state.difficulty) * elapsedMs) / 1000;
  const elapsed = state.elapsedMs + elapsedMs;

  if (state.phase === "playing") {
    const satiety = state.satiety - drained;
    if (satiety > 0) {
      return { ...state, satiety, elapsedMs: elapsed };
    }
    // 归零：进入宽限期，从满宽限开始倒数
    return {
      ...state,
      phase: "grace",
      satiety: 0,
      graceMsLeft: DIFFICULTY_PROFILES[state.difficulty].graceMs,
      elapsedMs: elapsed,
    };
  }

  // grace：宽限期倒数
  const graceMsLeft = state.graceMsLeft - elapsedMs;
  if (graceMsLeft > 0) {
    return { ...state, graceMsLeft, elapsedMs: elapsed };
  }
  return { ...state, phase: "over", graceMsLeft: 0, elapsedMs: elapsed };
}

/** 碗队列：最多只保留 MAX_PENDING_BOWLS 碗，多的直接算「已经吃掉了」。 */
function pushPending(pending: readonly number[], bowlId: number): number[] {
  const next = [...pending, bowlId];
  return next.length > MAX_PENDING_BOWLS ? next.slice(next.length - MAX_PENDING_BOWLS) : next;
}

/**
 * 端一碗去吃：扣掉队首、饱食度 +20（封顶 100）、served +1。
 *
 * 只在场上有打满的碗时才动。饱食度已经满了就**不吃**（原样返回），
 * 碗继续在台上摆着 —— 这是「不能囤满挂机」和「打好了不能白打」之间的折中：
 * 摆着不等于没做，等饿下来就能吃。
 */
export function eatBowl(state: GameState): GameState {
  if (state.pending.length === 0) return state;
  if (state.satiety >= SATIETY_MAX) return state;

  const before = state.satiety;
  const after = Math.min(SATIETY_MAX, before + BOWL_SATIETY);
  if (after <= before) return state;

  return {
    ...state,
    // 宽限期里吃到一碗 = 救回来了：退出 grace、回到正常计时。
    // 少了这一句，玩家明明吃到了却还在掉宽限期倒计时，照样被吃掉。
    phase: state.phase === "grace" ? "playing" : state.phase,
    graceMsLeft: state.phase === "grace" ? 0 : state.graceMsLeft,
    satiety: after,
    pending: state.pending.slice(1),
    served: state.served + 1,
  };
}

/**
 * 答了一道题。
 *
 * 答对：打饭机往碗里掉一串饭。攒满 5 个 → 这碗打满、端到旁边排队。
 *       饱食度不再由「答对」直接加，而是由「吃掉一碗」加 —— 进食归 eatBowl。
 *       **打满的碗不会当场被吃掉**：吃是有演出的（肥鱼要端碗、要吃白饭那段动画），
 *       由 UI 播完再调 eatBowl。这里只负责把碗打出来，不替 UI 决定吃没吃。
 * 答错：没饭。**不扣饱食度** —— 答错只是「没喂到」，再叠加惩罚会把挫败感翻倍。
 */
export function answer(state: GameState, correct: boolean): GameState {
  if (state.phase !== "playing" && state.phase !== "grace") return state;

  if (!correct) {
    return {
      ...state,
      wrong: state.wrong + 1,
      streak: 0,
      lastVerdict: "wrong",
      lastBowlDone: false,
      lastFill: state.serving.words,
    };
  }

  const streak = state.streak + 1;
  const filled = state.serving.words + 1;
  const bowlDone = filled >= WORDS_PER_BOWL;

  return {
    ...state,
    // 宽限期答对：立刻退出宽限、回到 playing（回血靠吃那碗饭，不靠答题）
    phase: "playing",
    graceMsLeft: 0,
    correct: state.correct + 1,
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    lastVerdict: "correct",
    lastBowlDone: bowlDone,
    lastFill: bowlDone ? WORDS_PER_BOWL : filled,
    serving: bowlDone
      ? { words: 0, id: state.serving.id + 1 }
      : { words: filled, id: state.serving.id },
    pending: bowlDone ? pushPending(state.pending, state.serving.id) : state.pending,
    bowlsMade: bowlDone ? state.bowlsMade + 1 : state.bowlsMade,
  };
}

/** 主动结束（用户点「不玩了」）。 */
export function giveUp(state: GameState): GameState {
  if (state.phase === "over") return state;
  return { ...state, phase: "over", graceMsLeft: 0 };
}

/** 饱食度 0..100 → 0..1，给进度条用。 */
export function satietyRatio(state: GameState): number {
  return Math.min(1, Math.max(0, state.satiety / SATIETY_MAX));
}

/** 本局存活时长的可读形式：M:SS。 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const ss = s < 10 ? "0" + String(s) : String(s);
  return String(m) + ":" + ss;
}