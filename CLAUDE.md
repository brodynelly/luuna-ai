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

Vanilla JS, no build step and no framework — `index.html`, `renderer.css`, `renderer.js`, `luuna-provider.js`.

- `renderer/luuna-provider.js` installs the `window.luuna` bridge over Tauri IPC (`invoke` + `listen`). It returns early if a bridge already exists, so an Electron preload can still provide one.
- `renderer/renderer.js` implements the menus, tiled windows, overlays and slash commands in DOM. The menu tree, key bar and help text live here and in the Rust backend.
- **The renderer must stay WebKit-compatible.** macOS uses WKWebView, not Chromium. Do not introduce Chromium-only APIs (`<dialog>`/`showModal`, `navigator.clipboard`, `backdrop-filter` without the `-webkit-` prefix, `structuredClone`, `ResizeObserver`) or CSS that Safari lacks. `::-webkit-scrollbar` is fine — WebKit and Chromium both support it.
- The window is frameless (`decorations: false`); the menu bar is the topmost element and doubles as the window's drag region and caption.

### Duplicated data — update all copies

The menu tree, key bar and help text exist in **two independent places**:

1. `renderer/renderer.js` → `MAIN_MENUS`
2. `src-tauri/src/main.rs` (help / status data)

Changing a menu item, mnemonic, shortcut or action ID means editing both, or the shells drift apart. The same applies to the bridge method list: `renderer/luuna-provider.js` and the `luuna_*` commands in `main.rs` must stay in sync — every bridge method maps 1:1 onto a command.

## Testing

`cargo test` (no Rust tests yet) and the `npm run check` / `npm test` scripts above.

`test/` holds **diagnostic scaffolds, not tests**. `test/probe-live-cdp.mjs` inspects the running app's real DOM over the WebView2 CDP port; `test/cdp-eval.mjs` evaluates an expression in it; `test/cdp-shot.mjs` captures a PNG of the app's own rendered surface. They need the app launched with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`, and they are deliberately kept out of the test glob.

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
- The UI theme is a fixed 16-colour DOS palette. Do not introduce arbitrary colours; add a named entry to the palette instead.
- The app must not bundle a browser. Keep using the OS WebView.
- `prompt.txt` and the original Turbo Pascal spec are not part of this repository.
