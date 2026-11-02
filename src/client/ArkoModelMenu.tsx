import type { ArkmeArkoModelCatalog } from '../types.js'
import { arkoModelChoices } from '../model-directory.js'
import { UnifiedModelPicker } from './UnifiedModelPicker.js'
export function ArkoModelMenu({ anchor, catalog, busy, error, onSelect, onClose }: {
  anchor: HTMLButtonElement; catalog?: ArkmeArkoModelCatalog | undefined; busy: boolean; error: string
  onSelect(routeKey: string): Promise<boolean>; onClose(): void
}) {
  return <UnifiedModelPicker scene="arko" scopeLabel="Arko 后续新任务" models={catalog ? arkoModelChoices(catalog) : []}
    currentId={JSON.stringify(['arko', catalog?.effectiveRouteKey])} anchor={anchor} busy={busy} error={error}
    onClose={onClose} onApply={async model => model.arko ? onSelect(model.arko) : false}/>
}
