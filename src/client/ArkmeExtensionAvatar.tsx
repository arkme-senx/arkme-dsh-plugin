import { useEffect, useState, type CSSProperties } from 'react'
import { ArkmeExtensionIcon } from './ArkmeExtensionIcon.js'
import { arkmeTheme } from './arkme-theme.js'

export function arkmeExtensionIconUrl(extensionId: string, iconRef: string): string {
  return `/arkme-self/api/extension-icon?extension_id=${encodeURIComponent(extensionId)}&icon_ref=${encodeURIComponent(iconRef)}`
}

export function ArkmeExtensionAvatar({ extensionId, iconRef, size = 32, fallbackColor }: {
  extensionId: string
  iconRef?: string | undefined
  size?: number
  fallbackColor?: string | undefined
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [extensionId, iconRef])
  const valid = iconRef !== undefined && /^icon_v1_[a-f0-9]{64}$/.test(iconRef)
  const style: CSSProperties = {
    width: size, height: size, display: 'grid', placeItems: 'center', overflow: 'hidden',
    borderRadius: 6,
    background: arkmeTheme.subtle,
    color: fallbackColor ?? arkmeTheme.secondary,
  }
  return <span style={style} aria-hidden>
    {valid && !failed
      ? <img
          src={arkmeExtensionIconUrl(extensionId, iconRef)} alt="" draggable={false}
          style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
          onError={() => { setFailed(true) }}
        />
      : <ArkmeExtensionIcon size={Math.max(18, Math.round(size * .56))} />}
  </span>
}
