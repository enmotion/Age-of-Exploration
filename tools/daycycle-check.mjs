// 验证工具：对照参考图右上角的昼夜四态缩略图，逐个应用面板预设并测量水面。
// 参考缩略图里那个水带是中景水，所以除了最底部近景，还会测一条紧贴地平线的中景带做交叉验证，
// 否则会把"取样距离不同"误判成"画面偏暗"。
// 用法：node tools/daycycle-check.mjs
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const REF = path.join(
  REPO_ROOT,
  'assets/source/reference/age-of-sail-style-sheet.png',
)
const PRESET_KEY = 'age-of-exploration:ocean-preset:v1'
const frozen = { animationPaused: true, timeOffset: 0 }

// 参考图右上角四张缩略图里的水面区域
// 各缩略图标签条的实测位置：清晨 90-113、正午 200-228、黄昏 320-350、夜晚 443-462。
// 下面这些条带是标签条之上的真实水面，不能碰到标签条。
const REF_REGIONS = {
  清晨: [1200, 55, 325, 32],
  正午: [1200, 160, 325, 37],
  黄昏: [1200, 276, 325, 42],
  夜晚: [1200, 378, 325, 57],
}
// 参考缩略图那个水带是中景水，所以除了最底部近景，再测一条紧贴地平线的中景带做交叉验证，
// 否则会把"取样距离不同"误判成"画面偏暗"。
const MINE_NEAR = [20, 500, 990, 360]
const MINE_MID = [20, 300, 990, 120]

const MEASURE = ([src, region]) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onerror = () => reject(new Error('load failed'))
    img.onload = () => {
      const [sx, sy, sw, sh] = region
      const canvas = document.createElement('canvas')
      canvas.width = sw
      canvas.height = sh
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
      const { data } = ctx.getImageData(0, 0, sw, sh)
      const lums = []
      let r = 0
      let g = 0
      let b = 0
      let warm = 0
      let n = 0
      for (let i = 0; i < data.length; i += 4) {
        const R = data[i]
        const G = data[i + 1]
        const B = data[i + 2]
        r += R
        g += G
        b += B
        lums.push(0.2126 * R + 0.7152 * G + 0.0722 * B)
        if (R > B + 10) warm++
        n++
      }
      lums.sort((a, c) => a - c)
      const hex = (v) => Math.round(v).toString(16).padStart(2, '0')
      resolve({
        mean: '#' + hex(r / n) + hex(g / n) + hex(b / n),
        p10: Math.round(lums[Math.floor(n * 0.1)]),
        p50: Math.round(lums[Math.floor(n * 0.5)]),
        p90: Math.round(lums[Math.floor(n * 0.9)]),
        warm: +(warm / n).toFixed(3),
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
  if (m.type() === 'error') errors.push(m.text().slice(0, 160))
})
await page.addInitScript(
  ([key, value]) => localStorage.setItem(key, value),
  [PRESET_KEY, JSON.stringify(frozen)],
)
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => document.querySelector('canvas')?.dataset.ready === 'true',
  null,
  {
    timeout: 45000,
  },
)
await page.getByRole('button', { name: '载入', exact: true }).click()
await page.waitForTimeout(1200)

const fmt = (m) =>
  `mean ${m.mean}  p10 ${String(m.p10).padStart(3)}  p50 ${String(m.p50).padStart(3)}  p90 ${String(m.p90).padStart(3)}  暖色 ${(m.warm * 100).toFixed(1)}%`

for (const [label, region] of Object.entries(REF_REGIONS)) {
  const ref = await page.evaluate(MEASURE, ['/@fs' + REF, region])
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.waitForTimeout(1600)
  const shot = await page.screenshot()
  const dataUrl = 'data:image/png;base64,' + shot.toString('base64')
  const near = await page.evaluate(MEASURE, [dataUrl, MINE_NEAR])
  const mid = await page.evaluate(MEASURE, [dataUrl, MINE_MID])
  console.log(`\n== ${label} ==`)
  console.log('  参考(中景) :', fmt(ref))
  console.log('  当前(近景) :', fmt(near))
  console.log('  当前(中景) :', fmt(mid))
}
if (errors.length) console.log('\nerrors =', JSON.stringify(errors.slice(0, 3)))
await browser.close()
