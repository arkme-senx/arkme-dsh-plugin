import { expect, it } from 'vitest'
import { placementOf, projectPlacement, samePlacement, type BoardItems } from '../src/client/arrangement-sort-model.js'
import type { ArkmeArrangementItem } from '../src/types.js'
const row = (arrangementRef: string) => ({ arrangementRef, status: 'identified' }) as ArkmeArrangementItem
const original: BoardItems = { identified: [row('a'), row('b'), row('c')], following: [row('d')], completed: [] }
it('projects reordering without mutating server items and derives adjacent anchors', () => {
 const next = projectPlacement(original, row('a'), 'identified', 1)
 expect(next.identified.map(x => x.arrangementRef)).toEqual(['b','a','c'])
 expect(original.identified[0]?.arrangementRef).toBe('a')
 expect(placementOf(next,'a')).toEqual({ status: 'identified', afterRef: 'b', beforeRef: 'c' })
})
it('supports empty columns and the loaded tail without claiming an absolute index', () => {
 const next = projectPlacement(original, row('a'), 'following', 1)
 expect(placementOf(next,'a')).toEqual({status:'following',afterRef:'d',beforeRef:undefined})
 expect(placementOf(projectPlacement(original,row('a'),'completed',0),'a')).toEqual({status:'completed',afterRef:undefined,beforeRef:undefined})
 expect(next.identified.map(x=>x.arrangementRef)).toEqual(['b','c'])
})
it('detects unchanged placement', () => {
 expect(samePlacement(placementOf(original,'b'),placementOf(projectPlacement(original,row('b'),'identified',1),'b'))).toBe(true)
 expect(samePlacement(placementOf(original,'b'),placementOf(projectPlacement(original,row('b'),'following',0),'b'))).toBe(false)
})
