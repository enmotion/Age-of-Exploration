export function generateCity(seed: number) {
  let state = seed >>> 0
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
  return Array.from({ length: 18 }, (_, index) => ({
    id: index,
    x: (index % 6) * 9 - 23,
    z: Math.floor(index / 6) * 12 - 19,
    height: 4 + random() * 6,
    width: 5 + random() * 2,
    tone: Math.floor(random() * 3),
  }))
}
