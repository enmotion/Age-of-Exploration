import { chromium } from '@playwright/test'

const REF = '/Users/enmotion/works/git-project/Age-of-Exploration/assets/source/reference/age-of-sail-style-sheet.png'
const PRESET_KEY = 'age-of-exploration:ocean-preset:v1'
const overrides = JSON.parse(process.argv[2] ?? '{}')
const outPath = process.argv[3] ?? '/tmp/p2.png'

const MEASURE = ([src, region, k]) => {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const [sx, sy, sw, sh] = region
      const c = document.createElement('canvas')
      c.width = sw; c.height = sh
      const g = c.getContext('2d', { willReadFrequently: true })
      g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
      const { data } = g.getImageData(0, 0, sw, sh)
      const pts = []
      for (let i = 0; i < data.length; i += 16) pts.push([data[i], data[i + 1], data[i + 2]])
      const cents = []
      for (let i = 0; i < k; i++) cents.push(pts[Math.floor(((i + 0.5) / k) * pts.length)].slice())
      const assign = new Array(pts.length).fill(0)
      for (let it = 0; it < 12; it++) {
        for (let p = 0; p < pts.length; p++) {
          let best = 0, bd = Infinity
          for (let ci = 0; ci < k; ci++) {
            const d = (pts[p][0]-cents[ci][0])**2 + (pts[p][1]-cents[ci][1])**2 + (pts[p][2]-cents[ci][2])**2
            if (d < bd) { bd = d; best = ci }
          }
          assign[p] = best
        }
        const sum = Array.from({ length: k }, () => [0, 0, 0, 0])
        for (let p = 0; p < pts.length; p++) {
          const a = assign[p]
          sum[a][0] += pts[p][0]; sum[a][1] += pts[p][1]; sum[a][2] += pts[p][2]; sum[a][3]++
        }
        for (let ci = 0; ci < k; ci++) if (sum[ci][3]) cents[ci] = [sum[ci][0]/sum[ci][3], sum[ci][1]/sum[ci][3], sum[ci][2]/sum[ci][3]]
      }
      const counts = new Array(k).fill(0)
      for (const a of assign) counts[a]++
      const hex = (c2) => '#' + c2.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
      resolve(cents.map((c2, i) => ({ hex: hex(c2), weight: +(counts[i] / pts.length).toFixed(3) }))
        .sort((a, b) => b.weight - a.weight))
    }
    img.onerror = () => reject(new Error('image load failed: ' + src.slice(0, 60)))
    img.src = src
  })
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 880 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [PRESET_KEY, JSON.stringify(overrides)])

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.querySelector('canvas')?.dataset.ready === 'true', null, { timeout: 45000 })
const refPalette = await page.evaluate(MEASURE, ['/@fs' + REF, [0, 300, 1180, 210], 8])
if (Object.keys(overrides).length) {
  await page.getByRole('button', { name: '载入', exact: true }).click()
  await page.waitForTimeout(1000)
}
await page.waitForTimeout(2000)
const shot = await page.screenshot({ path: outPath })
const myPalette = await page.evaluate(MEASURE, [
  'data:image/png;base64,' + shot.toString('base64'), [20, 500, 990, 360], 8,
])

const lum = (h) => { const n = parseInt(h.slice(1), 16); return Math.round(0.2126*((n>>16)&255) + 0.7152*((n>>8)&255) + 0.0722*(n&255)) }
const fmt = (l) => l.map((x) => `${x.hex}(Y${lum(x.hex)},${x.weight})`).join('  ')
console.log('参考图水面 :', fmt(refPalette))
console.log('当前渲染   :', fmt(myPalette))
if (errors.length) console.log('errors =', JSON.stringify(errors.slice(0, 3)))
await browser.close()
