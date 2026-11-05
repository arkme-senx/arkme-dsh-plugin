# Ordinary edit history

Record owns accepted immutable revisions. Chat verifies active membership and the exact visible relation before forwarding a query. The plugin and mobile reuse the existing history cards and snapshot interaction.

`cursor_version: 0` starts a version-ordered page; a positive cursor selects strictly older versions. The returned continuation equals the last visible version. `revision_uid` selects one revision of that record and is mutually exclusive with page cursors. Server version, not device time, orders history. Published timestamp pagination remains available to existing callers.

New human submissions freeze a stable revision identity and the editor's `{nickname, avatar}` before asynchronous work. Plugin recovery reads the formal write receipt for that identity, including when a later edit has already changed the current body. It never resends an uncertain write or decides success by comparing today's content. Existing pending operations lacking an identity retain their original recovery semantics.

`edit_duration_known` distinguishes a measured zero from an absent measurement. The published update duration remains cumulative; Record freezes the single-operation delta against the accepted base. An explicit edit plus AI polish counts human time only once, on the final accepted revision. Automatic processing remains separate. Incomplete cumulative coverage cannot become complete after a later known edit.

Only version 1 establishes creation facts. Missing historical capture is not filled from retained current metadata. Snapshot completion uses the human capture clock independently of server edit time. Location enrichment and its cache must explicitly identify the requested revision. Complete revision history and memory snapshots are private to the Record owner. Other chat members use the normal message reader and its existing publication/version checks; a readable current message never grants access to historical bodies. The edited marker remains visible without a history action for other authors.

| Surface | Existing owner and entry | Verification |
| --- | --- | --- |
| UI | History cards, version pagination and each card's memory snapshot menu | Service/UI tests, an isolated browser fixture, and the original menu/composer/save/history/snapshot components connected through Host HTTP to real Chat/Record/Mongo; pagination, exact selection, failed read/retry and measured-zero display |
| Tools | `arkme_record_history`, normal read grant, opaque source/message action refs | Registered official DSH session discovers and invokes the packed Tool; unauthenticated denial and private output redaction |
| SDK | `recordEditHistory` and `recordRevisionSnapshot`; `recordEditHistoryV1` capability | External consumer compiles against the installed public package and verifies cursor/exact identity, zero, cancellation and unsupported Provider |
| Host | One `RecordEditHistoryService`, existing account/source reference checks and Chat snapshot projection | Exact identity, order, privacy and account-switch tests; real isolated Mongo transaction tests in Record |

The official DSH and standalone browser mechanism adapters supply synthetic reads without production credentials or writes. The cross-repository acceptance in `record-edit-history-acceptance.md` additionally connects the original edit/history UI and Host to real authenticated isolated Chat/Record/Mongo owners. Directory shell and profile identity remain synthetic; edit acceptance, revisions and visibility checks use the actual business owners. No collection, index, product configuration or rollout switch is added.
