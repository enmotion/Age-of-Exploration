import * as BABYLON from '@babylonjs/core'
// 副作用导入：注册 glTF/GLB 加载器（SceneLoader 本身在 core 里）
import '@babylonjs/loaders/glTF'
import {
  SEA_RING_SEGMENTS,
  defaultOceanSettings,
  seaRingLayout,
} from '../../../domain/ocean'
import type { OceanSettings } from '../../../domain/ocean'
import {
  oceanFragment,
  oceanVertex,
  skyFragment,
  skyVertex,
  wakeFragment,
  wakeVertex,
} from './shaders'

export interface OceanRuntime {
  update(settings: OceanSettings): void
  resetCamera(): void
  dispose(): void
}

const waveUniforms = ['time', 'chop', 'waveA', 'waveB', 'waveRms']

function linearColor(value: string) {
  return BABYLON.Color3.FromHexString(value).toLinearSpace()
}

function standardMaterial(
  scene: BABYLON.Scene,
  name: string,
  diffuse: string,
  emissiveScale = 0,
) {
  const result = new BABYLON.StandardMaterial(name, scene)
  result.diffuseColor = BABYLON.Color3.FromHexString(diffuse)
  result.ambientColor = result.diffuseColor.scale(0.38)
  result.specularColor = new BABYLON.Color3(0.11, 0.1, 0.08)
  if (emissiveScale > 0)
    result.emissiveColor = result.diffuseColor.scale(emissiveScale)
  return result
}

/**
 * 海面用"同心环 LOD"覆盖：每环每边 SEA_RING_SEGMENTS 格，格子逐环翻倍。
 * 环 i 的半宽 R_i = (SEA_RING_SEGMENTS / 2) × cell_i，于是 R_{i+1} = 2 × R_i，
 * 环边界处顶点天然嵌套（粗环的边界点是细环的子集），只在顶点之间可能留细缝，用裙边挡住。
 *
 * 关键：所有环都以**世界原点为中心且静止**，因此顶点着色器里的局部坐标恒等于世界坐标，
 * 波场、面片 ID、岛屿距离场都不需要额外换算。
 */
/**
 * 重建节流间隔。环组顶点数只有约 4 万（旧的单张均匀网格是 26 万），
 * 重建很便宜，固定小间隔即可，不需要按规模分档。
 */
const SEA_REBUILD_INTERVAL_MS = 110
/**
 * 裙边深度（米）：挡住相邻环之间因细分不同而产生的细缝。
 * 细缝就是"细环边缘中点相对粗环直线边缘"的弓形高——按 3 m 面片、34 m 波长估约 7 cm，
 * 所以只要几十厘米就够。裙边太深反而会自己露出来变成一条暗线（竖直面法线朝侧向，受光不同）。
 */
const SEA_SKIRT_DEPTH = 4

/** 船模型（自包含 GLB：12 张贴图全部内嵌）。 */
const SHIP_MODEL_URL = '/assets/ships/caravel-pbr.glb'
/**
 * 船模型的吃水。模型原点在**龙骨最低点**（包围盒 min Y = 0），
 * 所以要让龙骨沉到水面以下，root 的 y 必须是负偏移——不能像原来那样用正值。
 */
const SHIP_DRAFT = 1.2
/** 让模型长度（13.1）接近原程序化船的观感尺寸（约 15）。 */
const SHIP_MODEL_SCALE = 1.15

/** 环 i 的面片边长。 */
function seaRingCellSize(baseCell: number, ring: number) {
  return baseCell * 2 ** ring
}

/** 环 i 的覆盖半宽。每环每边 SEA_RING_SEGMENTS 格，所以半宽 = 格数/2 × 该环面片边长。 */
function seaRingHalfExtent(baseCell: number, ring: number) {
  return (SEA_RING_SEGMENTS / 2) * seaRingCellSize(baseCell, ring)
}

/** 所有环合起来的最外圈半宽。 */
function seaOuterHalfExtent(baseCell: number, ringCount: number) {
  return seaRingHalfExtent(baseCell, Math.max(0, ringCount - 1))
}

/**
 * 生成第 ring 环：一个挖空的方环（最内环不挖），外边界带一圈向下的裙边。
 * position.y 用来承载裙边的下沉量，顶点着色器会在此基础上叠加波场位移。
 */
function createSeaRing(
  scene: BABYLON.Scene,
  name: string,
  cellSize: number,
  ring: number,
  isOutermost: boolean,
) {
  const segments = SEA_RING_SEGMENTS
  const side = segments + 1
  const half = (segments / 2) * cellSize
  // 内侧挖空半宽：环 i 的内边界就是环 i-1 的外边界
  // 内侧少挖一格：环 i+1 于是向内多覆盖一格，与环 i 的外边界**重叠**。
  // 重叠比裙边干净——没有缝就不需要补，也不会有裙边竖直面被高光打亮成一条亮线。
  const holeHalf = ring === 0 ? 0 : half / 2 - cellSize

  const positions: number[] = []
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      positions.push(col * cellSize - half, 0, row * cellSize - half)
    }
  }

  const indices: number[] = []
  for (let row = 0; row < segments; row += 1) {
    for (let col = 0; col < segments; col += 1) {
      if (holeHalf > 0) {
        const x0 = col * cellSize - half
        const z0 = row * cellSize - half
        const x1 = x0 + cellSize
        const z1 = z0 + cellSize
        const inside =
          x0 >= -holeHalf && x1 <= holeHalf && z0 >= -holeHalf && z1 <= holeHalf
        if (inside) continue
      }
      const a = col + row * side
      const b = col + 1 + row * side
      const c = col + 1 + (row + 1) * side
      const d = col + (row + 1) * side
      // 每个格子的对角线方向按格号随机翻转，破坏规则格纹带来的对称感。
      // 必须用**全局格号**（col - segments/2 就是世界格号）：片元里算棱边/顶点高光时
      // 用的是 hash(floor(vBase/vCellSize))，两边格号一致才能对上。
      // 各环格子尺寸不同，格号本来就落在不同格点上，天然去相关，不需要再加环偏移。
      if (seaCellHash(col - segments / 2, row - segments / 2) > 0.5) {
        indices.push(a, b, d, b, c, d)
      } else {
        indices.push(a, b, c, a, c, d)
      }
    }
  }

  // 最外圈兜底：把边界顶点向下复制一份连成竖直面，挡住平面边缘（雾通常已经盖住）。
  // 环与环之间不用裙边——那用的是"重叠一格"的方案。
  if (isOutermost) {
    const pushSkirt = (vertexIndex: number) => {
      const i = vertexIndex * 3
      positions.push(positions[i]!, -SEA_SKIRT_DEPTH, positions[i + 2]!)
      return positions.length / 3 - 1
    }
    const edges: number[][] = [
      Array.from({ length: side }, (_, i) => i),
      Array.from({ length: side }, (_, i) => segments * side + i),
      Array.from({ length: side }, (_, i) => i * side),
      Array.from({ length: side }, (_, i) => i * side + segments),
    ]
    for (const edge of edges) {
      for (let i = 0; i + 1 < edge.length; i += 1) {
        const a = edge[i]!
        const b = edge[i + 1]!
        const a2 = pushSkirt(a)
        const b2 = pushSkirt(b)
        indices.push(a, a2, b2, a, b2, b)
      }
    }
  }

  const mesh = new BABYLON.Mesh(name, scene)
  const vertexData = new BABYLON.VertexData()
  vertexData.positions = new Float32Array(positions)
  vertexData.indices = new Uint32Array(indices)
  vertexData.applyToMesh(mesh, false)
  // 每环一个格子尺寸，用顶点属性传给着色器，避免为每环复制一份材质。
  // 自定义属性名 Babylon 推断不出 stride，必须显式给 1
  mesh.setVerticesData(
    'ringCellSize',
    new Float32Array(positions.length / 3).fill(cellSize),
    false,
    1,
  )
  return mesh
}

/** 与着色器 oceanHash 同构的 CPU 版本，仅用于决定网格拓扑。 */
function seaCellHash(x: number, y: number) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return value - Math.floor(value)
}

/** 生成整组同心环。返回顺序为由内到外。 */
function createSeaRings(
  scene: BABYLON.Scene,
  baseCell: number,
  ringCount: number,
) {
  const rings: BABYLON.Mesh[] = []
  for (let ring = 0; ring < ringCount; ring += 1) {
    rings.push(
      createSeaRing(
        scene,
        `faceted-sea-${ring}`,
        seaRingCellSize(baseCell, ring),
        ring,
        ring === ringCount - 1,
      ),
    )
  }
  return rings
}

/**
 * Gerstner 波场的折叠判据：总陡度 Σ(k·a) 必须 < 1，否则波面自交（卷曲穿插）。
 *
 * 三档浪高是**相加**的，滑杆又各自允许到 2，所以很容易越过这个界限。
 * 实测把三档都拉到 2 时 Σ(k·a) = 2.0——波面已经折叠，浪脊信号铺满全画面，
 * 配色与泡沫一起饱和，看起来就是"亮青水面 + 大片斑块"。
 * 这里按比例整体缩放，**保持三档之间的配比**，只把总陡度压回安全范围。
 * 默认设置是 0.697，低于上限，所以默认观感完全不受影响。
 */
const MAX_WAVE_STEEPNESS = 0.85

/**
 * 浪高与坡度的"参考尺度"。
 *
 * 颜色映射、次表面散射、泡沫细修都直接吃 vHeight / slope。如果按**原始值**用，
 * 把三档浪高一起拉大时这些量会一起饱和——实测整片水面会被涂成 crestColor（青色），
 * 泡沫也大面积爆开。而浪脊/泡沫的**主**信号早就按 waveRms 归一化过了，
 * 只有这几处没有，同一物理量两套算法。
 *
 * 这里算出当前的参考尺度，再用默认设置下的值去除，得到归一化系数：
 * **默认设置下系数恰好为 1**，所以默认观感完全不变，只修正非默认组合。
 */
function waveScaleReferences(settings: OceanSettings) {
  const amplitude = waveAmplitudes(settings)
  const k = (length: number) => (2 * Math.PI) / Math.max(0.2, length)
  const kx = k(settings.largeLength)
  const ky = k(settings.mediumLength)
  const kz = k(settings.smallLength)
  return {
    height: Math.hypot(amplitude.x, amplitude.y, amplitude.z),
    slope: Math.hypot(amplitude.x * kx, amplitude.y * ky, amplitude.z * kz),
  }
}

/** 默认设置下的参考尺度，用作归一化基准。 */
const DEFAULT_WAVE_SCALE = waveScaleReferences(defaultOceanSettings)

function waveAmplitudes(settings: OceanSettings) {
  const amplitude = new BABYLON.Vector3(
    Math.max(0.01, settings.largeVertical * settings.swellScale * 1.65),
    Math.max(0.01, settings.mediumVertical * settings.localScale * 1.15),
    Math.max(0.005, settings.smallVertical * settings.localScale * 0.5),
  )
  const steepness =
    (amplitude.x * 2 * Math.PI) / Math.max(0.2, settings.largeLength) +
    (amplitude.y * 2 * Math.PI) / Math.max(0.2, settings.mediumLength) +
    (amplitude.z * 2 * Math.PI) / Math.max(0.2, settings.smallLength)
  if (steepness > MAX_WAVE_STEEPNESS) {
    amplitude.scaleInPlace(MAX_WAVE_STEEPNESS / steepness)
  }
  return amplitude
}

type WaveComponent = {
  dirX: number
  dirZ: number
  length: number
  speed: number
  amplitude: number
  phase: number
  horizontal: number
  band: number
}

const WAVE_COMPONENTS_PER_BAND = 8
/** 波长在带内按无理因子铺开。原先带内是固定有理比 1 : 0.64 : 0.41，会形成空间周期性。 */
const WAVE_LENGTH_SPREAD = 1.3247
const WAVE_SPREAD_OCTAVES = 2.4
/** 确定性伪随机：只用于生成分量表，逐帧结果完全可复现。 */
function waveHash(value: number) {
  const result = Math.sin(value * 127.1 + 311.7) * 43758.5453
  return result - Math.floor(result)
}

/**
 * 生成整个波场的分量表。着色器与 CPU 浮力采样共用这一份，
 * 保证船体高度与渲染出的海面严格一致。
 *
 * 旧实现每条波带只有 3 个正弦、带内振幅比固定为 1 : 0.2 : 0.1，
 * 导致带内主分量独占 91% 能量、整个波场里「大波主分量」独占 68%，
 * 大尺度看上去就是一个单方向正弦——已改为每带 8 个分量、
 * 波长按无理比铺开、方向带散布、谱形围绕带中心衰减。
 */
function buildWaveComponents(settings: OceanSettings): WaveComponent[] {
  const amplitudes = waveAmplitudes(settings)
  const bands = [
    {
      length: Math.max(2, settings.largeLength),
      speed: Math.max(0.04, settings.swellWind * 0.18),
      amplitude: amplitudes.x,
      direction: settings.swellDirection,
      horizontal: settings.largeHorizontal,
    },
    {
      length: Math.max(1, settings.mediumLength),
      speed: Math.max(0.06, settings.windSpeed * 0.34),
      amplitude: amplitudes.y,
      direction: settings.windDirection,
      horizontal: settings.mediumHorizontal,
    },
    {
      length: Math.max(0.4, settings.smallLength),
      speed: Math.max(0.1, settings.windSpeed * 0.72),
      amplitude: amplitudes.z,
      direction: settings.windDirection + 53,
      horizontal: settings.smallHorizontal,
    },
  ]

  const components: WaveComponent[] = []
  bands.forEach((band, bandIndex) => {
    const lengths: number[] = []
    const weights: number[] = []
    for (let index = 0; index < WAVE_COMPONENTS_PER_BAND; index += 1) {
      const t = index / (WAVE_COMPONENTS_PER_BAND - 1)
      lengths.push(
        band.length *
          Math.pow(WAVE_LENGTH_SPREAD, (t - 0.5) * WAVE_SPREAD_OCTAVES),
      )
      const offset = (t - 0.5) / 0.28
      weights.push(Math.exp(-0.5 * offset * offset))
    }
    const weightNorm = Math.sqrt(
      weights.reduce((sum, weight) => sum + weight * weight, 0),
    )
    // 保持该带原有总能量：sum(振幅²) 与旧的 0.72² + 0.2² + 0.1² 相当
    const energy = band.amplitude * Math.sqrt(0.72 ** 2 + 0.2 ** 2 + 0.1 ** 2)

    for (let index = 0; index < WAVE_COMPONENTS_PER_BAND; index += 1) {
      const t = index / (WAVE_COMPONENTS_PER_BAND - 1)
      const length = lengths[index]!
      const seed = bandIndex * 31 + index * 7.7
      // 短波方向散布更大：真实海面的短波更受局地风扰动
      const spread = (20 + 40 * t) * (waveHash(seed) - 0.5) * 2
      const radians = BABYLON.Tools.ToRadians(band.direction + spread)
      components.push({
        dirX: Math.cos(radians),
        dirZ: Math.sin(radians),
        length,
        // 深水重力波 c ∝ √L，取代原先固定 1.34 / 1.77 的速度比
        speed: band.speed * Math.sqrt(length / band.length),
        amplitude: (energy * weights[index]!) / weightNorm,
        phase: waveHash(seed + 101.3) * Math.PI * 2,
        horizontal: band.horizontal,
        band: bandIndex,
      })
    }
  })
  return components
}

function setWaveUniforms(
  target: BABYLON.ShaderMaterial,
  components: WaveComponent[],
  settings: OceanSettings,
) {
  const data: number[] = []
  const shape: number[] = []
  for (const component of components) {
    data.push(component.dirX, component.dirZ, component.length, component.speed)
    shape.push(
      component.amplitude,
      component.phase,
      component.horizontal,
      component.band,
    )
  }
  target.setArray4('waveA', data)
  target.setArray4('waveB', shape)
  // 各带总高度的均方根：独立相位下 sum(a²)/2 的平方根。着色器用它归一化浪脊信号。
  const energy = [0, 0, 0]
  for (const component of components) {
    energy[component.band] =
      (energy[component.band] ?? 0) + component.amplitude * component.amplitude
  }
  const rms = energy.map((value) => Math.sqrt(Math.max(0.0001, value / 2)))
  target.setVector3('waveRms', new BABYLON.Vector3(rms[0]!, rms[1]!, rms[2]!))
  target.setFloat('chop', settings.lambda)
}

/** 与着色器 evaluateOcean 同构的 CPU 采样，用于船体浮力与尾迹高度。 */
function sampleWave(
  components: WaveComponent[],
  x: number,
  z: number,
  time: number,
) {
  let height = 0
  for (const component of components) {
    const k = (Math.PI * 2) / Math.max(component.length, 0.2)
    const phase =
      (x * component.dirX + z * component.dirZ) * k +
      time * component.speed +
      component.phase
    const s = Math.sin(phase)
    const plateau = 1.4
    const nrm = Math.sqrt(1 + plateau * plateau)
    height +=
      ((s * nrm) / Math.sqrt(1 + s * s * plateau * plateau)) *
      component.amplitude
  }
  return height
}

function createShip(scene: BABYLON.Scene) {
  const root = new BABYLON.TransformNode('hero-ship', scene)
  root.position.set(0, 1, 10)
  root.scaling.setAll(1.35)
  root.rotationQuaternion = BABYLON.Quaternion.Identity()

  const hullMaterial = standardMaterial(scene, 'hull-oak', '#6f321b', 0.08)
  const darkWood = standardMaterial(scene, 'hull-dark', '#241814', 0.04)
  const gold = standardMaterial(scene, 'ship-gold', '#d69a47', 0.08)
  const sailMaterial = standardMaterial(scene, 'warm-canvas', '#f3dfbc', 0.12)
  const sailShade = standardMaterial(scene, 'canvas-shadow', '#c99f75', 0.06)
  const flagMaterial = standardMaterial(scene, 'navy-flag', '#183552', 0.08)
  sailMaterial.backFaceCulling = false
  sailShade.backFaceCulling = false
  flagMaterial.backFaceCulling = false

  const hull = BABYLON.MeshBuilder.CreateCylinder(
    'faceted-hull',
    {
      height: 11,
      diameterTop: 5,
      diameterBottom: 1.25,
      tessellation: 6,
    },
    scene,
  )
  hull.rotation.x = Math.PI / 2
  hull.position.y = 1.8
  hull.scaling.x = 1.08
  hull.material = hullMaterial
  hull.parent = root

  const deck = BABYLON.MeshBuilder.CreateBox(
    'ship-deck',
    { width: 5.05, height: 0.38, depth: 7.9 },
    scene,
  )
  deck.position.set(0, 3.25, -0.55)
  deck.material = gold
  deck.parent = root

  const stern = BABYLON.MeshBuilder.CreateBox(
    'stern-castle',
    { width: 4.8, height: 2.25, depth: 2.6 },
    scene,
  )
  stern.position.set(0, 4.25, -3.25)
  stern.material = darkWood
  stern.parent = root
  for (let side = -1; side <= 1; side += 2) {
    for (let index = 0; index < 3; index += 1) {
      const window = BABYLON.MeshBuilder.CreateBox(
        `stern-window-${side}-${index}`,
        { width: 0.52, height: 0.55, depth: 0.08 },
        scene,
      )
      window.position.set(side * (0.7 + index * 0.58), 4.42, -4.58)
      window.material = gold
      window.parent = root
    }
  }

  const mastData = [
    { z: -1.85, height: 14, width: 6.3 },
    { z: 1.45, height: 12.2, width: 5.6 },
    { z: 4.15, height: 9.1, width: 4.25 },
  ]
  mastData.forEach((data, index) => {
    const mast = BABYLON.MeshBuilder.CreateCylinder(
      `mast-${index}`,
      { height: data.height, diameter: 0.22, tessellation: 8 },
      scene,
    )
    mast.position.set(0, 3.2 + data.height / 2, data.z)
    mast.material = darkWood
    mast.parent = root

    for (let level = 0; level < (index === 2 ? 1 : 2); level += 1) {
      const y = 8.1 + level * 4.05 - index * 0.4
      const width = data.width * (1 - level * 0.24)
      const yard = BABYLON.MeshBuilder.CreateCylinder(
        `yard-${index}-${level}`,
        { height: width + 0.7, diameter: 0.14, tessellation: 6 },
        scene,
      )
      yard.rotation.z = Math.PI / 2
      yard.position.set(0, y + 1.35, data.z)
      yard.material = darkWood
      yard.parent = root
      const sail = BABYLON.MeshBuilder.CreatePlane(
        `sail-${index}-${level}`,
        { width, height: 3.15 - index * 0.18 },
        scene,
      )
      sail.position.set(0, y, data.z - 0.05)
      sail.rotation.y = Math.PI
      sail.material = level === 0 ? sailMaterial : sailShade
      sail.parent = root
    }
  })

  const flag = BABYLON.MeshBuilder.CreatePlane(
    'ship-flag',
    { width: 2.5, height: 1.15 },
    scene,
  )
  flag.position.set(1.3, 16.6, -1.85)
  flag.material = flagMaterial
  flag.parent = root

  const riggingMaterial = new BABYLON.StandardMaterial('rigging', scene)
  riggingMaterial.emissiveColor = new BABYLON.Color3(0.12, 0.08, 0.05)
  const rigging = [
    [new BABYLON.Vector3(0, 16.4, -1.85), new BABYLON.Vector3(-2.1, 3.2, -4.4)],
    [new BABYLON.Vector3(0, 16.4, -1.85), new BABYLON.Vector3(2.1, 3.2, -4.4)],
    [new BABYLON.Vector3(0, 14.2, 1.45), new BABYLON.Vector3(-2.1, 3.2, 4.7)],
    [new BABYLON.Vector3(0, 14.2, 1.45), new BABYLON.Vector3(2.1, 3.2, 4.7)],
  ]
  rigging.forEach((points, index) => {
    const rope = BABYLON.MeshBuilder.CreateLines(
      `rigging-${index}`,
      { points },
      scene,
    )
    rope.color = new BABYLON.Color3(0.12, 0.07, 0.035)
    rope.parent = root
  })
  return root
}

/**
 * 岛屿位置与缩放。网格与近岸距离场共用这一份数据，避免两边各写一遍而漂移。
 * 岸线半径 = 圆柱底半径 9.5 米 × scale。
 */
const ISLANDS: ReadonlyArray<{ x: number; z: number; scale: number }> = [
  { x: -58, z: 137, scale: 0.72 },
  { x: 65, z: 170, scale: 1.05 },
  { x: 43, z: 103, scale: 0.5 },
  { x: -38, z: 92, scale: 0.38 },
  { x: -44, z: 235, scale: 2.15 },
]
const SHORE_RADIUS_PER_SCALE = 9.5
const MAX_ISLAND_UNIFORMS = 8

function islandUniforms() {
  const data: number[] = []
  for (let index = 0; index < MAX_ISLAND_UNIFORMS; index += 1) {
    const island = ISLANDS[index]
    data.push(
      island?.x ?? 0,
      island?.z ?? 0,
      (island?.scale ?? 0) * SHORE_RADIUS_PER_SCALE,
    )
  }
  return data
}

function createIsland(
  scene: BABYLON.Scene,
  x: number,
  z: number,
  scale: number,
) {
  const root = new BABYLON.TransformNode(`island-${x}-${z}`, scene)
  root.position.set(x, -0.2, z)
  root.scaling.setAll(scale)
  const sand = standardMaterial(scene, `sand-${x}`, '#dbb778', 0.04)
  const rock = standardMaterial(scene, `rock-${x}`, '#7f7c75', 0.08)
  const litRock = standardMaterial(scene, `lit-rock-${x}`, '#bf8d69', 0.1)
  const green = standardMaterial(scene, `green-${x}`, '#4e9256', 0.1)
  const base = BABYLON.MeshBuilder.CreateCylinder(
    `shore-${x}`,
    { height: 1.4, diameterTop: 14, diameterBottom: 19, tessellation: 10 },
    scene,
  )
  base.material = sand
  base.parent = root
  for (let index = 0; index < 6; index += 1) {
    const peak = BABYLON.MeshBuilder.CreateIcoSphere(
      `peak-${x}-${index}`,
      { radius: 4.4 + index * 0.48, subdivisions: 1, flat: true },
      scene,
    )
    peak.scaling.set(0.72 + index * 0.07, 1.15 + index * 0.2, 0.66)
    peak.position.set(
      (index - 2.5) * 1.85,
      2.25 + index * 1.05,
      (index % 2) * 1.65 - 0.8,
    )
    peak.rotation.y = index * 0.78
    peak.material = index % 3 === 0 ? litRock : rock
    peak.parent = root
  }
  for (let index = 0; index < 9; index += 1) {
    const crown = BABYLON.MeshBuilder.CreatePolyhedron(
      `island-green-${x}-${index}`,
      { type: 2, size: 1.15 + (index % 3) * 0.25 },
      scene,
    )
    crown.position.set(
      (index - 4) * 1.25,
      1.15 + (index % 2) * 0.45,
      3 - (index % 3) * 1.4,
    )
    crown.scaling.y = 0.48
    crown.material = green
    crown.parent = root
  }
  return root
}

function createCloud(
  scene: BABYLON.Scene,
  x: number,
  y: number,
  z: number,
  scale: number,
) {
  const root = new BABYLON.TransformNode(`cloud-${x}-${z}`, scene)
  root.position.set(x, y, z)
  root.scaling.setAll(scale)
  const light = standardMaterial(scene, `cloud-light-${x}`, '#fff2d9', 0.34)
  const shade = standardMaterial(scene, `cloud-shade-${x}`, '#c9cfda', 0.2)
  const puffs: Array<[number, number, number, number]> = [
    [-6, 0, 0, 4.8],
    [-2.8, 1.8, 0.4, 6.1],
    [1.2, 2.9, 0, 7.3],
    [5.7, 1.1, 0.5, 5.6],
    [9, -0.3, 0, 3.8],
    [1.5, -1.4, -0.6, 6.4],
    [-3.2, -1.1, -0.5, 4.9],
  ]
  puffs.forEach(([px, py, pz, size], index) => {
    const puff = BABYLON.MeshBuilder.CreateIcoSphere(
      `cloud-puff-${x}-${index}`,
      { radius: size, subdivisions: 2, flat: true },
      scene,
    )
    puff.position.set(px, py, pz)
    puff.scaling.y = 0.72
    puff.material = index === 0 || index === 5 ? shade : light
    puff.parent = root
  })
  return root
}

function createWake(scene: BABYLON.Scene) {
  const shader = new BABYLON.ShaderMaterial(
    'ship-wake-material',
    scene,
    { vertexSource: wakeVertex, fragmentSource: wakeFragment },
    {
      attributes: ['position'],
      uniforms: [
        'world',
        'worldViewProjection',
        ...waveUniforms,
        'waterOffset',
        'originZ',
        'wakeLength',
        'initialWidth',
        'spread',
        'angle',
        'breakup',
        'textureScale',
        'brightness',
        'wakeColor',
        'wakeWaterColor',
        'cellSize',
        'gridOffset',
      ],
      needAlphaBlending: true,
    },
  )
  shader.backFaceCulling = false
  shader.disableDepthWrite = true
  shader.alphaMode = BABYLON.Engine.ALPHA_COMBINE
  const mesh = BABYLON.MeshBuilder.CreateGround(
    'ship-wake',
    { width: 58, height: 106, subdivisions: 150 },
    scene,
  )
  mesh.position.z = -37
  mesh.material = shader
  mesh.renderingGroupId = 1
  return { mesh, shader }
}

function sunVector(settings: OceanSettings) {
  const elevation = settings.inclination
  const azimuth = settings.azimuth
  return new BABYLON.Vector3(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth),
  ).normalize()
}

export async function createOcean(
  canvas: HTMLCanvasElement,
  initial: OceanSettings,
): Promise<OceanRuntime> {
  const engine = new BABYLON.Engine(canvas, true, {
    stencil: true,
    preserveDrawingBuffer: false,
  })
  let resize: ResizeObserver | undefined
  try {
    const scene = new BABYLON.Scene(engine)
    scene.useRightHandedSystem = true
    scene.clearColor = new BABYLON.Color4(0.18, 0.5, 0.7, 1)
    scene.ambientColor = new BABYLON.Color3(0.32, 0.38, 0.4)
    scene.imageProcessingConfiguration.toneMappingEnabled = true
    scene.imageProcessingConfiguration.toneMappingType =
      BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES

    const camera = new BABYLON.FreeCamera(
      'ocean-camera',
      new BABYLON.Vector3(initial.cameraX, initial.cameraY, initial.cameraZ),
      scene,
    )
    camera.rotation.set(
      BABYLON.Tools.ToRadians(initial.cameraPitch),
      BABYLON.Tools.ToRadians(initial.cameraYaw),
      0,
    )
    camera.minZ = 0.2
    camera.maxZ = 1800
    camera.speed = initial.cameraSpeed
    camera.fov = BABYLON.Tools.ToRadians(initial.cameraFov)
    camera.keysUp = [87, 38]
    camera.keysDown = [83, 40]
    camera.keysLeft = [65, 37]
    camera.keysRight = [68, 39]
    camera.keysUpward = [69, 33]
    camera.keysDownward = [32, 34]
    camera.attachControl(canvas, true)
    const homePosition = camera.position.clone()
    const homeRotation = camera.rotation.clone()

    const hemi = new BABYLON.HemisphericLight(
      'sky-light',
      new BABYLON.Vector3(0, 1, 0),
      scene,
    )
    hemi.groundColor = BABYLON.Color3.FromHexString('#315b69')
    const sun = new BABYLON.DirectionalLight(
      'sun-light',
      new BABYLON.Vector3(-0.4, -0.72, 0.5),
      scene,
    )
    sun.diffuse = BABYLON.Color3.FromHexString('#ffe4b2')

    const sky = new BABYLON.ShaderMaterial(
      'painted-sky',
      scene,
      { vertexSource: skyVertex, fragmentSource: skyFragment },
      {
        attributes: ['position'],
        uniforms: [
          'worldViewProjection',
          'time',
          'sunDirection',
          'luminance',
          'turbidity',
          'rayleigh',
          'mie',
          'nightAmount',
        ],
      },
    )
    sky.backFaceCulling = false
    sky.disableDepthWrite = true
    const skyMesh = BABYLON.MeshBuilder.CreateSphere(
      'sky-dome',
      { diameter: 1200, segments: 28, sideOrientation: BABYLON.Mesh.BACKSIDE },
      scene,
    )
    skyMesh.material = sky
    skyMesh.infiniteDistance = true

    const sunDiscMaterial = standardMaterial(scene, 'sun-disc', '#fff4ce')
    sunDiscMaterial.disableLighting = true
    sunDiscMaterial.emissiveColor = new BABYLON.Color3(2.4, 1.85, 0.9)
    const sunDisc = BABYLON.MeshBuilder.CreateSphere(
      'sun-disc',
      { diameter: 6, segments: 18 },
      scene,
    )
    sunDiscMaterial.fogEnabled = false
    sunDisc.material = sunDiscMaterial
    sunDisc.setEnabled(false)
    const moonDiscMaterial = standardMaterial(scene, 'moon-disc', '#dce9ff')
    moonDiscMaterial.disableLighting = true
    moonDiscMaterial.emissiveColor = new BABYLON.Color3(0.82, 0.9, 1.3)
    const moonDisc = BABYLON.MeshBuilder.CreateSphere(
      'moon-disc',
      { diameter: 10, segments: 18 },
      scene,
    )
    moonDiscMaterial.fogEnabled = false
    moonDisc.material = moonDiscMaterial

    const oceanUniforms = [
      'world',
      'worldViewProjection',
      'cameraPosition',
      'sunDirection',
      'moonDirection',
      'moonVisible',
      'reflectionMatrix',
      'seaLevel',
      'reflectionTexel',
      ...waveUniforms,
      'deepColor',
      'midColor',
      'slopeColor',
      'crestColor',
      'foamColor',
      'highlightColor',
      'sssColor',
      'fogColor',
      'cellSize',
      'heightScale',
      'slopeScale',
      'facetStrength',
      'edgeGlowStrength',
      'edgeGlowWidth',
      'vertexGlowStrength',
      'glowSpread',
      'shadowStrength',
      'shipShadow',
      'shipShadowSize',
      'shipYaw',
      'facetFadeStart',
      'facetFadeEnd',
      'facetJitter',
      'shadingContrast',
      'shadingBias',
      'toneSteps',
      'toneTransition',
      'heightColorStrength',
      'heightColorBias',
      'slopeColorStrength',
      'slopeColorBias',
      'lightColorStrength',
      'saturation',
      'brightness',
      'fresnelStrength',
      'fresnelBias',
      'roughness',
      'highlightStrength',
      'highlightSharpness',
      'glintScale',
      'glintAspect',
      'glintThreshold',
      'glintDistortion',
      'crestFoam',
      'foamWeights',
      'foamBias',
      'foamAmount',
      'foamHeightWeight',
      'foamSlopeWeight',
      'foamEdgeSoftness',
      'foamMaskScale',
      'foamMaskAspect',
      'foamMaskAngle',
      'foamBreakup',
      'foamDistortion',
      'foamSpeed',
      'foamFadeStart',
      'foamFadeEnd',
      'sssStrength',
      'sssBase',
      'sssScale',
      'shallowColor',
      'islands',
      'islandCount',
      'contactFoam',
      'foamContact',
      'foamFoldBias',
      'foamFoldScale',
      'skyLuminance',
      'seaHalfExtent',
      'turbidity',
      'rayleigh',
      'mie',
      'foamHistoryStep',
      'fogMode',
      'fogStart',
      'fogEnd',
      'fogDensity',
      'stylized',
    ]
    const ocean = new BABYLON.ShaderMaterial(
      'low-poly-ocean',
      scene,
      { vertexSource: oceanVertex, fragmentSource: oceanFragment },
      {
        attributes: ['position', 'ringCellSize'],
        uniforms: oceanUniforms,
        samplers: ['sceneReflection'],
      },
    )
    ocean.backFaceCulling = false
    const initialLayout = seaRingLayout(
      initial.seaExtent,
      initial.facetCellSize,
    )
    let seaBaseCell = initialLayout.baseCell
    let seaRingCount = initialLayout.ringCount
    let sea = createSeaRings(scene, seaBaseCell, seaRingCount)
    sea.forEach((mesh) => (mesh.material = ocean))

    const ship = createShip(scene)
    // 船模型异步加载；加载完成前先用程序化船顶上，避免空窗。
    // 关键：GLB 直接挂到**同一个 root** 上，于是海面浮沉、纵横摇那套代码完全不用改。
    void BABYLON.SceneLoader.ImportMeshAsync('', '', SHIP_MODEL_URL, scene)
      .then((result) => {
        if (disposed) {
          result.meshes.forEach((mesh) => mesh.dispose())
          return
        }
        ship.getChildMeshes().forEach((mesh) => mesh.dispose())
        result.meshes.forEach((mesh) => {
          if (!mesh.parent) mesh.parent = ship
          mesh.receiveShadows = true
          shadowGenerator.addShadowCaster(mesh, false)
        })
        ship.scaling.setAll(SHIP_MODEL_SCALE)
        // 船体贴图本身很暗（oak-basecolor 平均 rgb(68,61,55)，线性空间约 0.05），
        // 在场景的 ACES 色调映射下几乎发黑。参考图的船体是中等暖棕，所以做一次提亮 + 轻微暖化。
        // 注意：色调映射会压缩，所以系数要压得比较大才看得出差别（实测 1.0→2.4 只提升约 20%）。
        result.meshes.forEach((mesh) => {
          const material = mesh.material
          if (material instanceof BABYLON.PBRMaterial) {
            material.albedoColor = new BABYLON.Color3(2.4, 2.26, 2.06)
          }
        })
        canvas.dataset.ship = 'caravel-pbr'
      })
      .catch(() => {
        // 加载失败就保留程序化船，不影响渲染
      })
    const cloudRoots = [
      createCloud(scene, -38, 47, 145, 1.18),
      createCloud(scene, 34, 57, 188, 1.45),
      createCloud(scene, 2, 35, 118, 0.72),
      createCloud(scene, 88, 43, 210, 0.9),
    ]
    const cloudMaterials = scene.materials.filter((entry) =>
      entry.name.startsWith('cloud-'),
    ) as BABYLON.StandardMaterial[]
    const islandRoots = ISLANDS.map((island) =>
      createIsland(scene, island.x, island.z, island.scale),
    )

    // ---- 阴影视图 ----
    // 太阳是平行光，用正交阴影贴图。near/far 固定下来是**有意的**：
    // 海面是自定义 ShaderMaterial、不会自动接收阴影，需要在片元里手算
    // Babylon 那套"归一化线性深度"，而那个公式要用到这两个值。
    // 这两个值只服务于 Babylon 自己的物体阴影（船体自遮挡、岛屿之间）。
    // 海面的阴影走的是解析式，不用阴影贴图。
    sun.shadowMinZ = 1
    sun.shadowMaxZ = 260
    const shadowGenerator = new BABYLON.ShadowGenerator(2048, sun)
    shadowGenerator.bias = 0.002
    shadowGenerator.normalBias = 0.03
    const shadowCasters: BABYLON.AbstractMesh[] = []
    ;[...islandRoots, ...cloudRoots].forEach((root) => {
      root.getChildMeshes().forEach((mesh) => {
        mesh.receiveShadows = true
        shadowCasters.push(mesh)
      })
    })
    shadowCasters.forEach((mesh) =>
      shadowGenerator.addShadowCaster(mesh, false),
    )
    const wake = createWake(scene)
    // One half-resolution scene capture, excluding water to prevent recursion.
    const reflection = new BABYLON.MirrorTexture(
      'ocean-scene-reflection',
      { ratio: 0.5 },
      scene,
      false,
    )
    reflection.clearColor = new BABYLON.Color4(0, 0, 0, 0)
    // 用谓词而不是静态快照：海面环网格会重建、船模型是异步加载的，
    // 一次性 filter 出来的数组会把后来的新网格全部漏掉（表现是"有物体、没倒影"）。
    const excludedFromReflection = new Set<BABYLON.AbstractMesh>([
      wake.mesh,
      skyMesh,
      sunDisc,
      moonDisc,
    ])
    reflection.renderListPredicate = (mesh) =>
      !excludedFromReflection.has(mesh) && !sea.includes(mesh as BABYLON.Mesh)
    const reflectionMatrix = BABYLON.Matrix.Identity()
    reflection.onBeforeRenderObservable.add(() => {
      reflectionMatrix.copyFrom(scene.getTransformMatrix())
      ocean.setMatrix('reflectionMatrix', reflectionMatrix)
    })
    scene.customRenderTargets.push(reflection)
    ocean.setTexture('sceneReflection', reflection)
    const moonDirection = new BABYLON.Vector3(-0.1, 0.22, 0.97).normalize()
    ocean.setVector3('moonDirection', moonDirection)
    // 尾迹泡沫用最内环的格子，格点原点就是世界原点（各环半宽都是格子的整数倍）。
    wake.shader.setFloat('gridOffset', 0)

    let waveComponents = buildWaveComponents(initial)
    let settings = { ...initial }
    let previous = { ...initial }
    // 船的偏航角，解析阴影要用（与每帧的船体姿态保持一致）
    let shipYaw = 0
    let clock = initial.timeOffset
    let last = performance.now()
    let lastDiagnostics = 0
    let disposed = false
    let pendingSeaRebuild: ReturnType<typeof setTimeout> | undefined
    let lastSeaRebuildAt = 0

    /** 重建整组同心环。先建后删，重建失败时保留旧网格。 */
    const rebuildSea = (baseCell: number, ringCount: number) => {
      // 尾迹泡沫跟随最内环：两者格子必须一致，否则泡沫与海面面片错位。
      wake.shader.setFloat('cellSize', baseCell)
      if (baseCell === seaBaseCell && ringCount === seaRingCount) return
      const previousMeshes = sea
      const nextMeshes = createSeaRings(scene, baseCell, ringCount)
      const previousY = previousMeshes[0]?.position.y ?? 0
      nextMeshes.forEach((mesh) => {
        mesh.material = ocean
        mesh.position.y = previousY
      })
      sea = nextMeshes
      seaBaseCell = baseCell
      seaRingCount = ringCount
      ocean.setFloat('seaHalfExtent', seaOuterHalfExtent(baseCell, ringCount))
      previousMeshes.forEach((mesh) => mesh.dispose())
    }

    /** 节流重建：窗口内连续改动合并为一次尾部重建，最终值一定会被应用。 */
    const scheduleSeaRebuild = (baseCell: number, ringCount: number) => {
      // 环组顶点数只有约 4 万（旧的单张均匀网格是 26 万），重建很便宜，
      // 固定用小间隔节流即可，不需要按规模分档。
      const interval = SEA_REBUILD_INTERVAL_MS
      const elapsed = performance.now() - lastSeaRebuildAt
      if (elapsed >= interval) {
        if (pendingSeaRebuild) {
          clearTimeout(pendingSeaRebuild)
          pendingSeaRebuild = undefined
        }
        lastSeaRebuildAt = performance.now()
        rebuildSea(baseCell, ringCount)
        return
      }
      if (pendingSeaRebuild) clearTimeout(pendingSeaRebuild)
      pendingSeaRebuild = setTimeout(
        () => {
          pendingSeaRebuild = undefined
          lastSeaRebuildAt = performance.now()
          if (!disposed) rebuildSea(baseCell, ringCount)
        },
        Math.max(0, interval - elapsed),
      )
    }

    const applySeaResolution = (next: OceanSettings, first: boolean) => {
      // 范围由 seaExtent 固定；facetCellSize 只影响需要几环。
      const layout = seaRingLayout(next.seaExtent, next.facetCellSize)
      const { baseCell, ringCount } = layout
      ocean.setFloat('seaHalfExtent', layout.radius)
      if (first) {
        rebuildSea(baseCell, ringCount)
        lastSeaRebuildAt = performance.now()
        return
      }
      scheduleSeaRebuild(baseCell, ringCount)
    }

    const apply = (next: OceanSettings, first = false) => {
      const lastSettings = previous
      previous = { ...next }
      settings = { ...next }
      if (first || next.timeOffset !== lastSettings.timeOffset)
        clock = next.timeOffset

      scene.imageProcessingConfiguration.exposure = next.exposure
      scene.imageProcessingConfiguration.contrast = next.contrast
      hemi.intensity = 0.72 * next.envIntensity
      sun.intensity = 1.22 * next.lightIntensity
      applySeaResolution(next, first)
      sea.forEach((mesh) => (mesh.position.y = next.seaLevel))
      reflection.mirrorPlane = new BABYLON.Plane(0, -1, 0, next.seaLevel)
      ocean.setFloat('seaLevel', next.seaLevel)
      wake.mesh.position.y = next.seaLevel
      ocean.wireframe = next.wireframe
      wake.mesh.setEnabled(next.wakeEnabled)

      const sunPosition = sunVector(next)
      const lightDirection = sunPosition.scale(-1)
      sun.direction.copyFrom(lightDirection)
      sunDisc.position
        .copyFrom(camera.position)
        .addInPlace(sunPosition.scale(420))
      const nightAmount =
        1 - BABYLON.Scalar.Clamp((sunPosition.y + 0.08) / 0.28, 0, 1)
      // 月亮只在太阳落到地平线以下之后才出现，并且圆盘与水面光路共用这一个可见度。
      // 之前两者门控不同（圆盘 nightAmount>0.15，光路 smoothstep(.2,.95,nightAmount)），
      // 黄昏时会"天上没月亮、水里却有月亮光路"，看起来像第二个太阳。
      const moonVisibility = BABYLON.Scalar.Clamp(
        (-0.02 - sunPosition.y) / 0.06,
        0,
        1,
      )
      moonDisc.setEnabled(moonVisibility > 0.001)
      moonDiscMaterial.emissiveColor.set(
        0.82 * moonVisibility,
        0.9 * moonVisibility,
        1.3 * moonVisibility,
      )
      ocean.setFloat('moonVisible', moonVisibility)
      moonDisc.position
        .copyFrom(camera.position)
        .addInPlace(
          new BABYLON.Vector3(-0.1, 0.22, 0.97).normalize().scale(420),
        )
      const sunsetAmount =
        (1 - BABYLON.Scalar.Clamp((sunPosition.y - 0.04) / 0.22, 0, 1)) *
        (1 - nightAmount)
      cloudMaterials.forEach((cloudMaterial) => {
        const isShade = cloudMaterial.name.includes('shade')
        const day = BABYLON.Color3.FromHexString(
          isShade ? '#c9cfda' : '#fff2d9',
        )
        const sunset = BABYLON.Color3.FromHexString(
          isShade ? '#b86d68' : '#ffd0a0',
        )
        const night = BABYLON.Color3.FromHexString(
          isShade ? '#243454' : '#526483',
        )
        const lit = BABYLON.Color3.Lerp(day, sunset, sunsetAmount)
        cloudMaterial.diffuseColor.copyFrom(
          BABYLON.Color3.Lerp(lit, night, nightAmount),
        )
        cloudMaterial.emissiveColor.copyFrom(
          cloudMaterial.diffuseColor.scale(0.22),
        )
      })

      waveComponents = buildWaveComponents(next)
      setWaveUniforms(ocean, waveComponents, next)
      ocean.setColor3('deepColor', linearColor(next.valleyColor))
      ocean.setColor3('midColor', linearColor(next.waterColor))
      ocean.setColor3('slopeColor', linearColor(next.slopeColor))
      ocean.setColor3('crestColor', linearColor(next.crestColor))
      ocean.setColor3('foamColor', linearColor(next.foamColor))
      ocean.setColor3('highlightColor', linearColor(next.highlightColor))
      ocean.setColor3('sssColor', linearColor(next.sssColor))
      ocean.setColor3('fogColor', linearColor(next.fogColor))
      const waveScale = waveScaleReferences(next)
      ocean.setFloat(
        'heightScale',
        DEFAULT_WAVE_SCALE.height / Math.max(0.001, waveScale.height),
      )
      ocean.setFloat(
        'slopeScale',
        DEFAULT_WAVE_SCALE.slope / Math.max(0.001, waveScale.slope),
      )
      ocean.setFloat('facetStrength', next.facetStrength)
      ocean.setFloat('edgeGlowStrength', next.edgeGlowStrength)
      ocean.setFloat('edgeGlowWidth', next.edgeGlowWidth)
      ocean.setFloat('vertexGlowStrength', next.vertexGlowStrength)
      ocean.setFloat('glowSpread', next.glowSpread)
      ocean.setFloat('shadowStrength', next.shadowStrength)
      // 解析阴影用的船体包围盒（模型局部：长 13.1、宽 4.8、高约 10）× 缩放。
      // y 用船体的中段高度而不是水线，否则投影会偏。
      ocean.setVector3(
        'shipShadow',
        new BABYLON.Vector3(
          ship.position.x,
          ship.position.z,
          ship.position.y + 5.5 * SHIP_MODEL_SCALE,
        ),
      )
      ocean.setVector3(
        'shipShadowSize',
        new BABYLON.Vector3(6.6 * SHIP_MODEL_SCALE, 2.4 * SHIP_MODEL_SCALE, 0),
      )
      ocean.setFloat('shipYaw', shipYaw)
      ocean.setFloat('facetFadeStart', next.facetFadeStart)
      ocean.setFloat('facetFadeEnd', next.facetFadeEnd)
      ocean.setFloat('facetJitter', next.facetJitter)
      ocean.setFloat('shadingContrast', next.shadingContrast)
      ocean.setFloat('shadingBias', next.shadingBias)
      ocean.setFloat('toneSteps', next.toneSteps)
      ocean.setFloat('toneTransition', next.toneTransition)
      ocean.setFloat('foamFoldBias', next.foamFoldBias)
      ocean.setFloat('foamFoldScale', 12)
      ocean.setFloat('foamHistoryStep', 0.16)
      ocean.setFloat(
        'skyLuminance',
        Math.max(0.08, next.luminance * next.envIntensity),
      )
      ocean.setFloat('turbidity', next.turbidity)
      ocean.setFloat('rayleigh', next.rayleigh)
      ocean.setFloat('mie', next.mie)
      ocean.setFloat('heightColorStrength', next.heightColorStrength)
      ocean.setFloat('heightColorBias', next.heightColorBias)
      ocean.setFloat('slopeColorStrength', next.slopeColorStrength)
      ocean.setFloat('slopeColorBias', next.slopeColorBias)
      ocean.setFloat('lightColorStrength', next.lightColorStrength)
      ocean.setFloat('saturation', next.saturation)
      ocean.setFloat('brightness', next.brightness * (1 - nightAmount * 0.25))
      ocean.setFloat('fresnelStrength', next.fresnelStrength)
      ocean.setFloat('fresnelBias', next.fresnelBias)
      ocean.setFloat('roughness', next.roughness)
      ocean.setFloat(
        'highlightStrength',
        next.highlightStrength * (1 - nightAmount * 0.45),
      )
      ocean.setFloat('highlightSharpness', next.highlightSharpness)
      ocean.setFloat('glintScale', next.glintScale)
      ocean.setFloat('glintAspect', next.glintAspect)
      ocean.setFloat('glintThreshold', next.glintThreshold)
      ocean.setFloat('glintDistortion', next.glintDistortion)
      ocean.setFloat('crestFoam', next.crestFoam ? 1 : 0)
      ocean.setVector3(
        'foamWeights',
        new BABYLON.Vector3(next.largeFoam, next.mediumFoam, next.smallFoam),
      )
      ocean.setVector3(
        'foamBias',
        new BABYLON.Vector3(
          next.foamBiasLarge,
          next.foamBiasMedium,
          next.foamBiasSmall,
        ),
      )
      ocean.setFloat('foamAmount', next.foam)
      ocean.setFloat('foamHeightWeight', next.foamHeightWeight)
      ocean.setFloat('foamSlopeWeight', next.foamSlopeWeight)
      ocean.setFloat('foamEdgeSoftness', next.foamEdgeSoftness)
      ocean.setFloat('foamMaskScale', next.foamMaskScale)
      ocean.setFloat('foamMaskAspect', next.foamMaskAspect)
      ocean.setFloat('foamMaskAngle', next.foamMaskAngle)
      ocean.setFloat('foamBreakup', next.foamBreakup)
      ocean.setFloat('foamDistortion', next.foamDistortion)
      ocean.setVector2(
        'foamSpeed',
        new BABYLON.Vector2(next.foamSpeedX, next.foamSpeedZ),
      )
      ocean.setFloat('foamFadeStart', next.foamFadeStart)
      ocean.setFloat('foamFadeEnd', next.foamFadeEnd)
      ocean.setColor3('shallowColor', linearColor(next.shallowColor))
      ocean.setFloat('shallowStart', next.shallowStart)
      ocean.setFloat('shallowEnd', next.shallowEnd)
      ocean.setArray3('islands', islandUniforms())
      ocean.setFloat('islandCount', ISLANDS.length)
      ocean.setFloat('contactFoam', next.contactFoam ? 1 : 0)
      ocean.setFloat('foamContact', next.foamContact)
      ocean.setFloat('sssStrength', next.sssStrength)
      ocean.setFloat('sssBase', next.sssBase)
      ocean.setFloat('sssScale', next.sssScale)
      ocean.setFloat(
        'fogMode',
        next.fogMode === 'linear'
          ? 1
          : next.fogMode === 'exp'
            ? 2
            : next.fogMode === 'exp2'
              ? 3
              : 0,
      )
      ocean.setFloat('fogStart', next.fogStart)
      ocean.setFloat('fogEnd', next.fogEnd)
      ocean.setFloat('fogDensity', next.fogDensity)
      // 让岛屿、云等标准材质也吃到同一套空气透视；天空盒与日月光盘是自绘的，不受 scene fog 影响。
      scene.fogMode =
        next.fogMode === 'linear'
          ? BABYLON.Scene.FOGMODE_LINEAR
          : next.fogMode === 'exp'
            ? BABYLON.Scene.FOGMODE_EXP
            : next.fogMode === 'exp2'
              ? BABYLON.Scene.FOGMODE_EXP2
              : BABYLON.Scene.FOGMODE_NONE
      scene.fogColor = BABYLON.Color3.FromHexString(next.fogColor)
      scene.fogStart = next.fogStart
      scene.fogEnd = next.fogEnd
      scene.fogDensity = next.fogDensity
      ocean.setFloat('stylized', next.stylized ? 1 : 0)

      setWaveUniforms(wake.shader, waveComponents, next)
      wake.shader.setFloat('waterOffset', next.wakeWaterOffset)
      wake.shader.setFloat('originZ', 8)
      wake.shader.setFloat('wakeLength', Math.max(12, next.wakeLifetime * 8))
      wake.shader.setFloat('initialWidth', next.wakeInitialWidth)
      wake.shader.setFloat('spread', next.wakeSpreadSpeed)
      wake.shader.setFloat('angle', next.wakeAngle)
      wake.shader.setFloat('breakup', next.wakeBreakup)
      wake.shader.setFloat('textureScale', next.wakeTextureScale)
      wake.shader.setFloat('brightness', next.wakeBrightness)
      wake.shader.setColor3('wakeColor', linearColor(next.wakeColor))
      wake.shader.setColor3('wakeWaterColor', linearColor(next.wakeWaterColor))

      sky.setVector3('sunDirection', lightDirection)
      sky.setFloat(
        'luminance',
        Math.max(0.08, next.luminance * next.envIntensity),
      )
      sky.setFloat('turbidity', next.turbidity)
      sky.setFloat('rayleigh', next.rayleigh)
      sky.setFloat('mie', next.mie)
      sky.setFloat('nightAmount', nightAmount)

      camera.speed = next.cameraSpeed
      camera.fov = BABYLON.Tools.ToRadians(next.cameraFov)
      camera.keysUp = next.zqsd ? [90, 38] : [87, 38]
      camera.keysLeft = next.zqsd ? [81, 37] : [65, 37]
      if (
        !first &&
        (next.cameraX !== lastSettings.cameraX ||
          next.cameraY !== lastSettings.cameraY ||
          next.cameraZ !== lastSettings.cameraZ ||
          next.cameraPitch !== lastSettings.cameraPitch ||
          next.cameraYaw !== lastSettings.cameraYaw)
      ) {
        camera.position.set(next.cameraX, next.cameraY, next.cameraZ)
        camera.rotation.set(
          BABYLON.Tools.ToRadians(next.cameraPitch),
          BABYLON.Tools.ToRadians(next.cameraYaw),
          0,
        )
      }
    }
    apply(initial, true)

    scene.onBeforeRenderObservable.add(() => {
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (!settings.animationPaused) clock += dt * settings.animationSpeed
      ocean.setFloat('time', clock)
      ocean.setVector3('cameraPosition', camera.position)
      const reflectionSize = reflection.getSize()
      if (now - lastDiagnostics > 1000) {
        canvas.dataset.renderFps = engine.getFps().toFixed(1)
        canvas.dataset.reflectionSize = `${reflectionSize.width}x${reflectionSize.height}`
        lastDiagnostics = now
      }
      ocean.setVector2(
        'reflectionTexel',
        new BABYLON.Vector2(
          1 / reflectionSize.width,
          1 / reflectionSize.height,
        ),
      )
      ocean.setVector3('sunDirection', sun.direction)
      wake.shader.setFloat('time', clock)
      sky.setFloat('time', clock)

      const shipHeight = sampleWave(waveComponents, 0, 10, clock)
      ship.position.y =
        settings.seaLevel +
        settings.buoyOffset -
        SHIP_DRAFT * SHIP_MODEL_SCALE +
        (settings.buoyancy ? shipHeight * settings.heaveScale * 0.34 : 0)
      shipYaw = Math.sin(clock * 0.22) * 0.018
      ship.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(
        shipYaw,
        settings.buoyancy
          ? Math.sin(clock * 0.42) * 0.026 * settings.pitchScale
          : 0,
        settings.buoyancy
          ? Math.sin(clock * 0.36) * 0.045 * settings.rollScale
          : 0,
      )
      const currentSun = sunVector(settings)
      sunDisc.position
        .copyFrom(camera.position)
        .addInPlace(currentSun.scale(420))
      moonDisc.position
        .copyFrom(camera.position)
        .addInPlace(
          new BABYLON.Vector3(-0.1, 0.22, 0.97).normalize().scale(420),
        )
    })

    resize = new ResizeObserver(() => engine.resize())
    resize.observe(canvas)
    engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio || 1, 1.5))
    engine.resize()
    canvas.dataset.renderer = 'webgl-art-directed-ocean'

    await new Promise<void>((resolve) => scene.executeWhenReady(resolve))
    engine.runRenderLoop(() => scene.render())

    return {
      update(next) {
        apply(next)
      },
      resetCamera() {
        camera.position.copyFrom(homePosition)
        camera.rotation.copyFrom(homeRotation)
      },
      dispose() {
        if (disposed) return
        disposed = true
        if (pendingSeaRebuild) {
          clearTimeout(pendingSeaRebuild)
          pendingSeaRebuild = undefined
        }
        resize?.disconnect()
        engine.stopRenderLoop()
        camera.detachControl()
        scene.dispose()
        engine.dispose()
      },
    }
  } catch (error) {
    resize?.disconnect()
    engine.dispose()
    throw error
  }
}
