import { describe, expect, it, vi } from 'vitest'
import { verifyWebhookBot } from '../scripts/verify-webhook-bot-mvp.mjs'

function json(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('local Webhook Bot MVP verifier', () => {
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
    for (const call of fetchImpl.mock.calls) {
      expect(call[0]).toBe('https://bot.test/api/public/v1/bot/webhook/raw-id')
      expect(call[1]).toMatchObject({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      expect(JSON.parse(call[1].body)).toEqual({
        token: 'jbot_secret',
        message: 'DSH Webhook MVP verification',
        external_message_id: 'dsh-webhook-mvp-event-1',
      })
    }
    expect(result).toEqual({ accepted: true, messageId: 'message-1', deduplicated: true })
    expect(JSON.stringify(result)).not.toContain('jbot_secret')
    expect(JSON.stringify(result)).not.toContain('raw-id')
  })

  it('rejects unsafe inputs before issuing a request', async () => {
    const fetchImpl = vi.fn()

    await expect(verifyWebhookBot({
      webhookUrl: 'file:///tmp/webhook',
      token: 'jbot_secret',
      message: 'message',
      externalMessageId: 'event-1',
      fetchImpl,
    })).rejects.toThrow('HTTP(S)')
    await expect(verifyWebhookBot({
      webhookUrl: 'https://bot.test/webhook',
      token: '',
      message: 'message',
      externalMessageId: 'event-1',
      fetchImpl,
    })).rejects.toThrow('required')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('redacts transport failure details that may contain verification secrets', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('request to raw-id failed with jbot_secret')
    })

    await expect(verifyWebhookBot({
      webhookUrl: 'https://bot.test/api/public/v1/bot/webhook/raw-id',
      token: 'jbot_secret',
      message: 'message',
      externalMessageId: 'event-1',
      fetchImpl,
    })).rejects.toThrow(/^Webhook verification request failed$/)
  })
})
