# wordpacer · 桌面背单词

**本地单词复习节奏管理器。** 你录入今天背的词，它按遗忘曲线告诉你下次该看哪些；你不规律使用也不会崩。

不教单词、不考你、不评判你。只做三件事：记住你背过哪些词 → 每次打开算出最该看哪些 → 一张一张翻给你看。

---

## 为什么是它

每天背 30 个词、隔几天断一次、考前两个月才开始认真——这是专升本备考的真实节奏。
固定间隔表（1/3/7/15 天）遇到逾期只有一种反应：再等这么多天，间隔越拉越离谱。

FSRS 的核心输入是「**实际过去了多少天**」，先算这个时刻你还记得的概率，再决定下次间隔。
**不规律不是它的弱项，是它唯一比固定间隔强的地方。** 而且它不需要模型、不需要 GPU、不需要联网——几十行数学公式，不是「AI」。

---

## 功能

- **行式批量录入**：一次粘贴一天的词，先预览再导入；已存在的词走「追加义项」而不是覆盖
- **FSRS 排程**：`request_retention=0.85`、`maximum_interval=50`，二元评分（默认记住，可选「不会」）
- **会话上限 + 顺延**：一次最多看 150 张（可调），剩下的不消失、下次优先
- **单卡翻页**：只显示英文，点一下出中文；字号三档；键盘 Space / ← / →
- **查询**：「背过没有」直接看最后复习日期
- **导出 / 导入**：JSON 全量备份 + CSV，本地单文件 SQLite

---

## 从源码构建

### 前置依赖

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node | ≥ 20.18 | 本机实测 20.18.1；**不要用 Vite 7**（需 Node ≥ 20.19） |
| Rust | stable | 需要 C 链接器：MSVC Build Tools，或 GNU 工具链 + mingw |
| WebView2 | 任意 | Win10 1803+/Win11 自带 |

```powershell
npm install
npm run typecheck
npm run test
npm run tauri dev      # 开发（热更新）
npm run tauri build    # 打包 → src-tauri/target/release/bundle/nsis/*.exe
```

> 首次 `npm run tauri dev` / `build` 会编译几百个 Rust crate，**5–15 分钟**。第二次起是增量，几秒。

### 本机构建（已实测）

这台机器没装 MSVC，走 GNU 工具链。有两个坑必须绕开：

1. **工具链必须在纯 ASCII 路径**，且是 Medium 完整性标签 —— `ld` 和 `windres` 处理不了中文路径
2. **项目本体也必须在 ASCII 路径** —— `windres` 打不开中文路径下的 `.ico`

所以仓库实际放在 `D:\wp\wordpacer`，工作区里 `英语\桌面背单词\wordpacer` 是一个指向它的目录联接（Junction），
在资源管理器和编辑器里看起来就是同一个文件夹。

```powershell
# 工具链（ASCII 路径）
$env:RUSTUP_HOME = "D:\wpchain\rustup"
$env:CARGO_HOME  = "D:\wpchain\cargo"
$env:TMP = "D:\wpchain\tmp"; $env:TEMP = $env:TMP      # dlltool 要在 TEMP 里建临时文件
$env:PATH = "D:\CLion 2024.1.5\bin\mingw\bin;$env:CARGO_HOME\bin;$env:PATH"
$env:CARGO_TARGET_DIR = "D:\wpchain\target"

cd D:\wp\wordpacer
npm install
npm run typecheck
npm run test
node scripts/tauri-run.mjs build --no-bundle   # → D:\wpchain\target\release\wordpacer.exe
```

产物需要和 `WebView2Loader.dll` 放在同一目录才能双击运行。

### DSH 环境的坑

DSH 自带的 pnpm 跑在 Electron 二进制里，`process.execPath` 指向 `DSH Desktop.exe` 而不是 `node.exe`。
凡是 npm script 要调外部二进制并依赖它重新 spawn 自己的，可能出现「参数错乱」。
`scripts/tauri-run.mjs` 就是为此写的：显式找一个真 `node.exe` 再跑 `@tauri-apps/cli`。

另外本机 pnpm 12 会报 `ERR_PNPM_IGNORED_BUILDS`，所以依赖统一用 `npm install`。

### 版本对齐（踩过的坑）

`@tauri-apps/*` 的 npm 版本号与 Rust crate 版本号**不是同一个序列**。
`tauri-cli build` 会严格比对，对不上直接拒绝构建。本机实测可用组合：

| npm | Rust crate |
|---|---|
| `@tauri-apps/api@2.12.4` | `tauri@2.12.5` |
| `@tauri-apps/plugin-sql@2.6.0` | `tauri-plugin-sql@2.6.0` |
| `@tauri-apps/plugin-fs@2.7.1` | `tauri-plugin-fs@2.7.1` |
| `@tauri-apps/plugin-dialog@2.8.3` | `tauri-plugin-dialog@2.8.3` |

---

## 隐私

- **纯本地**。没有任何遥测、没有后台网络请求
- 数据在一个文件里：`%APPDATA%\com.wordpacer.app\wordpacer.db`
- 导出的 `.json` / `.csv` 与 `.db` **都不入库**（见 `.gitignore`）

---

## 参数说明

| 设置 | 默认 | 它真的在做什么 |
|---|---|---|
| 目标保留率 | 0.85 | 你希望复习时还记得的概率。调低 → 间隔变长、复习变少、忘得变多 |
| 单次会话上限 | 150 | 一次打开最多看多少张。不改变到期计算，只决定这次看多少 |
| 最大间隔 | 50 天 | 间隔上限。**为什么是 50**：考试在明年 3 月，考前只剩约 140 天；排到 200 天后的词等于考前再也见不到 |
| 毕业间隔 | 90 天 | 间隔到 90 天**并且**复习满 4 次才毕业。备考期内因为上限只有 50，够不到 90，所以没有词会悄悄毕业 |
| 最少复习次数 | 4 | 防止「一次 Good 就算毕业」 |
| 强制毕业阈值 | 6 | 被标「不会」累计 6 次，强制毕业，不再纠缠 |
| 显示「不会」按钮 | 关 | 开了才有那个按钮。关着不影响排程，只是算法收不到反馈 |
| 一天的边界 | 04:00 | 凌晨 2 点背的词算「昨天」 |

完整规格见 [`docs/01-开发文档.md`](docs/01-开发文档.md)（1155 行），使用手册见 [`docs/02-说明文档.md`](docs/02-说明文档.md)（767 行），视觉设计说明见 [`docs/UI-美化方案.md`](docs/UI-美化方案.md)。

---

## 目录结构

```
wordpacer/
├─ src/
│  ├─ domain/              纯函数，零 IO，100% 可单测
│  │  ├─ scheduler/        session · review · card · config · newWord
│  │  ├─ normalize/        headword · parseInput · similar
│  │  ├─ time.ts            dayKey / 边界小时
│  │  ├─ senses.ts          L1/L2 分层显示
│  │  ├─ importPlan.ts      录入计划
│  │  ├─ export.ts          导出结构与校验
│  │  └─ stats.ts           首页统计
│  ├─ data/
│  │  ├─ types.ts           行/领域/导出类型
│  │  ├─ repo.ts            Repository 接口（只定义）
│  │  └─ sqlite/            db · tx · repo 实现
│  ├─ ui/
│  │  ├─ pages/             Home · Review · Import · Search · Settings
│  │  ├─ store.ts           Zustand 会话态
│  │  ├─ repoClient.ts      repo 单例
│  │  ├─ files.ts           dialog + fs
│  │  └─ i18n.ts            文案集中
│  └─ main.tsx
├─ src-tauri/
│  ├─ src/lib.rs            ★ 只做窗口与插件注册，≤ 40 行
│  └─ migrations/0001_init.sql
└─ test/                    Vitest
```

**三条铁律**（CI 里靠 code review 卡住）：

1. `domain/` 不允许 import 任何 `@tauri-apps/*`、`data/*`、`ui/*`
2. `ui/` 不允许直接 import `ts-fsrs`
3. `src-tauri/src/lib.rs` 超过 400 行就说明业务逻辑漏到 Rust 里了

---

## 已知偏差（相对开发文档）

实现过程中按实测结果修正了几处，都是**文档与 ts-fsrs 真实行为不一致**导致的：

| 位置 | 文档说 | 实测 | 处理 |
|---|---|---|---|
| §5.4 逾期后间隔 | 逾期 30 天后 Good 的间隔应**短于**按时 Good | FSRS-6 的 `next_recall_stability` 里 `e^(w10·(1−R))−1` 在 R 低时更大，得出的是**更长**的间隔 | 按库的真实行为实现并写测试。这是 FSRS-6 的算法事实，不是 bug |
| §5.6 间隔上限 | `maximum_interval` 会夹住间隔 | `reviewState` 里有 `good_interval = max(good_interval, hard_interval + 1)`，实测 50 → 51 | `settle()` 在应用层再夹一次，保证设置真的成立 |
| §4.1.3 疑似重复 | 编辑距离 ≤ 1 且词根相同 | `run` 与 `running` 的编辑距离是 4，按字面写完就永远提示不到，而文档测试清单要求它触发 | 判定改成「词根相同 + 前缀关系」或「词根相同 + 编辑距离 ≤ 1」，两条并列 |
| §5.9 时间回拨 | `elapsed_days` 夹到 0，不推进 | ts-fsrs 遇到负 `delta_t` 直接抛 `Invalid delta_t` | `settle()` 先拦下来直接返回原卡，不把回拨时间喂给库 |

还有一处是**我自己写错、靠测试抓出来的**（记在这里防止以后再犯）：

| 位置 | 错误 | 症状 | 修法 |
|---|---|---|---|
| `domain/stats.ts` | 逾期天数多取了一个负号 | 首页「逾期最久」和复习页顶部永远是 0 | `daysBetween(due, today)` 本身就为正，不要再取反 |
| `data/sqlite/repo.ts` `commitImport` | 新词只写了 `words`，漏了 `senses` | 导入 38 行后词条有了但一个释义都没有，复习时显示「（无释义）」 | 补一段多值 `INSERT INTO senses`，L1/manual |
| `ui/pages/ReviewPage.tsx` | `shown` 只在按「不会」时更新 | 看完 37 张，`sessions.shown` 一直是 0 | 每张卡结算后都推进 `shown` 与 `again` |

---

## License

MIT
