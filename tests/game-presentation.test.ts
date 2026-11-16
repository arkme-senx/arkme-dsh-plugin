import { it, expect } from "vitest";
import { camps, cells } from "../src/client/game/checkers.js";
import { viewPoint, campTriangle } from "../src/client/game/presentation.js";
it("puts every local home below and its opposite goal above without changing cell identity", () => {
  for (let home = 0; home < 6; home++) {
    const average = (camp: number) =>
      camps[camp]!.map((c) => viewPoint(c, home)).reduce(
        (a, p) => [a[0]! + p[0] / 10, a[1]! + p[1] / 10],
        [0, 0],
      );
    expect(average(home)[0]).toBeCloseTo(0);
    expect(average(home)[1]).toBeGreaterThan(100);
    expect(average((home + 3) % 6)[0]).toBeCloseTo(0);
    expect(average((home + 3) % 6)[1]).toBeLessThan(-100);
    const positions = cells.map((c) =>
      viewPoint(c, home)
        .map((n) => n.toFixed(5))
        .join(","),
    );
    expect(new Set(positions).size).toBe(121);
    expect(campTriangle(home)).toHaveLength(3);
  }
});
it("keeps observers at the canonical fixed viewpoint", () => {
  expect(viewPoint([2, 0])).toEqual([56, 0]);
});

it('camp borders clear every board well, including the neighboring central row',()=>{
 const radius=9.5,strokeHalf=.75
 for(let camp=0;camp<6;camp++){
  const vertices=campTriangle(camp).map(c=>viewPoint(c)),cx=vertices.reduce((s,p)=>s+p[0]/3,0),cy=vertices.reduce((s,p)=>s+p[1]/3,0)
  const edges=vertices.map(([x,y])=>[cx+(x-cx)*1.52,cy+(y-cy)*1.52])
  for(const cell of cells){const p=viewPoint(cell)
   for(let i=0;i<3;i++){const a=edges[i]!,b=edges[(i+1)%3]!,dx=b[0]!-a[0]!,dy=b[1]!-a[1]!
    const t=Math.max(0,Math.min(1,((p[0]-a[0]!)*dx+(p[1]-a[1]!)*dy)/(dx*dx+dy*dy)))
    const distance=Math.hypot(p[0]-a[0]!-t*dx,p[1]-a[1]!-t*dy)
    expect(distance).toBeGreaterThan(radius+strokeHalf)
   }
  }
 }
})
