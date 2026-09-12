import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultPort } from '../domain/port'
import { ExplorationDatabase, IndexedDbPortRepository } from './indexedDb'

const databases: ExplorationDatabase[] = []
function open(name = `test-${crypto.randomUUID()}`) {
  const db = new ExplorationDatabase(name)
  databases.push(db)
  return { db, repository: new IndexedDbPortRepository(db) }
}
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete()
})

describe('IndexedDB port persistence', () => {
  it('restores a document after closing and reopening the database', async () => {
    const first = open()
    const port = createDefaultPort()
    port.name = '远航港'
    await first.repository.save(port)
    first.repository.close()
    const second = new ExplorationDatabase(first.db.name)
    const repository = new IndexedDbPortRepository(second)
    try {
      expect(await repository.load(port.id)).toEqual(port)
      expect(await repository.load('missing')).toBeUndefined()
    } finally {
      repository.close()
    }
  })

  it('rejects invalid writes without replacing the previous document', async () => {
    const { repository } = open()
    const port = createDefaultPort()
    await repository.save(port)
    await expect(repository.save({ ...port, name: ' ' })).rejects.toThrow()
    expect(await repository.load(port.id)).toEqual(port)
  })

  it('rejects unsupported document versions on read', async () => {
    const { db, repository } = open()
    const port = createDefaultPort()
    await db.ports.put(port)
    await db.ports.update(port.id, { schemaVersion: 99 } as never)
    await expect(repository.load(port.id)).rejects.toThrow()
  })
})
