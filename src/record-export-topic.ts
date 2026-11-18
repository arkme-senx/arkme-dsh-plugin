/** Topic names are metadata, never authored Markdown or HTML. */
export function exportTopicTitle(title: string | undefined): string {
  return (title?.trim() || '未命名主题').replace(/\s+/g, ' ')
}
export function exportTopicMarkdown(title: string | undefined): string {
  const escaped = exportTopicTitle(title)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replace(/[\\`*_{}\[\]()#+.!|~-]/g, '\\$&')
  return `主题：${escaped}\n\n`
}
// Only the server resolves visibility; absent summaries retain legacy output.
export function recordExportTopicMarkdown(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const topic = value as Record<string, unknown>
  if (typeof topic.topic_uid !== 'string' || !topic.topic_uid.trim()) return ''
  return exportTopicMarkdown(typeof topic.title === 'string' ? topic.title : undefined)
}
