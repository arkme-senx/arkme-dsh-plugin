export interface ArkmeLinkMetadata {
  url: string
  title: string
  description?: string
  siteName?: string
}

function linkUrl(rawUrl: string | URL): URL {
  return rawUrl instanceof URL ? new URL(rawUrl.href) : new URL(rawUrl)
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
