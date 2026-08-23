# Windows Native Credential Helper Design

## Goal

Restore reliable Arkme session persistence on Windows without PowerShell, so `auth.status`, QR-login persistence, restart recovery, and logout all use the operating system credential store successfully.

## Root cause

The packaged Electron executable runs DSH through `ELECTRON_RUN_AS_NODE=1`. On the affected Windows host, launching `powershell.exe` returns `EPERM` or `Access is denied`, so the current PasswordVault script never executes. Treating that failure as logged out would hide storage failures and would still break login persistence.

## Architecture

The plugin package ships a small Windows x64 helper executable built from Go without third-party modules. The TypeScript credential backend spawns the helper by an absolute package asset path and exchanges one JSON request and one JSON response through stdin/stdout. The helper calls `CredReadW`, `CredWriteW`, and `CredDeleteW` in `advapi32.dll` with `CRED_TYPE_GENERIC` and `CRED_PERSIST_LOCAL_MACHINE`.

The generic credential target is `Arkme/<service>/<account>` and the username remains `<account>`. The credential blob is the existing UTF-8 session JSON, so `ArkmeWindowsCredentialStore` keeps its current validation and 2,560-byte capacity guard.

## Protocol

Requests are a single JSON object:

```json
{"operation":"read|write|delete","service":"...","account":"...","payload":"optional"}
```

Successful responses preserve the existing backend contract:

```json
{"ok":true,"found":false}
{"ok":true,"found":true,"value":"..."}
{"ok":true}
```

Failures write a generic diagnostic to stderr and exit non-zero. Secrets must never appear in command-line arguments, stderr, logs, or temporary files.

## Security and packaging

- The helper path is resolved relative to the installed package and is never supplied by an API caller.
- The helper binary is committed with a SHA-256 manifest; build and prepare verify the manifest before bundling.
- stdin carries request secrets; stdout is capped by the existing one-megabyte limit and stderr content is not propagated to clients.
- The process keeps the existing ten-second timeout and hidden-window behavior.
- The helper source is committed under `native/windows-credential-helper`; the shipped x64 binary is under `assets/windows`.

## Migration and compatibility

The new backend uses Windows Generic Credentials rather than PowerShell PasswordVault access. Existing affected installations that cannot launch PowerShell cannot reliably migrate old PasswordVault entries, so the first native-helper build may require one fresh login. After that login, credentials persist across restarts through Credential Manager. macOS Keychain behavior is unchanged.

## Verification

- Host-independent Go protocol tests validate target derivation and request constraints.
- TypeScript tests validate helper response handling, process failure, timeout, and session-store behavior.
- A Windows integration probe performs write, read, delete, and missing-read against a unique service name.
- The packaged Electron Node runtime must return HTTP 200 with `logged-out` when no credential exists, persist a test credential, recover it after a new backend instance, and delete it.

