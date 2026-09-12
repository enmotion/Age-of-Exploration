import { Color3 } from '@babylonjs/core/Maths/math.color'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Scene } from '@babylonjs/core/scene'
import type { PortObject } from '../../domain/port'

export function createProceduralAsset(
  object: PortObject,
  scene: Scene,
): TransformNode {
  const root = new TransformNode(object.id, scene)
  const material = (name: string, hex: string) => {
    const mat = new StandardMaterial(`${object.id}:${name}`, scene)
    mat.diffuseColor = Color3.FromHexString(hex)
    mat.specularColor = Color3.Black()
    return mat
  }
  const sand = material('sand', '#d8c59a')
  const grass = material('grass', '#6b8d71')
  const wood = material('wood', '#765442')
  const plaster = material('plaster', '#efe0ba')
  const roof = material('roof', '#ac6950')
  const box = (
    name: string,
    size: [number, number, number],
    position: [number, number, number],
    mat: StandardMaterial,
  ) => {
    const mesh = CreateBox(
      `${object.id}:${name}`,
      { width: size[0], height: size[1], depth: size[2] },
      scene,
    )
    mesh.position.set(...position)
    mesh.material = mat
    mesh.parent = root
    return mesh
  }
  if (object.assetId === 'builtin:island') {
    const island = CreateCylinder(
      'island-base',
      { diameterTop: 13, diameterBottom: 15, height: 1.1, tessellation: 12 },
      scene,
    )
    island.position.y = -0.15
    island.scaling.z = 0.8
    island.material = sand
    island.parent = root
    const lawn = CreateCylinder(
      'island-grass',
      { diameter: 11.8, height: 0.15, tessellation: 12 },
      scene,
    )
    lawn.position.y = 0.47
    lawn.scaling.z = 0.78
    lawn.material = grass
    lawn.parent = root
    for (const [x, z, angle] of [
      [-2.5, 0, 0.12],
      [1.2, 1.3, -0.2],
      [-1, 2.7, 0.05],
    ]) {
      const house = box('house', [2, 1.5, 1.7], [x!, 1.25, z!], plaster)
      house.rotation.y = angle!
      const top = CreateCylinder(
        'roof',
        { diameter: 2.8, height: 2.25, tessellation: 3 },
        scene,
      )
      top.rotation.z = Math.PI / 2
      top.rotation.y = angle!
      top.position.set(x!, 2.15, z!)
      top.material = roof
      top.parent = root
      box('door', [0.43, 0.85, 0.06], [x!, 0.97, z! - 0.87], wood)
    }
    for (const [x, z] of [
      [-4, 1.5],
      [3.8, 1],
      [2.8, 3.1],
      [-3.5, -1.9],
    ]) {
      box('trunk', [0.2, 1.2, 0.2], [x!, 1, z!], wood)
      const crown = CreateSphere('tree', { diameter: 1.45, segments: 3 }, scene)
      crown.position.set(x!, 1.9, z!)
      crown.scaling.y = 1.25
      crown.material = grass
      crown.parent = root
    }
  } else if (object.assetId === 'builtin:dock') {
    for (let i = 0; i < 13; i++)
      box('plank', [2, 0.18, 0.35], [0, 0.48, 1.7 - i * 0.4], wood)
    for (const x of [-0.85, 0.85]) {
      for (const z of [-3.1, -0.6, 1.8])
        box('post', [0.16, 1.3, 0.16], [x, 0.25, z], wood)
    }
  } else if (object.assetId === 'builtin:ship') {
    const hull = CreateSphere('hull', { diameter: 2, segments: 4 }, scene)
    hull.scaling.set(0.7, 0.38, 1.7)
    hull.position.y = 0.16
    hull.material = wood
    hull.parent = root
    box('deck', [1.08, 0.12, 2.1], [0, 0.42, 0], sand)
    box('mast', [0.09, 3.1, 0.09], [0, 1.8, 0], wood)
    const sail = box('sail', [1.65, 1.8, 0.045], [0.15, 2.05, 0.05], plaster)
    sail.rotation.y = -0.25
    box('boom', [1.9, 0.06, 0.06], [0.1, 1.12, 0], wood)
  } else {
    root.dispose(false, true)
    throw new Error(`没有可用的资产构建器：${object.assetId}`)
  }
  root.position.set(...object.position)
  root.rotation.set(...object.rotation)
  root.scaling.set(...object.scale)
  return root
}
