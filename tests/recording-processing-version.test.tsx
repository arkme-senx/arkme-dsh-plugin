import { act, create } from 'react-test-renderer'
import { expect, it } from 'vitest'
import { RecordingProcessingVersion } from '../src/client/recordings/RecordingProcessingVersion.js'
it('identifies the current recipe and explains the historical scope without a setting', () => {
  let view: ReturnType<typeof create>
  act(() => { view = create(<RecordingProcessingVersion />) })
  expect(view!.root.findByProps({ 'aria-label': '录音处理版本：v2026-10' }).children).toEqual(['v2026-10'])
  expect(view!.root.findByType('span').props.title).toContain('历史录音保留原处理版本')
  expect(view!.root.findAllByType('select')).toHaveLength(0)
  act(() => view!.unmount())
})
