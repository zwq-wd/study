# Changelog

本项目的所有重要变更都记录在这里。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.6.3] - 2026-11-19

修好复习页「点不了下一张」：`settleWord` 的事务体里漏改了一处 `db` → `tx`。

### 修复

- v0.6.2 把事务改成「整段占锁 + 事务体走直连通道 tx」时，`settleWord` 里
  更新 `words` 用的是 `tx`，但紧接着插 `review_logs` 那条**还写着外层的 `db.execute`**。
  外层 `db` 会先排队等锁，而锁正被这个事务拿着 → 永远等不到。
- 表现出来就是复习页：中文出来了、两个按钮都在，点「背对了 / 背错了」**没反应**，
  `advanceLockRef` 也不会释放，于是下一张永远出不来。
- 数据库里能直接看到现场：卡住那两次会话 `shown=0, again=0, ended_at=NULL`。
- 修法：把那一处也改成 `tx.execute`，事务体里所有语句统一走 `tx`。

### 测试

**365 项全绿**（v0.6.2 是 363 项）。

- 新增 `test/review-settle.test.ts` 2 项：用一个「事务持锁期间若还用外层 db 就
  立刻抛 REENTRY」的假 driver 把这种写法钉死 —— 它不会挂住，而是直接失败，
  所以以后谁再把 `db.execute` 写回事务体，CI 会当场变红。
- 覆盖单张结算与连续结算多张（复习页逐张推进的真实路径）。
- 已验证有约束力：把那一处改回 `db.execute`，两条测试立刻失败。

另外确认导入已恢复正常：用户库里 `words` 从 835 增长到 885，`review_logs` 2131 条。

## [0.6.2] - 2026-11-19

修好 v0.6.1 引入的**导入死锁**，并补上真正的事务隔离。

### 修复

- **导入点了没反应**：v0.6.1 在 `db.ts` 里加了一道串行闸门，`tx.ts` 的
  `withTransaction` 又加了一道 —— 外层拿锁等内层，内层等外层，永远等不到。
  现在只有**一道**锁，由 `withTransaction` 整段持有。
- **事务会被别的事务插队**：只把串行做到「语句级」时，实际时序是
  `BEGIN A / BEGIN B / INSERT a / INSERT b / COMMIT / COMMIT` ——
  B 的 BEGIN 插进了 A 事务中间，A 的 COMMIT 把两边的写一起提交。
  现在事务**整段**占锁，日志严格是 `BEGIN a / INSERT a / COMMIT / BEGIN b / …`。
- **并发时仍然 code 5**：v0.6.2 一度用全局 `depth` 做「重入」判断，
  但并发时事务 A 持锁等 IO，事务 B 看到 `depth > 0` 就以为自己也在事务体内、
  直接放行插队。废弃该做法，改成**显式**直连通道：`withTransaction(db, fn)`
  把绕开锁的 `tx` 交给 `fn`，事务体里所有语句必须用 `tx`。

### 测试

**363 项全绿**（v0.6.1 是 359 项），连跑 5 次无抖动。

- `test/lock.test.ts` 8 项：认出 code 5、不误判、`directExecutor` 取直连通道、
  事务体多次 execute 不自锁、两个并发事务严格不交叉（逐条比对日志）、
  抛错时真的 ROLLBACK、以及「不串行时并发事务必 BUSY」的根因复现。
- `test/import-pooled.test.ts` 3 项：把 `SqliteRepo` 的**真实导入路径**跑在
  带连接池语义的 driver 上（并发才开第二条连接），覆盖正常导入不报 code 5、
  两次导入并发互不打断、同词重复导入走追加义项。
- 已验证这组测试有约束力：把事务改回「不串行」，`import-pooled` 立刻红。

真实环境验证：0.6.2 运行中，外部并发 8 次导入规模的事务全部成功、0 次 BUSY；
库仍为 835 词，`integrity ok`。

## [0.6.1] - 2026-11-19

修复导入时报 `error returned from database: (code: 5) database is locked`。

### 修复

- **根因**：plugin-sql 底下是 sqlx 的**连接池**（默认 10 条连接），`execute` 每次都
  「取一条 → 跑 → 归还」，连续两条语句**不保证落在同一条连接上**。
  于是 `withTransaction` 里的时序变成：`BEGIN IMMEDIATE` 在连接 A 上拿到写锁 →
  A 归还进池（锁仍在它身上）→ 下一条语句被派给连接 B → B 处于 autocommit，
  直接发起写入 → 立刻 `SQLITE_BUSY (code 5)`。
- 这不是「busy_timeout 太小」：它只会等**别人**，不会等**自己池子里**那条握着锁
  的连接。所以调大超时没用；单纯重试也没用 —— 只要 `BEGIN` 与后续语句还落在
  不同连接上，每轮重试都会以同样方式失败（`test/lock.test.ts` 里用按 sqlx 真实
  行为建模的假池子把这条时序钉死了）。
- **修法**：`db.ts` 给 `Database` 套一层**全局串行代理** —— 同一时刻只有一条语句
  在飞，池里就只会用到一条连接，`BEGIN` 与它后面的语句必然复用同一条，事务语义
  才真的成立。另外在 `tx.ts` 补了 BUSY 退避重试（约 2s），兜住外部进程短暂占锁。
- 代价可以忽略：这是单用户桌面应用，写入本来就是「一次一屏」的小事务。

### 测试

**359 项全绿**（v0.6.0 是 352 项）。新增 `test/lock.test.ts` 7 项：
认出 code 5、不误判其它错误、复现「不串行时并发事务必 BUSY」、
串行后两个并发事务都成功且全程只用一条连接、事务体的语句不会被别的事务插进来、
事务体抛错时真的 ROLLBACK。

另外在真实数据库上验证过：旧构建（空闲状态）会一直持有写锁，外部连
`BEGIN IMMEDIATE` 都拿不到；新构建运行中，外部连续 6 次写入 6 次成功、0 次 BUSY。

## [0.6.0] - 2026-11-19

把「喂肥鱼」整个重做了一遍：**画面不再由代码绘制，全部换成图片与视频素材**，
玩法从「答对一次吃一口」改成**打饭机**——答对一个词打一勺，五个词打满一碗。

### 变更

- **游戏页换成素材驱动的场景**（`src/ui/game/` 与 `public/pet/`）。
  角色不再是 SVG 重绘的鲸鱼娘，而是桌宠工程里现成的 VP9-alpha 透明 webm
  （待机 / 吃白饭 / 开心 / 饿了 / 被吓到，640×360 / 24fps），
  由 `FatFish.tsx` 按实测包围盒（`x 207..429, y 60..332`）放大并负位移裁掉留白，
  换片不跳位。删除了 `Whale.tsx` 与 `whale.css`。
- **打饭机**（`RiceDispenser.tsx`）：机器本体、饭碗、掉饭粒都是生图后抠白转成的 webp
  （`public/pet/props/`），机器下方五格灯表示这碗装到第几勺。
- **玩法改成一碗五词**：`config.ts` 新增 `WORDS_PER_BOWL = 5` 与 `BOWL_SATIETY`。
  `GameState.served` 的含义从「答对几次」改成**真正吃进嘴的碗数**，
  新增 `serving`（正在接饭的那碗）、`pending`（打满排在台上的碗）、`bowlsMade`。
- **多碗排队**：打满几碗台子上就摆几碗，肥鱼饿了就一碗一碗吃，
  吃的时候播「吃白饭」片段。台子上限 `MAX_PENDING_BOWLS = 5`。
- **话术换成打饭主题**（`i18n.ts` + 新增 `domain/game/lines.ts`）：
  `scoopLine` 按勺报进度（「三勺……手别抖啊。」），`bowlDoneLine` 是装满时的台词；
  `pickLine` 抽成纯函数（窗口内不重复），`bowlProgressLine` 按勺数取。
  语气照桌宠人格：自称「人家」，会撒娇也会嘴硬，但不说教。
- **音效分两层**（`sfx.ts`）：吃 / 开局 / 答错用桌宠自带的 wav，
  掉勺、装满、宽限期提示继续用 Web Audio 现场合成。
  新增 `preloadSfx()`，第一次开声音时解码好，避免首响延迟。

### 修复

- `answer()` 曾经顺手调 `eatBowl`，而 UI 播完吃动画又调一次 —— **一碗被吃两遍**。
  现在 `answer()` 只负责把碗打出来，吃归 UI 播完动画后调 `eatBowl`。
- `eatBowl()` 在宽限期里不退出 `grace`，导致「明明吃到了却仍被倒计时吃掉」。
  现在吃到一碗就回 `playing` 并清零 `graceMsLeft`。
- 透明 webm 在切后台 / 首帧未解码时会被 WebView 自己暂停，
  `FatFish.tsx` 补了 `visibilitychange` / `focus` / `pointerdown` 三个续播点。

### 素材与许可

- 角色动画与音效来自 `D:\dsh-pet-standalone-webm-chat`（角色 OC「溟月」，
  原仓库 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)），
  按 CC BY-NC-SA 类条款**仅限个人非商业使用**。
- 道具图由文生图生成（hunyuan-image-alpha，1536×1024，本次 6.46 积分），
  出图后脚本抠白、切分、转 webp。来路与限制记在 `public/pet/NOTICE.md`。

### 测试

**352 项全绿**（v0.5.0 是 350 项）。`test/game.test.ts` 重写为 64 项，盯新口径：
五勺一碗、打满后台面上多一碗、`answer` 不偷吃、`eatBowl` 封顶 100、
宽限期吃一碗真的回 `playing`、队列超过上限丢最早的、台词窗口不重复。

## [0.5.0] - 2026-11-16

本轮加的是一局**游戏**：背单词喂肥鱼。它刻意站在排程器之外 ——
不写 `review_logs`、不动 `fsrs_*`、不写 `sessions`，玩死一局也影响不到任何词的到期日。

### 新增

- **游戏模式「喂肥鱼」**（`src/ui/pages/GamePage.tsx`，全屏页，顶部导航 + 首页入口）。
  四选一：答对 → 肥鱼吃一碗饭（饱食度 +20，封顶 100）；答错 → 没饭吃、它催你一句。
  饱食度按难度匀速掉（易 12s/格 · 中 8s/格 · 难 5s/格，5 格满），
  掉到 0 进宽限期（易 12s · 中 10s · 难 8s），宽限期内答对立刻救回来，
  超时才被它把画面吞掉 → 结算 → 再来一局。
- `domain/game/hunger.ts`：饥饿状态机纯函数 `startGame / tick / answer / giveUp`。
  时间由 UI 的 rAF 以 `elapsedMs` 传入，domain 侧零 `Date.now()`，整套逻辑可在 vitest 里零时钟测试。
- `domain/game/quiz.ts`：出题。英→中与中→英随机交替；干扰项来自全库，
  抽到就与正确答案做**防重叠**比对（归一化后互相包含、或共享 ≥2 个连续汉字就重抽），
  同一条词的释义不会变成它自己的干扰项；凑不齐 3 个合格干扰项时**返回 null 跳过这个词**，
  宁可少出一题，也不出「两个都对」的废题。
- `domain/game/pool.ts`：今日池子 = 今天背错的词 ∪ 今天新导入的词，按 `word.id` 去重（错词优先）后洗牌。
  只用 L1 义项 —— L2 补充释义在 `fsrs_reps >= 3` 之前在复习页是不可见的，不能先在游戏里露脸。
- `Repo.gameTodayPool(today)` / `Repo.listDistractors(limit)`：两条只读取数。
  前者一次把两个来源连同 L1 释义查回来（不做 N+1 次 IPC），后者用 `ORDER BY RANDOM()` 抽干扰项。
- `src/ui/game/Whale.tsx` + `whale.css`：鲸鱼娘，纯 SVG + CSS，八种状态（idle / happy / eating /
  hungry / tremble / burp / swallow / over）。造型语言照 `docs/游戏模式-鲸鱼娘美术规范.md` 重画
  —— 原素材不在任何开源许可范围内，只能照着比例与配色重绘。
- `src/ui/game/sfx.ts`：Web Audio 现场合成的音效（吃饭、打嗝、答错、宽限警告、吞屏）。
  零音频文件、零版权风险；**默认静音**。
- `src/ui/game/gameSession.ts`：游戏会话态独立成一个 zustand store，
  所以离开这一页再回来是**接着吃**，不是重置，也不是按真实时间补算。
- 设置页新增「游戏模式」一组：默认难度、音效开关（键 `game_difficulty` / `game_sound`）。

### 关键设计：为什么答错不扣血

答错已经丢了一次喂食机会，再叠加扣血等于把同一次失误罚两遍。
调研（`docs/oss-scout-喂鲸鱼资产.md` 与团队调研报告）里 Duolingo Energy 的反例说明，
**零失误也会被扣**的设计会直接劝退用户。所以这里只有「没吃到」，没有「倒扣」。
同理：离开页面即冻结、重开永远满格、被吃掉只终结**这一局**，不产生任何学习数据上的后果。

### 测试

**350 项全绿**（v0.4.0 是 279 项，本轮 +71）。

- `test/game.test.ts` **新增 62 项**，盯 domain 纯函数：三档掉速、归零进宽限而非直接结束、
  宽限内答对回血、+20 封顶且满食时 `served` 不增、答错不扣血、`bestStreak` 记历史最高、
  非法 `elapsedMs` 幂等、池子去重与错词优先、最近 3 题不重复、干扰项三重不重复、
  凑不齐时返回 null。
- `test/repo.integration.test.ts` **新增 9 项**跑真实 SQLite：两个来源各自返回且都带 L1 释义、
  边界小时与 `listMissedToday` 走同一条时间轴、`listDistractors` 只给 L1、limit 越界不崩、
  以及「查完 `words` 与 `review_logs` 一行都没变」。

## [0.4.0] - 2026-11-11

本轮补上「录完当天就能再看一眼今天背的词」——**只读回看，不是复习**。
首页只多一块入口，排程、持久化、设置项一律没动。

### 新增

- **今日新词回看**（`src/ui/pages/TodayPage.tsx` + 首页入口 + 录入页跳转）。
  候选是 `words.created_at` 落在今天（按 `day_boundary_hour` 划界）的词。
  卡片形态与「重新复习」（§4.3.6）一致：只显英文 → 点一下出中文，
  **下面只有一个按钮**：「我记到了」→「下一张 / 看完了」。
- `domain/scheduler/todayWords.ts`：`buildTodayWords(candidates, limit, rng)` 纯函数，
  取前 limit 条后洗牌；`limit` 为 0 / 负数 / NaN 时当作**没有上限**（与 `buildRereview` 同一套策略）。
- `Repo.listTodayNewWords(today)`：用 `dayRange` 划出今天的时间区间查 `created_at`。
  **只读**，不改库、不结算、不写日志。
- 首页新增一块 `再看一遍（今天录入 N 张）`，**N = 0 时整块不出现**；
  录入页导入成功后多一个直接跳过去的按钮。
- `Page` 联合类型新增 `"today"`；文案集中到 `t.todayWords`。

### 关键设计：只读，因为它是一次翻看

新词入库即计一次 Good（§5.5），第一个到期日在入库那一刻就由 FSRS 算定了 ——
实测 `due_day` = 入库日 + 4 天（`test/repo.integration.test.ts`）。
翻看若也结算，`reps` / `scheduled_days` 会被「今天多看了两眼」推着往前走，
而 `maximum_interval = 50` 的全部意义是保证每个词在考前还能再见几次（§5.6.1）：
为了看一眼把词推远，正好把它推离考前。

同理，若允许翻看时点「背错了」，`lapses` 一涨就撞 `graduationOnLapses = 6`（§5.6），
**刚录的词可能当天就被系统判定「我认了」直接丢出队列**。回看之所以安全，恰恰因为不判对错。

所以这条路径**不写 `review_logs`、不动 `fsrs_*`、不写 `sessions`，也不计入首页「今日到期」**，
结束页写死一句「翻看不会改动排程，也不算一次复习。」

与「重新复习」（§4.3.6）的分工：那个看「今天**背错了**的词」（候选来自今天的 `review_logs`），
这个看「今天**新录入**的词」（候选来自今天的 `words.created_at`）。
两者都只读、候选互不重叠，先后顺序随意，互不冲突。

### 测试

**279 项全绿**（v0.3.0 是 266 项，本轮 +13）。

- `test/todayWords.test.ts` **新增 7 项**，盯 domain 纯函数：空输入、候选少于 / 多于上限、
  `limit = 0 / 负数 / NaN` 当作没有上限、输入数组不被改动、
  洗牌后仍是同一个多重集、以及注入 `rng` 后出场顺序确实被打乱。
- `test/repo.integration.test.ts` **新增 6 项** `listTodayNewWords` 用例，跑在真实 SQLite 上：
  空库返回空数组、今天 vs 昨天不串味、凌晨 02:00 与 04:00 的边界小时、
  结果按 `created_at` 正序、以及「查询前后 `words` 与 `review_logs` 一行都没变」。

## [0.3.0] - 2026-11-03

本轮把复习从「过一遍」改成「练到会」：背错了的词在本轮里再来一遍，直到背对。
另加一个全场结束后的「重新复习」入口。

### 新增

- **本轮重排**（`domain/scheduler/requeue.ts` + `ReviewPage`）：第二步点「背错了」后，
  该词被插回本轮队列，插在当前进度之后至少 5 张的随机位置，直到再次背对为止。
  同一张卡本轮最多重排 3 次（连同首次共 4 遍），封顶时顶部提示「这张先放着，明天还会再排到」。
  重排回来的卡在卡面上标「再过一遍」。
- **重新复习页**（`src/ui/pages/RereviewPage.tsx`）。首页新增入口
  `重新复习（今天背错 N 张）`，候选为 0 时整块不出现。
  卡片形态与复习页一致，但**只有一个按钮**：点「我记到了」翻中文，再点「下一张」。
  不判断对错 —— 判对错是复习页的职责。
- `domain/scheduler/rereview.ts`：`buildRereview` 纯函数，取前 N 条后洗牌。
- `domain/time.ts`：`dayRange(key, boundaryHour)` 把日键换成 `[start, end)` 时间区间，
  与 `dayKey` 互为逆运算。用于按「今天」聚类复习日志。
- `Repo.listMissedToday(today)`：取今天日志里 `rating = Again` 的词。
  **只读**，不结算、不写日志。

### 关键设计：同一张卡本轮只结算第一次

复习页每结算一次 `Again`，`lapses` 就 +1，而 `graduationOnLapses = 6` 会强制毕业。
若重排回来的每次作答都结算，一个词在这一次坐里错 6 次就会被永久移出队列 ——
**最需要练的词反而最先消失**。实测（S₀ = 2.31 的词在第 4 天）：

| 结算策略 | 本轮错 4 次后 lapses | stability |
|---|---|---|
| 每次作答都结算 | 4 | 2.31 → 0.02（再错 2 次强制毕业） |
| **只结算第一次**（采用） | 1 | 0.66（明天 due +1，正常恢复） |

第一次的反应才是真实的第一印象；后面的重复是练习，不是新的遗忘证据。
`domain/scheduler/requeue.ts` 的模块注释与 `test/requeue.test.ts` 的轨迹用例守着这条不变式。

「本次 N 张」相应改为 `settled.size`（真正结算过的卡），不再用队列长度 ——
重排会让队列变长，用长度会把练习次数算成新词。

### 修复

- **`decideRequeue` 对 NaN 的处理写反了**。`NaN >= 6` 是 `false`，原写法会让脏数据
  变成「永远重排」而不是「永不重排」。改为先归一化再比较，由 `test/requeue.test.ts` 盯住。
- **`resetWord` 的「立即排入」名不副实**。查询页「重新激活」原先用 `newWordCard` 实现，
  due = now + 4 天；而 `listDue` 只取 `fsrs_due_day <= 今天`，所以点完要等 4 天才会出现。
  改用 `createEmptyCard`（due = now、state = New、reps = lapses = 0），当天即可排入。
  同时 `reps` 从 1 改为 0 —— 重新激活等于从没背过。

### 测试

266 项全绿（新增 `test/requeue.test.ts` 16 项、`test/rereview.test.ts` 13 项、
`listMissedToday` 集成测试 8 项）。集成测试跑在真实 SQLite 上，覆盖边界小时
（凌晨 2 点算前一天、04:00 整算新的一天）、跨月、同日多次 Again 只取一次、
以及「查询不改变任何 FSRS 字段」。

## [0.2.0] - 2026-10-29

视觉层重做。**纯样式改动**：`src/domain/`、`src/data/`、`src-tauri/` 零改动，
158 项测试仍然全绿。设计说明见 [`docs/UI-美化方案.md`](docs/UI-美化方案.md)。

### 变更

- **配色**：从平涂深色改为「台灯下的单词卡」。桌面是一盏灯（`radial-gradient`，
  光源 40% 22%，亮度比 1.51:1），卡面是一张纸（`#241f18`，与灯心 1.32:1，
  hairline 边分离，不用阴影）。用光做层次，不用字号做层次。
- **英文改用衬线体**：`--font-serif`（Sitka Text → Georgia → Cambria）。
  原先 52px 英文使用 `font-light` + 中文字体栈的拉丁备用字形，笔画无对比、发虚。
  中文释义一律保持黑体，不碰衬线。
- **释义浮现**：`fade-in` 120ms 改为 `ink-in` 160ms（opacity + 4px 位移，
  不是翻转）。`prefers-reduced-motion` 下关闭位移。
- **设计 token 收敛**：新增 `paper-faint`、`card`、`well`、`row-hover`、
  `line-strong`、`accent-hover`、`warn`、`danger`、`good`；
  `paper` / `paper-dim` / `ink-line` / `accent` 保留原名只换色值，
  全站 186 处引用无需改动。

### 修复

- **对比度**：6 处文字低于 WCAG AA —— 占位符 `text-paper-dim/50`（2.64:1）、
  `opacity-50`（≈2.9:1）、`opacity-60`（3.22:1）、5 处 `text-paper-dim/70`（3.93:1）。
  全部改用 `text-paper-faint`，实测 4.60–6.08:1。
- **焦点可见性**：全项目 `focus-visible` 出现 0 次，而复习页完全依赖键盘。
  补全局 `:focus-visible` 焦点环。
- **主按钮 hover 方向**：原 `hover:bg-accent-dim` 是变暗，会让金色按钮上的
  深色字对比度掉到 4.34:1。改为变亮（`#e6c675`，7.48:1）。
- **主题外颜色**：`text-red-400` / `text-amber-300` 两个 Tailwind 默认色
  收进 `danger` / `warn`；3 处 `text-[10px]` 收进 `.tag`。

### 重构

- `src/styles.css` 新增 `@layer components`：`.btn-primary` / `.btn-ghost` /
  `.btn-link` / `.input` / `.panel` / `.tag`。17 处长 btn className、
  4 处输入框、5 处容器改用组件类。
- 设置页「开 / 关」文字按钮换成 switch（`role="switch"` + `aria-checked`）。
- 导航激活态改用底部金线，不再只靠颜色区分。
- 三处容器查询（`@container`）修复 520px 最小宽度下的挤压：
  查询页结果行、设置页三列网格、复习页卡面内距。
- `SearchPage` 硬编码的「复习次数 / 遗忘次数」移入 `i18n.ts`。

### 工程

- 新增 `.github/workflows/ci.yml`：类型检查、测试、前端构建、Rust 编译检查。

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

[0.6.3]: https://github.com/zwq-wd/study/releases/tag/v0.6.3
[0.6.2]: https://github.com/zwq-wd/study/releases/tag/v0.6.2
[0.6.1]: https://github.com/zwq-wd/study/releases/tag/v0.6.1
[0.6.0]: https://github.com/zwq-wd/study/releases/tag/v0.6.0
[0.5.0]: https://github.com/zwq-wd/study/releases/tag/v0.5.0
[0.4.0]: https://github.com/zwq-wd/study/releases/tag/v0.4.0
[0.3.0]: https://github.com/zwq-wd/study/releases/tag/v0.3.0
[0.2.0]: https://github.com/zwq-wd/study/releases/tag/v0.2.0
[0.1.0]: https://github.com/zwq-wd/study/releases/tag/v0.1.0