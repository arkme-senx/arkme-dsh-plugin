# Extension Market Discovery and Edit Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the current user’s private published extensions in Discover and replace standalone avatar upload with a Bot-style metadata editor backed by Host, SDK, and Tool contracts.

**Architecture:** The Arkme Host remains the only Browser-to-registry adapter. The Client merges public catalog and owner list projections, while a focused edit-flow module sequences metadata then icon writes and reports partial success; the same manager method backs the UI Host operation, public SDK, and confirmed model Tool.

**Tech Stack:** TypeScript, React 18, Cordis/DSH Host API, Vitest, existing Arkme SDK and extension manager.

**Spec:** `docs/superpowers/specs/2026-08-20-extension-market-discovery-and-edit-design.md`

## Global Constraints

- Continue on `codex/c20260820-extension-center-integration` from the current clean head; do not rebase or modify DSH source.
- Backend metadata implementation and test deployment from `2026-08-20-extension-metadata-backend.md` must exist before live edit acceptance.
- Discover is public catalog plus the current owner’s private/public items, deduplicated by `extension_id`; historical unlisted stays out of Discover.
- Opening the market, changing tabs, clicking the active tab, publishing, and editing all trigger fresh owner reads with stale-response protection.
- New edit writes expose only avatar, name, optional description, and `private/public` visibility.
- Version, changelog, Bundle/source, package name, runtime, permissions, and entrypoints never appear in the edit form.
- Metadata saves before icon. Metadata failure stops icon; icon failure after metadata produces an explicit partial-success state.
- Browser write bodies do not contain owner IDs, package names, local paths, upstream URLs, headers, tokens, or object keys.
- UI Host writes require same-origin; Tool writes require explicit write grant and confirmation; SDK uses public exported types.
- Preserve v1 artifact-only and v2 Bundle installation/publication behavior.

---

### Task 1: Add metadata types, registry client, Host owner, and capability

**Files:**
- Modify: `src/extensions/types.ts`
- Modify: `src/extensions/publish-client.ts`
- Modify: `src/extensions/manager.ts`
- Modify: `src/types.ts`
- Modify: `src/arkme-service.ts`
- Create: `tests/extensions/metadata.test.ts`
- Modify: `tests/arkme-service.test.ts`

**Interfaces:**
- Consumes: backend `POST /api/v1/extensions/metadata/update` and numeric codes `40021/40321/40421/40921/50321`.
- Produces: `ArkmeExtensionMetadataUpdateInput`, `ArkmeExtensionMetadataUpdateResult`, `ExtensionPublishClient.updateMetadata()`, `ArkmeExtensionManager.updateMetadata()`, and `features.extensionMetadataEdit?: true`.

- [ ] **Step 1: Write failing registry/manager tests**

Create a test that captures the exact authenticated request and safe result:

```ts
it('updates only owner-safe listing metadata and maps the response', async () => {
  const post = vi.fn(async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
    expect(path).toBe('/api/v1/extensions/metadata/update')
    expect(body).toEqual({
      extension_id: 'ext-1', name: '新名称', description: '', visibility: 'private',
      client_mutation_id: '9f445b4f-55aa-45c1-9250-25161832d432',
    })
    return { extension: {
      extension_id: 'ext-1', name: '新名称', description: '', visibility: 'private',
      status: 'active', latest_stable_version: '1.0.0', updated_at: 1780000000000,
    } } as T
  })
  const manager = metadataManager(post)
  await expect(manager.updateMetadata({
    extensionId: 'ext-1', name: '新名称', description: '', visibility: 'private',
    clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432',
  })).resolves.toMatchObject({ extension_id: 'ext-1', updated_at: 1780000000000 })
})
```

Add cases for invalid extension ID, blank/overlong name, overlong description, `unlisted`, invalid UUID, malformed extension identity in the response, each backend numeric code, and route 404 without numeric envelope.

- [ ] **Step 2: Run the metadata owner test and verify failure**

Run: `pnpm exec vitest run tests/extensions/metadata.test.ts`

Expected: FAIL because metadata types/methods are undefined.

- [ ] **Step 3: Add exact public types and repair timestamp drift**

In `src/extensions/types.ts`:

```ts
export type ArkmeExtensionEditableVisibility = 'private' | 'public'

export interface ArkmeExtensionMetadataUpdateInput {
  name: string
  description: string
  visibility: ArkmeExtensionEditableVisibility
  clientMutationId: string
}

export interface ArkmeExtensionMetadataUpdateResult {
  extension: ArkmeExtensionCatalogItem
}
```

Change `ArkmeExtensionCatalogItem.updated_at` to `number | undefined` and add `status?: 'active' | 'suspended' | 'deleted'`. Keep read-side `ArkmeExtensionVisibility` including `unlisted` for compatibility.

- [ ] **Step 4: Implement the registry client and error mapping**

Add `ExtensionPublishClient.updateMetadata()` that sends snake_case fields. Catch `ArkmePluginError` and map:

```ts
const metadataErrorCodes: Record<string, [string, string, boolean, number]> = {
  'arkme-code-40021': ['extension-metadata-invalid', '扩展信息无效', false, 400],
  'arkme-code-40321': ['extension-metadata-owner-forbidden', '当前账号不能编辑该扩展', false, 403],
  'arkme-code-40421': ['extension-not-found', '扩展不存在', false, 404],
  'arkme-code-40921': ['extension-metadata-idempotency-conflict', '扩展信息保存请求冲突', false, 409],
  'arkme-code-50321': ['extension-metadata-update-failed', '扩展信息暂时无法保存', true, 503],
}
```

Only `arkme-http-error` with `upstreamStatus===404` becomes `extension-metadata-update-unsupported`; a `40421` envelope remains `extension-not-found`.

- [ ] **Step 5: Implement `ArkmeExtensionManager.updateMetadata()`**

Normalize and validate Browser/Tool/SDK input before transport, then verify the response extension ID and editable fields equal the requested normalized values. Return the safe catalog item; never return the response wrapper or upstream transport details.

- [ ] **Step 6: Add the optional Provider capability**

Add `extensionMetadataEdit?: true` beside existing extension feature flags and return `extensionMetadataEdit: true` from `providerCapabilities()`. Update capability tests so older response fixtures without the field remain valid.

- [ ] **Step 7: Run focused tests and typecheck**

Run:

```bash
pnpm exec vitest run tests/extensions/metadata.test.ts tests/arkme-service.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit the Host owner**

```bash
git add src/extensions/types.ts src/extensions/publish-client.ts src/extensions/manager.ts src/types.ts src/arkme-service.ts tests/extensions/metadata.test.ts tests/arkme-service.test.ts
git commit -m "feat(extensions): 功能点: 增加扩展资料编辑能力"
```

### Task 2: Expose the Host operation, public SDK, and confirmed Tool

**Files:**
- Modify: `src/types.ts`
- Modify: `src/host-api.ts`
- Modify: `src/client/api.ts`
- Modify: `src/sdk/index.ts`
- Modify: `src/tools/extensions/index.ts`
- Modify: `tests/extensions/host-api.test.ts`
- Modify: `tests/sdk.test.ts`
- Modify: `tests/extensions/tools.test.ts`
- Modify: `tests/extensions/tools-runtime.test.ts`

**Interfaces:**
- Consumes: `ArkmeExtensionManager.updateMetadata()` and metadata types from Task 1.
- Produces: Host operation `extensions.metadata.update`, SDK `updateExtensionMetadata()`, Tool `arkme_extension_edit`.

- [ ] **Step 1: Write failing Host/SDK/Tool contract tests**

Host test:

```ts
await expect(dispatchArkmeHostOperation(service, 'extensions.metadata.update', {
  extensionId: 'ext-1', name: '新名称', description: '', visibility: 'private',
  clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432',
}, undefined, () => ({ updateMetadata }) as never)).resolves.toMatchObject({ name: '新名称' })
```

SDK test must assert exact camelCase Host params and no owner/package fields. Tool tests must assert schema visibility enum is exactly `['private', 'public']`, confirmation copy names the extension and target visibility, and execute delegates to the same manager method.

- [ ] **Step 2: Run the focused tests and verify missing entries**

Run:

```bash
pnpm exec vitest run tests/extensions/host-api.test.ts tests/sdk.test.ts tests/extensions/tools.test.ts tests/extensions/tools-runtime.test.ts
```

Expected: FAIL because operation/method/tool are absent.

- [ ] **Step 3: Add the Host operation and origin gate**

Add `'extensions.metadata.update'` to `ArkmePluginOperation`, `ArkmeUiOperation`, dispatch switch, and the write-operation origin-required list. Add a parser that accepts only the two editable values:

```ts
function extensionEditableVisibilityParam(params: Record<string, unknown>): ArkmeExtensionEditableVisibility {
  const value = stringParam(params, 'visibility')
  if (value !== 'private' && value !== 'public') {
    throw new ArkmePluginError('extension-metadata-invalid', '扩展可见范围无效', false, 400)
  }
  return value
}
```

Dispatch only these fields:

```ts
return await requireExtensionManager(extensionManager).updateMetadata({
  extensionId: stringParam(params, 'extensionId'),
  name: stringParam(params, 'name'),
  description: stringParam(params, 'description'),
  visibility: extensionEditableVisibilityParam(params),
  clientMutationId: stringParam(params, 'clientMutationId'),
})
```

- [ ] **Step 4: Add the SDK method**

Expose:

```ts
async updateExtensionMetadata(
  extensionId: string,
  input: ArkmeExtensionMetadataUpdateInput,
  signal?: AbortSignal,
): Promise<ArkmeExtensionCatalogItem>
```

Validate the UUID and editable visibility before calling the Host route. Export all input/result types from the public SDK entry.

- [ ] **Step 5: Register `arkme_extension_edit`**

Use effect=`write`, grant=`explicit-user-write`, and JSON schema fields `extension_id`, `name`, `description`, `visibility`. Confirmation text:

```ts
reason: `确认把扩展 ${extensionId} 的资料更新为“${name}”，可见范围：${visibility === 'public' ? '公开' : '仅自己'}吗？`
```

The Tool result returns only extension ID, name, description, visibility, updated_at, and a Chinese success message.

- [ ] **Step 6: Run focused tests and typecheck**

Run the four focused Vitest files from Step 2 plus `pnpm typecheck`.

Expected: PASS, including origin rejection and Tool confirmation coverage.

- [ ] **Step 7: Commit the adapters**

```bash
git add src/types.ts src/host-api.ts src/client/api.ts src/sdk/index.ts src/tools/extensions/index.ts tests/extensions/host-api.test.ts tests/sdk.test.ts tests/extensions/tools.test.ts tests/extensions/tools-runtime.test.ts
git commit -m "feat(extensions): 功能点: 暴露扩展资料编辑适配器"
```

### Task 3: Merge owner-private items into Discover and make refresh explicit

**Files:**
- Create: `src/client/extension-market-model.ts`
- Create: `tests/extensions/extension-market-model.test.ts`
- Modify: `src/client/ArkmeExtensionCenter.tsx`
- Modify: `tests/extensions/extension-center.test.tsx`

**Interfaces:**
- Consumes: `ArkmeExtensionCatalogItem[]` from public catalog and owner my-list.
- Produces: `mergeExtensionDiscoverItems(publicItems, ownedItems)` and `extensionOwnerVisibilityBadge(item)`.

- [ ] **Step 1: Write failing pure projection tests**

```ts
it('merges public and owner-private items without exposing historical unlisted', () => {
  const result = mergeExtensionDiscoverItems(
    [{ extension_id: 'ext-public', name: '公开', description: '', visibility: 'public', updated_at: 10 }],
    [
      { extension_id: 'ext-private', name: '私有', description: '', visibility: 'private', updated_at: 20 },
      { extension_id: 'ext-public', name: '公开 owner', description: '', visibility: 'public', updated_at: 10, owner_name: '我' },
      { extension_id: 'ext-unlisted', name: '历史', description: '', visibility: 'unlisted', updated_at: 30 },
    ],
  )
  expect(result.map(item => item.extension_id)).toEqual(['ext-private', 'ext-public'])
  expect(result[1]).toMatchObject({ name: '公开', owner_name: '我' })
})
```

Add deterministic tie ordering and no-input-mutation cases.

- [ ] **Step 2: Run the model test and observe missing exports**

Run: `pnpm exec vitest run tests/extensions/extension-market-model.test.ts`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement the pure merge**

Create a new map so inputs are never mutated. Owner fields fill missing public fields, public listing values win for shared public items, unlisted owner-only items are filtered, and the final array sorts by `updated_at` descending then `extension_id` ascending.

- [ ] **Step 4: Wire the merged projection and private badge**

Replace `const visibleItems = discoverItems` with the pure merge. Show a muted `仅自己` badge beside the title only when the item comes from the owner list and has private visibility.

When inspecting an owner-private item, use its my-list projection plus `extensions.install.preview` to populate manifest/version; do not call the public detail route.

- [ ] **Step 5: Make every requested refresh path explicit**

Change active-tab behavior from early return to:

```ts
if (target === tab) {
  void load(target, 'refresh')
  return
}
```

Keep mount load, tab-switch load, sequence checks, and AbortController. When `extensions.my-list` fails during Discover, retain public items and render the non-blocking warning `你的私有扩展暂未加载，请稍后刷新。`.

- [ ] **Step 6: Run UI/model tests**

Run:

```bash
pnpm exec vitest run tests/extensions/extension-market-model.test.ts tests/extensions/extension-center.test.tsx
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Discover and refresh behavior**

```bash
git add src/client/extension-market-model.ts src/client/ArkmeExtensionCenter.tsx tests/extensions/extension-market-model.test.ts tests/extensions/extension-center.test.tsx
git commit -m "fix(extensions): 功能点: 展示私有扩展并刷新市场数据"
```

### Task 4: Build the shared Bot-style avatar field and edit dialog

**Files:**
- Create: `src/client/ArkmeExtensionAvatarField.tsx`
- Create: `src/client/ArkmeExtensionEditDialog.tsx`
- Modify: `src/client/ArkmeExtensionPublishDialog.tsx`
- Create: `tests/extensions/extension-edit-dialog.test.tsx`
- Modify: `tests/extensions/extension-center.test.tsx`

**Interfaces:**
- Consumes: current extension icon URL/fallback, `File`, and editable metadata types.
- Produces: reusable `ArkmeExtensionAvatarField`, `ArkmeExtensionEditDialog`, and `ArkmeExtensionEditFormValue`.

- [ ] **Step 1: Write failing static interaction-contract tests**

Render the edit dialog and assert:

```ts
expect(html).toContain('编辑扩展')
expect(html).toContain('aria-label="更换扩展头像"')
expect(html).toContain('width:64px')
expect(html).toContain('border-radius:50%')
expect(html).toContain('accept="image/png,image/jpeg,image/webp"')
expect(html).toContain('display:none')
expect(html).toContain('>保存</button>')
expect(html).not.toContain('版本')
expect(html).not.toContain('更新说明')
expect(html).not.toContain('>通过链接访问</option>')
```

Render the publish dialog and assert it uses the same avatar field while retaining version/update fields.

- [ ] **Step 2: Run dialog tests and verify failure**

Run: `pnpm exec vitest run tests/extensions/extension-edit-dialog.test.tsx tests/extensions/extension-center.test.tsx`

Expected: FAIL because the shared field/edit dialog do not exist and the raw file input is visible.

- [ ] **Step 3: Implement `ArkmeExtensionAvatarField`**

Use a hidden input referenced by `useRef<HTMLInputElement>()`, a keyboard-accessible button wrapping a 64px circular current/selected preview, and a camera badge that becomes visible on hover/focus. Manage selected-file preview with `URL.createObjectURL(file)` and revoke the previous URL in effect cleanup.

Props:

```ts
interface ArkmeExtensionAvatarFieldProps {
  extensionId?: string
  iconRef?: string
  selectedFile?: File
  disabled: boolean
  onSelect(file: File): void
}
```

Reject unsupported MIME and files over 2 MiB before `onSelect`, and expose the validation message through `role="alert"`.

- [ ] **Step 4: Implement the edit dialog**

Initialize name/description/visibility from the published item. For historical unlisted, render a warning and no selected visibility; disable Save until private/public is chosen. Return:

```ts
export interface ArkmeExtensionEditFormValue {
  name: string
  description: string
  visibility: ArkmeExtensionEditableVisibility
  iconFile?: File
}
```

Validate trim-normalized name length, description length, and file rules locally while keeping Host authoritative.

- [ ] **Step 5: Replace the publish dialog’s raw avatar input**

Reuse `ArkmeExtensionAvatarField`; preserve publish form values and private default. The selected file remains optional and is returned through the existing publish submission callback.

- [ ] **Step 6: Run dialog tests and accessibility assertions**

Run the two test files from Step 2 plus `pnpm typecheck`.

Expected: PASS; the only visible avatar affordance is the Bot-style preview row.

- [ ] **Step 7: Commit the UI primitives**

```bash
git add src/client/ArkmeExtensionAvatarField.tsx src/client/ArkmeExtensionEditDialog.tsx src/client/ArkmeExtensionPublishDialog.tsx tests/extensions/extension-edit-dialog.test.tsx tests/extensions/extension-center.test.tsx
git commit -m "feat(extensions): 功能点: 增加扩展信息编辑弹窗"
```

### Task 5: Orchestrate metadata/icon partial success and replace card actions

**Files:**
- Create: `src/client/extension-edit-flow.ts`
- Create: `tests/extensions/extension-edit-flow.test.ts`
- Modify: `src/client/ArkmeExtensionCenter.tsx`
- Modify: `src/client/my-extension-model.ts`
- Modify: `tests/extensions/extension-center.test.tsx`
- Modify: `tests/extensions/my-extension-model.test.ts`

**Interfaces:**
- Consumes: SDK `updateExtensionMetadata`, SDK `setExtensionIcon`, edit dialog value, owner item.
- Produces: `saveExtensionEdit()` with complete/partial result and card action `edit` for published items.

- [ ] **Step 1: Write failing flow tests for call ordering**

```ts
it('stops before icon when metadata fails', async () => {
  const updateMetadata = vi.fn(async () => { throw new Error('metadata failed') })
  const setIcon = vi.fn()
  await expect(saveExtensionEdit(editInput(), { updateMetadata, setIcon })).rejects.toThrow('metadata failed')
  expect(setIcon).not.toHaveBeenCalled()
})

it('reports partial success when icon fails after metadata', async () => {
  const result = await saveExtensionEdit(editInput({ iconFile }), {
    updateMetadata: vi.fn(async () => updatedItem),
    setIcon: vi.fn(async () => { throw new Error('icon failed') }),
  })
  expect(result).toEqual({ kind: 'metadata-saved-icon-failed', extension: updatedItem, error: 'icon failed' })
})
```

Also cover metadata-only success, icon-only change with unchanged metadata, complete success, and stable mutation UUID reuse after retry.

- [ ] **Step 2: Run flow/model tests and verify failure**

Run: `pnpm exec vitest run tests/extensions/extension-edit-flow.test.ts tests/extensions/my-extension-model.test.ts`

Expected: FAIL because flow/action do not exist.

- [ ] **Step 3: Implement the pure async edit flow**

Return a discriminated union:

```ts
type ExtensionEditSaveResult =
  | { kind: 'saved'; extension: ArkmeExtensionCatalogItem; icon?: ArkmeExtensionIconResult }
  | { kind: 'metadata-saved-icon-failed'; extension: ArkmeExtensionCatalogItem; error: string }
```

Call metadata only when normalized fields differ from the baseline. Call icon only after metadata success or when metadata is unchanged. Let metadata exceptions reject so the dialog preserves its input.

Define a retry-stable mutation helper in the same module:

```ts
export interface ExtensionEditMutation { signature: string; id: string }

export function nextExtensionEditMutation(
  previous: ExtensionEditMutation | undefined,
  extensionId: string,
  value: Pick<ArkmeExtensionEditFormValue, 'name' | 'description' | 'visibility'>,
  createId: () => string,
): ExtensionEditMutation {
  const signature = JSON.stringify([extensionId, value.name.trim(), value.description.trim(), value.visibility])
  return previous?.signature === signature ? previous : { signature, id: createId() }
}
```

- [ ] **Step 4: Change card actions from avatar upload to Edit**

Update `myExtensionPrimaryAction()` so published items return `{ kind: 'edit', label: '编辑' }`, unpublished publishable items return publish, and unavailable local items return no action. Remove `onIconSelect` and visible `上传头像` from `MyExtensionCard`; add `onEdit`.

- [ ] **Step 5: Wire edit state and refresh**

Add `editItem`, `editBusy`, `editError`, and a stable mutation ref to `ArkmeExtensionCenter`. On save:

1. call `saveExtensionEdit`;
2. merge the returned extension immediately into `publishedItems` and matching `myExtensions`;
3. refresh `mine` and `discover` data;
4. on partial icon failure, keep the dialog open with `资料已保存，但头像更新失败：…` and update its baseline so retry only uploads the icon;
5. on complete success, close and show `扩展信息已更新。`.

If Host throws `extension-metadata-update-unsupported`, keep the dialog and show `当前扩展服务尚未支持资料编辑。`.

- [ ] **Step 6: Run flow and market UI tests**

Run:

```bash
pnpm exec vitest run tests/extensions/extension-edit-flow.test.ts tests/extensions/my-extension-model.test.ts tests/extensions/extension-center.test.tsx
pnpm typecheck
```

Expected: PASS; published rows contain “编辑”, never “上传头像”, and badges remain beside titles.

- [ ] **Step 7: Commit the edit orchestration**

```bash
git add src/client/extension-edit-flow.ts src/client/ArkmeExtensionCenter.tsx src/client/my-extension-model.ts tests/extensions/extension-edit-flow.test.ts tests/extensions/extension-center.test.tsx tests/extensions/my-extension-model.test.ts
git commit -m "feat(extensions): 功能点: 统一编辑扩展资料与头像"
```

### Task 6: Run plugin gates, package, and validate against the deployed backend

**Files:**
- No planned source changes; only fix verified regressions within the files already owned by Tasks 1–5.

**Interfaces:**
- Consumes: test backend metadata endpoint and all plugin commits.
- Produces: immutable plugin `.tgz`, clean-profile DSH runtime evidence, and test-server UI acceptance.

- [ ] **Step 1: Run all local gates**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all tests pass; build emits Host/Client/SDK artifacts.

- [ ] **Step 2: Pack and inspect the tarball**

Run `pnpm pack --pack-destination <fresh temporary directory>`, list tar members, and search extracted text for `/Users/`, the task worktree path, `127.0.0.1:52909`, tokens, signed URLs, and temporary backend values.

Expected: no author-machine paths or credentials; package exports include SDK types and compiled UI/Host changes.

- [ ] **Step 3: Install into a fresh temporary DSH_HOME with official DSH CLI**

Use the unmodified `/Users/apple/hehs/dsh` runtime only as a runner. Create a new temporary `DSH_HOME`, install the packed tarball through `dsh plugin --profile web add <tgz>`, and start an unused loopback port. Do not replace the user’s real Profile or modify DSH source.

- [ ] **Step 4: Validate Discover refresh and private visibility**

With the test account:

1. open the market and confirm “即我昵称显示（测试）” appears in Discover with `仅自己`;
2. close/reopen and confirm a fresh request retains it;
3. click the active Discover tab and confirm it refreshes;
4. confirm historical unlisted items do not appear in Discover;
5. confirm public owner items appear only once.

- [ ] **Step 5: Validate metadata and avatar editing**

Edit a dedicated temporary extension: change name, set empty description, switch private→public, upload a valid image, close/reopen, and confirm Discover/My Extensions/detail use the same server values and icon ref. Switch public→private and confirm public catalog removal while owner Discover remains visible.

Use an injected/controlled icon failure once and verify the UI states `资料已保存，但头像更新失败` while the text fields persist. Retry the icon only and confirm success.

- [ ] **Step 6: Validate SDK and Tool on the real DSH runtime**

Compile a tarball-installed external Consumer that checks `capabilities.features.extensionMetadataEdit`, calls `updateExtensionMetadata`, handles `extension-metadata-update-unsupported`, and imports only `@senguoyun/dsh-arkme/sdk`.

In a real DSH session, verify `arkme_extension_edit` is discoverable, requests confirmation, rejects `unlisted`, and updates the exact owned extension after approval.

- [ ] **Step 7: Run install compatibility regressions**

Resolve/install one historical v1 artifact-only extension and one strict v2 Bundle. Expected: both retain their existing install behavior and the installed list remains readable.

- [ ] **Step 8: Review final scope and commit any verified correction**

Run:

```bash
git status --short --branch
git diff --stat d4fbeec..HEAD
git log --oneline --decorate -10
git -C /Users/apple/hehs/dsh status --short
```

Expected: the plugin branch contains only planned plugin/spec/plan commits; DSH tracked files are unchanged. Any pre-existing untracked DSH files are reported and left untouched.
