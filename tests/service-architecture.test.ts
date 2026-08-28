import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

const expectedPublicMethods = [
  'fileCapabilities', 'fileSearch', 'fileSessionUser', 'fileStage', 'fileList', 'fileReadLocal', 'attachLocalFileOpener', 'fileOpenLocal', 'fileRemove', 'fileSend',
  'fileSendTasks', 'fileSendRetry', 'fileStageBytes', 'fileSendDiscard', 'fileSendReconcile', 'fileReceive',
  'startChatRealtime', 'chatRealtimeState', 'subscribeChatRealtime', 'chatRealtimeInitialEvent',
  'attachOpenClawProvisioner', 'connectOpenClawBot', 'listBots', 'createBot', 'createBotSummary', 'revealBotSecret',
  'manageBotProfile', 'updateManagedBot', 'revealManagedBotToken', 'deleteManagedBot', 'botNotificationPreference', 'updateBotNotificationPreference',
  'openBotChat', 'listBotPrivateChatDirectory', 'openBotPrivateChat', 'refreshBotPrivateChat', 'sendBotPrivateChatMessage', 'markBotPrivateChatRead', 'listGroupBots', 'addGroupBot', 'removeGroupBot', 'authStatus', 'clientConfig',
  'billingQuota', 'billingProducts', 'createBillingOrder', 'billingOrderStatus',
  'providerCapabilities', 'providerState', 'requestOutgoingCall', 'claimOutgoingCallIntent',
  'resolveOutgoingCallIntent', 'prepareOutgoingCall', 'heartbeatOutgoingCall', 'releaseOutgoingCall',
  'listCallHistory', 'callDetail', 'retryCallSummary',
  'dispose', 'requestStats', 'resolveManagedAccessCredential', 'cachedProfile', 'extensionAuthors', 'listExtensionReviews',
  'resolveLinkMetadata',
  'searchContact', 'addContact',
  'listDirectory', 'directoryContactProfile', 'directoryContactWorld', 'openDirectoryContactChat', 'openDirectoryGroupChat',
  'unmarkedSpeakerOptions', 'retryUnmarkedSpeakerInference', 'unmarkedSpeakerSegments', 'markUnmarkedSpeaker',
  'createExtensionReview', 'recordingCalendar', 'recordingTranscript', 'recordingProjection',
  'sealRecordingCursor', 'openRecordingCursor', 'recordingDay', 'recordingPlayback',
  'recordingSpeakerOptions', 'assignRecordingSpeaker',
  'acceptRecordingImport', 'recordingImportStatus', 'recordingImportList', 'retryRecordingImport',
  'cancelRecordingImport', 'resumeRecordingImports', 'refreshProfile', 'arkoProfile',
  'arkoEnsureSession', 'arkoCreateSession', 'arkoModelCatalog', 'arkoActivateModel', 'arkoHistoryPage',
  'arkoAsk', 'arkoRunStatus', 'arkoCancel', 'aiVideoPreflight', 'aiVideoCreate', 'aiVideoStatus',
  'aiVideoList', 'queryFileAssets', 'textAiVideoPreflight', 'textAiVideoCreate',
  'checkArkmeIdAvailability', 'setArkmeIdOnce', 'createTopic', 'renameTopic', 'dissolveTopic', 'topicDissolveStatus', 'activeTopicDissolve', 'moveTopicHierarchy', 'listSources', 'setChatDirectoryPolicy', 'listSourceMembers', 'sourceMemberRecords',
  'dshBetaCommunityEntryState', 'dshRemoteGet', 'dshRemotePost', 'interwovenMoments', 'interwovenMomentDetail',
  'relatedQuickNotesFromMessage', 'relatedQuickNotesFromMoment', 'relatedQuickNoteDetail',
  'joinDSHBetaCommunity', 'inspectGroupAiPolish', 'inspectGroupAiPolishByName',
  'readGroupAiPolishNotices', 'generateGroupAiPolishRuleForSource', 'generateGroupAiPolishRule',
  'prepareEnableGroupAiPolish', 'prepareEnableGroupAiPolishRuleForSource', 'confirmEnableGroupAiPolish', 'prepareDisableGroupAiPolishForSource', 'prepareDisableGroupAiPolish',
  'confirmDisableGroupAiPolish', 'listGroupMembers', 'listGroupMemberCandidates', 'groupInvitePreview', 'addGroupMembers',
  'createGroup', 'groupSettings', 'setGroupMessageDnd',
  'renameGroup', 'leaveGroup', 'dissolveGroup', 'reportGroup', 'userCard',
  'openPrivateChatFromUser', 'openPrivateChatFromContact', 'officialAuthorProfile', 'openOfficialAuthorPrivateChat', 'openPrivateChatFromWorldAuthor', 'openPrivateChatFromMember', 'readSource', 'messageReadReceiptSummaries', 'messageReadReceiptDetail', 'messageSnapshotDetail', 'saveMessageLocation', 'sharedRecordingDetail', 'relatedRecordingEligibility', 'relatedRecordings',
  'recordRelatedRecordingsToolEvent', 'reportMessage', 'copySourceMessageLink', 'resolveMessageCopyLink', 'extendMessageCopyLink', 'forwardSourceMessages',
  'sendSourceText', 'retryGroupAiPolish',
  'sendSourceRich', 'favoriteStickers', 'addFavoriteSticker', 'manageFavoriteSticker', 'sendFavoriteSticker', 'longArticleDetail', 'updateLongArticle', 'getLongArticleDraft',
  'putLongArticleDraft', 'removeLongArticleDraft', 'uploadLocalFile', 'fetchMedia', 'sendDirectText',
  'markSourceRead', 'listWechatConversations', 'readWechatMessages', 'getWechatConversationDetail',
  'listWechatGroupMembers', 'listWechatPhones', 'listWechatCommonGroups', 'listWechatMoneyFlows',
  'listWechatLocations', 'readImage', 'beginJiwoLogin', 'pollJiwoLogin', 'cancelJiwoLogin',
  'beginWechatLogin', 'pollWechatLogin', 'testLogin',
  'sendPhoneCode', 'verifyPhoneCode', 'logout', 'cachedSnapshot', 'queryCached', 'refreshLatest',
  'refreshSnapshot', 'searchRecords', 'searchRemote', 'searchHistory', 'createSearchHistory', 'searchImages',
  'searchScene', 'searchRecordings', 'syncHistory', 'summary', 'list', 'calendarBuckets', 'calendarRecords',
  'listWorldRecords',
  'listArrangements', 'arrangementDetail', 'listArrangementReminders', 'arrangementReminderSummary',
  'mutateArrangement', 'setArrangementReminderEnabled', 'markArrangementRemindersRead',
  'markAllArrangementRemindersRead', 'clearArrangementReminders', 'listWorldFeed', 'listMyWorldFeed', 'listUserWorldFeed',
  'worldAuthorLabels',
  'worldVoiceprintPlaybackAvailability', 'generateWorldVoiceprintPlayback', 'worldVoiceprintSocialContext', 'inviteWorldVoiceprint',
  'myVoiceprint', 'outboundVoiceprintGrants', 'recognizedVoiceprintPeople', 'recognizedVoiceprintPerson',
  'recognizedPersonVoiceprints', 'createVoiceprintInvitation', 'revokeVoiceprintPlaybackGrant', 'restoreVoiceprintPlayback',
  'createRecognizedPersonVoiceprintInvitation', 'bindVoiceprintEnrollment',
  'listWorldInteractions', 'createWorldTextInteraction', 'readWorldImage',
  'publishWorldText', 'publishWorldFileAssets', 'publishWorldTextForConversation',
  'createText', 'createTextForConversation', 'createDSHAgentInputText', 'pendingWrites',
  'retryPending', 'extensionPost',
].sort()

const expectedServiceFiles = [
  'file-transfers.ts',
  'service.ts', 'auth-service.ts', 'profile-service.ts', 'bot-service.ts', 'bot-conversation-service.ts', 'source-service.ts',
  'chat-service.ts', 'chat-realtime-service.ts', 'group-service.ts', 'group-ai-polish-service.ts',
  'record-service.ts', 'related-quick-note-service.ts', 'related-recording-service.ts', 'recording-service.ts',
  'recording-import-gateway.ts', 'search-service.ts',
  'media-service.ts', 'world-service.ts', 'arrangement-service.ts', 'wechat-service.ts',
  'arko-service.ts', 'ai-video-service.ts', 'outgoing-call-service.ts', 'interwoven-service.ts',
  'community-service.ts', 'extension-review-service.ts', 'calendar-service.ts',
  'contact-service.ts', 'contact-directory-service.ts', 'unmarked-speaker-service.ts',
  'voiceprint-service.ts', 'call-history-service.ts', 'privacy-visibility.ts',
  'link-metadata-service.ts',
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
    expect(facade.split('\n').length).toBeLessThan(1_800)
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

  it('keeps direct-conversation and group Bot projections behind separate mappers', () => {
    const botService = readFileSync(join(root, 'src/services/bot-service.ts'), 'utf8')
    const arkmeService = readFileSync(join(root, 'src/arkme-service.ts'), 'utf8')
    expect(botService).toContain('groupBotSummaryFromData')
    expect(arkmeService).not.toContain('BOT_CONVERSATION_OWNER')
  })

  it('keeps owner-specific Bot conversation transport behind a narrow adapter interface', () => {
    const conversation = readFileSync(join(root, 'src/services/bot-conversation-service.ts'), 'utf8')
    const facade = readFileSync(join(root, 'src/arkme-service.ts'), 'utf8')
    expect(conversation).toContain('interface BotConversationOwnerAdapter')
    expect(conversation).toContain('interface BotConversationRegistryPort')
    expect(conversation).toContain('interface ChatBotConversationPort')
    expect(conversation).toContain('class SubjectBotConversationAdapter implements BotConversationOwnerAdapter')
    expect(conversation).toContain('class ChatBotConversationAdapter implements BotConversationOwnerAdapter')
    expect(facade).not.toMatch(/\/api\/v1\/(bot\/private-chat|chat\/timeline)/)
  })

  it('keeps World cross-domain dependencies behind narrow ports', () => {
    const world = readFileSync(join(root, 'src/services/world-service.ts'), 'utf8')
    expect(world).toContain('export interface ArkmeWorldProfileReader')
    expect(world).toContain('export interface ArkmeWorldMediaReader')
    expect(world).toContain('export interface ArkmeWorldRecordWriter')
    expect(world).not.toMatch(/import \{[^}]*\bMediaService\b/)
    expect(world).not.toMatch(/import \{[^}]*\bRecordService\b/)
  })

  it('keeps Voiceprint profile enrichment behind a narrow port', () => {
    const voiceprint = readFileSync(join(root, 'src/services/voiceprint-service.ts'), 'utf8')
    expect(voiceprint).toContain('export interface ArkmeVoiceprintProfileReader')
    expect(voiceprint).toContain('export interface ArkmeVoiceprintInviteTargetResolver')
    expect(voiceprint).not.toMatch(/import \{[^}]*\bProfileService\b/)
    expect(voiceprint).not.toMatch(/import \{[^}]*\bContactService\b/)
  })

  it('keeps Voiceprint browser upload transport behind its narrow client port', () => {
    const surface = readFileSync(join(root, 'src/client/ArkmeVoiceprintSurface.tsx'), 'utf8')
    const enrollmentClient = readFileSync(join(root, 'src/client/voiceprint-enrollment-client.ts'), 'utf8')
    expect(surface).not.toMatch(/\bfetch\s*\(/)
    expect(enrollmentClient).toContain('export interface ArkmeVoiceprintEnrollmentClient')
    expect(enrollmentClient).toContain('class SameOriginArkmeVoiceprintEnrollmentClient')
  })

  it('keeps the default-off DSH remote feature ahead of platform secret-store construction', () => {
    const source = readFileSync(join(root, 'src/index.ts'), 'utf8')
    const guard = source.indexOf('if (!config.dshRemoteFeatureEnabled) return')
    const secretStore = source.indexOf('createArkmeSecureValueStore(', guard)
    expect(guard).toBeGreaterThanOrEqual(0)
    expect(secretStore).toBeGreaterThan(guard)
  })

  it('keeps link recognition separate from asynchronous metadata resolution', () => {
    const parser = readFileSync(join(root, 'src/client/text-link-parser.ts'), 'utf8')
    const presentation = readFileSync(join(root, 'src/client/ArkmeLinkText.tsx'), 'utf8')
    const client = readFileSync(join(root, 'src/client/link-metadata-client.ts'), 'utf8')
    expect(parser).not.toMatch(/\bfetch\s*\(|callArkme|useEffect|useState/)
    expect(presentation).not.toMatch(/\bfetch\s*\(|callArkme/)
    expect(client).toContain('export interface ArkmeLinkMetadataResolver')
    expect(client).not.toMatch(/from ['"]\.\.\/services\//)
  })

  it('reuses request admission infrastructure without a second Host cache or queue', () => {
    const service = readFileSync(join(root, 'src/services/link-metadata-service.ts'), 'utf8')
    expect(service).toContain('ArkmeRequestCoordinator')
    expect(service).not.toMatch(/private readonly (?:cache|inFlight|queuedLoads)\b/)
    expect(service).not.toMatch(/private activeLoads\b/)
  })

  it('keeps link metadata out of chat business while preserving one infrastructure owner', () => {
    const facade = readFileSync(join(root, 'src/arkme-service.ts'), 'utf8')
    const chat = readFileSync(join(root, 'src/services/chat-service.ts'), 'utf8')
    const sdk = readFileSync(join(root, 'src/sdk/index.ts'), 'utf8')
    const host = readFileSync(join(root, 'src/host-api.ts'), 'utf8')
    const types = readFileSync(join(root, 'src/types.ts'), 'utf8')
    const metadata = readFileSync(join(root, 'src/link-metadata.ts'), 'utf8')
    const client = readFileSync(join(root, 'src/client/link-metadata-client.ts'), 'utf8')
    const service = readFileSync(join(root, 'src/services/link-metadata-service.ts'), 'utf8')
    expect(facade.match(/async resolveLinkMetadata\b/gu) ?? []).toHaveLength(1)
    expect(chat).not.toMatch(/resolveLinkMetadata|fetchLinkMetadata|linkMetadataFromHtml/)
    expect(sdk.match(/async resolveLinkMetadata\b/gu) ?? []).toHaveLength(1)
    expect(sdk).toContain('source.link-metadata.resolve')
    expect(sdk).toMatch(/async resolveLinkMetadata\([\s\S]*?\): Promise<ArkmeLinkMetadata> \{/u)
    expect(types).toContain("| 'source.link-metadata.resolve'")
    expect(types).not.toMatch(/export interface ArkmeLinkMetadata\b/)
    expect(types).toContain("export type { ArkmeLinkMetadata } from './link-metadata.js'")
    expect(sdk).toContain("export type { ArkmeLinkMetadata } from '../link-metadata.js'")
    expect(metadata).toContain('export interface ArkmeLinkMetadata')
    expect(metadata).toContain('export function arkmeKnownLinkMetadataFallback')
    expect(metadata).toContain('export function arkmeRequiredLinkMetadataFallback')
    expect(client).toContain('arkmeKnownLinkMetadataFallback')
    expect(service).not.toContain('arkmeRequiredLinkMetadataFallback')
    expect(host).toContain('arkmeRequiredLinkMetadataFallback')
    expect(client).not.toMatch(/Pull Request #|Change #/u)
    expect(service).not.toMatch(/Pull Request #|Change #/u)
    expect(host.match(/service\.resolveLinkMetadata\(/gu) ?? []).toHaveLength(2)
  })
})
