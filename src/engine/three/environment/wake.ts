import { BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, ShaderMaterial } from 'three'
import { oceanHeight } from './waves'

interface WakePoint {
  x: number
  z: number
  heading: number
  born: number
  strength: number
}
const ROWS = 160,
  COLUMNS = 13,
  LIFETIME = 8

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
    uniforms: { daylight: { value: 1 }, time: { value: 0 } },
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
        float center = exp(-pow(side * width / (2.0 + age * 0.65), 2.0));
        float edge = exp(-pow((side - 0.78 - (n - 0.5) * 0.12) / 0.10, 2.0));
        float fade = pow(max(0.0, 1.0 - age / 8.0), 1.7);
        float foam = (center * (0.32 + n * 0.55) + edge * 0.48) * mix(0.15, 1.0, smoothstep(0.2, 0.7, fine));
        float alpha = foam * fade * strength * (1.0 - smoothstep(0.88, 1.0, side));
        vec3 color = mix(vec3(0.065,0.11,0.17), vec3(0.72,0.88,0.84), daylight);
        gl_FragColor = vec4(color, alpha * 0.78);
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
  let previous: WakePoint | undefined
  return {
    mesh,
    bow,
    update(
      x: number,
      z: number,
      heading: number,
      speed: number,
      time: number,
      daylight: number,
      docked: boolean,
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
      mesh.visible = history.length > 1
      mesh.position.set(-x, 0, -z)
      bow.position.copy(mesh.position)
      bow.visible = !docked && speed > 0.35
      for (let r = 0; r < 6; r++)
        for (let c = 0; c < COLUMNS; c++) {
          const side = (c / (COLUMNS - 1)) * 2 - 1,
            width = 1 + r * 1.3
          const px = x + Math.sin(heading) * (15 - r * 1.5) + Math.cos(heading) * side * width
          const pz = z - Math.cos(heading) * (15 - r * 1.5) + Math.sin(heading) * side * width
          const i = r * COLUMNS + c
          bowPositions.setXYZ(i, px, oceanHeight(px, pz, time) + 0.12, pz)
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
          positions.setXYZ(i, px, oceanHeight(px, pz, time) + 0.1, pz)
          data.setXYZW(i, side, age, point.strength, width)
        }
      }
      positions.needsUpdate = data.needsUpdate = true
      geometry.setDrawRange(0, Math.max(0, history.length - 1) * (COLUMNS - 1) * 6)
      material.uniforms.time!.value = time
      material.uniforms.daylight!.value = daylight
    },
    dispose() {
      geometry.dispose()
      bowGeometry.dispose()
      material.dispose()
    },
  }
}
