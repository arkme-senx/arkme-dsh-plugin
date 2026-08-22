# Windows Native Credential Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Windows PowerShell PasswordVault dependency with a packaged native Credential Manager helper.

**Architecture:** A dependency-free Go x64 helper owns the Windows API calls, while a focused TypeScript process adapter preserves the existing `ArkmeWindowsCredentialBackend` interface. JSON travels only through stdin/stdout and the packaged executable is integrity-checked before release.

**Tech Stack:** TypeScript, Vitest, Go 1.25, Windows Credential Manager (`advapi32.dll`), tsdown, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-22-windows-native-credential-helper-design.md`

## Global Constraints

- Do not use PowerShell, temporary files, command-line secrets, or plaintext credential files.
- Preserve the public `ArkmeSessionStore` behavior and all macOS Keychain behavior.
- Ship only a Windows x64 helper in this version.
- Do not perform git add, commit, push, or merge until the commit confirmation gate is completed.

---

### Task 1: Native protocol and Windows Credential Manager helper

**Files:**
- Create: `native/windows-credential-helper/go.mod`
- Create: `native/windows-credential-helper/protocol/protocol_test.go`
- Create: `native/windows-credential-helper/protocol/protocol.go`
- Create: `native/windows-credential-helper/main_windows.go`

**Interfaces:**
- Consumes: one JSON request from stdin.
- Produces: one JSON response on stdout and process exit code 0; failures exit non-zero without secret content.

- [ ] **Step 1: Write the failing protocol tests**

Cover the literal target `Arkme/com.senqisi.dsh-arkme.prod/session`, valid read/write/delete requests, missing payload rejection for write, and blank service/account rejection.

- [ ] **Step 2: Run the protocol tests and confirm RED**

Run: `go -C native/windows-credential-helper test ./...`

Expected: FAIL because the protocol package implementation does not exist.

- [ ] **Step 3: Implement the protocol and Windows API boundary**

Implement `protocol.Parse(io.Reader)`, `protocol.Target(Request)`, and `protocol.WriteResponse(io.Writer, Response)`. In the Windows main package, bind `CredReadW`, `CredWriteW`, `CredDeleteW`, and `CredFree` through `syscall.NewLazyDLL("advapi32.dll")`; treat error 1168 as a missing credential.

- [ ] **Step 4: Run host protocol tests and cross-compile**

Run: `go -C native/windows-credential-helper test ./...`

Run: `CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go -C native/windows-credential-helper build -trimpath -ldflags '-s -w -buildid=' -o ../../assets/windows/arkme-credential-helper.exe .`

Expected: tests PASS and a Windows PE32+ executable is produced.

### Task 2: Package and verify the native helper

**Files:**
- Create: `assets/windows/manifest.json`
- Create: `scripts/build-windows-credential-helper.mjs`
- Create: `scripts/verify-windows-credential-helper.mjs`
- Modify: `.gitattributes`
- Modify: `package.json`

**Interfaces:**
- Consumes: helper source and the committed binary.
- Produces: reproducible x64 build plus SHA-256 verification used by the normal package build.

- [ ] **Step 1: Write a failing verifier test**

Create `tests/windows-credential-helper-assets.test.ts` that executes the verifier and expects success for the committed manifest, then corrupts a copied fixture and expects a checksum mismatch.

- [ ] **Step 2: Run the verifier test and confirm RED**

Run: `pnpm exec vitest run tests/windows-credential-helper-assets.test.ts`

Expected: FAIL because the verifier does not exist.

- [ ] **Step 3: Implement build and verification scripts**

The build script cross-compiles with `GOOS=windows`, `GOARCH=amd64`, `CGO_ENABLED=0`, writes the manifest hash, and the verifier hashes the shipped binary. Add `assets/windows` to npm `files` and call the verifier from `pnpm build` before bundling.

- [ ] **Step 4: Verify package contents**

Run: `pnpm build`

Run: `pnpm pack --dry-run`

Expected: both the helper executable and manifest are listed.

### Task 3: TypeScript helper process backend

**Files:**
- Create: `src/windows-credential-helper.ts`
- Create: `tests/windows-credential-helper.test.ts`
- Modify: `src/keychain-store.ts`

**Interfaces:**
- Consumes: `WindowsCredentialRequest` and the packaged helper executable.
- Produces: `ArkmeWindowsCredentialBackend.read/write/delete` behavior identical to the current backend.

- [ ] **Step 1: Write failing process-adapter tests**

Test missing-read, read-value, write, delete, non-zero exit, malformed response, output limit, and timeout through a deterministic fake child-process boundary. Assertions target backend results and errors rather than mock call counts.

- [ ] **Step 2: Run the tests and confirm RED**

Run: `pnpm exec vitest run tests/windows-credential-helper.test.ts tests/keychain-store.test.ts`

Expected: FAIL because the native helper adapter is not implemented.

- [ ] **Step 3: Implement the adapter and select it on Windows**

Resolve `../assets/windows/arkme-credential-helper.exe` from `import.meta.url`, spawn it with no arguments, send exactly one JSON line through stdin, cap output, enforce timeout, and map its response into `ArkmeWindowsCredentialBackend`. Remove the PowerShell script and PowerShell process launcher.

- [ ] **Step 4: Run focused and full tests**

Run: `pnpm exec vitest run tests/windows-credential-helper.test.ts tests/keychain-store.test.ts`

Run: `pnpm typecheck && pnpm test`

Expected: all tests PASS; Windows-only integration remains skipped on macOS.

### Task 4: Windows packaged-runtime verification

**Files:**
- Modify: `tests/windows-credential.integration.test.ts`

**Interfaces:**
- Consumes: packaged helper and installed plugin build.
- Produces: target-machine evidence for read/write/delete and HTTP auth behavior.

- [ ] **Step 1: Extend the Windows integration test**

Assert a fresh service reads missing, write/read round-trips the full session, delete returns to missing, and cleanup is idempotent.

- [ ] **Step 2: Build and deploy a temporary plugin package**

Run: `pnpm build` and copy the complete package to a recoverable target-machine staging directory. Back up the installed plugin before replacement.

- [ ] **Step 3: Execute the helper and plugin integration under `arkme.exe` Node mode**

Run the Windows credential integration test with `ELECTRON_RUN_AS_NODE=1`, then start the client and call `auth.status`.

Expected: helper test PASS; `auth.status` returns HTTP 200 and `logged-out` for a fresh store.

- [ ] **Step 4: Restore or retain the temporary build based on verification**

If any verification fails, restore the backup immediately. If all checks pass, retain the temporary build for user testing and report its exact hash and backup location.
