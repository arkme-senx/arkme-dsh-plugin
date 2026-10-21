import { create, act, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it } from 'vitest'
import { ArkoMessageImages } from '../src/client/ArkoImageAttachments.js'
import type { ArkmeContentBlock } from '../src/types.js'

it('retains repeated image positions and exposes a retry after delivery failure', async () => {
  const block: ArkmeContentBlock = { kind: 'image', mediaRef: 'owned', fileAssetUid: 'uid', fileName: 'photo.png', mimeType: 'image/png', size: 10, sortOrder: 0 }
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<ArkoMessageImages blocks={[block, block]} />) })
  expect(renderer.root.findAllByType('img')).toHaveLength(2)
  await act(async () => { renderer.root.findAllByType('img')[0]!.props.onError() })
  expect(renderer.root.findAllByType('img')).toHaveLength(1)
  const retry = renderer.root.findAllByType('button').find(button => button.children.join('').includes('点击重试'))!
  expect(retry).toBeDefined()
  await act(async () => { retry.props.onClick({ stopPropagation() {} }) })
  expect(renderer.root.findAllByType('img')).toHaveLength(2)
  expect(renderer.root.findAllByType('img')[0]!.props.src).toContain('retry=1')
  await act(async () => { renderer.unmount() })
})
