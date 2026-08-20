# DSH Webhook Bot MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to list, create, and open Webhook Bots from a normal Arkme-integrated DSH conversation while keeping simulated Webhook delivery strictly in a non-production verification fixture.

**Architecture:** Extend the existing provider-neutral Bot port and opaque-reference flow to accept both `openclaw` and `webhook`. Keep provider-specific behavior at the service boundary: Webhook Bots use the same list/create/chat source flow, while OpenClaw connection rejects non-OpenClaw Bots before reading local runtime configuration. A standalone script simulates an external Webhook request for manual end-to-end verification and is never registered as a DSH tool or shipped in the npm package.

**Tech Stack:** TypeScript 6, Vitest 4, DSH tool modules, Arkme authenticated HTTP APIs, Node.js 22+

**Spec:** `docs/superpowers/specs/2026-08-20-dsh-webhook-bot-mvp-design.md`

## Global Constraints

- Production tools must never output raw `bot_id`, Bot token, or Webhook URL.
- `arkme_bot_create` requires an explicit `provider` of `openclaw` or `webhook` and remains an `explicit-user-write` tool.
- Unknown providers are rejected; they are never guessed or coerced.
- Webhook Bots must not enter the OpenClaw provisioning path.
- Simulated Webhook triggering is a verification fixture only: no production tool, prompt entry, runtime config, or published artifact may expose it.
- Unknown create outcomes are never automatically retried; reconciliation uses `arkme_bots_list`.
- Existing OpenClaw behavior and opaque-reference ownership checks must remain intact.

---

## File Structure

- `src/types.ts`: owns the public Bot provider union and provider-aware Bot summary types.
- `src/tools/ports/bots.ts`: owns the provider-bearing Bot create input used by tools and service.
- `src/arkme-service.ts`: maps API Bot records into safe summaries, creates the requested provider, and fences OpenClaw-only provisioning.
- `src/tools/business/bots/list.ts`: describes the provider-neutral list behavior to the model.
- `src/tools/business/bots/create.ts`: declares the required provider parameter and forwards it unchanged.
- `src/tools/business/bots/connect-openclaw.ts`: describes and preserves the OpenClaw-only boundary.
- `src/tools/prompts/business.ts`: teaches the model to select a provider explicitly and never route Webhook Bots to OpenClaw.
- `tests/arkme-bot-service.test.ts`: verifies HTTP contracts, secret redaction, provider projection, chat opening, and provisioning isolation.
- `tests/arkme-bot-tools.test.ts`: verifies tool schema, output redaction, metadata, prompts, and absence of a production trigger tool.
- `scripts/verify-webhook-bot-mvp.mjs`: non-published external Webhook simulator used only after a user creates and opens a test Bot in DSH.
- `README.md`: documents the production DSH conversation flow and clearly labels the simulator as a local verification command.

---

### Task 1: Generalize the Bot service contract to Webhook providers

**Files:**
- Modify: `src/types.ts`
- Modify: `src/tools/ports/bots.ts`
- Modify: `src/arkme-service.ts`
- Test: `tests/arkme-bot-service.test.ts`

**Interfaces:**
- Consumes: authenticated Bot endpoints already used by `ArkmeService`: `POST /api/v1/bot/list`, `POST /api/v1/bot/create`, and `POST /api/v1/bot/private-chat/open`.
- Produces: `ArkmeBotProvider = 'openclaw' | 'webhook'` and `ArkmeBotCreateInput { name; provider; description?; avatar? }`.
- Produces: provider-preserving `listBots`, `createBot`, and provider-fenced `connectOpenClawBot` behavior used by Task 2.

- [ ] **Step 1: Write failing service tests for mixed provider listing**

Add a test whose mocked `/api/v1/bot/list` response contains one OpenClaw Bot and one Webhook Bot:

```ts
it('projects owned OpenClaw and Webhook Bots without exposing raw ids', async () => {
  const service = botService(async input => {
    expect(String(input)).toContain('/api/v1/bot/list')
    return json({ code: 200, data: { bots: [
      { bot_id: 'openclaw-1', name: '本地助手', provider: 'openclaw', status: 'online', direct_chat_available: true },
      { bot_id: 'webhook-1', name: '回调测试', provider: 'webhook', status: 'default', direct_chat_available: true },
    ] } })
  })

  const result = await service.listBots()
  expect(result.items.map(item => [item.name, item.provider])).toEqual([
    ['本地助手', 'openclaw'],
    ['回调测试', 'webhook'],
  ])
  expect(JSON.stringify(result)).not.toContain('openclaw-1')
  expect(JSON.stringify(result)).not.toContain('webhook-1')
})
```

Use the test file's existing session, response, and service helpers rather than introducing duplicate fixtures.

- [ ] **Step 2: Write failing service tests for provider-aware creation**

Add two table-driven cases that assert the exact request provider and safe result:

```ts
it.each(['openclaw', 'webhook'] as const)('creates a %s Bot with an opaque result', async provider => {
  const requests: Array<Record<string, unknown>> = []
  const service = botService(async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)))
    return json({ code: 200, data: {
      bot: { bot_id: `${provider}-raw`, name: '测试 Bot', provider, status: 'default', direct_chat_available: true },
      token: 'jbot_secret_value',
      webhook_url: 'https://bot.test/api/public/v1/bot/webhook/raw',
    } })
  })

  const result = await service.createBot({ name: '测试 Bot', provider })
  expect(requests).toEqual([{ name: '测试 Bot', provider, description: '', avatar: '' }])
  expect(result.bot.provider).toBe(provider)
  expect(JSON.stringify(result.bot)).not.toContain('raw')
  expect(JSON.stringify(result.bot)).not.toContain('jbot_')
  expect(JSON.stringify(result.bot)).not.toContain('webhook_url')
})
```

Adapt the expected body to the existing service's established omission rules; preserve its current optional-field contract rather than changing unrelated serialization.

- [ ] **Step 3: Write a failing provider-fence test for OpenClaw connection**

```ts
it('rejects a Webhook Bot before invoking the OpenClaw provisioner', async () => {
  const provision = vi.fn()
  const service = botServiceWithBots([
    { bot_id: 'webhook-1', name: '回调测试', provider: 'webhook', status: 'default', direct_chat_available: true },
  ], { provision })
  const botRef = (await service.listBots()).items[0]!.botRef

  await expect(service.connectOpenClawBot(botRef)).rejects.toMatchObject({
    code: 'bot-provider-mismatch',
  })
  expect(provision).not.toHaveBeenCalled()
})
```

- [ ] **Step 4: Run the new service tests and verify they fail for the intended reasons**

Run:

```bash
pnpm vitest run tests/arkme-bot-service.test.ts
```

Expected: FAIL because `ArkmeBotProvider` only accepts `openclaw`, `createBot` hardcodes `provider: 'openclaw'`, and list mapping excludes Webhook records.

- [ ] **Step 5: Extend the types and create input**

In `src/types.ts`:

```ts
export type ArkmeBotProvider = 'openclaw' | 'webhook'
```

In `src/tools/ports/bots.ts`:

```ts
import type { ArkmeBotProvider } from '../../types.js'

export interface ArkmeBotCreateInput {
  name: string
  provider: ArkmeBotProvider
  description?: string
  avatar?: string
}
```

- [ ] **Step 6: Implement provider-aware service mapping and creation**

In `ArkmeService.listBots`, accept only exact known provider strings:

```ts
const provider = stringValue(raw.provider).trim()
if (provider !== 'openclaw' && provider !== 'webhook') continue
items.push(await this.botSummaryFromData(raw, session.userId))
```

In `createBot`, validate and forward `input.provider`:

```ts
const provider = input.provider
if (provider !== 'openclaw' && provider !== 'webhook') {
  throw new ArkmePluginError('bot-provider-unsupported', 'Bot Provider 不受支持', false, 400)
}

data = await this.authenticatedBotPost<Record<string, unknown>>(
  '/api/v1/bot/create', { name, provider, description, avatar }, session, options.signal,
)
```

Update `botSummaryFromData` to preserve the validated provider instead of requiring `openclaw`. Preserve all existing opaque-reference sealing and token handling.

- [ ] **Step 7: Fence OpenClaw provisioning before secret or profile access**

After resolving the owned Bot from `listBots`, add:

```ts
if (bot.provider !== 'openclaw') {
  throw new ArkmePluginError(
    'bot-provider-mismatch',
    '只有 OpenClaw Bot 可以连接本地 OpenClaw',
    false,
    400,
  )
}
```

This check must run before `openClawProvisioner === undefined`, `resolveBotConnectionMetadata`, or `revealBotSecret`, so a Webhook Bot never touches local OpenClaw state.

- [ ] **Step 8: Run service tests**

Run:

```bash
pnpm vitest run tests/arkme-bot-service.test.ts tests/openclaw-provisioner.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit the service contract**

```bash
git add src/types.ts src/tools/ports/bots.ts src/arkme-service.ts tests/arkme-bot-service.test.ts
git commit -m "feat(bot): support Webhook Bot provider"
```

---

### Task 2: Expose provider-aware Bot management in DSH conversations

**Files:**
- Modify: `src/tools/business/bots/list.ts`
- Modify: `src/tools/business/bots/create.ts`
- Modify: `src/tools/business/bots/connect-openclaw.ts`
- Modify: `src/tools/prompts/business.ts`
- Test: `tests/arkme-bot-tools.test.ts`

**Interfaces:**
- Consumes: `ArkmeBotCreateInput.provider` and provider-aware service behavior from Task 1.
- Produces: `arkme_bot_create` schema with required `provider`, provider-neutral list/chat instructions, and an OpenClaw-only connection instruction.
- Produces: a production catalog with no simulated Webhook trigger tool.

- [ ] **Step 1: Write failing tool-schema and forwarding tests**

Update the fake `createBot` port and add:

```ts
it('requires an explicit provider when creating a Bot', async () => {
  const ports = fakePorts()
  const tool = moduleFor('arkme_bot_create')!.create(ports)

  expect(tool.parameters).toMatchObject({
    properties: {
      provider: { enum: ['openclaw', 'webhook'] },
    },
    required: expect.arrayContaining(['name', 'provider']),
  })

  await tool.execute(
    { name: '回调测试', provider: 'webhook', description: '验证回调' },
    { callId: 'create-webhook-1', signal: new AbortController().signal } as never,
  )
  expect(ports.createBot).toHaveBeenCalledWith(
    { name: '回调测试', provider: 'webhook', description: '验证回调' },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  )
})
```

- [ ] **Step 2: Write failing prompt and catalog-boundary tests**

```ts
it('describes both providers without registering a Webhook simulator', () => {
  const list = moduleFor('arkme_bots_list')!.create(fakePorts())
  const create = moduleFor('arkme_bot_create')!.create(fakePorts())
  const connect = moduleFor('arkme_bot_openclaw_connect')!.create(fakePorts())
  const names = businessToolModules.map(module => module.meta.toolName)

  expect(list.description).toContain('Webhook')
  expect(create.description).toContain('provider')
  expect(connect.description).toContain('OpenClaw Bot')
  expect(ARKME_BUSINESS_TOOL_PROMPT).toContain('webhook')
  expect(names.some(name => name.includes('webhook') && name.includes('trigger'))).toBe(false)
  expect(names.some(name => name.includes('webhook') && name.includes('send'))).toBe(false)
})
```

- [ ] **Step 3: Run the tool tests and verify they fail**

Run:

```bash
pnpm vitest run tests/arkme-bot-tools.test.ts
```

Expected: FAIL because the create tool has no `provider` parameter and descriptions remain OpenClaw-only.

- [ ] **Step 4: Add the required provider parameter and forward it unchanged**

In `create.ts`:

```ts
parameters: {
  name: { type: 'string', required: true, description: 'Human-visible Bot name.' },
  provider: {
    type: 'string',
    required: true,
    enum: ['openclaw', 'webhook'],
    description: 'Bot runtime provider. Choose explicitly from openclaw or webhook.',
  },
  description: { type: 'string', description: 'Short description of what this Bot should do.' },
},
```

Forward the validated tool argument:

```ts
const result = await ports.createBot(
  {
    name: args.name,
    provider: args.provider,
    ...(args.description === undefined ? {} : { description: args.description }),
  },
  { signal: exec.signal },
)
```

Use the exact schema shape supported by the installed `@deepseek-ai/dsh-tools`; if its string schema expresses allowed values with `choices` rather than `enum`, update the test and implementation together to the library's real type without weakening the two-value restriction.

- [ ] **Step 5: Make list, create, connection, and prompt copy provider-aware**

Required semantic content:

```text
arkme_bots_list: lists owned OpenClaw and Webhook Bots.
arkme_bot_create: requires the human/model to select openclaw or webhook explicitly.
arkme_bot_openclaw_connect: accepts only an owned OpenClaw Bot.
system prompt: list first, never guess provider or bot_ref, never connect Webhook to OpenClaw,
and never automatically retry an uncertain create.
```

Do not mention or advertise the local Webhook simulator in production prompt text.

- [ ] **Step 6: Run tool and catalog tests**

Run:

```bash
pnpm vitest run tests/arkme-bot-tools.test.ts tests/tools/catalog.test.ts tests/tools/registrar.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the DSH conversation tools**

```bash
git add src/tools/business/bots/list.ts src/tools/business/bots/create.ts src/tools/business/bots/connect-openclaw.ts src/tools/prompts/business.ts tests/arkme-bot-tools.test.ts
git commit -m "feat(tools): manage Webhook Bots from DSH chat"
```

---

### Task 3: Add a non-production Webhook verification fixture

**Files:**
- Create: `scripts/verify-webhook-bot-mvp.mjs`
- Modify: `README.md`
- Test: `tests/webhook-bot-fixture.test.ts`
- Verify: `package.json`

**Interfaces:**
- Consumes: a user-created Webhook Bot's `webhook_url` and token supplied explicitly as local process environment variables for one verification run.
- Produces: a script that sends the same unique `external_message_id` twice and reports only safe receipt metadata.
- Produces: manual DSH verification instructions that use `arkme_bot_chat_open` and `arkme_source_read` for the production half of the closed loop.

- [ ] **Step 1: Write a failing fixture contract test**

Structure the script so its pure entry point can be imported without executing the CLI:

```ts
it('sends one event twice and reports acceptance plus deduplication without secrets', async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(json({ code: 200, data: { accepted: true, message_id: 'message-1' } }))
    .mockResolvedValueOnce(json({ code: 200, data: { accepted: true, deduplicated: true } }))

  const result = await verifyWebhookBot({
    webhookUrl: 'https://bot.test/api/public/v1/bot/webhook/raw-id',
    token: 'jbot_secret',
    message: 'DSH Webhook MVP verification',
    externalMessageId: 'dsh-webhook-mvp-event-1',
    fetchImpl,
  })

  expect(fetchImpl).toHaveBeenCalledTimes(2)
  expect(result).toEqual({ accepted: true, messageId: 'message-1', deduplicated: true })
  expect(JSON.stringify(result)).not.toContain('jbot_secret')
  expect(JSON.stringify(result)).not.toContain('raw-id')
})
```

- [ ] **Step 2: Run the fixture test and verify it fails**

Run:

```bash
pnpm vitest run tests/webhook-bot-fixture.test.ts
```

Expected: FAIL because `scripts/verify-webhook-bot-mvp.mjs` does not exist.

- [ ] **Step 3: Implement the pure verifier and CLI wrapper**

Export this interface from the `.mjs` module:

```js
export async function verifyWebhookBot({
  webhookUrl,
  token,
  message,
  externalMessageId,
  fetchImpl = fetch,
})
```

Validate that URL uses HTTP(S), all strings are non-empty, and the event ID is at most 128 characters. POST exactly this body twice:

```js
{
  token,
  message,
  external_message_id: externalMessageId,
}
```

Require the first response to contain `accepted: true` and a non-empty `message_id`. Require the second response to contain `accepted: true` and `deduplicated: true`. Return only:

```js
{ accepted: true, messageId, deduplicated: true }
```

The CLI reads:

```text
ARKME_WEBHOOK_TEST_URL
ARKME_WEBHOOK_TEST_TOKEN
ARKME_WEBHOOK_TEST_MESSAGE
ARKME_WEBHOOK_TEST_EVENT_ID
```

It prints only the safe returned object. It must never print the URL, token, request body, or response headers, including on error.

- [ ] **Step 4: Document the manual closed-loop verification**

Add a README section explicitly labeled “本地临时验收，不属于生产插件能力”:

```text
1. In DSH chat, list Bots.
2. Explicitly create provider=webhook with a unique test name.
3. Open its private chat and keep the source_ref.
4. Run scripts/verify-webhook-bot-mvp.mjs with local test URL/token environment variables.
5. In DSH chat, read the same source_ref and confirm exactly one test message.
6. Confirm the script reported deduplicated=true for the replay.
```

State that the script is not a DSH tool and is absent from the package's `files` list.

- [ ] **Step 5: Run fixture tests and publication-boundary checks**

Run:

```bash
pnpm vitest run tests/webhook-bot-fixture.test.ts
pnpm pack --dry-run
```

Expected: the test passes, and the dry-run file list does not contain `scripts/verify-webhook-bot-mvp.mjs` or `tests/webhook-bot-fixture.test.ts`.

- [ ] **Step 6: Commit the verification fixture**

```bash
git add scripts/verify-webhook-bot-mvp.mjs tests/webhook-bot-fixture.test.ts README.md
git commit -m "test(bot): add local Webhook closed-loop verifier"
```

---

### Task 4: Run full verification and inspect the production boundary

**Files:**
- Verify only; modify earlier task files only if a failing check reveals a defect covered by the spec.

**Interfaces:**
- Consumes: all production and fixture behavior from Tasks 1-3.
- Produces: a passing repository verification result and evidence that the simulator is absent from production tools and package artifacts.

- [ ] **Step 1: Run focused tests together**

```bash
pnpm vitest run tests/arkme-bot-service.test.ts tests/arkme-bot-tools.test.ts tests/webhook-bot-fixture.test.ts tests/tools/catalog.test.ts tests/tools/registrar.test.ts tests/openclaw-provisioner.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run static checks**

```bash
pnpm typecheck
pnpm build
```

Expected: both commands exit 0.

- [ ] **Step 3: Run the full test suite**

```bash
pnpm test
```

Expected: PASS with no unexpected skipped or failed tests.

- [ ] **Step 4: Inspect tool and build output for forbidden trigger capability**

```bash
rg -n "webhook.*(trigger|send)|simulate.*webhook" src lib
pnpm pack --dry-run
```

Expected: no production tool/prompt match that exposes simulated Webhook triggering; package file list excludes `scripts/verify-webhook-bot-mvp.mjs`, tests, local URLs, and test tokens. Matches in safe comments or error copy must be inspected rather than accepted automatically.

- [ ] **Step 5: Inspect diff and repository status**

```bash
git diff --check
git status --short
git log --oneline -5
```

Expected: no whitespace errors; only intentional changes remain; Tasks 1-3 have distinct commits.

- [ ] **Step 6: Record verification evidence in the handoff**

Report the exact commands and outcomes, the production tool names, the fixture path, and the fact that a live end-to-end Webhook run still requires user-supplied test credentials and a running DSH/Bot environment. Do not claim live callback success unless that run actually completed.
