// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { RecordingVersionDetails } from '../src/client/recordings/RecordingVersionDetails.js'
import type { ArkmeRecordingVersion } from '../src/types.js'

it('keeps unknown-source explanation inside the details modal and shows the selected version only', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const version: ArkmeRecordingVersion = { id: 'old', status: 'done', selectable: true, generationStage: 0, generatedAtMillis: 1, modelDisplayName: '历史模型', sourceState: 'unknown', content: '保留正文', error: '', timelineEvents: [] }
  try {
    await act(async () => root.render(<RecordingVersionDetails key={version.id} version={version}/>))
    expect(document.body.textContent).not.toContain('缺少可核验')
    await act(async () => host.querySelector('button')!.click())
    expect(document.querySelector('[aria-modal="true"]')?.textContent).toContain('缺少可核验的来源记录')
    expect(document.querySelector('[aria-modal="true"]')?.textContent).toContain('历史模型')
    await act(async () => root.render(<RecordingVersionDetails key="new" version={{...version, id:'new', modelDisplayName:'新模型', sourceState:'current'}}/>))
    expect(document.querySelector('[aria-modal="true"]')).toBeNull()
    await act(async () => host.querySelector('button')!.click())
    expect(document.querySelector('[aria-modal="true"]')?.textContent).toContain('来源与当前录音一致')
    expect(document.querySelector('[aria-modal="true"]')?.textContent).not.toContain('历史模型')
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})
