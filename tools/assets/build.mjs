import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import console from 'node:console'
import { buildShipMaterials } from './ship-materials.mjs'

const root = resolve(import.meta.dirname, '../..')
const catalog = JSON.parse(await readFile(resolve(root, 'assets/catalog.json'), 'utf8'))
const executable = resolve(root, 'node_modules/.bin/gltf-transform')

await buildShipMaterials(root)

function run(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { cwd: root, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`gltf-transform exited with ${code}`)),
    )
  })
}

for (const asset of catalog.assets) {
  if (asset.kind !== 'model') continue
  const input = resolve(root, asset.source)
  const output = resolve(root, asset.output)
  await mkdir(dirname(output), { recursive: true })
  console.log(`\n[asset] ${asset.id}`)
  await run([
    'optimize',
    input,
    output,
    '--compress',
    'meshopt',
    '--meshopt-level',
    'high',
    '--texture-compress',
    'auto',
    '--texture-size',
    '1024',
    '--simplify',
    'false',
  ])
}

// Preserve the generated master; publish a compact browser texture.
const { default: sharp } = await import('sharp')
await mkdir(resolve(root, 'public/assets/textures'), { recursive: true })
await sharp(resolve(root, 'assets/source/sky/milky-way.png'))
  .webp({ quality: 92 })
  .toFile(resolve(root, 'public/assets/textures/milky-way.webp'))
