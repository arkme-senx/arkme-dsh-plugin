# Extension market controls

The marketplace separates three different lifecycle operations:

- install/update writes a verified extension into the current DSH Profile;
- enable/disable changes whether an installed extension should run;
- uninstall removes the installed artifact and Profile dependency.

Author deletion is stronger than unpublishing. The registry uses a soft-delete internally so an operator can restore retained rows and artifacts, but the user-visible operation removes the extension from catalog/owned projections, uninstalls its current local copy, removes linked Cordis and Profile sources, deletes persisted lineage, and invalidates outstanding opaque source references. A required DSH restart is reported explicitly.

`enabled` is the durable desired state. `active` is the current Host runtime
observation. The UI must not infer one from the other, and must surface a
restart requirement when the current DSH process cannot reach the desired
state immediately.

Each materialized local Bundle also contains an atomic `activation.json`
projection. The install-state SQLite database remains the owner; the sidecar is
the boot guard used before extension Host code runs. This prevents a later DSH
package-manager reconciliation from accidentally reactivating a disabled
dependency merely because it remains installed.

## Capability matrix

| Surface | Enable/disable | Complete author deletion | Extension icon management |
| --- | --- | --- | --- |
| DSH Tool | `arkme_extension_set_enabled` with explicit confirmation | `arkme_extension_delete` confirms one exact owned identity and returns cleanup/restart facts | `arkme_extension_icon_set` uses `prepare → later direct human reply → confirm` for exactly one authorized Arkme `image_ref` or current-session-relative `workspace_path`; it does not use an ACK card |
| Public SDK | typed installed-list and enable/disable methods | `deleteExtension()` is restricted by contract to an explicit current human action | `setExtensionIcon()` uploads a local `Blob`; `extensionIconUrl()` returns only a same-origin URL |
| Built-in UI | switch in every installed projection, with busy/error/restart states | one confirmation removes the row from every tab and surfaces manual restart when required | publish, replace, list and detail surfaces share the current `icon_ref` with a generic fallback |
| Host owner | `ArkmeExtensionManager.setEnabled()` owns persistence, Cordis disposal/activation, Profile projection and errors | `ArkmeOwnedExtensionInventory.delete()` coordinates registry soft-delete, install/runtime/Profile cleanup, lineage deletion and opaque-ref invalidation | owns file/image-ref validation, workspace confinement and normalization, signed PUT/GET transport, digest verification and bounded cache invalidation |

The extension registry owns one replaceable icon for each extension identity;
changing it does not create an extension version. Public catalog, detail and
author projections expose only the immutable current `icon_ref`. Upload and
download URLs and headers are short-lived and stay between the registry and
the plugin Host. Browser UI reads through the same-origin image route, while
the model-facing Tool supplies either an account-authorized Arkme `image_ref`
or a relative file path confined to the current Agent session workspace. The
workspace path accepts PNG/JPEG/WebP and a deliberately restricted SVG subset;
Host decoding, metadata stripping, edge/pixel limits and re-encoding happen
before the existing cloud upload owner runs. Absolute paths, traversal,
symlink escapes and SVG external or executable content are rejected.

## Preview gallery MVP coverage

| Surface | Add | Delete/reorder | Read | MVP status |
| --- | --- | --- | --- | --- |
| DSH Tool | `arkme_extension_preview_add` accepts an Arkme `image_ref`, captured latest direct-user attachments, or current-session `workspace_paths`; add uses a fingerprint-bound `prepare → later direct human reply → confirm` flow while delete/reorder retain DSH approval | exact refs plus current revision | owned list/inspect returns ordered safe refs | available |
| Public SDK | `addExtensionPreview()` accepts a local `Blob` | CAS methods require `preview_revision` | `extensionPreviewUrl()` is same-origin | available |
| Built-in UI | local multi-file picker in Edit | staged delete and accessible drag/button reorder | detail gallery through the same-origin route | available |
| Host owner | signed PUT and real-byte verification | owner/revision validation | signed GET, SHA-256 verification and bounded cache | available |

The gallery is extension-owned, independent from versions, limited to 20 PNG/JPEG/WebP images, 320-4096 pixels on both axes and 5 MiB per image. Index zero is the cover. PNG/JPEG/WebP or restricted SVG files can be supplied only by unique relative paths inside the current Agent workspace; the Host rejects traversal and symlink escapes and normalizes SVG to PNG before upload. Prepare captures attachment authorization or workspace paths plus ordered content fingerprints; the user only needs to reply “确认”. Confirm re-reads every source and aborts if target or bytes changed, while a different prepare cannot replace an unconfirmed operation. Browser and model results never contain workspace paths, object keys or signed storage transport.

## GitHub source and read-only sharing

| Surface | GitHub source publication | Share link | Evidence |
| --- | --- | --- | --- |
| DSH Tool | `arkme_extension_publish` accepts an optional repository-root URL and keeps the fixed `github_repository` type inside the Host | `arkme_extension_share` rotates an owned link only after the normal DSH write confirmation | Tool schema and manager tests |
| Public SDK | `publishMyExtension()` accepts `githubRepositoryUrl` and normalizes it without exposing eligibility credentials | `rotateExtensionShare()` returns only `{ref,url}` | SDK consumer tests and emitted declarations |
| Built-in UI | the publish dialog has one optional GitHub URL field and no type selector | published public/private items open a detail view with copy and owner-only rotation controls | server-render and full UI tests |
| Host owner | `ArkmeExtensionManager` validates/normalizes optional provenance once; the registry derives author/importer and gates only its controlled importer context | the same manager validates the registry link before UI, Tool or SDK receives it | manager and authenticated Host-route tests |

Source metadata is an extension-level listing fact and never enters Bundle/source bytes, digests or signatures. Ordinary UI/Tool/SDK publication is always author-owned and never exposes the controlled importer mode. The registry returns `publisher_role`; Host applies the no-write legacy fallback (empty role plus GitHub means importer), enriches the current account nickname/avatar only for authors, and leaves GitHub as a separate source for explicit author rows. Share links display public or private metadata through the Web page only; they do not authorize install, comments, execution or writes. The browser and model never receive internal eligibility tokens, object keys or signed artifact transport.
