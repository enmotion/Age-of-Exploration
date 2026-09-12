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

const waveUniforms = [
  'time',
  'waveDirection0',
  'waveDirection1',
  'waveDirection2',
  'waveLength',
  'waveAmplitude',
  'waveSpeed',
  'horizontalScale',
  'chop',
]

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

function direction(degrees: number) {
  const radians = BABYLON.Tools.ToRadians(degrees)
  return new BABYLON.Vector2(Math.cos(radians), Math.sin(radians))
}

function waveAmplitudes(settings: OceanSettings) {
  return new BABYLON.Vector3(
    Math.max(0.01, settings.largeVertical * settings.swellScale * 1.65),
    Math.max(0.01, settings.mediumVertical * settings.localScale * 1.15),
    Math.max(0.005, settings.smallVertical * settings.localScale * 0.5),
  )
}

function setWaveUniforms(
  target: BABYLON.ShaderMaterial,
  settings: OceanSettings,
) {
  target.setVector2('waveDirection0', direction(settings.swellDirection))
  target.setVector2('waveDirection1', direction(settings.windDirection))
  target.setVector2('waveDirection2', direction(settings.windDirection + 53))
  target.setVector3(
    'waveLength',
    new BABYLON.Vector3(
      Math.max(2, settings.largeLength),
      Math.max(1, settings.mediumLength),
      Math.max(0.4, settings.smallLength),
    ),
  )
  target.setVector3('waveAmplitude', waveAmplitudes(settings))
  target.setVector3(
    'waveSpeed',
    new BABYLON.Vector3(
      Math.max(0.04, settings.swellWind * 0.18),
      Math.max(0.06, settings.windSpeed * 0.34),
      Math.max(0.1, settings.windSpeed * 0.72),
    ),
  )
  target.setVector3(
    'horizontalScale',
    new BABYLON.Vector3(
      settings.largeHorizontal,
      settings.mediumHorizontal,
      settings.smallHorizontal,
    ),
  )
  target.setFloat('chop', settings.lambda)
}

function sampleWave(
  x: number,
  z: number,
  time: number,
  settings: OceanSettings,
) {
  const amplitudes = waveAmplitudes(settings)
  const waves = [
    {
      direction: direction(settings.swellDirection),
      length: Math.max(2, settings.largeLength),
      speed: Math.max(0.04, settings.swellWind * 0.18),
      amplitude: amplitudes.x,
      phase: 0,
    },
    {
      direction: direction(settings.windDirection),
      length: Math.max(1, settings.mediumLength),
      speed: Math.max(0.06, settings.windSpeed * 0.34),
      amplitude: amplitudes.y,
      phase: 1.73,
    },
    {
      direction: direction(settings.windDirection + 53),
      length: Math.max(0.4, settings.smallLength),
      speed: Math.max(0.1, settings.windSpeed * 0.72),
      amplitude: amplitudes.z,
      phase: 3.46,
    },
  ]
  return waves.reduce((height, wave) => {
    const phase =
      ((x * wave.direction.x + z * wave.direction.y) * Math.PI * 2) /
        wave.length +
      time * wave.speed +
      wave.phase
    return (
      height +
      (Math.sin(phase) +
        Math.sin(phase * 2.07 + 1.1) * 0.18 +
        Math.sin(phase * 3.91 - 0.6) * 0.07) *
        wave.amplitude
    )
  }, 0)
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

type WakeRibbon = {
  mesh: BABYLON.Mesh
  side: number
  progress: number[]
  outer: BABYLON.Vector3[]
  inner: BABYLON.Vector3[]
}

function createWakeRibbons(scene: BABYLON.Scene) {
  const foamMaterial = standardMaterial(scene, 'wake-ribbon-foam', '#fffaf0')
  foamMaterial.disableLighting = true
  foamMaterial.emissiveColor = new BABYLON.Color3(0.92, 1, 0.98)
  foamMaterial.alpha = 0.88
  foamMaterial.backFaceCulling = false
  const ribbons: WakeRibbon[] = []
  for (let side = -1; side <= 1; side += 2) {
    for (let segment = 0; segment < 11; segment += 1) {
      if (segment === 3 || segment === 7) continue
      const progress: number[] = []
      const outer: BABYLON.Vector3[] = []
      const inner: BABYLON.Vector3[] = []
      for (let point = 0; point < 5; point += 1) {
        const t = (segment + point / 4) / 11
        progress.push(t)
        outer.push(new BABYLON.Vector3(side * (1 + t * 8), 0.2, 8 - t * 72))
        inner.push(
          new BABYLON.Vector3(side * (0.6 + t * 7.3), 0.21, 8 - t * 72),
        )
      }
      const mesh = BABYLON.MeshBuilder.CreateRibbon(
        `wake-ribbon-${side}-${segment}`,
        { pathArray: [outer, inner], updatable: true },
        scene,
      )
      mesh.material = foamMaterial
      mesh.renderingGroupId = 2
      ribbons.push({ mesh, side, progress, outer, inner })
    }
  }
  return { ribbons, material: foamMaterial }
}

function updateWakeRibbons(
  wake: ReturnType<typeof createWakeRibbons>,
  settings: OceanSettings,
  time: number,
) {
  const wakeLength = Math.max(12, settings.wakeLifetime * 8)
  const angle = BABYLON.Tools.ToRadians(settings.wakeAngle) * 0.5
  for (const ribbon of wake.ribbons) {
    ribbon.progress.forEach((progress, index) => {
      const distance = progress * wakeLength
      const z = 8 - distance
      const arm =
        settings.wakeInitialWidth +
        distance * Math.tan(angle) * settings.wakeSpreadSpeed
      const flutter =
        Math.sin(progress * 47 + ribbon.side * 1.7) * (0.15 + progress * 0.75)
      const width = 0.5 + progress
      const y =
        settings.seaLevel +
        settings.wakeWaterOffset +
        sampleWave(ribbon.side * arm, z, time, settings)
      ribbon.outer[index]!.set(ribbon.side * arm + flutter, y, z)
      ribbon.inner[index]!.set(
        ribbon.side * (arm - width) + flutter,
        y + 0.015,
        z,
      )
    })
    BABYLON.MeshBuilder.CreateRibbon(ribbon.mesh.name, {
      pathArray: [ribbon.outer, ribbon.inner],
      instance: ribbon.mesh,
    })
  }
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
      'facetStrength',
      'detailNormalStrength',
      'normalScaleX',
      'normalScaleZ',
      'shadingContrast',
      'shadingBias',
      'toneSteps',
      'toneTransition',
      'colorPatches',
      'patchScale',
      'patchStrength',
      'patchSpeed',
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
      'glintAngle',
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
    const sea = BABYLON.MeshBuilder.CreateGround(
      'faceted-sea',
      { width: 700, height: 700, subdivisions: 190 },
      scene,
    )
    sea.material = ocean

    const ship = createShip(scene)
    createCloud(scene, -38, 47, 145, 1.18)
    createCloud(scene, 34, 57, 188, 1.45)
    createCloud(scene, 2, 35, 118, 0.72)
    createCloud(scene, 88, 43, 210, 0.9)
    const cloudMaterials = scene.materials.filter((entry) =>
      entry.name.startsWith('cloud-'),
    ) as BABYLON.StandardMaterial[]
    createIsland(scene, -58, 137, 0.72)
    createIsland(scene, 65, 170, 1.05)
    createIsland(scene, 43, 103, 0.5)
    createIsland(scene, -38, 92, 0.38)
    createIsland(scene, -44, 235, 2.15)
    const wake = createWake(scene)
    const wakeRibbons = createWakeRibbons(scene)

    let settings = { ...initial }
    let previous = { ...initial }
    let clock = initial.timeOffset
    let last = performance.now()
    let disposed = false

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
      sea.position.y = next.seaLevel
      wake.mesh.position.y = next.seaLevel
      ocean.wireframe = next.wireframe
      wake.mesh.setEnabled(next.wakeEnabled)
      wakeRibbons.ribbons.forEach((ribbon) =>
        ribbon.mesh.setEnabled(next.wakeEnabled),
      )

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

      setWaveUniforms(ocean, next)
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
      ocean.setFloat('detailNormalStrength', next.detailNormalStrength)
      ocean.setFloat('normalScaleX', next.normalScaleX)
      ocean.setFloat('normalScaleZ', next.normalScaleZ)
      ocean.setFloat('shadingContrast', next.shadingContrast)
      ocean.setFloat('shadingBias', next.shadingBias)
      ocean.setFloat('toneSteps', next.toneSteps)
      ocean.setFloat('toneTransition', next.toneTransition)
      ocean.setFloat('colorPatches', next.colorPatches ? 1 : 0)
      ocean.setFloat('patchScale', next.patchScale)
      ocean.setFloat('patchStrength', next.patchStrength)
      ocean.setVector2(
        'patchSpeed',
        new BABYLON.Vector2(next.patchSpeedX, next.patchSpeedZ),
      )
      ocean.setFloat('heightColorStrength', next.heightColorStrength)
      ocean.setFloat('heightColorBias', next.heightColorBias)
      ocean.setFloat('slopeColorStrength', next.slopeColorStrength)
      ocean.setFloat('slopeColorBias', next.slopeColorBias)
      ocean.setFloat('lightColorStrength', next.lightColorStrength)
      ocean.setFloat('saturation', next.saturation)
      ocean.setFloat('brightness', next.brightness * (1 - nightAmount * 0.6))
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
      ocean.setFloat('glintAngle', next.glintAngle)
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
      ocean.setFloat('stylized', next.stylized ? 1 : 0)

      setWaveUniforms(wake.shader, next)
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
      const wakeRibbonColor = BABYLON.Color3.FromHexString(next.wakeColor)
      wakeRibbons.material.diffuseColor.copyFrom(wakeRibbonColor)
      wakeRibbons.material.emissiveColor.copyFrom(
        wakeRibbonColor.scale(Math.max(0.2, next.wakeBrightness * 1.15)),
      )

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

      const shipHeight = sampleWave(0, 10, clock, settings)
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
      if (settings.wakeEnabled) updateWakeRibbons(wakeRibbons, settings, clock)
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
    canvas.dataset.activeControls = '73'
    canvas.dataset.inactiveControls = '0'

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
