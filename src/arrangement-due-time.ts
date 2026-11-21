/**
 * Resolves a model-supplied reminder time into one UTC instant for an Arkme 安排.
 *
 * The selectors mirror DSH's own `schedule_create` (`after_seconds` or `at`) so the
 * model uses one time convention for both. The clock and default zone are the host's,
 * which is why relative requests such as "in 2 minutes" are resolved here instead of
 * trusting the model's idea of the current minute.
 */

export interface ArrangementLocalAt {
  date: string
  time: string
  time_zone?: string
}

export interface ArrangementDueTimeInput {
  afterSeconds?: number
  at?: string | ArrangementLocalAt
}

export interface ResolvedArrangementDueTime {
  dueAtMillis: number
  timeZone: string
}

/** The owner scans due reminders about every 30 s; nearer targets could already be past on arrival. */
export const MIN_ARRANGEMENT_LEAD_SECONDS = 10
const MAX_ARRANGEMENT_LEAD_SECONDS = 5 * 366 * 86_400
const MAX_TIMESTAMP_MILLIS = 253_402_300_799_999

export class ArrangementDueTimeError extends Error {
  constructor(readonly code: 'invalid_due_time' | 'invalid_time_zone' | 'due_time_past' | 'due_time_too_far', message: string) {
    super(message)
    this.name = 'ArrangementDueTimeError'
  }
}

export function hostTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function canonicalTimeZone(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 100) throw new ArrangementDueTimeError('invalid_time_zone', 'time_zone 必须是 IANA 时区，例如 Asia/Shanghai')
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).resolvedOptions().timeZone
  } catch {
    throw new ArrangementDueTimeError('invalid_time_zone', 'time_zone 必须是 IANA 时区，例如 Asia/Shanghai')
  }
}

interface WallClock { year: number; month: number; day: number; hour: number; minute: number; second: number }

function wallClockAt(instant: number, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant))
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value)
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute'), second: read('second') }
}

function wallClockAsUtc(clock: WallClock): number {
  return Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second)
}

/** Converts a zone-local wall time to its instant; DST gaps are rejected and repeated hours take the earlier instant. */
function zonedWallTimeToInstant(clock: WallClock, timeZone: string): number {
  const target = wallClockAsUtc(clock)
  const candidates = new Set<number>()
  for (const probe of [target - 86_400_000, target, target + 86_400_000]) {
    candidates.add(target - (wallClockAsUtc(wallClockAt(probe, timeZone)) - probe))
  }
  const matches = [...candidates].filter(instant => wallClockAsUtc(wallClockAt(instant, timeZone)) === target).sort((a, b) => a - b)
  if (matches.length === 0) throw new ArrangementDueTimeError('invalid_due_time', '该本地时间在所选时区不存在（夏令时跳过），请换一个时间')
  return matches[0]!
}

function parseLocalAt(at: ArrangementLocalAt, defaultTimeZone: string): ResolvedArrangementDueTime {
  if (typeof at.date !== 'string' || typeof at.time !== 'string' || (at.time_zone !== undefined && typeof at.time_zone !== 'string')) {
    throw new ArrangementDueTimeError('invalid_due_time', 'at 本地时间必须包含字符串 date、time，可选 time_zone')
  }
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(at.date.trim())
  const time = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(at.time.trim())
  if (!date || !time) throw new ArrangementDueTimeError('invalid_due_time', 'at.date 必须是 YYYY-MM-DD，at.time 必须是 24 小时制 HH:mm 或 HH:mm:ss')
  const clock: WallClock = {
    year: Number(date[1]), month: Number(date[2]), day: Number(date[3]),
    hour: Number(time[1]), minute: Number(time[2]), second: Number(time[3] ?? 0),
  }
  const calendar = new Date(Date.UTC(clock.year, clock.month - 1, clock.day))
  if (calendar.getUTCFullYear() !== clock.year || calendar.getUTCMonth() !== clock.month - 1 || calendar.getUTCDate() !== clock.day
    || clock.hour > 23 || clock.minute > 59 || clock.second > 59) {
    throw new ArrangementDueTimeError('invalid_due_time', 'at 不是真实存在的日期或时间')
  }
  const timeZone = at.time_zone?.trim() ? canonicalTimeZone(at.time_zone) : defaultTimeZone
  return { dueAtMillis: zonedWallTimeToInstant(clock, timeZone), timeZone }
}

/** Strict RFC 3339 with an explicit offset; a bare local string is ambiguous and rejected. */
function parseOffsetInstant(value: string, timeZone: string): ResolvedArrangementDueTime {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i.exec(value.trim())
  if (!match) throw new ArrangementDueTimeError('invalid_due_time', 'at 字符串必须是带时区偏移的 RFC 3339，例如 2026-11-20T15:30:00+08:00；或改用 {date,time,time_zone}')
  const instant = Date.parse(value.trim())
  const local = parseLocalAt({ date: `${match[1]}-${match[2]}-${match[3]}`, time: `${match[4]}:${match[5]}:${match[6] ?? '00'}`, time_zone: 'UTC' }, 'UTC')
  if (!Number.isFinite(instant) || Math.abs(instant - local.dueAtMillis) > 14 * 3_600_000) {
    throw new ArrangementDueTimeError('invalid_due_time', 'at 不是真实存在的时间')
  }
  return { dueAtMillis: instant, timeZone }
}

/** Returns undefined when no time was requested: the 安排 is then created without a due time and without a push. */
export function resolveArrangementDueTime(input: ArrangementDueTimeInput, nowMillis: number, defaultTimeZone = hostTimeZone()): ResolvedArrangementDueTime | undefined {
  if (input.afterSeconds !== undefined && input.at !== undefined) {
    throw new ArrangementDueTimeError('invalid_due_time', 'after_seconds 与 at 只能二选一')
  }
  const timeZone = canonicalTimeZone(defaultTimeZone)
  let resolved: ResolvedArrangementDueTime | undefined
  if (input.afterSeconds !== undefined) {
    if (!Number.isSafeInteger(input.afterSeconds) || input.afterSeconds <= 0) {
      throw new ArrangementDueTimeError('invalid_due_time', 'after_seconds 必须是正整数秒')
    }
    resolved = { dueAtMillis: nowMillis + input.afterSeconds * 1000, timeZone }
  } else if (typeof input.at === 'string') {
    resolved = parseOffsetInstant(input.at, timeZone)
  } else if (input.at !== undefined) {
    if (!input.at || typeof input.at !== 'object' || Array.isArray(input.at)) {
      throw new ArrangementDueTimeError('invalid_due_time', 'at 必须是 RFC 3339 字符串或 {date,time,time_zone} 对象')
    }
    resolved = parseLocalAt(input.at, timeZone)
  }
  if (resolved === undefined) return undefined
  if (resolved.dueAtMillis < nowMillis + MIN_ARRANGEMENT_LEAD_SECONDS * 1000) {
    throw new ArrangementDueTimeError('due_time_past', `提醒时间 ${formatArrangementLocalTime(resolved.dueAtMillis, resolved.timeZone)}（${resolved.timeZone}）已过去或距现在不足 ${String(MIN_ARRANGEMENT_LEAD_SECONDS)} 秒；当前时间是 ${formatArrangementLocalTime(nowMillis, resolved.timeZone)}`)
  }
  if (resolved.dueAtMillis > nowMillis + MAX_ARRANGEMENT_LEAD_SECONDS * 1000 || resolved.dueAtMillis > MAX_TIMESTAMP_MILLIS) {
    throw new ArrangementDueTimeError('due_time_too_far', '提醒时间不能超过五年之后')
  }
  return resolved
}

/** `YYYY-MM-DD HH:mm` in the given zone, the same shape camellia returns to Arko. */
export function formatArrangementLocalTime(instant: number, timeZone: string): string {
  const clock = wallClockAt(instant, timeZone)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${String(clock.year)}-${pad(clock.month)}-${pad(clock.day)} ${pad(clock.hour)}:${pad(clock.minute)}`
}
