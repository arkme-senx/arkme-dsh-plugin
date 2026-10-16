# Extension execution modes and publication checks

The package contract determines execution, not the size of `lib/index.js`. A generated Host shim loads and evaluates the separately stored Host source; it is not proof that the extension has no Host code or no injected services.

| Route | Execution contract | Packaging restrictions |
| --- | --- | --- |
| V2 sandbox bundle | Provider-controlled Host VM and Browser closure, guarded Cordis lifecycle/service facade | No runtime dependencies, optional dependencies, bundled dependencies, install scripts, `bin`, unsupported peer dependencies or native addons |
| V3 native profile bundle | Standard Profile package installation and native plugin loader, with declared native capabilities and separate review | Follow the native bundle contract and installation preview; do not disguise native code as a V2 sandbox artifact |

The V2 Host VM does not provide raw Node globals such as `process`, `Buffer`, `require`, unrestricted code generation, global fetch or global timers. Its facade can expose declared Cordis services and existing guarded service lookup; whether a particular service is available depends on the runtime, installation and injection contract. Therefore `ctx.fs` or `ctx.subagents` cannot be declared universally supported or universally absent from the shim alone. The Browser closure also shadows unsupported globals and exposes its documented Browser lifecycle and own-package RPC.

For data consumers, use the public Browser SDK. Credentials, raw source aggregation and AI business logic belong to the Provider. The day digest consumer needs no Host subagent or filesystem service.

V2 package validation now lists all manifest-level unsupported requirements in one readable error, while retaining the stable error code for the first failing rule. For example, a package with `dependencies`, `bin` and `scripts` reports all three together. This is a packaging diagnostic, not a complete static proof of every JavaScript capability: runtime guards and model/security review still apply. Use the route returned by `myExtensions()`; do not assume every owned package is sandbox-publishable.

`arkme_extension_publish({ action: 'status' })` reads the current conversation's pending confirmation and returns the deadline, remaining seconds, item count, `canConfirm` and next action. The default window remains ten minutes. Reading status never extends it. At or after the deadline, refresh the owned-extension list, prepare the exact current package again, and obtain a new direct human confirmation. Already accepted publication sessions are queried through the separate publish-session status/recovery capability; market `inspect` is not a publication job query.
