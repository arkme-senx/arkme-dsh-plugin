# Recording names and upload-state presentation

Baseline and PR target: `origin/dev` at `04b000d12a75d90c191358d4f635966a653ef6d1` (v3.0.64).
Branch: `codex/c20261117-recording-display-name`.

## Behavior and ownership

Device recording sessions can legitimately have an empty `orig_name` even when
their source files have names. The client previously rendered that empty session
name. The UI now preserves every nonblank name and otherwise displays a localized
`Recording <local start date/time>` label. Invalid dates use `Unnamed recording`.
The label is shared by current imports, completed imports, audio files, action
confirmations and accessible descriptions.

For device recordings, each import/completed row represents a recording session,
which can contain multiple source files. The generated label names that session;
it is not a source filename such as `seg_1.jlc3` or `seg_1.wav`. This change does
not alter that list granularity or replace the existing file-oriented headings.

This is presentation only. It does not rename a source file or session, create a
filename extension, infer a recording's device provenance, change deduplication
keys, or write generated labels back to the Host. Mutations still use the original
opaque session/import references. There is no new persistent state, per-record
cache, query, dependency or configuration. Each render lazily creates at most one
date formatter and shares a row's display label across its cells. A subsequent
render uses the current language and timezone. Delete confirmation retains the
original task reference instead of a previously translated label.

The display-name template uses the distinct `录音 {startTime}` translation key.
The existing calendar duration template `录音 {v0}` still translates to
`Recorded {v0}`; filename fallback does not change that separate business meaning.

| Surface | Scope | Evidence |
| --- | --- | --- |
| UI | Required: shared display fallback and action labels | Helper tests, import dialog tests, file list tests, packaged runtime acceptance |
| Host owner | Unchanged: existing recording import and session owners | Regression verifies deletion still submits only the original session reference |
| Tools | N/A: no new Host capability; generated UI labels are not source data | Public Tools contracts unchanged |
| SDK | N/A: no new Host capability; raw filename semantics must remain unchanged | Public SDK contracts unchanged |

## Name-label validation (18d928922)

- Focused regressions after rebase: 122 tests passed across five files, including
  blank/whitespace names, existing names, invalid dates, Chinese/English labels,
  current/completed lists, deletion identity, changing language while confirming
  deletion, formatter allocation for 500 records, timezone changes and the existing
  calendar recording-duration label. Combined cases verify that unnamed sessions
  retain unknown duration/end/size while receiving, confirmed duration/end/size
  when complete, and the server-projected end in the delete confirmation.
- Node 24.22.1: typecheck, build and the full suite passed after rebase;
  18,487 tests passed, 42 skipped (1,609 files passed, 32 skipped).
- The first full-suite attempt overlapped a separate package build and failed in
  a packaging hook. All seven package tests passed in isolation; the complete
  suite then passed with no separate build/pack running concurrently.
- Plugin version and dependency lockfile match the new baseline.
- An immutable `@senguoyun/dsh-arkme` 3.0.64 tarball was installed using the official
  DSH CLI into a fresh temporary profile with a space-containing path. Runtime:
  unmodified official npm DSH 0.2.1-rc.2 on Node 24.22.1, macOS.
- Actual browser acceptance with isolated synthetic API data verified current and
  completed lists, the audio file page and a deletion confirmation. A blank name
  displayed its date/time label; an existing `会议录音.m4a` name was preserved.
  The same browser run verified unknown and final delivery duration, expected
  size and projected end time alongside those names. No production deletion was
  performed. The fixture does not implement the unrelated
  calendar/storage endpoints, so those panels are not acceptance evidence.
- The tarball has 4,290 entries, SHA-256
  `227365f056fc3802f5cd5aff74bf9a7ac43f3a2b6303c091cab2b8b089f77119`.
  It contains no local worktree paths or secret files. Its bundled serialport dependency
  is already declared in the baseline package manifest.
- No DSH source or resident profile was changed. No production deployment or
  Windows/Linux browser acceptance was performed.

## Upload-state simplification and current acceptance

The service's `receivedBytes` counts fully acknowledged source files. It is not
an in-flight byte counter: the session end can be known while the source file is
still unconfirmed. Showing “received 0 B” in the file-size column misrepresented
that distinction. The UI now displays only `expectedBytes` when known, otherwise
an em dash. A confirmed zero remains zero; partial received bytes do not substitute
for an unknown total. Local file sizes retain their existing known-size behavior.

Receiving owner tasks with status `accepted` display “上传中” in both import and
day-file views. Source-file counts and model-derived percentages are omitted from
that receiving status, including its tooltip. Paused, failed, quota, unavailable
and interrupted states remain distinguishable and actionable. Once intake is
complete, the existing speaker-recognition/transcription states remain visible.
The shared formatter adds no state, cache, requests or Host behavior.

Current validation (Node 24.22.1, official DSH 0.2.1-rc.2 on macOS):

- 112 focused tests passed across delivery, import dialog and day-file tests.
  Cases cover unknown totals versus confirmed zero, preserved error/pause states,
  receiving-status text/tooltip/progress, and completed metadata.
- Typecheck and build passed. Full suite: 18,481 passed, 49 skipped, with one
  failure in the recorder runtime dependency suite's package setup. All seven
  tests in that suite passed on an isolated rerun (4.54 seconds). This is not
  recorded as a wholly green single full-suite run.
- The immutable package was installed into a fresh isolated DSH profile using
  the official CLI. Chrome verified receiving and completed rows, original and
  fallback names, audio files and delete confirmation using synthetic data.
- Artifact SHA-256:
  `7e1ed4dca2e285b4de7742dc1f8b68c7fe09bb2377d89e3243c16b605dd7c6e3`.
  Version and lockfile remain unchanged at the dev baseline.
- With the user's authorization, the local resident plugin was updated with this
  package while preserving its credentials, configuration and data. The existing
  browser cookie remained valid. Production account 4 showed two receiving rows
  as “上传中” with unknown sizes as “—”; completed records loaded normally and
  no browser page errors occurred. This was a local plugin update, not a cloud
  service deployment. No production records were deleted.
- Tools/SDK remain N/A because this changes only UI presentation. Host ownership,
  receipt counters, identifiers and upload protocol are unchanged. No DSH source
  was modified. Windows/Linux browser acceptance was not performed; this change
  contains no native or process integration code.

## Integration note

The PR targets `dev`; the diff contains only recording-name and upload-presentation
implementation, regression and validation files. It retains the baseline date/time
input, projected end boundaries, final-duration selection, backend size facts,
mutation identities and recovery actions. No configuration or schema is added.

## Name-formatting diagnostic

A local Node 24 diagnostic compared the reviewed implementation's eight date
formatting calls per history row with the corrected path's two calls (row and
processing details), using one formatter per render. Median results over 12 runs:

| Unnamed records | Before | After |
| --- | ---: | ---: |
| 50 | 11.13 ms | 0.11 ms |
| 500 | 123.39 ms | 0.67 ms |
| 1,000 | 185.43 ms | 1.45 ms |

These measurements cover name computation, not React rendering, browser layout or
an end-to-end page speed guarantee. The regression test enforces bounded formatter
allocation rather than a machine-dependent timing threshold.
