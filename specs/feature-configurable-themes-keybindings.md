# Feature: Configurable themes, Raycast-style keybindings and a `.luuna/` configuration directory

## Summary

LUUNA-AI becomes configurable "inside and out". Outside: every setting lives in a plain
JSON file under a `.luuna/` directory — a global tier in `~/.luuna/` and a project tier in
`<project>/.luuna/` — so a repo can carry its own theme, font and keyboard map. Inside: the
same settings are editable from a new in-app settings dialog, a theme picker and a
keyboard-shortcuts editor. The keyboard model is reshaped to Raycast's shape — every action
has a stable action ID, a default chord and a user override — and the UI (menu shortcut
column, key bar, help screen, guide) always renders the chord that is *currently* bound.
Themes stay inside the canonical 16-colour DOS palette: the **names** are fixed, a theme
only supplies **values** for them.

## Metadata

- Type: feature
- Source: request — "Make LUUNA-AI extremely configurable, inside and out" (themes,
  Raycast-style keybindings, `.luuna/` config dir, configurable font, in-app settings UI)
- Date: 2026-10-22
- Repo: `luuna-ai`, worktree `C:/Users/localhost/github/luuna-ai-wt`
  (branch `feat/raycast-keybindings-themes-config`)
- Reference: `docs/raycast-keybindings.md` (Raycast manual transcription)

## Context

LUUNA-AI is a Tauri v2 desktop app: a Rust backend (`src-tauri/src/main.rs`, ~2250 lines)
and a vanilla-JS renderer (`renderer/renderer.js`, ~1879 lines) that recreates a
Turbo-Pascal 7 / DOS-VGA UI in DOM. Today the app is *hardcoded* in three dimensions:

1. **Colour.** `renderer/renderer.css` `:root` (lines 6-28) defines the 16 DOS colours as
   CSS custom properties and the rest of the sheet uses `var(--…)` exclusively (16 hex
   literals exist in the whole file, all inside `:root`). There is no theme mechanism at
   all — no `.dark`/`.light` class, no `data-theme`, no `prefers-color-scheme`. A user who
   dislikes the royal-blue desktop cannot change it.
2. **Font.** `--font: "Consolas", …`, `--fs: 14px`, `--lh: 1.25` are hardcoded, and
   `renderer.js` additionally hardcodes the pixel metrics `charWidth() { return 8.4; }` and
   `lineHeight() { return 17.5; }` (lines 549-550), which assume 14px Consolas. Changing the
   font without changing those constants desynchronises the tree/agent layout.
3. **Keyboard.** Every chord is a literal in the code: the F1-F10 switch (renderer.js ~1613),
   the Alt+letter accelerators (~1633), the Ctrl block (~1643), the vim motions (~1685), the
   menu `shortcut` strings in `MAIN_MENUS` (~15-100), the `KEY_BAR_ITEMS` row (~102) and
   `HELP_LINES` (~104). There is no notion of an action ID, so nothing is rebindable and
   the help text can never agree with reality.

The Raycast research in `docs/raycast-keybindings.md` establishes the *shape* to copy
(action ID → default chord → user override → the UI renders whatever is bound), and the
chord table to draw defaults from. It also explicitly lists chords Raycast does **not**
document, which must not be invented.

Meanwhile the renderer has no filesystem access at all (`src-tauri/capabilities/default.json`
grants no `core:fs`), so "configurable as a file" is only possible through new `luuna_*`
Tauri commands.

The result of this feature is that a user can drop a `.luuna/` folder into a repo, commit it,
and the whole app — palette, font, and every shortcut — changes for anyone who opens that
repo, while still being overridable per machine in `~/.luuna/`.

## Requirements

Each requirement is independently verifiable.

1. **R1 — Two config tiers.** Settings are read from a global tier (`~/.luuna/config/`) and a
   project tier (`<current project cwd>/.luuna/config/`). The project tier is resolved
   against the **current** `AppState.cwd`, not the install directory, so it travels with the
   repo. On a per-key basis the project tier wins.
2. **R2 — Three settings files.** `appearance.settings.json`, `keybindings.settings.json`
   and `app.settings.json` exist in each tier. `appearance` holds `{ "theme", "font": {
   "family", "size", "lineHeight" } }`; `keybindings` holds `{ "<action.id>": ["Chord", …] }`;
   `app` holds miscellaneous preferences.
3. **R3 — Merge semantics.** Settings files merge key-by-key across the two tiers: objects
   are deep-merged, arrays and scalars are replaced wholesale by the project tier.
4. **R4 — Fixed palette names.** A theme supplies a *value* for each of the 16 canonical
   names (`black, blue, green, cyan, red, magenta, brown, lgray, dgray, lblue, lgreen,
   lcyan, lred, lmagenta, yellow, white`). No 17th colour name and no ad-hoc colour may be
   introduced anywhere (repo convention in `CLAUDE.md`).
5. **R5 — Built-in themes.** At least five themes ship in the app: **DOS Blue** (default,
   byte-identical to today's `:root` values), **Amber**, **Green Phosphor**, **Paper**
   (light) and **Midnight**. Each defines all 16 palette names.
6. **R6 — User themes.** Themes are discovered as `<tier>/themes/<id>.theme.json` in both
   tiers. A project theme shadows a global theme with the same `id`; a user theme shadows
   the built-in theme with the same `id`.
7. **R7 — Palette fallback.** A theme that omits (or misspells) a palette name falls back to
   the DOS Blue value *for that name only*; the rest of the theme still applies.
8. **R8 — CSP-safe theming.** Applying a theme writes the 16 palette custom properties plus
   `--font`, `--fs`, `--lh` onto `document.documentElement` via
   `documentElement.style.setProperty(...)`. No stylesheet is injected, no inline `style`
   attribute is added, and no `<style>` block is created (the CSP is
   `default-src 'self'; style-src 'self'; script-src 'self'`).
9. **R9 — Font precedence.** The effective font is: `appearance.font` (if the user set one)
   → the theme's `font` → the app default. Font changes are applied live, without a restart.
10. **R10 — Dynamic metrics.** `charWidth()` and `lineHeight()` are measured from the live
    font instead of the hardcoded `8.4` / `17.5`, and are re-measured whenever the font
    family, size or line height changes, so the tree and agent panes stay aligned.
11. **R11 — Action registry.** Every user-facing action has a stable string ID, a human
    label, a category, a scope and a default chord list. The registry is the single source
    of truth for the menu shortcut column, the key bar, the help screen, the guide, the
    command palette and the shortcuts editor.
12. **R12 — Chord grammar.** Chords are stored and matched in one canonical, order-
    independent form with a single fixed modifier order (see Design §C.2). The grammar is
    implemented identically in `renderer/keymap.js` and `src-tauri/src/config.rs`.
13. **R13 — Resolution.** A keydown event resolves to at most one action ID, honouring the
    scope (global / composer / normal-mode / tree / agent) and the *existing* precedence of
    the global keydown handler (alt-burst → overlay → open menu → app shortcuts → pane
    navigation).
14. **R14 — The UI renders the live binding.** No chord is hardcoded in a user-visible
    string. Rebinding an action changes the menu shortcut column, the key bar, the help
    screen and the guide on the next render.
15. **R15 — Nothing regresses.** Every pre-existing binding keeps working: F1-F10,
    Alt+letter menu accelerators, Alt+X, Ctrl+F, Ctrl+L, Ctrl+C, Ctrl+D/U, Ctrl+W,
    Tab, Enter/Shift+Enter/Escape in the composer, the `/` `?` `:` `i` `h` `j` `k` `l`
    `gg` `G` vim motions. The vim motions and the Ctrl+W prefix become overridable too.
16. **R16 — Raycast-derived defaults.** The default chords come from
    `docs/raycast-keybindings.md` (table in Design §C.3), which was fact-checked against
    `manual.raycast.com` and records which chords Raycast documents, which it documents
    differently, and which it does not document at all. Chords Raycast does not document
    are not invented as if they were Raycast's; LUUNA-specific bindings are labelled as
    such in the shortcuts editor.
17. **R17 — Command palette.** `Mod+K` opens an overlay listing every registered action,
    searchable by substring, executing the highlighted action on Enter. This is the Raycast
    Action Panel analogue and mirrors its documented behaviour: actions are grouped into
    sections, **each action shows its currently-bound chord on the right**, `Enter` runs
    the primary action, `Mod+Enter` the secondary and `Alt+Enter` the tertiary, `Escape`
    closes, and typing filters the list. The palette's field is labelled "Search for
    actions…".
18. **R18 — Composer menus.** Typing `/` at the start of the composer opens a slash-command
    list; typing `@` opens an attach-context list of project files. Both insert the
    selection into the composer. Neither is a *chord* — they are triggered by the typed
    character, so ordinary typing is never swallowed.
19. **R19 — Settings dialog.** One settings dialog (built with the existing `buildDialog`
    helper) with three sections — Appearance, Keybindings, Config — reachable from the
    `Options` menu and from `Mod+,`.
20. **R20 — Theme picker.** A theme-picker overlay lists the built-in and user themes,
    previews the highlighted theme live, and applies the chosen theme on Enter.
21. **R21 — Rebinding.** In the Keybindings section a row can be rebound by pressing a key
    combination while the row is in "recording" mode; the recorded chord is written to the
    selected scope; a chord already bound to another action is refused with a message
    naming the conflicting action; a row can be reset to its default. The recorder
    mirrors Raycast's: the pressed key is shown live in the row, the binding saves
    automatically after a ~1.5 second countdown (or immediately on `Enter`), `Backspace`
    clears the binding, and a conflict names the action that already owns the chord
    instead of silently overwriting it.
22. **R22 — Atomic writes.** A setting changed in the app is written to the chosen scope
    (`global` or `project`) with the backend's `atomic_write` (temp file + rename),
    creating `.luuna/config/` on demand.
23. **R23 — Config locations.** The Config section shows the global and project directory
    paths and can open them with the existing `showInFolder` bridge method.
24. **R24 — Project switch.** After `changeDirectory` succeeds the renderer re-reads the
    effective configuration, so the new project's `.luuna/` tier takes effect immediately.
25. **R25 — Backend surface.** Six new Tauri commands exist — `luuna_get_config`,
    `luuna_set_config`, `luuna_list_themes`, `luuna_read_theme`, `luuna_config_paths` and
    `luuna_open_folder` — each with a matching `window.luuna` method in
    `renderer/luuna-provider.js` (1:1, as the rest of the bridge is). The sixth command
    exists because the pre-existing `luuna_show_in_folder` runs `explorer /select,<path>`,
    which selects a *file* inside a directory and cannot open the directory itself — the
    Config section's "open folder" buttons need a command that opens the directory
    itself (see §D).
26. **R26 — Robustness.** A malformed settings file, a malformed theme file or an unknown
    action ID never breaks the app: the file is skipped, the error is reported in the
    Config section, and the app keeps running with the built-in defaults.
27. **R27 — Rust unit tests.** The repo currently has **zero** Rust tests. This feature adds
    Rust unit tests for: the deep merge of two JSON values, the two-tier settings merge
    (project wins; arrays replaced), theme file validation (unknown palette names
    rejected) and chord canonicalisation (modifiers ordered, unknown modifier rejected,
    bad key rejected).
28. **R28 — JS unit tests.** `renderer/keymap.js`, `renderer/themes.js` and
    `renderer/config.js` expose their pure functions through a CommonJS/UMD-style export
    so `node --test` can require them. Tests cover chord normalisation, `resolve()`
    matching (including scope and `Mod` expansion), theme resolution with fallback, and the
    config helpers.
29. **R29 — Test wiring.** `npm test` stays `cargo test --manifest-path
    src-tauri/Cargo.toml` (now including the new Rust tests). A new `npm run test:js`
    runs the JS tests. A new `npm run check:all` runs `check` + `test` + `test:js` +
    `check:js`. The CI workflow gains the JS test step.
30. **R30 — Platform constraints.** No `<dialog>`/`showModal`, `navigator.clipboard`,
    `structuredClone`, `ResizeObserver` or unprefixed `backdrop-filter`; no inline
    `<style>`/`style=` and no inline `<script>`; the app keeps using the OS WebView.

## Design

### A. Configuration tiers and file layout

```
<global tier>   ~/.luuna/
                  config/appearance.settings.json
                  config/keybindings.settings.json
                  config/app.settings.json
                  themes/<id>.theme.json
<project tier>  <AppState.cwd>/.luuna/
                  config/appearance.settings.json
                  config/keybindings.settings.json
                  config/app.settings.json
                  themes/<id>.theme.json
```

* `~/.luuna` is derived from the existing `dirs_home()` helper in `main.rs`
  (`USERPROFILE` → `HOME`), so it works on Windows and macOS.
* The project tier is derived from `AppState.cwd` — the directory the app currently has
  open — so `.luuna/` travels with the repository and is re-read after a directory change
  (R24).
* Merge order: start from the global file, deep-merge the project file on top. Objects
  merge recursively; arrays and scalars are replaced by the project tier.
* The project tier is *not* created by the app unless the user writes a project-scoped
  setting (R22). A missing tier is simply an empty object.

**File formats** (all UTF-8 JSON, pretty-printed with two-space indentation when the
backend writes them):

`appearance.settings.json`
```json
{
  "theme": "dos",
  "font": { "family": "\"Consolas\", \"Lucida Console\", \"Courier New\", monospace", "size": "14px", "lineHeight": 1.25 }
}
```

`keybindings.settings.json`
```json
{
  "app.palette": ["Mod+K"],
  "search.findFile": ["Ctrl+F"]
}
```

`app.settings.json`
```json
{ "sendKey": "Enter", "newlineKey": "Shift+Enter", "historySize": 200 }
```

`sendKey` is the chord that sends the message, `newlineKey` the one that inserts a
newline, `historySize` the composer's message-history limit (default 200). The keys are
merged per key, so a project tier that only sets `sendKey` keeps the global tier's
`newlineKey`. A malformed, unknown, empty or bare (single-character) `sendKey` /
`newlineKey` falls back to the default (`Enter` / `Shift+Enter`), and two equal keys
fall back to both defaults — the composer must never be left unable to send. The
settings are applied as the *defaults* of the two composer actions: an explicit rebind
in `keybindings.settings.json` still wins (§C.4).

`<id>.theme.json`
```json
{
  "id": "midnight",
  "name": "Midnight",
  "palette": { "black": "#000000", "blue": "#1A2030", "…": "…" },
  "font": { "family": "\"Consolas\", monospace", "size": "14px", "lineHeight": 1.25 }
}
```
`font` is optional in a theme file; `name` defaults to `id`; `palette` may be partial
(R7).

### B. Theme model

* The **16 palette names are canonical and fixed** (R4). A theme only supplies values.
  The `magenta` entry stays in the palette even though the CSS does not currently use it.
* **Built-in themes live in `renderer/themes.js` as plain JS data** — no filesystem access
  is needed to ship them, and the renderer is the only component that paints the screen.
  They are therefore *not* duplicated in Rust.
* **User themes** are read by the backend and delivered to the renderer over IPC. The
  backend returns the *user-discovered* themes; the renderer merges them with the
  built-ins, project tier shadowing global tier by `id`, and user themes shadowing
  built-ins by `id`. (`luuna_list_themes` is the command that returns the user-discovered
  half; the effective list the user sees is built-ins ∪ user themes.)
* **Applying a theme** = `document.documentElement.style.setProperty(name, value)` for
  each of the 16 names, then `--font`, `--fs`, `--lh` (R8). CSSOM writes are not blocked
  by `style-src 'self'`.
* **Fallback**: for every palette name, `theme.palette[name] ?? DOS_BLUE.palette[name]`.
  A theme that declares a name outside the canonical 16 is rejected by the backend
  (R26/R27); the renderer ignores unknown names defensively.
* The backend keeps a canonical list of the 16 **names** (`PALETTE_NAMES`) so it can reject
  a 17th name at the file boundary. It does *not* keep the colour values — those live only
  in `renderer/themes.js` (R7 is implemented renderer-side).

**Built-in theme list** (all 16 names each; DOS Blue is byte-identical to the current
`renderer.css` `:root`):

| id | name | description |
|---|---|---|
| `dos` | DOS Blue | the current royal-blue desktop — the default, values unchanged |
| `amber` | Amber | monochrome amber CRT phosphor |
| `phosphor` | Green Phosphor | green-on-black terminal phosphor |
| `paper` | Paper | light scheme for daylight / bright rooms |
| `midnight` | Midnight | dark blue-grey, low contrast |

### C. Keymap model

#### C.1 Files and shape

`renderer/keymap.js` (new) owns the registry and the chord algebra. It is loaded as a
classic script before `renderer.js` and exposes `window.LuunaKeymap`:

```js
{
  ACTIONS: [ { id, label, category, scope, chords: ["Mod+K"], group?, handler? } ],
  parseChord(str)          -> { mods: {ctrl,alt,shift,meta}, key } | null
  normalizeChord(str)      -> canonical string
  formatChord(str|obj)     -> display string ("⌘K" on macOS, "Ctrl+K" elsewhere)
  chordsFor(actionId)      -> string[]   // effective: user override, else defaults
  applyOverrides(settings) -> void        // settings = keybindings settings object
  resolve(event, ctx)      -> { actionId, chord } | null
  isBound(actionId, event) -> boolean
  platform                 -> "mac" | "other"
}
```

Action record fields: `id` (stable string), `label` (human text), `category` (grouping in
the UI), `scope` (`"global" | "composer" | "normal" | "tree" | "agent" | ["tree","agent"]`),
`chords` (default chord list — possibly empty for menu-only actions), optional `group`
(e.g. `"Recent sessions"`) and optional `hidden` (excluded from the shortcuts editor).

The registry contains **every** dispatchable menu command as well, most with an empty
chord list, so that any menu command can be given a shortcut from the settings UI and so
that the menu shortcut column always has a single source of truth.

#### C.2 Chord grammar and canonical order

A **chord** is `Modifiers+Key`:

* Modifiers: `Mod`, `Ctrl`, `Alt`, `Shift`, `Meta`. At most one of `Mod` / `Ctrl` /
  `Meta` may appear (they are mutually exclusive in practice).
* `Mod` is the portable alias: it expands to `Meta` (Cmd) on macOS and to `Ctrl`
  everywhere else. `Ctrl` and `Meta` are always distinct and are never expanded.
* Key: a named key (`Enter`, `Escape`, `Tab`, `Backspace`, `Delete`, `Space`, `Home`,
  `End`, `PageUp`, `PageDown`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`,
  `F1`…`F12`) or a single character (letter, digit or punctuation).

**Canonical modifier order — decided here, one order, used everywhere:**

```
<primary> → Alt → Shift → <key>
```

where `<primary>` is exactly one of `Mod`, `Ctrl`, `Meta`.

Rationale for not using a `Ctrl+Alt+Shift+Meta` alphabetical-type order: `Mod` is a
platform-dependent alias that must occupy the *primary* slot, and a chord never contains
both `Mod` and `Ctrl`/`Meta`, so a fixed primary-first order is unambiguous, matches how
Raycast writes its own chords (`Cmd+K`, `Shift+Cmd+M` → `Mod+Shift+M`) and keeps the
stored files portable between macOS and Windows.

Matching is **order-independent**: a chord is modelled internally as a modifier *set* plus
a key, so `Shift+Mod+M` and `Mod+Shift+M` are the same binding; the canonical order is
only used when a chord is *serialised* (into `keybindings.settings.json` or the UI).

**Key derivation from a keyboard event** (identical rule in JS and Rust):

1. `e.key` is one of the named keys → that name.
2. `e.code` matches `Key([A-Z])` → the uppercase letter (so `Shift+K` is `Shift+K`, and
   the physical key is used, not the produced character).
3. `e.code` matches `Digit([0-9])` → the digit (so `Shift+1` is `Shift+1`, never `!`).
4. `e.key` is a single printable character → that character (so `?`, `-`, `+`, `[`, `]`
   keep their symbol).
5. otherwise → `e.key` verbatim.

`Shift` is recorded as a modifier only for letters and digits; for symbol keys the
produced character already encodes the shift, so `Shift+/` is stored simply as `?` and
`Shift+1` as `Shift+1`.

**Sequences.** A binding may be a two-key sequence, written with a comma:
`"Ctrl+W,H"`, `"G,G"`. This is how the existing `Ctrl+W` prefix and the `gg` motion are
expressed. The first chord of a sequence is a prefix: the renderer waits for the next key.

#### C.3 Action registry and default chords

Origin column: **Raycast** = taken from `docs/raycast-keybindings.md`; **existing** =
already in the app today; **LUUNA** = specific to LUUNA (not a Raycast chord).

**General**

| Action ID | Label | Scope | Default chord(s) | Origin |
|---|---|---|---|---|
| `app.palette` | Command palette | global | `Mod+K` | Raycast (`Cmd+K` Action Panel) |
| `app.settings` | Settings… | global | `Mod+,` | LUUNA |
| `app.theme` | Theme picker… | global | `Mod+Shift+T` | LUUNA |
| `app.keybindings` | Keyboard shortcuts… | global | `Mod+Shift+K` | LUUNA |
| `app.help` | Keyboard help | global | `F1`, `Mod+/` | existing `F1`; `Mod+/` is LUUNA (Raycast documents no shortcuts-help overlay) |
| `app.menu` | Activate menu bar | global | `F10` | existing |
| `app.exit` | Exit | global | `Alt+X` | existing |

**Session**

| Action ID | Label | Scope | Default chord(s) | Origin |
|---|---|---|---|---|
| `file.new` | New session | global | `Mod+N` | Raycast (`Cmd+N`) |
| `file.save` | Save session to file… | global | `F2` | existing |
| `file.open` | Open saved session… | global | `F3` | existing |
| `file.export` | Export session to HTML… | global | — | menu only |
| `file.chdir` | Change directory… | global | — | menu only |
| `file.preview` | Preview selected file | global | — | menu only |
| `session.regenerate` | Regenerate last response | global | `Mod+R` | Raycast (`Cmd+R`) |
| `session.regenerateModel` | Regenerate with a different model | global | `Mod+Shift+R` | Raycast (`Shift+Cmd+R` — documented on the Quick AI page only) |
| `session.next` | Next recent session | global | `Mod+]` | Raycast (`Cmd+]` — Quick AI only in the docs) |
| `session.prev` | Previous recent session | global | `Mod+[` | Raycast (`Cmd+[` — Quick AI only in the docs) |
| `session.jump1`…`session.jump9` | Jump to recent session 1…9 | global | `Mod+1` … `Mod+9` | Raycast (`Cmd+1`…`Cmd+9`) |

`session.jump1`…`jump9` are nine action IDs sharing the group `"Recent sessions"`; the
shortcuts editor collapses the group into one row showing all nine chords. The handler
derives the index from the action ID.

**Agent**

| Action ID | Label | Scope | Default chord(s) | Origin |
|---|---|---|---|---|
| `agent.model` | Select model… | global | `Mod+Shift+M`, `F4` | Raycast (`Shift+Cmd+M`); `F4` existing |
| `agent.thinking` | Thinking effort… | global | `Mod+Shift+U`, `F5` | Raycast (`Shift+Cmd+U`); `F5` existing |
| `agent.mode` | Toggle plan/build mode | global | `F6` | existing |
| `agent.fork` | Fork session… | global | `Mod+Shift+B` | Raycast (`Shift+Cmd+B` Branch the chat) |
| `agent.attachContext` | Attach context to the message | global | `Mod+Shift+A` | Raycast (`Shift+Cmd+A`) |
| `agent.findInChat` | Find in agent output | global | `Mod+Shift+F` | Raycast (`Cmd+F`), shifted — see §C.5 |
| `agent.cycleModel` | Cycle to next model | global | — | menu only |
| `agent.compact` | Compact context | global | — | menu only |
| `agent.clone` | Clone active branch | global | — | menu only |
| `agent.abort` | Abort generation | global | — | menu only (+ `composer.cancel`) |

**Files, search, view, window**

| Action ID | Label | Scope | Default chord(s) | Origin |
|---|---|---|---|---|
| `search.findFile` | Find file in tree | global | `Ctrl+F` | existing (explicit `Ctrl` — see §C.5) |
| `search.grep` | Search text in files… | global | — | menu only |
| `search.clear` | Clear file filter | global | — | menu only |
| `tree.refresh` | Refresh project tree | global | — | menu only |
| `git.diff` | Unified git diff | global | `F7` | existing |
| `git.status` / `git.log` / `git.refresh` | Git status / history / refresh | global | — | menu only |
| `run.tests` | Run test suite | global | `F8` | existing |
| `run.build` | Build project | global | `F9` | existing |
| `run.command` | Run command… | global | — | menu only |
| `edit.copyOrAbort` | Copy selection / cancel operation | global | `Mod+C`, `Ctrl+C` | existing `Ctrl+C` |
| `view.clear` | Clear agent log | global | `Mod+L`, `Ctrl+L` | existing `Ctrl+L` |
| `view.toggleSidebar` | Toggle file tree | global | `Mod+B`, `Mod+Shift+S` | Raycast (`Cmd+B` / `Shift+Cmd+S`) |
| `view.zoomOut` | Font zoom out | global | `Mod+-` | Raycast (`Cmd+-`) |
| `view.zoomIn` | Font zoom in | global | `Mod+=` | Raycast (`Cmd+Plus`) |
| `view.zoomReset` | Font zoom reset | global | `Mod+0` | Raycast (`Cmd+0`) |
| `view.halfPageDown` | Half page down | tree, agent | `Mod+D`, `Ctrl+D` | existing |
| `view.halfPageUp` | Half page up | tree, agent | `Mod+U`, `Ctrl+U` | existing |
| `window.next` | Cycle focus | global | `Tab` | existing |
| `window.motionTree` / `window.motionAgent` / `window.motionInput` / `window.motionCycle` | Window motion (Ctrl+W + h/j/k/l/w) | tree, agent | `Ctrl+W,H`, `Ctrl+W,J`, `Ctrl+W,K`, `Ctrl+W,L`, `Ctrl+W,W` | existing |
| `window.zoom` / `window.files` / `window.agent` / `window.input` / `window.tile` | Window layout commands | global | — | menu only |

**Composer** (scope `composer` — active only while the message input has focus)

| Action ID | Label | Default chord(s) | Origin |
|---|---|---|---|
| `composer.send` | Send message | `Enter` | Raycast |
| `composer.newline` | Newline | `Shift+Enter` | Raycast |
| `composer.sendAlternate` | Alternate send | `Mod+Enter` | Raycast (see the send-key note below) |
| `composer.cancel` | Cancel / stop generation | `Escape` | existing (Raycast does **not** document `Esc` cancelling a run) |
| `composer.historyPrev` | Previous message | `ArrowUp` | Raycast (`Up`/`Down` edit last message) |
| `composer.historyNext` | Next message | `ArrowDown` | Raycast |

**Send-key note.** Raycast's own documentation is internally inconsistent here. The AI Chat
page says `↵` sends and `⇧↵` adds a newline, while Settings → AI → Chat → "Send Message"
says the default is `⌘ Return`. The manual does not resolve the conflict. LUUNA therefore
treats the send key as a **configurable setting** (`.luuna/config/app.settings.json`,
`sendKey`), defaults to `Enter` sends / `Shift+Enter` newline — the reading both of
Raycast's pages agree on — and exposes `Mod+Enter` as the "alternate send" chord.

**Zoom-chord note.** Raycast uses `Cmd+0` for two different things in two different
windows: "jump to chat 10" in the sidebar and "reset zoom" in AI Chat. LUUNA binds
`Mod+1`…`Mod+9` to recent sessions 1–9 and reserves `Mod+0` for **font zoom reset**,
matching the zoom reading of `Cmd+0`; there is no tenth recent-session slot.

**Divergence from Raycast — deliberate.** Raycast's built-in navigational chords
(`⌘K`, `⌘F`, `⌘W`, …) are **not** rebindable; only command hotkeys and aliases are. This
spec makes **every** binding rebindable, including the navigational ones. That is a
deliberate superset of Raycast, not an accident: the brief asks for an application that
is "extremely configurable inside and out". The in-app shortcuts editor labels the
built-in navigational actions as such, so the difference is visible rather than implied.

**Normal mode** (scope `normal` — active only when the focus is *not* the composer)

| Action ID | Label | Default chord(s) | Origin |
|---|---|---|---|
| `nav.down` | Move down | `J` | existing |
| `nav.up` | Move up | `K` | existing |
| `nav.left` | Collapse / parent | `H` (tree) | existing |
| `nav.right` | Expand / child | `L` (tree) | existing |
| `nav.top` | Jump to top | `G,G` (sequence) | existing (`gg`) |
| `nav.bottom` | Jump to bottom | `G` | existing |
| `nav.insert` | Insert mode (focus input) | `I` | existing |
| `nav.commandLine` | Command line (prefill `/`) | `:` | existing |
| `nav.find` | Find file in tree | `/` | existing |
| `nav.help` | Help | `?` | existing |

**Pane navigation** (scope `tree` / `agent`): `tree.up`, `tree.down`, `tree.pageUp`,
`tree.pageDown`, `tree.home`, `tree.end`, `tree.open` (`Enter`), `tree.escape`
(`Escape`); `agent.up`, `agent.down`, `agent.pageUp`, `agent.pageDown`, `agent.home`,
`agent.end`, `agent.focusInput` (`Enter`), `agent.escape` (`Escape`).

Raycast chords with **no LUUNA counterpart** and therefore not bound: `Cmd+J` (send to AI
Chat), `Tab` from Root Search, `Cmd+G`/`Shift+Cmd+G` (next/previous match), `Alt+Cmd+A`
(archive chat), `Ctrl+Shift+X` (delete unpinned chats — note Raycast maps the Windows
equivalent to `Ctrl Alt D`), `Ctrl+Cmd+N` (create project), `Ctrl+Cmd+M` (move chat to
project), `Shift+Cmd+=`/`Shift+Cmd+-` (upvote/downvote), `Ctrl+M` (dictation),
`Shift+Cmd+Y` (creativity), and the global no-window chords (double-tap `Shift`,
double-tap `Cmd`).

**Two Raycast chords that are double-documented** and therefore context-dependent in
Raycast, resolved here by not binding them: `Shift+Cmd+F` is "Search chats" in AI Chat
but "Add to Favorites" in Root Search, and `Shift+Cmd+B` is "Branch chat from a message"
in AI Chat but "Report a bug" under Extensions Support.

#### C.4 Resolution rules

`resolve(event, ctx)` where `ctx = { focus, overlayOpen, menuOpen }`:

1. Build the event's canonical chord (modifier set + key, §C.2).
2. Candidate actions are those whose `scope` is active in the current context:
   `global` always; `composer` when the focus is the message input; `normal` when the
   focus is not the message input; `tree`/`agent` when the focused pane is that pane.
3. Compare the event's modifier set with the *expanded* chord's modifier set
   (`Mod` → `Meta` on macOS, `Ctrl` elsewhere). All modifiers must match exactly
   (no "at least" matching), so `Ctrl+K` does not fire for `Ctrl+Shift+K`.
4. On a match, return `{ actionId, chord }`. For a two-chord sequence the first chord
   matches a *prefix* action and the renderer sets `state.pendingSeq` and waits for the
   next key.
5. A bare (unmodified) letter is only ever matched in `normal` scope, so typing in the
   composer is never swallowed.
6. **Scope rank.** When more than one candidate matches the same chord, the more
   specific scope wins: `composer` (4) > `tree`/`agent` (3) > `normal` (2) > `global`
   (1); the registry order breaks a tie inside one rank. This is what lets a global
   action and a composer action share a chord (the composer has it while the composer
   has the focus, the global action has it everywhere else) without the resolution
   layer ever claiming the same chord twice.

**Which chord an action owns** — three tiers, in this order:

1. the **explicit rebind** in `keybindings.settings.json` (the `overrides`),
2. the **app-settings default** (`app.settings.json` → `sendKey` / `newlineKey`, the
   `defaults`),
3. the **registry** chord.

An explicit rebind therefore wins over the app-settings setting, and the app-settings
setting wins over the registry. When the app-settings default collides with a *registry*
chord of another action **in the same scope**, the colliding registry chord is dropped —
the registry keeps exactly one owner per chord per scope (e.g. `sendKey: "Ctrl+Enter"`
takes `Mod+Enter` away from `composer.sendAlternate` off macOS). A chord an app-settings
default shares with an action of a *different* scope is not a collision: the two actions
are never live at the same time, so both keep it (e.g. `sendKey: "Ctrl+F"` leaves the
global `search.findFile` its own `Ctrl+F` while `composer.send` also owns it).

**"Reset to default" (`Delete` on a row) restores the *effective default*** — the
app-settings value when the action has one, the registry chord otherwise. It does **not**
write the registry chord as an explicit override, because that override would shadow the
app tier permanently: with `{"sendKey": "Ctrl+Enter"}` the effective binding of
"Send message" is `Ctrl+Enter`, and a `Delete` that wrote `Enter` would leave the
configured send key unreachable from the UI. Instead the override is *removed* from the
tier's own `keybindings.settings.json` (a replacing write, because a merge can never
remove a key), so the app tier applies again. When the action has no app-settings
default, the same removal leaves the registry chord in charge.

**An app-settings default that takes a chord away is reported.** When such a default
drops the registry chord of another action of the same scope, the app names the loser:
a note in the Keybindings section of the settings dialog ("the app settings take a chord
away: … takes … away from …") and a one-line notice at start-up. The chord is not
refused — the app tier is the user's own configuration and a send key is a legitimate
choice — but the user must learn that the other action is now unbound.

**Integration with the existing global keydown handler** (`renderer.js` ~1539). The
existing order is load-bearing and is preserved:

1. alt-burst check (must stay before `armAltBurst`) — the burst synthesises an
   `Alt+<letter>` chord and looks it up in the keymap **first** (so `Alt+X` = `app.exit`
   is rebindable), then falls back to the menu-mnemonic behaviour.
2. overlay intercept — the overlay owns the keyboard; the settings dialog's "recording"
   mode lives here, so a recorded chord never triggers an action.
3. open-menu intercept — unchanged.
4. **keymap resolution** (new) — replaces the hardcoded F-key switch, the Ctrl block and
   the vim-motion switch.
5. pane navigation — now resolved through the keymap as well (scope `tree` / `agent`).

The message textarea's own `keydown` handler keeps only the IME guard
(`e.isComposing || e.keyCode === 229`) and the "an overlay/menu owns the keyboard" guard;
all composer actions move into the keymap path, so `Enter`/`Shift+Enter`/`Escape` are
resolved in one place.

The menu accelerators (`Alt+F`…`Alt+H` opening the File/Search/… menus) stay tied to the
`MAIN_MENUS` mnemonics and are **not** rebindable — they are the DOS menu's own
navigation model. This is stated in the shortcuts editor as a non-rebindable note.

#### C.5 Conflicts and deviations from Raycast (decided here, one resolution)

1. **`Ctrl+F` vs. `Mod+F`.** Raycast's *find in chat* is `Cmd+F`; LUUNA's *find file in
   tree* is already `Ctrl+F`. Because `Mod` ≡ `Ctrl` on Windows and Linux, the two
   actions cannot both own `F` under `Mod`/`Ctrl`. **Resolution:** *find file in tree*
   keeps the explicit `Ctrl+F` (unchanged behaviour on every platform, R15) and *find in
   agent output* takes `Mod+Shift+F` (Raycast's `Shift+Cmd+F` position). On macOS a user
   may freely rebind find-in-chat to `Mod+F` because `Cmd+F` and `Ctrl+F` are distinct
   there. The deviation is documented in the shortcuts editor.
2. **`Mod+0`.** Raycast uses `Cmd+0` both for "jump to chat 10" and "reset zoom" in
   different contexts. LUUNA uses `Mod+0` for **font zoom reset** (the zoom family
   `Mod+-` / `Mod+=` / `Mod+0` is kept together) and `Mod+1`…`Mod+9` for the recent
   sessions. Documented in the editor.
3. **`Mod+Enter`.** The Raycast manual contradicts itself on the send key (prose says
   `Enter` sends / `Shift+Enter` newlines; the settings page says the default is
   `Cmd+Return`). LUUNA therefore treats the send key as **configurable**: `Enter` sends,
   `Shift+Enter` inserts a newline, `Mod+Enter` is an *alternate send* action, and
   `app.settings.json` exposes `sendKey` / `newlineKey`. A malformed, unknown, empty or
   bare (single-character) value falls back to the default — the composer must never be
   left unable to send — and `sendKey` equal to `newlineKey` falls back to both
   defaults. The project tier wins over the global tier per key.
4. **Bare `/` and `@` in the composer** are not chords (they would swallow typing);
   they trigger input-driven menus (R18).
5. **Conflicts created by a user rebind** are refused with a message naming the action
   that already owns the chord (R21). The comparison uses the *expanded* chord, so
   `Mod+F` and `Ctrl+F` collide on Windows but not on macOS, **and** the two actions'
   scopes: a chord is only a conflict when the two actions can be live at the same time.
   The effective scope set of an action is its `panes` when it has one, else its
   `scope`; two global actions conflict, two actions of the same pane scope conflict,
   but a global action and a composer-only action never do. A chord that *no* action of
   a live scope owns is not a conflict either.
6. **A bare single-character chord** may only be owned by an action that is active
   outside the composer (`normal` / `tree` / `agent` scope). A global or composer
   action can never fire from a bare letter, so the recorder refuses such a binding
   with a message and writes nothing.

### D. Backend commands

New module `src-tauri/src/config.rs` (new file) holds the pure logic; `main.rs` gets the
thin `#[tauri::command]` wrappers.

| Command | Parameters | Returns (`data`) |
|---|---|---|
| `luuna_get_config` | — | `{ settings: { appearance, keybindings, app }, tiers: { global, project }, themes: [user themes], errors: [ … ], paths: {…} }` |
| `luuna_set_config` | `scope: "global"\|"project"`, `file: "appearance"\|"keybindings"\|"app"`, `value: object`, `replace?: boolean` | `{ path, value }` (the file content after the write) |
| `luuna_list_themes` | — | `{ themes: [ { id, name, palette, font, source } ], errors: [ … ] }` |
| `luuna_read_theme` | `id: string` | one theme definition |
| `luuna_config_paths` | — | `{ globalDir, globalConfigDir, globalThemesDir, projectDir, projectConfigDir, projectThemesDir, cwd }` |
| `luuna_open_folder` | `path: string` | `true` |

`luuna_get_config` returns the **effective** settings (`settings`, the two tiers merged)
*and* the **tiers themselves** (`tiers.global`, `tiers.project`, each one tier's own
settings object). The tiers are what the shortcuts editor needs to say "the other tier
already owns this key" (§E); the merged view alone cannot answer that. `errors` carries
the per-file read/parse notes (a malformed file is reported, not fatal); `paths` carries
the resolved directories.

`luuna_set_config` takes an optional `replace` flag. Without it the value is deep-merged
into the existing file; with it the value **becomes** the file. A merge can never remove a
key, so "reset to defaults" and "unbind this action" need the replacing form.

`luuna_open_folder` opens a *directory* in the file manager (`explorer <path>` on Windows,
`open <path>` on macOS). The pre-existing `luuna_show_in_folder` selects a file inside a
directory (`explorer /select,<path>`) and therefore cannot open a directory — the Config
section's two "open folder" buttons would silently do nothing without this command.

All commands return the standard envelope: `Ok(json!({"success": true, "data": …}))` via
the existing `ok_data` helper, or `fail_msg(…)` → `{"success": false, "error": …}`.
`renderer/luuna-provider.js` gains one method per command (the bridge is 1:1).

`src-tauri/src/config.rs` public surface (all pure, all unit-testable):

```rust
pub const PALETTE_NAMES: [&str; 16];
pub fn global_dir() -> PathBuf;                    // dirs_home()/.luuna
pub fn project_dir(cwd: &str) -> PathBuf;          // cwd/.luuna
pub fn tier_dir(scope: &str, cwd: &str) -> Result<PathBuf, String>;
pub fn merge_json(base: &Value, overlay: &Value) -> Value;   // deep merge, arrays/scalars replaced
pub fn read_json_file(path: &Path) -> Result<Value, String>;
pub fn load_settings(cwd: &str) -> (Value, Vec<String>);      // merged across tiers + error notes
pub fn load_tier_settings(cwd: &str) -> (Value, Value, Vec<String>);  // the two tiers, kept apart
pub fn load_themes(cwd: &str) -> (Vec<Value>, Vec<String>);   // both tiers, project shadows global by id
pub fn validate_theme(v: &Value) -> Result<Value, String>;    // id/name/palette, unknown palette names rejected
pub fn canonical_chord(s: &str) -> Result<String, String>;     // chord normalisation (grammar of §C.2)
pub fn settings_path(scope: &str, file: &str, cwd: &str) -> Result<PathBuf, String>;
pub fn write_settings(scope: &str, file: &str, patch: &Value, cwd: &str, replace: bool)
    -> Result<(PathBuf, Value), String>;
```

`settings_path` and `write_settings` take the project's `cwd`: the project tier is
`<cwd>/.luuna/`, so without it the project tier cannot be located at all.

`write_settings` reads the existing file, deep-merges `patch` into it and writes it with
the existing `atomic_write` helper (temp file + `rename`), creating the directory tree
first. With `replace = true` the patch *is* the file content (no merge) — a merge can
never remove a key, which "reset to defaults" and "unbind" both need.

`changeDirectory` needs no special handling on the Rust side (nothing is cached); the
**renderer** re-requests `luuna_get_config` after a successful directory change and
re-applies the theme and the keymap (R24).

### E. In-app settings UI

The `Options` menu gains five items (mnemonics chosen to avoid clashes with the existing
`O K M L A R S F` set — use `P`, `T`, `Z`, `Y`, `U`):

| Label | Mnemonic | Action | Opens |
|---|---|---|---|
| Command palette… | `P` | `app.palette` | the palette overlay |
| Theme picker… | `T` | `app.theme` | the theme overlay |
| Font settings… | `Z` | `app.font` | settings dialog, Appearance section |
| Keyboard shortcuts… | `Y` | `app.keybindings` | settings dialog, Keybindings section |
| Settings… | `U` | `app.settings` | settings dialog, Appearance section |

The settings dialog is built with the existing `buildDialog({ title, bodyClass, width })`
helper and `addDialogButton`, with a left-hand section list (Appearance / Keybindings /
Config) and a right-hand content pane, driven by `vimListNav` + `makeListApi` for
keyboard navigation.

* **Appearance** — theme list (built-in + user, with the active one marked), font family
  (text field), font size (stepper, 10-32px), line height (stepper, 1.0-2.0), a
  "Preview" note that changes apply live, and "Reset appearance to defaults". The
  font family is written **once per change**: the `change` event and the dialog's own
  `Enter` handler both persist it, and the second write is suppressed (a failed write
  must not revert a font the first write already applied).
* **Keybindings** — a search field over the action registry, grouped by category; each row
  shows the label, the **origin** of the binding (`RAYCAST` / `EXISTING` / `LUUNA`, §C.3)
  and its current chord(s). The three notes of §C.5 are listed at the top of the
  section, so they are visible without scrolling. `Enter` starts recording (the row shows
  "Press a key…", then the live key and a ~1.5 s auto-save countdown); the next keydown is
  captured by the overlay's own `onKey` (so it never reaches the global handler) and
  stored as the action's override; `Backspace` clears the binding, `Delete` resets the
  action to its **effective default** (§C.4 — the app-settings value when the action has
  one, the registry chord otherwise; the override is removed, not replaced by the
  registry chord); a conflicting chord is refused with a message naming the
  conflicting action, and a bare single-character chord is refused for a global or
  composer action (it could never fire) — in both cases nothing is written. Actions with
  no chord show `(unbound)`.
  * **A plain `Enter` cannot be captured.** `Enter` is the recorder's own key — it
    commits the recording (and `Escape` cancels it), so a bare `Enter` is never
    recorded. The recorder says so when it happens ("A plain Enter is the recorder's own
    key and cannot be captured — record a chord such as `Ctrl+Enter`, or write
    `"Enter"` into the keybindings file"). A chord that *ends* in `Enter` (`Ctrl+Enter`,
    `Shift+Enter`) is a chord like any other and **is** recorded; only the bare key is
    the recorder's own.
  * While the **search field holds text**, `Backspace` and `Delete` edit the text and are
    not intercepted; only with an empty field do they act on the selected row. The guard
    is on the field's **content**, not on the focus: the user types a query, clicks a row
    (which blurs the field but keeps the text) and presses `Delete` — the text must
    survive and no binding may be reset.
  * The actions that share a `group` (the nine recent-session jumps) collapse into
    **one row** that shows all nine chords; `Enter` expands the group and every member
    is then rebindable on its own.
  * The section header names the **tier the writes go to** (`── Keybindings (Project
    tier) ──`) and the note under it says what that means (the project tier is a file
    in the repository; the global tier applies to every project). When the *other* tier
    already binds the same action, the save message says so — the project tier wins per
    key, so a write to the global tier can be shadowed.
* **Config** — the global and project directory paths (from `luuna_config_paths`), a
  scope selector (`Global` / `Project`) that decides where the shortcuts and appearance
  changes are written, an "Open folder" button per tier (using the new
  `luuna_open_folder` bridge method — `luuna_show_in_folder` selects a file and cannot
  open a directory), a "Reload configuration" button and a "Reset all to
  defaults" button. The reset does the **three writes and then one reload** (a reload
  per write would re-read both tiers' settings files and re-scan both theme
  directories three times over). Malformed files are listed here as errors (R26).

Theme picker overlay: a list of the built-in and user themes; moving the selection applies
the theme live as a preview; `Enter` keeps it, `Escape` restores the previous theme.

Command palette overlay (`Mod+K`): a "Search for actions…" field plus a list of the
registry's actions (those with a chord or a menu action), grouped into sections, matched by
a simple case-insensitive subsequence scorer; each row shows the action's currently-bound
chord on the right; `Enter` runs the highlighted action, `Mod+Enter`/`Alt+Enter` run its
secondary/tertiary variant where one is defined, `Escape` closes.

### F. Renderer integration

* **Boot order.** The boot IIFE at the end of `renderer.js` becomes: `luuna.boot()` →
  `luuna.getConfig()` → apply theme + font → apply keymap overrides → `refreshGitAndTree()`
  → `applyFocus()` → `applyZoom()` → `syncInput()` → start the render loop. A config
  failure must not abort the boot (the app falls back to the built-in DOS theme and the
  default keymap) — the error is flashed in the key bar.
* **Theming.** `renderer/themes.js` exports `BUILTIN_THEMES`, `DOS_BLUE`,
  `PALETTE_NAMES`, `resolveTheme(id, themes)` (applies the R7 fallback) and
  `applyTheme(theme, fontOverride)` (the R8 CSSOM writes). `renderer/config.js` exports
  `normaliseConfig(payload)`, `fontFromSettings(appearance, theme)` (R9 precedence),
  `zoomFontSize(size, direction)` and the metric helpers.
* **Metrics.** A hidden probe element (`position:absolute; visibility:hidden;
  white-space:pre`) carrying the current `--font` / `--fs` / `--lh` is measured after every
  font change: `charWidth = probe.getBoundingClientRect().width / 100` (100 "M" glyphs) and
  `lineHeight = lineProbe.getBoundingClientRect().height`. `charWidth()` / `lineHeight()`
  in `renderer.js` return the cached measurement instead of `8.4` / `17.5`. The cache is
  invalidated on font change and re-measured before the next render.
* **Menus.** A `MAIN_MENUS` item may carry a `shortcutAction` field: it is the **action
  id whose chord the row advertises** — an action id, never a chord literal (a literal
  would be looked up as an action id and render as "(unbound)"). Without it the row
  shows the chord of the item's own `action`. The two abort rows — Run ▸ "Abort
  command" and Agent ▸ "Abort agent generation" — both point at `edit.copyOrAbort` and
  show its **explicit** chord (`Ctrl+C`), the one that always aborts; the action's first
  chord is `Mod+C`, which copies the selection when there is one. The registry keeps
  exactly one owner per chord per scope, so the second abort row is not a second
  `Ctrl+C` owner — it is the same action, named from a second menu.
  * The menu column and the key bar advertise the **same** chord: both prefer the
    plain function key of the action (`F4`, `F5`, …) over its alternative chord
    (`Ctrl+Shift+M`), exactly as the key bar does. A row with `shortcutAction` is the
    exception — it shows the action's explicit chord (`Ctrl+C`), because the
    function-key preference would hide the chord that always aborts. This keeps the
    pre-existing menu (which showed `F4`/`F5`) unchanged (R15).
* **App settings.** At boot the renderer applies the app-settings tier to the keymap:
  `app.settings.json`'s `sendKey` / `newlineKey` become the *defaults* of
  `composer.send` / `composer.newline` (§C.4). A malformed value falls back to
  `Enter` / `Shift+Enter`, so the composer is never unable to send. `historySize`
  (default 200) is the composer's message-history limit.
* **Key bar.** `KEY_BAR_ITEMS` becomes a list of *action IDs* (`app.help`, `file.save`,
  `file.open`, `agent.model`, `agent.thinking`, `agent.mode`, `git.diff`, `run.tests`,
  `run.build`, `app.menu`); `renderKeybar()` asks the keymap for the current chord of each
  and renders it.
* **Help screen.** `HELP_LINES` is generated from the registry (grouped by category,
  showing the live chords) plus the normal-mode section. The static text is removed.
* **Guide.** `GUIDE_LINES` keeps its prose but every chord it mentions is interpolated
  from the keymap, so it can never drift.
* **Menu mnemonics** (`MAIN_MENUS[].mnemonic`) and the `Alt+letter` accelerators are
  unchanged and not rebindable.

### G. CSS

* `renderer/renderer.css` keeps its `:root` block as the **DOS Blue default** (so the
  built-in default theme is byte-identical to today) and gains the styles the new dialogs
  need — settings section list, keybinding rows, theme swatches, command-palette list.
* Every new style uses `var(--…)` only. No new hex literal outside `:root`; no 17th
  colour name. The three existing `rgba(0,0,0,…)` box-shadows may stay.
* No `backdrop-filter` (the unprefixed property is Chromium-only); no `<dialog>`; no
  inline styles beyond the existing `dlg.style.width` usage that `buildDialog` already
  performs (setting `element.style` from JavaScript is not blocked by the CSP — only
  `style=` attributes in markup and `<style>` blocks are).

### H. Test strategy and harness

The renderer has no build step, so the pure parts of the three new renderer modules are
written as UMD-style modules that work both as classic browser scripts and as CommonJS:

```js
(function (root, factory) {
	const api = factory();
	if (typeof module === "object" && module.exports) module.exports = api;
	if (root) root.LuunaKeymap = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
	/* … pure functions … */
	return { /* … */ };
});
```

* `package.json` changes `"type": "module"` → `"type": "commonjs"` so that `node --test`
  can `require()` the renderer modules and the `*.test.js` files. The repository has no
  other Node code: the diagnostic scaffolds are `.mjs` (always ESM regardless of the
  `type` field) and are unaffected.
* New test files (Node's built-in test runner, `node:test` + `node:assert/strict`):
  * `test/keymap.test.js` — chord parsing/normalisation, `Mod` expansion per platform,
    `resolve()` matching (modifier set, key derivation, scope filtering), sequence
    handling, `applyOverrides` merging user overrides over defaults, conflict detection.
  * `test/themes.test.js` — theme resolution, palette fallback for a missing name, the
    built-in themes defining all 16 names, DOS Blue matching the current `:root` values.
  * `test/config.test.js` — config normalisation, font precedence, font-size zoom steps,
    the metric-probe helpers, the app-settings tier (the send key and its fallbacks) and
    the two configuration tiers.
  * `test/keyboard.test.js` — the renderer-level guard: the real `renderer.js` is
    evaluated in a `node:vm` context with a stubbed DOM and a stubbed bridge, and the
    **real** keydown listener is driven with synthetic events. It covers the keymap
    resolution in context (the scopes, the overlay and menu intercepts, the Alt
    accelerators) and the behaviours the shortcuts editor owns (the `Delete` guard in
    the search field, the de-duplicated chord labels, the refused bare letter, the
    scope-aware conflict check, the collapsed recent-session group, the two abort rows,
    the configurable send key). The file it drives can be overridden with
    `LUUNA_RENDERER=<path>`, which is how the guard itself is mutation-checked.
* Rust unit tests live in `src-tauri/src/config.rs` under `#[cfg(test)] mod tests`:
  `merge_json` (deep merge; arrays and scalars replaced), tier merge (project wins),
  theme validation (unknown palette name rejected; missing names tolerated), and chord
  canonicalisation (order normalised, unknown modifier rejected, invalid key rejected).
* **Naming rule:** JS test files are `test/*.test.js`. The diagnostic scaffolds
  `test/probe-live-cdp.mjs`, `test/cdp-eval.mjs` and `test/cdp-shot.mjs` are **not**
  tests and must never be picked up by the test glob — Node's test runner treats *every*
  file under a directory named `test` as a test file, so the runner is invoked with an
  explicit file list rather than with the `test/` directory.
* `package.json` scripts (final):

```json
{
  "check":     "cargo check --manifest-path src-tauri/Cargo.toml",
  "check:js":  "node --check renderer/keymap.js && node --check renderer/themes.js && node --check renderer/config.js && node --check renderer/renderer.js && node --check renderer/luuna-provider.js",
  "test":      "cargo test --manifest-path src-tauri/Cargo.toml",
  "test:js":   "node --test test/keymap.test.js test/config.test.js test/themes.test.js test/keyboard.test.js",
  "check:all": "npm run check && npm run check:js && npm test && npm run test:js"
}
```

  `npm test` stays `cargo test`; `npm run check` stays `cargo check`. The explicit file
  list in `test:js` replaces the `test/*.test.js` glob because npm runs scripts through
  `cmd.exe` on Windows (no glob expansion) and because `node --test test/` would pick up
  the `.mjs` scaffolds. **Any new `*.test.js` file must be added to the `test:js` list.**
* CI (`.github/workflows/check.yml`) gains a step running `npm run test:js` (Node 20 is
  already set up in the workflow) before the build step.

## Step by Step Tasks

Each task is ordered and independently checkable. Files listed as *(new)* do not exist yet.

1. **Test harness scaffolding.** `package.json`: change `"type": "module"` to
   `"type": "commonjs"`; add the `check:js`, `test:js` and `check:all` scripts exactly as
   in §H (keep `check` and `test` unchanged). Do not touch the `test/*.mjs` scaffolds.
   *Check:* `node -e "console.log(require('./package.json').type)"` prints `commonjs`.
2. **`renderer/keymap.js` (new)** — the UMD module of §C.1: the `ACTIONS` registry (every
   action of §C.3, including the menu-only ones with empty chord lists), `parseChord`,
   `normalizeChord`, `formatChord` (macOS symbols `⌘⌥⇧⌃`, otherwise `Ctrl+Alt+Shift+`),
   `chordsFor`, `applyOverrides`, `resolve`, `isBound`, `platform` detection
   (`/Mac/i.test(navigator.platform || navigator.userAgent)`), and the event→chord key
   derivation of §C.2. It must not touch the DOM at load time.
   *Check:* `node -e "const k=require('./renderer/keymap.js'); console.log(k.chordsFor('app.palette'))"`
   prints `["Mod+K"]`.
3. **`renderer/themes.js` (new)** — `PALETTE_NAMES` (the 16 canonical names, in CSS
   `:root` order), `DOS_BLUE` (today's exact values), `BUILTIN_THEMES` (dos, amber,
   phosphor, paper, midnight — each with all 16 names and an optional font), `resolveTheme`
   (R7 fallback) and `applyTheme` (R8 CSSOM writes, only touching the 16 names + `--font`,
   `--fs`, `--lh`).
   *Check:* `node -e "const t=require('./renderer/themes.js'); console.log(Object.keys(t.DOS_BLUE.palette).length)"`
   prints `16`.
4. **`renderer/config.js` (new)** — `normaliseConfig(payload)` (tolerates a missing or
   partial payload), `fontFromSettings(appearance, theme)` (R9 precedence), `zoomFontSize`
   (the size ladder 10/11/12/13/14/16/18/20/24/28/32 with `+1`/`-1`/`0` = reset to 14),
   and the metric helpers: `createMetricsProbe()` returning `{ measure() }` that measures
   the char width (100 "M" glyphs) and the line height of the live font, plus
   `invalidateMetrics()`.
   *Check:* `node -e "const c=require('./renderer/config.js'); console.log(c.zoomFontSize(14,1))"`
   prints `16`.
5. **Rust config module.** `src-tauri/src/config.rs` (new) with the surface listed in §D.
   `merge_json` merges two `serde_json::Value`s (objects recursively, everything else
   replaced by the overlay). `load_settings` reads `appearance`/`keybindings`/`app` from
   the global tier and deep-merges the project tier on top. `load_themes` reads
   `<tier>/themes/*.theme.json`, keeps the file stem as the id, validates each theme
   (`validate_theme`) and lets the project tier shadow the global tier by id.
   `canonical_chord` implements the grammar and the canonical order of §C.2 (accepts the
   `Mod`/`Ctrl`/`Meta`/`Alt`/`Shift` modifiers and a named key or a single character;
   rejects unknown modifiers, duplicate primaries and empty keys; returns the canonical
   string). `write_settings` merges and writes atomically via the existing `atomic_write`.
   *Check:* `cargo check --manifest-path src-tauri/Cargo.toml`.
6. **Rust unit tests.** In `src-tauri/src/config.rs`, add `#[cfg(test)] mod tests`
   covering: `merge_json` deep merge (nested objects merge, arrays and scalars are
   replaced), the two-tier merge (project wins, array replaced, scalar replaced), theme
   validation (a palette key outside the 16 names is rejected, a missing name is
   tolerated, the id is required), theme discovery/shadowing, and `canonical_chord`
   (order normalisation, `Mod+Shift+M` → `Mod+Shift+M`, `Shift+Mod+M` → `Mod+Shift+M`,
   `Ctrl+Alt+X` → `Ctrl+Alt+X`, unknown modifier → error, empty key → error).
   *Check:* `cargo test --manifest-path src-tauri/Cargo.toml` runs the new tests.
7. **New Tauri commands.** `src-tauri/src/main.rs`: add `mod config;`, implement
   `luuna_get_config`, `luuna_set_config(scope, file, value, replace)`, `luuna_list_themes`,
   `luuna_read_theme(id)`, `luuna_config_paths` and `luuna_open_folder(path)` with the
   `ok_data` / `fail_msg` envelope, and register all six in the
   `tauri::generate_handler![…]` list (R25).
   `luuna_set_config` validates the scope (`global`/`project`), the file name
   (`appearance`/`keybindings`/`app`) and, for `keybindings`, every chord string through
   `canonical_chord`, so a malformed binding is rejected at the boundary.
   *Check:* `cargo check --manifest-path src-tauri/Cargo.toml` and the handler list contains
   the six new names.
8. **Bridge methods.** `renderer/luuna-provider.js`: add `getConfig`, `setConfig`,
   `listThemes`, `readTheme`, `configPaths` and `openFolder` — one `invoke` per command,
   keeping the 1:1 mapping with the Rust command names (`getConfig` →
   `luuna_get_config`, etc.). `setConfig` omits the `replace` flag rather than sending
   it as `undefined`, which Tauri would reject.
   *Check:* the provider's method count equals the number of registered `luuna_*`
   commands plus `on`.
9. **Script tags.** `renderer/index.html`: add
   `<script src="keymap.js"></script>`, `<script src="themes.js"></script>` and
   `<script src="config.js"></script>` **before** `renderer.js` (the CSP
   `script-src 'self'` allows same-origin scripts).
10. **Wire the keymap into the renderer — dispatch.** `renderer/renderer.js`: add a
    `KEYMAP_HANDLERS` map from action ID to the existing function (e.g. `"app.palette"`
    → `openCommandPalette`, `"file.new"` → `() => luuna.newSession()`); replace the
    hardcoded F1-F10 switch (~1613), the Ctrl block (~1643) and the vim-motion switch
    (~1685) with a single keymap resolution step, keeping the handler order of §C.4; make
    the alt-burst synthesise an `Alt+<letter>` chord and look it up in the keymap before
    falling back to the menu mnemonics; reduce the textarea's own `keydown` handler to the
    IME/overlay guards and route `Enter`/`Shift+Enter`/`Escape`/history through the
    composer-scoped keymap actions. Keep the `Ctrl+W` prefix machinery working through
    the new sequence bindings.
    *Check:* with the app running, F1-F10, Ctrl+F, Ctrl+L, Ctrl+C, Ctrl+D/U, Ctrl+W,
    Tab, the vim motions and Alt+X all still work.
11. **Derive the UI text from the keymap.** `renderer/renderer.js`: remove the `shortcut`
    literals from `MAIN_MENUS` and render the shortcut column from
    `Keymap.chordsFor(item.action)`; turn `KEY_BAR_ITEMS` into a list of action IDs and
    render the live chord; generate `HELP_LINES` from the registry grouped by category
    (plus a normal-mode section); interpolate the chords mentioned in `GUIDE_LINES` from
    the keymap. The `Options` menu gains the five items of §E.
    *Check:* rebinding `app.help` in the settings dialog changes the key bar, the Help
    menu column and the help screen.
12. **Theming and metrics.** `renderer/renderer.js` + `renderer/themes.js` +
    `renderer/config.js`: apply the theme and font at boot (before the first render),
    re-apply them when the user picks a theme or changes the font, and replace the
    hardcoded `charWidth()`/`lineHeight()` (lines 549-550) with the measured values,
    invalidating the cache on every font change. Add the `view.zoomOut` / `view.zoomIn` /
    `view.zoomReset` handlers (they change the font size and persist it).
    *Check:* changing the font size keeps the tree and agent panes aligned (no clipped
    text) and the font-size stepper reflects the new value.
13. **New overlays.** `renderer/renderer.js`: implement `openCommandPalette()` (search +
    list of registry actions, subsequence scorer, Enter runs), `openThemePicker()`
    (live preview, Enter applies, Escape restores), `openSettingsDialog(section)`
    (Appearance / Keybindings / Config), `openSlashCommandMenu()` and
    `openAttachContextMenu()` (composer popups triggered by the typed `/` and `@`). Use
    `buildDialog`, `addDialogButton`, `openPromptDialog`, `vimListNav` and
    `makeListApi`; each overlay sets `state.overlay = { kind, el, onKey }` and is closed
    with `closeOverlay()`. The recording mode of the Keybindings section is implemented in
    the overlay's own `onKey` so a recorded chord never reaches the global handler.
    *Check:* `Mod+K` opens the palette, typing `/` in the composer opens the slash list.
14. **Settings persistence.** `renderer/renderer.js`: write changes through
    `luuna.setConfig(scope, file, patch)` — appearance changes to
    `appearance.settings.json`, rebinds to `keybindings.settings.json` — then re-read
    `luuna.getConfig()` and re-apply. A failed write flashes the error and does not
    change the applied state. The scope selector (Global / Project) lives in the Config
    section and is remembered in the renderer state only.
    *Check:* rebinding an action creates/updates
    `<cwd>/.luuna/config/keybindings.settings.json` and the binding survives a restart.
15. **Config section and paths.** `renderer/renderer.js`: show the global and project
    paths from `luuna.configPaths()`, add "Open folder" buttons that call the existing
    `luuna.showInFolder(path)`, a "Reload configuration" button and a "Reset all to
    defaults" button (which clears the overrides in the chosen scope), and list any
    malformed-file errors reported by the backend.
    *Check:* the Config section shows the two paths and the Open-folder button opens them.
16. **Project switch re-reads the config.** `renderer/renderer.js`: after a successful
    `luuna.changeDirectory(...)` in `changeDirectoryDialog()`, re-fetch the config, re-apply
    the theme/font and re-apply the keymap overrides (R24).
    *Check:* changing into a repo that has its own `.luuna/` changes the theme and the
    shortcuts immediately.
17. **CSS for the new dialogs.** `renderer/renderer.css`: add the styles for the settings
    section list, the keybinding rows, the theme swatches and the command-palette list,
    using `var(--…)` only; keep `:root` byte-identical to today; add no hex literal
    outside `:root` and no new colour name.
    *Check:* `grep -n "#[0-9a-fA-F]\{3,6\}" renderer/renderer.css` returns only the 16
    `:root` values.
18. **JS unit tests.** `test/keymap.test.js` (new), `test/config.test.js` (new),
    `test/themes.test.js` (new) — the cases listed in §H. The test files must be named
    `*.test.js` and must not touch the DOM.
    *Check:* `npm run test:js` passes.
19. **CI.** `.github/workflows/check.yml`: add a step running `npm run test:js` (and
    `npm run check:js`) after the Rust type-check and before the build.
    *Check:* the workflow file contains the step.
20. **Full validation.** Run the commands in "Validation Commands" below and fix every
    failure. Then verify manually in the running app: switch themes, change the font,
    open the settings dialog, rebind `Mod+K` to something else and confirm the menu
    column, key bar, help screen and guide all follow, and confirm the old binding no
    longer fires.

## Validation Commands

Run in this order; stop at the first failure.

```bash
npm run check          # cargo check --manifest-path src-tauri/Cargo.toml
npm test               # cargo test --manifest-path src-tauri/Cargo.toml  (includes the new Rust unit tests)
npm run test:js        # node --test test/keymap.test.js test/config.test.js test/themes.test.js
npm run check:js       # node --check on the three new renderer modules
npm run check:all      # check + check:js + test + test:js  (the full gate)
```

Change-specific checks (each proves one part of this feature):

```bash
# R27 — the new Rust unit tests really run and pass
cargo test --manifest-path src-tauri/Cargo.toml config:: -- --nocapture

# R28 — the keymap module is require()-able and resolves a chord
node -e "const k=require('./renderer/keymap.js'); const e={key:'k',code:'KeyK',ctrlKey:true,metaKey:false,altKey:false,shiftKey:false}; console.log(k.resolve(e,{focus:'input'}).actionId)"

# R4/R5 — the built-in themes define all 16 canonical palette names
node -e "const t=require('./renderer/themes.js'); console.log(Object.keys(t.BUILTIN_THEMES).map(id=>[id,Object.keys(t.BUILTIN_THEMES[id].palette).length]))"

# R4 — no colour literal leaked outside :root
grep -n "#[0-9a-fA-F]\{3,8\}" renderer/renderer.css
```

Manual end-to-end (the app must be launched with `npm run dev`):

1. `Options → Theme picker…` → pick **Paper** → the desktop and panes repaint immediately;
   pick **DOS Blue** → the original colours return.
2. `Options → Settings…` → *Appearance* → change the font size to 18px → the tree and the
   agent pane stay aligned and the key bar is unaffected.
3. `Options → Keyboard shortcuts…` → rebind **Command palette** from `Mod+K` to `Mod+J` →
   `Mod+K` no longer opens the palette, `Mod+J` does, and the Options menu column, the key
   bar and the help screen all show `Ctrl+J` (or `⌘J`).
4. Rebind it to a chord that another action already owns → the rebind is refused and the
   message names the conflicting action.
5. Write a project-scoped setting → `<cwd>/.luuna/config/keybindings.settings.json`
   appears and is honoured after a restart; the same change in the *global* scope is
   overridden by the project file.
6. `File → Change directory…` into a repo that contains a `.luuna/` folder → its theme and
   shortcuts take effect immediately.

## Out of Scope

- A real fuzzy-search algorithm for the command palette — a simple case-insensitive
  subsequence scorer only.
- Native OS-level global hotkeys (the app is only reachable while it has focus) and any
  system-wide "launch LUUNA" key.
- Syncing settings between machines (no cloud account, no sync service) and importing /
  exporting a settings bundle as a single file.
- Shipping a theme editor that writes a new theme file from scratch — the theme picker
  selects and previews existing themes; new themes are authored by hand as
  `.luuna/themes/<id>.theme.json` (a "Save current theme as…" button is a follow-up).
- Rebinding the DOS **menu mnemonics** (`Alt+F`…`Alt+H`) or the menu's structural
  navigation; they stay tied to `MAIN_MENUS`.
- Live file-watching of `.luuna/` — the configuration is re-read at boot, after a
  directory change and on demand via "Reload configuration".
- Creating a `.luuna/` folder in the user's repo automatically, or adding it to
  `.gitignore` for them; the app only creates the folder when the user explicitly writes
  a project-scoped setting.
- Per-user colour-blind or high-contrast variants beyond the five shipped themes, and any
  17th palette colour.
- A settings UI for the Pi-side configuration (`~/.pi/agent/models.json`,
  `enabledModels`) — that stays in the existing API-keys / custom-model dialogs.
- Changing the `Ctrl+W` follow-up keys (`h`/`j`/`k`/`l`/`w`) into individually rebindable
  actions — the prefix is rebindable, its follow-ups are not.
- WebKit-incompatible conveniences (`<dialog>`, `navigator.clipboard`, `structuredClone`,
  `ResizeObserver`, unprefixed `backdrop-filter`).

## Notes

- **Risk — the keydown rewrite.** The global `keydown` handler in `renderer.js` is the
  highest-risk file in this change: its order is load-bearing (alt-burst before
  `armAltBurst`, overlay before menus) and the vim motions swallow bare letters. Task 10
  must preserve that order and must be validated with the manual checklist in the
  Validation Commands, not just by the unit tests (the unit tests cover the keymap
  algebra, not the DOM event flow).
- **Risk — CSP.** Theming must go through `documentElement.style.setProperty`. Injecting a
  `<style>` element or a stylesheet would be blocked by `style-src 'self'` and would also
  break the "no inline styles" convention.
- **Risk — duplicate palette knowledge.** The 16 palette *names* exist in Rust
  (`PALETTE_NAMES`, for validation) and in `renderer/themes.js` (for the values). The
  names must stay in sync; the values exist in exactly one place. A reviewer should check
  both lists against `renderer.css`.
- **Deliberate duplication of the merge algorithm.** The deep merge exists in Rust
  (`merge_json`) only. The renderer never merges files — it consumes the merged payload
  from `luuna_get_config` — so there is no second implementation to drift.
- **Follow-up candidates.** Per-panel "unbound" actions, a "Save current theme as…"
  button, per-repository theme inheritance beyond the project tier, and a `luuna-reload`
  CLI for headless config validation.
- The `docs/raycast-keybindings.md` file stays the reference for the default chords; the
  table in §C.3 is derived from it, and the deviations of §C.5 are recorded here so the
  two do not have to be re-derived.
