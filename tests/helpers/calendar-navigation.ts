import { act } from 'react'

/** Exercise the month title's inline picker, not a removed standalone header. */
export async function jumpCalendarMonth(container: ParentNode, month: string): Promise<void> {
  const current = visibleCalendarMonth(container)
  const section = container.querySelector(`[data-calendar-month="${current}"]`) ?? container
  await act(async () => section.querySelector<HTMLButtonElement>('[aria-label^="跳转月份："]')!.click())
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('[aria-label="跳转月份"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, month)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

export const visibleCalendarMonth = (container: ParentNode): string | undefined =>
  container.querySelector<HTMLElement>('[data-arkme-calendar-months]')?.dataset.visibleMonth
