import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export interface DictationTarget { insert(text: string): boolean; close(): void }
const anchors = new PluginKey<Map<string, number>>('arkmeDictationAnchors')
export const dictationAnchorExtension = Extension.create({
  name: 'arkmeDictationAnchors',
  addProseMirrorPlugins() {
    return [new Plugin({ key: anchors, state: {
      init: () => new Map<string, number>(),
      apply(tr, previous: Map<string, number>) {
        const next = new Map([...previous].map(([key, pos]) => [key, tr.mapping.map(pos, 1)]))
        const meta = tr.getMeta(anchors) as { add?: string; at?: number; remove?: string } | undefined
        if (meta?.add) next.set(meta.add, meta.at!)
        if (meta?.remove) next.delete(meta.remove)
        return next
      },
    } })]
  },
})

/** Position mapping preserves unrelated typing, headings, images, mentions, and undo. */
export function documentDictationTarget(editor: Editor, at = editor.state.selection.to): DictationTarget {
  const id = crypto.randomUUID()
  editor.view.dispatch(editor.state.tr.setMeta(anchors, { add: id, at }))
  let closed = false
  return {
    insert(text) {
      if (closed || editor.isDestroyed || !editor.isEditable) return false
      const pos = anchors.getState(editor.state)?.get(id)
      if (pos === undefined) return false
      if (!text) return true
      const previous = editor.state.doc
      editor.view.dispatch(editor.state.tr.insertText(text, pos))
      return previous !== editor.state.doc
    },
    close() { closed = true; if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(anchors, { remove: id })) },
  }
}

/** Plain editors cannot map rich transactions; rebase the insertion point through one text edit. */
export function mapDictationOffset(before: string, after: string, at: number): number {
  let start = 0, suffix = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  while (suffix < before.length - start && suffix < after.length - start && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  if (at < start) return at
  if (at <= before.length - suffix) return after.length - suffix
  return at + after.length - before.length
}

export function plainDictationTarget(options: { read(): string; at: number; write(text: string, caret: number): void; available(): boolean; maxLength: number }): DictationTarget {
  let before = options.read(), at = options.at, closed = false
  return { insert(text) {
    if (closed || !options.available()) return false
    const current = options.read()
    at = mapDictationOffset(before, current, at)
    if (current.length + text.length > options.maxLength) return false
    const next = current.slice(0, at) + text + current.slice(at)
    at += text.length; before = next
    options.write(next, at)
    return true
  }, close() { closed = true } }
}
