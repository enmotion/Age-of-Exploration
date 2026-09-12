import { assertKnownAssets } from '../assets/catalog'
import { portSchema, type PortDefinition } from '../domain/port'

/** Shared validation entry point for future editor/import flows. */
export function parsePortDocument(value: unknown): PortDefinition {
  const port = portSchema.parse(value)
  assertKnownAssets(port.objects.map((object) => object.assetId))
  return port
}
