import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const clientRoot = resolve(import.meta.dirname, '../src/client')

describe('Arkme directory slot contract', () => {
  it('keeps row rendering owned by Arkme instead of leaking style or surface hooks', () => {
    const contract = readFileSync(resolve(clientRoot, 'slots-contract.ts'), 'utf8')
    const workspace = readFileSync(resolve(clientRoot, 'ArkmeVirtualWorkspace.tsx'), 'utf8')

    expect(contract).toContain('renderRow')
    expect(contract).toContain('ArkmeDirectoryRowProps')
    expect(contract).not.toContain('rowClass')
    expect(contract).not.toContain('rowActiveClass')
    expect(contract).not.toContain('onActivateSurface')
    expect(workspace).toContain('renderRow: renderArkmeDirectoryRow')
  })

  it('keeps consumer directory entries mutually exclusive with native navigation', () => {
    const contract = readFileSync(resolve(clientRoot, 'slots-contract.ts'), 'utf8')
    const workspace = readFileSync(resolve(clientRoot, 'ArkmeVirtualWorkspace.tsx'), 'utf8')

    expect(contract).toContain('activeEntryId?: string')
    expect(contract).toContain('activateEntry(entryId?: string): void')
    expect(workspace).toContain('activeEntryId: activeDirectoryEntryId')
    expect(workspace).toContain('activateEntry: activateDirectoryEntry')
    expect(workspace).toContain('activateNativeEntry(); arkmeUi.showRecordings()')
    expect(workspace).toContain('activateNativeEntry(); arkmeUi.showCalendar()')
    expect(workspace).toContain('activateNativeEntry(); arkmeUi.showSearch()')
    expect(workspace).toContain('activateNativeEntry(); arkmeUi.showContactAdd()')
    expect(workspace).toContain('activateNativeEntry(); arkmeUi.showArko()')
  })
})
