# Resizable note detail

- Base: official dev `4b8b40346be695774900997da4d6ce2f5a05e970`.
- Branch: `codex/c20260904-resizable-detail`.
- Scope: shared right-edge overlay for normal/forwarded quick notes and interwoven details. Does not change message sending, underlying conversation layout, versions, root README or DSH sources.
- Left-edge 10px pointer target, 3px green highlight, ew-resize cursor; pointer capture, cancellation/unmount cleanup, keyboard support, double-click reset and optional localStorage width memory.
- Requested parity: default/minimum width 405px, maximum max(405px, 60% of available width). Containers narrower than 405px cap both bounds to the available width to prevent overflow. Previously saved preferences are clamped to the new bounds.

## Coverage

| Surface | Evidence |
| --- | --- |
| UI | Shared resize hook integrated into both detail owners; unit and drawer tests. |
| Tools | N/A: no business capability, browser layout preference only. |
| SDK | N/A: no public service/API changes. |
| Host | N/A: no Host routes or persistence changes. |

- Before change: 17 drawer tests passed. Final targeted coverage: 22 tests passed across identity, resize and drawer suites.
- Typecheck passed. Standard build passed after temporary LF normalization of the existing credential-helper checksum inputs; original line endings restored, no helper source diff.
- Latest full-suite run: 3102 passed, 30 failed, 4 skipped. One documentation identity failure was subsequently corrected and the identity suite passed in the targeted rerun. Remaining failures include Windows ACL/module issues, fixture checksums and other areas; not all were independently reproduced on an untouched baseline. Full-suite status is not green.
- Packaged tarball installed via official DSH 0.1.1-rc.1 into a new isolated profile; existing preview instances preserved. No link installation or production deployment.
- Windows is the exercised platform; macOS/Linux not verified.
- Installed-package browser verification: final bounds verified at 405px minimum/default and approximately 554px maximum for a 924px container (60%). Green full-height divider confirmed. Earlier persistence verification confirmed the dragged width survived closing/reopening the detail. No messages sent or note data changed.
- Scope review: no blocking issue identified in the resize change. Emoji rendering is untouched; the preview base does not include the separate sidebar emoji asset fix. This PR intentionally does not merge that work.
