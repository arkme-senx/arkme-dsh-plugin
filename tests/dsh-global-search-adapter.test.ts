import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const clientEntry = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
const persistentShell = readFileSync(new URL('../src/client/ArkmePersistentShell.tsx', import.meta.url), 'utf8')

describe('DSH global search adapter', () => {
  it('uses the injected public DSH sessions service without adding an Arkme Host route', () => {
    expect(clientEntry).toContain("export const inject = ['slots', 'layout', 'locale', 'sessions']")
    expect(clientEntry).toContain("{ sessions?: ISessions }).sessions")
    expect(clientEntry).toContain('dshSessions.search(query, signal)')
    expect(clientEntry).toContain('dshSessions.open(sessionId as SessionId)')
    expect(clientEntry).not.toContain('DSH_HOME')
    expect(clientEntry).not.toContain('sessions.jsonl')
  })

  it('maps DSH snippets onto the live task summaries owned by the DSH session list', () => {
    expect(persistentShell).toContain('const summary = sessionState.byId[item.sessionId]')
    expect(persistentShell).toContain("title: summary?.displayTitle ?? 'DeepSeek Harness 任务'")
    expect(persistentShell).toContain('onOpenDshSession={sessionId => { openDshSession(sessionId); arkmeUi.showHarness() }}')
  })
})
