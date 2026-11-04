import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { codexPromptDisplayText, codexPromptPresentation, codexPromptText } from '../src/team-codex-prompt-text.js'

const vectors = JSON.parse(readFileSync(new URL('./fixtures/codex-app-context-v1.json', import.meta.url), 'utf8')) as {name:string;kind:string;input:string;expected:string}[]
describe('Codex skill references and generated context', () => {
  it.each(vectors.filter(v=>v.kind==='UserPromptSubmit'))('$name', v => {
    expect(codexPromptDisplayText(v.input)).toBe(v.expected)
    expect(codexPromptDisplayText(codexPromptText(v.input))).toBe(v.expected)
    if (!v.expected) expect(codexPromptPresentation(v.input)).toMatchObject({hidden:true})
  })
  it('retains the source reference for highlighting while selecting only the visible name',()=>{
    const raw='😀 [$demo-skill](/workspace/skills/demo-skill/SKILL.md) 继续'
    expect(codexPromptText(raw)).toBe(raw)
    expect(codexPromptPresentation(raw)).toMatchObject({text:'😀 demo-skill 继续',skills:[{name:'demo-skill',start:3,end:13}]})
  })
  it('keeps oversized and incomplete generated messages readable',()=>{
    for(const text of ['<skill>\n<name>demo-skill</name>', '<external_codex_apps_open_page>{bad}</external_codex_apps_open_page>', 'x'.repeat(1024*1024)+'[$demo](/workspace/demo/SKILL.md)']) {
      expect(codexPromptPresentation(text)).toEqual({text})
    }
  })
})
