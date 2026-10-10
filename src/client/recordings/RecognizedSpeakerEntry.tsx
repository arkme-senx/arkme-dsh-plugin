import { useEffect, useSyncExternalStore, type CSSProperties } from 'react'
import { UsersThree } from '@phosphor-icons/react/dist/icons/UsersThree'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { tr, useArkmeLocale } from '../locale.js'
import { RecognizedSpeakerDirectory, recognizedSpeakerDirectory } from '../recognized-speaker-directory.js'

export function RecognizedSpeakerEntry({ accountKey, active, onOpen, style, directory = recognizedSpeakerDirectory }: {
  accountKey?: string | undefined; active: boolean; onOpen(): void; style: CSSProperties | undefined; directory?: RecognizedSpeakerDirectory
}) {
  useArkmeLocale()
  const snapshot = useSyncExternalStore(directory.subscribe, () => directory.get(accountKey), () => directory.get(accountKey))
  useEffect(() => { if (active && accountKey !== undefined) return directory.watch(accountKey) }, [accountKey, active, directory])
  const summary = snapshot.summary
  const count = summary?.state === 'disabled' ? null : summary?.totalCount
  const hint = summary?.state === 'disabled' ? '目录暂不可用'
    : count == null ? summary?.state === 'building' ? '整理中…' : snapshot.error || summary?.state === 'failed' ? '暂时无法更新' : ''
      : (summary?.unseenCount ?? 0) > 0 ? tr('新识别 {v0} 个', { v0: summary!.unseenCount! }) : ''
  return <button data-arkme-feedback="recording-action" type="button" style={{ ...style, flexDirection: 'column', minWidth: 0, fontSize: 13 }} onClick={onOpen}>
    <span style={{ display: 'flex', maxWidth: '100%', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
      <UsersThree size={16} style={{ flexShrink: 0 }} aria-hidden /><span title={tr('已识别说话人')} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{tr('已识别说话人')}</span>
      {count != null && <span style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{count}</span>}<CaretRight size={12} style={{ flexShrink: 0 }} aria-hidden />
    </span>
    {hint && <span style={{ fontSize: 11, lineHeight: '15px', fontWeight: 400 }} aria-live="polite">{tr(hint)}</span>}
  </button>
}
