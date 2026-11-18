import type { AccountModelPreferences, AccountModelSave, AccountModelSettings } from '../account-models.js'

export function isAccountModelConflict(error: unknown): boolean {
  const body = (error as { body?: { code?: string; writeOutcomeUnknown?: boolean } } | null)?.body
  return body?.writeOutcomeUnknown !== true && (body?.code === 'model-settings-conflict' || body?.code === 'arkme-code-1201')
}

// Rebase only a rejected write whose inputs still refer to the same saved
// settings. A timeout is never evidence that the owner rejected a mutation.
export function accountModelRetryParams(
  operation: string, params: Record<string, unknown>, before: AccountModelSettings | undefined, after: AccountModelSettings,
): Record<string, unknown> | undefined {
  if (!before || before.accountScope !== after.accountScope || !before.enabled || !after.enabled || after.revision <= before.revision) return
  if (operation === 'models.account.save') {
    const input = params.input as AccountModelSave
    if (input.expected_revision !== before.revision) return
    if (input.uid) {
      const original = before.models.find(model => model.uid === input.uid)
      const current = after.models.find(model => model.uid === input.uid)
      if (!original || !current || JSON.stringify(original) !== JSON.stringify(current)) return
    }
    if (input.execution === 'connector') {
      const original = before.connectors.find(connector => connector.uid === input.connector_id)
      const current = after.connectors.find(connector => connector.uid === input.connector_id)
      if (!original || !current || current.revoked || JSON.stringify(original) !== JSON.stringify(current)) return
    }
    return { ...params, input: { ...input, expected_revision: after.revision } }
  }
  if (operation === 'models.preferences.save') {
    if (params.revision !== before.revision || JSON.stringify(before.preferences) !== JSON.stringify(after.preferences)
      || JSON.stringify(before.scenes) !== JSON.stringify(after.scenes)) return
    const preferences = params.preferences as AccountModelPreferences
    const routes = [preferences.default_route, ...Object.values(preferences.scenes)]
    for (const route of routes.filter(route => route.startsWith('user-api/'))) {
      const original = before.models.find(model => model.route === route)
      const current = after.models.find(model => model.route === route)
      if (!original || !current || JSON.stringify(original) !== JSON.stringify(current)) return
      if (current.execution === 'connector') {
        const originalConnector = before.connectors.find(connector => connector.uid === current.connector_id)
        const currentConnector = after.connectors.find(connector => connector.uid === current.connector_id)
        if (!originalConnector || !currentConnector || currentConnector.revoked || JSON.stringify(originalConnector) !== JSON.stringify(currentConnector)) return
      }
    }
    return { ...params, revision: after.revision }
  }
}
