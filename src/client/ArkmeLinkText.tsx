import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { LinkIcon } from '@phosphor-icons/react/dist/csr/Link'
import { arkmeTheme } from './arkme-theme.js'
import {
  arkmeLinkMetadataResolver,
  arkmeShouldResolveLinkMetadata,
  type ArkmeLinkMetadataResolver,
} from './link-metadata-client.js'
import { textLinkRuns } from './text-link-parser.js'

const linkPresentationStyle: CSSProperties = {
  color: arkmeTheme.info,
  textDecoration: 'underline',
  textUnderlineOffset: 2,
  minWidth: 0,
  maxWidth: '100%',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  verticalAlign: 'text-bottom',
}
const linkIconStyle: CSSProperties = { width: 16, height: 16, flex: 'none' }
const rawLinkLabelStyle: CSSProperties = { minWidth: 0 }
const resolvedLinkLabelStyle: CSSProperties = {
  ...rawLinkLabelStyle,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

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
    style={linkPresentationStyle}
    data-arkme-text-link="true"
    data-arkme-link-title={resolved ? 'resolved' : 'raw'}
  >
    <LinkIcon aria-hidden style={linkIconStyle} data-arkme-link-icon="true" />
    <span
      style={resolved ? resolvedLinkLabelStyle : rawLinkLabelStyle}
      data-arkme-link-label="true"
    >{resolved ? title : text}</span>
  </a>
}

export function ArkmeLinkText({ text, renderText, renderLink, metadataResolver = arkmeLinkMetadataResolver }: {
  text: string
  renderText?: (text: string) => ReactNode
  renderLink?: ArkmeLinkRenderer
  metadataResolver?: ArkmeLinkMetadataResolver
}) {
  return <>{textLinkRuns(text).map((run, index) => {
    if (run.kind === 'text') {
      return <Fragment key={`${String(index)}:text`}>
        {renderText === undefined ? run.text : renderText(run.text)}
      </Fragment>
    }
    const projection = renderLink?.(run)
    return <Fragment key={`${String(index)}:link:${run.href}`}>
      {projection === undefined ? <ArkmeResolvedTextLink
        href={run.href}
        text={run.text}
        metadataResolver={metadataResolver}
      /> : projection}
    </Fragment>
  })}</>
}

export type ArkmeLinkRenderer = (link: Readonly<{ text: string; href: string }>) => ReactNode | undefined
