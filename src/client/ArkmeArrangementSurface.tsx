import { useState } from 'react'
import { ArkmeArrangementWorkspace } from './ArkmeArrangementWorkspace.js'
import { ArkmeArrangementCreate, ArkmeArrangementCreationStatus, useCreatedArrangements } from './ArkmeArrangementCreate.js'
import { useArkmeLocale } from './locale.js'

export function ArkmeArrangementSurface({ accountScope, initialArrangementRef }: { accountScope: string; initialArrangementRef?: string | undefined }) {
  return <ArrangementSurface key={accountScope} accountScope={accountScope} initialArrangementRef={initialArrangementRef} />
}

function ArrangementSurface({ accountScope, initialArrangementRef }: { accountScope: string; initialArrangementRef?: string | undefined }) {
  useArkmeLocale()
  const [createOpen, setCreateOpen] = useState(false)
  const created = useCreatedArrangements()

  return <div className="arkme-arrangement-surface">
    <ArkmeArrangementWorkspace initialArrangementRef={initialArrangementRef} accountScope={accountScope} createdItems={created.items}
      onAddArrangement={() => setCreateOpen(true)} />
    <ArkmeArrangementCreationStatus created={created} />
    <ArkmeArrangementCreate accountScope={accountScope} open={createOpen}
      onClose={() => setCreateOpen(false)} onSaved={created.merge} />
  </div>
}
