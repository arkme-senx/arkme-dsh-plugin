import { useId, type ReactNode } from 'react'

/** Shared settings presentation; the caller owns preference reads and writes. */
export function ArkmeSettingsToggleRow({ title, description, checked, busy, disabled = false, status, feedback, onChange }: {
  title: string
  description: string
  checked: boolean
  busy: boolean
  disabled?: boolean
  status?: string | undefined
  feedback?: ReactNode
  onChange: (checked: boolean) => void
}) {
  const descriptionId = useId()
  const switchDisabled = busy || disabled
  return <div className="arkme-redesign-setting-row arkme-settings-toggle-row">
    <div className="arkme-settings-toggle-copy">
      <strong>{title}</strong>
      <p id={descriptionId}>{description}</p>
      {status && <small role="status">{status}</small>}
      {feedback}
    </div>
    <button type="button" className="arkme-settings-switch" data-arkme-feedback="neutral"
      role="switch" aria-label={title} aria-describedby={descriptionId} aria-checked={checked}
      aria-busy={busy} disabled={switchDisabled} onClick={() => { if (!switchDisabled) onChange(!checked) }}>
      <span aria-hidden />
    </button>
    <span className="arkme-redesign-trailing-slot" aria-hidden />
  </div>
}
