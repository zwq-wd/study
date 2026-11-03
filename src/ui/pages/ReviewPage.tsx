/**
 * 复习页（开发文档 §4.3 / §9.2）
 *
 * ┌──────────────────────────────────┐
 * │  12 / 87            逾期最久 9 天 │
 * │                                  │
 * │           abandon                │
 * │                                  │
 * │      （点任意处 / 空格 显示中文）  │
 * │                                  │
 * │                        [ 我记到了 ]│
 * └──────────────────────────────────┘
 *          ↓ 点了「我记到了」，中文淡入
 * ┌──────────────────────────────────┐
 * │           abandon                │
 * │             放弃                  │
 * │  [ 背错了 ]            [ 背对了 ] │
 * └──────────────────────────────────┘
 *
 * 两步，不是一步：先自己回忆 → 点「我记到了」看答案 → 再判断对不对。
 * 老版本是「点下一张 = 默认我会」，问题是没看到答案就已经默认记对了，
 * 背错了也无从发现。现在评分只在看到中文之后才发生。
 *
 * 只显示英文；点一下出中文；出场顺序已打乱（§5.7），不再按逾期顺序一张张来。
 * 不显示进度条动画、不显示连击、不显示「你已连续 3 天」。只有一个 i / N。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Rating } from "ts-fsrs";
import type { SenseRow, WordRow } from "../../data/types.ts";
import { buildSession, type SessionPick } from "../../domain/scheduler/session.ts";
import { decideRequeue, insertRequeue } from "../../domain/scheduler/requeue.ts";
import { visibleSenses, isSupplement } from "../../domain/senses.ts";
import { daysBetween } from "../../domain/time.ts";
import { getRepo, loadConfig } from "../repoClient.ts";
import { todayKey } from "../files.ts";
import { useApp } from "../store.ts";
import { t } from "../i18n.ts";

interface SessionState {
  pick: SessionPick;
  index: number;
  revealed: boolean;
  againCount: number;
  senses: Map<number, SenseRow[]>;
  /** 本轮队列。背错了的词会被插回这个数组，所以它会变长。 */
  words: WordRow[];
  /** 已结算过的词 id。点「上一张」回头再看时不再重复结算，避免 reps 被刷。 */
  settled: Set<number>;
  /** 每个词本轮被重排过几次，用于封顶（§requeue.MAX_REQUEUE_PER_CARD）。 */
  requeueCount: Map<number, number>;
  /** 上一张已经用尽重排次数时的一句说明，前进即清除 */
  notice: string | null;
}

export function ReviewPage() {
  const includeAll = useApp((s) => s.includeAll);
  const setPage = useApp((s) => s.setPage);
  const fontSizeIndex = useApp((s) => s.fontSizeIndex);
  const cycleFontSize = useApp((s) => s.cycleFontSize);
  const bumpStats = useApp((s) => s.bumpStats);

  const [session, setSession] = useState<SessionState | null>(null);
  const [finished, setFinished] = useState(false);
  const [maxOverdue, setMaxOverdue] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [nextDueDesc, setNextDueDesc] = useState<string>("");

  const sessionIdRef = useRef<string | null>(null);
  /** 防连点：两个按钮都在手上，双击会把同一张卡结算两次。 */
  const advanceLockRef = useRef(false);

  // 建会话
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const cfg = await loadConfig();
        const repo = await getRepo();
        const today = todayKey(cfg.dayBoundaryHour);
        const due = await repo.listDue(today);
        const pick = buildSession(due, cfg.sessionLimit, includeAll);

        // 一次性把本轮要用的义项都取出来，避免逐卡 IPC
        const sensesMap = new Map<number, SenseRow[]>();
        for (const w of pick.picked) {
          const full = await repo.getWordById(w.id);
          if (full) sensesMap.set(w.id, full.senses);
        }

        let overdue = 0;
        for (const w of pick.picked) {
          if (!w.fsrs_due_day) continue;
          const d = -daysBetween(w.fsrs_due_day, today);
          if (d > overdue) overdue = d;
        }

        const id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        sessionIdRef.current = id;
        if (pick.picked.length > 0) {
          await repo.startSession(id, new Date(), pick.picked.length, pick.deferred);
        }

        if (!alive) return;
        setMaxOverdue(overdue);
        setSession({
          pick,
          index: 0,
          revealed: false,
          againCount: 0,
          senses: sensesMap,
          words: pick.picked,
          settled: new Set<number>(),
          requeueCount: new Map<number, number>(),
          notice: null,
        });
        setFinished(pick.picked.length === 0);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
    // includeAll 变化时重建会话
  }, [includeAll]);

  const current = session?.words[session.index] ?? null;
  const currentSenses = useMemo(() => {
    if (!session || !current) return [];
    return session.senses.get(current.id) ?? [];
  }, [session, current]);

  const shownSenses = useMemo(() => {
    if (!session || !current) return [];
    return visibleSenses(currentSenses, { revealed: session.revealed, reps: current.fsrs_reps });
  }, [session, current, currentSenses]);

  const finish = useCallback(
    async (againCount: number, shownCount: number) => {
      setFinished(true);
      const repo = await getRepo();
      const sid = sessionIdRef.current;
      if (sid) {
        await repo.updateSession(sid, { shown: shownCount, again: againCount });
        await repo.endSession(sid, new Date());
      }
      // 下次到期
      const cfg = await loadConfig();
      const today = todayKey(cfg.dayBoundaryHour);
      const due = await repo.listDue(today);
      if (due[0]?.fsrs_due_day) {
        const diff = daysBetween(today, due[0].fsrs_due_day);
        setNextDueDesc(diff <= 0 ? "今天" : diff === 1 ? "明天" : `${diff} 天后`);
      } else {
        setNextDueDesc("—");
      }
      bumpStats();
    },
    [bumpStats],
  );

  /**
   * 结算当前卡并前进。
   *
   * 两条规则同时成立：
   *
   * 1. **同一张卡本轮只结算第一次**（settled 集合）。点「上一张」回头再看、
   *    或者背错后被重排回来再答一次，都不会再写一次 FSRS —— 否则每答错一次
   *    `lapses` 就 +1，撞上 `graduationOnLapses = 6` 就被强制毕业，
   *    最需要练的词反而最先消失（见 domain/scheduler/requeue.ts）。
   *
   * 2. **背错了就插回本轮队列**，直到你背对。插的位置离当前位置至少
   *    MIN_REQUEUE_GAP 张，避免同一批词连着出现。
   *
   * 「本次 N 张」数的是真正结算过的卡（settled.size），不是队列里出现过的次数。
   */
  const advance = useCallback(
    async (rating: Rating) => {
      if (!session || !current) return;
      if (advanceLockRef.current) return;
      advanceLockRef.current = true;

      let next: SessionState = session;
      try {
        if (!session.settled.has(current.id)) {
          const repo = await getRepo();
          await repo.settleWord(current.id, rating, new Date(), sessionIdRef.current);

          const settled = new Set(session.settled);
          settled.add(current.id);
          const again = session.againCount + (rating === Rating.Again ? 1 : 0);

          // 每张卡都推进会话的 shown / again —— 中途关掉软件也不会丢进度（§4.3.5）
          if (sessionIdRef.current) {
            await repo.updateSession(sessionIdRef.current, { shown: settled.size, again });
          }
          next = { ...session, settled, againCount: again };
        }

        // 本轮重排：只在「未结算过」的那一次判断，因为 requeueCount 也只在那时增长。
        // 已经结算过的卡（回头重看）不重排，避免同一张卡无限循环。
        if (!session.settled.has(current.id)) {
          const soFar = session.requeueCount.get(current.id) ?? 0;
          const decision = decideRequeue(rating, soFar);
          if (decision.requeue) {
            const requeued = insertRequeue(next.words, next.index, current);
            const counts = new Map(next.requeueCount);
            counts.set(current.id, soFar + 1);
            next = { ...next, words: requeued, requeueCount: counts, notice: null };
          } else if (decision.reason === "exhausted") {
            // 次数用尽：这一张本轮不再回来。说一句「明天还会排到」，
            // 否则「怎么不出现了」和「怎么又出现了」一样让人困惑。
            next = { ...next, notice: t.review.requeueExhausted };
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        advanceLockRef.current = false;
        return;
      }

      if (next.index + 1 >= next.words.length) {
        await finish(next.againCount, next.settled.size);
        return;
      }
      setSession({ ...next, index: next.index + 1, revealed: false });
      advanceLockRef.current = false;
    },
    [session, current, finish],
  );

  const goPrev = useCallback(() => {
    if (!session || session.index === 0) return;
    setSession({ ...session, index: session.index - 1, revealed: false });
  }, [session]);

  /** 第一步 → 第二步：把中文亮出来。不结算。 */
  const reveal = useCallback(() => {
    if (!session) return;
    if (!session.revealed) setSession({ ...session, revealed: true });
  }, [session]);

  const onRemembered = useCallback(() => {
    void advance(Rating.Good);
  }, [advance]);

  const onForgot = useCallback(() => {
    void advance(Rating.Again);
  }, [advance]);

  // 键盘：Space 先显示中文、再看完之后推进；← 上一张；A 背错了
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (finished) return;
      const revealed = session?.revealed ?? false;

      if (e.code === "Space" || e.code === "ArrowRight") {
        e.preventDefault();
        if (!revealed) reveal();
        else onRemembered();
        return;
      }
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        goPrev();
        return;
      }
      if (e.key === "a" || e.key === "A") {
        // 没看到答案之前不能判错 —— 这正是老版本「默认我不会」的问题
        if (revealed) onForgot();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [finished, session, reveal, onRemembered, goPrev, onForgot]);

  if (error !== null) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-paper-dim">
        {t.common.error}：{error}
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="flex h-full items-center justify-center text-paper-dim">{t.common.loading}</div>
    );
  }

  if (finished) {
    // 「本次 N 张」= 真正结算过的卡，不是队列长度 ——
    // 背错重排会让 words 变长，用 words.length 会把重看的次数也算成新词。
    const shown = session.settled.size;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="text-lg text-paper">{t.review.doneTitle}</div>
        <div className="text-sm text-paper-dim">
          {t.review.doneLine(shown, session.againCount)}
        </div>
        {session.requeueCount.size > 0 && (
          <div className="text-xs text-paper-faint">
            {t.review.doneRequeued(session.requeueCount.size)}
          </div>
        )}
        {nextDueDesc !== "" && (
          <div className="text-sm text-paper-dim">{t.review.nextDueLine(nextDueDesc)}</div>
        )}
        <button
          type="button"
          onClick={() => {
            bumpStats();
            setPage("home");
          }}
          className="btn-ghost mt-8"
        >
          {t.review.backHome}
        </button>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="flex h-full items-center justify-center text-paper-dim">{t.home.emptyQueue}</div>
    );
  }

  const progress = t.review.progress(session.index + 1, session.words.length);
  const sizeClass = `word-size-${fontSizeIndex}`;

  return (
    <div
      className="flex h-full select-none flex-col px-10 py-6"
      onClick={reveal}
      role="presentation"
    >
      {/* 顶部：只有位置信息，不提供情绪 */}
      <div className="relative z-10 flex items-baseline justify-between text-sm text-paper-dim">
        <span className="tabular-nums">{progress}</span>
        <div className="flex items-center gap-4">
          {session.notice !== null && <span className="text-paper-faint">{session.notice}</span>}
          {maxOverdue > 0 && <span>{t.review.maxOverdue(maxOverdue)}</span>}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              cycleFontSize();
            }}
            className="btn-link text-xs"
            title="切换字号"
            aria-label="切换字号"
          >
            A
          </button>
        </div>
      </div>

      {/* 卡面：一张纸，浮在灯下。用 padding 而不是加大间距，让边留得从容 */}
      <div className="@container flex flex-1 items-center justify-center px-4">
        <div
          className="panel relative flex w-full max-w-2xl flex-col items-center justify-center gap-7 px-6 py-10 text-center @[600px]:px-10 @[600px]:py-14"
          style={{ boxShadow: "0 24px 60px -32px rgba(0, 0, 0, 0.75)" }}
        >
          <div className={`word ${sizeClass} text-paper`}>{current.headword}</div>

          {/* 这张是背错后被重排回来的：说清楚，免得「怎么又出现了」变成困惑 */}
          {session.requeueCount.has(current.id) && (
            <span className="-mt-4 text-xs tracking-wide text-paper-faint">
              {t.review.requeueTag}
            </span>
          )}

          {session.revealed ? (
            <div className="ink-in space-y-2.5">
              {shownSenses.length === 0 ? (
                <div className="text-sm text-paper-faint">（无释义）</div>
              ) : (
                shownSenses.map((s) => (
                  <div key={s.id} className="flex items-center justify-center gap-2">
                    <span className="text-xl leading-relaxed text-paper">{s.meaning_cn}</span>
                    {isSupplement(s) && <span className="tag">{t.review.supplement}</span>}
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="text-sm tracking-wide text-paper-faint">{t.review.revealHint}</div>
          )}
        </div>
      </div>

      {/* 拇指可达区：第一步一个按钮，第二步两个 */}
      <div className="flex items-center justify-between">
        {session.revealed ? (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onForgot();
              }}
              className="btn-ghost px-6 py-3"
            >
              {t.review.forgot}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemembered();
              }}
              className="btn-primary px-8 py-3 text-base"
            >
              {t.review.remembered}
            </button>
          </>
        ) : (
          <>
            <span />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                reveal();
              }}
              className="btn-primary px-8 py-3 text-base"
            >
              {t.review.showAnswer}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
