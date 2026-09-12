// 开发期验证工具（位于 node_modules/.cache，不参与 lint 与构建）：
// 冻结波浪相位后截图，与参考图做主色聚类和明度分布对比，用于客观验收美术方向。
// 用法：node tools/palette-check.mjs '{"foamBiasLarge":0.6}' /tmp/out.png
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const REF = path.join(
  REPO_ROOT,
  'assets/source/reference/age-of-sail-style-sheet.png',
)
const PRESET_KEY = 'age-of-exploration:ocean-preset:v1'
// 冻结时间：波浪相位每次运行都不同，会让统计产生肉眼级别的噪声，必须固定相位后各次测量才可比。
const overrides = {
  animationPaused: true,
  timeOffset: 0,
  ...JSON.parse(process.argv[2] ?? '{}'),
}
const outPath = process.argv[3] ?? '/tmp/palette.png'

const MEASURE = ([src, region, k]) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onerror = () =>
      reject(new Error('image load failed: ' + String(src).slice(0, 40)))
    img.onload = () => {
      const [sx, sy, sw, sh] = region
      const canvas = document.createElement('canvas')
      canvas.width = sw
      canvas.height = sh
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
      const { data } = ctx.getImageData(0, 0, sw, sh)
      const pts = []
      for (let i = 0; i < data.length; i += 16)
        pts.push([data[i], data[i + 1], data[i + 2]])
      const cents = []
      for (let i = 0; i < k; i++)
        cents.push(pts[Math.floor(((i + 0.5) / k) * pts.length)].slice())
      const assign = new Array(pts.length).fill(0)
      for (let it = 0; it < 12; it++) {
        for (let p = 0; p < pts.length; p++) {
          let best = 0
          let bd = Infinity
          for (let ci = 0; ci < k; ci++) {
            const d =
              (pts[p][0] - cents[ci][0]) ** 2 +
              (pts[p][1] - cents[ci][1]) ** 2 +
              (pts[p][2] - cents[ci][2]) ** 2
            if (d < bd) {
              bd = d
              best = ci
            }
          }
          assign[p] = best
        }
        const sum = Array.from({ length: k }, () => [0, 0, 0, 0])
        for (let p = 0; p < pts.length; p++) {
          const a = assign[p]
          sum[a][0] += pts[p][0]
          sum[a][1] += pts[p][1]
          sum[a][2] += pts[p][2]
          sum[a][3]++
        }
        for (let ci = 0; ci < k; ci++) {
          if (sum[ci][3]) {
            cents[ci] = [
              sum[ci][0] / sum[ci][3],
              sum[ci][1] / sum[ci][3],
              sum[ci][2] / sum[ci][3],
            ]
          }
        }
      }
      const counts = new Array(k).fill(0)
      for (const a of assign) counts[a]++
      const hex = (c) =>
        '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
      let bright = 0
      let veryBright = 0
      let warm = 0
      for (const p of pts) {
        const y = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]
        if (y > 190) bright++
        if (y > 235) veryBright++
        // 暖色像素（碎金/礁石）：参考图里碎金是暖色，用这个指标量化它的覆盖面积
        if (p[0] > p[2] + 10) warm++
      }
      resolve({
        clusters: cents
          .map((c, i) => ({
            hex: hex(c),
            weight: +(counts[i] / pts.length).toFixed(3),
          }))
          .sort((a, b) => b.weight - a.weight),
        bright: +(bright / pts.length).toFixed(3),
        veryBright: +(veryBright / pts.length).toFixed(3),
        warm: +(warm / pts.length).toFixed(3),
      })
    }
    img.src = src
  })

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=metal'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 880 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 200))
})
await page.addInitScript(
  ([key, value]) => localStorage.setItem(key, value),
  [PRESET_KEY, JSON.stringify(overrides)],
)

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => document.querySelector('canvas')?.dataset.ready === 'true',
  null,
  {
    timeout: 45000,
  },
)
// 参考图 hero 水面区域（地平线以下、避开岛屿与船体主干）—— 同源加载，避免污染 canvas
const ref = await page.evaluate(MEASURE, ['/@fs' + REF, [0, 300, 1180, 210], 8])
// 应用预设（含冻结相位），再截图
await page.getByRole('button', { name: '载入', exact: true }).click()
// 预设越界会被 parseSettings 整份拒绝，此时参数全部保持默认——必须报出来，
// 否则会把"默认值"当成"候选值"的结果，测出一模一样的数字还以为是收敛了。
const notice =
  (await page
    .locator('.notice')
    .textContent()
    .catch(() => '')) ?? ''
if (notice && !notice.includes('已载入')) {
  console.log('!! 预设被拒绝，本次结果不是候选值：', notice.trim())
  process.exitCode = 2
}
await page.waitForTimeout(2500)
const shot = await page.screenshot({ path: outPath })
const mine = await page.evaluate(MEASURE, [
  'data:image/png;base64,' + shot.toString('base64'),
  [20, 500, 990, 360],
  8,
])

const lum = (h) => {
  const n = parseInt(h.slice(1), 16)
  return Math.round(
    0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255),
  )
}
const fmt = (l) =>
  l.clusters.map((x) => `${x.hex}(Y${lum(x.hex)},${x.weight})`).join('  ')
console.log('参考图水面 :', fmt(ref))
console.log(
  '  明度>190 =',
  ref.bright,
  '  明度>235 =',
  ref.veryBright,
  '  暖色 =',
  ref.warm,
)
console.log('当前渲染   :', fmt(mine))
console.log(
  '  明度>190 =',
  mine.bright,
  '  明度>235 =',
  mine.veryBright,
  '  暖色 =',
  mine.warm,
)
if (errors.length) console.log('errors =', JSON.stringify(errors.slice(0, 3)))
await browser.close()
