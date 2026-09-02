# Quick Note Detail Extension Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a quick note's extensions in its detail drawer and make a newly sent detail-drawer extension immediately appear and remain in the active chat or topic.

**Architecture:** The detail drawer reads the existing `source.message-extension.context` owner API and renders its `extensions` using the same rich-content primitives as normal records. `DetailExtensionComposer` returns the canonical `ArkmeSourceMessageExtendResult`; the conversation surface projects that result into its current timeline, stores it in the conversation cache, and then refreshes from the server. Topic-owned extensions use the desktop topic extension endpoint instead of the generic record endpoint.

**Tech Stack:** TypeScript 6, React 18, Vitest, react-test-renderer, Arkme owner APIs.

**Spec:** User-confirmed low-fidelity prototype in the current Codex task (2026-08-31).

## Global Constraints

- Modify only `/Users/zhou/Desktop/project/jotmo/worktree/v134`.
- Preserve the existing compact footer and arrow send control.
- Detail-drawer extensions continue to support text and attachments.
- Do not discard or rewrite unrelated dirty-worktree changes.
- Do not render an extension loading label or an inline composer error row.
- Report extension composer failures through the existing conversation toast.
- For private and group chat, resolve selectable extension identities through `/api/v1/chats/extensions/tree/page`.
- Match the desktop extension input spacing and 28px send control, while retaining the existing upward-arrow glyph.

---

### Task 1: Detail drawer extension context

**Files:**
- Modify: `src/client/ArkmeNoteDetails.tsx`
- Test: `tests/related-quick-notes-drawer.test.tsx`

**Interfaces:**
- Consumes: `callArkme<ArkmeSourceMessageExtensionContext>('source.message-extension.context', { sourceRef, messageActionRef }, signal)`.
- Produces: a desktop-style `共 N 条延展` section and `onExtensionSent(result: ArkmeSourceMessageExtendResult)` callback.

- [ ] **Step 1: Write the failing tests**

Add one test that returns a literal extension context and asserts the drawer renders its count, author, timestamp, text, and attachment content. Add a second test that sends through the footer and asserts the canonical result is inserted immediately and passed to the parent callback.

- [ ] **Step 2: Run tests to verify RED**

Run: `pnpm test -- tests/related-quick-notes-drawer.test.tsx`

Expected: FAIL because the drawer does not request or render extension context and `onExtensionSent` does not exist.

- [ ] **Step 3: Implement the minimal drawer behavior**

Add a cancellable context loader keyed by `sourceRef + messageActionRef`, explicit loading/error/success state, rich-content rows, and result-first optimistic insertion followed by context reload. Change the composer callback from `() => void` to `(result: ArkmeSourceMessageExtendResult) => void`.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `pnpm test -- tests/related-quick-notes-drawer.test.tsx`

Expected: PASS.

### Task 2: Current chat/topic projection after drawer send

**Files:**
- Modify: `src/client/ArkmeSidebar.tsx`
- Test: `tests/conversation-send-directory.test.tsx`

**Interfaces:**
- Consumes: `ArkmeSourceMessageExtendResult` and the currently opened parent `ArkmeTimelineItem`.
- Produces: an `ArkmeTimelineItem` with `extensionParentRecordUid`, `extensionParent`, status, sequence, and content projected into both React state and the current conversation cache.

- [ ] **Step 1: Write the failing test**

Open a record detail, send an extension, and assert the active conversation immediately renders a single compound extension message with the parent preview and child content after the owner API resolves.

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm test -- tests/conversation-send-directory.test.tsx`

Expected: FAIL because the drawer currently reloads unrelated notes and never notifies the conversation.

- [ ] **Step 3: Implement the minimal projection**

Pass `onExtensionSent` from `ArkmeSidebar` to the drawer. Build the canonical optimistic child from the returned extension, merge it into the current timeline and cache, invalidate the directory, and refresh `source.timeline` so durable server data replaces the optimistic projection.

- [ ] **Step 4: Run test to verify GREEN**

Run: `pnpm test -- tests/conversation-send-directory.test.tsx`

Expected: PASS.

### Task 3: Topic extension routing

**Files:**
- Modify: `src/services/chat-service.ts`
- Test: `tests/services/chat-service.test.ts`

**Interfaces:**
- Consumes: an opened `topic` source, parent record UID, child record UID, text, and uploaded assets.
- Produces: POST `/api/v1/topics/records/extensions/create` with `topic_uid`, `parent_record_uid`, child record payload, and attachment content payload.

- [ ] **Step 1: Write the failing service test**

Use a literal topic source fixture and assert the exact topic endpoint and payload, including media refs, and assert `RecordService.createExtensionForConversation` is not called.

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm test -- tests/services/chat-service.test.ts`

Expected: FAIL because topic currently shares `/api/v1/records/extensions/create`.

- [ ] **Step 3: Implement the topic branch**

Call the topic extension endpoint directly, validate the returned record and parent identities, invalidate the record projection, and return the same `ArkmeSourceMessageExtendResult` shape used by chat and send-to-self.

- [ ] **Step 4: Run test to verify GREEN**

Run: `pnpm test -- tests/services/chat-service.test.ts`

Expected: PASS.

### Task 4: Regression verification and client restart

**Files:**
- Verify only: all modified source and test files.

**Interfaces:**
- Consumes: the completed feature changes.
- Produces: a passing plugin build and a restarted Arkme Harness client using the latest plugin output.

- [ ] **Step 1: Run focused tests**

Run the three focused Vitest files from Tasks 1–3.

- [ ] **Step 2: Run static verification**

Run: `pnpm typecheck`

- [ ] **Step 3: Run the full plugin suite**

Run: `pnpm test`

- [ ] **Step 4: Build and restart the configured Harness client**

Use the existing client scripts under `/Users/zhou/Desktop/project/jotmo/worktree/v134/arkme-dsh-client`; do not create a temporary runtime workspace.

### Task 5: Selected chat extension identity and desktop detail feedback

**Files:**
- Modify: `src/services/chat-service.ts`
- Modify: `src/client/ArkmeNoteDetails.tsx`
- Modify: `src/client/ArkmeSidebar.tsx`
- Test: `tests/services/chat-service.test.ts`
- Test: `tests/related-quick-notes-drawer.test.tsx`

**Interfaces:**
- Consumes: the chat extension tree edge fields `child_record_uid` and `child_record_owner_user_id`.
- Produces: durable selected-parent identity for `/api/v1/chats/extensions/children/create`, silent extension loading, toast-only failures, and the confirmed compact input layout.

- [ ] **Step 1: Write failing regression tests**

Assert that chat detail reads `/api/v1/chats/extensions/tree/page`, selected-child send uses the edge owner, loading text stays hidden, errors reach `onToast` without an inline alert, and the input uses 16px outer horizontal padding with 18px/28px controls.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `pnpm test -- tests/services/chat-service.test.ts tests/related-quick-notes-drawer.test.tsx`

Expected: FAIL on the public-record endpoint, inline loading/error UI, missing toast callback, and stale input dimensions.

- [ ] **Step 3: Implement the minimal fix**

Parse direct chat extension children from their durable edge and hydrated item, use that context for both detail loading and selected-target validation, route composer failures to the sidebar toast, and align footer dimensions with `DesktopRecordExtensionInput` without restoring the removed separator.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run: `pnpm test -- tests/services/chat-service.test.ts tests/related-quick-notes-drawer.test.tsx`

Expected: PASS.
