/** Public immutable catalog identity; never contains provider credentials. */
export interface ModelBinding { catalogReleaseId: string; offeringRevisionId: string; publicModelCode: string }
export interface ModelExecutionMetadata {
  binding?: ModelBinding
  supplierCode?: string
  costDescription?: string
  available?: boolean
  unavailableReason?: string
}
const doc = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const safe = (v: unknown) => typeof v === 'string' && v.length <= 256 && !/[\u0000-\u001f\u007f]/.test(v) ? v : ''
export function executionMetadata(raw: unknown): ModelExecutionMetadata {
  const item = doc(raw), binding = doc(item.binding ?? item.model_binding)
  // Account-provided routes are authorized by their scene catalog and billed by
  // that account's supplier, independently of the published points catalog.
  if (item.provider === 'user-api') {
    const available = item.available === undefined || item.available === true
    return { available, ...(available ? {} : { unavailableReason: safe(item.unavailable_reason) || 'adapter_unavailable' }) }
  }
  const release = safe(binding.catalog_release_id), revision = safe(binding.offering_revision_id), code = safe(binding.public_model_code)
  const valid = /^[1-9][0-9]*$/.test(release) && /^[1-9][0-9]*$/.test(revision) && !!code
  return { ...(valid ? { binding: { catalogReleaseId: release, offeringRevisionId: revision, publicModelCode: code } } : {}),
    ...(safe(item.supplier_code) ? { supplierCode: safe(item.supplier_code) } : {}),
    ...(safe(item.cost_description) ? { costDescription: safe(item.cost_description) } : {}),
    available: valid && item.available === true,
    ...(item.available === true && valid ? {} : { unavailableReason: safe(item.unavailable_reason) || 'catalog_unavailable' }) }
}
export function bindingWire(binding: ModelBinding) {
  return { catalog_release_id: binding.catalogReleaseId, offering_revision_id: binding.offeringRevisionId, public_model_code: binding.publicModelCode }
}
export function publishedChoiceId(binding: ModelBinding | undefined, fallback: readonly string[]): string {
  return JSON.stringify(binding ? ['published', binding.catalogReleaseId, binding.offeringRevisionId, binding.publicModelCode] : fallback)
}
