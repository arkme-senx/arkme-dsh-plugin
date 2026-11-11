import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {ArkmeMentionSuggestionRow,type ArkmeMentionSuggestionRowStyles} from '../src/client/ArkmeMentionSuggestionRow.js'
import type {ArkmeMentionCandidate} from '../src/client/mention-candidates.js'
import {teamAvatarImages} from '../src/client/team-avatar-image-runtime.js'
import {arkmeAvatarImages} from '../src/client/avatar-image-runtime.js'
import {arkmeAuthStore} from '../src/client/auth-store.js'
const mocks=vi.hoisted(()=>({callArkme:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.callArkme}))
const styles:ArkmeMentionSuggestionRowStyles={row:{},rowActive:{},avatar:{},botAvatar:{},text:{},name:{},secondary:{}}
const member:ArkmeMentionCandidate={kind:'member',mentionRef:'person',memberRef:'member',displayName:'Member',mentionDisplayName:'Member',role:'member',status:'active',isSelf:false,isOwner:false,joinedAtMillis:1,recordCount:0,mentionCount:0}
let renderer:ReactTestRenderer|undefined,scope=0
beforeEach(()=>{mocks.callArkme.mockReset();teamAvatarImages.activateScope(`team:${++scope}`);arkmeAvatarImages.activateScope(`personal:${scope}`)})
afterEach(()=>{act(()=>renderer?.unmount());renderer=undefined;teamAvatarImages.activateScope(undefined);arkmeAvatarImages.activateScope(undefined)})
const row=(candidate:ArkmeMentionCandidate)=><ArkmeMentionSuggestionRow candidate={candidate} active styles={styles} onActive={()=>{}} onSelect={()=>{}}/>
it('shows names immediately and resolves Team images through the existing account-scoped Team port',async()=>{
 let resolve!:(value:unknown)=>void
 mocks.callArkme.mockReturnValue(new Promise(done=>{resolve=done}))
 const candidate={...member,teamImage:{ref:'team-app-image.signed',key:'image-key'}} as ArkmeMentionCandidate
 await act(async()=>{renderer=create(row(candidate))})
 expect(JSON.stringify(renderer!.toJSON())).toContain('Member')
 expect(renderer!.root.findAllByType('img')).toHaveLength(0)
 expect(mocks.callArkme).toHaveBeenCalledExactlyOnceWith('team.app.image',{imageRef:'team-app-image.signed'},undefined,{priority:'background'})
 await act(async()=>{resolve({base64:'AQID',mimeType:'image/png'})})
 expect(renderer!.root.findByType('img').props.src).toBe('data:image/png;base64,AQID')
 await act(async()=>{renderer!.update(row({...candidate,teamImage:{ref:'team-app-image.rotated',key:'image-key'}} as ArkmeMentionCandidate))})
 expect(mocks.callArkme).toHaveBeenCalledOnce()
})
it('preserves ordinary personal avatars and keeps missing Team avatars as fallback without requests',async()=>{
 mocks.callArkme.mockResolvedValue({dataBase64:'AQID',mediaType:'image/png'})
 await act(async()=>{renderer=create(row({...member,avatarRef:'personal-image'} as ArkmeMentionCandidate))})
 expect(mocks.callArkme).toHaveBeenCalledExactlyOnceWith('image.read',{imageRef:'personal-image'},undefined,{priority:'background',avatarDownload:true})
 await act(async()=>{renderer!.update(row(member))})
 expect(renderer!.root.findAllByType('img')).toHaveLength(0);expect(mocks.callArkme).toHaveBeenCalledOnce()
})
it('returns both local hits in one request and lets a miss finish separately',async()=>{
  arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:42})
  teamAvatarImages.activateScope('test:42')
  let finishDownload!: (value:unknown)=>void
  mocks.callArkme.mockImplementation((operation:string) => operation==='team.app.image-cache.batch'
    ? Promise.resolve([{imageKey:'a',base64:'AQID',mimeType:'image/png'},null,{imageKey:'c',base64:'AQID',mimeType:'image/png'}])
    : new Promise(resolve=>{finishDownload=resolve}))
  try {
    const first=teamAvatarImages.load('team-app-image.a','a')
    const missing=teamAvatarImages.load('team-app-image.b','b')
    const last=teamAvatarImages.load('team-app-image.c','c')
    await expect(Promise.all([first,last])).resolves.toEqual(['data:image/png;base64,AQID','data:image/png;base64,AQID'])
    expect(mocks.callArkme.mock.calls[0]).toEqual(['team.app.image-cache.batch',{
      imageRefs:['team-app-image.a','team-app-image.b','team-app-image.c'],expectedAccountKey:'test:42',
    }])
    await vi.waitFor(()=>expect(finishDownload).toBeTypeOf('function'))
    expect(mocks.callArkme.mock.calls[1]).toEqual(['team.app.image',{imageRef:'team-app-image.b'},undefined,{priority:'background'}])
    finishDownload({base64:'Ag==',mimeType:'image/png'})
    await expect(missing).resolves.toBe('data:image/png;base64,Ag==')
  } finally { arkmeAuthStore.setAuth({status:'logged-out',environment:'test'}) }
})
it('keeps the name on image failure and discards late image bytes after logout',async()=>{
 const candidate={...member,teamImage:{ref:'team-app-image.signed',key:'image-key'}} as ArkmeMentionCandidate
 mocks.callArkme.mockRejectedValueOnce(new Error('unavailable'))
 await act(async()=>{renderer=create(row(candidate))})
 expect(JSON.stringify(renderer!.toJSON())).toContain('Member');expect(renderer!.root.findAllByType('img')).toHaveLength(0)
 expect(mocks.callArkme).toHaveBeenCalledOnce()
 let resolve!:(value:unknown)=>void
 mocks.callArkme.mockReturnValueOnce(new Promise(done=>{resolve=done}))
 await act(async()=>{renderer!.update(row({...candidate,teamImage:{ref:'team-app-image.next',key:'next-key'}} as ArkmeMentionCandidate))})
 await act(async()=>{teamAvatarImages.activateScope(undefined);resolve({base64:'AQID',mimeType:'image/png'})})
 expect(renderer!.root.findAllByType('img')).toHaveLength(0)
})
