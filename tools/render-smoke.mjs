import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import console from 'node:console'
import process from 'node:process'
import { mkdir } from 'node:fs/promises'

const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || 'chrome',
  headless: true,
})
const output = 'test-results/environment'
await mkdir(output, { recursive: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`)
  })
  await page.goto(process.env.VISUAL_TEST_URL || 'http://127.0.0.1:5175/')
  await page.getByRole('group', { name: '昼夜变化速度' }).waitFor()
  const hold = page.getByRole('button', { name: '定格', exact: true })
  await hold.click()
  await page.screenshot({ path: `${output}/day.png` })
  const time = await page.locator('.sky-clock time').textContent()
  await page.waitForTimeout(350)
  assert.equal(
    await page.locator('.sky-clock time').textContent(),
    time,
    'hold must stop the visual clock',
  )
  for (const [name, hour] of [
    ['sunset', 17],
    ['night', 22],
  ]) {
    await page.getByRole('button', { name: '12×', exact: true }).click()
    await page.waitForFunction(
      // eslint-disable-next-line no-undef -- callback executes inside the browser
      (h) => document.querySelector('.sky-clock time')?.textContent?.startsWith(`${h}:`),
      hour,
      { timeout: 30000 },
    )
    await hold.click()
    await page.screenshot({ path: `${output}/${name}.png` })
  }
  const canvas = page.locator('.sailing-canvas canvas')
  await page.getByRole('button', { name: '黄昏', exact: true }).click()
  await page.waitForTimeout(250)
  assert.equal(await page.locator('.sky-clock time').textContent(), '17:39')
  await page.screenshot({ path: `${output}/dusk-whitecaps.png` })
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${output}/dusk-whitecaps-later.png` })
  await page.getByRole('button', { name: '晴日', exact: true }).click()
  await page.waitForTimeout(250)
  assert.equal(await page.locator('.sky-clock time').textContent(), '12:00')
  await page.screenshot({ path: `${output}/noon-whitecaps.png` })
  await page.getByRole('button', { name: /扬帆出航/ }).click()
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${output}/wake-straight.png` })
  await page.keyboard.press('Tab')
  await page.keyboard.down('d')
  await page.waitForTimeout(1600)
  await page.keyboard.up('d')
  await page.screenshot({ path: `${output}/wake-turn.png` })
  const box = await canvas.boundingBox()
  assert.ok(box)
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.65, { steps: 12 })
  await page.mouse.up()
  await page.screenshot({ path: `${output}/orbit.png` })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${output}/mobile.png` })
  assert.equal(await page.locator('.scene-error').count(), 0, '3D scene must render')
  assert.equal(await page.locator('.asset-status').count(), 0, 'ship model must load')
  assert.deepEqual(errors, [], 'browser and shader errors')
  console.log(
    `Environment smoke passed: day, sunset, night, hold, sailing wake, turn, orbit, mobile. Screenshots: ${output}`,
  )
} finally {
  await browser.close()
}
