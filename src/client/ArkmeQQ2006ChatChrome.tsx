import type { CSSProperties, ReactNode, Ref } from 'react'
import { arkmeQQ2006ChatAssets as a } from './qq2006-chat-assets.js'

type Action = (() => void) | undefined

export const arkmeQQ2006ChatSkinStyle = {
  '--arkme-qq-body-bg': `url("${a.backgroundCenter}")`,
  '--arkme-qq-title-left': `url("${a.titleLeft}")`,
  '--arkme-qq-title-center': `url("${a.titleCenter}")`,
  '--arkme-qq-title-right': `url("${a.titleRight}")`,
  '--arkme-qq-head-left': `url("${a.headLeft}")`,
  '--arkme-qq-head-center': `url("${a.headCenter}")`,
  '--arkme-qq-head-right': `url("${a.headRight}")`,
  '--arkme-qq-small-toolbar-bg': `url("${a.smallToolbarBackground}")`,
  '--arkme-qq-color-normal': `url("${a.colorNormal}")`,
  '--arkme-qq-color-hover': `url("${a.colorHover}")`,
  '--arkme-qq-color-down': `url("${a.colorDown}")`,
  '--arkme-qq-menu-normal': `url("${a.menuNormal}")`,
  '--arkme-qq-menu-hover': `url("${a.menuHover}")`,
  '--arkme-qq-menu-down': `url("${a.menuDown}")`,
  '--arkme-qq-min-normal': `url("${a.minNormal}")`,
  '--arkme-qq-min-hover': `url("${a.minHover}")`,
  '--arkme-qq-min-down': `url("${a.minDown}")`,
  '--arkme-qq-close-normal': `url("${a.closeNormal}")`,
  '--arkme-qq-close-hover': `url("${a.closeHover}")`,
  '--arkme-qq-close-down': `url("${a.closeDown}")`,
} as CSSProperties

function ImageTool({ label, asset, action, className = 'arkme-qq2006-image-tool' }: {
  label: string
  asset: string
  action: Action
  className?: string
}) {
  const unavailable = action === undefined
  return <button
    type="button"
    className={className}
    aria-label={label}
    title={unavailable ? `${label}（当前 Arkme 会话暂不可用）` : label}
    disabled={unavailable}
    onMouseDown={event => { event.preventDefault() }}
    onClick={action}
  ><img src={asset} alt="" draggable={false} /></button>
}

export function ArkmeQQ2006WindowChrome({
  title,
  avatar,
  group,
  collapsed,
  onOpenMenu,
  onToggleCollapsed,
  onFocusComposer,
  onSelectFiles,
  onLongArticle,
  onOpenMembers,
  onScrollLatest,
  onInsertMusic,
}: {
  title: string
  avatar: ReactNode
  group: boolean
  collapsed: boolean
  onOpenMenu(): void
  onToggleCollapsed(): void
  onFocusComposer(): void
  onSelectFiles(): void
  onLongArticle(): void
  onOpenMembers?: () => void
  onScrollLatest(): void
  onInsertMusic(): void
}) {
  const tools: readonly [string, string, Action][] = [
    ['短信', a.bigSms, onFocusComposer],
    ['视频', a.bigVideo, undefined],
    ['语音', a.bigVoice, undefined],
    ['传文件', a.bigFile, onSelectFiles],
    ['3D秀', a.big3d, onLongArticle],
    ['邀请', a.bigInvite, onOpenMembers],
    ['分享', a.bigShare, onOpenMenu],
    ['音乐', a.bigMusic, onInsertMusic],
    ['群邮件', a.bigGroupmail, onLongArticle],
    ['窗口', a.bigWindow, onScrollLatest],
    ['黑名单', a.bigBlacklist, undefined],
    ['群空间', a.bigGroup, onOpenMembers],
  ]
  return <div className="arkme-qq2006-window-chrome" data-collapsed={collapsed ? 'true' : 'false'}>
    <div className="arkme-qq2006-title-band">
      <div className="arkme-qq2006-title-row">
        <span className="arkme-qq2006-title-text" title={title}>{title}</span>
        <div className="arkme-qq2006-title-buttons">
          <button type="button" className="arkme-qq2006-title-button is-color" aria-label="更换颜色（当前不可用）" disabled />
          <button type="button" className="arkme-qq2006-title-button is-menu" aria-label="菜单" onClick={onOpenMenu} />
          <button type="button" className="arkme-qq2006-title-button is-min" aria-label={collapsed ? '还原工具栏' : '隐藏工具栏'} onClick={onToggleCollapsed} />
          <button type="button" className="arkme-qq2006-title-button is-close" aria-label="关闭（Arkme 主窗口保留）" disabled />
        </div>
      </div>
    </div>
    <div className="arkme-qq2006-head-band">
      <div className="arkme-qq2006-big-toolbar" role="toolbar" aria-label="QQ2006 会话工具栏">
        {tools.map(([label, asset, action]) => <ImageTool key={label} label={label} asset={asset} action={action} />)}
      </div>
    </div>
    <div className="arkme-qq2006-friend-info">
      <span className="arkme-qq2006-friend-avatar">{avatar}</span>
      <strong>{title}</strong>
      <span>{group ? '群聊消息正在同步' : '正在与你聊天'}</span>
    </div>
  </div>
}

export function ArkmeQQ2006SmallToolbar({
  menuTriggerRef,
  emojiTrigger,
  onCycleFont,
  onOpenMenu,
  onSelectFiles,
  onLongArticle,
  onCelebrate,
}: {
  menuTriggerRef: Ref<HTMLButtonElement>
  emojiTrigger: ReactNode
  onCycleFont(): void
  onOpenMenu(): void
  onSelectFiles(): void
  onLongArticle(): void
  onCelebrate(): void
}) {
  return <div className="arkme-qq2006-small-toolbar" role="toolbar" aria-label="QQ2006 编辑工具栏">
    <ImageTool label="A 字体" asset={a.smallFont} action={onCycleFont} className="arkme-qq2006-small-tool" />
    {emojiTrigger}
    <button
      ref={menuTriggerRef}
      type="button"
      className="arkme-qq2006-small-tool"
      aria-label="其他"
      title="其他"
      onMouseDown={event => { event.preventDefault() }}
      onClick={onOpenMenu}
    ><img src={a.smallOther} alt="" draggable={false} /></button>
    <span className="arkme-qq2006-toolbar-separator" aria-hidden />
    <ImageTool label="图片" asset={a.smallPicture} action={onSelectFiles} className="arkme-qq2006-small-tool" />
    <ImageTool label="截图（当前不可用）" asset={a.smallCatch} action={undefined} className="arkme-qq2006-small-tool" />
    <ImageTool label="写长文" asset={a.smallScene} action={onLongArticle} className="arkme-qq2006-small-tool" />
    <ImageTool label="超级表情" asset={a.smallSuperbag} action={onCelebrate} className="arkme-qq2006-small-tool" />
    <ImageTool label="语音对讲（当前不可用）" asset={a.smallPtt} action={undefined} className="arkme-qq2006-small-tool" />
  </div>
}

export function ArkmeQQ2006InputActions({ group, canSend, onSend }: {
  group: boolean
  canSend: boolean
  onSend(): void
}) {
  return <div className="arkme-qq2006-input-actions">
    <span>Enter 发送，Shift+Enter 换行</span>
    <button type="button" className="arkme-qq2006-send" disabled={!canSend} onClick={onSend}>
      {group ? '发送到群(S)' : '发送(S)'}
    </button>
  </div>
}

export function ArkmeQQ2006BottomRow({
  onLoadOlder,
  onLongArticle,
  onScrollLatest,
  onOpenMenu,
  onCelebrate,
  onSelectFiles,
  onInsertMusic,
}: {
  onLoadOlder?: () => void
  onLongArticle(): void
  onScrollLatest(): void
  onOpenMenu(): void
  onCelebrate(): void
  onSelectFiles(): void
  onInsertMusic(): void
}) {
  const tools: readonly [string, string, Action][] = [
    ['聊天记录(H)', 'H', onLoadOlder],
    ['消息模式(T)', 'T', onLongArticle],
    ['滚动到最新消息', '↓', onScrollLatest],
    ['打开菜单', '☰', onOpenMenu],
    ['插入表情', '☺', onCelebrate],
    ['插入图片', '🖼', onSelectFiles],
    ['复制最近回复（当前不可用）', '✂', undefined],
    ['音乐', '🎵', onInsertMusic],
  ]
  return <div className="arkme-qq2006-bottom-row" role="toolbar" aria-label="QQ2006 会话底栏">
      {tools.map(([label, glyph, action]) => <button
        key={label}
        type="button"
        aria-label={label}
        title={action === undefined ? label : undefined}
        disabled={action === undefined}
        onMouseDown={event => { event.preventDefault() }}
        onClick={action}
      >{glyph}</button>)}
    </div>
}
