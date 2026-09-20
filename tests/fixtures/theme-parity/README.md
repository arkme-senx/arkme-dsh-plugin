# Theme parity check

Start with `pnpm exec vite --config tests/fixtures/theme-parity/vite.config.ts --port 3092 --strictPort`.

This fixture renders real Arkme calendar cells/portals, topic selectors, message
metadata and file viewers, plus the actual composer CSS and shared DSH selection
tokens. It imports the installed DSH palette instead of inventing a test palette.
All `/arkme-self/` requests are handled by the local fixture; no account is used.
The voiceprint page uses synthetic read-only data. Do not start a microphone
recording; enrollment, invitation and permission mutations are not implemented.

Verify light, dark and system modes, including changing theme while a calendar or
file portal is open. Check populated/selected/unavailable dates, count text, normal
and focused composer borders, disabled send controls and the selected topic row.
The DSH row sample exercises its shared color contract, not the complete DSH host.

Automated regression checks: `pnpm exec vitest run tests/theme-color-pairs.test.tsx tests/conversation-composer-visual.test.ts tests/self-calendar-popover.test.tsx tests/file-ui.test.tsx`.

The token tests resolve real light/dark declarations and require a 4.5:1 contrast
ratio for populated dates/counts, selected-row labels and primary input text.
Still perform visual checks: token assertions cannot replace testing the complete
desktop host, custom palettes, media or scroll/focus interactions.
