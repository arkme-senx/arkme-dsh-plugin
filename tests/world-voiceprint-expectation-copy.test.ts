import { describe, expect, it } from 'vitest'
import { resolveWorldVoiceprintExpectationCopy, worldVoiceprintReadableText } from '../src/client/world-voiceprint-expectation-copy.js'

describe('World voiceprint expectation copy', () => {
  it('changes with the post content category', () => {
    const prompts = [
      resolveWorldVoiceprintExpectationCopy('今天真的很难过，留下了很多遗憾。').prompt,
      resolveWorldVoiceprintExpectationCopy('哈哈，这件事也太搞笑了！').prompt,
      resolveWorldVoiceprintExpectationCopy('我觉得这件事不能只看结果。').prompt,
      resolveWorldVoiceprintExpectationCopy('分享一个整理照片的方法：https://example.com/guide').prompt,
    ]

    expect(new Set(prompts)).toHaveLength(4)
    expect(prompts).toEqual([
      '文字里有些情绪，更想听见TA的语气',
      '这段很有画面，带上声音会更有趣',
      '这段很有态度，想听TA怎么说',
      '这段分享，听起来可能更容易懂',
    ])
  })

  it('uses the same low-information fallbacks as mobile', () => {
    expect(resolveWorldVoiceprintExpectationCopy('333331a').prompt).toBe('像一串暗号，想听TA怎么读')
    expect(resolveWorldVoiceprintExpectationCopy('1+1=2').prompt).toBe('像一串暗号，想听TA怎么读')
    expect(resolveWorldVoiceprintExpectationCopy('晚安').prompt).toBe('字不多，更想听TA怎么说')
    expect(resolveWorldVoiceprintExpectationCopy('啊啊啊啊啊啊').prompt).toBe('有点看不懂，反而更想听TA怎么说')
  })

  it('rotates three prompts inside the same category when reopened', () => {
    const prompts = new Set(Array.from({ length: 3 }, (_value, index) => resolveWorldVoiceprintExpectationCopy('333331a', index).prompt))

    expect(prompts).toHaveLength(3)
    expect([...prompts].every(prompt => !prompt.endsWith('。') && !prompt.endsWith('.'))).toBe(true)
  })

  it('prefers the strongest content category', () => {
    expect(resolveWorldVoiceprintExpectationCopy('今天分享一个照片整理教程和实用方法。').prompt).toBe('这段分享，听起来可能更容易懂')
  })

  it('removes links while keeping surrounding text and punctuation', () => {
    expect(worldVoiceprintReadableText('看看这个 https://example.com/path?a=1 然后告诉我')).toBe('看看这个 然后告诉我')
    expect(worldVoiceprintReadableText('正文https://example.com/path。')).toBe('正文。')
    expect(worldVoiceprintReadableText('[链接名称](https://example.com)')).toBe('[链接名称]()')
    expect(worldVoiceprintReadableText('https://example.com')).toBe('')
  })
})
