# LUUNA-AI 1.0.2 Beta

[![Version](https://img.shields.io/badge/version-1.0.2%20Beta-blue.svg)](https://github.com/brodynelly/luuna-ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-v2-orange.svg)](https://tauri.app)

**Luuna-AI** is an authentic Turbo Pascal 7.0 / Borland DOS inspired native desktop frontend for the **[Pi coding agent](https://github.com/earendil-works/pi-mono)**. It spawns Pi in RPC mode (`pi --mode rpc`) and drives it over its JSONL protocol, delivering an early-1990s Borland IDE development experience with full mouse, hotkey, and multi-window support.

> *A loving homage to Turbo Pascal 7.1. Not affiliated with Borland International.*

```text
 ≡ File  Edit  Search  Run  Compile  Debug  Tools  Options  Window  Help ≡
╔═[■]══════ FILES ══════[▲]═╦═[■]═════════════════ AGENT.PAS ════════════════ 1 ═[▲]═╗
║ ▼ src                     ║ User: Implement session resume & slash commands        ║
║   commands/               ║                                                        ║
║     commands.ts           ║ Thinking: Analyzing project session storage...         ║
║   ui/                     ║                                                        ║
║     session-selector.ts   ║ [SEARCH ] ~/.pi/agent/sessions/                        ║
║     agent-panel.ts        ║ [EDIT   ] src/commands/commands.ts                     ║
║     menu-bar.ts           ║ [EDIT   ] src/main.ts                                  ║
║   main.ts                 ║ [TEST   ] npm test (59 tests passed)                   ║
║   package.json            ║                                                        ║
║                           ╠═[■]══ opencode/x-preview-f-free [high] [BUILD] ◄ 2 ═[▲]╣
║                           ║ > /resume                                              ║
╚═ 1/24 ══════════════════▲═╩═ 1:1 ════════════════════════════════════════════════▲═╝
 F1 Help  F2 Save  F3 Open  F4 Model  F5 Effort  F6 Mode  F7 Diff  F8 Test  F9 Build  F10 Menu
```

<p align="center">
  <img src="assets/screenshot-menu.png" width="49%" alt="Luuna-AI Main Interface & Menu" />
  <img src="assets/screenshot-about.png" width="49%" alt="Luuna-AI About Dialog & Thinking" />
</p>

---

## 🚀 Key Features

### 🏛️ Authentic Turbo Pascal 7.0 / Turbo Vision GUI
- **16-Color DOS/VGA Palette**: Classic Borland royal blue desktop, double-line frames, and 3D shadow buttons.
- **Top Menu Bar (10 Menus)**: `File`, `Edit`, `Search`, `Run`, `Compile`, `Debug`, `Tools`, `Options`, `Window`, `Help` with red mnemonic shortcuts (`Alt+F`..`Alt+H`).
- **Interactive Session Selector**: Browse and resume project sessions with date/time, task previews, and `1`..`9` fast shortcuts (`F3 Open`, `/resume`, `/sessions`).
- **Recent Sessions History**: The `File` menu automatically lists up to 9 recently saved/opened sessions with red numbered shortcuts (`1.` .. `9.`).
- **Complete Mouse Interaction**: Click to focus windows, open menus, select tree files, click window close `[■]` and zoom `[▲]` boxes, scroll lists with mouse wheel, and drag to select & copy text.
- **Vim Navigation**: `h`/`j`/`k`/`l`, `gg`/`G`, `Ctrl+D`/`Ctrl+U`, `:` for the command line, `/` to find files, `Ctrl+W` to switch windows.

### 🧠 Advanced LLM & Reasoning Workflow
- **Model Switching (`F4 Model`)**: Browse all available models from Pi, or use `[+] Enter custom model ID...` for quick custom models.
- **Custom Model Management**: Add and configure arbitrary models across providers (`openrouter`, `opencode`, `deepseek`, `google`, `anthropic`, `openai`, `groq`, `mistral`, `xai`, `together`) directly from `Options` → `Add custom model...` with automatic `~/.pi/agent/models.json` synchronization.
- **API Key Configuration (`Options` → `Configure API keys...`)**: Dialog to configure and securely save provider API keys to the local `.env`.
- **Reasoning Effort Control (`F5 Effort`)**: Cycles reasoning effort levels (`low` → `medium` → `high` → `off`), with automatic model reasoning flag enablement.
- **PLAN / BUILD Modes (`F6 Mode`)**: Switch between Architectural Planning mode (`[PLAN]`) and Autonomous Code Execution mode (`[BUILD]`).
- **Visual Thinking Distinction**: Model reasoning (`thinking_delta`) renders in **Gray** (`LIGHTGRAY`); the final response renders in **Bright White** (`WHITE`).
- **Built-in Slash Commands**: `/status`, `/help`, `/compact`, `/clear`, `/model`, `/effort`, `/plan`, `/build`, `/diff`, `/test`, `/save`, `/open`, `/resume`.

### 📁 Codebase Navigation & Git Tools
- **Project Tree Window**: Live filesystem explorer with folder expand/collapse, git-dirty indicators, and instant file preview (`Click` / Enter).
- **Unified Diff Viewer (`F7 Diff`)**: Color-coded unified diff viewer for git changes.
- **Test & Build Integration**: Direct execution of `npm test` (`F8 Test`) and `npm run build` (`F9 Build`) through Pi RPC.

---

## ⌨️ Keyboard & Mouse Shortcuts

| Key | Description |
|---|---|
| **`F1`** | Open Help screen & shortcut reference |
| **`F2`** | Save current session to file (`.md`) |
| **`F3`** | Open Interactive Session Selector / Browse Sessions |
| **`F4`** | Select AI Model (from Pi or custom) |
| **`F5`** | Cycle Reasoning / Thinking Effort (`low` → `medium` → `high` → `off`) |
| **`F6`** | Toggle **PLAN** / **BUILD** mode |
| **`F7`** | View Unified Git Diff |
| **`F8`** | Run Tests (`npm test` via Pi) |
| **`F9`** | Run Build (`npm run build` via Pi) |
| **`F10`** | Open the top menu bar / toggle it closed |
| **`Alt+F..H`** | Direct menu hotkeys (`Alt+F` File, `Alt+O` Options, etc.) |
| **`Ctrl+F`** | Filter project tree |
| **`Ctrl+L`** | Clear agent message history |
| **`Ctrl+C`** | Copy selected text to system clipboard / abort command |
| **`Alt+X`** | Exit Luuna-AI |
| **`Tab`** | Cycle active window focus |
| **`Esc`** | Close dialog / dismiss menu / cancel |

### Menu keyboard navigation

`F10` opens the menu bar (and toggles it closed), arrows move within and between menus, `Home`/`End` jump, `Enter` commits the selected item, `Esc` closes, and `Alt`+letter opens a menu directly. Plain letters commit an item while a menu is open. Requires the `core:window:allow-*` permissions granted in `src-tauri/capabilities/default.json`.

---

## 📦 Requirements

- **Pi coding agent**: Installed and available on PATH (`pi --version`). Tested with `@earendil-works/pi-coding-agent` >= 0.78.0.
- **Node.js** >= 20 (build-time only — the app itself does not use Node).
- **Rust toolchain** (`rustup`) — on Windows also the MSVC Build Tools.
- **Windows 10/11** or **macOS 10.15+**.

---

## 🛠️ Installation

### Prebuilt installers

Download from the [Releases page](https://github.com/brodynelly/luuna-ai/releases):

- **Windows** — `LUUNA-AI_<version>_x64-setup.exe` (NSIS installer)
- **macOS** — `LUUNA-AI_<version>_x64.dmg` / `.app` (requires notarization to open without a Gatekeeper warning)

### Build from source

```bash
git clone https://github.com/brodynelly/luuna-ai.git
cd luuna-ai
npm install

# Development — hot-reloads the renderer, rebuilds the Rust backend on change
npm run dev

# Release build
npm run build
```

The release build produces a native installer in `src-tauri/target/release/bundle/`.

> **macOS note:** a universal binary needs both Rust targets —
> `rustup target add aarch64-apple-darwin x86_64-apple-darwin` — then
> `npm run build -- --target universal-apple-darwin`.

---

## 🪟 The frameless window

The window has **no title bar at all**. It is created with `decorations: false`, so the OS draws neither a caption nor caption buttons, and the app draws no caption strip of its own either — the DOS menu bar is the topmost element and the UI starts at the very top edge of the window.

Window affordances therefore live in the menu bar: drag its background (the empty space after `Help`) to move the window, and double-click that background to toggle maximize. `Alt+X` or `File → Exit` closes the app. Native **Save As** and **Change Directory** dialogs, a right-click **Copy/Paste/Select All** menu, and taskbar/dock app identity all still apply.

Changing the directory from the File menu reconnects Pi in the selected project and starts a new backend session. If spawning Pi fails, the current project and session stay active. Once the replacement starts, connection errors are reported in the selected project.

---

## 🏗️ Architecture

```text
┌──────────────────────────────────────────────────┐
│                   LUUNA-AI                       │
│        Tauri v2 shell — Rust backend             │
│  10-Menu Bar │ Project Tree │ Agent Panel (DOS)  │
│  renderer/ — HTML/CSS/JS recreating the VGA look │
└─────────────────────────┬────────────────────────┘
                          │ JSONL over stdio (pi --mode rpc)
                          ▼
┌──────────────────────────────────────────────────┐
│                      PI                          │
│  LLM orchestration │ RPC engine │ Git & Context  │
└──────────────────────────────────────────────────┘
```

- **Pure Frontend Architecture**: Pi is never modified or forked; Luuna-AI drives Pi strictly via the documented JSONL RPC protocol.
- **No Bundled Browser**: the app uses the OS WebView (WebView2 on Windows, WKWebView on macOS), so installers stay around 1–2 MB.
- **Layout**: `src-tauri/` is the Rust backend (Pi subprocess, git, filesystem, sessions, env); `renderer/` is the UI. The renderer never touches the filesystem directly — all backend work goes through the `window.luuna` bridge, which maps 1:1 onto the `luuna_*` Tauri commands.
- **Bridge contract**: `renderer/luuna-provider.js` and the `luuna_*` commands in `src-tauri/src/main.rs` must stay in sync. The menu tree and help text live in `renderer/renderer.js` and `src-tauri/src/main.rs` — changing an item in one means changing it in the other.

---

## 🧪 Development

```bash
npm run check   # cargo check
npm test        # cargo test
```

### Diagnostic probes

`test/` includes diagnostic probes and the automated `workbench-native-smoke.mjs` regression suite. The probes below inspect the running app over the WebView2 CDP port; the workbench suite launches a fresh release with disposable stores and synthetic Pi.

```bash
# Launch the app with the debug port open
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333 npm run dev

# Inspect the live DOM and menu keyboard handling
node test/probe-live-cdp.mjs

# Evaluate an expression in the running app
node test/cdp-eval.mjs "document.querySelectorAll('.win').length"

# Capture a PNG of the app's own rendered surface
node test/cdp-shot.mjs shot.png
```

---

## 📄 License

MIT © 2026 Luuna-AI Contributors.
Homage to Turbo Pascal © 1983-1997 Borland International, Inc.

## Project component workbench

Open **Tools → Kanban board**, **Prompt library**, or **Expertise memory**. These use the real Missions, Beacon and Atlas CLIs in separate LUUNA-AI private stores for each selected project. Initialize explicitly; existing project/runtime data is never imported. Insert into message appends selected context to your draft without sending it to Pi.

Install **Bun 1.4.3** and Git, then run `npm run components:setup` to install pinned public source checkouts. Installed desktop builds can set `LUUNA_AI_COMPONENTS_ROOT` to this checkout's `.tools` directory and `LUUNA_AI_BUN` to the native Bun executable. Node is needed for setup/testing only. Source checkouts are verified on every operation.

See [Component workbench](docs/COMPONENT-WORKBENCH.md) for architecture, store ownership, supported operations, prerequisites and validation. Run `npm run test:components` for real CLI lifecycle checks and `npm run test:workbench` for the Windows native smoke with synthetic Pi.
