import { fileURLToPath } from 'node:url'

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`)
  }
  return value.trim()
}

function safeWebhookUrl(value) {
  const raw = requiredString(value, 'webhookUrl')
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('webhookUrl must be a valid HTTP(S) URL')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username !== '' || parsed.password !== '') {
    throw new Error('webhookUrl must be a credential-free HTTP(S) URL')
  }
  return parsed.toString()
}

async function acceptedPayload(fetchImpl, webhookUrl, body) {
  let response
  try {
    response = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Webhook verification request failed')
  }
  if (!response.ok) throw new Error('Webhook verification request failed')

  let envelope
  try {
    envelope = await response.json()
  } catch {
    throw new Error('Webhook verification returned invalid JSON')
  }
  if (envelope === null || typeof envelope !== 'object') {
    throw new Error('Webhook verification returned an invalid response')
  }
  const payload = envelope.data !== null && typeof envelope.data === 'object'
    ? envelope.data
    : envelope
  if (payload.accepted !== true) throw new Error('Webhook verification was not accepted')
  return payload
}

export async function verifyWebhookBot({
  webhookUrl,
  token,
  message,
  externalMessageId,
  fetchImpl = fetch,
}) {
  const safeUrl = safeWebhookUrl(webhookUrl)
  const safeToken = requiredString(token, 'token')
  const safeMessage = requiredString(message, 'message')
  const safeEventId = requiredString(externalMessageId, 'externalMessageId')
  if (safeEventId.length > 128) throw new Error('externalMessageId must not exceed 128 characters')
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required')

  const body = {
    token: safeToken,
    message: safeMessage,
    external_message_id: safeEventId,
  }
  const first = await acceptedPayload(fetchImpl, safeUrl, body)
  const messageId = typeof first.message_id === 'string' ? first.message_id.trim() : ''
  if (messageId === '') throw new Error('Webhook verification returned no message ID')

  const replay = await acceptedPayload(fetchImpl, safeUrl, body)
  if (replay.deduplicated !== true) throw new Error('Webhook verification replay was not deduplicated')

  return { accepted: true, messageId, deduplicated: true }
}

async function main() {
  const result = await verifyWebhookBot({
    webhookUrl: process.env.ARKME_WEBHOOK_TEST_URL,
    token: process.env.ARKME_WEBHOOK_TEST_TOKEN,
    message: process.env.ARKME_WEBHOOK_TEST_MESSAGE,
    externalMessageId: process.env.ARKME_WEBHOOK_TEST_EVENT_ID,
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    const message = error instanceof Error ? error.message : 'Webhook verification failed'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
