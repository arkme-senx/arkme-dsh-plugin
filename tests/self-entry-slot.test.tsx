import {act,create} from 'react-test-renderer'
import {expect,it,vi} from 'vitest'
import {ArkmeNavigation} from '../src/client/ArkmeVirtualWorkspace.js'
import {arkmeAuthStore} from '../src/client/auth-store.js'
import {arkmeUi} from '../src/client/ui-controller.js'
vi.mock('../src/client/api.js',()=>({callArkme:vi.fn(async (operation:string,params:any)=>{if(operation==='sources.list')return {items:[],hasMore:false,directory:params?.directory};throw new Error('Unavailable in this fixture')})}))
it('reuses the original row and only opens the existing topic directory',async()=>{
  vi.stubGlobal('window', { addEventListener:vi.fn(),removeEventListener:vi.fn(),setTimeout,clearTimeout,requestAnimationFrame:(fn:()=>void)=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout })
  arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:7012})
  arkmeUi.showConversations()
  let renderer: ReturnType<typeof create>
  await act(async()=>{renderer=create(<ArkmeNavigation wide embeddedProductShell renderSlot={((key:string,props:any)=>key==='arkme.send-to-self.entry'?props.renderEntry(props.openTopicDirectory):null) as any}/>)})
  const entries=renderer!.root.findAllByType('button').filter(x=>x.findAllByType('span').some(s=>s.children.includes('发给自己')))
  expect(entries).toHaveLength(1)
  expect(entries[0]!.props['data-arkme-home-tour-target']).toBe('send-to-self')
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('个人主题')
  await act(async()=>entries[0]!.props.onClick())
  expect(renderer!.root.findAllByProps({'aria-label':'发给自己分类'})).toHaveLength(1)
  await act(async()=>renderer!.root.findByProps({'aria-label':'返回 Arkme 会话列表'}).props.onClick())
  expect(renderer!.root.findAllByProps({'aria-label':'发给自己分类'})).toHaveLength(0)
  await act(async()=>renderer!.unmount())
  arkmeAuthStore.setAuth({status:'logged-out',environment:'test'})
  vi.unstubAllGlobals()
})
