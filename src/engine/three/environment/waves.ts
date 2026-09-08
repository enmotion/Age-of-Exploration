// Shared coefficients: render geometry, surface normals, buoyancy and wake agree.
export const WAVES = [
  { x: 0.98, z: 0.2, frequency: 0.095, amplitude: 0.48, speed: 0.96, sharpness: 0.16, phase: 0.37 },
  {
    x: -0.35,
    z: 0.94,
    frequency: 0.137,
    amplitude: 0.42,
    speed: 1.13,
    sharpness: 0.15,
    phase: 2.11,
  },
  {
    x: 0.71,
    z: -0.7,
    frequency: 0.213,
    amplitude: 0.27,
    speed: 1.42,
    sharpness: 0.12,
    phase: 4.73,
  },
  {
    x: -0.91,
    z: -0.41,
    frequency: 0.319,
    amplitude: 0.14,
    speed: 1.73,
    sharpness: 0.1,
    phase: 1.29,
  },
  {
    x: 0.22,
    z: 0.98,
    frequency: 0.487,
    amplitude: 0.07,
    speed: 2.07,
    sharpness: 0.08,
    phase: 5.44,
  },
  {
    x: -0.76,
    z: 0.65,
    frequency: 0.683,
    amplitude: 0.035,
    speed: 2.43,
    sharpness: 0.06,
    phase: 3.18,
  },
] as const

export const MAX_WAVE_HEIGHT = WAVES.reduce(
  (sum, wave) => sum + wave.amplitude * (1 + wave.sharpness),
  0,
)

/** Storm waves grow sub-linearly above gale force to remain stable at hurricane winds. */
export function waveScaleForWind(windSpeed: number) {
  if (windSpeed <= 14) return Math.max(0.18, windSpeed / 14)
  return Math.min(4.2, 1 + 1.2 * Math.sqrt((windSpeed - 14) / 16))
}

export function oceanHeight(x: number, z: number, time: number, windHeading = 0) {
  const angle = (-windHeading * Math.PI) / 180
  const rotatedX = x * Math.cos(angle) - z * Math.sin(angle)
  const rotatedZ = x * Math.sin(angle) + z * Math.cos(angle)
  // Low-frequency domain warping breaks up the long, parallel swell trains.
  // Keep this identical to waveDomainWarp() below so buoyancy matches rendering.
  const warpX =
    Math.sin(rotatedX * 0.007 + rotatedZ * 0.011 + time * 0.035) * 7.5 +
    Math.sin(rotatedX * -0.016 + rotatedZ * 0.005 - time * 0.023 + 2.7) * 3.2
  const warpZ =
    Math.sin(rotatedX * -0.009 + rotatedZ * 0.013 - time * 0.029 + 1.4) * 6.8 +
    Math.sin(rotatedX * 0.004 + rotatedZ * -0.019 + time * 0.041 + 4.1) * 2.8
  const sampleX = rotatedX + warpX
  const sampleZ = rotatedZ + warpZ
  let height = 0
  for (const wave of WAVES) {
    const bend = (-sampleX * wave.z + sampleZ * wave.x) * wave.frequency * 0.57 + time * 0.19
    const phase =
      (sampleX * wave.x + sampleZ * wave.z) * wave.frequency -
      time * wave.speed +
      Math.sin(bend) * 0.65 +
      wave.phase
    height += (Math.sin(phase) - wave.sharpness * Math.cos(phase * 2)) * wave.amplitude
  }
  return height
}

const f = (n: number) => n.toFixed(6)
const phaseGLSL = (wave: (typeof WAVES)[number], point = 'q') =>
  `(dot(${point}, vec2(${f(wave.x)}, ${f(wave.z)})) * ${f(wave.frequency)} - t * ${f(wave.speed)} + sin(dot(${point}, vec2(${f(-wave.z)}, ${f(wave.x)})) * ${f(wave.frequency * 0.57)} + t * 0.19) * 0.65 + ${f(wave.phase)})`

export const wavesGLSL = /* glsl */ `
  vec2 rotateWave(vec2 p, float angle) {
    float c = cos(angle), s = sin(angle);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }
  vec2 waveDomainWarp(vec2 p, float t) {
    return vec2(
      sin(dot(p, vec2(0.007, 0.011)) + t * 0.035) * 7.5 +
        sin(dot(p, vec2(-0.016, 0.005)) - t * 0.023 + 2.7) * 3.2,
      sin(dot(p, vec2(-0.009, 0.013)) - t * 0.029 + 1.4) * 6.8 +
        sin(dot(p, vec2(0.004, -0.019)) + t * 0.041 + 4.1) * 2.8
    );
  }
  // x = height, yz = analytical slopes, w = compression at overlapping crests.
  vec4 waveField(vec2 p, float t) {
    vec4 field = vec4(0.0);
    vec2 q = p + waveDomainWarp(p, t);
    float phase, s, derivative;
    ${WAVES.map(
      (wave) => `
      phase = ${phaseGLSL(wave)};
      s = sin(phase);
      field.x += (s - ${f(wave.sharpness)} * cos(phase * 2.0)) * ${f(wave.amplitude)};
      derivative = (cos(phase) + ${f(2 * wave.sharpness)} * sin(phase * 2.0)) * ${f(wave.amplitude * wave.frequency)};
      field.yz += derivative * (vec2(${f(wave.x)}, ${f(wave.z)}) +
        vec2(${f(-wave.z)}, ${f(wave.x)}) * 0.3705 *
        cos(dot(q, vec2(${f(-wave.z)}, ${f(wave.x)})) * ${f(wave.frequency * 0.57)} + t * 0.19));
      field.w += pow(max(s, 0.0), 8.0) * ${f(wave.amplitude)};
    `,
    ).join('\n')}
    return field;
  }
  vec4 windWaveField(vec2 p, float t, float windAngle) {
    vec4 field = waveField(rotateWave(p, -windAngle), t);
    field.yz = rotateWave(field.yz, windAngle);
    return field;
  }
  vec2 waveDisplacement(vec2 p, float t, float windAngle) {
    vec2 local = rotateWave(p, -windAngle);
    vec2 q = local + waveDomainWarp(local, t);
    vec2 displacement = vec2(0.0);
    ${WAVES.map(
      (wave) =>
        `displacement += vec2(${f(wave.x)}, ${f(wave.z)}) * cos(${phaseGLSL(wave)}) * ${f(wave.amplitude)};`,
    ).join('\n')}
    return rotateWave(displacement, windAngle);
  }
  float previousCrest(vec2 p, float t) {
    vec2 q = p + waveDomainWarp(p, t);
    return ${WAVES.map(
      (wave) => `pow(max(sin(${phaseGLSL(wave)}), 0.0), 8.0) * ${f(wave.amplitude)}`,
    ).join(' + ')};
  }
`
