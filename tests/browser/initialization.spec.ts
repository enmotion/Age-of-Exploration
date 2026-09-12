import { expect, test } from '@playwright/test'

test('runs the art-directed ocean and only exposes live controls', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('/')
  const canvas = page.locator('canvas[aria-label="Interactive ocean demo"]')
  await expect(canvas).toHaveAttribute('data-ready', 'true', {
    timeout: 45_000,
  })
  await expect(
    page.getByRole('complementary', { name: '海面调节面板' }),
  ).toBeVisible()

  const viewport = page.viewportSize()!
  expect(await canvas.boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: viewport.width,
    height: viewport.height,
  })

  for (const group of [
    '场景与播放',
    '海面网格',
    '风浪与涌浪',
    '大中小波分层',
    '折面、明暗与水色',
    '天空与碎金光路',
    '浪尖白沫',
    '船体、尾迹与浮力',
    '雾与镜头',
  ]) {
    await expect(
      page.getByRole('button', { name: group, exact: true }),
    ).toBeVisible()
  }

  await page.getByRole('button', { name: '浪尖白沫', exact: true }).click()
  const foam = page.getByLabel('浪尖白沫 · 覆盖强度', {
    exact: true,
  })
  await foam.fill('2.5')
  await expect(foam).toHaveValue('2.5')
  expect(
    await foam.evaluate((input: HTMLInputElement) => input.checkValidity()),
  ).toBe(true)

  await expect(page.locator('.control-row')).toHaveCount(75)
  await expect(page.locator('.control-row.is-disabled')).toHaveCount(0)
  await expect(canvas).toHaveAttribute('data-active-controls', '75')
  await expect(canvas).toHaveAttribute('data-inactive-controls', '0')

  await page.getByRole('button', { name: '黄昏', exact: true }).click()
  await expect(
    page.getByLabel('天空与碎金光路 · 太阳高度', { exact: true }),
  ).toHaveValue('0.1')

  await page.locator('.panel-toggle').click()
  await expect(foam).toBeHidden()

  await page.setViewportSize({ width: 390, height: 844 })
  expect(await canvas.boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: 390,
    height: 844,
  })
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth === innerWidth &&
        document.documentElement.scrollHeight === innerHeight,
    ),
  ).toBe(true)
  expect(errors).toEqual([])
})
