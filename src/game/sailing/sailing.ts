export interface VesselState {
  longitude: number
  latitude: number
  heading: number
  speed: number
  sail: number
}
export interface SailingInput {
  rudder: number
  sail: number
}
export interface SailingConditions {
  windHeading: number
  windSpeed: number
  load: number
  hull: number
  crew: number
}
export const defaultConditions: SailingConditions = {
  windHeading: 210,
  windSpeed: 14,
  load: 0.2,
  hull: 1,
  crew: 1,
}
const radians = Math.PI / 180
const earthRadiusNm = 3440.065
export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export function distanceNm(a: [number, number], b: [number, number]): number {
  const dLat = (b[1] - a[1]) * radians
  const dLon = (b[0] - a[0]) * radians
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(dLon / 2) ** 2
  return 2 * earthRadiusNm * Math.asin(Math.sqrt(clamp(h, 0, 1)))
}

/** Mutates an ordinary object. dt is real seconds; gameHours is simulated hours. */
export function stepSailing(
  vessel: VesselState,
  input: SailingInput,
  conditions: SailingConditions,
  dt: number,
  gameHours: number,
) {
  if (dt <= 0 || gameHours < 0) return
  vessel.heading = (((vessel.heading + clamp(input.rudder, -1, 1) * 35 * dt) % 360) + 360) % 360
  vessel.sail = clamp(input.sail, 0, 1)
  // Wind heading is the direction the wind travels towards.
  const windEfficiency =
    0.18 + (0.82 * (1 + Math.cos((vessel.heading - conditions.windHeading) * radians))) / 2
  const target =
    Math.min(10, conditions.windSpeed * 0.65) *
    windEfficiency *
    vessel.sail *
    (1 - clamp(conditions.load, 0, 1) * 0.35) *
    clamp(conditions.hull, 0, 1) *
    clamp(conditions.crew, 0, 1)
  vessel.speed += (target - vessel.speed) * (1 - Math.exp(-dt * 1.5))
  const angularDistance = (vessel.speed * gameHours) / earthRadiusNm
  const latitude = vessel.latitude * radians
  const heading = vessel.heading * radians
  const nextLat = Math.asin(
    clamp(
      Math.sin(latitude) * Math.cos(angularDistance) +
        Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(heading),
      -1,
      1,
    ),
  )
  const nextLon =
    vessel.longitude * radians +
    Math.atan2(
      Math.sin(heading) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(nextLat),
    )
  vessel.latitude = clamp(nextLat / radians, -85, 85)
  vessel.longitude = ((nextLon / radians + 540) % 360) - 180
}
