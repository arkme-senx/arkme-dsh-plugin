const MAX_RESPONSE_BYTES = 64 * 1024

export async function readBoundedResponse(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    throw new Error('response exceeds the OpenAPI MCP limit')
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error('response exceeds the OpenAPI MCP limit')
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8')
}
