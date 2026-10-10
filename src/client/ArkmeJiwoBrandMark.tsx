import type { CSSProperties } from 'react'
import arkmeNavigationLogoBase64 from '../../assets/branding/arkme-navigation-logo.png'
import arkmeNavigationLogoDarkBase64 from '../../assets/branding/arkme-navigation-logo-dark.png'

const themeStyles = `
  [data-arkme-jiwo-brand="light"] { mix-blend-mode: multiply; }
  [data-arkme-jiwo-brand="dark"] { display: none !important; }
  body[data-ds-dark-theme] [data-arkme-jiwo-brand="light"] { display: none !important; }
  body[data-ds-dark-theme] [data-arkme-jiwo-brand="dark"] { display: block !important; }
`

/** The same official mark and theme variants in navigation and signed-out pages. */
export function ArkmeJiwoBrandMark({ label = 'Arkme', className, style }: {
  label?: string
  className?: string
  style?: CSSProperties
}) {
  const imageStyle: CSSProperties = { display: 'block', width: 48, height: 28, objectFit: 'cover', ...style }
  return <>
    <style>{themeStyles}</style>
    <img src={`data:image/png;base64,${arkmeNavigationLogoBase64}`} alt={label}
      className={className} data-arkme-jiwo-brand="light" data-arkme-theme-image="light" draggable={false} style={imageStyle} />
    <img src={`data:image/png;base64,${arkmeNavigationLogoDarkBase64}`} alt={label}
      className={className} data-arkme-jiwo-brand="dark" data-arkme-theme-image="dark" draggable={false} style={imageStyle} />
  </>
}
