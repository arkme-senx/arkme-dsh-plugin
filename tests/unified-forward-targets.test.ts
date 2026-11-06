import { expect, it } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
import type { TeamConversation } from '../src/team-app-contract.js'
import { projectUnifiedForwardTargets, forwardTeamChildren, forwardTargetName, searchForwardRows } from '../src/client/unified-forward-targets.js'
import { mergeTeamDirectoryRows } from '../src/client/team-conversation-directory.js'
import { teamConversationEntryKey, teamFolderEntryKey } from '../src/client/team-directory-preferences.js'

const source = (name: string, time: number, pinned = false) => ({ source: { sourceRef: name, sourceKey: name,
  kind: 'private_chat', displayName: name, activeAtMillis: time, unreadCount: 0 } as ArkmeSourceItem, pinned, activeAtMillis: time })
const team = (name: string, side: 'team' | 'external', time: number, channel = name): TeamConversation => ({
  key: name, ref: `ref-${name}`, side, updatedAt: time, channel: { name: channel, jotmoId: channel, teamRef: channel, enabled: true }, visitor: { nickname: name },
} as TeamConversation)
it('keeps ordinary and Team targets in the second column order, including Team pins and equal activity', () => {
  const ordinary = [source('pinned-human', 8, true), source('recent-human', 30), source('tie-human', 20)]
  const teams = [team('recent-team', 'external', 40), team('pinned-team', 'external', 5), team('internal', 'team', 20, 'my-team')]
  const preferences = { [teamConversationEntryKey(teams[1]!)]: { pinned: true, dismissed: false } }
  const expected = mergeTeamDirectoryRows(ordinary, teams, true, preferences).map(row => 'source' in row ? row.source.displayName
    : row.kind === 'team' ? row.conversation.channel.name : row.group.channel.name)
  const rows = projectUnifiedForwardTargets(ordinary, teams, preferences, true)
  expect(rows.map(row => row.kind === 'folder' ? row.group.channel.name : forwardTargetName(row.target))).toEqual(expected)
  expect(expected).toEqual(['pinned-human', 'pinned-team', 'recent-team', 'recent-human', 'tie-human', 'my-team'])
})
it('preserves folder navigation, per-conversation pins, hidden entries and search into Team conversations', () => {
  const a = team('visitor-a', 'team', 10, 'support'), b = team('visitor-b', 'team', 20, 'support')
  const external = team('hidden', 'external', 50)
  const preferences = { [teamConversationEntryKey(a)]: { pinned: true, dismissed: false },
    [teamConversationEntryKey(external)]: { pinned: false, dismissed: true } }
  const rows = projectUnifiedForwardTargets([], [a, b, external], preferences, true)
  expect(rows).toHaveLength(1)
  const folder = rows[0]!
  if (folder.kind !== 'folder') throw new Error('missing folder')
  expect(forwardTeamChildren(folder.group, preferences).map(row => row.kind === 'target' && forwardTargetName(row.target))).toEqual(['support · visitor-a', 'support · visitor-b'])
  expect(searchForwardRows(rows, 'visitor-b', preferences)).toMatchObject([{ kind: 'target', target: { kind: 'team', conversation: b } }])
  expect(searchForwardRows(rows, 'support', preferences)).toHaveLength(2)
  expect(projectUnifiedForwardTargets([], [a, b], { [teamFolderEntryKey(a.channel)]: { pinned: false, dismissed: true } }, true)).toEqual([])
})
