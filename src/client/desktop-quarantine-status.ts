import type {
  ArkmeDesktopQuarantineEntryView,
  ArkmeDesktopQuarantineStatus,
} from '../extensions/desktop-quarantine.js'

export function parseArkmeDesktopQuarantineStatus(value: unknown): ArkmeDesktopQuarantineStatus | undefined {
  if (!isObject(value) || typeof value.active !== 'boolean' || !Array.isArray(value.entries)) return undefined
  const entries: ArkmeDesktopQuarantineEntryView[] = []
  for (const entry of value.entries) {
    if (!isObject(entry)
      || typeof entry.packageName !== 'string'
      || entry.packageName.trim() === ''
      || typeof entry.dismissed !== 'boolean'
      || typeof entry.resolved !== 'boolean'
      || (entry.extensionId !== undefined && typeof entry.extensionId !== 'string')) return undefined
    entries.push({
      packageName: entry.packageName,
      ...(typeof entry.extensionId === 'string' ? { extensionId: entry.extensionId } : {}),
      dismissed: entry.dismissed,
      resolved: entry.resolved,
    })
  }
  if (value.mode !== undefined && value.mode !== 'targeted' && value.mode !== 'local-safe-mode') return undefined
  for (const key of ['quarantineId', 'failureSummary', 'failureLogTail'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') return undefined
  }
  return {
    active: value.active,
    ...(typeof value.quarantineId === 'string' ? { quarantineId: value.quarantineId } : {}),
    ...(value.mode === 'targeted' || value.mode === 'local-safe-mode' ? { mode: value.mode } : {}),
    ...(typeof value.failureSummary === 'string' ? { failureSummary: value.failureSummary } : {}),
    ...(typeof value.failureLogTail === 'string' ? { failureLogTail: value.failureLogTail } : {}),
    entries,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
