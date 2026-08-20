# Sandboxed Client Export Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox status and must be checked only after the named command passes.

**Goal:** Make the Arkme plugin generate and locally validate the corrected Artifact Contract v2 sandbox bundle: Host-only exports two entries; Host+Client exports exactly one additional standard Client entry, while Cordis patch loading remains package-root-only.

**Architecture:** `bundle-materializer.ts` is the sole package-manifest generator for local Cordis/persisted publishing. `bundle-artifact.ts` independently validates the generated tar before upload using the same closed consistency matrix as the Go backend. Existing Tools, SDK, and UI continue calling the same publication owner and require no new API surface.

**Tech Stack:** TypeScript, pnpm, Vitest, tar archive helpers, DSH plugin CLI, temporary isolated DSH profiles.

**Spec:** `docs/superpowers/specs/2026-08-20-sandbox-client-export-contract-design.md`

## Global Constraints

- Work in `/Users/apple/hehs/arkme-dsh-plugin-c20260820-bundle-first-market-plan`; verify branch, upstream, ahead/behind, and worktree before editing.
- Preserve unrelated UI/market edits and stage only the exact bundle/test files named below.
- Do not modify DSH source. The DSH `ClientModuleRegistry` contract is the authority: a package declaring web Client must export `./client`.
- Do not add compatibility for the unused broken v2 shape. Do not change `artifact_contract_version`, v1 flows, signing, source/bundle equality, package identity, or install resolution.
- Do not add Tool, SDK, or UI branches: every caller must continue through the same publication materializer.
- Commit messages must include Chinese `功能点:`.

---

## Task 1: Lock generator and local-validator behavior with failing tests

**Files:**

- Modify: `tests/extensions/bundle-materializer.test.ts`
- Modify: `tests/extensions/bundle-artifact.test.ts`
- Inspect only: `src/extensions/bundle-materializer.ts`
- Inspect only: `src/extensions/bundle-artifact.ts`

- [x] **Step 1: Verify the current baseline**

```bash
git status --short --branch
git fetch origin master
git rev-list --left-right --count HEAD...origin/master
pnpm test -- tests/extensions/bundle-materializer.test.ts tests/extensions/bundle-artifact.test.ts --run
```

Expected: current tests pass. Record but do not clean unrelated changes.

- [x] **Step 2: Add exact manifest-generation assertions**

Add two generator tests that extract and parse `package/package.json`:

- Host-only input without `clientCode`: exports deep-equal `{ ".": "./lib/index.js", "./package.json": "./package.json" }`, has no `dsh.client`, and has no `package/lib/client.js`.
- Host+Client input with `clientCode`: exports deep-equal `{ ".": "./lib/index.js", "./client": "./lib/client.js", "./package.json": "./package.json" }`, has `dsh.client = { platform: "web", inject: [] }`, and includes `package/lib/client.js` with the supplied bytes.

Keep deterministic archive ordering and existing source/bundle byte-equality assertions.

- [x] **Step 3: Add local validation matrix tests**

Using the existing tar mutation/build helpers, cover both valid shapes and reject:

- declaration without Client file;
- declaration and file without Client export;
- incorrect Client export target;
- Client file without declaration;
- Client export without declaration;
- extra export in either mode;
- non-web Client platform;
- patch row loading `packageName + "/client"` even when `./client` is exported.

Assert the validator's stable issue code or precise error fragment so failures identify the Client contract instead of a generic archive error.

- [x] **Step 4: Prove tests fail against the old implementation**

```bash
pnpm test -- tests/extensions/bundle-materializer.test.ts tests/extensions/bundle-artifact.test.ts --run
```

Expected: the Host+Client generator/valid bundle case fails because `./client` is absent or because the validator still enforces exactly two exports.

- [x] **Step 5: Commit the red tests**

```bash
git add tests/extensions/bundle-materializer.test.ts tests/extensions/bundle-artifact.test.ts
git commit -m "test(extensions): 功能点: 固化沙箱 Client 导出合同"
```

## Task 2: Generate the conditional standard Client export

**Files:**

- Modify: `src/extensions/bundle-materializer.ts`

- [x] **Step 1: Build exports from Client presence**

When `clientCode` is absent, generate only the existing `.` and `./package.json` entries. When `clientCode` is present, insert exactly:

```ts
'./client': './lib/client.js'
```

Continue generating `package/lib/client.js` and `dsh.client = { platform: 'web', inject: [] }` only in the Client case. Do not expose `./lib/index.js`, wildcards, or other subpaths.

- [x] **Step 2: Keep patch output unchanged**

Confirm the materializer still emits exactly one patch insert row, with id `arkmeSandboxEntryId(packageName)` and name equal to the package root. Do not point the patch at `./client`.

- [x] **Step 3: Run generator tests**

```bash
pnpm test -- tests/extensions/bundle-materializer.test.ts --run
```

Expected: Host-only and Host+Client manifest assertions pass, including deterministic repeated generation.

- [x] **Step 4: Commit the generator**

```bash
git add src/extensions/bundle-materializer.ts
git commit -m "fix(extensions): 功能点: 生成标准沙箱 Client 导出"
```

## Task 3: Validate the same closed matrix before upload/install

**Files:**

- Modify: `src/extensions/bundle-artifact.ts`

- [x] **Step 1: Extend the parsed manifest type**

Represent optional `dsh.client` with `platform` and `inject` fields without loosening unrelated manifest types. Determine declaration by the presence of the `client` object, not only by a truthy platform string.

- [x] **Step 2: Preserve unconditional Host assertions**

Continue requiring `type=module`, `main=./lib/index.js`, root export to `./lib/index.js`, and package-json export to `./package.json`.

- [x] **Step 3: Apply the Client matrix**

Detect the regular tar entry `package/lib/client.js` and exact `./client` export. Require all three legs and exactly three exports when declared; require none and exactly two exports when undeclared. Reject non-string/conditional/wildcard Client exports and `platform != web` with a specific sandbox Client issue.

- [x] **Step 4: Keep archive and patch defenses unchanged**

Do not weaken entry normalization, symlink/hardlink rejection, path traversal rules, dependency/script/native/bin restrictions, deterministic identity, or patch root-only validation.

- [x] **Step 5: Keep serialized Client factories self-contained**

Execute the generated Client module with a fixture that mirrors `tsx`/esbuild name preservation. If `persistentClientFactory.toString()` contains `__name(...)`, the emitted module must provide the compatible helper inside its own ModuleLoader factory and execute without inheriting variables from the generation process.

- [x] **Step 6: Run focused tests**

```bash
pnpm test -- tests/extensions/bundle-artifact.test.ts tests/extensions/bundle-materializer.test.ts --run
```

Expected: the full valid/invalid matrix passes.

- [x] **Step 7: Commit the validator**

```bash
git add src/extensions/bundle-artifact.ts
git commit -m "fix(extensions): 功能点: 校验沙箱 Client 一致性"
```

## Task 4: Run plugin-wide regression and build exact distributable bytes

**Files:**

- Modify only for a demonstrated regression caused by Tasks 1-3; otherwise none.

- [x] **Step 1: Run all local gates**

```bash
pnpm test -- --run
pnpm run typecheck
pnpm run build
pnpm pack --dry-run
```

Use the repository's actual script name if `typecheck` or `build` differs, and record the substituted command. Do not dismiss an unrelated pre-existing failure; separate it with evidence.

- [x] **Step 2: Review the scoped diff**

```bash
git diff origin/master...HEAD -- src/extensions/bundle-materializer.ts src/extensions/bundle-artifact.ts tests/extensions/bundle-materializer.test.ts tests/extensions/bundle-artifact.test.ts
git status --short
```

Confirm the implementation matches every spec matrix row and contains no old-v2 compatibility or DSH modification.

- [x] **Step 3: Build from an exact committed snapshot**

Create a temporary detached worktree at the final task commit, install dependencies with the repository lockfile, build, and run `pnpm pack` there. Inspect the package tarball to confirm it contains the built Host and Client plugin files required by DSH and has no author-machine `link:` dependency. Remove only the temporary worktree after verification.

## Task 5: Cross-system test-environment acceptance

**Files:** None. Use temporary DSH homes/profiles and test backend records only.

- [x] **Step 1: Wait for the backend validator deployment**

Require the backend task's final test `develop` SHA and successful Jenkins build. Do not publish corrected v2 Client bytes before the new validator is live.

- [x] **Step 2: Reinstall the exact unified plugin package in the 52909 test session**

Install the package produced from the committed snapshot into the existing temporary DSH home backing port 52909, then restart through the existing owner process. Verify the extension-market dialog still opens and no startup/composition error references the Arkme plugin.

- [x] **Step 3: Publish both v2 shapes**

From the same plugin build:

- Publish a minimal Host-only sandbox extension.
- Publish the intended Host+Client Cordis extension as version `1.0.0` after the backend task confirms obsolete broken-v2 data removal.

For each publish, verify create/upload/finalize responses, remote visibility consistent with its visibility field, and a fresh market load (close/reopen or explicit owner refresh) retrieves the new record.

- [x] **Step 4: Resolve and install in a fresh DSH profile**

Use a new temporary `DSH_HOME` and Profile rather than the current interactive profile. Resolve-install both extensions and install using the official DSH plugin path. Validate downloaded size/SHA/signature before installation.

- [x] **Step 5: Restart and inspect module composition**

For Host-only, confirm the Host entry is active and no Client module is registered. For Host+Client, restart DSH and confirm:

- ClientModuleRegistry resolves the package's `./client` export;
- no `declares dsh.client but exports no "./client" bundle` error appears;
- Host and Client halves are active;
- the extension's intended settings/slot UI renders.

- [x] **Step 6: Regress v1 artifact-only installation**

Resolve and install an existing or freshly published v1 artifact-only extension against the same backend deployment. Confirm the wrapper/install path remains functional and is independent of the new v2 Client logic.

- [x] **Step 7: Preserve the user preview and report evidence**

Leave port 52909 running with the final unified plugin package. Report exact plugin commit/package path, backend `develop` SHA/Jenkins build, test extension ids, version, resolved SHAs, temporary profile path, restart result, Client UI result, v1 regression result, and any retained unrelated worktree changes.
