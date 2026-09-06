import { describe, expect, it } from 'vitest'
import { sailingAction } from './controls'

describe('helm keyboard input', () => {
  const button = { editing: false, modal: false, button: true }
  it('steers even when the departure button retains focus', () => {
    expect(sailingAction('a', button)).toBe('left')
    expect(sailingAction('D', button)).toBe('right')
    expect(sailingAction('ArrowLeft', button)).toBe('left')
    expect(sailingAction('w', button)).toBe('raise-sail')
  })
  it('preserves native button activation and editable inputs', () => {
    expect(sailingAction(' ', button)).toBeUndefined()
    expect(sailingAction('d', { ...button, editing: true })).toBeUndefined()
    expect(sailingAction('d', { ...button, modal: true })).toBeUndefined()
    expect(sailingAction(' ', { ...button, button: false })).toBe('pause')
  })
})
