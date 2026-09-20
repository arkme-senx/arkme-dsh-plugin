import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
const boundary = vi.hoisted(() => ({ calls: [] as string[], finish: vi.fn(), selectAt: vi.fn(), stop: vi.fn() }))
vi.mock('../src/client/ArkmeRecordingTour.js', () => ({ useRecordingTour: () => ({ sample: false, panel: null, finish: boundary.finish }) }))
vi.mock('../src/client/recordings/useRecordingPlayback.js', () => ({ useRecordingPlayback: () => ({ selectAt: boundary.selectAt, stop: boundary.stop, isPlaying: false, isLoading: false, error: '' }) }))
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: async (operation: string, params: { dateStamp: number }) => operation === 'recordings.day' ? {
 dateStamp: params.dateStamp, totalDurationMillis: 1000,
 transcript: { state: 'ready', message: '', processingCount: 0, items: [{ itemId:'real',itemRef:'real-ref',speakerKey:'speaker',speakerLabel:'我',speakerColorIndex:0,startAtMillis:1000,endAtMillis:2000,text:'真实转写' }] },
 summary: {state:'empty',items:[],message:''},timeline:{state:'empty',items:[],message:''},
} : operation === 'recordings.calendar' ? {days:[]} : {options:[]} }))
import { ArkmeRecordingSurface } from '../src/client/ArkmeRecordingSurface.js'
it('finishes without restoring focus before a real transcript text double-click selects playback', async () => {
 boundary.finish.mockImplementation(() => { boundary.calls.push('finish') })
 boundary.selectAt.mockImplementation(() => { boundary.calls.push('select') })
 let renderer: ReturnType<typeof create>
 await act(async () => { renderer=create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0}/>) })
 try {
  await act(async () => { renderer!.root.findByType('li').props.onDoubleClick() })
  expect(boundary.calls).toEqual(['finish','select'])
  expect(boundary.finish).toHaveBeenCalledWith(false)
  expect(boundary.selectAt).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({itemRef:'real-ref'})]),1000)
 } finally { act(() => renderer!.unmount()) }
})
