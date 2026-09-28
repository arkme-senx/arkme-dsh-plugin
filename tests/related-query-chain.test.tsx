// @vitest-environment jsdom
import { act, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { RelatedQuickNoteService } from '../src/services/related-quick-note-service.js'
import { ServiceRuntime, ArkmePluginError, type ArkmeServiceConfig, type StateStore } from '../src/services/service.js'
const api = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', async () => ({ callArkme: api, ArkmeClientError: (await import('../src/sdk/index.js')).ArkmeClientError }))
import { ArkmeClientError } from '../src/sdk/index.js'
import { loadRelatedQuickNotes, relatedQuickNotesState } from '../src/client/related-quick-notes-query.js'
import { ArkmeRelatedQuickNotesCard, type ArkmeRelatedQuickNotesLoadState } from '../src/client/ArkmeRelatedQuickNotes.js'

const endpoint = process.env.RELATED_CHAIN_RECORD_URL
it.skipIf(!endpoint)('walks UI, Host owner, record HTTP, recall and embedding HTTP through failure and recovery', async () => {
  expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const session = { userId: 11, accessToken: 'local-fixture', refreshToken: 'local-fixture' }
  const config = { environment:'test', recordBaseUrl:endpoint, authBaseUrl:endpoint, dataBaseUrl:endpoint,
    chatBaseUrl:endpoint,audioBaseUrl:endpoint,worldBaseUrl:endpoint,relationBaseUrl:endpoint,intelligentBaseUrl:endpoint,webrtcBaseUrl:endpoint,requestTimeoutMs:5000 } as ArkmeServiceConfig
  const runtime = new ServiceRuntime(config, {async read(){return session},async write(){},async delete(){}}, {async uniqueCode(){return 'local-chain-secret'}} as StateStore)
  let slowProfiles = false
  const owner = new RelatedQuickNoteService(runtime, {} as never, {} as never,
    {async publicProfileSummariesByUserIds(){return slowProfiles ? new Promise(() => {}) : new Map()}} as never,
    {async lockedRecordUids(){return new Set<string>()}} as never)
  api.mockImplementation(async (_operation, params, signal) => {
    try {
      return await owner.list({viewerUserId:11,sourceRef:'local-source',sourceOwnerRef:'local-owner',contextType:'record',recordUid:params.uid,recordOwnerUserId:11,chatSessionUid:''},signal)
    } catch (error) {
      if (error instanceof ArkmePluginError) throw new ArkmeClientError({code:error.code, message:error.message, retryable:error.retryable})
      throw error
    }
  })
  function View({uid}:{uid:string}) {
    const [state,setState]=useState<ArkmeRelatedQuickNotesLoadState>({kind:'loading'})
    const [revision,retry]=useState(0)
    useEffect(()=>{
      const c=new AbortController();setState({kind:'loading'})
      void loadRelatedQuickNotes('source.related-quick-notes.from-message',{uid},c.signal)
        .then(list=>{if(!c.signal.aborted)setState(relatedQuickNotesState(list))})
        .catch(()=>{if(!c.signal.aborted)setState({kind:'error',message:'相关快记暂时不可用'})})
      return ()=>c.abort()
    },[uid,revision])
    return <><p>可阅读的详情正文</p><ArkmeRelatedQuickNotesCard state={state} onOpen={()=>{}} onRetry={()=>retry(value=>value+1)}/></>
  }
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
  const show=async(uid:string,text:string)=>{
    await act(async()=>root.render(<View uid={uid}/>))
    expect(host.textContent).toContain('可阅读的详情正文')
    await vi.waitFor(async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,20))});expect(host.textContent).toContain(text)}, {timeout:8000})
  }
  try {
    await show('chain-normal','共 20 条')
    await show('chain-busy','相关快记暂时不可用')
    expect(host.textContent).not.toContain('暂未找到相关快记')
    await act(async()=>host.querySelector<HTMLButtonElement>('button')!.click())
    await vi.waitFor(async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,20))});expect(host.textContent).toContain('相关快记暂时不可用')},{timeout:8000})
    await show('chain-normal','共 20 条')
    await show('chain-empty','暂未找到相关快记')
    expect(host.querySelector('[data-arkme-related-quick-notes-card]')).toBeNull()
    await show('chain-recover-plugin','共 20 条')
    await show('chain-serverbusy-plugin','共 20 条')
    slowProfiles = true
    await show('chain-profiles-plugin','共 20 条')
    slowProfiles = false
    await show('chain-locked','相关快记暂时不可用')
    expect(host.querySelector('button')).toBeNull()
    await show('chain-missing','相关快记暂时不可用')
    await show('chain-timeout','相关快记暂时不可用')
  } finally {
    await act(async()=>root.unmount());host.remove();owner.dispose();runtime.dispose();vi.unstubAllGlobals()
  }
},30000)
