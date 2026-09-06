import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PCFSoftShadowMap,
  PlaneGeometry,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  WebGLRenderer,
} from 'three'
import type { VesselState } from '../../game/sailing/sailing'
import { createShip, disposeShip } from './ship'

// Visual compression only. Geographic position remains authoritative in the game.
const VISUAL_METRES_PER_METRE = 0.003
const rad = Math.PI / 180
export function createSailingView(
  host: HTMLElement,
  getState: () => { vessel: VesselState; paused: boolean; docked: boolean },
) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.2
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFSoftShadowMap
  renderer.domElement.setAttribute('aria-label', '可操控的三维帆船与动态海面')
  renderer.domElement.setAttribute('role', 'img')
  host.append(renderer.domElement)
  const scene = new Scene()
  scene.background = new Color('#a8c9ca')
  scene.fog = new Fog('#a8c9ca', 220, 800)
  const camera = new PerspectiveCamera(42, 1, 0.5, 2000)
  scene.add(new AmbientLight('#d9f0ec', 2))
  const sunlight = new DirectionalLight('#ffe0a4', 3.6)
  sunlight.position.set(-80, 120, -100)
  sunlight.castShadow = true
  sunlight.shadow.mapSize.set(1024, 1024)
  Object.assign(sunlight.shadow.camera, {
    left: -40,
    right: 40,
    top: 40,
    bottom: -40,
    near: 1,
    far: 300,
  })
  sunlight.shadow.normalBias = 0.15
  scene.add(sunlight)
  const sun = new Mesh(
    new SphereGeometry(20, 24, 16),
    new MeshBasicMaterial({ color: '#fff1c6', fog: false }),
  )
  sun.position.set(-320, 110, -650)
  scene.add(sun)
  const ship = createShip()
  scene.add(ship)
  const sails = ship.children.filter((object) => object.name === 'sail')
  const oceanMaterial = new ShaderMaterial({
    uniforms: { time: { value: 0 }, offset: { value: new Vector2() } },
    vertexShader: `
      uniform float time;
      uniform vec2 offset;
      varying vec3 vWorld;
      varying float vWave;
      void main() {
        vec3 p = position;
        vec2 w = p.xy + offset;
        vWave = sin(w.x * .065 + time * 1.4) * .55 + sin(w.y * .09 + w.x * .02 + time) * .4;
        p.z += vWave;
        vec4 world = modelMatrix * vec4(p, 1.);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform float time;
      uniform vec2 offset;
      varying vec3 vWorld;
      varying float vWave;
      void main() {
        vec2 p = vWorld.xz + vec2(offset.x, -offset.y);
        float lines = sin(p.x * .36 + sin(p.y * .11 + time) * 1.7 + time * 1.3);
        float flecks = pow(max(0., lines), 28.) * pow(max(0., sin(p.y * .48 - time * .8)), 8.);
        vec3 color = mix(vec3(.035, .23, .28), vec3(.12, .46, .46), .5 + vWave * .35);
        color += vec3(.72, .85, .74) * flecks * .5;
        float horizon = smoothstep(180., 750., length(vWorld.xz));
        gl_FragColor = vec4(mix(color, vec3(.66, .79, .79), horizon), 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  const ocean = new Mesh(new PlaneGeometry(2000, 2000, 160, 160), oceanMaterial)
  ocean.rotation.x = -Math.PI / 2
  scene.add(ocean)
  const wakeGeometry = new RingGeometry(0.72, 1, 24)
  const wake = Array.from({ length: 48 }, () => {
    const material = new MeshBasicMaterial({
      color: '#e1f7e9',
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    const mesh = new Mesh(wakeGeometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.visible = false
    scene.add(mesh)
    return { mesh, x: 0, z: 0, age: 100 }
  })
  const initial = getState().vessel
  const origin = { longitude: initial.longitude, latitude: initial.latitude }
  const position = new Vector2()
  const target = new Vector2()
  let heading = initial.heading * rad
  let cameraHeading = heading
  let time = 0
  let previous = 0
  let wakeElapsed = 0
  let wakeIndex = 0
  let active = true
  let disposed = false
  function resize() {
    if (disposed || !host.clientWidth || !host.clientHeight) return
    renderer.setSize(host.clientWidth, host.clientHeight)
    camera.aspect = host.clientWidth / host.clientHeight
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()

  renderer.setAnimationLoop((now) => {
    if (!active || document.hidden) {
      previous = 0
      return
    }
    if (previous && now - previous < 1000 / 60 - 1) return
    const delta = Math.min(previous ? (now - previous) / 1000 : 0, 0.1)
    previous = now
    const { vessel, paused, docked } = getState()
    const dt = paused ? 0 : delta
    time += dt
    const lonDelta = ((vessel.longitude - origin.longitude + 540) % 360) - 180
    target.set(
      lonDelta * 111320 * Math.cos(origin.latitude * rad) * VISUAL_METRES_PER_METRE,
      -(vessel.latitude - origin.latitude) * 111320 * VISUAL_METRES_PER_METRE,
    )
    const interpolation = 1 - Math.exp(-delta * 12)
    position.lerp(target, interpolation)
    const angle = Math.atan2(
      Math.sin(vessel.heading * rad - heading),
      Math.cos(vessel.heading * rad - heading),
    )
    heading += angle * interpolation
    cameraHeading +=
      Math.atan2(Math.sin(heading - cameraHeading), Math.cos(heading - cameraHeading)) *
      (1 - Math.exp(-delta * 0.65))
    ship.rotation.set(Math.sin(time * 1.2) * 0.025, -heading, Math.cos(time * 1.5) * 0.035)
    ship.position.y = Math.sin(time * 1.3) * 0.28
    sails.forEach((sail) => {
      sail.scale.y = 0.2 + vessel.sail * 0.8
    })
    camera.position.set(
      -Math.sin(cameraHeading) * 76 + Math.cos(cameraHeading) * 37,
      43,
      Math.cos(cameraHeading) * 76 + Math.sin(cameraHeading) * 37,
    )
    camera.lookAt(0, 8, 0)
    oceanMaterial.uniforms.time!.value = time
    oceanMaterial.uniforms.offset!.value.set(position.x, -position.y)
    wakeElapsed += dt
    if (!docked && vessel.speed > 0.3 && wakeElapsed > 0.09) {
      const item = wake[wakeIndex++ % wake.length]!
      item.x = position.x - Math.sin(heading) * 14
      item.z = position.y + Math.cos(heading) * 14
      item.age = 0
      wakeElapsed = 0
    }
    for (const item of wake) {
      if (docked) item.age = 100
      item.age += dt
      item.mesh.visible = item.age < 4.3
      item.mesh.position.set(item.x - position.x, 1, item.z - position.y)
      item.mesh.scale.set(3 + item.age * 3, 1.8 + item.age * 2, 1)
      item.mesh.material.opacity = Math.max(0, 0.33 * (1 - item.age / 4.3))
    }
    renderer.render(scene, camera)
  })
  return {
    setActive(value: boolean) {
      active = value
      previous = 0
      if (value) resize()
    },
    dispose() {
      disposed = true
      renderer.setAnimationLoop(null)
      observer.disconnect()
      disposeShip(ship)
      sunlight.shadow.map?.dispose()
      ocean.geometry.dispose()
      oceanMaterial.dispose()
      sun.geometry.dispose()
      sun.material.dispose()
      wakeGeometry.dispose()
      wake.forEach((item) => item.mesh.material.dispose())
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
