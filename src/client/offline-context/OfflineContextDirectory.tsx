import { useId, useState } from 'react'
import type { ArkmeSourceItem, ArkmeTimelineItem } from '../../types.js'
import { ArkmeCloseButton } from '../ArkmeCloseButton.js'
import { ArkmeConfirmDialog } from '../ArkmeConfirmDialog.js'
import { arkmeTheme } from '../arkme-theme.js'
import { tr } from '../locale.js'
import { OfflineContextCandidates } from './OfflineContextConnected.js'

/** Candidate management is requested explicitly, never inserted into chat history. */
export function OfflineContextDirectory({ source, items, onClose, onChanged }: {
  source: ArkmeSourceItem; items: ArkmeTimelineItem[]; onClose(): void; onChanged(): void
}) {
  const titleId = useId()
  const [state, setState] = useState<'suggested' | 'dismissed'>('suggested')
  return <ArkmeConfirmDialog layout="picker" titleId={titleId} title={tr('线下交流')} busy={false} onClose={onClose}
    dialogStyle={{ width: 'min(680px, 100%)', padding: 20 }}>
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <h2 style={{ fontSize: 17, margin: 0 }}>{tr('线下交流')}</h2>
      <ArkmeCloseButton aria-label={tr('关闭线下交流')} onClick={onClose} />
    </header>
    <div role="tablist" aria-label={tr('线下交流状态')} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      {(['suggested', 'dismissed'] as const).map(value => <button key={value} type="button" role="tab"
        aria-selected={state === value} onClick={() => setState(value)} style={{ border: 0, borderRadius: 8, padding: '8px 12px',
          cursor: 'pointer', color: arkmeTheme.text, background: state === value ? arkmeTheme.layer1 : 'transparent' }}>
        {tr(value === 'suggested' ? '待确认' : '已移除')}
      </button>)}
    </div>
    <div role="tabpanel" aria-label={tr(state === 'suggested' ? '待确认' : '已移除')}>
      <OfflineContextCandidates source={source} items={items} state={state} presentation="directory" onChanged={onChanged} />
    </div>
  </ArkmeConfirmDialog>
}
