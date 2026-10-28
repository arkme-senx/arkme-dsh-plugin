import { expect, it } from 'vitest'
import { createRecordingEntityUnderliner } from '../src/client/recordings/recording-entity-underlines.js'

const ranges = (text: string, names: string[]) => createRecordingEntityUnderliner(names.map(name => ({ key: name, name })))(text)

const marked = (text: string, names: string[]) => ranges(text, names).map(range =>
  Array.from(text).slice(range.start, range.start + range.length).join(''))

it('marks repeated names without requiring a selected occurrence and retains Unicode offsets', () => {
  const text = '🙂武汉欢迎你，武汉再见'
  expect(ranges(text, ['武汉'])).toEqual([{ start: 1, length: 2, entityKey: '武汉', name: '武汉' }, { start: 7, length: 2, entityKey: '武汉', name: '武汉' }])
  expect(marked('🙂武汉🙂，🙂再见', ['🙂'])).toEqual(['🙂', '🙂', '🙂'])
})

it('prefers longer overlapping names but keeps adjacent entity identities separate', () => {
  expect(marked('武汉市和长江大桥', ['武汉', '武汉市', '长江', '大桥', '武汉'])).toEqual(['武汉市', '长江', '大桥'])
  expect(ranges('长江大桥', ['长江', '大桥']).map(range => range.entityKey)).toEqual(['长江', '大桥'])
  expect(marked('哈哈哈', ['哈哈'])).toEqual(['哈哈哈'])
})

it('matches literal names and respects Latin word boundaries without excluding Chinese neighbors', () => {
  expect(marked('用AI做事，不是AIM；C++也行，a.b是名称', ['AI', 'C++', 'a.b'])).toEqual(['AI', 'C++', 'a.b'])
  expect(marked('10 100 210 名称10号', ['10'])).toEqual(['10', '10'])
  expect(marked('武汉', ['', '北京'])).toEqual([])
})

it('drops default underlines when the current day has no recognized names', () => {
  expect(ranges('武汉', [])).toEqual([])
})

it('uses list order for identical names and retains every covered character in crossing overlaps', () => {
  const underline = createRecordingEntityUnderliner([{ key: 'first', name: ' 武汉 ' }, { key: 'second', name: '武汉' }])
  expect(underline('武汉')).toEqual([{ start: 0, length: 2, entityKey: 'first', name: '武汉' }])
  expect(ranges('武汉大学生', ['武汉大学', '大学生'])).toEqual([
    { start: 0, length: 4, entityKey: '武汉大学', name: '武汉大学' },
    { start: 4, length: 1, entityKey: '大学生', name: '大学生' },
  ])
})

it('unions dense repeated matches without retaining one range per match', () => {
  expect(ranges('哈'.repeat(10_000), ['哈哈', '哈哈哈'])).toEqual([{ start: 0, length: 10_000, entityKey: '哈哈哈', name: '哈哈哈' }])
})
