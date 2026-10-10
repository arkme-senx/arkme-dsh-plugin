import type { ComponentType, ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { HARNESS_LAYOUT_MODULES, type HarnessLayoutPart } from '../harness-conversation-layout-contract.js'

export interface NativeWidthProps {
  side: 'left' | 'right'
  onStart(): number
  onDrag(width: number): void
  onCommit(width: number): void
  onEnd(): void
}
export interface NativeRailItem<Preview = string> {
  turn: number
  prompt: Preview
  response: Preview
  anchor: { kind: 'loaded'; key: string }
}
export interface NativeRailProps {
  items: readonly NativeRailItem<ReactNode>[]
  activeTurn: number | null
  busyTurn: number | null
  onNavigate(item: NativeRailItem<ReactNode>): void
  t(key: string, params?: { turn: number }): string
}
export interface HarnessConversationLayout {
  WidthHandle: ComponentType<NativeWidthProps>
  TurnNavigator: ComponentType<NativeRailProps>
  resolveContentWidth(column: number, preference: number | null): number
  rootClass: string
}

let load: (() => Promise<HarnessConversationLayout | undefined>) | undefined

export function installHarnessConversationLayoutLoader(ctx: ClientContext, doc: Document): () => void {
  let modules: { import(id: string): Promise<unknown> } | undefined
  try { modules = (ctx as unknown as { modules?: typeof modules }).modules }
  catch { return () => {} }
  if (typeof modules?.import !== 'function') return () => {}
  let pending: Promise<HarnessConversationLayout | undefined> | undefined
  const scripts = new Set<HTMLScriptElement>()
  const cancellations = new Set<() => void>()
  const importPart = (part: HarnessLayoutPart): Promise<unknown> => new Promise((resolve, reject) => {
    const spec = HARNESS_LAYOUT_MODULES[part]
    const script = doc.createElement('script')
    let finished = false
    const finish = (value?: unknown, error?: Error) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      script.onload = null; script.onerror = null
      script.remove(); scripts.delete(script); cancellations.delete(cancel)
      if (error) reject(error); else resolve(value)
    }
    const cancel = () => finish(undefined, new Error('Native layout load cancelled'))
    const timeout = setTimeout(cancel, 10_000)
    cancellations.add(cancel); scripts.add(script)
    script.src = spec.path; script.async = true
    script.onerror = () => finish(undefined, new Error('Native layout unavailable'))
    script.onload = () => { void Promise.resolve().then(() => modules!.import(spec.id)).then(value => finish(value), () => cancel()) }
    doc.head.append(script)
  })
  const loader = () => pending ??= Promise.all([importPart('width'), importPart('navigation')]).then(([widthValue, railValue]) => {
    const width = widthValue as { version?: number; WidthHandle?: unknown; resolveContentWidth?: unknown; classes?: { root?: unknown } }
    const rail = railValue as { version?: number; TurnNavigator?: unknown }
    if (width?.version !== 1 || rail?.version !== 1 || typeof width.WidthHandle !== 'function'
      || typeof width.resolveContentWidth !== 'function' || typeof width.classes?.root !== 'string'
      || !(typeof rail.TurnNavigator === 'function' || (rail.TurnNavigator && typeof rail.TurnNavigator === 'object'))) {
      throw new Error('Native layout interface changed')
    }
    return { WidthHandle: width.WidthHandle, TurnNavigator: rail.TurnNavigator,
      resolveContentWidth: width.resolveContentWidth, rootClass: width.classes.root } as HarnessConversationLayout
  }).catch(() => {
    console.warn('Arkme wide conversation unavailable; standard chat layout retained.')
    return undefined
  })
  load = loader
  return () => {
    if (load === loader) load = undefined
    for (const cancel of [...cancellations]) cancel()
    for (const script of scripts) script.remove()
  }
}

export function loadHarnessConversationLayout(): Promise<HarnessConversationLayout | undefined> {
  return load?.() ?? Promise.resolve(undefined)
}
