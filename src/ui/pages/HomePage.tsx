/**
 * 首页（开发文档 §4.4 / §9.1）
 *
 * 只有一个屏，四块信息，都不带情绪装饰：
 *   今日到期 / 顺延中 / 词库 / 下次到期最早
 *
 * 无图表、无热力图、无连击。「今日到期」数字是唯一醒目的元素。
 * 队列为空时显示「今天没有到期。」+ 一个「录入新词」按钮。
 */
import { useEffect, useState } from "react";
import type { HomeStats } from "../../data/types.ts";
import { describeDay } from "../../domain/time.ts";
import { getRepo, loadConfig } from "../repoClient.ts";
import { todayKey } from "../files.ts";
import { useApp } from "../store.ts";
import { t } from "../i18n.ts";

export function HomePage() {
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [backupDays, setBackupDays] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statsVersion = useApp((s) => s.statsVersion);
  const bumpStats = useApp((s) => s.bumpStats);
  const setPage = useApp((s) => s.setPage);
  const setIncludeAll = useApp((s) => s.setIncludeAll);
  const setConfig = useApp((s) => s.setConfig);
  const config = useApp((s) => s.config);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const cfg = await loadConfig();
        if (!alive) return;
        setConfig(cfg);

        const repo = await getRepo();
        const today = todayKey(cfg.dayBoundaryHour);
        const s = await repo.stats(today);
        if (!alive) return;
        setStats(s);
        setBackupDays(await repo.daysSinceBackup(new Date()));
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [statsVersion, setConfig]);

  if (error !== null) {
    return (
      <div className="p-8 text-paper-dim">
        {t.common.error}：{error}
      </div>
    );
  }

  if (stats === null) {
    return <div className="p-8 text-paper-dim">{t.common.loading}</div>;
  }

  const startReview = (all: boolean) => {
    setIncludeAll(all);
    setPage("review");
  };

  const dueText = stats.nextDueInDays === null ? null : describeDay(
    addDaysFromToday(stats.nextDueInDays),
    todayKey(config.dayBoundaryHour),
  );

  const showBackup = backupDays === null || backupDays > 7;

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col justify-center gap-10 px-10 py-12">
      <div className="space-y-6">
        {/* 今日到期 —— 唯一醒目的元素 */}
        <div className="flex items-end justify-between border-b border-ink-line pb-6">
          <div>
            <div className="text-sm tracking-wide text-paper-dim">{t.home.dueLabel}</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-6xl font-light tabular-nums text-accent">
                {stats.dueToday}
              </span>
              <span className="text-lg text-paper-dim">{t.home.unit}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button
              type="button"
              onClick={() => startReview(false)}
              disabled={stats.dueToday === 0}
              className="rounded-md bg-accent px-6 py-3 text-base font-medium text-ink transition hover:bg-accent-dim disabled:cursor-default disabled:bg-ink-line disabled:text-paper-dim"
            >
              {t.home.startReview}
            </button>
            {stats.deferred > 0 && (
              <button
                type="button"
                onClick={() => startReview(true)}
                className="text-sm text-paper-dim underline-offset-4 hover:text-accent hover:underline"
              >
                {t.home.reviewAll}
              </button>
            )}
          </div>
        </div>

        {/* 顺延中 */}
        {stats.deferred > 0 && (
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-paper-dim">{t.home.deferredLabel}</span>
            <span className="tabular-nums text-paper">
              {stats.deferred} {t.home.unit}
            </span>
          </div>
        )}

        {/* 词库 */}
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-paper-dim">{t.home.libraryLabel}</span>
          <span className="tabular-nums text-paper">
            {stats.total.toLocaleString()} {t.home.wordUnit} · {t.home.learningCount}{" "}
            {stats.learning.toLocaleString()} · {t.home.graduatedCount}{" "}
            {stats.graduated.toLocaleString()}
          </span>
        </div>

        {/* 下次到期最早 */}
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-paper-dim">{t.home.nextDueLabel}</span>
          <span className="tabular-nums text-paper">
            {stats.nextDueInDays === null ? "—" : dueText}
          </span>
        </div>
      </div>

      {/* 空队列：只给一句话 + 一个入口，不加任何催促文案 */}
      {stats.dueToday === 0 && (
        <div className="rounded-lg border border-ink-line px-6 py-8 text-center">
          <div className="text-paper-dim">{t.home.emptyQueue}</div>
          <button
            type="button"
            onClick={() => setPage("import")}
            className="mt-5 rounded-md border border-ink-line px-5 py-2 text-sm text-paper transition hover:border-accent hover:text-accent"
          >
            {t.home.importWords}
          </button>
        </div>
      )}

      {showBackup && (
        <button
          type="button"
          onClick={() => setPage("settings")}
          className="self-start text-xs text-paper-dim underline-offset-4 hover:text-accent hover:underline"
        >
          {backupDays === null ? t.home.neverBackedUp : t.home.backupReminder(backupDays)}
        </button>
      )}

      <div className="flex gap-3 text-sm">
        <button
          type="button"
          onClick={() => setPage("import")}
          className="rounded-md border border-ink-line px-4 py-2 text-paper transition hover:border-accent hover:text-accent"
        >
          {t.nav.import}
        </button>
        <button
          type="button"
          onClick={() => setPage("search")}
          className="rounded-md border border-ink-line px-4 py-2 text-paper transition hover:border-accent hover:text-accent"
        >
          {t.nav.search}
        </button>
        <button
          type="button"
          onClick={() => {
            bumpStats();
          }}
          className="ml-auto text-paper-dim underline-offset-4 hover:text-accent hover:underline"
        >
          刷新
        </button>
      </div>
    </div>
  );
}

/** 把「N 天后」换成一个日键，只为了复用 describeDay 的措辞。 */
function addDaysFromToday(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}
