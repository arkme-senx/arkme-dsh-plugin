import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopHarnessReadinessCommit, notifyDesktopHarnessReady } from '../src/client/desktop-harness-readiness.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('desktop harness readiness', () => {
  it('notifies the preload bridge only once without sending renderer data', () => {
    const notifyHarnessReady = vi.fn()
    vi.stubGlobal('window', { arkmeDesktop: { notifyHarnessReady } })

    expect(notifyDesktopHarnessReady()).toBe(true)
    expect(notifyDesktopHarnessReady()).toBe(true)

    expect(notifyHarnessReady).toHaveBeenCalledOnce()
    expect(notifyHarnessReady).toHaveBeenCalledWith()
  })

  it('stays available when the preload bridge is not installed yet', () => {
    vi.stubGlobal('window', {})
    expect(notifyDesktopHarnessReady()).toBe(false)

    const notifyHarnessReady = vi.fn()
    Object.assign(window, { arkmeDesktop: { notifyHarnessReady } })

    expect(notifyDesktopHarnessReady()).toBe(true)
    expect(notifyHarnessReady).toHaveBeenCalledOnce()
  })

  it('notifies only after the readiness surface commits', () => {
    const notifyHarnessReady = vi.fn()
    vi.stubGlobal('window', { arkmeDesktop: { notifyHarnessReady } })

    expect(notifyHarnessReady).not.toHaveBeenCalled()
    act(() => { create(createElement(DesktopHarnessReadinessCommit)) })

    expect(notifyHarnessReady).toHaveBeenCalledOnce()
  })
})
