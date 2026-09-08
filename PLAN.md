# Age of Exploration 游戏 Demo 开发计划

> 文档状态：方案确认稿  
> 技术方向：Vue 3 + Mapbox GL JS + Three.js + TresJS  
> 部署目标：Vercel 静态前端  
> 后端状态：当前不建设，保留未来接入边界  
> 更新日期：2026-09-06

## 1. 项目目标

开发一款受《大航海时代》启发的 Web 游戏 Demo，形成以下完整核心循环：

```text
从港口出航
  → 操纵船只航行
  → 探索未知海域和地点
  → 抵达新港口
  → 进入具有地域风格的城市
  → 交易商品、招募船员、补给
  → 再次出航
```

Demo 的目标不是一次性实现完整商业游戏，而是验证下面四件事：

1. Mapbox 地理地图和 Three.js 游戏画面能够可靠结合。
2. 航海、贸易、探索、招募能够形成有趣的短周期循环。
3. 城市能够根据地域风格和布局坐标稳定生成。
4. 游戏能够作为纯前端应用部署到 Vercel，并保存本地进度。

## 2. 已确认的技术决策

采用 Vue 3 混合架构：

```text
Vue 3 + Vite + TypeScript
├── UI：Vue 3 + Pinia
├── 世界地图：Mapbox GL JS
├── 航海 3D：原生 Three.js Custom Layer
├── 城市场景：TresJS
├── 游戏模拟：纯 TypeScript
├── 本地存档：Dexie / IndexedDB
└── 资产格式：GLB + Meshopt/Draco + KTX2
```

### 2.1 为什么采用混合架构

- Vue 3 负责市场、货舱、船员、日志、设置等传统 UI。
- Mapbox GL JS 负责底图、经纬度、地图投影和相机。
- 世界地图上的船、港口、海浪和天气由原生 Three.js Custom Layer 绘制。
- 城市内部使用 TresJS，以 Vue 组件方式组织建筑、NPC、灯光和交互。
- 航海模拟和经济规则放在纯 TypeScript 中，不绑定 Vue 或渲染框架。
- Mapbox 和 Three.js 实例不进入 Pinia 的深度响应式状态。

### 2.2 第一版明确不引入

- Nuxt 和服务端渲染
- 后端 API、账号系统和云存档
- 多人联机与服务器权威经济
- ECS 框架
- 全局事件总线
- 完整刚体船舶物理
- 重型 UI 组件库
- 实时全局光照和高成本屏幕空间特效

这些功能只有在垂直切片验证成功后才重新评估。

## 3. 技术栈

| 模块 | 选择 | 用途 |
|---|---|---|
| 构建 | Vite + TypeScript | SPA 构建、代码分包、开发服务器 |
| UI | Vue 3 Composition API | 游戏界面和场景外壳 |
| 状态 | Pinia | 低频业务状态和 UI 状态 |
| 世界地图 | Mapbox GL JS v3 | 地图、投影、地理坐标、港口图层 |
| 世界 3D | Three.js | 船只、港口模型、海面和天气特效 |
| 城市 3D | `@tresjs/core` | 城市场景组件化 |
| 城市辅助 | `@tresjs/cientos` | 按需使用模型加载、控制器等能力 |
| 后处理 | `@tresjs/post-processing` | 按需使用轻量 Bloom、调色等 |
| 物理 | 暂缓；必要时使用 Rapier | 城市动态碰撞，首版不作为基础依赖 |
| 数据校验 | Zod | 港口、布局、商品、存档结构校验 |
| 本地存档 | Dexie | IndexedDB 封装和存档版本迁移 |
| 音频 | Howler.js | 环境音、音效和音乐 |
| 单元测试 | Vitest | 经济、航海和生成规则测试 |
| 端到端测试 | Playwright | 完整航行与交易流程验证 |

## 4. 总体架构

```text
App.vue
├── GameShell
│   ├── HUD
│   ├── DialogLayer
│   ├── TradingPanel
│   ├── CrewPanel
│   └── LoadingScreen
│
├── WorldMapScene
│   ├── Mapbox Map
│   ├── ShipCustomLayer
│   ├── PortLayer
│   ├── WeatherLayer
│   └── ExplorationLayer
│
├── CityScene
│   ├── TresCanvas
│   ├── CityGenerator
│   ├── BuildingInstances
│   ├── NPCs
│   └── InteractionZones
│
├── Game Core
│   ├── SailingSystem
│   ├── TradingSystem
│   ├── EconomySystem
│   ├── CrewSystem
│   ├── ExplorationSystem
│   └── GameClock
│
└── Persistence
    ├── SaveRepository
    └── IndexedDbSaveRepository
```

### 4.1 状态分层规则

Pinia 保存需要 UI 响应或持久化的数据：

- 金币和声望
- 货物和货舱容量
- 船员和工资
- 当前港口与已发现港口
- 探索记录
- 游戏日期
- 设置和 UI 状态

普通 TypeScript 对象保存每帧模拟数据：

- 船只经纬度
- 船速、航向和角速度
- 风向、风速和洋流
- 当前输入
- 碰撞状态
- 粒子和动画进度

Three.js、Mapbox 实例使用普通引用、`shallowRef` 或 `markRaw`，不得使用深度 `reactive`。

## 5. 世界航海场景

### 5.1 坐标体系

- 游戏规则中的船只位置以经纬度为权威数据。
- 速度统一以节或海里/游戏小时表达。
- 每个模拟步根据速度、航向和时间更新经纬度。
- 渲染时再把经纬度转换为 Mapbox Mercator 坐标。
- 不使用 Three.js 世界坐标累计长距离航行。

### 5.2 航海模型

第一版采用可控的运动模型，而不使用刚体流体模拟：

- 玩家控制船舵和帆力。
- 风向与船头夹角决定航行效率。
- 载重、船况和船员状态影响最大航速。
- 使用固定时间步模拟，推荐 30Hz；画面插值到 60fps。
- 使用简化海岸线 GeoJSON 进行触礁和登陆判断。
- 港口周围设置靠岸触发半径。
- 后续可增加洋流、风暴、浅滩和自动航线。

### 5.3 地图视觉

- Mapbox Style 使用低饱和、羊皮纸或复古海图风格。
- 隐藏现代道路、现代 POI 和不符合时代的标签。
- 自定义港口、航线、危险区和探索图层。
- 船只、港口地标、风向粒子和天气效果由 Three.js 绘制。
- 保留符合 Mapbox 使用条款的 Logo 和 Attribution。

### 5.4 海面表现

首版使用轻量海面 Shader：

- 双层滚动法线
- 基于太阳方向的高光
- 深浅水颜色渐变
- 船尾泡沫和尾迹
- 风暴时改变波浪幅度、雾色和天空颜色

不在第一版实现昂贵的实时反射和真实流体。

## 6. 城市系统

### 6.1 场景切换

- 靠岸后进入独立的城市场景。
- 城市场景采用本地米制坐标，不使用 Mapbox 经纬度。
- 进入城市时暂停世界地图渲染。
- 离开城市时释放非缓存的城市 Geometry、Material 和 Texture。
- Mapbox Map 整个游戏会话尽量只初始化一次，避免重复 Map Loads。

### 6.2 地域风格包

建议最终准备 6 套风格，垂直切片先完成 1～2 套：

1. 伊比利亚/地中海
2. 北欧/汉萨城市
3. 北非/奥斯曼
4. 东非/斯瓦希里海岸
5. 印度洋/南亚
6. 东亚港口

可选第 7 套：美洲/加勒比殖民港口。

每套建议包含：

- 6～10 个模块化主体建筑
- 市场、酒馆、船员公会、港务局、地标各 1 个
- 门窗、招牌、遮阳棚、摊位、木箱、桶等装饰
- 2～3 套材质变化
- 简化碰撞体
- 中远景 LOD

第一版不要求一次性完成全部风格。

### 6.3 城市布局数据

```text
CityLayout
├── roads：道路折线
├── districts：功能区域
├── lots：地块位置、尺寸和用途
├── anchors：特殊建筑锚点
├── npcSpawns：NPC 出生点
├── interactions：交互区域
└── decorationZones：装饰物分布区
```

城市生成流程：

```text
读取港口定义
  → 获取 styleKitId 和 layoutId
  → 读取道路、地块和锚点
  → 根据地块用途筛选建筑
  → 使用固定 seed 选择变体
  → 批量实例化重复模型
  → 生成 NPC 和交互点
```

同一港口、同一存档下的城市结果必须保持稳定。

## 7. 核心游戏系统

### 7.1 交易系统

建议价格公式：

```text
成交价 =
基础价格
× 地区供需系数
× 库存压力系数
× 港口事件系数
× 玩家声望系数
```

第一版商品控制在 8～12 种：

- 粮食
- 木材
- 酒
- 纺织品
- 铁器
- 药材
- 香料
- 瓷器
- 茶叶
- 宝石或贵金属

经济变化由游戏日期和固定随机种子驱动，保证读档可重现。

### 7.2 探索系统

- 未发现港口不显示名称和详细信息。
- 船只周围逐步解除海图迷雾。
- 发现港口、岛屿、沉船、浅滩和特殊海域。
- 首次发现提供声望、金币或经验。
- 探索记录保存到 IndexedDB。
- 第一版使用规则网格或区域 ID，不建设复杂 GIS 分块服务。

### 7.3 船员系统

首版岗位：

- 航海士：航速和自动航线
- 瞭望员：探索半径
- 商人：买卖价格
- 水手长：转向和维修
- 医生：伤病恢复

船员属性：

- 姓名和地域
- 岗位
- 等级与能力
- 工资
- 士气
- 1～2 个特质

候选人根据港口、繁荣度和游戏日期稳定生成。

### 7.4 本地存档

- 使用 IndexedDB，不以 localStorage 作为主存档。
- 自动存档：靠岸、离港、重要交易后和定时间隔。
- 存档包含 schemaVersion。
- 支持未来版本迁移。
- 后续可增加导出/导入 JSON，方便测试和备份。

纯前端版本不提供防作弊、跨设备同步和服务器权威经济。

## 8. 内容数据建议

### 8.1 港口定义

```ts
interface PortDefinition {
  id: string
  name: string
  coordinates: [longitude: number, latitude: number]
  styleKitId: string
  layoutId: string
  seed: number
  economyProfileId: string
  discoveryRequirement?: string
  dockingRadiusMeters: number
}
```

### 8.2 城市地块

```ts
interface CityLot {
  id: string
  type: 'residential' | 'market' | 'tavern' | 'guild' | 'port' | 'landmark'
  position: [number, number, number]
  rotation: [number, number, number]
  size: [number, number]
  allowedAssetTags: string[]
}
```

### 8.3 美术资产元数据

```ts
interface ModelAssetDefinition {
  id: string
  url: string
  styleKitId: string
  tags: string[]
  footprint: [number, number]
  lodUrls?: string[]
  collider?: 'box' | 'capsule' | 'mesh' | 'none'
  allowInstancing: boolean
}
```

最终代码以实际实现时的 Zod Schema 为准。

## 9. 性能和资产预算

桌面浏览器优先，目标如下：

- 中端设备 50～60fps。
- 固定模拟 30Hz，渲染最高 60fps。
- Device Pixel Ratio 上限默认 1.5。
- 城市场景 Draw Call 控制在 200～300。
- 城市同屏三角形控制在约 100～150 万。
- 首次可玩下载目标不超过约 15MB。
- 单套城市风格包目标约 8～12MB。
- 所有城市包按需加载。
- 重复建筑和装饰使用 InstancedMesh。
- 静态模型优先烘焙 AO，减少实时灯光数量。
- 纹理优先 KTX2，模型使用 Meshopt 或 Draco。
- 美术源文件不直接进入前端发布目录。

大型资产超过 Vercel 项目合理范围后，迁移到独立对象存储和 CDN。

## 10. 目录规划

计划初始化为：

```text
src/
├── app/
├── components/
│   ├── game-ui/
│   └── common/
├── scenes/
│   ├── world/
│   └── city/
├── engine/
│   ├── mapbox/
│   ├── three/
│   ├── assets/
│   └── loop/
├── game/
│   ├── sailing/
│   ├── economy/
│   ├── crew/
│   ├── exploration/
│   └── clock/
├── stores/
├── data/
├── persistence/
├── types/
└── styles/

public/
├── assets/
│   ├── ships/
│   ├── cities/
│   ├── props/
│   ├── audio/
│   └── textures/
└── data/
    ├── ports/
    ├── cities/
    └── coastlines/
```

具体目录在创建项目时可根据实际模块略作调整。

## 11. 开发阶段

### Phase 0：工程基础，预计 2～3 天

工作内容：

- 初始化 Vue 3、Vite 和 TypeScript。
- 接入 Pinia、Mapbox GL JS、Three.js 和 TresJS。
- 建立代码质量、单测和环境变量配置。
- 建立场景切换和资源加载骨架。
- 部署第一个 Vercel Preview。

完成标准：

- 本地开发、构建和 Preview 部署均正常。
- Mapbox Token 不进入 Git。
- 空白世界场景和空白城市场景可以切换。

### Phase 1：技术验证，预计 3～5 天

工作内容：

- 加载复古 Mapbox 样式。
- 在 Custom Layer 中显示船只占位模型。
- 实现经纬度和 Three.js 坐标转换。
- 实现地图镜头跟随。
- 验证长距离移动、缩放、俯仰和旋转。

完成标准：

- 船只可以沿真实经纬度稳定移动。
- 缩放和旋转过程中模型不漂移。
- 刷新后可以恢复船只位置。

### Phase 2：垂直切片，预计 2 周

建议地图范围：伊比利亚—北非—加那利群岛。

工作内容：

- 5～8 个港口。
- 一艘可操控船只。
- 风向和基础航速模型。
- 海岸碰撞和靠岸。
- 一套城市风格。
- 港口市场和货舱。
- 基础本地存档。

完成标准：

- 可以从一个港口航行到另一个港口。
- 可以利用至少一组商品价差获利。
- 可以进入城市、交易并再次离港。

### Phase 3：核心系统，预计 2～3 周

- 船员招募和工资。
- 探索迷雾与 POI。
- 港口库存和每日经济变化。
- 船况、补给、疲劳。
- 风暴、浅滩和危险区。
- 完整 HUD、教程和错误反馈。

### Phase 4：城市内容，预计 3～5 周

- 城市布局编辑和验证流程。
- 程序化城市生成器。
- 扩展到 3 套地域风格。
- NPC、交互点和环境表现。
- LOD、实例化和资源释放优化。

完成 Demo 后再决定是否扩展到 6～7 套城市风格。

### Phase 5：发布优化，预计 1～2 周

- 浏览器兼容和性能测试。
- 资源压缩与懒加载。
- 存档迁移测试。
- 音量、画质和控制设置。
- Vercel Production 部署。
- Mapbox Production Token URL 限制。

## 12. Demo 验收标准

- [ ] 玩家可以手动控制船只连续航行。
- [ ] 风向、载重和船况能够影响航速。
- [ ] 船只不能直接穿过陆地。
- [ ] 至少有 5 个可到达港口。
- [ ] 可以进入独立城市场景。
- [ ] 城市可以根据布局和风格数据稳定生成。
- [ ] 至少两个港口存在可利用的商品价差。
- [ ] 可以招募至少三种岗位的船员。
- [ ] 可以发现隐藏港口或海上 POI。
- [ ] 刷新浏览器后可以恢复进度。
- [ ] Vercel Production 可以完整运行游戏循环。

## 13. 需要用户提前准备的清单

下面按阻塞程度排序。`P0` 会阻塞技术验证，`P1` 会影响垂直切片，`P2` 可以在开发过程中逐步补充。

### P0：开始开发前必须准备

- [ ] 创建 Mapbox 开发者账号。
- [ ] 在 Mapbox Studio 创建并发布一份初始地图样式。
- [ ] 提供 Mapbox Style URL，格式为 `mapbox://styles/{username}/{styleId}`。
- [ ] 创建 Local Public Token，只保留读取地图需要的权限。
- [ ] Local Token 允许 `localhost:5173`。
- [ ] 不提供、粘贴或提交任何以 `sk` 开头的 Mapbox Secret Token。
- [ ] 确认游戏的大致历史时期。
- [ ] 确认垂直切片的首发地图区域。
- [ ] 确认首发港口列表，建议 5～8 个。
- [ ] 提供 3～10 张目标视觉风格参考图或链接。
- [ ] 确认 Demo 是个人非商业展示，还是未来有商业用途。

推荐的地图范围默认值：

```text
时期：15～16 世纪架空历史
区域：伊比利亚半岛—摩洛哥—加那利群岛
港口：里斯本、塞维利亚、加的斯、丹吉尔、卡萨布兰卡、丰沙尔、拉斯帕尔马斯
```

如果不指定，将以此作为第一版开发假设。

### P1：垂直切片开发前准备

- [ ] 确认游戏名称；工作名可以继续使用 `Age of Exploration`。
- [ ] 确认画面风格：写实、风格化写实或卡通低多边形。
- [ ] 确认相机方式：船后跟随、斜俯视或自由旋转。
- [ ] 确认城市玩法：自由行走、点击移动或固定镜头热点交互。
- [ ] 确认操作方式：键盘鼠标优先，还是同时支持触屏。
- [ ] 确认第一艘船的类型和外观参考。
- [ ] 准备一艘拥有合法使用权的 GLB 船只模型，或确认允许先用占位模型。
- [ ] 确认首套城市地域风格。
- [ ] 准备首套城市的建筑、色彩、街道和服饰参考图。
- [ ] 确认首版商品清单和名称。
- [ ] 确认货币名称。
- [ ] 确认船员岗位和角色命名风格。
- [ ] 确认内容语言：仅中文，还是预留中英文国际化。

### P1：账号与部署准备

- [ ] 准备 GitHub 账号和用于部署的仓库权限。
- [ ] 创建或确认 Vercel 账号。
- [ ] 将 Vercel 连接到对应 GitHub 仓库。
- [ ] 确认是否使用自定义域名。
- [ ] 如果有自定义域名，提供最终域名用于限制 Production Token。
- [ ] 创建独立的 Mapbox Preview Public Token。
- [ ] 创建独立的 Mapbox Production Public Token。
- [ ] 在 Vercel Preview 和 Production 中分别配置环境变量。
- [ ] 确认 Mapbox Attribution 在游戏界面中的保留位置。

建议环境变量名称：

```text
VITE_MAPBOX_TOKEN
VITE_MAPBOX_STYLE_URL
```

Public Token 虽然可以在浏览器中公开，仍不得提交进 Git。应写入本地 `.env.local` 和 Vercel Environment Variables。

### P2：美术与内容扩展准备

- [ ] 为每套城市收集一份 Moodboard。
- [ ] 确认计划制作的 5～8 套地域风格名单。
- [ ] 明确模型来源和许可证。
- [ ] 保存第三方模型、纹理、字体和音乐的授权记录。
- [ ] 建立统一模型单位：1 Blender Unit = 1 米。
- [ ] 统一建筑朝向、原点、命名和导出规范。
- [ ] 为建筑准备简化碰撞体或占地尺寸。
- [ ] 准备港口坐标、区域归属和经济类型资料。
- [ ] 准备商品图标、船员头像和港口插图的视觉方向。
- [ ] 准备海浪、港口、市场和环境音效参考。

### P2：规则和体验选择

- [ ] 游戏时间与现实时间的倍率。
- [ ] 航行失败条件：沉没、断粮、破产或返回最近港口。
- [ ] 是否包含海盗和海战；建议首版不包含。
- [ ] 是否允许自动航行。
- [ ] 是否需要任务系统；建议首版只做引导任务。
- [ ] 商品价格波动幅度。
- [ ] 船员是否可能受伤、离队或死亡。
- [ ] 是否使用真实历史人物和真实政治边界。
- [ ] 是否需要无障碍选项和色盲模式。

## 14. 用户资料回传模板

用户完成前置准备后，可以按以下格式提供信息：

```text
游戏名称：
历史时期：
是否架空：
首发地图区域：
首发港口：
首套城市风格：
视觉风格：
相机方式：
城市交互方式：
目标设备：
内容语言：
首版是否包含海战：

Mapbox Style URL：
Mapbox Local Token：已配置 / 未配置
Mapbox Preview Token：已配置 / 未配置
Mapbox Production Token：已配置 / 未配置
Vercel：已连接 / 未连接
正式域名：

船只模型：有 / 使用占位模型
模型授权：
视觉参考资料位置：
其他要求：
```

Token 推荐由用户直接配置到 `.env.local` 或 Vercel，不需要写进回传内容。

## 15. 风险与控制措施

| 风险 | 控制措施 |
|---|---|
| Mapbox 和 Three.js 坐标漂移 | Phase 1 优先验证，经纬度为权威状态 |
| Vue 高频响应式开销 | 高频状态使用普通对象，Three 实例使用 `shallowRef` |
| 3D 资产过大 | GLB/KTX2 压缩、懒加载、LOD、风格包拆分 |
| 城市模型重复感 | 模块化建筑、材质变化、装饰规则和固定 seed |
| 城市美术工作量失控 | 垂直切片只制作 1 套，验证后逐套扩展 |
| Mapbox 费用不可控 | 单会话单 Map 实例、分环境 Token、生产域名限制、定期检查用量 |
| TresJS 插件成熟度不足 | 核心能力保持原生 Three.js 可替换，插件按需使用 |
| 纯前端存档可修改 | Demo 接受该限制，未来由后端实现权威数据 |
| Vercel 不适合大量资产 | 大型模型和音频后续迁移到对象存储/CDN |

## 16. 参考资料

- [TresJS 官方文档](https://docs.tresjs.org/getting-started)
- [TresJS 性能建议](https://docs.tresjs.org/api/advanced/performance)
- [Mapbox GL JS 官方文档](https://docs.mapbox.com/mapbox-gl-js/)
- [Mapbox 与 Three.js 3D 模型示例](https://docs.mapbox.com/mapbox-gl-js/example/add-3d-model/)
- [Mapbox Token 管理](https://docs.mapbox.com/accounts/guides/tokens/)
- [Mapbox Attribution](https://docs.mapbox.com/help/dive-deeper/attribution/)
- [Vercel Vite 部署](https://vercel.com/docs/frameworks/frontend/vite)
- [Vite 环境变量](https://vite.dev/guide/env-and-mode)

## 17. 下一步

1. 用户优先完成 P0 清单。
2. 开发侧初始化 Phase 0 工程。
3. Mapbox Style URL 和 Local Token 就绪后进入 Phase 1。
4. Phase 1 验证成功后冻结首个垂直切片范围和资产规范。
5. 按 Phase 2 实现第一个完整可玩循环。

## 18. 开发进展（2026-09-07）

已开始 Phase 0，当前交付范围为本地工程预览，不代表完整 Demo 或 Phase 1 验收完成。

- [x] 初始化 Vue 3、Vite、TypeScript、Pinia，并生成依赖锁定文件。
- [x] 接入 Mapbox / Three.js Custom Layer 代码与 TresJS 按需加载的城市占位场景。
- [x] 提供未配置 Mapbox 时的本地示意海图和配置错误降级提示。
- [x] 实现 30Hz 经纬度航行模拟、键盘转舵、帆力控制、暂停和离港/靠岸骨架。
- [x] 接入 Zod 校验和 Dexie / IndexedDB 版本化存档。
- [x] 建立 ESLint、Prettier、Vitest、类型检查和 CI 配置。
- [x] 提供 `.env.example`、Vercel 构建配置和 README 运行说明。
- [x] 建立可追溯的美术资产目录、许可清单、Meshopt 构建、glTF/体积校验和运行时缓存降级。
- [x] 接入首批 CC0 船只、码头及港口道具，并保留未来替换写实素材的稳定资产 ID。
- [x] 建立 `DialogueService` 前端端口，为未来后端 NPC 模型服务保留边界。
- [ ] 使用实际 Mapbox Public Token / Style URL 验证在线地图、模型坐标和相机。
- [ ] 浏览器画面及交互验收（当前执行环境未连接浏览器）；后续加入 Playwright E2E。
- [ ] 连接远程仓库及 Vercel，完成首个 Preview 部署。

当前内容假设：计划中的默认七港口、中文界面、斜俯视海图、固定镜头城市热点方向、低多边形 CC0 基线素材。塞维利亚暂以河口外港接近点表示，河道导航待 Phase 2。暂未实现陆地碰撞、贸易、招募和迷雾；验收标准保持未勾选。

### 航海体验修订

- 默认入口改为无需 Mapbox Token 的近景 Three.js 航行视图，海图保留为独立切换视图。
- 程序化帆船补充立体船体、甲板、索具与鼓起船帆，加入动态海面、尾迹、阴影及镜头平滑跟随。
- 界面改为大幅航行画面、底部操船台与目的港侧栏；出航默认满帆，支持画面内按住转舵和 W / S 控帆。
- 修复出航按钮保留焦点时 A / D 被忽略的问题。
- 默认航程推进从每秒 15 游戏分钟调整到每秒 1 游戏小时，另提供 4× 快进；航速节数仍由模拟规则计算。
- 近景采用视觉距离压缩；浏览器实机画面和性能仍待验收。
