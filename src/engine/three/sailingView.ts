import {
  ACESFilmicToneMapping,
  AmbientLight,
  BackSide,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PCFSoftShadowMap,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
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
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFSoftShadowMap
  renderer.domElement.setAttribute('aria-label', '可操控的三维帆船与动态海面')
  renderer.domElement.setAttribute('role', 'img')
  renderer.domElement.style.touchAction = 'none'
  renderer.domElement.style.cursor = 'grab'
  host.append(renderer.domElement)
  const scene = new Scene()
  scene.background = new Color('#9bbdc0')
  scene.fog = new Fog('#9bbdc0', 420, 1050)
  const camera = new PerspectiveCamera(42, 1, 0.5, 2000)
  scene.add(new AmbientLight('#b8d0d0', 0.18))
  scene.add(new HemisphereLight('#b9dce5', '#172722', 1.25))
  const sunDirection = new Vector3(-0.42, 0.53, -0.74).normalize()
  const sunlight = new DirectionalLight('#ffd79b', 4.8)
  sunlight.position.copy(sunDirection).multiplyScalar(190)
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
  sunlight.shadow.camera.updateProjectionMatrix()
  sunlight.shadow.normalBias = 0.15
  scene.add(sunlight)
  const skyMaterial = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: { sunDirection: { value: sunDirection } },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 sunDirection;
      varying vec3 vDirection;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
      }
      void main() {
        float height = clamp(vDirection.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 horizon = vec3(0.71, 0.79, 0.76);
        vec3 zenith = vec3(0.17, 0.39, 0.49);
        vec3 color = mix(horizon, zenith, pow(height, 0.72));
        float sunDot = max(dot(normalize(vDirection), sunDirection), 0.0);
        color += vec3(1.0, 0.67, 0.30) * pow(sunDot, 420.0) * 7.0;
        color += vec3(1.0, 0.55, 0.24) * pow(sunDot, 9.0) * 0.24;
        vec2 cloudUv = vDirection.xz / max(0.12, vDirection.y + 0.32) * 2.1;
        float cloud = noise(cloudUv) * 0.62 + noise(cloudUv * 2.1 + 4.0) * 0.38;
        cloud = smoothstep(0.59, 0.76, cloud) * smoothstep(-0.02, 0.3, vDirection.y);
        color = mix(color, vec3(0.88, 0.89, 0.82), cloud * 0.35);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  const sky = new Mesh(new SphereGeometry(1200, 36, 18), skyMaterial)
  scene.add(sky)
  const ship = createShip()
  scene.add(ship)
  const sails = ship.children.filter((object) => object.name === 'sail')
  const oceanMaterial = new ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      offset: { value: new Vector2() },
      sunDirection: { value: sunDirection },
      deepColor: { value: new Color('#062d3b') },
      midColor: { value: new Color('#0d5964') },
      skyColor: { value: new Color('#8fb4b5') },
      sunColor: { value: new Color('#ffd28a') },
    },
    vertexShader: `
      uniform float time;
      uniform vec2 offset;
      varying vec3 vWorld;
      varying vec3 vWaveNormal;
      varying float vHeight;

      void gerstner(
        vec2 samplePoint,
        vec2 direction,
        float frequency,
        float amplitude,
        float speed,
        float steepness,
        inout vec3 displaced,
        inout vec2 slope
      ) {
        direction = normalize(direction);
        float phase = dot(samplePoint, direction) * frequency + time * speed;
        displaced.xy += direction * cos(phase) * amplitude * steepness;
        displaced.z += sin(phase) * amplitude;
        slope += direction * cos(phase) * frequency * amplitude;
      }
      void main() {
        vec3 p = position;
        vec2 w = p.xy + offset;
        vec2 slope = vec2(0.0);
        gerstner(w, vec2(1.0, 0.28), 0.028, 1.24, 0.72, 0.48, p, slope);
        gerstner(w, vec2(-0.24, 1.0), 0.047, 0.73, 0.91, 0.40, p, slope);
        gerstner(w, vec2(0.76, -0.55), 0.083, 0.36, 1.22, 0.32, p, slope);
        gerstner(w, vec2(-0.86, -0.21), 0.145, 0.16, 1.68, 0.22, p, slope);
        gerstner(w, vec2(0.18, 1.0), 0.255, 0.055, 2.35, 0.10, p, slope);
        vHeight = p.z;
        vec3 localNormal = normalize(vec3(-slope.x, -slope.y, 1.0));
        vWaveNormal = normalize(mat3(modelMatrix) * localNormal);
        vec4 world = modelMatrix * vec4(p, 1.);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform float time;
      uniform vec2 offset;
      uniform vec3 sunDirection;
      uniform vec3 deepColor;
      uniform vec3 midColor;
      uniform vec3 skyColor;
      uniform vec3 sunColor;
      varying vec3 vWorld;
      varying vec3 vWaveNormal;
      varying float vHeight;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
      }
      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        mat2 rotation = mat2(0.80, -0.60, 0.60, 0.80);
        for (int i = 0; i < 4; i++) {
          value += amplitude * noise(p);
          p = rotation * p * 2.03 + 9.17;
          amplitude *= 0.5;
        }
        return value;
      }
      void main() {
        vec2 p = vWorld.xz + offset;
        float microA = fbm(p * 0.095 + vec2(time * 0.07, -time * 0.11));
        float microB = fbm((p + vec2(1.7, -2.9)) * 0.095 + vec2(time * 0.07, -time * 0.11));
        vec3 normal = normalize(vWaveNormal + vec3((microA - 0.5) * 0.18, 0.0, (microB - 0.5) * 0.18));
        vec3 viewDirection = normalize(cameraPosition - vWorld);
        vec3 halfDirection = normalize(viewDirection + sunDirection);
        float facing = clamp(dot(normal, viewDirection), 0.0, 1.0);
        float fresnel = 0.018 + 0.982 * pow(1.0 - facing, 5.0);
        float diffuse = clamp(dot(normal, sunDirection) * 0.5 + 0.5, 0.0, 1.0);
        float roughnessNoise = mix(0.68, 1.0, microA);
        float specular = pow(max(dot(normal, halfDirection), 0.0), 210.0 * roughnessNoise);
        float broadSpecular = pow(max(dot(normal, halfDirection), 0.0), 26.0) * 0.11;
        float trough = clamp(vHeight * 0.11 + diffuse * 0.30 + 0.38, 0.0, 1.0);
        vec3 water = mix(deepColor, midColor, trough);
        vec3 reflectedSky = mix(vec3(0.10, 0.29, 0.36), skyColor, clamp(normal.y * 0.67, 0.0, 1.0));
        vec3 color = mix(water, reflectedSky, fresnel * 0.48);
        color += sunColor * (specular * 3.6 + broadSpecular);
        float backLight = pow(max(dot(viewDirection, -sunDirection), 0.0), 3.0);
        color += vec3(0.02, 0.24, 0.20) * backLight * (1.0 - normal.y) * 0.42;
        float crestNoise = fbm(p * 0.08 + vec2(time * 0.08, -time * 0.055));
        float steep = 1.0 - normal.y;
        float foam = smoothstep(1.14, 1.72, vHeight + crestNoise * 0.48 + steep * 2.1);
        float brokenFoam = smoothstep(0.46, 0.72, fbm(p * 0.22 - time * 0.035));
        foam *= mix(0.38, 1.0, brokenFoam);
        color = mix(color, vec3(0.72, 0.87, 0.82), foam * 0.72);
        float distanceToCamera = length(cameraPosition - vWorld);
        float horizonFog = 1.0 - exp(-distanceToCamera * distanceToCamera * 0.0000019);
        color = mix(color, skyColor, clamp(horizonFog, 0.0, 0.88));
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  const ocean = new Mesh(new PlaneGeometry(2200, 2200, 190, 190), oceanMaterial)
  ocean.rotation.x = -Math.PI / 2
  scene.add(ocean)
  const wakeCanvas = document.createElement('canvas')
  wakeCanvas.width = 128
  wakeCanvas.height = 128
  const wakeContext = wakeCanvas.getContext('2d')
  if (!wakeContext) throw new Error('Canvas 2D is required for the wake texture')
  wakeContext.clearRect(0, 0, 128, 128)
  const wakeGradient = wakeContext.createRadialGradient(64, 64, 5, 64, 64, 58)
  wakeGradient.addColorStop(0, 'rgba(235,255,248,.8)')
  wakeGradient.addColorStop(0.3, 'rgba(220,248,241,.45)')
  wakeGradient.addColorStop(0.72, 'rgba(205,240,235,.14)')
  wakeGradient.addColorStop(1, 'rgba(205,240,235,0)')
  wakeContext.fillStyle = wakeGradient
  wakeContext.fillRect(0, 0, 128, 128)
  wakeContext.globalCompositeOperation = 'destination-out'
  wakeContext.beginPath()
  wakeContext.ellipse(64, 64, 23, 16, 0, 0, Math.PI * 2)
  wakeContext.fill()
  const wakeTexture = new CanvasTexture(wakeCanvas)
  const wakeGeometry = new PlaneGeometry(1, 1)
  const bowFoamMaterial = new MeshBasicMaterial({
    color: '#ddf2ec',
    map: wakeTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })
  const bowFoam = new Mesh(wakeGeometry, bowFoamMaterial)
  bowFoam.rotation.x = -Math.PI / 2
  bowFoam.scale.set(9, 4, 1)
  scene.add(bowFoam)
  const wake = Array.from({ length: 48 }, () => {
    const material = new MeshBasicMaterial({
      color: '#e1f7e9',
      map: wakeTexture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    const mesh = new Mesh(wakeGeometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.visible = false
    scene.add(mesh)
    return { mesh, x: 0, z: 0, age: 100, phase: 0 }
  })
  const initial = getState().vessel
  const origin = { longitude: initial.longitude, latitude: initial.latitude }
  const position = new Vector2()
  const target = new Vector2()
  let heading = initial.heading * rad
  let orbitAzimuth = -0.44
  let orbitElevation = 0.42
  let orbitDistance = 92
  let targetAzimuth = orbitAzimuth
  let targetElevation = orbitElevation
  let targetDistance = orbitDistance
  let draggingPointer: number | undefined
  let pointerX = 0
  let pointerY = 0
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

  function resetCamera() {
    targetAzimuth = -0.44
    targetElevation = 0.42
    targetDistance = 92
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
    const cameraInterpolation = 1 - Math.exp(-delta * 9)
    orbitAzimuth +=
      Math.atan2(Math.sin(targetAzimuth - orbitAzimuth), Math.cos(targetAzimuth - orbitAzimuth)) *
      cameraInterpolation
    orbitElevation += (targetElevation - orbitElevation) * cameraInterpolation
    orbitDistance += (targetDistance - orbitDistance) * cameraInterpolation
    ship.rotation.set(Math.sin(time * 1.2) * 0.025, -heading, Math.cos(time * 1.5) * 0.035)
    ship.position.y = Math.sin(time * 1.3) * 0.28
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
    oceanMaterial.uniforms.offset!.value.set(position.x, -position.y)
    bowFoam.position.set(Math.sin(heading) * 13, 1.06, -Math.cos(heading) * 13)
    bowFoam.rotation.z = heading
    bowFoamMaterial.opacity = docked ? 0 : Math.min(0.48, vessel.speed * 0.055)
    wakeElapsed += dt
    if (!docked && vessel.speed > 0.3 && wakeElapsed > 0.09) {
      const item = wake[wakeIndex++ % wake.length]!
      item.x = position.x - Math.sin(heading) * 14
      item.z = position.y + Math.cos(heading) * 14
      item.phase = wakeIndex * 1.618
      item.age = 0
      wakeElapsed = 0
    }
    for (const item of wake) {
      if (docked) item.age = 100
      item.age += dt
      item.mesh.visible = item.age < 4.3
      const spread = Math.sin(item.phase) * item.age * 0.75
      item.mesh.position.set(
        item.x - position.x + Math.cos(heading) * spread,
        1.05,
        item.z - position.y + Math.sin(heading) * spread,
      )
      item.mesh.rotation.z = heading
      item.mesh.scale.set(4 + item.age * 3.8, 2.2 + item.age * 2.4, 1)
      item.mesh.material.opacity = Math.max(0, 0.42 * (1 - item.age / 4.3))
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
      renderer.domElement.removeEventListener('pointerdown', pointerDown)
      renderer.domElement.removeEventListener('pointermove', pointerMove)
      renderer.domElement.removeEventListener('pointerup', pointerUp)
      renderer.domElement.removeEventListener('pointercancel', pointerUp)
      renderer.domElement.removeEventListener('wheel', zoom)
      renderer.domElement.removeEventListener('dblclick', resetCamera)
      disposeShip(ship)
      sunlight.shadow.map?.dispose()
      ocean.geometry.dispose()
      oceanMaterial.dispose()
      sky.geometry.dispose()
      skyMaterial.dispose()
      wakeGeometry.dispose()
      wakeTexture.dispose()
      bowFoamMaterial.dispose()
      wake.forEach((item) => item.mesh.material.dispose())
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
