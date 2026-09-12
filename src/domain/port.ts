import { z } from 'zod'

const vector = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
])
export const portSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(1, '请输入港口名称')
    .max(40, '名称最多 40 个字符'),
  objects: z
    .array(
      z.object({
        id: z.string().min(1),
        assetId: z.string().min(1),
        position: vector,
        rotation: vector,
        scale: z.tuple([
          z.number().positive(),
          z.number().positive(),
          z.number().positive(),
        ]),
      }),
    )
    .superRefine((objects, context) => {
      if (new Set(objects.map((object) => object.id)).size !== objects.length) {
        context.addIssue({ code: 'custom', message: '港口对象 ID 不能重复' })
      }
    }),
})
export type PortDefinition = z.infer<typeof portSchema>
export type PortObject = PortDefinition['objects'][number]

export function createDefaultPort(): PortDefinition {
  return {
    schemaVersion: 1,
    id: 'starter-port',
    name: '风帆港',
    objects: [
      {
        id: 'island',
        assetId: 'builtin:island',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      {
        id: 'dock',
        assetId: 'builtin:dock',
        position: [0, 0, -5],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      {
        id: 'ship',
        assetId: 'builtin:ship',
        position: [3.5, 0, -6],
        rotation: [0, -0.3, 0],
        scale: [1, 1, 1],
      },
    ],
  }
}
