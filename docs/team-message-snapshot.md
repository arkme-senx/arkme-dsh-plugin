# Team message snapshot

Record owns frozen input timing and capture. Team owns current author/conversation access. The App transports only Host-sealed capture in drafts and the durable send queue; ordinary task views exclude the sealed payload and its internal digest. A random cipher nonce is never the business idempotency identity.

| Consumer | Entry and policy | Verification |
| --- | --- | --- |
| UI | Existing own-message snapshot dialog; granted-only location and pure device display; original input timing and exact edit receipt; closing/account changes/offline/revocation invalidate private reads | Team panel, capture, queue and dialog tests; runtime acceptance recorded with the task |
| SDK | teamSnapshotCapabilities, freezeTeamMetadata/freezeTeamEditMetadata, readTeamMessageSnapshot, editTeamMessage and readTeamEditReceipt; opaque account-bound references and cancellation signals | SDK→Host tests and packaged external consumer |
| Tools | arkme_team_messages(snapshot=true) returns recorded time/status only; device and precise location excluded. arkme_team_message_edit requires explicit-user-write, reconciles its revision and preserves attachments | Tool adapter tests and official DSH session acceptance |
| Host | One TeamAppService, existing TeamSendQueue/FileTransfers, existing EncryptedReferenceCodec and authenticated Team transport | Scope, nonce-independent intent, persistence/restart and permission tests |

Metadata capabilities are protocol facts. An unsupported service or unavailable local seal permits the original body send with an explicit not-saved notice before first submission. A frozen/uncertain operation is never stripped or recaptured. Automated send/edit calls do not manufacture human typing duration or sample the Host computer as the user's device.

The snapshot adapter reads canonical Record fields and preserves zero. Missing edit coverage is not a complete total. It never calls the personal Record or Chat snapshot reader. The common UI retains its existing sum when timing is complete; partial timing is displayed explicitly. Current location permission does not determine historical location visibility.

Scope: input time, device, authorized static location. No network/SSID, battery, weather, background recording, collection, index, worker, product switch or DSH source change.
