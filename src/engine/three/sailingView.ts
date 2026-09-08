import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  PerspectiveCamera,
  PCFSoftShadowMap,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import type { VesselState } from '../../game/sailing/sailing'
import { instantiateModel } from '../assets/modelAssets'
import { createShip, disposeShip } from './ship'
import { createAtmosphere } from './environment/atmosphere'
import { advanceDay, daylightAt } from './environment/dayCycle'
import { createIsland } from './environment/island'
import { createOcean } from './environment/ocean'
import { sampleShipMotion, SHIP_DRAFT } from './environment/shipMotion'
import { createWake } from './environment/wake'
import { createNightLights } from './environment/nightLights'
import { createStorm } from './environment/storm'
import { waveScaleForWind } from './environment/waves'
import { createFoamField } from './environment/foamField'

// Visual compression only. Geographic position remains authoritative in the game.
const VISUAL_METRES_PER_METRE = 0.003
const rad = Math.PI / 180
export interface GraphicsSettings {
  renderScale: number
  fpsLimit: 30 | 45 | 60
  shadows: 'off' | 'low' | 'medium' | 'high'
  reflection: 'off' | 'low' | 'high'
  waveDetail: 'low' | 'medium' | 'high'
  foam: boolean
  wakeStrength: number
  wakeTurbulence: number
  bowFoamStrength: number
  bowFoamWidth: number
  foamLifetime: number
  vegetationAnimation: boolean
  stormEffects: boolean
}
export function createSailingView(
  host: HTMLElement,
  getState: () => {
    vessel: VesselState
    paused: boolean
    docked: boolean
    skySpeed: number
    windSpeed: number
    windHeading: number
    graphics: GraphicsSettings
  },
  onAssetState?: (state: 'loading' | 'ready' | 'fallback') => void,
  onSkyTime?: (hour: number) => void,
  onPerformance?: (fps: number) => void,
) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false })
  let graphics = getState().graphics
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * graphics.renderScale)
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFSoftShadowMap
  renderer.domElement.setAttribute('aria-label', '可操控的三维帆船与动态海面')
  renderer.domElement.setAttribute('role', 'img')
  renderer.domElement.style.touchAction = 'none'
  renderer.domElement.style.cursor = 'grab'
  host.append(renderer.domElement)
  const scene = new Scene()
  const fog = new Fog('#a1c5da', 400, 1300)
  scene.fog = fog
  const camera = new PerspectiveCamera(48, 1, 0.5, 3000)
  const hemisphere = new HemisphereLight('#c3e4ff', '#494839', 1.6)
  scene.add(hemisphere)
  const sunDirection = new Vector3()
  const moonDirection = new Vector3()
  const sunlight = new DirectionalLight('#fff0ce', 3)
  sunlight.castShadow = true
  sunlight.shadow.mapSize.set(2048, 2048)
  Object.assign(sunlight.shadow.camera, {
    left: -200,
    right: 200,
    top: 200,
    bottom: -200,
    near: 1,
    far: 1100,
  })
  sunlight.shadow.camera.updateProjectionMatrix()
  sunlight.shadow.normalBias = 0.09
  sunlight.shadow.bias = -0.00015
  const moonlight = new DirectionalLight('#95baff', 0.3)
  scene.add(sunlight, sunlight.target, moonlight)
  const sky = createAtmosphere(sunDirection, moonDirection)
  scene.add(sky)
  const island = createIsland()
  const islandAnchor = new Vector2(-60, 255)
  island.group.position.set(islandAnchor.x, 0, islandAnchor.y)
  scene.add(island.group)
  const dayFog = new Color('#a1c5da'),
    nightFog = new Color('#16273f')
  const sunsetFog = new Color('#b97a61'),
    warmSun = new Color('#ff9e52')
  const noonSun = new Color('#fff3da')
  const stormFog = new Color('#334a50')
  let skyHour = 15
  let skyPublishElapsed = 0
  onSkyTime?.(skyHour)
  const ship = new Group()
  const fallbackShip = createShip()
  ship.add(fallbackShip)
  scene.add(ship)
  let sails = fallbackShip.children.filter((object) => object.name === 'sail')
  let fallbackAttached = true
  onAssetState?.('loading')
  void instantiateModel('ship.player.caravel').then(
    (model) => {
      if (disposed) return
      ship.add(model)
      ship.remove(fallbackShip)
      disposeShip(fallbackShip)
      fallbackAttached = false
      sails = []
      onAssetState?.('ready')
    },
    (error: unknown) => {
      console.warn('Could not load the caravel asset; using the procedural fallback.', error)
      if (!disposed) onAssetState?.('fallback')
    },
  )
  const { ocean, material: oceanMaterial } = createOcean(sunDirection, moonDirection)
  const reflectionRender = ocean.onBeforeRender
  const nightLights = createNightLights(ship, island.group)
  oceanMaterial.uniforms.nightLights!.value = nightLights.positions
  scene.add(ocean)
  const storm = createStorm()
  scene.add(storm.rain, storm.spray)
  const wake = createWake()
  scene.add(wake.spray)
  const foamField = createFoamField()
  ship.position.y = -SHIP_DRAFT
  const initial = getState().vessel
  const origin = { longitude: initial.longitude, latitude: initial.latitude }
  const position = new Vector2()
  const target = new Vector2()
  let heading = initial.heading * rad
  let orbitAzimuth = -0.44
  let orbitElevation = 0.22
  let orbitDistance = 105
  let targetAzimuth = orbitAzimuth
  let targetElevation = orbitElevation
  let targetDistance = orbitDistance
  let draggingPointer: number | undefined
  let pointerX = 0
  let pointerY = 0
  let time = 0
  let previous = 0
  let performanceStarted = 0
  let performanceFrames = 0
  let active = true
  let disposed = false
  function applyGraphics(next: GraphicsSettings) {
    graphics = next
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * next.renderScale)
    renderer.shadowMap.enabled = next.shadows !== 'off'
    sunlight.castShadow = next.shadows !== 'off'
    const shadowSize = { off: 512, low: 512, medium: 1024, high: 2048 }[next.shadows]
    if (sunlight.shadow.mapSize.x !== shadowSize) {
      sunlight.shadow.mapSize.set(shadowSize, shadowSize)
      sunlight.shadow.map?.dispose()
      sunlight.shadow.map = null
    }
    ocean.onBeforeRender = next.reflection === 'off' ? () => undefined : reflectionRender
    oceanMaterial.uniforms.reflectionStrength!.value =
      next.reflection === 'off' ? 0 : next.reflection === 'low' ? 0.55 : 1
    oceanMaterial.uniforms.detailLevel!.value = { low: 0, medium: 0.5, high: 1 }[next.waveDetail]
    oceanMaterial.uniforms.foamEnabled!.value = next.foam ? 1 : 0
    resize()
  }
  function resize() {
    if (disposed || !host.clientWidth || !host.clientHeight) return
    renderer.setSize(host.clientWidth, host.clientHeight)
    camera.aspect = host.clientWidth / host.clientHeight
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()

  function resetCamera() {
    targetAzimuth = -0.44
    targetElevation = 0.22
    targetDistance = 105
  }
  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return
    draggingPointer = event.pointerId
    pointerX = event.clientX
    pointerY = event.clientY
    renderer.domElement.setPointerCapture(event.pointerId)
    renderer.domElement.style.cursor = 'grabbing'
  }
  function pointerMove(event: PointerEvent) {
    if (draggingPointer !== event.pointerId) return
    const deltaX = event.clientX - pointerX
    const deltaY = event.clientY - pointerY
    pointerX = event.clientX
    pointerY = event.clientY
    targetAzimuth -= deltaX * 0.007
    targetElevation = Math.min(1.38, Math.max(0.08, targetElevation + deltaY * 0.006))
  }
  function pointerUp(event: PointerEvent) {
    if (draggingPointer !== event.pointerId) return
    draggingPointer = undefined
    if (renderer.domElement.hasPointerCapture(event.pointerId))
      renderer.domElement.releasePointerCapture(event.pointerId)
    renderer.domElement.style.cursor = 'grab'
  }
  function zoom(event: WheelEvent) {
    event.preventDefault()
    targetDistance = Math.min(185, Math.max(46, targetDistance * Math.exp(event.deltaY * 0.0012)))
  }
  renderer.domElement.addEventListener('pointerdown', pointerDown)
  renderer.domElement.addEventListener('pointermove', pointerMove)
  renderer.domElement.addEventListener('pointerup', pointerUp)
  renderer.domElement.addEventListener('pointercancel', pointerUp)
  renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault())
  renderer.domElement.addEventListener('wheel', zoom, { passive: false })
  renderer.domElement.addEventListener('dblclick', resetCamera)

  renderer.setAnimationLoop((now) => {
    if (!active || document.hidden) {
      previous = 0
      return
    }
    if (previous && now - previous < 1000 / graphics.fpsLimit - 1) return
    const delta = Math.min(previous ? (now - previous) / 1000 : 0, 0.1)
    previous = now
    const { vessel, paused, docked, skySpeed, windSpeed, windHeading } = getState()
    const dt = paused ? 0 : delta
    time += dt
    if (graphics.vegetationAnimation) island.update(time)
    skyHour = advanceDay(skyHour, dt, skySpeed)
    skyPublishElapsed += delta
    if (skyPublishElapsed >= 0.15) {
      onSkyTime?.(skyHour)
      skyPublishElapsed = 0
    }
    const { phase, daylight } = daylightAt(skyHour)
    sunDirection.set(Math.cos(phase) * 0.32, Math.sin(phase), Math.cos(phase) * -0.95).normalize()
    moonDirection.copy(sunDirection).negate()
    sunlight.intensity = 3.2 * Math.max(0, sunDirection.y) ** 0.45
    sunlight.color.copy(warmSun).lerp(noonSun, Math.min(1, Math.max(0, sunDirection.y) * 2.5))
    moonlight.position.copy(moonDirection).multiplyScalar(500)
    moonlight.intensity = (1 - daylight) * 0.85
    hemisphere.intensity = 0.38 + daylight * 1.31
    hemisphere.color.setRGB(0.24 + daylight * 0.38, 0.34 + daylight * 0.4, 0.58 + daylight * 0.32)
    hemisphere.groundColor.setRGB(
      0.025 + daylight * 0.1,
      0.035 + daylight * 0.095,
      0.05 + daylight * 0.025,
    )
    fog.color.copy(nightFog).lerp(dayFog, daylight)
    fog.color.lerp(sunsetFog, daylight * Math.max(0, 1 - Math.abs(sunDirection.y) * 3.5) * 0.65)
    const stormStrength = storm.update(
      time,
      windSpeed,
      windHeading,
      graphics.stormEffects,
      graphics.foam,
      { low: 0.3, medium: 0.62, high: 1 }[graphics.waveDetail],
      position.x,
      position.y,
      daylight,
      camera.position.x,
      camera.position.z,
    )
    fog.color.lerp(stormFog, stormStrength * 0.72)
    fog.near = 400 - stormStrength * 290
    fog.far = 1300 - stormStrength * 820
    renderer.toneMappingExposure = 1.05 + (1 - daylight) * 0.25 - stormStrength * 0.18
    sky.material.uniforms.daylight!.value = daylight
    sky.material.uniforms.time!.value = time
    oceanMaterial.uniforms.daylight!.value = daylight
    const lonDelta = ((vessel.longitude - origin.longitude + 540) % 360) - 180
    target.set(
      lonDelta * 111320 * Math.cos(origin.latitude * rad) * VISUAL_METRES_PER_METRE,
      -(vessel.latitude - origin.latitude) * 111320 * VISUAL_METRES_PER_METRE,
    )
    const interpolation = 1 - Math.exp(-delta * 12)
    position.lerp(target, interpolation)
    island.group.position.set(islandAnchor.x - position.x, 0, islandAnchor.y - position.y)
    oceanMaterial.uniforms.islandCenter!.value.set(island.group.position.x, island.group.position.z)
    sunlight.target.position.set(island.group.position.x * 0.4, 0, island.group.position.z * 0.4)
    sunlight.position.copy(sunDirection).multiplyScalar(500).add(sunlight.target.position)

    const angle = Math.atan2(
      Math.sin(vessel.heading * rad - heading),
      Math.cos(vessel.heading * rad - heading),
    )
    heading += angle * interpolation
    const cameraInterpolation = 1 - Math.exp(-delta * 9)
    orbitAzimuth +=
      Math.atan2(Math.sin(targetAzimuth - orbitAzimuth), Math.cos(targetAzimuth - orbitAzimuth)) *
      cameraInterpolation
    orbitElevation += (targetElevation - orbitElevation) * cameraInterpolation
    orbitDistance += (targetDistance - orbitDistance) * cameraInterpolation
    const waveScale = waveScaleForWind(windSpeed)
    const seaViolence = Math.min(1, Math.max(0, (windSpeed - 12) / 18))
    oceanMaterial.uniforms.waveScale!.value = waveScale
    oceanMaterial.uniforms.windAngle!.value = windHeading * rad
    oceanMaterial.uniforms.waveChoppiness!.value = 0.2 + seaViolence * 1.05
    const motion = sampleShipMotion(position.x, position.y, heading, time, waveScale, windHeading)
    const buoyancy = 1 - Math.exp(-dt * 4)
    ship.rotation.order = 'YXZ'
    ship.rotation.y = -heading
    ship.rotation.x += (motion.pitch - ship.rotation.x) * buoyancy
    ship.rotation.z += (motion.roll - ship.rotation.z) * buoyancy
    ship.position.y += (motion.height - ship.position.y) * buoyancy
    nightLights.update(time, daylight)
    sails.forEach((sail) => {
      sail.scale.y = 0.2 + vessel.sail * 0.8
    })
    const cameraAngle = heading + orbitAzimuth
    const horizontalDistance = Math.cos(orbitElevation) * orbitDistance
    camera.position.set(
      -Math.sin(cameraAngle) * horizontalDistance,
      8 + Math.sin(orbitElevation) * orbitDistance,
      Math.cos(cameraAngle) * horizontalDistance,
    )
    camera.lookAt(0, 8 + Math.min(5, orbitDistance * 0.035), 0)
    oceanMaterial.uniforms.time!.value = time
    oceanMaterial.uniforms.offset!.value.set(position.x, position.y)
    wake.update(
      position.x,
      position.y,
      heading,
      vessel.speed,
      time,
      daylight,
      docked,
      waveScale,
      windHeading,
      graphics.foam,
      { low: 0.35, medium: 0.65, high: 1 }[graphics.waveDetail],
      graphics.wakeStrength,
      graphics.wakeTurbulence,
    )
    foamField.update(
      renderer,
      position.x,
      position.y,
      heading,
      vessel.speed,
      dt,
      time,
      wake.getHistory(),
      graphics.foam,
      graphics.wakeStrength,
      graphics.bowFoamStrength,
      graphics.bowFoamWidth,
      graphics.foamLifetime,
      graphics.wakeTurbulence,
    )
    oceanMaterial.uniforms.vesselFoam!.value = foamField.texture
    oceanMaterial.uniforms.vesselFoamCenter!.value.copy(foamField.center)
    oceanMaterial.uniforms.vesselFoamSize!.value = foamField.size
    renderer.render(scene, camera)
    performanceFrames++
    if (!performanceStarted) performanceStarted = now
    if (now - performanceStarted >= 500) {
      onPerformance?.((performanceFrames * 1000) / (now - performanceStarted))
      performanceStarted = now
      performanceFrames = 0
    }
  })
  return {
    setGraphics(next: GraphicsSettings) {
      applyGraphics(next)
    },
    setSkyHour(hour: number) {
      skyHour = ((hour % 24) + 24) % 24
      onSkyTime?.(skyHour)
    },
    setActive(value: boolean) {
      active = value
      previous = 0
      if (value) resize()
    },
    dispose() {
      disposed = true
      renderer.setAnimationLoop(null)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', pointerDown)
      renderer.domElement.removeEventListener('pointermove', pointerMove)
      renderer.domElement.removeEventListener('pointerup', pointerUp)
      renderer.domElement.removeEventListener('pointercancel', pointerUp)
      renderer.domElement.removeEventListener('wheel', zoom)
      renderer.domElement.removeEventListener('dblclick', resetCamera)
      if (fallbackAttached) disposeShip(fallbackShip)
      sunlight.shadow.map?.dispose()
      ocean.geometry.dispose()
      ocean.dispose()
      sky.geometry.dispose()
      sky.material.dispose()
      nightLights.dispose()
      storm.dispose()
      island.dispose()
      wake.dispose()
      foamField.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
