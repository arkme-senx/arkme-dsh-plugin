import { useEffect, useState, type CSSProperties } from 'react'
import type { ArkmeRecordingDay, ArkmeRecordingSpeakerMutationResult, ArkmeRecordingSpeakerOption, ArkmeRecordingWorkbenchItem } from '../../types.js'
import { callArkme } from '../api.js'
import { arkmeTheme } from '../arkme-theme.js'

const styles: Record<string, CSSProperties> = {
  popover: { marginTop: 8, padding: 12, display: 'grid', gap: 9, border: `1px solid ${arkmeTheme.border}`, borderRadius: 10, background: arkmeTheme.layer1 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  button: { border: `1px solid ${arkmeTheme.border}`, borderRadius: 7, background: arkmeTheme.base, color: arkmeTheme.text, padding: '5px 8px', cursor: 'pointer', fontSize: 11 },
  field: { minWidth: 0, height: 30, boxSizing: 'border-box', border: `1px solid ${arkmeTheme.border}`, borderRadius: 7, background: arkmeTheme.input, color: arkmeTheme.text, padding: '0 8px', font: 'inherit', fontSize: 11 },
  danger: { color: arkmeTheme.danger },
}

export function ArkmeRecordingSpeakerEditor({ item, onUpdated, onClose }: {
  item: ArkmeRecordingWorkbenchItem
  onUpdated(day: ArkmeRecordingDay): void
  onClose(): void
}) {
  const [options, setOptions] = useState<ArkmeRecordingSpeakerOption[]>([])
  const [selected, setSelected] = useState('')
  const [newName, setNewName] = useState('')
  const [batch, setBatch] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    setOptions([]); setSelected(''); setNewName(''); setBatch(false); setError('')
    setLoading(true)
    void callArkme<ArkmeRecordingSpeakerOption[]>('recordings.speaker.options', { itemRef: item.itemRef })
      .then(value => { if (!cancelled) setOptions(value) })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : '说话人候选读取失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [item.itemRef])

  const mutate = async () => {
    if (pending) return
    setPending(true); setError('')
    try {
      const result = await callArkme<ArkmeRecordingSpeakerMutationResult>('recordings.speaker.assign-item', {
        itemRef: item.itemRef,
        scope: batch ? 'speaker' : 'item',
        ...(selected === '' ? { newSpeakerName: newName.trim() } : { speakerRef: selected }),
      })
      onUpdated(result.day); onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '说话人修改失败') }
    finally { setPending(false) }
  }

  return <div style={styles.popover} role="dialog" aria-label="编辑说话人">
    <strong style={{ fontSize: 12 }}>编辑“{item.speakerLabel}”</strong>
    {loading ? <span role="status">正在读取候选…</span> : <select style={styles.field} aria-label="选择说话人" value={selected} onChange={event => { setSelected(event.target.value) }}>
      <option value="">新建说话人</option>
      {options.map(option => <option key={option.speakerRef} value={option.speakerRef}>{option.recommended ? `推荐 · ${option.label}` : option.label}</option>)}
    </select>}
    {selected === '' && <input style={styles.field} aria-label="新说话人名称" value={newName} maxLength={50} onChange={event => { setNewName(event.target.value) }} placeholder="输入说话人名称" />}
    {item.sameSpeakerItemCount > 1 && <label><input type="checkbox" checked={batch} onChange={event => { setBatch(event.target.checked) }} />批量修改当前录音 {item.sameSpeakerItemCount} 处“{item.speakerLabel}”</label>}
    {error !== '' && <div role="alert" style={styles.danger}>{error}</div>}
    <div style={styles.actions}>
      <button type="button" style={styles.button} disabled={loading || pending || (selected === '' && newName.trim() === '')} onClick={() => { void mutate() }}>{pending ? '正在保存…' : batch ? `批量保存 ${item.sameSpeakerItemCount} 处` : '保存到当前片段'}</button>
      <button type="button" style={styles.button} disabled={pending} onClick={onClose}>关闭</button>
    </div>
  </div>
}
