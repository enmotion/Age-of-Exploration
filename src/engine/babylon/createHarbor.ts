import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { PortDefinition } from '../../domain/port'
import { parsePortDocument } from '../../editor/portDocument'
import { createProceduralAsset } from './proceduralAssets'

export interface HarborRuntime {
  resetCamera(): void
  dispose(): void
}

export function createHarbor(
  canvas: HTMLCanvasElement,
  document: PortDefinition,
): HarborRuntime {
  const port = parsePortDocument(document)
  const engine = new Engine(canvas, true, {
    stencil: true,
    preserveDrawingBuffer: false,
  })
  try {
    const scene = new Scene(engine)
    scene.clearColor = Color4.FromHexString('#a8c4caff')
    const camera = new ArcRotateCamera(
      'harbor-camera',
      -Math.PI / 2.6,
      Math.PI / 3.1,
      24,
      new Vector3(0, 0, -1),
      scene,
    )
    camera.lowerRadiusLimit = 13
    camera.upperRadiusLimit = 38
    camera.lowerBetaLimit = 0.3
    camera.upperBetaLimit = Math.PI / 2.2
    camera.wheelPrecision = 35
    camera.panningSensibility = 0
    camera.attachControl(canvas, true)
    camera.storeState()
    new HemisphericLight('sky', new Vector3(0, 1, 0), scene).intensity = 0.65
    const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.5), scene)
    sun.intensity = 0.5
    sun.diffuse = Color3.FromHexString('#ffe3b5')
    const sea = CreateGround('sea', { width: 200, height: 200 }, scene)
    sea.position.y = -0.32
    const water = new StandardMaterial('water', scene)
    water.diffuseColor = Color3.FromHexString('#347e8a')
    water.specularColor = Color3.FromHexString('#86bbc2')
    water.specularPower = 100
    sea.material = water
    for (const object of port.objects) createProceduralAsset(object, scene)
    const resize = new ResizeObserver(() => engine.resize())
    resize.observe(canvas)
    engine.setHardwareScalingLevel(Math.max(1, window.devicePixelRatio / 2))
    engine.resize()
    engine.runRenderLoop(() => scene.render())
    let disposed = false
    return {
      resetCamera() {
        camera.restoreState()
      },
      dispose() {
        if (disposed) return
        disposed = true
        resize.disconnect()
        engine.stopRenderLoop()
        camera.detachControl()
        scene.dispose()
        engine.dispose()
      },
    }
  } catch (error) {
    engine.dispose()
    throw error
  }
}
