import { it, expect } from "vitest";
import { createBoard, move, type Cell } from "../src/client/game/checkers.js";
import { playableMove } from "../src/client/game/use-move-animation.js";
import { Authority, type State } from "../src/client/game/authority.js";
it("replays a confirmed multi-jump only on contiguous state, never on reconnect/repeated snapshots", () => {
  const board = createBoard(["a", "b"], 1000);
  board.pieces = { "0,0": "a", "1,0": "b", "3,0": "b" };
  const path: Cell[] = [
      [0, 0],
      [2, 0],
      [4, 0],
    ],
    lastMove = { version: 2, player: "a", path };
  const next: State = {
    version: 2,
    round: "r",
    count: 2,
    players: ["a", "b"],
    ready: [],
    board: move(board, "a", path, 2000),
    lastMove,
  };
  const prev = { version: 1, round: "r", board, epoch: 0 };
  expect(playableMove(prev, next, 0, false)?.path).toEqual(path);
  expect(playableMove(undefined, next, 0, false)).toBeUndefined();
  expect(playableMove(prev, next, 1, false)).toBeUndefined();
  expect(playableMove(prev, next, 0, true)).toBeUndefined();
  expect(playableMove({ ...prev, version: 2 }, next, 0, false)).toBeUndefined();
  expect(
    playableMove({ ...prev, round: "old" }, next, 0, false),
  ).toBeUndefined();
  expect(playableMove(prev, { ...next, version: 4 }, 0, false)).toBeUndefined();
});
it("host includes only validated paths, and command retry cannot produce a new animation", () => {
  const host = new Authority("a");
  host.state = {
    version: 1,
    round: "r",
    count: 2,
    players: ["a", "b"],
    ready: [],
    board: createBoard(["a", "b"], 1000),
  };
  host.state.board!.pieces = { "0,0": "a", "1,0": "b", "3,0": "b" };
  const members = ["a", "b"].map((id, i) => ({
    membership_id: id,
    user_id: i,
    client_id: 1,
    registration_id: id,
    binding_generation: "x",
    join_seq: i,
    status: "active" as const,
    lease_expires_at: 99000,
  }));
  const action = {
    id: "m",
    version: 1,
    round: "r",
    kind: "move" as const,
    value: [
      [0, 0],
      [2, 0],
      [4, 0],
    ],
  };
  expect(host.apply("a", action, members, 2000)).toBe("");
  expect(host.state.lastMove).toEqual({
    version: 2,
    player: "a",
    path: action.value,
  });
  expect(host.apply("a", action, members, 2000)).toBe("");
  expect(host.state.version).toBe(2);
  expect(
    host.apply("b", { ...action, id: "bad", version: 2 }, members, 2000),
  ).not.toBe("");
  expect(host.state.lastMove?.version).toBe(2);
});

import { encodeState, decodeState } from "../src/client/game/wire-state.js";
import { cells } from "../src/client/game/checkers.js";
it("roundtrips the full route and keeps six-player maximum snapshots below 4 KiB", () => {
  const ids = Array.from({ length: 6 }, (_, i) => String(i).repeat(32));
  const s: State = {
    version: 999999,
    round: "r".repeat(36),
    count: 6,
    players: ids,
    ready: [],
    board: createBoard(ids, Date.now()),
    lastMove: { version: 999999, player: ids[0]!, path: [...cells, cells[0]!] },
  };
  const encoded = encodeState(s);
  expect(decodeState(encoded)).toEqual(s);
  expect(
    new TextEncoder().encode(
      JSON.stringify({
        protocol_version: 1,
        room_id: "a".repeat(32),
        runtime_id: "r".repeat(36),
        type: "snapshot",
        payload: encoded,
      }),
    ).length,
  ).toBeLessThanOrEqual(4096);
  expect(() =>
    decodeState({ ...encoded, lastMove: { route: "ffff" } }),
  ).toThrow();
});
