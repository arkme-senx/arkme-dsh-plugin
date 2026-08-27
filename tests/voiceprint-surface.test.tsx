import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  ArkmeVoiceprintContent,
  ArkmeVoiceprintSurface,
  RecognizedPersonDialog,
} from '../src/client/ArkmeVoiceprintSurface.js'

const noop = vi.fn()

function buttonByText(node: ReactNode, text: string): ReactElement<{ onClick?: (event: unknown) => void }> {
  if (isValidElement(node)) {
    const element = node as ReactElement<{ children?: ReactNode; onClick?: (event: unknown) => void }>
    if (element.type === 'button' && renderToStaticMarkup(element).includes(text)) return element
    for (const child of Children.toArray(element.props.children)) {
      try { return buttonByText(child, text) } catch {}
    }
  }
  throw new Error(`button not found: ${text}`)
}

function elementByAriaLabel(node: ReactNode, label: string): ReactElement<Record<string, unknown>> {
  if (isValidElement(node)) {
    const element = node as ReactElement<Record<string, unknown>>
    if (element.props['aria-label'] === label) return element
    for (const child of Children.toArray(element.props.children as ReactNode)) {
      try { return elementByAriaLabel(child, label) } catch {}
    }
  }
  throw new Error(`element not found: ${label}`)
}

describe('Arkme voiceprint management surface', () => {
  it('owns a full-page voiceprint surface with one foundation layer and directional relationship sections', () => {
    const markup = renderToStaticMarkup(<ArkmeVoiceprintSurface />)

    expect(markup).toContain('data-arkme-owned="voiceprint-surface"')
    expect(markup).toContain('声纹管理')
    expect(markup).toContain('data-voiceprint-layer="foundation"')
    expect(markup).toContain('data-voiceprint-layout="primary-secondary"')
    expect(markup).toContain('我的声音')
    expect(markup).toContain('我识别到的人')
    expect(markup).toContain('谁能播放我的声音')
    expect(markup).toContain('邀请他人授权')
    expect(markup).not.toContain('aria-label="邀请他人授权"')
  })

  it('places the generic invitation with incoming permissions and keeps outbound grants separate', () => {
    const content = ArkmeVoiceprintContent({
      status: { status: 'loading' }, grants: { status: 'loading' }, people: { status: 'loading' },
      invitation: { status: 'idle' }, onRefreshStatus: noop, onRefreshGrants: noop, onRefreshPeople: noop,
      onInvite: noop, onRevoke: noop, onRestore: noop, onOpenPerson: noop, onStartEnrollment: noop,
    })
    const recognized = renderToStaticMarkup(elementByAriaLabel(content, '我识别到的人'))
    const outboundGrants = renderToStaticMarkup(elementByAriaLabel(content, '谁能播放我的声音'))

    expect(recognized).toContain('邀请他人授权')
    expect(recognized).toContain('邀请由对方明确授权')
    expect(outboundGrants).toContain('正在加载谁能播放我的声音')
    expect(outboundGrants).not.toContain('邀请他人授权')
  })

  it('renders independent loading, error, empty and success states without mixing references', () => {
    const loading = renderToStaticMarkup(<ArkmeVoiceprintContent
      status={{ status: 'loading' }} grants={{ status: 'loading' }} people={{ status: 'loading' }}
      invitation={{ status: 'idle' }} onRefreshStatus={noop} onRefreshGrants={noop} onRefreshPeople={noop}
      onInvite={noop} onRevoke={noop} onRestore={noop} onOpenPerson={noop} onStartEnrollment={noop}
    />)
    expect(loading.match(/正在加载/g)?.length).toBeGreaterThanOrEqual(3)

    const error = renderToStaticMarkup(<ArkmeVoiceprintContent
      status={{ status: 'error', message: '状态不可用' }}
      grants={{ status: 'success', value: { items: [], nextCursor: '', hasMore: false } }}
      people={{ status: 'success', value: { items: [], nextCursor: '', hasMore: false } }}
      invitation={{ status: 'error', message: '邀请失败' }}
      onRefreshStatus={noop} onRefreshGrants={noop} onRefreshPeople={noop} onInvite={noop}
      onRevoke={noop} onRestore={noop} onOpenPerson={noop} onStartEnrollment={noop}
    />)
    expect(error).toContain('状态不可用')
    expect(error).toContain('还没有人可以播放你的声音')
    expect(error).toContain('还没有识别到其他人')
    expect(error).toContain('邀请失败')

    const success = renderToStaticMarkup(<ArkmeVoiceprintContent
      status={{ status: 'success', value: {
        hasVoiceprint: true, nickname: '我的声音', updatedAtMillis: 1, canIdentify: true, canPlay: false,
        canRestorePlayback: true, enrollmentStatus: 'ready', enrollmentPending: false,
      } }}
      grants={{ status: 'success', value: { items: [{
        grantRef: 'arkme-voiceprint-grant-v1.secret', displayName: '小林', avatarRef: 'avatar-grant', identifyEnabled: true,
        playEnabled: true, grantedAtMillis: 2, updatedAtMillis: 3,
      }], nextCursor: '', hasMore: false } }}
      people={{ status: 'success', value: { items: [{
        personRef: 'arkme-voiceprint-person-v1.secret', identityKind: 'speaker', displayName: '会议中的同事',
        avatarRef: 'avatar-person',
        playGranted: false, previewAvailable: false, canInvite: true, inviteTargetSelectionRequired: true,
      }], nextCursor: '', hasMore: false } }}
      invitation={{ status: 'success', value: { inviteUrl: 'https://example.test/v?p=x#t=y', expiresAtMillis: 4 } }}
      onRefreshStatus={noop} onRefreshGrants={noop} onRefreshPeople={noop} onInvite={noop}
      onRevoke={noop} onRestore={noop} onOpenPerson={noop} onStartEnrollment={noop}
    />)
    expect(success).toContain('我的声音')
    expect(success).toContain('恢复声纹播放')
    expect(success).toContain('小林')
    expect(success).toContain('撤销播放授权')
    expect(success).toContain('会议中的同事')
    expect(success).toContain('小林的头像')
    expect(success).toContain('会议中的同事的头像')
    expect(success).toContain('查看识别详情')
    expect(success).toContain('复制邀请链接')
    expect(success).toContain('刷新状态')
    expect(success).toContain('刷新授权')
    expect(success).toContain('刷新识别')
    expect(success).not.toContain('arkme-voiceprint-grant-v1.secret')
    expect(success).not.toContain('arkme-voiceprint-person-v1.secret')
  })

  it('uses DSH semantic colors for error and destructive states', () => {
    const markup = renderToStaticMarkup(<ArkmeVoiceprintContent
      status={{ status: 'error', message: '状态不可用' }}
      grants={{ status: 'success', value: { items: [{
        grantRef: 'grant-ref', displayName: '小林', identifyEnabled: true, playEnabled: true,
        grantedAtMillis: 1, updatedAtMillis: 1,
      }], nextCursor: '', hasMore: false } }}
      people={{ status: 'success', value: { items: [], nextCursor: '', hasMore: false } }}
      invitation={{ status: 'idle' }} onRefreshStatus={noop} onRefreshGrants={noop} onRefreshPeople={noop}
      onInvite={noop} onRevoke={noop} onRestore={noop} onOpenPerson={noop} onStartEnrollment={noop}
    />)

    expect(markup).toContain('var(--dsw-alias-state-error-primary')
    expect(markup).toContain('var(--dsw-alias-interactive-bg-hover-danger')
    expect(markup).not.toContain('background:#fff1f0')
    expect(markup).not.toContain('color:#b42318')
  })

  it('does not forward React click events into refresh request parameters', () => {
    const onRefreshStatus = vi.fn()
    const onRefreshGrants = vi.fn()
    const onRefreshPeople = vi.fn()
    const content = ArkmeVoiceprintContent({
      status: { status: 'loading' }, grants: { status: 'loading' }, people: { status: 'loading' },
      invitation: { status: 'idle' }, onRefreshStatus, onRefreshGrants, onRefreshPeople,
      onInvite: noop, onRevoke: noop, onRestore: noop, onOpenPerson: noop, onStartEnrollment: noop,
    })
    const clickEvent = { type: 'click' }

    buttonByText(content, '刷新状态').props.onClick?.(clickEvent)
    buttonByText(content, '刷新授权').props.onClick?.(clickEvent)
    buttonByText(content, '刷新识别').props.onClick?.(clickEvent)

    expect(onRefreshStatus).toHaveBeenCalledWith()
    expect(onRefreshGrants).toHaveBeenCalledWith()
    expect(onRefreshPeople).toHaveBeenCalledWith()
  })

  it('keeps pagination failure visible while preserving existing rows', () => {
    const markup = renderToStaticMarkup(<ArkmeVoiceprintContent
      status={{ status: 'loading' }}
      grants={{ status: 'success', message: '更多授权加载失败', value: { items: [{
        grantRef: 'grant-ref', displayName: '小林', identifyEnabled: true, playEnabled: true,
        grantedAtMillis: 1, updatedAtMillis: 1,
      }], nextCursor: 'next', hasMore: true } }}
      people={{ status: 'success', message: '更多识别人加载失败', value: {
        items: [{
          personRef: 'person-ref', identityKind: 'speaker', displayName: '会议中的同事', playGranted: false,
          previewAvailable: false, canInvite: false, inviteTargetSelectionRequired: false,
        }], nextCursor: 'next', hasMore: true,
      } }}
      invitation={{ status: 'idle' }} onRefreshStatus={noop} onRefreshGrants={noop} onRefreshPeople={noop}
      onMoreGrants={noop} onMorePeople={noop} onInvite={noop} onRevoke={noop} onRestore={noop}
      onOpenPerson={noop} onStartEnrollment={noop}
    />)

    expect(markup).toContain('小林')
    expect(markup).toContain('会议中的同事')
    expect(markup).toContain('更多授权加载失败')
    expect(markup).toContain('更多识别人加载失败')
    expect(markup).toContain('加载更多授权')
    expect(markup).toContain('加载更多识别人')
  })

  it('asks for a contact only when an unbound recognized person needs target selection', () => {
    const bound = renderToStaticMarkup(<RecognizedPersonDialog
      person={{ status: 'success', value: {
        personRef: 'bound', identityKind: 'speaker', displayName: '已绑定的人', playGranted: false,
        previewAvailable: false, canInvite: true, inviteTargetSelectionRequired: false,
      } }}
      library={{ status: 'success', value: { items: [{ kind: 'authorized', hitCount: 0 }] } }} targetIdentifier="" invitation={{ status: 'idle' }}
      onRetryPerson={noop} onRetryLibrary={noop} onTargetIdentifierChange={noop} onSearchTarget={noop} onInvite={noop} onClose={noop}
    />)
    const unbound = renderToStaticMarkup(<RecognizedPersonDialog
      person={{ status: 'success', value: {
        personRef: 'unbound', identityKind: 'speaker', displayName: '未绑定的声音', playGranted: false,
        previewAvailable: false, canInvite: true, inviteTargetSelectionRequired: true,
      } }}
      library={{ status: 'success', value: { items: [] } }} targetIdentifier="" invitation={{ status: 'idle' }}
      onRetryPerson={noop} onRetryLibrary={noop} onTargetIdentifierChange={noop} onSearchTarget={noop} onInvite={noop} onClose={noop}
    />)

    expect(bound).toContain('生成专属邀请')
    expect(bound).toContain('命中 0 次')
    expect(bound).not.toContain('手机号或 Arkme ID')
    expect(unbound).toContain('手机号或 Arkme ID')
  })

  it('never presents speaker-owned voiceprint assets as an authorized-user library', () => {
    const markup = renderToStaticMarkup(<RecognizedPersonDialog
      person={{ status: 'success', value: {
        personRef: 'authorized-user', identityKind: 'authorized_user', displayName: '已授权用户',
        playGranted: true, previewAvailable: true, canInvite: false,
        inviteTargetSelectionRequired: false,
      } }}
      library={{ status: 'success', value: { items: [{ kind: 'local', hitCount: 3 }] } }}
      targetIdentifier="" invitation={{ status: 'idle' }}
      onRetryPerson={noop} onRetryLibrary={noop} onTargetIdentifierChange={noop}
      onSearchTarget={noop} onInvite={noop} onClose={noop}
    />)

    expect(markup).toContain('已授权的用户')
    expect(markup).not.toContain('声纹记录')
    expect(markup).not.toContain('本地识别声纹')
  })

  it('offers direct recovery when person detail or speaker library loading fails', () => {
    const detailError = renderToStaticMarkup(<RecognizedPersonDialog
      person={{ status: 'error', message: '识别详情加载失败' }}
      targetIdentifier="" invitation={{ status: 'idle' }}
      onRetryPerson={noop} onRetryLibrary={noop} onTargetIdentifierChange={noop}
      onSearchTarget={noop} onInvite={noop} onClose={noop}
    />)
    const libraryError = renderToStaticMarkup(<RecognizedPersonDialog
      person={{ status: 'success', value: {
        personRef: 'speaker', identityKind: 'speaker', displayName: '已识别声音', playGranted: false,
        previewAvailable: false, canInvite: false, inviteTargetSelectionRequired: false,
      } }}
      library={{ status: 'error', message: '声纹记录加载失败' }} targetIdentifier="" invitation={{ status: 'idle' }}
      onRetryPerson={noop} onRetryLibrary={noop} onTargetIdentifierChange={noop}
      onSearchTarget={noop} onInvite={noop} onClose={noop}
    />)

    expect(detailError).toContain('重试')
    expect(libraryError).toContain('重试')
  })

})
