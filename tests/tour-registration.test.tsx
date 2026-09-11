// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call}))
import { isTourRegistrationEligible, TOUR_REGISTRATION_CUTOFF, useTourAccount } from '../src/client/use-tour-account.js'
import type { ArkmeAuthSnapshot } from '../src/types.js'
let root:Root, host:HTMLDivElement
const auth:ArkmeAuthSnapshot={status:'authenticated',environment:'test',userId:1}
function Fixture({value}:{value:ArkmeAuthSnapshot|undefined}) {return <span>{useTourAccount(value)??'ineligible'}</span>}
async function render(value:ArkmeAuthSnapshot|undefined=auth){await act(async()=>root.render(<Fixture value={value}/>))}
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);mocks.call.mockReset()})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
it('uses an inclusive Beijing midnight cutoff and rejects absent/invalid dates',()=>{
 expect(TOUR_REGISTRATION_CUTOFF).toBe(Date.parse('2026-09-09T16:00:00Z'))
 expect(isTourRegistrationEligible(TOUR_REGISTRATION_CUTOFF-1)).toBe(false)
 expect(isTourRegistrationEligible(TOUR_REGISTRATION_CUTOFF)).toBe(true)
 expect(isTourRegistrationEligible(TOUR_REGISTRATION_CUTOFF+1)).toBe(true)
 expect(isTourRegistrationEligible(TOUR_REGISTRATION_CUTOFF*1000-1)).toBe(false)
 expect(isTourRegistrationEligible(TOUR_REGISTRATION_CUTOFF*1000)).toBe(true)
 expect(isTourRegistrationEligible(1721887524084877)).toBe(false)
 for(const value of [undefined,0,NaN,Infinity])expect(isTourRegistrationEligible(value)).toBe(false)
})
it('blocks old accounts and waits for a matching eligible profile',async()=>{
 mocks.call.mockResolvedValue({profile:{userId:1,createdAt:TOUR_REGISTRATION_CUTOFF-1}})
 await render();expect(host.textContent).toBe('ineligible')
 mocks.call.mockResolvedValue({profile:{userId:2,createdAt:TOUR_REGISTRATION_CUTOFF}})
 await render({...auth,userId:2});expect(host.textContent).toBe('test:2')
 await render(undefined);expect(host.textContent).toBe('ineligible')
})
it('refreshes an absent cached profile, without enabling before the response',async()=>{
 let resolve!:(value:unknown)=>void
 mocks.call.mockResolvedValueOnce({profile:null}).mockImplementationOnce(()=>new Promise(r=>resolve=r))
 await render();expect(host.textContent).toBe('ineligible');expect(mocks.call).toHaveBeenLastCalledWith('user.profile.refresh')
 await act(async()=>resolve({profile:{userId:1,createdAt:TOUR_REGISTRATION_CUTOFF}}));expect(host.textContent).toBe('test:1')
})
it('ignores stale responses when switching account or environment',async()=>{
 const pending:((v:unknown)=>void)[]=[];mocks.call.mockImplementation(()=>new Promise(r=>pending.push(r)))
 await render();await render({...auth,environment:'prod'});
 await act(async()=>pending[0]!({profile:{userId:1,createdAt:TOUR_REGISTRATION_CUTOFF}}));expect(host.textContent).toBe('ineligible')
 await act(async()=>pending[1]!({profile:{userId:1,createdAt:TOUR_REGISTRATION_CUTOFF}}));expect(host.textContent).toBe('prod:1')
})
it('does not enable for errors, missing dates or mismatched profiles',async()=>{
 mocks.call.mockRejectedValueOnce(new Error('offline'));await render();expect(host.textContent).toBe('ineligible')
 mocks.call.mockResolvedValueOnce({profile:{userId:2}});await render({...auth,userId:2});expect(host.textContent).toBe('ineligible')
 mocks.call.mockResolvedValueOnce({profile:{userId:2,createdAt:TOUR_REGISTRATION_CUTOFF}});await render({...auth,userId:3});expect(host.textContent).toBe('ineligible')
})
