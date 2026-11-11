/**
 * 录入页（开发文档 §4.1 / §9.3）
 *
 * 必须两步：先「解析预览」，再「导入」。直接导入会让你看不见错误行。
 */
import { useState } from "react";
import type { ImportPlan } from "../../data/types.ts";
import { getAiClient, getRepo } from "../repoClient.ts";
import { useApp } from "../store.ts";
import { t } from "../i18n.ts";
import { indexFindings, selectLinesForCheck, type FindingIndex } from "../../domain/ai/apply.ts";
import type { CheckFinding } from "../../domain/ai/types.ts";

export function ImportPage() {
  const [raw, setRaw] = useState("");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** 刚导入完就有「再看一遍」入口 —— 那是唯一一个「现在就想翻一遍」的时刻 */
  const [canViewToday, setCanViewToday] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI 校对：结果按行号索引；note 用来显示「没发现问题」或失败原因
  const [checking, setChecking] = useState(false);
  const [findings, setFindings] = useState<FindingIndex>(new Map<number, CheckFinding>());
  const [checkNote, setCheckNote] = useState<string | null>(null);

  const bumpStats = useApp((s) => s.bumpStats);
  const setPage = useApp((s) => s.setPage);

  const runCheck = async (p: ImportPlan) => {
    // 先清掉上一次的结果，避免旧结果挂在新预览上
    setFindings(new Map<number, CheckFinding>());
    setCheckNote(null);

    const lines = selectLinesForCheck(p.decisions);
    if (lines.length === 0) return;

    const ai = await getAiClient();
    const gate = await ai.gate();
    // 没开 / 没配 Key 时什么都不显示 —— 没打算用的人不该看到 AI 的存在
    if (!gate.ready) return;

    setChecking(true);
    try {
      const r = await ai.check(lines);
      if (r.ok) {
        setFindings(indexFindings(r.findings));
        if (r.partialError !== undefined) {
          // 有批没跑成：绝不能说「没发现问题」，那是谎报安全
          setCheckNote(t.importPage.aiPartial(r.partialError));
        } else if (r.findings.length === 0) {
          setCheckNote(t.importPage.aiClean);
        }
      } else {
        // 失败静默降级：说一句就够，绝不阻塞导入（§4.7）
        setCheckNote(t.importPage.aiFailed(r.reason));
      }
    } finally {
      setChecking(false);
    }
  };

  const onPreview = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const repo = await getRepo();
      const p = await repo.planImport(raw, new Date());
      setPlan(p);
      await runCheck(p);
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
      // 只有真进了新词才给入口：全是重复行或只追加义项时，今天并没有新词可翻
      setCanViewToday(r.insertedWords > 0);
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
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 px-8 py-8">
      <div className="text-xs tracking-wide text-paper-dim">{t.importPage.title}</div>

      <textarea
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          setPlan(null);
          setMessage(null);
          // 重新输入了，上一次导入的入口就不再对应当前内容
          setCanViewToday(false);
        }}
        placeholder={t.importPage.placeholder}
        spellCheck={false}
        className="input min-h-64 flex-1 resize-none rounded-lg p-4 font-mono leading-7"
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void onPreview()}
          disabled={busy || raw.trim() === ""}
          className="btn-ghost"
        >
          {t.importPage.preview}
        </button>
        <button
          type="button"
          onClick={() => void onCommit()}
          disabled={busy || plan === null}
          className="btn-primary"
        >
          {t.importPage.commit}
        </button>
        {message !== null && <span className="text-sm text-accent">{message}</span>}
        {canViewToday && (
          <button type="button" onClick={() => setPage("today")} className="btn-ghost">
            {t.todayWords.fromImport}
          </button>
        )}
        {error !== null && <span className="text-sm text-danger">{error}</span>}
      </div>

      {/* 预览摘要 */}
      {plan !== null && s !== undefined && (
        <div className="panel p-4 text-sm">
          <div className="text-paper">{t.importPage.previewTitle}</div>
          <div className="mt-2 text-paper-dim">{t.importPage.summary(s)}</div>
          {s.noMeaning > 0 && (
            <div className="mt-1 text-xs text-paper-dim">{t.importPage.noMeaningNote(s.noMeaning)}</div>
          )}

          {/* 错误行 */}
          {plan.parseErrors.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-danger">{t.importPage.errorRows}</div>
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
                <li key={`${d.lineNo}-${d.norm}`} className="text-xs text-warn">
                  第 {d.lineNo} 行 {t.importPage.similarHint(d.similarTo ?? "")}
                </li>
              ))}
          </ul>

          {/* AI 校对结果（只提示，不自动改任何一行） */}
          {checking && <div className="mt-3 text-xs text-paper-dim">{t.importPage.aiChecking}</div>}
          {!checking && checkNote !== null && (
            <div className="mt-3 text-xs text-paper-dim">{checkNote}</div>
          )}
          {!checking && findings.size > 0 && (
            <div className="mt-3">
              <div className="text-xs text-warn">{t.importPage.aiTitle}</div>
              <ul className="mt-1 space-y-0.5">
                {[...findings.values()].slice(0, 20).map((f) => (
                  <li key={f.lineNo} className="text-xs leading-5 text-paper-dim">
                    <span className="tabular-nums text-paper-faint">第 {f.lineNo} 行</span>{" "}
                    <span className="text-paper">{f.headword}</span>{" "}
                    <span className={f.kind === "nonexistent" ? "text-danger" : "text-warn"}>
                      {t.importPage.aiKind[f.kind]}
                    </span>
                    {f.suggestion !== undefined && (
                      <span className="ml-1">
                        — {t.importPage.aiSuggestion}{" "}
                        <span className="text-accent">{f.suggestion}</span>
                      </span>
                    )}
                    <span className="ml-1 text-paper-faint">（{f.reason}）</span>
                  </li>
                ))}
              </ul>
              <div className="mt-1 text-xs text-paper-faint">{t.importPage.aiHint}</div>
            </div>
          )}

          {/* 逐行清单（折叠到最近 200 条） */}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-paper-dim">
              逐行明细（{plan.decisions.length}）
            </summary>
            <ul className="mt-2 max-h-64 space-y-0.5 overflow-auto">
              {plan.decisions.slice(0, 200).map((d) => {
                const f = findings.get(d.lineNo);
                return (
                  <li key={`${d.lineNo}-${d.norm}`} className="text-xs text-paper-dim">
                    <span className="inline-block w-8 tabular-nums text-paper-faint">{d.lineNo}</span>
                    <span className="text-paper">{d.headword}</span>
                    <span className="ml-2 text-paper-faint">
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
                    {d.note !== undefined && <span className="ml-2 text-paper-faint">（{d.note}）</span>}
                    {f !== undefined && (
                      <span className={f.kind === "nonexistent" ? "ml-2 text-danger" : "ml-2 text-warn"}>
                        {t.importPage.aiKind[f.kind]}
                        {f.suggestion !== undefined ? ` → ${f.suggestion}` : ""}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}
