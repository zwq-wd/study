/**
 * 今日新词（v0.4）
 *
 * 场景：今天刚录完一批词，想立刻把它们再翻一遍。
 *
 * ┌──────────────────────────────────┐
 * │  3 / 24                          │
 * │                                  │
 * │        expectancy                │
 * │                                  │
 * │      （点任意处 / 空格 显示中文）  │
 * │                                  │
 * │                        [ 我记到了 ]│
 * └──────────────────────────────────┘
 *
 * 形态直接照抄重新复习页，因为两者是同一件事的两个入口：
 * 那个看「今天背错的」，这个看「今天录入的」。三条约束同样成立：
 *
 * 1. **不结算**。不写 review_logs、不动 fsrs_*、不写 sessions。
 *    新词入库时已经结算过一次 Good（§5.5），回看若再结算，reps 会凭空翻倍、
 *    间隔被一次次推长 —— 到期日会因为你「多看了几眼」而漂移，排程就不再可信。
 *    见 domain/scheduler/todayWords.ts。
 *
 * 2. **只有一个按钮**。回看不需要你判断对错，判对错是复习页的职责。
 *
 * 3. **不显示进度条动画、不显示连击、不显示「还剩几张」的催促**。
 *    只给位置 i / N，因为它回答的是「还要翻多久」，而不是「你还差多少」。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SenseRow, WordRow } from "../../data/types.ts";
import { buildTodayWords } from "../../domain/scheduler/todayWords.ts";
import { visibleSenses, isSupplement } from "../../domain/senses.ts";
import { getRepo, loadConfig } from "../repoClient.ts";
import { todayKey } from "../files.ts";
import { useApp } from "../store.ts";
import { t } from "../i18n.ts";

interface TodayState {
  words: WordRow[];
  index: number;
  revealed: boolean;
  senses: Map<number, SenseRow[]>;
  /** 本轮因上限顺延的张数（为 0 时整段不显示） */
  deferred: number;
}

export function TodayPage() {
  const setPage = useApp((s) => s.setPage);
  const fontSizeIndex = useApp((s) => s.fontSizeIndex);
  const cycleFontSize = useApp((s) => s.cycleFontSize);

  const [state, setState] = useState<TodayState | null>(null);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 上一轮翻过的张数，用于「再看一遍」之后结束页仍然有数字 */
  const [lastCount, setLastCount] = useState(0);

  /**
   * 本轮已经翻过的词 id。只活在内存里 —— 回看不落库，所以中途关掉软件
   * 下次就是从头再来。和重新复习页同一取舍：不留痕迹才是对的。
   */
  const seenRef = useRef<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      const cfg = await loadConfig();
      const repo = await getRepo();
      const today = todayKey(cfg.dayBoundaryHour);
      const rows = await repo.listTodayNewWords(today);
      const pick = buildTodayWords(rows, cfg.sessionLimit);

      // 一次性取义项，避免逐卡 IPC
      const sensesMap = new Map<number, SenseRow[]>();
      for (const w of pick.picked) {
        const full = await repo.getWordById(w.id);
        if (full) sensesMap.set(w.id, full.senses);
      }

      seenRef.current = new Set<number>();
      setState({
        words: pick.picked,
        index: 0,
        revealed: false,
        senses: sensesMap,
        deferred: pick.deferred,
      });
      setFinished(pick.picked.length === 0);
      setLastCount(0);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = state?.words[state.index] ?? null;

  const shownSenses = useMemo(() => {
    if (!state || !current) return [];
    const list = state.senses.get(current.id) ?? [];
    // reps 的用途和复习页一致：L2 补充义项要复习满 3 次才出现（§4.3.3）。
    // 这里只读 reps，不因为翻看而改动它。
    return visibleSenses(list, { revealed: state.revealed, reps: current.fsrs_reps });
  }, [state, current]);

  const reveal = useCallback(() => {
    if (!state) return;
    if (!state.revealed) setState({ ...state, revealed: true });
  }, [state]);

  /** 只在内存里前进一步：不打评分、不落库 */
  const advance = useCallback(() => {
    if (!state) return;
    const word = state.words[state.index];
    if (word) seenRef.current.add(word.id);

    if (state.index + 1 >= state.words.length) {
      setLastCount(seenRef.current.size);
      setFinished(true);
      return;
    }
    setState({ ...state, index: state.index + 1, revealed: false });
  }, [state]);

  // 键盘：空格 / → 先翻中文再前进；→ 在已翻开时也前进；Esc 回首页
  useEffect(() => {
    if (finished) return;
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowRight") {
        e.preventDefault();
        if (state?.revealed) advance();
        else reveal();
        return;
      }
      if (e.code === "Escape") {
        e.preventDefault();
        setPage("home");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [finished, state, reveal, advance, setPage]);

  if (error !== null) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-paper-dim">
        {t.common.error}：{error}
      </div>
    );
  }

  if (state === null) {
    return (
      <div className="flex h-full items-center justify-center text-paper-dim">{t.common.loading}</div>
    );
  }

  // ---------------------------------------------------------------- 翻完了
  if (finished) {
    const empty = state.words.length === 0;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="text-lg text-paper">
          {empty ? t.todayWords.emptyToday : t.todayWords.doneTitle}
        </div>
        {!empty && <div className="text-sm text-paper-dim">{t.todayWords.doneLine(lastCount)}</div>}
        {state.deferred > 0 && (
          <div className="text-xs text-paper-faint">{t.todayWords.deferNote(state.deferred)}</div>
        )}
        {/* 这句话是这个功能最重要的部分：翻看不改排程 */}
        {!empty && <div className="mt-1 text-xs text-paper-faint">{t.todayWords.doneHint}</div>}
        {empty ? (
          <div className="mt-8 flex items-center gap-3">
            <button type="button" onClick={() => setPage("import")} className="btn-ghost">
              {t.todayWords.goImport}
            </button>
            <button type="button" onClick={() => setPage("home")} className="btn-primary">
              {t.todayWords.backHome}
            </button>
          </div>
        ) : (
          <div className="mt-8 flex items-center gap-3">
            <button type="button" onClick={() => void load()} className="btn-ghost">
              {t.todayWords.restart}
            </button>
            <button type="button" onClick={() => setPage("home")} className="btn-primary">
              {t.todayWords.backHome}
            </button>
            <button type="button" onClick={() => setPage("import")} className="btn-ghost">
              {t.todayWords.goImport}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!current) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6">
        <div className="text-paper-dim">{t.todayWords.emptyToday}</div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setPage("import")} className="btn-ghost">
            {t.todayWords.goImport}
          </button>
          <button type="button" onClick={() => setPage("home")} className="btn-ghost">
            {t.todayWords.backHome}
          </button>
        </div>
      </div>
    );
  }

  const sizeClass = `word-size-${fontSizeIndex}`;
  const isLast = state.index + 1 >= state.words.length;

  return (
    <div className="flex h-full select-none flex-col px-10 py-6" onClick={reveal} role="presentation">
      {/* 顶部：只有位置 + 字号。没有「今天已翻 N 次」这类计数 */}
      <div className="relative z-10 flex items-baseline justify-between text-sm text-paper-dim">
        <span className="tabular-nums">{t.todayWords.progress(state.index + 1, state.words.length)}</span>
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

      <div className="@container flex flex-1 items-center justify-center px-4">
        <div
          className="panel relative flex w-full max-w-2xl flex-col items-center justify-center gap-7 px-6 py-10 text-center @[600px]:px-10 @[600px]:py-14"
          style={{ boxShadow: "0 24px 60px -32px rgba(0, 0, 0, 0.75)" }}
        >
          <div className={`word ${sizeClass} text-paper`}>{current.headword}</div>

          {state.revealed ? (
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
            <div className="text-sm tracking-wide text-paper-faint">{t.todayWords.revealHint}</div>
          )}
        </div>
      </div>

      {/* 只有一个按钮 —— 回看不需要判断对错 */}
      <div className="flex items-center justify-end">
        {state.revealed ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              advance();
            }}
            className="btn-primary px-8 py-3 text-base"
          >
            {isLast ? t.todayWords.last : t.todayWords.next}
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              reveal();
            }}
            className="btn-primary px-8 py-3 text-base"
          >
            {t.todayWords.showAnswer}
          </button>
        )}
      </div>
    </div>
  );
}
