import { expect, it } from 'vitest'
import { createDefaultPort } from '../domain/port'
import { parsePortDocument } from './portDocument'

it('rejects missing asset references', () => {
  const port = createDefaultPort()
  port.objects[0]!.assetId = 'missing:model'
  expect(() => parsePortDocument(port)).toThrow('缺少资产')
})
it('rejects duplicate object IDs and nonfinite transforms', () => {
  const port = createDefaultPort()
  port.objects.push({ ...port.objects[0]! })
  expect(() => parsePortDocument(port)).toThrow()
  port.objects.pop()
  port.objects[0]!.position[0] = Infinity
  expect(() => parsePortDocument(port)).toThrow()
})
