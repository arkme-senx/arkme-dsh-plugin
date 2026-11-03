import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { codexPromptDisplayText, codexPromptText } from '../src/team-codex-prompt-text.js'
import { codexImageSafeText } from '../src/team-codex-image-text.js'

const vectors = JSON.parse(readFileSync(new URL('./fixtures/codex-response-annotations-v1.json', import.meta.url), 'utf8')) as {name:string;kind:string;input:string;expected:string}[]
describe('response annotation display protocol shared with Team',()=>{
  it.each(vectors)('$name',vector=>{
    const content=codexImageSafeText(vector.kind==='UserPromptSubmit'?codexPromptText(vector.input):vector.input)
    expect(vector.kind==='UserPromptSubmit'?codexPromptDisplayText(content):content).toBe(vector.expected)
  })
})
