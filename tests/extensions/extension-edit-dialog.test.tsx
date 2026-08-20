import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeExtensionEditDialog } from '../../src/client/ArkmeExtensionEditDialog.js'
import { ArkmeExtensionAvatarCropDialog } from '../../src/client/ArkmeExtensionAvatarCropDialog.js'
import { ArkmeExtensionPublishDialog } from '../../src/client/ArkmeExtensionPublishDialog.js'

const published = {
  ownedRef: 'owned-ref', name: '天气助手', description: '天气卡片', states: ['published'] as const,
  halves: { host: true, client: false },
  published: {
    extensionId: 'ext-1', version: '1.0.0', visibility: 'private' as const,
    iconRef: `icon_v1_${'a'.repeat(64)}`,
  },
  publish: { allowed: false, reason: '该扩展已发布' },
}

describe('extension metadata dialogs', () => {
  it('renders an explicit square crop step with zoom and confirmation controls', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionAvatarCropDialog
      sourceFile={new File([new Uint8Array([1])], 'source.heic', { type: 'image/heic' })}
      onCancel={() => {}}
      onConfirm={() => {}}
    />)
    expect(html).toContain('裁剪扩展头像')
    expect(html).toContain('aria-label="头像缩放"')
    expect(html).toContain('type="range"')
    expect(html).toContain('width:280px')
    expect(html).toContain('height:280px')
    expect(html).toContain('>取消</button>')
    expect(html).toContain('>确认裁剪</button>')
  })

  it('renders a Bot-style avatar editor with metadata fields only', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionEditDialog
      item={published}
      busy={false}
      error=""
      onCancel={() => {}}
      onSubmit={() => {}}
    />)

    expect(html).toContain('编辑扩展')
    expect(html).toContain('aria-label="更换扩展头像"')
    expect(html).toContain('width:64px')
    expect(html).toContain('border-radius:50%')
    expect(html).toContain('accept="image/*"')
    expect(html).toContain('display:none')
    expect(html).toContain('>扩展头像<')
    expect(html).toContain('选择后可手动裁剪')
    expect(html).toContain('>保存</button>')
    expect(html).toContain('<option value="private" selected="">仅自己</option>')
    expect(html).not.toContain('<option value="unlisted"')
    expect(html).not.toContain('>版本<')
    expect(html).not.toContain('更新说明')
  })

  it('requires historical unlisted extensions to choose a supported visibility before saving', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionEditDialog
      item={{ ...published, published: { ...published.published, visibility: 'unlisted' } }}
      busy={false}
      error=""
      onCancel={() => {}}
      onSubmit={() => {}}
    />)
    expect(html).toContain('该历史可见范围已隐藏')
    expect(html).toContain('<option value="" selected="">请选择可见范围</option>')
    expect(html).toContain('disabled="">保存</button>')
  })

  it('reuses the hidden Bot-style avatar field in the publish form', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionPublishDialog
      item={{
        ownedRef: 'owned-new', name: '新扩展', description: '', states: ['cordis'],
        halves: { host: true, client: false }, cordis: { packageCount: 1, active: true },
        publish: { allowed: true, mode: 'new' },
      }}
      busy={false}
      error=""
      onCancel={() => {}}
      onSubmit={() => {}}
    />)
    expect(html).toContain('aria-label="更换扩展头像"')
    expect(html).toContain('accept="image/*"')
    expect(html).toContain('display:none')
    expect(html).toContain('>版本<')
    expect(html).toContain('更新说明')
  })
})
