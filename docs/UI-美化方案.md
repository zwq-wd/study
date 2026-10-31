# wordpacer 页面美化方案 · 台灯下的单词卡

> 目标版本：v0.2 视觉层
> 性质：**纯样式改动**。不动 `src/domain/`、不动 `src/data/`、不动任何业务逻辑。
> 验收前提：`npm run typecheck` 零错误，`npm run test` 158 项全绿（本次改动不应使任何一项失败）。

---

## 0. 一句话

现在这套 token 叫 `ink` 和 `paper`——墨、纸。但界面是平的：没有纸，也没有墨。

**把它做成真的：台灯开着，桌面上一团黄光，一叠卡片，一次只把一张推到光底下。**
光下是「现在该看的那一张」，暗处是「还没轮到的几百张」。

这不是装饰，是把排程器的行为直接画出来——顺延的词不消失，它们在暗处等着，不催你。

---

## 1. 三条设计决定

### 决定一：背景是一盏灯，不是一块纯色

`radial-gradient`，光源在 40% 22% 处，桌面从灯心暖褐衰减到边缘近黑，亮度比 **1.51:1**。

**用光做层次，不用字号做层次。** 首页现在是四行 `text-sm` 平分秋色，靠 `justify-between` 撑着；
改成把「今日到期」放在光最亮处，次级信息自然落在光锥外缘、跟着暗下去。层次是免费的，因为它是物理的。

### 决定二：卡面是一张纸，不是一块玻璃

`#241f18`，比灯心亮 1.32:1——看得出浮起一层，但**不加阴影**。
深色界面上的阴影永远是脏的灰边。用一条 hairline 边 + 一档明度差就够了。

明确**不做**：毛玻璃（那是 iOS，不是书桌）、玻璃拟态、渐变文字、发光边框 hover。

### 决定三：英文用衬线体

这是整个方案的题眼。单词卡天然是印刷品，衬线体是它的本来面目。

现在英文用 `font-light` + 字体栈第一顺位「Microsoft YaHei UI」——那是**中文字体**，
它的拉丁字形是给中文排版配的备用字母，52px 下笔画分布平均、没有粗细对比，所以看起来「虚」。
衬线体在 52px 下笔画的粗细对比会把字立起来。

**中文释义保持黑体，一律不碰衬线。** 衬线英文 × 黑体中文是拉英混排的标准配对，
也刚好把「题面 / 答案」分开——这个分层不靠颜色、不靠大小，靠字体本身。

**只能用系统字体**（离线应用，不能拉 Google Fonts）。可用回退链见 §3.2。

---

## 2. Design Token

### 2.1 关键设计：**绝大多数类名不用改**

新的 `--color-paper` / `--color-paper-dim` / `--color-ink-line` / `--color-accent` **保持原名**，
只换色值。这样全站 **82 处 `text-paper`、57 处 `text-paper-dim`、24 处 `border-ink-line`、
23 处 `text-accent` 一行都不用动**。

需要改名的只有下表 5 项。

| 旧 token | 旧值 | 新 token | 新值 | 用途 | 受影响处数 |
|---|---|---|---|---|---|
| `--color-ink` | `#171a21` | `--color-ink`（保留） | `#151210` | 最深底色 + **金按钮上的字** | 0（值变名不变） |
| `--color-ink-soft` | `#1e222b` | **`--color-card`** | `#241f18` | 卡面 / 输入框底 | 5 |
| `--color-ink-line` | `#2b303c` | `--color-ink-line`（保留） | `#3a342b` | 分割线 / 描边 | 0 |
| `--color-paper` | `#e9e6df` | `--color-paper`（保留） | `#ede8df` | 正文 / 英文 | 0 |
| `--color-paper-dim` | `#9aa0ad` | `--color-paper-dim`（保留） | `#aaa294` | 次要文字 | 0 |
| `--color-accent` | `#e8c46a` | `--color-accent`（保留） | `#d9b45f` | 金 | 0 |
| `--color-accent-dim` | `#b99748` | **`--color-accent-hover`** | `#e6c675` | 金按钮 hover | 4 |

> ⚠️ **注意 hover 是变亮不是变暗**：`#b8944a` 作 hover 会让金按钮上的深色字对比掉到 4.34:1（不达标）；
> 往亮走则升到 7.48:1。所以 token 名字里的 "dim" 是错的，必须改名。

### 2.2 完整 token 表

| Token | 值 | 角色 |
|---|---|---|
| `--color-desk-1` | `#3d3325` | 桌面·灯心 |
| `--color-desk-2` | `#2f281e` | 桌面·渐隐 |
| `--color-desk-3` | `#262018` | 桌面·中段 |
| `--color-desk-4` | `#1d1811` | 桌面·远 |
| `--color-ink` | `#151210` | 桌面·灯灭处 / 金底上的字 |
| `--color-card` | `#241f18` | 卡面 |
| `--color-card-lift` | `#2a2419` | 卡面悬停 |
| `--color-well` | `#14110e` | 凹槽（输入框内部） |
| `--color-ink-line` | `#3a342b` | 细线 |
| `--color-line-strong` | `#4a4234` | 卡边（比细线重一档） |
| `--color-paper` | `#ede8df` | 墨·正文 |
| `--color-paper-dim` | `#aaa294` | 墨·次要 |
| `--color-paper-faint` | `#a59d8e` | 墨·更淡（占位符 / 辅助） |
| `--color-accent` | `#d9b45f` | 金 |
| `--color-accent-hover` | `#e6c675` | 金·悬停 |
| `--color-warn` | `#d8b878` | 警示（替代 `text-amber-300`） |
| `--color-danger` | `#d98d7d` | 危险 / 错误（替代 `text-red-400`） |
| `--color-good` | `#96b98a` | 正向（备用） |

### 2.3 对比度矩阵（全部实测计算，WCAG AA = 4.5:1）

背景列：`core` = 灯心、`mid` = 中段、`edge` = 灯灭处、`well` = 凹槽、`card` = 卡面、`lift` = 卡面悬停、`row` = 列表行悬停

| 前景 | 色值 | core | mid | edge | well | card | lift | row |
|---|---|---|---|---|---|---|---|---|
| `paper` | `#ede8df` | 10.13 | 13.22 | 15.28 | 15.42 | 13.40 | 12.61 | 11.97 |
| `paper-dim` | `#aaa294` | 4.89 | 6.38 | 7.38 | 7.44 | 6.47 | 6.08 | 5.78 |
| `paper-faint` | `#a59d8e` | 4.60 | 6.00 | 6.94 | 7.00 | 6.08 | 5.72 | 5.44 |
| `accent` | `#d9b45f` | 6.27 | 8.17 | 9.45 | 9.54 | 8.29 | 7.80 | 7.40 |
| `accent-hover` | `#e6c675` | 7.48 | 9.75 | 11.28 | 11.38 | 9.89 | 9.30 | 8.83 |
| `warn` | `#d8b878` | 6.50 | 8.48 | 9.81 | 9.90 | 8.60 | 8.09 | 7.69 |
| `danger` | `#d98d7d` | 4.74 | 6.19 | 7.16 | 7.22 | 6.27 | 5.90 | 5.60 |
| `good` | `#96b98a` | 5.65 | 7.37 | 8.53 | 8.60 | 7.48 | 7.04 | 6.68 |

按钮类：

| 组合 | 对比度 |
|---|---|
| `ink` 字 on `accent` 底（主按钮） | 6.27 ✅ |
| `ink` 字 on `accent-hover` 底（主按钮悬停） | 7.48 ✅ |

> `--color-accent-quiet`（`#b8944a`）**只允许用于边框和背景，不用于文字**——它在灯心上只有 4.34:1。

### 2.4 对比现在修掉了什么（这是本方案的硬收益）

| 位置 | 现状 | 对比度 | 修后 |
|---|---|---|---|
| `ImportPage.tsx:73`、`SearchPage.tsx:136,167`、`SettingsPage.tsx:173` 占位符 `placeholder:text-paper-dim/50` | `#595d67` | **2.64** ❌ | 改 `placeholder:text-paper-faint` → 4.60–6.08 ✅ |
| `SettingsPage.tsx:180` 区间说明 `opacity-50` | ≈`#575d68` | **≈2.9** ❌ | 去掉 opacity，用 `text-paper-faint` ✅ |
| `ImportPage.tsx:154`、`ReviewPage.tsx:312` `opacity-60` | ≈`#666a75` | **3.22** ❌ | 去掉 opacity，用 `text-paper-faint` ✅ |
| `ImportPage.tsx:140` `text-paper-dim/60` | `#666a75` | **3.22** ❌ | `text-paper-faint` ✅ |
| `ImportPage.tsx:142`、`SettingsPage.tsx:247`、`SearchPage.tsx:118,187,188` `text-paper-dim/70` | `#737883` | **3.93** ❌ | `text-paper-faint` ✅ |
| `SearchPage.tsx:191` `text-paper-dim/50` | `#595d67` | **2.64** ❌ | `text-paper-faint` ✅ |

**原则：文字不再使用 `/50 /60 /70` 透明度或 `opacity-*`，需要更弱就用 `text-paper-faint` 这个具体色值。**
（唯一例外：`disabled:opacity-40` 可以保留，禁用态本就不需要满足对比度。）

---

## 3. `src/styles.css` 完整替换

直接整文件替换，共 66 行 → 约 120 行。

```css
@import "tailwindcss";

/* ─── 台灯下的单词卡 ────────────────────────────────────────────
   桌面是一盏灯：光源在左上方，越往外越暗。
   卡面是纸：浮起一层，用明度和 hairline 边分离，不用阴影。
   墨是字：paper / paper-dim / paper-faint 三档。
   金只出现在三个地方：今日到期数字、主按钮、「不会」标记。
   不做主题切换按钮，保持安静。 */

@theme {
  /* 桌面 */
  --color-desk-1: #3d3325;
  --color-desk-2: #2f281e;
  --color-desk-3: #262018;
  --color-desk-4: #1d1811;
  --color-ink: #151210;

  /* 卡面 / 凹槽 */
  --color-card: #241f18;
  --color-card-lift: #2a2419;
  --color-well: #14110e;
  --color-row-hover: #2e281d;

  /* 线 */
  --color-ink-line: #3a342b;
  --color-line-strong: #4a4234;

  /* 墨 */
  --color-paper: #ede8df;
  --color-paper-dim: #aaa294;
  --color-paper-faint: #a59d8e;

  /* 金 */
  --color-accent: #d9b45f;
  --color-accent-hover: #e6c675;

  /* 语义色（取代 Tailwind 默认的 red-400 / amber-300） */
  --color-warn: #d8b878;
  --color-danger: #d98d7d;
  --color-good: #96b98a;

  /* 字体 */
  --font-sans: "Microsoft YaHei UI", "PingFang SC", "Segoe UI", system-ui, sans-serif;
  /* 只给英文单词用；中文永远不碰衬线（屏上会发虚） */
  --font-serif: "Sitka Text", Georgia, Cambria, "Times New Roman", serif;
}

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  color: var(--color-paper);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  overflow: hidden;

  /* 灯：光源在 40% 22%，半径放到 120% 让衰减铺满整窗 */
  background-color: var(--color-ink);
  background-image: radial-gradient(
    ellipse 120% 100% at 40% 22%,
    var(--color-desk-1) 0%,
    var(--color-desk-2) 22%,
    var(--color-desk-3) 45%,
    var(--color-desk-4) 68%,
    var(--color-ink) 100%
  );
  background-attachment: fixed;
}

/* ─── 焦点：键盘用户必须看得见自己在哪里 ─────────────────────── */
/* 现在全项目 focus-visible 出现 0 次，而复习页全靠键盘。 */
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: 2px;
}
/* 输入框的焦点同时保留边框变色作为补充，而不是唯一提示 */
input:focus-visible,
textarea:focus-visible {
  outline-offset: 1px;
}

/* ─── 组件层：把散落在 5 个页面里的长 className 收口 ─────────── */
@layer components {
  .btn {
    @apply inline-flex items-center justify-center rounded-md text-sm
           transition-colors duration-150 disabled:cursor-default;
  }

  /* 主操作：金底深字 */
  .btn-primary {
    @apply btn bg-accent px-5 py-2 font-medium text-ink
           hover:bg-accent-hover disabled:bg-ink-line disabled:text-paper-dim;
  }

  /* 次操作：细边 */
  .btn-ghost {
    @apply btn border border-ink-line px-4 py-2 text-paper
           hover:border-accent hover:text-accent
           disabled:border-ink-line disabled:text-paper-faint;
  }

  /* 文字链 */
  .btn-link {
    @apply text-sm text-paper-dim underline-offset-4
           hover:text-accent hover:underline;
  }

  /* 输入框 / 文本域共用 */
  .input {
    @apply rounded-md border border-ink-line bg-well px-4 py-2.5 text-sm text-paper
           outline-none placeholder:text-paper-faint
           focus:border-accent;
  }

  /* 卡面 */
  .panel {
    @apply rounded-lg border border-line-strong bg-card;
  }

  /* 标签（取代 text-[10px]） */
  .tag {
    @apply rounded border border-ink-line px-1.5 py-0.5
           text-[11px] leading-none text-paper-dim;
  }
}

/* ─── 释义浮现：墨渗开 ─────────────────────────────────────────
   不做翻转（§9.2 禁翻转，因为翻转要人等）；渗开不用等。 */
@keyframes ink-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.ink-in {
  animation: ink-in cubic-bezier(0.2, 0, 0.2, 1) 160ms both;
}

/* 系统要求减少动效时：立刻出现，不要位移 */
@media (prefers-reduced-motion: reduce) {
  .ink-in {
    animation: none;
  }
  * {
    transition-duration: 0.01ms !important;
  }
}

/* ─── 复习页字号三档（§9.2：32 / 40 / 52 px） ─────────────────── */
.word-size-0 {
  font-size: 32px;
}
.word-size-1 {
  font-size: 40px;
}
.word-size-2 {
  font-size: 52px;
}

/* 英文单词专用：衬线 + 常规字重（衬线自带的粗细对比已经够了，
   再加 font-light 会把这层对比抹掉） */
.word {
  font-family: var(--font-serif);
  font-weight: 400;
  letter-spacing: 0.01em;
}

::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-thumb {
  background: var(--color-ink-line);
  border-radius: 4px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
```

> **Tailwind v4 注意**：`@layer components` 里用 `@apply` 引用其它自定义类（`.btn`）是支持的，
> 但 `.btn` 必须先定义。上面的顺序已经正确，不要打乱。

---

## 4. 逐文件改动清单

### 4.1 `src/ui/App.tsx`（53 行）

| 行 | 现在 | 改成 | 理由 |
|---|---|---|---|
| 34 | `border-b border-ink-line px-6 py-2` | `border-b border-ink-line/60 px-6 py-2 backdrop-blur-[2px]` | 让 header 透明浮在灯光上；`/60` 弱化分割线 |
| 41-45 | `"rounded px-3 py-1.5 text-sm text-accent"` / `"rounded px-3 py-1.5 text-sm text-paper-dim transition hover:text-paper"` | 激活：`"relative rounded px-3 py-1.5 text-sm text-paper"` + 下方 2px 金条；未激活：`"rounded px-3 py-1.5 text-sm text-paper-dim transition-colors hover:text-paper"` | 当前态只是金/灰换色，太弱；加一条底线，「当前在哪」用位置表达而不是颜色 |

激活态金条用伪元素或一个 `<span>`：

```tsx
{page === n.page && (
  <span className="absolute inset-x-2 -bottom-[9px] h-px bg-accent" aria-hidden />
)}
```

> 注意 `-bottom-[9px]` 需要按 header 的 `py-2` 实际值微调，让线与 header 下边重合。

### 4.2 `src/ui/pages/HomePage.tsx`（181 行）

**核心改动：让光自然分出主次，不再用字号硬撑。**

| 行 | 现在 | 改成 |
|---|---|---|
| 79 | `mx-auto flex h-full max-w-2xl flex-col justify-center gap-10 px-10 py-12` | `mx-auto flex h-full max-w-xl flex-col justify-center gap-8 px-10 py-12` |
| 82 | `flex items-end justify-between border-b border-ink-line pb-6` | `flex items-end justify-between border-b border-ink-line/70 pb-7` |
| 84 | `text-sm tracking-wide text-paper-dim` | `text-xs tracking-[0.18em] text-paper-dim` |
| 86 | `text-6xl font-light tabular-nums text-accent` | `text-7xl font-extralight tabular-nums leading-none text-accent` |
| 93-99 | 主按钮长 className | `className="btn-primary px-6 py-3 text-base"` |
| 101-109 | 「一次性看完」`text-sm text-paper-dim underline-offset-4 hover:text-accent hover:underline` | `className="btn-link"` |
| 113-121 | 顺延中行 | 序号标 `text-xs`，值保持 `text-sm`；整行加 `pl-1` 让文字落在光锥内 |
| 123-139 | 词库 / 下次到期两行 | 包一层 `<div className="space-y-3 border-l border-ink-line/50 pl-4">`，用左侧一条细线把三行次级信息收成一组 |
| 143-154 | 空队列卡片 | 容器 `rounded-lg border border-ink-line px-6 py-8 text-center` → `panel px-6 py-8 text-center` |
| 156-164 | 备份提醒 | `className="btn-link text-xs"` |
| 166-190 | 底部两个按钮 + 刷新 | 两个按钮 → `btn-ghost`；刷新 → `btn-link` |

**新增**：给数字加一个微弱的金色辉光，让「灯」的隐喻落在最重要的元素上：

```tsx
<span className="text-7xl font-extralight tabular-nums leading-none text-accent"
      style={{ textShadow: "0 0 32px rgba(217,180,95,0.18)" }}>
```

> 这是全站**唯一**允许的 `text-shadow`。别的地方用就俗了。

### 4.3 `src/ui/pages/ReviewPage.tsx`（302 行）

| 行 | 现在 | 改成 |
|---|---|---|
| 265 | `flex h-full select-none flex-col px-10 py-6` | `flex h-full select-none flex-col px-10 py-6`（不变） |
| 270 | `flex items-baseline justify-between text-sm text-paper-dim` | 加 `relative z-10`（保证在卡之上） |
| 274-283 | 字号切换按钮 `text-xs text-paper-dim hover:text-accent` | `btn-link text-xs` + `aria-label="切换字号"`（现在只有 `title`） |
| **289-313** | 卡面容器 `flex flex-1 flex-col items-center justify-center gap-8 text-center` | **整个替换成下面这段** |

**卡面替换（核心）**：

```tsx
{/* 卡面：一张纸，浮在灯下。加 padding 而不是加大间距，让边留得从容 */}
<div className="flex flex-1 items-center justify-center px-4">
  <div
    className="panel relative flex w-full max-w-2xl flex-col items-center justify-center
               gap-7 px-10 py-14 text-center"
    style={{ boxShadow: "0 24px 60px -32px rgba(0,0,0,0.75)" }}
  >
    <div className={`word ${sizeClass} text-paper`}>{current.headword}</div>

    {session.revealed ? (
      <div className="ink-in space-y-2.5">
        {shownSenses.length === 0 ? (
          <div className="text-sm text-paper-faint">（无释义）</div>
        ) : (
          shownSenses.map((s) => (
            <div key={s.id} className="flex items-center justify-center gap-2">
              <span className="text-xl leading-relaxed text-paper">{s.meaning_cn}</span>
              {isSupplement(s) && <span className="tag">{t.review.supplement}</span>}
            </div>
          ))
        )}
      </div>
    ) : (
      <div className="text-sm tracking-wide text-paper-faint">{t.review.revealHint}</div>
    )}
  </div>
</div>
```

> **关于这里唯一的一处 `boxShadow`**：卡面浮在**灯下**，而不是浮在纯黑上。
> 光从左上打来，所以阴影向右下偏移（`+24px`），并且用负扩散（`-32px`）让它只在卡的
> 下边缘露出一圈极淡的暗——这是「纸挡光」的物理影子，不是玻璃拟态的发光边。
> 如果真机上看起来偏脏，直接删掉这一行即可，靠 `border-line-strong` 也能分离。

| 行 | 现在 | 改成 |
|---|---|---|
| 303 | `rounded border border-ink-line px-1.5 py-0.5 text-[10px] text-paper-dim` | `className="tag"` |
| 312 | `text-sm text-paper-dim opacity-60` | `text-sm text-paper-faint` |
| 319-333 | 「不会」按钮 | `btn-ghost px-6 py-3`；开启时 `border-ink-line` 保持，**不要**为了醒目染红 |
| 334-343 | 「下一张」按钮 | `btn-primary px-8 py-3 text-base` |
| 232-250 | 结束页 | 容器加 `gap-3`；`doneTitle` 用 `text-lg text-paper`；按钮用 `btn-ghost` |

**结束页额外**：给「本次结束」上方加一段留白而不是加装饰——`mt-6` 改成 `mt-10`，其他不变。

### 4.4 `src/ui/pages/ImportPage.tsx`（148 行）

| 行 | 现在 | 改成 |
|---|---|---|
| 61 | `mx-auto flex h-full max-w-3xl flex-col gap-5 px-8 py-8` | `mx-auto flex h-full max-w-2xl flex-col gap-4 px-8 py-8` |
| 62 | `text-sm text-paper-dim` | `text-xs tracking-wide text-paper-dim` |
| 73 | `min-h-64 flex-1 resize-none rounded-lg border border-ink-line bg-ink-soft p-4 font-mono text-sm leading-7 text-paper outline-none placeholder:text-paper-dim/50 focus:border-accent` | `input min-h-64 flex-1 resize-none font-mono leading-7` （`rounded-lg` 保留？→ 用 `.input` 的 `rounded-md`，文本域可另加 `rounded-lg`） |
| 81 | 解析预览按钮 | `className="btn-ghost px-5"` |
| 89 | 导入按钮 | `className="btn-primary"` |
| 93 | `text-sm text-accent` | `text-sm text-accent`（不变） |
| 94 | `text-sm text-red-400` | `text-sm text-danger` |
| 99 | `rounded-lg border border-ink-line p-4 text-sm` | `panel p-4 text-sm` |
| 109 | `text-xs text-red-400` | `text-xs text-danger` |
| 112 | `text-xs text-paper-dim` | 错误行正文用 `text-xs text-paper-dim`（不变），行号用 `text-paper-faint` |
| 126 | `text-xs text-amber-300/80` | `text-xs text-warn` |
| 140 | `text-paper-dim/60` | `text-paper-faint` |
| 142 | `ml-2 text-paper-dim/70` | `ml-2 text-paper-faint` |
| 154 | `opacity-60` | 删掉，父级已是 `text-paper-dim` |

### 4.5 `src/ui/pages/SearchPage.tsx`（181 行）

| 行 | 现在 | 改成 |
|---|---|---|
| 76 | 详情页容器 | `max-w-2xl`（与其它页对齐） |
| 80 | 返回按钮 | `btn-link` |
| 86 | `text-3xl font-light text-paper` | `text-3xl font-normal text-paper`（中文不用 light，会虚） |
| 87 | `text-xs text-paper-dim` | `tag` 里的状态文字（加边框更有「词条」感） |
| 90-102 | 四格信息 `grid grid-cols-2 gap-2 text-sm text-paper-dim` | `grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-ink-line/60 bg-card/40 p-4 text-sm`；标签 `text-paper-faint`，值 `text-paper` |
| 100-101 | 硬编码中文「复习次数：」「遗忘次数：」 | **移进 `i18n.ts`**（`t.searchPage.reps` / `lapses`）——一致性 |
| 113 | `rounded border border-ink-line px-1.5 py-0.5 text-[10px] text-paper-dim` | `className="tag"` |
| 118 | `text-[10px] text-paper-dim/70` | `text-xs text-paper-faint` |
| 122 | `text-sm text-paper-dim` | `text-sm text-paper-faint` |
| 136, 167 | 输入框长 className | `className="input"` |
| 142, 149 | 两个按钮 | `btn-ghost` |
| 177 | `divide-y divide-ink-line overflow-auto rounded-lg border border-ink-line` | `divide-y divide-ink-line/60 overflow-auto rounded-lg border border-line-strong bg-card/30` |
| 183 | `transition hover:bg-ink-soft` | `transition-colors hover:bg-row-hover` |
| 185 | `w-42` | `w-40`（`w-42` 不在 Tailwind 默认刻度上，现在能生效说明是 v4 任意值支持，但没必要） |
| 187 | `text-xs text-paper-dim/70` | `text-xs text-paper-faint` |
| 188 | `text-xs tabular-nums text-paper-dim/70` | `text-xs tabular-nums text-paper-faint` |
| 191 | `text-xs tabular-nums text-paper-dim/50` | `text-xs tabular-nums text-paper-faint` |

> 列表五列在 `minWidth: 520` 下会挤。见 §5。

### 4.6 `src/ui/pages/SettingsPage.tsx`（252 行）

| 行 | 现在 | 改成 |
|---|---|---|
| 139 | `p-8 text-paper-dim` | `flex h-full items-center justify-center text-paper-dim`（与其它页 loading 一致） |
| 143 | `max-w-3xl` | `max-w-2xl` |
| 145 | `text-lg text-paper` | `text-base font-medium text-paper` |
| 146 | `text-xs text-accent` | 保留，但加 `transition-opacity` 让「已保存」淡入淡出 |
| 149 | `divide-y divide-ink-line rounded-lg border border-ink-line` | `divide-y divide-ink-line/60 overflow-hidden rounded-lg border border-line-strong` |
| 153 | `grid grid-cols-[9rem_7rem_1fr] items-start gap-4 px-4 py-3` | `grid grid-cols-[8rem_6rem_1fr] items-start gap-4 px-4 py-3.5` |
| 154 | `text-sm text-paper`（标签） | `text-sm text-paper`（不变） |
| 160 | 布尔开关 `rounded border border-ink-line px-2 py-0.5 text-xs text-paper hover:border-accent` | **换成 switch**，见下 |
| 173 | 数字输入框长 className | `className="input w-20 px-2 py-1 text-sm"` |
| 178 | `text-xs leading-5 text-paper-dim` | `text-xs leading-5 text-paper-dim`（不变） |
| 180 | `ml-2 opacity-50` | `ml-2 text-paper-faint` |
| 205 | 恢复默认 | `btn-ghost` |
| 221 | 导出 JSON | `btn-primary` |
| 229, 237 | 导出 CSV / 导入 JSON | `btn-ghost` |
| 243 | `text-xs text-accent` | 保留 |
| 245 | `text-xs text-red-400` | `text-xs text-danger` |

**布尔开关替换（160-163 行）**：

```tsx
<button
  type="button"
  role="switch"
  aria-checked={value as boolean}
  onClick={() => void patch(m.key, !(value as boolean))}
  className={`relative h-5 w-9 rounded-full border transition-colors ${
    (value as boolean)
      ? "border-accent bg-accent/25"
      : "border-ink-line bg-well"
  }`}
>
  <span
    className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
      (value as boolean) ? "left-[18px] bg-accent" : "left-0.5 bg-paper-faint"
    }`}
  />
</button>
```

> 现在这个「开/关」文字按钮（`SettingsPage.tsx:157-163`）看起来像没做完。换 switch 成本极低，
> 而且 `role="switch"` + `aria-checked` 一次就把无障碍也补上了。

### 4.7 `src/ui/i18n.ts`

新增两条，收掉 `SearchPage.tsx:100-101` 的硬编码中文：

```ts
reps: "复习次数",
lapses: "遗忘次数",
```

---

## 5. 响应式

窗口 `minWidth: 520`（`tauri.conf.json`）。三处会挤：

| 位置 | 问题 | 修法 |
|---|---|---|
| `SearchPage.tsx:177-197` 结果行五列 | 520px 下头部单词被压到 20px 宽 | 容器加 `@container`，`w-40` 改成 `@[640px]:w-40 w-24`；最后两列日期在窄屏隐藏（`hidden @[560px]:block`） |
| `SettingsPage.tsx:153` 三列网格 | `8rem + 6rem + 1fr` = 固定 224px，剩 296px 放说明 | 窄屏改两行：`grid-cols-1 @[600px]:grid-cols-[8rem_6rem_1fr]`，说明文字落到第二行 |
| `ReviewPage` 卡面 `max-w-2xl` | 520px 下 `px-10 py-14` 内外都挤 | 改 `px-6 py-10 @[600px]:px-10 @[600px]:py-14` |

Tailwind v4 原生支持 `@container`，不需要额外插件。`.panel` 的容器上加 `@container` 即可。

---

## 6. 验收清单

### 必过

- [ ] `npm run typecheck` 零错误
- [ ] `npm run test` 158 项全绿
- [ ] 五个页面在 960×720 和 520×560 两个尺寸下都不溢出、不横向滚动
- [ ] 只用键盘可以走完「首页 → Tab 到开始复习 → Enter → Space 显示 → → 下一张 → 结束 → 回首页」，全程**焦点可见**
- [ ] 系统设置里打开「减少动态效果」，释义浮现不再位移
- [ ] 应用在 100% / 125% / 150% 缩放下文字不糊（WebView2 会缩放，衬线体在高 DPI 下比黑体更需要看）

### 目测

- [ ] 首页一眼看过去，只有一个东西在「光里」
- [ ] 复习页的卡是「一张纸」，不是「一块玻璃」——从侧面看不出它有发光边
- [ ] 52px 的英文用衬线后，笔画有粗细对比，不再发虚
- [ ] 中文释义没有一处用到衬线体
- [ ] 金色只出现在：今日到期数字、主按钮、「不会」标记
- [ ] 全站找不到 `text-red-*` / `text-amber-*` / `text-[10px]` / 文字上的 `opacity-*` / 文字上的 `/50 /60 /70`

### 自查命令

```powershell
# 应该全部返回 0 条
rg "text-(red|amber|green|blue|emerald|sky)-" src/ui
rg "text-[10px]" src/ui
rg "opacity-(50|60|70)" src/ui
rg "text-paper(-dim)?/(50|60|70)" src/ui
rg "bg-ink-soft|bg-accent-dim" src/ui
```

---

## 7. 实施顺序

分 5 步，每步都能独立跑起来看效果，不用一次改完。

| 步 | 内容 | 涉及 | 预期 |
|---|---|---|---|
| **1** | 换 `styles.css` 的 `@theme` 色值 + body 灯效渐变；补 `:focus-visible`；加 `@layer components` | 1 个文件 | 立刻看到全站气质变了，且**不改任何 tsx** |
| **2** | 清对比度债：所有 `/50 /60 /70` 和文字上的 `opacity-*` → `paper-faint`；`red-400`/`amber-300` → `danger`/`warn`；`text-[10px]` → `.tag` | Import / Search / Settings / Review | 这一步是**修 bug**，不修就是没做完 |
| **3** | 组件化：17 处长 `btn` className → `.btn-primary` / `.btn-ghost` / `.btn-link`；4 处输入框 → `.input`；5 处容器 → `.panel` | 全 5 个页面 | 代码变短，为后面换皮留出口 |
| **4** | 复习页卡面 + 衬线英文 + `ink-in` | ReviewPage | 产品心脏 |
| **5** | 首页光锥分层 + 导航激活线 + 设置页 switch + 响应式 | App / Home / Settings / Search | 收尾 |

> **建议步骤 1 单独提交一次**。它改的是 token，后面的改动全部建立在它之上；
> 如果这一步效果不满意，回滚只有 1 个文件。

---

## 8. 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| Tailwind v4 的 `@apply` 在 `@layer components` 里引用同层自定义类（`.btn`）可能报错 | 步骤 3 卡住 | 若不支持，把 `.btn` 的公共部分内联进每个 `.btn-*`（重复 4 行 `@apply`，无伤大雅） |
| `Sitka Text` 不是所有 Win10 版本都有 | 英文回退到 Georgia，仍可接受 | 回退链已写好；Georgia 自带于所有 Windows |
| 灯效 `radial-gradient` 在 WebView2 上有轻微色带（banding） | 大屏纯色区域可能看到一圈圈 | 在渐变里加极淡噪点，或把中段 stop 加密；先看真机，多数情况看不出 |
| 卡面 `boxShadow` 在深色底偏脏 | 复习页显得脏 | 已在注释里标明：删掉这一行即可，靠 border 分离依然成立 |
| 收紧 `max-w-3xl` → `max-w-2xl` 让某些长文案换行 | 录入页 `placeholder` 多行示例可能断行难看 | 该 `placeholder` 是手写的多行文本，宽度不够时手动断行位置要复核 |

---

## 9. 本次**不做**的事（边界）

写明是为了防止以后被"顺手加一点"侵蚀：

- 不做浅色主题 / 主题切换按钮（`styles.css` 原有注释已表态：保持安静）
- 不做毛玻璃、玻璃拟态、渐变文字、发光边框 hover
- 不做页面切换过渡动画（五个页面硬切是有意的，不是缺陷）
- 不做任何图表、热力图、连击、进度条动画（§2.2 明令禁止）
- 不加新依赖（不引 framer-motion、不引字体包）
- 不改 `src/domain/`、`src/data/`、`src-tauri/` 任何一行
