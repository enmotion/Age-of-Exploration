# 航海纪元 · Age of Exploration

Vue 3 航海游戏的本地体验版。以 [PLAN.md](./PLAN.md) 为开发路线，默认直接显示近景 3D 帆船、动态海面和操船台，尚非完整游戏 Demo。

## 本地运行

需要 Node.js 22.12+（开发环境使用 Node 24）。

```bash
npm ci
npm run dev
```

打开 http://127.0.0.1:5173 ，点击画面下方「扬帆出航」。**3D 航行无需 Mapbox Token**，使用程序化模型与海面，不下载外部美术资源。帆船和城市场景需要 WebGL；无法创建 3D 画面时可切换海图。

顶部「海图」可查看航程位置。没有 Mapbox 配置时使用本地 SVG 示意海图，有配置时在首次切换海图后加载 Mapbox。

## 真实地图

复制 `.env.example` 为 `.env.local`，在本机填入：

```dotenv
VITE_MAPBOX_TOKEN=你的以pk.开头的PublicToken
VITE_MAPBOX_STYLE_URL=mapbox://styles/你的用户名/你的样式ID
```

修改环境变量后重启开发服务器。Token 的 URL 限制需包含实际使用的开发地址（`http://127.0.0.1:5173` 或 `http://localhost:5173`）。所有 `.env` 私有配置文件均由 Git 忽略；不要使用 Secret Token。Vite 的 `VITE_` 变量会进入浏览器产物，Public Token 应设置 URL 和权限限制。

使用 Mercator 投影以支持 Three.js Custom Layer。请在 Mapbox Studio 配置复古底图、隐藏现代标签，应用保留 Mapbox 默认 Logo / Attribution。当前船只为放大 180 倍的程序化占位模型，供区域地图辨认；真实米制模型、长距离精度及相机组合验证属于 Phase 1。

## 操作

- 进入港口：查看按港口 seed 生成的 TresJS 占位城市。
- 扬帆出航：自动满帆，使用 A / D 或左右方向键转舵，也可按住画面内的转舵按钮。
- 视角：在 3D 画面按住鼠标拖动可绕船观察，滚轮缩放，双击画面恢复默认船后视角；触屏可单指拖动。
- 帆力：W / S 升帆和收帆，或拖动滑块；空格或暂停按钮暂停航行。
- 航线：右侧选择目的港，根据建议航向手动转舵；此提示是直线方位，不是自动避障航线。
- 节奏：默认每秒推进 1 游戏小时（初版的 4 倍），可切换 4× 快进至每秒 4 游戏小时。节数仍由风向和帆力等规则计算。
- 靠岸：进入港口约 6.5 海里范围后点击靠岸按钮。
- 存档：IndexedDB 每 15 秒、场景切换、离港、靠岸及页面隐藏时保存，可手动保存；刷新恢复船位、日期及停泊状态。

模拟以 30Hz 固定步运行。每帧状态保存在普通对象，UI 以 10Hz 快照更新，近景 3D 在渲染时平滑跟随。隐藏页面暂停模拟，恢复时不补算后台时间。场景保持单个 Mapbox 实例；近景海面在切换海图或进城后停止绘制，城市按需加载，退出城市卸载 TresCanvas。

近景帆船具有船体、甲板、船帆、索具、方向光阴影和浮动动画。海面使用多方向 Gerstner 波、程序化微表面法线、菲涅耳反射、太阳高光、浪峰泡沫、船首白沫与运动尾迹；天空包含大气渐变、太阳光晕和低成本云层。近景航行采用视觉距离压缩，经纬度和航程仍以游戏模拟为准。快进选择、目的港和观察视角暂不写入存档，刷新后恢复默认值；船位、帆力和日期正常恢复。

## 检查

```bash
npm run check       # ESLint + Vitest + 类型检查 + 生产构建
npm run test:watch
npm run preview     # 先运行 npm run build
```

单元测试覆盖航向、地理距离、风/载重/船况、帧率独立性、存档校验/往返恢复与确定性布局。存档版本为 1；未知版本或损坏存档不会被自动覆盖，当前会话将显示错误并禁用写入。

## 当前范围与限制

- 已接入：Vue / Pinia / Mapbox GL JS / Three.js / TresJS / Zod / Dexie。
- 已提供：无需 Token 的近景 3D 航行、波浪与尾迹、7 个港口接近点、离港/靠岸骨架、基本航速模型、航程快进、场景切换、操作指南、错误提示。
- 尚未实现：陆地碰撞、探索迷雾、贸易、招募、经济、补给、资产流水线与音频。海面为风格化效果，不是真实流体模拟。
- 海图是手工绘制的示意图，港口为接近点；塞维利亚采用河口外港以等待河道导航。港口均可见，不代表探索功能完成。
- 城市为独立的静态低多边形占位场景，建筑尚未实例化，不代表最终画面或性能达标。
- 本地存档不跨设备同步；航海日志当前仅保留本次会话。关闭浏览器瞬间的未完成写入不保证落盘，可先点击保存。
- 未提供 Mapbox 配置，因此真实在线地图与 Custom Layer 仍需实际 Token 联调；没有完成 Vercel Preview / Production 部署。
- 当前执行环境未连接浏览器，因此 3D 实际画面、Shader 的设备兼容性及完整交互仍待浏览器验收；通过构建和单测不代表画面验收完成。

## Vercel

仓库提供 `vercel.json`：构建命令 `npm run build`，产物目录 `dist`。连接 Git 仓库后，在 Vercel Preview / Production 分别设置两项 Mapbox 环境变量，再发起部署。当前没有创建远程仓库或部署资源。

## 目录

`src/app` 为界面外壳；`src/scenes` 为世界和城市；`src/engine` 为固定步、Mapbox 与 Three 桥接；`src/game` 为纯 TypeScript 模拟；`src/stores` 为业务状态；`src/persistence` 为版本化存档边界；`src/data` 为 Zod 校验的内容数据。

接入依据：[Mapbox Custom Layer 示例](https://docs.mapbox.com/mapbox-gl-js/example/add-3d-model/)、[TresJS](https://docs.tresjs.org/getting-started)、[Vite](https://vite.dev/guide/)。
