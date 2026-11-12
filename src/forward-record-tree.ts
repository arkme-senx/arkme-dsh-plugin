import type { ArkmeForwardRecordsPreview, ArkmeForwardRecordPreviewItem } from './types.js'

export function* walkForwardRecordItems(card: ArkmeForwardRecordsPreview): Generator<ArkmeForwardRecordPreviewItem> {
  for (const row of card.items) {
    yield row
    if (row.forwardRecords) yield* walkForwardRecordItems(row.forwardRecords)
  }
}
