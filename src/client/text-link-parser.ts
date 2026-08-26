import { isValidLinkTld } from './text-link-tlds.js'

export type TextLinkRun =
  | Readonly<{ kind: 'text'; text: string }>
  | Readonly<{ kind: 'link'; text: string; href: string }>

const urlCandidatePattern = /(?<![a-z0-9_-])(?:[a-z][a-z0-9+.-]*:[^\s<>{}\[\]()（）【】，。！？；、“”‘’]*|(?:www\.)?(?=[a-z0-9.-]*\.)[a-z0-9][a-z0-9.-]*(?::[a-z0-9_+-]*)?(?:[/?#\\][^\s<>{}\[\]()（）【】，。！？；：、“”‘’]*)?)/giu
const explicitSchemePattern = /^[a-z][a-z0-9+.-]*:\/\//iu
const trailingPunctuationPattern = /[.,!?;:，。！？；：、'"“”‘’]+$/u
const asciiContinuationPattern = /[a-z0-9_-]/iu
const ipv4Pattern = /^(?:\d{1,3}\.){3}\d{1,3}$/u
const domainLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu

const riskyBareFileLikeTlds = new Set([
  'apk', 'avi', 'conf', 'csv', 'doc', 'docs', 'docx', 'dmg', 'exe', 'gif', 'gz',
  'ini', 'ipa', 'jpeg', 'jpg', 'json', 'log', 'md', 'mkv', 'mov', 'mp3', 'mp4',
  'msi', 'pdf', 'png', 'rar', 'svg', 'tar', 'txt', 'webp', 'xml', 'yaml', 'yml', 'zip',
])

function isExplicitUrl(text: string): boolean {
  return explicitSchemePattern.test(text)
}

function trimTrailingPunctuation(text: string): string {
  return text.replace(trailingPunctuationPattern, '')
}

function isValidIpv4(host: string): boolean {
  if (!ipv4Pattern.test(host) || host === '0.0.0.0') return false
  return host.split('.').every(part => {
    const value = Number(part)
    return Number.isInteger(value) && value >= 0 && value <= 255
  })
}

function isValidDomain(host: string): boolean {
  if (host.length > 253) return false
  const labels = host.split('.')
  if (labels.length < 2 || labels.some(label => !domainLabelPattern.test(label))) return false
  const tld = labels.at(-1)?.toLowerCase()
  return tld !== undefined && isValidLinkTld(tld)
}

function isValidHost(host: string): boolean {
  if (host === 'localhost') return true
  return ipv4Pattern.test(host) ? isValidIpv4(host) : isValidDomain(host)
}

function isLikelyNumericShortBareDomain(text: string, host: string): boolean {
  if (isExplicitUrl(text) || /^www\./iu.test(text) || ipv4Pattern.test(host)) return false
  const labels = host.split('.')
  return labels.length === 2 && /^\d$/u.test(labels[0] ?? '')
}

function isLikelyFileLikeBareDomain(text: string, host: string): boolean {
  if (isExplicitUrl(text) || /^www\./iu.test(text) || ipv4Pattern.test(host)) return false
  const labels = host.split('.')
  return labels.length === 2 && riskyBareFileLikeTlds.has(labels.at(-1)?.toLowerCase() ?? '')
}

function rawHost(text: string): string | undefined {
  const authorityStart = isExplicitUrl(text) ? text.indexOf('://') + 3 : 0
  const authority = text.slice(authorityStart).split(/[/?#\\]/u, 1)[0] ?? ''
  const host = authority.replace(/:\d{1,5}$/u, '').toLowerCase()
  return host === '' ? undefined : host
}

function normalizedHref(text: string): string | undefined {
  if (text.includes('\\')) return undefined
  const sourceHost = rawHost(text)
  if (sourceHost === undefined || !isValidHost(sourceHost)) return undefined
  if (sourceHost === 'localhost' && !isExplicitUrl(text)) return undefined
  const href = isExplicitUrl(text) ? text : `https://${text}`
  try {
    const url = new URL(href)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (url.username !== '' || url.password !== '' || !isValidHost(url.hostname)) return undefined
    if (url.pathname.includes('\\') || url.search.includes('\\') || url.hash.includes('\\')) return undefined
    if (url.search.toLowerCase().includes('javascript:') || url.hash.includes('##')) return undefined
    if (isLikelyNumericShortBareDomain(text, sourceHost)) return undefined
    if (isLikelyFileLikeBareDomain(text, sourceHost)) return undefined
    return href
  } catch {
    return undefined
  }
}

function pushText(runs: TextLinkRun[], text: string): void {
  if (text === '') return
  const previous = runs.at(-1)
  if (previous?.kind === 'text') {
    runs[runs.length - 1] = { kind: 'text', text: previous.text + text }
    return
  }
  runs.push({ kind: 'text', text })
}

export function textLinkRuns(text: string): readonly TextLinkRun[] {
  const runs: TextLinkRun[] = []
  let cursor = 0

  for (const match of text.matchAll(urlCandidatePattern)) {
    const candidate = trimTrailingPunctuation(match[0])
    if (candidate === '') continue
    const start = match.index
    const end = start + candidate.length
    const href = normalizedHref(candidate)
    const hasEmailBoundary = start > 0 && text[start - 1] === '@'
    const hasSuspiciousRightBoundary = !isExplicitUrl(candidate)
      && !/^www\./iu.test(candidate)
      && end < text.length
      && asciiContinuationPattern.test(text[end] ?? '')

    if (href === undefined || hasEmailBoundary || hasSuspiciousRightBoundary) continue

    pushText(runs, text.slice(cursor, start))
    runs.push({ kind: 'link', text: candidate, href })
    cursor = end
  }

  pushText(runs, text.slice(cursor))
  return runs
}
