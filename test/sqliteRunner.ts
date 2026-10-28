/**
 * 让 repo 跑在**真实 SQLite** 上的测试替身。
 *
 * 一个常驻 Python 进程持有 sqlite3 连接，Node 侧按行收发 JSON。
 * 常驻是必须的 —— BEGIN/COMMIT 要落在同一条连接上，否则事务语义既假不了也真不了。
 * 这样被测的是**真的 SQL**：多值 INSERT、事务、日期键、排序、LIKE 转义都被覆盖。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

const PY =
  process.env.WORDPACER_PY ??
  "D:/DSH-Data/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe";

export interface SqlResponse {
  rows: unknown[];
  changes: number;
  error: string | null;
}

export interface AsyncRunner {
  dbPath: string;
  asyncRun(
    sql: string,
    params: unknown[],
    mode?: "auto" | "select" | "execute",
  ): Promise<SqlResponse>;
  close(): void;
}

const RUNNER_SCRIPT = String.raw`
import io, json, sqlite3, sys
sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)
db = sys.argv[1]
con = sqlite3.connect(db, isolation_level=None)   # 自己管事务
con.row_factory = sqlite3.Row
cur = con.cursor()

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    payload = json.loads(line)
    if payload.get("op") == "close":
        con.close()
        print(json.dumps({"rows": [], "changes": 0, "error": None}))
        break
    mode = payload["mode"]
    sql = payload["sql"]
    params = payload.get("params") or []
    out = {"rows": [], "changes": 0, "error": None}
    try:
        cur.execute(sql, params)
        if mode == "select":
            out["rows"] = [dict(r) for r in cur.fetchall()]
        else:
            out["changes"] = cur.rowcount if cur.rowcount is not None and cur.rowcount >= 0 else 0
    except Exception as e:
        out["error"] = type(e).__name__ + ": " + str(e)
    print(json.dumps(out, ensure_ascii=False))
`;

function isReadOnly(sql: string): boolean {
  const head = sql.trimStart().toLowerCase();
  return head.startsWith("select") || head.startsWith("pragma") || head.startsWith("with");
}

export async function createAsyncRunner(): Promise<AsyncRunner> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-sql-"));
  const dbPath = path.join(dir, "test.db");
  const scriptPath = path.join(dir, "run.py");
  fs.writeFileSync(scriptPath, RUNNER_SCRIPT, "utf8");

  const child = spawn(PY, [scriptPath, dbPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });

  const rl = createInterface({ input: child.stdout });
  const pending: Array<(line: string) => void> = [];
  const buffered: string[] = [];
  let stderrText = "";

  rl.on("line", (line) => {
    const w = pending.shift();
    if (w) w(line);
    else buffered.push(line);
  });
  child.stderr.on("data", (c: Buffer) => {
    stderrText += c.toString("utf8");
  });

  const nextLine = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const ready = buffered.shift();
      if (ready !== undefined) {
        resolve(ready);
        return;
      }
      pending.push(resolve);
      const timer = setTimeout(() => reject(new Error(`sqlite 子进程超时。stderr: ${stderrText}`)), 60_000);
      timer.unref?.();
    });

  // 串行化：所有 SQL 按调用顺序排队，保证事务语义
  let chain: Promise<unknown> = Promise.resolve();
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => undefined);
    return p;
  };

  const asyncRun: AsyncRunner["asyncRun"] = (sql, params, mode = "auto") =>
    serialize(async () => {
      const resolved = mode === "auto" ? (isReadOnly(sql) ? "select" : "execute") : mode;
      child.stdin.write(`${JSON.stringify({ mode: resolved, sql, params })}\n`);
      const line = await nextLine();
      const out = JSON.parse(line) as SqlResponse;
      if (out.error !== null) throw new Error(`SQL 失败：${out.error}\nSQL: ${sql}`);
      return out;
    });

  // 建表：剥掉 -- 注释行，再按分号切分执行
  const schemaPath = path.resolve(process.cwd(), "src-tauri/migrations/0001_init.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  const stmts = schema
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  for (const stmt of stmts) {
    await asyncRun(stmt, [], "execute");
  }

  return {
    dbPath,
    asyncRun,
    close: () => {
      try {
        child.stdin.write(`${JSON.stringify({ op: "close" })}\n`);
        child.stdin.end();
      } catch {
        /* ignore */
      }
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

/** 伪造的 Database：签名与 @tauri-apps/plugin-sql 一致。 */
export function createFakeDatabase(runner: AsyncRunner) {
  return {
    async execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }> {
      const r = await runner.asyncRun(sql, params ?? [], "auto");
      return { rowsAffected: r.changes };
    },
    async select<T>(sql: string, params?: unknown[]): Promise<T> {
      const r = await runner.asyncRun(sql, params ?? [], "auto");
      return r.rows as T;
    },
    async load(): Promise<never> {
      throw new Error("测试替身不支持 load");
    },
    async close(): Promise<void> {
      runner.close();
    },
  };
}
