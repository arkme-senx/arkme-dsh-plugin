# Consumer day digest

`dayDigest()` reads an existing natural-day result and durable job state. It never creates a job, invokes a model, expires a job or repairs a failed attempt. The Provider collects currently authorized recordings, calls, chats and personal/topic records. Consumers receive structured results, coverage and safe evidence references, not the source snapshot or credentials.

```ts
import { createArkmeSdk } from '@senguoyun/dsh-arkme/sdk'
const sdk = createArkmeSdk()
const date = new Date('2026-10-14T00:00:00')
const query = {
  dateStamp: date.getTime(), // absolute timestamp at local midnight
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, // IANA, including DST
  timeZoneOffsetMillis: -date.getTimezoneOffset() * 60000, // east is positive
}
const state = await sdk.dayDigest(query)
const dispose = sdk.subscribeDayDigest(query, render, { onError: clearSensitiveContent })
// Dispose on unmount, date change, account change and logout.
// An error must clear rendered results; stale content is not a privacy fallback.
```

`features.dayDigestRead` advertises reads. `features.dayDigestGeneration` appears only when the backend supports generation for the current account. Without generation, show existing results and disable the button. An older Provider without either feature returns an unsupported empty read state. `generationEnabled` in the state is authoritative for the rendered action.

If an included source changes or becomes inaccessible, reads return `result: null` with `resultUnavailableReason: 'source_access_changed'`. Clear any displayed result, historical version and source detail. The current job and generation capability remain readable so a human can explicitly regenerate. Reading a revoked historical result directly still fails; no older content is substituted.

Call `generateDayDigest({...query, kinds, sources, idempotencyKey})` **synchronously inside a current human click handler**, before awaiting other work. It opens a script-free Host page displaying the exact date, timezone, sources and outputs. Only a separate human confirmation on that page submits the command. Background calls, raw create RPCs, scripted fetches of the confirmation document and replayed confirmation nonces are rejected. The consumer must allow the popup; cancelling the waiting promise stops observation and does not cancel an already accepted job.

Sources are `audio`, `call`, `chat`, `self`; `self` includes personal and topic records. Outputs are `summary` and `timeline`. The idempotency key is required (16–100 letters, digits, underscores or hyphens). Preserve it after an uncertain acknowledgement; changed parameters with the same key are rejected. Reads and subscriptions never retry writes. A terminal failed job requires a new explicit human action and a new key. The Provider permits one active job per account and exposes safe failure codes/messages.

The durable lifecycle is `queued → running → ready / failed`; `stage` distinguishes collection and generation. Restarted workers discover queued jobs. Interrupted running attempts expire to a readable failure rather than silently invoking a model again. Previously completed results remain readable while a new job runs, subject to fresh source authorization. Deleted, edited or restricted evidence hides dependent content until regeneration. `coverage` gives the count and complete/partial/unavailable/empty status for each requested source; `sourceScope` identifies sources actually included. Unsupported attachment material must never be presented as full coverage.

Timeline fields retain the recording semantics: scene, roles, events, mood, todos and representative quotes. Quotes must be continuous substrings of original evidence; other people, bots, forwarded text and unknown recording speakers must not be attributed to the current person. The result includes the explicit natural-day timezone offset. The generation owner reuses the recording prompt/model configuration; there is no general-purpose `askModel` endpoint.

## Migrating an existing UI

Replace the former read RPC with `dayDigest`, the create RPC with `generateDayDigest`, and progress polling with `subscribeDayDigest`. Remove Host subagents, filesystem access and local source aggregation. Keep the existing date selector, tabs, cards and details; render Provider coverage and failure fields. Do not interpret a small generated Host shim as a permission specification.

The [standalone example](../examples/day-digest/README.md) implements this flow using only the public SDK. Its standard DSH package has an inert Host loader entry because the loader imports all activated packages. The entry has no injected Host services or business behavior; all UI and interaction live in the Browser module.

The corresponding model tools are `arkme_day_digest_read` and `arkme_day_digest_generate`. Generation uses the same Host owner and requires a later direct human confirmation of prepared arguments; read and background turns cannot authorize it.
