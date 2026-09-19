type Rect = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>

/** The trigger, portaled menu and their narrow crossing gap are one hover target. */
export function inMenuHoverRegion(x: number, y: number, anchor: Rect, menu: Rect): boolean {
  const contains = (rect: Rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  if (contains(anchor) || contains(menu)) return true
  const top = Math.max(anchor.top, menu.top), bottom = Math.min(anchor.bottom, menu.bottom)
  if (menu.right <= anchor.left && anchor.left - menu.right <= 24) {
    return contains({ left: menu.right, right: anchor.left, top, bottom })
  }
  if (anchor.right <= menu.left && menu.left - anchor.right <= 24) {
    return contains({ left: anchor.right, right: menu.left, top, bottom })
  }
  return false
}
