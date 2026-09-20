import { tr, useArkmeLocale } from './locale.js'
import { useState, type CSSProperties } from 'react'
import { outgoingCallUi } from './outgoing-call-ui-controller.js'
import { ARKME_CONVERSATION_HEADER_BUTTON_STYLE } from './ArkmeGroupChatControls.js'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'

export interface ArkmePrivateCallMenuProps {
  sourceRef: string
  displayName: string
  assetBasePath?: string
}

const maskStyle: CSSProperties = {
  width: 16, height: 16, display: 'block', backgroundColor: 'currentColor',
  maskRepeat: 'no-repeat', maskPosition: 'center', maskSize: 'contain',
  WebkitMaskRepeat: 'no-repeat', WebkitMaskPosition: 'center', WebkitMaskSize: 'contain',
}

function MenuAssetIcon({ assetBasePath, iconAsset, size = 16 }: { assetBasePath: string; iconAsset: string; size?: number }) {
  const iconUrl = `${assetBasePath}/${iconAsset}`
  return <span aria-hidden data-arkme-private-call-menu-icon={iconAsset}
    style={{ ...maskStyle, width: size, height: size, maskImage: `url("${iconUrl}")`, WebkitMaskImage: `url("${iconUrl}")` }} />
}

export function ArkmePrivateCallMenu({
  sourceRef, displayName, assetBasePath = '/arkme-self/api/call',
}: ArkmePrivateCallMenuProps) {
  useArkmeLocale()
  const [open, setOpen] = useState(false)
  const start = (mediaType: 'audio' | 'video') => {
    setOpen(false)
    outgoingCallUi.request({ sourceRef, displayName, mediaType })
  }
  return <ArkmeActionMenu open={open} label={tr("选择通话方式")} align="end" onClose={() => setOpen(false)}
    anchor={<button data-arkme-feedback="neutral" type="button" aria-label={tr("呼叫{v0}", { v0: displayName })}
      aria-haspopup="menu" aria-expanded={open} title={tr("发起通话")}
      style={{ ...ARKME_CONVERSATION_HEADER_BUTTON_STYLE, appearance: 'none' }}
      onClick={() => setOpen(value => !value)}>
      <MenuAssetIcon assetBasePath={assetBasePath} iconAsset="call-linear-strong.svg" size={20} />
    </button>}
    actions={[
      { id: 'audio', label: '语音通话', icon: <MenuAssetIcon assetBasePath={assetBasePath} iconAsset="call-linear.svg" />, onSelect: () => start('audio') },
      { id: 'video', label: '视频通话', icon: <MenuAssetIcon assetBasePath={assetBasePath} iconAsset="video-linear.svg" />, onSelect: () => start('video') },
    ]}
  />
}
