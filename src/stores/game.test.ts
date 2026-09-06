import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore } from './game'
import { IndexedDbSaveRepository } from '../persistence/saveRepository'

// Keep repository behaviour real, with isolated databases for every store test.
const databases = vi.hoisted(() => ({ names: [] as string[] }))
vi.mock('../persistence/saveRepository', async (importOriginal) => {
  const original = await importOriginal<typeof import('../persistence/saveRepository')>()
  return {
    ...original,
    IndexedDbSaveRepository: class extends original.IndexedDbSaveRepository {
      constructor() {
        const name = `game-test-${databases.names.length}`
        databases.names.push(name)
        super(name)
      }
    },
  }
})
beforeEach(() => setActivePinia(createPinia()))
afterEach(async () => {
  for (const name of databases.names) await IndexedDbSaveRepository.delete(name)
  databases.names.length = 0
})

describe('scene and sailing lifecycle', () => {
  it('supports enter city, return to chart, depart and dock without moving while in port', async () => {
    const game = useGameStore()
    await game.initialize()
    const initial = { ...game.telemetry }
    game.tick(1, { rudder: 1, sail: 1 })
    expect(game.telemetry).toEqual(initial)
    game.enterCity()
    expect(game.scene).toBe('city')
    game.showChart()
    expect(game.scene).toBe('world')
    game.depart()
    expect(game.portId).toBeNull()
    expect(game.telemetry.sail).toBe(1)
    game.enterCity()
    expect(game.scene).toBe('world')
    game.tick(0.1, { rudder: 1, sail: 1 })
    expect(game.telemetry.heading).toBeGreaterThan(initial.heading)
    expect(game.gameHours).toBeGreaterThan(0)
    game.dock()
    expect(game.scene).toBe('city')
    expect(game.portId).toBe('lisbon')
    expect(game.telemetry.speed).toBe(0)
    await game.save()
  })
  it('advances faster without faking knots and keeps date aligned with travel', async () => {
    const normal = useGameStore()
    await normal.initialize()
    normal.depart()
    setActivePinia(createPinia())
    const fast = useGameStore()
    await fast.initialize()
    fast.depart()
    fast.travelPace = 4
    for (let i = 0; i < 300; i++) {
      normal.tick(1 / 30, { rudder: 0, sail: 1 })
      fast.tick(1 / 30, { rudder: 0, sail: 1 })
    }
    expect(normal.gameHours).toBeCloseTo(10)
    expect(fast.gameHours).toBeCloseTo(40)
    expect(fast.telemetry.speed).toBeCloseTo(normal.telemetry.speed)
    expect(fast.nearestPort.distance).toBeGreaterThan(normal.nearestPort.distance)
    await normal.save()
    await fast.save()
  })
  it('halts date and position while paused and rejects docking outside port radius', async () => {
    const game = useGameStore()
    await game.initialize()
    game.depart()
    game.paused = true
    const initial = { ...game.telemetry }
    game.tick(1, { rudder: 1, sail: 1 })
    expect(game.telemetry).toEqual(initial)
    expect(game.gameHours).toBe(0)
    game.paused = false
    for (let i = 0; i < 1800; i++) game.tick(1 / 30, { rudder: 0, sail: 1 })
    expect(game.canDock).toBe(false)
    game.dock()
    expect(game.portId).toBeNull()
    expect(game.scene).toBe('world')
    await game.save()
  })
})
