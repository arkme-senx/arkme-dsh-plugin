import { describe, expect, it } from 'vitest'
import { retainPartialTimelineMedia } from '../src/client/timeline-media.js'

describe('Live preview partial reads', () => {
  it('retains same-version motion on partial reads, but never reuses it for a newer Record version', () => {
    const motion = { kind: 'video' as const, mediaRef: 'motion-ref', fileAssetUid: 'motion', fileName: 'motion.mov', mimeType: 'video/quicktime', size: 1, sortOrder: 0 }
    const cover = { ...motion, kind: 'image' as const, mediaRef: 'cover-ref', fileAssetUid: 'cover', dynamicPhoto: { logicalUid: 'live', motion } }
    const before = { itemUid: 'record', status: 1, recordVersion: 2, contentBlocks: [cover] }
    const incoming = { ...before, mediaUnavailable: true, contentBlocks: [{ ...cover, dynamicPhoto: { logicalUid: 'live', motionFileAssetUid: 'motion' } }] }
    expect(retainPartialTimelineMedia(before as never, incoming as never).contentBlocks?.[0]?.dynamicPhoto?.motion).toEqual(motion)
    const changedPair = { ...incoming, contentBlocks: [{ ...cover, dynamicPhoto: { logicalUid: 'live', motionFileAssetUid: 'another-motion' } }] }
    expect(retainPartialTimelineMedia(before as never, changedPair as never).contentBlocks?.[0]?.dynamicPhoto?.motion).toBeUndefined()
    const newer = { ...incoming, recordVersion: 3 }
    expect(retainPartialTimelineMedia(before as never, newer as never)).toBe(newer)
  })
})
