import type { Cell } from "./checkers.js";
export const campColors = [
  "#df5960",
  "#e69a38",
  "#d7b933",
  "#45a77c",
  "#4a91d1",
  "#9770cd",
];
// Camp zero points at -30 degrees; put the local home at +90 (screen bottom).
export function viewPoint(cell: Cell, home?: number): [number, number] {
  const angle = ((home === undefined ? 0 : 120 - home * 60) * Math.PI) / 180;
  const x = (cell[0] + cell[1] / 2) * 28,
    y = cell[1] * Math.sqrt(3) * 14;
  return [
    x * Math.cos(angle) - y * Math.sin(angle),
    x * Math.sin(angle) + y * Math.cos(angle),
  ];
}
export function campTriangle(camp: number): Cell[] {
  return [
    [5, -4],
    [8, -4],
    [5, -1],
  ].map((pair) => {
    let [q, r] = pair as [number, number];
    for (let i = 0; i < camp; i++) [q, r] = [-r, q + r];
    return [q, r] as Cell;
  });
}

// Camp sides sit halfway between the outer camp row and the adjacent hex row.
// Original triangle inradius is 14*sqrt(3); +12.6 clears radius-9.5 wells.
export const campOutlineScale = 1.52
export const centerHex: Cell[] = [[4,0],[0,4],[-4,4],[-4,0],[0,-4],[4,-4]]

// Keep the entire upright identity card clear of the round frame and its shadow.
export function playerBadgePosition([x,y]: [number,number]): [number,number] {
  const n = Math.hypot(x,y), ux = x/n, uy = y/n;
  let low = 272, high = 400;
  for (let i=0;i<16;i++) {
    const r = (low+high)/2;
    const distance = Math.hypot(Math.max(0,Math.abs(ux*r)-64), Math.max(0,Math.abs(uy*r)-24));
    if(distance < 272) low = r; else high = r;
  }
  return [ux*high,uy*high];
}
