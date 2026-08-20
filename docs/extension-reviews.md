# Extension reviews and ratings

Extension review text is written through the normal Arkme Record owner before the review relation is published to the extension registry. The Record therefore appears in the signed-in user's default-category/home flow. The registry owns the public extension relation, parent/reply relation, one current rating per user, and rating aggregates.

Top-level reviews require a 1-5 rating. Replies use an account-bound `reviewRef` and must not carry a rating. Extension authors may reply but cannot rate their own extension. The registry does not add a moderation state; an unavailable or deleted extension is simply not reviewable/listable.

## Capability matrix

| Surface | Read | Write | Evidence |
| --- | --- | --- | --- |
| Host owner | `ArkmeService.listExtensionReviews()` | `ArkmeService.createExtensionReview()` | One implementation owns validation, Record-first ordering, stable IDs, durable recovery, safe refs and error semantics. |
| Built-in UI | Detail rating summary, review tree, pagination | Comment/reply dialog with preserved draft and mutation ID | Client/Host tests and actual extension-detail acceptance. |
| DSH Tools | `arkme_extension_reviews_read` | `arkme_extension_review_create` with explicit-user-write grant and pre-execute confirmation | Tool schema tests plus a real unchanged DSH session discovery/call. |
| Public SDK | `extensionReviews()` | `createExtensionReview()` | Public exports and independent SDK consumer contract test. |

Raw `record_uid`, Bearer tokens, registry internals and signed URLs remain Host-only. UI, Tools and SDK receive `reviewRef` values bound to the current Arkme account and extension.

## Failure and retry contract

The Host stores an account-scoped `extension_review_outbox` operation before creating the Record. A stable Record UID is derived from account, extension, parent and caller-stable mutation ID.

1. Record failure leaves both the normal Record outbox and review operation retryable.
2. Registry failure after Record success leaves the review operation in `failed`/`registry_pending`; the user is told that the home Record exists but detail synchronization is pending.
3. Opening the review list retries pending operations. Registry idempotency on `user_id + client_mutation_id` returns the existing review and repairs a missing current-rating write.
4. Successful registry acknowledgement removes the local review operation.

The registry paginates top-level reviews and returns each selected root with its complete reply tree so a page cannot orphan a reply from its parent.
