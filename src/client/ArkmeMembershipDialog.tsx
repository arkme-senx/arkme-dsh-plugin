import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import type { ArkmeMembershipCatalog } from '../types.js'
import { callArkme } from './api.js'
import { suspendArkmeVisibleReadIntent } from './read-intent-visibility.js'
import { membershipDescription, membershipLabel, type MembershipState } from './arkme-membership.js'

// Summary from Flutter's shared H5 membership-rights definitions. Full comparison
// opens the SAME mobile page, not a second desktop-only entitlement table.
export const MEMBERSHIP_SUMMARY = {
  1: ['50 GB 存储空间', '每月 1,200 分钟转写', '共享主题最多 200 位协作者', '2 级主题整理', 'AI 润色与隐私锁'],
  2: ['100 GB 存储空间', '每月 3,600 分钟转写', '共享主题最多 500 位协作者', '5 级主题整理', 'AI 润色与隐私锁'],
} as const

export function ArkmeMembershipDialog({ userId, state, onRefresh, onClose, returnFocusRef }: {
  userId: number; state: MembershipState; onRefresh: () => void; onClose: () => void; returnFocusRef?: RefObject<HTMLElement>
}) {
  useLayoutEffect(suspendArkmeVisibleReadIntent, [])
  const [chosenTier, setTier] = useState<1 | 2>()
  const tier = chosenTier ?? (state.status === 'ready' && state.value.memberType === 2 ? 2 : 1)
  const [catalog, setCatalog] = useState<ArkmeMembershipCatalog>()
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [guidance, setGuidance] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => {
      element?.close()
      // The profile menu is unmounted on entry. Restore to its stable avatar,
      // after the native dialog has performed its own focus restoration.
      queueMicrotask(() => returnFocusRef?.current?.focus({ preventScroll: true }))
    }
  }, [returnFocusRef])
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setFailed(false); setCatalog(undefined)
    void callArkme<ArkmeMembershipCatalog>('membership.catalog', { expectedUserId: userId }, controller.signal)
      .then(value => { if (active) { if (value.userId === userId) setCatalog(value); else setFailed(true) } })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false; controller.abort() }
  }, [userId, revision])
  const products = catalog?.products.filter(product => product.memberType === tier) ?? []
  const selected = products.find(product => product.id === selectedId) ?? products[0]
  const lifetime = state.status === 'ready' && state.value.lifetime
  const label = tier === 1 ? 'VIP' : 'SVIP'
  return createPortal(<dialog ref={dialog} className="arkme-membership-dialog" aria-label="即我会员" data-arkme-notification-blocking-overlay="true"
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose() }}
    onKeyDown={event => {
      event.stopPropagation()
      if (event.key !== 'Tab') return
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled)')]
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }}>
    <header><div><h2>即我会员</h2><p>让记录、整理与协作更从容</p></div><button type="button" autoFocus className="arkme-member-icon" aria-label="关闭会员窗口" onClick={onClose}><X size={20} /></button></header>
    <div className="arkme-member-current" aria-live="polite"><div><strong>{membershipLabel(state)}</strong><span>{membershipDescription(state)}</span></div><button type="button" onClick={onRefresh} disabled={state.status === 'loading'}>{state.status === 'loading' ? '读取中…' : '刷新状态'}</button></div>
    <div className="arkme-member-tabs" aria-label="会员等级">
      {([1, 2] as const).map(value => <button type="button" key={value} aria-pressed={tier === value} onClick={() => { setTier(value); setGuidance(false) }}>{value === 1 ? 'VIP' : 'SVIP'}</button>)}
    </div>
    <div className="arkme-member-columns">
      <section className="arkme-member-benefits"><h3>{label} 核心权益</h3><ul>{MEMBERSHIP_SUMMARY[tier].map(text => <li key={text}><Check size={18} aria-hidden />{text}</li>)}</ul><a href={`https://jiwo.cc/app/membership/rights?member_type=${tier === 1 ? 'vip' : 'svip'}&lang=zh&theme=system`} target="_blank" rel="noopener noreferrer">查看完整权益对比 ↗</a><small>与手机端共用权益说明</small></section>
      <section className="arkme-member-plans" aria-label="会员套餐"><h3>{lifetime ? '你已享有永久会员权益' : '选择套餐'}</h3>
        {lifetime ? <p>无需重复开通，当前会员权益可在同一账号下使用。</p> : <>
          {failed ? <p role="status">套餐暂时无法读取。<button type="button" onClick={() => setRevision(value => value + 1)}>重试</button></p> : !catalog ? <p role="status">正在读取在售套餐…</p> : products.length === 0 ? <p>暂无在售 {label} 套餐</p> : <div className="arkme-member-products" role="radiogroup" aria-label={`${label} 套餐`}>
            {products.map(product => <label key={product.id} className={selected?.id === product.id ? 'is-selected' : ''}>
              <input type="radio" name="arkme-membership-product" checked={selected?.id === product.id} onChange={() => { setSelectedId(product.id); setGuidance(false) }} />
              <span><strong>{product.name}</strong><small>{product.recurring ? '自动续费套餐' : '一次性购买 · 不自动续费'}</small></span><b>¥{(product.priceMinor / 100).toFixed(2)}</b>
            </label>)}
          </div>}
          {selected && <><button type="button" className="arkme-member-primary" onClick={() => setGuidance(true)}>开通 {label} · ¥{(selected.priceMinor / 100).toFixed(2)}</button><p className="arkme-member-note">{selected.recurring ? '所选为自动续费套餐，续费条款以正式支付页为准。' : '所选套餐为一次性购买，不自动续费。'}价格来自当前在售套餐。</p></>}
          {guidance && <div className="arkme-member-guidance" role="status">桌面端支付开发中，敬请期待。本次不会创建订单或扣款。</div>}
        </>}
      </section>
    </div>
  </dialog>, document.body)
}
