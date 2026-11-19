# 喂鲸鱼小游戏 · 开源资产侦察报告

> **侦察限制（实测）**：本机浏览器内核不可用（no spawnable Electron binary），raw.githubusercontent / jsDelivr / CodePen 全部被拦截。许可证与体积改由 `api.github.com`（权威 SPDX）、`api.iconify.design`（返回 spdx 字段）、`registry.npmjs.org`、`bundlephobia` 直取，均为实测值。
> ⚠️ **冲突提示**：AGENTS.md 明列「**不做桌宠**」。喂鲸鱼若做成常驻宠物，与产品定位冲突；建议限定为「复习完成后的单次奖励插曲」，否则先与 lead 确认定位。

## 一、鲸鱼 SVG 素材

| # | 来源 | License | 体积 | 可搬部分 | 风险 |
|---|---|---|---|---|---|
| 1 | **Fluent Emoji Flat `1f433`** `microsoft/fluentui-emoji` | **MIT** | 2020 B，5 path，viewBox `0 0 32 32`，0 依赖 | 图层天然可拆：p0/p1 身体 `#00a6ed`、p2 腹部 `#aeddff`、p3 眼 `#1c1c1c`、p4 喷水 `#26eafc`。眼 path 可直接做眨眼：`M15.517 15a.61.61 0 0 1-.604-.604v-.758c0-.33.274-.604.604-.604s.604.274.604.604v.758a.604.604 0 0 1-.604.604` | 眼睛是圆点，眨眼需换成短线；MIT 需保留版权声明 |
| 2 | **IconPark `whale`** `bytedance/IconPark` | **Apache-2.0** | viewBox `0 0 48 48`，stroke-width 4，2 path + 眼 circle | 线条风鲸鱼，眼是独立 `<circle>`，适合暗色 paper/ink | 仓库已 archived；线条风与彩色 emoji 需二选一 |
| 3 | **Lucide Lab `whale`** `lucide-icons/lucide-lab` | **ISC** | 24×24，stroke-width 2，1 group 4 子 path | 喷水与身体两条 path 分离，尾鳍可单独 `rotate()` | ⚠️ lucide **主线没有 whale**，只有 lab 子集有；需单引 lab 或拷 path |
| 4 | **Twemoji `1f40b`** `jdecked/twemoji` | 图形 **CC-BY-4.0**（仓库代码 MIT） | **670 B，仅 2 path**——最省体积 | 整条 path 直接内联 | CC-BY 需在关于页署名 |
| 5 | **OpenMoji `1f433`** `hfg-gmuend/openmoji` | **CC-BY-SA-4.0** | 3053 B，2 group / 8 path，有独立线条层 | 彩色+描边双层可拆 | **慎用**：SA 有传染性，闭源分发有义务；建议仅作设计参考 |

**已排除**：Font Awesome Free 6.7.2 —— solid 只有 `fish`，`whale.svg` 404（whale 属 Pro）→ 死路；Phosphor 2.1.1 只有 `fish`/`fish-simple`，无鲸；`picon/whale` 是 8×8 像素风（OFL-1.1，可商用需署名），适合 pixel 路线。

## 二、可复用的宠物 CSS 动效

1. **oneko.js**（`adryd325/oneko.js`，**MIT**，62 KB 仓库/单文件约 250 行）—— 最值得抄的是**结构**：`spriteSets` 帧表按状态给 `[col,row]` 序列（idle / alert / tired / sleeping / 8 方向）、`frameCount % 10` 节流、`idleTime` 超时切状态、`transform: translate` + `scaleX(±1)` 转身、`prefers-reduced-motion` 直接 return、localStorage 存位。**搬法**：保留帧表调度器，把 `oneko.gif` 换成鲸鱼雪碧图即可获得呼吸/摆尾/睡觉全套。风险：需自备精灵图，且其鼠标追随逻辑在喂食场景应删掉。
2. **纯 CSS 基线（自写，零来源风险）**：呼吸 `scale(1, 1.02)` 3.6s alternate；摆尾 `rotate(±4deg)`，`transform-origin` 钉在尾根；张嘴用 0.12s 的 `clip-path` 切变。
3. **CodePen 纯 CSS 鲸鱼/水母**（`ZZqgQq`、`WbbWRdG` 等）→ **不可直接搬**：CodePen 默认无许可证，且实测被 Cloudflare 拦截无法读源码确认授权。只可看效果，不可拷代码。
4. **mainVPet / pixel-paws / Virtual-Pet 类**：GitHub 搜到的全部 0–1 star 且 **无 LICENSE** → 按「未声明 = 不可用」排除。

## 三、测验干扰项（distractor）生成

| 候选 | License | 体积/依赖 | 可用性 |
|---|---|---|---|
| **dwyl/english-words** | **Unlicense**（公有领域，最宽松） | 466k 词纯文本，0 依赖 | ✅ 首选词源 |
| **word-list** (npm) | **MIT** | 274k 词，**0 依赖** | ✅ 可直接 `import` |
| **an-array-of-english-words** | **MIT** | 0 依赖 | ✅ 备选 |
| **wordpos** | **MIT** | 3 依赖（WordNet） | ⚠️ 唯一能给词性的，但要 POS 才引 |
| Yomitan | **GPL-3.0** | — | ❌ **代码禁用**，只能读思路 |
| Anki | **AGPL-3.0** | — | ❌ **代码禁用** |
| google-10000-english | **仓库无 LICENSE = 不可用** | — | ❌ |

**推荐做法（不引库，约 60 行 TS）**：先按**同词性**过滤（可用 wordpos 生成一次静态 POS 索引后固化成 JSON，运行时零依赖）→ 同长度 ±2 → 与正确答案编辑距离 ≥3 → 排除同义词根。词表放 Tauri resources 或首屏后懒加载，**别打进 bundle**（466k 词 ≈ 4 MB）。

## 四、状态机 / 饥饿条

| 方案 | License | 体积（bundlephobia 实测） | 结论 |
|---|---|---|---|
| xstate@5.19.0 | MIT | 43.3 KB / **13.4 KB gzip** | ❌ 过重，为一个喂食循环不值 |
| @xstate/fsm@2.1.0 | MIT | 3.6 KB / 1.6 KB gzip | ⚠️ 可但冗余 |
| **robot3**@0.3.1 (`matthewp/robot`) | **BSD-2-Clause** | 2.8 KB / **1.2 KB gzip，0 依赖** | ✅ 真需要库就它，`state.matches()` + 守卫，函数式不可变 |
| **自写 `useReducer` + 判别联合** | 自有 | **0 KB** | ✅ 最契合项目「不引依赖」气质 |

**饥饿条范式（无库）**：用 CSS 自定义属性驱动，避免 `setInterval` 累加漂移——

```css
.hunger { --h: .72; width: calc(var(--h) * 100%); transition: width 600ms linear; }
.hunger--critical { animation: pulse 1.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .hunger, .hunger--critical { transition: none; animation: none; }
}
```

冷却/倒计时用 `animation-duration: var(--secs)` + `animationend` 收尾，不要用 `setTimeout` 链。

## 首选组合

**用 Fluent Emoji Flat 的 `1f433` 五层 path（MIT，眼睛单独一层，眨眼只改一条 path）+ oneko.js 的帧表状态调度思路（只借结构不搬图）+ 自写约 60 行 CSS keyframes 和一个 `useReducer` 状态机；干扰项用 dwyl/english-words（Unlicense）+ 自写 60 行规则。不引 xstate、不引任何动画库、不碰 GPL/AGPL。**
