# Extension Metadata Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an owner-authorized, durable, idempotent extension metadata update endpoint without changing artifact, version, publication, icon, preview, review, or install contracts.

**Architecture:** `jotmo-extension-publish` remains the sole cloud owner of extension listing metadata. A new publication service method normalizes `name`, `description`, and `private/public` visibility, then delegates one repairable idempotent mutation to the Memory/Mongo store; Gin exposes the result through an explicit safe DTO and metadata-specific numeric error envelope.

**Tech Stack:** Go, Gin, MongoDB driver v2, in-memory repository, existing response envelope and publication service tests.

**Spec:** `docs/superpowers/specs/2026-08-20-extension-market-discovery-and-edit-design.md`

## Global Constraints

- Backend baseline is test `develop@b9776b0`; fetch and branch from the latest `origin/develop` before implementation.
- The only new write path is `POST /api/v1/extensions/metadata/update`.
- Metadata visibility accepts only `private` and `public`; existing `unlisted` read/install behavior remains unchanged.
- Name is trim-normalized and 1–120 Unicode code points; description is trim-normalized, optional, and at most 2000 Unicode code points.
- Only the owner may edit an extension with `status=active` and a non-empty `latest_stable_version`.
- `client_mutation_id` is a UUID and is permanently unique for `(owner_user_id, extension_id, client_mutation_id)`.
- Replays never reapply data or advance `updated_at`; delayed replays never overwrite a newer mutation.
- Wire errors use numeric codes `40021`, `40321`, `40421`, `40921`, `50321` in the existing envelope.
- Do not modify `ExtensionVersion`, `PublishSession`, bundle/source/artifact bytes, signatures, validators, icon/preview binary transport, or resolve-install v1/v2 behavior.

---

### Task 1: Define the metadata domain contract and MemoryStore behavior

**Files:**
- Create: `internal/publication/metadata.go`
- Create: `internal/publication/metadata_test.go`
- Modify: `internal/extension/models.go`
- Modify: `internal/extension/mutation.go`
- Modify: `internal/extension/memory_store.go`
- Modify: `internal/extension/memory_mutation.go`

**Interfaces:**
- Consumes: existing `extension.Extension`, `extension.ValidVisibility`, `extension.ErrNotFound`, `extension.ErrForbidden`, `extension.ErrInvalidState`, `extension.ErrIdempotencyMismatch`.
- Produces: `publication.UpdateExtensionMetadataRequest`, `publication.ExtensionMetadataView`, and `extension.Mutation.UpdateExtensionMetadata(context.Context, UpdateExtensionMetadataInput) (*Extension, bool, error)`.

- [ ] **Step 1: Write the failing publication service tests**

Add table-driven tests that seed `NewMemoryStore()` through the existing publish helper, then call the new service method:

```go
func TestUpdateExtensionMetadataNormalizesAndReplays(t *testing.T) {
    service, store := publishedMetadataFixture(t, extension.VisibilityPrivate)
    request := UpdateExtensionMetadataRequest{
        ExtensionID: "ext_metadata_001",
        Name: "  新名称  ",
        Description: "  新说明  ",
        Visibility: extension.VisibilityPublic,
        ClientMutationID: "9f445b4f-55aa-45c1-9250-25161832d432",
    }
    first, err := service.UpdateExtensionMetadata(context.Background(), 101, request)
    if err != nil { t.Fatal(err) }
    if first.Name != "新名称" || first.Description != "新说明" || first.Visibility != extension.VisibilityPublic {
        t.Fatalf("first=%+v", first)
    }
    firstUpdatedAt := first.UpdatedAt
    replayed, err := service.UpdateExtensionMetadata(context.Background(), 101, request)
    if err != nil { t.Fatal(err) }
    if replayed.UpdatedAt != firstUpdatedAt { t.Fatalf("replay advanced updated_at") }
    if got, _ := store.GetExtension(context.Background(), request.ExtensionID); got.Name != "新名称" {
        t.Fatalf("stored=%+v", got)
    }
}
```

Cover owner mismatch, missing/deleted/suspended/no-stable extension, empty description, overlong name/description, `unlisted`, invalid UUID, same key/different normalized payload, and a new mutation whose normalized data is unchanged.

- [ ] **Step 2: Run the focused tests and confirm the contract is missing**

Run: `go test ./internal/publication -run 'TestUpdateExtensionMetadata' -count=1`

Expected: FAIL because `UpdateExtensionMetadataRequest` and `Service.UpdateExtensionMetadata` do not exist.

- [ ] **Step 3: Add normalized request/result types and the store interface**

Define the service-facing contract in `metadata.go`:

```go
type UpdateExtensionMetadataRequest struct {
    ExtensionID     string `json:"extension_id"`
    Name            string `json:"name"`
    Description     string `json:"description"`
    Visibility      string `json:"visibility"`
    ClientMutationID string `json:"client_mutation_id"`
}

type ExtensionMetadataView struct {
    ExtensionID        string        `json:"extension_id"`
    OwnerUserID        int64         `json:"owner_user_id,omitempty"`
    PackageName        string        `json:"package_name,omitempty"`
    Slug               string        `json:"slug"`
    Name               string        `json:"name"`
    Description        string        `json:"description"`
    Visibility         string        `json:"visibility"`
    Status             string        `json:"status"`
    LatestStableVersion string       `json:"latest_stable_version,omitempty"`
    IconRef            string        `json:"icon_ref,omitempty"`
    UpdatedAt          int64         `json:"updated_at"`
    RatingSummary      extension.RatingSummary `json:"rating_summary"`
}
```

Define the mutation input and interface in `internal/extension/mutation.go`:

```go
type UpdateExtensionMetadataInput struct {
    OwnerUserID     int64
    ExtensionID     string
    ClientMutationID string
    Name            string
    Description     string
    Visibility      string
    RequestedAt     int64
}

UpdateExtensionMetadata(ctx context.Context, input UpdateExtensionMetadataInput) (*Extension, bool, error)
```

Add a `MetadataMutation` model containing owner, extension, client mutation ID, normalized payload, payload hash, `pending/completed` status, requested/applied timestamps, and the last applied extension projection fields required for repair diagnostics.

- [ ] **Step 4: Implement MemoryStore idempotency and stale replay protection**

Add a map keyed by `ownerID + "\x00" + extensionID + "\x00" + clientMutationID`. Under the existing mutex:

```go
if existing := s.metadataMutations[key]; existing != nil {
    if existing.PayloadHash != inputPayloadHash(input) { return nil, false, ErrIdempotencyMismatch }
    return cloneExtension(s.extensions[input.ExtensionID]), true, nil
}
item := s.extensions[input.ExtensionID]
if item == nil { return nil, false, ErrNotFound }
if item.OwnerUserID != input.OwnerUserID { return nil, false, ErrForbidden }
if item.Status != ExtensionStatusActive || item.LatestStableVersion == "" { return nil, false, ErrInvalidState }
if item.Name != input.Name || item.Description != input.Description || item.Visibility != input.Visibility {
    item.Name, item.Description, item.Visibility = input.Name, input.Description, input.Visibility
    item.UpdatedAt = maxInt64(input.RequestedAt, item.UpdatedAt+1)
}
s.metadataMutations[key] = completedMetadataMutation(input, item.UpdatedAt)
return cloneExtension(item), false, nil
```

The stored payload hash must use canonical JSON of normalized fields, not raw request whitespace.

- [ ] **Step 5: Implement the service normalizer and safe projection**

Validate exact extension ID syntax, UUID, name/description rune counts, and `private/public` visibility. Call the mutation once and project only the explicit DTO fields; obtain `rating_summary` through the existing rating summary owner rather than exposing the persistence model.

- [ ] **Step 6: Run the focused tests**

Run: `go test ./internal/publication ./internal/extension -run 'Metadata' -count=1`

Expected: PASS, including replay and no-op `updated_at` assertions.

- [ ] **Step 7: Commit the domain owner**

```bash
git add internal/publication/metadata.go internal/publication/metadata_test.go internal/extension/models.go internal/extension/mutation.go internal/extension/memory_store.go internal/extension/memory_mutation.go
git commit -m "feat: 功能点: 增加扩展资料更新领域能力"
```

### Task 2: Add durable Mongo idempotency and crash repair

**Files:**
- Modify: `internal/extension/mongo_store.go`
- Modify: `internal/extension/mongo_repository.go`
- Modify: `internal/extension/mongo_mutation.go`
- Modify: `internal/extension/mongo_repository_test.go`
- Create: `internal/extension/metadata_store_test.go`

**Interfaces:**
- Consumes: `extension.UpdateExtensionMetadataInput` and `MetadataMutation` from Task 1.
- Produces: the Mongo implementation of `Mutation.UpdateExtensionMetadata` and unique index `idx_metadata_mutation_owner_extension_client`.

- [ ] **Step 1: Write failing BSON/index/repair tests**

Add unit coverage for the unique index keys and helpers that decide replay behavior:

```go
func TestMetadataReplayDecisionNeverOverwritesNewerMutation(t *testing.T) {
    pending := &MetadataMutation{ClientMutationID: "old", RequestedAt: 100, Status: MetadataMutationPending}
    current := &Extension{UpdatedAt: 200, LastMetadataMutationID: "new", LastMetadataMutationAt: 200}
    if got := metadataReplayDecision(pending, current); got != metadataReplayStale {
        t.Fatalf("decision=%v", got)
    }
}
```

Cover already-applied marker, stale mutation, safe pending apply, and same-key payload mismatch.

- [ ] **Step 2: Run the extension package tests and observe failure**

Run: `go test ./internal/extension -run 'Metadata|MongoIndex' -count=1`

Expected: FAIL because the collection/index and replay helpers are absent.

- [ ] **Step 3: Add the metadata mutation collection and indexes**

Extend `MongoStore` with `metadataMutations *mongo.Collection`. Create a permanent unique index:

```go
{Keys: bson.D{
    {Key: "owner_user_id", Value: 1},
    {Key: "extension_id", Value: 1},
    {Key: "client_mutation_id", Value: 1},
}, Options: options.Index().SetUnique(true).SetName("idx_metadata_mutation_owner_extension_client")}
```

Do not add TTL options. Add sparse/default-safe fields `last_metadata_mutation_id` and `last_metadata_mutation_at` to `Extension` so legacy documents decode without migration.

- [ ] **Step 4: Implement repairable pending → apply → completed mutation**

Use this order:

1. Read and authorize the current extension.
2. Insert the normalized pending mutation; on duplicate, reload and compare payload hash.
3. If the extension marker equals this mutation ID, mark the record completed and return current state.
4. If another marker has a later `last_metadata_mutation_at`, mark this mutation completed as stale and return current state without writing.
5. Otherwise compute `appliedAt = max(requestedAt, current.UpdatedAt+1)` and atomically update the exact extension with owner/status/stable guards, metadata fields, marker ID, and marker time.
6. Mark the mutation completed. A crash between steps 5 and 6 is repaired by step 3 on replay.

Use `FindOneAndUpdate(..., options.FindOneAndUpdate().SetReturnDocument(options.After))` so the returned projection is the database fact. Duplicate or zero-match branches must reread before deciding conflict/stale/replay.

- [ ] **Step 5: Run store tests and race tests**

Run: `go test ./internal/extension -run 'Metadata|Mongo' -count=1`

Run: `go test -race ./internal/extension ./internal/publication`

Expected: PASS; concurrent same-key calls return one applied mutation, and delayed old replay preserves the newer values.

- [ ] **Step 6: Commit Mongo durability**

```bash
git add internal/extension/mongo_store.go internal/extension/mongo_repository.go internal/extension/mongo_mutation.go internal/extension/mongo_repository_test.go internal/extension/metadata_store_test.go
git commit -m "feat: 功能点: 持久化扩展资料幂等更新"
```

### Task 3: Expose the authenticated API and exact error envelope

**Files:**
- Modify: `gin/response/response.go`
- Modify: `gin/api/router.go`
- Modify: `gin/api/extensions.go`
- Create: `gin/api/metadata_router_test.go`
- Modify: `internal/publication/service_test.go`

**Interfaces:**
- Consumes: `Service.UpdateExtensionMetadata` and `ExtensionMetadataView` from Task 1.
- Produces: `POST /api/v1/extensions/metadata/update` with metadata-specific numeric errors.

- [ ] **Step 1: Write failing router tests**

Add authenticated tests for success and every numeric code:

```go
func TestMetadataUpdateRouteReturnsSafeProjection(t *testing.T) {
    body := `{"extension_id":"ext_metadata_001","name":"新名称","description":"","visibility":"private","client_mutation_id":"9f445b4f-55aa-45c1-9250-25161832d432"}`
    response := authenticatedRequest(t, router, http.MethodPost, "/api/v1/extensions/metadata/update", body, 101)
    if response.Code != http.StatusOK { t.Fatalf("status=%d body=%s", response.Code, response.Body.String()) }
    assertJSONPath(t, response.Body.Bytes(), "data.extension.name", "新名称")
    assertJSONMissing(t, response.Body.Bytes(), "data.extension.icon_object_key")
}
```

Assert invalid=`40021`, owner/state forbidden=`40321`, missing=`40421`, idempotency conflict=`40921`, injected storage failure=`50321` with HTTP 503.

- [ ] **Step 2: Run router tests and observe the missing route**

Run: `go test ./gin/api -run 'MetadataUpdate' -count=1`

Expected: FAIL with HTTP 404.

- [ ] **Step 3: Add metadata-specific numeric response constructors**

Add named constants and one constructor that preserves the current envelope:

```go
const (
    CodeExtensionMetadataInvalid = 40021
    CodeExtensionMetadataForbidden = 40321
    CodeExtensionMetadataNotFound = 40421
    CodeExtensionMetadataConflict = 40921
    CodeExtensionMetadataUnavailable = 50321
)

func ExtensionMetadataError(httpStatus, code int, message string, cause error) error {
    return NewError(httpStatus, code, message, cause)
}
```

- [ ] **Step 4: Register and implement the handler**

Register only under the authenticated group. Decode the exact request, call the service with `middlewares.UserID(c)`, map service/store sentinels to the five numeric codes, and return:

```go
response.OK(c, gin.H{"extension": result})
```

Do not reuse `mapServiceError` for this endpoint because generic 404/409 codes cannot distinguish unsupported routes from domain failures.

- [ ] **Step 5: Prove future version publication preserves edited listing metadata**

Add a service test that edits the extension, creates/completes a later v1 or v2 publish session using stale request display fields, then asserts stored `Name`, `Description`, `Visibility`, and metadata `UpdatedAt` remain the edited values. The publish may create a version but must not mutate listing metadata.

- [ ] **Step 6: Run API and publication tests**

Run: `go test ./gin/api ./internal/publication -run 'Metadata|Publish.*Preserves' -count=1`

Expected: PASS.

- [ ] **Step 7: Commit the API**

```bash
git add gin/response/response.go gin/api/router.go gin/api/extensions.go gin/api/metadata_router_test.go internal/publication/service_test.go
git commit -m "feat: 功能点: 提供扩展资料编辑接口"
```

### Task 4: Run backend regression and deploy to the test environment

**Files:**
- Test: all Go packages and deployment guard scripts already present in the backend repository.

**Interfaces:**
- Consumes: all backend commits from Tasks 1–3.
- Produces: one test `develop` SHA and successful `TEST_jotmo-extension-publish-backend` Jenkins build for the plugin plan.

- [ ] **Step 1: Run the full backend gates**

Run:

```bash
go test ./...
go test -race ./internal/extension ./internal/publication ./gin/api
go vet ./...
```

Expected: all commands pass.

- [ ] **Step 2: Run focused v1/v2 compatibility regressions**

Run the exact compatibility tests:

```bash
go test ./internal/publication -run 'Test(ServiceAlwaysAcceptsLegacyPublication|ServicePublishesArtifactOnlyV1Client|ServiceCompletesLegacySessionAcrossRestart|NormalServiceStillResolvesPublishedLegacyVersionAfterBundleCutover|NormalServiceResolvesPreSourceLegacyVersionAfterBundleCutover|ServicePublishesAndResolvesBundleV2WithPrivateSource|BundleV2CompleteKeepsUploadingUntilBothObjectsExist|BundleV2RequestRequiresSourceToMatchInstallBundleSnapshot)$' -count=1
```

Expected: PASS, including v1 without source and strict v2 bundle/source equality.

- [ ] **Step 3: Review the branch diff**

Run:

```bash
git diff --check origin/develop...HEAD
git status --short --branch
git diff --stat origin/develop...HEAD
```

Expected: only metadata domain/store/API/tests and optional docs changed; no artifact, signature, validator, icon/preview binary, or install resolver files changed except additive tests.

- [ ] **Step 4: Use the repository’s test deployment workflow**

Push the task branch, merge it into the latest `origin/develop` without force, and trigger the explicit Jenkins job `TEST_jotmo-extension-publish-backend`. Do not touch `master` or production.

- [ ] **Step 5: Verify the deployed contract**

Against the test environment, use a temporary owner extension to verify:

1. private → public makes it enter public catalog;
2. public → private removes it from public catalog but keeps it in my-list;
3. empty description succeeds;
4. same UUID replay preserves `updated_at`;
5. same UUID with changed payload returns numeric `40921`;
6. v1 artifact-only and v2 Bundle resolve-install still succeed.

Clean up only the temporary extension created for this backend smoke test through the existing soft-delete path.
