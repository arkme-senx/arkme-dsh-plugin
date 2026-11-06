import React from 'react'
import { createRoot } from 'react-dom/client'
import { ArkmeRecordEditHistory } from '../../src/client/ArkmeRecordEditHistory.js'
import { arkmeAuthStore } from '../../src/client/auth-store.js'
import type { ArkmeRecordEditHistoryReader } from '../../src/record-edit-history.js'

arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
let failOnce = true
const calls: unknown[] = []
const reader: ArkmeRecordEditHistoryReader = {
  async page(_source, _action, cursorVersion, signal) {
    signal.throwIfAborted(); calls.push({ cursorVersion })
    const revision = cursorVersion === 0 ? { revisionUid: 'edit', version: 2, kind: 'manual' as const,
      senderName: '编辑时昵称', editAtMillis: 1700000000000, content: { title: '', textContent: '新版正文', contentBlocks: [] } }
      : { revisionUid: 'initial', version: 1, kind: 'original' as const, senderName: '创建时昵称', editAtMillis: 1700000000000,
        content: { title: '', textContent: '最初正文', contentBlocks: [] } }
    return { items: [revision], hasMore: cursorVersion === 0, ...(cursorVersion === 0 ? { nextCursorVersion: 2 } : {}) }
  },
  async snapshot(_source, _action, revisionUid, signal) {
    signal.throwIfAborted(); calls.push({ revisionUid })
    if (failOnce) { failOnce = false; throw new Error('该版本暂不可用') }
    return { revisionUid, itemUid: 'record', textContent: revisionUid === 'edit' ? '本次编辑快照' : '创建快照',
      historical: true, backgroundSound: 'not-recorded', durationState: 'complete', editDurationMillis: 0,
      completeAtMillis: 1700000000000, captureContext: { clientName: revisionUid === 'edit' ? '编辑设备' : '创建设备' } }
  },
}
;(window as any).historyCalls = calls
createRoot(document.getElementById('root')!).render(<ArkmeRecordEditHistory sourceRef="source" messageActionRef="action" reader={reader}
  author={{ isMe: true, senderName: '今天的昵称', avatarRef: 'file_asset://today' }} />)
