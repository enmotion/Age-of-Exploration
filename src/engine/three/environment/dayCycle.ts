export const DAY_DURATION_SECONDS = 120

export function advanceDay(hour: number, delta: number, speed: number) {
  return (((hour + (delta * speed * 24) / DAY_DURATION_SECONDS) % 24) + 24) % 24
}

export function daylightAt(hour: number) {
  const phase = ((hour - 6) / 24) * Math.PI * 2
  const elevation = Math.sin(phase)
  const t = Math.min(1, Math.max(0, (elevation + 0.16) / 0.38))
  return { elevation, daylight: t * t * (3 - 2 * t), phase }
}

export function formatSkyTime(hour: number) {
  const minutes = Math.floor((((hour % 24) + 24) % 24) * 60)
  return `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`
}
