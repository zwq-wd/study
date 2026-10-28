/**
 * 导入计划的构造（开发文档 §4.1 / §9.3）
 *
 * 纯函数：把 parseInput 的结果 + 现有词库快照，变成一份「每行怎么落库」的计划。
 * 真正的写库在 data 层。
 */
import type {
  ImportLineDecision,
  ImportPlan,
  ImportSummary,
} from "../data/types.ts";
import { parseInput } from "./normalize/parseInput.ts";
import { looksSimilar } from "./normalize/similar.ts";

export interface ExistingWordInfo {
  norm: string;
  headword: string;
  /** 最后复习日 YYYY-MM-DD，null = 从没复习过 */
  lastReviewDay: string | null;
  /** 已有的中文义项（用来判断「追加」到底是不是新意思） */
  meanings: string[];
}

export interface BuildPlanOptions {
  /** 词库现有的 norm + 摘要 */
  existing: readonly ExistingWordInfo[];
  /** 用于「疑似重复」提示的近邻候选（通常就是全部 norm） */
  similarPool?: readonly string[];
}

/** 「已存在，最后复习于 X」这句提示。 */
function formatNote(info: ExistingWordInfo): string {
  if (info.lastReviewDay) return `已存在，最后复习于 ${info.lastReviewDay}`;
  return "已存在，还没有复习记录";
}

export function buildImportPlan(raw: string, opts: BuildPlanOptions): ImportPlan {
  const parsed = parseInput(raw);
  const byNorm = new Map<string, ExistingWordInfo>();
  for (const e of opts.existing) byNorm.set(e.norm, e);

  const similarPool = opts.similarPool ?? opts.existing.map((e) => e.norm);

  const decisions: ImportLineDecision[] = [];
  let newWords = 0;
  let appendSenses = 0;
  let duplicates = 0;
  let noMeaning = 0;

  const handledNorm = new Set<string>();

  for (const line of parsed.lines) {
    const existing = byNorm.get(line.norm);

    // 输入内部重复：同一批里第二次出现同一个 norm，按「重复」处理
    if (handledNorm.has(line.norm)) {
      duplicates++;
      decisions.push({
        lineNo: line.lineNo,
        raw: line.raw,
        headword: line.headword,
        norm: line.norm,
        meanings: line.meanings,
        action: "duplicate",
        note: "本批输入里重复出现",
      });
      continue;
    }
    handledNorm.add(line.norm);

    if (existing) {
      // 已存在：看新意思里有没有库里没有的
      const existingMeanings = new Set(existing.meanings);
      const fresh = line.meanings.filter((m) => !existingMeanings.has(m));

      if (fresh.length === 0) {
        duplicates++;
        decisions.push({
          lineNo: line.lineNo,
          raw: line.raw,
          headword: line.headword,
          norm: line.norm,
          meanings: line.meanings,
          action: "duplicate",
          note: formatNote(existing),
        });
      } else {
        appendSenses++;
        decisions.push({
          lineNo: line.lineNo,
          raw: line.raw,
          headword: line.headword,
          norm: line.norm,
          meanings: fresh,
          action: "append",
          note: formatNote(existing),
        });
      }
      continue;
    }

    // 新词：顺手做一次「疑似重复」提示（仅提示，不自动改）
    let similarTo: string | undefined;
    for (const cand of similarPool) {
      if (looksSimilar(line.norm, cand)) {
        similarTo = cand;
        break;
      }
    }

    if (line.meanings.length === 0) noMeaning++;
    newWords++;

    decisions.push({
      lineNo: line.lineNo,
      raw: line.raw,
      headword: line.headword,
      norm: line.norm,
      meanings: line.meanings,
      action: "new",
      ...(similarTo ? { similarTo } : {}),
      // 同一批里 A 与 B 相互像，提示依然只针对「库里已有」——
      // 这里 similarPool 传的是库内 norm，所以不会误报批内互相像
      note: line.meanings.length === 0 ? "无释义，先建卡" : undefined,
    });
  }

  const summary: ImportSummary = {
    totalRows: decisions.length,
    newWords,
    appendSenses,
    duplicates,
    noMeaning,
    errors: parsed.errors.length,
  };

  // 保证 summary 与 decisions 一致（再算一遍更保险，避免上面分支漏计）
  summary.newWords = decisions.filter((d) => d.action === "new").length;
  summary.appendSenses = decisions.filter((d) => d.action === "append").length;
  summary.duplicates = decisions.filter((d) => d.action === "duplicate").length;
  summary.totalRows = decisions.length;

  return { decisions, summary, parseErrors: parsed.errors };
}
