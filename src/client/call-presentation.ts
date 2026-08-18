import type {
  JotmoCallDirection,
  JotmoCallListItem,
  JotmoCallMediaType,
  JotmoCallSectionState,
} from '../types.js'

const CALL_TIME_ZONE = 'Asia/Shanghai'

function dateKey(value: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CALL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function mergeCallListItems(
  current: readonly JotmoCallListItem[],
  incoming: readonly JotmoCallListItem[],
): JotmoCallListItem[] {
  const result = [...current]
  const known = new Set(current.map(item => item.callRef))
  for (const item of incoming) {
    if (known.has(item.callRef)) continue
    known.add(item.callRef)
    result.push(item)
  }
  return result
}

export function nextSelectedCallRef(
  current: string | undefined,
  items: readonly Pick<JotmoCallListItem, 'callRef'>[],
): string | undefined {
  if (current !== undefined && items.some(item => item.callRef === current)) return current
  return items[0]?.callRef
}

export function isCurrentCallRequest(requestGeneration: number, currentGeneration: number): boolean {
  return requestGeneration === currentGeneration
}

export function formatCallDuration(value: number): string {
  const totalSeconds = Math.max(0, Math.floor((Number.isFinite(value) ? value : 0) / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${String(hours)}小时${String(minutes).padStart(2, '0')}分${String(seconds).padStart(2, '0')}秒`
  }
  if (minutes > 0) return `${String(minutes)}分${String(seconds).padStart(2, '0')}秒`
  return `${String(seconds)}秒`
}

export function formatCallTime(value: number, nowMillis = Date.now()): string {
  if (!Number.isFinite(value) || value <= 0) return '--'
  const time = new Intl.DateTimeFormat('zh-CN', {
    timeZone: CALL_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
  if (dateKey(value) === dateKey(nowMillis)) return time
  if (dateKey(value) === dateKey(nowMillis - 86_400_000)) return `昨天 ${time}`
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: CALL_TIME_ZONE,
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}

export function callMediaLabel(value: JotmoCallMediaType): string {
  if (value === 'audio') return '语音'
  if (value === 'video') return '视频'
  return '通话'
}

export function callDirectionLabel(value: JotmoCallDirection): string {
  if (value === 'incoming') return '呼入'
  if (value === 'outgoing') return '呼出'
  if (value === 'group') return '群通话'
  return '通话'
}

export function sectionStatusMessage(
  kind: 'summary' | 'transcript',
  state: JotmoCallSectionState,
): string {
  if (state === 'ready') return ''
  if (kind === 'summary') {
    if (state === 'processing') return 'AI 摘要生成中'
    if (state === 'failed') return 'AI 摘要生成失败'
    return '暂无 AI 摘要'
  }
  if (state === 'processing') return '通话转录处理中'
  if (state === 'failed') return '通话转录失败'
  return '暂无转录内容'
}
