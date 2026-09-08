import { access, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import console from 'node:console'
import process from 'node:process'
import { validateBytes } from 'gltf-validator'

const root = resolve(import.meta.dirname, '../..')
const catalog = JSON.parse(await readFile(resolve(root, 'assets/catalog.json'), 'utf8'))
const ids = new Set()
let failed = false

for (const asset of catalog.assets) {
  if (!asset.id || ids.has(asset.id)) {
    console.error(`[asset] duplicate or missing id: ${asset.id}`)
    failed = true
  }
  ids.add(asset.id)
  if (!asset.licenseId || !asset.sourceUrl || !asset.url?.startsWith('/assets/')) {
    console.error(`[asset] incomplete provenance: ${asset.id}`)
    failed = true
  }
  const output = resolve(root, asset.output)
  try {
    await access(output)
    const info = await stat(output)
    if (info.size > asset.maxBytes) {
      console.error(`[asset] ${asset.id}: ${info.size} bytes exceeds ${asset.maxBytes}`)
      failed = true
    }
    if (asset.kind === 'model') {
      const report = await validateBytes(new Uint8Array(await readFile(output)), {
        uri: asset.url,
        maxIssues: 100,
      })
      const errors = report.issues.numErrors
      const warnings = report.issues.numWarnings
      console.log(
        `[asset] ${asset.id}: ${(info.size / 1024).toFixed(1)} KiB, ${errors} errors, ${warnings} warnings`,
      )
      if (errors > 0) failed = true
    }
  } catch (error) {
    console.error(`[asset] ${asset.id}: ${error instanceof Error ? error.message : String(error)}`)
    failed = true
  }
}

if (failed) process.exitCode = 1

try {
  await access(resolve(root, 'assets/source/sky/PROVENANCE.md'))
  const sky = await stat(resolve(root, 'public/assets/textures/milky-way.webp'))
  if (sky.size > 1500000) throw new Error('Night sky exceeds 1.5 MB budget')
  console.log(`[asset] sky.milky-way: ${(sky.size / 1024).toFixed(1)} KiB`)
} catch (error) {
  console.error('[asset] sky.milky-way:', error)
  process.exitCode = 1
}
