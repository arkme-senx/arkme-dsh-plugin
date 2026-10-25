// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { installArkmeRedesignStyles } from '../src/client/redesign/styles.js'
vi.mock('../src/client/redesign/arkme-redesign.css?inline',async()=>({default:(await import('node:fs')).readFileSync(`${process.cwd()}/src/client/redesign/arkme-redesign.css`,'utf8')}))
vi.mock('../src/client/arrangement-workspace.css?inline',async()=>({default:(await import('node:fs')).readFileSync(`${process.cwd()}/src/client/arrangement-workspace.css`,'utf8')}))
afterEach(()=>{document.head.replaceChildren();document.body.replaceChildren()})
it('retains a real icon and 28px hit target inside the shared workspace button reset',()=>{
  const dispose=installArkmeRedesignStyles()
  const host=document.createElement('div');host.setAttribute('data-arkme-workspace','')
  host.innerHTML='<div class="arkme-arrangement-workspace"><button class="arkme-arrangement-checkbox" role="checkbox" aria-checked="false"><svg class="arkme-arrangement-checkbox-icon" width="20" height="20"><rect x="3" y="3" width="14" height="14" /></svg></button></div>'
  document.body.append(host)
  const button=host.querySelector('button')!,icon=button.querySelector('svg')!
  expect(getComputedStyle(button).width).toBe('28px')
  expect(getComputedStyle(button).height).toBe('28px')
  expect(getComputedStyle(button).display).toBe('grid')
  expect(getComputedStyle(icon).display).toBe('block')
  expect(icon.childElementCount).toBeGreaterThan(0)
  dispose()
})
