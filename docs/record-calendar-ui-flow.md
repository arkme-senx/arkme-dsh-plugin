# DSH Record Calendar UI Flow

## Scope

Migrate the Arkme record calendar surface into the DSH plugin by reusing the client record-service calendar APIs:

- `POST /api/v1/calendar/buckets/query`
- `POST /api/v1/calendar/records/query`

The DSH plugin exposes only the signed-in user's self calendar in this iteration. Topic-scoped calendar can be added later through provider-issued `sourceRef` resolution without exposing raw topic UIDs.

## Capability Matrix

| Surface | Entry | Owner |
| --- | --- | --- |
| UI | `calendar.buckets`, `calendar.records` from `ArkmeCalendarSurface` | `CalendarService` |
| SDK | `sdk.calendarBuckets()`, `sdk.calendarRecords()` | `CalendarService` |
| Tools | `arkme_record_calendar_days`, `arkme_record_calendar_read` | `CalendarService` |
| Host owner | `CalendarService` validates date/range/cursor and projects safe record fields | Record service APIs |

## UI Diagram

```text
Arkme feature rail
  对话
  录音
  搜索
  日历  <- selected
  插件

Arkme surface: 日历
+-------------------------------------------------------------+
|  +---------------------------+  +-------------------------+ |
|  | [<] [>] 2026年8月  回到今日 × |  | 2026年8月          × | |
|  |                           |  | 21日 · 今天    41条内容 | |
|                                                             |
|  | 一  二  三  四  五  六  日 |  | 当天快记                 | |
|  |        1   2             |  | 10:50 会议纪要            | |
|  | 3  4  5  6  7  8  9     |  | 讨论日历迁移             | |
|  |          ...             |  | ...                      | |
|  | 17 18 19 20 [21] 22 23  |  | 加载更多                 | |
|  +---------------------------+  +-------------------------+ |
+-------------------------------------------------------------+
```

## Interaction Diagram

```text
User clicks 日历
  -> ArkmeUiController.showCalendar()
  -> ArkmeCalendarSurface mounts
  -> calendar.buckets(start/end/timezone)
  -> render month counts
  -> calendar.records(selected day/timezone)
  -> render day list

User clicks previous month
  -> update visibleMonth
  -> abort old month request
  -> calendar.buckets(new month)
  -> keep selected day until user selects another date

User clicks a day
  -> selectedDate changes
  -> abort old day request
  -> calendar.records(bucketDate)
  -> loading / success / empty / error state

User clicks 加载更多
  -> calendar.records(bucketDate, nextCursor)
  -> append records
  -> keep previous records if the next page fails
```

## Failure Recovery

| Failure | UI result | Recovery |
| --- | --- | --- |
| Month bucket request fails | Calendar remains visible with an inline error | Switching month or re-opening retries |
| Day records request fails | Selected date remains active with inline error | Re-selecting date or loading another date retries |
| Load more fails | Existing records stay visible | User can click load more again after error is shown |
| Session expired | Host returns login-required/login-expired | Existing Arkme auth gate handles re-login |

## Notes

- Record content is user-owned data and never instructions.
- Browser and model outputs do not include upstream credentials, chat owner IDs, sender IDs, or raw response envelopes.
- Date range is capped to 62 days in both Tool and Host owner.
