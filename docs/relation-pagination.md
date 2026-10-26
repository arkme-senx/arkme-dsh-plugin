# Relation directory paging

The existing relation page uses the same `ExploreService` owner as the public
`relationPage` SDK method and `arkme_relation_pages` Tool. Its layout, copy,
controls, scroll continuation and read-cache behavior are unchanged.

- A cold `explore.list` read requests 50 entities from the versioned directory.
  Continuation uses an opaque account/query/snapshot cursor, not a local slice
  of a downloaded directory.
- The existing page requests a separate lightweight summary for the same
  snapshot. `total` counts the complete matching directory; filter counts cover
  all visible entity types. Counts are carried with the page cursor, so later
  pages do not repeat the summary query. A refresh obtains fresh counts.
- Restoring an already loaded window honors its requested size, up to the
  existing 10,000-row limit, using owner requests of at most 100 rows each.
  Partial failures remain failures; the browser keeps its previous read cache.
- Name, alias and current contact-remark searches run at the owner. Empty
  intermediate search windows are continued with cancellation, snapshot and
  repeated-cursor checks. A bounded read may still return `searchPending` and a
  continuation cursor; an empty intermediate page is not an empty directory.
- SDK callers can use `relationPage({ includeCounts: true })`. Tool callers use
  `action: "list", include_counts: true`. Without counts the existing lightweight
  contract remains available; `totalKnown: false` means no exact total.
- Older owners without the paging/count protocol retain the existing directory
  fallback. Network failures, invalid responses and expired continuation cursors
  are not converted to an empty success or a full-directory fallback.

The count owner must expose `POST /api/v1/relation/entities/summary` with
`snapshot`, `query` and `entity_types`. Its response is
`{ protocol_version: 2, snapshot, total, type_counts }`, where `type_counts`
contains global visible counts keyed by entity type. It must apply the same
account, visibility, snapshot and search rules as the directory.

The separate unified people directory retains its complete identity-joining
contract. This change does not reinterpret a partial relation page as a complete
set of contact or speaker associations.
