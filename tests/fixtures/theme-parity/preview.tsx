import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArkmeCalendarCell, ArkmeSelfCalendarPopover } from '../../../src/client/ArkmeCalendarSurface.js'
import { ArkmeSourceBreadcrumb } from '../../../src/client/ArkmeSourceBreadcrumb.js'
import { ArkmeFileViewer } from '../../../src/client/ArkmeFileViewer.js'
import { ArkmeComposerSendButton } from '../../../src/client/ArkmeComposerSendButton.js'
import { ArkmeMessageSnapshotDialogContent } from '../../../src/client/ArkmeMessageSnapshotDialog.js'
import { ArkmeVoiceprintSurface } from '../../../src/client/ArkmeVoiceprintSurface.js'
import { arkmeTheme } from '../../../src/client/arkme-theme.js'
import { CONVERSATION_MENU_COLORS, CONVERSATION_MENU_SURFACE } from '../../../src/client/conversation-selector-style.js'
import type { ArkmeTimelineItem } from '../../../src/types.js'
import '@deepseek-ai/dsh-client-ui-theme/styles/design-platform.css'
import '../../../src/client/redesign/arkme-redesign.css'
import '../../../src/client/arkme-button-hover.css'
import '../../../src/client/redesign/interaction-feedback.css'

const item: ArkmeTimelineItem = { itemUid: 'synthetic', senderName: '测试', isMe: true, sendAtMillis: 1, status: 1, templateKind: 1, title: '', textContent: '消息详情验收', contentBlocks: [] }
const panel = { padding: 20, borderRadius: 16, background: arkmeTheme.menu, color: arkmeTheme.text, border: `1px solid ${arkmeTheme.border}` }
function Preview() {
  const [mode, setMode] = useState<'light'|'dark'|'system'>('dark')
  const [file, setFile] = useState<'md'|'txt'|'zip'>()
  const [calendar, setCalendar] = useState(false)
  const [focused, setFocused] = useState(false)
  const [voiceprint, setVoiceprint] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => { const dark = mode === 'dark' || (mode === 'system' && system.matches); document.body.toggleAttribute('data-ds-dark-theme', dark); document.documentElement.style.colorScheme = dark ? 'dark' : 'light' }
    apply(); system.addEventListener('change', apply); return () => system.removeEventListener('change', apply)
  }, [mode])
  return <main style={{ padding: 32, fontFamily: 'system-ui', color: arkmeTheme.text }}>
    <nav hidden data-arkme-owned="product-navigation" />
    <style>{`body { margin:0; background:var(--dsw-alias-bg-base); } button,select { font:inherit; } .checks { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:24px; } .fixture-tools { display:flex; gap:12px; margin-bottom:24px; } .fixture-tools button,select { padding:8px 12px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-2); }`}</style>
    <h1>明暗主题验收</h1><p>合成数据 · 真实组件 · 不连接业务账号</p>
    <div className="fixture-tools">
      <select aria-label="主题" value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="dark">暗色</option><option value="light">亮色</option><option value="system">跟随系统</option></select>
      <button ref={anchor} onClick={() => setCalendar(true)}>打开日历</button>
      <button onClick={() => setFile('md')}>查看 MD</button><button onClick={() => setFile('txt')}>查看文本</button><button onClick={() => setFile('zip')}>查看普通文件</button>
      <button onClick={() => setVoiceprint(value => !value)}>声纹管理验收</button>
    </div>
    {voiceprint ? <ArkmeVoiceprintSurface /> : <div className="checks">
      <section style={panel} aria-label="日期状态"><h2>日期与数量</h2><div style={{ display:'flex',gap:8 }}>
        {[false,true].map(selected => <ArkmeCalendarCell key={String(selected)} date={new Date(2026,8,18)} selected={selected} disabled={false} showCountLabel meta={{ bucketDate:'2026-09-18',count:18,hasRecords:true,protectedCount:0 }} onClick={() => {}} />)}
        <ArkmeCalendarCell date={new Date(2026,8,19)} selected={false} disabled showCountLabel onClick={() => {}} />
      </div></section>
      <section style={panel} aria-label="输入框状态"><h2>输入框</h2>
        <div className="arkme-conversation-composer-inner" data-arkme-primary-composer="true" data-arkme-composer-focused={String(focused)} style={{padding:14,border:'1px solid transparent',borderRadius:15}}>
          <textarea aria-label="测试输入框" placeholder="记录此刻想法…" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={{width:'100%',height:70,border:0,outline:0,background:'transparent',color:arkmeTheme.text}} />
          <div style={{display:'flex',gap:12}}><ArkmeComposerSendButton ariaLabel="发送" disabled={false} onClick={() => {}} /><ArkmeComposerSendButton ariaLabel="不可发送" disabled onClick={() => {}} /></div>
        </div>
      </section>
      <section style={panel}><h2>主题选择</h2><ArkmeSourceBreadcrumb selectedSource={undefined} sources={[]} onSelect={() => {}} onSelectAggregate={() => {}} /></section>
      <section style={{...panel,...CONVERSATION_MENU_SURFACE}} aria-label="DSH 共用选中样式"><h2>会话列表</h2><div data-test-selection style={{background:CONVERSATION_MENU_COLORS.selected,borderRadius:8,padding:12}}>选中的会话 <span style={{color:arkmeTheme.secondary}}>18 分钟</span></div></section>
      <section style={panel} aria-label="消息信息"><ArkmeMessageSnapshotDialogContent item={item} /></section>
    </div>}
    <ArkmeSelfCalendarPopover open={calendar} anchor={anchor} onClose={() => setCalendar(false)} onSelectRecord={() => {}} />
    {file && <ArkmeFileViewer openLocalFile={file !== 'zip'} block={{kind:'file',fileName:`主题验收.${file}`,mimeType:file==='md'?'text/markdown':file==='txt'?'text/plain':'application/zip',size:120,sortOrder:0,mediaRef:'',localFileRef:'arkme-file-v1.00000000-0000-4000-8000-000000000001'}} onClose={() => setFile(undefined)} />}
  </main>
}
createRoot(document.getElementById('root')!).render(<Preview />)
