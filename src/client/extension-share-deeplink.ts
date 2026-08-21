const EXTENSION_SHARE_HASH = /^#\/arkme\/extensions\/share\/(extshare_[0-9a-f]{32})$/

/** Parse one exact, fragment-only Arkme extension share deep link. */
export function extensionShareRefFromHash(hash: string): string | undefined {
	return EXTENSION_SHARE_HASH.exec(hash)?.[1]
}

/** Consume the deep-link fragment without disturbing the DSH pathname or query string. */
export function consumeExtensionShareDeepLink(location: Location, history: History): string | undefined {
	const shareRef = extensionShareRefFromHash(location.hash)
	if (shareRef === undefined) return undefined
	history.replaceState(history.state, '', `${location.pathname}${location.search}`)
	return shareRef
}
