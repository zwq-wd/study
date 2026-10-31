/**
 * 设置页的 AI 区块（开发文档 §4.5 / §4.7）
 *
 * 单独成文件而不是塞进 SettingsPage：
 * 排程参数走 SchedulerConfig（数字/布尔），AI 走 AiConfig（字符串/密钥），
 * 两者存储键、校验方式、默认值都不一样，混在一起容易出错。
 *
 * 红线：Key 存在本机 settings 表里，导出功能会整体剔除 ai_ 前缀的键
 * （见 repo.exportAll），所以它不会跟着备份文件跑出去。
 */
import { useEffect, useState } from "react";
import {
  DEFAULT_AI_CONFIG,
  canRunCheck,
  normalizeAiConfig,
  type AiConfig,
} from "../../domain/ai/config.ts";
import { getAiClient } from "../repoClient.ts";
import { t } from "../i18n.ts";

export function AiSettingsSection() {
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [probe, setProbe] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    void (async () => {
      const ai = await getAiClient();
      setCfg(await ai.loadConfig());
    })();
  }, []);

  const save = async (next: AiConfig) => {
    setCfg(next);
    const ai = await getAiClient();
    await ai.saveConfig(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  };

  const patch = (part: Partial<AiConfig>) => {
    if (!cfg) return;
    // 端点/模型都过一遍收敛，非法值回落到默认，避免用户填错导致永久失败
    void save(normalizeAiConfig({ ...cfg, ...part }));
  };

  /** 真正打一次请求，比「看起来配好了」有用得多。 */
  const test = async () => {
    setProbing(true);
    setProbe(null);
    try {
      const ai = await getAiClient();
      const r = await ai.check([{ lineNo: 1, headword: "accomodate" }]);
      if (!r.ok) {
        setProbe(t.settingsPage.aiTestFailed(r.reason));
        return;
      }
      // 故意送一个错拼的词：能识别出来说明整条链路（Key、端点、模型、解析）都通了
      const hit = r.findings.length > 0;
      setProbe(hit ? t.settingsPage.aiTestOk : t.settingsPage.aiTestWeak);
    } finally {
      setProbing(false);
    }
  };

  if (cfg === null) {
    return <div className="text-xs text-paper-dim">{t.common.loading}</div>;
  }

  const gate = canRunCheck(cfg);

  return (
    <div className="mt-8">
      <div className="flex items-baseline justify-between">
        <div className="text-sm text-paper">{t.settingsPage.aiTitle}</div>
        {saved && <span className="text-xs text-accent">{t.settingsPage.saved}</span>}
      </div>
      <p className="mt-1 text-xs leading-5 text-paper-dim">{t.settingsPage.aiIntro}</p>

      <div className="@container mt-3 divide-y divide-ink-line/60 overflow-hidden rounded-lg border border-line-strong">
        {/* 总开关 */}
        <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 px-4 py-3.5 @[560px]:grid-cols-[8rem_6rem_1fr] @[560px]:items-start @[560px]:gap-y-0">
          <div className="text-sm text-paper">{t.settingsPage.aiEnable}</div>
          <div className="text-sm text-accent">
            <button
              type="button"
              role="switch"
              aria-checked={cfg.enabled}
              aria-label={t.settingsPage.aiEnable}
              onClick={() => patch({ enabled: !cfg.enabled })}
              className={`relative h-5 w-9 rounded-full border transition-colors ${
                cfg.enabled ? "border-accent bg-accent/25" : "border-ink-line bg-well"
              }`}
            >
              <span
                className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
                  cfg.enabled ? "left-[18px] bg-accent" : "left-0.5 bg-paper-faint"
                }`}
              />
            </button>
          </div>
          <div className="text-xs leading-5 text-paper-dim">{t.settingsPage.aiEnableDesc}</div>
        </div>

        {/* API Key */}
        <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 px-4 py-3.5 @[560px]:grid-cols-[8rem_6rem_1fr] @[560px]:items-start @[560px]:gap-y-0">
          <div className="text-sm text-paper">{t.settingsPage.aiKey}</div>
          <div className="flex items-center gap-2">
            <input
              type={showKey ? "text" : "password"}
              value={cfg.apiKey}
              placeholder="sk-..."
              spellCheck={false}
              onChange={(e) => patch({ apiKey: e.target.value })}
              className="input w-40 px-2 py-1 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="text-xs text-paper-dim hover:text-paper"
            >
              {showKey ? t.settingsPage.aiHide : t.settingsPage.aiShow}
            </button>
          </div>
          <div className="text-xs leading-5 text-paper-dim">{t.settingsPage.aiKeyDesc}</div>
        </div>

        {/* 端点 */}
        <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 px-4 py-3.5 @[560px]:grid-cols-[8rem_6rem_1fr] @[560px]:items-start @[560px]:gap-y-0">
          <div className="text-sm text-paper">{t.settingsPage.aiBaseUrl}</div>
          <div>
            <input
              type="text"
              value={cfg.baseUrl}
              spellCheck={false}
              onChange={(e) => patch({ baseUrl: e.target.value })}
              className="input w-40 px-2 py-1 font-mono text-xs"
            />
          </div>
          <div className="text-xs leading-5 text-paper-dim">{t.settingsPage.aiBaseUrlDesc}</div>
        </div>

        {/* 模型 */}
        <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 px-4 py-3.5 @[560px]:grid-cols-[8rem_6rem_1fr] @[560px]:items-start @[560px]:gap-y-0">
          <div className="text-sm text-paper">{t.settingsPage.aiModel}</div>
          <div>
            <input
              type="text"
              value={cfg.model}
              spellCheck={false}
              onChange={(e) => patch({ model: e.target.value })}
              className="input w-40 px-2 py-1 font-mono text-xs"
            />
          </div>
          <div className="text-xs leading-5 text-paper-dim">{t.settingsPage.aiModelDesc}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={probing || !gate.ready}
          onClick={() => void test()}
          className="btn-ghost disabled:opacity-40"
        >
          {probing ? t.settingsPage.aiTesting : t.settingsPage.aiTest}
        </button>
        <button
          type="button"
          onClick={() => void save(DEFAULT_AI_CONFIG)}
          className="btn-ghost"
        >
          {t.settingsPage.reset}
        </button>
        {!gate.ready && <span className="text-xs text-paper-faint">{gate.reason}</span>}
        {probe !== null && <span className="text-xs text-paper-dim">{probe}</span>}
      </div>
    </div>
  );
}
