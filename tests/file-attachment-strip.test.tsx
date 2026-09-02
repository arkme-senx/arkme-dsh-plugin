import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeAttachmentStrip, ArkmeFilePreparingIndicator } from '../src/client/ArkmeAttachmentStrip.js'
import { arkmeClipboardFiles } from '../src/client/ArkmeSidebar.js'
import type { ArkmeComposerAttachment } from '../src/client/composer-draft-store.js'

const attachments: ArkmeComposerAttachment[] = ['a.pdf', 'b.txt'].map((fileName, index) => ({ localFile: {
  fileRef: `arkme-file-v1.00000000-0000-4000-8000-00000000000${index + 1}`,
  fileName, fileKind: 4, mimeType: 'application/octet-stream', size: 10,
} }))

describe('client-aligned attachment strip', () => {
  it('supports drag order and keyboard order without extra arrow buttons', async () => {
    const onMove = vi.fn(); const onRemove = vi.fn(); const onPreview = vi.fn(); let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeAttachmentStrip attachments={attachments} disabled={false} onMove={onMove} onRemove={onRemove} onPreview={onPreview} />) })
    const items = view.root.findAllByProps({ role: 'listitem' })
    expect(items).toHaveLength(2)
    const event = { dataTransfer: { setData: vi.fn(), effectAllowed: '' }, preventDefault: vi.fn(), stopPropagation: vi.fn() }
    await act(async () => { items[1]!.props.onDragStart(event); items[0]!.props.onDrop(event) })
    expect(onMove).toHaveBeenCalledWith(1, 0)
    await act(async () => items[0]!.props.onKeyDown({ ...event, altKey: true, key: 'ArrowRight' }))
    expect(onMove).toHaveBeenLastCalledWith(0, 1)
    await act(async () => view.root.findByProps({ 'aria-label': '预览 a.pdf' }).props.onClick())
    expect(onPreview).toHaveBeenCalledWith(attachments[0])
    await act(async () => view.root.findByProps({ 'aria-label': '移除a.pdf' }).props.onClick())
    expect(onRemove).toHaveBeenCalledWith(attachments[0])
    expect(view.root.findAllByType('button')).toHaveLength(4) // Only preview and remove per file.
    await act(async () => view.unmount())
  })
  it('disallows ordering during preparation or send acceptance', async () => {
    const onMove = vi.fn(); let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeAttachmentStrip attachments={attachments} disabled onMove={onMove} onRemove={() => {}} onPreview={() => {}} />) })
    const item = view.root.findAllByProps({ role: 'listitem' })[0]!
    expect(item.props.draggable).toBe(false)
    const event = { preventDefault: vi.fn(), altKey: true, key: 'ArrowRight' }
    await act(async () => { item.props.onDragStart(event); item.props.onKeyDown(event) })
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(onMove).not.toHaveBeenCalled()
    await act(async () => view.unmount())
  })
  it('prefers pasted-file bytes for image previews and shows an explicit image error when decoding fails', async () => {
    const image: ArkmeComposerAttachment = {
      localFile: {
        fileRef: 'arkme-file-v1.00000000-0000-4000-8000-000000000003',
        fileName: 'clipboard.png', fileKind: 1, mimeType: 'image/png', size: 10,
      },
      previewUrl: 'blob:clipboard-preview',
    }
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeAttachmentStrip attachments={[image]} disabled={false} onMove={() => {}} onRemove={() => {}} onPreview={() => {}} />) })
    const preview = view.root.findByType('img')
    expect(preview.props.src).toBe('blob:clipboard-preview')
    await act(async () => { preview.props.onError() })
    expect(view.root.findAllByType('img').filter(image => image.props.src === 'blob:clipboard-preview')).toHaveLength(0)
    expect(view.root.findByProps({ 'aria-label': '附件 clipboard.png' }).props['data-arkme-attachment-tile']).toBe('image-error')
    expect(view.root.findByProps({ role: 'status', 'aria-label': 'clipboard.png 图片预览失败' })).toBeTruthy()
    await act(async () => view.unmount())
  })
  it('shows a local preparation spinner, with no cloud-upload text', async () => {
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFilePreparingIndicator />) })
    expect(view.root.findByProps({ role: 'progressbar' }).props['aria-label']).toBe('正在准备附件')
    expect(view.root.findByType('animateTransform').props.repeatCount).toBe('indefinite')
    expect(JSON.stringify(view.toJSON())).not.toContain('保存')
    await act(async () => view.unmount())
  })
  it('imports ordinary clipboard files as well as images through the same path', () => {
    const pdf = new File(['pdf'], 'a.pdf', { type: 'application/pdf' })
    const image = new File(['png'], 'a.png', { type: 'image/png' })
    expect(arkmeClipboardFiles({ files: [pdf, image] as unknown as FileList, items: [] as unknown as DataTransferItemList })).toEqual([pdf, image])
    expect(arkmeClipboardFiles({ files: [] as unknown as FileList, items: [{ kind: 'string', getAsFile: () => null }, { kind: 'file', getAsFile: () => pdf }] as unknown as DataTransferItemList })).toEqual([pdf])
  })
})
