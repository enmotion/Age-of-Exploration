import { describe, expect, it } from 'vitest'
import { oceanFragment } from './shaders'

describe('reflection filtering regression', () => {
  it('never differentiates the derivative-built reflection normal', () => {
    expect(oceanFragment).not.toMatch(
      /(?:dFdx|dFdy|fwidth)\(\s*(?:N|normal|reflectionNormal|faceNormal)\s*\)/,
    )
    expect(oceanFragment).toContain('dFdx(vWorld.xz)')
    expect(oceanFragment).toContain('dFdy(vWorld.xz)')
  })
})
