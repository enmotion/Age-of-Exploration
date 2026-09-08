import { oceanHeight } from './waves'

export const SHIP_DRAFT = 2.2

export function sampleShipMotion(
  x: number,
  z: number,
  heading: number,
  time: number,
  waveScale = 1,
  windHeading = 0,
) {
  const fx = Math.sin(heading),
    fz = -Math.cos(heading)
  const rx = Math.cos(heading),
    rz = Math.sin(heading)
  const bow = oceanHeight(x + fx * 12, z + fz * 12, time, windHeading) * waveScale
  const stern = oceanHeight(x - fx * 12, z - fz * 12, time, windHeading) * waveScale
  const right = oceanHeight(x + rx * 4, z + rz * 4, time, windHeading) * waveScale
  const left = oceanHeight(x - rx * 4, z - rz * 4, time, windHeading) * waveScale
  return {
    height: (bow + stern + right + left) / 4 - SHIP_DRAFT,
    pitch: Math.atan2(bow - stern, 24),
    roll: Math.atan2(right - left, 8),
  }
}
