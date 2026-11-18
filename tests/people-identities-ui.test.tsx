// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { PeopleIdentities } from '../src/client/explore/PeopleIdentities.js'
import { clearPeopleDirectoryCache } from '../src/client/explore/usePeopleDirectory.js'
import type { UnifiedPerson } from '../src/people-contract.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
const capabilities={supported:true,link:true,unlink:true,merge:true,split:true,undo:true,materialize:true,recordingBinding:true}
const person: UnifiedPerson = { key: 'person', name: '甲', aliases: [], sources: ['relations'], isSelf: false, facets: [{ key: 'entity', personKey: 'person', personIdentityKey: 'stable-root', personRef: 'root-ref', identityKey: 'root', identityRef: 'entity-ref', source: 'relations', name: '甲', aliases: [], accountLinked: false, isSelf: false }] }
const other: UnifiedPerson = { ...person, key: 'other', name: '乙', facets: [{ ...person.facets[0]!, key: 'speaker', source: 'speakers', name: '乙', identityKey: 'speaker-id', identityRef: 'speaker-ref', personRef: 'other-root' }] }
let root: Root, host: HTMLDivElement
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); clearPeopleDirectoryCache(); mocks.call.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function click(text: string) { const b = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text); expect(b).toBeTruthy(); await act(async () => b!.click()) }
async function choose(value: string) { await act(async () => { const radio = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(r => r.value === value); expect(radio).toBeTruthy(); radio!.click() }) }

it('requires preview confirmation, retries the identical signed command, and exposes recent undo', async () => {
  const changed = vi.fn(); let fail = true
  mocks.call.mockImplementation(async (_op, p) => { if(p.action==='capabilities')return capabilities; if (p.action === 'impact') return {state:'complete',identityCount:1,relationRecordCount:0,unavailableRecordCount:0,names:[]}; if (p.action === 'list') return { links: [], ...(!fail ? { operationRef: 'receipt' } : {}) }; if (p.action === 'preview') return { commandRef: 'signed', changeCount: 1, expiresAt: Date.now() + 600000 }; if (p.action === 'apply') { if (fail) { fail = false; throw new Error('网络中断') }; return { operationRef: 'receipt', state: 'committed' } } })
  await act(async () => root.render(<PeopleIdentities person={person} people={[person, other]} accountScope="test:11" onChanged={changed} onClose={() => {}}/>))
  expect(document.querySelector('select')).toBeNull()
  await choose('speaker'); await click('预览影响')
  expect(document.querySelector('[aria-modal="true"]')).not.toBeNull()
  expect(mocks.call.mock.calls.some(c => c[1].action === 'apply')).toBe(false)
  await click('确认保存'); expect(document.body.textContent).toContain('保存结果待确认')
  await click('重试同一操作')
  expect(mocks.call.mock.calls.filter(c => c[1].action === 'apply').map(c => c[1].commandRef)).toEqual(['signed', 'signed'])
  expect(changed).toHaveBeenCalledOnce(); await click('撤销最近操作')
  expect(mocks.call.mock.calls.filter(c => c[1].action === 'preview').at(-1)?.[1]).toMatchObject({ action: 'preview', kind: 'undo', operationRef: 'receipt' })
})
it('previews a specific linked identity removal and a selected person merge', async () => {
  mocks.call.mockImplementation(async (_op, p) => p.action==='capabilities'?capabilities:p.action === 'list' ? { links: [{ identityKey: 'speaker-id', identityRef: 'linked-ref', namespace: 'audio_speaker' }] } : { commandRef: 'preview', changeCount: 1, expiresAt: Date.now() + 600000 })
  await act(async () => root.render(<PeopleIdentities person={person} people={[person, other]} accountScope="test:12" onChanged={() => {}} onClose={() => {}}/>))
  await click('解除关联'); expect(mocks.call.mock.calls.filter(c => c[1].action === 'preview').at(-1)?.[1]).toMatchObject({ kind: 'unlink', identityRef: 'linked-ref' })
  await click('取消'); await click('合并人物'); await choose('other'); await click('预览影响')
  expect(mocks.call.mock.calls.filter(c => c[1].action === 'preview').at(-1)?.[1]).toMatchObject({ kind: 'merge', otherPersonRef: 'other-root' })
  expect(document.body.textContent).toContain('乙 → 甲')
})

it('restores durable undo from the server on a fresh mount with no local receipt', async () => {
  mocks.call.mockImplementation(async (_op, p) => p.action==='capabilities'?capabilities:p.action === 'list' ? { links: [], operationRef: 'durable-receipt' } : { commandRef: 'undo-preview', changeCount: 2, changes: [], expiresAt: Date.now() + 600000 })
  await act(async () => root.render(<PeopleIdentities person={person} people={[person]} accountScope="test:13" onChanged={() => {}} onClose={() => {}}/>))
  await click('撤销最近操作')
  expect(mocks.call.mock.calls.filter(c => c[1].action === 'preview').at(-1)?.[1]).toMatchObject({ kind: 'undo', operationRef: 'durable-receipt' })
})
it('allows an independent speaker to preview a first contact link without an existing root', async () => {
  const independent = { ...other, facets: [{ ...other.facets[0]!, personRef: '' }] }
  const contact = { ...other, key: 'contact-person', facets: [{ ...other.facets[0]!, key: 'contact', source: 'contacts' as const, personRef: '', identityRef: 'contact-ref' }] }
  mocks.call.mockImplementation(async(_op,p)=>p.action==='capabilities'?capabilities:{ commandRef: 'create-root-preview', changeCount: 2, changes: [], expiresAt: Date.now()+600000 })
  await act(async () => root.render(<PeopleIdentities person={independent} people={[independent, contact]} accountScope="test:14" onChanged={() => {}} onClose={() => {}}/>))
  expect(Array.from(document.querySelectorAll('button')).some(button => button.textContent === '建立人物档案')).toBe(false)
  await choose('contact'); await click('预览影响')
  expect(mocks.call.mock.calls.filter(c => c[1].action === 'preview').at(-1)?.[1]).toMatchObject({ action: 'preview', kind: 'link', anchorIdentityRef: 'speaker-ref', identityRef: 'contact-ref' })
  expect(mocks.call.mock.calls.filter(c => c[1].action === 'preview').at(-1)?.[1]).not.toHaveProperty('personRef')
  expect(mocks.call.mock.calls.some(c => c[1].action === 'apply')).toBe(false)
})

it('clears a definitely rejected command so a conflict can be re-previewed immediately and after reopen', async () => {
  const changed = vi.fn()
  mocks.call.mockImplementation(async (_op, p) => { if(p.action==='capabilities')return capabilities;
    if (p.action === 'impact') return {state:'complete',identityCount:1,relationRecordCount:0,unavailableRecordCount:0,names:[]}
    if (p.action === 'list') return { links: [] }
    if (p.action === 'preview') return { commandRef: 'rejected-command', changeCount: 1, changes: [], expiresAt: Date.now() + 600000 }
    if (p.action === 'apply') throw Object.assign(new Error('人物身份已变化'), { body: { code: 'people-identity-rejected' } })
  })
  const render = (key: string) => root.render(<PeopleIdentities key={key} person={person} people={[person, other]} accountScope="test:15" onChanged={changed} onClose={() => {}}/>)
  await act(async () => render('first'))
  await choose('speaker'); await click('预览影响'); await click('确认保存')
  expect(document.body.textContent).toContain('本次未保存')
  expect(document.body.textContent).not.toContain('重试同一操作')
  await click('预览影响')
  expect(mocks.call.mock.calls.filter(c => c[1].action === 'preview')).toHaveLength(2)
  const keys = mocks.call.mock.calls.filter(c => c[1].action === 'preview').map(c => c[1].idempotencyKey)
  expect(keys[0]).not.toBe(keys[1])
  await click('确认保存')
  await act(async () => render('reopened'))
  expect(document.body.textContent).not.toContain('重试同一操作')
  await choose('speaker'); await click('预览影响')
  expect(mocks.call.mock.calls.filter(c => c[1].action === 'preview')).toHaveLength(3)
})

it('keeps confirmation disabled until every impact page is verified', async () => {
  let finish!: (v: unknown) => void
  mocks.call.mockImplementation(async (_op,p) => { if(p.action==='capabilities')return capabilities;
    if (p.action === 'list') return {links:[]}
    if (p.action === 'preview') return {commandRef:'counting',changeCount:1,changes:[],expiresAt:Date.now()+600000}
    if (p.action === 'impact') return p.cursor ? new Promise(resolve => { finish=resolve }) : {state:'pending',identityCount:1,relationRecordCount:100,unavailableRecordCount:0,names:[],nextCursor:'page-two'}
    if (p.action === 'apply') return {state:'committed',operationRef:'done'}
  })
  await act(async () => root.render(<PeopleIdentities person={person} people={[person,other]} accountScope="counting" onChanged={() => {}} onClose={() => {}}/>))
  await choose('speaker');await click('预览影响')
  const button=()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='确认保存')!
  expect(button().disabled).toBe(true)
  await click('确认保存');expect(mocks.call.mock.calls.some(([,p])=>p.action==='apply')).toBe(false)
  await act(async()=>finish({state:'complete',identityCount:1,relationRecordCount:157,unavailableRecordCount:0,names:[{name:'甲',target:true}]}))
  expect(button().disabled).toBe(false);expect(document.body.textContent).toContain('157')
})
it('keeps identity browsing but disables unavailable merge and reports capability read failures',async()=>{
 mocks.call.mockImplementation(async(_op,p)=>p.action==='capabilities'?{supported:true,link:true,merge:false,unlink:false,split:false,undo:false,materialize:false,recordingBinding:false}:{links:[]})
 await act(async()=>root.render(<PeopleIdentities person={person} people={[person,other]} accountScope="capabilities" onChanged={()=>{}} onClose={()=>{}}/>))
 const merge=[...document.querySelectorAll('button')].find(b=>b.textContent==='合并人物')!
 expect(merge.disabled).toBe(true)
 expect(mocks.call.mock.calls.some(c=>c[1].action==='capabilities')).toBe(true)
})

it('shows verified provenance and cautious candidate explanation without writing',async()=>{
 mocks.call.mockImplementation(async(_op,p)=>p.action==='capabilities'?capabilities:p.action==='list'?{links:[{identityKey:'linked',identityRef:'ref',namespace:'audio_speaker',provenance:{kind:'user_decision',action:'link',confirmedAt:1794391200000,confirmedBySelf:true}}]}:undefined)
 await act(async()=>root.render(<PeopleIdentities person={person} people={[person,other]} accountScope="test:proof" onChanged={()=>{}} onClose={()=>{}}/>))
 expect(document.body.textContent).toContain('查看关联依据')
 expect(document.body.textContent).toContain('你已手动确认')
 await choose('speaker')
 expect(document.body.textContent).toContain('尚未确认是同一人')
 expect(mocks.call.mock.calls.some(c=>c[1].action==='apply')).toBe(false)
})
