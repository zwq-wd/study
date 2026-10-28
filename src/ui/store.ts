/**
 * 应用级状态（Zustand 只放会话态，§7.1）。
 *
 * 页面切换不用路由库：Tauri 单窗口，一个 page 字段就够（§2.2）。
 */
import { create } from "zustand";
import type { SchedulerConfig } from "../domain/scheduler/config.ts";
import { DEFAULT_CONFIG } from "../domain/scheduler/config.ts";

export type Page = "home" | "review" | "import" | "search" | "settings";

interface AppState {
  page: Page;
  setPage: (p: Page) => void;

  /** 复习页字号档位 0/1/2 → 32/40/52 px */
  fontSizeIndex: number;
  cycleFontSize: () => void;

  /** 当前排程配置（设置页改完要刷新首页） */
  config: SchedulerConfig;
  setConfig: (c: SchedulerConfig) => void;

  /** 首页数据版本号，任何会改变统计的操作后 +1 触发重取 */
  statsVersion: number;
  bumpStats: () => void;

  /** 复习页要「一次性看完」 */
  includeAll: boolean;
  setIncludeAll: (v: boolean) => void;
}

export const useApp = create<AppState>((set) => ({
  page: "home",
  setPage: (page) => set({ page }),

  fontSizeIndex: 1,
  cycleFontSize: () => set((s) => ({ fontSizeIndex: (s.fontSizeIndex + 1) % 3 })),

  config: DEFAULT_CONFIG,
  setConfig: (config) => set({ config }),

  statsVersion: 0,
  bumpStats: () => set((s) => ({ statsVersion: s.statsVersion + 1 })),

  includeAll: false,
  setIncludeAll: (includeAll) => set({ includeAll }),
}));
