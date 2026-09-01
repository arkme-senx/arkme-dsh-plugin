import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeWorkbenchDirectoryEntry } from '../src/workbench-extension-client.js'

describe('workbench extension client', () => {
  it('renders as an independent entry in the Arkme conversation directory', () => {
    const activateEntry = vi.fn()
    const markup = renderToStaticMarkup(<ArkmeWorkbenchDirectoryEntry
      activeEntryId={undefined}
      activateEntry={activateEntry}
      wide authenticated
      renderRow={props => <button type="button" onClick={props.onClick}>{props.title}<small>{props.preview}</small></button>}
    />)
    expect(markup).toContain('>工作台<')
    expect(markup).toContain('>我的本地资料库<')
  })
})
