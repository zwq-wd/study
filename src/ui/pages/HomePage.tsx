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
  const [missedCount, setMissedCount] = useState(0);
  const [todayCount, setTodayCount] = useState(0);
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
        const missed = await repo.listMissedToday(today);
        // 今日新词和「重新复习」来自同一天的同一批查库动作，合成一次读
        const todayNew = await repo.listTodayNewWords(today);
        if (!alive) return;
        setStats(s);
        setMissedCount(missed.length);
        setTodayCount(todayNew.length);
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
    <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-8 px-10 py-12">
      <div className="space-y-6">
        {/* 今日到期 —— 唯一醒目的元素 */}
        <div className="flex items-end justify-between border-b border-ink-line/70 pb-7">
          <div>
            <div className="text-xs tracking-[0.18em] text-paper-dim">{t.home.dueLabel}</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span
                className="text-7xl font-extralight tabular-nums leading-none text-accent"
                style={{ textShadow: "0 0 32px rgba(217, 180, 95, 0.18)" }}
              >
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
              className="btn-primary px-6 py-3 text-base"
            >
              {t.home.startReview}
            </button>
            {stats.deferred > 0 && (
              <button
                type="button"
                onClick={() => startReview(true)}
                className="btn-link"
              >
                {t.home.reviewAll}
              </button>
            )}
          </div>
        </div>

        <div className="space-y-3 border-l border-ink-line/50 pl-4">
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
      </div>

      {/* 空队列：只给一句话 + 一个入口，不加任何催促文案 */}
      {stats.dueToday === 0 && (
        <div className="panel px-6 py-8 text-center">
          <div className="text-paper-dim">{t.home.emptyQueue}</div>
          <button
            type="button"
            onClick={() => setPage("import")}
            className="btn-ghost mt-5"
          >
            {t.home.importWords}
          </button>
        </div>
      )}

      {showBackup && (
        <button
          type="button"
          onClick={() => setPage("settings")}
          className="btn-link self-start text-xs"
        >
          {backupDays === null ? t.home.neverBackedUp : t.home.backupReminder(backupDays)}
        </button>
      )}

      {/* 今天背错了的词：只在这一块出现，队列为空时也在 —— 那正是最想再看一眼的时候 */}
      {missedCount > 0 && (
        <div className="panel flex items-center justify-between px-6 py-5">
          <div>
            <div className="text-sm text-paper">{t.rereview.title}</div>
            <div className="mt-1 text-xs text-paper-faint">{t.rereview.homeHint}</div>
          </div>
          <button
            type="button"
            onClick={() => setPage("rereview")}
            className="btn-ghost shrink-0"
          >
            {t.rereview.entry(missedCount)}
          </button>
        </div>
      )}

      {/* 今天录入的词：紧跟在「重新复习」下面 —— 两者是同一件事的两个入口 */}
      {todayCount > 0 && (
        <div className="panel flex items-center justify-between px-6 py-5">
          <div>
            <div className="text-sm text-paper">{t.todayWords.title}</div>
            <div className="mt-1 text-xs text-paper-faint">{t.todayWords.homeHint}</div>
          </div>
          <button
            type="button"
            onClick={() => setPage("today")}
            className="btn-ghost shrink-0"
          >
            {t.todayWords.entry(todayCount)}
          </button>
        </div>
      )}

      <div className="flex gap-3 text-sm">
        <button
          type="button"
          onClick={() => setPage("import")}
          className="btn-ghost text-paper"
        >
          {t.nav.import}
        </button>
        <button
          type="button"
          onClick={() => setPage("search")}
          className="btn-ghost text-paper"
        >
          {t.nav.search}
        </button>
        <button
          type="button"
          onClick={() => {
            bumpStats();
          }}
          className="btn-link ml-auto"
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
