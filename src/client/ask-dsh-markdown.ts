import type { ArkmeContentBlock, ArkmeMessageSnapshotDetail, ArkmeTimelineItem } from '../types.js'

export type AskDshNote = ArkmeTimelineItem & { exportSourceName?: string }
type Attachments = (blocks: readonly ArkmeContentBlock[], heading: string) => string
const line = (value: string) => value.replace(/[\r\n]+/g, ' ').trim()
const field = (label: string, value: string | undefined) => value?.trim() ? `${label}：${line(value)}` : ''
const join = (parts: (string | undefined)[]) => parts.filter(part => part?.trim()).join('\n\n')
export function noteTime(value: number | undefined): string {
  if (!value || !Number.isFinite(value)) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const offset = -date.getTimezoneOffset(), pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
}
export function noteDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return ''
  const total = Math.floor(seconds), pad = (n: number) => String(n).padStart(2, '0')
  return total >= 3600 ? `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}` : `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}
export function attachmentDescription(block: ArkmeContentBlock): string {
  const kind = block.dynamicPhoto ? '动态照片的静态画面' : block.renderRole === 3 ? '表情贴纸'
    : ({ image: '图片', video: '视频', audio: '音频', file: '文件' })[block.kind]
  const size = block.size > 0 ? block.size >= 1048576 ? `${+(block.size / 1048576).toFixed(2)} MB`
    : block.size >= 1024 ? `${+(block.size / 1024).toFixed(1)} KB` : `${block.size} B` : ''
  return [kind, noteDuration(block.durationSec), size].filter(Boolean).join('｜')
}
function noteKind(item: ArkmeTimelineItem, blocks: readonly ArkmeContentBlock[]): string {
  if (item.forwardRecords) return item.forwardRecords.items.some(row => row.sourceType === 'long_recording_segments') ? '录音片段转发' : '合并转发'
  if (item.sharedRecording) return '共享录音'
  if (item.callRecord) return '通话记录'
  if (item.extensionParent || item.extensionParentRecordUid) return '延展快记'
  if (item.displayKind === 1 || item.templateKind === 8) return '长文'
  if (item.templateKind === 4) return '语音混合媒体快记'
  if (item.templateKind === 3) return '语音快记'
  if (blocks.some(block => block.dynamicPhoto)) return '动态照片快记'
  if (blocks.length && blocks.every(block => block.renderRole === 3)) return '表情贴纸快记'
  if (blocks.length || item.templateKind === 2) return '媒体快记'
  return item.templateKind === 5 ? '结构化快记' : '文字快记'
}

/** Serialize only loaded, user-visible fields. No recursive reads or opaque references. */
export function formatAskDshNote(item: AskDshNote, detail: ArkmeMessageSnapshotDetail, index: number, attachments: Attachments): string {
  const blocks = detail.contentBlocks ?? []
  const voice = item.templateKind === 3 || item.templateKind === 4
  const audio = blocks.filter(block => block.kind === 'audio')
  const call = item.callRecord, shared = item.sharedRecording, forward = item.forwardRecords
  const title = item.title.trim() || shared?.title.trim() || forward?.title.trim() || '快记'
  const parts = [
    `## ${index + 1}. ${line(title)}`,
    field('用户', item.senderName || (item.isMe ? '我' : 'Arkme用户')),
    field('类型', noteKind(item, blocks)), field('时间', noteTime(item.sendAtMillis)),
    field('来源', item.exportSourceName), field('来源链接', detail.sourceUrl), field('主题', item.selfTopic?.title),
    field('记录', item.itemUid), field('更新时间', item.updateAtMillis && item.updateAtMillis !== item.sendAtMillis ? noteTime(item.updateAtMillis) : ''),
    field('来源 Agent', item.agentSource ? [item.agentSource.displayName, item.agentSource.label].filter(Boolean).join(' · ') : ''),
    field('音频时长', voice && audio.length === 1 ? noteDuration(audio[0]!.durationSec ?? (item.recordDurationMillis ? item.recordDurationMillis / 1000 : undefined)) : ''),
    field('记录耗时', !voice && item.recordDurationMillis ? noteDuration(item.recordDurationMillis / 1000) : ''),
    field('编辑耗时', item.editDurationMillis ? noteDuration(item.editDurationMillis / 1000) : ''),
    field('提及', item.mentions?.map(mention => mention.displayName).filter(Boolean).join('、')),
    field('AI 润色状态', item.aiPolish && item.aiPolish.state !== 'none' ? ({ polishing: '润色中', polished: '已润色', kept_original: '保留原文', failed: '润色失败' })[item.aiPolish.state] : ''),
    item.textContent,
  ]
  if (call) parts.push(
    field('通话方式', call.mediaType === 'video' ? '视频' : '语音'),
    field('通话方向', call.direction === 'incoming' ? '呼入' : call.direction === 'outgoing' ? '呼出' : ''),
    field('通话状态', call.text), field('开始时间', noteTime(call.startedAtMillis)), field('通话时长', noteDuration(call.durationSeconds)),
    call.summaryText && call.summaryText !== item.textContent ? `### 通话摘要\n\n${call.summaryText}` : '',
    !call.summaryText ? field('通话摘要状态', call.summaryStatus) : '',
  )
  if (shared) parts.push(
    field('录音标题', shared.title), field('分享时间', noteTime(shared.sharedAtMillis)),
    field('录音开始时间', noteTime(shared.displayAtMillis)), field('录音结束时间', noteTime(shared.endAtMillis)),
    field('录音时间范围', shared.timeRangeText), field('参与人', shared.participants.map(person => person.displayName).join('、')),
    shared.summary && shared.summary !== item.textContent ? `### 摘要\n\n${shared.summary}` : '',
    shared.transcript ? `### 已加载的转写内容\n\n${shared.transcript}` : '转写未加载。',
  )
  if (forward) {
    parts.push(field('转发标题', forward.title), field('转发时间', noteTime(forward.createdAtMillis)))
    if (forward.summaryLines.length) parts.push(`### 转发摘要\n\n${forward.summaryLines.join('\n')}`)
    if (forward.truncated) parts.push('注意：当前转发快照已截断，仅包含已加载内容。')
    forward.items.forEach((row, rowIndex) => {
      if (row.mediaUnavailable) throw new Error(`原消息 ${rowIndex + 1}：附件清单暂不可用，请刷新后重试`)
      parts.push(`### 原消息 ${rowIndex + 1}${row.title.trim() ? `：${line(row.title)}` : ''}`,
        field('原发送者', row.senderName), field('原消息时间', noteTime(row.sendAtMillis)), row.textContent,
        row.truncated ? '注意：此条原消息快照已截断。' : '')
      row.segments?.forEach((segment, segmentIndex) => {
        if (segment.mediaUnavailable) throw new Error(`录音片段 ${segmentIndex + 1}：附件清单暂不可用，请刷新后重试`)
        parts.push(`#### 片段 ${segmentIndex + 1}｜${noteDuration(segment.startMillis / 1000)}–${noteDuration(segment.endMillis / 1000)}｜说话人：${line(segment.speakerName)}`,
          segment.textContent, attachments(segment.contentBlocks ?? [], '片段附件'))
      })
      parts.push(attachments(row.contentBlocks ?? [], '原消息附件'))
    })
  }
  if (item.extensionParent) {
    const parent = item.extensionParent
    parts.push('### 延展来源（已加载快照）', field('原快记标题', parent.title), field('原快记用户', parent.senderName),
      field('原快记时间', noteTime(parent.sendAtMillis)), field('原快记记录', parent.itemUid),
      parent.textContent ? parent.textContent.split('\n').map(text => `> ${text}`).join('\n') : '',
      parent.contentBlocks?.length ? `引用快记附件（仅列名称，未附原件）：${parent.contentBlocks.map(block => line(block.fileName)).join('、')}` : '')
  } else if (item.extensionParentRecordUid) parts.push(field('延展来源记录', item.extensionParentRecordUid), '延展来源快照未加载。')
  if (item.aiPolish?.originalText && item.aiPolish.originalText !== item.textContent) parts.push(`### 润色前原文\n\n${item.aiPolish.originalText}`)
  if (item.aiPolish?.polishedText && item.aiPolish.polishedText !== item.textContent && item.aiPolish.polishedText !== item.aiPolish.originalText) parts.push(`### 已加载的润色结果\n\n${item.aiPolish.polishedText}`)
  if (item.captureContext) {
    const context = item.captureContext
    const fields = [field('设备', context.clientName), field('网络', context.networkName), field('电量', context.electric === undefined ? '' : String(context.electric))].filter(Boolean)
    if (fields.length) parts.push(`### 已有环境信息\n\n${fields.join('\n\n')}`)
  }
  if (item.locationCapture) {
    const location = item.locationCapture
    parts.push(`### 已有位置信息\n\n经纬度：${location.latitude}, ${location.longitude}`,
      field('采集时间', noteTime(location.capturedAtMillis)), field('精度', location.accuracyMeters === undefined ? '' : `${location.accuracyMeters} 米`),
      field('海拔', location.altitudeMeters === undefined ? '' : `${location.altitudeMeters} 米`))
  }
  parts.push(attachments(blocks, '附件'))
  return join(parts)
}
