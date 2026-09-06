export type SailingAction = 'left' | 'right' | 'raise-sail' | 'lower-sail' | 'pause'
/** Buttons keep native Space activation, but must not swallow helm keys after departure. */
export function sailingAction(
  key: string,
  context: { editing: boolean; button: boolean; modal: boolean },
): SailingAction | undefined {
  if (context.editing || context.modal) return
  const actions: Record<string, SailingAction> = {
    a: 'left',
    arrowleft: 'left',
    d: 'right',
    arrowright: 'right',
    w: 'raise-sail',
    arrowup: 'raise-sail',
    s: 'lower-sail',
    arrowdown: 'lower-sail',
    ' ': 'pause',
  }
  if (key === ' ' && context.button) return
  return actions[key.toLowerCase()]
}
