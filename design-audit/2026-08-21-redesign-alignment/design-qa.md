# Arkme DSH Redesign QA

- Reference: `http://127.0.0.1:5175/` for the redesigned outer shell and task view; `http://127.0.0.1:5194/` for the existing client conversation content.
- Prototype: local `Arkme DSH.app`, backed by the DSH service on port 5187.
- Viewport: 1360 × 900 content target; macOS window validated at 1360 × 932 including native window chrome.
- States checked: task start, embedded DSH task list, conversation directory, recording, search, calendar overlay, plugin grid, avatar popover, selected private conversation, selected group conversation and composer.
- Comparison artifacts: `07-comparison.png` combines the initial reference states; `09-native-titlebar-fixed.png` records the final native-client state after the second alignment pass.

## Rubric

- Layout: passed — one outer rail, one secondary directory and one content area; tasks are embedded in conversations; plugin headers are not duplicated.
- Typography: passed — task heading, directory heading, 14–15px conversation copy, labels and metadata follow the supplied references.
- Spacing: passed — conversation rows use the 5194 production values (52px minimum row height, 38px avatar, 10px avatar/content gap).
- Icons: passed — outer navigation uses the Demo-aligned Phosphor icon family and production content retains its existing icons.
- Avatars: passed — private avatars retain the production client rendering; group conversations retain the existing multi-avatar composition.
- Interaction: passed — task sessions stay on the DSH session runtime; rail routes, calendar overlay, avatar popover, conversation selection and composer remain functional.
- Desktop shell: passed — the signed arm64 macOS app opens a resizable native window, loads the local DSH client and avoids the previous doubled top spacing.

final result: passed
