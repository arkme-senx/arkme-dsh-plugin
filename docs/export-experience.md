# Folder export performance and progress

The directory export owner reuses opted-in frozen previews for up to 60 seconds, with at most 12 cached selections and four distinct prepares in flight. Identical readers share a request; canceling one reader does not cancel another. Explicit refresh, login identity changes, export execution and recovery invalidate prepared plans. Directory identity and local chain checks still run on each selection. Existing SDK callers request fresh previews unless they opt in.

The UI retains previous counts while the Host validates the current selection. The export action remains disabled until that response arrives. A refresh gets a new snapshot; records created after a frozen snapshot are included by a later incremental export.

Each page contains at most 100 records/removals and is staged in one SQLite transaction. Original files use at most four concurrent workers, with conflicting identities rejected and all writers settled before cleanup. Markdown writes are buffered to about 64 KiB; ordering, file hashing, fsync, atomic replacement, receipts and save confirmation remain unchanged.

Progress reports `preparing`, `syncing`, `writing` and `confirming`. `count` is the number of synchronized records, not a percentage or the final date-filtered output count. The UI uses an indeterminate progress bar and only shows success after the owner returns the verified result. Cancellation remains pending until the request settles. A disconnected request cannot confirm Host cleanup, so the UI reports cancellation requested and the Host rejects new exports/previews until cleanup finishes; durable state is checked on the next export. A directory result may legitimately contain fewer records than were synchronized. ZIP and Arko result-count validation is unchanged.

| Surface | Contract and verification |
| --- | --- |
| UI | Uses the existing export owner; retains counts, gates execution on current validation, displays real phases and cancellation state. Panel tests cover zero-record/deletion-only exports. |
| Public SDK | Optional directory preview/refresh options and optional phase metadata; existing callers and count-only streams remain compatible. An independently installed package consumer verifies types, phases, filtered results and disposal. |
| Host | Existing routes forward validated options to the shared directory owner. HTTP streaming tests cover phases, cancellation and invalid frames. Previews cannot recover a currently running export. |
| Tools | No new business operation. Existing ZIP exports and grants remain unchanged; ZIP count validation is retained. Native directory grants continue to come from the desktop picker. |

Service tests cover page rollback, exact Markdown bytes, attachment verification, bounded concurrency/cache, conflicting identities, failure cleanup, preview invalidation and shared-read cancellation. Desktop measurements and platform acceptance are separate from these deterministic checks; no cloud throughput or cross-platform performance guarantee follows from unit tests.
