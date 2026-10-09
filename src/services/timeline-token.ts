import { createCipheriv, createDecipheriv, createHash, createHmac } from 'node:crypto'
import { ArkmePluginError } from './service.js'

/** Confidential, deterministic envelope: stable pagination equality without exposing upstream scope. */
export class TimelineTokenCodec {
  private readonly key: Buffer
  constructor(secret: string, private readonly scope: string) {
    this.key = createHash('sha256').update(secret).update('\0arkme-timeline-v1').digest()
  }
  seal(token: string, purpose: string): string {
    const text = JSON.stringify([this.scope, purpose, token])
    const iv = createHmac('sha256', this.key).update(text).digest().subarray(0, 12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
    return `atw1.${iv.toString('base64url')}.${bytes.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`
  }
  open(token: string, purpose: string): string {
    try {
      if (token.length > 32768) throw new Error('size')
      const [prefix, nonce, data, tag, extra] = token.split('.')
      if (prefix !== 'atw1' || !nonce || !data || !tag || extra !== undefined) throw new Error('shape')
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(nonce, 'base64url'))
      decipher.setAuthTag(Buffer.from(tag, 'base64url'))
      const value: unknown = JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8'))
      if (!Array.isArray(value) || value.length !== 3 || value[0] !== this.scope || value[1] !== purpose || typeof value[2] !== 'string' || !value[2]) throw new Error('scope')
      return value[2]
    } catch {
      throw new ArkmePluginError('chat-timeline-token-invalid', '时间线读取引用无效', false, 400)
    }
  }
}
