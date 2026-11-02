// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {ArkmeSettingsSurface} from '../src/client/ArkmeSettingsSurface.js'
import {ArkmeMarketplace,ExtensionCard} from '../src/client/ArkmeMarketplace.js'
import {arkmeAuthStore} from '../src/client/auth-store.js'
import {callArkme} from '../src/client/api.js'
import pluginManifest from '../package.json' with { type: 'json' }
vi.mock('../src/client/api.js',async importOriginal=>({...await importOriginal<object>(),callArkme:vi.fn()}))
afterEach(()=>vi.restoreAllMocks())
function setChannel(mas:boolean){
 const current=arkmeAuthStore.getSnapshot()
 const snapshot={...current,config:{...current.config,hostPolicy:{distribution:mas?'mas':'website',capabilities:{clientSelfUpdate:!mas,runtimeSelfUpdate:!mas,executableExtensionInstall:!mas}}}}
 vi.spyOn(arkmeAuthStore,'getSnapshot').mockReturnValue(snapshot as ReturnType<typeof arkmeAuthStore.getSnapshot>)
}
it('keeps the unified About version without legacy update rows in both channels',()=>{
 setChannel(true)
 const mas=renderToStaticMarkup(<ArkmeSettingsSurface view="about" />)
 expect(mas).not.toContain('打开 APP 更新')
 const masDocument = new DOMParser().parseFromString(mas, 'text/html')
 expect(masDocument.querySelector('.arkme-about-version')?.textContent).toBe(`v3.${pluginManifest.version.split('.')[2]}`)
 expect(mas).not.toContain('DeepSeek Harness');expect(mas).not.toContain('ArkME 插件')
 vi.restoreAllMocks();setChannel(false)
 const website = renderToStaticMarkup(<ArkmeSettingsSurface view="about" />)
 const document = new DOMParser().parseFromString(website, 'text/html')
 expect(document.querySelector('.arkme-about-version')?.textContent).toBe(`v3.${pluginManifest.version.split('.')[2]}`)
 expect([...document.querySelectorAll('button')].filter(button => button.textContent === '打开 APP 更新')).toHaveLength(0)
 expect(website).not.toContain('DeepSeek Harness');expect(website).not.toContain('ArkME 插件')
})
it('keeps marketplace installation button but shows website-only message without starting installation',async()=>{
 setChannel(true)
 vi.mocked(callArkme).mockImplementation(async(op)=>{
  if(op==='extensions.catalog.list')return {items:[{extension_id:'demo',name:'Demo',description:'Demo extension',visibility:'public',version:'1.0.0',latest_stable_version:'1.0.0'}],total:1} as never
  if(op==='extensions.installed-list'||op==='extensions.updates')return [] as never
  return {items:[],categories:[]} as never
 })
 let view!:ReactTestRenderer
 try{
  await act(async()=>{view=create(<ArkmeMarketplace displayMode="page" />)})
  await vi.waitFor(()=>expect(view.root.findAllByType(ExtensionCard)).toHaveLength(1))
  const card=view.root.findByType(ExtensionCard)
  expect(card.props.actionLabel).toBe('安装')
  await act(async()=>{card.props.onAction()})
  expect(JSON.stringify(view.toJSON())).toContain('该功能仅在官网版本中可用。')
  expect(vi.mocked(callArkme).mock.calls.some(([op])=>op==='extensions.install.preview'||op==='extensions.install.start')).toBe(false)
 }finally{if(view)await act(async()=>view.unmount())}
})
