/**
 * 游戏模式 · 打饭喂肥鱼（v2）
 *
 * 玩法闭环：
 *   出题 → 答对一勺 → 打饭机往碗里掉一撮饭 → 五勺打满一碗
 *   → 碗端到旁边排队 → 肥鱼吃掉一碗（+20 饱食度，播「吃白饭」动画）
 *   → 台子上还有打满的碗就继续吃；吃不动（饱食度满）就先摆着
 *
 * 画面这一版全部换成图片素材：肥鱼是桌宠导出的透明 webm，
 * 打饭机和碗是生图后抠白的道具图。这里只负责摆位、状态和时序。
 *
 * 整个页面的计时只在 status === "playing" 且窗口可见时推进 ——
 * 离开这一页或最小化窗口，rAF 自然不再被调用，饱食度就冻住了。
 * 用户要的就是「离开就暂停」，所以这里不做任何「按真实时间补算」的逻辑。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n.ts";
import { getRepo } from "../repoClient.ts";
import { todayKey } from "../files.ts";
import { useApp } from "../store.ts";
import { RECENT_MAX, useGame } from "../game/gameSession.ts";
import { FatFish, type FishMood } from "../game/FatFish.tsx";
import { RiceDispenser } from "../game/RiceDispenser.tsx";
import {
  answer as applyAnswer,
  eatBowl,
  formatDuration,
  satietyRatio,
  startGame,
  tick,
} from "../../domain/game/hunger.ts";
import { buildGamePool } from "../../domain/game/pool.ts";
import { buildQuestion, nextEntry, pickDirection } from "../../domain/game/quiz.ts";
import { bowlProgressLine, pickLine } from "../../domain/game/lines.ts";
import { CRITICAL_THRESHOLD, TREMBLE_THRESHOLD, POOL_LIMIT, WORDS_PER_BOWL } from "../../domain/game/config.ts";
import type { Difficulty, GameQuestion } from "../../domain/game/types.ts";
import {
  preloadSfx,
  sfxBowl,
  sfxEat,
  sfxGrace,
  sfxScoop,
  sfxStart,
  sfxSwallow,
  sfxWrong,
  unlockAudio,
} from "../game/sfx.ts";
import "../game/game.css";

type LoadError = string | null;

const FISH_SOUND_KEY = "game_sound";
const FISH_DIFFICULTY_KEY = "game_difficulty";

/** 吃一碗饭的演出时长（毫秒）：肥鱼「吃白饭」片段播一段，播完才结算下一碗 */
const EAT_MS = 2400;

function isDifficulty(v: string | undefined): v is Difficulty {
  return v === "easy" || v === "normal" || v === "hard";
}

export function GamePage() {
  const setPage = useApp((s) => s.setPage);
  const config = useApp((s) => s.config);

  const status = useGame((s) => s.status);
  const difficulty = useGame((s) => s.difficulty);
  const gs = useGame((s) => s.state);
  const pool = useGame((s) => s.pool);
  const question = useGame((s) => s.question);
  const fromMissed = useGame((s) => s.poolFromMissed);
  const fromNew = useGame((s) => s.poolFromNew);
  const sound = useGame((s) => s.sound);
  const gaveUp = useGame((s) => s.gaveUp);

  const setSound = useGame((s) => s.setSound);
  const setDifficulty = useGame((s) => s.setDifficulty);
  const beginRound = useGame((s) => s.beginRound);
  const setQuestion = useGame((s) => s.setQuestion);
  const setState = useGame((s) => s.setState);
  const endRound = useGame((s) => s.endRound);
  const backToPick = useGame((s) => s.backToPick);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError>(null);
  const [line, setLine] = useState<string>("");
  const [poolError, setPoolError] = useState<string>("");
  /** 吞屏演出 */
  const [swallow, setSwallow] = useState(false);
  /** 刚掉了一勺（驱动掉饭动画） */
  const [dropping, setDropping] = useState(false);
  /** 刚装满一碗 */
  const [justDone, setJustDone] = useState(false);
  /** 正在吃第几碗：吃的时候把肥鱼切成 eating */
  const [eating, setEating] = useState(false);

  const recentNag = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const eatTimer = useRef<number | null>(null);

  // 声音开关与默认难度存在 settings 表里
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const repo = await getRepo();
        const rows = await repo.loadSettings();
        if (!alive) return;
        if (rows[FISH_SOUND_KEY] === "1") setSound(true);
        if (isDifficulty(rows[FISH_DIFFICULTY_KEY])) {
          const d = rows[FISH_DIFFICULTY_KEY];
          if (d) setDifficulty(d);
        }
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [setSound, setDifficulty]);

  const persist = useCallback((key: string, value: string) => {
    void (async () => {
      try {
        const repo = await getRepo();
        await repo.saveSettings({ [key]: value });
      } catch {
        // 设置存不上不影响玩
      }
    })();
  }, []);

  const toggleSound = useCallback(() => {
    const next = !sound;
    setSound(next);
    if (next) {
      unlockAudio();
      preloadSfx();
    }
    persist(FISH_SOUND_KEY, next ? "1" : "0");
  }, [sound, setSound, persist]);

  const chooseDifficulty = useCallback(
    (d: Difficulty) => {
      setDifficulty(d);
      persist(FISH_DIFFICULTY_KEY, d);
    },
    [setDifficulty, persist],
  );

  const startRound = useCallback(
    async (d: Difficulty) => {
      setError(null);
      try {
        const repo = await getRepo();
        const today = todayKey(config.dayBoundaryHour);
        const [snapshot, distractors] = await Promise.all([
          repo.gameTodayPool(today),
          repo.listDistractors(600),
        ]);
        const built = buildGamePool(snapshot.missed, snapshot.fresh, POOL_LIMIT);
        beginRound({
          difficulty: d,
          pool: built.entries,
          candidates: distractors,
          fromMissed: built.fromMissed,
          fromNew: built.fromNew,
        });
        if (built.entries.length === 0) {
          setError(null);
          setPoolError(t.game.poolTooSmall);
          return;
        }
        setPoolError("");
        setState(startGame(d));
        setSwallow(false);
        setLine("");
        setEating(false);
        recentNag.current = [];
        unlockAudio();
        preloadSfx();
        if (useGame.getState().sound) sfxStart();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [config.dayBoundaryHour, beginRound, setState],
  );

  /**
   * 出下一题。
   *
   * **在这里把「凑不出四个选项」的词就地跳过**，不要 setQuestion(null) 让
   * 上层 effect 再试一次 —— null 和 null 之间 zustand 不会触发重渲染，
   * 一局会卡死在空白题面上（这是接进去之后实测踩到的坑）。
   */
  const advance = useCallback(() => {
    const s = useGame.getState();
    if (s.pool.length === 0) {
      setPoolError(t.game.poolTooSmall);
      return;
    }

    let cursor = s.cursor;
    let recent = s.recent;
    const attempts = Math.min(s.pool.length, 8);

    for (let i = 0; i < attempts; i++) {
      const picked = nextEntry(s.pool, cursor, recent);
      if (picked.entry === null) break;
      cursor = picked.cursor;
      recent = [...recent, picked.entry.wordId].slice(-RECENT_MAX);

      const built = buildQuestion({
        entry: picked.entry,
        candidates: s.candidates,
        direction: pickDirection(),
      });
      if (built !== null) {
        setQuestion(built, cursor, picked.entry.wordId);
        return;
      }
    }

    setPoolError(t.game.poolTooSmall);
  }, [setQuestion, setPoolError]);

  // 开局后立刻出第一题
  useEffect(() => {
    if (status === "playing" && question === null && pool.length > 0) advance();
  }, [status, question, pool.length, advance]);

  // 掉了饭 / 装满了：两条短演出，到点自动收
  useEffect(() => {
    if (!dropping) return;
    const timer = window.setTimeout(() => setDropping(false), 520);
    return () => window.clearTimeout(timer);
  }, [dropping]);

  useEffect(() => {
    if (!justDone) return;
    const timer = window.setTimeout(() => setJustDone(false), 900);
    return () => window.clearTimeout(timer);
  }, [justDone]);

  // 吞屏演出
  useEffect(() => {
    if (!swallow) return;
    const timer = window.setTimeout(() => setSwallow(false), 950);
    return () => window.clearTimeout(timer);
  }, [swallow]);

  /** 主循环：只在 playing / grace 时走时间。 */
  useEffect(() => {
    if (status !== "playing" || gs === null) return;
    if (gs.phase !== "playing" && gs.phase !== "grace") return;

    const step = (ts: number): void => {
      const prev = lastTsRef.current;
      lastTsRef.current = ts;
      if (prev !== null) {
        const elapsed = Math.min(ts - prev, 250); // 掉帧保护：一次最多推进 250ms
        const cur = useGame.getState().state;
        if (cur !== null) {
          const nextState = tick(cur, elapsed);
          if (nextState !== cur) {
            useGame.getState().setState(nextState);
            if (cur.phase === "playing" && nextState.phase === "grace") {
              if (useGame.getState().sound) sfxGrace();
              setLine(t.game.graceTitle);
              recentNag.current = [];
            }
            if (nextState.phase === "over" && cur.phase !== "over") {
              if (useGame.getState().sound) sfxSwallow();
              setSwallow(true);
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(step);
    };

    lastTsRef.current = null;
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
    };
  }, [status, gs === null ? null : gs.phase]);

  /**
   * 吃一碗饭的演出。
   *
   * 肥鱼「吃白饭」的片段约 10 秒，整段放完会打断节奏，所以只吃一段就收，
   * 剩下的碗等这一段演完再接着吃 —— 桌子上有几碗就演几次。
   */
  const startEat = useCallback(() => {
    if (eatTimer.current !== null) return;
    const s = useGame.getState();
    if (s.state === null) return;
    if (s.state.pending.length === 0) return;

    setEating(true);
    if (s.sound) sfxEat();
    eatTimer.current = window.setTimeout(() => {
      eatTimer.current = null;
      const still = useGame.getState();
      if (still.state === null) {
        setEating(false);
        return;
      }
      still.setState(eatBowl(still.state));
      setEating(false);
      // 这里不再自己排下一次：eatBowl 改了 state，下面那个 effect 会接着开吃，
      // 自己再排一次就会和 effect 抢，一碗被吃两遍。
    }, EAT_MS);
  }, []);

  /**
   * 只要台上有打满的碗、且吃得下，就自动开吃。
   *
   * 吃一碗会改 state，这个 effect 于是再跑一次 —— 台上还有碗就接着吃，
   * 所以「一次打出三碗」会连着演三次，不需要额外的调度。
   */
  useEffect(() => {
    if (eating) return;
    if (gs === null) return;
    if (gs.phase !== "playing" && gs.phase !== "grace") return;
    if (gs.pending.length === 0) return;
    if (gs.satiety >= 100) return;
    startEat();
  }, [gs, eating, startEat]);

  /** 判定一道题。 */
  const choose = useCallback(
    (index: number) => {
      const s = useGame.getState();
      if (s.state === null || s.question === null) return;
      if (s.state.phase !== "playing" && s.state.phase !== "grace") return;

      const correct = index === s.question.correctIndex;
      const next = applyAnswer(s.state, correct);
      s.setState(next);

      if (correct) {
        if (s.sound) sfxScoop();
        setDropping(true);
        setLine(bowlProgressLine(t.game.scoopLine, next.lastFill));
        if (next.lastBowlDone) {
          window.setTimeout(() => {
            if (useGame.getState().sound) sfxBowl();
            setJustDone(true);
            setLine(pickLine(t.game.bowlDoneLine, []).text);
          }, 240);
        }
      } else {
        if (s.sound) sfxWrong();
        const lines = next.phase === "grace" ? t.game.hungryNag : t.game.nag;
        const picked = pickLine(lines, recentNag.current);
        recentNag.current = picked.recent;
        setLine(picked.text);
      }

      // 捕获当前题对象：超时回来时如果题已经换了，就不再推进
      const answered = s.question;
      window.setTimeout(() => {
        const still = useGame.getState();
        if (still.status !== "playing") return;
        if (still.question !== answered) return;
        advance();
      }, correct ? 300 : 420);
    },
    [advance],
  );

  // 键盘：1/2/3/4 与 A/B/C/D
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useGame.getState();
      if (s.status !== "playing" || s.question === null) return;
      const index = resolveKey(e.key);
      if (index === null) return;
      e.preventDefault();
      choose(index);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choose]);

  // 离场时收掉吃碗定时器
  useEffect(
    () => () => {
      if (eatTimer.current !== null) window.clearTimeout(eatTimer.current);
      eatTimer.current = null;
    },
    [],
  );

  const mood: FishMood = useMemo(() => {
    if (swallow) return "troubled";
    if (gs === null) return "idle";
    if (eating) return "eating";
    if (gs.phase === "over") return "troubled";
    if (gs.phase === "grace") return "hungry";
    if (gs.satiety < TREMBLE_THRESHOLD) return "hungry";
    if (gs.lastVerdict === "correct") return gs.lastBowlDone ? "happy" : "idle";
    if (gs.lastVerdict === "wrong") return "troubled";
    return "idle";
  }, [swallow, gs, eating]);

  const fullness = gs === null ? 1 : satietyRatio(gs);
  const critical = gs !== null && gs.satiety < CRITICAL_THRESHOLD;

  if (loading) {
    return (
      <div className="grid h-full place-items-center bg-[#0f1a33] text-sm text-[#9fb0d9]">
        {t.common.loading}
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="grid h-full place-items-center bg-[#0f1a33] px-8 text-center">
        <div>
          <p className="text-sm text-[#e0433f]">{error}</p>
          <button type="button" className="game-btn mt-4" onClick={() => setPage("home")}>
            {t.game.backHome}
          </button>
        </div>
      </div>
    );
  }

  // ---------- 选难度 ----------
  if (status === "pick") {
    return (
      <div className="game-stage">
        <div className="game-pick">
          <header className="game-pick-head">
            <h1 className="game-title">{t.game.title}</h1>
            <p className="game-tagline">{t.game.tagline}</p>
          </header>

          <div className="game-pick-fish" aria-hidden>
            <FatFish mood="idle" />
          </div>

          <div className="game-diffs">
            {(["easy", "normal", "hard"] as const).map((d) => (
              <button
                key={d}
                type="button"
                className={difficulty === d ? "game-diff game-diff-active" : "game-diff"}
                onClick={() => chooseDifficulty(d)}
              >
                <span className="game-diff-name">{t.game.difficulty[d]}</span>
                <span className="game-diff-desc">{t.game.difficultyDesc[d]}</span>
              </button>
            ))}
          </div>

          {poolError !== "" ? (
            <p className="game-pool-error">{poolError}</p>
          ) : (
            <p className="game-pool-line">{t.game.poolLine(fromMissed, fromNew)}</p>
          )}

          <div className="game-pick-actions">
            <button
              type="button"
              className="game-btn game-btn-primary"
              onClick={() => void startRound(difficulty)}
            >
              {t.game.start}
            </button>
            <button type="button" className="game-btn" onClick={() => setPage("review")}>
              {t.game.goReview}
            </button>
            <button type="button" className="game-btn" onClick={() => setPage("import")}>
              {t.game.goImport}
            </button>
            <button type="button" className="game-btn" onClick={() => setPage("home")}>
              {t.game.backHome}
            </button>
          </div>

          <button type="button" className="game-sound" onClick={toggleSound}>
            {sound ? t.game.mute : t.game.unmute}
          </button>
        </div>
      </div>
    );
  }

  // ---------- 结算 ----------
  if (status === "over" || (gs !== null && gs.phase === "over")) {
    const final = gs;
    if (swallow) {
      return (
        <div className="game-stage game-swallowing">
          <div className="game-swallow-flash" aria-hidden />
          <div className="game-swallow-fish" aria-hidden>
            <FatFish mood="troubled" />
          </div>
        </div>
      );
    }
    return (
      <div className="game-stage">
        <div className="game-over">
          <h2 className="game-over-title">
            {gaveUp ? t.game.quitTitle : t.game.overTitle}
          </h2>
          <p className="game-over-line">
            {gaveUp ? t.game.overGaveUp : t.game.overEaten}
          </p>
          <div className="game-over-fish" aria-hidden>
            <FatFish mood={gaveUp ? "idle" : "troubled"} />
          </div>
          <dl className="game-result">
            <div>
              <dt>{t.game.resultBowls}</dt>
              <dd>
                {final?.served ?? 0}
                <span className="game-unit">{t.game.resultBowlsUnit}</span>
              </dd>
            </div>
            <div>
              <dt>{t.game.resultCorrect}</dt>
              <dd>{final?.correct ?? 0}</dd>
            </div>
            <div>
              <dt>{t.game.resultWrong}</dt>
              <dd>{final?.wrong ?? 0}</dd>
            </div>
            <div>
              <dt>{t.game.resultBest}</dt>
              <dd>{final?.bestStreak ?? 0}</dd>
            </div>
            <div>
              <dt>{t.game.resultSurvived}</dt>
              <dd>{formatDuration(final?.elapsedMs ?? 0)}</dd>
            </div>
          </dl>
          <p className="game-over-hint">{t.game.overHint}</p>
          <div className="game-pick-actions">
            <button
              type="button"
              className="game-btn game-btn-primary"
              onClick={() => void startRound(difficulty)}
            >
              {t.game.again}
            </button>
            <button
              type="button"
              className="game-btn"
              onClick={() => {
                backToPick();
                setPoolError("");
                setPage("home");
              }}
            >
              {t.game.backHome}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- 游戏中 ----------
  const inGrace = gs !== null && gs.phase === "grace";
  const graceSeconds = gs === null ? 0 : Math.ceil(gs.graceMsLeft / 1000);
  const filled = gs?.serving.words ?? 0;
  const pendingCount = gs?.pending.length ?? 0;

  return (
    <div className={inGrace ? "game-stage game-grace" : "game-stage"}>
      <div className="game-hud">
        <button type="button" className="game-hud-btn" onClick={() => { endRound(); }}>
          {t.game.quit}
        </button>
        <span className="game-hud-stat">{t.game.bowls(gs?.served ?? 0)}</span>
        <span className="game-hud-stat">{t.game.bestStreak(gs?.bestStreak ?? 0)}</span>
        <span className="game-hud-hint">{t.game.keyboardHint}</span>
        <button type="button" className="game-hud-btn" onClick={toggleSound}>
          {sound ? t.game.mute : t.game.unmute}
        </button>
      </div>

      {question !== null && <QuizCard question={question} onPick={choose} />}

      <div className={critical ? "game-satiety game-satiety-critical" : "game-satiety"}>
        <span className="game-satiety-label">{t.game.satietyLabel}</span>
        <div className="game-satiety-track">
          <div className="game-satiety-fill" style={{ width: `${Math.round(fullness * 100)}%` }} />
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className="game-satiety-tick" style={{ left: `${i * 20}%` }} />
          ))}
        </div>
        <span className="game-satiety-value">{Math.round(gs?.satiety ?? 0)}</span>
      </div>

      {inGrace && (
        <div className="game-grace-band">
          <strong>{t.game.graceTitle}</strong>
          <span>{t.game.graceHint(graceSeconds)}</span>
        </div>
      )}

      {/* 食堂台面：左边打饭机、中间肥鱼、右边排队的碗 */}
      <div className="game-floor">
        <div className="game-floor-inner">
          <div className="game-station">
            <RiceDispenser
              filled={filled}
              total={WORDS_PER_BOWL}
              dropping={dropping}
              justDone={justDone}
              bowlId={gs?.serving.id ?? 1}
            />
            <span className="game-station-label">
              {filled >= WORDS_PER_BOWL ? t.game.bowlReady : t.game.servingLabel}
              <b>
                {" "}
                {t.game.bowlProgress(filled, WORDS_PER_BOWL)}
              </b>
            </span>
          </div>

          <div className="game-fish">
            <FatFish mood={mood} />
          </div>

          {/* 台子右边排队的碗：打满一碗就多一只 */}
          <div className="game-queue" data-count={pendingCount} aria-hidden={pendingCount === 0}>
            <div className="game-queue-bowls">
              {Array.from({ length: pendingCount }, (_, i) => (
                <img
                  key={`${gs?.serving.id ?? 0}-${i}`}
                  className="game-queue-bowl"
                  src="/pet/props/bowl.webp"
                  alt=""
                  draggable={false}
                  style={{ animationDelay: `${i * 70}ms` }}
                />
              ))}
            </div>
            <span className="game-queue-label">
              {pendingCount > 0 ? t.game.queueLabel(pendingCount) : ""}
            </span>
          </div>
        </div>

        <div className="game-sea-waves" aria-hidden>
          <svg viewBox="0 0 1440 120" preserveAspectRatio="none">
            <path className="wave wave-a" d="M0,64 C240,20 480,108 720,64 C960,20 1200,108 1440,64 L1440,120 L0,120 Z" />
            <path className="wave wave-b" d="M0,80 C240,40 480,120 720,80 C960,40 1200,120 1440,80 L1440,120 L0,120 Z" />
          </svg>
        </div>

        {line !== "" && <div className="game-nag">{line}</div>}
      </div>
    </div>
  );
}

/** 键位映射：数字与字母都接受。 */
function resolveKey(key: string): number | null {
  switch (key.toLowerCase()) {
    case "1":
    case "a":
      return 0;
    case "2":
    case "b":
      return 1;
    case "3":
    case "c":
      return 2;
    case "4":
    case "d":
      return 3;
    default:
      return null;
  }
}

const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

function QuizCard({
  question,
  onPick,
}: {
  question: GameQuestion;
  onPick: (index: number) => void;
}): React.ReactElement {
  return (
    <div className="game-quiz">
      <p className="game-prompt" data-dir={question.direction}>
        {question.prompt}
      </p>
      <div className="game-options">
        {question.options.map((opt, i) => (
          <button key={opt.id} type="button" className="game-option" onClick={() => onPick(i)}>
            <span className="game-option-key">{OPTION_LETTERS[i] ?? "?"}</span>
            <span className="game-option-text">{opt.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}