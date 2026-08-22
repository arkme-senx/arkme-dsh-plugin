import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeExtensionInstallStore } from '../../src/extensions/install-store.js'
import { ArkmeExtensionManager } from '../../src/extensions/manager.js'
import { ExtensionPublishClient } from '../../src/extensions/publish-client.js'
import { normalizeGitHubRepositoryURL } from '../../src/extensions/source.js'

const directories: string[] = []
const stores: ArkmeExtensionInstallStore[] = []
afterEach(() => {
	for (const store of stores.splice(0)) store.close()
	for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

function managerWith(post: ConstructorParameters<typeof ExtensionPublishClient>[0]): ArkmeExtensionManager {
	const root = mkdtempSync(join(tmpdir(), 'arkme-extension-share-'))
	directories.push(root)
	const store = new ArkmeExtensionInstallStore(join(root, 'store'))
	stores.push(store)
	return new ArkmeExtensionManager(
		new ExtensionPublishClient(post),
		store,
		{} as never,
		{ artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}' },
	)
}

describe('extension share Host owner', () => {
	it('normalizes only exact GitHub repository roots', () => {
		expect(normalizeGitHubRepositoryURL('https://www.github.com/Example/Weather.git/')).toBe('https://github.com/example/weather')
		expect(() => normalizeGitHubRepositoryURL('https://github.com/example/weather/tree/main')).toThrow(/repository root/)
		expect(() => normalizeGitHubRepositoryURL('http://github.com/example/weather')).toThrow(/invalid/)
	})
	it('validates and rotates an owner share link through one manager', async () => {
		const post = vi.fn(async () => ({
			ref: 'extshare_0123456789abcdef0123456789abcdef',
			url: 'https://jiwo.cc/app/share/extension/extshare_0123456789abcdef0123456789abcdef',
		}))
		const manager = managerWith(post)
		await expect(manager.rotateShareLink({
			extensionId: 'ext-1', clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432',
		})).resolves.toMatchObject({ ref: 'extshare_0123456789abcdef0123456789abcdef' })
		expect(post).toHaveBeenCalledOnce()
	})

	it('rejects invalid rotation input before transport', async () => {
		const post = vi.fn()
		await expect(managerWith(post).rotateShareLink({
			extensionId: '', clientMutationId: 'bad',
		})).rejects.toMatchObject({ code: 'extension-share-invalid' })
		expect(post).not.toHaveBeenCalled()
	})

	it('reads and validates one link-scoped read-only share without exposing an extension id', async () => {
		const post = vi.fn(async () => ({
			extension: {
				name: 'Weather', description: 'Open source weather', visibility: 'private',
				share_scope: 'link_readonly', latest_stable_version: '1.0.0',
				preview_images: [], rating_summary: { average: 4.5, count: 2, histogram: [0, 0, 0, 1, 1] },
				source: {
					type: 'github_repository', url: 'https://github.com/example/weather',
					label: '开源来源 · GitHub', verification: 'publisher_attested',
				},
			},
		}))
		const manager = managerWith(post)
		const detail = await manager.readSharedDetail('extshare_0123456789abcdef0123456789abcdef')
		expect(detail).toMatchObject({ name: 'Weather', visibility: 'private', share_scope: 'link_readonly' })
		expect(detail).not.toHaveProperty('extension_id')
		expect(post).toHaveBeenCalledWith(
			'/api/public/v1/extensions/share/detail',
			{ share_ref: 'extshare_0123456789abcdef0123456789abcdef' },
			undefined,
		)
	})

	it('rejects malformed refs and non-read-only share responses', async () => {
		const post = vi.fn(async () => ({ extension: {
			name: 'Weather', description: '', visibility: 'private', share_scope: 'install',
			latest_stable_version: '1.0.0', preview_images: [],
			rating_summary: { average: 0, count: 0, histogram: [0, 0, 0, 0, 0] },
		} }))
		const manager = managerWith(post)
		await expect(manager.readSharedDetail('bad')).rejects.toMatchObject({ code: 'extension-share-invalid' })
		expect(post).not.toHaveBeenCalled()
		await expect(manager.readSharedDetail('extshare_0123456789abcdef0123456789abcdef'))
			.rejects.toMatchObject({ code: 'extension-share-contract-invalid' })
	})
})
