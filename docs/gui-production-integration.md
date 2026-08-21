# Arkme GUI production integration

This branch implements the selected Arkme desktop visual direction in the production plugin UI. It is not a standalone demo application.

## Modification boundary

- Arkme is the permanent product shell while the plugin is enabled. It registers the public DSH `sidebar`, `conversation`, and `details` slots during client initialization; registration does not depend on an open/closed UI state.
- The official DSH `ui-layout` plugin remains the `root` owner. Arkme shadows only its visible child seats: the sidebar becomes the compact Arkme feature rail, conversation becomes the Arkme directory plus content surface, and details is claimed empty and kept closed.
- Login, loading, error, existing-account, and first-user states render inside the same permanent Arkme shell. Escape, Session navigation, refresh, and notification activation never reveal the official DSH sidebar or conversation.
- The product navigation and all new visual styles render below nodes marked with `data-arkme-owned`.
- No global stylesheet, DSH private-source import, DSH source patch, or write to a DSH repository is used.
- Arkme no longer queries the host DOM, measures the host conversation region, or portals a floating card over DSH. The permanent conversation owner renders inline at full width and height.
- DSH continues to own root geometry, theme presentation, Sessions, Workspaces, Agents, Tools, and Host transports. Those runtime capabilities remain mounted but their official sidebar/conversation presentation is not visible.

## Supported visual routes

| Route | Layout inside the Arkme surface | Production owner | Status |
| --- | --- | --- | --- |
| Conversations | Permanent feature rail + conversation directory + content | Existing Arkme source directory and timeline | Implemented |
| Recordings | Feature rail + full-width recording page | Existing recording calendar/day API | Implemented with the updated Demo's date browser, selected-day list, day timeline, and content tabs |
| Search | Feature rail + full-width search page | Existing record search and AI video API | Implemented with the existing search actions and history |
| Calendar | Feature rail + floating month calendar + day-content panel | Baseline calendar bucket/day APIs | Implemented with real counts, date switching, paging, loading, empty, and error states |
| Marketplace | Feature rail + full-width marketplace page | Existing Arkme marketplace | Implemented as the real search/install/uninstall marketplace |
| Tasks | Not rendered | No stable task-list/session contract in the plugin | Deferred; no mock implementation |

The feature rail remains mounted for every route. The conversation directory is mounted only in conversation mode and is unmounted for recordings, search, calendar, and plugins so its asynchronous source restoration cannot force a utility page back to the conversation layout.

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

Final acceptance used the unchanged-version `@senguoyun/dsh-arkme@0.1.11` package as an immutable `.tgz` installed through the official DSH plugin command into a fresh isolated DSH home. The runtime was a clean `@deepseek-ai/dsh@0.1.1-rc.1` install; no DSH checkout was created or modified.

Typecheck, production build, and the complete test suite passed. The suite result is 157 test files passed and 3 skipped, with 861 tests passed and 3 skipped. Browser acceptance verified cold load, authenticated conversation rendering, route switching, and refresh: the permanent Arkme sidebar/workspace remained the visible winners, the sidebar settled at the official 56px compact width, and neither `DSH Local Build` nor `探索未至之境` appeared.
