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
| DSH Tool | `arkme_extension_set_enabled` with explicit confirmation | N/A: no model-facing behavior is added | `arkme_extension_icon_set` accepts only an Arkme `image_ref` and requires confirmation |
| Public SDK | typed installed-list and enable/disable methods | N/A: display-only formatting belongs to the built-in UI | `setExtensionIcon()` uploads a local `Blob`; `extensionIconUrl()` returns only a same-origin URL |
| Built-in UI | switch in every installed projection, with busy/error/restart states | dark install/update buttons and explicit installed/latest versions | publish, replace, list and detail surfaces share the current `icon_ref` with a generic fallback |
| Host owner | `ArkmeExtensionManager.setEnabled()` owns persistence, Cordis disposal/activation, Profile projection and errors | existing catalog/update projections | owns file/image-ref validation, signed PUT/GET transport, digest verification and bounded cache invalidation |

The extension registry owns one replaceable icon for each extension identity;
changing it does not create an extension version. Public catalog, detail and
author projections expose only the immutable current `icon_ref`. Upload and
download URLs and headers are short-lived and stay between the registry and
the plugin Host. Browser UI reads through the same-origin image route, while
the model-facing Tool can only supply an account-authorized Arkme `image_ref`.
