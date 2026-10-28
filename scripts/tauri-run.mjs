#!/usr/bin/env node
/**
 * DSH 环境下启动 Tauri CLI 的包装脚本。
 *
 * 为什么需要它：DSH 自带的 pnpm 跑在 Electron 二进制里，process.execPath 指向
 * DSH Desktop.exe 而不是 node.exe。凡是 npm script 要调外部二进制（这里就是
 * tauri / cargo），依赖它重新 spawn 自己时会出现「参数错乱」。
 * 这里显式找一个真正的 node.exe，再用它去跑 @tauri-apps/cli。
 */
import { spawn } from "node:child_process";
import process from "node:process";
import fs from "node:fs";

function findRealNode() {
  const candidates = [];
  if (process.env.WORDPACER_NODE) candidates.push(process.env.WORDPACER_NODE);

  // process.execPath 本身就是 node 的情况（普通终端）
  if (/^node(\.exe)?$/i.test(process.execPath.split(/[\\/]/).pop() ?? "")) {
    candidates.push(process.execPath);
  }

  for (const p of (process.env.PATH ?? "").split(";")) {
    if (!p) continue;
    candidates.push(`${p}\\node.exe`);
  }
  candidates.push(
    "D:\\truffle\\node.exe",
    "C:\\Program Files\\nodejs\\node.exe",
    "D:\\Program Files\\nodejs\\node.exe",
  );

  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

const node = findRealNode();
if (!node) {
  console.error("找不到可用的 node.exe，请设置 WORDPACER_NODE 环境变量指向它。");
  process.exit(1);
}

const cli = new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url);
const args = [cli.pathname.replace(/^\/([A-Za-z]:)/, "$1"), ...process.argv.slice(2)];

const child = spawn(node, args, {
  stdio: "inherit",
  cwd: process.cwd(),
  env: { ...process.env, TAURI_CLI_NODE: node },
});
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error("启动 tauri-cli 失败：", err.message);
  process.exit(1);
});
