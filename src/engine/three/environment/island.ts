import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
} from 'three'

export const ISLAND_RADIUS = 88

export function coastlineRadius(angle: number) {
  return ISLAND_RADIUS * (1 + 0.09 * Math.sin(angle * 3) + 0.05 * Math.cos(angle * 5))
}

export function islandHeight(x: number, z: number) {
  const r = Math.hypot(x, z / 0.72) / coastlineRadius(Math.atan2(z / 0.72, x))
  const inland = Math.max(0, 1 - r)
  return (
    (1 - r) * 13 +
    Math.pow(Math.max(0, 1 - r / 0.73), 2) * 22 +
    (Math.sin(x * 0.12) * Math.cos(z * 0.09) * 3 + Math.sin(x * 0.24 + z * 0.18)) * inland
  )
}

/** Original, deterministic coastal kit: one terrain and instanced vegetation/rocks. */
export function createIsland() {
  const group = new Group()
  group.name = 'Jungle island scenery'
  let seed = 4921
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const terrain = new PlaneGeometry(240, 190, 112, 88)
  terrain.rotateX(-Math.PI / 2)
  const p = terrain.attributes.position!
  const colors: number[] = []
  const sand = new Color('#dcc494'),
    grass = new Color('#557345'),
    rock = new Color('#6e7669')
  const color = new Color()
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getZ(i),
      h = islandHeight(x, z)
    p.setY(i, h)
    color.copy(sand).lerp(grass, Math.min(1, Math.max(0, (h - 2.5) / 5)))
    if (h > 23) color.lerp(rock, Math.min(0.8, (h - 23) / 22))
    color.multiplyScalar(0.9 + random() * 0.15)
    colors.push(color.r, color.g, color.b)
  }
  terrain.setAttribute('color', new Float32BufferAttribute(colors, 3))
  terrain.computeVertexNormals()
  const land = new Mesh(terrain, new MeshStandardMaterial({ vertexColors: true, roughness: 0.96 }))
  land.receiveShadow = land.castShadow = true
  group.add(land)

  const dummy = new Object3D()
  function instances(geometry: BufferGeometry, material: MeshStandardMaterial, count: number) {
    const mesh = new InstancedMesh(geometry, material, count)
    mesh.castShadow = mesh.receiveShadow = true
    group.add(mesh)
    return mesh
  }
  function place(
    mesh: InstancedMesh,
    i: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    ry = 0,
    rz = 0,
  ) {
    dummy.position.set(x, y, z)
    dummy.scale.set(sx, sy, sz)
    dummy.rotation.set(0, ry, rz)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }
  const trunks = instances(
    new CylinderGeometry(0.2, 0.45, 1, 7),
    new MeshStandardMaterial({ color: '#6e5740', roughness: 1 }),
    115,
  )
  const crowns = instances(
    new IcosahedronGeometry(1, 2),
    new MeshStandardMaterial({ color: '#ffffff', roughness: 0.93 }),
    230,
  )
  for (let i = 0; i < 115; i++) {
    const angle = random() * Math.PI * 2,
      radius = Math.sqrt(random()) * 59
    const x = Math.cos(angle) * radius,
      z = Math.sin(angle) * radius * 0.72
    const h = islandHeight(x, z),
      height = 6 + random() * 9,
      size = 3 + random() * 3
    place(trunks, i, x, h + height / 2, z, 1, height, 1)
    for (let j = 0; j < 2; j++) {
      const n = i * 2 + j
      place(
        crowns,
        n,
        x + j * 1.6,
        h + height - j * 2.4,
        z + j,
        size,
        size * (0.9 + random() * 0.5),
        size,
      )
      crowns.setColorAt(
        n,
        new Color().setHSL(0.24 + random() * 0.095, 0.3 + random() * 0.18, 0.18 + random() * 0.12),
      )
    }
  }
  const shrubs = instances(
    new IcosahedronGeometry(1, 1),
    new MeshStandardMaterial({ color: '#ffffff', roughness: 1 }),
    100,
  )
  for (let i = 0; i < 100; i++) {
    const angle = random() * Math.PI * 2,
      r = 48 + random() * 24
    const x = Math.cos(angle) * r,
      z = Math.sin(angle) * r * 0.72
    const s = 1.1 + random() * 2
    place(shrubs, i, x, islandHeight(x, z) + s * 0.5, z, s * 1.3, s, s)
    shrubs.setColorAt(i, new Color().setHSL(0.23 + random() * 0.12, 0.35, 0.24 + random() * 0.1))
  }

  // Curved tapering palm fronds, reused for every palm instead of hundreds of meshes.
  const frondPositions: number[] = [],
    frondIndices: number[] = []
  for (let i = 0; i <= 10; i++) {
    const t = i / 10,
      width = Math.sin(Math.PI * t) * 0.72 + 0.015
    const y = Math.sin(t * Math.PI * 0.85) * 1.9 - t * t * 2.8
    frondPositions.push(t * 7, y, -width, t * 7, y + 0.15, width)
    if (i < 10) {
      const a = i * 2
      frondIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const frondGeometry = new BufferGeometry()
  frondGeometry.setAttribute('position', new Float32BufferAttribute(frondPositions, 3))
  frondGeometry.setIndex(frondIndices)
  frondGeometry.computeVertexNormals()
  const palms = instances(
    new CylinderGeometry(0.22, 0.48, 1, 8),
    new MeshStandardMaterial({ color: '#887454', roughness: 1 }),
    18,
  )
  const fronds = instances(
    frondGeometry,
    new MeshStandardMaterial({ color: '#3f7438', side: DoubleSide, roughness: 0.85 }),
    126,
  )
  const windTime = { value: 0 }
  const leafMaterial = fronds.material as MeshStandardMaterial
  leafMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = windTime
    shader.vertexShader = `uniform float windTime;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       transformed.y += sin(windTime * 1.5 + instanceMatrix[3].x * 0.1 + position.x * 0.5) * position.x * 0.045;`,
    )
  }
  for (let i = 0; i < 18; i++) {
    const angle = random() * Math.PI * 2,
      r = 64 + random() * 9
    const x = Math.cos(angle) * r,
      z = Math.sin(angle) * r * 0.72
    const base = islandHeight(x, z),
      height = 10 + random() * 6
    place(palms, i, x, base + height / 2, z, 1, height, 1)
    for (let j = 0; j < 7; j++) {
      place(
        fronds,
        i * 7 + j,
        x,
        base + height,
        z,
        1,
        1,
        1,
        (j * Math.PI * 2) / 7 + angle,
        random() * 0.15,
      )
    }
  }
  const rocks = instances(
    new IcosahedronGeometry(1, 1),
    new MeshStandardMaterial({ color: '#7b827a', roughness: 0.92 }),
    25,
  )
  for (let i = 0; i < 25; i++) {
    const a = random() * Math.PI * 2,
      r = 78 + random() * 8,
      size = 1.8 + random() * 3
    const x = Math.cos(a) * r,
      z = Math.sin(a) * r * 0.72
    place(rocks, i, x, islandHeight(x, z) + size * 0.25, z, size * 1.3, size, size, a)
  }
  group.traverse((object) => {
    if (object instanceof InstancedMesh) {
      object.instanceMatrix.needsUpdate = true
      if (object.instanceColor) object.instanceColor.needsUpdate = true
      object.computeBoundingSphere()
    }
  })
  return {
    group,
    update(time: number) {
      windTime.value = time
    },
    dispose() {
      group.traverse((object) => {
        if (object instanceof Mesh) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach((material) => material.dispose())
          if (object instanceof InstancedMesh) object.dispose()
        }
      })
    },
  }
}
