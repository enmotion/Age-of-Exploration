import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Shape,
  Vector3,
} from 'three'

/** Original procedural caravel, metres, Y up; bow points towards -Z. */
export function createShip() {
  const ship = new Group()
  const wood = new MeshStandardMaterial({ color: '#51301f', roughness: 0.8 })
  const deck = new MeshStandardMaterial({ color: '#ad7845', roughness: 0.9 })
  const gold = new MeshStandardMaterial({ color: '#d9af62', metalness: 0.35, roughness: 0.45 })
  const canvas = new MeshStandardMaterial({ color: '#fff0cc', roughness: 0.86, side: DoubleSide })
  const red = new MeshStandardMaterial({ color: '#a5372c', side: DoubleSide })
  const outline = new Shape()
  outline.moveTo(0, -19)
  outline.lineTo(4.5, -11)
  outline.lineTo(5.3, 4)
  outline.lineTo(4, 14)
  outline.lineTo(-4, 14)
  outline.lineTo(-5.3, 4)
  outline.lineTo(-4.5, -11)
  outline.closePath()
  function add(mesh: Mesh, position: [number, number, number]) {
    mesh.position.set(...position)
    mesh.castShadow = true
    mesh.receiveShadow = true
    ship.add(mesh)
    return mesh
  }
  const hull = add(
    new Mesh(
      new ExtrudeGeometry(outline, {
        depth: 3.4,
        bevelEnabled: true,
        bevelSize: 0.8,
        bevelThickness: 0.7,
        bevelSegments: 2,
        steps: 1,
      }),
      wood,
    ),
    [0, 4.5, 0],
  )
  hull.rotation.x = Math.PI / 2
  const floor = add(
    new Mesh(new ExtrudeGeometry(outline, { depth: 0.2, bevelEnabled: false }), deck),
    [0, 4.8, 0],
  )
  floor.rotation.x = Math.PI / 2
  add(new Mesh(new BoxGeometry(7.5, 3, 6), wood), [0, 6.2, 10])
  add(new Mesh(new BoxGeometry(8, 0.4, 6.5), deck), [0, 7.9, 10])
  for (const x of [-4.4, 4.4]) {
    add(new Mesh(new BoxGeometry(0.24, 0.24, 22), gold), [x, 6.4, 0])
    for (const z of [-10, -6, -2, 2, 6, 10])
      add(new Mesh(new BoxGeometry(0.2, 1.8, 0.2), wood), [x, 5.5, z])
  }
  for (const z of [-8, 1]) {
    add(new Mesh(new CylinderGeometry(0.18, 0.4, 25, 10), wood), [0, 16, z])
    const yard = add(new Mesh(new CylinderGeometry(0.15, 0.15, 17, 8), wood), [0, 25, z])
    yard.rotation.z = Math.PI / 2
    const geometry = new PlaneGeometry(16, 13, 16, 12)
    const positions = geometry.attributes.position!
    for (let i = 0; i < positions.count; i++) {
      positions.setZ(
        i,
        -Math.cos((positions.getX(i) / 16) * Math.PI) *
          Math.cos((positions.getY(i) / 13) * Math.PI) *
          2.8,
      )
    }
    geometry.computeVertexNormals()
    const sail = add(new Mesh(geometry, canvas), [0, 18.4, z])
    sail.name = 'sail'
    add(new Mesh(new PlaneGeometry(4.8, 1.3), red), [2.4, 28, z])
    for (const x of [-4.3, 4.3]) {
      const start = new Vector3(x, 5, z + 4)
      const end = new Vector3(0, 27, z)
      const rope = add(
        new Mesh(new CylinderGeometry(0.045, 0.045, start.distanceTo(end), 4), wood),
        [0, 0, 0],
      )
      rope.position.copy(start).add(end).multiplyScalar(0.5)
      rope.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), end.sub(start).normalize())
    }
  }
  for (const x of [-1.8, 1.8]) {
    add(new Mesh(new CylinderGeometry(0.8, 0.8, 1.5, 8), deck), [x, 5.7, 5])
  }
  return ship
}

export function disposeShip(ship: Group) {
  const materials = new Set<MeshStandardMaterial>()
  ship.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose()
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        materials.add(material)
    }
  })
  materials.forEach((material) => material.dispose())
}
