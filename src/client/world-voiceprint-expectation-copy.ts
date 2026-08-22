export type WorldVoiceprintExpectationCopy = {
  prompt: string
  alternatePrompts: readonly string[]
}

const unclearCopy: WorldVoiceprintExpectationCopy = {
  prompt: '有点看不懂，反而更想听TA怎么说',
  alternatePrompts: ['越看不懂，越想听TA亲口表达', '这段有点跳脱，想听TA怎么读'],
}

const numericCopy: WorldVoiceprintExpectationCopy = {
  prompt: '像一串暗号，想听TA怎么读',
  alternatePrompts: ['这串数字藏着什么，想听TA念出来', '看起来像个暗号，想听TA怎么解开'],
}

const shortCopy: WorldVoiceprintExpectationCopy = {
  prompt: '字不多，更想听TA怎么说',
  alternatePrompts: ['只有几个字，反而更好奇TA的语气', '话很短，想听TA会怎么念'],
}

const sadCopy: WorldVoiceprintExpectationCopy = {
  prompt: '文字里有些情绪，更想听见TA的语气',
  alternatePrompts: ['这段情绪藏在字里，想听TA怎么说', '有些感受看得见，也想听得见'],
}

const funnyCopy: WorldVoiceprintExpectationCopy = {
  prompt: '这段很有画面，带上声音会更有趣',
  alternatePrompts: ['光看文字就有画面，想听TA怎么演绎', '这段有点好玩，想听TA会怎么说'],
}

const opinionCopy: WorldVoiceprintExpectationCopy = {
  prompt: '这段很有态度，想听TA怎么说',
  alternatePrompts: ['观点写在字里，也想听见TA的语气', '这几句话很有主张，想听TA亲口说'],
}

const storyCopy: WorldVoiceprintExpectationCopy = {
  prompt: '这个故事，也让人想听见',
  alternatePrompts: ['故事写下来了，也想听TA讲出来', '这段像在讲故事，想听TA亲口说'],
}

const warmCopy: WorldVoiceprintExpectationCopy = {
  prompt: '这段很温柔，带上声音会更完整',
  alternatePrompts: ['文字里有温度，想听TA怎么说', '这份温柔，也想从TA的声音里听见'],
}

const usefulCopy: WorldVoiceprintExpectationCopy = {
  prompt: '这段分享，听起来可能更容易懂',
  alternatePrompts: ['这段很有用，想听TA讲得更明白', '不只想看这段分享，也想听TA说'],
}

const defaultCopy: WorldVoiceprintExpectationCopy = {
  prompt: '想让这段文字带上TA的声音',
  alternatePrompts: ['这段话如果有声音，会是什么感觉', '看见了TA的文字，也想听见TA的声音'],
}

const categoryKeywords = {
  sad: ['难过', '悲伤', '遗憾', '绝望', '失去', '离开', '哭', '痛苦'],
  funny: ['哈哈', '笑死', '搞笑', '好玩', '有趣', '逗'],
  opinion: ['我觉得', '我认为', '观点', '想法', '其实', '应该', '不能'],
  useful: ['教程', '方法', '步骤', '经验', '分享', '建议', '怎么做'],
  warm: ['温柔', '治愈', '希望', '拥抱', '阳光', '安慰'],
  story: ['曾经', '后来', '那年', '小时候', '有一天', '今天', '昨天', '故事'],
} as const

type ContentCategory = keyof typeof categoryKeywords

const categoryCopies: Record<ContentCategory, WorldVoiceprintExpectationCopy> = {
  sad: sadCopy,
  funny: funnyCopy,
  opinion: opinionCopy,
  useful: usefulCopy,
  warm: warmCopy,
  story: storyCopy,
}

const urlPattern = /(?:(?:https?|ftp):\/\/|www\.)[^\s，。！？；：、"“”‘’（）【】《》<>]+/gi
const trailingUrlPunctuation = /[.,;:!?，。；：！？）)\]}>…]+$/
const whitespace = /\s+/g
const meaningfulCharacter = /[\p{L}\p{N}]/gu
const digitCharacter = /\p{N}/u
const latinCharacter = /[a-z]/i
const chineseCharacter = /[\u3400-\u9fff]/
const mathSymbol = /[+\-×÷*/=<>]/

export function worldVoiceprintReadableText(value: string): string {
  const withoutUrls = value.replace(urlPattern, matchedUrl => matchedUrl.match(trailingUrlPunctuation)?.[0] ?? '')
  const normalized = withoutUrls.replace(/<>/g, ' ').replace(whitespace, ' ').trim()
  return /[\p{L}\p{N}]/u.test(normalized) ? normalized : ''
}

export function resolveWorldVoiceprintExpectationCopy(rawText: string, variantIndex = 0): WorldVoiceprintExpectationCopy {
  const text = worldVoiceprintReadableText(rawText).toLowerCase()
  const meaningful = text.match(meaningfulCharacter) ?? []
  let copy: WorldVoiceprintExpectationCopy
  if (meaningful.length === 0) copy = unclearCopy
  else if (looksNumericOrFormula(text, meaningful)) copy = numericCopy
  else if (looksUnclear(text, meaningful)) copy = unclearCopy
  else if (meaningful.length <= 6) copy = shortCopy
  else {
    const category = bestMatchingCategory(text)
    copy = category === undefined ? defaultCopy : categoryCopies[category]
  }

  const prompts = [copy.prompt, ...copy.alternatePrompts]
  const normalizedIndex = variantIndex < 0 ? 0 : variantIndex
  return { ...copy, prompt: prompts[normalizedIndex % prompts.length]! }
}

function looksNumericOrFormula(text: string, meaningful: string[]): boolean {
  const digitCount = meaningful.filter(character => digitCharacter.test(character)).length
  if (digitCount === 0) return false
  if (mathSymbol.test(text)) return true
  return digitCount / meaningful.length >= 0.7
}

function looksUnclear(text: string, meaningful: string[]): boolean {
  const uniqueCharacters = new Set(meaningful)
  if (meaningful.length >= 5 && uniqueCharacters.size === 1) return true
  if (meaningful.length >= 8 && uniqueCharacters.size <= 2) return true
  const hasChinese = chineseCharacter.test(text)
  const hasLatin = latinCharacter.test(text)
  const hasDigit = digitCharacter.test(text)
  return !hasChinese && hasLatin && hasDigit && !text.includes(' ')
}

function bestMatchingCategory(text: string): ContentCategory | undefined {
  let bestCategory: ContentCategory | undefined
  let bestScore = 0
  for (const [category, keywords] of Object.entries(categoryKeywords) as Array<[ContentCategory, readonly string[]]>) {
    const score = keywords.filter(keyword => text.includes(keyword)).length
    if (score > bestScore) {
      bestCategory = category
      bestScore = score
    }
  }
  return bestCategory
}
