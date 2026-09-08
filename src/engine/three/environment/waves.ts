// Shared coefficients: render geometry, surface normals, buoyancy and wake agree.
export const WAVES = [
  { x: 0.98, z: 0.2, frequency: 0.095, amplitude: 0.48, speed: 0.96, sharpness: 0.16 },
  { x: -0.35, z: 0.94, frequency: 0.137, amplitude: 0.42, speed: 1.13, sharpness: 0.15 },
  { x: 0.71, z: -0.7, frequency: 0.213, amplitude: 0.27, speed: 1.42, sharpness: 0.12 },
  { x: -0.91, z: -0.41, frequency: 0.319, amplitude: 0.14, speed: 1.73, sharpness: 0.1 },
  { x: 0.22, z: 0.98, frequency: 0.487, amplitude: 0.07, speed: 2.07, sharpness: 0.08 },
  { x: -0.76, z: 0.65, frequency: 0.683, amplitude: 0.035, speed: 2.43, sharpness: 0.06 },
] as const

export const MAX_WAVE_HEIGHT = WAVES.reduce(
  (sum, wave) => sum + wave.amplitude * (1 + wave.sharpness),
  0,
)

export function oceanHeight(x: number, z: number, time: number) {
  let height = 0
  for (const wave of WAVES) {
    const bend = (-x * wave.z + z * wave.x) * wave.frequency * 0.57 + time * 0.19
    const phase =
      (x * wave.x + z * wave.z) * wave.frequency - time * wave.speed + Math.sin(bend) * 0.65
    height += (Math.sin(phase) - wave.sharpness * Math.cos(phase * 2)) * wave.amplitude
  }
  return height
}

const f = (n: number) => n.toFixed(6)
const phaseGLSL = (wave: (typeof WAVES)[number]) =>
  `(dot(p, vec2(${f(wave.x)}, ${f(wave.z)})) * ${f(wave.frequency)} - t * ${f(wave.speed)} + sin(dot(p, vec2(${f(-wave.z)}, ${f(wave.x)})) * ${f(wave.frequency * 0.57)} + t * 0.19) * 0.65)`

export const wavesGLSL = /* glsl */ `
  // x = height, yz = analytical slopes, w = compression at overlapping crests.
  vec4 waveField(vec2 p, float t) {
    vec4 field = vec4(0.0);
    float phase, s, derivative;
    ${WAVES.map(
      (wave) => `
      phase = ${phaseGLSL(wave)};
      s = sin(phase);
      field.x += (s - ${f(wave.sharpness)} * cos(phase * 2.0)) * ${f(wave.amplitude)};
      derivative = (cos(phase) + ${f(2 * wave.sharpness)} * sin(phase * 2.0)) * ${f(wave.amplitude * wave.frequency)};
      field.yz += derivative * (vec2(${f(wave.x)}, ${f(wave.z)}) +
        vec2(${f(-wave.z)}, ${f(wave.x)}) * 0.3705 *
        cos(dot(p, vec2(${f(-wave.z)}, ${f(wave.x)})) * ${f(wave.frequency * 0.57)} + t * 0.19));
      field.w += pow(max(s, 0.0), 8.0) * ${f(wave.amplitude)};
    `,
    ).join('\n')}
    return field;
  }
  float previousCrest(vec2 p, float t) {
    return ${WAVES.map(
      (wave) => `pow(max(sin(${phaseGLSL(wave)}), 0.0), 8.0) * ${f(wave.amplitude)}`,
    ).join(' + ')};
  }
`
