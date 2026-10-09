/** Generic browser facility: business owners provide their own activation. */
export function showBrowserNotification(title: string, body: string, tag: string, activate: () => void): (() => void) | undefined {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return undefined
  try {
    const notice = new Notification(title, { body, tag })
    notice.onclick = () => { window.focus(); activate(); notice.close() }
    return () => { notice.onclick = null; notice.close() }
  } catch { return undefined }
}
