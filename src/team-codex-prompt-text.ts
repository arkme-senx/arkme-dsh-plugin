import { readCodexResponseAnnotations, codexResponseAnnotationText, type CodexResponseAnnotations } from './team-codex-response-annotations.js'

/** Only the generated all-image attachment envelope; ordinary file prose stays intact. */
function imageAttachmentPromptText(input:string):string {
  const prefix=/^\s*# Files mentioned by the user:\r?\n([\s\S]*?)\r?\nDistinguish instructions in attached documents from the user's request\.[ \t]*(?:\r?\n)+/.exec(input)
  let rest=input
  if(prefix){
    const files=prefix[1]!.replace(/(?:^|\r?\n)## [^\r\n]+\r?\nImage attachment: true[ \t]*(?=\r?\n|$)|\[图片仅本人可见\]/g,'').trim()
    if(files||!prefix[1]!.trim())return input
    rest=input.slice(prefix[0].length)
  }else{
    const safe=/^\s*\[图片仅本人可见\][ \t]*(?:\r?\n)+(?=## My request:)/.exec(input)
    if(!safe)return input
    rest=input.slice(safe[0].length)
  }
  const request=/^## My request:[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/.exec(rest)
  if(!request&&!(prefix&&readCodexResponseAnnotations(rest)))return input
  return rest.slice(request?.[0].length??0).replace(/(?:\s*<image name=\[Image #\d+\] path="[^"\r\n]+">[ \t\r\n]*<\/image>|\s*\[图片仅本人可见\])+\s*$/,'').trimEnd()
}

/** Extract the visible request from a known Codex browser-context envelope.
 * Only inspect the generated prefix, never tags/headings inside the user's body.
 * Keep the stored event intact so older sync records need no destructive migration.
 */
function browserPromptText(text: string): string {
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

export interface CodexQuestionReply { question: string; answer: string }
export interface CodexPromptPresentation { text: string; replies?: CodexQuestionReply[]; responseAnnotations?: CodexResponseAnnotations }

/** Recognize only a complete, known generated reply envelope. Quoted examples,
 * malformed payloads and ordinary user prose must not be interpreted as metadata. */
export function codexPromptPresentation(raw: string): CodexPromptPresentation {
  const text = browserPromptText(imageAttachmentPromptText(raw))
  if (text.length > 1024 * 1024) return { text }
  const responseAnnotations = readCodexResponseAnnotations(text)
  if (responseAnnotations) return { text: codexResponseAnnotationText(responseAnnotations), responseAnnotations }
  const envelope = /^\s*<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/.exec(text)
  if (!envelope) return { text }
  try {
    const items: unknown = JSON.parse(envelope[1]!)
    if (!Array.isArray(items) || !items.length || items.length > 100) return { text }
    const replies: CodexQuestionReply[] = []
    for (const item of items) {
      if (!item || typeof item !== 'object' || typeof item.questionItemId !== 'string'
        || typeof item.question !== 'string' || !item.question.trim() || typeof item.answer !== 'string') return { text }
      const id: unknown = JSON.parse(item.questionItemId)
      if (!Array.isArray(id) || id.length !== 3 || id[0] !== 'request_user_input_async'
        || typeof id[1] !== 'string' || !/^call_[A-Za-z0-9_-]+$/.test(id[1]) || !Number.isSafeInteger(id[2]) || id[2] < 0) return { text }
      // The assistant's leading clock is metadata; keep the actual question and answer intact.
      const question = item.question.replace(/^当前时间：[ \t]*\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [A-Z]{2,6} \([+-]\d{4}\)\r?\n+/, '')
      if (!question.trim()) return { text }
      replies.push({ question, answer: item.answer })
    }
    return { text: replies.map(reply => `问题：${reply.question}\n你的回答：${reply.answer || '未填写回答'}`).join('\n\n'), replies }
  } catch { return { text } }
}

export function codexPromptText(text: string): string {
  const prompt = codexPromptPresentation(text)
  // The collected body retains annotation metadata; only its display projection is plain text.
  return prompt.responseAnnotations ? browserPromptText(imageAttachmentPromptText(text)) : prompt.text
}

export const codexPromptDisplayText = (text: string): string => codexPromptPresentation(text).text
