/**
 * 游戏模式的会话态（独立于 useApp 的第二个 zustand store）。
 *
 * 为什么不塞进 useApp：那个 store 是「应用外壳态」（当前页、字号、排程配置），
 * 而这里是一个会一局一局重置的游戏会话。分开之后，退出游戏页再回来，
 * 外壳态不受影响，而游戏会话可以原样恢复 —— 这正是用户要的「离开就暂停，回来接着吃」。
 *
 * 这里只存状态，不含任何 IO；读库与出题由 GamePage 调 domain 层完成。
 */
import { create } from "zustand";
import type { Difficulty, DistractorCandidate, GameQuestion, GameState, QuizPoolEntry } from "../../domain/game/types.ts";
import { giveUp } from "../../domain/game/hunger.ts";

export type GameStatus = "pick" | "playing" | "over";

/** 最近几题出过的词，交给 domain 的 nextEntry 去窗口判重 */
export const RECENT_MAX = 8;

interface GameStore {
  status: GameStatus;
  difficulty: Difficulty;
  state: GameState | null;
  pool: QuizPoolEntry[];
  candidates: DistractorCandidate[];
  question: GameQuestion | null;
  cursor: number;
  recent: number[];
  /** 池子里分别有多少词来自两个来源，用于开局前的说明 */
  poolFromMissed: number;
  poolFromNew: number;
  /** 声音开关（默认关，用户明确要求） */
  sound: boolean;
  /** 是不是玩家自己点了「不玩了」——结算页要说清楚，别把主动收手说成被吃掉 */
  gaveUp: boolean;

  setSound: (v: boolean) => void;
  setDifficulty: (d: Difficulty) => void;
  beginRound: (input: {
    difficulty: Difficulty;
    pool: QuizPoolEntry[];
    candidates: DistractorCandidate[];
    fromMissed: number;
    fromNew: number;
  }) => void;
  setQuestion: (q: GameQuestion | null, cursor: number, wordId: number | null) => void;
  setState: (s: GameState) => void;
  /** 主动收手：走 domain 的 giveUp，保证 phase 真的变成 over */
  endRound: () => void;
  backToPick: () => void;
}

export const useGame = create<GameStore>((set) => ({
  status: "pick",
  difficulty: "normal",
  state: null,
  pool: [],
  candidates: [],
  question: null,
  cursor: 0,
  recent: [],
  poolFromMissed: 0,
  poolFromNew: 0,
  sound: false,
  gaveUp: false,

  setSound: (sound) => set({ sound }),
  setDifficulty: (difficulty) => set({ difficulty }),

  beginRound: (input) =>
    set({
      status: "playing",
      difficulty: input.difficulty,
      pool: input.pool,
      candidates: input.candidates,
      question: null,
      cursor: 0,
      recent: [],
      gaveUp: false,
      poolFromMissed: input.fromMissed,
      poolFromNew: input.fromNew,
    }),

  setQuestion: (question, cursor, wordId) =>
    set((s) => ({
      question,
      cursor,
      recent: wordId === null ? s.recent : [...s.recent, wordId].slice(-RECENT_MAX),
    })),

  setState: (state) =>
    set(() => ({
      state,
      status: state.phase === "over" ? "over" : "playing",
    })),

  endRound: () =>
    set((s) => ({ status: "over", gaveUp: true, state: s.state === null ? null : giveUp(s.state) })),

  backToPick: () =>
    set({
      status: "pick",
      state: null,
      question: null,
      pool: [],
      candidates: [],
      cursor: 0,
      recent: [],
      poolFromMissed: 0,
      poolFromNew: 0,
      gaveUp: false,
    }),
}));