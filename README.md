# 航海纪元 · Age of Exploration

Vue 3 航海游戏的本地体验版。以 [PLAN.md](./PLAN.md) 为开发路线，默认直接显示近景 3D 帆船、动态海面和操船台，尚非完整游戏 Demo。

## 本地运行

需要 Node.js 22.12+（开发环境使用 Node 24）。

```bash
npm ci
npm run dev
```

打开终端显示的本地地址（默认 http://127.0.0.1:5173 ），点击画面下方「扬帆出航」。若 5173 已占用，Vite 会自动选择下一可用端口。**3D 航行无需 Mapbox Token**。主船使用已随项目发布的 CC0 GLB 素材；加载失败时自动使用程序化备用船体。帆船和城市场景需要 WebGL；无法创建 3D 画面时可切换海图。

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
- 光景预览：「晴日／黄昏／月夜」可直接切换并锁定光照，波浪仍继续运动。海面新增随浪峰生成、破碎并短暂残留的白沫，黄昏云层增加暗部、暖色受光边缘与远处雾化层次。
- 昼夜：画面右侧「海岛光景」提供 1×／4×／12×，分别为 120／30／10 秒一昼夜。「定格」锁住光照时刻，波浪继续运动；游戏暂停或页面隐藏时，天空、植被与波浪一起停止。此为独立的视觉时钟，停泊也能观看，不改变航程和存档日期，刷新从 15:00 开始。
- 帆力：W / S 升帆和收帆，或拖动滑块；空格或暂停按钮暂停航行。
- 航线：右侧选择目的港，根据建议航向手动转舵；此提示是直线方位，不是自动避障航线。
- 节奏：默认每秒推进 1 游戏小时（初版的 4 倍），可切换 4× 快进至每秒 4 游戏小时。节数仍由风向和帆力等规则计算。
- 靠岸：进入港口约 6.5 海里范围后点击靠岸按钮。
- 存档：IndexedDB 每 15 秒、场景切换、离港、靠岸及页面隐藏时保存，可手动保存；刷新恢复船位、日期及停泊状态。

模拟以 30Hz 固定步运行。每帧状态保存在普通对象，UI 以 10Hz 快照更新，近景 3D 在渲染时平滑跟随。隐藏页面暂停模拟，恢复时不补算后台时间。场景保持单个 Mapbox 实例；近景海面在切换海图或进城后停止绘制，城市按需加载，退出城市卸载 TresCanvas。

近景包含沙滩、礁石、灌木、密林和随风摇动的棕榈叶。海面使用多方向波浪、微表面法线、菲涅耳反射、768×768 的船体/海岛实时倒影、浅水色、岸边碎浪、太阳/月亮高光及尾迹。天空包含动态云层、日出日落、太阳光晕、月亮和星空，船体与植被照明同步变化。岛屿为原创程序化景观，由实例化植被控制绘制开销；目前不对应真实地理岛屿，也未实现登陆和岛体碰撞。近景航行采用视觉距离压缩，经纬度和航程仍以游戏模拟为准。

## 检查

```bash
npm run check       # ESLint + Vitest + 类型检查 + 生产构建
npm run test:watch
npm run preview     # 先运行 npm run build
```

画面检查（使用本机 Chrome 的独立临时会话）：先执行 `npm run dev -- --port 5175`，再执行 `npm run test:visual`。可通过 `VISUAL_TEST_URL` 指向其他开发/生产预览端口。检查白天、日落、夜晚、光照定格、拖动视角、手机尺寸及浏览器/Shader 错误；截图输出到 `test-results/environment/`。

## 美术资产

夜景已加入两盏暖色船灯、八支岸边火把、跳动火焰与光晕，以及带暗尘层次的银河星带。灯火随昼夜渐变，甲板、沙滩和海面会出现暖光；使用四个无阴影局部光源控制开销。可在「海岛光景」选择 12×，入夜后点击「定格」观察。

项目已经建立可重复的 Web 资产生产流：第三方原件与许可保存在 `assets/vendor`，`assets/catalog.json` 登记来源、预算和运行时 URL，生成的 GLB 位于 `public/assets`。当前包含 Kenney Pirate Kit 2.1 的船、码头、桶、木箱和火炮，均为 CC0；模型经过 Meshopt 压缩并把外部色板纹理嵌入 GLB。

```bash
npm run assets:build      # 从源文件重新生成运行时 GLB
npm run assets:validate   # 校验 glTF、许可元数据和体积预算
```

完整的模型、贴图、KTX2、Shader、动画命名和授权规范见 [美术资产生产流](./docs/ASSET_PIPELINE.md)。

单元测试覆盖航向、地理距离、风/载重/船况、帧率独立性、存档校验/往返恢复与确定性布局。存档版本为 1；未知版本或损坏存档不会被自动覆盖，当前会话将显示错误并禁用写入。

## 当前范围与限制

- 已接入：Vue / Pinia / Mapbox GL JS / Three.js / TresJS / Zod / Dexie。
- 已提供：无需 Token 的近景 3D 航行、波浪与尾迹、7 个港口接近点、离港/靠岸骨架、基本航速模型、航程快进、场景切换、操作指南、错误提示。
- 尚未实现：陆地碰撞、探索迷雾、贸易、招募、经济、补给、音频以及完整角色动画库。海面为风格化效果，不是真实流体模拟。
- 海图是手工绘制的示意图，港口为接近点；塞维利亚采用河口外港以等待河道导航。港口均可见，不代表探索功能完成。
- 城市为独立的静态低多边形占位场景，建筑尚未实例化，不代表最终画面或性能达标。
- 本地存档不跨设备同步；航海日志当前仅保留本次会话。关闭浏览器瞬间的未完成写入不保证落盘，可先点击保存。
- 未提供 Mapbox 配置，因此真实在线地图与 Custom Layer 仍需实际 Token 联调；没有完成 Vercel Preview / Production 部署。
- 已使用本机 Chrome 无头浏览器进行日景/日落/夜景截图与基础交互检查；手机尺寸截图不代表真实移动 GPU 性能验收，Safari 和移动设备的帧率仍待实机验证。

## Vercel

仓库提供 `vercel.json`：构建命令 `npm run build`，产物目录 `dist`。连接 Git 仓库后，在 Vercel Preview / Production 分别设置两项 Mapbox 环境变量，再发起部署。当前没有创建远程仓库或部署资源。

## 目录

`src/app` 为界面外壳；`src/scenes` 为世界和城市；`src/engine` 为固定步、Mapbox、Three 与资产加载；`src/game` 为纯 TypeScript 模拟；`src/stores` 为业务状态；`src/persistence` 为版本化存档边界；`src/services` 保留未来后端服务接口；`src/data` 为 Zod 校验的内容数据。

接入依据：[Mapbox Custom Layer 示例](https://docs.mapbox.com/mapbox-gl-js/example/add-3d-model/)、[TresJS](https://docs.tresjs.org/getting-started)、[Vite](https://vite.dev/guide/)。
