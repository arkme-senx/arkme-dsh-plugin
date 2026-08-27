# Arkme Contact Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a WeChat-style, collapsible contact directory below the existing conversation list, with contact World details and the existing unmarked-speaker inference/listen/mark workflow in the right pane.

**Architecture:** A new Provider-side directory service owns list aggregation, projection, opaque account-bound references, contact profile/World resolution, and team read-only projection. A separate unmarked-speaker service owns the audio API contracts, candidate versions, speaker choices, and controlled audio references. A focused React module owns the five independent collapsible sections and an explicit `none | contact | unmarked-speaker` detail state. The production shell adds a sibling Contacts tab to `ArkmeProductNavigation`; `ArkmePersistentSidebar` and `ArkmePersistentWorkspace` switch only their Contacts branches while the existing Conversations branches remain behaviorally identical to HEAD.

**Tech Stack:** TypeScript 6, React 18, Vitest 4, `@phosphor-icons/react`, Provider Host API, Jotmo chat/bot/team/audio/world services, `pinyin-pro`, CSS.

**Spec:** `docs/superpowers/specs/2026-08-23-contact-directory-design.md`

## Global Constraints

- Treat the confirmed low-fidelity prototype as the UI contract: `/Users/zhou/.codex/visualizations/2026/08/23/01a02cad-5f41-7030-82d0-4719e7ce18ed/arkme-contacts-low-fi.html`.
- Preserve the existing task directory, chat navigation, group/Bot open behavior, authentication recovery, and all non-chat routes.
- Keep team rows non-interactive: no `button`, `tabIndex`, click handler, selected state, or detail route.
- Never expose access tokens, STS credentials, user IDs, candidate IDs, speaker IDs, audio object keys, signed URLs, or raw service payloads to the browser. Use account-bound opaque refs.
- Do not infer or cluster speakers in the plugin. The audio service remains the owner of candidates, recommendations, versions, and mark outcomes.
- Keep each section and each contact detail subrequest independently recoverable. A failure in one source must not blank the entire directory.
- Use TDD for every task: write the focused failing test, observe RED, implement the minimum behavior, observe GREEN, then run the stated regression set.
- Do not perform `git add`, `git commit`, `git push`, merge, PR, or deployment without a separate explicit user confirmation. Commit commands below are gated checkpoints, not authorization.

---

### Task 1: Define browser-safe directory and unmarked-speaker contracts

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/types.ts`
- Create: `src/contact-directory-presentation.ts`
- Create: `tests/contact-directory-presentation.test.ts`

**Interfaces:**
- Produces: discriminated directory rows, opaque detail refs, contact profile/World projections, unmarked-speaker pages/options/segments/results, and deterministic A–Z / `#` grouping.
- Consumes: normalized display fields only; raw IDs remain Provider-private.

Use these public shapes as the stable boundary:

```ts
export type ArkmeDirectorySectionKind =
  | 'groups' | 'bots' | 'unmarked-speakers' | 'teams' | 'contacts'

export type ArkmeDirectoryItem =
  | { kind: 'group'; sourceRef: string; displayName: string; avatarRef?: string }
  | { kind: 'bot'; botRef: string; displayName: string; avatarRef?: string }
  | { kind: 'unmarked-speaker'; candidateRef: string; displayName: string; subtitle: string }
  | { kind: 'team'; rowKey: string; displayName: string; publicId?: string; avatarRef?: string }
  | { kind: 'contact'; contactRef: string; displayName: string; nickname: string; remark: string; accountName?: string; avatarRef?: string; letter: string }

export interface ArkmeDirectoryPage {
  section: ArkmeDirectorySectionKind
  items: ArkmeDirectoryItem[]
  total: number
  hasMore: boolean
  nextCursor?: string
  projectionState?: 'fresh' | 'stale' | 'building' | 'failed'
  retryAfterMillis?: number
  cursorStale?: boolean
}

export interface ArkmeDirectoryContactProfile {
  contactRef: string
  displayName: string
  nickname: string
  remark: string
  avatarRef?: string
}

export type ArkmeUnmarkedSpeakerMarkOutcome =
  | 'marked' | 'stale' | 'conflict' | 'candidate_not_found' | 'speaker_not_found'
```

- [ ] **Step 1: Add failing projection tests**

Test `contactDirectoryLetter`, `sortContactDirectoryItems`, and `groupContactDirectoryItems` with: remark over nickname, Chinese `张三 -> Z`, English case folding, digits/symbols/Emoji/blank to `#`, Chinese locale ordering inside a letter, and `contactRef` as the final stable tie-breaker. Also test cross-day and single-day unmarked-speaker display strings.

- [ ] **Step 2: Run the projection test and confirm RED**

Run: `pnpm exec vitest run tests/contact-directory-presentation.test.ts`

Expected: FAIL because `src/contact-directory-presentation.ts` and the new contracts do not exist.

- [ ] **Step 3: Add pinned pinyin support and implement the projection**

Run during implementation: `pnpm add pinyin-pro`

Implement the first-letter rule with `pinyin(value, { pattern: 'first', toneType: 'none', type: 'array' })`, accept only `/^[A-Z]$/`, place everything else in `#`, and sort sections as `A...Z,#`. Keep a single `Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })` instance for stable item ordering.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm exec vitest run tests/contact-directory-presentation.test.ts && pnpm typecheck`

Expected: PASS; serialized public fixtures contain none of `user_id`, `candidate_id`, `speaker_id`, `audio_file_name`, or `object_key`.

- [ ] **Step 5: Prepare gated checkpoint**

Suggested commit message after explicit approval: `feat(contacts): define safe directory projections`

---

### Task 2: Implement group, Bot, team, and contact directory reads

**Files:**
- Create: `src/services/contact-directory-service.ts`
- Create: `tests/services/contact-directory-service.test.ts`
- Modify: `src/services/contact-service.ts`
- Modify: `src/services/source-service.ts`
- Modify: `src/services/bot-service.ts`
- Modify: `src/services/profile-service.ts`
- Modify: `src/services/service.ts`

**Interfaces:**
- `ContactDirectoryService.list(section, options)` reads one section and returns `ArkmeDirectoryPage`.
- `ContactDirectoryService.contactProfile(contactRef)` returns a browser-safe profile.
- `ContactDirectoryService.contactWorld(contactRef, options)` resolves the ref internally and delegates to `WorldService.listUserWorldFeed`.
- `ContactDirectoryService.openContactChat(contactRef)` resolves the ref internally and delegates to `ChatService.openPrivateChatFromUser`.

Use this service surface:

```ts
list(
  section: ArkmeDirectorySectionKind,
  options?: { limit?: number; cursor?: string; refresh?: boolean; signal?: AbortSignal },
): Promise<ArkmeDirectoryPage>
contactProfile(contactRef: string, signal?: AbortSignal): Promise<ArkmeDirectoryContactProfile>
contactWorld(
  contactRef: string,
  options?: { limit?: number; offset?: number; signal?: AbortSignal },
): Promise<ArkmeWorldFeedPage>
openContactChat(contactRef: string, signal?: AbortSignal): Promise<ArkmeOpenPrivateChatResult>
```

- [ ] **Step 1: Write failing source-contract tests**

Cover:

- `/api/v1/chats/contacts/list` field priority: remark, profile nickname, allowed account name, fallback.
- `/api/v1/chats/list` filtering to `session_kind === 2` for groups while preserving existing `sourceRef` sealing.
- Existing `BotService.listBots` projection without leaking bot IDs.
- `/api/v1/team/list-mine` projection to `rowKey`, display name, public ID, and avatar fallback only.
- Empty, pagination, malformed item skipping, and one source failure without cached data.
- Opaque contact ref expiry, tampering, wrong account, and wrong ref type.
- Contact profile, World, and open-chat all revalidate the current account before using the private target user ID.

- [ ] **Step 2: Run the service tests and confirm RED**

Run: `pnpm exec vitest run tests/services/contact-directory-service.test.ts`

Expected: FAIL because `ContactDirectoryService` does not exist.

- [ ] **Step 3: Implement account-bound reference storage**

Store private contact payloads only in the Provider:

```ts
interface ContactDirectoryRefEntry {
  viewerUserId: number
  targetUserId: number
  chatSessionUid?: string
  displayName: string
  nickname: string
  remark: string
  expiresAtMillis: number
}
```

Issue `arkme-directory-contact-v1.<uuid>` refs with a 30-minute lifetime, cap the map at 2,000 entries, prune expired refs before every access, and clear it on the existing session-change invalidation path. Do not reuse search-only `arkme-contact-v1` refs.

- [ ] **Step 4: Implement the four non-speaker data sources**

Reuse existing services for groups and Bots. Call chat/team endpoints through `ServiceRuntime` with interactive-read coordination and bounded limits (`1...50`). Return only opaque refs and display fields. Do not add a team detail ref.

- [ ] **Step 5: Implement profile, World, and private-chat resolution**

Resolve `contactRef`, verify `viewerUserId`, then delegate to the existing profile, World, and chat owners. The browser must call these operations with only `contactRef`; raw `peerUserId` must not cross the new UI boundary.

- [ ] **Step 6: Run focused and neighboring service tests**

Run: `pnpm exec vitest run tests/services/contact-directory-service.test.ts tests/services/contact-service.test.ts tests/services/source-service.test.ts tests/services/bot-service.test.ts`

Expected: PASS with existing list/search/add behaviors unchanged.

- [ ] **Step 7: Prepare gated checkpoint**

Suggested commit message after explicit approval: `feat(contacts): add provider directory service`

---

### Task 3: Implement the unmarked-speaker Provider service

**Files:**
- Create: `src/services/unmarked-speaker-service.ts`
- Create: `tests/services/unmarked-speaker-service.test.ts`
- Modify: `src/services/service.ts`

**Interfaces:**
- Wraps the five confirmed audio endpoints.
- Returns candidate, speaker-choice, and segment refs instead of raw IDs.
- Requires the current `candidateVersion` for every mark write.

Use this service surface:

```ts
list(options?: { limit?: number; cursor?: string; signal?: AbortSignal }): Promise<ArkmeDirectoryPage>
markOptions(candidateRef: string, signal?: AbortSignal): Promise<ArkmeUnmarkedSpeakerOptions>
retryInference(candidateRef: string, signal?: AbortSignal): Promise<ArkmeUnmarkedSpeakerInferenceRetry>
segments(
  candidateRef: string,
  options?: { cursor?: string; limit?: number; signal?: AbortSignal },
): Promise<ArkmeUnmarkedSpeakerSegmentPage>
mark(input: {
  candidateRef: string
  candidateVersion: string
  speakerRef?: string
  newSpeakerName?: string
}, signal?: AbortSignal): Promise<ArkmeUnmarkedSpeakerMarkResult>
```

- [ ] **Step 1: Write failing contract tests for all reads and writes**

Test `/list`, `/mark-options`, `/speaker-inference/retry`, `/segments`, and `/mark`. Include projection states `fresh/stale/building/failed`, `retry_after_ms`, `cursor_stale`, pending/failed/unavailable inference, recommendation filtering, segment pagination, and all mark outcomes.

- [ ] **Step 2: Add security and version tests**

Assert candidate/speaker/segment refs reject tampering, expiry, cross-account use, and type confusion. Assert `mark` rejects a blank/mismatched version and never sends a mark request without `candidate_version`. Assert non-`marked` outcomes do not mutate cached candidates.

- [ ] **Step 3: Run the tests and confirm RED**

Run: `pnpm exec vitest run tests/services/unmarked-speaker-service.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 4: Implement strict response normalization**

Call the exact endpoints from the approved spec. Normalize only known display fields, drop invalid candidates/options/segments, filter the placeholder name `未命名说话人`, cap list sizes, and preserve only documented string-union values. Store raw IDs only inside account-bound ref entries.

- [ ] **Step 5: Implement mark outcome handling**

On `marked`, invalidate the candidate list and speaker-choice caches. On `stale`, invalidate the selected candidate options/segments. On `conflict`, keep the candidate and invalidate reads. On `candidate_not_found`, delete that candidate ref. On `speaker_not_found`, preserve the candidate and invalidate its choices.

- [ ] **Step 6: Run focused tests and request validation**

Run: `pnpm exec vitest run tests/services/unmarked-speaker-service.test.ts && pnpm typecheck`

Expected: PASS; request fixtures contain `candidate_version` and exactly one of `speaker_id` or the backend-supported new-speaker name field.

- [ ] **Step 7: Prepare gated checkpoint**

Suggested commit message after explicit approval: `feat(speakers): add unmarked speaker provider flow`

---

### Task 4: Add controlled unmarked-speaker audio playback

**Files:**
- Modify: `src/services/media-service.ts`
- Modify: `src/services/unmarked-speaker-service.ts`
- Modify: `src/arkme-service.ts`
- Modify: `src/media-routes.ts`
- Create: `tests/unmarked-speaker-media.test.ts`

**Interfaces:**
- `segments()` returns a short-lived `mediaRef` per playable segment.
- Existing local media route resolves `mediaRef`, supports `Range`, and proxies audio bytes.
- Browser never sees STS data, OSS key, internal path, or signed URL.

- [ ] **Step 1: Write failing controlled-media tests**

Test that a segment media ref is issued only after the segment belongs to the current candidate and account; wrong account, forged ref, expired ref, unknown segment, and untrusted OSS host fail before fetch. Test `Range` forwarding and `206` response propagation. Assert the segment JSON contains `mediaRef` but not `session_id`, `child_id`, `audio_file_name`, STS fields, object key, or signed URL.

- [ ] **Step 2: Run media tests and confirm RED**

Run: `pnpm exec vitest run tests/unmarked-speaker-media.test.ts`

Expected: FAIL because unmarked-speaker audio refs are not issued.

- [ ] **Step 3: Implement Provider-side OSS signing**

Use the same environment bucket rule as the existing Web flow (`jotmo-useraudio` in production, `jotmo-useraudio-test` otherwise). Build the object key only inside the Provider from the authenticated user and validated segment tuple, request STS through the existing authenticated audio seam, use `ali-oss` to sign a two-minute GET URL, validate the resulting HTTPS host/path, and immediately hide it behind `MediaService.issueMediaRef`.

- [ ] **Step 4: Reuse the existing local media route**

Do not create a public object-key route. Extend only the descriptor kind/mime handling needed for audio. Preserve existing image and World voiceprint behavior.

- [ ] **Step 5: Run media and regression tests**

Run: `pnpm exec vitest run tests/unmarked-speaker-media.test.ts tests/media-route.test.ts tests/services/media-service.test.ts`

Expected: PASS, including range playback and existing media-host allowlisting.

- [ ] **Step 6: Prepare gated checkpoint**

Suggested commit message after explicit approval: `feat(speakers): proxy candidate audio securely`

---

### Task 5: Wire Provider services through ArkmeService and Host API

**Files:**
- Modify: `src/arkme-service.ts`
- Modify: `src/host-api.ts`
- Modify: `src/types.ts`
- Modify: `src/client/api.ts`
- Create: `tests/contact-directory-host-api.test.ts`
- Create: `tests/unmarked-speaker-host-api.test.ts`
- Modify: `tests/arkme-service.test.ts`

**Interfaces:**
- Adds built-in UI operations:
  - `directory.list`
  - `directory.contact.profile`
  - `directory.contact.world`
  - `directory.contact.open-chat`
  - `unmarked-speakers.options`
  - `unmarked-speakers.retry-inference`
  - `unmarked-speakers.segments`
  - `unmarked-speakers.mark`
- Keeps these UI-only operations out of the public Consumer SDK methods while allowing the local client bridge to type them.

- [ ] **Step 1: Write failing Host dispatch tests**

Verify enum validation, limit clamps, trimmed opaque refs/cursors, bounded world offsets, mutually exclusive speaker selection/new name, and that injected raw fields such as `userId`, `candidateId`, `speakerId`, or `audioFileName` are ignored.

- [ ] **Step 2: Run Host tests and confirm RED**

Run: `pnpm exec vitest run tests/contact-directory-host-api.test.ts tests/unmarked-speaker-host-api.test.ts`

Expected: FAIL because the operations are unknown.

- [ ] **Step 3: Construct and expose the new services**

Instantiate `ContactDirectoryService` and `UnmarkedSpeakerService` in `ArkmeService` with existing source, bot, profile, world, chat, and media owners. Add narrow forwarding methods rather than exposing service objects.

- [ ] **Step 4: Add strict Host dispatch parsing**

Implement dedicated parsers for directory section and mark input. Fail closed on unknown sections or invalid selection mode. Add the operation strings to `ArkmeHostOperation` and the built-in `ArkmeUiOperation`; do not add public SDK convenience methods for this desktop-only surface.

- [ ] **Step 5: Run Host, service, and type tests**

Run: `pnpm exec vitest run tests/contact-directory-host-api.test.ts tests/unmarked-speaker-host-api.test.ts tests/arkme-service.test.ts tests/host-api.test.ts tests/sdk.test.ts && pnpm typecheck`

Expected: PASS; existing public SDK surface remains source-compatible.

- [ ] **Step 6: Prepare gated checkpoint**

Suggested commit message after explicit approval: `feat(contacts): expose directory host operations`

---

### Task 6: Build the five-section directory state model and left pane

**Files:**
- Create: `src/client/redesign/contacts/contact-directory-state.ts`
- Create: `src/client/redesign/contacts/ContactDirectorySurface.tsx`
- Create: `src/client/redesign/contacts/CollapsibleDirectorySection.tsx`
- Create: `src/client/redesign/contacts/AlphabeticalContactList.tsx`
- Create: `tests/contact-directory-state.test.ts`
- Create: `tests/contact-directory-surface.test.tsx`

**Interfaces:**
- `ContactDirectorySurface` emits only contact/unmarked selection changes and group/Bot open results.
- Each section owns `idle | loading | ready | empty | error`, stale data, cursor, total, expanded state, and request generation.
- Selection is explicit:

```ts
export type ArkmeDirectorySelection =
  | { kind: 'none' }
  | { kind: 'contact'; contactRef: string }
  | { kind: 'unmarked-speaker'; candidateRef: string }
```

- [ ] **Step 1: Write failing reducer/state tests**

Test order `groups, bots, unmarked-speakers, teams, contacts`; contacts default expanded; other sections initially collapsed; independent loading/error; first-expand load; cached re-expand; cursor merge/dedup; stale data retention; cursor-stale reset; request generation rejection; removed selected item clearing; and account reset clearing all sensitive state.

- [ ] **Step 2: Run state tests and confirm RED**

Run: `pnpm exec vitest run tests/contact-directory-state.test.ts`

Expected: FAIL because the state module does not exist.

- [ ] **Step 3: Implement the pure state model**

Keep network calls outside the reducer. Every async completion carries `{ section, generation, accountKey }`; ignore a completion unless all three still match. Preserve previous items on refresh failure and attach an inline warning.

- [ ] **Step 4: Write failing component tests**

Test five headings/counts, `aria-expanded`, contacts grouped by letter, retry, load-more, group/Bot row callbacks, contact/unmarked selection semantics, and team rows rendered as non-focusable `<div role="listitem">` without click handlers.

- [ ] **Step 5: Implement directory components**

Use native buttons for section headers and actionable rows. Add `aria-controls`, `aria-current` for selected contact/speaker rows, visible focus styles, and independent inline loading/error/empty rendering. Do not add search, filters, management, or team actions.

- [ ] **Step 6: Run state and component tests**

Run: `pnpm exec vitest run tests/contact-directory-state.test.ts tests/contact-directory-surface.test.tsx`

Expected: PASS, including the negative interaction assertions for team rows.

- [ ] **Step 7: Prepare gated checkpoint**

Suggested commit message after explicit approval: `feat(contacts): build collapsible directory pane`

---

### Task 7: Build contact profile, World, and message detail

**Files:**
- Create: `src/client/redesign/contacts/DirectoryDetailPane.tsx`
- Create: `src/client/redesign/contacts/ContactProfileDetail.tsx`
- Create: `src/client/redesign/contacts/ContactWorldList.tsx`
- Create: `tests/contact-profile-detail.test.tsx`

**Interfaces:**
- `DirectoryDetailPane` renders Logo for `none`, contact content for `contact`, and speaker flow for `unmarked-speaker`.
- Contact profile and World calls run in parallel using only `contactRef`.
- “发消息” calls `directory.contact.open-chat` and passes the returned `source` to the existing chat activation path.

- [ ] **Step 1: Write failing detail tests**

Test Arkme Logo for no selection; profile loading/success/error; World loading/list/true-empty/error/load-more; profile success while World fails; quick A→B selection ignoring A responses; abort on unmount/account change; and message-open success/failure without duplicate submits.

- [ ] **Step 2: Run detail tests and confirm RED**

Run: `pnpm exec vitest run tests/contact-profile-detail.test.tsx`

Expected: FAIL because the detail components do not exist.

- [ ] **Step 3: Implement generation-safe parallel loading**

Create one generation plus separate `AbortController`s for profile and World. Commit each result only when both `generation` and `contactRef` still match. Render the World empty state only after a successful page with `items.length === 0` and `total === 0`.

- [ ] **Step 4: Implement message handoff**

Disable “发消息” only while its request is in flight. On success, clear directory detail selection, activate the returned existing/private source through the same callback used by current chat navigation, and retain error feedback if the open fails.

- [ ] **Step 5: Reuse existing World presentation primitives**

Render `ArkmeWorldFeedItem` image/avatar refs through existing Provider media components. Do not fetch signed media directly and do not duplicate World interaction controls not shown in the prototype.

- [ ] **Step 6: Run focused tests**

Run: `pnpm exec vitest run tests/contact-profile-detail.test.tsx tests/world-surface.test.tsx`

Expected: PASS with independent profile/World states.

- [ ] **Step 7: Prepare gated checkpoint**

Suggested commit message after explicit approval: `feat(contacts): add profile and world detail`

---

### Task 8: Build the inferred-speaker, listen, choose, and mark flow

**Files:**
- Create: `src/client/redesign/contacts/UnmarkedSpeakerDetail.tsx`
- Create: `src/client/redesign/contacts/UnmarkedSpeakerAudioList.tsx`
- Create: `src/client/redesign/contacts/SpeakerChoicePanel.tsx`
- Create: `src/client/redesign/contacts/useSingleAudioPlayback.ts`
- Create: `tests/unmarked-speaker-detail.test.tsx`
- Create: `tests/single-audio-playback.test.tsx`

**Interfaces:**
- Initial view displays inferred speaker and the exact actions “去听声音” and “选择说话人”.
- Audio subview pages through controlled segment refs and allows only one active audio element.
- Choice subview supports recommended/existing manual speakers and a new manual speaker name.
- Mark submits the current `candidateVersion` and shows outcome-specific recovery.

- [ ] **Step 1: Write failing inference-flow tests**

Cover ready/pending/failed/retryable/unavailable inference, existing last-known inference during retry, summary independence, and polling delays `2s × 5`, `5s × 6`, then `10s`, cancelled on candidate/account change.

- [ ] **Step 2: Write failing audio-controller tests**

With a fake `Audio` and `URL`, verify playing B pauses A, toggling the current segment pauses it, `ended/error` reset state, switching candidate/unmounting stops playback and revokes object URLs, and one segment failure does not fail the full detail.

- [ ] **Step 3: Write failing choice/mark tests**

Test recommended item selection, another manual speaker, nonblank bounded new name, disabled submit without a choice, `candidateVersion` forwarding, duplicate-submit prevention, and each result: `marked`, `stale`, `conflict`, `candidate_not_found`, `speaker_not_found`.

- [ ] **Step 4: Run the tests and confirm RED**

Run: `pnpm exec vitest run tests/unmarked-speaker-detail.test.tsx tests/single-audio-playback.test.tsx`

Expected: FAIL because the flow components do not exist.

- [ ] **Step 5: Implement the three explicit subviews**

Keep `summary | audio | choice | success` as a local discriminated state. The summary view must always keep “去听声音” and “选择说话人” available unless the candidate no longer exists. The audio and choice views each have a visible back action to the candidate summary.

- [ ] **Step 6: Implement polling and outcome recovery**

Clamp server `retryAfterMillis` to `1...30s`. On `marked`, show success then request directory refresh. On `stale/conflict`, keep the candidate visible and reload options. On `candidate_not_found`, stop audio, clear selection, and refresh the list. On `speaker_not_found`, remain in choice view and reload choices.

- [ ] **Step 7: Run focused tests**

Run: `pnpm exec vitest run tests/unmarked-speaker-detail.test.tsx tests/single-audio-playback.test.tsx tests/contact-directory-surface.test.tsx`

Expected: PASS; tests assert the confirmed three user-facing actions are present.

- [ ] **Step 8: Prepare gated checkpoint**

Suggested commit message after explicit approval: `feat(speakers): add infer listen and mark UI`

---

### Task 9: Add a sibling Contacts tab without changing the Conversations surface

**Files:**
- Modify: `src/client/ArkmeProductNavigation.tsx`
- Modify: `src/client/ui-controller.ts`
- Modify: `src/client/ArkmePersistentShell.tsx`
- Modify: `src/client/ArkmeSidebar.tsx`
- Modify: `src/client/arkme-auth-flow.tsx`
- Modify: `src/client/redesign/arkme-redesign.css`
- Create: `src/client/redesign/contacts/contacts-tab-store.ts`
- Test: `tests/product-navigation.test.tsx`
- Test: `tests/persistent-shell.test.tsx`
- Test: `tests/contact-directory-production-integration.test.tsx`
- Test: `tests/contact-directory-handoff-integration.test.tsx`
- Test: `tests/contacts-tab-store.test.ts`
- Modify: `tests/redesign-dark-theme.test.ts`

**Interfaces:**
- Contacts is a sibling product-navigation Tab immediately below Conversations; it never mounts inside the conversation tree.
- The existing Conversations `ArkmeNavigation` and `ArkmeSurface` branches remain unchanged and restore their retained source when selected.
- Contacts owns the persistent sidebar/workspace seats only while its product mode is active.
- Group/Bot/contact activation resolves through dedicated Host operations, then crosses the existing `arkmeUi.selectSource` boundary.
- New task, existing conversation, route change, environment/user account change and replacement selection cancel stale Contacts work.

- [x] **Step 1: Write failing production integration tests**

Test the sibling Contacts item immediately below Conversations in product navigation, Logo on no directory selection, workspace switching, group/Bot handoff, team inertness, contact message handoff, selection clearing on existing conversation/new task/route/account changes, and non-chat routes unchanged.

- [x] **Step 2: Run production tests and confirm RED**

Run: `pnpm exec vitest run tests/contact-directory-production-integration.test.tsx`

Expected: FAIL because product navigation does not yet expose the sibling Contacts item.

- [x] **Step 3: Add the sibling product integration**

Add `contacts` as a sibling product mode. The Conversations item remains the default and its existing `ArkmeNavigation`/`ArkmeSurface` branches stay unchanged. The Contacts item switches the middle column to `ContactDirectorySurface` and the workspace to `DirectoryDetailPane`; switching back restores the last conversation source. Do not add source-activation callbacks or Contacts effects to `ArkmeVirtualWorkspace.tsx`. Group/Bot/contact message actions must resolve through their own Host operations and then use the existing `arkmeUi.selectSource` boundary.

- [x] **Step 4: Implement CSS for the approved prototype**

Style the five collapsible sections, A–Z headers, selected rows, centered Logo, two-tier contact pane, World cards/empty state, and speaker subviews. Reuse existing CSS variables. Add `min-width: 0`, bounded scrolling, `overflow-wrap`, visible `:focus-visible`, `prefers-reduced-motion`, dark theme, and narrow-window rules. Do not add unconfirmed search, calls, team detail, or management controls.

- [x] **Step 5: Run production and visual-contract tests**

Run: `pnpm exec vitest run tests/contact-directory-production-integration.test.tsx tests/contact-directory-handoff-integration.test.tsx tests/redesign-dark-theme.test.ts tests/contact-directory-surface.test.tsx tests/contact-profile-detail.test.tsx tests/unmarked-speaker-detail.test.tsx`

Expected: PASS; CSS contract includes dark/narrow/focus rules and no horizontal page overflow.

- [x] **Step 6: Perform browser visual QA**

Run the local plugin development host using the repository’s existing command. Verify the non-mutating states at normal desktop width and the narrowest supported width; cover dark styling and write/audio subflows with isolated automated fixtures rather than mutating real account data:

1. No selection / Arkme Logo.
2. Contact with World content.
3. Contact with true World empty state.
4. Unmarked speaker inference summary.
5. Audio segment lifecycle with isolated fake `Audio`/media refs.
6. Speaker choice and mark outcomes with isolated Host/service fixtures.
7. Team rows with no hover/click affordance through mounted DOM and CSS contracts.

Compare each state against the confirmed low-fidelity prototype and record any intentional spacing-only differences in the execution notes.

- [x] **Step 7: Prepare gated checkpoint**

Suggested commit message after explicit approval: `feat(ui): integrate Arkme contact directory`

---

### Task 10: Full regression, security review, and completion evidence

**Files:**
- Modify only files required by failures found in this task.
- Review: `docs/superpowers/specs/2026-08-23-contact-directory-design.md`
- Review: `docs/superpowers/plans/2026-08-23-contact-directory.md`

**Interfaces:**
- Produces a verified build and a requirement-to-test evidence checklist.
- Does not publish, commit, push, or deploy.

- [x] **Step 1: Run the complete verification gate**

Run: `pnpm test`

Run: `pnpm typecheck`

Run: `pnpm build`

Run: `git diff --check`

Expected: every command exits 0.

- [x] **Step 2: Run a sensitive-field scan**

Run:

```sh
rg -n "accessToken|refreshToken|securityToken|accessKeySecret|signedUrl|objectKey|candidate_id|speaker_id|audio_file_name|targetUserId|peerUserId" \
  src/client/redesign/contacts tests/contact-*.test.tsx tests/unmarked-speaker-*.test.tsx
```

Expected: no production client hit. Test fixtures may contain forbidden raw names only where asserting that Host projections remove them.

- [x] **Step 3: Review every acceptance criterion**

Map all 13 criteria in the design spec to an automated test or a named visual-QA state. Recheck team row semantics in the rendered DOM, mark conflict handling, current-account resets, and the exact visible actions “推测说话人 / 去听声音 / 选择说话人”.

- [x] **Step 4: Review the diff for scope and placeholders**

Run: `git status --short`

Run: `git diff --stat`

Run: `rg -n "TODO|FIXME|placeholder|mock speaker|fake team" src tests`

Expected: only in-scope files changed, no unfinished production placeholders, and the approved spec/plan remain present.

- [x] **Step 5: Prepare the final gated checkpoint**

Report verification commands and visual-QA evidence to the user. If they explicitly authorize a commit, use the repository’s commit-confirmation skill and suggest: `feat(arkme): add contact directory and speaker marking`.
