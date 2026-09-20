import { tr, useArkmeLocale } from './locale.js'
import { useState, type CSSProperties } from 'react'
import type { ArkmeContentBlock } from '../types.js'
import { ArkmeMarkdownBody } from './ArkmeMarkdownBody.js'
import { ArkmeMediaPreview } from './ArkmeRichContent.js'

export function articleImageUrl(block: ArkmeContentBlock): string {
  return `/arkme-self/api/media?ref=${encodeURIComponent(block.mediaRef)}`
}
function ArticleImage({ block, alt, onOpen }: { block: ArkmeContentBlock; alt: string; onOpen(): void }) {
  useArkmeLocale()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  return <span style={{ display: 'inline-block', maxWidth: '100%', verticalAlign: 'bottom' }}>
    {failed ? <button type="button" onClick={() => { setAttempt(value => value + 1); setFailed(false) }}>{alt || tr("图片")}{tr("加载失败，点击重试")}</button>
      : <button type="button" aria-label={tr("预览图片 {v0}", { v0: alt })} onClick={onOpen} style={{ display: 'block', border: 0, padding: 0, background: 'transparent', cursor: 'pointer', maxWidth: '100%' }}>
        <img loading="lazy" src={`${articleImageUrl(block)}&retry=${attempt}`} alt={alt} onError={() => { setFailed(true) }} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
      </button>}
  </span>
}
export function ArkmeLongArticleBody({ text, blocks = [], textStyle }: { text: string; blocks?: ArkmeContentBlock[] | undefined; textStyle?: Pick<CSSProperties, 'fontSize' | 'lineHeight'> | undefined }) {
  useArkmeLocale()
  const [selected, setSelected] = useState<ArkmeContentBlock>()
  const images = blocks.filter(block => block.kind === 'image')
  return <>
    <ArkmeMarkdownBody text={text} textStyle={textStyle} renderImage={(ref, alt) => {
      const block = images.find(image => `arkme-asset:${image.fileAssetUid}` === ref)
      return block ? <ArticleImage key={block.mediaRef} block={block} alt={alt} onOpen={() => { setSelected(block) }} /> : undefined
    }} />
    {selected && <ArkmeMediaPreview blocks={images} selected={selected} onSelect={setSelected} onClose={() => { setSelected(undefined) }} />}
  </>
}
