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
    if ((/(?:^|_)(?:owner|user|team)_id$/.test(key) || key === 'record_owner') && typeof value === 'number' && !Number.isSafeInteger(value)
      && context.source !== undefined && /^[1-9]\d*$/.test(context.source)) return context.source
    return value
  })
}

/** Keep the owner API's numeric wire contract without rounding decimal identifiers. */
export function stringifyOwnerJson(value: unknown): string {
  const json = JSON as typeof JSON & { rawJSON(text: string): unknown }
  return JSON.stringify(value, function (key, item: unknown) {
    // Publication attribution has an explicit decimal-string Team ID contract.
    // Other Team/owner endpoints retain their existing numeric int64 wire form.
    if (key === 'team_id' && (this?.membership_kind === 'owner' || this?.membership_kind === 'member')
      && Number.isSafeInteger(this?.group_join_at)) return item

    if ((/(?:^|_)(?:owner|user|team)_id$/.test(key) || key === 'record_owner') && typeof item === 'string'
      && typeof recordOwnerId(item) === 'string') return json.rawJSON(item)
    return item
  })
}
