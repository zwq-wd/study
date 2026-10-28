/**
 * 录入页（开发文档 §4.1 / §9.3）
 *
 * 必须两步：先「解析预览」，再「导入」。直接导入会让你看不见错误行。
 */
import { useState } from "react";
import type { ImportPlan } from "../../data/types.ts";
import { getRepo } from "../repoClient.ts";
import { useApp } from "../store.ts";
import { t } from "../i18n.ts";

export function ImportPage() {
  const [raw, setRaw] = useState("");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bumpStats = useApp((s) => s.bumpStats);

  const onPreview = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const repo = await getRepo();
      const p = await repo.planImport(raw, new Date());
      setPlan(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onCommit = async () => {
    if (!plan) return;
    if (plan.summary.totalRows === 0) {
      setMessage(t.importPage.nothingToImport);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const repo = await getRepo();
      const r = await repo.commitImport(plan, new Date());
      setMessage(t.importPage.done(r.insertedWords, r.appendedSenses));
      setPlan(null);
      setRaw("");
      bumpStats();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const s = plan?.summary;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-5 px-8 py-8">
      <div className="text-sm text-paper-dim">{t.importPage.title}</div>

      <textarea
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          setPlan(null);
          setMessage(null);
        }}
        placeholder={t.importPage.placeholder}
        spellCheck={false}
        className="min-h-64 flex-1 resize-none rounded-lg border border-ink-line bg-ink-soft p-4 font-mono text-sm leading-7 text-paper outline-none placeholder:text-paper-dim/50 focus:border-accent"
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void onPreview()}
          disabled={busy || raw.trim() === ""}
          className="rounded-md border border-ink-line px-5 py-2 text-sm text-paper transition hover:border-accent hover:text-accent disabled:cursor-default disabled:opacity-40"
        >
          {t.importPage.preview}
        </button>
        <button
          type="button"
          onClick={() => void onCommit()}
          disabled={busy || plan === null}
          className="rounded-md bg-accent px-5 py-2 text-sm font-medium text-ink transition hover:bg-accent-dim disabled:cursor-default disabled:bg-ink-line disabled:text-paper-dim"
        >
          {t.importPage.commit}
        </button>
        {message !== null && <span className="text-sm text-accent">{message}</span>}
        {error !== null && <span className="text-sm text-red-400">{error}</span>}
      </div>

      {/* 预览摘要 */}
      {plan !== null && s !== undefined && (
        <div className="rounded-lg border border-ink-line p-4 text-sm">
          <div className="text-paper">{t.importPage.previewTitle}</div>
          <div className="mt-2 text-paper-dim">{t.importPage.summary(s)}</div>
          {s.noMeaning > 0 && (
            <div className="mt-1 text-xs text-paper-dim">{t.importPage.noMeaningNote(s.noMeaning)}</div>
          )}

          {/* 错误行 */}
          {plan.parseErrors.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-red-400">{t.importPage.errorRows}</div>
              <ul className="mt-1 space-y-0.5">
                {plan.parseErrors.slice(0, 20).map((e) => (
                  <li key={e.lineNo} className="text-xs text-paper-dim">
                    第 {e.lineNo} 行「{e.raw}」— {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 疑似重复提示（提示，不自动改） */}
          <ul className="mt-3 space-y-0.5">
            {plan.decisions
              .filter((d) => d.similarTo !== undefined)
              .slice(0, 20)
              .map((d) => (
                <li key={`${d.lineNo}-${d.norm}`} className="text-xs text-amber-300/80">
                  第 {d.lineNo} 行 {t.importPage.similarHint(d.similarTo ?? "")}
                </li>
              ))}
          </ul>

          {/* 逐行清单（折叠到最近 200 条） */}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-paper-dim">
              逐行明细（{plan.decisions.length}）
            </summary>
            <ul className="mt-2 max-h-64 space-y-0.5 overflow-auto">
              {plan.decisions.slice(0, 200).map((d) => (
                <li key={`${d.lineNo}-${d.norm}`} className="text-xs text-paper-dim">
                  <span className="inline-block w-8 tabular-nums text-paper-dim/60">{d.lineNo}</span>
                  <span className="text-paper">{d.headword}</span>
                  <span className="ml-2 text-paper-dim/70">
                    {d.action === "new"
                      ? "新增"
                      : d.action === "append"
                        ? "追加义项"
                        : d.action === "duplicate"
                          ? "重复"
                          : "错误"}
                  </span>
                  {d.meanings.length > 0 && (
                    <span className="ml-2">{d.meanings.join("；")}</span>
                  )}
                  {d.note !== undefined && <span className="ml-2 opacity-60">（{d.note}）</span>}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}
