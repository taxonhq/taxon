import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include:    ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles:  ['./test/setup.ts'],
    // 测试涉及真实数据库连接，串行执行避免 schema/连接竞争
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
