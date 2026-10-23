# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

LUUNA-AI is a Turbo Pascal 7.0 / Borland DOS styled **native desktop** frontend for the [Pi coding agent](https://github.com/earendil-works/pi-mono). Pi is never modified or forked — LUUNA-AI drives it strictly over Pi's documented JSONL RPC protocol (`pi --mode rpc`).

It is a [Tauri v2](https://tauri.app) application: a Rust backend plus a static HTML/CSS/JS renderer. There is no terminal UI in this repository and no Node code at runtime.

| Part | Code | Role |
|---|---|---|
| Backend | `src-tauri/` — Rust | owns the `pi` subprocess, the JSONL protocol, git/filesystem/session/env operations |
| Renderer | `renderer/` — HTML/CSS/JS | recreates the DOS/VGA UI; never touches the filesystem directly |

## Commands

```bash
npm install        # installs @tauri-apps/cli (build-time only)
npm run dev        # tauri dev — hot-reloads the renderer, rebuilds Rust on change
npm run build      # tauri build — release build + native installer
npm run check      # cargo check
npm test           # cargo test
npm run check:js   # node --check on the renderer's plain-JS modules
npm run test:js    # node --test on the renderer's JS tests
npm run check:all  # check + check:js + test + test:js
```

`npm run build` writes the installer to `src-tauri/target/release/bundle/`. macOS needs both Rust targets for a universal binary:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run build -- --target universal-apple-darwin
```

## Architecture

### The Rust backend (`src-tauri/src/main.rs`)

One file, ~2250 lines, organised as: RPC plumbing → state → commands → the `pi` subprocess.

- **`luuna_*` commands** are the Tauri IPC surface. Every one maps 1:1 onto a `window.luuna` method in the renderer.
- **Push events**: `push:state`, `push:entry`, `push:delta`, `push:textPopup`, `push:bootError`. The renderer subscribes to these; it never polls.
- **`spawn_pi`** starts `pi --mode rpc`. On Windows it goes through `cmd.exe /d /s /c` with `windowsVerbatimArguments` (npm `.cmd` shims are not executable directly) and every argument is rejected if it contains `" \r\n&|<>^%!`. On macOS `pi` is executed directly.
- **Cross-platform code** is gated with `#[cfg(windows)]` / `#[cfg(target_os = "macos")]` — clipboard uses `clip` vs `pbcopy`, "show in folder" uses `explorer /select,` vs `open -R`. Keep new platform-specific code behind the same gates.
- **Tauri config** is split: `tauri.conf.json` is shared, `tauri.windows.conf.json` builds an NSIS installer (no WiX needed), `tauri.macos.conf.json` builds an `.app` and `.dmg`. Do not hardcode one platform's bundle target in the shared config.

### The renderer (`renderer/`)

Vanilla JS, no build step and no framework — `index.html`, `renderer.css`, `renderer.js`, `luuna-provider.js`, plus the three configuration modules `keymap.js`, `themes.js` and `config.js`.

- `renderer/luuna-provider.js` installs the `window.luuna` bridge over Tauri IPC (`invoke` + `listen`). It returns early if a bridge already exists, so an Electron preload can still provide one.
- `renderer/renderer.js` implements the menus, tiled windows, overlays and slash commands in DOM. The menu tree (`MAIN_MENUS`), the key bar and the help text live **here only** — the Rust backend has no copy.
- `renderer/keymap.js` is the **single source of truth for user-visible chords**. It holds the action registry (`ACTIONS`), the chord grammar and the resolver. The menu's shortcut column, the key bar, the help screen and the global keydown handler all read from it, so a rebind shows up everywhere at once.
- `renderer/themes.js` owns the theme model and the built-in themes. `renderer/config.js` owns the merged configuration (settings + theme + keymap overrides) and the font metrics probe.
- **The renderer must stay WebKit-compatible.** macOS uses WKWebView, not Chromium. Do not introduce Chromium-only APIs (`<dialog>`/`showModal`, `navigator.clipboard`, `backdrop-filter` without the `-webkit-` prefix, `structuredClone`, `ResizeObserver`) or CSS that Safari lacks. `::-webkit-scrollbar` is fine — WebKit and Chromium both support it.
- The window is frameless (`decorations: false`); the menu bar is the topmost element and doubles as the window's drag region and caption.

### Duplicated data — update all copies

Two things genuinely exist in two places:

1. **The bridge.** `renderer/luuna-provider.js` and the `luuna_*` commands in `src-tauri/src/main.rs` must stay in sync — every bridge method maps 1:1 onto a command. Adding a command without its provider method (or the reverse) breaks the surface.
2. **The chord grammar.** `renderer/keymap.js` and `src-tauri/src/config.rs` both implement it — the renderer resolves chords, the backend validates and canonicalises them when a settings file is written. Keep the two implementations in step: a chord the renderer accepts but the backend rejects is a silent write failure.

The menu tree, the key bar and the help text are **not** duplicated — they live only in `renderer/renderer.js`.

### The `.luuna/` configuration tiers

Settings live in two tiers, and the project tier wins:

| Tier | Path | Holds |
|---|---|---|
| Global | `~/.luuna/` | preferences that follow the user across projects |
| Project | `<project>/.luuna/` | preferences for one repository |

```
<project>/.luuna/
├── config/
│   ├── appearance.settings.json   # theme, font family, font size, line height
│   ├── keybindings.settings.json  # action id → chord overrides
│   └── app.settings.json          # sendKey / newlineKey / historySize
└── themes/
    └── <id>.theme.json            # a user theme
```

The Rust side (`src-tauri/src/config.rs`) owns the paths, the merge order and the atomic writes; the renderer reads the merged result through `luuna.getConfig()` and writes patches through `luuna.setConfig(scope, file, patch)`.

- **The three settings file names are fixed** — `appearance`, `keybindings`, `app`. `SETTINGS_FILES` in `config.rs` is the authority.
- **The 16 palette names are fixed** — `PALETTE_NAMES` in `config.rs` and `PALETTE_NAMES` in `renderer/themes.js` are the same list in the same order. A theme supplies *values* for those 16 names; it may not introduce a 17th name or a colour outside the palette.
- **A malformed settings file is never silently overwritten.** `write_settings` refuses to overwrite a file it could not parse, and the parse error is reported back to the renderer so the Config section can show it.
- The theme list is the built-ins merged with the user themes, a user theme shadowing a built-in of the same id.

## Testing

`npm run check:all` runs everything: `cargo check`, a syntax check of the renderer's plain-JS modules, `cargo test` and `node --test`.

- **Rust**: `src-tauri/src/config.rs` carries its own unit tests (paths, merging, validation, chord canonicalisation). `npm test` runs them.
- **Renderer**: `test/keymap.test.js`, `test/config.test.js` and `test/themes.test.js` are `node:test` files that exercise the pure modules without a DOM. `npm run test:js` runs them. They are named `*.test.js` (not `*.mjs`) so the diagnostic scaffolds below stay out of the glob, and the file list in `package.json` is explicit rather than a glob because npm on Windows shells out to `cmd.exe`.
- `test/` also holds **diagnostic scaffolds, not tests**. `test/probe-live-cdp.mjs` inspects the running app's real DOM over the WebView2 CDP port; `test/cdp-eval.mjs` evaluates an expression in it; `test/cdp-shot.mjs` captures a PNG of the app's own rendered surface. They need the app launched with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`, and they are deliberately kept out of the test glob.
- **The renderer itself**: `test/keyboard.test.js` is the regression guard for the keyboard. `renderer/renderer.js` is a browser script with no exports, so the file evaluates it in a `node:vm` context with a stubbed DOM and a stubbed bridge, then feeds synthetic keydown events into the listener the renderer itself installs. It pins the keydown order (Alt-burst → IME guard → overlay → menu → keymap → Alt+letter), the "one keystroke, one thing" invariant, the `bareAllowed` net that keeps ordinary typing in the composer from being swallowed, and the pre-existing bindings (F1–F10, the Alt+letter accelerators, the vim motions, the window motions). It also pins the shortcuts editor: the `Delete` guard in the search field, the de-duplicated chord labels, the refused bare letter, the scope-aware conflict check, the collapsed recent-session group, the two abort rows and the configurable send key. `LUUNA_RENDERER=<path>` points it at a different renderer — that is how it is mutation-checked.
- **The mutation hooks**: `LUUNA_RENDERER`, `LUUNA_KEYMAP` and `LUUNA_CONFIG` each replace one of the three plain-JS modules the harness loads (`renderer/renderer.js`, `renderer/keymap.js`, `renderer/config.js`). `test/mutate-fix2.cjs` uses them: it copies a module, applies one string mutation to the copy and asserts that the expected test then fails. A mutation that still passes is a hole in the test suite.

## Configuration and environment

- **`PI_CMD`** — overrides the Pi executable (default `pi` on PATH).
- **`LUUNA_AI_DIR`** — the project directory to open on launch. Falls back to the legacy `TURBO_AI_DIR`, then to the process working directory.
- **`PI_CONFIG_DIR`** — overrides the Pi config directory (default `~/.pi/agent`).
- `~/.pi/agent/models.json` — custom models, written by `luuna_add_custom_model` via atomic temp-file + rename.
- `~/.pi/agent/settings.json` — the `enabledModels` array; `filter_enabled_models` narrows the model list to it.
- `~/.pi/agent/sessions/**.jsonl` — Pi session files; `get_project_sessions` scans them and keeps only those whose recorded `cwd` matches the project.
- `.env` in the project directory — API keys, written by `luuna_write_env_key` (validated env var name, single-line value, mode 0600).
- Provider defaults (base URL, API type, env var name) live in `PROVIDER_DEFAULTS` in `src-tauri/src/main.rs`.

## Conventions

- Rust is formatted with tabs, matching the DOS aesthetic and the renderer's CSS.
- The UI theme is a fixed 16-colour DOS palette. Do not introduce arbitrary colours; add a named entry to the palette instead. The **names** are fixed (16 of them, `PALETTE_NAMES`); a theme only supplies the **values**.
- The renderer's CSS keeps every colour in `:root` as a custom property. `renderer/renderer.css` should contain no hex literal outside that block — a theme is a data swap, and a stray literal would ignore the theme.
- Keyboard shortcuts follow [Raycast](https://manual.raycast.com/)'s conventions: `Mod` is `Cmd` on macOS and `Ctrl` elsewhere, and the canonical order is `<primary> → Alt → Shift → <key>`. The reference table lives in `docs/raycast-keybindings.md`.
- The app must not bundle a browser. Keep using the OS WebView.
- `prompt.txt` and the original Turbo Pascal spec are not part of this repository.
