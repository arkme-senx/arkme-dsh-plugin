import { cells, key, type Cell } from "./checkers.js";
import type { State } from "./authority.js";
const indices = new Map(cells.map((cell, i) => [key(cell), i]));
// Two hex digits per board position keep even a maximal chain within 4 KiB.
export function encodeState(state: State) {
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
export function decodeState(value: any): State {
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
