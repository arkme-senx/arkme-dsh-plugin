import {expect,it} from 'vitest'
import {shortcutFromKey,shortcutLabel} from '../src/client/screenshot-shortcut.js'
it('records physical letter keys including option-modified mac keys',()=>{expect(shortcutFromKey({code:'KeyA',metaKey:true,ctrlKey:false,altKey:true,shiftKey:true})).toBe('Command+Alt+Shift+A')})
it('rejects unmodified and modifier-only keys',()=>{expect(shortcutFromKey({code:'KeyA',metaKey:false,ctrlKey:false,altKey:false,shiftKey:true})).toBe(null);expect(shortcutFromKey({code:'ShiftLeft',metaKey:true,ctrlKey:false,altKey:false,shiftKey:true})).toBe(null)})
it('formats platform labels',()=>{expect(shortcutLabel('Command+Shift+A')).toBe('⌘ + ⇧ + A');expect(shortcutLabel('Control+Shift+A')).toBe('Ctrl + Shift + A')})
