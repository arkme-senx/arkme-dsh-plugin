import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileOpenApiMcpReconcileLock } from '../src/openapi-mcp/reconcile-lock.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async path => { await rm(path, { recursive: true, force: true }) }))
})

async function lockFixture(): Promise<{ directory: string; path: string; lock: FileOpenApiMcpReconcileLock }> {
  const directory = await mkdtemp(join(tmpdir(), 'arkme-openapi-mcp-lock-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'reconcile.lock')
  return { directory, path, lock: new FileOpenApiMcpReconcileLock(path) }
}

describe('OpenAPI MCP cross-process reconcile lock', () => {
  it('serializes concurrent owners and removes the lock after completion', async () => {
    const fixture = await lockFixture()
    const order: string[] = []
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
    const first = fixture.lock.run(new AbortController().signal, async () => {
      order.push('first-enter')
      await firstGate
      order.push('first-leave')
    })
    await expect.poll(() => order).toContain('first-enter')
    const second = fixture.lock.run(new AbortController().signal, async () => { order.push('second-enter') })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(order).toEqual(['first-enter'])
    releaseFirst?.()
    await Promise.all([first, second])

    expect(order).toEqual(['first-enter', 'first-leave', 'second-enter'])
    await expect(stat(fixture.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('recovers a stale lock left by a terminated process', async () => {
    const fixture = await lockFixture()
    await writeFile(fixture.path, '')
    const stale = new Date(Date.now() - 3 * 60_000)
    await utimes(fixture.path, stale, stale)

    await expect(fixture.lock.run(new AbortController().signal, async () => 'recovered')).resolves.toBe('recovered')
    await expect(stat(fixture.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never removes a replacement owner after its own stale inode is superseded', async () => {
    const fixture = await lockFixture()
    let releaseFirst: (() => void) | undefined
    let releaseSecond: (() => void) | undefined
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
    const secondGate = new Promise<void>(resolve => { releaseSecond = resolve })
    const first = fixture.lock.run(new AbortController().signal, async () => { await firstGate })
    await expect.poll(async () => await stat(fixture.path).then(() => true, () => false)).toBe(true)
    const stale = new Date(Date.now() - 3 * 60_000)
    await utimes(fixture.path, stale, stale)
    let secondEntered = false
    const second = fixture.lock.run(new AbortController().signal, async () => {
      secondEntered = true
      await secondGate
    })
    await expect.poll(() => secondEntered).toBe(true)

    releaseFirst?.()
    await first
    await expect(stat(fixture.path)).resolves.toBeDefined()
    releaseSecond?.()
    await second
    await expect(stat(fixture.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
