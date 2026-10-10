import { tr } from './locale.js'
import type { CSSProperties } from 'react'
import { ChatCircleDots } from '@phosphor-icons/react/dist/icons/ChatCircleDots'
import { Lightbulb } from '@phosphor-icons/react/dist/icons/Lightbulb'
import { HandWaving } from '@phosphor-icons/react/dist/icons/HandWaving'
import { PuzzlePiece } from '@phosphor-icons/react/dist/icons/PuzzlePiece'
import { GlobeHemisphereWest } from '@phosphor-icons/react/dist/icons/GlobeHemisphereWest'
import { NotePencil } from '@phosphor-icons/react/dist/icons/NotePencil'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { arkmeTheme } from './arkme-theme.js'
import { arkmeUi } from './ui-controller.js'

const actions = [
  ['打个招呼', '大家好，我刚开始用 Arkme 👋', HandWaving],
  ['问个问题', '我想问一下，', ChatCircleDots],
  ['提个建议', '我用 Arkme 时，觉得', Lightbulb],
] as const
const destinations = [
  ['逛逛市集', '找找感兴趣的小工具和小游戏', PuzzlePiece, () => arkmeUi.showExtensions()],
  ['看看世界', '看看大家正在分享什么', GlobeHemisphereWest, () => arkmeUi.showWorld()],
  ['发给自己', '随手记下第一条想法', NotePencil, () => arkmeUi.focusSendToSelf()],
] as const
const buttonStyle: CSSProperties = {
  border: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 9,
  background: arkmeTheme.base, color: 'inherit',
  font: 'inherit', fontSize: 12, padding: '8px 11px', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
}

export function ArkmeBetaCommunityWelcome({ title, disabled, onChoose }: {
  title: string; disabled?: boolean; onChoose(text: string): void
}) {
  return <section aria-label={tr("入群欢迎")} style={{
    width: '100%', maxWidth: 610, boxSizing: 'border-box', margin: '16px auto',
    padding: '22px 24px', borderRadius: 16, textAlign: 'left', fontSize: 14,
    border: `1px solid ${arkmeTheme.borderSoft}`,
    background: `color-mix(in srgb, ${arkmeTheme.text} 4%, ${arkmeTheme.base})`,
    color: arkmeTheme.text,
  }}>
    <h3 style={{ fontSize: 16, lineHeight: 1.6, margin: '0 0 12px', fontWeight: 600 }}>{tr("欢迎加入")} {title} 👋</h3>
    <p style={{ lineHeight: 1.85, margin: 0 }}>{tr("群里有 Arkme 的内测用户、作者（群主）和团队伙伴。")}</p>
    <p style={{ lineHeight: 1.85, margin: '10px 0 0' }}>{tr("来唠唠嗑、反馈 Bug、问问题、提建议，都可以～你的想法，或许会成为 Arkme 的下一次改变。")}</p>
    <p style={{ margin: '20px 0 9px', fontSize: 13, color: arkmeTheme.secondary }}>{tr("刚开始用 Arkme？可以先逛逛：")}</p>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {destinations.map(([label, description, Icon, navigate]) => <button key={label} type="button"
        onClick={navigate} style={{ ...buttonStyle, width: '100%', padding: '11px 13px', gap: 12, textAlign: 'left' }}>
        <Icon size={19} aria-hidden style={{ flexShrink: 0, color: '#526a9c' }} />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 12, rowGap: 3 }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{label}</span>
          <span style={{ fontSize: 12, color: arkmeTheme.secondary }}>{description}</span>
        </span>
        <CaretRight size={15} aria-hidden style={{ flexShrink: 0, color: arkmeTheme.secondary }} />
      </button>)}
    </div>
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${arkmeTheme.borderSoft}` }}>
    <p style={{ margin: '0 0 10px', fontSize: 13, lineHeight: 1.85, color: arkmeTheme.secondary }}>{tr("先去试试，用着有疑问或新想法，随时回来聊。")}</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {actions.map(([label, text, Icon]) => <button key={label} type="button" disabled={disabled}
        style={{ ...buttonStyle, ...(disabled ? { opacity: 0.5, cursor: 'default' } : {}) }}
        onClick={() => onChoose(text)}><Icon size={15} aria-hidden style={{ color: arkmeTheme.secondary }} />{label}</button>)}
    </div>
    </div>
  </section>
}
