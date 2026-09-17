import { createRoot } from 'react-dom/client'
import { ArkmePersonalDayCalendar } from '../../../src/client/ArkmePersonalDayCalendar.js'
import { installArkmeRedesignStyles } from '../../../src/client/redesign/styles.js'
import '@deepseek-ai/dsh-client-ui-theme/styles/design-platform.css'

// Exercise the same style loading path as the installed DSH plugin.
installArkmeRedesignStyles()

document.body.toggleAttribute('data-ds-dark-theme', new URLSearchParams(location.search).get('theme') === 'dark')
createRoot(document.getElementById('root')!).render(<>
  <style>{`body { margin: 0; font-family: system-ui, sans-serif; background: var(--dsw-alias-bg-base); } button { font: inherit; }`}</style>
  <ArkmePersonalDayCalendar accountScope="offline-fixture:123" onClose={() => {}} />
</>)
