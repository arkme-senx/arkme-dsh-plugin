import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { projectRecordingVersions } from '../src/recording-presentation.js'
import { RecordingSourceNotice } from '../src/client/recordings/RecordingSourceNotice.js'

describe.each(['summary', 'timeline'] as const)('%s source freshness', kind => {
  const project = (source: unknown, id = 'selected') => projectRecordingVersions({ items: [{
    id, kind: kind === 'summary' ? 2 : 1, status: 2,
    answer: '09:00-10:00 保留的原内容', source_state: source,
  }] }, kind)[0]!
  it('preserves content and selection while current → stale → current after undo', () => {
    for (const state of ['current', 'stale', 'current']) {
      const version = project({ state })
      expect(version.id).toBe('selected')
      expect(version.content).toBe('09:00-10:00 保留的原内容')
      expect(version.selectable).toBe(true)
      const markup = renderToStaticMarkup(<RecordingSourceNotice version={version} />)
      if (state === 'current') expect(markup).toBe('')
      else {
        expect(markup).toContain('此版本待更新')
        expect(markup).toContain('重新生成')
        expect(markup).not.toContain('<button')
      }
    }
  })
  it.each([undefined, null, {}, { state: 'unknown' }, { state: 'future' }, 'current'])('does not infer freshness from legacy or invalid state %j', source => {
    const version = project(source)
    expect(version.sourceState).toBe('unknown')
    expect(renderToStaticMarkup(<RecordingSourceNotice version={version} />)).toBe('')
  })
  it('shows the selected historical state independently of the newest version', () => {
    const old = project({ state: 'stale' }, 'old')
    const latest = project({ state: 'current' }, 'latest')
    expect(renderToStaticMarkup(<RecordingSourceNotice version={old} />)).toContain('此版本待更新')
    expect(renderToStaticMarkup(<RecordingSourceNotice version={latest} />)).toBe('')
    expect(renderToStaticMarkup(<RecordingSourceNotice version={{ ...old, sourceState: undefined }} />)).toBe('')
    expect(renderToStaticMarkup(<RecordingSourceNotice version={{ ...old, status: 'processing' }} />)).toBe('')
  })
})
