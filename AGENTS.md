# 你正在实现 wordpacer 这个 Tauri 桌面应用。

产品定位：一个**排程器**。它不教你单词、不考你、不评判你。只做三件事：
1. 记住你背过哪些词、每个词的释义
2. 每次打开它，算出「现在最该看哪些词」
3. 把词一张一张翻给你看

**明确不做**：不测验、不打分、不做连续打卡 streak、不做每日配额、不做日历网格主界面、
不做考试/成绩预测、不做内置核心词表、不做云同步、不做桌宠、AI 不进回忆屏。
复习页不显示进度条动画、不显示连击。队列为空时只显示「今天没有到期。」不加任何催促文案。

---

## 硬性约束（违反即返工）

1. `src/domain/` **不允许** import 任何 `@tauri-apps/*`、任何 `src/data/*`、任何 `src/ui/*`。
   它是纯函数层，零 IO、100% 可单测。「时间」一律从参数传进来，**不允许**在 domain 里调 `Date.now()`。
2. `src/ui/` **不允许**直接 import `ts-fsrs`。所有排程计算必须经 `domain/`。
3. `src-tauri/src/lib.rs` 不写任何 `#[tauri::command]`。业务全在 TS。
4. 禁止 `any`。跨边界（IPC / 导入 JSON）必须 `unknown` + 手写 parse。
5. `tsconfig` 已是 `strict` + `noUncheckedIndexedAccess` + `noUnusedLocals`，
   所有数组下标访问都要判空。`npm run typecheck` 必须零错误。

---

## 环境事实（实测，不要改）

- Node **20.18.1**（不要升 Vite 7，需 Node ≥ 20.19）
- 依赖用 **npm** 装（pnpm 12 在本机报 `ERR_PNPM_IGNORED_BUILDS`）
- Rust 用 **GNU 工具链**（本机没装 MSVC），且工具链必须在**纯 ASCII 路径**下：

  ```powershell
  $env:RUSTUP_HOME = "D:\wpchain\rustup"
  $env:CARGO_HOME  = "D:\wpchain\cargo"
  $env:TMP = "D:\wpchain\tmp"; $env:TEMP = $env:TMP      # dlltool 要在 TEMP 建临时文件
  $env:PATH = "D:\CLion 2024.1.5\bin\mingw\bin;$env:CARGO_HOME\bin;$env:PATH"
  $env:CARGO_TARGET_DIR = "D:\wpchain\target"
  ```

- **中文路径**：`windres` 打不开中文路径的 `.ico`，所以项目本体放在 `D:\wp\wordpacer`（纯 ASCII）。
  工作区里的 `英语\桌面背单词\wordpacer` 是指向它的 Junction。
- 中文路径下 Windows 控制台输出会有乱码，不影响写入。

---

## 开发文档在哪里

- `docs/01-开发文档.md`（1155 行，规格书）
- `docs/02-说明文档.md`（767 行，技术学习 + 使用手册）
- `docs/UI-美化方案.md`（视觉层设计说明，v0.2 起）

**这几个文件里有全部细节，遇到任何实现疑问先读对应章节，不要凭感觉发挥。**

