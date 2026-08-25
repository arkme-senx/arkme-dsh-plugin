export type WorldVoiceprintExpectationCopy = {
  prompt: string
  alternatePrompts: readonly string[]
}

export type WorldVoiceprintInviteCopyInput = {
  peerDisplayName: string
  inviteUrl: string
  textPreview?: string
  imageCount?: number
  videoCount?: number
  voiceCount?: number
  variantIndex?: number
}

export const WORLD_VOICEPRINT_INVITE_VARIANT_COUNT = 4

type ContentKind = 'unclear' | 'numeric' | 'short' | 'sad' | 'funny' | 'opinion' | 'travel'
  | 'food' | 'workStudy' | 'creative' | 'pet' | 'story' | 'warm' | 'useful' | 'default'

type ContentCopy = WorldVoiceprintExpectationCopy & {
  invitationReactions: readonly [string, string, string, string]
}

const contentCopies: Record<ContentKind, ContentCopy> = {
  unclear: {
    prompt: '有点看不懂，反而更想听TA怎么说',
    alternatePrompts: ['越看不懂，越想听TA亲口表达', '这段有点跳脱，想听TA怎么读'],
    invitationReactions: [
      '我有点没看懂，却不是想划走，反而更想听你亲口解释它是什么意思。',
      '这段像藏着一点只有你知道的意思，让我很好奇你会怎么说出来。',
      '它读起来有点跳脱，也正因为这样，我更想听见你自己的语气。',
      '我盯着这段看了一会儿，还是觉得由你亲口讲出来一定更明白。',
    ],
  },
  numeric: {
    prompt: '像一串暗号，想听TA怎么读',
    alternatePrompts: ['这串数字藏着什么，想听TA念出来', '看起来像个暗号，想听TA怎么解开'],
    invitationReactions: [
      '这串内容看起来像个小暗号，我很好奇它从你嘴里说出来会是什么语气。',
      '我看到它时忍不住猜了好一会儿，真想听你亲口把这个暗号解开。',
      '只有这些字符，反而给人留下了很多想象，我想听听你会怎么读。',
      '它越简短越让人好奇，感觉只有听你说出来才算完整。',
    ],
  },
  short: {
    prompt: '字不多，更想听TA怎么说',
    alternatePrompts: ['只有几个字，反而更好奇TA的语气', '话很短，想听TA会怎么念'],
    invitationReactions: [
      '你只写了短短几个字，反而让我更好奇你当时真正的语气。',
      '这句话很短，却挺有余味的，我很想听你亲口说一遍。',
      '字不多，但感觉里面还有没写出来的意思，想听听你会怎么表达。',
      '我看到这句时停了一下，总觉得带上你的声音会更有感觉。',
    ],
  },
  sad: {
    prompt: '文字里有些情绪，更想听见TA的语气',
    alternatePrompts: ['这段情绪藏在字里，想听TA怎么说', '有些感受看得见，也想听得见'],
    invitationReactions: [
      '读到这里有点心疼。文字能写下经历，但我更想听见你当时真正的语气。',
      '这段话里的情绪很真实，让我没有办法只把它当成普通文字划过去。',
      '看到这些话，我很想更认真地听你说说，而不只是隔着文字猜你的感受。',
      '有些心情写出来已经很不容易了，如果能听见你的声音，也许会更懂你。',
    ],
  },
  funny: {
    prompt: '这段很有画面，带上声音会更有趣',
    alternatePrompts: ['光看文字就有画面，想听TA怎么演绎', '这段有点好玩，想听TA会怎么说'],
    invitationReactions: [
      '光看文字就已经很有画面了，我开始好奇你亲口讲出来会有多好玩。',
      '我看到这里真的笑了一下，要是配上你的语气，感觉一定更有意思。',
      '这段太适合听你现场讲了，文字已经有趣，声音应该会更生动。',
      '你把这件事写得很有意思，我很想知道你说到这里时会是什么语气。',
    ],
  },
  opinion: {
    prompt: '这段很有态度，想听TA怎么说',
    alternatePrompts: ['观点写在字里，也想听见TA的语气', '这几句话很有主张，想听TA亲口说'],
    invitationReactions: [
      '这个想法很有你的态度，我很想听你亲口说出来时的语气和停顿。',
      '你的观点让我停下来想了想，也让我好奇你会怎样当面讲清楚它。',
      '这几句话很有主张，不只是想看文字，也想听你完整地表达一次。',
      '我能从字里看到你的判断，但还是很想听见这份态度本来的声音。',
    ],
  },
  travel: {
    prompt: '这段旅途很有画面，想听TA亲口讲',
    alternatePrompts: ['风景写进文字里，也想听TA说出来', '这段经历，让人想听见沿途的心情'],
    invitationReactions: [
      '你写的这段经历特别有画面感，我读完真的很想听你亲口讲讲当时的见闻。',
      '看到这些沿途的片段，我好像也跟着走了一小段，很想听听你当时的心情。',
      '这段旅途被你写得很有感觉，如果配上你的讲述，应该会更像身临其境。',
      '我很喜欢你记录风景的方式，也开始期待从你的声音里再走一遍这段路。',
    ],
  },
  food: {
    prompt: '这份味道写得很诱人，想听TA聊聊',
    alternatePrompts: ['光看就有点馋，想听TA亲口安利', '这段吃喝日常，也想听见TA的满足'],
    invitationReactions: [
      '你写得我都有点馋了，很想听你亲口讲讲它到底有多好吃。',
      '光看这段分享就能想象到味道，如果听你安利，应该会更有感染力。',
      '这份吃喝日常很有生活气，我好奇你说起它时是不是也会忍不住开心。',
      '你把这份味道写得很诱人，我真的很想听到你的现场评价。',
    ],
  },
  workStudy: {
    prompt: '这段思考很认真，想听TA展开说说',
    alternatePrompts: ['字里有不少思考，也想听TA讲明白', '这段成长和复盘，值得被亲口说出来'],
    invitationReactions: [
      '这段记录里有很多认真思考，我很想听你用自己的方式再展开讲讲。',
      '能看出你在这件事上花了不少心思，我也很好奇你一路是怎么想过来的。',
      '这份复盘很真诚，文字说清了结果，我还想听见你经历过程时的感受。',
      '你的思路让我很受启发，如果由你亲口讲出来，应该会更清楚也更有力量。',
    ],
  },
  creative: {
    prompt: '这份创作有自己的味道，想听TA聊聊',
    alternatePrompts: ['作品被看见了，也想听见背后的想法', '这份表达不只有画面，也该有声音'],
    invitationReactions: [
      '这份表达很有你自己的味道，我不只想看作品，也想听你聊聊背后的想法。',
      '我很喜欢你记录和创作的方式，也开始好奇你会怎样介绍它。',
      '作品已经让人停下来看了，如果再听见你的讲述，感觉会更完整。',
      '这段内容有很鲜明的个人感觉，我想听听你创作它时真正想表达什么。',
    ],
  },
  pet: {
    prompt: '这份可爱很有画面，想听TA聊聊',
    alternatePrompts: ['小家伙被记录下来，也想听TA的宠爱', '光看就很可爱，想听TA亲口分享'],
    invitationReactions: [
      '这个小家伙也太可爱了，我很想听你亲口讲讲它平时是什么样子。',
      '看得出来你很喜欢它，照片和文字之外，我也想听见你说起它时的语气。',
      '这份可爱让我忍不住多看了一会儿，感觉听你分享一定更有意思。',
      '你记录它的方式很温柔，我也开始期待听你聊聊你们之间的小故事。',
    ],
  },
  story: {
    prompt: '这个故事，也让人想听见',
    alternatePrompts: ['故事写下来了，也想听TA讲出来', '这段像在讲故事，想听TA亲口说'],
    invitationReactions: [
      '这段经历读起来像一个有画面的故事，我很想听你亲口把它讲出来。',
      '你写下来的这些细节让我跟着看了进去，也开始好奇你的真实语气。',
      '故事写在这里已经很动人，如果听你亲自讲，感觉会离它更近一点。',
      '我读完还在想后面的画面，很想听你用自己的声音把这段经历补完整。',
    ],
  },
  warm: {
    prompt: '这段很温柔，带上声音会更完整',
    alternatePrompts: ['文字里有温度，想听TA怎么说', '这份温柔，也想从TA的声音里听见'],
    invitationReactions: [
      '这段文字很温柔，我也很想从你的声音里听见这份温度。',
      '读到这里心里会松一下，如果由你亲口说出来，应该会更治愈。',
      '你的表达让人觉得很舒服，我开始期待听见你说这些话时的声音。',
      '这份温柔不该只停在文字里，我很想听你亲自把它说出来。',
    ],
  },
  useful: {
    prompt: '这段分享，听起来可能更容易懂',
    alternatePrompts: ['这段很有用，想听TA讲得更明白', '不只想看这段分享，也想听TA说'],
    invitationReactions: [
      '这段分享很有用，我也很想听你用自己的方式再讲一遍。',
      '你整理得很清楚，看完之后还会想听你补充那些文字没展开的细节。',
      '这个方法让我觉得很受用，如果听你亲口解释，应该会更容易记住。',
      '能感受到你是真心想把经验分享出来，我也很期待听见你的讲解。',
    ],
  },
  default: {
    prompt: '想让这段文字带上TA的声音',
    alternatePrompts: ['这段话如果有声音，会是什么感觉', '看见了TA的文字，也想听见TA的声音'],
    invitationReactions: [
      '这段话让我停下来多看了一会儿，也开始好奇，如果由你亲口说出来会是什么感觉。',
      '我不是只想看完就划过去，而是真的很想听听你当时是怎样说这些话的。',
      '文字让我看见了你的表达，也让我开始期待它带上属于你的声音。',
      '看到这条快记时，我第一反应就是：如果能听见你亲口说，应该会更有感觉。',
    ],
  },
}

const categoryKeywords: Readonly<Record<Exclude<ContentKind, 'unclear' | 'numeric' | 'short' | 'default'>, readonly string[]>> = {
  sad: ['难过', '悲伤', '遗憾', '绝望', '失去', '离开', '哭', '痛苦', '疲惫', '好难', '难熬'],
  funny: ['哈哈', '笑死', '搞笑', '好玩', '有趣', '逗'],
  opinion: ['我觉得', '我认为', '观点', '想法', '其实', '应该', '不能'],
  travel: ['旅行', '旅途', '出发', '风景', '景色', '海边', '爬山', '城市', '远方', '路上', '散步'],
  food: ['好吃', '美食', '餐厅', '咖啡', '甜品', '味道', '烤肉', '火锅', '做饭'],
  workStudy: ['工作', '项目', '学习', '论文', '考试', '复盘', '成长', '加班', '研究', '产品'],
  creative: ['摄影', '音乐', '电影', '读书', '作品', '创作', '设计', '照片', '画画'],
  pet: ['小猫', '小狗', '猫咪', '狗狗', '宠物', '毛孩子'],
  useful: ['教程', '方法', '步骤', '经验', '分享', '建议', '怎么做'],
  warm: ['温柔', '治愈', '希望', '拥抱', '阳光', '安慰'],
  story: ['曾经', '后来', '那年', '小时候', '有一天', '今天', '昨天', '故事'],
}

const invitationClosings: readonly [string, string, string, string] = [
  '如果你愿意，来录入一下声纹吧。以后再看到你的世界快记，我也能直接听见你的声音：',
  '愿意的话，也来录入声纹，给这条快记添上你的声音吧。我很期待以后不只看到文字，也能听见你：',
  '所以想认真邀请你录入声纹。这样下次在世界遇见你的文字，也能听到你亲口表达：',
  '要是你愿意，就来留下声纹吧。以后你的世界快记不只有文字，也会有属于你的声音：',
]

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
  const copy = contentCopies[worldVoiceprintContentKind(rawText)]
  const prompts = [copy.prompt, ...copy.alternatePrompts]
  return { ...copy, prompt: prompts[normalizedVariant(variantIndex, prompts.length)]! }
}

export function buildWorldVoiceprintInviteMessage(input: WorldVoiceprintInviteCopyInput): string {
  const preview = input.textPreview?.replace(whitespace, ' ').trim()
  const variant = normalizedVariant(input.variantIndex ?? 0, WORLD_VOICEPRINT_INVITE_VARIANT_COUNT)
  const copy = contentCopies[worldVoiceprintContentKind(preview ?? '')]
  const name = input.peerDisplayName.replace(whitespace, ' ').trim()
  const greeting = name === '' || name === '这位用户'
    ? '我是看到你在世界发的这条快记才来找你的：'
    : `${name}，我是看到你在世界发的这条快记才来找你的：`
  const media = mediaSummary(input)
  const quoted = preview === undefined || preview === ''
    ? `（你发布了一条${media === '' ? '' : `${media}的`}世界快记）`
    : `“${preview}”${media === '' ? '' : `\n（还包含${media}）`}`
  return `${greeting}\n\n【来自世界的快记】\n${quoted}\n\n${copy.invitationReactions[variant]}\n\n${invitationClosings[variant]}\n${input.inviteUrl}`
}

function mediaSummary(input: Pick<WorldVoiceprintInviteCopyInput, 'imageCount' | 'videoCount' | 'voiceCount'>): string {
  const parts: string[] = []
  if ((input.imageCount ?? 0) > 0) parts.push(`${String(Math.trunc(input.imageCount!))}张图片`)
  if ((input.videoCount ?? 0) > 0) parts.push(`${String(Math.trunc(input.videoCount!))}段视频`)
  if ((input.voiceCount ?? 0) > 0) parts.push(`${String(Math.trunc(input.voiceCount!))}段语音`)
  return parts.join('、')
}

function normalizedVariant(value: number, count: number): number {
  if (!Number.isFinite(value)) return 0
  return ((Math.trunc(value) % count) + count) % count
}

function worldVoiceprintContentKind(rawText: string): ContentKind {
  const text = worldVoiceprintReadableText(rawText).toLowerCase()
  const meaningful = text.match(meaningfulCharacter) ?? []
  if (meaningful.length === 0) return 'unclear'
  if (looksNumericOrFormula(text, meaningful)) return 'numeric'
  if (looksUnclear(text, meaningful)) return 'unclear'
  if (meaningful.length <= 6) return 'short'
  return bestMatchingCategory(text) ?? 'default'
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

function bestMatchingCategory(text: string): Exclude<ContentKind, 'unclear' | 'numeric' | 'short' | 'default'> | undefined {
  let bestCategory: Exclude<ContentKind, 'unclear' | 'numeric' | 'short' | 'default'> | undefined
  let bestScore = 0
  for (const [category, keywords] of Object.entries(categoryKeywords) as Array<[
    Exclude<ContentKind, 'unclear' | 'numeric' | 'short' | 'default'>,
    readonly string[],
  ]>) {
    const score = keywords.filter(keyword => text.includes(keyword)).length
    if (score > bestScore) {
      bestCategory = category
      bestScore = score
    }
  }
  return bestCategory
}
