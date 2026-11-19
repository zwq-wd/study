/**
 * 游戏模式 · 领域类型（冻结契约）
 *
 * 这一层和 src/domain 其它部分一样：纯函数、零 IO、不碰 Date.now()。
 * 所有时间都由 UI 侧传入（elapsedMs / nowMs）。
 */

/** 难度档位：只改「饿的速度」这一个变量 */
export type Difficulty = "easy" | "normal" | "hard";

/** 题型方向 */
export type QuizDirection = "en2cn" | "cn2en";

/** 一个选项 */
export interface GameOption {
  /** 稳定 key，用于 React 列表 */
  id: string;
  /** 展示文字：中文释义，或英文 headword */
  text: string;
  /** 是否正确答案 */
  correct: boolean;
}

/** 一道四选一题 */
export interface GameQuestion {
  direction: QuizDirection;
  /** 这个词在库里的 id（用于去重、统计） */
  wordId: number;
  /** 英文原形，结算页可能用到 */
  headword: string;
  /** 题面文字（英→中时是 headword，中→英时是释义） */
  prompt: string;
  /** 恰好 4 个，已洗牌 */
  options: GameOption[];
  /** 正确答案在 options 里的下标（便于快速判定，**不要**渲染进 DOM） */
  correctIndex: number;
}

/** 游戏阶段 */
export type GamePhase = "idle" | "playing" | "grace" | "over";

/** 一次答题的判定结果 */
export type AnswerVerdict = "correct" | "wrong";

/**
 * 打饭机上的「此刻正在接饭的那碗」。
 *
 * v2 把「答对一次 = 吃一口」换成了「答对 5 次 = 打满一碗」：
 * 打饭机先出碗，每答对一个词就掉一串饭进去，满了就端走换成下一碗。
 */
export interface ServingBowl {
  /** 这一碗里已经装了几个词（0..WORDS_PER_BOWL） */
  words: number;
  /** 这一碗的身份，用于 React 换 key 触发「新碗落下」动画 */
  id: number;
}

/** 完整的游戏运行时状态（不可变，每次转换返回新对象） */
export interface GameState {
  phase: GamePhase;
  difficulty: Difficulty;
  /** 饱食度 0..100 */
  satiety: number;
  /** 宽限期剩余毫秒（仅 phase === "grace" 时有意义） */
  graceMsLeft: number;
  /** 本局存活毫秒（不含暂停时间） */
  elapsedMs: number;
  /** 打饭机上正在接饭的那一碗 */
  serving: ServingBowl;
  /** 打满、还没被吃掉的碗（按打好的先后顺序，front 是最先打的） */
  pending: number[];
  /** 已经端走去吃的碗数（不含在场排队的） */
  bowlsMade: number;
  /** 肥鱼真正吃到嘴里的碗数 */
  served: number;
  correct: number;
  wrong: number;
  /** 当前连对 */
  streak: number;
  /** 本局最高连对 */
  bestStreak: number;
  /** 上一题判定，供 UI 放反馈动画 */
  lastVerdict: AnswerVerdict | null;
  /** 上一题是否「打满了一碗」（触发吃白饭动画） */
  lastBowlDone: boolean;
  /** 上一题装进去之后，这一碗装到第几个了（0..WORDS_PER_BOWL） */
  lastFill: number;
}

/** 出题上下文：一个可复用的池子 */
export interface QuizPoolEntry {
  wordId: number;
  headword: string;
  /** 这个词的可见释义（已过 visibleSenses 过滤） */
  meanings: string[];
}

/** 干扰项候选（来自全库） */
export interface DistractorCandidate {
  /** 中文释义（cn 方向用作干扰项） */
  meaningCn: string;
  /** 归属词条的 headword（en 方向用作干扰项） */
  headword: string;
  /** 归属词条 id，用于排除「同一个词」 */
  wordId: number;
}
