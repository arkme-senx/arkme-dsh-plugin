# Extension Preview Editor Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add staged local multi-image selection, deletion and accessible ordering to “编辑扩展”, then save preview changes through the existing SDK/Host owner with revision-safe recovery.

**Architecture:** A pure draft model represents remote preview refs and local `File` items without performing writes. A focused React field owns file-picker/object-URL/drag UI and emits complete staged order. The existing edit workflow coordinates metadata, icon, preview deletes, uploads and final reorder through Browser SDK adapters, carrying each returned revision forward and reconciling partial failure.

**Tech Stack:** React 18, TypeScript, Browser `File`/object URLs, existing Arkme Browser SDK, Vitest SSR and pure workflow tests.

**Spec:** `docs/superpowers/specs/2026-08-20-extension-preview-user-upload-design.md`

## Global Constraints

- Continue in `/Users/apple/hehs/arkme-dsh-plugin-c20260820-bundle-first-market-plan`; verify current HEAD and clean ownership before touching shared edit files.
- Reuse `ArkmeSdk.addExtensionPreview()`, `deleteExtensionPreview()` and `reorderExtensionPreviews()`; do not call registry or signed URLs from React.
- Accept only PNG/JPEG/WebP `File` objects, each 1..5 MiB, with a final maximum of 20 entries.
- Unpublished items cannot select preview files. Cancel produces zero preview writes.
- Remote deletion and reorder use the newest returned `preview_revision`; revision conflict stops and refreshes instead of overwriting.
- Object URLs are revoked on removal, replacement and unmount. Local paths never enter state, logs, output or docs.
- Drag sorting must have equivalent move-before/move-after buttons and accessible labels.
- Preserve existing metadata/icon partial-success behavior and current avatar crop flow.
- Do not modify DSH or backend code.
- Commit only task files. Commit messages include Chinese `功能点:`.

---

### Task 1: Build the pure staged preview draft model

**Files:**
- Create: `src/client/extension-preview-edit.ts`
- Create: `tests/extensions/extension-preview-edit.test.ts`

**Interfaces:**
- Produces:

```ts
export type ExtensionPreviewDraftItem =
  | { kind: 'remote'; id: string; preview: ArkmeExtensionPreviewItem }
  | { kind: 'local'; id: string; file: File; mutationId: string }

export interface ExtensionPreviewDraft {
  revision: number
  initialRemoteRefs: string[]
  items: ExtensionPreviewDraftItem[]
}

export function createExtensionPreviewDraft(
  previews: readonly ArkmeExtensionPreviewItem[],
  revision: number,
): ExtensionPreviewDraft

export function appendExtensionPreviewFiles(
  draft: ExtensionPreviewDraft,
  files: readonly File[],
  createId: () => string,
  createMutationId: () => string,
): ExtensionPreviewDraft

export function removeExtensionPreviewDraftItem(draft: ExtensionPreviewDraft, id: string): ExtensionPreviewDraft
export function moveExtensionPreviewDraftItem(draft: ExtensionPreviewDraft, id: string, targetIndex: number): ExtensionPreviewDraft

export interface ExtensionPreviewObjectUrlRegistry {
  urlFor(id: string, file: File): string
  retain(ids: ReadonlySet<string>): void
  dispose(): void
}

export function createExtensionPreviewObjectUrlRegistry(
  createUrl?: (file: File) => string,
  revokeUrl?: (url: string) => void,
): ExtensionPreviewObjectUrlRegistry
```

- [ ] **Step 1: Write draft initialization and validation tests**

Assert remote order/revision preservation, PNG/JPEG/WebP acceptance, zero-byte/over-5-MiB/unsupported type rejection, whole-batch rejection above 20, and stable local ids/mutation UUIDs. Test the object-URL registry with injected create/revoke functions: one URL per local id, `retain()` revokes removed ids, and `dispose()` revokes every remaining URL exactly once.

- [ ] **Step 2: Write deletion and ordering tests**

Assert removing local/remote items, deleting all items, moving first/middle/last, clamping/rejecting invalid indices, preserving unique ids and marking the first resulting item as the eventual cover by order.

- [ ] **Step 3: Run tests and verify RED**

```bash
pnpm exec vitest run tests/extensions/extension-preview-edit.test.ts
```

Expected: FAIL because the draft module is absent.

- [ ] **Step 4: Implement immutable draft helpers**

Keep all functions free of React, object URLs and network calls. Error messages must identify unsupported type, empty file, 5 MiB limit or 20-item limit so the UI can render them directly.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
pnpm exec vitest run tests/extensions/extension-preview-edit.test.ts
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/client/extension-preview-edit.ts tests/extensions/extension-preview-edit.test.ts
git commit -m "feat(extensions): 功能点: 建立预览图编辑草稿模型"
```

### Task 2: Add the accessible multi-file preview field

**Files:**
- Create: `src/client/ArkmeExtensionPreviewField.tsx`
- Create: `tests/extensions/extension-preview-field.test.tsx`
- Modify: `src/client/ArkmeExtensionEditDialog.tsx`

**Interfaces:**
- Consumes: `ExtensionPreviewDraft` and immutable helpers from Task 1.
- Produces:

```ts
export function ArkmeExtensionPreviewField(props: {
  extensionId?: string
  draft: ExtensionPreviewDraft
  disabled: boolean
  onChange(draft: ExtensionPreviewDraft): void
  createId(): string
  createMutationId(): string
}): ReactNode
```

`ArkmeExtensionEditFormValue` gains `previewDraft: ExtensionPreviewDraft`.

- [ ] **Step 1: Write SSR structure tests**

Assert:

- published extension renders “扩展预览图”, a multiple file input with `accept="image/png,image/jpeg,image/webp"`, current images through the same-origin route and an add button;
- unpublished extension renders “发布后可上传预览图” and no enabled file input;
- first item has “封面”; every item has delete, move-forward and move-back accessible names;
- local items render browser object URLs, never file paths.

- [ ] **Step 2: Write input and staged-interaction behavior tests**

Use SSR to verify the exact multiple file-input contract and accessible controls. Exercise file validation, remove and ordering through the real Task 1 draft helpers; object URL creation/revocation is already owned and tested by `ExtensionPreviewObjectUrlRegistry`. Reserve native file-input reset and drag-event behavior for the real browser E2E in Task 5 instead of adding a DOM-emulator dependency.

- [ ] **Step 3: Run tests and verify RED**

```bash
pnpm exec vitest run tests/extensions/extension-preview-field.test.tsx
```

Expected: FAIL because the field is absent.

- [ ] **Step 4: Implement the field**

Use a horizontal/compact thumbnail grid within the existing 430px edit dialog. Keep one `ExtensionPreviewObjectUrlRegistry` in a ref, call `retain()` after draft changes, and call `dispose()` on unmount. Drag events reorder by item id; visible move buttons perform the same immutable operation. After reading a file selection, reset the native input value so the same file can be selected again after removal.

- [ ] **Step 5: Integrate staged state into the dialog**

Initialize once from:

```ts
createExtensionPreviewDraft(
  item.published?.previewImages ?? [],
  item.published?.previewRevision ?? 0,
)
```

Place the preview field after `ArkmeExtensionAvatarField` and before name. Submit the complete draft; Cancel only closes.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
pnpm exec vitest run tests/extensions/extension-preview-field.test.tsx tests/extensions/extension-center.test.tsx
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/client/ArkmeExtensionPreviewField.tsx src/client/ArkmeExtensionEditDialog.tsx tests/extensions/extension-preview-field.test.tsx
git commit -m "feat(extensions): 功能点: 编辑页支持多选预览图"
```

### Task 3: Implement revision-safe preview save orchestration

**Files:**
- Modify: `src/client/extension-edit-flow.ts`
- Modify: `tests/extensions/extension-edit-flow.test.ts`

**Interfaces:**
- Consumes: `ExtensionPreviewDraft` from Task 1 and existing `ArkmeExtensionEditFormValue`.
- Extends dependencies:

```ts
addPreview(extensionId: string, file: File, mutationId: string): Promise<ArkmeExtensionPreviewGallery>
deletePreview(extensionId: string, previewRef: string, revision: number): Promise<ArkmeExtensionPreviewGallery>
reorderPreviews(extensionId: string, orderedRefs: string[], revision: number): Promise<ArkmeExtensionPreviewGallery>
```

- Extends save results:

```ts
type ExtensionEditSaveResult =
  | { kind: 'saved'; extension: ArkmeExtensionCatalogItem; icon?: ArkmeExtensionIconResult; previews?: ArkmeExtensionPreviewGallery }
  | { kind: 'metadata-saved-icon-failed'; extension: ArkmeExtensionCatalogItem; error: string }
  | { kind: 'profile-saved-preview-failed'; extension: ArkmeExtensionCatalogItem; icon?: ArkmeExtensionIconResult; previews?: ArkmeExtensionPreviewGallery; error: string }
```

- [ ] **Step 1: Write no-change and ordered-success tests**

Assert zero preview calls when draft equals initial refs, then assert exact call order/revision chain for:

```text
delete removed refs -> upload local files in staged order -> reorder final refs
```

Use literal refs/revisions and stable mutation ids. Verify a final empty gallery skips reorder.

- [ ] **Step 2: Write partial-failure and conflict tests**

Cover metadata-only, icon-only, preview-only and combined saves. Assert metadata/icon success is retained when preview delete/add/reorder fails; latest successful gallery is returned; no later operation runs after revision conflict; local mutation ids are reused on retry.

- [ ] **Step 3: Run tests and verify RED**

```bash
pnpm exec vitest run tests/extensions/extension-edit-flow.test.ts
```

Expected: FAIL because `previewDraft` and preview dependencies are not consumed.

- [ ] **Step 4: Implement preview reconciliation**

Build a map from each remote/local draft id to its final preview ref. Carry the gallery returned by every mutation. Compute final refs from the staged order only after every successful local upload. Reorder only when the server order differs; never synthesize a revision.

- [ ] **Step 5: Preserve existing result semantics**

Do not change the current rule: an icon-only failure throws, while metadata-saved/icon-failed returns its existing partial kind. Preview failure returns the new partial kind when metadata or icon or a preview mutation succeeded; if nothing changed remotely, throw the original error.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
pnpm exec vitest run tests/extensions/extension-edit-flow.test.ts tests/extensions/sdk.test.ts
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/client/extension-edit-flow.ts tests/extensions/extension-edit-flow.test.ts
git commit -m "feat(extensions): 功能点: 串联预览图保存与冲突恢复"
```

### Task 4: Wire SDK adapters and refresh unified projections

**Files:**
- Modify: `src/client/ArkmeExtensionCenter.tsx`
- Modify: `src/client/extension-edit-flow.ts`
- Modify: `src/extensions/owned-types.ts` only if the current published projection lacks fields
- Modify: `tests/extensions/extension-center.test.tsx`
- Modify: `tests/extensions/extension-edit-flow.test.ts`

**Interfaces:**
- Consumes: field/form/save results from Tasks 1-3 and existing SDK methods.
- Produces: refreshed `myExtensions`, `publishedItems`, `discoverItems` and open detail gallery using one server-confirmed preview projection.

- [ ] **Step 1: Write integration projection tests**

Assert `applyEditedMyExtension()` copies `preview_images` and `preview_revision` into `published.previewImages/previewRevision`, and the center provides exact SDK adapters with stable mutation ids.

- [ ] **Step 2: Write UI outcome tests**

Assert complete success closes the dialog and shows `扩展信息已更新。`; preview partial keeps the dialog open, shows `资料已保存，但预览图更新未完成：...`, refreshes mine, and does not claim completion. Revision conflict uses a specific refresh/reconfirm message.

- [ ] **Step 3: Run tests and verify RED**

```bash
pnpm exec vitest run tests/extensions/extension-center.test.tsx tests/extensions/extension-edit-flow.test.ts
```

Expected: FAIL because the center only wires metadata/icon today.

- [ ] **Step 4: Wire existing SDK methods**

Use:

```ts
extensionSdk.addExtensionPreview(extensionId, file, { clientMutationId: mutationId })
extensionSdk.deleteExtensionPreview(extensionId, previewRef, revision)
extensionSdk.reorderExtensionPreviews(extensionId, refs, revision)
```

After any preview write outcome, call `load('mine', 'refresh')`; update open detail only from returned/refreshed server facts.

- [ ] **Step 5: Run integration tests and typecheck**

```bash
pnpm exec vitest run tests/extensions/extension-center.test.tsx tests/extensions/extension-edit-flow.test.ts tests/extensions/extension-preview-field.test.tsx
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/client/ArkmeExtensionCenter.tsx src/client/extension-edit-flow.ts src/extensions/owned-types.ts tests/extensions/extension-center.test.tsx tests/extensions/extension-edit-flow.test.ts
git commit -m "feat(extensions): 功能点: 接入预览图编辑保存流程"
```

### Task 5: Full gates, immutable package and test-environment E2E

**Files:**
- Modify only if a demonstrated preview-management defect requires it: files from Tasks 1-4.
- Modify: `docs/extension-market-controls.md`
- Modify: `docs/consumer-plugin-contract.md`

**Interfaces:**
- Consumes: completed editor workflow.
- Produces: immutable tgz and real DSH/UI acceptance evidence.

- [ ] **Step 1: Run all repository gates**

```bash
pnpm test
pnpm run typecheck
pnpm run build
pnpm run verify:call-assets
pnpm pack --dry-run
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 2: Build an exact committed tgz**

Use a detached temporary worktree at the final editor commit, `pnpm install --frozen-lockfile`, then `pnpm pack`. Inspect the tarball for client bundle/types and reject `link:` dependencies or temporary paths.

- [ ] **Step 3: Install in a fresh test DSH profile**

Use the official unmodified DSH CLI and a new temporary `DSH_HOME`; install the exact tgz, configure the test backend overlay, and start on an unused loopback port. Do not reuse the production-validation profile.

- [ ] **Step 4: Exercise the complete editor workflow on test**

For a dedicated owned extension:

- select 2 local files in one picker action;
- add a third file, delete one remote image, drag one image to index 0, and save;
- verify progress/disabled states and that Cancel in a second edit makes zero writes;
- close/reopen the market and confirm detail uses the server order and same-origin image route;
- provoke a stale revision and confirm refresh/reconfirm behavior;
- verify no signed URL, local path or object URL survives in API/UI state.

- [ ] **Step 5: Update documentation and commit**

Update built-in UI coverage from read-only gallery to add/delete/reorder management while keeping Tool and SDK contracts distinct.

```bash
git add docs/extension-market-controls.md docs/consumer-plugin-contract.md
git commit -m "docs(extensions): 功能点: 说明预览图编辑管理流程"
```

- [ ] **Step 6: Preserve the current formal-environment page**

After test E2E, reinstall the final tgz into the currently authorized 52909 production-validation temporary Profile without writing production preview data. Leave 52909 running and report that real production gallery-write validation remains unexecuted unless explicitly authorized.
