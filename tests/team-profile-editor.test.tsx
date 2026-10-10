import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {afterEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call}))
vi.mock('../src/client/ArkmeTeamAvatar.js',async original=>({...await original<typeof import('../src/client/ArkmeTeamAvatar.js')>(),ArkmeTeamAvatar:({name,avatar}:any)=> <span data-team-name={name} data-avatar-mode={avatar.mode}>avatar</span>}))
vi.mock('../src/client/ArkmeExtensionAvatarCropDialog.js',()=>({ArkmeExtensionAvatarCropDialog:()=> <section role="dialog">crop</section>}))
import {TeamProfileEditor} from '../src/client/redesign/contacts/TeamProfileEditor.js'
const profile={profileRef:'opaque',name:'团队',jotmoId:'test_team',profileRevision:3,canEditProfile:true,avatar:{mode:'default' as const,key:'default'}}
let view:ReactTestRenderer|undefined
afterEach(()=>{if(view)act(()=>view!.unmount());view=undefined;mocks.call.mockReset()})
function mount(overrides={},onUpdated=vi.fn()) {act(()=>{view=create(<TeamProfileEditor profile={{...profile,...overrides}} onClose={()=>undefined} onUpdated={onUpdated}/>,{createNodeMock:node=>node.type==='dialog'?{showModal(){}}:null})});return onUpdated}
it('saves a compact owner form and preserves the exact request identity on retry',async()=>{
 const updated=mount();mocks.call.mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce({acceptedRevision:4,profile:{...profile,name:'新名',profileRevision:4}})
 act(()=>view!.root.findByProps({'aria-label':'团队名称'}).props.onChange({currentTarget:{value:'新名'}}))
 const submit=()=>view!.root.findByType('form').props.onSubmit({preventDefault(){}})
 await act(async()=>{submit()});expect(view!.root.findByProps({role:'alert'}).children).toEqual(['temporary']);await act(async()=>{submit()})
 expect(mocks.call.mock.calls[0]![1].requestUid).toBe(mocks.call.mock.calls[1]![1].requestUid);expect(updated).toHaveBeenCalledWith(expect.objectContaining({name:'新名',profileRevision:4}))
})
it('blocks stale-version saves while preserving input and never offers member editing',async()=>{
 mount();mocks.call.mockRejectedValue(Object.assign(new Error('请重新打开'),{code:'team-version_conflict'}));await act(async()=>view!.root.findByType('form').props.onSubmit({preventDefault(){}}))
 expect(view!.root.findByProps({type:'submit'}).props.disabled).toBe(true);expect(view!.root.findByProps({'aria-label':'团队名称'}).props.value).toBe('团队')
 act(()=>view!.update(<TeamProfileEditor profile={{...profile,canEditProfile:false}} onClose={()=>undefined} onUpdated={()=>undefined}/>));expect(view!.toJSON()).toBeNull()
})
it('places image cropping inside the native modal focus scope',()=>{
 mount();const input=view!.root.findByProps({type:'file'});act(()=>input.props.onChange({currentTarget:{files:[new File(['bytes'],'test.png',{type:'image/png'})],value:'x'}}))
 expect(view!.root.findByType('dialog').findByProps({role:'dialog'}).children).toEqual(['crop'])
})
it('uses the name avatar from its menu without uploading any image',async()=>{
 const updated=mount({avatar:{mode:'custom',key:'custom'}});mocks.call.mockResolvedValue({acceptedRevision:4,profile})
 act(()=>view!.root.findByProps({'aria-label':'更换团队头像'}).props.onClick());act(()=>view!.root.findAllByProps({role:'menuitem'}).find(b=>text(b).includes('使用名称头像'))!.props.onClick());await act(async()=>view!.root.findByType('form').props.onSubmit({preventDefault(){}}))
 expect(mocks.call).toHaveBeenCalledExactlyOnceWith('team.app.profile.update',expect.objectContaining({avatar:{action:'default'}}),expect.any(AbortSignal));expect(updated).toHaveBeenCalledOnce()
})

it('renews an attempted candidate when the edit changes and retains the local image',async()=>{
 mount();const image=new File(['bytes'],'test.png',{type:'image/png'});Object.defineProperty(image,'arrayBuffer',{value:async()=>new Uint8Array([1,2,3]).buffer})
 act(()=>view!.root.findByProps({type:'file'}).props.onChange({currentTarget:{files:[image],value:'x'}}));act(()=>view!.root.find(node=>typeof node.props.onConfirm==='function').props.onConfirm(image))
 mocks.call.mockImplementation(async(method)=>method==='team.app.profile.avatar.upload'?{uploadRef:'uploaded-'+mocks.call.mock.calls.length}:method==='team.app.profile.avatar.abort'?undefined:Promise.reject(new Error('temporary')))
 const submit=()=>view!.root.findByType('form').props.onSubmit({preventDefault(){}})
 await act(async()=>submit());await act(async()=>submit())
 const previous=mocks.call.mock.calls.filter(c=>c[0]==='team.app.profile.update');expect(previous[0]![1].requestUid).toBe(previous[1]![1].requestUid);expect(mocks.call.mock.calls.filter(c=>c[0]==='team.app.profile.avatar.upload')).toHaveLength(1)
 await act(async()=>view!.root.findByProps({'aria-label':'团队名称'}).props.onChange({currentTarget:{value:'新名称'}}));await act(async()=>submit())
 const uploads=mocks.call.mock.calls.filter(c=>c[0]==='team.app.profile.avatar.upload');expect(uploads).toHaveLength(2);expect(uploads[0]![1].uploadUid).not.toBe(uploads[1]![1].uploadUid);expect(uploads[0]![1].contentBase64).toBe(uploads[1]![1].contentBase64);expect(mocks.call.mock.calls.some(c=>c[0]==='team.app.profile.avatar.abort')).toBe(true)
})

function text(node:any):string { return typeof node==='string'?node:(node.children??[]).map(text).join('') }
it('previews the draft name in the menu and only persists the choice on Save',()=>{
 mount({avatar:{mode:'custom',key:'custom'}})
 expect(view!.root.findAllByProps({role:'menuitem'})).toHaveLength(0)
 act(()=>view!.root.findByProps({'aria-label':'团队名称'}).props.onChange({currentTarget:{value:'研发团队'}}))
 act(()=>view!.root.findByProps({'aria-label':'更换团队头像'}).props.onClick())
 const choice=view!.root.findAllByProps({role:'menuitem'}).find(b=>text(b).includes('使用名称头像'))!
 expect(text(choice)).toContain('研发使用名称头像随团队名称自动更新')
 act(()=>choice.props.onClick())
 expect(view!.root.findAllByProps({role:'menuitem'})).toHaveLength(0)
 expect(view!.root.findByProps({'data-avatar-mode':'default'}).props['data-team-name']).toBe('研发团队')
 expect(mocks.call).not.toHaveBeenCalled()
 act(()=>view!.root.findByProps({'aria-label':'更换团队头像'}).props.onClick())
 expect(view!.root.findAllByProps({role:'menuitem'}).map(text)).toEqual(['上传图片'])
})
