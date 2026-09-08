import {
  AdditiveBlending,
  BufferGeometry,
  ClampToEdgeWrapping,
  Float32BufferAttribute,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Points,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import type { WakePoint } from './wake'

const RESOLUTION = 512
const FIELD_SIZE = 420
const MAX_STAMPS = 640

/** Persistent world-space foam mask sampled directly by the ocean material. */
export function createFoamField() {
  const targetOptions = {
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    format: RGBAFormat,
    type: UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
  }
  let previous = new WebGLRenderTarget(RESOLUTION, RESOLUTION, targetOptions)
  let next = new WebGLRenderTarget(RESOLUTION, RESOLUTION, targetOptions)
  const center = new Vector2()
  const previousCenter = new Vector2()
  let initialized = false

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const decayScene = new Scene()
  const decayMaterial = new ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      previousFoam: { value: previous.texture },
      centerShift: { value: new Vector2() },
      decay: { value: new Vector2(1, 1) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D previousFoam;
      uniform vec2 centerShift;
      uniform vec2 decay;
      varying vec2 vUv;
      void main() {
        vec2 previousUv = vUv + centerShift;
        float inside = step(0.0, previousUv.x) * step(previousUv.x, 1.0) *
          step(0.0, previousUv.y) * step(previousUv.y, 1.0);
        vec2 foam = texture2D(previousFoam, clamp(previousUv, 0.0, 1.0)).rg * decay * inside;
        gl_FragColor = vec4(foam, 0.0, 1.0);
      }
    `,
  })
  decayScene.add(new Mesh(new PlaneGeometry(2, 2), decayMaterial))

  const stampPositions = new Float32BufferAttribute(MAX_STAMPS * 3, 3)
  const stampData = new Float32BufferAttribute(MAX_STAMPS * 3, 3)
  const stampGeometry = new BufferGeometry()
  stampGeometry.setAttribute('position', stampPositions)
  stampGeometry.setAttribute('stampData', stampData)
  const stampMaterial = new ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      resolution: { value: RESOLUTION },
      fieldSize: { value: FIELD_SIZE },
      centerWorld: { value: new Vector2() },
    },
    vertexShader: /* glsl */ `
      uniform float resolution;
      uniform float fieldSize;
      attribute vec3 stampData;
      varying float vStrength;
      varying float vLayer;
      void main() {
        gl_Position = vec4(position.xy, 0.0, 1.0);
        gl_PointSize = max(1.0, stampData.x * resolution * 2.0 / fieldSize);
        vStrength = stampData.y;
        vLayer = stampData.z;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float resolution;
      uniform float fieldSize;
      uniform vec2 centerWorld;
      varying float vStrength;
      varying float vLayer;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
          mix(hash(i + vec2(0,1)), hash(i + 1.0), f.x), f.y);
      }
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float radius = length(q) * 2.0;
        vec2 world = centerWorld + (gl_FragCoord.xy / resolution - 0.5) * fieldSize;
        float coarse = noise(world * 0.17);
        float fine = noise(world * 0.61 + coarse * 3.7);
        float edgeNoise = (coarse - 0.5) * 0.28;
        float mask = 1.0 - smoothstep(0.42 + edgeNoise, 1.0, radius);
        float islands = smoothstep(0.34, 0.7, coarse * 0.72 + fine * 0.42);
        float threads = 1.0 - smoothstep(0.055, 0.19, abs(fine - 0.5));
        mask *= max(islands, threads * coarse * 0.72);
        if (mask <= 0.01) discard;
        float foam = mask * vStrength;
        gl_FragColor = vec4(foam * (1.0 - vLayer), foam * vLayer, 0.0, 1.0);
      }
    `,
  })
  const stampScene = new Scene()
  stampScene.add(new Points(stampGeometry, stampMaterial))

  function stamp(
    index: number,
    x: number,
    z: number,
    radius: number,
    strength: number,
    layer: 0 | 1,
  ) {
    if (index >= MAX_STAMPS) return index
    stampPositions.setXYZ(
      index,
      ((x - center.x) / FIELD_SIZE) * 2,
      ((z - center.y) / FIELD_SIZE) * 2,
      0,
    )
    stampData.setXYZ(index, radius, strength, layer)
    return index + 1
  }

  return {
    get texture() {
      return previous.texture
    },
    center,
    size: FIELD_SIZE,
    update(
      renderer: WebGLRenderer,
      x: number,
      z: number,
      heading: number,
      speed: number,
      dt: number,
      time: number,
      history: readonly WakePoint[],
      enabled: boolean,
      wakeStrength: number,
      bowStrength: number,
      bowWidth: number,
      lifetime: number,
      turbulence: number,
    ) {
      if (initialized && dt <= 0) return
      center.set(x, z)
      decayMaterial.uniforms.previousFoam!.value = previous.texture
      decayMaterial.uniforms
        .centerShift!.value.copy(center)
        .sub(previousCenter)
        .divideScalar(FIELD_SIZE)
      const trailDecay = enabled ? Math.exp(-Math.max(0, dt) / Math.max(0.2, lifetime)) : 0
      const churnDecay = enabled
        ? Math.exp(-Math.max(0, dt) / Math.max(0.2, Math.min(2.2, lifetime * 0.32)))
        : 0
      decayMaterial.uniforms.decay!.value.set(trailDecay, churnDecay)

      let count = 0
      if (enabled) {
        const deposit = Math.min(1, Math.max(0, dt) * 8)
        let distanceBehind = 0
        for (let i = 0; i < history.length && count + 3 <= MAX_STAMPS; i++) {
          const point = history[i]!
          if (i)
            distanceBehind += Math.hypot(point.x - history[i - 1]!.x, point.z - history[i - 1]!.z)
          const stampAge = time - point.born
          if (stampAge > 0.35) continue
          const ageFade = Math.max(0, 1 - stampAge / 0.35)
          const width = 3.2 + Math.min(24, distanceBehind * 0.22)
          const nx = Math.cos(point.heading)
          const nz = Math.sin(point.heading)
          const chaosA = Math.sin(point.born * 37.1 + i * 11.7)
          const chaosB = Math.sin(point.born * 19.3 + i * 47.9)
          const jitter = Math.max(0, turbulence) * 0.75
          const jitterX = nx * chaosA * jitter + Math.sin(point.heading) * chaosB * jitter * 0.45
          const jitterZ = nz * chaosA * jitter - Math.cos(point.heading) * chaosB * jitter * 0.45
          const variation = Math.max(0.18, 1 + chaosB * Math.min(0.78, turbulence * 0.18))
          const strength = point.strength * wakeStrength * ageFade * deposit * 0.32 * variation
          count = stamp(
            count,
            point.x + jitterX,
            point.z + jitterZ,
            2.1 * variation,
            strength * 0.48,
            1,
          )
          count = stamp(
            count,
            point.x + nx * width * 0.72 + jitterX,
            point.z + nz * width * 0.72 + jitterZ,
            1.55 * variation,
            strength * 0.72,
            0,
          )
          count = stamp(
            count,
            point.x - nx * width * 0.72 + jitterX,
            point.z - nz * width * 0.72 + jitterZ,
            1.55 * variation,
            strength * 0.72,
            0,
          )
        }

        const forwardX = Math.sin(heading)
        const forwardZ = -Math.cos(heading)
        const sideX = Math.cos(heading)
        const sideZ = Math.sin(heading)
        const impact = Math.min(1, speed / 8) * bowStrength * deposit * 0.3
        // One curved contact arc at the hull, not a filled fan projected in front of it.
        for (let column = 0; column < 19 && count < MAX_STAMPS; column++) {
          const side = (column / 18) * 2 - 1
          const shoulder = side * 7.2 * bowWidth
          const ahead = 11.5 + (1 - Math.abs(side)) * 3.8
          const px = x + forwardX * ahead + sideX * shoulder
          const pz = z + forwardZ * ahead + sideZ * shoulder
          const broken = 0.5 + 0.5 * Math.sin(column * 12.73 + time * 1.7)
          count = stamp(count, px, pz, 1.25 + broken * 0.85, impact * (0.28 + broken * 0.52), 1)
        }
        count = stamp(count, x + forwardX * 12, z + forwardZ * 12, 2.4, impact * 0.58, 1)
      }
      stampPositions.needsUpdate = true
      stampData.needsUpdate = true
      stampGeometry.setDrawRange(0, count)
      stampMaterial.uniforms.centerWorld!.value.copy(center)

      const oldTarget = renderer.getRenderTarget()
      const oldAutoClear = renderer.autoClear
      const oldXr = renderer.xr.enabled
      renderer.xr.enabled = false
      renderer.setRenderTarget(next)
      renderer.clear()
      renderer.autoClear = false
      if (initialized) renderer.render(decayScene, camera)
      if (count) renderer.render(stampScene, camera)
      renderer.setRenderTarget(oldTarget)
      renderer.autoClear = oldAutoClear
      renderer.xr.enabled = oldXr

      ;[previous, next] = [next, previous]
      previousCenter.copy(center)
      initialized = true
    },
    dispose() {
      previous.dispose()
      next.dispose()
      ;(decayScene.children[0] as Mesh).geometry.dispose()
      decayMaterial.dispose()
      stampGeometry.dispose()
      stampMaterial.dispose()
    },
  }
}
