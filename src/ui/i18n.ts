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
    again: "不会",
    next: "下一张",
    prev: "上一张",
    doneTitle: "本次结束",
    doneLine: (n: number, again: number) => `本次 ${n} 张 · 标记不会 ${again} 张`,
    nextDueLine: (desc: string) => `下次到期 ${desc}`,
    backHome: "回首页",
    supplement: "补充",
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
