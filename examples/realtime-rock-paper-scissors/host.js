const descriptor = Object.freeze({
  service: 'rock-paper-scissors',
  protocol: 'app.arkme.rps',
  protocolMajor: 1,
  participantMin: 2,
  participantMax: 2,
})
const moves = new Set(['rock', 'paper', 'scissors'])
let active

function winner(left, right) {
  if (left === right) return 0
  return (left === 'rock' && right === 'scissors')
    || (left === 'paper' && right === 'rock')
    || (left === 'scissors' && right === 'paper') ? 1 : 2
}

function publicState() {
  if (active === undefined) return { active: false }
  return {
    active: true,
    round: active.round,
    submitted: active.submitted,
    received: active.moves.size,
    resolution: active.resolution,
  }
}

function applyEvent(event) {
  if (active === undefined || event.channelRef !== active.session.channelRef) return
  const payload = event.payload
  if (payload === null || typeof payload !== 'object') return
  if (payload.type === 'move' && payload.round === active.round && moves.has(payload.move)) {
    active.moves.set(event.senderSeatRef, payload.move)
    if (active.moves.size === 2 && active.resolution === undefined) {
      const entries = [...active.moves.entries()].sort(([left], [right]) => left.localeCompare(right))
      const outcome = winner(entries[0][1], entries[1][1])
      active.resolution = {
        players: entries.map(([, move], index) => ({
          label: `玩家 ${String(index + 1)}`,
          move,
        })),
        outcome: outcome === 0 ? 'draw' : `player-${String(outcome)}`,
      }
    }
    return
  }
  if (payload.type === 'next-round' && Number.isInteger(payload.round)
    && payload.round === active.round + 1 && active.resolution !== undefined) {
    active.round = payload.round
    active.moves.clear()
    active.submitted = false
    active.resolution = undefined
  }
}

async function leaveRoom() {
  if (active === undefined) return
  const previous = active
  active = undefined
  previous.unsubscribe()
}

harness.handle('realtime.open', async session => {
  await leaveRoom()
  const room = {
    session,
    round: 1,
    submitted: false,
    moves: new Map(),
    resolution: undefined,
    unsubscribe: () => {},
  }
  active = room
  room.unsubscribe = await harness.realtime.subscribe(session.channelRef, applyEvent)
  return publicState()
})

harness.handle('rps.play', async args => {
  if (active === undefined) throw new Error('请先从聊天邀请卡片进入房间')
  const move = typeof args?.move === 'string' ? args.move : ''
  if (!moves.has(move)) throw new Error('无效的出拳')
  if (active.submitted || active.resolution !== undefined) throw new Error('本局已经出拳')
  const result = await harness.realtime.publish(active.session, {
    type: 'move',
    round: active.round,
    move,
  })
  active.submitted = true
  return { ...publicState(), publish: result }
})

harness.handle('rps.next', async () => {
  if (active?.resolution === undefined) throw new Error('本局尚未结束')
  return await harness.realtime.publish(active.session, {
    type: 'next-round',
    round: active.round + 1,
  })
})

harness.handle('rps.state', () => publicState())
harness.handle('rps.leave', async () => { await leaveRoom(); return { active: false } })

return {
  name: 'arkme-realtime-rps-host',
  async apply(ctx) {
    const release = await harness.realtime.provide(descriptor)
    ctx.effect(() => release, 'rps: release realtime service')
    ctx.effect(() => () => { void leaveRoom() }, 'rps: leave active room')
    ctx.tools.register(defineTool({
      name: 'arkme_rps_invite',
      description: '向一个 Arkme 私聊或群聊发送双人石头剪刀布邀请。仅在用户当前明确要求发起游戏时调用；source_ref 必须原样来自 arkme_sources_list。',
      parameters: {
        source_ref: { type: 'string', required: true, description: '当前账号下的 private_chat 或 group_chat source_ref。' },
      },
      output: { type: 'string' },
      async execute(args) {
        const invite = await harness.realtime.invite({
          ...descriptor,
          sourceRef: args.source_ref,
          participantLimit: 2,
          fallbackText: '来一局石头剪刀布',
        })
        return JSON.stringify(invite)
      },
    }))
  },
}
