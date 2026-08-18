# Harness Call History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authenticated call-history entry to the existing Jotmo Footer navigation and render a browser-safe two-column call list/detail surface with transcript and AI summary.

**Architecture:** The Host fetches Data aggregate pages, hydrates public display names through Auth, seals room identifiers into account-bound opaque call references, and fetches WebRTC detail only after verifying those references. Pure projection modules normalize the upstream contracts and remove all identifiers and media metadata before the SDK or browser sees the DTOs. The existing Jotmo UI controller gains a `calls` mode; a dedicated React surface owns list paging, selection, detail loading, retry, and stale-response rejection without changing the conversation slot or existing source surface.

**Tech Stack:** TypeScript 6, Node.js 22+, React 18, Cordis/Schemastery, Vitest 4, pnpm 11.

**Spec:** `docs/superpowers/specs/2026-08-18-harness-call-history-design.md`

## Global Constraints

- Keep `JOTMO_PROVIDER_CONTRACT_VERSION` at `1`; advertise additive `callHistory` and `callDetail` feature flags.
- Keep all upstream bearer tokens, numeric user IDs, TRTC room/account/speaker IDs, media URLs, object keys, file metadata, quotas, confidence values, and raw upstream payloads inside the Host.
- Treat call references as integrity-protected, account-bound opaque handles, not encryption.
- Render summary and transcript as plain text only; never introduce `dangerouslySetInnerHTML`.
- Do not persist call list items, detail, summary, transcript, or call selection to local storage/navigation cache.
- Do not modify `JotmoConversationSurface`, `JotmoFooterDropdown`, slot registration, or the new-session watcher.
- Use TDD for each behavior-bearing task: add a focused failing test, run it and inspect the expected failure, implement the smallest passing change, then rerun the focused test.
- Before declaring completion, run the full test, typecheck, and build commands from the repository root.

---

## Task 1: Add the public call DTO and configuration contract

**Files:**

- Modify: `src/types.ts:1-238`
- Modify: `src/index.ts:14-116`
- Modify: `src/jotmo-service.ts:1-80, 319-352`
- Modify: `cordis.patch.yml:1-16`
- Create: `tests/index.test.ts`
- Test: `tests/jotmo-service.test.ts`

- [x] **Step 1: Add failing capability and configuration tests**

Extend the shared service test config with these exact values:

```ts
dataBaseUrl: 'https://jotmo-data.senguo.me',
webrtcBaseUrl: 'https://jotmo-webrtc.senguo.me',
```

Extend the provider-capability assertion:

```ts
expect(service.providerCapabilities()).toMatchObject({
  contractVersion: 1,
  features: { callHistory: true, callDetail: true },
})
```

Create `tests/index.test.ts` and test a focused exported validator named `validateJotmoConfig(config, webServerHost)`. Cover both new origins with the same rules as Auth/Record/Chat: HTTPS only, no credentials, and pathname exactly `/`. Assert a production config fails when `allowProduction` is false and accepts explicit values `https://data.jotmo.cc` and `https://webrtc.jiwo.cc` when `allowProduction` is true.

- [x] **Step 2: Run the focused test and confirm the expected RED state**

Run:

```bash
pnpm vitest run tests/index.test.ts tests/jotmo-service.test.ts
```

Expected failure: `validateJotmoConfig` and the new config fields do not exist, or capabilities lack `callHistory`/`callDetail`.

- [x] **Step 3: Add exact public DTOs and operations**

Add to `src/types.ts`:

```ts
export type JotmoCallMediaType = 'audio' | 'video' | 'unknown'
export type JotmoCallDirection = 'incoming' | 'outgoing' | 'group' | 'unknown'
export type JotmoCallSectionState = 'ready' | 'empty' | 'processing' | 'failed'

export interface JotmoCallListItem {
  callRef: string
  displayName: string
  participantCount: number
  mediaType: JotmoCallMediaType
  direction: JotmoCallDirection
  connected: boolean
  startedAtMillis: number
  acceptedAtMillis: number
  endedAtMillis: number
  durationMillis: number
  summaryState: JotmoCallSectionState
  summaryPreview: string
}

export interface JotmoCallList {
  items: JotmoCallListItem[]
  hasMore: boolean
  nextCursor?: string
}

export interface JotmoCallParticipant {
  displayName: string
  isSelf: boolean
  connected: boolean
}

export interface JotmoCallTranscriptItem {
  itemId: string
  startOffsetMillis: number
  endOffsetMillis: number
  speakerLabel: string
  isSelf: boolean
  text: string
}

export interface JotmoCallTextSection {
  state: JotmoCallSectionState
  content: string
  message: string
}

export interface JotmoCallTranscriptSection {
  state: JotmoCallSectionState
  items: JotmoCallTranscriptItem[]
  message: string
}

export interface JotmoCallDetail {
  callRef: string
  displayName: string
  participants: JotmoCallParticipant[]
  mediaType: JotmoCallMediaType
  direction: JotmoCallDirection
  connected: boolean
  startedAtMillis: number
  acceptedAtMillis: number
  endedAtMillis: number
  durationMillis: number
  summary: JotmoCallTextSection
  transcript: JotmoCallTranscriptSection
}
```

Add `callHistory: true` and `callDetail: true` to `JotmoProviderCapabilities.features`, and add `'calls.list' | 'calls.detail'` to `JotmoPluginOperation`.

Export every new DTO from `src/index.ts` and later from `src/sdk/index.ts`.

- [x] **Step 4: Add the two upstream origins to runtime configuration**

Add `dataBaseUrl` and `webrtcBaseUrl` to `Config`, `Config` schema, and `JotmoServiceConfig`. Extract the current validation body into this testable signature and call it at the beginning of `apply()`:

```ts
export function validateJotmoConfig(config: Config, webServerHost: string): void
```

Preserve every existing validation rule and include the two new origins in the origin loop. Use these test defaults:

```ts
dataBaseUrl: Schema.string().default('https://jotmo-data.senguo.me'),
webrtcBaseUrl: Schema.string().default('https://jotmo-webrtc.senguo.me'),
```

Add the same values to the test-environment block in `cordis.patch.yml`. Production deployments must override them with `https://data.jotmo.cc` and `https://webrtc.jiwo.cc`; do not silently infer production origins from `environment`.

- [x] **Step 5: Advertise the capabilities and verify GREEN**

Add the two flags to `JotmoService.providerCapabilities()` and run:

```bash
pnpm vitest run tests/index.test.ts tests/jotmo-service.test.ts
pnpm typecheck
```

Expected: focused tests and typecheck pass.

- [x] **Step 6: Commit the contract slice**

```bash
git add src/types.ts src/index.ts src/jotmo-service.ts cordis.patch.yml tests/index.test.ts tests/jotmo-service.test.ts
git commit -m "feat: define call history provider contract"
```

---

## Task 2: Normalize and sanitize upstream call data in pure Host projections

**Files:**

- Create: `src/call-presentation.ts`
- Create: `tests/call-presentation.test.ts`

- [x] **Step 1: Write failing list projection tests**

Create `tests/call-presentation.test.ts` with a Data aggregate envelope containing:

- one `source: 'trtc'` audio call with caller `101`, callee `202`, seconds-based start/end/accept values, `call_result: 'answered'`, and a completed summary;
- one non-TRTC aggregate that must be removed;
- one three-person video call whose summary is processing;
- `has_more: true` and an opaque `next_cursor`.

Import and call these exact APIs:

```ts
import {
  callListParticipantUserIds,
  callListRoomIds,
  projectCallDetail,
  projectCallListPage,
} from '../src/call-presentation.js'

const callRefs = new Map([
  ['room-a', 'jotmo-call-ref-a'],
  ['room-group', 'jotmo-call-ref-group'],
])
const names = new Map([[101, '我'], [202, '小林'], [303, '阿青']])

expect(callListRoomIds(rawPage)).toEqual(['room-a', 'room-group'])
expect(callListParticipantUserIds(rawPage)).toEqual([101, 202, 303])
expect(projectCallListPage(rawPage, {
  viewerUserId: 101,
  displayNamesByUserId: names,
  callRefByRoomId: callRefs,
})).toEqual({
  items: [
    expect.objectContaining({
      callRef: 'jotmo-call-ref-a',
      displayName: '小林',
      participantCount: 2,
      mediaType: 'audio',
      direction: 'outgoing',
      connected: true,
      summaryState: 'ready',
    }),
    expect.objectContaining({
      callRef: 'jotmo-call-ref-group',
      participantCount: 3,
      mediaType: 'video',
      direction: 'group',
      summaryState: 'processing',
    }),
  ],
  hasMore: true,
  nextCursor: 'opaque-next',
})
```

Also assert that a missing `next_cursor` with `has_more: true` throws `JotmoPluginError` code `call-list-contract-invalid`, a blank/missing room ID is discarded, fallback names contain no numeric IDs, and a completed summary preview is whitespace-normalized and capped at 160 Unicode code points.

- [x] **Step 2: Write failing detail projection and privacy tests**

Use a WebRTC detail envelope with `participant_profiles`, `room_transcript_segments`, `call_transcription_progress`, and deliberately populated sensitive fields such as `recording_url`, `object_key`, `file_id`, `speaker_user_id`, `spk_id`, `confidence`, `trtc_account`, and quota data.

Assert the result contains only the `JotmoCallDetail` keys, maps the current user to `我`, prefers participant display name over `inner_spk_remark`, drops blank transcript segments, and never serializes any sensitive sentinel value:

```ts
const detail = projectCallDetail(rawDetail, {
  viewerUserId: 101,
  expectedRoomId: 'room-a',
  callRef: 'jotmo-call-ref-a',
})

expect(detail).toMatchObject({
  callRef: 'jotmo-call-ref-a',
  displayName: '小林',
  summary: { state: 'ready', content: '讨论了发布节奏。' },
  transcript: {
    state: 'ready',
    items: [
      expect.objectContaining({ speakerLabel: '我', isSelf: true, text: '今天确认发布节奏。' }),
      expect.objectContaining({ speakerLabel: '小林', isSelf: false, text: '我来跟进。' }),
    ],
  },
})
const serialized = JSON.stringify(detail)
for (const sentinel of ['SECRET_URL', 'SECRET_KEY', 'SECRET_FILE', 'SECRET_ACCOUNT', 'SECRET_SPK']) {
  expect(serialized).not.toContain(sentinel)
}
```

Cover transcript status precedence: `processing` and `failed` override segments; segments imply `ready`; terminal success without segments implies `empty`. Cover summary status mapping and mismatched `room_id` rejection.

- [x] **Step 3: Run the new test and confirm RED**

```bash
pnpm vitest run tests/call-presentation.test.ts
```

Expected failure: module and exports do not exist.

- [x] **Step 4: Implement strict extraction and normalization helpers**

Implement these exported signatures in `src/call-presentation.ts`:

```ts
export interface JotmoCallListProjectionContext {
  viewerUserId: number
  displayNamesByUserId: ReadonlyMap<number, string>
  callRefByRoomId: ReadonlyMap<string, string>
}

export function callListRoomIds(raw: unknown): string[]
export function callListParticipantUserIds(raw: unknown): number[]
export function projectCallListPage(
  raw: unknown,
  context: JotmoCallListProjectionContext,
): JotmoCallList
export function projectCallDetail(
  raw: unknown,
  context: { viewerUserId: number; expectedRoomId: string; callRef: string },
): JotmoCallDetail
```

Keep all parsing local to this module. Apply the spec's exact mappings:

- media `0 -> audio`, `1 -> video`, otherwise `unknown`;
- group direction when unique participants exceed two, otherwise current caller means outgoing and current callee means incoming;
- normalize seconds/milliseconds to epoch milliseconds and prefer start, then aggregate `sort_time_ms`, then TRTC `create_at`;
- unconnected results are the normalized set `cancel`, `canceled`, `cancelled`, `reject`, `rejected`, `notanswer`, `noanswer`, `missed`, `callbusy`, `busy`, `offline`;
- duration is `Math.max(0, endedAtMillis - (acceptedAtMillis || startedAtMillis))`;
- summary preview is plain text, collapsed whitespace, and at most 160 code points;
- transcript item IDs are deterministic non-sensitive local values such as `segment-1`, `segment-2` after blank segments are removed.

Construct fresh DTOs field-by-field. Never spread an upstream object into a returned value.

- [x] **Step 5: Verify projection behavior and static types**

```bash
pnpm vitest run tests/call-presentation.test.ts
pnpm typecheck
```

Expected: all normalization, privacy, error-contract, and status-state tests pass.

- [x] **Step 6: Commit the projection slice**

```bash
git add src/call-presentation.ts tests/call-presentation.test.ts
git commit -m "feat: project safe call history data"
```

---

## Task 3: Fetch call pages/details and enforce opaque account-bound references

**Files:**

- Modify: `src/jotmo-service.ts:1-80, 302-370, 1195-1430`
- Modify: `tests/jotmo-service.test.ts`

- [x] **Step 1: Add failing service orchestration tests**

Add fetch-mock tests for `service.listCalls({ limit: 20, cursor: 'cursor-a' })` that assert:

```ts
expect(requests[0]).toMatchObject({
  url: 'https://jotmo-data.senguo.me/api/v1/call/history-aggregate',
  body: { limit: 20, cursor: 'cursor-a' },
})
expect(requests[1]).toMatchObject({
  url: 'https://jotmo.senguo.me/api/v1/auth/get-public-users-by-ids',
  body: { user_ids: [101, 202] },
})
expect(page.items[0]).toMatchObject({ displayName: '小林' })
expect(page.items[0]?.callRef).toMatch(/^jotmo-call-v1\./)
```

Add these failure/edge assertions:

- default limit is `20`; values are truncated and constrained to `1..50`;
- opaque cursor is sent unchanged;
- Auth name hydration failure still returns list items with safe fallback names;
- Data 401/403 refreshes the access token once and retries;
- an aborted signal reaches the fetch implementation;
- browser DTO JSON contains none of the upstream numeric IDs or room IDs.

Add detail tests that call `readCall(callRef)`, assert `POST https://jotmo-webrtc.senguo.me/api/v1/trtc/call-detail` with `{ room_id: 'room-a' }`, and assert a tampered ref plus a valid ref from another account both fail before any WebRTC request.

- [x] **Step 2: Run focused service tests and confirm RED**

```bash
pnpm vitest run tests/jotmo-service.test.ts
```

Expected failure: `listCalls` and `readCall` are missing.

- [x] **Step 3: Add call reference sealing/opening**

Add an internal payload:

```ts
interface JotmoCallRefPayload {
  version: 1
  userId: number
  roomId: string
}
```

Implement `sealCallRef(userId, roomId)` and `openCallRef(callRef, expectedUserId)` alongside the source-ref helpers. Use the exact prefix `jotmo-call-v1`, `encodeOpaqueJson`, HMAC-SHA256 with `await this.stateStore.uniqueCode()`, `base64url`, equal-length checking, and `timingSafeEqual`. All malformed, tampered, blank-room, wrong-version, and wrong-account values must raise `JotmoPluginError('call-ref-invalid', ..., false)`; use HTTP 403 for a verified payload bound to another account.

- [x] **Step 4: Add authenticated Data/WebRTC helpers**

Implement `authenticatedDataPost<T>()` and `authenticatedWebrtcPost<T>()` by following `authenticatedAuthPost<T>()`: success code `[200]`, optional `AbortSignal`, one refresh/retry on `auth-http-401` or `auth-http-403`, and the configured base URL.

Add a focused private helper for name hydration rather than changing avatar lookup semantics:

```ts
private async publicDisplayNamesByUserIds(
  userIds: number[],
  session: JotmoSessionCredentials,
  signal?: AbortSignal,
): Promise<Map<number, string>>
```

It calls `/api/v1/auth/get-public-users-by-ids`, accepts a non-empty trusted display name even when no avatar exists, and returns only requested positive IDs. Catch its failure in `listCalls()` and substitute an empty map.

- [x] **Step 5: Implement public service methods**

Add these exact methods:

```ts
async listCalls(options: {
  limit?: number
  cursor?: string
  signal?: AbortSignal
} = {}): Promise<JotmoCallList>

async readCall(callRef: string, options: {
  signal?: AbortSignal
} = {}): Promise<JotmoCallDetail>
```

`listCalls()` must require a session, constrain the limit, fetch the Data aggregate page, extract participant IDs/room IDs with the pure helpers, hydrate names best-effort, seal every room ID, then project. `readCall()` must require a session, open/verify the call ref before network access, request WebRTC detail, then project it against the expected room ID.

- [x] **Step 6: Verify service security and retry behavior**

```bash
pnpm vitest run tests/jotmo-service.test.ts tests/call-presentation.test.ts
pnpm typecheck
```

Expected: list/detail success, refresh, abort, fallback, ref-integrity, account-binding, and DTO privacy tests all pass.

- [x] **Step 7: Commit the service slice**

```bash
git add src/jotmo-service.ts tests/jotmo-service.test.ts
git commit -m "feat: serve authenticated call history"
```

---

## Task 4: Expose call history through the Host API and browser SDK

**Files:**

- Modify: `src/host-api.ts:1-230`
- Modify: `src/sdk/index.ts:1-220`
- Modify: `tests/sdk.test.ts`

- [x] **Step 1: Add failing SDK request-shape tests**

Extend `tests/sdk.test.ts` with a mock route that handles `calls.list` and `calls.detail`, then assert:

```ts
await expect(sdk.listCalls({ limit: 12, cursor: 'opaque-page' }))
  .resolves.toMatchObject({ hasMore: false })
await expect(sdk.readCall('jotmo-call-v1.payload.signature'))
  .resolves.toMatchObject({ callRef: 'jotmo-call-v1.payload.signature' })
expect(calls).toEqual([
  { operation: 'calls.list', params: { limit: 12, cursor: 'opaque-page' } },
  { operation: 'calls.detail', params: { callRef: 'jotmo-call-v1.payload.signature' } },
])
```

Assert blank `callRef` rejects with `TypeError`, and that each method passes its `AbortSignal` to fetch.

- [x] **Step 2: Run the SDK test and confirm RED**

```bash
pnpm vitest run tests/sdk.test.ts
```

Expected failure: SDK methods do not exist.

- [x] **Step 3: Wire Host dispatch**

Add to `dispatch()`:

```ts
case 'calls.list': return await service.listCalls({
  limit: numberParam(params, 'limit', 20),
  ...(stringParam(params, 'cursor') === '' ? {} : { cursor: stringParam(params, 'cursor') }),
})
case 'calls.detail': return await service.readCall(stringParam(params, 'callRef'))
```

The local Host route remains same-origin, POST-only, loopback-protected, `Cache-Control: no-store`, and the only browser entry point.

- [x] **Step 4: Add typed SDK methods and exports**

Add and export all call DTOs, then implement:

```ts
async listCalls(options: {
  limit?: number
  cursor?: string
  signal?: AbortSignal
} = {}): Promise<JotmoCallList> {
  return await this.call<JotmoCallList>('calls.list', {
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
  }, options.signal)
}

async readCall(callRef: string, options: {
  signal?: AbortSignal
} = {}): Promise<JotmoCallDetail> {
  if (callRef.trim() === '') throw new TypeError('Jiwo call reference must not be empty')
  return await this.call<JotmoCallDetail>('calls.detail', { callRef }, options.signal)
}
```

- [x] **Step 5: Verify Host/SDK contract**

```bash
pnpm vitest run tests/sdk.test.ts tests/jotmo-service.test.ts
pnpm typecheck
```

Expected: operations and request shapes pass without changing contract version 1.

- [x] **Step 6: Commit the API slice**

```bash
git add src/host-api.ts src/sdk/index.ts tests/sdk.test.ts
git commit -m "feat: expose call history in jotmo sdk"
```

---

## Task 5: Add calls UI mode and testable client presentation helpers

**Files:**

- Modify: `src/client/ui-controller.ts:1-76`
- Create: `src/client/call-presentation.ts`
- Modify: `tests/ui-controller.test.ts`
- Create: `tests/client-call-presentation.test.ts`

- [x] **Step 1: Add failing UI-controller tests**

Extend `tests/ui-controller.test.ts`:

```ts
controller.selectSource(source)
controller.showCalls()
expect(controller.getSnapshot()).toMatchObject({
  mode: 'calls',
  selectedSource: source,
  open: true,
  surfaceOpen: true,
})
controller.selectSource(source)
expect(controller.getSnapshot()).toMatchObject({ mode: 'source', selectedSource: source })
controller.showCalls()
controller.authChanged(false)
expect(controller.getSnapshot()).toEqual({
  open: false,
  surfaceOpen: true,
  authRevision: 1,
  mode: 'login',
})
```

The first assertion proves entering calls preserves the last selected source for returning to conversations; the final assertion proves auth changes clear it.

- [x] **Step 2: Add failing client-helper tests**

Create `tests/client-call-presentation.test.ts` for these exact exports:

```ts
import {
  callDirectionLabel,
  callMediaLabel,
  formatCallDuration,
  formatCallTime,
  mergeCallListItems,
  sectionStatusMessage,
} from '../src/client/call-presentation.js'
```

Cover deduplication by `callRef` while preserving page order, `61_000 -> '1分01秒'`, valid/zero timestamps, all media/direction labels, and stable Chinese status messages for `empty`, `processing`, and `failed` summary/transcript sections.

- [x] **Step 3: Run the focused tests and confirm RED**

```bash
pnpm vitest run tests/ui-controller.test.ts tests/client-call-presentation.test.ts
```

Expected failure: `showCalls()` and the helper module are missing.

- [x] **Step 4: Add calls mode without discarding source selection**

Change `JotmoUiState.mode` to `'login' | 'source' | 'calls'` and implement:

```ts
showCalls(): void {
  this.publish({ ...this.state, open: true, surfaceOpen: true, mode: 'calls' })
}
```

Keep `selectSource()` returning to `source`. Keep `authChanged()`, `showLogin()`, and `showLoginSurface()` removing `selectedSource`. Do not add calls state to any navigation cache structure.

- [x] **Step 5: Implement deterministic presentation helpers**

Implement the six functions imported by the test. `mergeCallListItems(current, incoming)` must replace no existing entry, append only unseen `callRef` values, and return a new array. `formatCallTime()` uses the existing Chinese date/time conventions. `sectionStatusMessage()` accepts the section kind (`'summary' | 'transcript'`) and state and returns plain text only.

- [x] **Step 6: Verify controller and presentation behavior**

```bash
pnpm vitest run tests/ui-controller.test.ts tests/client-call-presentation.test.ts
pnpm typecheck
```

Expected: mode transitions, auth clearing, merge behavior, and labels pass.

- [x] **Step 7: Commit the client-state slice**

```bash
git add src/client/ui-controller.ts src/client/call-presentation.ts tests/ui-controller.test.ts tests/client-call-presentation.test.ts
git commit -m "feat: add call history ui state"
```

---

## Task 6: Build and wire the confirmed two-column call-history surface

**Files:**

- Create: `src/client/JotmoCallHistorySurface.tsx`
- Modify: `src/client/JotmoVirtualWorkspace.tsx:191-390`
- Modify: `src/client/JotmoSidebar.tsx:1-320`
- Test: `tests/client-call-presentation.test.ts`

- [x] **Step 1: Add failing state-transition helper coverage before React wiring**

Add tests for small pure exports used by the component:

```ts
expect(nextSelectedCallRef(undefined, [{ callRef: 'call-a' }])).toBe('call-a')
expect(nextSelectedCallRef('call-a', [{ callRef: 'call-a' }, { callRef: 'call-b' }])).toBe('call-a')
expect(nextSelectedCallRef('missing', [{ callRef: 'call-a' }])).toBe('call-a')
expect(isCurrentCallRequest(3, 3)).toBe(true)
expect(isCurrentCallRequest(2, 3)).toBe(false)
```

These helpers live in `src/client/call-presentation.ts` and make auto-selection and stale-response policy independently testable.

- [x] **Step 2: Run the helper test and confirm RED**

```bash
pnpm vitest run tests/client-call-presentation.test.ts
```

Expected failure: the new exports do not exist.

- [x] **Step 3: Implement the helpers and restore GREEN**

Implement `nextSelectedCallRef()` so a missing/invalid selection chooses the first item, while an existing selection remains stable. Implement `isCurrentCallRequest(requestGeneration, currentGeneration)` as strict equality. Run the focused test again before creating the component.

- [x] **Step 4: Create `JotmoCallHistorySurface`**

The component must call the local Provider only:

```ts
callJotmo<JotmoCallList>('calls.list', {
  limit: 20,
  ...(cursor === undefined ? {} : { cursor }),
})
callJotmo<JotmoCallDetail>('calls.detail', { callRef })
```

Implement these states separately:

- initial list loading, appended-page loading, terminal list empty, list error/retry;
- selected call ref, detail loading, detail error/retry;
- summary and transcript `ready`, `empty`, `processing`, and `failed` blocks;
- list and detail request-generation refs; ignore any completion whose captured generation is no longer current;
- auto-select the first successful list item;
- append/dedupe by `callRef` and continue pagination even when a filtered page contains zero displayable items but `hasMore` remains true;
- clear component memory when unmounted or when auth identity/mode changes; do not write browser storage.

Use the confirmed layout:

```ts
const callStyles = {
  shell: {
    display: 'grid',
    gridTemplateColumns: 'minmax(260px, 320px) minmax(0, 1fr)',
    height: '100%',
    minWidth: 0,
    overflow: 'hidden',
  },
  listPane: { minWidth: 0, overflowY: 'auto', borderRight: '1px solid rgba(0,0,0,.08)' },
  detailPane: { minWidth: 0, overflowY: 'auto' },
} satisfies Record<string, React.CSSProperties>
```

List rows show display name, audio/video label, direction/result, call time, duration, and summary preview/status. Detail shows title/meta, participant names, AI summary, and ordered transcript. Every text value is rendered through JSX text nodes with `whiteSpace: 'pre-wrap'` where needed.

- [x] **Step 5: Add the Footer root navigation entry**

In the `directory === 'root'` block of `JotmoNavigation`, insert a `通话记录` row after `发给自己` and before `sources.map(...)`. Its click handler is:

```ts
const showCalls = () => {
  jotmoUi.showCalls()
  onActivateSurface?.()
}
```

The call row is active only when `ui.mode === 'calls'`. Change source-row active calculations to require `ui.mode === 'source'`, including the synthetic `发给自己` row, so the UI never displays two active destinations. Do not persist `calls` or a call reference through `persistCache()`.

- [x] **Step 6: Route only calls mode to the new surface**

Import the component into `src/client/JotmoSidebar.tsx`. After auth is known and authenticated, render `<JotmoCallHistorySurface />` when `ui.mode === 'calls'`; otherwise preserve the existing login/source behavior. The calls branch must not render the message header, timeline, composer, or conversation controls.

Do not change `JotmoConversationSurface`, `JotmoFooterDropdown`, client slot declarations, or session-watcher code.

- [x] **Step 7: Verify the UI integration**

```bash
pnpm vitest run tests/ui-controller.test.ts tests/client-call-presentation.test.ts
pnpm typecheck
pnpm build
```

Then manually inspect the local Harness UI:

1. Open the Footer Jotmo dropdown and verify root order: `发给自己`, `通话记录`, existing chats.
2. Select `通话记录`; verify only one navigation row is active.
3. Verify list/detail panes scroll independently at desktop width.
4. Verify first item auto-select, load-more deduplication, summary/transcript states, and separate retry controls.
5. Switch back to a conversation; verify the previous source remains selected and existing timeline/composer behavior is unchanged.
6. Log out/change account; verify call content and source selection are cleared.

- [x] **Step 8: Commit the UI slice**

```bash
git add src/client/JotmoCallHistorySurface.tsx src/client/JotmoVirtualWorkspace.tsx src/client/JotmoSidebar.tsx src/client/call-presentation.ts tests/client-call-presentation.test.ts
git commit -m "feat: add call history workspace surface"
```

---

## Task 7: Document the additive contract and run the release gate

**Files:**

- Modify: `README.md`
- Modify: `docs/consumer-plugin-contract.md`

- [x] **Step 1: Document configuration and data boundaries**

Update `README.md` with the two new origins, their test/prod values, the `allowProduction` requirement, and the user-visible call-history workflow. State that call content is fetched on demand and is not persisted by this plugin.

- [x] **Step 2: Document Provider/SDK operations**

Update `docs/consumer-plugin-contract.md` with:

- provider contract version remains `1`;
- feature flags `callHistory` and `callDetail`;
- operations `calls.list` and `calls.detail`;
- SDK signatures and DTO fields;
- opaque cursor and opaque account-bound `callRef` rules;
- plain-text rendering and Host-side identifier/media stripping;
- error codes `call-list-contract-invalid` and `call-ref-invalid`.

- [x] **Step 3: Run focused and full verification from a clean command invocation**

```bash
pnpm vitest run tests/call-presentation.test.ts tests/jotmo-service.test.ts tests/sdk.test.ts tests/ui-controller.test.ts tests/client-call-presentation.test.ts
pnpm test
pnpm typecheck
pnpm build
git diff --check
git status --short
```

Expected: all commands succeed; `git diff --check` is silent; status contains only the intended documentation changes before the final commit.

- [x] **Step 4: Perform a privacy grep**

```bash
rg -n "recording_url|object_key|file_id|speaker_user_id|spk_id|confidence|trtc_account|quota" src/client src/sdk src/types.ts
```

Expected: no sensitive upstream field is declared in public/browser DTOs or consumed by client code. A pure Host projector may read sensitive keys only to ignore them; it must not return them.

- [x] **Step 5: Self-review against the confirmed spec**

Verify each requirement in `docs/superpowers/specs/2026-08-18-harness-call-history-design.md` has a matching test or manual check, with special attention to filtered empty pages, missing next cursor, account-bound refs, best-effort name hydration, stale request generations, no cache persistence, and unchanged conversation-slot behavior.

- [x] **Step 6: Commit documentation and final verification result**

```bash
git add README.md docs/consumer-plugin-contract.md
git commit -m "docs: describe call history integration"
```

After the commit, rerun:

```bash
git status --short
```

Expected: clean worktree.
