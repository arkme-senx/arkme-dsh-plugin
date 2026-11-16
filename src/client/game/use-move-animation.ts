import { useLayoutEffect, useRef, useState } from "react";
import type { State } from "./authority.js";
import { key, validatePath, type Board } from "./checkers.js";
export interface PreviousPosition {
  version: number;
  round: string;
  board?: Board | undefined;
  epoch: number;
}
export function playableMove(
  previous: PreviousPosition | undefined,
  state: State | undefined,
  epoch: number,
  paused: boolean,
) {
  const move = state?.lastMove;
  if (
    paused ||
    !previous?.board ||
    !state?.board ||
    !move ||
    !Array.isArray(move.path) ||
    typeof move.player !== "string" ||
    previous.epoch !== epoch ||
    previous.round !== state.round ||
    state.version !== previous.version + 1 ||
    move.version !== state.version
  )
    return undefined;
  if (
    !validatePath(previous.board, move.player, move.path) ||
    state.board.pieces[key(move.path.at(-1)!)] !== move.player
  )
    return undefined;
  return move;
}
export function useMoveAnimation(
  state: State | undefined,
  epoch: number,
  paused: boolean,
) {
  const previous = useRef<PreviousPosition>();
  const [animation, setAnimation] = useState<{
    move: NonNullable<State["lastMove"]>;
    segment: number;
    progress: number;
  }>();
  useLayoutEffect(() => {
    const next = playableMove(previous.current, state, epoch, paused);
    previous.current = state
      ? {
          version: state.version,
          round: state.round,
          board: state.board,
          epoch,
        }
      : undefined;
    setAnimation(undefined);
    if (!next || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    let frame = 0;
    const started = performance.now();
    const duration = 300;
    const tick = (now: number) => {
      // RAF uses the frame timestamp, which can precede setup in that frame.
      const elapsed = Math.max(0, now - started),
        segment = Math.floor(elapsed / duration);
      if (segment >= next.path.length - 1) {
        setAnimation(undefined);
        return;
      }
      setAnimation({
        move: next,
        segment,
        progress: Math.min(1, (elapsed % duration) / 240),
      });
      frame = requestAnimationFrame(tick);
    };
    tick(started);
    return () => cancelAnimationFrame(frame);
  }, [state?.version, state?.round, epoch, paused]);
  return animation;
}
