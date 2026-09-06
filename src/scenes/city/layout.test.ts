import { expect, it } from 'vitest'
import { generateCity } from './layout'

it('generates the same city for the same port seed across visits', () => {
  expect(generateCity(1492)).toEqual(generateCity(1492))
  expect(generateCity(1492)).not.toEqual(generateCity(1493))
  expect(new Set(generateCity(1492).map((lot) => lot.id)).size).toBe(18)
})
