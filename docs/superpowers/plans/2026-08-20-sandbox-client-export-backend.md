# Sandboxed Client Export Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox status and must be checked only after the named command passes.

**Goal:** Update the Artifact Contract v2 backend validator so a sandboxed Host-only package has exactly two exports, while a sandboxed Host+Client package has exactly three exports including `./client -> ./lib/client.js`, without changing v1 compatibility or patch root-only enforcement.

**Architecture:** `jotmo-extension-publish` remains the authoritative remote validator. The validator parses the package manifest, validates the existing sandbox Host contract first, then validates one closed Client consistency matrix over the manifest declaration, tar entry, and package export. The change replaces the unused broken v2 Client shape directly; it does not add version branching, migration code, or install-time rewriting.

**Tech Stack:** Go, standard `archive/tar` and `encoding/json`, Gin service tests, existing publication fixtures and Jenkins test deployment.

**Spec:** `docs/superpowers/specs/2026-08-20-sandbox-client-export-contract-design.md`

## Global Constraints

- Work in `/Users/apple/hehs/senqisi_refactor/jotmo-extension-publish-c20260820-develop-review`; verify branch, upstream, ahead/behind, and worktree before editing.
- Do not modify DSH, production data, v1 request parsing, v1 artifact-only resolution, v2 source/bundle equality, signing, package identity, or patch validation.
- Artifact Contract v2 has no external users: directly replace the broken Client manifest shape. Do not add old-v2 compatibility, migration, revoke, patch-bump, or fallback code.
- Keep `allow-legacy-writes=true` behavior unchanged. Existing v1 artifact-only and v1-with-source tests must remain green.
- Commit only files named by each task. Commit messages must include Chinese `功能点:`.

---

## Task 1: Lock the v2 Client consistency matrix with failing tests

**Files:**

- Modify: `internal/publication/bundle_validator_test.go`
- Inspect only: `internal/publication/bundle_validator.go`

- [x] **Step 1: Verify the baseline**

Run:

```bash
git status --short --branch
git fetch origin develop
git rev-list --left-right --count HEAD...origin/develop
go test ./internal/publication -run 'TestValidateBundle|TestBundle' -count=1
```

Expected: the existing publication validator tests pass. If the worktree contains unrelated changes, preserve them and stage only the test file from this task.

- [x] **Step 2: Add the two valid sandbox cases**

Add or extend table-driven tests that build complete tarballs with the existing test helper:

1. Host-only: no `dsh.client`, no `package/lib/client.js`, and exports exactly `.` plus `./package.json`; expect success.
2. Host+Client: `dsh.client.platform` is `web`, `inject` is an empty array, `package/lib/client.js` exists, and exports additionally contain `"./client": "./lib/client.js"`; expect success.

Keep the existing valid patch as one insert row whose id is derived by the same sandbox id helper and whose name is the package root.

- [x] **Step 3: Add every invalid matrix edge**

Add named cases and assert a deterministic client-contract error code for:

- `dsh.client` present but `lib/client.js` missing.
- `dsh.client` and the file present but `./client` export missing.
- `./client` points anywhere except `./lib/client.js`.
- `lib/client.js` exists without `dsh.client`.
- `./client` exists without `dsh.client`.
- an extra fourth export exists in Host+Client.
- a third export exists in Host-only.
- `dsh.client.platform` is not `web`.

Also keep or add a regression proving `row.name = packageName + "/client"` is still rejected by patch validation even though the package may export `./client`.

- [x] **Step 4: Prove the new tests fail for the expected reason**

Run:

```bash
go test ./internal/publication -run 'TestValidateBundle.*Sandbox|TestBundle.*Sandbox' -count=1
```

Expected: the Host+Client valid case fails because the current validator requires exactly two exports; the invalid consistency cases must not all pass accidentally.

- [x] **Step 5: Commit the red contract tests**

```bash
git add internal/publication/bundle_validator_test.go
git commit -m "test(publication): 功能点: 固化沙箱 Client 导出合同"
```

## Task 2: Implement conditional sandbox Client validation

**Files:**

- Modify: `internal/publication/bundle_validator.go`
- Modify if compilation requires helper reuse only: `internal/publication/bundle_validator_test.go`

- [x] **Step 1: Parse the declared Client contract**

Extend the internal package manifest model under `dsh` with a `client` object that exposes `platform` and `inject`. Preserve unknown-field tolerance used by the current manifest parser; validation, not decoding, owns the strict shape.

- [x] **Step 2: Separate fixed Host exports from conditional Client exports**

Keep these assertions unconditional for `arkme-sandboxed`:

- `type == "module"`
- `main == "./lib/index.js"`
- `exports["."] == "./lib/index.js"`
- `exports["./package.json"] == "./package.json"`

Then implement one helper that derives:

```text
clientDeclared = dsh.client is present
clientFile = package/lib/client.js is a regular tar file
clientExported = exports contains ./client
```

Apply the closed matrix:

- If declared: platform must be `web`, file must exist, export must equal `./lib/client.js`, and total exports must be 3.
- If not declared: file and export must both be absent, and total exports must be 2.

Return one stable code such as `bundle_sandbox_client_invalid` with a message identifying the mismatched leg. Do not weaken path/link checks or accept conditional export objects and wildcard exports.

- [x] **Step 3: Keep patch validation root-only**

Do not change the patch parser or sandbox row-id calculation. Confirm there is still exactly one insert row, the row id matches the package-name-derived id, and `row.name` equals the package root exactly.

- [x] **Step 4: Make the focused test suite green**

Run:

```bash
gofmt -w internal/publication/bundle_validator.go internal/publication/bundle_validator_test.go
go test ./internal/publication -run 'TestValidateBundle.*Sandbox|TestBundle.*Sandbox' -count=1
```

Expected: all valid and invalid matrix cases pass, including patch-subpath rejection.

- [x] **Step 5: Commit the validator**

```bash
git add internal/publication/bundle_validator.go internal/publication/bundle_validator_test.go
git commit -m "fix(publication): 功能点: 支持沙箱 Client 标准导出"
```

## Task 3: Prove unchanged v1 and strict v2 behavior

**Files:**

- Modify only if a missing regression is found: `internal/publication/bundle_validator_test.go`
- Modify only if an existing end-to-end suite is the owner: matching files under `internal/publication/` or `tests/`

- [x] **Step 1: Run the publication regression suite**

```bash
go test ./internal/publication/... -count=1
go test ./... -count=1
go vet ./...
```

Expected: v1 artifact-only, v1 with source, strict v2 bundle/source byte equality, SHA/size, signature, identity, and both sandbox modes all pass.

- [x] **Step 2: Add only genuinely missing regressions**

If the named v1 and strict-v2 paths are not exercised, add focused tests proving:

- `allow-legacy-writes=true` still accepts an artifact-only v1 publish and resolves it for install.
- strict v2 still rejects missing source or bundle with the existing retryable conflict and retains `uploading` state.
- strict v2 still requires source and bundle bytes, sizes, and SHA values to match.

Do not change runtime behavior while adding these tests.

- [x] **Step 3: Commit any added regression tests**

Skip this commit if no file changed. Otherwise:

```bash
git add internal/publication/bundle_validator_test.go
git commit -m "test(publication): 功能点: 回归 v1 与严格 v2 发布合同"
```

## Task 4: Deploy to test and clean only obsolete v2 test data

**Files:** None in the runtime service unless the repository already owns a test-only operations script. Do not add a public cleanup API.

- [x] **Step 1: Integrate through the repository's established develop workflow**

Push the scoped backend commits, merge them into the current `develop`, and trigger the existing test Jenkins job. Record the final `develop` SHA and Jenkins build number. Do not merge or deploy to `master`.

- [x] **Step 2: Smoke the deployed validator with bytes generated by the unified plugin**

After the plugin task supplies fresh bundles, publish one Host-only and one Host+Client v2 bundle against test. For both, assert successful creation, upload completion, publish completion, and resolve-install. For Host+Client, the backend must accept exactly three exports.

- [x] **Step 3: Clean the obsolete broken v2 test rows and objects**

Use an existing test-environment operations path or a one-off DB/OSS administration command. Resolve exact ids first, then remove only records satisfying all of:

- test environment;
- `artifact_contract_version = 2`;
- `execution_model = arkme-sandboxed`;
- manifest declares `dsh.client`;
- manifest lacks the exact `./client -> ./lib/client.js` export.

Also remove their unreferenced test artifact/source objects. Do not touch v1 rows, correctly shaped v2 rows, production data, or local DSH source. Capture the ids and before/after counts in the task report; do not commit credentials or raw tokens.

- [x] **Step 4: Re-publish the intended Cordis fixture as `1.0.0`**

Rebuild from the source Cordis extension with the fixed plugin, publish version `1.0.0`, resolve it, and verify its stored package manifest has exactly the three expected exports. Reusing `1.0.0` is allowed only after the obsolete v2 test row and objects are confirmed removed.

- [x] **Step 5: Hand backend evidence to the plugin task**

Report: backend commit(s), final test `develop` SHA, Jenkins success URL/number, cleaned test ids/counts, Host-only publish id, Host+Client publish id, and resolve-install SHA values.
