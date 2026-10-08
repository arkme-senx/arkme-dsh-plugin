import { arkmeMarkdownPlainText, arkmeMarkdownTree } from './markdown.js'
import { textLinkRuns } from './text-link-parser.js'

export type ShareLinkKind = 'message' | 'conversation' | 'article' | 'image' | 'video' | 'audio' | 'file' | 'recording' | 'agent' | 'world' | 'public-record' | 'topic' | 'call' | 'call-invite' | 'voiceprint' | 'auto-sticker' | 'extension'
export interface ShareLinkTarget {
  url: string
  kind: ShareLinkKind
  id: string
  environment: 'prod' | 'test'
  code?: string
  stamp?: number
}
export interface ShareLinkPreview {
  kind: ShareLinkKind
  state: 'ready' | 'generic' | 'unavailable' | 'expired' | 'auditing' | 'restricted' | 'error'
  title?: string
  author?: string
  /** Derived from authenticated source ownership, never from a matching name. */
  authorIsMe?: boolean
  avatarUrl?: string
  summary?: string
  thumbnailUrl?: string
  count?: number
  timestamp?: number
  durationMillis?: number
  fileSize?: number
  version?: string
  callMediaType?: 'audio' | 'video'
}

export const shareLinkLabels: Record<ShareLinkKind, string> = {
  message: '快记', conversation: '对话记录', article: '长文', image: '图片', video: '视频',
  audio: '语音', file: '文件', recording: '录音片段', agent: 'AI 对话', world: '个人世界',
  'public-record': '公开快记', topic: '群聊 / 主题邀请', call: '通话记录',
  'call-invite': '通话邀请', voiceprint: '声纹录入邀请', 'auto-sticker': '自动贴图邀请', extension: '市集扩展',
}
const productionHosts = new Set(['jiwo.cc', 'www.jiwo.cc', 'app.jiwo.cc', 'app.jotmo.cc', 'app.arkme.ai'])
const testHosts = new Set(['jotmo-app.senguo.me', 'app-test.arkme.ai'])
const reserved = new Set(['login', 'signup', 'account', 'settings', 'billing', 'payment', 'api', 'app', 'share', 'events', 'download', 'artifacts', 'recording', 'webhook', 'auth', 'oauth', 'voiceprint', 'auto-sticker', 'shijie'])

/** A URL is an identifier, never a server-side fetch destination. */
export function parseShareLink(raw: string): ShareLinkTarget | undefined {
  if (raw.length > 4096 || /[\\\u0000-\u0020]/u.test(raw)) return undefined
  let url: URL
  try { url = new URL(/^https:\/\//iu.test(raw) ? raw : `https://${raw}`) } catch { return undefined }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return undefined
  const environment = productionHosts.has(url.hostname) ? 'prod' : testHosts.has(url.hostname) ? 'test' : undefined
  if (!environment) return undefined
  const path = url.pathname.replace(/^\/app\//u, '/').replace(/\/$/u, '')
  const target = (kind: ShareLinkKind, id: string): ShareLinkTarget => ({ kind, id, environment, url: url.href })
  let match = /^\/s\/([A-Za-z0-9]{16})$/u.exec(path)
  if (match && !url.search && !url.hash) return target('message', match[1]!)
  match = /^\/(?:forward|share\/chat\/forward)\/([A-Za-z0-9_-]{1,256})$/u.exec(path)
  const withInvite = (value: ShareLinkTarget): ShareLinkTarget => {
    const code = url.searchParams.get('code') ?? ''
    const stamp = Number(url.searchParams.get('s') ?? url.searchParams.get('stamp'))
    return { ...value, ...(code ? { code: code.slice(0, 512) } : {}), ...(Number.isSafeInteger(stamp) && stamp > 0 ? { stamp } : {}) }
  }
  if (match) return withInvite(target('conversation', match[1]!))
  match = /^\/share\/topic\/([A-Za-z0-9_-]{1,512})$/u.exec(path)
  if (match) return withInvite(target('topic', match[1]!))
  match = /^\/share\/call\/([a-f0-9]{24}\.[a-f0-9]{64})$/u.exec(path)
  if (match) return target('call', match[1]!)
  match = /^\/share\/extension\/(extshare_[a-f0-9]{32})$/u.exec(path)
  if (match) return target('extension', match[1]!)
  if (path === '/share-call') return target('call-invite', (url.searchParams.get('token') ?? '').slice(0, 2048))
  // Binding credential in the fragment deliberately never enters preview requests.
  if (path === '/v' || path === '/voiceprint/invite') return target('voiceprint', (url.searchParams.get('p') ?? '').slice(0, 2048))
  if (path === '/auto-sticker/invite') return target('auto-sticker', '')
  match = /^\/(?:shijie\/)?([A-Za-z][A-Za-z0-9_-]{4,31})(?:\/record\/([A-Za-z0-9_-]{1,128}))?$/u.exec(path)
  if (match && !reserved.has(match[1]!.toLowerCase()) && !url.search && !url.hash) {
    return target(match[2] ? 'public-record' : 'world', match[2] ?? match[1]!)
  }
  return undefined
}

/** Do not send credentials/actions on Arkme domains through generic metadata scraping. */
export function isInternalShareHost(raw: string): boolean {
  try { const u = new URL(raw); return productionHosts.has(u.hostname) || testHosts.has(u.hostname) } catch { return false }
}

export function collectShareLinks(text: string, format: 'plain' | 'markdown'): { links: ShareLinkTarget[]; standalone: boolean } {
  const links = new Map<string, ShareLinkTarget>()
  const add = (href: string) => { const link = parseShareLink(href); if (link && links.size < 20) links.set(link.url, link) }
  if (format === 'plain') {
    const runs = textLinkRuns(text)
    for (const run of runs) if (run.kind === 'link') add(run.href)
    return { links: [...links.values()], standalone: links.size === 1 && runs.every(run => run.kind === 'link' ? !!parseShareLink(run.href) : !run.text.trim()) }
  }
  type Node = ReturnType<typeof arkmeMarkdownTree> & { identifier?: string; children?: Node[] }
  const tree = arkmeMarkdownTree(text) as Node
  const definitions = new Map<string, string>()
  const index = (node: Node) => { if (node.type === 'definition' && node.identifier && node.url) definitions.set(node.identifier.toLowerCase(), node.url); node.children?.forEach(index) }
  index(tree)
  let otherContent = false
  const visit = (node: Node) => {
    if (node.type === 'definition') return
    if (node.type === 'link' || node.type === 'linkReference') {
      const url = node.url ?? definitions.get(node.identifier?.toLowerCase() ?? '') ?? ''
      add(url); if (!parseShareLink(url)) otherContent = true
      // Historical editor bugs could store URL + trailing prose as one link label.
      // A preview must never hide that prose even though the href is a valid share.
      const label = (node.children ?? []).map(child => child.value ?? '').join('').trim()
      if (label.startsWith(url) && label.slice(url.length).trim()) otherContent = true
      return
    }
    if (['code', 'inlineCode', 'html', 'image', 'imageReference'].includes(node.type)) { otherContent = true; return }
    if (node.type === 'text') {
      for (const run of textLinkRuns(node.value ?? '')) {
        if (run.kind === 'link' && parseShareLink(run.href)) add(run.href)
        else if (run.text.trim()) otherContent = true
      }
    }
    node.children?.forEach(visit)
  }
  visit(tree)
  return { links: [...links.values()], standalone: links.size === 1 && !otherContent }
}

export function previewObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function sharePreviewIsOwnMessage(raw: unknown, viewerUserId: number): boolean {
  const data = previewObject(raw)
  if (data.access_mode !== 'normal' || !Number.isSafeInteger(viewerUserId) || viewerUserId <= 0) return false
  const items = Array.isArray(data.items) ? data.items : []
  if (items.length !== 1) return false
  const item = previewObject(items[0])
  // An AI response can belong to the user's session without being sent by them.
  if (['agent_message', 'dsh_native', 'dsh_question'].includes(String(item.source_kind))
    || item.template_kind === 5 || previewObject(item.structured_content).structured_kind === 3) return false
  const source = previewObject(data.source_context)
  const anchors = Array.isArray(source.anchors) ? source.anchors.map(previewObject) : []
  const uid = item.record_uid ?? item.recordUid ?? item.uid
  const matching = typeof uid === 'string' && uid ? anchors.filter(anchor => anchor.record_uid === uid) : anchors.length === 1 ? anchors : []
  return matching.length === 1 && String(matching[0]!.record_owner_user_id) === String(viewerUserId)
}
const list = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.slice(0, 150).map(previewObject) : []
export function previewText(value: unknown, max = 200): string {
  if (typeof value !== 'string') return ''
  const plain = value.slice(0, 12000).replace(/[\u0000-\u001f\u007f\s]+/gu, ' ').trim()
  const points = Array.from(plain)
  return points.length > max ? `${points.slice(0, max).join('')}…` : plain
}
export function previewImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !/^[a-z0-9.-]+\.[a-z]{2,}$/iu.test(url.hostname)
      || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/iu.test(url.hostname)) return undefined
    return url.href
  } catch { return undefined }
}
function time(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(n) && n > 0 && n < 8_640_000_000_000_000 ? (n < 100_000_000_000 ? n * 1000 : n) : undefined
}
function state(data: Record<string, unknown>): ShareLinkPreview['state'] | undefined {
  const status = String(data.status ?? data.audit_status ?? data.reason_code ?? data.failure_reason ?? '')
  if (data.expired === true || /^(expired|link_expired|invite_expired)$/u.test(status)) return 'expired'
  if (/^(auditing|reviewing|pending|audit_pending)$/u.test(status)) return 'auditing'
  if (/^(forbidden|unauthorized|permission_denied|login_required)$/u.test(status)) return 'restricted'
  if (data.available === false || /^(unavailable|deleted|revoked|blocked|not_found|rejected)$/u.test(status)) return 'unavailable'
  return undefined
}
function sourceSummary(item: Record<string, unknown>): string {
  if (typeof item.availability === 'string' && item.availability !== 'available') return ''
  const structure = previewObject(item.structured_content)
  const segments = list(structure.long_recording_segments)
  const body = item.text_content ?? item.text ?? item.content
  return previewText(item.text_format === 'markdown' && typeof body === 'string' ? arkmeMarkdownPlainText(body.slice(0, 12000)) : body) || segments.slice(0, 3).map(s =>
    [previewText(s.speaker_label, 30), previewText(s.text, 100)].filter(Boolean).join('：')).join(' · ')
    || list(item.media_items ?? item.files).map(m => previewText(m.file_name, 80)).filter(Boolean).slice(0, 2).join(' · ')
}

/** Pure projection: no private lookup, recursive resolution, AI, or media download. */
export function projectSharePreview(target: ShareLinkTarget, raw: unknown): ShareLinkPreview {
  const data = previewObject(raw)
  const failed = state(data)
  if (failed) return { kind: target.kind, state: failed }
  const base: ShareLinkPreview = { kind: target.kind, state: 'ready' }
  const assign = (title: unknown, author: unknown, avatar: unknown, summary: unknown): ShareLinkPreview => ({
    ...base, ...(previewText(title, 100) ? { title: previewText(title, 100) } : {}),
    ...(previewText(author, 60) ? { author: previewText(author, 60) } : {}),
    ...(previewImageUrl(avatar) ? { avatarUrl: previewImageUrl(avatar)! } : {}),
    ...(previewText(summary, 240) ? { summary: typeof summary === 'string' ? summary.split('\n').slice(0, 3).map(line => previewText(line, 160)).join('\n') : '' } : {}),
  })
  if (target.kind === 'message' || target.kind === 'conversation') {
    const forward = previewObject(data.forward_records)
    const items = list(target.kind === 'conversation' ? forward.items : data.items)
    const presentation = list(data.presentation)
    const bundle = presentation.find(n => n.kind === 'forward_bundle')
    if (target.kind === 'conversation' || items.length > 1 || bundle) {
      const lines = items.filter(item => !item.availability || item.availability === 'available').slice(0, 3).map(item => [previewText(item.sender_display_name ?? item.owner_name, 40), sourceSummary(item) || previewText(item.title)].filter(Boolean).join('：')).filter(Boolean)
      const fallbackLines = Array.isArray(forward.summary_lines) ? forward.summary_lines.slice(0, 3).map(v => previewText(v, 100)) : []
      return { ...assign(bundle?.title ?? data.display_title ?? forward.title ?? data.title,
        bundle?.sender_display_name ?? data.sharer_display_name, bundle?.sender_avatar_url ?? data.sharer_avatar_url, (lines.length ? lines : fallbackLines).join('\n')),
        kind: 'conversation', ...(items.length ? { count: items.length } : {}),
        ...(!items.length && !fallbackLines.length && !bundle ? { state: 'unavailable' } : {}),
      }
    }
    const item = items[0]
    if (!item) return { ...base, state: 'unavailable' }
    const structure = previewObject(item.structured_content)
    const media = list(item.media_items)
    const first = media[0]
    const kind: ShareLinkKind = item.display_kind === 1 || item.template_kind === 8 ? 'article'
      : structure.structured_kind === 1 || Array.isArray(structure.long_recording_segments) ? 'recording'
      : ['agent_message', 'dsh_native', 'dsh_question'].includes(String(item.source_kind)) ? 'agent'
      : first?.file_kind === 1 ? 'image' : first?.file_kind === 3 ? 'video' : first?.file_kind === 2 ? 'audio' : first?.file_kind === 4 ? 'file' : 'message'
    const result = assign(item.title, item.sender_display_name, item.sender_avatar_url, sourceSummary(item))
    const thumb = previewImageUrl(media.find(m => (m.file_kind === 1 || m.file_kind === 3) && m.preview_url)?.preview_url)
    const duration = Number(structure.duration_millis ?? previewObject(structure.voice).duration_millis)
    const timestamp = time(item.send_at)
    const fileSize = Number(first?.size)
    return { ...result, kind, ...(thumb ? { thumbnailUrl: thumb } : {}), ...(timestamp ? { timestamp } : {}),
      ...(Number.isFinite(duration) && duration > 0 ? { durationMillis: duration } : {}),
      ...(kind === 'file' && Number.isFinite(fileSize) && fileSize > 0 ? { fileSize } : {}) }
  }
  if (target.kind === 'world') {
    const user = list(data.items)[0] ?? {}
    return Object.keys(user).length ? assign(user.nick_name, undefined, user.head_img, user.jotmo_id) : { ...base, state: 'unavailable' }
  }
  if (target.kind === 'public-record') return assign(undefined, data.nick_name, data.avatar, data.text_content ?? data.content)
  if (target.kind === 'topic') return assign(data.title, data.creator_display_name, undefined, undefined)
  if (target.kind === 'call-invite') {
    const user = previewObject(data.sharer_profile)
    return { ...assign(undefined, user.display_name, user.avatar_url, undefined),
      ...(data.call_media_type === 0 ? { callMediaType: 'audio' } : data.call_media_type === 1 ? { callMediaType: 'video' } : {}) }
  }
  if (target.kind === 'voiceprint') return assign(undefined, data.inviter_display_name, undefined, undefined)
  if (target.kind === 'extension') {
    const author = previewObject(data.author)
    return { ...assign(data.name, author.nick_name, author.head_img, data.description),
      ...(previewText(data.latest_stable_version, 30) ? { version: previewText(data.latest_stable_version, 30) } : {}) }
  }
  return { ...base, state: 'generic' }
}
