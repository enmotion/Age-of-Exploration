import Dexie, { type Table } from 'dexie'
import { portSchema, type PortDefinition } from '../domain/port'
import type { PortRepository } from './portRepository'

/** Database schema versions and document schemaVersion serve different purposes. */
export class ExplorationDatabase extends Dexie {
  ports!: Table<PortDefinition, string>

  constructor(name = 'age-of-exploration') {
    super(name)
    this.version(1).stores({ ports: '&id, name' })
  }
}

export class IndexedDbPortRepository implements PortRepository {
  constructor(private readonly database = new ExplorationDatabase()) {}

  async load(id: string): Promise<PortDefinition | undefined> {
    const record = await this.database.ports.get(id)
    return record === undefined ? undefined : portSchema.parse(record)
  }

  async save(port: PortDefinition): Promise<void> {
    // Parsing also strips reactive proxies before structured cloning to IndexedDB.
    const data = portSchema.parse(port)
    await this.database.transaction('rw', this.database.ports, async () => {
      await this.database.ports.put(data)
    })
  }

  close(): void {
    this.database.close()
  }
}
