export type GameType = 'chinese_checkers' | 'multiplayer_gomoku'
export const isGameType = (value: unknown): value is GameType => value === 'chinese_checkers' || value === 'multiplayer_gomoku'
export const playerCounts = (type: GameType) => type === 'multiplayer_gomoku' ? [2,3,4,5,6] : [2,3,4,6]
export const gameName = (type: GameType) => type === 'multiplayer_gomoku' ? '多人五子棋' : '跳棋'
