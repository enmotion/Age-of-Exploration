import { describe, expect, it } from 'vitest'
import { oceanHeight, waveScaleForWind } from './waves'

describe('wind-oriented ocean field', () => {
  it('rotates the shared wave field with the wind heading', () => {
    const x = 17.25
    const z = -8.4
    const time = 3.7
    expect(oceanHeight(x, z, time, 90)).toBeCloseTo(oceanHeight(z, -x, time), 10)
  })

  it('keeps the legacy field unchanged at a zero heading', () => {
    expect(oceanHeight(12, 6, 2)).toBe(oceanHeight(12, 6, 2, 0))
  })
})

describe('wind to wave scaling', () => {
  it('keeps growing beyond 30 knots without scaling hurricane waves linearly', () => {
    expect(waveScaleForWind(120)).toBeGreaterThan(waveScaleForWind(30))
    expect(waveScaleForWind(120)).toBeLessThan(120 / 14)
  })
})
