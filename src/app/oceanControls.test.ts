import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { oceanControlGroups } from './oceanControls'

const controls = oceanControlGroups.flatMap((group) => [
  ...group.controls,
  ...(group.children?.flatMap((child) => child.controls) ?? []),
])

describe('ocean control contract', () => {
  it('only exposes unique, enabled controls', () => {
    const keys = controls.map((control) => control.key)
    expect(keys).toHaveLength(80)
    expect(new Set(keys).size).toBe(keys.length)
    expect(controls.every((control) => !control.disabled)).toBe(true)
  })

  it('connects every visible control to the active renderer', () => {
    const renderer = readFileSync(
      new URL('../engine/babylon/ocean/createOcean.ts', import.meta.url),
      'utf8',
    )
    for (const control of controls) {
      expect(
        renderer,
        `${String(control.key)} is visible but not connected`,
      ).toMatch(
        new RegExp(
          `(?:next|settings)\\.${String(control.key)}(?![A-Za-z0-9_])`,
        ),
      )
    }
  })
})
