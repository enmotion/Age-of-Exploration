import type { PortDefinition } from '../domain/port'

export interface PortRepository {
  load(id: string): Promise<PortDefinition | undefined>
  save(port: PortDefinition): Promise<void>
  close(): void
}
