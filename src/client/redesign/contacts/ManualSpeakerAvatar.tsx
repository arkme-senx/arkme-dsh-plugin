import { ArkmeDefaultAvatarFrame } from '../../ArkmeAvatar.js'
import { tr } from '../../locale.js'

const graphemes = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' })

export function ManualSpeakerAvatar({ name, size = 38 }: { name: string; size?: number }) {
  const initial = graphemes.segment(name.trim())[Symbol.iterator]().next().value?.segment ?? '…'
  return <span role="img" aria-label={tr('{v0}的说话人头像', { v0: name })}
    style={{ width: size, height: size, flex: 'none', display: 'inline-grid', fontSize: Math.round(size * .43), fontWeight: 600 }}>
    <ArkmeDefaultAvatarFrame>{initial}</ArkmeDefaultAvatarFrame>
  </span>
}
