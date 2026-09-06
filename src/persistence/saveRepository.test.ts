import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { IndexedDbSaveRepository, saveSchema, type GameSave } from './saveRepository'

const save: GameSave = {
  schemaVersion: 1,
  savedAt: '2026-09-06T00:00:00.000Z',
  gameHours: 8,
  gold: 2400,
  portId: 'lisbon',
  scene: 'city',
  vessel: { longitude: -9.2, latitude: 38.67, heading: 210, speed: 0, sail: 0 },
}
let repository: IndexedDbSaveRepository | undefined
afterEach(async () => {
  await repository?.delete()
})
describe('versioned IndexedDB saves', () => {
  it('starts empty and restores a complete save from a reopened database', async () => {
    repository = new IndexedDbSaveRepository('save-roundtrip-test')
    expect(await repository.load()).toBeUndefined()
    await repository.save(save)
    repository.close()
    repository = new IndexedDbSaveRepository('save-roundtrip-test')
    expect(await repository.load()).toEqual(save)
  })
  it('rejects invalid saves without replacing the last valid save', async () => {
    repository = new IndexedDbSaveRepository('save-validation-test')
    await repository.save(save)
    await expect(repository.save({ ...save, gold: -1 })).rejects.toThrow()
    expect(await repository.load()).toEqual(save)
  })
  it('rejects future versions, unknown ports and cities without ports', () => {
    for (const invalid of [
      { ...save, schemaVersion: 2 },
      { ...save, portId: 'unknown' },
      { ...save, portId: null },
      { ...save, vessel: { ...save.vessel, latitude: 100 } },
    ]) {
      expect(saveSchema.safeParse(invalid).success).toBe(false)
    }
  })
})
