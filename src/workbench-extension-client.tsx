import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { HouseLine } from '@phosphor-icons/react/dist/icons/HouseLine'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ArkmeDirectoryEntryOwnerProps } from './client/slots-contract.js'
import { ArkmeWorkbenchSurface } from './client/ArkmeWorkbenchSurface.js'
import workbenchCss from './client/redesign/arkme-redesign.css?inline'

const ENTRY_ID = 'arkme-workbench'

export const inject = ['slots']

export function ArkmeWorkbenchDirectoryEntry({ activeEntryId, activateEntry, renderRow }: ArkmeDirectoryEntryOwnerProps) {
  const selected = activeEntryId === ENTRY_ID
  const [surface, setSurface] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!selected) { setSurface(null); return }
    setSurface(document.querySelector<HTMLElement>('.arkme-conversation-panel'))
  }, [selected])
  return <>
    {renderRow({
      avatar: <span className="arkme-conversation-workbench-icon"><HouseLine size={20} aria-hidden /></span>,
      title: '工作台',
      preview: '我的本地资料库',
      selected,
      onClick: () => { activateEntry(ENTRY_ID) },
    })}
    {selected && surface !== null && createPortal(<div className="arkme-workbench-extension-surface"><ArkmeWorkbenchSurface /></div>, surface)}
  </>
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.pluginCss = '@senguoyun/arkme-workbench'
    style.textContent = workbenchCss
    document.head.append(style)
    const dispose = ctx.slots.inject('arkme.directory.entry', () => ctx.slots.register({
      name: 'arkme.directory.entry',
      id: ENTRY_ID,
      order: -100,
      inject: () => ({} as never),
    }, ArkmeWorkbenchDirectoryEntry as never))
    return () => { dispose(); style.remove() }
  }, 'arkme-workbench: conversation directory entry')
}
