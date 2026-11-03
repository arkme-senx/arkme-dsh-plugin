/** Export choices are local UI state until the Record owner publishes a range contract.
 * Never forward these choices to the v1 all-records endpoint or infer a checkpoint
 * from latest_at (that is ZIP generation time, not a saved backup). */
export type RecordExportRangeKind = 'all' | 'dates' | 'incremental'
export type RecordExportDatePreset = 'week' | 'month' | 'last-month'
export interface RecordExportDates { start: string; end: string }

function dateInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function recordExportDatePreset(preset: RecordExportDatePreset, now = new Date()): RecordExportDates {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(end)
  if (preset === 'week') start.setDate(start.getDate() - 6)
  else if (preset === 'month') start.setDate(1)
  else {
    start.setDate(1); start.setMonth(start.getMonth() - 1)
    end.setDate(0)
  }
  return { start: dateInputValue(start), end: dateInputValue(end) }
}

function calendarDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  if (year < 1000 || year > 9999) return undefined
  const date = new Date(year, month - 1, day)
  return dateInputValue(date) === value ? date : undefined
}

export function recordExportDateError(dates: RecordExportDates): string {
  if (!dates.start || !dates.end) return '请选择开始日期和结束日期。'
  const start = calendarDate(dates.start), end = calendarDate(dates.end)
  if (!start || !end) return '日期无效，请重新选择。'
  return start > end ? '结束日期不能早于开始日期。' : ''
}

/** The legacy export can execute only this exact selection. This guard must also
 * run immediately before confirmation/execution, independently of button state. */
export function legacyRecordExportAvailable(kind: RecordExportRangeKind, includeAttachments: boolean): boolean {
  return kind === 'all' && includeAttachments
}
