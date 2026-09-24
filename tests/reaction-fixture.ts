import { createHash } from 'node:crypto'
import type { ReactionRequest, ReactionState, ReactionLibrary, ReactionHistoryEvent } from '../src/reaction-contract.js'
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const reactionFixture = {
  library: { revision: 0, items: [] } as ReactionLibrary,
  states: new Map<string, ReactionState>(),
  history: [] as ReactionHistoryEvent[],
  reset() { this.library = { revision: 0, items: [] }; this.states.clear(); this.history = [] },
  async call(_operation: string, input: ReactionRequest) {
    if (input.action === 'library-query') return structuredClone(this.library)
    if (input.action === 'library-set') { this.library = { revision: this.library.revision + 1, items: input.items }; return { outcome: 'updated', library: this.library } }
    if (input.action === 'query') return { items: input.targets.map(target => { const mine = this.states.get(target.id) ?? { revision: 0, selections: [] }; return { target_id: target.id, mine, groups: mine.selections.map(item => ({ ...item, count: 1 })), has_more: false, actors_visible: true, private: false } }) }
    if (input.action === 'set') {
      const key = hash(input.expression), current = this.states.get(input.target.id) ?? { revision: 0, selections: [] }
      const state = { revision: current.revision + 1, selections: current.selections.filter(item => item.key !== key) }
      if (input.active) state.selections.push({ key, expression: input.expression, at: Date.now() })
      this.states.set(input.target.id, state)
      this.history.push({ event_uid: hash(input.request_id), target_id: input.target.id, expression: input.expression, active: input.active, at: Date.now(), restricted: false })
      return { outcome: 'updated', state }
    }
    if (input.action === 'history') return { items: this.history.filter(item => item.at >= input.start_at && item.at < input.end_at).sort((a,b) => b.at-a.at), has_more: false }
    throw new Error('Unexpected fixture action '+input.action)
  },
}
