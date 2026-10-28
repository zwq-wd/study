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
