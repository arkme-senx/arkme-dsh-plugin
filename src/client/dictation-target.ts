import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export interface DictationTarget { insert(text: string): boolean; replace(text: string): boolean; close(): void }
interface Range { from: number; to: number }
const anchors = new PluginKey<Map<string, Range>>('arkmeDictationAnchors')
export const dictationAnchorExtension = Extension.create({
  name: 'arkmeDictationAnchors',
  addProseMirrorPlugins() {
    return [new Plugin({ key: anchors, state: {
      init: () => new Map<string, Range>(),
      apply(tr, previous: Map<string, Range>) {
        const next = new Map([...previous].map(([key, pos]) => {
          const from = tr.mapping.map(pos.from, 1), to = tr.mapping.map(pos.to, -1)
          return [key, { from, to: Math.max(from, to) }] as const
        }))
        const meta = tr.getMeta(anchors) as { add?: string; range?: Range; remove?: string } | undefined
        if (meta?.add) next.set(meta.add, meta.range!)
        if (meta?.remove) next.delete(meta.remove)
        return next
      },
    } })]
  },
})

/** Map both ends; refuse to overwrite text the user edited inside the live hypothesis. */
export function documentDictationTarget(editor: Editor, at = editor.state.selection.to): DictationTarget {
  const id = crypto.randomUUID()
  editor.view.dispatch(editor.state.tr.setMeta(anchors, { add: id, range: { from: at, to: at } }))
  let closed = false, last = ''
  const replace = (text: string) => {
    if (closed || editor.isDestroyed || !editor.isEditable) return false
    const range = anchors.getState(editor.state)?.get(id)
    if (!range || editor.state.doc.textBetween(range.from, range.to, '\n', '\uFFFC') !== last) return false
    if (text === last) return true
    const previous = editor.state.doc
    const tr = text ? editor.state.tr.insertText(text, range.from, range.to) : editor.state.tr.delete(range.from, range.to)
    editor.view.dispatch(tr.setMeta(anchors, { add: id, range: { from: range.from, to: range.from + text.length } }))
    if (previous === editor.state.doc) return false
    last = text; return true
  }
  return {
    insert: text => replace(last + text), replace,
    close() { closed = true; if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(anchors, { remove: id })) },
  }
}

/** Plain editors rebase the live range through one text edit. */
export function mapDictationOffset(before: string, after: string, at: number): number {
  let start = 0, suffix = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  while (suffix < before.length - start && suffix < after.length - start && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  if (at < start) return at
  if (at <= before.length - suffix) return after.length - suffix
  return at + after.length - before.length
}

export function plainDictationTarget(options: { read(): string; at: number; write(text: string, caret: number): void; available(): boolean; maxLength: number }): DictationTarget {
  let before = options.read(), from = options.at, to = options.at, closed = false, last = ''
  const replace = (text: string) => {
    if (closed || !options.available()) return false
    const current = options.read()
    if (current !== before) {
      const wrappedAt = before ? current.indexOf(before) : -1
      if (wrappedAt >= 0 && current.lastIndexOf(before) === wrappedAt) { from += wrappedAt; to += wrappedAt }
      else {
      let prefix = 0, suffix = 0
      while (prefix < before.length && prefix < current.length && before[prefix] === current[prefix]) prefix++
      while (suffix < before.length - prefix && suffix < current.length - prefix && before[before.length - 1 - suffix] === current[current.length - 1 - suffix]) suffix++
      const oldEnd = before.length - suffix
      if (oldEnd <= from) { const delta = current.length - before.length; from += delta; to += delta }
      else if (prefix < to) return false
      }
      before = current
    }
    if (current.slice(from, to) !== last || current.length - last.length + text.length > options.maxLength) return false
    const next = current.slice(0, from) + text + current.slice(to)
    to = from + text.length; before = next; last = text
    options.write(next, to); return true
  }
  return { insert: text => replace(last + text), replace, close() { closed = true } }
}
