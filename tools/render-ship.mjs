import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import console from 'node:console'
import process from 'node:process'

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true })
const origin = process.env.VISUAL_TEST_URL || 'http://127.0.0.1:5176/'
await mkdir('test-results/ship', { recursive: true })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`) })
  await page.goto(new URL('tools/ship-preview.html', origin).href)
  await page.getByText('模型已载入 · 几何与比例保持一致').waitFor()
  await page.screenshot({ path: 'test-results/ship/material-comparison.png' })
  await page.goto(origin)
  await page.getByRole('button', { name: '晴日', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.asset-status')) // eslint-disable-line no-undef
  await page.waitForTimeout(1000)
  await page.screenshot({ path: 'test-results/ship/in-game-day.png' })
  await page.getByRole('button', { name: '黄昏', exact: true }).click()
  await page.screenshot({ path: 'test-results/ship/in-game-dusk.png' })
  assert.deepEqual(errors, [])
  console.log('Ship preview and in-game materials loaded without browser/shader errors.')
} finally {
  await browser.close()
}
