const EXTENSION_SHARE_HASH = /^#\/arkme\/extensions\/share\/(extshare_[0-9a-f]{32})(?:\/(author-chat|author-world))?$/

type ExtensionShareDeepLinkTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>

export type ArkmeExtensionShareAction = 'author-chat' | 'author-world'

export interface ArkmeExtensionShareIntent {
	shareRef: string
	action?: ArkmeExtensionShareAction
}

/** Parse one exact, fragment-only Arkme extension share intent. */
export function extensionShareIntentFromHash(hash: string): ArkmeExtensionShareIntent | undefined {
	const match = EXTENSION_SHARE_HASH.exec(hash)
	if (match?.[1] === undefined) return undefined
	return {
		shareRef: match[1],
		...(match[2] === undefined ? {} : { action: match[2] as ArkmeExtensionShareAction }),
	}
}

/** Parse one exact, fragment-only Arkme extension share deep link. */
export function extensionShareRefFromHash(hash: string): string | undefined {
	return extensionShareIntentFromHash(hash)?.shareRef
}

/** Consume the full deep-link intent without disturbing the DSH pathname or query string. */
export function consumeExtensionShareDeepLinkIntent(
	location: Location,
	history: History,
): ArkmeExtensionShareIntent | undefined {
	const intent = extensionShareIntentFromHash(location.hash)
	if (intent === undefined) return undefined
	history.replaceState(history.state, '', `${location.pathname}${location.search}`)
	return intent
}

/** Consume the deep-link fragment without disturbing the DSH pathname or query string. */
export function consumeExtensionShareDeepLink(location: Location, history: History): string | undefined {
	return consumeExtensionShareDeepLinkIntent(location, history)?.shareRef
}

/** Consume startup and later desktop deep links, including reopening the same share. */
export function observeExtensionShareDeepLinks(
	location: Location,
	history: History,
	target: ExtensionShareDeepLinkTarget,
	onOpen: (intent: ArkmeExtensionShareIntent) => void,
): () => void {
	const consume = () => {
		const intent = consumeExtensionShareDeepLinkIntent(location, history)
		if (intent !== undefined) onOpen(intent)
	}
	target.addEventListener('hashchange', consume)
	consume()
	return () => { target.removeEventListener('hashchange', consume) }
}
