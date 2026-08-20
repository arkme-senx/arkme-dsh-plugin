/**
 * Arkme-owned child-slot contract: one additive directory entry inside the
 * Arkme dropdown panel. Declaring is claiming — this entry is the only
 * registrant allowed to render the key. Consumer plugins (e.g. the World
 * surface) register a row into `arkme.directory.entry` without touching the
 * Arkme surface code.
 */
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReactNode } from 'react'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Additive directory rows rendered inside the Arkme dropdown panel. */
    'arkme.directory.entry': {
      kind: 'list'
      scope: 'root'
      owner: ArkmeDirectoryEntryOwnerProps
    }
  }
}

/** Semantic content accepted by the Arkme-owned directory-row renderer. */
export interface ArkmeDirectoryRowProps {
  avatar: ReactNode
  title: string
  preview: string
  selected: boolean
  disabled?: boolean
  ariaLabel?: string
  onClick(): void
}

/** Owner share of a directory entry: column state plus owner-rendered chrome. */
export interface ArkmeDirectoryEntryOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
  /** Whether the Arkme account is authenticated. */
  authenticated: boolean
  /** Render one row with Arkme-owned structure, tokens and accessibility. */
  renderRow(props: ArkmeDirectoryRowProps): ReactNode
}

/** Full props of a component registered into `arkme.directory.entry`. */
export type ArkmeDirectoryEntryComponentProps =
  PropsRuntime<'arkme.directory.entry'> & PropsRenderSlots<'arkme.directory.entry'>
