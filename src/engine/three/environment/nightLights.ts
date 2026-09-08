import {
  AdditiveBlending,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  Vector4,
} from 'three'
import { islandHeight } from './island'

/** Four unshadowed local lights; the other torches share their illumination. */
export function createNightLights(ship: Group, island: Group) {
  const shipRig = new Group(),
    islandRig = new Group()
  ship.add(shipRig)
  island.add(islandRig)
  const poleGeometry = new CylinderGeometry(0.12, 0.18, 1, 6)
  const flameGeometry = new SphereGeometry(1, 10, 8)
  const metal = new MeshStandardMaterial({ color: '#433325', roughness: 0.8 })
  const flameMaterial = new MeshBasicMaterial({ color: '#ffd293', toneMapped: false })
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255,231,163,1)')
  gradient.addColorStop(0.12, 'rgba(255,173,58,.7)')
  gradient.addColorStop(0.4, 'rgba(255,112,24,.18)')
  gradient.addColorStop(1, 'rgba(255,95,12,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  const texture = new CanvasTexture(canvas)
  const glowMaterial = new SpriteMaterial({
    map: texture,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
  const flames: { flame: Mesh; glow: Sprite; phase: number; size: number }[] = []
  const lights: PointLight[] = []
  const positions = Array.from({ length: 4 }, () => new Vector4())
  const world = new Vector3()
  function addLamp(parent: Group, x: number, y: number, z: number, size: number, power: number) {
    const mount = new Group()
    mount.position.set(x, y, z)
    parent.add(mount)
    const pole = new Mesh(poleGeometry, metal)
    pole.scale.set(size, size * 3, size)
    pole.position.y = -size * 1.5
    mount.add(pole)
    const cap = new Mesh(poleGeometry, metal)
    cap.scale.set(size * 3.5, size * 0.3, size * 3.5)
    mount.add(cap)
    const flame = new Mesh(flameGeometry, flameMaterial)
    flame.position.y = size * 0.6
    flame.scale.set(size * 0.33, size * 0.8, size * 0.33)
    mount.add(flame)
    const glow = new Sprite(glowMaterial)
    glow.position.y = size * 0.6
    glow.scale.setScalar(size * 8)
    mount.add(glow)
    flames.push({ flame, glow, phase: flames.length * 2.39, size })
    if (power) {
      const light = new PointLight('#ffb858', 0, size < 1 ? 32 : 65, 2)
      light.position.y = size
      light.userData.power = power
      mount.add(light)
      lights.push(light)
    }
  }
  addLamp(shipRig, -4.8, 8.5, 7, 0.8, 150)
  addLamp(shipRig, 4.8, 8.5, -5, 0.8, 150)
  for (let i = 0; i < 8; i++) {
    const angle = Math.PI * (1.12 + i * 0.105)
    const x = Math.cos(angle) * 76,
      z = Math.sin(angle) * 76 * 0.72
    addLamp(islandRig, x, islandHeight(x, z) + 4.5, z, 1.5, i === 2 || i === 5 ? 850 : 0)
  }
  return {
    positions,
    update(time: number, daylight: number) {
      const night = (1 - daylight) ** 1.5
      glowMaterial.opacity = night * 0.85
      for (const { flame, glow, phase, size } of flames) {
        const flicker =
          0.87 + Math.sin(time * 7 + phase) * 0.08 + Math.sin(time * 13.7 + phase) * 0.05
        flame.visible = glow.visible = night > 0.01
        flame.scale.y = size * flicker
        flame.position.x = Math.sin(time * 4 + phase) * size * 0.1
        glow.scale.setScalar(size * (7.5 + flicker))
      }
      shipRig.updateWorldMatrix(true, true)
      islandRig.updateWorldMatrix(true, true)
      lights.forEach((light, i) => {
        const flicker = 0.94 + Math.sin(time * 6.2 + i * 2) * 0.06
        light.intensity = light.userData.power * night * flicker
        light.getWorldPosition(world)
        positions[i]!.set(world.x, world.y, world.z, night * flicker * (i < 2 ? 1 : 2))
      })
    },
    dispose() {
      ship.remove(shipRig)
      island.remove(islandRig)
      lights.forEach((light) => light.dispose())
      poleGeometry.dispose()
      flameGeometry.dispose()
      metal.dispose()
      flameMaterial.dispose()
      glowMaterial.dispose()
      texture.dispose()
    },
  }
}
