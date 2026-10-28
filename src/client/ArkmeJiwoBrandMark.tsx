import type { CSSProperties } from 'react'
import { useArkmeBrand } from './product-brand.js'

const themeStyles = `
  [data-arkme-jiwo-brand="light"] { mix-blend-mode: multiply; }
  [data-arkme-jiwo-brand="dark"] { display: none !important; }
  body[data-ds-dark-theme] [data-arkme-jiwo-brand="light"] { display: none !important; }
  body[data-ds-dark-theme] [data-arkme-jiwo-brand="dark"] { display: block !important; }
  body[data-ds-dark-theme] [data-arkme-jiwo-brand="dark"][data-brand-language="en"] { filter: invert(1) hue-rotate(180deg); }
`

/** The same official mark and theme variants in navigation and signed-out pages. */
export function ArkmeJiwoBrandMark({ label, className, style, wordmarkHeight }: {
  label?: string
  className?: string
  style?: CSSProperties
  wordmarkHeight?: number
}) {
  const brand = useArkmeBrand()
  const imageStyle: CSSProperties = { display: 'block', width: 48, height: 28,
    ...(wordmarkHeight === undefined ? {} : { height: wordmarkHeight, width: Math.round(wordmarkHeight * (brand.name === '即我' ? 2 : 640 / 159)) }),
    ...style, objectFit: brand.name === '即我' ? 'cover' : 'contain' }
  return <>
    <style>{themeStyles}</style>
    <img src={brand.wordmark} alt={label ?? brand.name}
      className={className} data-arkme-jiwo-brand="light" data-arkme-theme-image="light" draggable={false} style={imageStyle} />
    <img src={brand.wordmarkDark} alt={label ?? brand.name}
      className={className} data-brand-language={brand.name === '即我' ? 'zh' : 'en'} data-arkme-jiwo-brand="dark" data-arkme-theme-image="dark" draggable={false} style={imageStyle} />
  </>
}
