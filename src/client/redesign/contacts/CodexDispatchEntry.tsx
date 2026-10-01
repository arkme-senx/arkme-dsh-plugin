import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { tr, useArkmeLocale } from '../../locale.js'
import { CodexDispatchComposer } from './CodexDispatchComposer.js'

/** Explicitly gated preview: no API, installer, permission probe or dispatch callback. */
export function CodexDispatchEntry({ scopeKey, mode }: { scopeKey: string; mode: 'local' | 'remote' | 'readonly' }) {
  return <ScopedEntry key={`${scopeKey}:${mode}`} scopeKey={scopeKey} mode={mode}/>
}
function ScopedEntry({ scopeKey, mode }: { scopeKey: string; mode: 'local' | 'remote' | 'readonly' }) {
  useArkmeLocale()
  const [open, setOpen] = useState(false)
  if (mode !== 'local') return <p className="arkme-codex-dispatch-readonly">{tr(mode === 'remote'
    ? '这项任务来自其他电脑，云端派发尚未接通' : '仅查看成员对话，不开放操作对方电脑')}</p>
  return <>
    <CodexDispatchComposer scopeKey={scopeKey} availability="integration_pending" onConnect={() => setOpen(true)}/>
    {open && <CodexHelperGuide onClose={() => setOpen(false)}/>}
  </>
}
function CodexHelperGuide({ onClose }: { onClose(): void }) {
  const id = useId()
  const dialog = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
    if (event.key !== 'Tab' || typeof document === 'undefined') return
    const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
    const first = buttons?.[0], last = buttons?.[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  const content = <div className="arkme-contact-remark-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialog} className="arkme-contact-remark-dialog arkme-codex-helper-guide" role="dialog" aria-modal="true"
      aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onKeyDown={keyDown}>
      <header className="arkme-contact-remark-header">
        <h2 id={`${id}-title`}>{tr('连接 Codex 助手')}</h2>
        <button type="button" className="arkme-contact-remark-close" aria-label={tr('关闭')} onClick={onClose}>×</button>
      </header>
      <p id={`${id}-description`}>{tr('无需修改 Arkme 客户端。后续由独立安装的本机助手，代你向 Codex 输入需求并加入队列。')}</p>
      <p className="arkme-codex-helper-pending" role="status">{tr('助手派发功能接入中，暂不可发送')}</p>
      <ol>
        <li><strong>{tr('安装并打开独立助手')}</strong><span>{tr('当前验证版尚未接通 Arkme 接单，暂不提供正式安装入口。')}</span></li>
        <li><strong>{tr('为助手授予系统控制权限')}</strong><span>{tr('在 macOS「隐私与安全」中的「设备控制和数据访问」（旧版为「辅助功能」）授权助手，而不是 Arkme 客户端。')}</span></li>
        <li><strong>{tr('确认账号、团队与来源电脑，开启自动输入')}</strong><span>{tr('同步记录不等于授权操作；执行时会短暂切换到 Codex，锁屏或存在草稿时等待。')}</span></li>
      </ol>
      <p className="arkme-codex-helper-note">{tr('当前入口不会创建请求、发送消息或更改系统权限。')}</p>
      <footer className="arkme-contact-remark-footer"><button type="button" className="arkme-contact-remark-confirm" onClick={onClose}>{tr('知道了')}</button></footer>
    </section>
  </div>
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}
