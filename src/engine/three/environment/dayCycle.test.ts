import { describe, expect, it } from 'vitest'
import { advanceDay, daylightAt, formatSkyTime } from './dayCycle'

describe('compressed visual day', () => {
  it('completes one day in 120 seconds and respects acceleration and hold', () => {
    expect(advanceDay(15, 120, 1)).toBeCloseTo(15)
    expect(advanceDay(15, 10, 12)).toBeCloseTo(15)
    expect(advanceDay(15, 10, 4)).toBeCloseTo(23)
    expect(advanceDay(15, 10, 0)).toBe(15)
  })
  it('wraps midnight and produces continuous dawn and dusk', () => {
    expect(advanceDay(23.9, 1, 1)).toBeCloseTo(0.1)
    expect(daylightAt(12).daylight).toBe(1)
    expect(daylightAt(0).daylight).toBe(0)
    expect(daylightAt(6).daylight).toBeGreaterThan(0)
    expect(daylightAt(6).daylight).toBeLessThan(1)
    expect(daylightAt(6).daylight).toBeCloseTo(daylightAt(18).daylight)
    expect(formatSkyTime(24.5)).toBe('00:30')
  })
})
