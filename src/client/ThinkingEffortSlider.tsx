import { useId, useRef } from 'react'
import type { ModelChoice } from '../model-directory.js'
import { tr } from './locale.js'

const adjustmentKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])

/** Preview locally; commit once on release, including keyboard and assistive input. */
export function ThinkingEffortSlider({ reasoning, value, disabled, onPreview, onCommit }: {
  reasoning: NonNullable<ModelChoice['reasoning']>; value: string; disabled: boolean
  onPreview(value: string): void; onCommit(value: string): void
}) {
  const labelId = useId(), input = useRef<HTMLInputElement>(null)
  const latest = useRef(value), start = useRef(value), dragging = useRef(false), keyboard = useRef(false)
  latest.current = value
  const options = reasoning.efforts
  if (!options.length) return null
  const selectedIndex = options.findIndex(option => option.id === (value || reasoning.defaultEffort))
  const index = Math.max(0, selectedIndex), unresolved = selectedIndex < 0
  const label = value ? options.find(option => option.id === value)?.name ?? tr('待确认') : tr('默认')
  const percent = (index: number) => options.length > 1 ? index / (options.length - 1) * 100 : 0
  const preview = (next: string) => { latest.current = next; onPreview(next) }
  const commit = () => { onCommit(latest.current) }
  const cancelDrag = () => {
    if (!dragging.current) return
    dragging.current = false; preview(start.current)
  }
  return <div className="arkme-unified-model-effort">
    <div className="arkme-unified-model-effort-heading">
      <span><span id={labelId}>{tr('思考强度')}</span> <span className="arkme-unified-model-effort-value">· {tr(label)}</span></span>
      <button type="button" aria-label={tr('恢复默认思考强度')} aria-pressed={value === ''} disabled={disabled}
        onClick={() => { preview(''); commit() }}>{tr('默认')}</button>
    </div>
    <div className={'arkme-unified-model-effort-track' + (unresolved ? ' is-unresolved' : '')}>
      <div className="arkme-unified-model-effort-rail" aria-hidden="true">
        <span className="arkme-unified-model-effort-fill" style={{ width: `${unresolved ? 0 : percent(index)}%` }}/>
        {options.map((option, tick) => <span key={option.id} className="arkme-unified-model-effort-tick" data-active={!unresolved && tick <= index} style={{ left: `${percent(tick)}%` }}/>) }
      </div>
      <input ref={input} type="range" min={0} max={Math.max(0, options.length - 1)} step={1} value={index}
        aria-labelledby={labelId} aria-valuetext={tr(label)} disabled={disabled || options.length < 2}
        onPointerDown={event => {
          dragging.current = true; start.current = latest.current
          event.currentTarget.setPointerCapture?.(event.pointerId)
        }}
        onChange={event => {
          const option = options[Number(event.currentTarget.value)]
          if (!option) return
          preview(option.id)
          if (!dragging.current && !keyboard.current) commit()
        }}
        onPointerUp={() => { if (dragging.current) { dragging.current = false; commit() } }}
        onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}
        onKeyDown={event => { if (adjustmentKeys.has(event.key)) keyboard.current = true }}
        onKeyUp={event => { if (adjustmentKeys.has(event.key) && keyboard.current) { keyboard.current = false; commit() } }}
        onBlur={() => { if (keyboard.current) { keyboard.current = false; commit() } }}/>
    </div>
    <div className="arkme-unified-model-effort-labels">
      {options.map((option, tick) => <button key={option.id} type="button" aria-pressed={value === option.id} title={option.description}
        disabled={disabled} style={{ left: `${percent(tick)}%` }}
        onClick={() => { preview(option.id); commit(); input.current?.focus({ preventScroll: true }) }}>{tr(option.name)}</button>)}
    </div>
  </div>
}
