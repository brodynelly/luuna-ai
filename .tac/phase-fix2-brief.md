# Phase FIX-2 brief — the second fix round of `cf2d125e`

**Worktree:** `C:/Users/localhost/github/luuna-ai-wt` (branch `feat/raycast-keybindings-themes-config`, HEAD `6f54fa5`).
**Spec:** `specs/feature-configurable-themes-keybindings.md` (R1–R30, §A–§H).

The first review (PASS, 13 findings) and the first fix round (14 fixes, all verified fixed) are done. The
re-review of that round came back **PASS** again, with 6 `tech_debt` and 6 `skippable` findings and no
blockers. This round fixes the two findings a user can actually hit, plus the cheap ones.

Do NOT touch `C:/Users/localhost/github/luuna-ai` — a parallel session owns that checkout.
Do NOT commit, push, or create a branch. Leave everything in the working tree.

## The state you are building on

- `renderer/keymap.js` — the registry, the chord grammar, the resolver. It now has three tiers of
  ownership (explicit override > app-settings default > registry chord), a scope rank
  (composer 4 > tree/agent 3 > normal 2 > global 1), scope-aware conflict detection, and
  `formatChordSet` for de-duplicated labels.
- `renderer/config.js` — the merged config, `appKeyDefaults` / `normaliseHistorySize` / `validComposerChord`,
  the app tier applied as *defaults* before the explicit overrides.
- `renderer/renderer.js` — the keymap-driven renderer, the overlays, the settings dialog.
- `src-tauri/src/config.rs` + `src-tauri/src/main.rs` — the config tiers; `luuna_get_config` returns
  `{ settings, tiers, themes, errors, paths }`.
- `test/{keymap,config,themes,keyboard}.test.js` — 150 JS tests; `cargo test` — 30.

**The two invariants that must survive this round** (the re-review verified them; keep them true):
1. **Exactly one owner per chord per scope**, over the whole registry, on both Windows and macOS, with
   the app-settings tier applied.
2. **No pre-existing binding changed behaviour** — the scope-rank resolution returns the same action as
   the previous registry-order resolution for every registry chord in the `input`, `tree` and `agent`
   contexts.

## Fix list

### 1. "Reset to default" restores the registry chord, not the effective default — `renderer/renderer.js:2716`

This is the one the reviewer says a user can hit. `resetToDefault()` writes the *registry* chord as an
explicit override. With `app.settings.json` containing `{"sendKey":"Ctrl+Enter"}`, the effective binding
of "Send message" is `Ctrl+Enter`; the user selects the row and presses `Delete`; the registry chord
`Enter` is written as an explicit override; the effective binding becomes `Enter` and the configured
send key is shadowed — **permanently**, because pressing `Delete` again writes `Enter` again. The
app-settings value can no longer be restored from the UI.

**Fix:** `Delete` must restore the action's *effective default* — the app-settings value when there is
one, the registry chord otherwise. Do not write an override that shadows the app tier. The spec's
wording ("Delete resets the action to its default") is ambiguous between the two; §C.4's tier model
points at the effective default. Record the decision in the spec.

### 2. A failed font-family write does not restore the previous family — `renderer/renderer.js:2303`

The "a failed write must not change the applied state" invariant is broken for the family. The input
handler applies the family live (`font = {...font, family}`) *before* `persistFamily()` runs, so the
snapshot `persistFamily` takes (`const before = {...font}`) already contains the **new** family. If the
write fails, `restoreFont(before)` restores the new family again — the UI keeps an unsaved font family,
although the code comment claims otherwise.

The size (`:2314`) and line-height (`:2328`) paths snapshot *before* mutating and are correct.

**Fix:** restructure the family flow the way `changeSize` / `changeLineHeight` do it — capture the
previous value before the live apply and restore *that* on a failed write.

### 3. An app-settings default can silently unbind another action — `renderer/keymap.js:680`

`defaultCollides()` drops the registry chord of a same-scope action that the app default takes over,
and nothing tells the user. With `{"sendKey":"Escape"}` the `composer.cancel` chord is dropped and
`chordsFor('composer.cancel')` is `[]`; with `{"sendKey":"ArrowUp"}` it is `composer.historyPrev`. The
editor shows "(unbound)", which is confusing; the composer gives no hint.

**Fix:** the user must learn about it. Either refuse such a `sendKey` the way two equal send/newline
keys are refused, or warn — a note in the Keybindings section and/or a flash at boot naming the action
that lost its chord. Whichever you choose, the behaviour must be explained in the spec too.

### 4. The README does not document the app tier — `README.md:101`

It states "In the message composer: Enter sends, Shift+Enter inserts a newline" as fixed, and describes
`.luuna/config/app.settings.json` only as "miscellaneous preferences". The renderer reads `sendKey`,
`newlineKey` and `historySize` from it.

**Fix:** name the three keys under `app.settings.json` and qualify the composer line with "by default".

### 5. The menu column and the key bar advertise different chords — `renderer/renderer.js:96`

`rowChord()` shows the first chord of the action; `actionDisplayChord()` (used by the key bar) prefers
the plain function key. "Select model…" shows `Ctrl+Shift+M` in the menu but `F4` in the key bar;
"Thinking effort…" shows `Ctrl+Shift+U` vs `F5`. **The original menu showed `F4`/`F5`** — this is a
regression against the pre-existing UI, and R15 says nothing regresses.

**Fix:** the menu column must prefer the plain F-key the way the key bar does, keeping the explicit-chord
rule for the two abort rows (which must show `Ctrl+C`, not `⌘C`).

### 6. The `Delete` / `Backspace` guard also needs the focus — `renderer/renderer.js:2801`

The guard requires the search field to be `activeElement`. The user types "com" in the search field,
clicks a row to select it (the click blurs the field, the text stays), then presses `Delete` — the
guard does not apply and the highlighted action's binding is reset and written, even though the search
field still holds text.

**Fix:** base the guard on the field's *content* (`search.value`), not on focus. `Backspace` has the
same shape and should be fixed the same way.

### 7. The keyboard test leaks a rebinding into the shared keymap — `test/keyboard.test.js:1313`

The test "a member of the collapsed group is still rebindable on its own" writes `session.jump1 ->
['Alt+Shift+1']` through the real write path and never clears it. No current test depends on it, but
any future test asserting the recent-session chords will fail depending on the test order.

**Fix:** clear the overrides in `test.afterEach` (`Keymap.applyOverrides({})`).

### 8. The mutation hook only reaches the renderer — `test/keyboard.test.js:46`

`LUUNA_RENDERER` replaces `renderer/renderer.js` only. `renderer/keymap.js` and `renderer/config.js`
can only be mutation-checked by copying the whole tree.

**Fix:** add `LUUNA_KEYMAP` and `LUUNA_CONFIG` overrides, so all three modules are reachable.

### 9-12. The spec and the code need four small corrections

- **§C.4** says "When the app-settings default collides with a registry chord of another action, the
  colliding registry chord is dropped", but `defaultCollides()` only drops a chord of an action **in the
  same scope**. With `sendKey: "Ctrl+F"` the global `search.findFile` keeps `Ctrl+F` while
  `composer.send` also owns it. The behaviour is the intended one; the sentence is not. Qualify it with
  "of another action in the same scope" — the same rule §C.5.5 uses.
- **§D's** table row for `luuna_get_config` omits `errors` from the Returns column. The implementation
  returns `{ settings, tiers, themes, errors, paths }` (`src-tauri/src/main.rs:2236`).
- **§E** says "the next keydown is captured … and stored as the action's override", but the recorder
  treats `Enter` as "commit the recording", so `Enter` can never be captured and the user gets no
  explanation. Note the limitation in §E and in the README (a chord with a modifier — `Ctrl+Enter` —
  does record).
- **`MAIN_MENUS.shortcut`** now holds an *action id*, not a chord, but the name still reads like the old
  literal-chord field. A future edit of `shortcut: "Ctrl+C"` would be looked up as an action id and
  render as "(unbound)". Rename it (e.g. `shortcutAction`) or state the action-id contract in the
  `MAIN_MENUS` comment.

## Constraints

- **The registry must keep exactly one owner per chord per scope.** The re-review measured this over the
  whole registry on both platforms with the app tier applied, for ten different `sendKey` values. It
  must still hold.
- **No pre-existing binding may change behaviour.** The scope-rank resolution must still return the same
  action as the previous registry-order resolution for every registry chord in the `input`, `tree` and
  `agent` contexts.
- **Tabs** for indentation; the fixed 16-colour DOS palette (no new colour names, no hex literal in
  `renderer/renderer.css` outside `:root`); CSP-safe (`default-src 'self'; style-src 'self'; script-src
  'self'` — no `<style>` block, no `style=` attribute, no inline `<script>`); WebKit-compatible (no
  `<dialog>`/`showModal`, no `navigator.clipboard`, no `structuredClone`, no `ResizeObserver`, no
  unprefixed `backdrop-filter`); no secrets.

## Tests

- Extend `test/keyboard.test.js` for the changed behaviours: `Delete` restores the *effective* default
  (the app-settings value) and does not shadow the app tier; a failed font-family write restores the
  previous family; `Delete` in a blurred-but-non-empty search field edits the text; the menu column
  shows `F4`/`F5` where the key bar does; an app-settings default that unbinds another action warns.
- Extend `test/keymap.test.js` for the pure part of #3.
- **Re-verify both invariants mechanically** and report the measurement: the collision count over the
  whole registry on both platforms with the app tier applied, and the difference count between the
  scope-rank resolution and the previous registry-order resolution for every registry chord in the
  `input`, `tree` and `agent` contexts.

**`npm run check:all` must be green before you report.** It is `cargo check` + the renderer syntax check
+ `cargo test` (30) + `node --test` (150).

## Report back

- what you changed, file by file;
- the new test names;
- the two invariant measurements, with numbers;
- anything you did not fix, and why;
- the `npm run check:all` result;
- `BUILD: DONE` or `BUILD: FAILED`.
