import React, { useEffect, useState, useRef, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { GameRuntime } from "./runtime.js";
import {
  cells,
  camps,
  layouts,
  key,
  validatePath,
  type Cell,
} from "./checkers.js";
import { invitation, type GameCommand } from "./command.js";
import type { Reply } from "./contracts.js";
import { useMoveAnimation } from "./use-move-animation.js";
const channel = "arkme.game.window.v1";
const pending = new Map<
  string,
  {
    resolve: (v: any) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
window.addEventListener("message", (e) => {
  if (
    e.source !== window.opener ||
    e.origin !== location.origin ||
    e.data?.channel !== channel
  )
    return;
  const p = pending.get(e.data.id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(e.data.id);
  if (e.data.error) p.reject(new Error(e.data.error));
  else p.resolve(e.data.data);
});
function rpc<T>(
  action: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!window.opener) {
      reject(new Error("请通过群聊中的 /game 口令打开游戏"));
      return;
    }
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("请求超时，请重试"));
    }, 25000);
    pending.set(id, { resolve, reject, timer });
    window.opener.postMessage({ channel, id, action, body }, location.origin);
  });
}
import {
  campColors,
  viewPoint,
  campTriangle,
  campOutlineScale,
  centerHex,
  playerBadgePosition,
} from "./presentation.js";
import { gameStyles } from "./style.js";
interface MemberProfile { membershipId: string; registrationId: string; userId: number; name: string; avatarUrl?: string }
function Avatar({url, name}: {url: string | undefined; name: string}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return <span className="person-avatar" aria-hidden="true">{url && !failed
    ? <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span>{Array.from(name)[0] || "人"}</span>}</span>;
}
function App() {
  const [, render] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => render((x) => x + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const [runtime] = useState(
    () =>
      new GameRuntime(
        (a, b) => rpc<Reply>(a, b),
        () => render((x) => x + 1),
        (id) => {
          void rpc("selected-room", { roomId: id });
        },
      ),
  );
  const [command, setCommand] = useState<GameCommand>();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const chatList = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = chatList.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [runtime.messages.at(-1)?.ID]);
  const [path, setPath] = useState<Cell[]>([]);
  const [notice, setNotice] = useState("");
  const [copy, setCopy] = useState("");
  const [started, setStarted] = useState(false);
  const run = (fn: () => Promise<unknown>) => {
    setNotice("");
    void fn().catch((e) =>
      setNotice(e instanceof Error ? e.message : "操作失败"),
    );
  };
  useEffect(() => {
    void rpc<{ command: GameCommand }>("init").then(
      (v) => {
        setCommand(v.command);
        if (v.command.kind === "join") {
          setStarted(true);
          void runtime.enter(v.command);
        }
      },
      (e) => setNotice(e.message),
    );
    const bus = new BroadcastChannel("arkme-game-discovery-v1");
    bus.onmessage = (e) => {
      if (e.data?.kind === "find") {
        window.focus();
        bus.postMessage({
          kind: "found",
          id: e.data.id,
          roomId:
            runtime.room?.room_id ??
            (command?.kind === "join" ? command.roomId : null),
        });
      }
    };
    const before = (e: BeforeUnloadEvent) => {
      if (runtime.room && !runtime.closed) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const unload = () => {
      void runtime.leave();
    };
    window.addEventListener("beforeunload", before);
    window.addEventListener("pagehide", unload);
    return () => {
      bus.close();
      window.removeEventListener("beforeunload", before);
      window.removeEventListener("pagehide", unload);
      void runtime.leave();
    };
  }, []);
  useEffect(() => setPath([]), [runtime.state?.version]);
  const room = runtime.room,
    state = runtime.state,
    board = state?.board,
    me = runtime.me;
  const animation = useMoveAnimation(
    state,
    runtime.animationEpoch,
    runtime.paused,
  );
  const [profiles, setProfiles] = useState<Record<string, MemberProfile>>({});
  const memberKey = room?.members.map(m => m.membership_id).sort().join(",") ?? "";
  useEffect(() => {
    if (!room || runtime.closed) return;
    let active = true;
    const refresh = async () => {
      try {
        const data = await rpc<{profiles: MemberProfile[]}>("profiles", {
          room_id: room.room_id, membership_id: me,
          ...(runtime.host ? {runtime_id: room.runtime_id} : {}),
        });
        if (active) setProfiles(previous => ({...previous, ...Object.fromEntries(data.profiles.map(p => [p.membershipId, p]))}));
      } catch { /* Profile availability never blocks the game. Retry next refresh. */ }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 60000);
    return () => { active = false; clearInterval(timer); };
  }, [room?.room_id, memberKey, me, runtime.closed]);
  const name = (id: string) => {
    const m = room?.members.find((m) => m.membership_id === id);
    return `${profiles[id]?.name || (m ? String(m.user_id) : "已离开成员")}${id === me ? "（你）" : ""}`;
  };
  const player = state?.players.includes(me) ?? false;
  const select = (cell: Cell) => {
    if (
      !board ||
      runtime.paused ||
      animation ||
      runtime.awaitingAction ||
      board.ended ||
      board.players[board.turn]?.id !== me
    )
      return;
    if (board.pieces[key(cell)] === me) {
      setPath([cell]);
      return;
    }
    const next = [...path, cell];
    if (validatePath(board, me, next)) setPath(next);
  };
  const leave = () => {
    if (
      !runtime.room ||
      confirm(
        runtime.host
          ? "退出将结束整个房间，确定退出？"
          : player
            ? "退出将离开本局，确定退出？"
            : "确定退出房间？",
      )
    )
      run(async () => {
        await runtime.leave();
        window.close();
      });
  };
  const sendChat = () => {
    if (sendingRef.current || !runtime.online || !room || !text.trim()) return;
    sendingRef.current = true;
    setSending(true);
    run(async () => {
      const sent = text;
      try {
        await runtime.text(sent);
        setText((current) => (current === sent ? "" : current));
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    });
  };
  const localPlayer = board?.players.find((p) => p.id === me);
  const home = localPlayer?.camp;
  const myTurn =
    !!board &&
    !board.ended &&
    board.players[board.turn]?.id === me &&
    !runtime.paused &&
    !animation &&
    !runtime.awaitingAction;
  const seconds = board
    ? Math.max(0, Math.ceil((board.deadline - runtime.now) / 1000))
    : 0;
  const currentName = board ? name(board.players[board.turn]!.id) : "";
  const point = (c: Cell) => viewPoint(c, home);
  const canStart =
    !!state &&
    !runtime.paused &&
    !runtime.awaitingAction &&
    state.players.length === state.count &&
    state.players.every((p) => state.ready.includes(p)) &&
    !room?.members.some((m) => m.status === "joining");
  const startHint =
    state && state.players.length < state.count
      ? `还需 ${state.count - state.players.length} 人加入`
      : state && !state.players.every((p) => state.ready.includes(p))
        ? "等待所有参与者准备"
        : "人员已就绪，房主可以开始游戏";
  return (
    <div className="game-app">
      <style>{gameStyles}</style>
      <header className="game-header">
        <strong className="brand">✦ Arkme · 跳棋</strong>
        <span className="room-meta">
          {room ? `房间 ${room.room_id.slice(0, 8)}` : "一起玩一局，轻松一下"}
        </span>
        <span className="connection">
          {runtime.online ? "● 已连接" : "○ 未连接"}
        </span>
        {runtime.host && runtime.token && room?.status === "open" && (
          <button
            onClick={() =>
              run(async () => {
                const value = invitation(room.room_id, runtime.token);
                try {
                  await navigator.clipboard.writeText(value);
                  setNotice("房间钥匙已复制");
                } catch {
                  setCopy(value);
                }
              })
            }
          >
            复制房间钥匙
          </button>
        )}
        <button className="danger" onClick={leave}>
          {room ? "退出房间" : "取消进入"}
        </button>
      </header>
      {(notice || runtime.error) && (
        <div className="notice" role="status">
          {notice || runtime.error}
        </div>
      )}
      {runtime.initializationFailed && (
        <div className="actions">
          <button onClick={() => run(() => runtime.retry())}>重试连接</button>
        </div>
      )}
      {copy && (
        <textarea
          className="copy-fallback"
          aria-label="手动复制房间钥匙"
          readOnly
          value={copy}
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
      <main className="game-main">
        <section className="play-area">
          {!started && command?.kind === "create" && (
            <div className="card picker">
              <div className="eyebrow">ARKME GAME ROOM</div>
              <div className="picker-icon">✦</div>
              <h2>下一步，跳出精彩</h2>
              <p className="muted">经典六角星跳棋 · 好友对弈 · 实时聊天</p>
              <button
                className="primary"
                onClick={() => {
                  setStarted(true);
                  void runtime.enter(command);
                }}
              >
                跳棋 · 2 / 3 / 4 / 6 人
              </button>
              <p className="muted">创建房间后，复制钥匙邀请朋友加入</p>
            </div>
          )}
          {started && !state && (
            <div className="card picker">
              <div className="picker-icon">✦</div>
              <h2>{runtime.status || "等待房主同步…"}</h2>
              <p className="muted">连接成功后将自动进入房间</p>
            </div>
          )}
          {state && !board && (
            <div className="card">
              <span className="status-tag">
                {player ? "参与游戏" : "正在观战"} · 本局 {state.count} 人
              </span>
              <h2 style={{ marginTop: 16 }}>等待开局</h2>
              <p className="muted">复制房间钥匙，邀请朋友一起跳棋</p>
              {runtime.paused && (
                <div role="status" className="notice">
                  连接恢复中，暂停操作
                </div>
              )}
              <div className="lobby-controls">
                <strong>本局人数</strong>
                {runtime.host ? (
                  <div className="segmented" role="group" aria-label="本局人数">
                    {[2, 3, 4, 6].map((n) => (
                      <button
                        key={n}
                        aria-pressed={state.count === n}
                        disabled={runtime.paused || runtime.awaitingAction}
                        onClick={() => run(() => runtime.act("count", n))}
                      >
                        {n} 人
                      </button>
                    ))}
                  </div>
                ) : (
                  <span>{state.count} 人</span>
                )}
              </div>
              <ol className="players">
                {Array.from({ length: state.count }, (_, i) => {
                  const id = state.players[i];
                  return (
                    <li className="player-card" key={i}>
                      <span
                        className="avatar"
                        style={{
                          background: id
                            ? campColors[layouts[state.count]![i]!]
                            : "#d8dfe5",
                        }}
                      >
                        {id ? i + 1 : "＋"}
                      </span>
                      <div>
                        <strong>{id ? name(id) : "等待加入"}</strong>
                        <div
                          className={
                            id && state.ready.includes(id)
                              ? "muted ready"
                              : "muted"
                          }
                        >
                          {id
                            ? `${id === room?.host_membership_id ? "房主 · " : ""}${state.ready.includes(id) ? "✓ 已准备" : "未准备"}`
                            : "空闲座位"}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <div className="actions">
                {player && (
                  <button
                    className={state.ready.includes(me) ? "" : "primary"}
                    disabled={runtime.paused || runtime.awaitingAction}
                    onClick={() => run(() => runtime.act("ready"))}
                  >
                    {state.ready.includes(me) ? "取消准备" : "准备"}
                  </button>
                )}
                {runtime.host && (
                  <button
                    className="primary"
                    disabled={!canStart}
                    onClick={() => run(() => runtime.act("start"))}
                  >
                    开始游戏
                  </button>
                )}
              </div>
              <p className="muted" style={{ textAlign: "center" }}>
                {!player
                  ? "你正在观战，下一局将按进房顺序分配参与者"
                  : startHint}
              </p>
            </div>
          )}
          {board && (
            <>
              <div
                key={`${state?.round ?? ""}-${board.turn}-${runtime.paused}`}
                className={`turn-banner ${runtime.paused ? "paused" : myTurn ? "mine" : ""}`}
                role="status"
                aria-live="polite"
              >
                <div>
                  <strong>
                    {runtime.paused
                      ? "连接恢复中，暂停操作"
                      : animation
                        ? "正在演示走棋路径…"
                        : board.ended
                          ? `本局结束 · ${board.winner ? `${name(board.winner)} 获胜` : "无胜者"}`
                          : myTurn
                            ? "● 轮到你了"
                            : `${player ? "等待" : "正在观战 · 等待"} ${currentName} 走棋`}
                  </strong>
                  <span className="muted">
                    {runtime.paused
                      ? "恢复同步后才可继续走棋"
                      : board.ended
                        ? "感谢这场对弈，再来一局吧"
                        : myTurn
                          ? "请选择棋子，完成路径后确认走棋"
                          : player
                            ? "你的营地在下方，目标营地在正上方"
                            : "观察者不能操作棋子，可以在右侧聊天"}
                  </span>
                </div>
                {!board.ended && (
                  <span
                    aria-label={`剩余 ${seconds} 秒`}
                    className={`clock ${seconds <= 10 ? "urgent" : ""}`}
                  >
                    {String(Math.floor(seconds / 60)).padStart(2, "0")}:
                    {String(seconds % 60).padStart(2, "0")}
                  </span>
                )}
              </div>
              <div className="board-wrap">
                <svg
                  className="board-svg"
                  role="img"
                  aria-label="六角星跳棋棋盘"
                  viewBox="-370 -335 740 670"
                  data-home-camp={home ?? "observer"}
                >
                  <defs>
                    <radialGradient id="boardSurface">
                      <stop offset="0" stopColor="#fffdf6" />
                      <stop offset="1" stopColor="#f1e8d6" />
                    </radialGradient>
                    <filter
                      id="boardShadow"
                      x="-20%"
                      y="-20%"
                      width="140%"
                      height="145%"
                    >
                      <feDropShadow
                        dx="0"
                        dy="5"
                        stdDeviation="5"
                        floodColor="#273645"
                        floodOpacity=".18"
                      />
                    </filter>
                    {campColors.map((color, i) => (
                      <radialGradient
                        key={i}
                        id={`piece-${i}`}
                        cx="32%"
                        cy="25%"
                        r="80%"
                      >
                        <stop stopColor="#fff" stopOpacity=".8" />
                        <stop offset=".3" stopColor={color} />
                        <stop offset="1" stopColor={color} />
                      </radialGradient>
                    ))}
                  </defs>
                  <circle r="250" fill="#4d6070" filter="url(#boardShadow)" />
                  <circle r="243" fill="#bcc6c8" />
                  <circle
                    r="238"
                    fill="url(#boardSurface)"
                    stroke="#718391"
                    strokeWidth="1.5"
                  />
                  <polygon
                    data-center-hex="true"
                    points={centerHex
                      .map((c) =>
                        point(c)
                          .map((n) => n * 1.08)
                          .join(","),
                      )
                      .join(" ")}
                    fill="#dce7e9"
                    fillOpacity=".7"
                  />
                  {camps.map((camp, i) => {
                    const pts = campTriangle(i).map(point);
                    const center = [
                      pts.reduce((s, p) => s + p[0], 0) / 3,
                      pts.reduce((s, p) => s + p[1], 0) / 3,
                    ];
                    return (
                      <polygon
                        key={i}
                        data-camp={i}
                        points={pts
                          .map(
                            (p) =>
                              `${center[0]! + (p[0] - center[0]!) * campOutlineScale},${center[1]! + (p[1] - center[1]!) * campOutlineScale}`,
                          )
                          .join(" ")}
                        fill={campColors[i]}
                        fillOpacity=".19"
                        stroke={campColors[i]}
                        strokeOpacity=".65"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                      />
                    );
                  })}
                  {path.length > 1 && (
                    <polyline
                      className="path-line"
                      points={path.map((c) => point(c).join(",")).join(" ")}
                    />
                  )}
                  {cells.map((c) => {
                    const k = key(c),
                      [x, y] = point(c);
                    let owner = board.pieces[k];
                    if (animation && k === key(animation.move.path.at(-1)!))
                      owner = undefined;
                    if (!animation && path.length > 1) {
                      if (k === key(path[0]!)) owner = undefined;
                      if (k === key(path.at(-1)!)) owner = me;
                    }
                    const p = board.players.find((p) => p.id === owner),
                      selected = path.some((v) => key(v) === k),
                      valid =
                        myTurn &&
                        path.length > 0 &&
                        validatePath(board, me, [...path, c]);
                    return (
                      <g key={k}>
                        {valid && (
                          <g data-landing={k}>
                            <circle
                              className="landing-marker"
                              cx={x}
                              cy={y}
                              r="13"
                            />
                          </g>
                        )}
                        {selected && (
                          <circle
                            className="selection-ring"
                            cx={x}
                            cy={y}
                            r="13"
                          />
                        )}
                        <circle
                          data-cell={k}
                          className="board-cell"
                          cx={x}
                          cy={y}
                          r="9.5"
                          fill={
                            p
                              ? `url(#piece-${p.camp})`
                              : valid
                                ? "#c7e7da"
                                : "#e3ddcf"
                          }
                          stroke={
                            p
                              ? campColors[p.camp]
                              : valid
                                ? "#3f9577"
                                : "#c7bfaf"
                          }
                          strokeWidth={p || valid ? 1.8 : 1}
                          onClick={() => select(c)}
                          tabIndex={myTurn ? 0 : -1}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              select(c);
                            }
                          }}
                          aria-label={`${owner ? name(owner) : "空位"} ${k}`}
                        >
                          <title>
                            {owner ? name(owner) : "空位"} {k}
                          </title>
                        </circle>
                        {valid && (
                          <circle className="landing-dot" cx={x} cy={y} r="3" />
                        )}
                        {selected && (
                          <text
                            x={x}
                            y={y + 3.5}
                            textAnchor="middle"
                            fontSize="10"
                            fill={owner ? "white" : "#35596c"}
                            pointerEvents="none"
                          >
                            {path.findIndex((v) => key(v) === k) + 1}
                          </text>
                        )}
                      </g>
                    );
                  })}
                  {animation &&
                    (() => {
                      const a = point(animation.move.path[animation.segment]!),
                        b = point(animation.move.path[animation.segment + 1]!),
                        t = animation.progress;
                      const x = a[0] + (b[0] - a[0]) * t,
                        y = a[1] + (b[1] - a[1]) * t;
                      const camp =
                        board.players.find(
                          (p) => p.id === animation.move.player,
                        )?.camp ?? 0;
                      return (
                        <g
                          className="move-animation"
                          data-animation-segment={animation.segment}
                        >
                          <polyline
                            className="path-line"
                            points={animation.move.path
                              .map((c) => point(c).join(","))
                              .join(" ")}
                          />
                          <ellipse
                            cx={x}
                            cy={y + 5}
                            rx={9 - 3 * Math.sin(t * Math.PI)}
                            ry="3"
                            fill="#273645"
                            opacity=".2"
                          />
                          <circle
                            cx={x}
                            cy={y - 12 * Math.sin(t * Math.PI)}
                            r="10"
                            fill={`url(#piece-${camp})`}
                            stroke={campColors[camp]}
                            strokeWidth="2"
                          />
                        </g>
                      );
                    })()}
                  {home !== undefined && (() => {
                    const [x,y] = point(camps[(home + 3) % 6]![9]!);
                    const n = Math.hypot(x,y);
                    return <text className="board-label" x={x/n*230} y={y/n*230+4} textAnchor="middle">目标</text>;
                  })()}
                  {board.players.map(p => {
                    const [x,y] = playerBadgePosition(point(camps[p.camp]![9]!));
                    const current = !board.ended && !runtime.paused && board.players[board.turn]?.id === p.id;
                    return <foreignObject key={p.id} x={x-64} y={y-24} width="128" height="48" data-player-badge={p.id}>
                      <div className={`camp-player ${current ? "current" : ""}`} style={{borderColor: current ? "#236453" : campColors[p.camp]}} title={name(p.id)}>
                        <Avatar url={profiles[p.id]?.avatarUrl} name={name(p.id)} />
                        <span className="camp-identity"><span className="person-name">{name(p.id)}</span>{current && <span className="turn-label">当前回合</span>}</span>
                      </div>
                    </foreignObject>;
                  })}
                </svg>
              </div>
              {player && !board.ended && (
                <div className="actions move-bar">
                  <span className="muted">
                    {path.length > 1
                      ? `已选择 ${path.length - 1} 段路径`
                      : myTurn
                        ? "选择一枚棋子开始"
                        : "等待你的回合"}
                  </span>
                  <button
                    disabled={!path.length || !myTurn || runtime.awaitingAction}
                    onClick={() => setPath([])}
                  >
                    重新选子
                  </button>
                  <button
                    disabled={
                      path.length < 2 || !myTurn || runtime.awaitingAction
                    }
                    onClick={() => setPath((p) => p.slice(0, -1))}
                  >
                    撤销一步
                  </button>
                  <button
                    className="primary"
                    disabled={
                      !myTurn || runtime.awaitingAction || path.length < 2
                    }
                    onClick={() =>
                      run(async () => {
                        await runtime.act("move", path);
                        setPath([]);
                      })
                    }
                  >
                    确认走棋
                  </button>
                </div>
              )}
              {runtime.host && board.ended && (
                <button
                  className="primary"
                  disabled={runtime.paused || runtime.awaitingAction}
                  onClick={() => run(() => runtime.act("next"))}
                >
                  下一局
                </button>
              )}
            </>
          )}
        </section>
        <aside className="chat">
          <div className="chat-head">
            <strong>房间聊天</strong>
            <span className="status-tag">
              {room?.members.filter((m) => m.status === "active").length ?? 0}{" "}
              人
            </span>
          </div>
          <div className="messages" ref={chatList}>
            {!runtime.messages.length && (
              <div className="chat-empty">
                聊聊下一步
                <br />
                <small>参与者和观察者都可以发言</small>
              </div>
            )}
            {runtime.messages.map((m) => {
              const id =
                room?.members.find((x) => x.registration_id === m.from)
                  ?.membership_id ?? Object.values(profiles).find(p => p.registrationId === m.from)?.membershipId ?? "";
              return (
                <p className={`message ${id === me ? "own" : ""}`} key={m.ID}>
                  <Avatar url={profiles[id]?.avatarUrl} name={name(id)} />
                  <span className="message-content"><small title={name(id)}>{name(id)}</small>
                  <span className="bubble">{m.payload.text}</span></span>
                </p>
              );
            })}
          </div>
          <div className="chat-compose">
            <textarea
              aria-label="聊天文字"
              placeholder="说点什么，一起聊聊…"
              value={text}
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
              disabled={!runtime.online || !room}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  e.nativeEvent.keyCode !== 229
                ) {
                  e.preventDefault();
                  sendChat();
                }
              }}
              rows={3}
            />
            <div className="chat-footer">
              <small className="muted">{text.length}/500</small>
              <button
                className="primary"
                disabled={sending || !runtime.online || !room || !text.trim()}
                onClick={sendChat}
              >
                发送
              </button>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
document.body.style.margin = "0";
// A device may have several Arkme conversation windows. Hold the same-origin
// lock in the game page so those launchers cannot create duplicate SDK logins.
if (!navigator.locks)
  document.getElementById("game")!.textContent =
    "当前客户端不支持游戏窗口互斥，请升级客户端";
else
  void navigator.locks.request(
    "arkme-game-window-v1",
    { ifAvailable: true },
    async (lock) => {
      if (!lock) {
        document.getElementById("game")!.textContent =
          "已有游戏窗口，请回到该窗口继续";
        return;
      }
      createRoot(document.getElementById("game")!).render(<App />);
      await new Promise<void>((resolve) =>
        window.addEventListener("pagehide", () => resolve(), { once: true }),
      );
    },
  );
