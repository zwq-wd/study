/**
 * 日期与时间 —— 本项目唯一允许做日期换算的地方（开发文档 §6）。
 *
 * 只服务单机单时区，全部走本地时区，不引入 dayjs / luxon。
 * 「一天的边界」默认 04:00：凌晨背的词在心理上属于「昨晚」。
 */

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** 把时刻按「边界小时」折算成日粒度键 YYYY-MM-DD。 */
export function dayKey(now: Date, boundaryHour = 4): string {
  const d = new Date(now.getTime() - boundaryHour * 3_600_000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 日键 → 该日 00:00 的本地 Date（仅用于算天数差，不参与展示）。 */
export function dayKeyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map((s) => Number.parseInt(s, 10));
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

/** a 到 b 相差多少天（b 晚于 a 时为正）。 */
export function daysBetween(a: string, b: string): number {
  const ms = dayKeyToDate(b).getTime() - dayKeyToDate(a).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * 一个日键对应的时间区间 [start, end)，epoch 毫秒，左闭右开。
 *
 * 和 dayKey 互为逆运算：dayKey(某时刻) === 日键 ⟺ 该时刻落在 dayRange(日键) 里。
 * 边界小时参与计算 —— 今天的区间是「今天 04:00 到明天 04:00」，不是 00:00 到 24:00。
 * 用在「查今天这一场复习里被标背错了的词」这种按日聚类的查询上。
 */
export function dayRange(key: string, boundaryHour = 4): { start: number; end: number } {
  const d = dayKeyToDate(key);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), boundaryHour, 0, 0, 0);
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
}

/** 日键加天数。 */
export function addDays(key: string, days: number): string {
  const d = dayKeyToDate(key);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 「今天没有到期」之外，把日期说成人话：今天 / 明天 / 3 天后 / 逾期 2 天。 */
export function describeDay(target: string, today: string): string {
  const diff = daysBetween(today, target);
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff > 1) return `${diff} 天后`;
  return `逾期 ${-diff} 天`;
}
