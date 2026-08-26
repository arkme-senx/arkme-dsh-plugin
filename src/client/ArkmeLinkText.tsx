import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { arkmeTheme } from './arkme-theme.js'
import {
  arkmeLinkMetadataResolver,
  arkmeShouldResolveLinkMetadata,
  type ArkmeLinkMetadataResolver,
} from './link-metadata-client.js'
import { textLinkRuns } from './text-link-parser.js'

const linkStyle: CSSProperties = { color: arkmeTheme.info, textDecoration: 'underline', textUnderlineOffset: 2 }

function ArkmeResolvedTextLink({ href, text, metadataResolver }: {
  href: string
  text: string
  metadataResolver: ArkmeLinkMetadataResolver
}) {
  const [title, setTitle] = useState('')

  useEffect(() => {
    let active = true
    setTitle('')
    if (!arkmeShouldResolveLinkMetadata(href)) return () => { active = false }
    void metadataResolver.resolve(href)
      .then(metadata => {
        if (active) setTitle(metadata?.title.trim() ?? '')
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [href, metadataResolver])

  const resolved = title !== ''
  return <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    title={resolved ? href : undefined}
    style={linkStyle}
    data-arkme-text-link="true"
    data-arkme-link-title={resolved ? 'resolved' : 'raw'}
  >{resolved ? title : text}</a>
}

export function ArkmeLinkText({ text, renderText, metadataResolver = arkmeLinkMetadataResolver }: {
  text: string
  renderText?: (text: string) => ReactNode
  metadataResolver?: ArkmeLinkMetadataResolver
}) {
  return <>{textLinkRuns(text).map((run, index) => run.kind === 'link'
    ? <ArkmeResolvedTextLink
      key={`${String(index)}:link:${run.href}`}
      href={run.href}
      text={run.text}
      metadataResolver={metadataResolver}
    />
    : <Fragment key={`${String(index)}:text`}>{renderText === undefined ? run.text : renderText(run.text)}</Fragment>)}</>
}
