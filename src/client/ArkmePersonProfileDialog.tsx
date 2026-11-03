import { useId, useState } from 'react'
import { XIcon } from '@phosphor-icons/react/dist/csr/X'
import { GlobeHemisphereWestIcon } from '@phosphor-icons/react/dist/csr/GlobeHemisphereWest'
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/csr/ArrowUpRight'
import { ChatCircleIcon } from '@phosphor-icons/react/dist/csr/ChatCircle'
import { UsersIcon } from '@phosphor-icons/react/dist/csr/Users'
import { DotsThreeIcon } from '@phosphor-icons/react/dist/csr/DotsThree'
import type { IdentityShareTarget } from '../identity-share-contract.js'
import type { ArkmeGroupAvatarFallback } from '../types.js'
import type { ArkmeAvatarImagePort } from './avatar-image-store.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { IdentityCopyLinkButton } from './IdentityCopyLinkButton.js'
import { tr, useArkmeLocale } from './locale.js'

/** The one person-card surface used by avatar and shared-link entry points. */
export function ArkmePersonProfileDialog(props: {
  displayName: string; topicNickname?: string; accountName?: string | undefined
  avatarRef?: string | undefined; avatarFallback?: ArkmeGroupAvatarFallback | undefined
  imagePort?: ArkmeAvatarImagePort | undefined; imageKey?: string | undefined
  isSelf?: boolean | undefined; hideSend?: boolean | undefined
  accountScope: string; copyLinkTarget?: IdentityShareTarget | undefined
  busy: boolean; worldBusy?: boolean; worldDisabled?: boolean; loading?: boolean
  error?: string | undefined
  onClose(): void; onSend(): void; onWorld(): void
  onContactAsTeam?: (() => void) | undefined
  onRefresh?: (() => void) | undefined; browserUrl?: string | undefined
}) {
  useArkmeLocale()
  const titleId = useId(), [more, setMore] = useState(false)
  const [sendState, setSendState] = useState('idle')
  return <ArkmeConfirmDialog layout="picker" titleId={titleId}
    title={tr('{v0} 的用户卡片', { v0: props.displayName })} busy={props.busy || Boolean(props.worldBusy)}
    onClose={props.onClose} dialogStyle={{ width: 'min(390px, 100%)', borderRadius: 18 }}>
    <div className="arkme-person-card" data-arkme-member-profile data-arkme-person-profile="unified">
      <button type="button" className="arkme-person-icon arkme-person-close" aria-label={tr('关闭')}
        disabled={props.busy || props.worldBusy} onClick={props.onClose}><XIcon size={18} aria-hidden /></button>
      <header className="arkme-person-identity">
        <ArkmeUserAvatar avatarRef={props.avatarRef} {...(props.avatarFallback ? { fallback: props.avatarFallback } : {})}
          {...(props.imagePort ? { imagePort: props.imagePort } : {})} imageKey={props.imageKey}
          size={72} label={tr('{v0} 的头像', { v0: props.displayName })} />
        <div className="arkme-person-names">
          <h3>{props.displayName}</h3>
          {props.accountName && <p>{tr('即我号：')}{props.accountName}</p>}
          {props.topicNickname && <p className="arkme-person-alias">{tr('主题内昵称：')}{props.topicNickname}</p>}
          {props.loading && <p role="status">{tr('正在读取资料…')}</p>}
        </div>
      </header>
      <button type="button" className="arkme-person-world" disabled={props.busy || props.worldBusy || props.worldDisabled}
        aria-label={tr(props.isSelf ? '进入我的世界' : '进入 TA 的世界')} onClick={props.onWorld} aria-busy={props.worldBusy || undefined}>
        <span className="arkme-person-world-icon"><GlobeHemisphereWestIcon size={22} weight="regular" aria-hidden /></span>
        <span className="arkme-person-world-copy"><strong>{tr(props.isSelf ? '进入我的世界' : '进入 TA 的世界')}</strong>
          <span>{tr(props.worldBusy ? '正在打开…' : '看看日常、想法与分享')}</span></span>
        <ArrowUpRightIcon size={18} aria-hidden />
      </button>
      {props.error && <p className="arkme-person-error" role="alert">{props.error}</p>}
      {!props.hideSend && <div className="arkme-person-actions">
        <button type="button" className="arkme-person-button arkme-person-primary" data-arkme-feedback="primary"
          data-arkme-profile-send-state={props.busy ? 'loading' : sendState} disabled={props.busy || props.worldBusy}
          aria-busy={props.busy || undefined} onPointerEnter={() => setSendState('hover')} onPointerLeave={() => setSendState('idle')}
          onPointerDown={() => setSendState('active')} onPointerUp={() => setSendState('hover')} onClick={props.onSend}>
          <ChatCircleIcon size={18} aria-hidden />{tr(props.busy ? '正在打开…' : props.isSelf ? '发给自己' : '发消息')}
        </button>
        {props.onContactAsTeam && !props.isSelf && <button type="button" className="arkme-person-button" data-arkme-feedback="neutral"
          disabled={props.busy || props.worldBusy} onClick={props.onContactAsTeam}><UsersIcon size={18} aria-hidden />{tr('以团队联系')}</button>}
      </div>}
      {(props.copyLinkTarget || props.onRefresh || props.browserUrl) && <footer className="arkme-person-footer">
        <div className="arkme-person-copy">{props.copyLinkTarget && <IdentityCopyLinkButton accountScope={props.accountScope} target={props.copyLinkTarget}
          className="arkme-person-text-button" style={{}} label="复制个人链接" iconSize={15} />}</div>
        {(props.onRefresh || props.browserUrl) && <div className="arkme-person-more">
          <button type="button" className="arkme-person-icon" aria-label={tr('更多操作')} aria-expanded={more}
            disabled={props.busy || props.worldBusy} onClick={() => setMore(value => !value)}><DotsThreeIcon size={23} weight="bold" aria-hidden /></button>
          {more && <div className="arkme-person-more-panel">
            {props.onRefresh && <button type="button" onClick={() => { setMore(false); props.onRefresh?.() }}>{tr('刷新名片')}</button>}
            {props.browserUrl && <a href={props.browserUrl} target="_blank" rel="noopener noreferrer">{tr('在浏览器中打开')}</a>}
          </div>}
        </div>}
      </footer>}
    </div>
  </ArkmeConfirmDialog>
}
