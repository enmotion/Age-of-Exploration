import Dexie, { type Table } from 'dexie'
import { z } from 'zod'
import { getPort } from '../data/ports'

export const saveSchema = z
  .object({
    schemaVersion: z.literal(1),
    savedAt: z.string().datetime(),
    gameHours: z.number().finite().nonnegative(),
    gold: z.number().int().nonnegative(),
    portId: z
      .string()
      .refine((id) => Boolean(getPort(id)))
      .nullable(),
    scene: z.enum(['world', 'city']),
    vessel: z.object({
      longitude: z.number().min(-180).max(180),
      latitude: z.number().min(-85).max(85),
      heading: z.number().min(0).lt(360),
      speed: z.number().min(0).max(30),
      sail: z.number().min(0).max(1),
    }),
  })
  .refine(
    (save) => save.scene !== 'city' || save.portId !== null,
    'City saves require a valid port',
  )
export type GameSave = z.infer<typeof saveSchema>
export interface SaveRepository {
  load(): Promise<GameSave | undefined>
  save(data: GameSave): Promise<void>
}

export class IndexedDbSaveRepository extends Dexie implements SaveRepository {
  private saves!: Table<{ id: string; data: GameSave }, string>
  constructor(name = 'age-of-exploration') {
    super(name)
    this.version(1).stores({ saves: '&id' })
    this.saves = this.table('saves')
  }
  async load() {
    const row = await this.saves.get('autosave')
    // Future versions must add an explicit migration here. Never silently replace an unreadable save.
    return row ? saveSchema.parse(row.data) : undefined
  }
  async save(data: GameSave) {
    await this.saves.put({ id: 'autosave', data: saveSchema.parse(data) })
  }
}
