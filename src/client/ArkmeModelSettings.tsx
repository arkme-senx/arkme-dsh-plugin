import { useId, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { AccountModelsPanel } from './AccountModelsPanel.js'
import { ArkmeOfficialModels } from './ArkmeModelCatalogDialog.js'
import { arkmeAuthStore } from './auth-store.js'
import { tr, useArkmeLocale } from './locale.js'
import { ARKME_HARNESS_EMBED_PATH, HARNESS_MODELS_SETTINGS_QUERY } from '../harness-embed-contract.js'

export type ModelSettingsTab = 'official' | 'custom' | 'preferences' | 'usage'

export function ArkmeModelSettings({ initialTab = 'official' }: { initialTab?: ModelSettingsTab }) {
  useArkmeLocale()
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  if (auth?.status !== 'authenticated' || auth.userId === undefined) return <p>{tr('登录后查看模型设置')}</p>
  const scope = `${auth.environment}:${auth.userId}`
  return <ModelSettings key={`${scope}:${initialTab}`} scope={scope} initialTab={initialTab}/>
}

function ModelSettings({ scope, initialTab }: { scope: string; initialTab: ModelSettingsTab }) {
  const id = useId()
  const [tab, setTab] = useState(initialTab)
  const [officialVisited, setOfficialVisited] = useState(initialTab === 'official')
  const [accountVisited,setAccountVisited]=useState(initialTab!=='official')
  const [customVisited, setCustomVisited] = useState(initialTab === 'custom')
  const choose = (next: ModelSettingsTab) => { setTab(next); if(next!=='official')setAccountVisited(true); if (next === 'custom') setCustomVisited(true); else if(next==='official') setOfficialVisited(true) }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const tabs: ModelSettingsTab[]=['official','custom','preferences','usage']; const next = event.key==='Home' ? tabs[0]! : event.key==='End' ? tabs[3]! : tabs[(tabs.indexOf(tab)+(event.key==='ArrowRight'?1:3))%4]!
    choose(next)
    document.getElementById(`${id}-${next}`)?.focus()
  }
  return <section className="arkme-model-settings" data-arkme-settings-page="models">
    <h2>{tr('模型')}</h2>
    <p className="arkme-model-settings-intro">{tr('管理模型，查看各功能可用的模型与费用')}</p>
    <div role="tablist" aria-label={tr('模型来源')} className="arkme-model-settings-tabs">
      {([['official', '即我官方'], ['custom', '自提供模型'],['preferences','使用偏好'],['usage','使用记录']] as const).map(([value, label]) => <button key={value} type="button"
        role="tab" id={`${id}-${value}`} aria-controls={`${id}-${value==='official'?'official':'account'}-panel`} aria-selected={tab === value}
        tabIndex={tab === value ? 0 : -1} onKeyDown={onKeyDown} onClick={() => choose(value)}>{tr(label)}</button>)}
    </div>
    <div role="tabpanel" id={`${id}-official-panel`} aria-labelledby={`${id}-official`} hidden={tab !== 'official'} className="arkme-model-settings-official">
      {officialVisited && <ArkmeOfficialModels scope={scope}/>}
    </div>
    <div role="tabpanel" id={`${id}-account-panel`} aria-labelledby={`${id}-${tab==='official'?'custom':tab}`} hidden={tab==='official'} className="arkme-model-settings-account">
      {accountVisited && <AccountModelsPanel scope={scope} tab={tab==='official'?'custom':tab}/>}
    </div>
    <div role="tabpanel" id={`${id}-native-panel`} aria-label={tr("本机高级模型配置")} hidden={tab !== 'custom'} className="arkme-model-settings-custom">
      <p className="arkme-model-settings-scope">{tr('本机高级配置 · 保留原有提供方与密钥；需要跨场景使用时，请在上方绑定本机连接器。')}</p>
      {customVisited && <iframe title={tr('自提供模型配置')} src={`${ARKME_HARNESS_EMBED_PATH}?arkme-harness-embed=1&${HARNESS_MODELS_SETTINGS_QUERY}=1`}
        data-arkme-account-scope={scope} className="arkme-model-settings-frame"/>}
    </div>
  </section>
}
