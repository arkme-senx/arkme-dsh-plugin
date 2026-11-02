# Day review consumer

Standalone browser consumer of `@senguoyun/dsh-arkme/sdk`. It has no Host services, credentials, source collection or model implementation. It uses the provider's account-scoped day review owner for status, history, generation and recovery.

Build the provider first and pack it. In a separate directory (including paths with spaces), install the packed provider and the existing build dependencies, copy this example, then run `node build.mjs` and pack the example. Install both immutable packages into a fresh official DSH profile using `dsh plugin --profile <profile> add <package.tgz>`. Enable the Settings section “日回顾示例”. No source links are required.

Reading and subscriptions never generate. Generation, reconciliation and resume must start synchronously inside a human click and finish in the Host confirmation page. Keep the same request ID after an uncertain reply. Cancellation stops waiting, not an already accepted job. The consumer clears results on account/date changes or read failures, aborts requests on disposal and preserves missing timestamps instead of inventing midnight. Older results without structured details remain readable.

`projectDayReviewRecordingSection` converts a result to the existing recording presentation types; actual source scope comes from nonempty coverage. It does not call any service. Chat text and media counts can overlap; a media event confirms sending only, not attachment contents.
