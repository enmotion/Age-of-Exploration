import { z } from 'zod'
import catalogJson from '../../../assets/catalog.json'

const transformSchema = z.object({
  scale: z.number().positive().optional(),
  rotationY: z.number().optional(),
  waterlineY: z.number().optional(),
})

const assetSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('model'),
  source: z.string().min(1),
  output: z.string().min(1),
  url: z.string().startsWith('/assets/'),
  licenseId: z.string().min(1),
  sourceUrl: z.url(),
  maxBytes: z.number().int().positive(),
  transform: transformSchema.optional(),
})

const catalogSchema = z.object({
  version: z.literal(1),
  assets: z.array(assetSchema),
})

export type ModelAsset = z.infer<typeof assetSchema>
const catalog = catalogSchema.parse(catalogJson)

export function getModelAsset(id: string): ModelAsset {
  const asset = catalog.assets.find((candidate) => candidate.id === id)
  if (!asset) throw new Error(`Unknown model asset: ${id}`)
  return asset
}
