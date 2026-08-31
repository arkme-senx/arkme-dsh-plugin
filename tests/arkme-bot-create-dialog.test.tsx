import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))

import { ArkmeBotCreateDialog } from '../src/client/ArkmeBotCreateDialog.js'

function text(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : text(child)).join('')
}

function createButton(renderer: ReactTestRenderer): ReactTestInstance {
  const button = renderer.root.findAllByType('button').find(node => text(node) === '创建 Bot')
  if (button === undefined) throw new Error('create button not found')
  return button
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

describe('Arkme manual Bot create ownership', () => {
  let renderer: ReactTestRenderer | undefined

  beforeEach(() => {
    mocks.callArkme.mockReset()
  })

  afterEach(() => {
    renderer?.unmount()
    renderer = undefined
    vi.clearAllMocks()
  })

  it('keeps a manually created OpenClaw Bot on the existing Subject-owned path', async () => {
    const created = {
      botRef: 'bot-ref', name: '手动创建', provider: 'openclaw', description: '', status: 'offline',
      directChatAvailable: true, conversationProjection: 'record',
    }
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'bots.create') return created
      throw new Error(`unexpected operation ${operation}`)
    })

    await act(async () => {
      renderer = create(<ArkmeBotCreateDialog onClose={vi.fn()} />)
      await Promise.resolve()
    })
    const nameInput = renderer.root.findByProps({ placeholder: '给 Bot 起个名字' })
    await act(async () => { nameInput.props.onChange({ currentTarget: { value: '手动创建' } }) })
    await act(async () => { createButton(renderer!).props.onClick(); await Promise.resolve() })
    await flush()

    expect(mocks.callArkme).toHaveBeenCalledTimes(1)
    expect(mocks.callArkme).toHaveBeenCalledWith('bots.create', {
      name: '手动创建', provider: 'openclaw',
    })
  })
})
