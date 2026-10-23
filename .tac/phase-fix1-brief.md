# Phase FIX-1 brief — findings from the review of `cf2d125e`

**Worktree:** `C:/Users/localhost/github/luuna-ai-wt` (branch `feat/raycast-keybindings-themes-config`, HEAD `6f54fa5`).
**Spec:** `specs/feature-configurable-themes-keybindings.md` (R1–R30, §A–§H).
**Review verdict:** PASS — no blockers. 13 findings, all tech_debt or skippable. This round fixes the ones that are real user-visible defects or unmet requirement clauses.

Do NOT touch `C:/Users/localhost/github/luuna-ai` — a parallel session owns that checkout.
Do NOT commit, push, or create a branch. Leave everything in the working tree.

## Already done in this round (do not redo)

- `test/keyboard.test.js` was added: the renderer-level keyboard regression guard. It evaluates
  `renderer/renderer.js` in a `node:vm` context with a stubbed DOM and a stubbed bridge, and drives the
  real keydown listener. 60 tests, all green. It is wired into `npm run test:js` (`package.json`).
  `CLAUDE.md` documents it.

## Fix list

### 1. `Delete` in the keybindings search field resets a binding — `renderer/renderer.js:2478`

The `Backspace` branch has an explicit guard ("the search field keeps its own Backspace while it holds
text"); the `Delete` branch has none. The user types "com" in the search field, presses `Delete` to
delete a character, and instead the highlighted action's binding is silently reset to its default and
written to the settings file.

**Fix:** mirror the `Backspace` guard — when the search field holds text, let `Delete` edit the text
and do not intercept it. When the field is empty, `Delete` keeps its documented meaning (restore the
default).

### 2. The same chord is printed twice on Windows/Linux — `renderer/renderer.js:2281`

The registry stores `edit.copyOrAbort = ["Mod+C","Ctrl+C"]`, `view.clear = ["Mod+L","Ctrl+L"]`,
`view.halfPageDown = ["Mod+D","Ctrl+D"]`, `view.halfPageUp = ["Mod+U","Ctrl+U"]`. `Mod` expands to
`Ctrl` off macOS, so both entries format to the same label and the column reads "Ctrl+C / Ctrl+C".

**Fix:** de-duplicate the *formatted* chord labels after expansion. The stored chords stay as they are
(the two spellings are meaningful on macOS); only the rendered label collapses. Every place that
renders a chord set — the keybindings editor, the command palette, the menu column, the key bar, the
help screen, the guide — must go through the same helper so they agree.

### 3. The origin of a binding is never shown — `renderer/renderer.js:2305` (R16, last clause)

`origin` ("raycast" | "existing" | "luuna") is recorded on every action and never read. R16 says
"LUUNA-specific bindings are labelled as such in the shortcuts editor", and §C.3/C.4/C.5 require the
editor to carry three notes: the `Ctrl+F` vs `Mod+Shift+F` deviation, the `Mod+0` deviation, and the
fact that the `Alt+letter` menu accelerators are not rebindable.

**Fix:** render the origin next to the label in the Keybindings section (a small tag: e.g. `LUUNA` for
the invented ones, `Raycast` for the documented ones — pick one consistent, readable scheme) and add
the three notes to that section. The notes must be visible without scrolling to the bottom if that is
cheap; otherwise put them at the end of the section, clearly labelled.

### 4. The `app` tier is written but never read — the send key is not configurable

`cfg.app` is never read anywhere in the renderer. The registry hardcodes `composer.send = ["Enter"]`
and `composer.newline = ["Shift+Enter"]`. §C.3's send-key note and §C.5.3 prescribe a configurable
send key, and `app.settings.json` exists for it.

**Fix:** read the send key from `cfg.app` at boot and apply it to the `composer.send` binding (and
`newlineKey` to `composer.newline` if the spec names it — check §C.5.3 and use the exact key names the
spec uses). The setting must survive a restart, must not break the default (`Enter` sends, `Shift+Enter`
breaks the line), and a failed or malformed value must fall back to the default rather than leaving the
composer unable to send. If the spec does not in fact prescribe a configurable send key, then instead
remove the write of `app.settings.json` and say so in the report — but read the spec before deciding.

### 5. "Reset all to defaults" re-reads the config three times — `renderer/renderer.js:2631`

Three `writeConfig` calls, each ending in `applyConfiguration()` → a full backend round trip that
re-reads both tiers' three settings files and re-scans both theme directories.

**Fix:** make the reset do the three writes and then reload once.

### 6. The font-family field writes twice on Enter — `renderer/renderer.js:2046`

The input's `change` listener persists the family and the dialog's `key` handler calls `activate()`,
which persists the same value again. Browsers fire `change` on Enter for a text input whose value
changed since focus, so both paths run. If the first write succeeds and the second fails, `restoreFont()`
reverts a font the first write already applied and persisted.

**Fix:** one write per change. The dialog persists on `Enter` and on the reset path; the `change`
handler must not duplicate that. Keep the "a failed write changes nothing" invariant.

### 7. "Abort agent generation" shows an empty shortcut column — `renderer/renderer.js:419`

`agent.abort` has `chords: []` and is not in `ALIASES` (only `run.abort` → `edit.copyOrAbort` is), so
`actionChord("agent.abort")` returns `""`. The Run menu's "Abort command" row shows a chord, the Agent
menu's "Abort agent generation" row shows nothing, and both call `luuna.abort()`. The original UI showed
`Ctrl+C` on that row, so the row lost its hint.

**Fix:** both rows must show the same, correct chord. Prefer giving the menu a way to state the chord
for a row explicitly (a per-row `shortcut` field) over adding a second `Ctrl+C` owner to the registry —
the registry must keep exactly one owner per chord per scope, or the resolution layer will start
claiming the same chord twice.

### 8. The abort row advertises the wrong chord on macOS — `renderer/renderer.js:36`

`actionChord()` returns the first chord of the list, and `edit.copyOrAbort`'s first chord is `Mod+C`
(⌘C on macOS). But ⌘C copies the selection when there is one and only aborts otherwise; the chord that
always aborts is `Ctrl+C`, its second chord.

**Fix:** the rows whose meaning is "abort" must show the abort chord. This is the same fix as #7 —
if the per-row `shortcut` field is the mechanism, use it for both rows.

### 9. A bare letter recorded for a global-scoped action can never fire — `renderer/keymap.js:619`

`bareAllowed()` only lets a bare single-character chord match an action whose scope includes
normal/tree/agent, so a global- or composer-scoped action can never own one. The recorder accepts it
anyway, writes it, flashes "Command palette -> K" — and the binding never fires. The palette is then
no longer reachable by keyboard at all, with nothing telling the user.

**Fix:** refuse a bare single-character chord for a global/composer-scoped action in the recorder, with
a message that says why. The refusal must not leave a half-written setting file behind.

### 10. The conflict check ignores the scope — `renderer/keymap.js:708`

`findConflict()` compares only the expanded chord. The user rebinds the global "Command palette" to
`Enter`; `composer.send` already owns `Enter`, so the recorder refuses it — even though `Enter` is only
live while the composer has the focus and the two can never fire at the same time. The same refusal
blocks a global action from taking any composer-only chord.

**Fix:** compare the scopes as well and only refuse when the two actions can be active at the same
time. `scopeActive`/`scopeMatches` already exist in `renderer/keymap.js` — use them. A genuine
conflict (two global actions, or two actions live in the same pane scope) must still be refused by
name.

### 11. The write scope is invisible where the writes happen — `renderer/renderer.js:2383`

The scope selector lives only in the Config section, but the Keybindings and Appearance sections write
to `state.configScope` (default "project"). The user rebinds an action and has no way to see that the
write went to the project tier — creating `.luuna/config/keybindings.settings.json` in the repo by
default. Worse, when the other tier already owns that action, the write succeeds, the message says
"saved", and the effective binding silently remains the other tier's because the project wins per key.

**Fix:** show the active scope in the Keybindings and the Appearance section headers, and say plainly
what a write to the project tier means (it creates a file in the repo). If the other tier already owns
the key, the message must say so rather than claiming a plain success.

### 12. The nine recent-session jumps are not collapsed — `renderer/renderer.js:2284`

§C.3 says "the shortcuts editor collapses the group into one row showing all nine chords". The registry
marks the nine actions with `group: "Recent sessions"` and the handler derives the index from the action
id, but the editor emits one row per action, so the list shows nine near-identical rows and `group` is
never read.

**Fix:** group the Keybindings rows by `action.group` and render one row per group showing all nine
chords, with the individual actions still individually rebindable.

### 13. The composer-popup docstring does not match the behaviour — `renderer/renderer.js:2710`

The docstring says a chord-opened popup "the item replaces the word the caret is in". The code
(`renderer/renderer.js:2763`) replaces the *filter region* — `value.slice(0, filterStart) + body +
value.slice(caret)` — i.e. the text typed after the popup opened. The behaviour is the sensible one;
the docstring is wrong.

**Fix:** correct the docstring. No behaviour change.

### 14. The sixth backend command is not in the spec — `src-tauri/src/main.rs:2168`

R25 says "Five new Tauri commands exist"; the build ships six (`luuna_open_folder` is the sixth). The
addition is justified — `luuna_show_in_folder` runs `explorer /select,<path>`, which selects a file
inside a directory and cannot open the directory itself, so the Config section's "open folder" buttons
would not have worked with it. The bridge is 1:1 (verified: 51 provider invokes ↔ 51 registered
commands, identical name sets).

**Fix:** record the sixth command in the spec's R25 and §D tables, and state why it exists. Also record
in the spec that `luuna_set_config` takes an optional `replace` flag (a merge can never remove a key,
so "reset to defaults" and "unbind" need it) and that `settings_path`/`write_settings` take a `cwd`
(the spec's signatures cannot locate the project tier).

## Constraints

- **The registry must keep exactly one owner per chord per scope.** No new collisions — the reviewer
  verified mechanically that there are none today; that property must survive this round.
- **Tabs for indentation**, the house style.
- **The theme is a fixed 16-colour DOS palette**: no new colour names, and no hex literal in
  `renderer/renderer.css` outside the `:root` block.
- **CSP-safe**: `default-src 'self'; style-src 'self'; script-src 'self'`. No `<style>` block, no
  `style=` attribute, no inline `<script>`. CSSOM writes (`element.style.setProperty`) are fine.
- **WebKit-compatible** (macOS WKWebView): no `<dialog>`/`showModal`, no `navigator.clipboard`, no
  `structuredClone`, no `ResizeObserver`, no unprefixed `backdrop-filter`.
- **No secrets.**

## Tests

Extend `test/keyboard.test.js` (the renderer-level guard) with cases for the behaviours this round
changes — at minimum: `Delete` in the keybindings search field edits the text instead of resetting a
binding; the chord label set has no duplicates; a bare letter for a global action is refused with a
message; a scope-disjoint chord is not refused as a conflict while a genuine one still is. Add unit
tests to `test/keymap.test.js` for the pure parts of #9 and #10.

**`npm run check:all` must be green before you report.** That is `cargo check` + the renderer syntax
check + `cargo test` + `node --test` (116 JS tests today; the number will grow).

## Report back

- what you changed, file by file;
- the new test names;
- anything you did not fix, and why;
- the `npm run check:all` result;
- `BUILD: DONE` or `BUILD: FAILED`.
