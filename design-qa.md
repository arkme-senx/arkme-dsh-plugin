# Arkme utility-page design QA

## Source of truth

- Demo URL: `http://127.0.0.1:5174/`
- Calendar Demo URL: `http://127.0.0.1:5175/`
- Production comparison URL: `http://127.0.0.1:5191/`
- Final clean-profile acceptance URL: `http://127.0.0.1:5193/`
- Browser viewports: 1360 × 900 for the saved comparisons; 1733 × 1171 for final host-integration acceptance, device pixel ratio 1
- Reference screenshots:
  - `qa/reference-recordings-1360x900.jpg`
  - `qa/reference-search-1360x900.jpg`
  - `qa/reference-plugins-1360x900.jpg`
- Production screenshots:
  - `qa/production-recordings-1360x900.jpg`
  - `qa/production-search-1360x900.jpg`
  - `qa/production-plugins-1360x900.jpg`
  - `qa/production-send-to-self-spacing-v12-1733x1171.png`
- Combined comparison: `qa/comparison-utility-pages.jpg`

The send-to-self spacing pass uses the user's 2026-08-21 browser-annotation screenshot as its source visual truth and the 1733 × 1171 browser capture above as the revised implementation. Both are desktop, light-theme, expanded topic-tree states at device pixel ratio 1.

The search-history area in the production QA image is blurred because it contains real account data. The page geometry, search field, section label, rows, separators, and scroll behavior remain visible for comparison.

## States checked

| State | Expected layout | Observed |
| --- | --- | --- |
| Conversation | Feature rail + directory + content | Directory spacing, header alignment, message bubbles, message typography, and list notification placement match the Demo direction |
| Recording | Feature rail + full-width page | No conversation directory; two-column date browser and recording content area match the updated Demo structure |
| Search | Feature rail + full-width page | No conversation directory; compact single heading, 50 px search field, quick find, and history rows |
| Calendar | Feature rail + month calendar + day-content panel | Real bucket counts, black selected-day pill, today navigation, real day records, and paging match the updated Demo direction |
| Plugins | Feature rail + full-width page | No conversation directory or extension modal; Demo-style hero, search, two-column cards, and real actions |
| Send to self | Feature rail + compact topic tree + content | Root rows now use 4 px outer gutters, counts sit closer to the right edge, and child depth remains readable with an 18 px step |
| DSH host integration | Native DSH shell + Arkme public slots | Arkme wordmark appears in the top-left brand area, the Arkme icon appears in the new-session hero, and the Arkme entry appears at the bottom-left without patching DSH source |
| Recording month expansion | Weekly strip expands to a complete month | August 2026 expands from the 17–23 strip to all dates 1–31, with future dates disabled and the selected date preserved |
| Composer controls | Existing production composer | The add-content `+` remains functional and is visually anchored at the far-left edge of the composer toolbar |

## Iteration history

1. P1 — the first integrated layout left the conversation directory mounted for every tab. Fixed by conditionally mounting it only for `source` mode.
2. P1 — recording, search, and plugin pages initially reused their legacy layouts too literally. Fixed with the updated Demo's recording date/content split, compact search hierarchy, and an embedded plugin marketplace.
3. P1 — the mounted directory could asynchronously restore a source and pull a utility page back to the conversation view. Fixed by unmounting the directory outside conversation mode and excluding utility modes from source restoration.
4. P2 — the plugin page still exposed its modal category tabs and green action styling. Fixed by using the Demo's single `我的插件` entry, dark action buttons, and two-column discovery cards while retaining production operations.
5. P2 — the recording page was based on the previous Demo revision. Fixed by rebuilding it around the updated date strip, selected-day list, day timeline, and transcript/summary/timeline tabs while keeping the existing recording API as the data owner.
6. P2 — search suggestion rows lacked the Demo's directional affordance. Fixed by adding consistent trailing arrows.
7. P2 — conversation message text, group header height, member drawer top edge, DND marker placement, and bubble colors did not match the Demo. Fixed using the Demo's 14 px message type, neutral bubble palette, asymmetric radii, aligned 68 px header boundary, and lower-right list metadata.
8. The input-composer redesign was intentionally rolled back after product review. The previous production composer remains in place for this iteration.
9. P1 — selecting Arko replaced the entire product area and removed the conversation directory. Fixed by treating Arko as a normal conversation destination: the feature rail and directory remain mounted while Arko renders in the third column.
10. P2 — the send-to-self entry and topic list were denser than the desktop client and inherited a green accent. Fixed with the client's bookmark asset geometry in neutral gray, a 15 px title, and 12 px horizontal topic-list margins.
11. P2 — quick-note detail still used the legacy drawer hierarchy. Fixed against the Demo's 372 px side panel, 56 px header, compact close control, 14 px text hierarchy, and full-width source-group row.
12. P2 — long plugin descriptions appeared clipped against the next row. Fixed by raising card minimum height, allowing three description lines, and reserving bottom scroll padding so every card boundary remains visible.
13. P2 — send-to-self topic rows still lost too much usable width to stacked outer gutters, lead slots, and trailing count padding. Fixed by reducing row gutters from 12 px to 4 px, the lead slot from 30 px to 24 px, trailing metadata from 58 px to 44 px, and the hierarchy step from 20 px to 18 px. The revised 1733 × 1171 focused capture confirms that labels and counts move outward without flattening the parent/child structure.
14. P1 — the final host page still presented the official DSH brand and could make Arkme look like an optional afterthought. Fixed through the public `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark` slots; the host title remains unchanged because DSH exposes no public title slot.
15. P1 — the recording browser exposed only the selected week. Fixed with an explicit expand/collapse control that renders the complete month while preserving the existing recording API and selected-date behavior.
16. P2 — the composer add-content control sat inside the old padded toolbar area. Fixed by removing the toolbar padding and anchoring the `+` at the far-left edge without replacing the production composer.
17. P1 — the latest baseline introduced the calendar capability after the GUI branch diverged. Rebased onto the latest baseline, retained the calendar Host/SDK/Tool/data flow, and adapted only its plugin UI into the existing Arkme feature rail and visual system.
18. P1 — treating the Arkme A as a standalone top-left logo duplicated the mark beside the wordmark. Fixed by rendering the complete transparent Arkme wordmark once in the top-left mark slot and leaving the adjacent name slot empty; the square new-session slot remains the compact mark to avoid overlapping the host-owned title.

## Final checks

- Same-size source/implementation comparisons inspected together.
- No actionable P0, P1, or P2 visual mismatch remains in the accepted scope. Real data density and the empty recording state are content differences, not layout substitutions.
- Utility tabs stay selected after asynchronous data loading.
- DSH source is not patched or written by this implementation.
- Final acceptance used a fresh DSH home and a clean `@deepseek-ai/dsh@0.1.0-rc.8` runtime containing no runtime-level Arkme dependency. The immutable rebased `@senguoyun/dsh-arkme@0.1.11` tarball was installed through the official `dsh plugin --profile web add` command.
- Final browser acceptance confirmed the bottom-left Arkme entry, top-left Arkme wordmark, new-session Arkme hero mark, far-left composer `+`, and the complete 1–31 August month view.
- The central new-session title remains `探索未至之境`; changing it would require a DSH title slot or a host change, neither of which is in the plugin's public integration surface.
- Validation passed with TypeScript typecheck, production build, and the full suite: 152 test files passed, 3 skipped; 837 tests passed, 3 skipped. The suite was run with the repository-pinned pnpm 11.7.0.
- The production search history is blurred only in the saved QA artifact because it contains live account data.
- Focused send-to-self comparison checked typography, spacing, neutral tokens, existing icons, and copy. The only image-asset change is the transparent Arkme brand wordmark/mark used through public DSH slots.

## Update UI refactor QA (2026-08-25)

### Source and implementation

- Visual and interaction source: `http://127.0.0.1:5176/`
- Real implementation: `http://127.0.0.1:5198/` running `@deepseek-ai/dsh@0.1.0-rc.8` with the packed Arkme plugin
- Source capture: `/private/tmp/arkme-update-demo-same-viewport-1440.png`
- Implementation capture: `/private/tmp/arkme-update-real-same-viewport.png`
- Combined component comparison: `/private/tmp/arkme-update-dialog-final-comparison.png`
- Progress capture: `/private/tmp/arkme-update-real-final-progress.png`
- Collapsed progress capture: `/private/tmp/arkme-update-real-final-collapsed.png`
- Feedback source capture: `/private/tmp/arkme-update-feedback-demo.png`
- Feedback implementation capture: `/private/tmp/arkme-update-feedback-final-open.png`
- Feedback focused comparison: `/private/tmp/arkme-update-feedback-comparison.png`
- No-update implementation capture: `/private/tmp/arkme-update-feedback-no-update.png`
- Browser state: desktop, light theme. The source and implementation components were compared at their rendered CSS size rather than judging screenshots in isolation.

### States checked

| State | Expected | Observed |
| --- | --- | --- |
| Update available | Demo rail entry and anchored release-note popover | Real DSH renders the same 356 × 347.046875 px popover, 20 px radius, shadow, content rhythm, numbered notes, and two-button footer |
| Updating | Demo top-center progress capsule | Real DSH renders the capsule above the working content without blocking chat or navigation |
| Progress collapsed | Closing the capsule leaves a percentage above the avatar | Real DSH keeps the 8% recovery entry in the lower rail and the page remains usable |
| Progress restored | Clicking the percentage restores the capsule | Covered by the controller/component interaction tests; the real 0.1.20 package also showed the recoverable 8% entry while the Host request was active |
| Restarting | Preserve the baseline updater's automatic restart | A real 0.1.20 tgz downloaded the remote 0.1.21 artifact, stopped PID 63643, installed the new package, and automatically restarted the same 5198 service as PID 63771 |
| No update | Do not reserve an update-entry slot | A real DSH profile running the current 0.1.21 package exposes only the profile button; the update rail slot is absent and the profile remains 12 px from the viewport bottom |

### Comparison history

1. Removed the temporary standalone QA shell from the implementation path and validated only inside a real DSH host.
2. Replaced the old logo badge/blocking update dialogs with the Demo rail entry, anchored popover, top-center progress capsule, and collapsed percentage recovery entry.
3. P1 — the first pass invented fallback release-note rows and a secondary sentence that were not returned by the update API. Removed all fallback copy; production now renders only the real remote summary lines and omits the note region when no release text exists.
4. P1 — the popover was absolutely positioned inside the rail footer and was clipped by the navigation column despite its z-index. Portalled it to `document.body`, positioned it from the rail button's viewport rectangle, and raised it to the page-level overlay layer. Browser evidence confirms `parentElement === document.body`, `position: fixed`, and `z-index: 100000`.
5. P1 — DSH button styles overrode the primary action, leaving `立即更新` white and changing hover behavior. Scoped the Demo tokens to the update controls with sufficient specificity. Browser evidence now reads `rgb(28, 31, 40)` for the primary background, white text, a 12 px radius, and the Demo shadow; the red rail button uses the Demo active/hover red and elevation.
6. P2 — update presence needed an explicit no-reserved-space check. A real DSH profile at the current remote version renders no update slot while keeping the profile control at its normal 12 px bottom inset; a component regression assertion covers the absent rail-slot markup.
7. P1 — the bundled updater entry silently exited because tsdown moved its guarded `main()` into a shared chunk. Split the executable wrapper from the reusable updater module and added a post-bundle executable-entry check; the real tgz update now reaches `succeeded` and records the target artifact digest, app version, and DSH version.
8. The post-fix 1492 × 1171 source and implementation captures were inspected together in `/private/tmp/arkme-update-feedback-comparison.png`. The different popover height is intentional because production now displays one real remote note instead of three Demo fixture notes. Typography, spacing rhythm, tokens, icon source, button states, radii, shadows, and copy ownership have no remaining actionable P0/P1/P2 mismatch.

final result: passed
