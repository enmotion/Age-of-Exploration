import { MercatorCoordinate, type CustomLayerInterface } from 'mapbox-gl'
import {
  AmbientLight,
  Camera,
  DirectionalLight,
  Matrix4,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import type { VesselState } from '../../game/sailing/sailing'
import { createShip, disposeShip } from '../three/ship'

export function createShipLayer(getVessel: () => VesselState): CustomLayerInterface {
  const camera = new Camera()
  const scene = new Scene()
  const ship = createShip()
  scene.add(ship, new AmbientLight(0xffffff, 2))
  const sun = new DirectionalLight(0xffe3af, 3)
  sun.position.set(-50, 100, 30)
  scene.add(sun)
  let renderer: WebGLRenderer | undefined
  return {
    id: 'exploration-ship',
    type: 'custom',
    renderingMode: '3d',
    onAdd(map, gl) {
      renderer = new WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true })
      renderer.autoClear = false
    },
    render(_gl, matrix) {
      if (!renderer) return
      const vessel = getVessel()
      const origin = MercatorCoordinate.fromLngLat([vessel.longitude, vessel.latitude], 0)
      // Exaggerated chart model for the regional prototype; Phase 1 will verify metre-scale assets.
      const scale = origin.meterInMercatorCoordinateUnits() * 180
      const transform = new Matrix4()
        .makeTranslation(origin.x, origin.y, origin.z)
        .scale(new Vector3(scale, -scale, scale))
        .multiply(new Matrix4().makeRotationX(Math.PI / 2))
        .multiply(new Matrix4().makeRotationY((-vessel.heading * Math.PI) / 180))
      camera.projectionMatrix = new Matrix4().fromArray(matrix as number[]).multiply(transform)
      renderer.resetState()
      renderer.render(scene, camera)
    },
    onRemove() {
      disposeShip(ship)
      renderer?.dispose()
      renderer = undefined
    },
  }
}
