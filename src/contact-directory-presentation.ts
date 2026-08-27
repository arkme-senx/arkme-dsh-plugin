import { pinyin } from 'pinyin-pro'

import type { ArkmeDirectoryItem } from './types.js'

type ArkmeDirectoryContactItem = Extract<ArkmeDirectoryItem, { kind: 'contact' }>

export interface ArkmeDirectoryContactGroup {
  letter: string
  items: ArkmeDirectoryContactItem[]
}

export interface ArkmeUnmarkedSpeakerDisplayNameInput {
  speakerToken: string
  firstSeenDate: string
  lastSeenDate: string
}

const contactDirectoryCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
const CONTACT_DIRECTORY_LETTERS = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index))

function contactDirectorySortName(item: ArkmeDirectoryContactItem): string {
  return item.remark.trim()
    || item.nickname.trim()
    || item.accountName?.trim()
    || item.displayName.trim()
}

function strictStringCompare(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

export function contactDirectoryLetter(item: ArkmeDirectoryContactItem): string {
  const first = pinyin(contactDirectorySortName(item), {
    pattern: 'first',
    toneType: 'none',
    type: 'array',
  })[0]?.toUpperCase()
  return first !== undefined && /^[A-Z]$/.test(first) ? first : '#'
}

export function sortContactDirectoryItems(items: ArkmeDirectoryContactItem[]): ArkmeDirectoryContactItem[] {
  return [...items].sort((left, right) => contactDirectoryCollator.compare(contactDirectorySortName(left), contactDirectorySortName(right))
    || contactDirectoryCollator.compare(left.contactRef, right.contactRef)
    || strictStringCompare(left.contactRef, right.contactRef))
}

export function groupContactDirectoryItems(items: ArkmeDirectoryContactItem[]): ArkmeDirectoryContactGroup[] {
  const grouped = new Map<string, ArkmeDirectoryContactItem[]>()
  for (const item of sortContactDirectoryItems(items)) {
    const letter = contactDirectoryLetter(item)
    const group = grouped.get(letter)
    if (group === undefined) grouped.set(letter, [item])
    else group.push(item)
  }
  return [...CONTACT_DIRECTORY_LETTERS, '#']
    .flatMap(letter => {
      const itemsForLetter = grouped.get(letter)
      return itemsForLetter === undefined ? [] : [{ letter, items: itemsForLetter }]
    })
}

export function unmarkedSpeakerDisplayName(input: ArkmeUnmarkedSpeakerDisplayNameInput): string {
  return input.firstSeenDate === input.lastSeenDate
    ? `${input.firstSeenDate} · 当天说话人 ${input.speakerToken}`
    : `说话人 ${input.speakerToken}`
}
