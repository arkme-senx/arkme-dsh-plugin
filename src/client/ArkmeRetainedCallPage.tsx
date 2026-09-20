import { useEffect, useState } from 'react'
import { ArkmeCallSurface } from './ArkmeCallSurface.js'

/** The parent keys this page by authenticated account and removes it on logout. */
export function ArkmeRetainedCallPage({ active }: { active: boolean }) {
  const [visited, setVisited] = useState(active)
  useEffect(() => { if (active) setVisited(true) }, [active])
  if (!active && !visited) return null
  return <div data-arkme-retained-call-page="true" hidden={!active} aria-hidden={!active}
    style={{ display: active ? 'flex' : 'none', flex: 1, minWidth: 0, minHeight: 0 }}>
    <ArkmeCallSurface active={active} />
  </div>
}
