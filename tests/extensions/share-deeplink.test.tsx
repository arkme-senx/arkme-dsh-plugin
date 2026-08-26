import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeSharedExtensionDetail } from '../../src/client/ArkmeSharedExtensionDetail.js'
import { extensionShareRefFromHash } from '../../src/client/extension-share-deeplink.js'
import { ArkmeUiController } from '../../src/client/ui-controller.js'

const SHARE_REF = 'extshare_0123456789abcdef0123456789abcdef'

describe('extension share DSH deep link', () => {
	it('accepts only the exact fragment route', () => {
		expect(extensionShareRefFromHash(`#/arkme/extensions/share/${SHARE_REF}`)).toBe(SHARE_REF)
		expect(extensionShareRefFromHash(`#/arkme/extensions/share/${SHARE_REF}?install=1`)).toBeUndefined()
		expect(extensionShareRefFromHash('#/arkme/extensions/share/bad')).toBeUndefined()
	})

	it('keeps one pending share intent in the Arkme UI controller', () => {
		const controller = new ArkmeUiController()
		controller.openExtensionShare(SHARE_REF)
		expect(controller.getSnapshot()).toMatchObject({
			extensionShareRef: SHARE_REF,
		})
		controller.dismissExtensionShare()
		expect(controller.getSnapshot()).not.toHaveProperty('extensionShareRef')
		controller.openExtensionShare(SHARE_REF)
		const latestShareRef = 'extshare_fedcba9876543210fedcba9876543210'
		controller.openExtensionShare(latestShareRef)
		expect(controller.getSnapshot()).toMatchObject({ extensionShareRef: latestShareRef })
		controller.dismissExtensionShare()
		expect(controller.getSnapshot()).not.toHaveProperty('extensionShareRef')
	})

	it('renders a read-only shared detail without install, comment, or management actions', () => {
		const html = renderToStaticMarkup(<ArkmeSharedExtensionDetail
			shareRef={SHARE_REF}
			extension={{
				name: '天气', description: '天气扩展', visibility: 'private', share_scope: 'link_readonly',
				latest_stable_version: '1.0.0', preview_images: [],
				rating_summary: { average: 4.5, count: 2, histogram: [0, 0, 0, 1, 1] },
				source: {
					type: 'github_repository', url: 'https://github.com/example/weather',
					label: '开源来源 · GitHub', verification: 'publisher_attested',
				},
			}}
			onBack={() => {}}
		/>)
		expect(html).toContain('通过分享链接查看')
		expect(html).toContain('天气扩展')
		expect(html).toContain('4.5')
		expect(html).toContain('查看 GitHub 仓库')
		expect(html).not.toContain('>安装</button>')
		expect(html).not.toContain('发表评论')
		expect(html).not.toContain('轮换')
	})
})
