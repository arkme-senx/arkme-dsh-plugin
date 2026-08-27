import { useEffect, useState } from 'react'
import type { ArkmeUnmarkedSpeakerOptions } from '../../../types.js'
import { UnmarkedSpeakerLinearIcon } from './UnmarkedSpeakerVisuals.js'

export type SpeakerMarkTarget =
  | { mode: 'existing'; speakerRef: string }
  | { mode: 'new'; newSpeakerName: string }

export interface SpeakerChoicePanelProps {
  identityKey: string
  options: ArkmeUnmarkedSpeakerOptions | undefined
  loading: boolean
  busy: boolean
  recovering: boolean
  error?: string
  onBack(): void
  onReload(): void
  onSubmit(target: SpeakerMarkTarget): void
}

type ChoiceMode = 'none' | 'existing' | 'new'

export function SpeakerChoicePanel({
  identityKey,
  options,
  loading,
  busy,
  recovering,
  error,
  onBack,
  onReload,
  onSubmit,
}: SpeakerChoicePanelProps) {
  const [mode, setMode] = useState<ChoiceMode>('none')
  const [speakerRef, setSpeakerRef] = useState('')
  const [newName, setNewName] = useState('')
  const [selectionVersion, setSelectionVersion] = useState('')

  useEffect(() => {
    setMode('none')
    setSpeakerRef('')
    setNewName('')
    setSelectionVersion('')
  }, [identityKey])

  useEffect(() => {
    if (mode === 'none') return
    if (options === undefined || selectionVersion !== options.candidateVersion
      || (mode === 'existing' && !options.speakerChoices.some(choice => choice.speakerRef === speakerRef))) {
      setMode('none')
      setSpeakerRef('')
      setNewName('')
      setSelectionVersion('')
    }
  }, [mode, options, selectionVersion, speakerRef])

  const normalizedName = newName.trim()
  const selectionIsCurrent = options !== undefined && selectionVersion === options.candidateVersion
  const valid = selectionIsCurrent && (mode === 'existing'
    ? speakerRef !== ''
    : mode === 'new' && normalizedName !== '' && normalizedName.length <= 100)
  const controlsDisabled = busy || recovering
  return <section className="arkme-unmarked-speaker-choice" aria-label="标记为说话人">
    <header className="arkme-unmarked-speaker-subview-header">
      <button type="button" onClick={onBack}>返回候选摘要</button>
      <span className="arkme-unmarked-speaker-action-icon"><UnmarkedSpeakerLinearIcon kind="profile" /></span>
      <div className="arkme-unmarked-speaker-subview-heading">
        <h2>标记为说话人</h2>
        <p>选择已有说话人，或创建一个新身份</p>
      </div>
    </header>
    {options !== undefined && <p className="arkme-unmarked-speaker-choice-meta">出现 {options.appearanceDays} 天 · 相关片段 {options.segmentCount} 个</p>}
    {loading && options === undefined && <div role="status">正在加载说话人选项…</div>}
    <fieldset className="arkme-unmarked-speaker-choice-options" disabled={controlsDisabled}>
      <legend>选择说话人</legend>
      {options?.speakerChoices.map(choice => <label className="arkme-unmarked-speaker-choice-option" key={choice.speakerRef}>
        <input
          type="radio"
          name="speaker-choice"
          value={choice.speakerRef}
          checked={mode === 'existing' && speakerRef === choice.speakerRef && selectionIsCurrent}
          onChange={() => {
            setMode('existing')
            setSpeakerRef(choice.speakerRef)
            setNewName('')
            setSelectionVersion(options.candidateVersion)
          }}
        />
        <span>{choice.displayName}</span>{choice.source === 'recommended' && <span className="arkme-unmarked-speaker-recommended">推荐</span>}
      </label>)}
      <label className="arkme-unmarked-speaker-choice-option">
        <input
          type="radio"
          name="speaker-choice"
          value="__new__"
          checked={mode === 'new' && selectionIsCurrent}
          disabled={options === undefined}
          onChange={() => {
            setMode('new')
            setSpeakerRef('')
            setSelectionVersion(options?.candidateVersion ?? '')
          }}
        />
        <span>新建说话人</span>
      </label>
    </fieldset>
    {mode === 'new' && <input
      type="text"
      className="arkme-unmarked-speaker-choice-new-name"
      aria-label="新说话人名称"
      placeholder="请输入说话人名称"
      value={newName}
      maxLength={100}
      disabled={controlsDisabled}
      onChange={event => { setNewName(event.currentTarget.value.slice(0, 100)) }}
    />}
    {error !== undefined && <div role="alert">{error}</div>}
    {options === undefined && !loading && !recovering && <button type="button" onClick={onReload}>重新加载选项</button>}
    <button
      type="button"
      className="arkme-unmarked-speaker-confirm"
      disabled={!valid || controlsDisabled || options === undefined}
      onClick={() => {
        if (!valid || controlsDisabled || options === undefined) return
        if (mode === 'existing') onSubmit({ mode, speakerRef })
        else if (mode === 'new') onSubmit({ mode, newSpeakerName: normalizedName })
      }}
    >{recovering ? '正在刷新选项…' : busy ? '正在标记…' : '确认标记全部片段'}</button>
  </section>
}
