/**
 * 查询页（开发文档 §4.2 / §9.4）
 *
 * 按英文查（前缀 + 完全匹配，大小写不敏感）与按中文释义查。
 * 结果行：headword · 首条 L1 释义 · 状态 · 最后复习日期 · 下次到期日
 * 「背过没有」：查不到 = 没背过；查到 = 背过，且直接看到最后复习日期。
 */
import { useCallback, useEffect, useState } from "react";
import type { SearchHit, WordWithSenses } from "../../data/types.ts";
import { dayKey, describeDay } from "../../domain/time.ts";
import { getRepo, loadConfig } from "../repoClient.ts";
import { todayKey } from "../files.ts";
import { useApp } from "../store.ts";
import { t, statusLabel } from "../i18n.ts";

export function SearchPage() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [detail, setDetail] = useState<WordWithSenses | null>(null);
  const [newSense, setNewSense] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [boundary, setBoundary] = useState(4);

  const bumpStats = useApp((s) => s.bumpStats);

  useEffect(() => {
    void (async () => {
      const cfg = await loadConfig();
      setBoundary(cfg.dayBoundaryHour);
    })();
  }, []);

  const search = useCallback(async (term: string) => {
    const repo = await getRepo();
    const rows = await repo.search(term, { limit: 100 });
    setHits(rows);
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void search(q);
    }, 120);
    return () => window.clearTimeout(id);
  }, [q, search]);

  const openDetail = async (id: number) => {
    const repo = await getRepo();
    const w = await repo.getWordById(id);
    setDetail(w);
    setNewSense("");
    setNote(null);
  };

  const addSense = async () => {
    if (!detail || newSense.trim() === "") return;
    const repo = await getRepo();
    await repo.addSense(detail.id, newSense.trim(), "manual");
    await openDetail(detail.id);
    setNewSense("");
    setNote("已添加。");
  };

  const reset = async () => {
    if (!detail) return;
    const repo = await getRepo();
    await repo.resetWord(detail.id, new Date());
    await openDetail(detail.id);
    setNote(t.searchPage.resetDone);
    bumpStats();
  };

  if (detail !== null) {
    const today = todayKey(boundary);
    const dueDay = detail.fsrs_due === null ? null : dayKey(new Date(detail.fsrs_due), boundary);
    return (
      <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 overflow-auto px-8 py-8">
        <button
          type="button"
          onClick={() => setDetail(null)}
          className="self-start text-sm text-paper-dim hover:text-accent"
        >
          ← {t.searchPage.back}
        </button>

        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-light text-paper">{detail.headword}</span>
          <span className="text-xs text-paper-dim">{statusLabel(detail.status)}</span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm text-paper-dim">
          <div>
            {t.searchPage.lastReview}：
            {detail.fsrs_last_review === null
              ? t.searchPage.never
              : dayKey(new Date(detail.fsrs_last_review), boundary)}
          </div>
          <div>
            {t.searchPage.nextDue}：{dueDay === null ? "—" : describeDay(dueDay, today)}
          </div>
          <div>复习次数：{detail.fsrs_reps}</div>
          <div>遗忘次数：{detail.fsrs_lapses}</div>
        </div>

        <div className="mt-2">
          <div className="text-sm font-medium text-paper">
            {t.searchPage.detail}
          </div>
          <ul className="mt-2 space-y-1">
            {detail.senses.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <span className="text-paper">{s.meaning_cn}</span>
                {s.layer === 2 && (
                  <span className="rounded border border-ink-line px-1.5 py-0.5 text-[10px] text-paper-dim">
                    {t.review.supplement}
                  </span>
                )}
                {s.origin === "ai" && (
                  <span className="text-[10px] text-paper-dim/70">AI</span>
                )}
              </li>
            ))}
            {detail.senses.length === 0 && (
              <li className="text-sm text-paper-dim">（无释义）</li>
            )}
          </ul>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <input
            value={newSense}
            onChange={(e) => setNewSense(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addSense();
            }}
            placeholder={t.searchPage.addSensePlaceholder}
            className="rounded-md border border-ink-line bg-ink-soft px-3 py-2 text-sm text-paper outline-none placeholder:text-paper-dim/50 focus:border-accent"
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void addSense()}
              className="rounded-md border border-ink-line px-4 py-2 text-sm text-paper hover:border-accent hover:text-accent"
            >
              {t.searchPage.add}
            </button>
            <button
              type="button"
              onClick={() => void reset()}
              className="rounded-md border border-ink-line px-4 py-2 text-sm text-paper-dim hover:border-accent hover:text-accent"
            >
              {t.searchPage.reset}
            </button>
          </div>
          {note !== null && <div className="text-xs text-accent">{note}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 px-8 py-8">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t.searchPage.placeholder}
        autoFocus
        className="rounded-md border border-ink-line bg-ink-soft px-4 py-2.5 text-sm text-paper outline-none placeholder:text-paper-dim/50 focus:border-accent"
      />

      {hits === null ? (
        <div className="text-sm text-paper-dim">{t.common.loading}</div>
      ) : hits.length === 0 ? (
        <div className="text-sm text-paper-dim">
          {q.trim() === "" ? t.searchPage.empty : t.searchPage.noResult}
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-ink-line overflow-auto rounded-lg border border-ink-line">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => void openDetail(h.id)}
                className="flex w-full items-baseline gap-3 px-4 py-3 text-left transition hover:bg-ink-soft"
              >
                <span className="w-42 shrink-0 truncate text-paper">{h.headword}</span>
                <span className="flex-1 truncate text-sm text-paper-dim">{h.firstMeaning}</span>
                <span className="shrink-0 text-xs text-paper-dim/70">{statusLabel(h.status)}</span>
                <span className="w-28 shrink-0 text-right text-xs tabular-nums text-paper-dim/70">
                  {h.lastReviewDay ?? t.searchPage.never}
                </span>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-paper-dim/50">
                  {h.fsrs_due_day ?? "—"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
