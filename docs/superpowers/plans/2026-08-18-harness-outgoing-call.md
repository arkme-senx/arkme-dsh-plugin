# Harness Private-Chat Outgoing Call Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add private-chat audio/video outgoing calls in a frontend-faithful modal and a `jotmo_call_start` Tool that opens the same call flow after resolving an exact private-chat `source_ref`.

**Architecture:** Keep identity resolution, TRTC credentials, room creation, intent rendezvous, and cross-tab call leases in the Host-side `JotmoService`. Mount one browser-side outgoing-call coordinator from the always-present Footer tree; it consumes direct header actions or claimed Tool intents, embeds the pinned `jotmo_frontend` desktop-call bundle in a same-origin iframe, and reports `calling` or failure back to the Host. No public SDK method receives UserSig, raw user IDs, room IDs, or TRTC accounts.

**Tech Stack:** TypeScript 6, Node.js 22+, React 18, ReactDOM Portal, Cordis web-server routes, Vitest 4, pnpm 11, pinned `@trtc/call-engine-lite-js` bundle from `jotmo_frontend`.

**Spec:** `docs/superpowers/specs/2026-08-18-harness-outgoing-call-design.md`

## Global Constraints

- Only one-to-one `private_chat` outgoing calls are in scope; do not register incoming listeners, expose accept/reject UI, or keep TRTC logged in while idle.
- The default modal content is `960 × 640`, the minimum responsive call surface is `360 × 640`, and compact mode is `160 × 280`.
- The header trigger is `24 × 24`, contains the exact `20 × 20` frontend icon, opens `8px` below the trigger, and uses a `12px` menu radius with `32px` rows, `18px` row icons, and `13px / 500` labels.
- Tool media values are exactly `audio | video`; Tool success is emitted only after the iframe sends `calling`.
- Tool callers must obtain an unchanged `source_ref` from `jotmo_sources_list(root)` and must never resolve a destination by guessed nickname.
- UserSig may exist only in the prepare response, browser coordinator transient memory, and iframe memory. It must never enter Tool output, logs, URL/query/hash values, DOM attributes, navigation state, local/session storage, IndexedDB, SQLite, or public SDK DTOs.
- Access/refresh tokens, OSS credentials, raw user IDs, room IDs, and TRTC accounts must never enter Tool output or Agent-visible responses.
- The iframe must be same-origin and package-local. Validate `event.origin`, `event.source`, bridge channel, and `callRequestId`; reject every unknown or stale event.
- Preserve all pre-existing staged, unstaged, and untracked user changes. In particular, inspect and merge around the current changes in `src/jotmo-tools.ts`, call-presentation files, and their tests instead of replacing them.
- The worktree is already dirty. Each task includes a suggested commit checkpoint for reviewer boundaries, but do not run `git add`, `git commit`, or `git push` until the commit gate has shown the exact diff summary and the user has explicitly approved it.
- Use TDD for every behavior change: add one focused failing test, observe the expected failure, implement the smallest passing behavior, then run the focused suite and typecheck.

## File Structure

### New Host files

- `src/outgoing-call-contract.ts` — internal-only request/result, iframe payload, intent, completion, and error types. This module is imported by Host and browser bundles but is not re-exported from `src/index.ts` or the public SDK.
- `src/outgoing-call-broker.ts` — account-scoped in-memory Tool intent broker plus cross-tab active-call lease/heartbeat.
- `src/outgoing-call-assets.ts` — allowlisted static-asset resolver and HTTP handler for the pinned iframe page, bundle, icon, and manifest.
- `scripts/verify-call-assets.mjs` — read-only SHA-256 verifier used by CI/build checks.
- `tests/outgoing-call-broker.test.ts` — deterministic fake-clock tests for intent TTL, claim, completion, abort, account isolation, and active lease expiry.
- `tests/outgoing-call-assets.test.ts` — allowlist, content type, CSP, cache, hash-manifest, and traversal rejection tests.
- `tests/host-api.test.ts` — request parameter validation and internal operation dispatch tests.

### New browser files

- `src/client/outgoing-call-ui-controller.ts` — a small external store for direct header requests and current modal snapshot.
- `src/client/outgoing-call-bridge.ts` — strict iframe event parser, host command sender, and browser media-permission adapter.
- `src/client/outgoing-call-runtime.ts` — framework-neutral state machine for claim polling, prepare, iframe bootstrap/call, lease heartbeat, terminal cleanup, and Tool completion.
- `src/client/JotmoOutgoingCallHost.tsx` — Portal/modal/iframe shell that renders runtime snapshots and maps full/compact/close actions.
- `src/client/JotmoPrivateCallMenu.tsx` — frontend-faithful private-chat call trigger and audio/video menu.
- `tests/outgoing-call-bridge.test.ts` — bridge validation, commands, permission outcomes, and stale-event tests.
- `tests/outgoing-call-runtime.test.ts` — direct and Tool call state-machine tests with fake API, bridge, clock, and frame.
- `tests/client-outgoing-call-ui.test.ts` — server-rendered menu markup and pure modal-layout tests without adding a DOM test framework.

### Pinned assets

- `assets/desktop_call/index.html` — adapted same-origin Harness bridge; visual DOM remains owned by the frontend bundle.
- `assets/desktop_call/bundle.js` — exact copy of `jotmo_frontend/assets/web/desktop_call/bundle.js`.
- `assets/desktop_call/call-linear-strong.svg` — exact copy of the existing frontend header icon.
- `assets/desktop_call/manifest.json` — upstream commit and SHA-256 pins.

### Existing files to modify

- `src/types.ts` — add `outgoingCall: true`, the harmless call-asset base path in `JotmoClientConfig`, and internal Host operation string literals only.
- `src/jotmo-service.ts` — validate private Source, refresh chat counterpart, prepare credentials/room, wrap the broker, and clear call state on logout.
- `src/host-api.ts` — parse the five internal call operations without adding sensitive serialization or permissive parameter coercion.
- `src/jotmo-tools.ts` — add the explicit-authorization prompt rule and `jotmo_call_start` definition while preserving current user edits.
- `src/index.ts` — construct/dispose the broker and register the allowlisted asset prefix route.
- `src/client/JotmoFooterDropdown.tsx` — mount the global call host regardless of whether the Jiwo directory is open.
- `src/client/JotmoSidebar.tsx` — render the call menu after a private-chat title only.
- `src/client/index.tsx` — export the new focused components/controller for tests and downstream diagnostics.
- `package.json` — include `assets/desktop_call` in published files and add a deterministic asset verification script.
- `README.md` — document outbound-only UI/Tool behavior and manual verification.
- `tests/jotmo-service.test.ts`, `tests/jotmo-tools.test.ts`, `tests/index.test.ts`, `tests/client-adapter.test.ts` — extend current patterns without rewriting existing call-history coverage.

---

### Task 1: Internal contract and account-scoped intent broker

**Files:**

- Create: `src/outgoing-call-contract.ts`
- Create: `src/outgoing-call-broker.ts`
- Create: `tests/outgoing-call-broker.test.ts`

**Interfaces:**

- Consumes: `JotmoPluginError`-compatible normalized error fields; injected `now`, `randomId`, `setTimer`, and `clearTimer` functions for deterministic tests.
- Produces:

```ts
export type JotmoOutgoingCallMediaType = 'audio' | 'video'
export type JotmoOutgoingCallFailureCode =
  | 'call-ui-unavailable'
  | 'call-active'
  | 'call-source-invalid'
  | 'call-peer-unavailable'
  | 'call-permission-denied'
  | 'call-bootstrap-failed'
  | 'call-engine-failed'
  | 'call-cancelled'

export interface JotmoOutgoingCallIntentClaim {
  intentId: string
  claimToken: string
  callRequestId: string
  sourceRef: string
  displayName: string
  mediaType: JotmoOutgoingCallMediaType
  expiresAtMillis: number
}

export interface JotmoOutgoingCallToolResult {
  status: 'calling'
  displayName: string
  mediaType: JotmoOutgoingCallMediaType
}

export interface JotmoOutgoingCallIntentResolutionInput {
  userId: number
  intentId: string
  claimToken: string
  outcome:
    | { status: 'calling' }
    | { status: 'failed'; code: JotmoOutgoingCallFailureCode; message: string }
}

export class JotmoOutgoingCallBroker {
  request(input: {
    userId: number
    sourceRef: string
    displayName: string
    mediaType: JotmoOutgoingCallMediaType
    signal?: AbortSignal
  }): Promise<JotmoOutgoingCallToolResult>
  claim(userId: number): JotmoOutgoingCallIntentClaim | null
  resolveIntent(input: JotmoOutgoingCallIntentResolutionInput): void
  acquireLease(userId: number, callRequestId: string): number
  heartbeatLease(userId: number, callRequestId: string): number
  releaseLease(userId: number, callRequestId: string): void
  clearUser(userId: number, message: string): void
  dispose(): void
}
```

- [ ] **Step 1: Write failing broker tests**

Add tests with a fake clock for these exact cases:

```ts
it('allows one page to claim an intent and resolves only with its one-time token', async () => {
  const pending = broker.request({
    userId: 7,
    sourceRef: 'jotmo-source-v1.payload.signature',
    displayName: '小林',
    mediaType: 'video',
  })
  const claim = broker.claim(7)!
  expect(broker.claim(7)).toBeNull()
  expect(() => broker.resolveIntent({
    userId: 8,
    intentId: claim.intentId,
    claimToken: claim.claimToken,
    outcome: { status: 'calling' },
  })).toThrow(/账号/)
  broker.resolveIntent({ userId: 7, intentId: claim.intentId, claimToken: claim.claimToken, outcome: { status: 'calling' } })
  await expect(pending).resolves.toEqual({ status: 'calling', displayName: '小林', mediaType: 'video' })
})

it('expires an unclaimed intent after 30 seconds with call-ui-unavailable', async () => {
  const pending = broker.request({ userId: 7, sourceRef: 'source', displayName: '小林', mediaType: 'audio' })
  clock.advanceBy(30_001)
  await expect(pending).rejects.toMatchObject({ code: 'call-ui-unavailable' })
})

it('keeps a claimed browser call independent when the Tool signal aborts', async () => {
  const abort = new AbortController()
  const pending = broker.request({ userId: 7, sourceRef: 'source', displayName: '小林', mediaType: 'audio', signal: abort.signal })
  const claim = broker.claim(7)!
  abort.abort()
  await expect(pending).rejects.toMatchObject({ code: 'call-cancelled' })
  expect(() => broker.resolveIntent({ userId: 7, intentId: claim.intentId, claimToken: claim.claimToken, outcome: { status: 'calling' } })).not.toThrow()
})
```

Also assert that a second lease is rejected, a matching heartbeat extends the `120_000ms` lease, a stale heartbeat cannot revive it, release is request-ID scoped, `clearUser` rejects only that account, and `dispose` clears all timers.

- [ ] **Step 2: Run the focused test and observe the missing-module failure**

Run:

```bash
pnpm vitest run tests/outgoing-call-broker.test.ts
```

Expected: FAIL because `src/outgoing-call-broker.ts` does not exist.

- [ ] **Step 3: Implement the internal types and smallest broker**

Use constants, not magic numbers:

```ts
const INTENT_TTL_MS = 30_000
const ACTIVE_LEASE_TTL_MS = 120_000

interface PendingIntent {
  userId: number
  intentId: string
  callRequestId: string
  claimToken?: string
  claimed: boolean
  toolSettled: boolean
  resolve(value: JotmoOutgoingCallToolResult): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}
```

Delete each pending entry and remove abort listeners exactly once. Keep claimed entries long enough to accept a browser result even if the Tool signal has already aborted, but never re-resolve the settled Tool Promise. Validate positive safe-integer account IDs and non-empty opaque refs/request IDs at every public method.

- [ ] **Step 4: Run broker tests and typecheck**

Run:

```bash
pnpm vitest run tests/outgoing-call-broker.test.ts
pnpm typecheck
```

Expected: all broker tests PASS; typecheck PASS.

- [ ] **Step 5: Commit checkpoint (requires the separate commit gate)**

Suggested message: `feat(jotmo): add outgoing call intent broker`

---

### Task 2: Private-chat preparation and TRTC service orchestration

**Files:**

- Modify: `src/jotmo-service.ts`
- Modify: `src/types.ts`
- Modify: `src/outgoing-call-contract.ts`
- Modify: `tests/jotmo-service.test.ts`

**Interfaces:**

- Consumes: `JotmoOutgoingCallBroker` and media/failure types from Task 1; existing authenticated Chat/Auth/WebRTC request helpers and HMAC Source opening.
- Produces:

```ts
export interface JotmoOutgoingCallPrepareResult {
  callRequestId: string
  displayName: string
  peerAvatarRef?: string
  bootstrap: {
    sdkAppId: number
    userId: string
    userSig: string
    nickName: string
    avatar: ''
  }
  call: {
    roomId: string
    mediaType: 'audio' | 'video'
    calleeAccounts: string[]
    calleeName: string
    calleeAvatar: ''
    callerName: string
    callerAvatar: ''
    timeoutSec: 30
    userData: string
    offlinePushInfo: {
      title: string
      description: string
      extension: string
      ignoreIOSBadge: true
      iOSPushType: 1
    }
  }
}

JotmoService.requestOutgoingCall(
  sourceRef: string,
  mediaType: 'audio' | 'video',
  signal?: AbortSignal,
): Promise<JotmoOutgoingCallToolResult>

JotmoService.claimOutgoingCallIntent(): Promise<JotmoOutgoingCallIntentClaim | null>
JotmoService.resolveOutgoingCallIntent(input: Omit<JotmoOutgoingCallIntentResolutionInput, 'userId'>): Promise<void>
JotmoService.prepareOutgoingCall(input: {
  sourceRef: string
  mediaType: 'audio' | 'video'
  callRequestId: string
  signal?: AbortSignal
}): Promise<JotmoOutgoingCallPrepareResult>
JotmoService.heartbeatOutgoingCall(callRequestId: string): Promise<{ expiresAtMillis: number }>
JotmoService.releaseOutgoingCall(callRequestId: string): Promise<void>
```

- [ ] **Step 1: Add failing preparation contract tests**

Build the happy-path fetch fixture in this exact order:

```ts
expect(requests.map(item => item.url)).toEqual([
  'https://chat.test/api/v1/chats/detail',
  'https://auth.test/api/v1/auth/get-user-info',
  'https://auth.test/api/v1/auth/get-public-users-by-ids',
  'https://webrtc.test/api/v1/trtc/credentials',
  'https://webrtc.test/api/v1/trtc/create-room',
])
expect(requests[0]!.body).toEqual({ chat_session_uid: 'chat-private-1' })
expect(requests[4]!.body).toMatchObject({
  shared_topic_id: 0,
  chat_session_uid: 'chat-private-1',
  callee_user_ids: [20002],
  call_media_type: 1,
  caller_name: '我的昵称',
})
```

The Chat detail response must contain `session.chat_session_uid`, private `session_kind`, `private_counterpart.user_id`, and supplement/display fields. Credentials return `sdk_app_id`, device-scoped `user_id`, and `user_sig`; room creation returns non-empty `room_id` and `callee_accounts`.

Assert the private prepare result matches the iframe payload and `peerAvatarRef` is opaque. In a separate `requestOutgoingCall` broker-resolution test, return `calling` and assert its Tool-visible result contains only `status`, `displayName`, and `mediaType`; it must not contain the fixture's UserSig, room ID, or callee account.

Add negative tests for group/self Source refs before fetch, mismatched Chat UID, missing/own counterpart ID, empty credentials fields, empty room ID, empty `callee_accounts`, and a second concurrent call lease.

- [ ] **Step 2: Run the focused preparation tests and observe failures**

Run:

```bash
pnpm vitest run tests/jotmo-service.test.ts -t "outgoing call"
```

Expected: FAIL because the outgoing service methods and capability do not exist.

- [ ] **Step 3: Implement private Source validation and fresh counterpart resolution**

Extend the existing constructor with a final optional dependency so current callers remain source-compatible and tests can inject a fake-clock broker:

```ts
constructor(
  config: JotmoServiceConfig,
  sessionStore: SessionStore,
  stateStore: StateStore,
  fetchImpl: FetchLike = fetch,
  outgoingCallBroker: JotmoOutgoingCallBroker = new JotmoOutgoingCallBroker(),
)
```

Open the signed Source locally, require `kind === 'private_chat'`, then call:

```ts
const detail = await this.authenticatedChatPost<Record<string, unknown>>(
  '/api/v1/chats/detail',
  { chat_session_uid: source.ownerRef },
  session,
  signal,
)
```

Require the returned session UID to equal `ownerRef`; accept only the repository's private session kinds; require a positive counterpart ID different from the viewer. Derive display name with the same precedence as `listSources`, then hydrate the public profile only for a better display name and an opaque `sealProfileImageRef`.

- [ ] **Step 4: Implement credentials, room creation, payload projection, and lease cleanup**

Acquire the broker lease before the first remote request. In one `try/catch`, release it on every preparation failure. Fetch current profile, credentials, and create room using the current session; preserve the existing one-refresh-only behavior of authenticated helpers.

Build frontend-compatible `userData` and push data without exposing Host-only identifiers to Tool output:

```ts
const userData = JSON.stringify({
  sharedTopicId,
  sourceTag: 'harness-private-chat-header',
  callerName,
  callerAvatar: '',
})
const description = mediaType === 'video' ? '邀请你进行视频通话' : '邀请你进行语音通话'
```

Pass a raw caller avatar reference only in the Host-to-WebRTC `create-room` request when the existing profile contract supplies one; keep `bootstrap.avatar`, `call.callerAvatar`, and `call.calleeAvatar` empty. The browser will resolve `peerAvatarRef` through `image.read` and use its data URL only for local peer presentation.

Add `outgoingCall: true` to capabilities. Do not export `JotmoOutgoingCallPrepareResult` from `src/index.ts` or `src/sdk/index.ts`.

- [ ] **Step 5: Clear pending intents and active lease on logout**

Before deleting the stored session, capture its user ID and call:

```ts
this.outgoingCallBroker.clearUser(session.userId, '账号已退出，呼叫已取消')
```

Also expose a service `dispose()` that disposes the broker; Task 5 will register it in Cordis teardown.

- [ ] **Step 6: Run focused and regression tests**

Run:

```bash
pnpm vitest run tests/jotmo-service.test.ts
pnpm typecheck
```

Expected: service tests PASS; existing call history/source/auth tests remain unchanged; typecheck PASS.

- [ ] **Step 7: Commit checkpoint (requires the separate commit gate)**

Suggested message: `feat(jotmo): prepare private outgoing calls`

---

### Task 3: Strict same-origin Host API operations

**Files:**

- Create: `tests/host-api.test.ts`
- Modify: `src/types.ts`
- Modify: `src/host-api.ts`

**Interfaces:**

- Consumes: the six service methods from Task 2.
- Produces these internal operation names:

```ts
type JotmoPluginOperation =
  | /* existing operations */
  | 'calls.outgoing.intent.claim'
  | 'calls.outgoing.intent.resolve'
  | 'calls.outgoing.prepare'
  | 'calls.outgoing.heartbeat'
  | 'calls.outgoing.release'
```

- [ ] **Step 1: Add failing operation validation tests**

Export the dispatch function under the explicit testable name `dispatchJotmoHostOperation`. Test that:

```ts
await expect(dispatchJotmoHostOperation(service, 'calls.outgoing.prepare', {
  sourceRef: 'source-ref', mediaType: 'screen', callRequestId: 'request-1',
})).rejects.toMatchObject({ code: 'call-media-type-invalid' })

await expect(dispatchJotmoHostOperation(service, 'calls.outgoing.intent.resolve', {
  intentId: '', claimToken: '', status: 'calling',
})).rejects.toMatchObject({ code: 'call-intent-invalid' })
```

Also assert that `failed` completion accepts only the known failure-code union and a bounded non-empty message, while `calling` ignores any caller-supplied failure message. Verify unknown operation remains `operation-unsupported`.

- [ ] **Step 2: Run the Host API test and observe failures**

Run:

```bash
pnpm vitest run tests/host-api.test.ts
```

Expected: FAIL because the exported dispatcher and operations are absent.

- [ ] **Step 3: Implement exact parsers and dispatch cases**

Add these strict helpers:

```ts
function outgoingMediaTypeParam(params: Record<string, unknown>): 'audio' | 'video'
function nonEmptyCallParam(params: Record<string, unknown>, key: string, max: number): string
function outgoingFailureCodeParam(params: Record<string, unknown>): JotmoOutgoingCallFailureCode
```

Do not use the existing permissive `stringParam` for IDs/tokens in completion, heartbeat, or release. Bind the account exclusively inside `JotmoService`; never accept a `userId` parameter from the browser.

- [ ] **Step 4: Run Host API, service, and type tests**

Run:

```bash
pnpm vitest run tests/host-api.test.ts tests/jotmo-service.test.ts
pnpm typecheck
```

Expected: both suites PASS; typecheck PASS.

- [ ] **Step 5: Commit checkpoint (requires the separate commit gate)**

Suggested message: `feat(jotmo): expose internal outgoing call operations`

---

### Task 4: `jotmo_call_start` Tool and authorization prompt

**Files:**

- Modify: `src/jotmo-tools.ts`
- Modify: `tests/jotmo-tools.test.ts`

**Interfaces:**

- Consumes: `requestOutgoingCall(sourceRef, mediaType, signal)` from Task 2.
- Produces: Tool `jotmo_call_start(source_ref, media_type)` with safe text-only output.

- [ ] **Step 1: Add failing Tool definition and output tests**

Extend the fake service with a spy and assert:

```ts
const tool = definitions.find(item => item.name === 'jotmo_call_start')!
const output = await tool.execute({ source_ref: 'opaque-private-ref', media_type: 'video' }, exec)
expect(service.requestOutgoingCall).toHaveBeenCalledWith('opaque-private-ref', 'video', exec.signal)
expect(output).toContain('已向“小林”发起视频通话，呼叫界面已打开。')
expect(output).not.toContain('opaque-private-ref')
expect(output).not.toContain('room-')
expect(output).not.toContain('userSig')
```

Test blank refs, invalid media values, normalized failure messages, and non-concurrency safety. Assert the system prompt includes all of these phrases: `当前对话中明确要求`, `jotmo_sources_list`, `kind=private_chat`, `source_ref`, `不得根据昵称猜测`, `目标不明确时先询问`, and `calling`.

- [ ] **Step 2: Run Tool tests and observe the missing Tool failure**

Run:

```bash
pnpm vitest run tests/jotmo-tools.test.ts -t "call start|outgoing call"
```

Expected: FAIL because `jotmo_call_start` and the service interface method are absent.

- [ ] **Step 3: Merge the Tool into the current modified file**

First inspect the existing unstaged diff for `src/jotmo-tools.ts` and preserve every call-history/presentation change. Add to `JotmoConversationReadService`:

```ts
requestOutgoingCall(
  sourceRef: string,
  mediaType: 'audio' | 'video',
  signal?: AbortSignal,
): Promise<JotmoOutgoingCallToolResult>
```

Define the Tool with required enum parameters and:

```ts
async execute(args, exec) {
  const sourceRef = args.source_ref.trim()
  if (sourceRef === '') throw new Error('source_ref 不能为空')
  const result = await service.requestOutgoingCall(
    sourceRef,
    args.media_type as 'audio' | 'video',
    exec.signal,
  )
  const label = result.mediaType === 'video' ? '视频' : '语音'
  return `已向“${safeToolDisplayName(result.displayName)}”发起${label}通话，呼叫界面已打开。`
}
```

Bound the display name to 100 Unicode code points and remove CR/LF/control characters before interpolation. Do not include tagged JSON because this is an action result, not user-owned content.

- [ ] **Step 4: Run the full Tool suite and typecheck**

Run:

```bash
pnpm vitest run tests/jotmo-tools.test.ts
pnpm typecheck
```

Expected: all existing and outgoing Tool tests PASS; typecheck PASS.

- [ ] **Step 5: Commit checkpoint (requires the separate commit gate)**

Suggested message: `feat(jotmo): add private outgoing call tool`

---

### Task 5: Pin, package, verify, and serve the exact frontend call assets

**Files:**

- Create: `assets/desktop_call/index.html`
- Create: `assets/desktop_call/bundle.js`
- Create: `assets/desktop_call/call-linear-strong.svg`
- Create: `assets/desktop_call/manifest.json`
- Create: `src/outgoing-call-assets.ts`
- Create: `tests/outgoing-call-assets.test.ts`
- Create: `scripts/verify-call-assets.mjs`
- Modify: `package.json`
- Modify: `src/index.ts`
- Modify: `src/types.ts`
- Modify: `tests/index.test.ts`

**Interfaces:**

- Consumes: frontend commit `b8c3e8b4b5bfa346561193dce31d195970b8c3fa`, bundle SHA-256 `6ff59d3eb9ce4d7556ba4054bac0df22ae279a7bccc56ccbf5712b6f475c95ce`, icon SHA-256 `583d7dbd34069c5b50ca294a071637bbd3beed913cecdb91a202c001004eed45`.
- Produces:

```ts
export function createOutgoingCallAssetHandler(options: {
  routePrefix: string
  assetDirectory?: string
}): (req: IncomingMessage, res: ServerResponse) => Promise<void>
```

The asset base path is `${config.routePath}/call`, defaulting to `/jotmo-self/api/call`.

- [ ] **Step 1: Add failing asset tests**

Test exact allowlist behavior for `index.html`, `bundle.js`, `call-linear-strong.svg`, and `manifest.json`. Assert `/../package.json`, encoded traversal, unknown files, non-GET/HEAD methods, and a prefix root without a filename are rejected.

For HTML assert:

```ts
expect(headers['content-security-policy']).toContain("script-src 'self' 'unsafe-inline'")
expect(headers['content-security-policy']).toContain("frame-ancestors 'self'")
expect(body).toContain('channel: "jotmo-desktop-call"')
expect(body).toContain('import("./bundle.js")')
```

For JS/SVG/manifest assert `X-Content-Type-Options: nosniff`, correct MIME type, and immutable caching only for the pinned bundle/icon; HTML uses `Cache-Control: no-store`.

- [ ] **Step 2: Run the asset tests and observe the missing handler failure**

Run:

```bash
pnpm vitest run tests/outgoing-call-assets.test.ts tests/index.test.ts
```

Expected: FAIL because assets, handler, and route registration are absent.

- [ ] **Step 3: Copy the pinned generated files and write the manifest**

Copy mechanically from the approved worktree source:

```bash
cp ../jotmo_frontend/assets/web/desktop_call/bundle.js assets/desktop_call/bundle.js
cp ../jotmo_frontend/assets/icons/call-linear-strong.svg assets/desktop_call/call-linear-strong.svg
```

Write `manifest.json` with exact values:

```json
{
  "upstreamRepository": "jotmo_frontend",
  "upstreamCommit": "b8c3e8b4b5bfa346561193dce31d195970b8c3fa",
  "callEnginePackage": "@trtc/call-engine-lite-js",
  "callEngineRange": "^3.5.9",
  "bundleSha256": "6ff59d3eb9ce4d7556ba4054bac0df22ae279a7bccc56ccbf5712b6f475c95ce",
  "iconSha256": "583d7dbd34069c5b50ca294a071637bbd3beed913cecdb91a202c001004eed45"
}
```

Verify immediately:

```bash
shasum -a 256 assets/desktop_call/bundle.js assets/desktop_call/call-linear-strong.svg
```

Expected: hashes exactly match the manifest.

- [ ] **Step 4: Adapt only the iframe bridge in `index.html`**

Preserve the upstream root styles and node-global masking. Replace Flutter bridge resolution with a parent bridge that reads `callRequestId` from the initial `window.name` JSON, never from URL/query/hash or DOM attributes:

```js
const context = JSON.parse(window.name || "{}")
const postToParent = (message) => parent.postMessage({
  channel: "jotmo-desktop-call",
  callRequestId: String(context.callRequestId || ""),
  message,
}, location.origin)
```

Implement `window.__JOTMO_DESKTOP_CALL_HOST__` with the upstream `onHostMessage`, `drain`, and `subscribe` queue, and route `postFlutterMessage` only to `postToParent`. Import `./bundle.js`; do not edit the generated bundle.

- [ ] **Step 5: Implement allowlisted file serving and Cordis lifecycle**

Resolve assets relative to the built Node entry:

```ts
const defaultDirectory = fileURLToPath(new URL('../assets/desktop_call/', import.meta.url))
```

Use an exact filename map rather than path joining untrusted request text. Register one `prefix` route at `${config.routePath}/call`. Add `assets/desktop_call` to `package.json.files`, extend `JotmoClientConfig` with `callAssetBasePath`, and call `service.dispose()` alongside local database teardown.

Use this CSP for HTML so scripts remain local while TRTC can connect:

```text
default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self' https: wss:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'
```

- [ ] **Step 6: Add deterministic asset verification script**

Create `scripts/verify-call-assets.mjs`. The command exposed from `package.json` must be:

```json
"verify:call-assets": "node scripts/verify-call-assets.mjs"
```

The script reads the manifest, calculates both hashes, exits non-zero on mismatch, and never rewrites assets.

- [ ] **Step 7: Run asset, configuration, build, and package-content checks**

Run:

```bash
pnpm verify:call-assets
pnpm vitest run tests/outgoing-call-assets.test.ts tests/index.test.ts
pnpm typecheck
pnpm build
pnpm pack --dry-run
```

Expected: hashes PASS; tests/typecheck/build PASS; dry-run output contains all four `assets/desktop_call` files.

- [ ] **Step 8: Commit checkpoint (requires the separate commit gate)**

Suggested message: `feat(jotmo): package desktop call web assets`

---

### Task 6: Browser UI controller, strict bridge, and media permission adapter

**Files:**

- Create: `src/client/outgoing-call-ui-controller.ts`
- Create: `src/client/outgoing-call-bridge.ts`
- Create: `tests/outgoing-call-bridge.test.ts`

**Interfaces:**

- Consumes: internal call types and `callJotmo` error shape.
- Produces:

```ts
export interface DirectOutgoingCallRequest {
  callRequestId: string
  sourceRef: string
  displayName: string
  avatarRef?: string
  mediaType: 'audio' | 'video'
}

export const jotmoOutgoingCallUi: {
  configure(callAssetBasePath: string): void
  request(input: Omit<DirectOutgoingCallRequest, 'callRequestId'>): string
  subscribe(listener: () => void): () => void
  getSnapshot(): { revision: number; callAssetBasePath: string; pending?: DirectOutgoingCallRequest }
  consume(callRequestId: string): void
  reset(): void
}

export type DesktopCallBridgeEvent =
  | { type: 'ready' }
  | { type: 'media_permission_request'; requestId: string; camera: boolean; microphone: boolean }
  | { type: 'calling' | 'begin' | 'end' | 'not_connected' | 'user_reject' | 'user_no_response' | 'user_line_busy'; message: string }
  | { type: 'permission_denied' | 'fatal_error'; message: string }
  | { type: 'toggle_fullscreen_request' | 'toggle_compact_mode_request' | 'hide_window_request' }
```

- [ ] **Step 1: Add failing bridge/controller tests**

Verify stable snapshot identity until a mutation, configuration with a validated absolute path, one pending direct request at a time, generated request IDs, and consumption by matching ID only.

For the bridge, accept only a same-origin event whose source equals the current iframe window and whose envelope is:

```ts
{
  channel: 'jotmo-desktop-call',
  callRequestId: 'request-1',
  message: '{"type":"calling","phase":"outgoing"}'
}
```

Reject wildcard origin, wrong frame, wrong request ID, malformed JSON, unknown type, and incoming/accept/reject events. Test command delivery calls only `__JOTMO_DESKTOP_CALL_HOST__.onHostMessage(JSON.stringify({ type, payload }))` on the matching same-origin frame.

- [ ] **Step 2: Run bridge tests and observe missing-module failures**

Run:

```bash
pnpm vitest run tests/outgoing-call-bridge.test.ts
```

Expected: FAIL because controller and bridge modules are absent.

- [ ] **Step 3: Implement the strict parser and command allowlist**

The outbound command union is exactly:

```ts
type DesktopCallHostCommand =
  | 'bootstrap'
  | 'media_permission_result'
  | 'call'
  | 'hangup'
  | 'terminate'
  | 'logout'
```

Do not forward incoming-only `accept` or `reject`, even though the reused bundle contains dormant handlers.

- [ ] **Step 4: Implement browser permission handling**

On `media_permission_request`, call parent-page `navigator.mediaDevices.getUserMedia` with the exact requested tracks, immediately stop all returned tracks, and send:

```ts
{
  requestId,
  cameraGranted,
  microphoneGranted,
  cameraStatus: cameraGranted ? 'granted' : 'denied',
  microphoneStatus: microphoneGranted ? 'granted' : 'denied',
  granted: microphoneGranted && (!camera || cameraGranted),
  message,
}
```

Microphone denial is terminal. Camera-only denial reports false so the existing frontend bundle can fall back to audio exactly as it already does.

- [ ] **Step 5: Run bridge tests and typecheck**

Run:

```bash
pnpm vitest run tests/outgoing-call-bridge.test.ts
pnpm typecheck
```

Expected: tests PASS; typecheck PASS.

- [ ] **Step 6: Commit checkpoint (requires the separate commit gate)**

Suggested message: `feat(jotmo): add browser call bridge`

---

### Task 7: Framework-neutral outgoing call runtime

**Files:**

- Create: `src/client/outgoing-call-runtime.ts`
- Create: `tests/outgoing-call-runtime.test.ts`

**Interfaces:**

- Consumes: Task 6 controller/bridge, `callJotmo`, and `loadJotmoImageDataUrl`.
- Produces:

```ts
export type OutgoingCallPhase =
  | 'idle'
  | 'preparing'
  | 'bootstrapping'
  | 'calling'
  | 'active'
  | 'ending'
  | 'failed'

export interface OutgoingCallSnapshot {
  phase: OutgoingCallPhase
  visible: boolean
  callRequestId: string
  displayName: string
  mediaType: 'audio' | 'video'
  layout: 'regular' | 'fullscreen' | 'compact'
  errorMessage: string
  frameName: string
  frameSrc: string
}

export class JotmoOutgoingCallRuntime {
  mount(): void
  unmount(): Promise<void>
  startDirect(request: DirectOutgoingCallRequest): Promise<void>
  attachFrame(frame: HTMLIFrameElement): void
  handleWindowMessage(event: MessageEvent): Promise<void>
  requestClose(): Promise<void>
  toggleFullscreen(): void
  toggleCompact(): void
  subscribe(listener: () => void): () => void
  getSnapshot(): OutgoingCallSnapshot
}
```

- [ ] **Step 1: Add failing direct-call state tests**

Use fake dependencies and assert:

```ts
await runtime.startDirect(request)
expect(api.calls).toContainEqual(['calls.outgoing.prepare', expect.objectContaining({
  sourceRef: 'private-ref', mediaType: 'video', callRequestId: request.callRequestId,
})])
expect(runtime.getSnapshot()).toMatchObject({ visible: true, phase: 'bootstrapping' })

await runtime.handleWindowMessage(readyEvent)
expect(bridge.commands.map(item => item.type)).toEqual(['bootstrap'])
bridge.emit({ type: 'ready' }) // second ready after successful bootstrap
expect(bridge.commands.map(item => item.type)).toEqual(['bootstrap', 'call'])
```

Match the bundle's actual protocol: it emits `ready` before bootstrap and again after bootstrap. The runtime must send `bootstrap` on the first `ready`, `call` on the post-bootstrap `ready`, and never issue a duplicate call command.

- [ ] **Step 2: Add failing Tool-intent and lifecycle tests**

With fake timers, assert `mount()` polls claim every `750ms`, stops polling while any phase is not idle, and resumes after cleanup. On a claim, it must preserve `intentId/claimToken`; on iframe `calling`, call `calls.outgoing.intent.resolve` with `status: 'calling'`; on earlier failure, resolve once with a normalized failure.

Also test:

- heartbeat every `15_000ms` only during `bootstrapping/calling/active/ending`;
- `begin` maps to `active`;
- terminal events map to `ending`, release the lease, send `logout`, drop sensitive prepare references, and close after `800ms`;
- preparation/permission/fatal errors release immediately and close after rendering failure;
- backdrop/Escape close is ignored while calling/active and routes through `hangup` during an active call;
- unmount sends `terminate`, then `logout`, then release, without resolving a Tool success;
- no snapshot, exception, or test diagnostic contains `userSig`, raw room ID, or TRTC account.

- [ ] **Step 3: Run runtime tests and observe missing implementation failures**

Run:

```bash
pnpm vitest run tests/outgoing-call-runtime.test.ts
```

Expected: FAIL because the runtime does not exist.

- [ ] **Step 4: Implement state transitions with transient credentials**

Keep the full prepare result in a private field, never in `OutgoingCallSnapshot`. After sending `bootstrap`, replace the stored object with a copy whose `bootstrap.userSig` is empty; after sending `call`, clear the full prepare field. Set iframe `window.name` to JSON containing only `{ callRequestId }`.

Resolve `peerAvatarRef` through `loadJotmoImageDataUrl`; if it fails, keep `calleeAvatar: ''` and continue. Do not pass the opaque avatar ref into the iframe.

- [ ] **Step 5: Implement Tool polling, completion, heartbeat, and cleanup**

Use `AbortController` for every active request and clear all intervals/timeouts in one idempotent `cleanupSession({ releaseLease, closeAfterMillis })` method. Complete a Tool intent only once. If claim polling receives 401/logged-out, stop polling until the component remount/auth revision changes; do not loop noisy errors.

- [ ] **Step 6: Run runtime, bridge, and type tests**

Run:

```bash
pnpm vitest run tests/outgoing-call-runtime.test.ts tests/outgoing-call-bridge.test.ts
pnpm typecheck
```

Expected: both suites PASS; typecheck PASS.

- [ ] **Step 7: Commit checkpoint (requires the separate commit gate)**

Suggested message: `feat(jotmo): orchestrate outgoing call lifecycle`

---

### Task 8: Portal call host and frontend-faithful private-chat menu

**Files:**

- Create: `src/client/JotmoOutgoingCallHost.tsx`
- Create: `src/client/JotmoPrivateCallMenu.tsx`
- Create: `tests/client-outgoing-call-ui.test.ts`
- Modify: `src/client/JotmoFooterDropdown.tsx`
- Modify: `src/client/JotmoSidebar.tsx`
- Modify: `src/client/index.tsx`
- Modify: `tests/client-adapter.test.ts`

**Interfaces:**

- Consumes: Task 6 controller, Task 7 runtime, current `JotmoSourceItem`, and `JotmoClientConfig.callAssetBasePath`.
- Produces: one always-mounted call coordinator plus the confirmed header button/menu.

- [ ] **Step 1: Add failing menu and layout tests**

Use `react-dom/server` for the prop-driven visual leaf and pure exported layout helpers:

```ts
const html = renderToStaticMarkup(<JotmoPrivateCallMenu
  source={{ sourceRef: 'private-ref', kind: 'private_chat', displayName: '小林', activeAtMillis: 0, unreadCount: 0 }}
  assetBasePath="/jotmo-self/api/call"
  onStart={start}
/>)
expect(html).toContain('aria-label="发起通话"')
expect(html).toContain('/jotmo-self/api/call/call-linear-strong.svg')
expect(callMenuItems.map(item => item.label)).toEqual(['语音通话', '视频通话'])
```

Export `callMenuItems` for the exact closed-menu row contract. Test layout values:

```ts
expect(callModalLayout('regular')).toEqual({ width: 960, height: 640 })
expect(callModalLayout('compact')).toEqual({ width: 160, height: 280 })
```

Extend adapter tests to assert the Footer component remains the registered owner and no private DSH slots are added.

- [ ] **Step 2: Run UI tests and observe missing-component failures**

Run:

```bash
pnpm vitest run tests/client-outgoing-call-ui.test.ts tests/client-adapter.test.ts
```

Expected: FAIL because the call host/menu components are absent.

- [ ] **Step 3: Implement the exact private-chat trigger/menu**

Render `JotmoPrivateCallMenu` beside the `<h2>` only when `source?.kind === 'private_chat'`. `JotmoSurface` subscribes to `jotmoOutgoingCallUi` and passes its configured `callAssetBasePath` as the component's `assetBasePath` prop. Use the copied SVG through that path. Implement click-outside, Escape, focus return, `aria-haspopup="menu"`, `role="menu"`, arrow-key movement, Enter/Space activation, and no hover-only actions.

On selection call:

```ts
jotmoOutgoingCallUi.request({
  sourceRef: source.sourceRef,
  displayName: source.displayName,
  ...(source.avatarRef === undefined ? {} : { avatarRef: source.avatarRef }),
  mediaType,
})
```

- [ ] **Step 4: Implement the Portal modal and iframe shell**

Mount `<JotmoOutgoingCallHost />` as a sibling of the Footer root contents so it exists even when `ui.open === false`; the component itself returns a Portal to `document.body` only while visible.

On mount, call `auth.config` to obtain `callAssetBasePath`; do not hard-code the configured API path in the runtime. The menu receives the same base path through a small client config cache shared by the host and header component.

Modal requirements:

```tsx
<iframe
  title={`${snapshot.displayName}${snapshot.mediaType === 'video' ? '视频' : '语音'}通话`}
  src={snapshot.frameSrc}
  name={snapshot.frameName}
  allow="camera; microphone; autoplay"
  sandbox="allow-scripts allow-same-origin"
  referrerPolicy="no-referrer"
/>
```

Regular mode uses `width: min(960px, calc(100vw - 32px))` and `height: min(640px, calc(100vh - 32px))`; enforce the iframe's `360px` minimum only when the viewport permits it. Fullscreen fills the viewport. Compact mode is fixed `160 × 280`, positioned at bottom-right with a `16px` inset, no backdrop interception, and a high DSH-safe z-index.

Do not overlay a separately designed call toolbar: all microphone, speaker, camera, hangup, status, avatar, remote video, local preview, fullscreen, and compact controls come from the reused frontend iframe.

- [ ] **Step 5: Wire iframe events and safe closing behavior**

Attach the current frame to the runtime on load. Route `toggle_fullscreen_request` and `toggle_compact_mode_request` to layout state. Treat `hide_window_request` as compact mode while a call is active, not as an invisible background call. Backdrop and Escape call `runtime.requestClose()`; the runtime decides whether to hang up or close.

- [ ] **Step 6: Run UI, runtime, adapter, type, and build checks**

Run:

```bash
pnpm vitest run tests/client-outgoing-call-ui.test.ts tests/outgoing-call-runtime.test.ts tests/client-adapter.test.ts
pnpm typecheck
pnpm build
```

Expected: all tests PASS; typecheck/build PASS; no new private DSH slot name appears.

- [ ] **Step 7: Commit checkpoint (requires the separate commit gate)**

Suggested message: `feat(jotmo): add private call modal and header action`

---

### Task 9: Security regression, docs, packaging, and live Harness acceptance

**Files:**

- Modify: `README.md`
- Modify: `docs/consumer-plugin-contract.md` only to state that outgoing call remains Host-internal and is not a Consumer SDK method.
- Modify: focused tests from Tasks 1–8 as failures reveal missing regression coverage.

**Interfaces:**

- Consumes: the complete implementation from Tasks 1–8.
- Produces: verified package plus manual evidence for real audio/video calling.

- [ ] **Step 1: Add a cross-layer secret-regression test**

Create one fixture containing unmistakable sentinel values:

```ts
const secrets = {
  userSig: 'SECRET_USER_SIG_SENTINEL',
  roomId: 'SECRET_ROOM_SENTINEL',
  calleeAccount: 'SECRET_TRTC_ACCOUNT_SENTINEL',
  accessToken: 'SECRET_ACCESS_TOKEN_SENTINEL',
}
```

Drive service prepare, Tool completion, runtime snapshot, normalized errors, and any logger spy. Assert only the private prepare value contains the first three sentinels and no Tool output, snapshot, failure message, logger call, URL, iframe name, or persisted store contains any sentinel. Access Token must not appear outside request headers.

- [ ] **Step 2: Run focused security tests and fix only demonstrated gaps**

Run:

```bash
pnpm vitest run tests/outgoing-call-broker.test.ts tests/jotmo-service.test.ts tests/host-api.test.ts tests/jotmo-tools.test.ts tests/outgoing-call-assets.test.ts tests/outgoing-call-bridge.test.ts tests/outgoing-call-runtime.test.ts tests/client-outgoing-call-ui.test.ts
```

Expected: PASS. If a sentinel appears, remove that exact serialization/storage/log path and add a regression assertion before continuing.

- [ ] **Step 3: Document the user and Consumer boundaries**

README must state:

- private-chat header offers `语音通话` and `视频通话`;
- the popup reuses the desktop Web call UI;
- only outgoing one-to-one calls are supported;
- Agent flow is list exact private Source, then `jotmo_call_start`;
- the browser page must be open for a Tool call to claim the intent;
- microphone is required, camera denial falls back to audio according to existing UI behavior;
- no incoming registration or public SDK call method exists.

Consumer contract must say `outgoingCall: true` is a Provider capability indicator only and that generated consumers cannot call internal prepare/intent operations or receive UserSig.

- [ ] **Step 4: Run the complete automated verification gate**

Run:

```bash
pnpm verify:call-assets
pnpm test
pnpm typecheck
pnpm build
pnpm pack --dry-run
git diff --check
```

Expected: every command exits 0; package output contains call assets; `git diff --check` has no whitespace errors.

- [ ] **Step 5: Install the local package into the existing v95 Harness profile**

Use the repository's documented local profile install/cachebuster workflow. Do not modify DSH source. Start the Web profile from the existing workspace command and keep the terminal visible for errors.

- [ ] **Step 6: Manually verify private header and audio call**

Check:

1. Private chat shows the `24 × 24` call button after the nickname; self/topic/group/call-history surfaces do not.
2. Menu labels, dimensions, icon, hover, focus, Escape, and click-outside match the confirmed prototype.
3. Audio selection opens a regular `960 × 640` modal clamped to viewport.
4. The frontend Web UI shows blurred peer backdrop, avatar/name, status, timer, mic/speaker/hangup.
5. Microphone prompt appears only after the explicit action; a successful request rings the selected private user.
6. Hangup closes after the terminal status and leaves no active media track or TRTC login.

- [ ] **Step 7: Manually verify video call, fallback, and window modes**

Check remote area, local preview, mic/speaker/camera/hangup, fullscreen, compact `160 × 280`, restore, and terminal cleanup. Deny camera while allowing microphone and confirm the exact UI falls back to audio. Deny microphone and confirm no `calling` success is reported.

- [ ] **Step 8: Manually verify Tool rendezvous and failure truthfulness**

With Harness open but Jiwo surface closed:

1. Ask Agent to list root Sources and call one exact private user.
2. Confirm the global coordinator opens the same modal.
3. Confirm Tool returns success only after the peer is actually ringing (`calling`).
4. Close the Harness page and retry; confirm Tool returns `call-ui-unavailable` instead of success.
5. Start one call and attempt a second direct or Tool call; confirm “当前已有通话进行中”.
6. Confirm no incoming call UI appears when another device calls this Harness client while it is idle.

- [ ] **Step 9: Review scope and current-worktree preservation**

Compare the final diff to the confirmed spec. Verify no group call, incoming call, recording, summary, transcript, public SDK call method, token persistence, DSH private slot, or unrelated call-presentation rewrite entered the change. Re-run the pre-existing modified tests to ensure the user's concurrent changes remain intact.

- [ ] **Step 10: Commit checkpoint (requires the separate commit gate)**

Suggested final message: `feat(jotmo): add Harness private outgoing calls`
