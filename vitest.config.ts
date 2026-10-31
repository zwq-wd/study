import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    reporters: ["default"],
    // 固定时区：dayKey 全程用本地时区（getFullYear/getMonth/getDate），
    // 而测试里写的是带 +08:00 的绝对时刻。GitHub runner 是 UTC，
    // 2026-10-27T10:00+08:00 在 UTC 下是 02:00Z，再减 4 小时日边界
    // 就落到前一天，导致 due_day 断言差一天。锁定 Asia/Shanghai，
    // 让 CI 与本机走同一条路径，也让这些日期断言在任何机器上稳定。
    env: {
      TZ: "Asia/Shanghai",
    },
    // 默认 5 秒对集成测试不够。repo.integration 与 e2e 每个用例都要
    // 跨进程往返几十次 SQLite，CI 的 Windows runner 上磁盘 I/O 慢、
    // Defender 还会扫临时目录，5 秒会稳定超时（本机则很快）。
    // 调大的是单用例上限，不是并发，不会掩盖死锁以外的性能问题。
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
