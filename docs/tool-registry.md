# Arkme Tool Registry

Arkme classifies model-facing tools before compiling them into the DSH `ToolDefinition` registry. DSH remains the owner of schemas, execution, scope visibility, guards, duplicate detection and lifecycle disposal.

## Profiles

- `business`: system tools plus user-goal-oriented Arkme tools. This is the default and preserves the existing tool surface.
- `atomic`: system tools plus owner-specific primitive tools. No atomic tools ship yet.
- `hybrid`: system, business and atomic tools.
- `disabled`: no Arkme model tools or Arkme tool prompt.

Every module declares an internal versioned ID, model-facing tool name, `system`/`business`/`atomic` kind, dependency phase, read/write effect, required grant and profiles. The static Catalog rejects duplicate IDs/names, invalid category/profile combinations and writes without explicit grant ownership.

## Registration phases

`core` modules register immediately. `attachments` modules register only inside the DSH attachments injection fiber, so dependency disposal withdraws the tools and remounting restores them. The Registrar checks that every materialized `ToolDefinition.name` matches the Catalog metadata before handing it to DSH.

## Composition rule

Business and atomic tools share typed application Ports; a business tool must not invoke another tool's `execute()` method. This keeps authorization, cancellation, logging and output projection owned by one model tool call.

Per-tool instructions stay in `ToolDefinition.description`. Cross-tool guidance is selected by Profile and registered in the same Arkme registrar. Prompt text must not name a tool outside the selected Profile or an unavailable dependency phase; attachment guidance appears and disappears with the attachment-backed tool. Prompt visibility is not authorization: write metadata declares ownership, and the one-time Arkme ID mutation additionally installs a DSH `tools/pre-execute` approval decision before execution. Other write grants remain available for a future shared guard resolver.

## Adding a tool

1. Add one module under `src/tools/business`, `src/tools/atomic` or `src/tools/system`.
2. Depend on the narrow Port, not `ArkmeService` or another tool module.
3. Export it from the layer's static `index.ts` and add it to the ordered Catalog list.
4. Declare `effect: 'write'` with `grant: 'explicit-user-write'` for mutations.
5. Add module behavior tests plus Catalog/Profile visibility assertions.
6. If cross-tool guidance changes, assert every referenced tool is visible in that Profile.
