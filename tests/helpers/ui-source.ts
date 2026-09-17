import { readFileSync } from 'node:fs'

/** Structural assertions predate localization. Normalize only fixed UI-copy
 * wrappers; dynamic expressions and all behavior remain unchanged. Language
 * switching is exercised separately against mounted components. */
export function normalizeUiSource(source: string): string {
  return source
    .replace(/get (label|title|description|tabLabel)\(\) \{ return tr\("([^"\n]*)"\) \}/g, "$1: '$2'")
    .replace(/(\b(?:aria-label|title|label|description|actionLabel|placeholder|alt))=\{tr\(("[^"\n]*"|'[^'\n]*')\)\}/g,
      (_all, prop: string, literal: string) => `${prop}="${literal.slice(1, -1)}"`)
    .replace(/\{tr\("([^"\n]*)"\)\}/g, '$1')
    .replace(/tr\("([^"\n]*)"\)/g, "'$1'")
    .replace(/label: \(\) => tr\('([^'\n]*)'\)/g, "label: '$1'")
}

export function readUiSource(path: string | URL, encoding: 'utf8'): string {
  return normalizeUiSource(readFileSync(path, encoding))
}
