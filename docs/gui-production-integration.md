# Arkme GUI production integration

This branch implements the selected Arkme desktop visual direction in the production plugin UI. It is not a standalone demo application.

## Modification boundary

- The entry remains the official DSH `sidebar.footer.action` slot registered by the Arkme client bundle.
- The complete transparent Arkme wordmark occupies the top-left `sidebar.brand.mark` slot and the adjacent `sidebar.brand.name` slot intentionally renders nothing. The square `conversation.hero.brand.mark` slot keeps the compact Arkme mark because DSH owns the adjacent `探索未至之境` headline and exposes no title slot.
- The product navigation and all new visual styles render below nodes marked with `data-arkme-owned`.
- No global stylesheet, DSH package import, DSH source patch, or write to a DSH repository is used.
- The existing floating surface still measures the host conversation region at runtime. That compatibility adapter is pre-existing plugin code; this branch does not patch the measured DSH element.
- DSH top chrome, native sidebar dimensions, native session list, and native conversation components remain owned by DSH and are intentionally unchanged.

## Supported visual routes

| Route | Layout inside the Arkme surface | Production owner | Status |
| --- | --- | --- | --- |
| Conversations | Feature rail + conversation directory + content | Existing Arkme source directory and timeline | Implemented |
| Recordings | Feature rail + full-width recording page | Existing recording calendar/day API | Implemented with the updated Demo's date browser, selected-day list, day timeline, and content tabs |
| Search | Feature rail + full-width search page | Existing record search and AI video API | Implemented with the existing search actions and history |
| Calendar | Feature rail + floating month calendar + day-content panel | Baseline calendar bucket/day APIs | Implemented with real counts, date switching, paging, loading, empty, and error states |
| Plugins | Feature rail + full-width plugin page | Existing Arkme extension center | Implemented as the real search/install/uninstall center |
| Tasks | Not rendered | No stable task-list/session contract in the plugin | Deferred; no mock implementation |

The conversation directory is mounted only in conversation mode. It is unmounted for recordings, search, calendar, and plugins so its asynchronous source restoration cannot force a utility page back to the conversation layout.

The conversation route keeps the existing production composer for this iteration. Its add-content `+` is moved to the far-left edge of the toolbar, while the remaining redesign is limited to the surrounding three-column shell, directory density, header alignment, message typography and bubbles, member drawer alignment, and list metadata placement.

The plugin page keeps the production extension operations. The embedded discovery view intentionally omits the modal-only category tab strip to match the Demo; `我的插件` switches to the installed list, while install, uninstall, detail, loading, restart, and error flows remain the existing implementations.

## Capability matrix

| Surface | Decision | Evidence |
| --- | --- | --- |
| UI | Required | Production `src/client` components provide navigation, responsive layout, and visible states. |
| Tools | N/A | This change adds no Host route, query, command, or persisted business capability. Existing Tools are unchanged. |
| SDK | N/A | This change adds no business capability for external plugins. Existing SDK exports are unchanged. |
| Host owner | Existing owners | Conversations, recordings, search, and extensions continue to use their existing `callArkme` operations. |

## Packaging acceptance

The final acceptance artifact must be an immutable `.tgz` built from this worktree and installed into a fresh profile of an unmodified supported DSH runtime. A standalone Vite preview is not acceptance evidence.

Final acceptance used the rebased `@senguoyun/dsh-arkme@0.1.11` package as an immutable `.tgz` installed through the official DSH plugin command into a fresh isolated DSH home. The runtime was a clean `@deepseek-ai/dsh@0.1.0-rc.8` install with no runtime-level Arkme dependency; no DSH checkout was created or modified.

Typecheck, production build, and the complete test suite passed. The suite result is 152 test files passed and 3 skipped, with 837 tests passed and 3 skipped. Saved Demo/production comparisons remain in `qa/`; final host-integration checks were performed at `http://127.0.0.1:5193/`.
