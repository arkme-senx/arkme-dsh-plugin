import { useEffect, useState } from 'react'
import { ArrowLeft } from '@phosphor-icons/react/ArrowLeft'
import { CaretRight } from '@phosphor-icons/react/CaretRight'
import { Folder } from '@phosphor-icons/react/Folder'
import { House } from '@phosphor-icons/react/House'
import { X } from '@phosphor-icons/react/X'
import type { DirectoryListing } from '@deepseek-ai/dsh-client-runtime/client'

export function ArkmeWorkspaceDialog({
  open,
  busy,
  listDirectory,
  onCancel,
  onSelect,
}: {
  open: boolean
  busy: boolean
  listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  onCancel(): void
  onSelect(path: string): void
}) {
  const [path, setPath] = useState<string>()
  const [listing, setListing] = useState<DirectoryListing>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setPath(undefined)
      setListing(undefined)
      setError('')
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void listDirectory(path, controller.signal)
      .then(setListing)
      .catch(caught => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '目录读取失败')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort() }
  }, [listDirectory, open, path])

  if (!open) return null
  const visibleEntries = (listing?.entries ?? []).filter(entry => !entry.hidden)
  return <div className="arkme-workspace-dialog-backdrop" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget && !busy) onCancel()
  }}>
    <section className="arkme-workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="arkme-workspace-dialog-title">
      <header>
        <div><span>任务工作区</span><h2 id="arkme-workspace-dialog-title">选择 Agent 要处理的目录</h2></div>
        <button type="button" aria-label="关闭工作区选择" disabled={busy} onClick={onCancel}><X size={18} /></button>
      </header>
      <nav aria-label="目录路径">
        {(listing?.crumbs ?? []).map((crumb, index) => <span key={crumb.path}>
          {index > 0 && <CaretRight size={12} />}
          <button type="button" disabled={loading || busy} onClick={() => { setPath(crumb.path) }}>
            {index === 0 ? <House size={14} /> : null}{crumb.name}
          </button>
        </span>)}
      </nav>
      <div className="arkme-workspace-directory-list">
        {loading && <div className="arkme-workspace-dialog-status">正在读取目录…</div>}
        {!loading && error !== '' && <div className="arkme-workspace-dialog-error" role="alert">{error}</div>}
        {!loading && error === '' && visibleEntries.map(entry => <button type="button" key={entry.path} onClick={() => { setPath(entry.path) }}>
          <span><Folder size={19} /></span><strong>{entry.name}</strong><CaretRight size={15} />
        </button>)}
        {!loading && error === '' && visibleEntries.length === 0 && <div className="arkme-workspace-dialog-status">当前目录没有子目录</div>}
      </div>
      <footer>
        <button type="button" className="arkme-workspace-dialog-back" disabled={loading || busy || (listing?.crumbs.length ?? 0) <= 1} onClick={() => {
          const parent = listing?.crumbs.at(-2)
          if (parent !== undefined) setPath(parent.path)
        }}><ArrowLeft size={15} />上一级</button>
        <div><small>{listing?.path ?? '正在读取…'}</small><button type="button" disabled={loading || busy || listing === undefined} onClick={() => {
          if (listing !== undefined) onSelect(listing.path)
        }}>{busy ? '正在准备…' : '使用此目录'}</button></div>
      </footer>
    </section>
  </div>
}
