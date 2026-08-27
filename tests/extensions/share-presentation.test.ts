import { describe, expect, it, vi } from 'vitest'
import { resolveExtensionSharePresentation } from '../../src/client/extension-share-presentation.js'

const SHARE_REF = 'extshare_0123456789abcdef0123456789abcdef'

describe('extension share presentation routing', () => {
	it('prefers the existing marketplace detail when the authenticated share resolves', async () => {
		const caller = vi.fn(async () => ({
			extension_id: 'ext-public-1', name: '破妄真眼', description: '标准详情', visibility: 'public',
		}))

		await expect(resolveExtensionSharePresentation(SHARE_REF, undefined, caller))
			.resolves.toMatchObject({ kind: 'catalog', detail: { extension_id: 'ext-public-1', name: '破妄真眼' } })
		expect(caller).toHaveBeenCalledTimes(1)
		expect(caller).toHaveBeenCalledWith('extensions.share.resolve', { shareRef: SHARE_REF }, undefined)
	})

	it('uses the read-only view only when catalog resolution is unavailable', async () => {
		const caller = vi.fn(async (operation: string) => {
			if (operation === 'extensions.share.resolve') throw new Error('not resolvable')
			return {
				name: '私有扩展', description: '只读详情', visibility: 'private', share_scope: 'link_readonly',
				latest_stable_version: '1.0.0', preview_images: [],
				rating_summary: { average: 0, count: 0, histogram: [0, 0, 0, 0, 0] },
			}
		})

		await expect(resolveExtensionSharePresentation(SHARE_REF, undefined, caller))
			.resolves.toMatchObject({ kind: 'readonly', detail: { name: '私有扩展', share_scope: 'link_readonly' } })
		expect(caller.mock.calls.map(call => call[0])).toEqual([
			'extensions.share.resolve', 'extensions.share.detail',
		])
	})

	it('does not start a fallback request after cancellation', async () => {
		const controller = new AbortController()
		controller.abort()
		const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' })
		const caller = vi.fn(async (): Promise<never> => { throw aborted })

		await expect(resolveExtensionSharePresentation(SHARE_REF, controller.signal, caller)).rejects.toBe(aborted)
		expect(caller).toHaveBeenCalledTimes(1)
	})
})
