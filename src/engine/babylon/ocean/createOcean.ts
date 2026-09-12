import * as BABYLON from '@babylonjs/core'
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
 * 海面平面固定为 SEA_EXTENT × SEA_EXTENT 米，细分段数决定面片数量：
 * 面片数 = 段数²，顶点数 = (段数 + 1)²，单个面片边长 = SEA_EXTENT ÷ 段数。
 */
const SEA_EXTENT = 700
const SEA_SEGMENTS_MIN = 24
const SEA_SEGMENTS_MAX = 512
/**
 * 拖动细分滑杆时 input 事件远密于帧率，必须节流，否则一次拖动会重建上百次网格。
 * 实测单次重建在主线程上的最长掉帧（1440×880）：
 *   48 段 ≈ 0ms、190 段 ≈ 0ms、256 段 ≈ 6ms、384 段 ≈ 13ms、512 段 ≈ 22ms。
 * 低细分可以按帧率级别重建以保持跟手，高细分放慢节流间隔。
 */
const SEA_REBUILD_INTERVAL_LOW = 90
const SEA_REBUILD_INTERVAL_HIGH = 220
const SEA_REBUILD_HEAVY_SEGMENTS = 256

function createSeaMesh(scene: BABYLON.Scene, segments: number) {
  const cellSize = SEA_EXTENT / segments
  const side = segments + 1
  const positions = new Float32Array(side * side * 3)
  const half = SEA_EXTENT / 2
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      const index = (row * side + col) * 3
      positions[index] = col * cellSize - half
      positions[index + 1] = 0
      positions[index + 2] = row * cellSize - half
    }
  }
  // 每个格子的对角线方向按格号随机翻转，破坏规则格纹带来的对称感。
  const indices = new Uint32Array(segments * segments * 6)
  let cursor = 0
  for (let row = 0; row < segments; row += 1) {
    for (let col = 0; col < segments; col += 1) {
      const a = col + row * side
      const b = col + 1 + row * side
      const c = col + 1 + (row + 1) * side
      const d = col + (row + 1) * side
      if (seaCellHash(col, row) > 0.5) {
        indices[cursor] = a
        indices[cursor + 1] = b
        indices[cursor + 2] = d
        indices[cursor + 3] = b
        indices[cursor + 4] = c
        indices[cursor + 5] = d
      } else {
        indices[cursor] = a
        indices[cursor + 1] = b
        indices[cursor + 2] = c
        indices[cursor + 3] = a
        indices[cursor + 4] = c
        indices[cursor + 5] = d
      }
      cursor += 6
    }
  }
  const mesh = new BABYLON.Mesh('faceted-sea', scene)
  const vertexData = new BABYLON.VertexData()
  vertexData.positions = positions
  vertexData.indices = indices
  vertexData.applyToMesh(mesh, false)
  return mesh
}

/** 与着色器 oceanHash 同构的 CPU 版本，仅用于决定网格拓扑。 */
function seaCellHash(x: number, y: number) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return value - Math.floor(value)
}

function clampSeaSegments(value: number) {
  if (!Number.isFinite(value)) return SEA_SEGMENTS_MIN
  return Math.min(
    SEA_SEGMENTS_MAX,
    Math.max(SEA_SEGMENTS_MIN, Math.round(value)),
  )
}

function waveAmplitudes(settings: OceanSettings) {
  return new BABYLON.Vector3(
    Math.max(0.01, settings.largeVertical * settings.swellScale * 1.65),
    Math.max(0.01, settings.mediumVertical * settings.localScale * 1.15),
    Math.max(0.005, settings.smallVertical * settings.localScale * 0.5),
  )
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
      { diameter: 5, segments: 18 },
      scene,
    )
    moonDiscMaterial.fogEnabled = false
    moonDisc.material = moonDiscMaterial

    const oceanUniforms = [
      'world',
      'worldViewProjection',
      'cameraPosition',
      'sunDirection',
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
      'facetStrength',
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
      { attributes: ['position'], uniforms: oceanUniforms },
    )
    ocean.backFaceCulling = false
    let sea = createSeaMesh(scene, clampSeaSegments(initial.facetResolution))
    sea.material = ocean
    let seaSegments = clampSeaSegments(initial.facetResolution)

    const ship = createShip(scene)
    createCloud(scene, -38, 47, 145, 1.18)
    createCloud(scene, 34, 57, 188, 1.45)
    createCloud(scene, 2, 35, 118, 0.72)
    createCloud(scene, 88, 43, 210, 0.9)
    const cloudMaterials = scene.materials.filter((entry) =>
      entry.name.startsWith('cloud-'),
    ) as BABYLON.StandardMaterial[]
    ISLANDS.forEach((island) =>
      createIsland(scene, island.x, island.z, island.scale),
    )
    const wake = createWake(scene)
    wake.shader.setFloat('gridOffset', SEA_EXTENT / 2)

    let waveComponents = buildWaveComponents(initial)
    let settings = { ...initial }
    let previous = { ...initial }
    let clock = initial.timeOffset
    let last = performance.now()
    let disposed = false
    let pendingSeaRebuild: ReturnType<typeof setTimeout> | undefined
    let lastSeaRebuildAt = 0

    /** 用新的细分段数重建海面网格；先建后删，重建失败时保留旧网格。 */
    const rebuildSea = (segments: number) => {
      // cellSize 与网格必须同步更新，否则面片 ID 会和真实面片错位。
      // 尾迹泡沫也用同一套面片格，所以两边都要设。
      ocean.setFloat('cellSize', SEA_EXTENT / segments)
      wake.shader.setFloat('cellSize', SEA_EXTENT / segments)
      if (segments === seaSegments) return
      const previousMesh = sea
      sea = createSeaMesh(scene, segments)
      sea.material = ocean
      sea.position.y = previousMesh.position.y
      seaSegments = segments
      previousMesh.dispose()
    }

    /** 节流重建：窗口内连续改动合并为一次尾部重建，最终值一定会被应用。 */
    const scheduleSeaRebuild = (segments: number) => {
      const interval =
        segments > SEA_REBUILD_HEAVY_SEGMENTS
          ? SEA_REBUILD_INTERVAL_HIGH
          : SEA_REBUILD_INTERVAL_LOW
      const elapsed = performance.now() - lastSeaRebuildAt
      if (elapsed >= interval) {
        if (pendingSeaRebuild) {
          clearTimeout(pendingSeaRebuild)
          pendingSeaRebuild = undefined
        }
        lastSeaRebuildAt = performance.now()
        rebuildSea(segments)
        return
      }
      if (pendingSeaRebuild) clearTimeout(pendingSeaRebuild)
      pendingSeaRebuild = setTimeout(
        () => {
          pendingSeaRebuild = undefined
          lastSeaRebuildAt = performance.now()
          if (!disposed) rebuildSea(segments)
        },
        Math.max(0, interval - elapsed),
      )
    }

    const applySeaResolution = (next: OceanSettings, first: boolean) => {
      const segments = clampSeaSegments(next.facetResolution)
      if (first) {
        rebuildSea(segments)
        lastSeaRebuildAt = performance.now()
        return
      }
      scheduleSeaRebuild(segments)
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
      sea.position.y = next.seaLevel
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
      moonDisc.setEnabled(nightAmount > 0.15)
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
      ocean.setColor3(
        'highlightColor',
        BABYLON.Color3.Lerp(
          linearColor(next.highlightColor),
          linearColor('#bedcff'),
          nightAmount,
        ),
      )
      ocean.setColor3('sssColor', linearColor(next.sssColor))
      ocean.setColor3('fogColor', linearColor(next.fogColor))
      ocean.setFloat('facetStrength', next.facetStrength)
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
      ocean.setFloat('seaHalfExtent', SEA_EXTENT / 2)
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
      ocean.setVector3('sunDirection', sun.direction)
      wake.shader.setFloat('time', clock)
      sky.setFloat('time', clock)

      const shipHeight = sampleWave(waveComponents, 0, 10, clock)
      ship.position.y =
        settings.seaLevel +
        settings.buoyOffset +
        0.8 +
        (settings.buoyancy ? shipHeight * settings.heaveScale * 0.34 : 0)
      ship.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(
        Math.sin(clock * 0.22) * 0.018,
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
