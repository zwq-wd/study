/**
 * 归一化（开发文档 §4.1.1）
 *
 * norm(headword) = lower(trim(headword))
 *   → 折叠连续空白为单空格
 *   → 去首尾非字母数字字符
 * 故意不做词形还原：abandoned 和 abandon 是两张不同的卡。
 */
export function normalizeHeadword(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

/**
 * 展示用：保留你输入的大小写，但仍折叠空白、去首尾杂字符。
 * 和 norm 的区别只有「不转小写」。
 */
export function normalizeDisplay(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
}
