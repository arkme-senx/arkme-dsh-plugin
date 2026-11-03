import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { UserCircle } from '@phosphor-icons/react/UserCircle'
import { ChartBar } from '@phosphor-icons/react/ChartBar'
import { Database } from '@phosphor-icons/react/Database'
import { Gear } from '@phosphor-icons/react/Gear'
import { Info } from '@phosphor-icons/react/Info'
import { X } from '@phosphor-icons/react/X'
import { ArkmeSettingsSurface } from './ArkmeSettingsSurface.js'
import { ArkmeAccountUsageSettings } from './ArkmeAccountUsageSettings.js'
import { ArkmeDataManagementSettings } from './ArkmeDataManagementSettings.js'
import { arkmeUi, type ArkmeSettingsSection } from './ui-controller.js'
import { arkmeAuthStore } from './auth-store.js'
import { tr, useArkmeLocale } from './locale.js'
import settingsCss from './settings-dialog.css?inline'

type Section = ArkmeSettingsSection | 'general' | 'about'
const sections = [
  { id: 'arkme-account', label: '我的账户', Icon: UserCircle },
  { id: 'arkme-usage', label: '用量与额度', Icon: ChartBar },
  { id: 'arkme-data', label: '数据管理', Icon: Database },
  { id: 'general', label: '通用设置', Icon: Gear },
  { id: 'about', label: '关于', Icon: Info },
] as const
type Preferences = Pick<Context, 'locale' | 'theme' | 'on'>

/** Use the existing global preference owners, never a second settings file. */
function CommonPreferences({ preferences }: { preferences: Preferences }) {
  const language = useSyncExternalStore(fn => preferences.locale.subscribe(fn), () => preferences.locale.getSnapshot())
  const [appearance, setAppearance] = useState(() => preferences.theme.getTheme())
  useEffect(() => {
    setAppearance(preferences.theme.getTheme())
    const stop = preferences.on('theme/change', snapshot => setAppearance(snapshot))
    return () => { stop() }
  }, [preferences])
  return <div className="arkme-settings-common">
    <label className="arkme-settings-preference"><span>{tr('语言')}</span>
      <select aria-label={tr('语言')} value={language.active} onChange={event => preferences.locale.setLocale(event.target.value)}>
        {language.locales.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
    <div className="arkme-settings-preference"><span>{tr('外观')}</span><div role="group" aria-label={tr('外观')}>
      {([['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']] as const).map(([id, label]) =>
        <button key={id} type="button" data-arkme-feedback="neutral" aria-pressed={appearance.preference === id}
          onClick={() => preferences.theme.setTheme(id)}>{tr(label)}</button>)}
    </div></div>
  </div>
}

export function ArkmeSettingsDialog({ section, preferences, onClose, onSelect }: {
  section: Section; preferences: Preferences; onClose(): void; onSelect(section: Section): void
}) {
  useArkmeLocale()
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => { content.current?.scrollTo?.(0, 0) }, [section])
  return <Modal open title={tr('即我设置')} onClose={onClose} headless
    className="arkme-settings-dialog" shortcutModal="settings">
    <style>{settingsCss}</style>
    <div className="arkme-settings-layout" data-arkme-owned="settings-dialog">
      <nav aria-label={tr('即我设置分类')}><h2 className="arkme-settings-nav-title">{tr('即我设置')}</h2>
        <div className="arkme-settings-nav-items">{sections.map(({ Icon, ...item }) => <button key={item.id} type="button"
        data-arkme-feedback="neutral" aria-current={section === item.id ? 'page' : undefined}
        data-modal-autofocus={section === item.id ? '' : undefined} onClick={() => onSelect(item.id)}><Icon size={20} aria-hidden /><span>{tr(item.label)}</span></button>)}</div></nav>
      <div className="arkme-settings-main">
        <div className="arkme-settings-toolbar"><button type="button" className="arkme-settings-close" aria-label={tr('关闭')}
          data-arkme-feedback="neutral" onClick={onClose}><X size={20} aria-hidden /></button></div>
        <div className="arkme-settings-dialog-content" ref={content}>
        {section === 'arkme-account' && <ArkmeSettingsSurface />}
        {section === 'arkme-usage' && <ArkmeAccountUsageSettings />}
        {section === 'arkme-data' && <ArkmeDataManagementSettings />}
        {section === 'general' && <><CommonPreferences preferences={preferences} /><ArkmeSettingsSurface view="general" /></>}
        {section === 'about' && <ArkmeSettingsSurface view="about" />}
        </div>
      </div>
    </div>
  </Modal>
}

function SettingsHost({ preferences }: { preferences: Preferences }) {
  const [section, setSection] = useState<Section>()
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const account = auth.auth?.status === 'authenticated' ? `${auth.auth.environment}:${auth.auth.userId}` : undefined
  useEffect(() => arkmeUi.bindSettingsOpener(next => setSection(next ?? 'arkme-account')), [])
  useEffect(() => { setSection(undefined) }, [account])
  return section === undefined ? null : <ArkmeSettingsDialog section={section} preferences={preferences}
    onSelect={setSection} onClose={() => setSection(undefined)} />
}

export function installArkmeSettingsDialog(ctx: Context): () => void {
  const host = document.createElement('div')
  host.dataset.arkmeOwned = 'settings-host'
  document.body.append(host)
  const root = createRoot(host)
  root.render(<SettingsHost preferences={ctx} />)
  return () => { root.unmount(); host.remove() }
}
