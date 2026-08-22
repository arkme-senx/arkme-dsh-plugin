const listeners = new Set()
let snapshot = { open: false, room: undefined, game: { active: false }, error: '' }

function emit(patch) {
  snapshot = { ...snapshot, ...patch }
  for (const listener of listeners) listener()
}

async function refresh() {
  if (!snapshot.open) return
  try {
    emit({ game: await host.call('rps.state'), error: '' })
  } catch (error) {
    emit({ error: error instanceof Error ? error.message : '读取房间状态失败' })
  }
}

function useRoom() {
  return React.useSyncExternalStore(
    callback => { listeners.add(callback); return () => { listeners.delete(callback) } },
    () => snapshot,
  )
}

function Room() {
  const state = useRoom()
  if (!state.open) return null
  const game = state.game
  const play = async move => {
    try {
      emit({ error: '' })
      emit({ game: await host.call('rps.play', { move }) })
    } catch (error) {
      emit({ error: error instanceof Error ? error.message : '出拳失败' })
    }
  }
  const next = async () => {
    try { await host.call('rps.next'); await refresh() }
    catch (error) { emit({ error: error instanceof Error ? error.message : '开始下一局失败' }) }
  }
  const close = async () => {
    try { await host.call('rps.leave') } finally { emit({ open: false, room: undefined, game: { active: false } }) }
  }
  return React.createElement('div', { className: 'arkme-rps-backdrop' },
    React.createElement('section', { className: 'arkme-rps-room', role: 'dialog', 'aria-modal': true, 'aria-label': '石头剪刀布实时房间' },
      React.createElement('h2', null, '石头剪刀布'),
      React.createElement('p', null, `第 ${String(game.round ?? 1)} 局 · ${String(game.received ?? 0)}/2 已出拳`),
      game.resolution === undefined
        ? React.createElement('div', { className: 'arkme-rps-actions' },
            ['rock', 'paper', 'scissors'].map((move, index) => React.createElement('button', {
              key: move, disabled: game.submitted === true, onClick: () => { void play(move) },
            }, ['石头', '布', '剪刀'][index])))
        : React.createElement(React.Fragment, null,
            React.createElement('p', { className: 'arkme-rps-result' },
              game.resolution.outcome === 'draw' ? '平局' : `${game.resolution.outcome === 'player-1' ? '玩家 1' : '玩家 2'} 获胜`),
            React.createElement('button', { onClick: () => { void next() } }, '下一局')),
      state.error === '' ? null : React.createElement('p', { className: 'arkme-rps-error' }, state.error),
      React.createElement('button', { className: 'arkme-rps-close', onClick: () => { void close() } }, '离开房间')))
}

harness.realtime.onOpen(session => {
  emit({ open: true, room: session, error: '' })
  void refresh()
})

styles.insert(`
  .arkme-rps-backdrop { position: fixed; inset: 0; z-index: 1200; display: grid; place-items: center; background: rgba(14,18,30,.54); }
  .arkme-rps-room { width: min(360px, calc(100vw - 32px)); padding: 24px; border-radius: 20px; background: #fff; color: #17191c; box-shadow: 0 24px 80px rgba(0,0,0,.24); }
  .arkme-rps-room h2 { margin: 0 0 8px; }
  .arkme-rps-actions { display: flex; gap: 8px; margin: 18px 0; }
  .arkme-rps-room button { min-height: 36px; padding: 0 14px; border: 0; border-radius: 10px; cursor: pointer; }
  .arkme-rps-actions button { flex: 1; background: #3964fe; color: #fff; }
  .arkme-rps-result { font-weight: 700; }
  .arkme-rps-error { color: #d92d20; }
  .arkme-rps-close { margin-top: 18px; background: #edf0f5; }
`)

return {
  name: 'arkme-realtime-rps-client',
  inject: ['slots', 'timer'],
  apply(ctx) {
    ctx.interval(() => { void refresh() }, 500)
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'arkme-realtime-rps-room',
      order: 50,
      label: '石头剪刀布实时房间',
    }, Room))
  },
}
