import { z } from 'zod'

export const portSchema = z.object({
  id: z.string(),
  name: z.string(),
  region: z.string(),
  coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-85).max(85)]),
  styleKitId: z.enum(['iberian', 'north-african']),
  seed: z.number().int(),
  dockingRadiusMeters: z.number().positive(),
})
export type PortDefinition = z.infer<typeof portSchema>

// Port approach coordinates; inland navigation (including Seville) comes in Phase 2.
export const ports = z.array(portSchema).parse([
  {
    id: 'lisbon',
    name: '里斯本',
    region: '葡萄牙 · 特茹河口',
    coordinates: [-9.2, 38.67],
    styleKitId: 'iberian',
    seed: 1492,
    dockingRadiusMeters: 12000,
  },
  {
    id: 'seville',
    name: '塞维利亚外港',
    region: '伊比利亚 · 瓜达尔基维尔河口',
    coordinates: [-6.45, 36.78],
    styleKitId: 'iberian',
    seed: 1493,
    dockingRadiusMeters: 12000,
  },
  {
    id: 'cadiz',
    name: '加的斯',
    region: '伊比利亚 · 安达卢西亚',
    coordinates: [-6.32, 36.53],
    styleKitId: 'iberian',
    seed: 1494,
    dockingRadiusMeters: 12000,
  },
  {
    id: 'tangier',
    name: '丹吉尔',
    region: '北非 · 直布罗陀海峡',
    coordinates: [-5.81, 35.81],
    styleKitId: 'north-african',
    seed: 1495,
    dockingRadiusMeters: 12000,
  },
  {
    id: 'casablanca',
    name: '卡萨布兰卡',
    region: '北非 · 大西洋沿岸',
    coordinates: [-7.64, 33.63],
    styleKitId: 'north-african',
    seed: 1496,
    dockingRadiusMeters: 12000,
  },
  {
    id: 'funchal',
    name: '丰沙尔',
    region: '葡萄牙 · 马德拉群岛',
    coordinates: [-16.92, 32.62],
    styleKitId: 'iberian',
    seed: 1497,
    dockingRadiusMeters: 12000,
  },
  {
    id: 'las-palmas',
    name: '拉斯帕尔马斯',
    region: '加那利群岛 · 大加那利岛',
    coordinates: [-15.41, 28.14],
    styleKitId: 'iberian',
    seed: 1498,
    dockingRadiusMeters: 12000,
  },
])

export const homePort = ports[0]!
export function getPort(id: string) {
  return ports.find((port) => port.id === id)
}
