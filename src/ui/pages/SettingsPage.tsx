/**
 * 设置页（开发文档 §4.5 / §9.5）
 *
 * 表格形式，每项一行：名称 / 当前值 / 说明 / 修改。
 * 参数改了要立刻落库，并且首页的到期数会跟着变（session_limit 影响顺延）。
 */
import { useEffect, useState } from "react";
import {
  DEFAULT_CONFIG,
  SETTING_META,
  normalizeConfig,
  type SchedulerConfig,
} from "../../domain/scheduler/config.ts";
import type { Difficulty } from "../../domain/game/types.ts";
import { parseBundleText, toCsv } from "../../domain/export.ts";
import { getRepo, loadConfig } from "../repoClient.ts";
import { openTextFile, saveTextFile, todayKey } from "../files.ts";
import { useApp } from "../store.ts";
import { t } from "../i18n.ts";
import { AiSettingsSection } from "./AiSettingsSection.tsx";

/**
 * 游戏模式的设置键。和 GamePage 里读写的完全是同一对键，
 * 所以这里改完，回游戏页（或重开一局）立刻生效。
 */
const GAME_DIFFICULTY_KEY = "game_difficulty";
const GAME_SOUND_KEY = "game_sound";

/** settings 表里存的是字符串，读回来要当成 unknown 再收窄，不能直接信。 */
function parseGameDifficulty(v: string | undefined): Difficulty {
  return v === "easy" || v === "hard" ? v : "normal";
}

export function SettingsPage() {
  const [cfg, setCfg] = useState<SchedulerConfig | null>(null);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gameDifficulty, setGameDifficulty] = useState<Difficulty>("normal");
  const [gameSound, setGameSound] = useState(false);
  // 和上面的 saved 分开：那个是排程参数改动的提示，别串到这一组来
  const [gameSaved, setGameSaved] = useState(false);

  const setStoreConfig = useApp((s) => s.setConfig);
  const bumpStats = useApp((s) => s.bumpStats);

  useEffect(() => {
    void (async () => {
      const c = await loadConfig();
      setCfg(c);
      setStoreConfig(c);
    })();
  }, [setStoreConfig]);

  // 游戏模式的偏好和排程参数不是一回事（存的是字符串、不参与 normalize），单独读一次
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const repo = await getRepo();
        const rows = await repo.loadSettings();
        if (!alive) return;
        setGameDifficulty(parseGameDifficulty(rows[GAME_DIFFICULTY_KEY]));
        setGameSound(rows[GAME_SOUND_KEY] === "1");
      } catch {
        // 读不到就用默认值，不打断设置页
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const patch = async (key: keyof SchedulerConfig, value: number | boolean) => {
    if (!cfg) return;
    const next = normalizeConfig({ ...cfg, [key]: value });
    setCfg(next);
    setStoreConfig(next);

    const repo = await getRepo();
    await repo.saveSettings({ [settingKeyOf(key)]: String(value) });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
    bumpStats();
  };

  /** 游戏偏好不走 normalizeConfig —— 它不在 SchedulerConfig 里，也不影响排程。 */
  const saveGameSetting = async (row: Record<string, string>) => {
    const repo = await getRepo();
    await repo.saveSettings(row);
    setGameSaved(true);
    window.setTimeout(() => setGameSaved(false), 1200);
  };

  const chooseDifficulty = (d: Difficulty) => {
    setGameDifficulty(d);
    void saveGameSetting({ [GAME_DIFFICULTY_KEY]: d });
  };

  const toggleSound = () => {
    const next = !gameSound;
    setGameSound(next);
    void saveGameSetting({ [GAME_SOUND_KEY]: next ? "1" : "0" });
  };

  const exportJson = async () => {
    setBusy(true);
    setError(null);
    try {
      const repo = await getRepo();
      const bundle = await repo.exportAll();
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const path = await saveTextFile(JSON.stringify(bundle, null, 2), {
        defaultName: `wordpacer-${stamp}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (path !== null) {
        await repo.markBackupDone(new Date());
        bumpStats();
        setMessage(`${t.settingsPage.exportDone} ${path}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    setBusy(true);
    setError(null);
    try {
      const repo = await getRepo();
      const hits = await repo.search("", { limit: 200 });
      const csv = toCsv(
        hits.map((h) => ({
          headword: h.headword,
          meanings: [h.firstMeaning].filter((m) => m !== ""),
          status: h.status,
          dueDay: h.fsrs_due_day ?? "",
          reps: h.fsrs_reps,
          lapses: h.fsrs_lapses,
        })),
      );
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      await saveTextFile(csv, {
        defaultName: `wordpacer-${stamp}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      setMessage(t.settingsPage.exportDone);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const importJson = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const picked = await openTextFile({ filters: [{ name: "JSON", extensions: ["json"] }] });
      if (picked === null) return;

      const bundle = parseBundleText(picked.text);
      const confirmed = window.confirm(
        `${t.settingsPage.replaceWarning}\n\n${t.settingsPage.merge}\n\n→ 点「确定」= 合并；点「取消」则中止。`,
      );
      // 用两次确认来实现 replace 模式：第一次确定合并，第二次才问替换
      let mode: "merge" | "replace" = "merge";
      if (confirmed) {
        const replaceIt = window.confirm(t.settingsPage.confirmReplace);
        if (replaceIt) mode = "replace";
      } else {
        return;
      }

      const repo = await getRepo();
      const r = await repo.importAll(bundle, mode);
      setMessage(t.settingsPage.importDone(r.insertedWords, r.skipped));
      const c = await loadConfig();
      setCfg(c);
      setStoreConfig(c);
      bumpStats();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (cfg === null) {
    return <div className="flex h-full items-center justify-center text-paper-dim">{t.common.loading}</div>;
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-6 overflow-auto px-8 py-8">
      <div className="flex items-baseline justify-between">
        <div className="text-base font-medium text-paper">{t.settingsPage.title}</div>
        {saved && (
          <span className="text-xs text-accent transition-opacity">{t.settingsPage.saved}</span>
        )}
      </div>

      <div className="@container divide-y divide-ink-line/60 overflow-hidden rounded-lg border border-line-strong">
        {SETTING_META.map((m) => {
          const value = cfg[m.key];
          return (
            <div key={m.key} className="grid grid-cols-1 gap-x-4 gap-y-1.5 px-4 py-3.5 @[560px]:grid-cols-[8rem_6rem_1fr] @[560px]:items-start @[560px]:gap-y-0">
              <div className="text-sm text-paper">{m.label}</div>
              <div className="text-sm tabular-nums text-accent">
                <input
                  type="number"
                  step={m.key === "requestRetention" ? 0.01 : 1}
                  value={String(value)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) void patch(m.key, n);
                  }}
                  className="input w-20 px-2 py-1"
                />
                {m.unit !== "" && <span className="ml-1 text-xs text-paper-dim">{m.unit}</span>}
              </div>
              <div className="text-xs leading-5 text-paper-dim">
                {m.describe}
                <span className="ml-2 text-paper-faint">（{m.range}）</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            void (async () => {
              setCfg(DEFAULT_CONFIG);
              setStoreConfig(DEFAULT_CONFIG);
              const repo = await getRepo();
              const rows: Record<string, string> = {};
              for (const m of SETTING_META) {
                rows[settingKeyOf(m.key)] = String(DEFAULT_CONFIG[m.key]);
              }
              await repo.saveSettings(rows);
              bumpStats();
              setSaved(true);
              window.setTimeout(() => setSaved(false), 1200);
            })();
          }}
          className="btn-ghost"
        >
          {t.settingsPage.reset}
        </button>
      </div>

      <div className="mt-2">
        <div className="text-sm text-paper">{t.settingsPage.dataTitle}</div>
        <p className="mt-1 text-xs leading-5 text-paper-dim">
          单机无服务 = 硬盘坏、系统重装就全丢。这是唯一的数据保险。
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportJson()}
            className="btn-primary disabled:opacity-40"
          >
            {t.settingsPage.exportJson}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportCsv()}
            className="btn-ghost disabled:opacity-40"
          >
            {t.settingsPage.exportCsv}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void importJson()}
            className="btn-ghost disabled:opacity-40"
          >
            {t.settingsPage.importJson}
          </button>
        </div>
        {message !== null && (
          <div className="mt-2 break-all text-xs text-accent">{message}</div>
        )}
        {error !== null && <div className="mt-2 text-xs text-danger">{error}</div>}

        <div className="mt-6 text-xs leading-5 text-paper-faint">
          <div className="text-paper-dim">{t.settingsPage.dataLocation}</div>
          <div className="mt-1 font-mono">%APPDATA%\com.wordpacer.app\wordpacer.db</div>
          <div className="mt-3">
            卸载不会删数据。备份：每周点一次「导出 JSON」，存到网盘或另一块盘。
          </div>
        </div>

        <AiSettingsSection />

        {/* ─── 游戏模式 ───────────────────────────────────────────────
            放在最后，和排程参数、AI 都分开：它不影响排程，也不写复习记录。
            控件沿用本页既有那套（switch 用 role="switch" + aria-checked，
            三选一用 btn-ghost 表示选中），不另造一套。 */}
        <div className="mt-8">
          <div className="flex items-baseline justify-between">
            <div className="text-sm text-paper">{t.game.settingsTitle}</div>
            {gameSaved && <span className="text-xs text-accent">{t.settingsPage.saved}</span>}
          </div>
          {/* 这句必须写：不然用户会以为玩游戏等于复习过了 */}
          <p className="mt-1 text-xs leading-5 text-paper-dim">{t.game.settingsHint}</p>

          <div className="@container mt-3 divide-y divide-ink-line/60 overflow-hidden rounded-lg border border-line-strong">
            {/* 默认难度 */}
            <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 px-4 py-3.5 @[560px]:grid-cols-[8rem_auto_1fr] @[560px]:items-start @[560px]:gap-y-0">
              <div className="text-sm text-paper">{t.game.defaultDifficulty}</div>
              <div className="flex items-center gap-2">
                {(["easy", "normal", "hard"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={gameDifficulty === d}
                    onClick={() => chooseDifficulty(d)}
                    className={
                      gameDifficulty === d
                        ? "btn-ghost border-accent px-2 py-0.5 text-xs text-accent"
                        : "btn-ghost px-2 py-0.5 text-xs text-paper-dim"
                    }
                  >
                    {t.game.difficulty[d]}
                  </button>
                ))}
              </div>
              <div className="text-xs leading-5 text-paper-dim">
                {t.game.difficultyDesc[gameDifficulty]}
              </div>
            </div>

            {/* 音效 */}
            <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 px-4 py-3.5 @[560px]:grid-cols-[8rem_6rem_1fr] @[560px]:items-start @[560px]:gap-y-0">
              <div className="text-sm text-paper">{t.game.soundToggle}</div>
              <div className="text-sm text-accent">
                <button
                  type="button"
                  role="switch"
                  aria-checked={gameSound}
                  aria-label={t.game.soundToggle}
                  onClick={toggleSound}
                  className={`relative h-5 w-9 rounded-full border transition-colors ${
                    gameSound ? "border-accent bg-accent/25" : "border-ink-line bg-well"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
                      gameSound ? "left-[18px] bg-accent" : "left-0.5 bg-paper-faint"
                    }`}
                  />
                </button>
              </div>
              <div className="text-xs leading-5 text-paper-dim">{t.game.soundToggleDesc}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function settingKeyOf(key: keyof SchedulerConfig): string {
  const map: Record<keyof SchedulerConfig, string> = {
    requestRetention: "request_retention",
    sessionLimit: "session_limit",
    maximumInterval: "maximum_interval",
    graduateInterval: "graduate_interval",
    minRepsToGraduate: "min_reps_to_graduate",
    graduationOnLapses: "graduation_on_lapses",
    dayBoundaryHour: "day_boundary_hour",
  };
  return map[key];
}

/** 供首页 / 备份提醒复用。 */
export function computeTodayKey(boundaryHour: number): string {
  return todayKey(boundaryHour);
}
