import type {
  ArkmeExtensionReviewCreateInput,
  ArkmeExtensionReviewCreateResult,
  ArkmeExtensionReviewPage,
} from '../../extensions/types.js'

export interface ArkmeExtensionReviewToolPort {
  listExtensionReviews(
    extensionId: string,
    options?: { limit?: number; offset?: number; signal?: AbortSignal },
  ): Promise<ArkmeExtensionReviewPage>
  createExtensionReview(
    input: ArkmeExtensionReviewCreateInput,
    signal?: AbortSignal,
  ): Promise<ArkmeExtensionReviewCreateResult>
}
