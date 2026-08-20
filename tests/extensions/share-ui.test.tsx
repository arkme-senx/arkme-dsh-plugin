import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeExtensionShareSection } from '../../src/client/ArkmeExtensionShareSection.js'

describe('extension share UI', () => {
	it('shows the attested GitHub source and owner share controls', () => {
		const html = renderToStaticMarkup(<ArkmeExtensionShareSection
			source={{
				type: 'github_repository', url: 'https://github.com/example/weather',
				label: '开源来源 · GitHub', verification: 'publisher_attested',
			}}
			share={{
				ref: 'extshare_0123456789abcdef0123456789abcdef',
				url: 'https://jiwo.cc/app/share/extension/extshare_0123456789abcdef0123456789abcdef',
			}}
			canRotate
			busy={false}
			onCopy={() => {}}
			onRotate={() => {}}
		/>)
		expect(html).toContain('开源来源 · GitHub')
		expect(html).toContain('href="https://github.com/example/weather"')
		expect(html).toContain('rel="noopener noreferrer nofollow"')
		expect(html).toContain('>复制分享链接</button>')
		expect(html).toContain('>轮换链接</button>')
		expect(html).not.toContain('安装')
	})
})
