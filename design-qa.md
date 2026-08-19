# Search surface design QA

- Source visual truth:
  - `/var/folders/91/3cfcmnr17dgfn1g40f_2k2tw0000gn/T/codex-clipboard-14961ddc-fb95-4bf3-a944-0a488be088ef.png`
  - `/var/folders/91/3cfcmnr17dgfn1g40f_2k2tw0000gn/T/codex-clipboard-61a5a816-c2b3-4449-ad61-e73c409ae82b.png`
- Implementation screenshot: unavailable; the Codex in-app Browser rejected local `http://127.0.0.1:3081/` access under its URL policy.
- Source viewport: 1500 × 2000 px for the cropped-search report; 1964 × 1192 px for the earlier desktop AI-video reference.
- Implementation viewport / CSS size / density: unavailable because browser capture was blocked.
- State: quick-note search with query `倒霉`; AI-video quick-entry landing state.

## Full-view comparison evidence

The reported implementation constrained the search surface to a 600 px container with hidden overflow and constrained the AI-video quick-entry content to a 470 px centered panel. Code inspection confirmed both constraints. The fix restores the earlier desktop document-flow shell, full-width AI-video content, two-column video cards, and adds the existing client `arrow_left.svg` asset as the top-left return control.

## Focused region comparison evidence

The source screenshots clearly expose the two affected regions: the cut-off sixth search result at the bottom of the fixed-height viewport and the narrow centered AI-video panel. A post-fix focused screenshot could not be captured because local browser access was blocked.

## Findings

- [Resolved P1] Search results were clipped by fixed height and hidden overflow. Removed both constraints so results stay in the page document flow.
- [Resolved P1] AI-video quick entry used a 470 px sidebar shell. Restored the full desktop search width and removed the panel shadow/background treatment.
- [Resolved P2] The quick-entry exit control used a close icon at the upper right. Replaced it with the existing desktop-client back asset at the upper left.
- [Blocked] Post-fix visual comparison, interaction capture, and console inspection cannot be completed through the available browser because localhost access is denied by browser policy.

## Required fidelity surfaces

- Fonts and typography: existing search typography retained; post-fix browser comparison blocked.
- Spacing and layout rhythm: restored the earlier 850 px desktop shell and natural page height; post-fix browser comparison blocked.
- Colors and visual tokens: existing DSH theme variables retained; return icon is copied from the client asset set.
- Image quality and asset fidelity: AI-video cover rendering is unchanged; return control uses a real client SVG asset.
- Copy and content: `搜索快记`, `AI 视频`, and existing result copy are unchanged.

## Comparison history

1. Initial evidence: fixed-height search clipping and a mobile-like 470 px AI-video panel.
2. Fix: removed fixed-height/hidden-overflow layout, removed the 470 px quick shell, restored desktop spacing, added the client back icon.
3. Post-fix evidence: automated tests and HTTP health passed; browser-rendered visual evidence remains blocked.

final result: blocked
