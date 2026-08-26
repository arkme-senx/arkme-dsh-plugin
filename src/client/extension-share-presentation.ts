import type { ArkmeExtensionCatalogItem, ArkmeSharedExtensionDetail } from '../extensions/types.js'
import { callArkme } from './api.js'

type ExtensionShareCaller = <T>(
	operation: 'extensions.share.resolve' | 'extensions.share.detail',
	params: { shareRef: string },
	signal?: AbortSignal,
) => Promise<T>

export type ExtensionSharePresentation =
	| { kind: 'catalog'; detail: ArkmeExtensionCatalogItem }
	| { kind: 'readonly'; detail: ArkmeSharedExtensionDetail }

/**
 * Prefer the authenticated marketplace identity so Arkme can reuse its normal detail modal.
 * The public read-only projection remains a compatibility fallback for private shares and old services.
 */
export async function resolveExtensionSharePresentation(
	shareRef: string,
	signal?: AbortSignal,
	caller: ExtensionShareCaller = callArkme,
): Promise<ExtensionSharePresentation> {
	try {
		return {
			kind: 'catalog',
			detail: await caller<ArkmeExtensionCatalogItem>('extensions.share.resolve', { shareRef }, signal),
		}
	} catch (caught) {
		if (signal?.aborted === true || (caught as Error).name === 'AbortError') throw caught
		return {
			kind: 'readonly',
			detail: await caller<ArkmeSharedExtensionDetail>('extensions.share.detail', { shareRef }, signal),
		}
	}
}
