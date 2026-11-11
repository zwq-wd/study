/**
 * Repository 的 SQLite 实现（开发文档 §7.4 / §8）
 *
 * 性能预算（1 万词条、单用户）：
 * - 首页加载（含统计）< 150 ms
 * - 生成会话（取 150 条）< 50 ms
 * - 单卡结算 < 10 ms
 * - 录入 50 行 < 300 ms
 *
 * 批量录入必须用单条多值 INSERT，不要循环 50 次 IPC（§7.5）。
 */
import type Database from "@tauri-apps/plugin-sql";
import { Rating, createEmptyCard } from "ts-fsrs";
import { getDb, checkpoint } from "./db.ts";
import { withTransaction } from "./tx.ts";
import type {
  ExportBundle,
  HomeStats,
  ImportMode,
  ImportPlan,
  SearchHit,
  SenseOrigin,
  SenseRow,
  WordRow,
  WordWithSenses,
} from "../types.ts";
import type { ImportCommitResult, Repo, SettleResult } from "../repo.ts";
import { buildImportPlan } from "../../domain/importPlan.ts";
import { DEFAULT_CONFIG, normalizeConfig, type SchedulerConfig } from "../../domain/scheduler/config.ts";
import { settle } from "../../domain/scheduler/review.ts";
import { newWordCard } from "../../domain/scheduler/newWord.ts";
import { toCard, fromCard } from "../../domain/scheduler/card.ts";
import { dayKey, dayRange } from "../../domain/time.ts";
import { buildBundle } from "../../domain/export.ts";
import { computeStats } from "../../domain/stats.ts";

/** 设置表里排程参数的键名（下划线风格，和导出 JSON 一致）。 */
export const SETTING_KEYS = {
  requestRetention: "request_retention",
  sessionLimit: "session_limit",
  maximumInterval: "maximum_interval",
  graduateInterval: "graduate_interval",
  minRepsToGraduate: "min_reps_to_graduate",
  graduationOnLapses: "graduation_on_lapses",
  dayBoundaryHour: "day_boundary_hour",
} as const;

const LAST_BACKUP_KEY = "last_backup_at";

function toConfigRows(cfg: SchedulerConfig): Array<[string, string]> {
  return [
    [SETTING_KEYS.requestRetention, String(cfg.requestRetention)],
    [SETTING_KEYS.sessionLimit, String(cfg.sessionLimit)],
    [SETTING_KEYS.maximumInterval, String(cfg.maximumInterval)],
    [SETTING_KEYS.graduateInterval, String(cfg.graduateInterval)],
    [SETTING_KEYS.minRepsToGraduate, String(cfg.minRepsToGraduate)],
    [SETTING_KEYS.graduationOnLapses, String(cfg.graduationOnLapses)],
    [SETTING_KEYS.dayBoundaryHour, String(cfg.dayBoundaryHour)],
  ];
}

function rowsToConfig(rows: Record<string, string>): SchedulerConfig {
  return normalizeConfig({
    requestRetention: rows[SETTING_KEYS.requestRetention],
    sessionLimit: rows[SETTING_KEYS.sessionLimit],
    maximumInterval: rows[SETTING_KEYS.maximumInterval],
    graduateInterval: rows[SETTING_KEYS.graduateInterval],
    minRepsToGraduate: rows[SETTING_KEYS.minRepsToGraduate],
    graduationOnLapses: rows[SETTING_KEYS.graduationOnLapses],
    dayBoundaryHour: rows[SETTING_KEYS.dayBoundaryHour],
  });
}

/** 每 100 个绑定参数一块，D1/SQLite 都有上限，留余量（§M0 实现记录第 4 条）。 */
function chunks<T>(items: readonly T[], size = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 「今天背错了」的判定：今天这一场的日志里出现过 Again。 */
const MISSED_SQL = `
  SELECT w.* FROM words w
    WHERE EXISTS (
      SELECT 1 FROM review_logs l
        WHERE l.word_id = w.id AND l.rating = 1
          AND l.reviewed_at >= ? AND l.reviewed_at < ?
    )
    ORDER BY w.fsrs_due_day ASC, w.fsrs_stability ASC, w.id ASC`;

/**
 * 「今天新录入的词」的判定：落地时间落在今天这一天的区间里。
 *
 * 用 created_at 而不是 updated_at：后者会被每一次结算刷掉，
 * 那样「今天录入」会变成「今天复习过」，和这个入口的语义正好相反。
 * id 参与排序只是为了让同一毫秒录入的几个词有稳定顺序，洗牌在 domain 里做。
 */
const TODAY_NEW_SQL = `SELECT * FROM words
    WHERE created_at >= ? AND created_at < ?
    ORDER BY created_at ASC, id ASC`;

export class SqliteRepo implements Repo {
  private db: Database | null = null;
  private cfgCache: SchedulerConfig | null = null;

  /**
   * 允许注入一个 Database（测试用真实 SQLite 替身）。
   * 生产路径不传参，走 getDb()。
   */
  constructor(private readonly injected: Database | null = null) {}

  async init(): Promise<void> {
    this.db = this.injected ?? (await getDb());
    await this.ensureSettings();
  }

  private async d(): Promise<Database> {
    if (!this.db) this.db = this.injected ?? (await getDb());
    return this.db;
  }

  // ------------------------------------------------------------ 设置

  /** 首次启动把默认值写进 settings，之后只读。 */
  private async ensureSettings(): Promise<void> {
    const db = await this.d();
    const rows = await db.select<Array<{ key: string }>>("SELECT key FROM settings");
    const have = new Set(rows.map((r) => r.key));
    const missing = toConfigRows(DEFAULT_CONFIG).filter(([k]) => !have.has(k));
    if (missing.length === 0) return;

    const now = Date.now();
    const values: unknown[] = [];
    const placeholders = missing.map(([k, v]) => {
      values.push(k, v, now);
      return "(?, ?, ?)";
    });
    await db.execute(
      `INSERT INTO settings(key, value, updated_at) VALUES ${placeholders.join(", ")}`,
      values,
    );
  }

  async loadSettings(): Promise<Record<string, string>> {
    const db = await this.d();
    const rows = await db.select<Array<{ key: string; value: string }>>(
      "SELECT key, value FROM settings",
    );
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  async saveSettings(patch: Record<string, string>): Promise<void> {
    const db = await this.d();
    const now = Date.now();
    const entries = Object.entries(patch);
    if (entries.length === 0) return;

    const values: unknown[] = [];
    const placeholders = entries.map(([k, v]) => {
      values.push(k, v, now);
      return "(?, ?, ?)";
    });
    await db.execute(
      `INSERT INTO settings(key, value, updated_at) VALUES ${placeholders.join(", ")}
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      values,
    );
    this.cfgCache = null;
  }

  /** 当前排程配置（带缓存）。 */
  async config(): Promise<SchedulerConfig> {
    if (this.cfgCache) return this.cfgCache;
    const rows = await this.loadSettings();
    this.cfgCache = rowsToConfig(rows);
    return this.cfgCache;
  }

  // ------------------------------------------------------------ 复习

  async listDue(today: string): Promise<WordRow[]> {
    const db = await this.d();
    return db.select<WordRow[]>(
      `SELECT * FROM words
        WHERE status = 'learning' AND fsrs_due_day IS NOT NULL AND fsrs_due_day <= ?
        ORDER BY fsrs_due_day ASC, fsrs_stability ASC, id ASC`,
      [today],
    );
  }

  async countDue(today: string): Promise<number> {
    const db = await this.d();
    const rows = await db.select<Array<{ n: number }>>(
      `SELECT COUNT(*) AS n FROM words
        WHERE status = 'learning' AND fsrs_due_day IS NOT NULL AND fsrs_due_day <= ?`,
      [today],
    );
    return rows[0]?.n ?? 0;
  }

  async listMissedToday(today: string): Promise<WordRow[]> {
    const db = await this.d();
    const cfg = await this.config();
    const { start, end } = dayRange(today, cfg.dayBoundaryHour);
    return db.select<WordRow[]>(MISSED_SQL, [start, end]);
  }

  async listTodayNewWords(today: string): Promise<WordRow[]> {
    const db = await this.d();
    const cfg = await this.config();
    const { start, end } = dayRange(today, cfg.dayBoundaryHour);
    return db.select<WordRow[]>(TODAY_NEW_SQL, [start, end]);
  }

  async settleWord(
    wordId: number,
    rating: Rating,
    now: Date,
    sessionId: string | null,
  ): Promise<SettleResult> {
    const db = await this.d();
    const cfg = await this.config();

    const rows = await db.select<WordRow[]>("SELECT * FROM words WHERE id = ?", [wordId]);
    const word = rows[0];
    if (!word) throw new Error(`词条不存在：id=${wordId}`);

    const prev = toCard(word, now);
    const outcome = settle(prev, rating, now, cfg);

    const f = fromCard(outcome.card);
    const dueDay = dayKey(outcome.card.due, cfg.dayBoundaryHour);
    const status = outcome.graduated ? "graduated" : word.status;

    await withTransaction(db, async () => {
      await db.execute(
        `UPDATE words SET
           status = ?, fsrs_state = ?, fsrs_due = ?, fsrs_due_day = ?,
           fsrs_stability = ?, fsrs_difficulty = ?, fsrs_reps = ?, fsrs_lapses = ?,
           fsrs_scheduled_days = ?, fsrs_last_review = ?, updated_at = ?
         WHERE id = ?`,
        [
          status,
          f.fsrs_state,
          f.fsrs_due,
          dueDay,
          f.fsrs_stability,
          f.fsrs_difficulty,
          f.fsrs_reps,
          f.fsrs_lapses,
          f.fsrs_scheduled_days,
          f.fsrs_last_review,
          now.getTime(),
          wordId,
        ],
      );

      await db.execute(
        `INSERT INTO review_logs
           (word_id, rating, state_before, state_after, due_after, stability_after,
            difficulty_after, elapsed_days, reviewed_at, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          wordId,
          rating,
          word.fsrs_state,
          outcome.card.state,
          outcome.card.due.getTime(),
          outcome.card.stability,
          outcome.card.difficulty,
          outcome.log.elapsed_days,
          now.getTime(),
          sessionId,
        ],
      );
    });

    return { nextDueDay: dueDay, graduated: outcome.graduated };
  }

  // ------------------------------------------------------------ 录入

  async planImport(raw: string, _now: Date): Promise<ImportPlan> {
    const db = await this.d();
    // 只取摘要字段，避免把整库载入内存
    const existing = await db.select<Array<{ norm: string; headword: string; last_day: string | null }>>(
      `SELECT w.norm, w.headword,
              (SELECT MAX(s.meaning_cn) FROM senses s WHERE s.word_id = w.id AND s.layer = 1) AS last_day
         FROM words w`,
    );
    const senseRows = await db.select<Array<{ word_id: number; meaning_cn: string }>>(
      "SELECT word_id, meaning_cn FROM senses WHERE layer = 1",
    );

    const meaningsByWord = new Map<number, string[]>();
    for (const s of senseRows) {
      const list = meaningsByWord.get(s.word_id);
      if (list) list.push(s.meaning_cn);
      else meaningsByWord.set(s.word_id, [s.meaning_cn]);
    }

    const idByNorm = await db.select<Array<{ id: number; norm: string; last_review: number | null }>>(
      "SELECT id, norm, fsrs_last_review AS last_review FROM words",
    );
    const normToId = new Map(idByNorm.map((r) => [r.norm, r.id]));
    const idToReview = new Map(idByNorm.map((r) => [r.id, r.last_review]));

    const cfg = await this.config();
    const existingInfos = existing.map((e) => {
      const id = normToId.get(e.norm) ?? -1;
      const lastReview = idToReview.get(id) ?? null;
      return {
        norm: e.norm,
        headword: e.headword,
        lastReviewDay: lastReview === null ? null : dayKey(new Date(lastReview), cfg.dayBoundaryHour),
        meanings: meaningsByWord.get(id) ?? [],
      };
    });

    return buildImportPlan(raw, {
      existing: existingInfos,
      similarPool: existing.map((e) => e.norm),
    });
  }

  async commitImport(plan: ImportPlan, now: Date): Promise<ImportCommitResult> {
    const db = await this.d();
    const cfg = await this.config();
    const nowMs = now.getTime();

    const toInsert = plan.decisions.filter((d) => d.action === "new");
    let insertedWords = 0;
    let appendedSenses = 0;

    const existingRows = await db.select<Array<{ id: number; norm: string }>>(
      "SELECT id, norm FROM words",
    );
    const idByNorm = new Map(existingRows.map((r) => [r.norm, r.id]));

    await withTransaction(db, async () => {
      // --- 新词：一条多值 INSERT（§7.5 唯一的性能坑）
      if (toInsert.length > 0) {
        const created = newWordCard(now, cfg);
        const f = fromCard(created);
        const dueDay = dayKey(created.due, cfg.dayBoundaryHour);

        const values: unknown[] = [];
        const tuples = toInsert.map((d) => {
          values.push(
            d.headword, // headword
            d.norm, // norm
            null, // phonetic
            null, // source
            null, // note
            null, // example_json
            "learning", // status
            f.fsrs_state,
            f.fsrs_due,
            dueDay,
            f.fsrs_stability,
            f.fsrs_difficulty,
            f.fsrs_reps,
            f.fsrs_lapses,
            f.fsrs_scheduled_days,
            f.fsrs_last_review,
            nowMs,
            nowMs,
          );
          return "(" + new Array(18).fill("?").join(", ") + ")";
        });

        await db.execute(
          `INSERT INTO words
             (headword, norm, phonetic, source, note, example_json, status,
              fsrs_state, fsrs_due, fsrs_due_day, fsrs_stability, fsrs_difficulty,
              fsrs_reps, fsrs_lapses, fsrs_scheduled_days, fsrs_last_review,
              created_at, updated_at)
           VALUES ${tuples.join(", ")}`,
          values,
        );
        insertedWords = toInsert.length;

        // --- 新词的 L1 义项（layer=1, origin=manual）
        // 一次性把所有 new 词 id 取回来，再按 norm 分组插义项。
        const fresh = await db.select<Array<{ id: number; norm: string }>>(
          "SELECT id, norm FROM words",
        );
        const newIdByNorm = new Map(fresh.map((r) => [r.norm, r.id]));

        const senseValues: unknown[] = [];
        const senseTuples = toInsert.flatMap((d) => {
          const wordId = newIdByNorm.get(d.norm);
          if (wordId === undefined) return [];
          return d.meanings.map((m, i) => {
            senseValues.push(wordId, m, 1, "manual", i, nowMs);
            return "(" + new Array(6).fill("?").join(", ") + ")";
          });
        });
        if (senseTuples.length > 0) {
          await db.execute(
            `INSERT INTO senses(word_id, meaning_cn, layer, origin, sort, created_at)
             VALUES ${senseTuples.join(", ")}`,
            senseValues,
          );
        }

        // 新词入库即计一次 Good → 补一条 review_log，保证历史可重放（§8.3）
        const logValues: unknown[] = [];
        const logTuples = toInsert.map((d) => {
          const id = newIdByNorm.get(d.norm);
          logValues.push(
            id ?? null,
            Rating.Good,
            0, // state_before = New
            f.fsrs_state,
            f.fsrs_due,
            f.fsrs_stability,
            f.fsrs_difficulty,
            0,
            nowMs,
            null,
          );
          return "(" + new Array(10).fill("?").join(", ") + ")";
        });
        await db.execute(
          `INSERT INTO review_logs
             (word_id, rating, state_before, state_after, due_after, stability_after,
              difficulty_after, elapsed_days, reviewed_at, session_id)
           VALUES ${logTuples.join(", ")}`,
          logValues,
        );
      }

      // --- 追加义项：L2、origin=manual
      for (const d of plan.decisions) {
        if (d.action !== "append") continue;
        const wordId = idByNorm.get(d.norm);
        if (wordId === undefined) continue;

        if (d.meanings.length > 0) {
          const values: unknown[] = [];
          const tuples = d.meanings.map((m) => {
            values.push(wordId, m, 2, "manual", 0, nowMs);
            return "(" + new Array(6).fill("?").join(", ") + ")";
          });
          await db.execute(
            `INSERT INTO senses(word_id, meaning_cn, layer, origin, sort, created_at)
             VALUES ${tuples.join(", ")}`,
            values,
          );
        }
        appendedSenses++;
      }
    });

    return {
      insertedWords,
      appendedSenses,
      skipped: plan.decisions.filter((d) => d.action === "duplicate").length,
    };
  }

  // ------------------------------------------------------------ 查询

  async search(q: string, opts?: { status?: string; limit?: number }): Promise<SearchHit[]> {
    const db = await this.d();
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
    const term = q.trim();
    const cfg = await this.config();

    const where: string[] = [];
    const values: unknown[] = [];

    if (term !== "") {
      where.push("(w.norm LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM senses s WHERE s.word_id = w.id AND s.meaning_cn LIKE ? ESCAPE '\\'))");
      const like = `%${term.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      const likeCn = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      values.push(like, likeCn);
    }
    if (opts?.status) {
      where.push("w.status = ?");
      values.push(opts.status);
    }

    const rows = await db.select<
      Array<WordRow & { first_meaning: string | null }>
    >(
      `SELECT w.*,
              (SELECT s.meaning_cn FROM senses s WHERE s.word_id = w.id AND s.layer = 1 ORDER BY s.sort, s.id LIMIT 1) AS first_meaning
         FROM words w
         ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY w.norm ASC
         LIMIT ?`,
      [...values, limit],
    );

    return rows.map((r) => ({
      ...r,
      firstMeaning: r.first_meaning ?? "",
      lastReviewDay:
        r.fsrs_last_review === null ? null : dayKey(new Date(r.fsrs_last_review), cfg.dayBoundaryHour),
    }));
  }

  async getWordByNorm(norm: string): Promise<WordWithSenses | null> {
    const db = await this.d();
    const rows = await db.select<WordRow[]>("SELECT * FROM words WHERE norm = ?", [norm]);
    const word = rows[0];
    if (!word) return null;
    return this.attachSenses(word);
  }

  async getWordById(id: number): Promise<WordWithSenses | null> {
    const db = await this.d();
    const rows = await db.select<WordRow[]>("SELECT * FROM words WHERE id = ?", [id]);
    const word = rows[0];
    if (!word) return null;
    return this.attachSenses(word);
  }

  private async attachSenses(word: WordRow): Promise<WordWithSenses> {
    const db = await this.d();
    const senses = await db.select<SenseRow[]>(
      "SELECT * FROM senses WHERE word_id = ? ORDER BY layer ASC, sort ASC, id ASC",
      [word.id],
    );
    return { ...word, senses };
  }

  // ------------------------------------------------------------ 维护

  async addSense(wordId: number, meaningCn: string, origin: SenseOrigin): Promise<void> {
    const db = await this.d();
    const meaning = meaningCn.trim();
    if (meaning === "") return;

    // 去重：同词同释义不再插
    const dup = await db.select<Array<{ id: number }>>(
      "SELECT id FROM senses WHERE word_id = ? AND meaning_cn = ?",
      [wordId, meaning],
    );
    if (dup.length > 0) return;

    const maxRows = await db.select<Array<{ m: number | null }>>(
      "SELECT MAX(sort) AS m FROM senses WHERE word_id = ? AND layer = 2",
      [wordId],
    );
    const nextSort = (maxRows[0]?.m ?? -1) + 1;

    await db.execute(
      "INSERT INTO senses(word_id, meaning_cn, layer, origin, sort, created_at) VALUES (?, ?, 2, ?, ?, ?)",
      [wordId, meaning, origin, nextSort, Date.now()],
    );
  }

  async updateWord(wordId: number, patch: Partial<WordRow>): Promise<void> {
    const db = await this.d();
    const allowed: Array<keyof WordRow> = [
      "headword",
      "norm",
      "phonetic",
      "source",
      "note",
      "example_json",
      "status",
    ];
    const keys = Object.keys(patch).filter((k): k is keyof WordRow =>
      (allowed as string[]).includes(k),
    );
    if (keys.length === 0) return;

    const sets = keys.map((k) => `${k} = ?`);
    const values: unknown[] = keys.map((k) => patch[k]);
    await db.execute(
      `UPDATE words SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`,
      [...values, Date.now(), wordId],
    );
  }

  /**
   * 重新激活（§5.6）：重置为 `State.New` + **立即**排入下一次会话。
   *
   * 这里必须用 `createEmptyCard` 而不是 `newWordCard`：
   * - `newWordCard` 是「今天刚录入、已经背过一次」的语义，它把 due 排到 4 天后
   * - 而 `listDue` 只取 `fsrs_due_day <= 今天`，所以用 newWordCard 实现的
   *   「立即排入」实际上是 4 天后才出现，跟按钮上的承诺相反
   *
   * 用空卡则是 due = now、state = New、reps = lapses = 0，
   * 今天这一场复习就能把它排进来 —— 这才是「重新激活」该有的效果。
   */
  async resetWord(wordId: number, now: Date): Promise<void> {
    const db = await this.d();
    const cfg = await this.config();
    const fresh = createEmptyCard(now);
    const f = fromCard(fresh);
    const dueDay = dayKey(fresh.due, cfg.dayBoundaryHour);

    await db.execute(
      `UPDATE words SET
         status = 'learning', fsrs_state = ?, fsrs_due = ?, fsrs_due_day = ?,
         fsrs_stability = ?, fsrs_difficulty = ?, fsrs_reps = ?, fsrs_lapses = 0,
         fsrs_scheduled_days = ?, fsrs_last_review = ?, updated_at = ?
       WHERE id = ?`,
      [
        f.fsrs_state,
        f.fsrs_due,
        dueDay,
        f.fsrs_stability,
        f.fsrs_difficulty,
        f.fsrs_reps,
        f.fsrs_scheduled_days,
        f.fsrs_last_review,
        now.getTime(),
        wordId,
      ],
    );
  }

  // ------------------------------------------------------------ 备份

  async exportAll(): Promise<ExportBundle> {
    const db = await this.d();
    // WAL 检查点：保证 .db 单文件自洽（§8.4）。注入替身时没有 WAL，跳过。
    if (this.injected === null) {
      try {
        await checkpoint();
      } catch {
        // 检查点失败不该阻断导出
      }
    }

    const words = await db.select<WordRow[]>("SELECT * FROM words ORDER BY norm ASC");
    const senses = await db.select<SenseRow[]>("SELECT * FROM senses ORDER BY word_id, layer, sort, id");
    const settings = await this.loadSettings();

    const sensesByWord = new Map<number, Array<{ meaningCn: string; layer: number; origin: string }>>();
    for (const s of senses) {
      const list = sensesByWord.get(s.word_id);
      const item = { meaningCn: s.meaning_cn, layer: s.layer, origin: s.origin };
      if (list) list.push(item);
      else sensesByWord.set(s.word_id, [item]);
    }

    // 导出不含 API Key（§12.3 红线）
    const safeSettings: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(settings)) {
      if (k.startsWith("ai_")) continue;
      if (k === LAST_BACKUP_KEY) continue;
      safeSettings[k] = v;
    }

    return buildBundle({
      exportedAt: new Date().toISOString(),
      settings: safeSettings,
      words: words.map((w) => ({
        headword: w.headword,
        norm: w.norm,
        phonetic: w.phonetic,
        source: w.source,
        note: w.note,
        status: w.status,
        senses: sensesByWord.get(w.id) ?? [],
        fsrs: {
          state: w.fsrs_state,
          due: w.fsrs_due,
          stability: w.fsrs_stability,
          difficulty: w.fsrs_difficulty,
          reps: w.fsrs_reps,
          lapses: w.fsrs_lapses,
          scheduledDays: w.fsrs_scheduled_days,
          lastReview: w.fsrs_last_review,
        },
      })),
    });
  }

  async importAll(bundle: ExportBundle, mode: ImportMode): Promise<ImportCommitResult> {
    const db = await this.d();
    const cfg = await this.config();
    const now = Date.now();
    let insertedWords = 0;
    let appendedSenses = 0;
    let skipped = 0;

    await withTransaction(db, async () => {
      if (mode === "replace") {
        // 应用层级联，不依赖数据库外键（§8.5 风险提示）
        await db.execute("DELETE FROM review_logs");
        await db.execute("DELETE FROM senses");
        await db.execute("DELETE FROM words");
        await db.execute("DELETE FROM sessions");
      }

      // 现有词 → id 映射
      const existing = await db.select<Array<{ id: number; norm: string }>>(
        "SELECT id, norm FROM words",
      );
      const idByNorm = new Map(existing.map((r) => [r.norm, r.id]));

      for (const w of bundle.words) {
        const existingId = idByNorm.get(w.norm);

        if (existingId === undefined) {
          // 新词
          await db.execute(
            `INSERT INTO words
               (headword, norm, phonetic, source, note, example_json, status,
                fsrs_state, fsrs_due, fsrs_due_day, fsrs_stability, fsrs_difficulty,
                fsrs_reps, fsrs_lapses, fsrs_scheduled_days, fsrs_last_review,
                created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              w.headword,
              w.norm,
              w.phonetic,
              w.source,
              w.note,
              w.status,
              w.fsrs.state,
              w.fsrs.due,
              w.fsrs.due === null ? null : dayKey(new Date(w.fsrs.due), cfg.dayBoundaryHour),
              w.fsrs.stability,
              w.fsrs.difficulty,
              w.fsrs.reps,
              w.fsrs.lapses,
              w.fsrs.scheduledDays,
              w.fsrs.lastReview,
              now,
              now,
            ],
          );
          const got = await db.select<Array<{ id: number }>>(
            "SELECT id FROM words WHERE norm = ?",
            [w.norm],
          );
          const newId = got[0]?.id;
          if (newId !== undefined) {
            idByNorm.set(w.norm, newId);
            insertedWords++;
            await this.insertSenses(newId, w.senses, now);
          }
        } else {
          // merge：以导入文件为准更新
          await db.execute(
            `UPDATE words SET
               headword = ?, phonetic = ?, source = ?, note = ?, status = ?,
               fsrs_state = ?, fsrs_due = ?, fsrs_due_day = ?, fsrs_stability = ?,
               fsrs_difficulty = ?, fsrs_reps = ?, fsrs_lapses = ?, fsrs_scheduled_days = ?,
               fsrs_last_review = ?, updated_at = ?
             WHERE id = ?`,
            [
              w.headword,
              w.phonetic,
              w.source,
              w.note,
              w.status,
              w.fsrs.state,
              w.fsrs.due,
              w.fsrs.due === null ? null : dayKey(new Date(w.fsrs.due), cfg.dayBoundaryHour),
              w.fsrs.stability,
              w.fsrs.difficulty,
              w.fsrs.reps,
              w.fsrs.lapses,
              w.fsrs.scheduledDays,
              w.fsrs.lastReview,
              now,
              existingId,
            ],
          );
          await db.execute("DELETE FROM senses WHERE word_id = ?", [existingId]);
          await this.insertSenses(existingId, w.senses, now);
          appendedSenses += w.senses.length;
          skipped++;
        }
      }

      // 设置：merge 时也覆盖（导入文件为准）
      if (Object.keys(bundle.settings).length > 0) {
        const values: unknown[] = [];
        const tuples = Object.entries(bundle.settings).map(([k, v]) => {
          values.push(k, String(v), now);
          return "(?, ?, ?)";
        });
        await db.execute(
          `INSERT INTO settings(key, value, updated_at) VALUES ${tuples.join(", ")}
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          values,
        );
        this.cfgCache = null;
      }
    });

    return { insertedWords, appendedSenses, skipped };
  }

  private async insertSenses(
    wordId: number,
    senses: ReadonlyArray<{ meaningCn: string; layer: number; origin: string }>,
    now: number,
  ): Promise<void> {
    if (senses.length === 0) return;
    const db = await this.d();
    const values: unknown[] = [];
    const tuples = senses.map((s, i) => {
      values.push(wordId, s.meaningCn, s.layer, s.origin, i, now);
      return "(" + new Array(6).fill("?").join(", ") + ")";
    });
    await db.execute(
      `INSERT INTO senses(word_id, meaning_cn, layer, origin, sort, created_at)
       VALUES ${tuples.join(", ")}`,
      values,
    );
  }

  // ------------------------------------------------------------ 统计

  async stats(today: string): Promise<HomeStats> {
    const db = await this.d();
    const cfg = await this.config();

    const counts = await db.select<Array<{ total: number; learning: number; graduated: number }>>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'learning' THEN 1 ELSE 0 END) AS learning,
              SUM(CASE WHEN status = 'graduated' THEN 1 ELSE 0 END) AS graduated
         FROM words`,
    );
    const c = counts[0];

    const dueRows = await this.listDue(today);
    const dueTotal = dueRows.length;
    const deferred = Math.max(0, dueTotal - cfg.sessionLimit);

    const nextRows = await db.select<Array<{ d: string | null }>>(
      `SELECT MIN(fsrs_due_day) AS d FROM words
        WHERE status = 'learning' AND fsrs_due_day IS NOT NULL AND fsrs_due_day > ?`,
      [today],
    );

    return computeStats({
      total: c?.total ?? 0,
      learning: c?.learning ?? 0,
      graduated: c?.graduated ?? 0,
      dueRows,
      today,
      deferred,
      nextDueDay: nextRows[0]?.d ?? null,
    });
  }

  async daysSinceBackup(now: Date): Promise<number | null> {
    const db = await this.d();
    const rows = await db.select<Array<{ value: string }>>(
      "SELECT value FROM settings WHERE key = ?",
      [LAST_BACKUP_KEY],
    );
    const raw = rows[0]?.value;
    if (!raw) return null;
    const at = Number.parseInt(raw, 10);
    if (!Number.isFinite(at)) return null;
    return Math.floor((now.getTime() - at) / 86_400_000);
  }

  async markBackupDone(now: Date): Promise<void> {
    const db = await this.d();
    await db.execute(
      `INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [LAST_BACKUP_KEY, String(now.getTime()), now.getTime()],
    );
  }

  // ------------------------------------------------------------ 会话

  async startSession(id: string, now: Date, planned: number, deferred: number): Promise<void> {
    const db = await this.d();
    await db.execute(
      "INSERT INTO sessions(id, started_at, planned, shown, again, deferred) VALUES (?, ?, ?, 0, 0, ?)",
      [id, now.getTime(), planned, deferred],
    );
  }

  async updateSession(id: string, patch: { shown?: number; again?: number }): Promise<void> {
    const db = await this.d();
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.shown !== undefined) {
      sets.push("shown = ?");
      values.push(patch.shown);
    }
    if (patch.again !== undefined) {
      sets.push("again = ?");
      values.push(patch.again);
    }
    if (sets.length === 0) return;
    await db.execute(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`, [...values, id]);
  }

  async endSession(id: string, now: Date): Promise<void> {
    const db = await this.d();
    await db.execute("UPDATE sessions SET ended_at = ? WHERE id = ?", [now.getTime(), id]);
  }
}

/** 供测试/调试用的分块工具。 */
export { chunks };
