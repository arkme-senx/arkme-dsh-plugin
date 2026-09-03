import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { LinkIcon } from '@phosphor-icons/react/dist/csr/Link'
import { arkmeIsGenericLinkMetadataTitle } from '../link-metadata.js'
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
const rawLinkLabelStyle: CSSProperties = {
  minWidth: 0,
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  whiteSpace: 'normal',
}
const resolvedLinkLabelStyle: CSSProperties = {
  ...rawLinkLabelStyle,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

export const ARKME_LINK_FALLBACK_LABEL = '分享链接'
export type ArkmeLinkLabelMode = 'raw' | 'resolved'

function arkmeResolvedLinkTitle(title: string | undefined, href: string): string {
  const trimmed = title?.trim() ?? ''
  return !arkmeIsGenericLinkMetadataTitle(trimmed) && trimmed !== href ? trimmed : ''
}

export function ArkmeTextLink({ href, text, linkLabelMode = 'resolved', fallbackLabel = ARKME_LINK_FALLBACK_LABEL, metadataResolver = arkmeLinkMetadataResolver }: {
  href: string
  text: string
  linkLabelMode?: ArkmeLinkLabelMode
  fallbackLabel?: string
  metadataResolver?: ArkmeLinkMetadataResolver
}) {
  const [title, setTitle] = useState('')
  const shouldResolve = linkLabelMode === 'resolved' && arkmeShouldResolveLinkMetadata(href)

  useEffect(() => {
    let active = true
    setTitle('')
    if (!shouldResolve) return () => { active = false }
    void metadataResolver.resolve(href)
      .then(metadata => {
        if (active) setTitle(arkmeResolvedLinkTitle(metadata?.title, href))
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [href, metadataResolver, shouldResolve])

  const resolved = linkLabelMode === 'resolved' && title !== ''
  const fallback = shouldResolve && !resolved
  const label = resolved ? title : fallback ? fallbackLabel : text
  return <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    title={resolved || fallback ? href : undefined}
    style={linkPresentationStyle}
    data-arkme-text-link="true"
    data-arkme-link-title={resolved ? 'resolved' : fallback ? 'fallback' : 'raw'}
  >
    <LinkIcon aria-hidden style={linkIconStyle} data-arkme-link-icon="true" />
    <span
      style={resolved || fallback ? resolvedLinkLabelStyle : rawLinkLabelStyle}
      data-arkme-link-label="true"
    >{label}</span>
  </a>
}

export function ArkmeLinkText({ text, renderText, renderLink, linkLabelMode = 'resolved', metadataResolver = arkmeLinkMetadataResolver, fallbackLabel = ARKME_LINK_FALLBACK_LABEL }: {
  text: string
  renderText?: (text: string) => ReactNode
  renderLink?: ArkmeLinkRenderer
  linkLabelMode?: ArkmeLinkLabelMode
  metadataResolver?: ArkmeLinkMetadataResolver
  fallbackLabel?: string
}) {
  return <>{textLinkRuns(text).map((run, index) => {
    if (run.kind === 'text') {
      return <Fragment key={`${String(index)}:text`}>
        {renderText === undefined ? run.text : renderText(run.text)}
      </Fragment>
    }
    const projection = renderLink?.(run)
    return <Fragment key={`${String(index)}:link:${run.href}`}>
      {projection === undefined ? <ArkmeTextLink
        href={run.href}
        text={run.text}
        linkLabelMode={linkLabelMode}
        fallbackLabel={fallbackLabel}
        metadataResolver={metadataResolver}
      /> : projection}
    </Fragment>
  })}</>
}

export type ArkmeLinkRenderer = (link: Readonly<{ text: string; href: string }>) => ReactNode | undefined
