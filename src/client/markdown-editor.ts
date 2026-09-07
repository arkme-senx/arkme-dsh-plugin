import { Extension, InputRule, Node, mergeAttributes, type Editor, type JSONContent } from '@tiptap/core'
import { decodeString } from 'micromark-util-decode-string'
import StarterKit from '@tiptap/starter-kit'
import CodeBlock from '@tiptap/extension-code-block'
import { TableKit } from '@tiptap/extension-table'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown } from '@tiptap/markdown'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Slice } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { ArkmeComposerEmoji, ArkmeComposerMention } from './composer-draft-store.js'
import { arkmeEmojiById } from './arkme-emoji.js'
import { arkmeEscapeMarkdownText, arkmeMarkdownEditorSource } from '../markdown.js'
import { arkmeHashTagRanges, arkmeHashTagTrigger } from '../hashtag.js'

export interface ArkmeMarkdownDraft {
  document: JSONContent
  source: string
  mentions: readonly ArkmeComposerMention[]
}

/** Paste uses the selection's context; code is literal and paragraph edges remain open. */
export function arkmePasteMarkdown(editor: Editor, source: string): void {
  const text = source.replace(/\r\n?/gu, '\n')
  if (editor.isActive('codeBlock') || editor.isActive('code') || text.trim() === '') {
    editor.view.dispatch(closeHistory(editor.state.tr).insertText(text).setMeta('uiEvent', 'paste'))
    return
  }
  const document = editor.schema.nodeFromJSON(editor.markdown!.parse(arkmeMarkdownEditorSource(text)))
  if (document.childCount === 1 && document.firstChild!.type.name === 'paragraph') {
    editor.chain().command(({ tr }) => { closeHistory(tr).setMeta('uiEvent', 'paste'); return true })
      .insertContent(document.firstChild!.toJSON().content ?? []).run()
    return
  }
  const paragraphs = document.content.content.every(node => node.type.name === 'paragraph')
  const slice = paragraphs ? Slice.maxOpen(document.content) : new Slice(document.content, 0, 0)
  editor.view.dispatch(closeHistory(editor.state.tr).replaceSelection(slice).setMeta('uiEvent', 'paste'))
}

const Mention = Node.create({
  name: 'arkmeMention', group: 'inline', inline: true, atom: true, selectable: false,
  addAttributes: () => ({ mention: { default: null }, markdownToken: { default: null } }),
  parseHTML: () => [{ tag: 'span[data-arkme-mention]' }],
  renderHTML: ({ node }) => ['span', { 'data-arkme-mention': '', style: 'color:var(--dsw-alias-state-business-primary,#3964fe)' }, `@${String(node.attrs.mention?.displayName ?? '')}`],
  renderText: ({ node }) => `@${String(node.attrs.mention?.displayName ?? '')}`,
  renderMarkdown: node => node.attrs?.markdownToken as string ?? arkmeEscapeMarkdownText(`@${String(node.attrs?.mention?.displayName ?? '')}`),
})

const Emoji = Node.create({
  name: 'arkmeEmoji', group: 'inline', inline: true, atom: true, selectable: false,
  addAttributes: () => ({ emojiId: { default: '' } }),
  parseHTML: () => [{ tag: 'span[data-arkme-editable-emoji]' }],
  renderHTML: ({ node, HTMLAttributes }) => {
    const emoji = arkmeEmojiById[String(node.attrs.emojiId)]
    return ['span', mergeAttributes(HTMLAttributes, { 'data-arkme-editable-emoji': node.attrs.emojiId, contenteditable: 'false' }),
      ['img', { src: emoji?.assetUrl ?? '', alt: emoji?.label ?? '', draggable: 'false', style: 'width:1.45em;height:1.45em;vertical-align:-.34em;display:inline-block' }]]
  },
  renderText: () => '\uFFFC',
  renderMarkdown: node => arkmeEmojiById[String(node.attrs?.emojiId)]?.token ?? '',
  markdownTokenizer: {
    name: 'arkmeEmoji', level: 'inline', start: source => source.indexOf('[jm_emoji:'),
    tokenize: source => {
      const match = /^\[(?:jm_emoji|im_emoji):[^\]\r\n]+\]/u.exec(source)
      if (!match) return undefined
      const emoji = Object.values(arkmeEmojiById).find(item => item.token === match[0])
      return emoji === undefined ? undefined : { type: 'arkmeEmoji', raw: match[0], emojiId: emoji.id }
    },
  },
  parseMarkdown: token => ({ type: 'arkmeEmoji', attrs: { emojiId: token.emojiId } }),
})

// Tiptap's default text parser decodes only a subset of HTML entities.
const Entities = Extension.create({
  name: 'arkmeEntity',
  markdownTokenizer: {
    name: 'arkmeEntity', level: 'inline', start: source => source.indexOf('&'),
    tokenize: source => {
      const match = /^&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);/iu.exec(source)
      return match ? { type: 'arkmeEntity', raw: match[0], text: decodeString(match[0]) } : undefined
    },
  },
  parseMarkdown: token => ({ type: 'text', text: token.text ?? '' }),
})

const QuickNoteCodeBlock = CodeBlock.extend({
  renderMarkdown: (node, helpers) => {
    const language = String(node.attrs?.language ?? '')
    const text = helpers.renderChildren(node.content ?? [])
    // Backticks cannot occur in a backtick fence's info string.
    const marker = language.includes('`') ? '~' : '`'
    let length = 3
    for (const match of text.matchAll(marker === '`' ? /`+/gu : /~+/gu)) {
      length = Math.max(length, match[0].length + 1)
    }
    const fence = marker.repeat(length)
    return `${fence}${language}\n${text}\n${fence}`
  },
})

// Keep StarterKit's extension order so the writer override does not reorder key handlers.
const QuickNoteStarterKit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map(extension => extension.name === 'codeBlock'
      ? QuickNoteCodeBlock.configure(extension.options) : extension)
  },
})

const QuickNoteTaskItem = TaskItem.extend({
  addInputRules() {
    return [new InputRule({
      find: /^\s*\[([ xX])\]\s$/u,
      handler: ({ range, match, chain, state }) => {
        for (let depth = state.selection.$from.depth; depth > 0; depth--) if (state.selection.$from.node(depth).type.name === 'taskItem') return null
        // '- ' already became a bullet list. Change its type before wrapping the task item.
        chain().deleteRange(range).toggleList('taskList', 'taskItem').updateAttributes('taskItem', { checked: match[1]?.toLowerCase() === 'x' }).run()
      },
    })]
  },
})

// Decorations preserve plain tag text in Markdown, undo history and IME composition.
const HashTags = Extension.create({
  name: 'arkmeHashTags',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('arkmeHashTags'),
      props: {
        decorations(state) {
          const decorations: Decoration[] = []
          state.doc.descendants((block, position) => {
            if (!block.isTextblock) return true
            if (block.type.name === 'codeBlock') return false
            let text = ''
            // Mask non-text and protected marks with terminators, retaining ProseMirror offsets.
            block.forEach(child => {
              text += child.isText && !child.marks.some(mark => mark.type.name === 'code' || mark.type.name === 'link')
                ? child.text! : '\n'.repeat(child.nodeSize)
            })
            // Autolink marks arrive after whitespace; protect URLs while they are still being typed.
            const urls = [...text.matchAll(/(?:https?:\/\/|www\.)[^\s<>()]+/giu)]
            const allowed = (start: number) => {
              let escapes = 0
              for (let index = start - 1; index >= 0 && text[index] === '\\'; index--) escapes++
              return escapes % 2 === 0 && !urls.some(url => start >= url.index && start < url.index + url[0].length)
            }
            const ranges = arkmeHashTagRanges(text).filter(tag => allowed(tag.startIndex))
            const { $from, empty } = state.selection
            const active = empty && $from.parent === block ? arkmeHashTagTrigger(text, $from.parentOffset) : undefined
            if (active?.query === '' && allowed(active.startIndex) && !ranges.some(tag => tag.startIndex === active.startIndex)) {
              ranges.push({ tag: '', startIndex: active.startIndex, length: 1 })
            }
            for (const range of ranges) {
              decorations.push(Decoration.inline(position + 1 + range.startIndex, position + 1 + range.startIndex + range.length, {
                'data-arkme-editable-tag': 'true',
                style: 'color:var(--dsw-alias-state-business-primary,#3964fe)',
              }))
            }
            return false
          })
          return DecorationSet.create(state.doc, decorations)
        },
      },
    })]
  },
})

export function arkmeMarkdownExtensions() {
  return [
    QuickNoteStarterKit.configure({ underline: false, trailingNode: false, link: { openOnClick: false, autolink: true, markdownLinks: true } }),
    TableKit.configure({ table: { resizable: false } }), TaskList, QuickNoteTaskItem.configure({ nested: true }),
    Mention, Emoji, Entities, HashTags, Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
  ]
}

/** Shift+Enter is our paragraph break, so it must also complete the opening code fence. */
export function arkmeCompleteMarkdownCodeFence(editor: Editor): boolean {
  const { $from, empty } = editor.state.selection
  if (!empty || $from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size || editor.isActive('table')) return false
  const match = /^ {0,3}(?:`{3,}|~{3,})([\w+-]*)[ \t]*$/u.exec($from.parent.textContent)
  if (!match) return false
  return editor.chain().deleteRange({ from: $from.start(), to: $from.end() }).setCodeBlock(match[1] ? { language: match[1] } : undefined).run()
}

/** Completing a GFM delimiter row converts the two paragraphs in one undoable transaction. */
export function arkmeCompleteMarkdownTable(editor: Editor): boolean {
  const { $from, empty } = editor.state.selection
  if (!empty || $from.depth !== 1 || $from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size) return false
  const index = $from.index(0)
  if (index === 0 || !/^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/u.test($from.parent.textContent)) return false
  const header = editor.state.doc.child(index - 1)
  if (header.type.name !== 'paragraph' || !header.textContent.trimStart().startsWith('|')) return false
  const parsed = editor.markdown!.parse(`${header.textContent}\n${$from.parent.textContent}`)
  const table = parsed.content?.[0]
  const heading = table?.content?.[0]
  if (table?.type !== 'table' || !heading?.content?.length) return false
  table.content = [heading, { type: 'tableRow', content: heading.content.map(cell => ({
    type: 'tableCell', attrs: cell.attrs, content: [{ type: 'paragraph' }],
  })) }]
  const node = editor.schema.nodeFromJSON(table)
  const from = $from.before() - header.nodeSize
  return editor.chain().insertContentAt({ from, to: $from.after() }, table).setTextSelection(from + node.child(0).nodeSize + 4).run()
}

/** A visible-text coordinate space for the existing pickers, never used as a wire mention offset. */
export function arkmeEditorProjection(doc: ProseMirrorNode) {
  let text = ''
  const positions: number[] = []
  const mentions: ArkmeComposerMention[] = []
  const emojis: ArkmeComposerEmoji[] = []
  let blocks = 0
  doc.descendants((block, position) => {
    if (!block.isTextblock) return true
    if (blocks++ > 0) { text += '\n'; positions.push(position + 1) }
    else positions.push(position + 1)
    block.forEach((node, offset) => {
      const start = position + 1 + offset
      let value = node.text ?? ''
      if (node.type.name === 'hardBreak') value = '\n'
      if (node.type.name === 'arkmeMention') {
        value = `@${String(node.attrs.mention?.displayName ?? '')}`
        mentions.push({ ...node.attrs.mention as ArkmeComposerMention, startIndex: text.length, length: value.length })
      }
      if (node.type.name === 'arkmeEmoji') { value = '\uFFFC'; emojis.push({ emojiId: String(node.attrs.emojiId), startIndex: text.length }) }
      text += value
      for (let index = 1; index <= value.length; index++) positions.push(node.isText ? start + index : index === value.length ? start + node.nodeSize : start)
    })
    return false
  })
  const indexAt = (position: number) => {
    for (let index = 0; index < positions.length; index++) if (positions[index]! >= position) return index
    return text.length
  }
  return { text, positions, mentions, emojis, indexAt }
}

export function arkmeEditorInlineContent(text: string, mentions: readonly ArkmeComposerMention[], emojis: readonly ArkmeComposerEmoji[], offset = 0): JSONContent[] {
  const atoms = [
    ...mentions.map(mention => ({ start: mention.startIndex, length: mention.length, node: { type: 'arkmeMention', attrs: { mention } } as JSONContent })),
    ...emojis.map(emoji => ({ start: emoji.startIndex, length: 1, node: { type: 'arkmeEmoji', attrs: { emojiId: emoji.emojiId } } as JSONContent })),
  ].filter(atom => atom.start >= offset && atom.start + atom.length <= offset + text.length).sort((a, b) => a.start - b.start)
  const result: JSONContent[] = []
  let cursor = 0
  for (const atom of atoms) {
    const start = atom.start - offset
    if (start < cursor) continue
    if (start > cursor) result.push({ type: 'text', text: text.slice(cursor, start) })
    result.push(atom.node)
    cursor = start + atom.length
  }
  if (cursor < text.length) result.push({ type: 'text', text: text.slice(cursor) })
  return result
}

export function arkmePlainEditorDocument(text: string, mentions: readonly ArkmeComposerMention[] = [], emojis: readonly ArkmeComposerEmoji[] = []): JSONContent {
  let offset = 0
  return { type: 'doc', content: text.split('\n').map(line => {
    const paragraph = { type: 'paragraph', content: arkmeEditorInlineContent(line, mentions, emojis, offset) }
    offset += line.length + 1
    return paragraph
  }) }
}

/** Serialize first, then locate each atom in the final UTF-16 Markdown source. */
export function arkmeSerializeMarkdownEditor(editor: Editor, document = editor.getJSON()): ArkmeMarkdownDraft {
  const serializable = structuredClone(document)
  const tokens = new Map<string, ArkmeComposerMention>()
  const literals = new Map<string, string>()
  const prefix = `\uE000arkme-${crypto.randomUUID()}-`
  const protect = (value: string) => {
    const token = `${prefix}literal${literals.size}\uE001`
    literals.set(token, value)
    return token
  }
  const visit = (node: JSONContent, parent?: JSONContent, index = 0) => {
    if (node.type === 'arkmeMention' && node.attrs) {
      const token = `${prefix}${tokens.size}\uE001`
      tokens.set(token, node.attrs.mention as ArkmeComposerMention)
      node.attrs.markdownToken = token
    }
    if (node.type === 'text' && node.text && parent?.type !== 'codeBlock' && !node.marks?.some(mark => mark.type === 'code')) {
      // Tiptap's Markdown encoder escapes inline delimiters, but not block prefixes or table pipes.
      node.text = node.text.replace(/\|/gu, () => protect('\\|'))
      if (index === 0 || parent?.content?.[index - 1]?.type === 'hardBreak') {
        node.text = node.text.replace(/^(?: {4,}|\t[ \t]*)/u, whitespace => protect(whitespace.replace(/ /gu, '&#32;').replace(/\t/gu, '&#9;')))
        node.text = node.text.replace(/^( {0,3})(#{1,6}(?=\s|$)|[-+](?=\s|$)|\d+[.)](?=\s)|=+(?=\s|$)|-{2,}(?=\s|$))/u,
          (_match, spaces: string, marker: string) => spaces + protect(marker.replace(/[#+.\-=)]/gu, '\\$&')))
      }
    }
    node.content?.forEach((child, childIndex) => visit(child, node, childIndex))
  }
  visit(serializable)
  const encoded = editor.markdown!.serialize(serializable)
  const pattern = new RegExp(`${prefix}\\d+\uE001`, 'gu')
  const mentions: ArkmeComposerMention[] = []
  let source = ''
  let cursor = 0
  for (const match of encoded.matchAll(pattern)) {
    source += encoded.slice(cursor, match.index)
    const mention = tokens.get(match[0])!
    const value = arkmeEscapeMarkdownText(`@${mention.displayName}`)
    mentions.push({ ...mention, startIndex: source.length, length: value.length })
    source += value
    cursor = match.index + match[0].length
  }
  source += encoded.slice(cursor)
  // Literal tokens precede mentions in source; rebase ranges while replacing them.
  for (const [token, value] of literals) {
    const start = source.indexOf(token)
    if (start < 0) continue
    source = source.slice(0, start) + value + source.slice(start + token.length)
    for (const mention of mentions) if (mention.startIndex > start) mention.startIndex += value.length - token.length
  }
  return { document, source, mentions }
}
