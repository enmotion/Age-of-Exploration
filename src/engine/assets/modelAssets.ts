import { Group, Mesh, MeshStandardMaterial } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { getModelAsset } from './catalog'

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
const modelCache = new Map<string, Promise<Group>>()

function sourceModel(id: string) {
  let pending = modelCache.get(id)
  if (!pending) {
    const asset = getModelAsset(id)
    pending = loader.loadAsync(asset.url).then(({ scene }) => scene)
    modelCache.set(id, pending)
  }
  return pending
}

export async function instantiateModel(id: string) {
  const asset = getModelAsset(id)
  const instance = clone(await sourceModel(id))
  instance.name = id
  const transform = asset.transform
  if (transform?.scale) instance.scale.setScalar(transform.scale)
  if (transform?.rotationY) instance.rotation.y = transform.rotationY
  if (transform?.waterlineY) instance.position.y = transform.waterlineY
  instance.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.castShadow = true
    object.receiveShadow = true
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      if (material instanceof MeshStandardMaterial) {
        material.envMapIntensity = 0.75
        material.roughness = Math.max(0.55, material.roughness)
      }
    }
  })
  return instance
}
