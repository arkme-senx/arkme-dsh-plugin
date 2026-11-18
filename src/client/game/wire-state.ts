import { cells, key, type Cell } from "./checkers.js";
import {isGameType, playerCounts, type GameType} from './game-types.js';
import type { State } from "./authority.js";
const indices = new Map(cells.map((cell, i) => [key(cell), i]));
// Two hex digits per board position keep even a maximal chain within 4 KiB.
export function encodeState(state: State) {
  if (state.gameType === 'multiplayer_gomoku') {
    if (!state.gomoku) return state;
    return {...state, gomoku: {...state.gomoku, cells: state.gomoku.cells.join('')}};
  }
  if (!state.lastMove) return state;
  const { path, ...move } = state.lastMove;
  return {
    ...state,
    lastMove: {
      ...move,
      route: path
        .map((c) => indices.get(key(c))!.toString(16).padStart(2, "0"))
        .join(""),
    },
  };
}
export function decodeState(value: any, expected: GameType = 'chinese_checkers'): State {
  const type = value?.gameType ?? 'chinese_checkers';
  if (!isGameType(type) || type !== expected || !Number.isSafeInteger(value?.version) || value.version < 1 || typeof value.round !== 'string' || !playerCounts(type).includes(value.count) || !Array.isArray(value.players) || value.players.length > value.count || !value.players.every((p: unknown) => typeof p === 'string') || new Set(value.players).size !== value.players.length || !Array.isArray(value.ready) || !value.ready.every((p: unknown)=>value.players.includes(p))) throw Error('Invalid game state');
  if (type === 'multiplayer_gomoku') {
    if (value.board || value.lastMove || ![30,60,90,120].includes(value.turnSeconds)) throw Error('Invalid gomoku state');
    if (!value.gomoku) return value;
    const b=value.gomoku;
    if (typeof b.cells !== 'string' || !/^[0-6]{225}$/.test(b.cells) || !Array.isArray(b.players) || b.players.length !== value.count || b.players.length !== value.players.length || !b.players.every((p: any,i: number)=>p && p.id === value.players[i] && typeof p.retired === 'boolean' && Number.isInteger(p.timeouts) && p.timeouts >= 0) || !Number.isInteger(b.turn) || b.turn < 0 || b.turn >= b.players.length || !Number.isFinite(b.deadline) || b.turnSeconds !== value.turnSeconds || typeof b.ended !== 'boolean') throw Error('Invalid gomoku board');
    const cells = [...b.cells].map(Number);
    if (cells.some(c=>c>b.players.length) || (b.lastCell !== undefined && (!Number.isInteger(b.lastCell) || b.lastCell<0 || b.lastCell>=225)) || (b.winner !== undefined && !value.players.includes(b.winner)) || (b.winningLine !== undefined && (!Array.isArray(b.winningLine) || b.winningLine.length<5 || b.winningLine.length>15 || !b.winningLine.every((c: unknown)=>Number.isInteger(c) && Number(c)>=0 && Number(c)<225)))) throw Error('Invalid gomoku cells');
    return {...value, gomoku:{...b,cells}};
  }
  if (value.gomoku) throw Error('Wrong game board');
  if (!value?.lastMove?.route) return value;
  const { route, ...move } = value.lastMove;
  if (
    typeof route !== "string" ||
    route.length < 4 ||
    route.length > 244 ||
    route.length % 2 ||
    !/^[0-9a-f]+$/.test(route)
  )
    throw Error("Invalid move route");
  const path: Cell[] = [];
  for (let i = 0; i < route.length; i += 2) {
    const cell = cells[parseInt(route.slice(i, i + 2), 16)];
    if (!cell) throw Error("Invalid move cell");
    path.push(cell);
  }
  return { ...value, lastMove: { ...move, path } };
}
