# Quick Note Detail Images

## Scope

This change completes ordinary timeline quick-note detail rendering for records that already contain image media blocks. It only changes the Arkme plugin UI projection and reuses the existing message media renderer. It does not change Flutter, DSH, backend APIs, Host routes, Tools, SDK contracts, or media hydration.

## UI Diagram

```mermaid
flowchart TB
  A[Timeline message bubble] --> B[User opens quick-note detail]
  B --> C[Timeline Detail Drawer]
  C --> D[Header: author and timestamp]
  D --> E{Item has contentBlocks or mediaUnavailable?}
  E -->|No| F[Existing text paragraph path]
  E -->|Yes| G[ArkmeMessageContent]
  G --> H{Real text exists?}
  H -->|Yes| I[Text plus media grid]
  H -->|No, image-only| J[Media grid only]
  H -->|Media unavailable| K[Existing unavailable feedback]
```

## Interaction Diagram

```mermaid
sequenceDiagram
  participant User
  participant UI as Timeline Detail Drawer
  participant Timeline as Timeline Item

  User->>UI: Open quick-note detail
  UI->>Timeline: Read selected ArkmeTimelineItem
  Timeline-->>UI: Text, media blocks, or unavailable flag
  alt Has media blocks
    UI-->>User: Render existing text and media through ArkmeMessageContent
  else Image-only
    UI-->>User: Render media only without non-text fallback copy
  else No supported text or media
    UI-->>User: Render the existing non-text fallback copy
  end
  alt Existing mediaUnavailable flag
    Timeline-->>UI: Existing mediaUnavailable flag
    UI-->>User: Keep detail visible and show media unavailable feedback
  end
```

## Validation Notes

- Existing text-only quick-note details keep the old paragraph rendering path.
- Image details use `ArkmeMessageContent` so media URLs continue to flow through the existing local media proxy instead of exposing signed OSS URLs.
- Image-only timeline details render the media grid without the `非文本内容` fallback label.
- If media hydration is unavailable, the detail remains readable and the media area shows the existing unavailable feedback.
