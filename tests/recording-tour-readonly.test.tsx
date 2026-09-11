import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { ArkmeRecordingTranscriptRow } from '../src/client/ArkmeRecordingSurface.js'
it('renders a read-only speaker and transcript without playback or editing affordances', () => {
 const edit = vi.fn(), play = vi.fn()
 let renderer: ReturnType<typeof create>
 act(() => { renderer = create(<ArkmeRecordingTranscriptRow readOnly item={{ itemId:'sample', itemRef:'sample', speakerLabel:'小林', speakerNumber:1, speakerColorIndex:0, text:'周六九点出发', startAtMillis:0,endAtMillis:30000 } as any} selected={false} onEditSpeaker={edit} onSelect={play} />) })
 expect(renderer!.root.findAllByType('button')).toHaveLength(0)
 expect(renderer!.root.findByType('li').props.onDoubleClick).toBeUndefined()
 act(() => renderer!.unmount())
})
