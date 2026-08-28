# File lifecycle parity

Baseline: official master `3af3554949e8d47f2fcb8f3962e2da1aced0ba73`
(v0.1.28), rebased on 2026-08-27 before this correction.

Client reference (read-only): native frontend remote `pre-release`
`0fc133450`, inspected on 2026-08-27. Only the Arkme plugin is changed; no
client or DSH source is changed.

## Product reference, not internal capability names

The client input toolbar has exactly two actions: 添加照片和文件 and 写长文
(`features/chat/presentation/input_toolbar.dart`, lines 714–731 at the reference).
Local file staging is an implementation detail, not a 本地附件 menu or library.
The client preview uses 接收文件 / 打开 in the file panel and a download icon at
the bottom; it does **not** have an 另存为 button. The icon invokes a destination
picker before receiving/copying bytes (`features/file/presentation/desktop/desktop_image_preview.dart`,
lines 999–1054, 1485–1554 and 2214–2247).

The bottom download icon is visible **before reception**, while receiving and
after reception, unless that page has already been saved successfully in the
current preview. This condition is independent of the original-file cache
(`desktop_image_preview.dart`, lines 99–112 and 2214–2247;
`test/features/file/desktop_image_preview_open_file_test.dart`, lines 357–379).
The center action changes from 接收文件 to percentage progress, then hands the
completed local original to the operating system and closes the preview. Opening
the same cached original later shows 打开. These statements describe the remote
desktop source, not a driven native-app acceptance test.

File icons use the user-selected **B: Untitled UI File Icons / Solid** set,
pinned to `@untitledui/file-icons@0.0.9`. All 12 SVGs retain upstream geometry
and default colors; see [asset provenance and license](file-icon-licenses.md).
This intentionally replaces the previous native-client assets. The shared icon
keeps MIME-first classification, adding a dedicated DMG icon; Markdown uses
the same set's code icon and unknown files its empty icon. Drafts use 32px,
message/search cards 40px, and the information panel 64px. The Solid preview
icon is intentionally smaller than the previous 120px native-style sizing,
following visual feedback; card/draft sizes and transfer actions are unchanged.
Assets are embedded
in the client bundle, with no external image requests or new dependency.
This is UI-only: Host, SDK and Tools are N/A for this icon change because no
business capability, transfer logic or button visibility rule changes.

| User step | Plugin behavior following the client |
| --- | --- |
| Add files | Existing picker, clipboard files or drop; prepare locally, spinner in add button |
| Pending attachments | Preview/remove and drag order; keyboard Alt+arrows without extra visible controls |
| Send | Accept a fixed message with attachments, clear that draft, allow the next input while uploading |
| Upload | Per-file overlay/progress; completing capped at 99%; failure removes a stale progress overlay |
| Retry | Keep the message identity and already uploaded siblings; never overwrite a newer draft |
| Open a remote generic file | 接收文件, shared percentage progress, then automatically open with the system default application |
| Open a cached generic file | Show 打开 and hand the account-bound local original to the system default application |
| Open browser media/text | Reuse original bytes; supported media and Markdown keep the existing inline renderer |
| Download | Client download icon; native browser picker first where supported, cancellation has no download side effect |
| Search | Existing file scene; reuse the same file card, receiver and viewer |

Image, video and generic-file presentation are separate after classification.
Real filename/MIME format wins over a stale upstream `file_kind=4`, so JPG,
MP4 and MP3 records do not flash or remain in a generic file card. Presentation
classification is separate from browser decoding: HEIC and SVG remain images,
and MKV remains video, even when the Web host cannot render their bytes inline.
Those formats use a media-shaped receive/download fallback instead of being
relabeled as files. Legacy visual metadata is still rejected when the real
filename has a non-media suffix, preventing old `.dmg` records from being
decoded as images. PDF, Office documents, archives, installers and unknown
types remain generic files. Recorded voice messages continue to use the audio
flow.

If an image or transient video resource fails to load, the message keeps an
image- or video-shaped failure tile with a retry action. It does not temporarily
replace that media with a generic file card. Retrying uses a fresh URL, and a
newer record version clears stale failure state. A browser-declared unsupported
image or video format instead offers 接收图片 or 接收视频 and opens the existing
receive/download flow; it does not promise that retrying the same bytes will work. This prevents
the observed `image -> file text/card -> image` flash while preserving explicit
files.

The retry/status UI is a plugin recovery adaptation, not a claim that every
client surface has an identical retry control. Unknown server acknowledgement
is reconciled against recent messages and is never blindly resent with new IDs.

## Contract before implementation

Select/import prepares account-bound local files only. Accepting a send persists
the message and its local references before releasing the composer. Cloud upload
progress belongs to message attachments; uploaded bytes are not a sent message.
Retries retain successful assets and the original record/relation identifiers.
An uncertain message acknowledgement must not be silently retried with new IDs.

Drafts, messages and file search share a file viewer. Original-file reception is
distinct from browser download/save; a thumbnail is never an original fallback.
File search uses existing scene 4. Existing upload()/sendRich() consumers retain
their synchronous completion contract.

| Consumer | Required implementation | Verification |
| --- | --- | --- |
| Host | Single account-bound file owner: local staging, MIME normalization, durable send state, upload progress, original reception and validated local open | Owner, account-isolation, API-proxy and route failure/recovery tests |
| UI | Local attachment strip, preview/reorder/remove, optimistic files, per-file progress, retry; distinct visual/file rendering; generic receive/open state machine | Interactive and rendering tests, actual Web acceptance |
| SDK | Public typed stage/send/status/retry/receive plus `openLocalFile(fileRef)`; paths never cross the API | External consumer compile and contract tests |
| Tools | Existing `arkme_file_task` adds confirmed `open-local` for opaque current-account file refs; no arbitrary filesystem read | Formal catalog/grant registration and official DSH session invocation |

DSH public seams: WebServer.register() owns HTTP response lifecycle and returns a
disposer. Existing Arkme HTTP adapters remain responsible for Origin/auth checks.
The Host resolves an opaque Arkme file ref and calls the public `ctx.apiProxy.host.openPath`
gateway, which owns Finder / Explorer / xdg-open handoff. Before that handoff,
the owner creates an account-scoped hard-link alias with a sanitized original
file name and extension. This lets the OS recognize PDF, ZIP, Office and other
generic formats while the canonical cache remains opaque. Both paths stay
Host-side and aliases are removed with their cached originals. DSH attachment v1 supports images only, not generic files. No private
DSH imports, custom shell-open commands or new remote upload/search services are introduced.

## Acceptance

- Selection performs no cloud upload; importing failure preserves valid siblings.
- Local acceptance releases input; each file has actual upload progress capped
  below completion until complete-upload succeeds.
- Partial upload failure retains completed assets; message failure never replaces
  a newer draft; source/account changes cannot rebind a pending send.
- Same record ID is idempotent; uncertain acknowledgement is shown explicitly.
- Original reception is shared, validates length, and never promotes partial data.
- Cache/staging references remain account-bound and do not expose paths or URLs.
- Generic files show 接收文件, real percentage progress, automatically open on
  successful reception, and an already received file card opens the account-local
  original directly without showing a second confirmation dialog.
- When an authoritative remote message replaces its local pending send row, the
  current-account task rebinds each matching `fileAssetUid` to its opaque local
  file ref. A file selected on this device therefore never regresses to 未下载.
- Browser download fallback reports only handoff, never unverified disk-save success.
- With a supported save picker, success is reported only after the writable file closes.
- Feature remains plugin-only; running user profiles are not replaced.

## Verification and remaining boundaries

Typecheck, the complete media/file interaction matrix and the production build
passed on macOS. The full suite passed 1917 product tests and skipped 5; its
remaining package-list harness uses an npm flag that npm 11 no longer parses,
including the B / Solid icon replacement. File icon tests pin all 12 SVG hashes,
check inactive/self-contained assets, retain MIME precedence and verify the
shared draft/card/preview mapping, including DMG. No new Host, SDK or Tool
behavior is introduced by this visual correction.

The file viewer uses a 64px icon and places its close control inside the
top-right corner, with a 32px hit target and 12px inset. Information and content
views both reserve space above their content. Click and Escape dismissal remain
covered; the latter stops propagation so a parent detail view stays open.

The Web adaptation shows actual reception percentages on the reference client's
220px-wide, 4px-high rounded track, with no invented percentage when total bytes
are unknown. A received browser-previewable image, video, audio or supported text
file offers Preview. A stale generic-file marker cannot override a real media
format. PDF, XML, Office documents, installers, archives and unknown formats use
the native generic-file flow: 接收文件, percentage progress, automatic system open,
then 打开 for the cached original. PDF is never placed in a blank browser iframe.
Clicking an already received generic-file card bypasses the information panel and
hands the cached original directly to the native opener. The panel remains the
receive/progress/retry surface for files that are missing, receiving or failed.
The bottom download control remains a separate optional disk-copy action and does
not replace the central receive/open state. No native-application limitation text
or central save-success state is shown.

The mounted message view now retains its last usable attachment display when
the Host explicitly reports a media lookup failure for the same record version.
It keeps the existing failure notice and replaces references on recovery. It
does not retain media across source/record changes, unknown/newer versions,
deleted records, or a successful response that removes attachments. The
regression sequence (complete, unavailable, recovered) formerly rendered
attachment counts `1 -> 0 -> 1`; it now renders `1 -> 1 -> 1`. This reproduces
one deterministic failure path, not every possible live intermittent symptom.

Native copy remains blocked: the desktop reference's `_copyImage` first calls
`Pasteboard.writeFiles`, with an image fallback (lines 956–997). It copies a
file, not its name or a URL. DSH rc.7 exposes `writeClipboard(text: string)`;
the inspected browser bridges cover app updates/notifications/calls, not native
file clipboard writes. Standard browser clipboard formats are not an
equivalent OS file-list contract. No shell-on-Host workaround, misleading
copy-name fallback, or nonfunctional copy button is added. A client-side native
file-clipboard bridge with explicit permission is needed for full parity.
Owner/SDK route tests cover account isolation, Origin, range reads, local staging,
durable identity, partial upload failure, unknown acknowledgement, cache reuse,
truncated reception, validated native opening, save cancellation and failed disk writes. UI tests also
cover original-menu-only, drag order, shared card reception, formatted Markdown
and the absence of invented file-library/Save-As controls.

An isolated official DSH rc.7 installation loaded the immutable package on a
fresh Profile. Its Host reported `canOpenPath=true`; the real Web conversation
rendered a remote PDF with 接收文件 as the central action and the separate download
icon. The file Tool owner/action and conversational confirmation are covered by
registration and dispatch tests; no automated acceptance opened a user file.
A separate external consumer compiled against the packaged public SDK and its
exported `ArkmeFileOpenResult`. These checks do not prove authenticated upstream
upload/send behavior. The interactive fixture uses real plugin components and
file owner, but simulated upstream upload/send ports; it never sends to a real
user's conversation.

Still **not full native-client parity**:

- Native opening is available only when this DSH Host reports its official native
  opener capability. The plugin uses that Host seam and never invents a remote
  browser-open claim. Native file clipboard copy remains unavailable: the public
  clipboard primitive accepts text, not an OS file list, so no misleading copy
  fallback is added.
- Browser save dialogs, clipboard file availability, video codecs and PDF viewer
  support depend on the browser. Native OS dialogs and Windows/Linux behavior
  have not been validated. The current receive/preview presentation is not a
  pixel-identical client clone.
- File size remains bounded by Host configuration (default 100 MiB); image limit
  is at most 50 MiB and attachment limit is 9. Do not promise the client's 200 MiB
  non-image limit or dynamic VIP quota without an authoritative capability.
- Real-account upload, private/group/self/topic delivery, weak-network behavior
  and the full native client reference flow still require end-to-end acceptance.
- Native client code was inspected at the remote reference; the Flutter client
  itself was not driven through this flow. Passing plugin tests is not proof
  that the two products are completely aligned.
