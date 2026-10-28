# Changelog

本项目的所有重要变更都记录在这里。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-10-28

首个可用版本。M0–M4 全部完成：能录、能复习、能撑住、能带走。

### 新增

- **录入**：行式批量粘贴，两步（解析预览 → 导入）。支持空格 / Tab / 逗号分隔，
  中文按 `；;，,/` 拆成多条义项，只写英文也允许。已存在的词走「追加义项」而非覆盖，
  同词不同义标为 L2 补充义项。
- **排程**：接入 `ts-fsrs` 5.4.2（FSRS-6）。`request_retention=0.85`、`maximum_interval=50`、
  `enable_short_term=false`、`enable_fuzz=false`。录入即计一次 Good，下次复习在 4 天后。
- **复习**：单卡翻页，一屏一张只显示英文，点一下出中文。默认动作是「记住」，
  可选「不会」按钮（默认关闭）。键盘 `Space` / `←` / `→` / `A`。字号三档可切。
- **会话上限与顺延**：默认 150 张，超出部分不消失、下次优先，首页显示顺延数。
- **义项分层**：L1（当初录入）立即显示；L2（事后补充）要复习满 3 次后才出现，避免提前泄题。
- **毕业**：`state=Review && scheduled_days>=90 && reps>=4` 或 `lapses>=6` 强制毕业。
  备考期内因上限 50 < 毕业线 90，自然毕业不会触发，没有词会悄悄消失。
- **查询**：按英文（前缀 + 完全匹配，大小写不敏感）或中文释义查。
  查不到 = 没背过；查到直接看到最后复习日期。
- **设置**：8 项参数全部可在界面调整并持久化，越界值自动夹到边界。
- **导出 / 导入**：JSON 全量备份（含词条、义项、设置，**不含 API Key**）+ CSV。
  导入支持 merge / replace 两种模式。导出前执行 `PRAGMA wal_checkpoint(TRUNCATE)`。
- **备份提醒**：距上次备份超过 7 天，首页显示一行提示。
- **探测性提示**：录入时若词根相同且拼写接近（如 `abandoned` vs `abandon`），
  提示「可能重复」，但**只提示、不自动合并**。

### 测试

- 158 项测试：domain 纯函数全覆盖 + 28 项跑在真实 SQLite 上的集成测试 + 2 项端到端流程。
- TypeScript `strict` + `noUncheckedIndexedAccess`，零类型错误。

### 实现中修正的文档偏差

- §5.4「逾期后间隔应更短」与 FSRS-6 实际相反（`e^(w10·(1−R))−1` 在 R 低时更大），按库的真实行为实现。
- §5.6 `maximum_interval` 会被 `good_interval = max(good_interval, hard_interval + 1)` 多算 1 天
  （实测 50 → 51），在 `settle()` 里再夹一次。
- §4.1.3「编辑距离 ≤ 1 且词根相同」对 `run`/`running` 永远不成立（距离是 4），
  判定改成「词根相同 + 前缀关系」或「词根相同 + 编辑距离 ≤ 1」两条并列。
- §5.9 时间回拨：ts-fsrs 遇到负 `delta_t` 直接抛错，改为先拦截、直接返回原卡。

### 开发中自己写错、被测试抓出的缺陷

- `domain/stats.ts`：逾期天数多取一个负号，导致「逾期最久」永远是 0。
- `data/sqlite/repo.ts` `commitImport`：新词只写 `words`，漏写 `senses`，导入后一个释义都没有。
- `ui/pages/ReviewPage.tsx`：`shown` 只在按「不会」时更新，看完 37 张仍记 0。

### 已知限制

- 只支持 Windows 10 / 11 x64。无手机端、无云同步。
- 安装包（NSIS）未生成：需要联网下载 `nsis-3.13.zip`，本机下载不稳定。
  当前交付的是免安装绿色版，拷整个文件夹即可运行。
- AI 旁路（补义项 / 例句 / 辨析）未实现，`ai_enabled` 设置项留位。

[0.1.0]: https://example.com/wordpacer/releases/tag/v0.1.0
