import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { browserEntrypoints, verifyBrowserBundle, verifyBrowserEntrypoints } from '../scripts/verify-browser-entrypoints.mjs'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe('browser release artifact dependencies', () => {
  it('accepts registered platform modules and ignores require-shaped text in strings', () => {
    expect(() => verifyBrowserBundle(`
      window.__ModuleLoader__.load({ id: 'example', factory: require => {
        const React = require('react'); const dom = require('react-dom');
        const slots = require('@deepseek-ai/dsh-client-ui-slots');
        return { React, dom, slots, description: 'require("./not-an-import.cjs")' };
      }});
    `, 'harness-model-client.js')).not.toThrow()
  })

  it.each([
    ['require("./api-5DW-ZiYY.cjs")', './api-5DW-ZiYY.cjs'],
    ['Promise.resolve().then(() => require("./social-action-guard.cjs"))', './social-action-guard.cjs'],
    ['require("node:fs")', 'node:fs'],
    ['require("path")', 'path'],
    ['require("unregistered-package")', 'unregistered-package'],
    ['require(name)', 'non-literal require'],
    ['import("./guard.js")', 'unbundled import()'],
    ['import React from "react"', 'unbundled module declaration'],
  ])('rejects unresolved dependency %s before release', (source, failure) => {
    expect(() => verifyBrowserBundle(source, 'harness-model-client.js')).toThrow(failure)
  })

  it('checks every Harness entry even when the main plugin is self-contained', () => {
    const directory = mkdtempSync(join(tmpdir(), 'arkme-browser-entrypoints-'))
    directories.push(directory)
    for (const name of browserEntrypoints) writeFileSync(join(directory, name), 'require("react")')
    writeFileSync(join(directory, 'harness-model-client.js'), 'require("./api-broken.cjs")')
    expect(() => verifyBrowserEntrypoints(directory)).toThrow('harness-model-client.js')
    writeFileSync(join(directory, 'harness-model-client.js'), 'require("react")')
    writeFileSync(join(directory, 'harness-future-client.js'), 'require("./another-chunk.cjs")')
    expect(() => verifyBrowserEntrypoints(directory)).toThrow('harness-future-client.js')
  })

  it('rejects missing entry files instead of treating an incomplete package as valid', () => {
    const directory = mkdtempSync(join(tmpdir(), 'arkme-browser-entrypoints-'))
    directories.push(directory)
    writeFileSync(join(directory, 'client.js'), '')
    expect(() => verifyBrowserEntrypoints(directory)).toThrow('harness-session-client.js')
  })
})
