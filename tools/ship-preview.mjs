import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

/* global document, window, requestAnimationFrame */
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
const views = []
for (const [id, url] of [
  ['before', '/assets/vendor/kenney-pirate-kit/Models/GLB format/ship-large.glb'],
  ['after', '/assets/models/ships/caravel.glb'],
]) {
  const canvas = document.getElementById(id)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#192128')
  scene.add(new THREE.HemisphereLight('#d4e3ee', '#756759', 2.0))
  const sun = new THREE.DirectionalLight('#fff0da', 3)
  sun.position.set(-8, 15, 10)
  scene.add(sun)
  const fill = new THREE.DirectionalLight('#b6d0e8', 0.8)
  fill.position.set(8, 7, -8)
  scene.add(fill)
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 150)
  camera.position.set(17, 11, 21)
  const controls = new OrbitControls(camera, canvas)
  controls.target.set(0, 4.5, 0)
  controls.minDistance = 8
  controls.maxDistance = 45
  controls.update()
  const { scene: model } = await loader.loadAsync(url)
  model.traverse((object) => {
    if (!object.isMesh) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) {
        if (material[key]) material[key].anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
      }
    }
  })
  scene.add(model)
  views.push({ renderer, camera, controls, scene, canvas })
}
for (const view of views) {
  view.controls.addEventListener('change', () => {
    for (const other of views) {
      if (other === view) continue
      other.camera.position.copy(view.camera.position)
      other.camera.quaternion.copy(view.camera.quaternion)
      other.controls.target.copy(view.controls.target)
    }
  })
}
function render() {
  for (const { renderer, camera, scene, canvas } of views) {
    const width = canvas.clientWidth, height = canvas.clientHeight
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.render(scene, camera)
  }
  requestAnimationFrame(render)
}
render()
document.getElementById('status').textContent = '模型已载入 · 几何与比例保持一致'
