import type { ExploreEvidence } from '../explore-contract.js'
import { ArkmePluginError } from './service.js'
import { doc, type Doc } from './explore-projection.js'

/** Only owner-complete, current-body positions may expose an inferred identity. */
export function projectPersonReferences(row: Doc, content: string): Pick<ExploreEvidence, 'personReferences' | 'personReferenceStatus'> {
  if (row.content_status === 'unavailable') return { personReferenceStatus: 'unavailable', personReferences: [] }
  if (row.person_reference_status !== 'complete') return { personReferenceStatus: 'not_analyzed', personReferences: [] }
  const invalid = () => new ArkmePluginError('reference-invalid', '人物指代结果与原文不一致，请重新读取', true, 502)
  if (!Array.isArray(row.person_references) || row.person_references.length > 512) throw invalid()
  const runes = Array.from(content), seen = new Set<number>()
  const personReferences: NonNullable<ExploreEvidence['personReferences']> = row.person_references.map((raw): NonNullable<ExploreEvidence['personReferences']>[number] => {
    const value = doc(raw), start = value.start_position, end = value.end_position
    const status = value.status, targetName = value.target_name, confidence = value.confidence
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || typeof start !== 'number' || typeof end !== 'number' || start < 0 || end <= start || end > runes.length || seen.has(start) || runes.slice(start, end).join('') !== value.text) throw invalid()
    seen.add(start)
    if (status !== 'resolved' && status !== 'unresolved' && status !== 'generic' && status !== 'group') throw invalid()
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw invalid()
    if (status === 'resolved' ? typeof targetName !== 'string' || !targetName.trim() || confidence < .9 : !!targetName) throw invalid()
    return { start, end, text: String(value.text), status, ...(status === 'resolved' ? { targetName: String(targetName) } : {}) }
  }).sort((a, b) => a.start - b.start)
  return { personReferenceStatus: 'complete', personReferences }
}
