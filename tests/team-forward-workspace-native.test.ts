import { createHmac, randomUUID } from 'node:crypto'
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ArkmeService } from '../src/arkme-service.js'
import { ArkmeStateStore } from '../src/state-store.js'
import type { ArkmeServiceConfig } from '../src/services/service.js'
import type { TeamGroupJoinContext, TeamGroupCommandResult, TeamWorkspaceFolder, TeamWorkspacePage } from '../src/team-group-contract.js'
import type { TeamPage, TeamConversation, TeamTimeline } from '../src/team-app-contract.js'
import { SourceForwardAttempt } from '../src/client/source-forward-attempt.js'
import { projectUnifiedForwardTargets, forwardTargetKey } from '../src/client/unified-forward-targets.js'
import { mergeTeamDirectoryRows } from '../src/client/team-conversation-directory.js'
import { mergeTeamWorkspaceRows, teamWorkspaceTarget } from '../src/client/team-workspace-rows.js'

// An explicit disposable stack is required. No real session, Keychain or cloud URL is read.
const fixture = process.env.CODEX_TEAM_WORKSPACE_STACK_FIXTURE ?? ''
it.skipIf(!fixture)('forwards through both real delegated group authorities while preserving silent Team contacts', async () => {
  const endpoints = JSON.parse(await readFile(fixture, 'utf8')) as Record<'team' | 'chat' | 'record', string>
  for (const name of ['team', 'chat', 'record'] as const) {
    const url = new URL(endpoints[name]); expect(url.protocol).toBe('http:'); expect(url.hostname).toBe('127.0.0.1'); expect(url.port).not.toBe('')
  }
  const token = (id: number) => {
    const parts = [{ alg: 'HS256', typ: 'JWT' }, { user_id: id, client_id: 1, iss: 'jotmo', exp: Math.floor(Date.now() / 1000) + 3600 }].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')
    return `${parts}.${createHmac('sha256', 'team-interaction-isolated-stack').update(parts).digest('base64url')}`
  }
  let actor = 4
  const post = async (owner: 'team' | 'chat' | 'record', path: string, body: unknown, id = actor) => {
    const response = await fetch(endpoints[owner] + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(id)}` }, body: JSON.stringify(body) })
    const result = await response.json() as { code?: number; data?: any }
    expect(response.status).toBe(200); if (!path.startsWith('/fixture/')) expect([0, 200]).toContain(result.code)
    return result.data ?? result
  }
  const directory = await mkdtemp(join(tmpdir(), 'arkme-forward-workspace-'))
  const external = 'http://127.0.0.1:9', config = { environment: 'test', routePath: '/arkme-self/api', requestTimeoutMs: 10000, maxTextLength: 20000,
    interwovenMomentsEnabled: false, shareWebsite: external, authBaseUrl: external, subjectBaseUrl: external,
    teamBaseUrl: endpoints.team, chatBaseUrl: endpoints.chat, recordBaseUrl: endpoints.record,
    botBaseUrl: external, imBaseUrl: external, webrtcBaseUrl: external, worldBaseUrl: external, relationBaseUrl: external, intelligentBaseUrl: external, audioBaseUrl: external } as ArkmeServiceConfig
  const calls: { owner: string; path: string; scoped: boolean }[] = []
  const service = new ArkmeService(config, { async read() { return { userId: actor, accessToken: token(actor), refreshToken: 'synthetic-unused' } }, async write() {}, async delete() {} }, new ArkmeStateStore(directory), async (input, init) => {
    const url = new URL(String(input)), owner = (Object.keys(endpoints) as Array<keyof typeof endpoints>).find(name => new URL(endpoints[name]).origin === url.origin)
    if (owner) { calls.push({ owner, path: url.pathname, scoped: new Headers(init?.headers).has('x-chat-access-ref') }); return fetch(input, init) }
    expect(url.origin).toBe(external)
    // Explicit external account/profile boundary; all content, authorization and group state use real owners.
    return new Response(JSON.stringify({ code: 200, data: url.pathname.endsWith('/get-user-info') ? { user_id: actor, nick_name: `合成用户${actor}`, jotmo_id: `fixture_${actor}`, phone: '13800000000' } : { items: [], users: [], has_more: false } }), { headers: { 'Content-Type': 'application/json' } })
  })
  const until = async <T,>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> => {
    for (let i = 0; i < 80; i++) { const value = await read(); if (accept(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)) }
    throw new Error('isolated owner did not converge')
  }
  try {
    const personal = (await service.listSources('root', { limit: 100 })).items.find(s => s.kind === 'group_chat' && s.displayName === '隔离转发目标')!
    expect(personal).toBeTruthy()
    const context = await service.executeTeamApp('team.app.group.join-context', { sourceRef: personal.sourceRef }) as TeamGroupJoinContext
    expect(context.state).toBe('ready')
    for (const jotmoId of ['stack_team_7', 'stack_team_8']) {
      const selected = context.teams.find(t => t.jotmoId === jotmoId)!
      expect(selected).toBeTruthy()
      const joined = await service.executeTeamApp('team.app.group.command', { sourceRef: personal.sourceRef, teamRef: selected.teamRef, action: 'join', requestUid: randomUUID(), expectedRevision: selected.revision }) as TeamGroupCommandResult
      expect(joined.state).toBe('joined')
    }
    const silent = await post('team', '/api/v1/team/conversations/open-by-member', { team_id: 7, external_user_id: '63000001' })
    expect(silent.conversation.last_seq).toBe(0); expect(silent.conversation.member_initiated).toBe(true)
    const folders = await until(() => service.executeTeamApp('team.app.workspace.folders', {}) as Promise<TeamWorkspaceFolder[]>, rows => rows.filter(row => row.groupCount > 0).length === 2)
    const conversations = await service.executeTeamApp('team.app.conversations', { side: 'team', limit: 100 }) as TeamPage<TeamConversation>
    const sidebar = mergeTeamDirectoryRows([], conversations.items, true, {}, folders)
    const forward = projectUnifiedForwardTargets([], conversations.items, {}, true, folders)
    expect(forward.map(row => row.kind === 'folder' ? row.group.key : row.target.kind)).toEqual(sidebar.map(row => row.kind === 'team-folder' ? row.group.key : row.kind))
    const workspaces = await Promise.all(folders.map(folder => service.executeTeamApp('team.app.workspace', { teamRef: folder.channel.teamRef }) as Promise<TeamWorkspacePage>))
    expect(workspaces.every(page => page.complete && !page.resetRequired)).toBe(true)
    const a = workspaces[folders.findIndex(folder => folder.channel.jotmoId === 'stack_team_7')]!, b = workspaces[folders.findIndex(folder => folder.channel.jotmoId === 'stack_team_8')]!
    expect(a.items.some(row => row.kind === 'customer' && row.conversation.lastSeq === 0 && row.conversation.memberInitiated)).toBe(true)
    const groupA = a.items.find(row => row.kind === 'group')!, groupB = b.items.find(row => row.kind === 'group')!
    if (groupA.kind !== 'group' || groupB.kind !== 'group') throw new Error('missing delegated groups')
    expect(groupA.source.accessKind).toBe('team_delegation'); expect(groupA.source.canonicalChatSourceKey).toBe(groupB.source.canonicalChatSourceKey)
    expect(forwardTargetKey({ kind: 'source', source: groupA.source })).not.toBe(forwardTargetKey({ kind: 'source', source: groupB.source }))
    const merged = mergeTeamWorkspaceRows({ channel: folders.find(row => row.channel.jotmoId === 'stack_team_7')!.channel, rows: a.items, conversations: conversations.items, opened: [], hasPage: true, preferences: {}, canPresent: () => true })
    expect(merged.map(row => teamWorkspaceTarget(row).kind)).toContain('group')
    const recordUid = randomUUID(), relationUid = randomUUID(), text = `isolated unified forward ${randomUUID()}`
    await service.sendSourceText(personal.sourceRef, text, { recordUid, relationUid })
    await post('record', '/fixture/complete', {}); await post('chat', '/fixture/audit-pass', { rel_uid: relationUid, version: 1 })
    const timeline = await until(() => service.readSource(personal.sourceRef, { limit: 100 }), page => page.items.some(row => row.itemUid === recordUid && !!row.messageActionRef))
    const item = timeline.items.find(row => row.itemUid === recordUid)!
    const attempt = new SourceForwardAttempt(personal.sourceRef, [item.messageActionRef!], actor, command => service.forwardSourceMessages(command.sourceRef, command.actionRefs, command))
    for (const [row, jotmoId] of [[groupA, 'stack_team_7'], [groupB, 'stack_team_8']] as const) {
      const result = await attempt.send({ kind: 'source', source: row.source }, '', new AbortController().signal)
      expect(result.localState).toBe('synced'); expect(result.representation?.jotmoId).toBe(jotmoId)
    }
    const published = conversations.items.find(row => row.lastSeq > 0)!
    expect(published).toBeTruthy()
    const teamTimeline = await service.executeTeamApp('team.app.timeline', { conversationRef: published.ref, limit: 50 }) as TeamTimeline
    const teamMessage = teamTimeline.messages.find(row => row.contentStatus === 'available')!
    expect(teamMessage).toBeTruthy()
    // Ordinary personal snapshots use quick_records, and timeline responses
    // intentionally omit full items. Exercise that contract through real owners.
    const self = await service.selfTarget(), personalUids = [randomUUID(), randomUUID()]
    const personalTexts = personalUids.map((_, index) => `frozen personal ${index} ${randomUUID()}`)
    for (let index = 0; index < personalUids.length; index++) await service.sendSourceText(self.sourceRef, personalTexts[index]!, { recordUid: personalUids[index] })
    await post('record', '/fixture/complete', {})
    const personalPage = await until(() => service.readSource(self.sourceRef, { limit: 100 }), page => personalUids.every(uid => page.items.some(row => row.itemUid === uid && !!row.messageActionRef)))
    const actions = personalUids.map(uid => personalPage.items.find(row => row.itemUid === uid)!.messageActionRef!)
    for (const size of [1, 2]) {
      const options = { targetConversationRef: published.ref, expectedUserId: actor, recordUid: randomUUID(), sendAtMillis: Date.now() }
      const accepted = await service.forwardSourceMessages(self.sourceRef, actions.slice(0, size), options)
      const repeated = await service.forwardSourceMessages(self.sourceRef, actions.slice(0, size), options)
      expect(repeated.itemUid).toBe(accepted.itemUid); expect(repeated.sequence).toBe(accepted.sequence)
      const page = await service.executeTeamApp('team.app.timeline', { conversationRef: published.ref, limit: 100 }) as TeamTimeline
      const card = page.messages.find(row => row.seq === accepted.sequence)!
      expect(card.forwardRecords?.items).toEqual([])
      expect(card.forwardRecords?.summaryLines).toHaveLength(size)
      expect(card.forwardRecords?.summaryLines.join('\n')).toContain(personalTexts[0])
      const full = await service.preflightTeamMessages(published.ref, [{ messageRef: card.ref, version: card.version }])
      expect(full[0]?.forwardRecords?.items.map(item => item.textContent)).toEqual(personalTexts.slice(0, size))
      expect(full[0]?.forwardRecords?.items.every(item => item.senderUserId === undefined)).toBe(true)
    }
    for (const target of [groupA, groupB]) {
      const sent = await service.forwardTeamMessages({ conversationRef: published.ref, selections: [{ messageRef: teamMessage.ref, version: teamMessage.version }], target: { kind: 'source', sourceRef: target.source.sourceRef }, requestId: randomUUID(), recordUid: randomUUID(), sendAtMillis: Date.now() })
      expect(sent.localState).toBe('synced')
    }
    const forwarded = calls.filter(call => call.path.endsWith('/records/forward'))
    expect(forwarded).toHaveLength(4); expect(forwarded.every(call => call.scoped)).toBe(true)
    actor = 13
    await expect(service.readSource(groupA.source.sourceRef, { limit: 10 })).rejects.toBeTruthy()
    const colleagueFolders = await service.executeTeamApp('team.app.workspace.folders', {}) as TeamWorkspaceFolder[]
    expect(colleagueFolders.some(row => row.channel.jotmoId === 'stack_team_8')).toBe(false)
    const current = await service.executeTeamApp('team.app.workspace', { teamRef: colleagueFolders.find(row => row.channel.jotmoId === 'stack_team_7')!.channel.teamRef }) as TeamWorkspacePage
    expect(current.items.some(row => row.kind === 'group')).toBe(true)
    if (process.env.CODEX_TEAM_WORKSPACE_REPORT) await writeFile(process.env.CODEX_TEAM_WORKSPACE_REPORT, JSON.stringify({ passed: true, syntheticAccounts: true, realOwners: ['Team', 'Chat', 'Record'], groupOnlyFolder: true, silentMemberContact: true, separateDelegatedIdentities: true, actualForwardToBothTeams: true, crossAccountDenied: true, requestCounts: calls.reduce<Record<string, number>>((out, call) => { out[call.owner] = (out[call.owner] ?? 0) + 1; return out }, {}) }, null, 2))
  } finally { service.dispose(); await rm(directory, { recursive: true, force: true }) }
}, 120000)
