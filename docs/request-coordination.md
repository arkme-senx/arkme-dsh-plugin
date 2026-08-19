# Arkme request coordination

All ordinary remote HTTP calls owned by `ArkmeService` pass through the Host-side
`ArkmeRequestCoordinator`. Chat SSE and Arko response streams retain their own
lifecycle and backoff and do not consume the ordinary HTTP budget.

## Lanes and defaults

| Lane | Concurrent | Starts/second | Burst | Queue |
| --- | ---: | ---: | ---: | ---: |
| `auth` | 1 | 4 | 4 | 16 |
| `interactive-read` | 4 | 6 | 10 | 128 |
| `background-read` | 2 | 2 | 4 | 256 |
| `write` | 4 | 5 | 8 | 128 |
| `image` | 4 | 8 | 12 | 256 |

Each upstream service also has a shared default ceiling of 6 concurrent calls,
8 starts/second, a burst of 12, and 512 queued calls. Cache hits, callers that
join an existing request, cooldown skips, and rejected queue overflow do not
consume a remote start.

## Correctness rules

- Only explicitly keyed idempotent reads may join one in-flight Promise or use
  the coordinator TTL cache. Mutations remain unkeyed and are never silently
  deduplicated.
- Keys include the authenticated account scope and semantic request parameters.
  Batch member identifiers are normalized before a key is created.
- Logout and login acceptance advance the account generation, abort old work,
  and prevent stale completions from populating current caches.
- A caller abort does not cancel a keyed request shared by another caller. It
  does cancel its own unkeyed request. Account invalidation cancels both.
- `429` and `503` honor `Retry-After` when present and otherwise pause the whole
  upstream service for five seconds, capped by the response parser at one minute.
- Queue overflow fails closed instead of accumulating an unbounded delay storm.

## Business-owned policies

The coordinator is deliberately unaware of endpoint meaning. `ArkmeService`
selects the lane, semantic key, TTL, failure cooldown, and invalidation boundary.
For example, Chat directory/timeline reads are interactive, SSE projections and
avatar/profile hydration are background reads, and access-token refresh is an
account-scoped auth single-flight.
