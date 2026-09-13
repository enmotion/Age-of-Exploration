import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  /**
   * 单测时限。反射那个用例要拍 6 张 1280×720 的 canvas 截图，在 CI 的软件渲染下本来就要 80 秒以上；
   * 加上船模型（2.18 MB GLB + 12 张贴图解码）之后越过了原来的 90 秒线。
   */
  timeout: 150000,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
})
