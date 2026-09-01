import { describe, expect, it } from 'vitest'
import {
  categorizeRecordingSpeakerOptions,
  recordingSpeakerPopoverPosition,
} from '../src/client/recordings/ArkmeRecordingSpeakerEditor.js'
import type { ArkmeRecordingSpeakerOption } from '../src/types.js'

function option(input: Partial<ArkmeRecordingSpeakerOption> & Pick<ArkmeRecordingSpeakerOption, 'speakerRef' | 'label' | 'kind'>): ArkmeRecordingSpeakerOption {
  return {
    currentAssignment: false,
    isCurrentUser: false,
    recommended: false,
    ...input,
  }
}

describe('recording speaker editor categories', () => {
  it('keeps recommendation, stored speaker, and Jotmo user concepts mutually exclusive', () => {
    const result = categorizeRecordingSpeakerOptions([
      option({ speakerRef: 'recommended-user', label: '小林', kind: 'arkme-user', recommended: true }),
      option({ speakerRef: 'stored-speaker', label: '小陈', kind: 'speaker', currentAssignment: true }),
      option({ speakerRef: 'arkme-user', label: '小王', kind: 'arkme-user', isCurrentUser: true }),
    ], '')

    expect(result.recommended.map(item => item.speakerRef)).toEqual(['recommended-user'])
    expect(result.speakers.map(item => item.speakerRef)).toEqual(['stored-speaker'])
    expect(result.users.map(item => item.speakerRef)).toEqual(['arkme-user'])
  })

  it('filters every category using the same visible label query', () => {
    const result = categorizeRecordingSpeakerOptions([
      option({ speakerRef: 'speaker-a', label: '林老师', kind: 'speaker' }),
      option({ speakerRef: 'user-b', label: '王老师', kind: 'arkme-user' }),
    ], '林')

    expect(result.speakers.map(item => item.label)).toEqual(['林老师'])
    expect(result.users).toEqual([])
  })

  it('keeps the editor visible when its transcript avatar is near a viewport edge', () => {
    expect(recordingSpeakerPopoverPosition(
      { left: 980, right: 1_012, top: 720, bottom: 752 },
      { width: 1_024, height: 768 },
    )).toEqual({ left: 738, top: 332 })

    expect(recordingSpeakerPopoverPosition(
      { left: 8, right: 40, top: 8, bottom: 40 },
      { width: 1_024, height: 768 },
    )).toEqual({ left: 8, top: 48 })
  })
})
