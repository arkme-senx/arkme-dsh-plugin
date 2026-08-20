import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeExtensionShareDialog, ArkmeExtensionSourceLink } from '../../src/client/ArkmeExtensionShare.js'

describe('extension share UI', () => {
	it('shows the share URL in a compact copy dialog without rotation controls', () => {
		const html = renderToStaticMarkup(<ArkmeExtensionShareDialog
			url="https://jiwo.cc/app/share/extension/extshare_0123456789abcdef0123456789abcdef"
			notice="分享链接已复制。"
			onClose={() => {}}
			onCopy={() => {}}
		/>)
		expect(html).toContain('aria-label="分享网页链接"')
		expect(html).toContain('value="https://jiwo.cc/app/share/extension/extshare_0123456789abcdef0123456789abcdef"')
		expect(html).toContain('>复制</button>')
		expect(html).toContain('分享链接已复制。')
		expect(html).not.toContain('轮换链接')
	})

	it('keeps the attested GitHub source as a lightweight detail link', () => {
		const html = renderToStaticMarkup(<ArkmeExtensionSourceLink
			source={{
				type: 'github_repository', url: 'https://github.com/example/weather',
				label: '开源来源 · GitHub', verification: 'publisher_attested',
			}}
		/>)
		expect(html).toContain('开源来源 · GitHub')
		expect(html).toContain('href="https://github.com/example/weather"')
		expect(html).toContain('rel="noopener noreferrer nofollow"')
	})
})
