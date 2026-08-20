export function normalizeGitHubRepositoryURL(raw: string | undefined): string | undefined {
	const value = raw?.trim() ?? ''
	if (value === '') return undefined
	let parsed: URL
	try { parsed = new URL(value) } catch { throw new TypeError('GitHub repository URL is invalid') }
	const host = parsed.hostname.toLowerCase()
	if (parsed.protocol !== 'https:' || !['github.com', 'www.github.com'].includes(host)
		|| parsed.username !== '' || parsed.password !== '' || parsed.port !== '' || parsed.search !== '' || parsed.hash !== '') {
		throw new TypeError('GitHub repository URL is invalid')
	}
	const parts = parsed.pathname.replace(/\/$/, '').replace(/^\//, '').split('/')
	if (parts.length !== 2) throw new TypeError('GitHub repository URL must point to a repository root')
	const owner = parts[0]!
	const repository = parts[1]!.replace(/\.git$/, '')
	if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)
		|| !/^[A-Za-z0-9._-]{1,100}$/.test(repository) || repository.endsWith('.')) {
		throw new TypeError('GitHub repository URL is invalid')
	}
	return `https://github.com/${owner.toLowerCase()}/${repository.toLowerCase()}`
}
