// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useNavigationVersion } from '../src/client/use-navigation-version.js'

function Version({ plugin = '3.0.38' }: { plugin?: string }) {
  return <span>{useNavigationVersion(plugin)}</span>
}
afterEach(() => { vi.unstubAllGlobals() })
it('uses desktop history and switches back when the plugin is updated', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const showClientVersionCode = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
  vi.stubGlobal('arkmeDesktop', { appVersionCode: 219, productVersion: { showClientVersionCode } })
  const host = document.createElement('div'), root = createRoot(host)
  await act(async () => root.render(<Version />))
  expect(host.textContent).toBe('v3.0.38+219')
  expect(showClientVersionCode).toHaveBeenCalledWith('3.0.38')
  await act(async () => root.render(<Version plugin="3.0.39" />))
  expect(host.textContent).toBe('v3.0.39')
  await act(async () => root.unmount())
})
it.each(['legacy', 'failed', 'missing-code'])('falls back safely for %s desktops', async mode => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('arkmeDesktop', mode === 'legacy' ? { appVersionCode: 219 } : {
    appVersionCode: mode === 'missing-code' ? undefined : 219,
    productVersion: { showClientVersionCode: mode === 'failed' ? vi.fn().mockRejectedValue(new Error('unavailable')) : vi.fn().mockResolvedValue(true) },
  })
  const host = document.createElement('div'), root = createRoot(host)
  await act(async () => root.render(<Version />))
  expect(host.textContent).toBe('v3.0.38')
  await act(async () => root.unmount())
})
