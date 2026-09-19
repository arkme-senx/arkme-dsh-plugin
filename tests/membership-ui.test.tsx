// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createRef } from 'react'
import { installArkmeRedesignStyles } from '../src/client/redesign/styles.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeMembershipDialog } from '../src/client/ArkmeMembershipDialog.js'
import { membershipDescription, membershipLabel, useMembership, type MembershipState } from '../src/client/arkme-membership.js'
const mocks=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call}))
vi.mock('../src/client/read-intent-visibility.js',()=>({suspendArkmeVisibleReadIntent:()=>()=>{}}))
// Vitest omits CSS by default. Exercise the installer with the real stylesheet;
// packaged browser verification separately checks that the bundle includes it.
vi.mock('../src/client/arkme-membership.css?inline',async()=>({default:(await import('node:fs')).readFileSync(`${process.cwd()}/src/client/arkme-membership.css`,'utf8')}))
const free:MembershipState={status:'ready',value:{userId:11,memberType:0,expireAtMillis:null,gifted:false,lifetime:false}}
let root:Root, host:HTMLDivElement
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
  mocks.call.mockReset()
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')}
  HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')}
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
const flush=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0))})}
function button(text:string){return [...document.querySelectorAll('button')].find(b=>b.textContent?.includes(text))!}
describe('membership presentation',()=>{
  it('ships membership CSS through the actual plugin style installer',()=>{
    const dispose=installArkmeRedesignStyles()
    expect(document.head.textContent).toContain('.arkme-member-columns')
    expect(document.head.textContent).toContain('.arkme-membership-dialog::backdrop')
    dispose()
  })
  it('defaults to the current tier after async loading and restores the stable avatar focus',async()=>{
    mocks.call.mockResolvedValue({userId:11,products:[]})
    const ref=createRef<HTMLButtonElement>()
    function View({state,open=true}:{state:MembershipState;open?:boolean}){return <><button ref={ref}>头像</button>{open&&<ArkmeMembershipDialog userId={11} state={state} onRefresh={()=>{}} onClose={()=>{}} returnFocusRef={ref}/>}</>}
    await act(async()=>root.render(<View state={{status:'loading'}}/>));await flush()
    await act(async()=>root.render(<View state={{status:'ready',value:{...free.value,memberType:2}}}/>))
    expect(document.querySelector('.arkme-member-tabs button[aria-pressed="true"]')?.textContent).toBe('SVIP')
    await act(async()=>root.render(<View state={free} open={false}/>));await flush()
    expect(document.activeElement).toBe(ref.current)
  })
  it('distinguishes loading, unavailable, free, gifted and lifetime',()=>{
    expect(membershipLabel({status:'error'})).toBe('待确认')
    expect(membershipLabel({status:'loading'})).toBe('读取中')
    expect(membershipLabel(free)).toBe('免费版')
    expect(membershipDescription({status:'ready',value:{...free.value,memberType:1,gifted:true}})).toContain('赠送会员')
    expect(membershipDescription({status:'ready',value:{...free.value,memberType:2,lifetime:true}})).toBe('永久会员')
  })
  it('shows server prices, switches tiers and keeps payment as an explicit non-mutating placeholder',async()=>{
    mocks.call.mockResolvedValue({userId:11,checkout:'mobile-app-only',products:[{id:'vip',memberType:1,name:'月度',priceMinor:1800,recurring:false},{id:'svip',memberType:2,name:'年度',priceMinor:19800,recurring:true}]})
    await act(async()=>root.render(<ArkmeMembershipDialog userId={11} state={free} onRefresh={()=>{}} onClose={()=>{}} />));await flush()
    expect(document.body.textContent).toContain('¥18.00')
    await act(async()=>button('开通 VIP').click())
    expect(document.body.textContent).toContain('桌面端支付开发中')
    await act(async()=>document.querySelector<HTMLButtonElement>('.arkme-member-tabs button:last-child')!.click())
    expect(document.body.textContent).toContain('¥198.00')
    expect(button('开通 SVIP')).toBeTruthy()
    expect(document.body.textContent).not.toContain('桌面端支付开发中')
    expect(mocks.call.mock.calls.map(c=>c[0])).toEqual(['membership.catalog'])
  })
  it('does not offer a redundant purchase to lifetime users',async()=>{
    mocks.call.mockResolvedValue({userId:11,products:[]})
    await act(async()=>root.render(<ArkmeMembershipDialog userId={11} state={{status:'ready',value:{...free.value,memberType:2,lifetime:true}}} onRefresh={()=>{}} onClose={()=>{}} />));await flush()
    expect(document.body.textContent).toContain('无需重复开通')
    expect(document.querySelector('.arkme-member-primary')).toBeNull()
  })
  it('supports retry and explicit status refresh without claiming purchase succeeded',async()=>{
    mocks.call.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({userId:11,products:[]})
    const refresh=vi.fn()
    await act(async()=>root.render(<ArkmeMembershipDialog userId={11} state={{status:'error'}} onRefresh={refresh} onClose={()=>{}} />));await flush()
    expect(document.body.textContent).toContain('套餐暂时无法读取')
    await act(async()=>button('重试').click());await flush()
    expect(document.body.textContent).toContain('暂无在售')
    await act(async()=>button('刷新状态').click())
    expect(refresh).toHaveBeenCalledOnce()
  })
  it('discards stale status when account changes during a request',async()=>{
    let resolveFirst:(v:unknown)=>void=()=>{}
    mocks.call.mockImplementationOnce(()=>new Promise(r=>{resolveFirst=r})).mockResolvedValueOnce({...free.value,userId:12,memberType:1}).mockRejectedValueOnce(new Error('unavailable'))
    function Status({id}:{id:number}){const m=useMembership(`prod:${id}`,id,false);return <span>{membershipLabel(m.state)}</span>}
    await act(async()=>root.render(<Status id={11}/>))
    await act(async()=>root.render(<Status id={12}/>));await flush()
    await act(async()=>resolveFirst({...free.value,memberType:2}))
    expect(host.textContent).toBe('VIP')
    await act(async()=>root.render(<Status id={13}/>));await flush()
    expect(host.textContent).toBe('待确认')
  })
})
