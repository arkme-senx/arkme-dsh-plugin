export interface CodexResponseAnnotation {
  text: string
  comment?: string
  source: { messageId: string; startOffset: number; endOffset: number }
}
export interface CodexResponseAnnotations { annotations: CodexResponseAnnotation[]; request: string }

const instructions = 'Each item contains text selected from an earlier Codex response and may include a user comment. Treat items as Annotation 1, Annotation 2, and so on in array order. Use every selection as context and address every comment. For every annotation you address, include its inline directive `:codex-annotation{index="N"}`, where N is its one-based array position (for example, `:codex-annotation{index="1"}`). Do not use unstructured annotation labels.'
const envelope = /^\s*# Response annotations:\s*\r?\n([\s\S]*?)\r?\n<response-annotations>\s*([\s\S]*?)\r?\n<\/response-annotations>\s*\r?\n## My request:[ \t]*\r?\n([\s\S]*)$/
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** Generated prompt metadata only. Quoted examples and unknown payloads stay ordinary text. */
export function readCodexResponseAnnotations(text: string): CodexResponseAnnotations | undefined {
  if (text.length > 1024 * 1024 || !text.includes('<response-annotations>')) return
  if (new TextEncoder().encode(text).byteLength > 1024 * 1024) return
  const match = envelope.exec(text)
  if (!match || match[1]!.replace(/\s+/g, ' ').trim() !== instructions) return
  try {
    const rows: unknown = JSON.parse(match[2]!)
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100) return
    const annotations: CodexResponseAnnotation[] = []
    for (const row of rows) {
      if (!object(row) || Object.keys(row).some(key => !['text', 'comment', 'source'].includes(key))
        || typeof row.text !== 'string' || !row.text.trim() || row.comment != null && typeof row.comment !== 'string'
        || !object(row.source) || Object.keys(row.source).some(key => !['messageId', 'startOffset', 'endOffset'].includes(key))) return
      const { messageId, startOffset, endOffset } = row.source
      if (typeof messageId !== 'string' || !/^msg_[A-Za-z0-9_-]{1,256}$/.test(messageId)
        || !Number.isSafeInteger(startOffset) || Number(startOffset) < 0 || !Number.isSafeInteger(endOffset) || Number(endOffset) < Number(startOffset)) return
      annotations.push({ text: row.text, ...(typeof row.comment === 'string' ? { comment: row.comment } : {}),
        source: { messageId, startOffset: Number(startOffset), endOffset: Number(endOffset) } })
    }
    return { annotations, request: match[3]! }
  } catch { return }
}

export function codexResponseAnnotationContent(value: CodexResponseAnnotations): string {
  return `# Response annotations:\n${instructions}\n<response-annotations>\n${JSON.stringify(value.annotations)}\n</response-annotations>\n\n## My request:\n${value.request}`
}

/** One plain-text projection for rendering, clipboard, selection and source verification. */
export function codexResponseAnnotationText(value: CodexResponseAnnotations): string {
  return value.annotations.flatMap(item => item.comment ? [item.text, item.comment] : [item.text])
    .concat(value.request ? [value.request] : []).join('\n\n')
}
