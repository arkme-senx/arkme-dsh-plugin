import { parseShareLink, type ShareLinkTarget } from './share-link-preview.js'

/** Keep normal links portable; only supported identity links acquire in-app actions. */
export function identityShareTarget(url: string): ShareLinkTarget | undefined {
  const target = parseShareLink(url)
  return target?.kind === 'world' || target?.kind === 'topic' && target.id.startsWith('chat_v1_') ? target : undefined
}
