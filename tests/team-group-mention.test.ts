import {expect,it,vi} from 'vitest'
import {GroupTeamMentionCodec} from '../src/services/group-team-mention.js'
import {ChatService} from '../src/services/chat-service.js'
import {ServiceRuntime,type ArkmeServiceConfig,type StateStore} from '../src/services/service.js'
import {SourceService,type ArkmeSourceRefPayload} from '../src/services/source-service.js'
import {encodeMentionMetadata} from '../src/services/mention-metadata-codec.js'
import {insertArkmeComposerMentionToken,reconcileArkmeComposerMentions} from '../src/client/composer-draft-store.js'
import {arkmeGroupMentionCandidates} from '../src/client/mention-candidates.js'
import {recordReeditMentionProjection,prepareRecordReeditMentions,recordReeditMentionMetadata} from '../src/services/record-reedit-mentions.js'
import {arkmeMentionMetadataMentionsViewer} from '../src/mention-metadata.js'

const actor={userId:90,accessToken:'fake',refreshToken:'fake'}
const source:ArkmeSourceRefPayload={version:1,userId:90,kind:'group_chat',ownerRef:'group',displayName:'客户群',groupDelegation:{accessRef:'host-only-access',teamId:'42',membershipKind:'owner',membershipRevision:0,groupMembershipUid:'source-admission',groupMembershipRevision:1,visibleFromSeq:10}}
const participant={team_id:'9223372036854775806',membership_uid:'mentioned-admission',revision:1,team_name:'支持团队'}
function fixture(environment='test') {
  let rows=[participant]
  const requests:{headers:Headers;body:Record<string,unknown>}[]=[]
  const fetchImpl=vi.fn(async(_url,init)=>{requests.push({headers:new Headers(init?.headers),body:JSON.parse(String(init?.body))});return new Response(JSON.stringify({code:200,data:{items:rows,has_more:false}}))}) as typeof fetch
  const runtime=new ServiceRuntime({environment,chatBaseUrl:'https://chat.example',requestTimeoutMs:1000} as ArkmeServiceConfig,{} as never,{uniqueCode:async()=> 'fake-key'} as StateStore,fetchImpl)
  const sources=new SourceService(runtime,{} as never,{} as never)
  const chat=new ChatService(runtime,sources,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never)
  return {runtime,codec:new GroupTeamMentionCodec(runtime),chat,requests,setRows:(next:typeof rows)=>{rows=next}}
}

it('keeps Team, human and Bot identities distinct and fences actor, environment, group, admission and delegation',async()=>{
  const f=fixture(),ref=await f.codec.seal(source,participant)
  expect(ref).not.toContain(participant.team_id)
  expect((await f.codec.open(source,ref)).teamId).toBe(participant.team_id)
  const rotated=await f.codec.seal(source,participant)
  expect(ref).not.toBe(rotated)
  expect(await f.codec.key(source,participant)).toBe(await f.codec.key(source,{...participant,team_name:'Changed public name'}))
  for(const changed of [{...source,userId:91},{...source,ownerRef:'other'},{...source,groupDelegation:undefined},{...source,groupDelegation:{...source.groupDelegation!,groupMembershipUid:'rejoined'}}]) {
    await expect(f.codec.open(changed,ref)).rejects.toThrow()
  }
  await expect(fixture('production').codec.open(source,ref)).rejects.toThrow()
  const text='🙂 @支持团队',input={teamMentionRef:ref,startIndex:3,length:5}
  const mentions=await f.chat.resolveMentions(source,text,text,[],[],actor,undefined,'plain',[input])
  expect(mentions).toEqual({humans:[],bots:[],teams:[{team_id:participant.team_id,display_name_snapshot:'支持团队',start_index:3,length:5}]})
  expect(f.requests[0]!.headers.get('X-Chat-Access-Ref')).toBe('host-only-access')
  const wire=encodeMentionMetadata(text,mentions)
  expect(wire).not.toHaveProperty('human_mentions');expect(wire).not.toHaveProperty('bot_mentions')
  expect(arkmeMentionMetadataMentionsViewer({}, {mention_metadata:wire},90)).toBe(false)
  expect(arkmeMentionMetadataMentionsViewer({}, {mention_metadata:wire},90,participant.team_id)).toBe(true)
  // No positive authorization cache, and a new admission invalidates the old mention.
  f.setRows([{...participant,membership_uid:'new-admission',revision:3}])
  await expect(f.chat.resolveMentions(source,text,text,[],[],actor,undefined,'plain',[input])).rejects.toThrow('重新选择')
  expect(f.requests).toHaveLength(2)
})

it('validates exact UTF16/markdown spans and cross-kind overlaps',async()=>{
  const f=fixture(),ref=await f.codec.seal(source,participant),team={teamMentionRef:ref,startIndex:0,length:5}
  await expect(f.chat.resolveMentions(source,'@别的团队','@别的团队',[],[],actor,undefined,'plain',[team])).rejects.toThrow('文本')
  await expect(f.chat.resolveMentions(source,'`@支持团队`','`@支持团队`',[],[],actor,undefined,'markdown',[{...team,startIndex:1}])).rejects.toThrow('代码')
  const normalized='@支持团队'
  await expect(f.chat.resolveMentions(source,normalized,normalized,[{all:true,startIndex:0,length:5}],[],actor,undefined,'plain',[team])).rejects.toThrow()
  await expect(f.chat.resolveMentions(source,normalized,normalized,[],[],actor,undefined,'plain',[team,team])).rejects.toThrow('重叠')
})

it('uses the original autocomplete and draft tokens and retains historical typed identities during re-edit',async()=>{
  const candidate=arkmeGroupMentionCandidates('支持',[],[],[{key:'candidate-key',mentionRef:'team-mention',teamRef:'not-a-mention',name:'支持团队',jotmoId:'support',revision:1}])[0]!
  expect(candidate).toMatchObject({kind:'team',teamMentionRef:'team-mention'})
  const inserted=insertArkmeComposerMentionToken({text:'🙂 ',mentions:[],emojis:[]},{teamMentionRef:'team-mention'},'支持团队',3)!
  expect(inserted.mentions[0]).toEqual({teamMentionRef:'team-mention',displayName:'支持团队',startIndex:3,length:5})
  expect(reconcileArkmeComposerMentions(inserted.text,'改 '+inserted.text,inserted.mentions)[0]?.startIndex).toBe(5)
  const payload={mention_metadata:{team_mentions:[{team_id:participant.team_id,display_name_snapshot:'支持团队',start_index:3,length:5}]}}
  const old=recordReeditMentionProjection(payload,inserted.text,'plain')
  const resolve=vi.fn()
  const metadata=await recordReeditMentionMetadata(inserted.text,prepareRecordReeditMentions(payload,inserted.text,inserted.text,old,true,'plain'),resolve)
  expect(metadata?.team_mentions).toEqual(payload.mention_metadata.team_mentions)
  expect(resolve).not.toHaveBeenCalled()
  expect(metadata).not.toHaveProperty('human_mentions')
})
