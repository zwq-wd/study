/**
 * 文案集中在这里（v1 只中文，但集中便于以后改）。
 * 顺带把「不做」的边界写进注释：不做打卡、不做配额、不做催促文案。
 */
export const t = {
  appName: "背单词",
  nav: {
    home: "首页",
    review: "复习",
    import: "录入",
    search: "查询",
    settings: "设置",
  },
  home: {
    dueLabel: "今日到期",
    deferredLabel: "顺延中",
    libraryLabel: "词库",
    nextDueLabel: "下次到期最早",
    startReview: "开始复习",
    reviewAll: "一次性看完",
    importWords: "录入新词",
    emptyQueue: "今天没有到期。",
    emptyHint: "",
    unit: "张",
    wordUnit: "词",
    learningCount: "学习中",
    graduatedCount: "已毕业",
    backupReminder: (days: number) => `距上次备份 ${days} 天 · 导出`,
    neverBackedUp: "还没有备份过 · 导出",
  },
  review: {
    progress: (i: number, n: number) => `${i} / ${n}`,
    maxOverdue: (days: number) => `逾期最久 ${days} 天`,
    revealHint: "点任意处 / 空格 显示中文",
    /** 第一步：回忆完了，把答案翻出来 */
    showAnswer: "我记到了",
    /** 第二步：看到中文之后的两个判断 */
    remembered: "背对了",
    forgot: "背错了",
    doneTitle: "本次结束",
    doneLine: (n: number, again: number) => `本次 ${n} 张 · 背错 ${again} 张`,
    /** 有重排时补一行，把「多看了几遍」说清楚 */
    doneRequeued: (n: number) => `其中 ${n} 张重看过（同一张本轮只结算一次）`,
    nextDueLine: (desc: string) => `下次到期 ${desc}`,
    backHome: "回首页",
    supplement: "补充",
    /** 这张卡本轮是重排回来的 —— 让「怎么又出现了」有解释 */
    requeueTag: "再过一遍",
    /** 同一个词本轮重排次数用尽 */
    requeueExhausted: "这张先放着，明天还会再排到",
  },
  /**
   * 重新复习（v0.4）。文案刻意不出现「错」「不及格」「再考一次」——
   * 它是「再看一遍」，不是补考。和首页一样：只给位置信息，不给情绪。
   */
  rereview: {
    title: "重新复习",
    progress: (i: number, n: number) => `${i} / ${n}`,
    /** 首页入口：今天背错了 N 个词 */
    entry: (n: number) => `重新复习（今天背错 ${n} 张）`,
    homeHint: "今天标过「背错了」的词。重看一遍，不改下次到期。",
    revealHint: "点任意处 / 空格 显示中文",
    showAnswer: "我记到了",
    next: "下一张",
    last: "看完了",
    doneTitle: "这轮看完了",
    doneLine: (n: number) => `本次重看 ${n} 张`,
    /** 必须写出来：重看不改排程，否则用户会以为「重看=复习过了」 */
    doneHint: "重看不会改动下次到期日。",
    emptyToday: "今天没有背错的词。",
    backHome: "回首页",
    restart: "再看一遍",
    /** 中途关掉软件后恢复 */
    resume: (i: number, n: number) => `已看过 ${i} / ${n}，从第 ${i + 1} 张继续`,
    deferNote: (n: number) => `另有 ${n} 张顺延到下一轮`,
  },
  /**
   * 今日新词。和 rereview 是同一类页面的两种入口：那个看「今天背错的」，
   * 这个看「今天录入的」。同样只读 —— 所以文案里不出现「复习」「到期」「掌握」。
   */
  todayWords: {
    title: "今日新词",
    homeHint: "今天录入的词。翻一遍，不改下次到期。",
    entry: (n: number) => `再看一遍（今天录入 ${n} 张）`,
    progress: (i: number, n: number) => `${i} / ${n}`,
    revealHint: "点任意处 / 空格 显示中文",
    showAnswer: "我记到了",
    next: "下一张",
    last: "看完了",
    doneTitle: "这轮翻完了",
    doneLine: (n: number) => `今天录入 ${n} 张`,
    /** 必须写出来：翻看不改排程，否则用户会以为「翻过=复习过了」 */
    doneHint: "翻看不会改动排程，也不算一次复习。",
    emptyToday: "今天还没有录入新词。",
    backHome: "回首页",
    restart: "再看一遍",
    goImport: "去录入",
    deferNote: (n: number) => `另有 ${n} 张留到下一轮`,
    /** 录入页导入成功后的入口：刚录完正是最想看一遍的时候 */
    fromImport: "再看一遍今天录入的词",
  },
  importPage: {
    title: "粘贴今天的词（每行一个）",
    placeholder:
      "abandon 放弃；抛弃\nabstract 抽象的\naccommodate\t容纳\n\n英文和中文之间用空格、Tab、逗号都行；\n中文多个意思用 ；; ，, / 分隔。",
    preview: "解析预览",
    commit: "导入",
    previewTitle: "预览",
    summary: (s: {
      totalRows: number;
      newWords: number;
      appendSenses: number;
      duplicates: number;
      noMeaning: number;
      errors: number;
    }) =>
      `${s.totalRows} 行 · 新增 ${s.newWords} · 追加义项 ${s.appendSenses} · 重复 ${s.duplicates} · 错误 ${s.errors}`,
    noMeaningNote: (n: number) => `${n} 条无释义（先建卡，释义后补）`,
    errorRows: "错误行",
    done: (n: number, s: number) => `已导入：新增 ${n} 词，追加 ${s} 条义项。`,
    nothingToImport: "没有可导入的行。",
    similarHint: (w: string) => `可能重复：${w}（已存在）`,
    aiChecking: "AI 正在校对英文…",
    aiClean: "AI 校对：没有发现拼写问题。",
    aiFailed: (reason: string) => `AI 校对没跑成：${reason}（不影响导入）`,
    aiPartial: (reason: string) =>
      `部分批次没校对成功：${reason}。下面只覆盖跑成的那部分，没列出的行不代表没问题。`,
    aiTitle: "AI 认为这些行可能有拼写问题",
    aiHint: "只是提示，不会自动改。改完再点一次「解析预览」重新校对。",
    aiSuggestion: "建议改成",
    aiKind: {
      spelling: "拼写错误",
      wordform: "词形存疑",
      nonexistent: "查无此词",
    },
  },
  searchPage: {
    placeholder: "按英文或中文查",
    empty: "查不到就是没背过。",
    noResult: "没有结果。",
    status: {
      learning: "学习中",
      graduated: "已毕业",
      suspended: "已暂停",
    },
    lastReview: "最后复习",
    nextDue: "下次到期",
    never: "还没复习过",
    addSense: "补充释义",
    addSensePlaceholder: "新义项（会标为「补充」，复习满 3 次后出现在卡片上）",
    add: "添加",
    reset: "重新激活",
    resetDone: "已重新激活，下次打开会排进复习。",
    reps: "复习次数",
    lapses: "遗忘次数",
    detail: "词条详情",
    back: "返回",
  },
  settingsPage: {
    title: "设置",
    saved: "已保存",
    reset: "恢复默认",
    dataTitle: "数据",
    exportJson: "导出 JSON",
    exportCsv: "导出 CSV",
    importJson: "导入 JSON",
    exportDone: "已导出。",
    importDone: (n: number, s: number) => `已导入：新增 ${n} 词，更新 ${s} 词。`,
    importMode: "导入模式",
    merge: "合并（按单词合并，已存在的以导入文件为准）",
    replace: "替换（清空全部再导入）",
    replaceWarning: "替换模式会清空现有全部数据。它会先弹一次确认。",
    confirmReplace: "确定要清空全部数据并导入吗？",
    dataLocation: "数据位置",
    aiTitle: "AI 校对",
    aiIntro:
      "录入时顺手检查英文有没有拼错。它只指出问题、不替你写释义，也不参与复习——回忆屏里不会出现任何 AI 内容。",
    aiEnable: "开启 AI 校对",
    aiEnableDesc: "关着就完全不联网。开着也要点了「解析预览」才会请求，不会后台偷跑。",
    aiKey: "API Key",
    aiKeyDesc: "只存在本机数据库，导出 JSON 时会被剔除，不会跟着备份文件走。",
    aiShow: "显示",
    aiHide: "隐藏",
    aiBaseUrl: "接口端点",
    aiBaseUrlDesc: "默认 DeepSeek。填 OpenAI 兼容的地址也能用（含 /v1 或路径均可）。",
    aiModel: "模型",
    aiModelDesc: "默认 deepseek-chat。",
    aiTest: "测试",
    aiTesting: "测试中…",
    aiTestOk: "链路正常：测试用的错拼词被识别出来了。",
    aiTestWeak: "请求通了，但没识别出测试用的错拼词。模型可能太弱或返回格式不符。",
    aiTestFailed: (reason: string) => `测试失败：${reason}`,
  },
  /**
   * 游戏模式。刻意写得像个游戏而不是学习工具：
   * 这里允许出现「饿」「催」「被吃掉」—— 它是一局游戏，不是排程器的一部分。
   * 但也不做愧疚感：不写「你已连续 N 天」，不写「再不背就完了」。
   */
  game: {
    nav: "喂肥鱼",
    title: "打饭喂肥鱼",
    tagline: "答对一个打一勺，五个词打满一碗。肥鱼只吃白饭。",

    /** 选难度 */
    pickTitle: "今天怎么喂",
    pickHint: "难度只改它饿的速度。随时可以重开换档。",
    difficulty: {
      easy: "易",
      normal: "中",
      hard: "难",
    },
    difficultyDesc: {
      easy: "12 秒掉一格 · 适合边听歌边玩",
      normal: "8 秒掉一格 · 得一直答",
      hard: "5 秒掉一格 · 手不能停",
    },
    start: "开机打饭",
    poolLine: (missed: number, fresh: number) =>
      `今天池子：背错 ${missed} 个 · 新导入 ${fresh} 个`,
    poolEmpty: "今天还没有背错或新导入的词。先去复习或录入几个。",
    goReview: "去复习",
    goImport: "去录入",
    poolLoop: "池子答完会从头再来，越玩越熟。",
    /** 词库太小，凑不出三个像样的干扰项 —— 这局没法开，直说，别让人对着白屏等 */
    poolTooSmall:
      "今天的词凑不出四选一（词太少，选不出三个不像的干扰项）。先多录几个词再玩。",

    /** 局内 */
    remaining: (n: number) => `还剩 ${n} 题`,
    satietyLabel: "饱食度",
    bowls: (n: number) => `吃了 ${n} 碗`,
    streakLine: (n: number) => `连对 ${n}`,
    bestStreak: (n: number) => `最高连对 ${n}`,
    graceTitle: "它要咬屏幕了",
    graceHint: (s: number) => `还有 ${s} 秒——吃一碗就救回来`,
    quit: "不玩了",
    mute: "静音",
    unmute: "开声音",
    keyboardHint: "1 / 2 / 3 / 4 或 A / B / C / D 选择",

    /** 打饭机 */
    bowlProgress: (filled: number, total: number) => `${filled} / ${total}`,
    bowlReady: "这碗满了",
    servingLabel: "正在打饭",
    queueLabel: (n: number) => `旁边排着 ${n} 碗`,
    queueFull: "台子摆不下了，先吃吧",

    /**
     * 打饭机报进度：每打进一勺说一句。
     * 索引 = 这一碗装到第几个 - 1（1/5 → 第 0 句，4/5 → 第 3 句）。
     * 语气照抄桌宠人格：自称「人家」，会撒娇也会嘴硬，但绝不说教。
     */
    scoopLine: [
      "一勺。这才哪到哪。",
      "两勺了，人家才开始热身。",
      "三勺……手别抖啊。",
      "四勺！差一勺就满，快！",
    ],
    /** 整碗打满时的一句 */
    bowlDoneLine: [
      "满碗！人家开动了——",
      "这碗归人家了。",
      "端走端走，下一碗！",
      "刚好五勺，一点不差。",
    ],

    /** 催促台词：答错时随机说一句。同一句 4 题内不重复。 */
    nag: [
      "啊——饭掉了！",
      "这一勺没接住……",
      "再来！人家碗还空着。",
      "你确定？人家看不对。",
      "快一点，人家饿了。",
      "别停啊，前面还有四勺。",
      "手滑了？那不算。",
      "人家等得饭都凉了。",
    ],
    /** 饿到 0 之后的台词 */
    hungryNag: [
      "人家要咬屏幕了！",
      "最后一碗！快！",
      "没得吃了……那就吃这个画面。",
      "饿到人家尾巴都软了。",
    ],

    /** 结算 */
    overTitle: "屏幕被吃掉了",
    quitTitle: "这局先到这",
    overEaten: "肥鱼把整个画面吞了下去。",
    overGaveUp: "你自己收手了。肥鱼还没吃饱。",
    resultBowls: "吃了",
    resultBowlsUnit: "碗",
    resultCorrect: "答对",
    resultWrong: "答错",
    resultBest: "最高连对",
    resultSurvived: "活了",
    resultUnit: "题",
    resultTimeUnit: "",
    again: "再来一局",
    backHome: "回首页",
    overHint: "这一局不进复习记录，你的排程没被动过。",

    /** 设置 */
    settingsTitle: "游戏模式",
    defaultDifficulty: "默认难度",
    soundToggle: "音效",
    soundToggleDesc: "默认关。开着才有吃饭的咕噜声。",
    settingsHint: "只是一局小游戏：玩完不写复习记录、不改下次到期，排程完全不受影响。",
  },
  common: {
    ok: "好",
    cancel: "取消",
    confirm: "确定",
    loading: "载入中…",
    error: "出错了",
  },
} as const;

/** 状态 → 中文（查询页与详情页共用）。 */
export function statusLabel(status: string): string {
  if (status === "graduated") return t.searchPage.status.graduated;
  if (status === "suspended") return t.searchPage.status.suspended;
  return t.searchPage.status.learning;
}