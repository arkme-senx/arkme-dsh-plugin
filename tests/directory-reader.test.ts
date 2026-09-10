import { describe, expect, it, vi } from 'vitest'
import { readDirectoryPage } from '../src/directory-reader.js'

describe('shared directory read contract', () => {
  it.each(['groups', 'bots', 'unmarked-speakers', 'teams', 'contacts'] as const)('rejects refresh plus cursor before dispatching %s to its owner', async section => {
    const service = { listDirectory: vi.fn() }
    const teams = { listDirectory: vi.fn() }
    await expect(async () => readDirectoryPage(service, teams, section, { refresh: true, cursor: 'old-page' })).rejects.toMatchObject({ code: 'directory-cursor-invalid', retryable: false })
    expect(service.listDirectory).not.toHaveBeenCalled()
    expect(teams.listDirectory).not.toHaveBeenCalled()
  })
})
