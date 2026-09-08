import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, weld } from '@gltf-transform/functions'
import sharp from 'sharp'

// This unwrap is specific to Kenney Pirate Kit 2.1 ship-large, whose U columns
// identify surfaces and whose V values encode painted lighting, not surface UVs.
export async function buildShipMaterials(root) {
  const folder = resolve(root, 'assets/source/ships/caravel')
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  const document = await io.read(
    resolve(root, 'assets/vendor/kenney-pirate-kit/Models/GLB format/ship-large.glb'),
  )
  const buffer = document.getRoot().listBuffers()[0]
  const master = resolve(folder, 'material-atlas.png')
  const { width, height } = await sharp(master).metadata()
  const half = Math.floor(width / 2)
  if (width !== height || width % 2) throw new Error('Ship atlas must have four equal quadrants')
  const sets = {}
  await mkdir(resolve(folder, 'textures'), { recursive: true })

  for (const [name, quadrant, roughness, metalness, relief] of [
    ['oak', 0, 0.84, 0, 0.65],
    ['deck', 1, 0.91, 0, 0.5],
    ['canvas', 2, 0.96, 0, 0.22],
    ['iron', 3, 0.68, 0.72, 0.32],
  ]) {
    const size = 512
    const pixels = await sharp(master)
      .extract({ left: (quadrant % 2) * half, top: Math.floor(quadrant / 2) * half, width: half, height: half })
      .resize(size, size)
      .removeAlpha()
      .raw()
      .toBuffer()
    const luminance = new Float32Array(size * size)
    for (let i = 0; i < luminance.length; i++) {
      luminance[i] = (pixels[i * 3] * 0.2126 + pixels[i * 3 + 1] * 0.7152 + pixels[i * 3 + 2] * 0.0722) / 255
    }
    // Approximate microrelief from albedo, not a high-poly normal/AO bake.
    // Clamp the derivative at tile edges; mirrored wrapping avoids color jumps.
    const sample = (x, y) => luminance[Math.max(0, Math.min(size - 1, y)) * size + Math.max(0, Math.min(size - 1, x))]
    const normals = new Uint8Array(size * size * 3)
    const orm = new Uint8Array(size * size * 3)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 3
        const dx = (sample(x - 1, y) - sample(x + 1, y)) * relief
        // glTF tangent +Y points toward increasing V (down the image).
        const dy = (sample(x, y - 1) - sample(x, y + 1)) * relief
        const length = Math.hypot(dx, dy, 1)
        normals[i] = Math.round((dx / length * 0.5 + 0.5) * 255)
        normals[i + 1] = Math.round((dy / length * 0.5 + 0.5) * 255)
        normals[i + 2] = Math.round((1 / length * 0.5 + 0.5) * 255)
        orm[i] = 255 // No fabricated geometry occlusion in the R channel.
        orm[i + 1] = Math.round(Math.min(1, roughness + (0.5 - sample(x, y)) * 0.12) * 255)
        orm[i + 2] = Math.round(metalness * 255)
      }
    }
    sets[name] = {}
    for (const [kind, bytes] of [['basecolor', pixels], ['normal', normals], ['orm', orm]]) {
      const png = await sharp(bytes, { raw: { width: size, height: size, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer()
      await writeFile(resolve(folder, `textures/${name}-${kind}.png`), png)
      // Keep editable PNG masters; only color uses JPEG in the browser GLB.
      const image = kind === 'basecolor' ? await sharp(png).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer() : png
      sets[name][kind] = document.createTexture(`${name}-${kind}`).setImage(image).setMimeType(kind === 'basecolor' ? 'image/jpeg' : 'image/png')
    }
  }

  const materials = {}
  for (const [name, set, tint] of [
    ['hull', 'oak', [1, 1, 1, 1]],
    ['deck', 'deck', [1, 1, 1, 1]],
    ['spars', 'oak', [0.85, 0.78, 0.68, 1]],
    ['canvas', 'canvas', [1, 1, 1, 1]],
    ['rope', 'canvas', [0.38, 0.30, 0.20, 1]],
    ['iron', 'iron', [1, 1, 1, 1]],
  ]) {
    const textures = sets[set]
    const material = document.createMaterial(`caravel-${name}`)
      .setBaseColorFactor(tint)
      .setBaseColorTexture(textures.basecolor)
      .setNormalTexture(textures.normal)
      .setNormalScale(0.65)
      .setMetallicRoughnessTexture(textures.orm)
      .setRoughnessFactor(1)
      .setMetallicFactor(set === 'iron' ? 1 : 0)
      .setDoubleSided(true)
    for (const info of [material.getBaseColorTextureInfo(), material.getNormalTextureInfo(), material.getMetallicRoughnessTextureInfo()]) {
      info.setWrapS(33648).setWrapT(33648).setMinFilter(9987).setMagFilter(9729)
    }
    materials[name] = material
  }

  const audit = []
  for (const mesh of document.getRoot().listMeshes()) {
    const original = mesh.listPrimitives()[0]
    const positions = original.getAttribute('POSITION')
    const normals = original.getAttribute('NORMAL')
    const palette = original.getAttribute('TEXCOORD_0')
    const indices = original.getIndices()
    const groups = new Map()
    const name = mesh.getName()
    for (let i = 0; i < indices.getCount(); i += 3) {
      const triangle = [0, 1, 2].map((offset) => indices.getScalar(i + offset))
      const points = triangle.map((index) => positions.getElement(index, []))
      const column = Math.round(palette.getElement(triangle[0], [])[0] * 32)
      const n = [0, 1, 2].map((axis) => triangle.reduce((sum, index) => sum + normals.getElement(index, [])[axis], 0) / 3)
      const center = [0, 1, 2].map((axis) => points.reduce((sum, p) => sum + p[axis], 0) / 3)
      let surface
      if (column === 19) surface = name.startsWith('flag') || name.startsWith('sail') || center[2] > 4.5 ? 'canvas' : 'rope'
      else if (column === 3) surface = 'iron'
      else if (column === 27 || name.startsWith('sail') || (Math.abs(center[0]) < 0.32 && center[1] > 2.4 && [-0.356, -5.357, 4.215].some((z) => Math.abs(center[2] - z) < 0.3))) surface = 'spars'
      else surface = n[1] > 0.65 && center[1] > 1.8 && center[1] < 3.5 ? 'deck' : 'hull'
      const group = groups.get(surface) ?? { positions: [], normals: [], uv: [], colors: [] }
      groups.set(surface, group)
      const uvStart = group.uv.length
      for (let j = 0; j < 3; j++) {
        const p = points[j]
        const [x, y, z] = p
        let uv
        if (surface === 'canvas' && name.startsWith('sail')) {
          uv = [(x + 2.2) / 4.4, 1 - y / (name === 'sail-a' ? 4.725 : 3.625)]
        } else if (surface === 'canvas' || surface === 'rope') {
          uv = [z / 1.4, -y / 1.4]
        } else if (surface === 'deck') {
          uv = [z / 4.5, x / 1.5]
        } else if (surface === 'spars') {
          // The source dark-wood column contains masts and posts; sail nodes contain yards.
          uv = name.startsWith('sail') ? [x / 2, 0.045 + z * 0.04] : [y / 2, 0.045 + (x + z) * 0.015]
        } else if (Math.abs(n[1]) > 0.75) {
          uv = [z / 4.5, x / 1.5]
        } else {
          // Separate bow/stern projections from port/starboard to avoid stretched ends.
          uv = [Math.abs(n[0]) >= Math.abs(n[2]) ? z / 4.5 : x / 4.5, -y / 1.5]
        }
        group.positions.push(...p)
        group.normals.push(...normals.getElement(triangle[j], []))
        group.uv.push(...uv)
        const wet = surface === 'hull' ? 0.62 + 0.38 * Math.min(1, Math.max(0, (y - 0.15) / 0.65)) : 1
        group.colors.push(wet, wet, wet, 1)
      }
      const [au, av, bu, bv, cu, cv] = group.uv.slice(uvStart)
      if (Math.abs((bu - au) * (cv - av) - (bv - av) * (cu - au)) < 1e-10) {
        // Cloth hems, spar end caps and thin rail edges need a secondary plane.
        const a = points[1].map((v, axis) => v - points[0][axis])
        const b = points[2].map((v, axis) => v - points[0][axis])
        const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
        const axis = cross.map(Math.abs).indexOf(Math.max(...cross.map(Math.abs)))
        const axes = [0, 1, 2].filter((value) => value !== axis)
        group.uv.splice(uvStart, 6, ...points.flatMap((p) => [p[axes[0]] / 2, p[axes[1]] / 2]))
      }
    }
    mesh.removePrimitive(original)
    original.dispose()
    for (const [surface, data] of groups) {
      const accessor = (suffix, type, values) => document.createAccessor(`${name}-${surface}-${suffix}`, buffer).setType(type).setArray(new Float32Array(values))
      const count = data.positions.length / 3
      mesh.addPrimitive(document.createPrimitive()
        .setAttribute('POSITION', accessor('position', 'VEC3', data.positions))
        .setAttribute('NORMAL', accessor('normal', 'VEC3', data.normals))
        .setAttribute('TEXCOORD_0', accessor('uv', 'VEC2', data.uv))
        .setAttribute('COLOR_0', accessor('color', 'VEC4', data.colors))
        .setIndices(document.createAccessor(`${name}-${surface}-indices`, buffer).setType('SCALAR').setArray(Uint16Array.from({ length: count }, (_, index) => index)))
        .setMaterial(materials[surface]))
      audit.push({ mesh: name, surface, triangles: count / 3 })
    }
  }
  // Original tangents describe the collapsed palette UVs. Omit them so glTF/Three
  // computes a tangent frame from the new UVs rather than reusing invalid data.
  await document.transform(weld(), prune())
  const output = resolve(folder, 'caravel-pbr.glb')
  await io.write(output, document)
  await writeFile(resolve(folder, 'surface-audit.json'), JSON.stringify(audit, null, 2) + '\n')
  return output
}
