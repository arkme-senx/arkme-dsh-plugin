import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isDeepSeekHarnessPage, qq2006HarnessCommand, qq2006HarnessHealthUrl, qq2006HarnessPageUrl,
} from '../src/qq2006-harness-runtime.js'

describe('QQ2006 Harness source runtime', () => {
  it('launches the built source checkout on a loopback-only port', () => {
    const sourceRoot = join('test fixtures', 'QQ2006 Harness source')
    const command = qq2006HarnessCommand({
      sourceRoot,
      runtimeHome: join('test fixtures', 'QQ2006 runtime'),
      dshHome: join('test fixtures', 'DSH home'),
      nodeCommand: 'node',
      port: 3186,
    })

    expect(command.command).toBe('node')
    expect(command.cwd).toBe(sourceRoot)
    expect(command.args.at(0)).toMatch(/apps[\\/]cli[\\/]lib[\\/]bin\.js$/)
    expect(command.args.slice(1)).toEqual(['web', '--host', '127.0.0.1', '--port', '3186'])
  })

  it('uses the forced source-level QQ2006 embed URL', () => {
    expect(qq2006HarnessHealthUrl(3186)).toBe('http://127.0.0.1:3186/')
    expect(qq2006HarnessPageUrl(3186)).toBe(
      'http://127.0.0.1:3186/?arkme-harness-embed=1&arkme-qq2006=1',
    )
  })

  it('only accepts the expected DeepSeek Harness page as a healthy runtime', () => {
    expect(isDeepSeekHarnessPage('<title>DeepSeek Harness</title><div id="root"></div>')).toBe(true)
    expect(isDeepSeekHarnessPage('<title>Another local service</title>')).toBe(false)
  })
})
