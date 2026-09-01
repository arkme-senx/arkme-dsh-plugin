# Extension Parent Locate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match the desktop quick-note detail composer and let an extension parent preview locate its original quick note even when the target is outside the loaded chat pages.

**Architecture:** Keep the existing drawer and timeline components, but make their boundaries match the desktop contracts. Add a viewer-bound chat timeline-around host operation, replace the visible timeline with the returned continuous window for deep locates, retain older/newer cursors, and reuse the existing centered highlight behavior.

**Tech Stack:** React 18, TypeScript, Vitest, Arkme Host RPC, Jotmo chat timeline APIs.

**Spec:** User-confirmed low-fidelity prototype in the 2026-09-01 task conversation.

## Global Constraints

- Work only in `/Users/zhou/Desktop/project/jotmo/worktree/v134`.
- Do not create another worktree.
- Restore the quick-note detail footer divider.
- Use the desktop composer background colors: light `#F6F6F6`, dark `#2B2B2B`.
- Keep the existing upward-arrow send control.
- Locate failures use Toast and must not replace the current timeline window.
- Do not create a git commit unless the user requests one separately.

---

### Task 1: Desktop quick-note detail composer

**Files:**
- Modify: `src/client/ArkmeNoteDetails.tsx`
- Test: `tests/related-quick-notes-drawer.test.tsx`

**Interfaces:**
- Consumes: existing `DetailExtensionComposer` props and attachment behavior.
- Produces: a 44px empty composer shell inside a 12px vertical/16px horizontal footer with a 0.5px divider and desktop surface color.

- [ ] Add a failing renderer test that checks the divider, explicit desktop surface color, and compact one-line geometry.
- [ ] Run the focused Vitest file and verify it fails on the missing divider/background contract.
- [ ] Change only the composer presentation structure and styles needed by the test.
- [ ] Run the focused test and verify it passes.

### Task 2: Timeline-around host boundary

**Files:**
- Modify: `src/types.ts`
- Modify: `src/services/chat-service.ts`
- Modify: `src/host-api.ts`
- Modify: `src/sdk/index.ts`
- Test: `tests/services/chat-service.test.ts`
- Test: `tests/host-api.test.ts`
- Test: `tests/sdk.test.ts`

**Interfaces:**
- Consumes: `sourceRef`, `recordUid`, `recordOwnerUserId`, `beforeLimit`, and `afterLimit`.
- Produces: `ArkmeTimelineAroundPage` containing a continuous target window, anchor UID, older/newer cursors, and latest known sequence.

- [ ] Add failing service tests for `/api/v1/chat/timeline/around` projection and parent owner identity retention.
- [ ] Add failing host and SDK boundary tests for `source.timeline-around`.
- [ ] Run the focused tests and verify the new operation is missing.
- [ ] Implement the minimum type, service, host, and SDK boundary.
- [ ] Re-run the focused tests and verify they pass.

### Task 3: Parent-preview locate and continuous paging

**Files:**
- Modify: `src/client/conversation-memory-cache.ts`
- Modify: `src/client/ui-controller.ts`
- Modify: `src/client/ArkmeSidebar.tsx`
- Test: `tests/conversation-memory-cache.test.ts`
- Test: `tests/ui-controller.test.ts`
- Test: `tests/conversation-send-directory.test.tsx`

**Interfaces:**
- Consumes: `ArkmeTimelineExtensionParent.recordOwnerUserId` and `source.timeline-around`.
- Produces: clickable extension parent previews, centered/highlighted target rows, stable replacement of the active timeline window, and older/newer continuation.

- [ ] Add failing tests for a loaded parent click, a missing parent around read, deduplicated locate, and Toast-only failure.
- [ ] Add failing cache tests for retaining older/newer window cursors.
- [ ] Run the focused tests and verify the click/around behavior is absent.
- [ ] Implement the clickable preview and locate state machine with stale-response cancellation.
- [ ] Implement older and newer continuation from the around window.
- [ ] Re-run the focused tests and verify they pass.

### Task 4: Verification and runtime handoff

**Files:**
- Verify all modified files above.
- Runtime: `/Users/zhou/Desktop/project/jotmo/worktree/v134/arkme-dsh-client`

**Interfaces:**
- Consumes: the completed plugin build.
- Produces: a running test-environment Harness client using the latest local plugin code.

- [ ] Run all focused tests for composer, service, host, SDK, cache, controller, and conversation UI.
- [ ] Run `pnpm test`, `pnpm typecheck`, and `pnpm build`.
- [ ] Inspect the final diff for unrelated changes and preserve all pre-existing user modifications.
- [ ] Restart the Harness client in the test environment and verify the process stays running.

### Task 5: Atomic around-window navigation

**Files:**
- Modify: `src/client/conversation-memory-cache.ts`
- Modify: `src/client/ArkmeSidebar.tsx`
- Test: `tests/conversation-send-directory.test.tsx`

**Interfaces:**
- Consumes: `ArkmeTimelineAroundPage`, retained realtime timeline deltas, `olderCursor`, and `newerCursor`.
- Produces: an explicit `latest | around` client timeline mode, first-click layout-complete target positioning, and an isolated continuous bidirectional window while browsing target history.

- [x] Add a failing renderer test where a retained latest realtime item exists before `source.timeline-around` resolves; verify the first click replaces the list with only the continuous around window and scrolls the target once the row exists.
- [x] Add a failing renderer test that fires the newer sentinel from an around window; verify `source.timeline` is called with `afterSequence` and only the returned contiguous newer page is appended.
- [x] Run the focused tests and verify they fail because the current view has no around mode and blindly merges retained realtime delta items.
- [x] Extend `ArkmeConversationTimelineSnapshot` and the active timeline view with `mode: 'latest' | 'around'`, preserving the mode and both cursors in cache updates.
- [x] When an around response succeeds, atomically install its items/cursors, clear ordinary viewport restoration, and queue the target UID for a layout-phase centered locate before consuming the target.
- [x] While mode is `around`, ignore realtime items outside the loaded sequence interval; continue older/newer paging with the page cursors and switch to `latest` only after newer paging reports the live edge.
- [x] Re-run the focused tests and verify both first-click positioning and bidirectional continuity pass.
- [x] Run the full test suite, typecheck, and build, then restart the test-environment Harness client from the existing `v134` workspace.

### Task 6: Around-window concurrency hardening

**Files:**
- Modify: `src/client/conversation-memory-cache.ts`
- Modify: `src/client/ArkmeSidebar.tsx`
- Test: `tests/conversation-memory-cache.test.ts`
- Test: `tests/conversation-send-directory.test.tsx`

**Interfaces:**
- Consumes: background latest refreshes, simultaneous older/newer pages, local projections, and retained realtime deltas.
- Produces: a window revision guard, per-direction request cancellation, and a server-maintained around sequence range.

- [x] Add regressions for a stale latest response arriving after around installation, simultaneous older/newer paging, and optimistic items outside the around range.
- [x] Replace the shared pagination abort controller with per-direction request slots and invalidate old window responses when the active window changes.
- [x] Persist an explicit around sequence range and update it only from authoritative around/pagination responses.
- [x] Filter realtime deltas with the explicit range rather than the dynamically merged item minimum/maximum.
- [x] Re-run focused typecheck and conversation/cache regressions.
- [x] Run the complete test suite, typecheck, build, diff checks, and restart the test-environment Harness client.
