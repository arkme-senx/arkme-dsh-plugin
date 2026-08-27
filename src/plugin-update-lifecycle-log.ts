import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface PluginUpdateLifecycleContext {
  jobId: string
  previousVersion: string
  targetVersion: string
}

export interface PluginUpdateLifecycleDetails {
  durationMs?: number
  error?: string
  installedVersion?: string
  replacementPid?: number
}

function redactSensitiveText(value: string): string {
  const credentialKey = String.raw`(?:_?authToken|access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|x-api-key|password|passwd|secret|authorization|cookie|set-cookie|x-amz-signature|x-amz-credential|signature|token)`
  const quotedCredential = new RegExp(`(["'])(${credentialKey})\\1\\s*:\\s*(["'])[^"']*\\3`, 'gi')
  const plainCredential = new RegExp(`\\b(${credentialKey})\\b\\s*[:=]\\s*(?:"[^"]*"|'[^']*'|[^\\s,;&}\\]]+)`, 'gi')
  return value
    // URLs may contain user-info, query credentials, or signed download parameters.
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, '[REDACTED_URL]')
    .replace(/\bBearer\s+[^\s,;}]+/gi, 'Bearer [REDACTED]')
    .replace(quotedCredential, (_match, quote: string, key: string, valueQuote: string) => (
      `${quote}${key}${quote}:${valueQuote}[REDACTED]${valueQuote}`
    ))
    .replace(plainCredential, (_match, key: string) => `${key}=[REDACTED]`)
    .slice(0, 2_000)
}

/**
 * Append one process-safe JSON line to the desktop-owned harness log.
 * Logging is diagnostic-only: callers keep the update flow alive when the log cannot be written.
 */
export function writePluginUpdateLifecycleLog(
  logPath: string,
  context: PluginUpdateLifecycleContext,
  stage: string,
  details: PluginUpdateLifecycleDetails = {},
): boolean {
  try {
    mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 })
    const safeDetails = details.error === undefined
      ? details
      : { ...details, error: redactSensitiveText(details.error) }
    const entry = {
      timestamp: new Date().toISOString(),
      jobId: context.jobId,
      stage,
      previousVersion: context.previousVersion,
      targetVersion: context.targetVersion,
      pid: process.pid,
      ...safeDetails,
    }
    appendFileSync(logPath, `[plugin-update] ${JSON.stringify(entry)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    return true
  } catch {
    return false
  }
}
