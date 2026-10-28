/**
 * 文件保存 / 读取（走 Tauri dialog + fs）。
 * 这是 ui/ 唯一允许碰文件系统的地方。
 */
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";

export interface SaveOptions {
  defaultName: string;
  filters: Array<{ name: string; extensions: string[] }>;
}

/** 弹保存对话框并写文件；用户取消返回 null。 */
export async function saveTextFile(content: string, opts: SaveOptions): Promise<string | null> {
  const path = await save({
    defaultPath: opts.defaultName,
    filters: opts.filters,
  });
  if (path === null) return null;
  await writeTextFile(path, content);
  return path;
}

/** 弹打开对话框并读文件；用户取消返回 null。 */
export async function openTextFile(opts: {
  filters: Array<{ name: string; extensions: string[] }>;
}): Promise<{ path: string; text: string } | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    filters: opts.filters,
  });
  if (picked === null) return null;
  const path = Array.isArray(picked) ? picked[0] : picked;
  if (!path) return null;
  const text = await readTextFile(path);
  return { path, text };
}

/** 首页 × 天检查用的「今天」。 */
export function todayKey(boundaryHour: number): string {
  const d = new Date(Date.now() - boundaryHour * 3_600_000);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
