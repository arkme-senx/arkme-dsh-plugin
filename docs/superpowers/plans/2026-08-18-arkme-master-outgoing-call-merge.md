# Arkme Master Merge and Outgoing Call Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge `arkme/master` into the pushed temporary branch and port the existing private-chat audio/video outgoing-call feature onto the latest Arkme architecture without restoring removed Jotmo subsystems.

**Architecture:** First resolve the merge to an exact, independently passing Arkme master baseline plus the approved design/plan documents. Then reintroduce outgoing calls in focused commits: core contract/assets, Arkme service and Host API, client UI/runtime, modular Arkme tool, and public configuration/docs. The final branch keeps a normal merge commit, master remains authoritative, and no history rewrite is required.

**Tech Stack:** TypeScript 6, React 18, Cordis, DSH tools/slots, Vitest 4, tsdown, Node.js HTTP APIs, pnpm 11.

**Spec:** `docs/superpowers/specs/2026-08-18-arkme-master-outgoing-call-merge-design.md`

## Global Constraints

- Use a normal merge; do not rebase or force-push `codex/tmp-v95-outgoing-call-20260818`.
- Latest fetched integration target at execution start is `arkme/master` commit `4099d7c`.
- Arkme architecture, naming, directory structure, tree navigation, official community, realtime chat, and AI-video behavior remain authoritative.
- Only private chats expose outgoing audio/video calls.
- Do not restore call history, all-day recording, related-recording UI, or their old Jotmo navigation modes.
- Keep the fixed `assets/desktop_call` frontend outgoing-only; do not alter its bundle or manifest hashes.
- The model-facing tool is `arkme_call_start`, with `effect: 'write'` and `grant: 'explicit-user-write'`.
- Never return TRTC `userSig`, room bootstrap credentials, or other secrets from a model tool or log.
- Use `/arkme-self/api/call` as the default static call asset route.
- Use direct local binaries for verification so the pnpm wrapper does not unexpectedly reinstall dependencies.

---

## File Structure

### Files restored from the approved outgoing-call implementation and renamed for Arkme

- `src/outgoing-call-contract.ts`: Arkme outgoing-call DTOs and typed failures.
- `src/outgoing-call-broker.ts`: single-use model intent and per-user active-call lease state.
- `src/outgoing-call-assets.ts`: allowlisted static asset HTTP handler.
- `src/client/outgoing-call-ui-controller.ts`: in-memory requests from the private-chat header.
- `src/client/outgoing-call-bridge.ts`: validated iframe protocol and browser media permission adapter.
- `src/client/outgoing-call-runtime.ts`: prepare/bootstrap/call/heartbeat/release state machine.
- `src/client/ArkmeOutgoingCallHost.tsx`: global outgoing-call portal.
- `src/client/ArkmePrivateCallMenu.tsx`: private-chat audio/video menu.
- `src/tools/ports/outgoing-call.ts`: tool-to-service outgoing-call port.
- `src/tools/business/conversation/start-call.ts`: `arkme_call_start` tool module.
- `assets/desktop_call/*`: pinned outgoing-only browser frontend.
- `scripts/verify-call-assets.mjs`: manifest and derived asset verifier.

### Existing Arkme files modified

- `src/arkme-service.ts`: service methods, WebRTC calls, broker lifecycle.
- `src/host-api.ts`: outgoing-call operation validation and dispatch.
- `src/index.ts`: WebRTC config, static asset route, disposal and public type exports.
- `src/types.ts`: client config, capability flag and Host operation union.
- `src/client/ArkmeSidebar.tsx`: approved private-chat call entry.
- `src/client/ArkmeFooterDropdown.tsx`: mounts the global call host.
- `src/client/index.tsx`: Arkme outgoing-call client exports.
- `src/tools/ports/index.ts`: includes the outgoing-call tool port.
- `src/tools/business/conversation/index.ts`: conversation-module export.
- `src/tools/business/index.ts`: stable catalog insertion.
- `src/tools/prompts/business.ts`: explicit human-request guidance.
- `package.json`, `cordis.patch.yml`, `README.md`, `docs/consumer-plugin-contract.md`: packaging, configuration and contract documentation.

### Tests added or modified

- `tests/outgoing-call-broker.test.ts`
- `tests/outgoing-call-assets.test.ts`
- `tests/host-api.test.ts`
- `tests/arkme-service.test.ts`
- `tests/outgoing-call-bridge.test.ts`
- `tests/outgoing-call-runtime.test.ts`
- `tests/client-outgoing-call-ui.test.tsx`
- `tests/arkme-tools.test.ts`
- `tests/tools/catalog.test.ts`
- `tests/production-config.test.ts`
- `tests/sdk.test.ts`

---

### Task 1: Resolve the Merge to a Passing Arkme Baseline

**Files:**
- Keep from current branch: `docs/superpowers/specs/2026-08-18-arkme-master-outgoing-call-merge-design.md`
- Keep from current branch: `docs/superpowers/plans/2026-08-18-arkme-master-outgoing-call-merge.md`
- Modify: `tests/arkme-identity.test.ts` to exclude internal `docs/superpowers` migration artifacts while retaining identity checks for published documentation and all source files.
- Resolve to master: all product code, configuration, package metadata, existing tests and pre-existing documentation.
- Remove from merge result: old Jotmo call-history/recording/related-recording/outgoing-call files listed below.

**Interfaces:**
- Consumes: current branch `codex/tmp-v95-outgoing-call-20260818`; fetched `arkme/master`.
- Produces: a two-parent merge commit whose tree differs from `arkme/master` only by the approved design and plan documents.

- [ ] **Step 1: Verify the starting branch, clean tree and fetched master**

Run:

```bash
git branch --show-current
git status --short
git -c core.sshCommand="ssh -p 443 -o Hostname=ssh.github.com" fetch arkme master --prune
git rev-parse arkme/master
```

Expected: branch is `codex/tmp-v95-outgoing-call-20260818`, status is empty, and the fetched master is `4099d7c` or a newer commit reviewed against this plan before continuing.

- [ ] **Step 2: Start the non-fast-forward merge without committing**

Run:

```bash
git merge --no-ff --no-commit arkme/master
```

Expected: Git reports conflicts in the shared Jotmo-to-Arkme migration files and leaves `MERGE_HEAD` pointing at `arkme/master`.

- [ ] **Step 3: Resolve every shared architecture path to the master version**

Run this exact restore set:

```bash
git restore --source=arkme/master --staged --worktree -- .gitignore README.md cordis.patch.yml docs/consumer-plugin-contract.md docs/tool-registry.md package.json pnpm-lock.yaml src/client/api.ts src/client/geetest.ts src/client/index.tsx src/client/navigation-cache.ts src/client/new-session-activation.ts src/client/record-presentation.ts src/client/ui-controller.ts src/host-api.ts src/index.ts src/keychain-store.ts src/local-database.ts src/sdk/index.ts src/state-store.ts src/types.ts tests/client-adapter.test.ts tests/local-database.test.ts tests/navigation-cache.test.ts tests/new-session-activation.test.ts tests/production-config.test.ts tests/record-presentation.test.ts tests/sdk.test.ts tests/state-store.test.ts tests/ui-controller.test.ts tests/wechat-tools.test.ts tsconfig.json
```

This explicitly selects master for every changed-in-both or automatically merged shared architecture file; later tasks reapply only the approved outgoing-call deltas.

- [ ] **Step 4: Keep master deletions and remove obsolete ours-only files**

Run:

```bash
git rm -r --ignore-unmatch assets/desktop_call scripts/verify-call-assets.mjs docs/superpowers/plans/2026-08-18-all-day-recording-query-tools.md docs/superpowers/plans/2026-08-18-harness-call-history.md docs/superpowers/plans/2026-08-18-harness-outgoing-call.md docs/superpowers/specs/2026-08-18-all-day-recording-query-tools-design.md docs/superpowers/specs/2026-08-18-harness-call-history-design.md docs/superpowers/specs/2026-08-18-harness-outgoing-call-design.md src/call-presentation.ts src/client/JotmoCallHistorySurface.tsx src/client/JotmoConversationSurface.tsx src/client/JotmoFooterAction.tsx src/client/JotmoFooterDropdown.tsx src/client/JotmoLogin.tsx src/client/JotmoOutgoingCallHost.tsx src/client/JotmoPrivateCallMenu.tsx src/client/JotmoRecordingSurface.tsx src/client/JotmoSettingsRow.tsx src/client/JotmoSidebar.tsx src/client/JotmoVirtualWorkspace.tsx src/client/call-presentation.ts src/client/login-assets.ts src/client/outgoing-call-bridge.ts src/client/outgoing-call-runtime.ts src/client/outgoing-call-ui-controller.ts src/client/related-recordings.tsx src/jotmo-image-tool.ts src/jotmo-service.ts src/jotmo-tools.ts src/outgoing-call-assets.ts src/outgoing-call-broker.ts src/outgoing-call-contract.ts src/recording-presentation.ts src/recording-tools.ts src/related-recording-tool.ts src/wechat-tools.ts tests/call-presentation.test.ts tests/client-call-presentation.test.ts tests/client-outgoing-call-ui.test.ts tests/host-api.test.ts tests/index.test.ts tests/jotmo-login.test.tsx tests/jotmo-service.test.ts tests/jotmo-tools.test.ts tests/outgoing-call-assets.test.ts tests/outgoing-call-bridge.test.ts tests/outgoing-call-broker.test.ts tests/outgoing-call-runtime.test.ts tests/recording-presentation.test.ts tests/recording-surface-layout.test.tsx tests/recording-tools.test.ts tests/related-recording-tool.test.ts tests/related-recordings-ui.test.tsx
```

Then stage master additions and deletions:

```bash
git add -A
git diff --name-only --diff-filter=U
git diff --cached --check
```

Expected: no unmerged paths and no whitespace errors.

- [ ] **Step 5: Prove the resolved tree is master plus only the approved docs**

Run:

```bash
git diff --cached --name-status arkme/master
```

Expected output contains only:

```text
A docs/superpowers/plans/2026-08-18-arkme-master-outgoing-call-merge.md
A docs/superpowers/specs/2026-08-18-arkme-master-outgoing-call-merge-design.md
M tests/arkme-identity.test.ts
```

- [ ] **Step 6: Verify the Arkme baseline**

Run:

```bash
./node_modules/.bin/tsc --project tsconfig.json --noEmit
./node_modules/.bin/vitest run
```

Expected: typecheck succeeds and the full master test suite passes.

- [ ] **Step 7: Commit the merge baseline**

Run:

```bash
git commit -m "merge: integrate latest arkme master architecture"
git show -s --format='%H%n%P%n%s' HEAD
```

Expected: the commit has two parents; the second parent is the fetched `arkme/master` commit.

---

### Task 2: Port the Outgoing-Call Contract, Broker and Fixed Assets

**Files:**
- Create: `src/outgoing-call-contract.ts`
- Create: `src/outgoing-call-broker.ts`
- Create: `src/outgoing-call-assets.ts`
- Create: `assets/desktop_call/bundle.js`
- Create: `assets/desktop_call/call-linear-strong.svg`
- Create: `assets/desktop_call/index.html`
- Create: `assets/desktop_call/manifest.json`
- Create: `scripts/verify-call-assets.mjs`
- Create: `tests/outgoing-call-broker.test.ts`
- Create: `tests/outgoing-call-assets.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: opaque Arkme `sourceRef`, numeric signed-in user ID, `audio | video` media selection.
- Produces: `ArkmeOutgoingCallBroker`; `ArkmeOutgoingCallPrepareResult`; `createOutgoingCallAssetHandler(options)`.

- [ ] **Step 1: Add failing broker and asset tests using Arkme names and route**

Use commit `bf1addf3c979db1568ac9a9880fa0bdbf6d03a84` as the behavior reference. Recreate the existing broker and asset tests with these exact Arkme substitutions:

```ts
import { ArkmeOutgoingCallBroker } from '../src/outgoing-call-broker.js'

const broker = new ArkmeOutgoingCallBroker({
  now: () => clock.now,
  randomId: () => `id-${String(++sequence)}`,
  setTimer: clock.setTimer,
  clearTimer: clock.clearTimer,
})
```

```ts
await createOutgoingCallAssetHandler({
  routePrefix: '/arkme-self/api/call',
  assetDirectory,
})(req, res)
```

Keep the original assertions for one-time claim tokens, 30-second intent expiry, per-user isolation, 120-second leases, manifest SHA-256 values, allowlisted paths, CSP and `outgoingOnly: true`.

- [ ] **Step 2: Run tests to verify they fail because the Arkme files do not exist**

Run:

```bash
./node_modules/.bin/vitest run tests/outgoing-call-broker.test.ts tests/outgoing-call-assets.test.ts
```

Expected: FAIL with unresolved imports for `src/outgoing-call-broker.ts` or `src/outgoing-call-assets.ts`.

- [ ] **Step 3: Implement the Arkme contract and broker**

Create the contract with these exact public names:

```ts
export type ArkmeOutgoingCallMediaType = 'audio' | 'video'
export type ArkmeOutgoingCallFailureCode =
  | 'call-ui-unavailable' | 'call-active' | 'call-source-invalid'
  | 'call-peer-unavailable' | 'call-permission-denied'
  | 'call-bootstrap-failed' | 'call-engine-failed' | 'call-cancelled'

export interface ArkmeOutgoingCallIntentClaim {
  intentId: string
  claimToken: string
  callRequestId: string
  sourceRef: string
  displayName: string
  mediaType: ArkmeOutgoingCallMediaType
  expiresAtMillis: number
}

export interface ArkmeOutgoingCallToolResult {
  status: 'calling'
  displayName: string
  mediaType: ArkmeOutgoingCallMediaType
}

export interface ArkmeOutgoingCallIntentResolutionInput {
  userId: number
  intentId: string
  claimToken: string
  outcome:
    | { status: 'calling' }
    | { status: 'failed'; code: ArkmeOutgoingCallFailureCode; message: string }
}

export interface ArkmeOutgoingCallPrepareResult {
  callRequestId: string
  displayName: string
  peerAvatarRef?: string
  bootstrap: {
    sdkAppId: number
    userId: string
    userSig: string
    nickName: string
    avatar: ''
    outgoingOnly: true
  }
  call: {
    roomId: string
    mediaType: ArkmeOutgoingCallMediaType
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

export class ArkmeOutgoingCallError extends Error {
  readonly retryable = false
  constructor(readonly code: ArkmeOutgoingCallFailureCode, message: string) {
    super(message)
    this.name = 'ArkmeOutgoingCallError'
  }
}
```

Rename `JotmoOutgoingCallBroker` to `ArkmeOutgoingCallBroker` without changing TTLs or state behavior.

- [ ] **Step 4: Restore the pinned assets and static handler unchanged**

Restore the four asset byte streams, verifier and HTTP handler from `bf1addf`; only change test/request route examples from `/jotmo-self/api/call` to `/arkme-self/api/call`. Do not edit `bundle.js`, `index.html`, `manifest.json` or the SVG contents because the manifest pins their hashes and bridge channel.

Update `package.json`:

```json
{
  "files": ["lib", "assets/desktop_call", "cordis.patch.yml", "README.md", "docs"],
  "scripts": {
    "verify:call-assets": "node scripts/verify-call-assets.mjs"
  }
}
```

Retain all master scripts and dependencies around these additions.

- [ ] **Step 5: Run targeted tests and resource verification**

Run:

```bash
./node_modules/.bin/vitest run tests/outgoing-call-broker.test.ts tests/outgoing-call-assets.test.ts
node scripts/verify-call-assets.mjs
```

Expected: both test files pass and the verifier reports the pinned outgoing-only assets valid.

- [ ] **Step 6: Commit the core port**

Run:

```bash
git add package.json assets/desktop_call scripts/verify-call-assets.mjs src/outgoing-call-contract.ts src/outgoing-call-broker.ts src/outgoing-call-assets.ts tests/outgoing-call-broker.test.ts tests/outgoing-call-assets.test.ts
git commit -m "feat(arkme): port outgoing call core and assets"
```

---

### Task 3: Integrate Calls with ArkmeService, Host API and Plugin Lifecycle

**Files:**
- Modify: `src/arkme-service.ts`
- Modify: `src/host-api.ts`
- Modify: `src/index.ts`
- Modify: `src/types.ts`
- Create: `tests/host-api.test.ts`
- Modify: `tests/arkme-service.test.ts`
- Modify: `tests/production-config.test.ts`

**Interfaces:**
- Consumes: `ArkmeOutgoingCallBroker`, Arkme sealed private-chat source refs, `webrtcBaseUrl`.
- Produces: five `calls.outgoing.*` Host operations, service call preparation, asset route registration and lifecycle cleanup.

- [ ] **Step 1: Add failing type, Host API, service and configuration tests**

Add `callAssetBasePath` and capability assertions:

```ts
expect(service.clientConfig()).toMatchObject({ callAssetBasePath: '/arkme-self/api/call' })
expect(service.providerCapabilities().features.outgoingCall).toBe(true)
```

Port the existing Host dispatch cases to `dispatchArkmeHostOperation`, including invalid media, invalid intent status/failure code, prepare forwarding, heartbeat and release validation.

Add Arkme service tests that assert this request order:

```ts
expect(requests.map(item => item.url)).toEqual([
  'https://chat.test/api/v1/chats/detail',
  'https://auth.test/api/v1/auth/get-user-info',
  'https://auth.test/api/v1/auth/get-public-users-by-ids',
  'https://webrtc.test/api/v1/trtc/credentials',
  'https://webrtc.test/api/v1/trtc/create-room',
])
```

Retain assertions that group-chat refs fail before network I/O, empty callee lists release leases, safe tool results omit secrets, logout clears intents and `dispose()` rejects pending requests.

- [ ] **Step 2: Run the focused tests and observe missing call integration**

Run:

```bash
./node_modules/.bin/vitest run tests/host-api.test.ts tests/arkme-service.test.ts tests/production-config.test.ts
```

Expected: FAIL because Arkme config, operations and service methods do not yet exist.

- [ ] **Step 3: Extend Arkme types and service config**

Add these exact shapes to `src/types.ts`:

```ts
export interface ArkmeClientConfig {
  captchaId: string
  callAssetBasePath: string
}
```

Add `outgoingCall: true` to provider capabilities, and add these values to `ArkmePluginOperation`:

```ts
| 'calls.outgoing.intent.claim'
| 'calls.outgoing.intent.resolve'
| 'calls.outgoing.prepare'
| 'calls.outgoing.heartbeat'
| 'calls.outgoing.release'
```

Extend `ArkmeServiceConfig` and root `Config` with `webrtcBaseUrl: string`, defaulting to `https://jotmo-webrtc.senguo.me`, and validate it with the existing HTTPS-origin loop.

- [ ] **Step 4: Port the service methods onto ArkmeService**

Keep the current fourth constructor argument as `fetchImpl` and the fifth as master’s pending binding-session store; add the injectable broker as the sixth argument so the new phone-binding flow and existing master tests remain source-compatible:

```ts
constructor(
  private readonly config: ArkmeServiceConfig,
  private readonly sessionStore: ArkmeSessionStore,
  private readonly stateStore: StateStore,
  private readonly fetchImpl: FetchLike = fetch,
  private readonly pendingSessionStore?: ArkmeSessionStore,
  private readonly outgoingCallBroker = new ArkmeOutgoingCallBroker(),
)
```

Keep the existing constructor body unchanged: initialize `ArkmeChatRealtimeRuntime` from `config.imBaseUrl`, `sessionStore.read` and `fetchImpl` exactly as master does.

Implement these exact signatures:

```ts
async requestOutgoingCall(
  sourceRef: string,
  mediaType: ArkmeOutgoingCallMediaType,
  signal?: AbortSignal,
): Promise<ArkmeOutgoingCallToolResult>

async claimOutgoingCallIntent(): Promise<ArkmeOutgoingCallIntentClaim | null>

async resolveOutgoingCallIntent(
  input: Omit<ArkmeOutgoingCallIntentResolutionInput, 'userId'>,
): Promise<void>

async prepareOutgoingCall(input: {
  sourceRef: string
  mediaType: ArkmeOutgoingCallMediaType
  callRequestId: string
  signal?: AbortSignal
}): Promise<ArkmeOutgoingCallPrepareResult>

async heartbeatOutgoingCall(callRequestId: string): Promise<{ expiresAtMillis: number }>
async releaseOutgoingCall(callRequestId: string): Promise<void>
dispose(): void
```

Use the master `openSourceRef`, `publicProfilesByUserIds`, `sealProfileImageRef`, `refreshProfile` and `authenticatedChatPost` implementations. Add `authenticatedWebrtcPost` mirroring `authenticatedChatPost` but targeting `config.webrtcBaseUrl`. Preserve the approved `/api/v1/trtc/credentials` and `/api/v1/trtc/create-room` request contracts and clear the broker in logout/dispose.

- [ ] **Step 5: Add Host operation validation and error mapping**

Export `dispatchArkmeHostOperation` for focused tests. Map `ArkmeOutgoingCallError` to an `ArkmePluginError`, using HTTP 409 for `call-active` and HTTP 400 for other broker errors. Add the five dispatch cases exactly as defined in the design; validation must reject blank IDs, media other than `audio | video`, unknown failure codes and failure messages longer than 500 characters.

- [ ] **Step 6: Register the static route and service cleanup**

In `apply()` create:

```ts
const callAssetHandler = createOutgoingCallAssetHandler({ routePrefix: `${config.routePath}/call` })
```

Register a prefix web route at `${config.routePath}/call`. Change the existing database cleanup effect so it calls both `service.dispose()` and `localDatabase.close()`.

- [ ] **Step 7: Run targeted tests and typecheck**

Run:

```bash
./node_modules/.bin/vitest run tests/host-api.test.ts tests/arkme-service.test.ts tests/production-config.test.ts
./node_modules/.bin/tsc --project tsconfig.json --noEmit
```

Expected: focused tests and typecheck pass.

- [ ] **Step 8: Commit service integration**

Run:

```bash
git add src/arkme-service.ts src/host-api.ts src/index.ts src/types.ts tests/host-api.test.ts tests/arkme-service.test.ts tests/production-config.test.ts
git commit -m "feat(arkme): integrate outgoing call host service"
```

---

### Task 4: Port the Approved Private-Chat UI and Call Runtime

**Files:**
- Create: `src/client/outgoing-call-ui-controller.ts`
- Create: `src/client/outgoing-call-bridge.ts`
- Create: `src/client/outgoing-call-runtime.ts`
- Create: `src/client/ArkmeOutgoingCallHost.tsx`
- Create: `src/client/ArkmePrivateCallMenu.tsx`
- Modify: `src/client/ArkmeSidebar.tsx`
- Modify: `src/client/ArkmeFooterDropdown.tsx`
- Modify: `src/client/index.tsx`
- Create: `tests/outgoing-call-bridge.test.ts`
- Create: `tests/outgoing-call-runtime.test.ts`
- Create: `tests/client-outgoing-call-ui.test.tsx`

**Interfaces:**
- Consumes: `callArkme`, `ArkmeClientConfig.callAssetBasePath`, the five Host call operations, private-chat source refs.
- Produces: private-chat call menu, global call portal and secure iframe state machine.

- [ ] **Step 1: Add failing bridge, runtime and UI tests**

Port the existing bridge/runtime tests with Arkme type names. Keep protocol assertions for source/origin/request-ID filtering, message length, media permissions, bootstrap-before-call ordering, heartbeats, lease release and intent resolution.

Add component assertions:

```tsx
const markup = renderToStaticMarkup(
  <ArkmePrivateCallMenu sourceRef="source-private" displayName="小林" assetBasePath="/arkme-self/api/call" />,
)
expect(markup).toContain('aria-label="呼叫小林"')
expect(markup).toContain('/arkme-self/api/call/call-linear-strong.svg')
```

Keep layout assertions for normal `960x640`, compact `160x280`, and fullscreen viewport size.

- [ ] **Step 2: Run tests to verify the Arkme client modules are missing**

Run:

```bash
./node_modules/.bin/vitest run tests/outgoing-call-bridge.test.ts tests/outgoing-call-runtime.test.ts tests/client-outgoing-call-ui.test.tsx
```

Expected: FAIL with unresolved Arkme call UI imports.

- [ ] **Step 3: Port the controller, bridge and runtime**

Restore behavior from `bf1addf`, changing all exported DTO references from `JotmoOutgoingCall*` to `ArkmeOutgoingCall*` and changing the default API dependency from `callJotmo` to `callArkme`.

Keep this bridge constant unchanged because the pinned `index.html` and bundle depend on it:

```ts
export const DESKTOP_CALL_CHANNEL = 'jotmo-desktop-call'
```

Keep strict `event.source`, `event.origin`, channel, `callRequestId`, known-message-type and 65,536-byte envelope checks. Zero `prepared.bootstrap.userSig` immediately after bootstrap delivery.

- [ ] **Step 4: Create the Arkme call host and menu**

Rename the React components to `ArkmeOutgoingCallHost` and `ArkmePrivateCallMenu`. `ArkmeOutgoingCallHost` must load avatars through `callArkme('image.read')` and read `/arkme-self/api/call` from `auth.config`.

The menu must publish only:

```ts
outgoingCallUi.request({ sourceRef, displayName, mediaType })
```

for `mediaType` equal to `audio` or `video`, close on outside click/Escape, and preserve the approved 24px header icon and two-item popup.

- [ ] **Step 5: Integrate the call entry into Arkme UI**

In `ArkmeSidebar`, fetch `callAssetBasePath` alongside captcha config and render:

```tsx
{ui.mode === 'source' && source?.kind === 'private_chat' && <ArkmePrivateCallMenu
  sourceRef={source.sourceRef}
  displayName={source.displayName}
  assetBasePath={callAssetBasePath}
/>}
```

Add `position: 'relative'` and `gap: 2` to the existing header style; do not change master message, composer, tree or authentication behavior. Mount one `<ArkmeOutgoingCallHost />` in `ArkmeFooterDropdown`, outside conditional directory/surface rendering, so model-tool intents can be polled whenever the plugin is mounted.

Export the host, menu, layout helper and `outgoingCallUi` from `src/client/index.tsx`.

- [ ] **Step 6: Run UI/runtime tests and typecheck**

Run:

```bash
./node_modules/.bin/vitest run tests/outgoing-call-bridge.test.ts tests/outgoing-call-runtime.test.ts tests/client-outgoing-call-ui.test.tsx tests/floating-surface.test.ts tests/arkme-footer-action.test.tsx
./node_modules/.bin/tsc --project tsconfig.json --noEmit
```

Expected: all focused tests and typecheck pass.

- [ ] **Step 7: Commit the Arkme UI port**

Run:

```bash
git add src/client/outgoing-call-ui-controller.ts src/client/outgoing-call-bridge.ts src/client/outgoing-call-runtime.ts src/client/ArkmeOutgoingCallHost.tsx src/client/ArkmePrivateCallMenu.tsx src/client/ArkmeSidebar.tsx src/client/ArkmeFooterDropdown.tsx src/client/index.tsx tests/outgoing-call-bridge.test.ts tests/outgoing-call-runtime.test.ts tests/client-outgoing-call-ui.test.tsx
git commit -m "feat(arkme): add private chat outgoing call UI"
```

---

### Task 5: Add the Modular `arkme_call_start` Tool

**Files:**
- Create: `src/tools/ports/outgoing-call.ts`
- Modify: `src/tools/ports/index.ts`
- Create: `src/tools/business/conversation/start-call.ts`
- Modify: `src/tools/business/conversation/index.ts`
- Modify: `src/tools/business/index.ts`
- Modify: `src/tools/prompts/business.ts`
- Modify: `tests/arkme-tools.test.ts`
- Modify: `tests/tools/catalog.test.ts`

**Interfaces:**
- Consumes: `ArkmeService.requestOutgoingCall(sourceRef, mediaType, signal)`.
- Produces: business/hybrid write tool `arkme_call_start` returning only `{ status, displayName, mediaType }`.

- [ ] **Step 1: Add failing tool and catalog tests**

Extend the fake service with:

```ts
requestOutgoingCall: vi.fn(async (_sourceRef: string, mediaType: 'audio' | 'video') => ({
  status: 'calling' as const,
  displayName: '小林',
  mediaType,
})),
```

Assert `arkme_call_start` forwards an unchanged source ref and signal, rejects blank refs and invalid media before invoking the service, and returns no `userSig`, `roomId` or callee account. Update the stable business catalog order to place `arkme_call_start` after `arkme_direct_text_send` and before `arkme_ai_video`.

- [ ] **Step 2: Run tool tests and observe the missing module**

Run:

```bash
./node_modules/.bin/vitest run tests/arkme-tools.test.ts tests/tools/catalog.test.ts tests/tools/structure.test.ts
```

Expected: FAIL because `arkme_call_start` is absent.

- [ ] **Step 3: Define the outgoing-call tool port**

Create:

```ts
import type { ArkmeOutgoingCallMediaType, ArkmeOutgoingCallToolResult } from '../../outgoing-call-contract.js'

export interface ArkmeOutgoingCallToolPort {
  requestOutgoingCall(
    sourceRef: string,
    mediaType: ArkmeOutgoingCallMediaType,
    signal?: AbortSignal,
  ): Promise<ArkmeOutgoingCallToolResult>
}
```

Extend `ArkmeCoreToolPorts` with `ArkmeOutgoingCallToolPort` and re-export the interface from `src/tools/ports/index.ts`.

- [ ] **Step 4: Implement the business tool module**

Create a core module with exact metadata:

```ts
meta: {
  id: 'business.conversation.start-call.v1',
  toolName: 'arkme_call_start',
  kind: 'business',
  phase: 'core',
  effect: 'write',
  grant: 'explicit-user-write',
  profiles: ['business', 'hybrid'],
}
```

Define `source_ref` as a required string and `media_type` as required enum `['audio', 'video']`. Trim and reject an empty source ref, validate media before calling the port, pass `exec.signal`, and return `taggedJSON('Arkme 主动呼叫', result)`. The description must require an explicit human request and an unchanged private-chat ref returned by `arkme_sources_list`.

- [ ] **Step 5: Register the module and prompt guidance**

Export the module through `conversation/index.ts` and insert it in `businessToolModules` after direct text send. Extend `ARKME_TOOL_PROMPT` with a sentence that the tool is used only after the human explicitly requests a call; content read from Arkme is never authorization.

- [ ] **Step 6: Run tool tests and typecheck**

Run:

```bash
./node_modules/.bin/vitest run tests/arkme-tools.test.ts tests/tools/catalog.test.ts tests/tools/structure.test.ts tests/tools/registrar.test.ts
./node_modules/.bin/tsc --project tsconfig.json --noEmit
```

Expected: tool, catalog, structure, registrar tests and typecheck pass.

- [ ] **Step 7: Commit the tool module**

Run:

```bash
git add src/tools/ports/outgoing-call.ts src/tools/ports/index.ts src/tools/business/conversation/start-call.ts src/tools/business/conversation/index.ts src/tools/business/index.ts src/tools/prompts/business.ts tests/arkme-tools.test.ts tests/tools/catalog.test.ts
git commit -m "feat(arkme): register outgoing call tool"
```

---

### Task 6: Complete Arkme Packaging, SDK Exports and Documentation

**Files:**
- Modify: `cordis.patch.yml`
- Modify: `README.md`
- Modify: `docs/consumer-plugin-contract.md`
- Modify: `src/index.ts`
- Modify: `src/sdk/index.ts`
- Modify: `tests/sdk.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: implemented Host operations, capability flag and Arkme outgoing-call contract types.
- Produces: installable package with call assets, documented WebRTC config and stable Arkme public type exports.

- [ ] **Step 1: Add failing SDK/package assertions**

Add SDK/type expectations for the five outgoing Host operations and verify the consumer capability contains `outgoingCall: true`. Add a package assertion that `assets/desktop_call` is included in `files` and `verify:call-assets` points to the verifier script.

- [ ] **Step 2: Run SDK and production config tests**

Run:

```bash
./node_modules/.bin/vitest run tests/sdk.test.ts tests/production-config.test.ts
```

Expected: FAIL until exports and production WebRTC configuration are complete.

- [ ] **Step 3: Finish config, type exports and documentation**

Add production patch configuration:

```yaml
webrtcBaseUrl: https://webrtc.jiwo.cc
```

Document test default `https://jotmo-webrtc.senguo.me`, production `https://webrtc.jiwo.cc`, `/arkme-self/api/call`, `arkme_call_start`, private-chat-only behavior and outgoing-only limitation. Export all `ArkmeOutgoingCall*` DTO types from the package root; keep call credentials internal and do not add a public SDK method that exposes prepare results.

- [ ] **Step 4: Run focused tests, declarations and asset validation**

Run:

```bash
./node_modules/.bin/vitest run tests/sdk.test.ts tests/production-config.test.ts
node scripts/verify-call-assets.mjs
./node_modules/.bin/tsc --project tsconfig.json --emitDeclarationOnly
```

Expected: focused tests, asset validation and declaration generation pass.

- [ ] **Step 5: Commit packaging and docs**

Run:

```bash
git add cordis.patch.yml README.md docs/consumer-plugin-contract.md src/index.ts src/sdk/index.ts tests/sdk.test.ts package.json
git commit -m "docs(arkme): document outgoing call integration"
```

---

### Task 7: Run the Full Gate, Audit the Merge and Push

**Files:**
- Verify: entire repository.
- Modify only if a failing check identifies an outgoing-call integration defect covered by the approved spec.

**Interfaces:**
- Consumes: all prior task commits.
- Produces: clean, verified and remotely synchronized temporary branch.

- [ ] **Step 1: Check repository and conflict hygiene**

Run:

```bash
git status --short
git diff --check
git grep -n -E '^(<<<<<<<|=======|>>>>>>>)' -- ':!assets/desktop_call/bundle.js'
```

Expected: clean status, no whitespace errors and no conflict markers.

- [ ] **Step 2: Run all verification commands**

Run in this order:

```bash
node scripts/verify-call-assets.mjs
./node_modules/.bin/tsc --project tsconfig.json --noEmit
./node_modules/.bin/vitest run
./node_modules/.bin/tsc --project tsconfig.json --emitDeclarationOnly
./node_modules/.bin/tsdown
```

Expected: every command exits 0. Record the Vitest file/test counts and build output for the handoff.

- [ ] **Step 3: Audit master ancestry and merge parents**

Run:

```bash
git merge-base --is-ancestor arkme/master HEAD
git log --merges --first-parent -1 --format='%H%n%P%n%s'
git log --oneline --decorate -8
```

Expected: master is an ancestor; the integration merge has the pre-merge branch and `arkme/master` as parents; later commits are the focused outgoing-call port.

- [ ] **Step 4: Push without rewriting history**

Run:

```bash
git -c core.sshCommand="ssh -p 443 -o Hostname=ssh.github.com" push arkme codex/tmp-v95-outgoing-call-20260818
```

Expected: ordinary fast-forward update of the existing remote branch.

- [ ] **Step 5: Verify local and remote hashes match**

Run:

```bash
git rev-parse HEAD
git ls-remote arkme refs/heads/codex/tmp-v95-outgoing-call-20260818
git status --short
```

Expected: local and remote hashes are identical and the worktree is clean.
