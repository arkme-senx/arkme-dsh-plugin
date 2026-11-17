import type { CSSProperties } from 'react'
import { tr } from './locale.js'

export const arkmeClockPattern = '(?:[01][0-9]|2[0-3]):[0-5][0-9]'
const secondPattern = `${arkmeClockPattern}(?::[0-5][0-9])?`
const millisecondPattern = `${arkmeClockPattern}(?::[0-5][0-9](?:[.][0-9]{1,3})?)?`
const localDateTimePattern = new RegExp(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T${millisecondPattern}$`)

export function parseArkmeLocalDateTime(value: string): number {
  return localDateTimePattern.test(value) ? new Date(value).getTime() : NaN
}

interface ArkmeLocalDateTimeInputProps {
  label: string
  value: string
  disabled?: boolean
  milliseconds?: boolean
  style?: CSSProperties | undefined
  onValueChange(value: string): void
  onCommit?(value: string): void
}

export function ArkmeLocalDateTimeInput({
  label, value, disabled, milliseconds, style, onValueChange, onCommit,
}: ArkmeLocalDateTimeInputProps) {
  const [date = '', time = ''] = value.split('T')
  const placeholder = milliseconds ? 'HH:mm:ss.SSS' : 'HH:mm:ss'
  const pattern = milliseconds ? millisecondPattern : secondPattern
  const fieldStyle: CSSProperties = { ...style, minWidth: 0, boxSizing: 'border-box', fontVariantNumeric: 'tabular-nums' }

  return <span role="group" aria-label={label}
    style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, minWidth: 0 }}
    onBlur={onCommit && (event => {
      if (!event.currentTarget.contains(event.relatedTarget)) onCommit(value)
    })}>
    <input type="date" aria-label={`${label} · ${tr('日期')}`} value={date} disabled={disabled}
      style={{ ...fieldStyle, width: 104 }}
      onChange={event => onValueChange(`${event.target.value}T${time}`)} />
    <input type="text" aria-label={`${label} · ${tr('时间')}`} value={time} disabled={disabled}
      placeholder={placeholder} pattern={pattern} maxLength={placeholder.length}
      spellCheck={false} autoComplete="off"
      style={{ ...fieldStyle, width: milliseconds ? 106 : 70 }}
      onChange={event => onValueChange(`${date}T${event.target.value}`)} />
  </span>
}
