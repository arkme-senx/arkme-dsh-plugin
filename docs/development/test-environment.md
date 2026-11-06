# Local test environment

Use Node 24 for local development, matching the test and release workflows. With
nvm installed, run `nvm install` and `nvm use` from the repository root; `.nvmrc`
selects the same major version as CI. The package's supported runtime range is
unchanged. Use the pnpm version declared in `package.json`.

Run the regular suite with `pnpm test`. The root Vitest configuration disables
Node's native Web Storage in test workers so jsdom supplies browser-scoped
`localStorage` and `sessionStorage`, including on Node 25+. This does not change
the plugin runtime or build process and does not require a global `NODE_OPTIONS`.

The worker option is intentional: passing the flag only to the Node process
that starts Vitest does not reliably configure its workers. A native storage
file is not a substitute for jsdom storage and would introduce persistent state
into browser tests. The storage environment regression test checks the real
Storage implementation, read/write/remove/clear behavior, and separate local
and session stores.

Custom `--config` suites (including Harness browser E2E configurations) use their
own environment configuration; they do not inherit the root configuration.
Keep storage isolation on the Node workers for jsdom tests, not in production
browser code or by replacing storage methods with no-op mocks.
