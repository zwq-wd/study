/**
 * repo 单例 + 平台能力封装。
 *
 * ui/ 只依赖 Repo 接口与本文件；换外壳（Electron）时只换这一层（§13 R1）。
 */
import { SqliteRepo } from "../data/sqlite/repo.ts";
import type { Repo } from "../data/repo.ts";
import { TauriAiClient } from "../data/ai/client.ts";

let repoPromise: Promise<Repo> | null = null;
let aiPromise: Promise<TauriAiClient> | null = null;

export function getRepo(): Promise<Repo> {
  if (!repoPromise) {
    repoPromise = (async () => {
      const repo = new SqliteRepo();
      await repo.init();
      return repo;
    })();
  }
  return repoPromise;
}

/** 首页与设置页都要用的「当前配置」。 */
export async function loadConfig() {
  const repo = await getRepo();
  const r = repo as SqliteRepo;
  return r.config();
}

/**
 * AI 校对客户端。设置存储复用同一个 Repo ——
 * Key 和排程参数存在同一张 settings 表里，导出时一起被剔除。
 */
export function getAiClient(): Promise<TauriAiClient> {
  if (!aiPromise) {
    aiPromise = (async () => {
      const repo = await getRepo();
      return new TauriAiClient(repo);
    })();
  }
  return aiPromise;
}

export type { Repo };
