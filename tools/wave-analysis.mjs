// 镜像 shaders.ts 的 evaluateOcean，用于分析波场构成（纯数学，无依赖）
const plateau = 1.4
const norm = Math.sqrt(1 + plateau * plateau)
const shaped = (s) => (s * norm) / Math.sqrt(1 + s * s * plateau * plateau)
const dir = (deg) => [
  Math.cos((deg * Math.PI) / 180),
  Math.sin((deg * Math.PI) / 180),
]

// 默认值（src/domain/ocean.ts）
const largeVertical = 1,
  mediumVertical = 0.82,
  smallVertical = 0.42
const swellScale = 0.72,
  localScale = 0.72
const A = [
  largeVertical * swellScale * 1.65,
  mediumVertical * localScale * 1.15,
  smallVertical * localScale * 0.5,
]
const L = [34, 14, 5.5]
const baseAngles = [14, -28, -28 + 53] // swell / wind / wind+53
const COMPONENTS_PER_BAND = 8
const LENGTH_SPREAD = 1.3247
const SPREAD_OCTAVES = 2.4
const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

const comps = []
for (let band = 0; band < 3; band++) {
  const weights = [],
    lengths = []
  for (let i = 0; i < COMPONENTS_PER_BAND; i++) {
    const t = i / (COMPONENTS_PER_BAND - 1)
    lengths.push(L[band] * Math.pow(LENGTH_SPREAD, (t - 0.5) * SPREAD_OCTAVES))
    const offset = (t - 0.5) / 0.28
    weights.push(Math.exp(-0.5 * offset * offset))
  }
  const weightNorm = Math.sqrt(weights.reduce((sum, w) => sum + w * w, 0))
  const energy = A[band] * Math.sqrt(0.72 ** 2 + 0.2 ** 2 + 0.1 ** 2)
  for (let i = 0; i < COMPONENTS_PER_BAND; i++) {
    const t = i / (COMPONENTS_PER_BAND - 1)
    const seed = band * 31 + i * 7.7
    const spread = (20 + 40 * t) * (hash(seed) - 0.5) * 2
    comps.push({
      band,
      sub: String(i),
      deg: baseAngles[band] + spread,
      len: lengths[i],
      amp: (energy * weights[i]) / weightNorm,
    })
  }
}
const energy = (c) => c.amp * c.amp
const total = comps.reduce((s, c) => s + energy(c), 0)

console.log(`=== ${comps.length} 个波分量（默认参数）===`)
console.log('带  子  方向°   波长m   振幅m   能量占比')
for (const c of comps) {
  console.log(
    `${c.band}   ${c.sub}   ${c.deg.toFixed(1).padStart(6)}  ${c.len.toFixed(2).padStart(6)}  ${c.amp.toFixed(3).padStart(6)}  ${((energy(c) / total) * 100).toFixed(1).padStart(6)}%`,
  )
}
const bandEnergy = [0, 1, 2].map((b) =>
  comps.filter((c) => c.band === b).reduce((s, c) => s + energy(c), 0),
)
console.log('\n=== 能量分布 ===')
console.log(
  '各带能量占比:     ',
  bandEnergy.map((e) => ((e / total) * 100).toFixed(1) + '%').join('  '),
)
console.log(
  '带内最大分量占该带比: ',
  [0, 1, 2]
    .map((b) => {
      const inBand = comps.filter((c) => c.band === b)
      const peak = Math.max(...inBand.map(energy))
      return ((peak / bandEnergy[b]) * 100).toFixed(1) + '%'
    })
    .join('  '),
)
const single = comps.reduce((best, c) => (energy(c) > energy(best) ? c : best))
console.log(
  `\n>>> 仅最大的单个正弦，就占整个波场能量的 ${((energy(single) / total) * 100).toFixed(1)}%`,
)

// 沿大波主方向采一条剖面，做自相关找重复周期
const N = 4096,
  dx = 1.0
const profile = new Float64Array(N)
for (let i = 0; i < N; i++) {
  const x = i * dx
  let h = 0
  for (const c of comps) {
    const d = dir(c.deg),
      k = (2 * Math.PI) / c.len
    h += shaped(Math.sin((x * d[0] + 0 * d[1]) * k)) * c.amp
  }
  profile[i] = h
}
const mean = profile.reduce((a, b) => a + b, 0) / N
for (let i = 0; i < N; i++) profile[i] -= mean
let v0 = 0
for (let i = 0; i < N; i++) v0 += profile[i] * profile[i]
const peaks = []
for (let lag = 5; lag < N / 2; lag++) {
  let r = 0
  for (let i = 0; i + lag < N; i++) r += profile[i] * profile[i + lag]
  r /= v0 * (1 - lag / N)
  if (r > 0.25 && r > (peaks.at(-1)?.r ?? 0)) peaks.push({ lag, r })
  else if (peaks.length && r < 0.1) break
}
console.log('\n=== 高度剖面的自相关主峰（沿大波主方向）===')
for (const p of peaks.slice(0, 6))
  console.log(
    `  重复距离 ${String(p.lag).padStart(5)} m   相关度 ${p.r.toFixed(3)}`,
  )
