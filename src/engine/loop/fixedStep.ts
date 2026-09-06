/** Caps frame debt after suspension to prevent a background-tab catch-up spiral. */
export function createFixedStepper(step: (dt: number) => void, hz = 30) {
  const dt = 1 / hz
  let accumulator = 0
  return {
    advance(elapsed: number) {
      accumulator += Math.max(0, Math.min(elapsed, 0.25))
      while (accumulator + 1e-10 >= dt) {
        step(dt)
        accumulator -= dt
      }
      return Math.max(0, accumulator / dt)
    },
    reset() {
      accumulator = 0
    },
  }
}
