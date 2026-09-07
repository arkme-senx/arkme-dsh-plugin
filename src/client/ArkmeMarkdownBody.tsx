import { Children, isValidElement, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { arkmeLiteralMarkdownNodes, arkmeMarkdownBusinessNodes } from '../markdown.js'
import { ArkmeRichText, ArkmeMentionText } from './ArkmeRichText.js'
import type { ArkmeLinkRenderer } from './ArkmeLinkText.js'

function markdownLinkLabel(children: ReactNode): string {
  return Children.toArray(children).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child)
    return isValidElement<{ children?: ReactNode }>(child) ? markdownLinkLabel(child.props.children) : ''
  }).join('')
}

// Shared with the editor; styles are scoped to avoid changing the Harness page.
export const arkmeMarkdownStyles = `
.arkme-markdown { min-width:0; max-width:100%; overflow-wrap:anywhere; line-height:1.6; white-space:normal; }
.arkme-markdown p { margin:0 0 .45em; min-height:1em; }
.arkme-markdown > :last-child { margin-bottom:0; }
.arkme-markdown h1,.arkme-markdown h2,.arkme-markdown h3,.arkme-markdown h4,.arkme-markdown h5,.arkme-markdown h6 { margin:.6em 0 .3em; line-height:1.35; font-weight:650; }
.arkme-markdown h1 { font-size:1.5em; } .arkme-markdown h2 { font-size:1.3em; } .arkme-markdown h3 { font-size:1.15em; }
.arkme-markdown ul,.arkme-markdown ol { padding-left:1.5em; margin:.35em 0; }
.arkme-markdown ul { list-style:disc; } .arkme-markdown ol { list-style:decimal; }
.arkme-markdown li > p { margin:0; }
.arkme-markdown blockquote { margin:.4em 0; padding-left:.8em; border-left:3px solid var(--dsw-alias-border-secondary,#b9c1cb); color:var(--dsw-alias-label-secondary,#68707c); }
.arkme-markdown pre { max-width:100%; overflow-x:auto; padding:.7em; border-radius:6px; background:var(--dsw-alias-background-secondary,rgba(128,128,128,.1)); white-space:pre; overflow-wrap:normal; }
.arkme-markdown code { font-family:ui-monospace,monospace; font-size:.9em; background:var(--dsw-alias-background-secondary,rgba(128,128,128,.1)); border-radius:3px; padding:.08em .2em; }
.arkme-markdown pre code { padding:0; background:none; }
.arkme-markdown .arkme-markdown-table,.arkme-markdown .tableWrapper { max-width:100%; overflow-x:auto; }
.arkme-markdown table { border-collapse:collapse; margin:.4em 0; } .arkme-markdown th,.arkme-markdown td { border:1px solid var(--dsw-alias-border-secondary,#bdc3ca); padding:.3em .55em; min-width:5em; }
.arkme-markdown th { font-weight:600; background:var(--dsw-alias-background-secondary,rgba(128,128,128,.1)); }
.arkme-markdown input[type=checkbox] { margin-right:.5em; vertical-align:middle; }
.arkme-markdown .task-list-item { list-style:none; }
.arkme-markdown ul[data-type=taskList] { padding-left:0; list-style:none; }
.arkme-markdown li[data-type=taskItem],.arkme-markdown ul[data-type=taskList] > li { display:flex; align-items:baseline; gap:.4em; }
.arkme-markdown li[data-type=taskItem] > div,.arkme-markdown ul[data-type=taskList] > li > div { flex:1; min-width:0; }
.arkme-markdown a { color:var(--dsw-alias-state-business-primary,#3964fe); text-decoration:underline; }
.arkme-markdown .ProseMirror { outline:none; min-height:inherit; white-space:pre-wrap; }
.arkme-markdown .ProseMirror > :first-child { margin-top:0; }
`

export function ArkmeMarkdownBody({ text, highlightMentions = true, renderLink, collapse = false, textStyle }: {
  text: string
  highlightMentions?: boolean
  renderLink?: ArkmeLinkRenderer
  collapse?: boolean
  textStyle?: Pick<CSSProperties, 'fontSize' | 'lineHeight'> | undefined
}) {
  const body = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const height = 160
  useLayoutEffect(() => {
    const element = body.current
    if (element === null || !collapse) return
    const measure = () => setOverflow(element.scrollHeight > height + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text, collapse])
  const rich = (children: ReactNode) => Children.map(children, child => typeof child === 'string'
    ? <ArkmeRichText text={child} highlightMentions={highlightMentions} highlightTags={false} linkLabelMode="raw" {...(renderLink === undefined ? {} : { renderLink })} /> : child)
  return <div style={{ minWidth: 0, maxWidth: '100%' }} data-arkme-text-format="markdown">
    <style>{arkmeMarkdownStyles}</style>
    <div style={{ maxHeight: collapse && !expanded ? height : undefined, overflow: 'hidden' }}>
      <div ref={body} className="arkme-markdown" style={textStyle}>
        <Markdown remarkPlugins={[remarkGfm, remarkBreaks, arkmeMarkdownBusinessNodes, arkmeLiteralMarkdownNodes]} components={{
          span: ({ children, node }) => (node?.properties['data-arkme-markdown-run'] ?? node?.properties['dataArkmeMarkdownRun']) === 'tag' && highlightMentions
            ? <ArkmeMentionText text={String(children)} /> : <span>{rich(children)}</span>,
          p: ({ children }) => <p>{rich(children)}</p>,
          h1: ({ children }) => <h1>{rich(children)}</h1>, h2: ({ children }) => <h2>{rich(children)}</h2>,
          h3: ({ children }) => <h3>{rich(children)}</h3>, h4: ({ children }) => <h4>{rich(children)}</h4>,
          h5: ({ children }) => <h5>{rich(children)}</h5>, h6: ({ children }) => <h6>{rich(children)}</h6>,
          strong: ({ children }) => <strong>{rich(children)}</strong>, em: ({ children }) => <em>{rich(children)}</em>,
          del: ({ children }) => <del>{rich(children)}</del>, li: ({ children, className }) => <li className={className}>{rich(children)}</li>,
          td: ({ children, style }) => <td style={style}>{rich(children)}</td>, th: ({ children, style }) => <th style={style}>{rich(children)}</th>,
          table: ({ children }) => <div className="arkme-markdown-table"><table>{children}</table></div>,
          a: ({ children, href }) => {
            if (!href) return <span>{children}</span>
            const label = markdownLinkLabel(children)
            return renderLink?.({ href, text: label || href }) ?? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          },
          input: ({ checked }) => <input type="checkbox" checked={Boolean(checked)} disabled aria-label={checked ? '已完成' : '未完成'} />,
        }}>{text}</Markdown>
      </div>
    </div>
    {collapse && overflow && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
      style={{ border: 0, padding: '4px 0', background: 'none', color: 'var(--dsw-alias-state-business-primary,#3964fe)', cursor: 'pointer' }}>
      {expanded ? '收起' : '展开'}
    </button>}
  </div>
}
