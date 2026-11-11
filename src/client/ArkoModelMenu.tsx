import type { ArkmeArkoModelCatalog } from '../types.js'
import { arkoModelChoices } from '../model-directory.js'
import { UnifiedModelPicker } from './UnifiedModelPicker.js'
export function ArkoModelMenu({ anchor, catalog, busy, error, onSelect, onClose, onRefresh }: {
  anchor: HTMLButtonElement; catalog?: ArkmeArkoModelCatalog | undefined; busy: boolean; error: string
  onSelect(routeKey: string): Promise<boolean>; onClose(): void; onRefresh?: () => Promise<void>
}) {
  const models = catalog ? arkoModelChoices(catalog) : []
  const currentId = models.find(model => model.arko === catalog?.effectiveRouteKey)?.id ?? ''
  return <UnifiedModelPicker scene="arko" scopeLabel="Arko 后续新任务" models={models}
    currentId={currentId} anchor={anchor} busy={busy} loading={!catalog && !error} error={error}
    onRefresh={onRefresh} onClose={onClose} onApply={async model => model.arko ? onSelect(model.arko) : false}/>
}
