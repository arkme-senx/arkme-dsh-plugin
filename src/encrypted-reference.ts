import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/** Local transport reference. Authority is always checked again by the business owner. */
export class EncryptedReferenceCodec {
  constructor(private readonly uniqueCode: () => Promise<string>, private readonly invalid: (cause?: unknown) => Error) {}

  async seal(prefix: string, payload: unknown): Promise<string> {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', await this.key(prefix), iv)
    const bytes = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
    return `${prefix}.${iv.toString('base64url')}.${bytes.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`
  }

  async open(prefix: string, value: string): Promise<Record<string, unknown>> {
    try {
      const parts = value.trim().split('.')
      if (parts.length !== 4 || parts[0] !== prefix || value.length > 16_384) throw this.invalid()
      const decipher = createDecipheriv('aes-256-gcm', await this.key(prefix), Buffer.from(parts[1] ?? '', 'base64url'))
      decipher.setAuthTag(Buffer.from(parts[3] ?? '', 'base64url'))
      const decoded: unknown = JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[2] ?? '', 'base64url')), decipher.final()]).toString('utf8'))
      if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) throw this.invalid()
      return decoded as Record<string, unknown>
    } catch (error) { throw this.invalid(error) }
  }

  private async key(prefix: string): Promise<Buffer> {
    return createHash('sha256').update(await this.uniqueCode()).update(`\0${prefix}`).digest()
  }
}
