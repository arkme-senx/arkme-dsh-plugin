import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { create, act } from 'react-test-renderer'
import { projectRecordingCoverage, recordingCoverageContains, recordingBelongsToViewer } from '../src/recording-coverage.js'
import { localRecordingCoverage } from '../src/client/recordings/recording-coverage.js'
import { ArkmeRecordingTimeline } from '../src/client/recordings/ArkmeRecordingTimeline.js'
import { ArkmeRecordingEmptyState, ArkmeRecordingSurface } from '../src/client/ArkmeRecordingSurface.js'
import type { DirectRecordingSnapshot } from '../src/client/recordings/direct-recording-store.js'
import type { ArkmeRecordingWorkbenchItem } from '../src/types.js'

const day = new Date(2026, 8, 18).getTime(), hour = 3_600_000
const session = { id: 'secret-session', belong_usr: 7, start_at: day + 8 * hour, end_at: day + 20 * hour, orig_name: '白天录音.wav' }
const child = { session_id: session.id, start_at: session.start_at, duration: 12 * hour, has_asr: true, asr: [] }
const project = (children = [child], sessions = [session]) => projectRecordingCoverage({ session_ls: sessions, child_ls: children }, day, day + 24 * hour, 7)

describe('recording coverage independent of speech', () => {
  it('confirms adjacent or overlapping cloud chunks without bridging real gaps', () => {
    const range = (startAtMillis: number, endAtMillis: number) => ({ startAtMillis, endAtMillis })
    expect(recordingCoverageContains([range(15, 30), range(0, 15)], 5, 25)).toBe(true)
    expect(recordingCoverageContains([range(0, 20), range(15, 30)], 5, 25)).toBe(true)
    expect(recordingCoverageContains([range(0, 14), range(15, 30)], 5, 25)).toBe(false)
    expect(recordingCoverageContains([range(0, NaN)], 5, 25)).toBe(false)
  })
  it('retains the whole 08:00–20:00 audio even without a single ASR row and leaks no owner ids', () => {
    const result = project()
    expect(result).toEqual({ state: 'ready', intervals: [{ startAtMillis: day + 8 * hour, endAtMillis: day + 20 * hour, sourceLabel: '白天录音.wav', status: 'saved' }] })
    expect(JSON.stringify(result)).not.toContain('secret-session')
  })
  it('keeps holes between actual children instead of painting a session envelope', () => {
    const result = project([{ ...child, duration: hour }, { ...child, start_at: day + 19 * hour, duration: hour }])
    expect(result.intervals.map(x => [x.startAtMillis, x.endAtMillis])).toEqual([[day + 8 * hour, day + 9 * hour], [day + 19 * hour, day + 20 * hour]])
  })
  it('clips cross-midnight audio and accepts legacy offsets without using speech boundaries', () => {
    const result = projectRecordingCoverage({ session_ls: [{ ...session, start_at: day - hour }], child_ls: [{ ...child, start_at: 0, duration: 2 * hour }] }, day, day + 24 * hour, 7)
    expect(result.intervals[0]).toMatchObject({ startAtMillis: day, endAtMillis: day + hour })
  })
  it('shows pending ASR as covered and never fabricates coverage from invalid metadata', () => {
    expect(project([{ ...child, has_asr: false }]).intervals[0]?.status).toBe('processing')
    expect(project([{ ...child, duration: NaN }])).toEqual({ state: 'partial', intervals: [] })
    expect(projectRecordingCoverage({}, day, day + 24 * hour, 7).state).toBe('partial')
    expect(projectRecordingCoverage({ session_ls: [], child_ls: [] }, day, day + 24 * hour, 7)).toEqual({ state: 'ready', intervals: [] })
  })
  it('does not infer a silent continuous file from a session with unproven gaps', () => {
    expect(project([])).toEqual({ state: 'partial', intervals: [] })
    expect(projectRecordingCoverage({ session_ls: [{ ...session, duration: 12 * hour, has_finish_spk: true }], child_ls: [] }, day, day + 24 * hour, 7).intervals).toHaveLength(1)
  })
  it('requires explicit self attribution instead of upload ownership or a recognized self speaker', () => {
    expect(recordingBelongsToViewer({ user_id: 7, belong_usr: 0 }, 7)).toBe(false)
    expect(recordingBelongsToViewer({ user_id: 7, belong_usr: 99, spk_ls: [{ ref_usr_id: 7 }] }, 7)).toBe(false)
    expect(recordingBelongsToViewer({ user_id: 7 }, 7)).toBe(false)
    expect(recordingBelongsToViewer({ belong_usr: 0 }, 0)).toBe(false)
    expect(project([child], [{ ...session, belong_usr: 0 }])).toEqual({ state: 'ready', intervals: [] })
    expect(project([child], [{ ...session, belong_usr: 99 }])).toEqual({ state: 'ready', intervals: [] })
  })
  it('excludes unattributed, orphaned and invalid-owner recordings without declaring missing data empty', () => {
    const { belong_usr, ...unattributed } = session
    const input = { session_ls: [unattributed], child_ls: [child] }
    expect(projectRecordingCoverage(input, day, day + 24 * hour, 7)).toEqual({ state: 'partial', intervals: [] })
    expect(project([{ ...child, session_id: 'orphan' }], [])).toEqual({ state: 'partial', intervals: [] })
    expect(projectRecordingCoverage({ session_ls: [session], child_ls: [child] }, day, day + 24 * hour, NaN)).toEqual({ state: 'partial', intervals: [] })
  })
  it('filters both direct children and completed session fallbacks by the current viewer', () => {
    const response = {
      session_ls: [session, { ...session, id: 'other', belong_usr: 99, has_finish_spk: true, duration: 12 * hour }],
      child_ls: [child],
    }
    expect(projectRecordingCoverage(response, day, day + 24 * hour, 7).intervals).toHaveLength(1)
    expect(projectRecordingCoverage(response, day, day + 24 * hour, 99).intervals).toHaveLength(1)
    expect(projectRecordingCoverage(response, day, day + 24 * hour, 42).intervals).toHaveLength(0)
  })
})

describe('local capture coverage', () => {
  const state: DirectRecordingSnapshot = { accountKey: 'test:7', phase: 'recording', elapsedMillis: 5000, startedAt: day + hour, maxMillis: 300000, levels: [], pending: [], message: '', error: '', progress: 0, acceptedRevision: 0, volatile: false }
  it('uses actual PCM duration, scopes by account and does not claim a permission request is recording', () => {
    expect(localRecordingCoverage(state, 'test:7', day)[0]).toMatchObject({ startAtMillis: day + hour, endAtMillis: day + hour + 5000, status: 'recording' })
    expect(localRecordingCoverage(state, 'prod:7', day)).toEqual([])
    expect(localRecordingCoverage({ ...state, phase: 'starting' }, 'test:7', day)).toEqual([])
    expect(localRecordingCoverage(state, 'test:7', day + 24 * hour)).toEqual([])
  })
  it('retains stopped/pending/submitted audio but never labels it recording', () => {
    const record = { id: 'r', accountKey: 'test:7', userId: 7, startedAt: day + hour, bytes: 320000, sampleRate: 16000, chunks: 1, finished: true, fileName: 'local.wav' }
    expect(localRecordingCoverage({ ...state, phase: 'idle', pending: [record] }, 'test:7', day)[0]).toMatchObject({ endAtMillis: day + hour + 10000, status: 'local' })
    expect(localRecordingCoverage({ ...state, phase: 'idle', submitted: [record] }, 'test:7', day)[0]?.status).toBe('submitted')
  })
})

describe('coverage and speech timeline presentation', () => {
  const props = { items: [] as ArkmeRecordingWorkbenchItem[], dayStartMillis: day, isPlaying: false, onSelectAtMillis: vi.fn(), onTogglePlayback: vi.fn() }
  it('paints both rails at the correct 12-hour width with no speech, leaves overview unfilled by selection', () => {
    const markup = renderToStaticMarkup(<ArkmeRecordingTimeline {...props} coverage={project().intervals} emptyState />)
    expect(markup.match(/data-recording-coverage="saved"/g)).toHaveLength(2)
    expect(markup).toContain('left:33.33333333333333%;width:50%')
    expect(markup).toContain('已有录音覆盖，暂无已识别人声')
    expect(markup).not.toContain('data-timeline-layer="empty"')
    expect(markup).not.toContain('data-recording-segment-index')
    expect(markup).toContain('已同步')
  })
  it('distinguishes unknown data from an empty day and still shows local audio during cloud errors', () => {
    const markup = renderToStaticMarkup(<ArkmeRecordingTimeline {...props} coverageState="error" coverage={[{ ...project().intervals[0]!, status: 'local' }]} />)
    expect(markup).toContain('云端录音范围读取失败')
    expect(markup).toContain('无已知录音')
    expect(markup).not.toContain('data-timeline-layer="empty"')
  })
  it('keeps a silent rail zoomable, stops its pulse after capture ends', () => {
    let renderer: ReturnType<typeof create>
    act(() => { renderer = create(<ArkmeRecordingTimeline {...props} coverage={[{ ...project().intervals[0]!, status: 'recording' }]} />) })
    expect(renderer!.root.findAllByProps({ 'data-arkme-recording-breath': 'dot' })).toHaveLength(2)
    const zoom = renderer!.root.findByProps({ 'aria-label': '放大' })
    expect(zoom.props.disabled).toBe(false)
    act(() => { zoom.props.onClick() })
    act(() => { renderer!.update(<ArkmeRecordingTimeline {...props} coverage={project().intervals} />) })
    expect(renderer!.root.findAllByProps({ 'data-arkme-recording-breath': 'dot' })).toHaveLength(0)
    act(() => renderer!.unmount())
  })
  it('does not call background audio human speech', () => {
    const markup = renderToStaticMarkup(<ArkmeRecordingTimeline {...props} coverage={project().intervals} items={[{ itemId: 'bg', isBackground: true, startAtMillis: day + 9 * hour, endAtMillis: day + 10 * hour, text: '环境音' } as ArkmeRecordingWorkbenchItem]} />)
    expect(markup).not.toContain('data-recording-segment-index')
  })
  it('keeps speech overlays in the same attribution scope even when the speaker is the viewer', () => {
    const ownSpeech = { itemId: 'own', recordingBelongsToViewer: true, isSelf: false, isBackground: false, speakerKey: 'other-person', speakerLabel: '对方', speakerColorIndex: 1, startAtMillis: day + 9 * hour, endAtMillis: day + 9 * hour + 1000, text: '我的录音中的对方讲话' } as ArkmeRecordingWorkbenchItem
    const otherSpeech = { ...ownSpeech, itemId: 'other', recordingBelongsToViewer: false, isSelf: true, speakerKey: 'self', speakerLabel: '我', text: '其他资料中的本人讲话' }
    const markup = renderToStaticMarkup(<ArkmeRecordingTimeline {...props} coverage={project().intervals} items={[otherSpeech, ownSpeech]} />)
    expect(markup.match(/data-recording-segment-index=/g)).toHaveLength(1)
    expect(markup).toContain('我的录音中的对方讲话')
    expect(markup).not.toContain('其他资料中的本人讲话')
  })
  it('removes the nested calendar outlines and avoids telling silent-recording owners to record again', () => {
    const markup = renderToStaticMarkup(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />)
    expect(markup).toMatch(/border:0;background:transparent[^>]*aria-label="选择录音日期"/)
    expect(renderToStaticMarkup(<ArkmeRecordingEmptyState recorded />)).toContain('已有录音，暂无转写内容')
  })
})
