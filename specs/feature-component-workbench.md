# Feature: Missions, Beacon and Atlas desktop workbench

## Metadata

- Type: feature
- Source: Owner request to research `../luuna` and expose luuna-missions, luuna-beacon and luuna-atlas through LUUNA-AI with a Kanban board, prompt library and expertise memory.
- Date: 2026-10-22
- Research baseline: local `../luuna` HEAD `87a7e3fea0416551e9ba61195ec5fff8f90a1989`; its unrelated untracked audit documents must remain untouched.

## Feature Description

Add a usable native workbench to the existing DOS desktop: manage Missions tickets on a board, compose and version Beacon prompts, and capture/search/edit Atlas expertise. All durable content belongs to the real public CLIs and survives application restart. Explicit actions can insert a selected ticket, rendered prompt or expertise record into the existing Pi message composer for review before the user sends it.

## User Story

As a developer using LUUNA-AI, I want to organize work, reuse prompts and recall project expertise without leaving the desktop, so those records can inform my existing Pi workflow.

## Solution Statement

Keep Tauri/Rust plus framework-free WebKit-compatible HTML/CSS/JS. Add a bounded Rust CLI adapter, reproducible pinned component installation, and a workbench window with three views in the existing palette. Use private LUUNA-AI-owned project stores keyed by canonical working-directory identity. These are **standalone component workflows**; they do not connect to Luuna's runtime or claim its approval, planning, baseline, candidate, promotion or publication guarantees. No runtime-owned or pre-existing developer stores are adopted.

The source checkouts may be discovered from the installed LUUNA-AI tool directory or an explicitly configured compatible component-source root (including `../luuna`). Source discovery never determines the data workspace. Workbench operations are enabled only after explicit initialization of LUUNA-AI's separate private project workspace.

## Out of Scope

- Replacing Pi, adding another agent runtime, automatic agent execution, automatic context loading, or changing Pi configuration/provider keys.
- Connecting to or editing Luuna runtime-managed component workspaces. A future runtime client must use the authenticated runtime API and exact-plan policies.
- Runtime memory promotion/export, automatic task completion, scheduling, branches/worktrees, publication, repository hooks or all Missions plan-template commands.
- Shared/global personal memory, adopting imported history, remote sync, modifying upstream CLI repositories, package publication or changing their storage formats.
- React/framework migration, arbitrary themes, browser bundling or desktop redesign outside these workbench views.

## Research and integration contracts

### Architecture evidence

- `CLAUDE.md:5-64`: native Tauri v2, Rust owns subprocess/filesystem; renderer is static and must remain WebKit-compatible; bridge command/method list and menu/help copies stay synchronized.
- `../luuna/AGENTS.md`: independent components, adapters over component internals, no imported history in agent context, runtime owns policies.
- `../luuna/docs/decisions/0012-independent-component-repositories.md` and `../luuna/components/manifest.json`: independently maintained public Git repositories, exact commit pins, unpublished registry packages. Do not substitute `npm install @luuna/...`.
- `../luuna/docs/decisions/0014-runtime-component-workflows.md`: explicit activation, separate private stores, bounded stdin transport, native process supervision, immutable selected context; runtime projects must never be edited through a second writable authority.
- `../luuna/docs/decisions/0020-capability-catalog-and-tui.md`: Luuna clients consume runtime routes, not private component files.
- `../luuna/docs/decisions/0021-memory-promotion-and-project-export.md`: runtime scope promotion and scope-safe export are newer capabilities, intentionally distinct from this standalone project expertise implementation.
- `../luuna/crates/luuna-components/src/lib.rs` and `assets/cli-bridge.mjs`: executable discovery, source identity checks, stdin JSON import bridge, 30-second deadline, 1 MiB input, 4 MiB stdout, 64 KiB stderr, environment isolation, reparse-point checks and owned process cleanup are concrete reference implementation patterns. Reuse/adapt these patterns with attribution; do not add a Cargo dependency on a private sibling checkout.

### Pins and setup

| Component | Public repository | Commit | Package / entrypoint |
| --- | --- | --- | --- |
| Missions | `https://github.com/brodynelly/luuna-missions.git` | `e1b5db171892de653e7462e630d64d4964d01422` | `@luuna/missions-cli` 0.6.0 / `src/index.ts` |
| Atlas | `https://github.com/brodynelly/luuna-atlas.git` | `76ad209daf404dd9a12aeaf46293e05e9f41e517` | `@luuna/atlas-cli` 0.11.0 / `src/cli.ts` |
| Beacon | `https://github.com/brodynelly/luuna-beacon.git` | `072e482169e0d469c3744ec712222f8b310fa7da` | `@luuna/beacon-cli` 0.2.6 / `src/index.ts` |

Bun 1.4.3 is the current supported runtime, verified before CLI execution. A Node build/setup script can clone these repositories into ignored `.tools/components`, check out exact commits, verify identities, and run `bun install --frozen-lockfile --ignore-scripts` per component. Existing valid local source clones may be reused without mutation. Do not reset dirty checkouts. Setup can use a configured Bun executable or PATH and must give an actionable missing/version-mismatch message. Node remains a build/setup dependency, not an app runtime requirement; Bun is the explicit component-runtime prerequisite.

### Missions

Sources: `../luuna/components/missions/src/types.ts`, `commands/create.ts`, `update.ts`, `list.ts`, `dep.ts`, `close.ts`, `init.ts`.

- `init --json` initializes `.seeds` and writes `.gitattributes` in its working directory: run only inside the owned private workspace, never the user's project root.
- `list --all --limit 10001 --json` returns `{success, issues, count}`. Default list hides closed tickets and defaults to 50: override both. Enforce a bounded board size and show an explicit overflow error instead of silently truncating.
- `create --title <text> --description <text> --type task|bug|feature|epic --priority 0..4 [--assignee <name>] [--labels <csv>] --json` returns `{id}`; follow with `show <id> --json` / reload list.
- `update <id> --status open|in_progress|closed --title ... --description ... --priority ... --type ... --json` returns `{issue}`. Empty optional values need correct CLI handling; do not pretend fields were cleared when an upstream option ignores empty strings.
- `dep add <id> <dependency-id> --json`, `dep remove ...`, `dep list <id> --json`; preserve dependency validation and show blocked indicators. Status columns are exactly Open, In progress, Closed, with blocked as an indicator, not an invented status.
- `Issue` includes `id,title,status,type,priority,assignee,description,blockedBy,blocks,labels,createdAt,updatedAt`.

### Beacon

Sources: `../luuna/components/beacon/src/commands/{create,update,list,show,render,history,archive}.ts` and `src/render.ts`.

- `init --json`; `list --json` returns `{prompts,count}` and excludes archived; use `list --status archived --json` for an archive filter.
- `create --name <name> --description <text> --section purpose=<text> [--tag <tag>] [--extends <name>] [--mixin <name>] --json` creates a prompt. Name/description/body and tags are required UI concepts; parent/mixins may be exposed when the editor supports them without misleading omissions.
- `show <name> --json` returns `{prompt}` with sections/status/version; `update <name> --section purpose=<text> --description ... --json` increments version. When editing a multi-section prompt, preserve untouched sections. The UI may edit one selected section at a time instead of pretending to replace all sections atomically.
- `render <name> --json` returns `{name,version,sections,resolvedFrom,frontmatter}`, **not a pre-rendered Markdown string**. Format the returned sections for preview/composer insertion, retaining source name/version.
- `history <name> --limit 100 --json` returns `{versions}`; `show <name>@<version> --json` provides historical source. `render name@oldversion` is NOT a general historical renderer: the current resolver deduplicates to current prompts and rejects old versions. Label historical source preview honestly.
- `archive <name> --json`; restore using `update <name> --status active --json` if offered.
- Before updating/archiving, compare the displayed expected version to current `show`. Serialize app operations. This protects app stale edits, but the CLI has no cross-process compare-and-swap; documentation must not claim atomic conflict protection against external CLI writers.

### Atlas

Sources: `../luuna/components/atlas/src/commands/{init,record,search,edit,delete,show}.ts`, registry/types, `src/utils/config.ts`.

- `init --json --quiet` creates `.mulch`. Refuse executable hooks before operations by inspecting `config show --json --quiet`; disable ambient env/config discovery.
- `record <domain> --type convention --content <body> --classification foundational|tactical|observational [--tags <csv>] --json --quiet` returns `{record}`.
- Support at least convention, pattern, failure, decision with their meaningful fields: convention `content`; pattern `name,description`; failure `description,resolution`; decision `title,rationale`. Validate actual registry required fields, not guessed schema.
- `search [query] [--domain <domain>] [--type <type>] --json --quiet` returns `{total,domains:[{domain,matches:[record,...]}]}`. Empty query requires a filter. To list all supported records with no query, issue one search per supported type and merge with domains preserved (or use a validated domain-list route). Never issue unfiltered empty `search` and report failure as empty memory.
- `edit <domain> <id> --content ...` / type-specific field options updates existing records; `delete <domain> <id> --json --quiet` deletes only the selected record.
- Preserve record domain/type/id/classification/timestamps in the UI; capture meaningful source/provenance as supported record fields/tags and show them. Do not label type/classification as runtime scope or claim global/user-memory promotion.

## Relevant Files

- `src-tauri/src/main.rs`: current Global/AppState, cwd switching, help data, command registration; add minimal workbench integration without bloating all implementation into this file.
- `src-tauri/src/components.rs` (new; may split into modules): pinned runner, owned workspace/status, typed operation dispatch, response normalization and tests.
- `src-tauri/assets/component-bridge.mjs` (new): fixed stdin transport to public CLI entrypoints.
- `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`: explicit process supervision/hash/test dependencies as needed.
- `components/manifest.json` (new): pinned distribution metadata, public source identities and attribution; no submodule changes needed in sibling Luuna.
- `scripts/setup-components.mjs` (new), `package.json`, `.gitignore`: reproducible local source installation and real validation commands.
- `renderer/workbench.js` (new), optionally `renderer/workbench.css` (new): isolated view/state/form implementation.
- `renderer/index.html`, `renderer/renderer.js`, `renderer/renderer.css`, `renderer/luuna-provider.js`: loading/menu/help/bridge integration and composer insertion.
- `test/workbench-native-smoke.mjs` (new), optional fixture Pi executable/script: actual Tauri/WebView2 UI test using synthetic Pi and real CLIs.
- `README.md`, `CLAUDE.md`, `docs/COMPONENT-WORKBENCH.md` (new): setup, architecture decision, boundaries, CLI/store access and validation evidence.

## Implementation Plan

### Foundation

Use a committed manifest and validated native Bun executable. Resolve the LUUNA-AI app-data root through Tauri path APIs (with a test-only/configured data-root override if necessary). Derive a collision-resistant project key from canonical cwd; save/check an ownership metadata file with schema/version/project identity. No API accepts a caller-selected component workspace. Even when the selected project is under another tool's data root, the target stores remain under LUUNA-AI's owned root. Reject data-root overrides that point at existing foreign stores, runtime component roots, project roots or linked/reparse ancestors; require owned metadata before reopening initialized stores. Source-root overrides only select code, never data.

Initialization is explicit and repeatable. Missing tools give setup guidance; partial initialization shows a retry state, without pretending success. Status/reloads do not initialize stores or import records. Mutations are serialized; asynchronous work captures project identity and the renderer rejects late results after a project switch. UI mutations carry the expected project key so stale forms cannot write into a newly selected project.

### Core

Use a closed Rust operation enum and validated fields, not renderer-supplied raw CLI args or executable paths. Preserve the established `{success,data,error}` response convention. A small IPC surface such as status/initialize/action with matching bridge methods is acceptable; each action must map to fixed backend-owned commands. Run subprocess work outside the UI/core mutex and do not hold AppState across waits. Send text via bounded stdin JSON; no shell, no command interpolation, no content-bearing process command lines. Bound outputs, deadline and descendants; sanitize child environment, isolate HOME/config, avoid `.env` reads/auto install, and refuse linked data directories and executable Atlas hooks. Errors should be actionable without echoing private user text or environment values.

Use public CLI JSON for all records; app-owned metadata is only identity and initialization metadata. Re-read after mutations and on Refresh; report errors and stale versions visibly. Do not retry a timed-out write automatically: explain that outcome is uncertain and require refresh/reconciliation before another create. Prevent double-submit while a write is running.

### Integration

Provide menu entry points for Kanban, Prompt library and Expertise memory, with a common workbench navigation strip and visible current project. Use existing overlays or a dedicated workbench window with close/Escape/focus restore. Respect existing global keyboard handlers; inputs must not trigger app shortcuts. Panels need loading/error/empty/setup states, useful scroll behavior and responsive layout at the app's minimum supported width. Use DOM `textContent`/safe escaping for stored text.

Board cards show title, ID, priority, type and unresolved dependencies, with inspect/edit/create controls and explicit move controls usable without dragging. Prompt library supports search/list/create/edit/archive, rendered preview, source/version history and explicit Insert into message. Expertise supports domain/type/classification filters, search/create/edit/delete with confirmation and explicit Insert into message. Insertion appends to existing draft text, identifies the source, returns focus to the composer, and never calls `luuna.prompt` automatically. Opening a view or changing project never injects context.

## Step by Step Tasks

1. Record the researched integration decision in `docs/COMPONENT-WORKBENCH.md`: standalone managed stores, API boundary, exact pins and setup, source citations, supported operations and runtime exclusions.
2. Add committed manifest and `npm run components:setup` script. Verify actual Bun and source identities; use existing sibling sources read-only or install exact public commits. Add ignored tooling paths and attribution. Prove a clean setup path works without requiring a private Luuna repository.
3. Implement Rust owned-workspace and bounded process runner with fixed stdin bridge. Add typed status/initialization/action APIs; wire app-state project identity and Tauri registration/bridge methods. Reject malformed operations, invalid path-like IDs/domains, stale project keys, foreign/linked workspaces, unavailable pins and executable hooks.
4. Implement actual Missions list/create/edit/move/dependency operations, Beacon list/create/update/show/render/history/archive operations and Atlas typed record/search/edit/delete operations. Normalize data and preserve CLI error/absence distinctions. Protect stale UI writes and cap list sizes visibly.
5. Implement workbench navigation and all three usable views in the DOS renderer. Keep composer, Pi, menus, keyboard and directory switching functional. Wire explicit reviewed context insertion; add loading, empty, failure, conflict, initialization and refresh states.
6. Add meaningful backend tests for identity/isolation, enum-to-CLI contracts, limits, stale project/version protection and data normalization. Add an opt-in real CLI integration test using disposable directories for all three lifecycle workflows, rereads/restart persistence, project isolation and Unicode/large content.
7. Add and run a native WebView2/CDP smoke that opens the **fresh built executable**, initializes a disposable project, creates and moves a ticket, edits a prompt with history, creates/searches/edits/deletes memory, inserts context without sending, changes projects without leakage, reopens and verifies persistence. Exercise errors/keyboard/close behavior. Use a clearly synthetic Pi fixture to avoid provider costs or claiming genuine provider evidence. Capture screenshots and inspect the rendered views.
8. Run validation commands, fix regressions, then update docs with observed commands/platforms, actual artifact path, supported operations and remaining platform limits. Do not commit or push.

## Testing Strategy

- Unit: argument validation/closed operation allowlist, actual JSON normalization, unsupported enum fields, app-owned workspace identity and symlink refusal, project-key freshness, source pin checks, prompt expected version, safe rendering/context composition.
- Real CLI integration: all three init/create/read/update/list workflows, ticket status/dependencies, Beacon versions/history/render/archive, Atlas type fields/search/delete, persistence after reconstructed service and project A/B separation. Include apostrophes, shell metacharacters, multiline Unicode and content larger than Windows command-line limits to prove stdin transport.
- Native UI: invoke actions through controls using real Tauri IPC and real CLIs, not a mock bridge. Pi may be synthetic and must be labeled. Inspect screenshots at normal/minimum sizes; no disappearing controls or XSS from stored text.
- Failure edges: unavailable Bun/component sources, partial initialization, malformed output, timeouts/output bounds, stale requests after cwd switch, conflicting prompt edits, duplicate clicks, data links and executable hooks.

## Acceptance Criteria

- [ ] Fresh development setup can install pinned public components and explain missing Bun without registry-package assumptions or private sibling dependency.
- [ ] Opening the workbench is read-only until explicit initialization; imported and runtime-managed stores remain untouched and cannot be targeted by IPC.
- [ ] Kanban reflects all three real Missions statuses; creating/editing/moving tickets and adding/removing dependencies persist in actual CLI data after refresh/restart.
- [ ] Beacon library creates/edits/version-previews/archives real prompts, displays rendered composition and history, and rejects stale displayed versions rather than silently overwriting.
- [ ] Atlas expertise supports the four documented types, domain/classification, create/search/edit/delete and persistence, using actual CLI contracts.
- [ ] A selected record can be appended to the existing message draft; nothing is sent or automatically loaded into Pi.
- [ ] Project switching does not show or mutate another project's records through stale views or in-flight responses.
- [ ] Missing tools, failures and uncertain writes remain visible and never become successful empty/mock states.
- [ ] The existing Pi desktop, DOS palette, menu/help synchronization and WebKit compatibility are preserved.
- [ ] Backend checks, tests and native build pass; real CLI and native UI evidence is recorded separately from synthetic Pi and untested macOS behavior.

## Validation Commands

- `npm run components:setup` — new supported setup script, actually installs/verifies pinned public tools.
- `npm run check` — repository-supported Rust compile check.
- `npm test` — repository-supported Rust tests, including new component unit coverage.
- `npm run test:components` — add this script to run the explicit real-component integration tests (for example, `cargo test --manifest-path src-tauri/Cargo.toml components_real -- --ignored --nocapture`); it must fail clearly when prerequisites are absent rather than passing skipped.
- `npm run build` — repository-supported native release and installer build.
- `npm run test:workbench` — add this script for `node test/workbench-native-smoke.mjs`, targeting the exact fresh Windows native executable with disposable data and synthetic Pi; fail if no native target or assertions fail.
- `git diff --check` — whitespace check; review `git status --short` to ensure no private stores, transcripts, credentials or unrelated sibling changes were introduced.

## Notes

The CLI source runner is a native host process, not a sandbox. Preserve the bounded runner's process ownership and environment isolation instead of implying that argument validation is OS isolation. The GUI is deliberately a standalone consumer of the three tools and does not inherit Luuna's authoritative execution lifecycle. Private stores avoid accidental corruption of runtime envelopes and imported developer data, while still exposing the compatible CLI interfaces for explicit troubleshooting.

An expected-version read before a CLI edit protects stale app state but cannot remove the external-writer TOCTOU race; describe that limitation accurately. The component APIs themselves own advisory locks and data writes. Historical Beacon source is available through `show`/`history`, whereas current render composition must not be falsely labeled a historic snapshot.

Existing baseline `npm run check` passed in the parent workflow with six pre-existing warnings. Do not broaden this task into unrelated warning cleanup. macOS compilation/native UI cannot be established by a Windows build and should be recorded as untested if no capable runner exists.
