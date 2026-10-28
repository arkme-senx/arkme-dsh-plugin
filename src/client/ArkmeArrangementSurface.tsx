import { useState } from 'react'
import { ArkmeArrangementWorkspace } from './ArkmeArrangementWorkspace.js'
import { ArkmeArrangementCreate, ArkmeArrangementCreationStatus, useCreatedArrangements } from './ArkmeArrangementCreate.js'
import { useArkmeLocale } from './locale.js'

export function ArkmeArrangementSurface({ accountScope }: { accountScope: string }) {
  return <ArrangementSurface key={accountScope} accountScope={accountScope} />
}

function ArrangementSurface({ accountScope }: { accountScope: string }) {
  useArkmeLocale()
  const [createOpen, setCreateOpen] = useState(false)
  const created = useCreatedArrangements()

  return <div className="arkme-arrangement-surface">
    <ArkmeArrangementWorkspace accountScope={accountScope} createdItems={created.items}
      onAddArrangement={() => setCreateOpen(true)} />
    <ArkmeArrangementCreationStatus created={created} />
    <ArkmeArrangementCreate accountScope={accountScope} open={createOpen}
      onClose={() => setCreateOpen(false)} onSaved={created.merge} />
  </div>
}
