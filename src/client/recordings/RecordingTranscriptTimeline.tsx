import type { ComponentProps, RefObject } from 'react'
import { ArkmeRecordingTimeline } from './ArkmeRecordingTimeline.js'
import { useRecordingReadingPosition } from './useRecordingReadingPosition.js'

/** Keep scroll-driven updates inside the header, away from the all-day transcript list. */
export function RecordingTranscriptTimeline({ transcriptRoot, followTranscript, ...props }: ComponentProps<typeof ArkmeRecordingTimeline> & {
  transcriptRoot: RefObject<HTMLDivElement>
  followTranscript: boolean
}) {
  const readingRange = useRecordingReadingPosition(transcriptRoot, props.items, followTranscript, props.dayStartMillis ?? 0)
  return <ArkmeRecordingTimeline {...props} readingRange={readingRange} />
}
