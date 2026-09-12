# 大航海 · Age of Exploration

基于 Babylon.js 的单机航海游戏。当前入口为全屏海洋效果场景，仅保留水面调节控件。Web 为首要平台，未来预留桌面容器和后端 NPC 决策接入。

## 开发

使用 Node.js 24 LTS（`.nvmrc`）与 npm：

```sh
npm ci
npm run dev
```

打开 http://127.0.0.1:5173 。拖动鼠标观察，使用 WASD（或勾选 ZQSD）与 E/空格移动。右侧面板提供 80 个已接入的实时参数，控制三层风浪、折面水色、浪脊白沫、碎金反光、V 型尾迹、昼夜光照、雾与镜头，并在「海面网格」中实时调节海面细分与面片数量；没有接入渲染器的旧参数不再展示。

当前水面参数为会话内状态，刷新恢复默认值。港口数据、IndexedDB 仓储和平台接口仍保留供后续编辑器使用；全屏场景不展示港口或存档界面。

```sh
npm run check          # 格式、lint、单元测试、类型检查及生产构建
npx playwright install chromium
npm run test:browser   # 先运行 build；验证全屏画布、水面控件、预设和窄屏布局
npm run preview        # 本地预览 dist，不用于公网生产服务
```

## 技术与目录

- Vue 3 + TypeScript + Vite：界面和构建。
- Babylon.js：独立场景生命周期，按模块导入并延迟加载引擎。
- Dexie + IndexedDB：本地数据，数据库版本从 1 开始。
- Zod：持久化文档校验，港口文档 `schemaVersion` 从 1 开始。
- Vitest、Playwright、ESLint、Prettier：验证与规范。

```text
src/app/              Vue 界面与样式
src/domain/           不依赖引擎的港口数据与 NPC 决策接口
src/engine/babylon/   场景、相机、程序化资产、资源释放
src/assets/           资产清单与引用检查
src/editor/           港口文档验证入口（编辑器尚未实现）
src/storage/          仓储接口与 IndexedDB 实现
src/platform/         浏览器平台服务与文件导出
assets/source/        原始资产工作区
public/assets/        运行时资产目录
```

数据库结构变化应追加 Dexie 版本及必要的 upgrade 迁移；港口文档格式变化另行编写版本迁移，禁止静默覆盖无法识别的数据。当前只保存港口文档，游戏进度、用户资产 Blob 和设置将在对应功能开发时增加表。

## 平台边界

玩法数据不持有 Babylon.js 对象，NPC 接口当前只有本地 idle 实现。浏览器存储和下载位于平台层。Vite 使用相对资源路径，未来可选择 Electron 或 Tauri；目前没有桌面打包依赖、后端或模型调用。桌面 IndexedDB 的源与数据目录、文件桥接、签名及安装包仍需在接入时实现和验证。

海洋实现完全位于本仓库：GLSL 组合三组主波及六组交叉次波，生成实时 Gerstner 风浪位移、折面法线、Fresnel 反射、碎金高光、浪峰透光与沿浪脊破碎的白沫。船体使用同一波场计算升沉与摇摆，独立尾迹着色层与断续几何泡沫带形成可调 V 型航迹。程序化天空支持清晨、正午、黄昏和夜晚，场景包含低多边形云、远岛与帆船。控制契约测试确保所有可见参数都连接到活动渲染器。

完整资产库、港口编辑器和航行玩法仍在后续阶段。

需求和阶段安排见 [plan.md](plan.md)，资产约定见 [assets/README.md](assets/README.md)。

初始化参考：[Vite 官方指南](https://vite.dev/guide/)、[Babylon.js 官方仓库](https://github.com/BabylonJS/Babylon.js)。
