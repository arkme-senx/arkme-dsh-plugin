import { callArkme } from '../api.js'
import { arkmeAuthStore } from '../auth-store.js'
import type { GameCommand } from './command.js'
let current: { win: Window; command: GameCommand; stop: () => void } | undefined
let opening: Promise<void> | undefined
async function findExisting(command: GameCommand): Promise<boolean> {
  const bus = new BroadcastChannel('arkme-game-discovery-v1'),
    id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bus.close()
      resolve(false)
    }, 180)
    bus.onmessage = (e) => {
      if (e.data?.kind !== 'found' || e.data.id !== id) return
      clearTimeout(timer)
      bus.close()
      if (command.kind === 'join' && e.data.roomId !== command.roomId)
        reject(new Error('请先退出当前游戏房间，再使用新的钥匙'))
      else resolve(true)
    }
    bus.postMessage({ kind: 'find', id })
  })
}
export async function openGame(command: GameCommand): Promise<void> {
  if (opening) {
    await opening
    return openGame(command)
  }
  if (current && !current.win.closed) {
    if (command.kind === 'create' || (current.command.kind === 'join' && command.roomId === current.command.roomId)) {
      current.win.focus()
      return
    }
    throw new Error('请先在游戏窗口退出当前房间，再使用新的钥匙')
  }
  const operation = launch(command)
  opening = operation
  try {
    await operation
  } finally {
    if (opening === operation) opening = undefined
  }
}
async function launch(command: GameCommand): Promise<void> {
  if (!navigator.locks) throw new Error('当前客户端不支持游戏窗口互斥，请升级客户端')
  await new Promise<void>((resolve, reject) => {
    // Serialize launchers across independent conversation windows. The game page
    // additionally holds its own lifetime lock, even if an opener reloads.
    void navigator.locks
      .request('arkme-game-launch-v1', async () => {
        try {
          if (await findExisting(command)) {
            resolve()
            return
          }
          current?.stop()
          const win = window.open('about:blank', `arkme-game-${crypto.randomUUID()}`,  'popup,width=1100,height=760,resizable=yes')
          if (!win) throw new Error('游戏窗口未能打开，请允许弹出窗口后重试')
          const auth = arkmeAuthStore.getSnapshot().auth
          const bootstrap = await callArkme<{ path: string; account: string }>('game.request', {
            action: 'bootstrap',
          }).catch((e) => {
            win.close()
            throw e
          })
          if (win.closed) throw new Error('游戏窗口已取消')
          const origin = window.location.origin
          let initialized = false
          let readyResolve: () => void = () => {},
            readyReject: (e: Error) => void = () => {}
          const ready = new Promise<void>((ok, no) => {
            readyResolve = ok
            readyReject = no
          })
          const readyTimer = setTimeout(() => readyReject(new Error('游戏窗口加载失败，请重试')), 15000)
          const listener = (event: MessageEvent) => {
            if (event.source !== win || event.origin !== origin || event.data?.channel !== 'arkme.game.window.v1')
              return
            const { id, action, body } = event.data
            if (typeof id !== 'string' || typeof action !== 'string') return
            const reply = (data: unknown, error?: string) => {
              if (!win.closed) win.postMessage({ channel: 'arkme.game.window.v1', id, data, error }, origin)
            }
            const now = arkmeAuthStore.getSnapshot().auth
            if (
              now?.userId !== auth?.userId ||
              now?.environment !== auth?.environment ||
              now?.status !== 'authenticated'
            ) {
              reply(null, '账号状态已变化，请重新打开游戏')
              readyReject(new Error('账号已变化'))
              win.close()
              return
            }
            if (action === 'init') {
              if (!initialized) {
                initialized = true
                reply({ command })
                readyResolve()
              }
              return
            }
            if (!initialized) return
            if (action === 'selected-room' && (typeof body?.roomId === 'string' || body?.roomId === null)) {
              current!.command = body.roomId === null ? { kind: 'create' } : { kind: 'join', roomId: body.roomId, token: '' }
              reply({})
              return
            }
            void callArkme('game.request', { action, body, account: bootstrap.account }).then(
              (data) => reply(data),
              (error: unknown) => reply(null, error instanceof Error ? error.message : '游戏请求失败，请稍后重试'),
            )
          }
          window.addEventListener('message', listener)
          const timer = setInterval(() => {
            if (win.closed) {
              readyReject(new Error('游戏窗口已取消'))
              stop()
              if (current?.win === win) current = undefined
            }
          }, 1000)
          const stop = () => {
            window.removeEventListener('message', listener)
            clearInterval(timer)
            clearTimeout(readyTimer)
          }
          current = { win, command, stop }
          win.location.replace(bootstrap.path)
          try {
            await ready
            resolve()
          } catch (e) {
            stop()
            win.close()
            throw e
          } finally {
            clearTimeout(readyTimer)
          }
        } catch (e) {
          reject(e)
        }
      })
      .catch(reject)
  })
}
