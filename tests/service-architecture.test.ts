import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

const expectedPublicMethods = [
  'startChatRealtime', 'chatRealtimeState', 'subscribeChatRealtime', 'chatRealtimeInitialEvent',
  'attachOpenClawProvisioner', 'connectOpenClawBot', 'listBots', 'createBot', 'createBotSummary', 'revealBotSecret',
  'openBotChat', 'listGroupBots', 'addGroupBot', 'removeGroupBot', 'authStatus', 'clientConfig',
  'providerCapabilities', 'providerState', 'requestOutgoingCall', 'claimOutgoingCallIntent',
  'resolveOutgoingCallIntent', 'prepareOutgoingCall', 'heartbeatOutgoingCall', 'releaseOutgoingCall',
  'dispose', 'requestStats', 'cachedProfile', 'extensionAuthors', 'listExtensionReviews',
  'searchContact', 'addContact',
  'createExtensionReview', 'recordingCalendar', 'recordingTranscript', 'recordingProjection',
  'sealRecordingCursor', 'openRecordingCursor', 'startRecordingDoubaoBackfill', 'recordingDay',
  'refreshProfile', 'arkoProfile',
  'arkoEnsureSession', 'arkoCreateSession', 'arkoModelCatalog', 'arkoActivateModel', 'arkoHistoryPage',
  'arkoAsk', 'arkoRunStatus', 'arkoCancel', 'aiVideoPreflight', 'aiVideoCreate', 'aiVideoStatus',
  'aiVideoList', 'queryFileAssets', 'textAiVideoPreflight', 'textAiVideoCreate',
  'checkArkmeIdAvailability', 'setArkmeIdOnce', 'createTopic', 'listSources',
  'dshBetaCommunityEntryState', 'interwovenMoments', 'interwovenMomentDetail',
  'joinDSHBetaCommunity', 'inspectGroupAiPolish', 'inspectGroupAiPolishByName',
  'readGroupAiPolishNotices', 'generateGroupAiPolishRuleForSource', 'generateGroupAiPolishRule',
  'confirmEnableGroupAiPolish', 'prepareDisableGroupAiPolishForSource', 'prepareDisableGroupAiPolish',
  'confirmDisableGroupAiPolish', 'listGroupMembers', 'listGroupMemberCandidates', 'groupInvitePreview', 'addGroupMembers',
  'createGroup', 'groupSettings', 'setGroupMessageDnd',
  'renameGroup', 'leaveGroup', 'dissolveGroup', 'reportGroup', 'userCard',
  'openPrivateChatFromUser', 'readSource', 'relatedRecordingEligibility', 'relatedRecordings',
  'recordRelatedRecordingsToolEvent', 'reportMessage', 'sendSourceText', 'retryGroupAiPolish',
  'sendSourceRich', 'longArticleDetail', 'updateLongArticle', 'getLongArticleDraft',
  'putLongArticleDraft', 'removeLongArticleDraft', 'uploadLocalFile', 'fetchMedia', 'sendDirectText',
  'markSourceRead', 'listWechatConversations', 'readWechatMessages', 'getWechatConversationDetail',
  'listWechatGroupMembers', 'listWechatPhones', 'listWechatCommonGroups', 'listWechatMoneyFlows',
  'listWechatLocations', 'readImage', 'beginWechatLogin', 'pollWechatLogin', 'testLogin',
  'sendPhoneCode', 'verifyPhoneCode', 'logout', 'cachedSnapshot', 'queryCached', 'refreshLatest',
  'refreshSnapshot', 'searchRecords', 'searchRemote', 'searchHistory', 'createSearchHistory', 'searchImages',
  'searchScene', 'searchRecordings', 'syncHistory', 'summary', 'list', 'calendarBuckets', 'calendarRecords',
  'listWorldRecords',
  'listArrangements', 'arrangementDetail', 'listArrangementReminders', 'arrangementReminderSummary',
  'mutateArrangement', 'setArrangementReminderEnabled', 'markArrangementRemindersRead',
  'markAllArrangementRemindersRead', 'clearArrangementReminders', 'listWorldFeed', 'listMyWorldFeed',
  'worldVoiceprintPlaybackAvailability', 'generateWorldVoiceprintPlayback', 'inviteWorldVoiceprint',
  'listWorldInteractions', 'createWorldTextInteraction', 'readWorldImage',
  'publishWorldTextForConversation', 'createText', 'createTextForConversation', 'pendingWrites',
  'retryPending', 'extensionPost',
].sort()

const expectedServiceFiles = [
  'service.ts', 'auth-service.ts', 'profile-service.ts', 'bot-service.ts', 'source-service.ts',
  'chat-service.ts', 'chat-realtime-service.ts', 'group-service.ts', 'group-ai-polish-service.ts',
  'record-service.ts', 'related-recording-service.ts', 'recording-service.ts', 'search-service.ts',
  'media-service.ts', 'world-service.ts', 'arrangement-service.ts', 'wechat-service.ts',
  'arko-service.ts', 'ai-video-service.ts', 'outgoing-call-service.ts', 'interwoven-service.ts',
  'community-service.ts', 'extension-review-service.ts', 'calendar-service.ts',
  'contact-service.ts',
].sort()

function publicMethodNames(path: string): string[] {
  const source = readFileSync(path, 'utf8')
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const service = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'ArkmeService')
  if (service === undefined || !ts.isClassDeclaration(service)) throw new Error('ArkmeService class not found')
  return service.members
    .filter((member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member))
    .filter(member => !member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword))
    .map(member => member.name.getText(file))
    .sort()
}

describe('Arkme service architecture', () => {
  it('preserves the public facade method contract', () => {
    expect(publicMethodNames(join(root, 'src/arkme-service.ts'))).toEqual(expectedPublicMethods)
  })

  it('has a services runtime root', () => {
    expect(existsSync(join(root, 'src/services/service.ts'))).toBe(true)
  })

  it('keeps every planned product domain in its own service file', () => {
    expect(readdirSync(join(root, 'src/services')).filter(name => name.endsWith('.ts')).sort())
      .toEqual(expectedServiceFiles)
  })

  it('keeps the compatibility facade free of business transport and state owners', () => {
    const facade = readFileSync(join(root, 'src/arkme-service.ts'), 'utf8')
    expect(facade.split('\n').length).toBeLessThan(1_500)
    expect(facade).not.toMatch(/\/api\//)
    expect(facade).not.toMatch(/private readonly \w+\s*=\s*new Map/)
  })

  it('prevents domain services from importing the facade', () => {
    const directory = join(root, 'src/services')
    if (!existsSync(directory)) return
    for (const file of readdirSync(directory).filter(name => name.endsWith('-service.ts'))) {
      expect(readFileSync(join(directory, file), 'utf8')).not.toMatch(/from ['"]\.\.\/arkme-service/)
    }
  })
})
