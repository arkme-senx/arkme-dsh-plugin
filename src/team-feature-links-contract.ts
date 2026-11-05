export const MAX_TEAM_FEATURE_LINKS = 20
export interface TeamFeatureLink { id: string; name: string; url: string }
export interface TeamFeatureLinks { schemaVersion: 1; revision: number; canManage: boolean; maxItems: number; items: TeamFeatureLink[] }
export interface TeamFeatureLinksSave { expectedRevision: number; requestUid: string; items: TeamFeatureLink[] }
export const teamFeatureLinkId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value)
const invalidText = (value: string) => /[\p{Cc}\p{Cf}]/u.test(value)
export function teamFeatureLinkURL(value: string): string | undefined {
  const text = value.trim()
  if (!text || new TextEncoder().encode(text).length > 2048 || invalidText(text) || /[\\\s]/u.test(text)) return
  try {
    const url = new URL(text)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.port === '0') return
    return url.href
  } catch { return }
}
export function readTeamFeatureLinks(value: unknown): TeamFeatureLink[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_TEAM_FEATURE_LINKS) return
  const ids = new Set<string>(), items: TeamFeatureLink[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return
    const { id, name, url } = raw as Record<string, unknown>
    if (!teamFeatureLinkId(id) || ids.has(id) || typeof name !== 'string' || !name.trim() || [...name.trim()].length > 40 || invalidText(name) || typeof url !== 'string' || !teamFeatureLinkURL(url)) return
    ids.add(id); items.push({ id, name: name.trim(), url: teamFeatureLinkURL(url)! })
  }
  return items
}
