import { describe, expect, it } from 'vitest'
import { parseGroupConsistency, parseSpeakerSimilarity, speakerGroupConsistencyLabel } from '../src/speaker-similarity-contract.js'
import { person } from './helpers/speaker-directory.js'
const group = () => ({ state: 'ready', score: 93, analyzed_count: 20, total_count: 20, review_count: 0 })
const response = () => ({ supported: true, schema_version: 1, metric: 'cosine_distance', state: 'ready', version: 'v1', model_version: 'model', aggregation: 'robust-v1', score_definition: 'cohesion-v1', anchor: 'a', anchor_consistency: group(), searched_count: 100, total_count: 1000,
  items: [{ person: 'b', distance: .12, consistency: group(), reason: '测试证据' }], has_more: false, next_cursor: '' })
const parse = (value: unknown) => parseSpeakerSimilarity(value, raw => person(String(raw)))
describe('similar speaker evidence contract', () => {
  it('separates group consistency, inter-group distance, and incomplete search coverage', () => {
    expect(parse(response())).toMatchObject({ searchedCount: 100, totalCount: 1000, anchorConsistency: { score: 93 }, items: [{ distance: .12, consistency: { score: 93 } }] })
    expect(parse({ supported: false })).toEqual({ supported: false })
    expect(speakerGroupConsistencyLabel(undefined)).toBe('待计算')
    expect(speakerGroupConsistencyLabel(parseGroupConsistency({ ...group(), state: 'partial', analyzed_count: 10 }))).toBe('93（局部）')
    expect(() => parseGroupConsistency({ ...group(), state: 'insufficient' })).toThrow()
  })
  it.each(['metric', 'model', 'score', 'nan-distance', 'range', 'coverage', 'duplicate', 'self', 'cursor', 'building-rows', 'false-complete', 'definition'])('rejects %s evidence', kind => {
    const raw = response()
    if (kind === 'metric') raw.metric = 'similarity'
    if (kind === 'model') raw.model_version = ''
    if (kind === 'score') raw.anchor_consistency.score = 101
    if (kind === 'nan-distance') raw.items[0]!.distance = NaN
    if (kind === 'range') raw.items[0]!.distance = -1
    if (kind === 'coverage') raw.searched_count = 1001
    if (kind === 'duplicate') raw.items.push(raw.items[0]!)
    if (kind === 'self') raw.items[0]!.person = 'a'
    if (kind === 'cursor') raw.has_more = true
    if (kind === 'building-rows') raw.state = 'building'
    if (kind === 'false-complete') raw.anchor_consistency.analyzed_count = 10
    if (kind === 'definition') raw.score_definition = ''
    expect(() => parse(raw)).toThrow()
  })
})
