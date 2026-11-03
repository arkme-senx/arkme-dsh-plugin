import { act, create } from 'react-test-renderer'
import type { ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
import type { ArkmeArrangementItem } from '../src/types.js'
const api = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: api }))
vi.mock('../src/client/ArkmeDetailShell.js', () => ({ ArkmeDetailShell: ({ children, title }: { children: ReactNode; title: string }) => <section aria-label={title}>{children}</section> }))
import { ArkmeArrangementContent } from '../src/client/ArkmeArrangementContent.js'

const item: ArkmeArrangementItem = {
  arrangementRef: 'old', title: '缓存的安排', description: '', status: 'following',
  reminderEnabled: false, reminderState: '', createdAtMillis: 100, updatedAtMillis: 200,
}

it('reads and opens merged provenance with the verified master reference', async () => {
  api.mockReset().mockImplementation(async (operation, params) => {
    if (operation === 'arrangements.detail') return {
      ...item, arrangementRef: 'master', resolvedFromRef: 'old',
      provenance: [{ id: 'e', kind: 'input', role: 'initial', canOpen: true, readOnExpand: true }],
    }
    expect(params.arrangementRef).toBe('master')
    return operation === 'arrangements.source.read'
      ? { evidenceId: 'e', state: 'ready', text: '归并后核验的原文' }
      : { kind: 'document', title: '主安排来源', text: '归并后核验的原文' }
  })
  let ui!: ReturnType<typeof create>
  await act(async () => { ui = create(<ArkmeArrangementContent item={item} expanded />) })
  try {
    expect(JSON.stringify(ui.toJSON())).toContain('归并后核验的原文')
    expect(JSON.stringify(ui.toJSON())).not.toContain('创建原文加载失败')
    await act(async () => ui.root.findByType('button').props.onClick({ stopPropagation() {} }))
    expect(api).toHaveBeenCalledWith('arrangements.source.open', { arrangementRef: 'master', evidenceId: 'e' }, expect.any(AbortSignal))
  } finally { await act(async () => ui.unmount()) }
})

it.each([undefined, 'another-request'])('rejects unverified redirects (%s)', async resolvedFromRef => {
  api.mockReset().mockResolvedValue({ ...item, arrangementRef: 'other', resolvedFromRef, creationSource: {kind:'input',items:[{text:'其他安排私密原文'}],unavailableCount:0} })
  let ui!: ReturnType<typeof create>
  await act(async () => { ui = create(<ArkmeArrangementContent item={item} expanded />) })
  try {
    expect(JSON.stringify(ui.toJSON())).toContain('创建原文加载失败')
    expect(JSON.stringify(ui.toJSON())).not.toContain('其他安排私密原文')
  } finally { await act(async () => ui.unmount()) }
})
