# Day digest consumer

This standalone Browser consumer uses only `@senguoyun/dsh-arkme/sdk`. It contributes a “日总结示例” section to official DSH Settings with a date selector, timeline/summary tabs, generation confirmation, coverage, progress and failure display. It does not collect source data or request Host services.

Copy this directory into a separate package directory in an isolated DSH profile containing the packed Provider. Install `react`, TypeScript, `tsdown` and the matching official DSH client type packages as development dependencies. Compile `client.tsx` with strict TypeScript, NodeNext resolution, DOM libraries and `react-jsx`. Run `node build.mjs`, then `npm pack --ignore-scripts`; install the resulting artifact through official `dsh plugin --profile <profile> add <artifact.tgz>`.

The package contains `package.json`, `cordis.patch.yml`, `lib/client.js` and an inert `lib/index.js` required by the standard Host loader. There is no Host data or AI implementation. The SDK is bundled into the browser entry; React uses the official module table. The example requires an HTTP loopback Harness page supporting the Host confirmation flow and a Provider advertising day digest capabilities.

See [the contract and migration guide](../../docs/day-digest.md). Disposing the subscription aborts reads and clears the timer. The example never automatically submits or retries generation; uncertain submission keeps its key until a confirmed receipt.
