import type { CSSProperties } from 'react'
import { phraseColor } from './reaction-phrase-palette.js'
import { arkmeDefaultEmojis } from './arkme-emoji.js'
import { reactionLabelContent } from './reaction-label-content.js'

export function reactionLabelText(label: string): string {
  const content = reactionLabelContent(label)
  return content ? content.name + (content.handName ? `＋${content.handName}` : '') + (content.text ? ` ${content.text}` : '') : label
}

export function ReactionLabel({ label, size = 22 }: { label: string; size?: number }) {
  const content = reactionLabelContent(label)
  const emoji = content && arkmeDefaultEmojis.find(value => value.id === content.id)
  const hand = content?.handId && arkmeDefaultEmojis.find(value => value.id === content.handId)
  if (emoji && hand) return <><span role="img" aria-label={`${emoji.label}＋${hand.label}`} style={{ display: 'inline-block', position: 'relative', width: size * 1.4, height: size, verticalAlign: 'middle', flexShrink: 0 }}>
    <img src={emoji.assetUrl} alt="" draggable={false} style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, objectFit: 'contain' }} />
    <img src={hand.assetUrl} alt="" draggable={false} style={{ position: 'absolute', right: 0, bottom: 0, width: size * .8, height: size * .8, objectFit: 'contain' }} />
  </span>{content?.text && <> {content.text}</>}</>
  return emoji ? <><img src={emoji.assetUrl} alt={emoji.label} title={emoji.label} width={size} height={size}
    draggable={false} style={{ verticalAlign: 'middle', objectFit: 'contain' }} />{content?.text && <> {content.text}</>}</> : <>{label}</>
}

export function reactionPhraseStyle(label: string, selected = false, colorId?: string): CSSProperties {
  if (colorId === undefined && arkmeDefaultEmojis.some(emoji => emoji.token === label)) return {}
  const { color, background, border } = phraseColor(label, colorId)
  return { color, background, border: `1px solid ${selected ? color : border}` }
}
