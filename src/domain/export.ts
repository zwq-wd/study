/**
 * 导出 / 导入结构（开发文档 §4.6 / §9.4）
 *
 * 导出：一个 .json 文件，含全部词条 + 全部义项 + 全部设置（**不含 API Key**）。
 * 导入：merge（按 norm 合并，冲突以导入文件的「更新」为准）/ replace（清空后导入）。
 *
 * 跨边界的东西一律 unknown + 手写 parse，不许 as。
 */
import type {
  ExportBundle,
  ExportSense,
  ExportWord,
  SenseLayer,
  SenseOrigin,
  WordStatus,
} from "../data/types.ts";

export const EXPORT_VERSION = 1;

export interface BundleSourceWord {
  headword: string;
  norm: string;
  phonetic: string | null;
  source: string | null;
  note: string | null;
  status: WordStatus;
  senses: Array<{ meaningCn: string; layer: number; origin: string }>;
  fsrs: {
    state: number;
    due: number | null;
    stability: number;
    difficulty: number;
    reps: number;
    lapses: number;
    scheduledDays: number;
    lastReview: number | null;
  };
}

export interface BundleSource {
  exportedAt: string;
  settings: Record<string, string | number | boolean>;
  words: BundleSourceWord[];
}

/** 组装导出包（纯函数，时间由调用方给）。 */
export function buildBundle(src: BundleSource): ExportBundle {
  const words: ExportWord[] = src.words.map((w) => {
    const senses: ExportSense[] = w.senses.map((s) => ({
      meaningCn: s.meaningCn,
      layer: (s.layer === 2 ? 2 : 1) as SenseLayer,
      origin: (s.origin === "ai" ? "ai" : "manual") as SenseOrigin,
    }));
    return {
      headword: w.headword,
      norm: w.norm,
      phonetic: w.phonetic,
      source: w.source,
      note: w.note,
      status: w.status,
      senses,
      fsrs: { ...w.fsrs },
    };
  });

  return {
    version: EXPORT_VERSION,
    exportedAt: src.exportedAt,
    settings: { ...src.settings },
    words,
  };
}

// ---------------------------------------------------------------- parse

class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleError";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown, field: string): string {
  if (typeof v !== "string") throw new BundleError(`字段 ${field} 应为字符串`);
  return v;
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asNumberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asStatus(v: unknown): WordStatus {
  return v === "graduated" || v === "suspended" ? v : "learning";
}

function asLayer(v: unknown): SenseLayer {
  return v === 2 ? 2 : 1;
}

function asOrigin(v: unknown): SenseOrigin {
  return v === "ai" ? "ai" : "manual";
}

/**
 * 校验并还原一个导出包。任何结构问题都抛 BundleError —— 半个 schema 比崩掉更危险。
 */
export function parseBundle(input: unknown): ExportBundle {
  if (!isRecord(input)) throw new BundleError("文件不是一个 JSON 对象");

  const version = input["version"];
  if (version !== 1) throw new BundleError(`不认识的导出格式版本：${String(version)}`);

  const exportedAt = asString(input["exportedAt"] ?? "", "exportedAt");

  const rawSettings = input["settings"];
  const settings: Record<string, string | number | boolean> = {};
  if (isRecord(rawSettings)) {
    for (const [k, v] of Object.entries(rawSettings)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        settings[k] = v;
      }
    }
  }

  const rawWords = input["words"];
  if (!Array.isArray(rawWords)) throw new BundleError("字段 words 应为数组");

  const words: ExportWord[] = rawWords.map((w, i) => {
    if (!isRecord(w)) throw new BundleError(`第 ${i + 1} 个词条不是对象`);
    const headword = asString(w["headword"], `words[${i}].headword`);
    const norm = asString(w["norm"], `words[${i}].norm`);

    const rawSenses = w["senses"];
    const senses: ExportSense[] = Array.isArray(rawSenses)
      ? rawSenses
          .filter(isRecord)
          .map((s) => ({
            meaningCn: asString(s["meaningCn"] ?? "", `words[${i}].senses[].meaningCn`),
            layer: asLayer(s["layer"]),
            origin: asOrigin(s["origin"]),
          }))
          .filter((s) => s.meaningCn.trim() !== "")
      : [];

    const rawFsrs = w["fsrs"];
    const fsrs = isRecord(rawFsrs)
      ? {
          state: asNumberOrNull(rawFsrs["state"]) ?? 0,
          due: asNumberOrNull(rawFsrs["due"]),
          stability: asNumberOrNull(rawFsrs["stability"]) ?? 0,
          difficulty: asNumberOrNull(rawFsrs["difficulty"]) ?? 0,
          reps: asNumberOrNull(rawFsrs["reps"]) ?? 0,
          lapses: asNumberOrNull(rawFsrs["lapses"]) ?? 0,
          scheduledDays: asNumberOrNull(rawFsrs["scheduledDays"]) ?? 0,
          lastReview: asNumberOrNull(rawFsrs["lastReview"]),
        }
      : {
          state: 0,
          due: null,
          stability: 0,
          difficulty: 0,
          reps: 0,
          lapses: 0,
          scheduledDays: 0,
          lastReview: null,
        };

    return {
      headword,
      norm,
      phonetic: asStringOrNull(w["phonetic"]),
      source: asStringOrNull(w["source"]),
      note: asStringOrNull(w["note"]),
      status: asStatus(w["status"]),
      senses,
      fsrs,
    };
  });

  return { version: 1, exportedAt, settings, words };
}

/** 从文件文本还原导出包。 */
export function parseBundleText(text: string): ExportBundle {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BundleError("不是合法的 JSON 文件");
  }
  return parseBundle(json);
}

/** CSV（可选导出）：headword,meanings,status,due_day,reps,lapses */
export function toCsv(
  rows: Array<{
    headword: string;
    meanings: string[];
    status: string;
    dueDay: string;
    reps: number;
    lapses: number;
  }>,
): string {
  const esc = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = "headword,meanings,status,due_day,reps,lapses";
  const body = rows.map((r) =>
    [r.headword, r.meanings.join("；"), r.status, r.dueDay, String(r.reps), String(r.lapses)]
      .map(esc)
      .join(","),
  );
  return [head, ...body].join("\r\n");
}
