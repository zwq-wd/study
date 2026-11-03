/**
 * Repository 接口（开发文档 §7.4）
 *
 * **只定义，不实现。** ui/ 只依赖这个接口；
 * 测试时用 InMemoryRepo 实现，不需要真数据库。
 */
import type { Rating } from "ts-fsrs";
import type {
  ExportBundle,
  HomeStats,
  ImportMode,
  ImportPlan,
  SearchHit,
  SenseOrigin,
  WordRow,
  WordWithSenses,
} from "../data/types.ts";

export interface ImportCommitResult {
  insertedWords: number;
  appendedSenses: number;
  skipped: number;
}

export interface SettleResult {
  nextDueDay: string;
  graduated: boolean;
}

export interface SessionPlan {
  /** 本次排入的卡 */
  picked: WordRow[];
  /** 到期总数 */
  dueTotal: number;
  /** 顺延数 */
  deferred: number;
}

export interface Repo {
  // ---------- 复习 ----------
  /** 取所有到期的词条，已按 §5.4 排好序 */
  listDue(today: string): Promise<WordRow[]>;
  countDue(today: string): Promise<number>;
  /** 单卡结算：写 words + review_logs，一个事务 */
  settleWord(wordId: number, rating: Rating, now: Date, sessionId: string | null): Promise<SettleResult>;
  /**
   * 「今天背错了」的词。给「重新复习」用，**只读**，不结算、不写日志。
   * 时间区间按 day_boundary_hour 划，不是 00:00。
   */
  listMissedToday(today: string): Promise<WordRow[]>;

  // ---------- 录入 ----------
  /** 解析 + 比对已有词条，产出预览；不写库 */
  planImport(raw: string, now: Date): Promise<ImportPlan>;
  /** 按预览落库；新词入库即计一次 Good */
  commitImport(plan: ImportPlan, now: Date): Promise<ImportCommitResult>;

  // ---------- 查询 ----------
  search(q: string, opts?: { status?: string; limit?: number }): Promise<SearchHit[]>;
  getWordByNorm(norm: string): Promise<WordWithSenses | null>;
  getWordById(id: number): Promise<WordWithSenses | null>;

  // ---------- 维护 ----------
  addSense(wordId: number, meaningCn: string, origin: SenseOrigin): Promise<void>;
  updateWord(wordId: number, patch: Partial<WordRow>): Promise<void>;
  /** 重新激活：重置为 New + 立即排入下次会话 */
  resetWord(wordId: number, now: Date): Promise<void>;

  // ---------- 备份 ----------
  exportAll(): Promise<ExportBundle>;
  importAll(bundle: ExportBundle, mode: ImportMode): Promise<ImportCommitResult>;

  // ---------- 统计 ----------
  stats(today: string): Promise<HomeStats>;
  /** 距上次备份多少天；null = 从未备份 */
  daysSinceBackup(now: Date): Promise<number | null>;
  markBackupDone(now: Date): Promise<void>;

  // ---------- 设置 ----------
  loadSettings(): Promise<Record<string, string>>;
  saveSettings(patch: Record<string, string>): Promise<void>;

  // ---------- 会话 ----------
  startSession(id: string, now: Date, planned: number, deferred: number): Promise<void>;
  updateSession(id: string, patch: { shown?: number; again?: number }): Promise<void>;
  endSession(id: string, now: Date): Promise<void>;
}
