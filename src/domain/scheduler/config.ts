/**
 * 排程配置（开发文档 §4.5 / §5.2 / §5.6.1）
 *
 * 所有参数都可改，且必须写进设置表、随导出一起带走。
 * 这里只定义「参数长什么样、怎么校验、怎么变 ts-fsrs 的 generatorParameters」。
 */
import { fsrs, generatorParameters, type FSRS } from "ts-fsrs";

export interface SchedulerConfig {
  /** 目标保留率，0.80–0.95 */
  requestRetention: number;
  /** 单次会话上限，60–300 */
  sessionLimit: number;
  /** FSRS 间隔上限（天），20–3650。备考期 50，理由见文档 §5.6.1 */
  maximumInterval: number;
  /** 间隔达到此值 + 次数达标才毕业（天），30–365 */
  graduateInterval: number;
  /** 最少复习次数，防止「间隔一长就毕业」，2–10 */
  minRepsToGraduate: number;
  /** 遗忘次数达到此值强制毕业，3–20 */
  graduationOnLapses: number;
  /** 一天的边界小时，0–6 */
  dayBoundaryHour: number;
}

/** 文档 §4.5 定稿默认值 */
export const DEFAULT_CONFIG: SchedulerConfig = {
  requestRetention: 0.85,
  sessionLimit: 150,
  maximumInterval: 50,
  graduateInterval: 90,
  minRepsToGraduate: 4,
  graduationOnLapses: 6,
  dayBoundaryHour: 4,
};

export interface Range {
  min: number;
  max: number;
  /** 允许小数（保留率用） */
  float?: boolean;
}

export const CONFIG_RANGES: Record<keyof SchedulerConfig, Range> = {
  requestRetention: { min: 0.8, max: 0.95, float: true },
  sessionLimit: { min: 60, max: 300 },
  maximumInterval: { min: 20, max: 3650 },
  graduateInterval: { min: 30, max: 365 },
  minRepsToGraduate: { min: 2, max: 10 },
  graduationOnLapses: { min: 3, max: 20 },
  dayBoundaryHour: { min: 0, max: 6 },
};

function clamp(n: number, r: Range): number {
  const v = Math.min(Math.max(n, r.min), r.max);
  return r.float ? v : Math.round(v);
}

/**
 * 把（可能来自数据库 / 导入 JSON 的）任意值收敛成合法配置。
 * 越界的夹到边界，缺省的回落到默认值 —— 不改代码的分级，只在范围外兜底。
 */
export function normalizeConfig(partial: Partial<Record<keyof SchedulerConfig, unknown>>): SchedulerConfig {
  const out: SchedulerConfig = { ...DEFAULT_CONFIG };

  for (const key of Object.keys(CONFIG_RANGES) as Array<keyof typeof CONFIG_RANGES>) {
    const raw = partial[key];
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(n)) {
      // requestRetention 允许 0.85 这种带小数的；其它按整数处理
      out[key] = clamp(n, CONFIG_RANGES[key]) as never;
    }
  }

  return out;
}

/** 参数变了就重建实例。enable_fuzz / enable_short_term 两个 false 是硬约束，见 §5.2。 */
export function buildFsrs(cfg: SchedulerConfig): FSRS {
  return fsrs(
    generatorParameters({
      request_retention: cfg.requestRetention,
      maximum_interval: cfg.maximumInterval,
      enable_fuzz: false,
      enable_short_term: false,
      learning_steps: [],
      relearning_steps: [],
    }),
  );
}

/**
 * 设置页每一行要展示的元信息（名称 / 说明 / 范围 / 单位）。
 * 文案集中在这里，UI 只负责渲染。
 *
 * 只剩数值项了：「显示不会按钮」随 §4.3.2 改成两步流程一起退役，
 * 「背错了」现在是复习页的固定按钮，不再是可关的开关。
 */
export interface SettingMeta {
  key: keyof SchedulerConfig;
  label: string;
  unit: string;
  range: string;
  describe: string;
}

export const SETTING_META: SettingMeta[] = [
  {
    key: "requestRetention",
    label: "目标保留率",
    unit: "",
    range: "0.80 – 0.95",
    describe: "你希望复习时还记得的概率。调低 → 间隔变长、复习变少、忘得变多。",
  },
  {
    key: "sessionLimit",
    label: "单次会话上限",
    unit: "张",
    range: "60 – 300",
    describe: "一次打开最多看多少张。不改变到期计算，只决定这次看多少，超出的顺延。",
  },
  {
    key: "maximumInterval",
    label: "最大间隔",
    unit: "天",
    range: "20 – 3650",
    describe:
      "单个词的复习间隔上限。备考期用 50：考试在明年 3 月，排到 200 天后的词等于考前再也见不到。考完试想长期用 → 调到 365。",
  },
  {
    key: "graduateInterval",
    label: "毕业间隔",
    unit: "天",
    range: "30 – 365",
    describe: "间隔到 90 天、并且复习满 4 次，才标「已毕业」。备考期内因为上限只有 50 天，够不到 90。",
  },
  {
    key: "minRepsToGraduate",
    label: "最少复习次数",
    unit: "次",
    range: "2 – 10",
    describe: "防止「一次 Good 就算毕业」。不建议低于 3。",
  },
  {
    key: "graduationOnLapses",
    label: "强制毕业阈值",
    unit: "次",
    range: "3 – 20",
    describe: "一个词被标「背错了」累计这么多次，强制毕业，不再纠缠。",
  },
  {
    key: "dayBoundaryHour",
    label: "一天的边界",
    unit: "时",
    range: "0 – 6",
    describe: "凌晨 2 点背的词算「昨天」，避免深夜学习被误判逾期。",
  },
];
