# Extension market controls

The extension center separates three different lifecycle operations:

- install/update writes a verified extension into the current DSH Profile;
- enable/disable changes whether an installed extension should run;
- uninstall removes the installed artifact and Profile dependency.

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

| Surface | Enable/disable | Version and button presentation | Extension icon management |
| --- | --- | --- | --- |
| DSH Tool | `arkme_extension_set_enabled` with explicit confirmation | N/A: no model-facing behavior is added | Blocked until the registry exposes a safe opaque image contract |
| Public SDK | typed installed-list and enable/disable methods | N/A: display-only formatting belongs to the built-in UI | Blocked until the registry exposes a safe opaque image contract |
| Built-in UI | switch in every installed projection, with busy/error/restart states | dark install/update buttons and explicit installed/latest versions | fallback mark only until the registry contract exists |
| Host owner | `ArkmeExtensionManager.setEnabled()` owns persistence, Cordis disposal/activation, Profile projection and errors | existing catalog/update projections | must own validation and signed-upload handling when the server seam exists |

The extension registry currently returns no icon reference in public list or
detail responses. The plugin must not invent a device-local avatar or expose a
signed object-storage URL to the Browser, SDK, or model. The minimum upstream
contract is an extension-owned icon upload session plus a stable opaque icon
reference in catalog projections.
