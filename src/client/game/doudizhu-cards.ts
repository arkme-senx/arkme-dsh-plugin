// Within each rank card IDs increase in clubs, diamonds, hearts, spades order.
export type Kind = 'single' | 'pair' | 'triple' | 'tripleSingle' | 'triplePair' |
  'straight' | 'pairRun' | 'plane' | 'planeSingles' | 'planePairs' |
  'fourSingles' | 'fourPairs' | 'bomb' | 'rocket'
export interface Pattern { kind: Kind; high: number; length: number }

export function rank(card: number) {
  return card < 52 ? Math.floor(card / 4) : card - 39
}

interface Shape { kind: Kind; width: number; length: number; wings: number; pairWings?: boolean }
function shapes(size: number): Shape[] {
  const result: Shape[] = []
  function add(kind: Kind, width: number, length = 1, wings = 0, pairWings = false) {
    if (width * length + wings * (pairWings ? 2 : 1) <= size)
      result.push({ kind, width, length, wings, pairWings })
  }
  add('single', 1)
  add('pair', 2)
  add('triple', 3)
  add('tripleSingle', 3, 1, 1)
  add('triplePair', 3, 1, 1, true)
  for (let n = 5; n <= 12; n++) add('straight', 1, n)
  for (let n = 3; n <= 10; n++) add('pairRun', 2, n)
  for (let n = 2; n <= 6; n++) {
    add('plane', 3, n)
    add('planeSingles', 3, n, n)
    add('planePairs', 3, n, n, true)
  }
  add('fourSingles', 4, 1, 2)
  add('fourPairs', 4, 1, 2, true)
  add('bomb', 4)
  return result
}

export function beats(candidate: Pattern, target: Pattern): boolean {
  if (target.kind === 'rocket') return false
  if (candidate.kind === 'rocket') return true
  if (candidate.kind === 'bomb' && target.kind !== 'bomb') return true
  return candidate.kind === target.kind && candidate.length === target.length && candidate.high > target.high
}

function groups(cards: readonly number[]) {
  if (new Set(cards).size !== cards.length || cards.some(c => !Number.isInteger(c) || c < 0 || c > 53))
    throw new Error('牌编号无效或重复')
  const buckets: number[][] = Array.from({ length: 15 }, () => [])
  for (const c of [...cards].sort((a,b) => a-b)) buckets[rank(c)]!.push(c)
  return buckets
}

// For each rank choice use its lowest suits. Equivalent suits always beat the same targets.
function enumerate(cards: readonly number[], target: Pattern | null, exact: boolean) {
  const buckets = groups(cards)
  const result: { cards: number[]; pattern: Pattern }[] = []
  for (const s of shapes(cards.length)) {
    if (exact && s.width * s.length + s.wings * (s.pairWings ? 2 : 1) !== cards.length) continue
    const limit = s.length === 1 ? 15 : 12
    for (let start = 0; start + s.length <= limit; start++) {
      const end = start + s.length
      const body = buckets.slice(start, end)
      if (body.some(b => b.length < s.width)) continue
      const pattern = { kind: s.kind, length: s.length, high: end - 1 }
      if (target && !beats(pattern, target)) continue
      const chosen = body.flatMap(b => b.slice(0,s.width))
      function attach(from: number, left: number, selected: number[]) {
        if (!left) { result.push({ cards: selected, pattern }); return }
        for (let r = from; r < 15; r++) {
          if (r >= start && r < end) continue
          const unit = s.pairWings ? 2 : 1
          const max = Math.min(left, s.pairWings ? 1 : left, Math.floor(buckets[r]!.length / unit))
          for (let count = 1; count <= max; count++)
            attach(r + 1, left - count, [...selected, ...buckets[r]!.slice(0,count * unit)])
        }
      }
      attach(0,s.wings,chosen)
    }
  }
  const rocket: Pattern = { kind: 'rocket', length: 1, high: 14 }
  if ((!exact || cards.length === 2) && buckets[13]!.length && buckets[14]!.length && (!target || beats(rocket,target)))
    result.push({ cards: [52,53], pattern: rocket })
  return result
}

// A naked plane takes precedence, then the interpretation with the highest body.
function compareInterpretations(a: Pattern, b: Pattern) {
  return Number(b.kind === 'plane') - Number(a.kind === 'plane') || b.high - a.high
}

export function classify(cards: readonly number[], target: Pattern | null = null): Pattern | null {
  const choices = enumerate(cards,target,true)
  choices.sort((a,b) => compareInterpretations(a.pattern,b.pattern))
  return choices[0]?.pattern ?? null
}

export function legalPlays(hand: readonly number[], target: Pattern | null = null): number[][] {
  const byCards = new Map<string,{ cards: number[]; pattern: Pattern }>()
  const order: Kind[] = ['single','pair','triple','tripleSingle','triplePair','straight','pairRun',
    'plane','planeSingles','planePairs','fourSingles','fourPairs','bomb','rocket']
  for (const candidate of enumerate(hand,target,false)) {
    const key = [...candidate.cards].sort((a,b) => a-b).join(',')
    const prior = byCards.get(key)
    if (!prior || compareInterpretations(candidate.pattern,prior.pattern) < 0)
      byCards.set(key,candidate)
  }
  const candidates = [...byCards.values()]
  candidates.sort(({pattern:a},{pattern:b}) =>
    order.indexOf(a.kind) - order.indexOf(b.kind) || a.high - b.high || a.length - b.length)
  return candidates.map(candidate => candidate.cards)
}
