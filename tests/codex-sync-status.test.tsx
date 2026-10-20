import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import type { TeamCodexTask } from '../src/team-codex-contract.js'
import { CodexSyncStatus, codexCollectorUnavailable, codexSyncLabel } from '../src/client/redesign/contacts/CodexSyncStatus.js'
it('distinguishes a verified outage from unknown remote state and an idle online source',()=>{
  const remote={updatedAt:Date.UTC(2026,9,12),cloud:{remote:true}} as TeamCodexTask
  expect(codexSyncLabel(remote)).toBe('同步状态待核实')
  expect(codexCollectorUnavailable(remote)).toBe(true)
  expect(renderToStaticMarkup(<CodexSyncStatus task={remote}/>)).toContain('最后收到')
  const offline={...remote,captureHealth:{status:'offline' as const,checkedAt:Date.now(),lastReceivedAt:remote.updatedAt}}
  expect(codexSyncLabel(offline)).toBe('同步已中断')
  expect(renderToStaticMarkup(<CodexSyncStatus task={offline}/>)).toContain('查看原因')
  const idle={...offline,captureHealth:{...offline.captureHealth,status:'online' as const}}
  expect(codexCollectorUnavailable(idle)).toBe(false)
  expect(codexSyncLabel(idle)).toBe('采集端在线')
})
