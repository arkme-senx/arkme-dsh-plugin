import { arkmeIntlLocale, tr } from './locale.js'

export function validArrangementReminderTime(value: number | undefined): value is number {
  return value !== undefined && value > 0 && Number.isFinite(new Date(value).getTime())
}

export function ArkmeArrangementReminder({ atMillis, now }: { atMillis: number | undefined; now: number }) {
  if (!validArrangementReminderTime(atMillis)) return null
  const date = new Date(atMillis)
  return <div className="arkme-arrangement-reminder" data-upcoming={atMillis > now}>
    {/* Same paths as Flutter assets/icons/notification-linear.svg, with inherited status color. */}
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">
      <path d="M12.0201 2.91003C8.71009 2.91003 6.02009 5.60003 6.02009 8.91003V11.8C6.02009 12.41 5.76009 13.34 5.45009 13.86L4.30009 15.77C3.59009 16.95 4.08009 18.26 5.38009 18.7C9.69009 20.14 14.3401 20.14 18.6501 18.7C19.8601 18.3 20.3901 16.87 19.7301 15.77L18.5801 13.86C18.2801 13.34 18.0201 12.41 18.0201 11.8V8.91003C18.0201 5.61003 15.3201 2.91003 12.0201 2.91003Z" strokeWidth="1.5" strokeMiterlimit="10" strokeLinecap="round" />
      <path d="M13.8699 3.19994C13.5599 3.10994 13.2399 3.03994 12.9099 2.99994C11.9499 2.87994 11.0299 2.94994 10.1699 3.19994C10.4599 2.45994 11.1799 1.93994 12.0199 1.93994C12.8599 1.93994 13.5799 2.45994 13.8699 3.19994Z" strokeWidth="1.5" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.02 19.0601C15.02 20.7101 13.67 22.0601 12.02 22.0601C11.2 22.0601 10.44 21.7201 9.90002 21.1801C9.36002 20.6401 9.02002 19.8801 9.02002 19.0601" strokeWidth="1.5" strokeMiterlimit="10" />
    </svg>
    <time dateTime={date.toISOString()} aria-label={tr('通知时间')}>
      {new Intl.DateTimeFormat(arkmeIntlLocale(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)}
    </time>
  </div>
}
