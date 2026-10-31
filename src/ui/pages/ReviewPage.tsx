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
 * │  [ 不会 ]              [ 下一张 ] │
 * └──────────────────────────────────┘
 *
 * 只显示英文；点一下出中文；默认动作 = 记住（看完即算完成，不点按钮也会推进）。
 * 不显示进度条动画、不显示连击、不显示「你已连续 3 天」。只有一个 i / N。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Rating } from "ts-fsrs";
import type { SenseRow, WordRow } from "../../data/types.ts";
import { buildSession, type SessionPick } from "../../domain/scheduler/session.ts";
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
  words: WordRow[];
}

export function ReviewPage() {
  const includeAll = useApp((s) => s.includeAll);
  const setPage = useApp((s) => s.setPage);
  const fontSizeIndex = useApp((s) => s.fontSizeIndex);
  const cycleFontSize = useApp((s) => s.cycleFontSize);
  const bumpStats = useApp((s) => s.bumpStats);
  const config = useApp((s) => s.config);

  const [session, setSession] = useState<SessionState | null>(null);
  const [finished, setFinished] = useState(false);
  const [maxOverdue, setMaxOverdue] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [nextDueDesc, setNextDueDesc] = useState<string>("");

  const sessionIdRef = useRef<string | null>(null);

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

  const advance = useCallback(
    async (rating: Rating) => {
      if (!session || !current) return;
      const repo = await getRepo();
      const again = session.againCount + (rating === Rating.Again ? 1 : 0);
      const shown = session.index + 1;

      try {
        await repo.settleWord(current.id, rating, new Date(), sessionIdRef.current);
        // 每张卡都推进会话的 shown / again —— 中途关掉软件也不会丢进度（§4.3.5）
        if (sessionIdRef.current) {
          await repo.updateSession(sessionIdRef.current, { shown, again });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }

      if (session.index + 1 >= session.words.length) {
        await finish(again, shown);
        return;
      }
      setSession({ ...session, index: session.index + 1, revealed: false, againCount: again });
    },
    [session, current, finish],
  );

  const goPrev = useCallback(() => {
    if (!session || session.index === 0) return;
    setSession({ ...session, index: session.index - 1, revealed: false });
  }, [session]);

  const reveal = useCallback(() => {
    if (!session) return;
    if (!session.revealed) setSession({ ...session, revealed: true });
  }, [session]);

  const onNext = useCallback(() => {
    if (!session) return;
    // 默认动作 = 记住。还没看答案就按下一张，也按 Good 结算（看完即算完成）。
    void advance(Rating.Good);
  }, [session, advance]);

  const onAgain = useCallback(() => {
    void advance(Rating.Again);
  }, [advance]);

  // 键盘：Space 显示/下一张，← 上一张，A 标记不会（若开启）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (finished) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (session && !session.revealed) reveal();
        else onNext();
        return;
      }
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        goPrev();
        return;
      }
      if (e.code === "ArrowRight") {
        e.preventDefault();
        onNext();
        return;
      }
      if (e.key === "a" || e.key === "A") {
        if (config.enableAgainButton) onAgain();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [finished, session, reveal, onNext, goPrev, onAgain, config.enableAgainButton]);

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
    const shown = session.words.length;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="text-lg text-paper">{t.review.doneTitle}</div>
        <div className="text-sm text-paper-dim">
          {t.review.doneLine(shown, session.againCount)}
        </div>
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

      {/* 拇指可达区：主操作固定在屏幕下方 */}
      <div className="flex items-center justify-between">
        <div>
          {config.enableAgainButton ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAgain();
              }}
              className="btn-ghost px-6 py-3"
            >
              {t.review.again}
            </button>
          ) : (
            <span />
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          className="btn-primary px-8 py-3 text-base"
        >
          {t.review.next}
        </button>
      </div>
    </div>
  );
}
