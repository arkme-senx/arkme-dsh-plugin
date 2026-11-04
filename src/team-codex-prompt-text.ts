import { readCodexResponseAnnotations, codexResponseAnnotationText, type CodexResponseAnnotations } from './team-codex-response-annotations.js'
import { unified } from 'unified'
import remarkParse from 'remark-parse'

const skillName = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const skillFile = /^(?:\/|[A-Za-z]:[\\/]|file:\/\/\/)(?:[^\r\n<>]*[\\/])?SKILL\.md$/
const withinContextLimit = (text:string) => text.length <= 1024*1024 && new TextEncoder().encode(text).byteLength <= 1024*1024

const agentsHeader = '# AGENTS.md instructions for '
const agentsContext = /^# AGENTS\.md instructions for (?:\/|[A-Za-z]:[\\/]|\\\\)[^\r\n]*\r?\n(?:[ \t]*\r?\n)*<INSTRUCTIONS>\r?\n[\s\S]+?\r?\n<\/INSTRUCTIONS>(?=\r?\n|$)/
const environmentContext = /^<environment_context>\r?\n[ \t]*<cwd>[^<>\r\n]+<\/cwd>\r?\n[ \t]*<shell>[^<>\r\n]+<\/shell>\r?\n(?:[ \t]*<(current_date|timezone|approval_policy|sandbox_mode|network_access)>[^<>\r\n]*<\/\1>\r?\n)*(?:[ \t]*<filesystem><workspace_roots>[^\r\n]*<\/workspace_roots><permission_profile\b[^<>\r\n]*>[^\r\n]*<\/permission_profile><\/filesystem>\r?\n)?<\/environment_context>$/

/** Recognize complete app messages, never quoted examples or mixed user prose. */
function hiddenAppContext(text:string):boolean {
  const value=text.trim()
  if (!value.startsWith('<external_codex_apps_open_page>') && !value.startsWith('<skill>')
    && !value.startsWith(agentsHeader) && !value.startsWith('<environment_context>')) return false
  if (!withinContextLimit(value)) return false
  if (value.startsWith(agentsHeader)) {
    const instructions = agentsContext.exec(value)
    if (!instructions) return false
    const remainder = value.slice(instructions[0].length).trim()
    return !remainder || environmentContext.test(remainder)
  }
  if (value.startsWith('<environment_context>')) return environmentContext.test(value)
  const page=/^<external_codex_apps_open_page>\s*([\s\S]*?)\s*<\/external_codex_apps_open_page>$/.exec(value)
  if(page)try{
    const data:unknown=JSON.parse(page[1]!)
    if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==1||!('page_id' in data))return false
    return data.page_id===null||typeof data.page_id==='string'&&data.page_id.length>0&&new TextEncoder().encode(data.page_id).byteLength<=512
  }catch{return false}
  const skill=/^<skill>\r?\n<name>([^\r\n<>]+)<\/name>\r?\n<path>([^\r\n<>]+)<\/path>\r?\n([\s\S]*)\r?\n<\/skill>$/.exec(value)
  return !!skill&&skillName.test(skill[1]!)&&skillFile.test(skill[2]!)
    &&skill[3]!.replace(/\r\n/g,'\n').startsWith(`---\nname: ${skill[1]}\n`)
}

export interface CodexSkillMention { name:string; start:number; end:number }
type MarkdownNode={type:string;url?:string;title?:string|null;value?:string;children?:MarkdownNode[];position?:{start:{offset?:number};end:{offset?:number}}}
/** Destinations identify mentions only; no local path is opened or sent to the browser. */
export function codexSkillPresentation(input:string):{text:string;skills?:CodexSkillMention[]} {
  if(!input.includes('[$')||!input.includes('SKILL.md')||!withinContextLimit(input))return {text:input}
  const links:{start:number;end:number;name:string}[]=[]
  let root:MarkdownNode
  try{root=unified().use(remarkParse).parse(input) as MarkdownNode}catch{return {text:input}}
  const pending=[root]
  while(pending.length){
    const node=pending.pop()!
    if(node.type==='blockquote')continue
    const label=node.children?.length===1&&node.children[0]!.type==='text'?node.children[0]!.value:undefined
    const start=node.position?.start.offset,end=node.position?.end.offset
    if(node.type==='link'&&!node.title&&node.url&&skillFile.test(node.url)&&label?.startsWith('$')&&skillName.test(label.slice(1))
      &&start!==undefined&&end!==undefined&&input.startsWith(`[${label}](`,start))links.push({start,end,name:label.slice(1)})
    for(const child of node.children??[])pending.push(child)
  }
  if(!links.length||links.length>100)return {text:input}
  let text='',offset=0
  const skills:CodexSkillMention[]=[]
  for(const link of links.sort((a,b)=>a.start-b.start)){
    text+=input.slice(offset,link.start)
    skills.push({name:link.name,start:text.length,end:text.length+link.name.length})
    text+=link.name;offset=link.end
  }
  return {text:text+input.slice(offset),skills}
}

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
export interface CodexPromptPresentation { text: string; replies?: CodexQuestionReply[]; responseAnnotations?: CodexResponseAnnotations;skills?:CodexSkillMention[];hidden?:true }

/** Recognize only a complete, known generated reply envelope. Quoted examples,
 * malformed payloads and ordinary user prose must not be interpreted as metadata. */
export function codexPromptPresentation(raw: string): CodexPromptPresentation {
  const text = browserPromptText(imageAttachmentPromptText(raw))
  if (text.length > 1024 * 1024) return { text }
  if (hiddenAppContext(text)) return { text:'',hidden:true }
  const responseAnnotations = readCodexResponseAnnotations(text)
  if (responseAnnotations) return { text: codexResponseAnnotationText({...responseAnnotations,request:codexSkillPresentation(responseAnnotations.request).text}), responseAnnotations }
  const envelope = /^\s*<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/.exec(text)
  if (!envelope) return codexSkillPresentation(text)
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
  return prompt.responseAnnotations || prompt.skills || prompt.hidden ? browserPromptText(imageAttachmentPromptText(text)) : prompt.text
}

export const codexPromptDisplayText = (text: string): string => codexPromptPresentation(text).text
