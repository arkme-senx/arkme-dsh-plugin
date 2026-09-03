export interface ArkmeLinkMetadata {
  url: string
  title: string
  description?: string
  siteName?: string
}

export function arkmeIsGenericLinkMetadataTitle(rawTitle: string | null | undefined): boolean {
  const title = rawTitle?.trim() ?? ''
  if (title === '') return true
  if (title === '分享链接') return true
  if (title === '即我' || title === '即我-对话发现自我' || title === '即我 - 对话发现自我') return true
  if (title === '即我-进入Ta的世界' || title === '即我 - 进入Ta的世界') return true
  const lowerTitle = title.toLowerCase()
  if (lowerTitle.includes('this page could not be found')) return true
  return /^404\b/u.test(title)
}

function linkUrl(rawUrl: string | URL): URL {
  return rawUrl instanceof URL ? new URL(rawUrl.href) : new URL(rawUrl)
}

export function arkmeExtensionShareRefFromLink(rawUrl: string | URL): string | undefined {
  let url: URL
  try {
    url = linkUrl(rawUrl)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return undefined
  const host = url.hostname.replace(/^www\./iu, '').toLowerCase()
  if (!['jiwo.cc', 'app.arkme.ai', 'app-test.arkme.ai', 'jotmo-app.senguo.me'].includes(host)) return undefined
  const parts = url.pathname.split('/').filter(Boolean)
  const shareRef = parts.length === 4 && parts[0] === 'app' && parts[1] === 'share' && parts[2] === 'extension'
    ? parts[3]
    : undefined
  return shareRef !== undefined && /^extshare_[0-9a-f]{32}$/u.test(shareRef) ? shareRef : undefined
}

export function arkmeKnownLinkMetadataFallback(rawUrl: string | URL): ArkmeLinkMetadata | null {
  try {
    const url = linkUrl(rawUrl)
    const host = url.hostname.replace(/^www\./iu, '').toLowerCase()
    const parts = url.pathname.split('/').filter(Boolean)
    if (host === 'github.com') {
      if (parts.length >= 4 && parts[2] === 'pull') {
        return { url: url.href, title: `Pull Request #${parts[3]} · ${parts[0]}/${parts[1]}` }
      }
      if (parts.length >= 2) {
        return { url: url.href, title: `${parts[0]}/${parts[1]}` }
      }
    }
    if ((host === 'codeup.aliyun.com' || host.endsWith('.codeup.aliyun.com')) && parts.includes('change')) {
      const changeIndex = parts.indexOf('change')
      const repository = changeIndex >= 2 ? parts[changeIndex - 1] : undefined
      const changeNo = parts[changeIndex + 1]
      if (repository !== undefined && changeNo !== undefined) {
        return { url: url.href, title: `${repository} · Change #${changeNo}` }
      }
    }
  } catch {
    // Unknown or invalid links have no deterministic title fallback.
  }
  return null
}

export function arkmeRequiredLinkMetadataFallback(rawUrl: string | URL): ArkmeLinkMetadata {
  const url = linkUrl(rawUrl)
  const siteName = url.hostname.replace(/^www\./iu, '')
  const known = arkmeKnownLinkMetadataFallback(url)
  return known === null
    ? { url: url.href, title: '分享链接', siteName }
    : { ...known, siteName }
}
