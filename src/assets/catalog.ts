export interface AssetRecord {
  id: string
  name: string
  category: 'terrain' | 'structure' | 'vessel'
  version: number
  status: 'approved' | 'review' | 'deprecated'
  source: { kind: 'procedural'; author: string; license: string; path: string }
}

// All starter geometry is authored in this repository; no external assets are downloaded.
export const assetCatalog: readonly AssetRecord[] = [
  {
    id: 'builtin:island',
    name: '海岛与聚落',
    category: 'terrain',
    version: 1,
    status: 'approved',
    source: {
      kind: 'procedural',
      author: 'Age of Exploration project',
      license: 'Project-owned; no third-party content',
      path: 'src/engine/babylon/proceduralAssets.ts',
    },
  },
  {
    id: 'builtin:dock',
    name: '木质码头',
    category: 'structure',
    version: 1,
    status: 'approved',
    source: {
      kind: 'procedural',
      author: 'Age of Exploration project',
      license: 'Project-owned; no third-party content',
      path: 'src/engine/babylon/proceduralAssets.ts',
    },
  },
  {
    id: 'builtin:ship',
    name: '单桅帆船',
    category: 'vessel',
    version: 1,
    status: 'approved',
    source: {
      kind: 'procedural',
      author: 'Age of Exploration project',
      license: 'Project-owned; no third-party content',
      path: 'src/engine/babylon/proceduralAssets.ts',
    },
  },
]

export function assertKnownAssets(ids: string[]): void {
  const known = new Set(assetCatalog.map((asset) => asset.id))
  for (const id of ids) {
    if (!known.has(id)) throw new Error(`缺少资产：${id}`)
  }
}
