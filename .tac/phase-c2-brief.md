# Phase C2 brief — new overlays, settings UI, persistence, CSS

(This file is the brief handed to the Phase C2 builder agent. It is a working
document, not a spec — the spec is `specs/feature-configurable-themes-keybindings.md`.)

## Scope

Phase C1 rewires `renderer/renderer.js` so the keymap drives dispatch, the menu
shortcut column, the key bar and the help screen, and so the theme/font/metrics are
applied at boot. **Phase C2 adds the user-facing surfaces that the new configuration
system needs**, plus the CSS and the docs.

Files to change:

- `renderer/renderer.js` — the new overlays, the `Options` menu items, the persistence
  helpers, and the `KEYMAP_HANDLERS` entries that C1 left as placeholders.
- `renderer/renderer.css` — styles for the new dialogs.
- `README.md` and `CLAUDE.md` — document the new configuration surface.

Do **not** touch `renderer/keymap.js`, `renderer/themes.js`, `renderer/config.js`,
`src-tauri/src/config.rs`, `src-tauri/src/main.rs`, `renderer/luuna-provider.js` or
`package.json` — they are done and tested.

**Already done for you:** the `luuna_open_folder` command and its `openFolder` provider
method exist (added during C1, because `luuna_show_in_folder` runs
`explorer /select,<path>`, which selects a *file* in its parent rather than opening a
directory). The bridge is currently 51 commands ↔ 51 provider invokes. Call
`luuna.openFolder(path)` for the "open the .luuna folder" buttons.

## The overlays to build

All of them follow the existing pattern: `buildDialog({ title, bodyClass, width })`
returns `{ backdrop, dlg, body, buttons }`; the overlay is registered as
`state.overlay = { kind, el: backdropOf(dlg), onKey }`; `closeOverlay()` removes it and
returns focus to the input. Use `addDialogButton`, `openPromptDialog`, `openTextPopup`,
`vimListNav` and `makeListApi` rather than inventing new helpers.

### 1. `openCommandPalette()` — the `Mod+K` Action Panel analogue

Raycast's Action Panel is the model (`docs/raycast-keybindings.md` documents it):

- A "Search for actions…" field at the top.
- The actions grouped into **sections** (Raycast groups them: Primary Action, Favorites,
  Configure, …). Use the registry's `category` as the section key.
- **Each action shows its currently-bound chord on the right** — Raycast's own words:
  "Each action shows its keyboard shortcut on the right, so you can learn to trigger
  them directly over time."
- `Enter` runs the highlighted action. `Mod+Enter` runs a secondary variant and
  `Alt+Enter` a tertiary one **where the action defines them**; otherwise they behave
  like `Enter`.
- Typing filters the list with a simple case-insensitive **subsequence** scorer
  (all the query's characters appear in order in the label). A plain substring match is
  not enough — a subsequence match is what makes "cmdp" find "Command palette".
- `Escape` closes.

The list of actions: every registry action that has a chord or a menu action. Reuse the
existing `.listrow` / `.dline` CSS classes where they fit.

### 2. `openThemePicker()` — the theme overlay

- A list of the built-in themes **and** the user themes (`LuunaThemes.mergeThemes`
  already merges the two, with the user theme shadowing the built-in by id).
- Moving the selection **applies the theme live as a preview**; `Enter` keeps it,
  `Escape` restores the previous theme.
- Show the theme's 16 palette values as small swatches so the user can see what they are
  choosing.
- Persist the choice through `luuna.setConfig(scope, "appearance", { theme: id })`.

### 3. `openSettingsDialog(section)` — the settings dialog

One dialog, three sections, reachable from the `Options` menu and from `Mod+,`. A
left-hand section list (Appearance / Keybindings / Config) and a right-hand content pane,
driven by `vimListNav` + `makeListApi`.

**Appearance** — the theme list (with the active one marked), the font family (text
field), the font size (stepper, 10-32px), the line height (stepper, 1.0-2.0), a note
that changes apply live, and "Reset appearance to defaults".

**Keybindings** — a search field over the action registry, grouped by category; each row
shows the label and its current chord(s). The recorder mirrors Raycast's:

- `Enter` starts recording; the row shows "Press a key…", then the live key and a
  **~1.5 second auto-save countdown** (or `Enter` to save immediately).
- The next keydown is captured by the **overlay's own `onKey`**, so a recorded chord
  never reaches the global handler.
- `Backspace` clears the binding; `Delete` resets the action to its default.
- A chord already bound to another action is **refused with a message naming the
  conflicting action** — do not silently overwrite it. `LuunaKeymap.findConflict` exists
  for this.
- An action with no chord shows `(unbound)`.

**Config** — the global and project directory paths (from `luuna.configPaths()`), a scope
selector (`Global` / `Project`) that decides where changes are written, an "Open folder"
button per tier (the new `luuna.openFolder(path)`), a "Reload configuration" button, a
"Reset all to defaults" button (clears the overrides in the chosen scope), and any
malformed-file errors the backend reports (`luuna.getConfig()` returns an `errors`
array — the Rust side deliberately returns it so a bad file can be shown).

### 4. `openSlashCommandMenu()` and `openAttachContextMenu()` — the composer popups

- Typing `/` at the start of the composer opens a list of the app's slash commands
  (`/status`, `/model`, `/effort`, `/plan`, `/build`, `/diff`, `/test`, `/save`,
  `/resume`, … — read them from the existing slash-command handler in `renderer.js`).
  Selecting one **inserts it into the composer**; it does not send.
- Typing `@` opens a list of the project files to attach (the project tree is already
  loaded in `state.tree`; use `luuna.getTree()` if a fresh list is needed). Selecting one
  inserts a reference to it into the composer.
- **Neither is a chord** — they are triggered by the typed character, so ordinary typing
  is never swallowed. The typed `/` and `@` stay in the composer text.

### 5. The five `Options` menu items

Per the spec's §E, with mnemonics chosen to avoid the existing `O K M L A R S F` set —
use `P`, `T`, `Z`, `Y`, `U`:

| Label | Mnemonic | Action | Opens |
|---|---|---|---|
| Command palette… | `P` | `app.palette` | the palette overlay |
| Theme picker… | `T` | `app.theme` | the theme overlay |
| Font settings… | `Z` | `app.font` | settings dialog, Appearance section |
| Keyboard shortcuts… | `Y` | `app.keybindings` | settings dialog, Keybindings section |
| Settings… | `U` | `app.settings` | settings dialog, Appearance section |

Register the matching handlers in the `KEYMAP_HANDLERS` map that Phase C1 created, and
remove the placeholders it left for `app.palette`, `app.settings`, `app.theme`,
`app.keybindings`, `agent.attachContext`, `agent.findInChat` and
`session.regenerateModel`.

- `agent.attachContext` → the attach-context menu.
- `agent.findInChat` → a find overlay over the agent panel: a text field, `Enter` jumps
  to the next match, `Mod+G` / `Shift+Mod+G` for next/previous, `Escape` closes. Keep it
  simple — highlight the matching entry in the agent panel and scroll it into view.
- `session.regenerateModel` → open the model selector, and when a model is chosen,
  regenerate the last response with it.

## Persistence

All writes go through `luuna.setConfig(scope, file, patch)`:

- appearance changes → `appearance.settings.json`
- rebinds → `keybindings.settings.json`
- app preferences (e.g. the send key) → `app.settings.json`

`scope` is `"global"` or `"project"`. After a successful write, re-read the config
(`luuna.getConfig()`) and re-apply the theme, the font and the keymap overrides. **A
failed write flashes the error and does not change the applied state.**

### Resetting — use the `replace` flag

`luuna.setConfig(scope, file, value, replace)` takes an optional fourth argument.
By default the patch is **deep-merged** into the existing file, so a partial patch
never drops the other keys. A merge can never *remove* a key, so the two reset
buttons need `replace = true`, which makes the value the whole file:

- "Reset appearance to defaults" →
  `setConfig(scope, "appearance", { theme: "dos", font: {…defaults…} }, true)`
- "Reset all to defaults" in the Config section →
  `setConfig(scope, "keybindings", {}, true)` and
  `setConfig(scope, "appearance", { …defaults… }, true)` and
  `setConfig(scope, "app", {}, true)`

A `replace` also overwrites a malformed file, which is the only way to recover one
from inside the app. Without it the backend refuses to overwrite a file it could
not parse — that refusal is deliberate, so never work around it by writing the
file from the renderer.

The scope selector lives in the Config section and is remembered in the renderer state
only.

**Phase C1 left `persistAppearance(patch)` hardcoded to the `"project"` scope** (with a
comment saying so). The scope selector must replace that: keep the selected scope in
the renderer state and use it in every write — `persistAppearance` included.

**Phase C1 left `toggleSidebar()` doing the layout in JavaScript** (`tree.style.display`,
`desktop.style.gridTemplateColumns`, with the comment "the stylesheet does not know the
class yet"). Move that into `renderer/renderer.css` as a `.no-tree` rule on the desktop
grid, so the layout is CSS again and the toggle only flips the class.

## CSS

- `renderer/renderer.css` keeps its `:root` block **byte-identical** to today.
- New styles use `var(--…)` only. **No new hex literal outside `:root`; no 17th colour
  name.** The three existing `rgba(0,0,0,…)` box-shadows may stay.
- No `backdrop-filter` (unprefixed is Chromium-only), no `<dialog>`, no inline
  `style=` attributes in markup and no `<style>` blocks. Setting `element.style` from
  JavaScript is fine — the CSP only forbids `style=` attributes in markup and `<style>`
  blocks.
- The app must keep working in **WebKit** (macOS WKWebView): no `navigator.clipboard`,
  no `structuredClone`, no `ResizeObserver`, no `<dialog>`/`showModal`.
- The new classes: the settings section list, the keybinding rows, the theme swatches,
  the command-palette list, the find bar. Reuse `.listrow`, `.dlg-field`, `.dlg-input`
  and `.dline` where they fit.

## The new `luuna_open_folder` command — already done

`luuna_show_in_folder` runs `explorer /select,<path>` on Windows, which selects a file
inside its parent folder — the wrong behaviour for opening a directory. The
`luuna_open_folder` command and its `openFolder` provider method were added during C1.
**Use `luuna.openFolder(path)`**; do not add another command.

Keep the bridge 1:1 — the number of `invoke("luuna_…")` calls in the provider must equal
the number of `luuna_*` commands in `generate_handler!`, and the two name sets must be
identical.

## Docs

**Already done — do not redo.** `README.md` (keyboard table, Themes section,
Configuration section) and `CLAUDE.md` (the `.luuna/` conventions, the corrected
"Duplicated data" section, the new test commands) have both been written. Read them,
and only correct them if the implementation you build contradicts them — for example
if the settings dialog ends up with a different file layout than the README describes.

## Validation

```
npm run check
npm test
npm run test:js
npm run check:all
```

All four must pass. Then check the bridge parity (provider invokes ↔ registered
commands) and confirm no hex literal crept into `renderer/renderer.css` outside
`:root`.
