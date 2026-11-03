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
  copyUrl?: string | undefined; refreshing?: boolean; refreshError?: string
  accountScope: string; copyLinkTarget?: IdentityShareTarget | undefined
  busy: boolean; worldBusy?: boolean; worldDisabled?: boolean; loading?: boolean; pending?: boolean
  error?: string | undefined
  onClose(): void; onSend(): void; onWorld(): void
  onContactAsTeam?: (() => void) | undefined
  onRefresh?: (() => void) | undefined; browserUrl?: string | undefined
}) {
  const locale = useArkmeLocale()
  const titleId = useId(), [more, setMore] = useState(false)
  const [sendState, setSendState] = useState('idle')
  return <ArkmeConfirmDialog layout="picker" titleId={titleId}
    title={tr('{v0} 的用户卡片', { v0: props.displayName })} busy={props.busy || Boolean(props.worldBusy)}
    onClose={props.onClose} dialogStyle={{ width: 'min(390px, 100%)', borderRadius: 18 }}>
    <div className="arkme-person-card" data-arkme-member-profile data-arkme-person-profile="unified" data-arkme-person-profile-ready={props.pending ? undefined : "true"} aria-busy={props.pending || undefined}>
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
          data-arkme-profile-send-state={props.busy ? 'loading' : sendState} disabled={props.busy || props.worldBusy || props.pending}
          aria-busy={props.busy || undefined} onPointerEnter={() => setSendState('hover')} onPointerLeave={() => setSendState('idle')}
          onPointerDown={() => setSendState('active')} onPointerUp={() => setSendState('hover')} onClick={props.onSend}>
          <ChatCircleIcon size={18} aria-hidden />{tr(props.busy ? '正在打开…' : props.isSelf ? '发给自己' : locale === 'en' ? '发送消息' : '发消息')}
        </button>
        {(props.onContactAsTeam || props.pending) && !props.isSelf && <button type="button" className="arkme-person-button" data-arkme-feedback="neutral"
          disabled={props.busy || props.worldBusy || props.pending} onClick={props.onContactAsTeam}><UsersIcon size={18} aria-hidden />{tr('以团队联系')}</button>}
      </div>}
      {(props.copyLinkTarget || props.copyUrl || props.onRefresh || props.browserUrl || props.pending) && <footer className="arkme-person-footer">
        <div className="arkme-person-copy">{props.pending && !props.copyUrl && <span className="arkme-person-skeleton" aria-hidden style={{ width: 100, height: 13 }} />}{(props.copyLinkTarget || props.copyUrl) && <IdentityCopyLinkButton accountScope={props.accountScope} {...(props.copyUrl ? { url: props.copyUrl } : { target: props.copyLinkTarget! })}
          className="arkme-person-text-button" style={{}} label="复制个人链接" iconSize={15} />}</div>
        <span className="arkme-person-refresh" role="status">
          {props.refreshing && !props.pending ? tr('更新中…') : props.refreshError && <><span title={props.refreshError}>{props.refreshError}</span><button type="button" className="arkme-person-text-button" aria-label={tr('重试更新名片')} disabled={props.busy || props.worldBusy} onClick={props.onRefresh}>{tr('重试')}</button></>}
        </span>
        {(props.onRefresh || props.browserUrl) && <div className="arkme-person-more">
          <button type="button" className="arkme-person-icon" aria-label={tr('更多操作')} aria-expanded={more}
            disabled={props.busy || props.worldBusy} onClick={() => setMore(value => !value)}><DotsThreeIcon size={23} weight="bold" aria-hidden /></button>
          {more && <div className="arkme-person-more-panel">
            {props.onRefresh && <button type="button" disabled={props.refreshing} onClick={() => { setMore(false); props.onRefresh?.() }}>{tr(props.refreshing ? '更新中…' : '刷新名片')}</button>}
            {props.browserUrl && <a href={props.browserUrl} target="_blank" rel="noopener noreferrer">{tr('在浏览器中打开')}</a>}
          </div>}
        </div>}
      </footer>}
    </div>
  </ArkmeConfirmDialog>
}
