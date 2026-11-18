export type GameCommand = { kind: 'create' } | { kind: 'join'; roomId: string; token: string }
const join = /^\/game join ([a-f0-9]{32})\.([a-f0-9]{64})$/
export function parseGameCommand(text: string): GameCommand | null {
  const value = text.trim()
  if (value === '/game') return { kind: 'create' }
  const wrapped = /^发送「([^\r\n]+)」到群聊加入游戏$/.exec(value)
  // The copied sentence is a shareable note, not an instruction to this client.
  if (wrapped && join.test(wrapped[1]!)) return null
  const match = join.exec(value)
  if (match) return { kind: 'join', roomId: match[1]!, token: match[2]! }
  if (/\/game\b/.test(value)) throw new Error('游戏口令格式不正确，请单独粘贴完整房间钥匙')
  return null
}
export function invitation(roomId: string, token: string): string {
  return `发送「/game join ${roomId}.${token}」到群聊加入游戏`
}
