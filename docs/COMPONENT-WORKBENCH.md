# Component workbench

- Date: 2026-10-22
- Specs: [Feature](../specs/feature-component-workbench.md), [lifecycle and recovery patch](../specs/patch-workbench-lifecycle.md)

## Overview

LUUNA-AI exposes Missions tickets, Beacon prompts and Atlas expertise as standalone project workflows. The desktop never connects to the Luuna runtime or edits its stores, and does not inherit runtime planning, approval, promotion or publication guarantees. Selected context is appended to the message draft only on an explicit action; Pi is never sent an automatic prompt.

## Usage

Install Bun 1.4.3 and Git, then run `npm run components:setup`. The script clones the three public repositories at exact commits from `components/manifest.json`, verifies package identities and installs frozen dependencies without lifecycle scripts. No private sibling checkout or published npm component package is needed. Set `LUUNA_AI_BUN` to a native Bun executable if it is not found automatically. `LUUNA_AI_COMPONENTS_ROOT` can select an existing compatible source root containing `components/{missions,atlas,beacon}`; it never selects data. Dirty or wrong-pin source checkouts are refused. The application uses an embedded manifest, so editing installation metadata cannot change its allowed pins.

From this checkout run `npm install`, `npm run components:setup`, then `npm run dev`. For an installed desktop, set `LUUNA_AI_COMPONENTS_ROOT` to the checkout's `.tools` directory before launching. Select your project through **File > Change Directory**, or set `LUUNA_AI_DIR` before launch. Open **Tools > Kanban board**, **Prompt library**, or **Expertise memory**, then choose **Initialize private workspace**. **Insert into message** appends context to the current draft for review; Escape closes the workbench and restores focus.

## How it works

[`renderer/workbench.js`](../renderer/workbench.js) and its stylesheet provide the views. The bridge in `renderer/luuna-provider.js` maps status, initialization and typed actions to Tauri commands in `src-tauri/src/main.rs`. [`components.rs`](../src-tauri/src/components.rs) owns project identity/readiness and CLI workflows; [`component_runner.rs`](../src-tauri/src/component_runner.rs) verifies and supervises pinned CLI execution. Project switching installs one Pi child and guards reader events/EOF by process generation so an old process cannot disconnect its replacement.

Opening a view is read-only. Initialize explicitly to create three real CLI stores under the application's data directory in `workbench`, keyed by SHA-256 of canonical project identity. Ownership metadata is checked on every operation. `LUUNA_AI_WORKBENCH_ROOT` can select a new private test/data root; existing foreign roots, linked paths and project/runtime stores are refused. The selected project directory is never initialized by a component. Source and data locations are independent.

The adapter has a closed operation enum. Content goes through bounded JSON stdin, not shell commands or OS command-line arguments. The native runner isolates HOME/config/environment, disables Bun env-file loading and auto-install, rejects linked data and Atlas executable hooks, enforces 30 seconds, 1 MiB input, 4 MiB stdout and 64 KiB stderr, and owns/terminates descendants. This is host execution, not an OS sandbox. A timed-out write has uncertain outcome; refresh and reconcile before trying again.

Beacon edits compare the displayed version before writing and application actions are serialized. This detects stale desktop edits, but is not atomic cross-process compare-and-swap against external CLI writers. Historical previews show source, not falsely rendered historical composition. Atlas classification is not runtime memory scope; no global-memory promotion exists here.

## Research and attribution

Architecture was researched in `../luuna` at `87a7e3fea0416551e9ba61195ec5fff8f90a1989`, especially decisions 0012, 0014, 0020 and 0021, component source command implementations and `crates/luuna-components`. The bounded process runner and stdin bridge are adapted from that MIT implementation. Public component identities, versions, repository URLs, upstream attributions and license hashes are committed in `components/manifest.json`; each clone retains its license. Missions derives from Seeds, Beacon from Canopy, Atlas from Mulch.

## Supported workflows

- Missions: all-status board, create/edit/move, priorities/types, dependency add/remove and unresolved dependency indicators.
- Beacon: active/archived list, search, create, single-section edit preserving other sections, tags, composition render, version/source history, archive/restore.
- Atlas: convention/content; pattern/name+description; failure/description+resolution; decision/title+rationale. Domain/type/classification filters, capture provenance in tags, search/edit/delete. Tags are creation-time provenance; the upstream edit command does not update tags.
- All three: refresh and explicit context insertion preserving the current message draft.

## Testing

Run `npm run check`, `npm test`, `npm run test:components`, `npm run build`, and `npm run test:workbench`. Integration tests use disposable stores and actual pinned CLIs. The native smoke uses the freshly built Windows executable and real Tauri IPC, with a clearly synthetic Pi fixture to avoid provider calls. macOS native behavior is untested on this Windows host.

### Observed Windows validation (2026-10-22)

The independent tester passed all seven commands, including pinned public setup and `git diff --check`. `npm run check` retained six pre-existing warnings. `npm test` passed 10 unit tests; its two opt-in tests passed separately via `npm run test:components`, covering all three CLI lifecycle workflows and partial-store recovery, >48KiB Unicode stdin, stale Beacon conflict detection, Atlas executable-hook refusal, service reconstruction and project separation. `npm run build` produced `src-tauri/target/release/luuna-ai.exe` and `src-tauri/target/release/bundle/nsis/LUUNA-AI_1.0.2_x64-setup.exe`.

Native smoke passed all nine workflow checks on the fresh Windows release: actual ticket and prompt create/edit/move/version/render, draft insertion, Atlas create/search/edit/delete, visible errors, restored focus and body-focused Escape, A-to-B-to-A project switching with isolated records and exactly one new Pi process per switch, real fixture RPC after old-process EOF, restart persistence, and active-child EOF handling. The fixture recorded zero prompt sends. All six normal/minimum 760x480 screenshots were independently inspected. The ignored `.tac/runs/8d2ea719/tester-native/verification.json` records `complete: true` and executable SHA-256 `4a36dd8a99f43160e442b114629aee69c56bc317610a46e178cd0dc345c0ee9c`. DOM controls are clicked through WebView2 CDP; physical-mouse delivery, macOS and live-provider behavior were not tested. Independent review passed with no blockers and one follow-up for generic CLI refusal messages.

## Notes and recovery

Readiness now requires all component config/store artifacts, even if ownership metadata says initialized. Empty interrupted Missions/Beacon directories may be removed non-recursively and initialized again. Nonempty incomplete Missions or Beacon stores are refused intact with recovery guidance; restore missing artifacts from backup or use the component's documented recovery tools before refreshing. Atlas uses its idempotent public init to restore missing config/expertise artifacts without rewriting existing records. The real-component partial-recovery suite verifies byte preservation, truthful partial status, blocked actions, safe retries and repeated initialization.

The pinned Missions CLI ignores empty description and assignee edits. The adapter refuses attempted clearing of nonempty values with an actionable error; labels can be cleared using its supported `--set-labels` option. Atlas edit retains creation-time provenance tags. Long Missions IDs reflect its workspace-derived prefix; cards abbreviate their display and retain the full value in accessible labels and titles.

Some CLI failures, such as duplicate prompt names or invalid/circular dependencies, currently return a generic refusal. Refresh to confirm stored state and correct the submitted values; actionable category-specific messages are a review follow-up. Raw stderr and private record text are intentionally excluded from error messages.

The adapted runner's original MIT notice is retained in `docs/LUUNA-RUNNER-LICENSE.txt`.

## Local Windows setup follow-up (2026-10-22)

Dependencies and all three pinned components are installed. The current user's `LUUNA_AI_COMPONENTS_ROOT` points to this checkout's `.tools`, and `LUUNA_AI_BUN` points to native Bun 1.4.3. The installed Windows app and its Desktop/Start Menu shortcuts open the `luuna-ai` project; its private workspace is initialized. Use **Tools** to open any of the three views. Other project directories have their own workspace and can be initialized when selected.

Setup exposed and fixed Windows argument escaping in the Pi launcher: `cmd.exe` now receives its validated command string through Rust `raw_arg`, including correctly quoted executable paths with spaces. Twelve unit tests pass, including an actual npm-style shim argument round trip. The native fixture now forwards and validates arguments instead of silently ignoring them. Installed Pi 1.3.0 answered RPC health checks successfully; no model prompt was sent. Local installation identity, view screenshots and setup verification are saved under ignored `.tac/runs/workbench-setup/`. The NSIS-installed executable differs from the raw release only in Tauri's documented bundle-type marker.

The follow-up passed Rust checks, both real CLI suites, the rebuilt installer, and all nine native workflow checks with the stricter launcher fixture. Native waits check actual readiness and allow for sequential CLI operations on slower Windows hosts. The installed application was reopened normally from its configured shortcut with debugging disabled.
