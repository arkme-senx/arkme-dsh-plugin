const games = {
  chinese_checkers: {name:'跳棋', counts:[2,3,4,6]},
  multiplayer_gomoku: {name:'多人五子棋', counts:[2,3,4,5,6]},
  doudizhu: {name:'斗地主', counts:[3]},
}
export type GameType = keyof typeof games
export const isGameType = (value: unknown): value is GameType => typeof value === 'string' && Object.hasOwn(games, value)
export const playerCounts = (type: GameType) => games[type].counts
export const gameName = (type: GameType) => games[type].name
