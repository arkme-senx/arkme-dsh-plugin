/** Convert an explicit wall time in the calendar timezone; reject invalid dates and DST gaps. */
export function arrangementDateTimeMillis(date: string, time: string, timezone: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error('Invalid arrangement date')
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const [hour, minute] = time.split(':').map(Number) as [number, number]
  if (year < 1970 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) throw new Error('Invalid arrangement date')
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  const format = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const partsAt = (stamp: number) => Object.fromEntries(format.formatToParts(stamp).map(part => [part.type, part.value]))
  let stamp = wall
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = partsAt(stamp)
    const delta = wall - Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute))
    if (delta === 0) break
    stamp += delta
  }
  const parts = partsAt(stamp)
  if (`${parts.year}-${parts.month}-${parts.day}` !== date || `${parts.hour}:${parts.minute}` !== time) throw new Error('Invalid arrangement date')
  return stamp
}

export function arrangementDayBounds(date: string, timezone: string): [number, number] {
  const start = arrangementDateTimeMillis(date, '00:00', timezone)
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const next = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
  return [start, arrangementDateTimeMillis(next, '00:00', timezone)]
}
