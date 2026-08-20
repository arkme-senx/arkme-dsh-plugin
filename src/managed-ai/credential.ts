const MAX_JWT_PAYLOAD_CHARS = 16 * 1024

/** Treat a parseable JWT expiry as a refresh hint; opaque access tokens remain usable. */
export function managedAccessTokenExpiresWithin(
  accessToken: string,
  windowMillis: number,
  nowMillis = Date.now(),
): boolean {
  const payload = accessToken.split('.')[1]
  if (payload === undefined || payload === '' || payload.length > MAX_JWT_PAYLOAD_CHARS) return false
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }
    return typeof value.exp === 'number'
      && Number.isSafeInteger(value.exp)
      && value.exp > 0
      && value.exp * 1000 - nowMillis < windowMillis
  } catch {
    return false
  }
}
