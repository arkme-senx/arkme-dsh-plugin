/** Record owners include synthetic Bot owners outside JavaScript's safe integer range. */
export type RecordOwnerId = number | string

export function recordOwnerId(value: unknown): RecordOwnerId {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : 0
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return 0
  const id = BigInt(value)
  if (id > 9223372036854775807n) return 0
  return id <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(id) : value
}

/** Node 22 preserves the original JSON token in reviver context. */
export function parseOwnerJson(text: string): unknown {
  const parse = JSON.parse as (text: string, reviver: (key: string, value: unknown, context: { source?: string }) => unknown) => unknown
  return parse(text, (key, value, context) => {
    if (/(?:^|_)(?:owner|user)_id$/.test(key) && typeof value === 'number' && !Number.isSafeInteger(value)
      && context.source !== undefined && /^[1-9]\d*$/.test(context.source)) return context.source
    return value
  })
}

/** Keep the owner API's numeric wire contract without rounding decimal identifiers. */
export function stringifyOwnerJson(value: unknown): string {
  const json = JSON as typeof JSON & { rawJSON(text: string): unknown }
  return JSON.stringify(value, (key, item: unknown) => {
    if (/(?:^|_)(?:owner|user)_id$/.test(key) && typeof item === 'string'
      && typeof recordOwnerId(item) === 'string') return json.rawJSON(item)
    return item
  })
}
