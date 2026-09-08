export type DialogueRole = 'player' | 'npc'

export interface DialogueMessage {
  role: DialogueRole
  content: string
}

export interface DialogueRequest {
  npcId: string
  locale: string
  messages: readonly DialogueMessage[]
  worldContext?: Readonly<Record<string, unknown>>
}

export interface DialogueReply {
  content: string
  emotion?: string
}

/** Browser code depends on this boundary; a future HTTP implementation may call the backend. */
export interface DialogueService {
  reply(request: DialogueRequest, signal?: AbortSignal): Promise<DialogueReply>
}
