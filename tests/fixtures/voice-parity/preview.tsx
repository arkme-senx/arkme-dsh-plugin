import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArkmeMessageContent, ArkmeRecordDetailContent } from '../../../src/client/ArkmeRichContent.js'
import { ArkmeSearchSurface } from '../../../src/client/ArkmeSearchSurface.js'
import { ArkmeVoiceContent } from '../../../src/client/ArkmeVoiceContent.js'
import { notes } from './data.js'
import './preview.css'
import '../../../src/client/redesign/arkme-redesign.css'

function resolveSlowVoice(signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')) }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel)
      resolve('/arkme-self/api/media?ref=fixture-voice-1')
    }, 2000)
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
  })
}

function Preview() {
  const [dark, setDark] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const [detail, setDetail] = useState<number>()
  return <main data-dark={dark} style={{ maxWidth: narrow ? 360 : 1080 }}>
    <header><h1>语音样式验收</h1><p>合成数据 · 真实组件 · 不连接业务账号</p>
      <button onClick={() => setDark(value => !value)}>切换深浅色</button>{' '}
      <button onClick={() => setNarrow(value => !value)}>切换窄窗口</button>
    </header>
    <section aria-label="聊天语音"><h2>聊天 / 群成员快记</h2>{notes.map((note, index) => <article key={note.itemUid}>
      <span className="sender">lucis</span>
      <div className="existing-message-container" role="button" tabIndex={0} aria-label={`查看第${index + 1}条详情`}
        onClick={() => setDetail(index)} onKeyDown={event => { if (event.currentTarget === event.target && event.key === 'Enter') setDetail(index) }}>
        <ArkmeMessageContent item={note} />
      </div>
    </article>)}</section>
    {detail !== undefined && <section aria-label="快记详情"><h2>快记详情</h2><button onClick={() => setDetail(undefined)}>关闭详情</button><ArkmeRecordDetailContent item={notes[detail]!} /></section>}
    <section aria-label="慢加载验收"><h2>慢加载不撑高气泡</h2>
      <div className="existing-message-container"><ArkmeVoiceContent sourceKey="slow" durationSeconds={2} resolveSrc={resolveSlowVoice}>延迟加载不改变气泡高度</ArkmeVoiceContent></div>
    </section>
    <section aria-label="失败与空状态"><h2>失败与空状态</h2>
      <ArkmeVoiceContent sourceKey="failure" src="/arkme-self/api/media?ref=missing">失败不丢失文字</ArkmeVoiceContent>
      <ArkmeVoiceContent sourceKey="unavailable">无音频引用，文字仍可读</ArkmeVoiceContent>
    </section>
    <section aria-label="搜索验收"><h2>搜索 / 语音入口</h2><ArkmeSearchSurface onOpenRecord={item => setDetail(notes.findIndex(note => note.itemUid === item.recordUid))} /></section>
  </main>
}
createRoot(document.getElementById('root')!).render(<Preview />)
