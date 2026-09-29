// @vitest-environment jsdom
import { act, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { RelatedQuickNoteService } from '../src/services/related-quick-note-service.js'
import { ServiceRuntime, ArkmePluginError, type ArkmeServiceConfig, type StateStore } from '../src/services/service.js'
const api = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', async () => ({ callArkme: api, ArkmeClientError: (await import('../src/sdk/index.js')).ArkmeClientError }))
import { ArkmeClientError } from '../src/sdk/index.js'
import { loadRelatedQuickNotes } from '../src/client/related-quick-notes-query.js'
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
    {async publicProfileSummariesByUserIds(){if (slowProfiles) await new Promise(resolve => setTimeout(resolve, 800)); return new Map()}} as never,
    {async lockedRecordUids(){return new Set<string>()}} as never)
  api.mockImplementation(async (_operation, params, signal) => {
    try {
      return await owner.list({viewerUserId:11,sourceRef:'local-source',sourceOwnerRef:'local-owner',contextType:'record',recordUid:params.uid,recordOwnerUserId:11,chatSessionUid:''},signal)
    } catch (error) {
      if (error instanceof ArkmePluginError) throw new ArkmeClientError({code:error.code, message:error.message, retryable:error.retryable})
      throw error
    }
  })
  let completed = ''
  function View({uid}:{uid:string}) {
    const [state,setState]=useState<ArkmeRelatedQuickNotesLoadState>({kind:'loading'})
    const [revision,retry]=useState(0)
    useEffect(()=>{
      const c=new AbortController();setState({kind:'loading'})
      void loadRelatedQuickNotes('source.related-quick-notes.from-message',{uid},c.signal)
        .then(list=>{if(!c.signal.aborted)setState(list.items.length ? {kind:'success',list} : {kind:'empty'})})
        .catch(()=>{if(!c.signal.aborted)setState({kind:'error',message:'相关快记加载失败'})})
        .finally(()=>{if(!c.signal.aborted)completed=uid})
      return ()=>c.abort()
    },[uid,revision])
    return <><p>可阅读的详情正文</p><ArkmeRelatedQuickNotesCard state={state} onOpen={()=>{}} onRetry={()=>retry(value=>value+1)}/></>
  }
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
  const show=async(uid:string,text:string)=>{
    completed=''
    await act(async()=>root.render(<View key={uid} uid={uid}/>))
    expect(host.textContent).toContain('可阅读的详情正文')
    await vi.waitFor(async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,20))});expect(completed).toBe(uid);expect(host.textContent).toContain(text)}, {timeout:8000})
    for (const notice of ['暂未找到相关快记','相关快记暂时不可用','相关结果可能不完整']) expect(host.textContent).not.toContain(notice)
    expect(host.querySelector('[role=alert], [role=alertdialog]')).toBeNull()
  }
  try {
    await show('chain-normal','共 20 条')
    await show('chain-busy','可阅读的详情正文')
    expect(host.querySelector('button')).toBeNull()
    await show('chain-normal','共 20 条')
    await show('chain-empty','可阅读的详情正文')
    expect(host.querySelector('[data-arkme-related-quick-notes-card]')).toBeNull()
    await show('chain-recover-plugin','共 20 条')
    await show('chain-serverbusy-plugin','共 20 条')
    slowProfiles = true
    await show('chain-profiles-plugin','共 20 条')
    slowProfiles = false
    await show('chain-locked','可阅读的详情正文')
    expect(host.querySelector('button')).toBeNull()
    await show('chain-missing','可阅读的详情正文')
    await show('chain-timeout','可阅读的详情正文')
  } finally {
    await act(async()=>root.unmount());host.remove();owner.dispose();runtime.dispose();vi.unstubAllGlobals()
  }
},30000)
