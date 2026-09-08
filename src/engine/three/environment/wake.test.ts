import { describe, expect, it } from 'vitest'
import { createWake } from './wake'
import { sampleShipMotion, SHIP_DRAFT } from './shipMotion'
import { MAX_WAVE_HEIGHT } from './waves'

describe('ship waterline and trail', () => {
  it('keeps the hull submerged throughout a wave cycle', () => {
    for (let time = 0; time < 20; time += 0.5) {
      const motion = sampleShipMotion(20, 30, 1.2, time)
      expect(motion.height).toBeLessThan(0)
      expect(Math.abs(motion.height + SHIP_DRAFT)).toBeLessThan(MAX_WAVE_HEIGHT)
      expect(Math.abs(motion.pitch)).toBeLessThan(0.15)
      expect(Math.abs(motion.roll)).toBeLessThan(0.2)
    }
  })
  it('keeps old foam positions when steering, then expires after stopping', () => {
    const wake = createWake()
    wake.update(0, 0, 0, 8, 0, 1, false)
    wake.update(0, -10, 0, 8, 1, 1, false)
    const geometry = wake.mesh.geometry
    const count = geometry.drawRange.count
    const p = geometry.attributes.position!
    // Last populated row is the oldest retained cross section.
    const lastRow = count / (12 * 6)
    const oldX = p.getX(lastRow * 13 + 6),
      oldZ = p.getZ(lastRow * 13 + 6)
    wake.update(10, -10, Math.PI / 2, 8, 2, 1, false)
    const newLastRow = geometry.drawRange.count / (12 * 6)
    expect(p.getX(newLastRow * 13 + 6)).toBeCloseTo(oldX)
    expect(p.getZ(newLastRow * 13 + 6)).toBeCloseTo(oldZ)
    wake.update(10, -10, Math.PI / 2, 0, 11, 1, false)
    expect(wake.mesh.visible).toBe(false)
    expect(geometry.drawRange.count).toBe(0)
    wake.dispose()
  })
})
