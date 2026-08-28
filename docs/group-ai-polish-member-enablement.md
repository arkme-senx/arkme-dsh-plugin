# Group AI polish management

Group AI polish is a shared group capability. Any active member may manage it when the chat service returns `can_manage: true`; clients must not infer permission from owner/admin roles or require a group-member-list request.

## Capability matrix

| Surface | Contract |
| --- | --- |
| Tools | `arkme_group_ai_polish_manage` resolves an exact group name, reads status, previews a generated or saved rule, and performs an enable/disable write only after explicit confirmation. |
| SDK | External plugins discover `features.groupAiPolish` and use public methods to query settings, generate or select a rule, and prepare/confirm enable or disable operations. |
| UI | The group header shows the active state and rule. The existing three-dot menu opens a centered rules dialog and conversational rule editor. |
| Host owner | `GroupAiPolishService` owns permission checks, rule selection, confirmation expiry, concurrency control, persistence, cache invalidation, and fresh readback verification for every adapter. |

## Permission and confirmation contract

- The server-provided `can_manage` value is authoritative for every read-modify-write flow.
- Permission is checked again immediately before a confirmed write. A revoked membership or permission cannot reuse an earlier preview.
- Confirmation references are opaque, scoped to the current account, action, and group, and expire after ten minutes.
- A natural-language requirement always generates a preview. It must not silently select an existing rule.
- Enabling a saved rule does not regenerate or upsert it. When selection is ambiguous, the caller must request an exact rule name or opaque rule reference.
- Editing an existing rule records its version at preview time and rejects a concurrent edit instead of overwriting it.
- Saving and enabling are treated as a recoverable two-step operation. If saving succeeds but enabling or verification fails, a retry reuses the saved rule rather than creating a duplicate.
- A positive write response is not sufficient. The Host invalidates cached settings and verifies the enabled state, active rule, and approved rule content with a fresh read.
- Server denial is reported as a permission failure, never as an inability to fetch group members.

## Desktop interaction

- The enabled state and active rule are visible beneath the group title.
- The only settings entry is `AI 表达润色` inside the existing group three-dot menu.
- The centered dialog supports selecting a saved rule, disabling polish, and opening a conversational editor for a new or existing rule.
- Loading, retryable failure, read-only permission, confirmation, success, and partial-write recovery remain scoped to the selected group.
- The editor persists mobile-compatible `rule_thread_messages`, so mobile and desktop can continue the same rule conversation.
- Settings changes replace only the selected group's AI-polish snapshot; they do not reload the conversation timeline.

## Conversation rendering reliability

- A confirmed send replaces only its optimistic message row and writes the same result into the selected conversation cache before the conversation summary advances.
- Realtime deltas merge into the latest rendered timeline instead of replacing restored history with the delta alone.
- Identical in-flight timeline reads are shared. Switching sources or requesting a different page still cancels obsolete work.
- Expected request cancellation is silent. Transient idempotent reads use bounded retries and persistent failures settle into an actionable error state.
- Outgoing message rows retain their existing right-aligned container while text wrapping remains inside the bubble.

## Verification requirements

- Cover ordinary-member success, server denial, revoked permission, ambiguous selection, stale preview, retry after partial success, and fresh readback mismatch at the Host owner.
- Cover Tool discovery, grant, schema, preview/confirmation behavior, and the absence of member-list lookup.
- Compile and exercise the public SDK consumer contract without private imports.
- Cover menu, dialog, editor, row-only send reconciliation, retained timeline history, request single-flight, retry, and error settlement in UI tests.
- Before delivery, run related tests, typecheck, the complete test suite, production build, immutable `.tgz` inspection, and installation into an unmodified official DSH with a fresh temporary Profile.
