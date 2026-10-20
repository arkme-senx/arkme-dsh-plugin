export interface TimelineRowChunk { id: string; rowIds: string[] }

/** Preserve row parents across prepends and sliding-tail eviction, not just appends. */
export function timelineRowChunks(ids: readonly { id: string }[], previous: readonly TimelineRowChunk[], size: number): TimelineRowChunk[] {
  const owners = new Map(previous.flatMap(chunk => chunk.rowIds.map(id => [id, chunk.id] as const)))
  const chunks: TimelineRowChunk[] = []
  for (const { id } of ids) {
    const owner = owners.get(id)
    let chunk = chunks.at(-1)
    if (!chunk || chunk.rowIds.length >= size || owner !== undefined && owner !== chunk.id) {
      chunk = { id: owner ?? id, rowIds: [] }
      chunks.push(chunk)
    }
    chunk.rowIds.push(id)
  }
  // Insertions inside a full chunk can split its old owner into two pieces.
  const used = new Set<string>()
  for (const chunk of chunks) {
    if (used.has(chunk.id)) chunk.id = chunk.rowIds[0]!
    used.add(chunk.id)
  }
  return chunks
}
