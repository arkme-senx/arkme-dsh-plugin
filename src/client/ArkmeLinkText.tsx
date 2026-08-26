import { Fragment, type CSSProperties, type ReactNode } from 'react'
import { arkmeTheme } from './arkme-theme.js'
import { textLinkRuns } from './text-link-parser.js'

const linkStyle: CSSProperties = { color: arkmeTheme.info, textDecoration: 'underline', textUnderlineOffset: 2 }

export function ArkmeLinkText({ text, renderText }: { text: string; renderText?: (text: string) => ReactNode }) {
  return <>{textLinkRuns(text).map((run, index) => run.kind === 'link'
    ? <a
      key={`${String(index)}:link:${run.href}`}
      href={run.href}
      target="_blank"
      rel="noopener noreferrer"
      style={linkStyle}
      data-arkme-text-link="true"
    >{run.text}</a>
    : <Fragment key={`${String(index)}:text`}>{renderText === undefined ? run.text : renderText(run.text)}</Fragment>)}</>
}
