import { describe, expect, it } from 'vitest'
import { defaultConditions, distanceNm, stepSailing, type VesselState } from './sailing'
import { createFixedStepper } from '../../engine/loop/fixedStep'

const vessel = (heading = 210): VesselState => ({
  longitude: -9.2,
  latitude: 38.67,
  heading,
  speed: 0,
  sail: 1,
})
function cruise(overrides = {}, heading = 210) {
  const ship = vessel(heading)
  for (let i = 0; i < 300; i++)
    stepSailing(
      ship,
      { rudder: 0, sail: 1 },
      { ...defaultConditions, ...overrides },
      1 / 30,
      1 / 120,
    )
  return ship
}
describe('sailing in geographic coordinates', () => {
  it('moves approximately one nautical mile per minute of latitude', () => {
    expect(distanceNm([0, 0], [0, 1])).toBeCloseTo(60.04, 1)
    expect(distanceNm([-9.2, 38.67], [-9.2, 38.67])).toBe(0)
  })
  it('wind direction, cargo and hull affect speed', () => {
    const baseline = cruise().speed
    expect(cruise({}, 30).speed).toBeLessThan(baseline * 0.3)
    expect(cruise({ load: 1 }).speed).toBeLessThan(baseline)
    expect(cruise({ hull: 0.5 }).speed).toBeCloseTo(baseline * 0.5)
  })
  it('moves north and east using nautical units and wraps at the dateline', () => {
    const ship = { ...vessel(90), longitude: 179.999, latitude: 0, speed: 10 }
    stepSailing(
      ship,
      { rudder: 0, sail: 1 },
      { ...defaultConditions, windHeading: 90, load: 0, windSpeed: 20 },
      1,
      1,
    )
    expect(ship.longitude).toBeLessThan(-179)
    expect(distanceNm([179.999, 0], [ship.longitude, ship.latitude])).toBeCloseTo(10, 4)
    expect(Math.abs(ship.latitude)).toBeLessThan(0.0001)
  })
  it('bounds rudder, heading and sail input', () => {
    const ship = vessel(359)
    stepSailing(ship, { rudder: 9, sail: 2 }, defaultConditions, 1, 0)
    expect(ship.heading).toBe(34)
    expect(ship.sail).toBe(1)
    expect(ship.longitude).toBeCloseTo(-9.2)
  })
  it('converges to rest when sails are lowered', () => {
    const ship = cruise()
    for (let i = 0; i < 300; i++)
      stepSailing(ship, { rudder: 0, sail: 0 }, defaultConditions, 1 / 30, 0)
    expect(ship.speed).toBeLessThan(0.001)
  })
})
describe('fixed-step simulation', () => {
  it('produces equivalent state at 30 and 60 fps', () => {
    function run(fps: number) {
      const ship = vessel()
      const loop = createFixedStepper((dt) =>
        stepSailing(ship, { rudder: 0.2, sail: 1 }, defaultConditions, dt, dt * 0.25),
      )
      for (let i = 0; i < fps * 10; i++) loop.advance(1 / fps)
      return ship
    }
    expect(run(30)).toEqual(run(60))
  })
  it('caps suspended-frame catch-up and can clear elapsed debt', () => {
    let steps = 0
    const loop = createFixedStepper(() => steps++)
    loop.advance(120)
    expect(steps).toBeLessThanOrEqual(8)
    loop.reset()
    steps = 0
    loop.advance(1 / 60)
    expect(steps).toBe(0)
  })
})
