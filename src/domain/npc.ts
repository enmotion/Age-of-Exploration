/** Engine-independent boundary. A future backend implements this interface. */
export interface NpcContext {
  npcId: string
  portId: string
  gameTime: number
}
export type NpcDecision = { type: 'idle'; durationSeconds: number }
export interface NpcDecisionProvider {
  decide(
    context: Readonly<NpcContext>,
    signal: AbortSignal,
  ): Promise<NpcDecision>
}
export class LocalNpcDecisionProvider implements NpcDecisionProvider {
  async decide(
    _context: Readonly<NpcContext>,
    signal: AbortSignal,
  ): Promise<NpcDecision> {
    signal.throwIfAborted()
    return { type: 'idle', durationSeconds: 5 }
  }
}
