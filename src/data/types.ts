/**
 * 类型定义 —— 数据库行 / 领域对象 / 导出结构。
 * 这里只有类型，没有实现；data 层和 domain 层都依赖它。
 */

/** 词条状态（§8.2） */
export type WordStatus = "learning" | "graduated" | "suspended";

/** 义项层级：1 = 当初录入，2 = 事后补充 */
export type SenseLayer = 1 | 2;

/** 义项来源 */
export type SenseOrigin = "manual" | "ai";

/** words 表的一行（字段名与 DDL 完全一致） */
export interface WordRow {
  id: number;
  headword: string;
  norm: string;
  phonetic: string | null;
  source: string | null;
  note: string | null;
  example_json: string | null;
  status: WordStatus;
  fsrs_state: number;
  fsrs_due: number | null;
  fsrs_due_day: string | null;
  fsrs_stability: number;
  fsrs_difficulty: number;
  fsrs_reps: number;
  fsrs_lapses: number;
  fsrs_scheduled_days: number;
  fsrs_last_review: number | null;
  created_at: number;
  updated_at: number;
}

/** senses 表的一行 */
export interface SenseRow {
  id: number;
  word_id: number;
  meaning_cn: string;
  layer: number;
  origin: string;
  sort: number;
  created_at: number;
}

/** 词条 + 它的义项（UI 主要用这个） */
export interface WordWithSenses extends WordRow {
  senses: SenseRow[];
}

/** 查询页一行要显示的东西（§4.2） */
export interface SearchHit extends WordRow {
  /** 首条 L1 释义 */
  firstMeaning: string;
  /** 最后复习日期 YYYY-MM-DD，没复习过为 null */
  lastReviewDay: string | null;
}

/** 首页四块信息（§4.4） */
export interface HomeStats {
  total: number;
  learning: number;
  graduated: number;
  dueToday: number;
  /** 到期但本次排不进来、留到下次的 */
  deferred: number;
  /** 下次到期最早是几天后；null = 队列里没有将来会到期的词 */
  nextDueInDays: number | null;
  /** 到期里逾期最久的天数，0 表示没有逾期的 */
  maxOverdueDays: number;
}

/** 导入结果的一份统计（§9.3 预览摘要） */
export interface ImportSummary {
  /** 有效行数 */
  totalRows: number;
  newWords: number;
  appendSenses: number;
  duplicates: number;
  noMeaning: number;
  errors: number;
}

/** 单行在库里的落法 */
export type ImportAction = "new" | "append" | "duplicate" | "error";

export interface ImportLineDecision {
  lineNo: number;
  raw: string;
  headword: string;
  norm: string;
  meanings: string[];
  action: ImportAction;
  /** 已存在时给的出现位置提示，如「已存在，最后复习于 2026-10-20」 */
  note?: string;
  /** 疑似重复时给的建议（提示，不自动改） */
  similarTo?: string;
}

export interface ImportPlan {
  decisions: ImportLineDecision[];
  summary: ImportSummary;
  /** 解析期就失败的行 */
  parseErrors: Array<{ lineNo: number; raw: string; reason: string }>;
}

/** 导出结构（§9.4） */
export interface ExportSense {
  meaningCn: string;
  layer: SenseLayer;
  origin: SenseOrigin;
}

export interface ExportFsrs {
  state: number;
  due: number | null;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  scheduledDays: number;
  lastReview: number | null;
}

export interface ExportWord {
  headword: string;
  norm: string;
  phonetic: string | null;
  source: string | null;
  note: string | null;
  status: WordStatus;
  senses: ExportSense[];
  fsrs: ExportFsrs;
}

export interface ExportBundle {
  version: 1;
  exportedAt: string;
  settings: Record<string, string | number | boolean>;
  words: ExportWord[];
}

/** 导入模式（§4.6） */
export type ImportMode = "merge" | "replace";
