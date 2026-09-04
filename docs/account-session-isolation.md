# DSH Account Session Isolation

Arkme desktop treats one complete `DSH_HOME` as the minimum local conversation isolation unit. The plugin never filters or rewrites DSH's private session files. The client selects an opaque Home container before exposing the Harness window, while the plugin permits authenticated reads and DSH Remote projection only after the client attests that the active container belongs to the current Arkme account.

Login, logout, phone-binding fallback and refresh-token expiry all mutate the credential store through one account-session owner. A scope change uses the Host-only desktop bridge in three steps: `account.scope.prepare` hides the old Harness surface, the owner writes or deletes credentials, and `account.scope.commit` atomically changes the container owner or schedules a client relaunch. Persistence failure calls `account.scope.abort`; commit uncertainty remains fail closed and is recovered by startup attestation.

On first upgraded launch, an existing legacy `dsh/` directory is staged for `current-account-wins` migration and moved only after the prior Harness process exits. A logged-out legacy Home becomes the current guest container. A guest Home with non-blank DSH sessions is claimed whole by the next authenticated account; an empty guest Home returns to that account's prior preferred container when one exists.

The Backend continues to derive `user_id` and `client_id` exclusively from authentication. Each local Home uses `web:<container-ref>` as its stable `profile_ref`, so Backend Runtime uniqueness and snapshot tombstones cannot collapse two Home containers into one Runtime.

## Capability matrix

| Surface | Contract |
| --- | --- |
| Plugin Host | Owns credential transition ordering, account attestation and Remote Host gating. |
| Client/Harness | Owns the container registry, atomic legacy migration, window gate and relaunch recovery. |
| UI | Native “会话空间” menu switches only among containers owned by the active account. |
| Tools | N/A: a model must not switch the local account data root. |
| SDK | N/A: an external plugin must not switch the local account data root. |

The application isolation boundary does not defend against the operating-system user or administrator reading local DSH files directly.
