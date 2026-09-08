import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  Points,
  ShaderMaterial,
} from 'three'
import { oceanHeight } from './waves'

export interface WakePoint {
  x: number
  z: number
  heading: number
  born: number
  strength: number
}
const ROWS = 200,
  COLUMNS = 100,
  SPRAY_COLUMNS = 300,
  LIFETIME = 20

/** World-anchored ribbon: historical headings survive steering and stopping. */
export function createWake() {
  const history: WakePoint[] = []
  const geometry = new BufferGeometry()
  const positions = new Float32BufferAttribute(ROWS * COLUMNS * 3, 3)
  const data = new Float32BufferAttribute(ROWS * COLUMNS * 4, 4)
  geometry.setAttribute('position', positions)
  geometry.setAttribute('wakeData', data)
  const indices: number[] = []
  for (let r = 0; r < ROWS - 1; r++)
    for (let c = 0; c < COLUMNS - 1; c++) {
      const a = r * COLUMNS + c,
        b = a + COLUMNS
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  geometry.setIndex(indices)
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      daylight: { value: 1 },
      time: { value: 0 },
      intensity: { value: 1 },
      turbulence: { value: 1 },
    },
    vertexShader: `
      attribute vec4 wakeData;
      varying vec4 vWake;
      varying vec2 vPoint;
      void main() {
        vWake = wakeData;
        vPoint = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float daylight;
      uniform float time;
      uniform float intensity;
      uniform float turbulence;
      varying vec4 vWake;
      varying vec2 vPoint;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);
      }
      void main() {
        float side = abs(vWake.x), age = vWake.y, strength = vWake.z, width = vWake.w;
        float n = noise(vPoint * 0.72 + vec2(time * 0.09, -time * 0.06));
        float fine = noise(vPoint * 2.5 + n * 2.0);
        float center = exp(-pow(side * width / (2.8 + age * 0.78), 2.0));
        float edge = exp(-pow((side - 0.76 - (n - 0.5) * 0.12) / 0.15, 2.0));
        float fade = pow(max(0.0, 1.0 - age / 8.0), 1.7);
        float foam = (center * (0.48 + n * 0.62) + edge * 0.68) * mix(0.24, 1.0, smoothstep(0.2, 0.7, fine));
        float gain = intensity <= 0.0 ? 0.0 : 0.7 + intensity * 1.3;
        float alpha = foam * fade * strength * gain * (1.0 - smoothstep(0.92, 1.0, side));
        vec3 color = mix(vec3(0.065,0.11,0.17), vec3(0.72,0.88,0.84), daylight);
        gl_FragColor = vec4(color, alpha * 0.94);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  const mesh = new Mesh(geometry, material)
  // Viewed from either side during orbit; geometry winding faces down.
  material.side = DoubleSide
  mesh.frustumCulled = false
  mesh.renderOrder = 2
  const bowGeometry = new BufferGeometry()
  const bowPositions = new Float32BufferAttribute(6 * COLUMNS * 3, 3)
  const bowData = new Float32BufferAttribute(6 * COLUMNS * 4, 4)
  bowGeometry.setAttribute('position', bowPositions)
  bowGeometry.setAttribute('wakeData', bowData)
  bowGeometry.setIndex(indices.slice(0, 5 * (COLUMNS - 1) * 6))
  const bow = new Mesh(bowGeometry, material)
  bow.frustumCulled = false
  bow.renderOrder = 2
  const sprayGeometry = new BufferGeometry()
  const sprayPositions = new Float32BufferAttribute(ROWS * SPRAY_COLUMNS * 3, 3)
  const sprayData = new Float32BufferAttribute(ROWS * SPRAY_COLUMNS * 4, 4)
  const sprayVariation = new Float32BufferAttribute(ROWS * SPRAY_COLUMNS * 3, 3)
  const sprayDirection = new Float32BufferAttribute(ROWS * SPRAY_COLUMNS * 2, 2)
  for (let i = 0; i < ROWS * SPRAY_COLUMNS; i++) {
    const randomA = Math.abs(Math.sin((i + 1) * 91.731)) % 1
    const randomB = Math.abs(Math.sin((i + 1) * 47.117 + 2.4)) % 1
    const randomC = Math.abs(Math.sin((i + 1) * 17.913 + 5.8)) % 1
    sprayVariation.setXYZ(i, randomA, 0.65 + randomB * 0.95, 0.45 + randomC * 1.05)
  }
  sprayGeometry.setAttribute('position', sprayPositions)
  sprayGeometry.setAttribute('wakeData', sprayData)
  sprayGeometry.setAttribute('sprayVariation', sprayVariation)
  sprayGeometry.setAttribute('sprayDirection', sprayDirection)
  const sprayMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      daylight: { value: 1 },
      time: { value: 0 },
      intensity: { value: 1 },
      turbulence: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float time;
      uniform float intensity;
      uniform float turbulence;
      attribute vec4 wakeData;
      attribute vec3 sprayVariation;
      attribute vec2 sprayDirection;
      varying float vAlpha;
      varying float vSeed;
      void main() {
        float side = abs(wakeData.x);
        float age = wakeData.y;
        float strength = wakeData.z;
        float seed = sprayVariation.x;
        float lifeRate = mix(1.0, sprayVariation.y, min(turbulence, 2.0));
        float life = fract(age * lifeRate + seed);
        float sternEnergy = exp(-age * 0.62) * strength;
        float center = exp(-pow(side / 0.42, 2.0));
        float arms = exp(-pow((side - 0.76) / 0.52, 2.0));
        vec3 p = position;
        float gain = intensity <= 0.0 ? 0.0 : 0.75 + intensity * 1.25;
        float arc = 4.0 * life * (1.0 - life);
        float chaos = max(0.0, turbulence);
        float flutter = sin(time * (3.0 + sprayVariation.y * 5.0) + seed * 31.0) *
          (0.035 + chaos * 0.075);
        float burst = mix(1.0, sprayVariation.z, min(chaos, 3.0));
        p.y += (arc * burst + flutter) * (0.24 + sternEnergy * 0.92) *
          (0.75 + chaos * 0.25) *
          mix(0.8, 1.45, clamp(intensity / 4.0, 0.0, 1.0));
        p.xz += vec2(sin(seed * 43.0 + time * sprayVariation.y), cos(seed * 29.0 - time)) *
          life * sternEnergy * (0.05 + chaos * 0.22);
        // Real lateral spray: droplets travel away from each stern corner instead
        // of merely oscillating vertically above two fixed tracks.
        float lateralLife = pow(life, 0.72);
        float lateralBurst = (0.3 + chaos * 0.7) * mix(0.7, 1.45, sprayVariation.z);
        p.xz += sprayDirection * lateralLife * lateralBurst;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float sizeOverLife = mix(1.48, 0.32, smoothstep(0.06, 0.96, life));
        gl_PointSize = mix(0.58, 2.15, sternEnergy) * sizeOverLife *
          mix(0.82, 1.1, sprayVariation.z) *
          mix(0.86, 1.35, clamp(intensity / 4.0, 0.0, 1.0)) *
          (95.0 / max(20.0, -mv.z));
        float viewDistance = length(mv.xyz);
        float cameraDetail = mix(0.2, 1.0, 1.0 - smoothstep(35.0, 170.0, viewDistance));
        float pulse = mix(1.0, 0.55 + 0.75 * sin(time * sprayVariation.y * 4.0 + seed * 53.0),
          min(1.0, chaos * 0.35));
        vAlpha = (center * 0.45 + arms * 0.72) * sternEnergy * gain * max(0.15, pulse) *
          sin(life * 3.14159) *
          cameraDetail * (1.0 - smoothstep(180.0, 260.0, viewDistance));
        vSeed = seed;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float daylight;
      varying float vAlpha;
      varying float vSeed;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float grain = 1.0 - smoothstep(0.14, 0.48, length(q));
        grain *= 0.84 + 0.16 * sin((q.x - q.y + vSeed) * 35.0);
        float alpha = grain * vAlpha;
        if (alpha < 0.015) discard;
        float environmentLight = mix(0.52, 1.0, daylight);
        vec3 nightFoam = vec3(0.38, 0.48, 0.52);
        vec3 dayFoam = vec3(0.72, 0.84, 0.83);
        vec3 color = mix(nightFoam, dayFoam, daylight);
        gl_FragColor = vec4(color * environmentLight, alpha * mix(0.56, 0.9, daylight));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const spray = new Points(sprayGeometry, sprayMaterial)
  spray.frustumCulled = false
  spray.renderOrder = 3
  let previous: WakePoint | undefined
  return {
    mesh,
    bow,
    spray,
    getHistory() {
      return history as readonly WakePoint[]
    },
    update(
      x: number,
      z: number,
      heading: number,
      speed: number,
      time: number,
      daylight: number,
      docked: boolean,
      waveScale = 1,
      windHeading = 0,
      enabled = true,
      detail = 1,
      intensity = 1,
      turbulence = 1,
    ) {
      const current = {
        x: x - Math.sin(heading) * 12,
        z: z + Math.cos(heading) * 12,
        heading,
        born: time,
        strength: Math.min(1, speed / 8),
      }
      if (previous && time > previous.born && !docked && speed > 0.35) {
        const distance = Math.hypot(current.x - previous.x, current.z - previous.z)
        if (distance > 0.12) {
          const steps = Math.min(32, Math.max(1, Math.ceil(distance / 1.8)))
          const angle = Math.atan2(
            Math.sin(heading - previous.heading),
            Math.cos(heading - previous.heading),
          )
          for (let i = 1; i <= steps; i++) {
            const t = i / steps
            history.unshift({
              ...current,
              x: previous.x + (current.x - previous.x) * t,
              z: previous.z + (current.z - previous.z) * t,
              heading: previous.heading + angle * t,
              born: previous.born + (time - previous.born) * t,
            })
          }
        }
      }
      previous = current
      while (
        history.length &&
        (history.length > ROWS || time - history[history.length - 1]!.born > LIFETIME)
      )
        history.pop()
      const visible = enabled && intensity > 0.001
      mesh.visible = visible && history.length > 1
      mesh.position.set(-x, 0, -z)
      bow.position.copy(mesh.position)
      spray.position.copy(mesh.position)
      bow.visible = visible && !docked && speed > 0.35
      spray.visible = visible && history.length > 1
      for (let r = 0; r < 6; r++)
        for (let c = 0; c < COLUMNS; c++) {
          const side = (c / (COLUMNS - 1)) * 2 - 1,
            width = 1 + r * 1.3
          const px = x + Math.sin(heading) * (15 - r * 1.5) + Math.cos(heading) * side * width
          const pz = z - Math.cos(heading) * (15 - r * 1.5) + Math.sin(heading) * side * width
          const i = r * COLUMNS + c
          bowPositions.setXYZ(i, px, oceanHeight(px, pz, time, windHeading) * waveScale + 0.12, pz)
          bowData.setXYZW(i, side, 0.5, Math.min(1, speed / 9), width)
        }
      bowPositions.needsUpdate = bowData.needsUpdate = true
      let distanceBehind = 0
      for (let r = 0; r < history.length; r++) {
        const point = history[r]!,
          age = time - point.born
        if (r)
          distanceBehind += Math.hypot(point.x - history[r - 1]!.x, point.z - history[r - 1]!.z)
        const width = 2.6 + Math.min(26, distanceBehind * 0.24) + age * 0.55
        for (let c = 0; c < COLUMNS; c++) {
          const side = (c / (COLUMNS - 1)) * 2 - 1
          const px = point.x + Math.cos(point.heading) * side * width
          const pz = point.z + Math.sin(point.heading) * side * width
          const i = r * COLUMNS + c
          positions.setXYZ(i, px, oceanHeight(px, pz, time, windHeading) * waveScale + 0.1, pz)
          data.setXYZW(i, side, age, point.strength, width)
        }
        for (let c = 0; c < SPRAY_COLUMNS; c++) {
          // Stable, decorrelated samples prevent successive history rows from lining up
          // as two visible rails when the wake is viewed from above.
          const seed = (r + 1) * 127.1 + (c + 1) * 311.7
          const randomA = Math.abs(Math.sin(seed) * 43758.5453) % 1
          const randomB = Math.abs(Math.sin(seed + 19.19) * 15731.743) % 1
          const randomC = Math.abs(Math.sin(seed + 47.77) * 789221.123) % 1
          const gaussianSide = (randomA + randomB + randomC - 1.5) / 1.5
          // Nine out of ten samples originate in dense clusters at the two stern corners.
          // Each cluster is an irregular ellipse rather than a fixed-width vertical rail.
          const centreSample = c % 10 === 0
          const emitterSide = c % 2 ? 1 : -1
          const clusterSpread = 0.045 + Math.min(0.72, age * 0.095 + distanceBehind * 0.012)
          const side = centreSample
            ? (randomA - 0.5) * 1.15
            : emitterSide * 0.76 + gaussianSide * clusterSpread
          const sprayWidth = 4.4 + Math.min(28, distanceBehind * 0.25) + age * 0.62
          const lateralOffset = side * sprayWidth
          // Bias most droplets downstream, with a small upstream tail. The growing
          // envelope turns the two compact stern emitters into broken, fan-shaped clouds.
          const longitudinalSpread = 0.45 + Math.min(5.5, age * 0.7 + distanceBehind * 0.075)
          const longitudinalOffset = (Math.pow(randomB, 1.7) - 0.18) * longitudinalSpread
          const px =
            point.x +
            Math.cos(point.heading) * lateralOffset -
            Math.sin(point.heading) * longitudinalOffset
          const pz =
            point.z +
            Math.sin(point.heading) * lateralOffset +
            Math.cos(point.heading) * longitudinalOffset
          const i = r * SPRAY_COLUMNS + c
          sprayPositions.setXYZ(
            i,
            px,
            oceanHeight(px, pz, time, windHeading) * waveScale + 0.16,
            pz,
          )
          sprayData.setXYZW(i, side, age, point.strength, sprayWidth)
          const horizontalSpeed =
            emitterSide * (0.7 + randomC * 2.1) + gaussianSide * (0.35 + age * 0.08)
          sprayDirection.setXY(
            i,
            Math.cos(point.heading) * horizontalSpeed,
            Math.sin(point.heading) * horizontalSpeed,
          )
        }
      }
      positions.needsUpdate = data.needsUpdate = true
      sprayPositions.needsUpdate = sprayData.needsUpdate = true
      sprayDirection.needsUpdate = true
      geometry.setDrawRange(0, Math.max(0, history.length - 1) * (COLUMNS - 1) * 6)
      sprayGeometry.setDrawRange(
        0,
        Math.min(
          history.length * SPRAY_COLUMNS,
          Math.round(
            history.length *
              SPRAY_COLUMNS *
              Math.max(0.35, detail) *
              Math.min(1, 0.55 + intensity * 0.3),
          ),
        ),
      )
      material.uniforms.time!.value = time
      material.uniforms.daylight!.value = daylight
      material.uniforms.intensity!.value = intensity
      sprayMaterial.uniforms.time!.value = time
      sprayMaterial.uniforms.daylight!.value = daylight
      sprayMaterial.uniforms.intensity!.value = intensity
      sprayMaterial.uniforms.turbulence!.value = turbulence
    },
    dispose() {
      geometry.dispose()
      bowGeometry.dispose()
      material.dispose()
      sprayGeometry.dispose()
      sprayMaterial.dispose()
    },
  }
}
