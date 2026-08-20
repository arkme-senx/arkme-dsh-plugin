# Extension Preview Agent Attachments Implementation Plan

> 后续合同说明：本计划记录初版附件入口的执行过程。当前 Tool 还支持当前 Agent workspace 的唯一相对 `workspace_paths`，并以 Host 维护的两阶段对话确认取代预执行 ACK。准备阶段保存附件授权或路径和内容指纹；后续用户精确确认后重读校验，再只上传尚未存在的内容寻址图片。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `arkme_extension_preview_add` upload one or more images selected in the latest direct user message without requiring `image_ref`, while retaining the existing `image_ref` compatibility path and all security/confirmation rules.

**Architecture:** A focused session-event selector resolves only `ImageAttachmentRef` values from the latest direct user message. A Tool-side batch coordinator pre-reads and validates every selected attachment, checks current gallery capacity, then calls the existing `ArkmeExtensionManager.addPreview()` owner sequentially with stable per-attachment idempotency. The existing Tool remains model-visible in business/hybrid profiles and continues to use DSH `tools/pre-execute` confirmation.

**Tech Stack:** TypeScript, DSH Agent/Session events, `@deepseek-ai/dsh-attachment`, Cordis ToolRuntime, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-20-extension-preview-user-upload-design.md`

## Global Constraints

- Continue in `/Users/apple/hehs/arkme-dsh-plugin-c20260820-bundle-first-market-plan` on `codex/c20260820-extension-center-integration`; verify live HEAD and worktree before every task.
- Preserve `fa10ea8` workspace-icon support. Do not weaken its realpath, symlink, SVG or normalization defenses while editing `src/tools/extensions/index.ts`.
- Do not modify DSH source or `jotmo-extension-publish`; existing single-preview APIs remain authoritative.
- Do not accept absolute/relative file paths, Base64, data URLs, HTTP URLs, object keys, raw bytes or user-supplied attachment ids in the preview Tool.
- The Tool reads only images in the latest direct `source.kind=user` message; it never falls back to older messages or non-user events.
- Accepted media are PNG/JPEG/WebP, at most 5 MiB each, and final gallery size is at most 20.
- `image_ref` remains optional and backward compatible; `image_ref` and `attachment_indices` are mutually exclusive.
- All remote writes still require `explicit-user-write` and a DSH `tools/pre-execute` ask decision.
- Commit only task files. Commit messages include Chinese `功能点:`.

---

### Task 1: Resolve latest-user-message image attachments

**Files:**
- Create: `src/extensions/session-preview-attachments.ts`
- Create: `tests/extensions/session-preview-attachments.test.ts`

**Interfaces:**
- Consumes: `Agent` from `@deepseek-ai/dsh-agent`, `ImageAttachmentRef` from `@deepseek-ai/dsh-attachment`.
- Produces:

```ts
export interface SelectedPreviewAttachment {
  index: number
  ref: ImageAttachmentRef
}

export function selectLatestUserPreviewAttachments(
  agent: Agent,
  attachmentIndices?: readonly number[],
): SelectedPreviewAttachment[]
```

- [ ] **Step 1: Write the selector tests**

Create real session-event fixtures containing:

```ts
const first = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png' as const,
  bytes: 4, width: 1, height: 1, name: 'first.png',
}
const second = {
  attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`),
  mediaType: 'image/webp' as const,
  bytes: 5, width: 1, height: 1, name: 'second.webp',
}
```

Assert these observable behaviors:

- omitted indices return every image from the latest direct user message in content order;
- `[2, 1]` returns second then first;
- an older user message with images is not used when the latest direct user message has none;
- `source.kind=plugin`, assistant messages and tool results are ignored;
- empty, duplicate, zero, negative, non-integer and out-of-range indices throw before returning refs;
- a message with no image throws `the latest direct user message has no image attachments`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/extensions/session-preview-attachments.test.ts
```

Expected: FAIL because `session-preview-attachments.ts` or its exports do not exist.

- [ ] **Step 3: Implement the selector**

Walk `agent.session.events` backwards, stop at the first `user/message` whose `data.source.kind === 'user'`, collect only direct `content` blocks shaped as `{ type: 'image', attachment: ImageAttachmentRef }`, then apply 1-based indices. Copy each returned ref; never expose the session event or other message blocks.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
pnpm exec vitest run tests/extensions/session-preview-attachments.test.ts
pnpm run typecheck
```

Expected: PASS with all selector edges covered.

- [ ] **Step 5: Commit**

```bash
git add src/extensions/session-preview-attachments.ts tests/extensions/session-preview-attachments.test.ts
git commit -m "feat(extensions): 功能点: 解析当前用户预览图附件"
```

### Task 2: Coordinate validated multi-image preview writes

**Files:**
- Create: `src/tools/extensions/preview-attachment-batch.ts`
- Create: `tests/extensions/preview-attachment-batch.test.ts`

**Interfaces:**
- Consumes: `SelectedPreviewAttachment[]`, DSH `AttachmentStore`, and the existing `ArkmeExtensionManager` methods `myList()` and `addPreview()`.
- Produces:

```ts
export interface PreviewAttachmentBatchResult {
  outcome: 'complete' | 'partial'
  extension_id: string
  added_count: number
  preview_images: ArkmeExtensionPreviewItem[]
  preview_revision: number
  failed?: { index: number; message: string }
}

export async function addPreviewAttachmentBatch(input: {
  extensionId: string
  attachments: readonly SelectedPreviewAttachment[]
  store: AttachmentStore
  manager: ArkmeExtensionManager
  signal?: AbortSignal
}): Promise<PreviewAttachmentBatchResult>
```

- [ ] **Step 1: Write zero-write preflight tests**

Using a real `ImageAttachmentRef` fixture and specific fakes, assert:

- target extension missing from `manager.myList()` rejects as not owned;
- existing 19 items plus 2 attachments rejects before `store.readImage()` and `manager.addPreview()`;
- GIF, empty bytes, over-5-MiB bytes and metadata/actual byte mismatch reject before the first add;
- every attachment is read and validated before any add;
- input order is preserved.

- [ ] **Step 2: Write success/idempotency/partial tests**

Assert:

- two valid attachments call `manager.addPreview()` twice in order;
- each idempotency key is a UUID-shaped deterministic value derived from `extensionId + attachmentId`, independent of Tool call id;
- complete output contains only extension id, added count, ordered safe gallery and revision;
- failure on the first add throws;
- failure on the second add returns `outcome='partial'`, `added_count=1`, current safe gallery/revision and `{ index: 2, message }`;
- output JSON never contains attachment ids, names, original data, local paths or URLs.

- [ ] **Step 3: Run tests and verify RED**

```bash
pnpm exec vitest run tests/extensions/preview-attachment-batch.test.ts
```

Expected: FAIL because the coordinator is absent.

- [ ] **Step 4: Implement complete preflight and sequential writes**

Implementation rules:

```ts
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024
const ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/webp'])
```

Read current owner projection once, pre-read every attachment with `store.readImage(ref, signal)`, compare stored ref identity/size to returned bytes, and only then begin sequential manager calls. Construct the UUID from a SHA-256 digest without using a caller-controlled path or name.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
pnpm exec vitest run tests/extensions/preview-attachment-batch.test.ts
pnpm run typecheck
```

Expected: PASS; the zero-write tests prove validation happens before the first remote call.

- [ ] **Step 6: Commit**

```bash
git add src/tools/extensions/preview-attachment-batch.ts tests/extensions/preview-attachment-batch.test.ts
git commit -m "feat(extensions): 功能点: 批量上传会话预览图附件"
```

### Task 3: Extend the model Tool and confirmation contract

**Files:**
- Modify: `src/tools/extensions/index.ts`
- Modify: `tests/extensions/tools.test.ts`
- Modify: `tests/extensions/tools-runtime.test.ts`

**Interfaces:**
- Consumes: `selectLatestUserPreviewAttachments()` from Task 1 and `addPreviewAttachmentBatch()` from Task 2.
- Produces: backward-compatible `arkme_extension_preview_add` schema with optional `image_ref` and optional `attachment_indices`.

- [ ] **Step 1: Add failing Tool schema tests**

Assert the materialized Tool schema equals:

```ts
{
  type: 'object',
  properties: {
    extension_id: expect.objectContaining({ type: 'string' }),
    image_ref: expect.objectContaining({ type: 'string' }),
    attachment_indices: expect.objectContaining({ type: 'array', items: { type: 'integer' } }),
  },
  required: ['extension_id'],
}
```

Keep the existing `image_ref` execution test and add latest-user-message attachment execution through a real `Context`, ToolRuntime, AttachmentStore fake and Agent session.

- [ ] **Step 2: Add failing source-validation tests**

Assert:

- `image_ref` plus `attachment_indices` rejects;
- neither source uses the latest direct user message attachments;
- no attachment service fails only for the attachment branch;
- `image_ref` still calls `imageSource.readImage()` and never reads DSH attachments;
- attachment branch never calls `imageSource.readImage()`.

- [ ] **Step 3: Add failing confirmation tests**

Extend `tools/pre-execute` assertions:

```text
确认把当前消息选择的 2 张图片添加到扩展 ext-1 的预览图集吗？
```

For `image_ref`, preserve the existing single-image question. Invalid indices must return a Tool validation error before approval is presented.

- [ ] **Step 4: Run tests and verify RED**

```bash
pnpm exec vitest run tests/extensions/tools.test.ts tests/extensions/tools-runtime.test.ts
```

Expected: FAIL because `image_ref` is still required and attachments are not read.

- [ ] **Step 5: Implement the additive Tool contract**

Keep the current `registerArkmeExtensionTools()` public signature. In the Tool execute function:

```ts
const imageRef = clean(args.image_ref)
const indices = Array.isArray(args.attachment_indices) ? args.attachment_indices : undefined
if (imageRef !== '' && indices !== undefined) throw new Error('image_ref and attachment_indices are mutually exclusive')
```

Route non-empty `image_ref` through the existing single-image manager path. Otherwise require the real Agent and `ctx.get('attachments')`, select latest-message refs, then call the batch coordinator. Update the Tool description and authoring prompt to tell the model to use current user attachments without searching files or old messages.

- [ ] **Step 6: Implement exact pre-execute questions**

The guard uses the same selector helper and arguments as execution so the confirmed count cannot drift. It must never read attachment bytes or call the preview backend before confirmation.

- [ ] **Step 7: Run Tool/runtime tests**

```bash
pnpm exec vitest run tests/extensions/tools.test.ts tests/extensions/tools-runtime.test.ts tests/extensions/session-preview-attachments.test.ts tests/extensions/preview-attachment-batch.test.ts
pnpm run typecheck
```

Expected: PASS; business ToolRuntime schemas include add/delete/reorder and attachment add executes only after the ask decision.

- [ ] **Step 8: Commit**

```bash
git add src/tools/extensions/index.ts tests/extensions/tools.test.ts tests/extensions/tools-runtime.test.ts
git commit -m "feat(tools): 功能点: 允许用户附件上传扩展预览图"
```

### Task 4: Document and verify real DSH Tool behavior

**Files:**
- Modify: `docs/tool-registry.md`
- Modify: `docs/extension-market-controls.md`
- Modify: `docs/consumer-plugin-contract.md`

**Interfaces:**
- Consumes: final Tool schema and result types from Tasks 1-3.
- Produces: user/consumer contract that distinguishes user attachments, Arkme image refs and forbidden paths.

- [ ] **Step 1: Update contract documentation**

Document the exact defaults, 1-based indices, latest-direct-user-message boundary, batch limits, partial result and confirmation. Keep workspace icon upload documented separately; preview attachments do not authorize `workspace_path`.

- [ ] **Step 2: Run all Tool and preview tests**

```bash
pnpm exec vitest run tests/extensions/tools.test.ts tests/extensions/tools-runtime.test.ts tests/extensions/preview.test.ts tests/extensions/preview-routes.test.ts tests/extensions/session-preview-attachments.test.ts tests/extensions/preview-attachment-batch.test.ts
```

Expected: PASS.

- [ ] **Step 3: Verify in an unchanged DSH session**

Build an immutable plugin tgz, install it into a fresh temporary `DSH_HOME`, start a business-profile DSH, and create a dedicated test extension on the test backend. In one direct user message attach two small PNG/WebP files and ask the Agent to add both. Verify:

- the real request tool catalog contains `arkme_extension_preview_add` with optional `image_ref`;
- pre-execute asks for exactly 2 images;
- approval produces `outcome=complete`, `added_count=2` and no attachment/storage identifiers;
- `arkme_extension_list_mine` returns the two ordered safe refs;
- no arbitrary path is accepted.

Do not run the write E2E against production without a separate explicit authorization.

- [ ] **Step 4: Commit docs**

```bash
git add docs/tool-registry.md docs/extension-market-controls.md docs/consumer-plugin-contract.md
git commit -m "docs(extensions): 功能点: 说明用户附件预览图合同"
```
