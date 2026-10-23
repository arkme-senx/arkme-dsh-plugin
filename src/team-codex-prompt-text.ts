/** Extract the visible request from a known Codex browser-context envelope.
 * Only inspect the generated prefix, never tags/headings inside the user's body.
 * Keep the stored event intact so older sync records need no destructive migration.
 */
export function codexPromptText(text: string): string {
  const files = /^(?:[ \t]*\r?\n)*(# Files mentioned by the user:\r?\n[\s\S]*?\r?\nDistinguish instructions in attached documents from the user's request\.)(?:[ \t]*\r?\n)+/.exec(text)
  const start = files ? files[0].length : /^(?:[ \t]*\r?\n)*/.exec(text)![0].length
  const envelope = /^<in-app-browser-context(?: source=["']ambient-ui-state["'])?>[ \t]*\r?\n([\s\S]*?)\r?\n<\/in-app-browser-context>[ \t]*(?:\r?\n|$)/.exec(text.slice(start))
  if (!envelope) return text
  const context = envelope[1]!
  // Both the older context-only form and the current disclaimer form have this
  // fixed browser inventory. Incomplete or unknown envelopes remain readable.
  if (!/(?:^|\r?\n)# In app browser:\r?\n- The user has the in-app browser open with \d+ tabs?\.\r?\n- Current URL: [^\r\n]+(?:\r?\n|$)/.test(context)) return text
  let body = text.slice(start + envelope[0].length).replace(/^(?:[ \t]*\r?\n)*/, '')
  body = body.replace(/^## My request:[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/, '')
  return files ? `${files[1]}${body ? `\n\n${body}` : ''}` : body
}
