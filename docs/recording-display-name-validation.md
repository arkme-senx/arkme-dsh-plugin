# Unnamed recording display labels

Baseline: `origin/master` at `1943e705aa6d2824fb634f87f000da2ecbd09798` (v3.0.64).
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

## Validation

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

## Integration note

The branch was rebased onto the baseline above after explicitly fetching the
remote master ref into `origin/master`. Conflicts in
`ArkmeRecordingImportDialog.tsx`, `ArkmeRecordingFiles.tsx` and
`tests/recording-import-dialog.test.tsx` were resolved by combining the display
labels with the baseline's `ArkmeLocalDateTimeInput`, projected delivery end,
final-duration selection and expected-byte display. Both sets of tests remain;
neither component was replaced wholesale. The validation above covers this
integrated result. There are no unresolved conflicts.

Before submission, the four changed production sources were compared with the
accepted tarball's source map; all four matched byte for byte.

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
