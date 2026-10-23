/**
 * LUUNA-AI Desktop — renderer.
 * Faithful HTML/CSS port of the Turbo Pascal 7 UI (menus, tiled windows, DOS
 * palette, overlays, slash commands). All backend work goes through the
 * `luuna` bridge into the Rust backend over Tauri IPC. NOTE: do NOT re-declare
 * `luuna` as a global const — the provider installs it as a global property.
 */
"use strict";

// ---------------------------------------------------------------------------
// The keymap, the themes and the effective configuration
//
// `renderer/keymap.js`, `renderer/themes.js` and `renderer/config.js` are
// loaded before this file (see `renderer/index.html`). They are the single
// source of truth for the chords, the palette and the configuration; nothing
// in this file hardcodes a chord any more.
// ---------------------------------------------------------------------------

const Keymap = window.LuunaKeymap;
const Themes = window.LuunaThemes;
const Config = window.LuunaConfig;

/**
 * The display form of a chord: "⌘K" on macOS, "Ctrl+K" everywhere else.
 * A two-key sequence ("Ctrl+W,H") is displayed as its parts.
 */
function chordLabel(chord) {
	if (!chord) return "";
	return Keymap.formatBinding(chord);
}

/**
 * The display labels of a chord set, de-duplicated.
 *
 * `Mod` expands to `Ctrl` off macOS, so a binding list like
 * `["Mod+C", "Ctrl+C"]` would render as "Ctrl+C / Ctrl+C". The stored chords
 * keep both spellings (they mean different things on macOS), but the label
 * collapses — every surface that shows a chord set goes through here, so they
 * can never disagree.
 *
 * @param {string[]} chords
 * @returns {string[]} the labels
 */
function chordSetLabels(chords) {
	return Keymap.formatChordSet(chords);
}

/**
 * The chord set of an action as one string ("Ctrl+C / Alt+C"), or "" when the
 * action is unbound.
 *
 * @param {string} actionId
 * @returns {string}
 */
function chordSetText(actionId) {
	return chordSetLabels(Keymap.chordsFor(actionId)).join(" / ");
}

/**
 * The primary chord of an action — the first one of its binding list — or ""
 * when the action is unbound.
 */
function actionChord(actionId) {
	const chords = Keymap.chordsFor(actionId);
	return chords.length ? chordLabel(chords[0]) : "";
}

/**
 * The explicitly spelled chord of an action: the one written with `Ctrl` or
 * `Meta` instead of the platform-dependent `Mod` alias.
 *
 * It is the same chord on every platform, so it is the one to advertise when
 * the meaning of a row is the platform-independent one: the abort rows show
 * `Ctrl+C` (the chord that always aborts) and not `Mod+C` (which copies the
 * selection when there is one).
 *
 * @param {string} actionId
 * @returns {string}
 */
function actionExplicitChord(actionId) {
	return chordLabel(Keymap.explicitChord(actionId));
}

/**
 * The chord a menu row advertises.
 *
 * A row may name the action whose chord it shows (`shortcutAction`) — the
 * abort rows point at `edit.copyOrAbort`, whose explicitly spelled chord
 * (`Ctrl+C`) is the one that always aborts, while its first chord (`Mod+C`)
 * copies the selection when there is one. The chord is still looked up in
 * the keymap, so a rebinding shows up on the next paint.
 *
 * An ordinary row shows the same chord the key bar shows: the plain function
 * key when the action has one, the primary chord otherwise. The menu used to
 * show `F4` for "Select model…" — the key bar and the menu must not drift
 * apart.
 *
 * @param {Object} item a `MAIN_MENUS` item
 * @returns {string}
 */
function rowChord(item) {
	if (!item) return "";
	const id = item.shortcutAction || item.action;
	if (!id) return "";
	if (item.shortcutAction) return actionExplicitChord(id);
	return actionDisplayChord(id);
}

/**
 * The chord shown for an action in the key bar and in the guide: the plain
 * function key when the action has one (that is the shape the key bar has
 * always had), the primary chord otherwise.
 */
function actionDisplayChord(actionId) {
	const chords = Keymap.chordsFor(actionId);
	if (!chords.length) return "";
	const plain = chords.find((c) => /^F\d{1,2}$/.test(c));
	return chordLabel(plain ?? chords[0]);
}

/** The prefix chord of a two-key sequence binding ("Ctrl+W,H" → "Ctrl+W"). */
function sequencePrefix(actionId) {
	for (const binding of Keymap.chordsFor(actionId)) {
		const parts = binding.split(",");
		if (parts.length === 2) return chordLabel(parts[0]);
	}
	return "";
}

/** The follow-up keys of the window-motion sequences ("H/J/K/L/W"). */
function motionKeys() {
	const out = [];
	for (const id of ["window.motionTree", "window.motionAgent", "window.motionInput", "window.motionCycle"]) {
		for (const binding of Keymap.chordsFor(id)) {
			const parts = binding.split(",");
			if (parts.length === 2 && !out.includes(parts[1])) out.push(parts[1]);
		}
	}
	return out.join("/");
}

/**
 * The chord of a keyboard event, in the canonical "Mod+Shift+K" form.
 *
 * The primary modifier is stored as `Mod` whenever it is the one `Mod` stands
 * for on this platform, so one binding file works everywhere. A bare
 * modifier press (Shift, Control, …) has no chord and returns null.
 */
function chordFromEvent(e) {
	const chord = Keymap.eventChord(e);
	if (!chord) return null;
	if (["Shift", "Control", "Alt", "Meta", "CapsLock", "NumLock", "ScrollLock", "Dead", "Unidentified"].includes(chord.key)) return null;
	const mac = Keymap.platform === "mac";
	// Two primary modifiers at once cannot be expressed as a chord.
	if (chord.mods.ctrl && chord.mods.meta) return null;
	let primary = "";
	if (chord.primary === "Ctrl") primary = mac ? "Ctrl" : "Mod";
	else if (chord.primary === "Meta") primary = mac ? "Mod" : "Meta";
	const parts = [];
	if (primary) parts.push(primary);
	if (chord.mods.alt) parts.push("Alt");
	if (chord.mods.shift) parts.push("Shift");
	parts.push(chord.key);
	const out = parts.join("+");
	// Only a chord the keymap (and therefore the backend) understands is a
	// candidate: "AltGraph" and friends are dropped.
	return Keymap.normalizeBinding(out) ? out : null;
}

// ---------------------------------------------------------------------------
// Static UI data (mirrors src/ui/menu-bar.ts, status-bar.ts, help.ts,
// provider-dialog.ts)
// ---------------------------------------------------------------------------

// The menu tree. `action` is the action id the row runs; `shortcutAction` (on
// the two abort rows) is the action id whose CHORD the row advertises — an
// action id, never a chord literal: a literal would be looked up as an action
// id and render as "(unbound)".
const MAIN_MENUS = [
	{ title: "File", mnemonic: "F", hint: "File management commands (Save, Open, New session, Preview, Change dir, Export, Exit)", items: [
		{ label: "Save session to file...", mnemonic: "S", action: "file.save", hint: "Save current conversation log to a file" },
		{ label: "Open saved session...", mnemonic: "O", action: "file.open", hint: "Open and load a saved session file" },
		{ label: "New session", mnemonic: "N", action: "file.new", hint: "Start a new session with the Pi coding agent" },
		{ label: "Open file preview...", mnemonic: "P", action: "file.preview", hint: "Preview selected file from project explorer" },
		{ label: "Change directory...", mnemonic: "D", action: "file.chdir", hint: "Reconnect Pi and start a new session in another project directory" },
		{ label: "Export session to HTML...", mnemonic: "E", action: "file.export", hint: "Export conversation transcript to HTML document" },
		{ separator: true },
		{ label: "Exit", mnemonic: "x", action: "app.exit", hint: "Exit Luuna-AI and return to DOS / shell" },
	] },
	{ title: "Edit", mnemonic: "E", hint: "Text editing and view commands (Clear input, Clear agent log, Find in tree)", items: [
		{ label: "Clear message input", mnemonic: "I", action: "edit.clearInput", hint: "Clear current text in the prompt input line" },
		{ label: "Clear agent log", mnemonic: "C", action: "view.clear", hint: "Clear agent message history from screen" },
		{ separator: true },
		{ label: "Copy last answer...", mnemonic: "L", action: "edit.lastAnswer", hint: "Inspect clean text of the last assistant reply" },
		{ label: "Find in file tree...", mnemonic: "F", action: "search.find", hint: "Filter files in the project tree" },
		{ label: "Reset file filter", mnemonic: "R", action: "search.clear", hint: "Clear file tree filter and show all files" },
	] },
	{ title: "Search", mnemonic: "S", hint: "Search and filter files in workspace", items: [
		{ label: "Find file by name...", mnemonic: "F", action: "search.find", hint: "Filter and find files in the project tree" },
		{ label: "Search text in files...", mnemonic: "T", action: "search.grep", hint: "Search tracked workspace files with git grep" },
		{ separator: true },
		{ label: "Clear search filter", mnemonic: "C", action: "search.clear", hint: "Reset active search filter in project tree" },
	] },
	{ title: "Run", mnemonic: "R", hint: "Execute commands, tests, build and abort operations", items: [
		{ label: "Run command...", mnemonic: "R", action: "run.command", hint: "Execute custom command in agent bash tool" },
		{ label: "Run test suite", mnemonic: "T", action: "run.tests", hint: "Run project test suite (npm test)" },
		{ label: "Build project", mnemonic: "B", action: "run.build", hint: "Build project artifacts (npm run build)" },
		{ separator: true },
		{ label: "Abort command", mnemonic: "A", action: "run.abort", shortcutAction: "edit.copyOrAbort", hint: "Cancel running shell / bash command" },
	] },
	{ title: "Agent", mnemonic: "A", hint: "Pi agent control, model selection, reasoning effort, and plan/build modes", items: [
		{ label: "Select model...", mnemonic: "M", action: "tools.model", hint: "Choose active LLM model provider and identifier" },
		{ label: "Thinking effort...", mnemonic: "E", action: "agent.thinking", hint: "Cycle reasoning effort (off -> low -> medium -> high)" },
		{ label: "Plan / Build mode...", mnemonic: "P", action: "agent.mode", hint: "Toggle between PLAN and BUILD execution modes" },
		{ separator: true },
		{ label: "Cycle to next model", mnemonic: "C", action: "agent.cycle", hint: "Quickly toggle to the next enabled LLM model" },
		{ label: "Compact context memory", mnemonic: "K", action: "agent.compact", hint: "Summarize conversation to free context window tokens" },
		{ label: "Fork session branch...", mnemonic: "F", action: "agent.fork", hint: "Create a new branch from an earlier user message" },
		{ label: "Clone active branch", mnemonic: "L", action: "agent.clone", hint: "Duplicate active conversation branch into a new session" },
		{ separator: true },
		{ label: "Abort agent generation", mnemonic: "A", action: "agent.abort", shortcutAction: "edit.copyOrAbort", hint: "Abort ongoing LLM generation or tool execution" },
	] },
	{ title: "Git", mnemonic: "G", hint: "Git version control operations (Status, Diff, History, Refresh)", items: [
		{ label: "Diff working tree...", mnemonic: "D", action: "git.diff", hint: "View unified git diff of working tree changes" },
		{ label: "Status...", mnemonic: "S", action: "git.status", hint: "Show git repository branch and modified files" },
		{ label: "Commit history...", mnemonic: "L", action: "git.log", hint: "View recent git commits log in a popup" },
		{ separator: true },
		{ label: "Refresh git status", mnemonic: "R", action: "git.refresh", hint: "Rescan git status and dirty file markers" },
	] },
	{ title: "Tools", mnemonic: "T", hint: "Session statistics, session rename, and environment metrics", items: [
		{ label: "Session statistics...", mnemonic: "S", action: "tools.stats", hint: "Display token usage, context usage, and cost" },
		{ label: "Rename session...", mnemonic: "N", action: "tools.rename", hint: "Set a custom display name for the current session" },
		{ separator: true },
		{ label: "Refresh project tree", mnemonic: "R", action: "tree.refresh", hint: "Rescan project directory for new/deleted files" },
		{ label: "Environment & system info...", mnemonic: "E", action: "tools.env", hint: "Show Node.js, OS, memory, PID and terminal info" },
	] },
	{ title: "Options", mnemonic: "O", hint: "Themes, fonts, keyboard shortcuts, API keys, custom models, and delivery modes", items: [
		{ label: "Command palette…", mnemonic: "P", action: "app.palette", hint: "Search for an action and run it" },
		{ label: "Theme picker…", mnemonic: "T", action: "app.theme", hint: "Pick a theme — the preview applies live" },
		{ label: "Font settings…", mnemonic: "Z", action: "app.font", hint: "Font family, size and line height" },
		{ label: "Keyboard shortcuts…", mnemonic: "Y", action: "app.keybindings", hint: "Rebind the keyboard shortcuts" },
		{ label: "Settings…", mnemonic: "U", action: "app.settings", hint: "Appearance, keyboard shortcuts and configuration" },
		{ separator: true },
		{ label: "Configure API keys & providers...", mnemonic: "K", action: "opt.keys", hint: "Set API keys for OpenRouter, DeepSeek, Google, Anthropic, OpenAI" },
		{ label: "Add custom model...", mnemonic: "M", action: "opt.addModel", hint: "Register a new custom model in models.json" },
		{ label: "Reload models list", mnemonic: "L", action: "opt.reloadModels", hint: "Rescan and reload all available models from Pi" },
		{ separator: true },
		{ label: "Auto-compaction on/off", mnemonic: "A", action: "opt.compaction", hint: "Toggle automatic context compaction when memory fills" },
		{ label: "Auto-retry on error", mnemonic: "R", action: "opt.retry", hint: "Toggle automatic retry on transient network/API errors" },
		{ separator: true },
		{ label: "Steering delivery mode...", mnemonic: "S", action: "opt.steering", hint: "Toggle steer delivery mode (one-at-a-time / all)" },
		{ label: "Follow-up delivery mode...", mnemonic: "F", action: "opt.followUp", hint: "Toggle follow-up delivery mode (one-at-a-time / all)" },
	] },
	{ title: "Window", mnemonic: "W", hint: "Window navigation, zooming, and layout arrangement", items: [
		{ label: "Next pane", mnemonic: "N", action: "window.next", hint: "Switch active window (Files / Agent / Message)" },
		{ label: "Zoom / Restore window", mnemonic: "Z", action: "window.zoom", hint: "Toggle active window between tiled and full screen" },
		{ separator: true },
		{ label: "Project files", mnemonic: "P", action: "window.files", hint: "Focus project file explorer window (FILES.PAS)" },
		{ label: "Agent output", mnemonic: "A", action: "window.agent", hint: "Focus agent message log window (AGENT.PAS)" },
		{ label: "Message input", mnemonic: "M", action: "window.input", hint: "Focus message prompt input window (MESSAGE)" },
		{ separator: true },
		{ label: "Tile windows", mnemonic: "T", action: "window.tile", hint: "Restore standard 3-pane tiled desktop layout" },
	] },
	{ title: "Help", mnemonic: "H", hint: "Help system, key reference and About dialog", items: [
		{ label: "Keyboard help...", mnemonic: "H", action: "help.show", hint: "Display list of hotkeys and shortcuts" },
		{ label: "Pi & IDE Guide...", mnemonic: "G", action: "help.guide", hint: "Comprehensive guide to Luuna-AI and Pi features" },
		{ separator: true },
		{ label: "About...", mnemonic: "A", action: "help.about", hint: "Information about Luuna AI tribute and version" },
	] },
];

// The key bar lists ACTION IDS, never chords: the chord of every entry is
// looked up in the keymap when the bar is rendered, so a rebinding shows up
// on the next paint.
const KEY_BAR_ITEMS = [
	["app.help", "Help"], ["file.save", "Save"], ["file.open", "Open"],
	["agent.model", "Model"], ["agent.thinking", "Effort"], ["agent.mode", "Mode"],
	["git.diff", "Diff"], ["run.tests", "Test"], ["run.build", "Build"], ["app.menu", "Menu"],
];

/**
 * The help screen, generated from the action registry: one section per
 * category, one line per action, showing the chord that is bound RIGHT NOW.
 * An action without a chord (a menu-only command) is not listed.
 */
function buildHelpLines() {
	const categories = new Map();
	for (const action of Keymap.ACTIONS) {
		const chords = Keymap.chordsFor(action.id);
		if (!chords.length) continue;
		let entries = categories.get(action.category);
		if (!entries) { entries = []; categories.set(action.category, entries); }
		entries.push({ id: action.id, label: action.label, chords });
	}
	const lines = [];
	for (const [category, entries] of categories) {
		lines.push({ head: category });
		for (const entry of entries) {
			lines.push({ key: chordSetText(entry.id), text: entry.label });
		}
	}
	return lines;
}

/**
 * The user guide: the prose is fixed, but every chord it mentions is
 * interpolated from the keymap, so the guide can never drift away from the
 * bindings that are actually in effect.
 */
function buildGuideLines() {
	const row = (id, text) => `  ${actionDisplayChord(id).padEnd(12)}${text}`;
	const pair = (a, b) => `${actionDisplayChord(a)} / ${actionDisplayChord(b)}`;
	// The abort chord is the explicitly spelled one (Ctrl+C): it aborts on
	// every platform, while Mod+C copies the selection when there is one.
	const abortRow = (id, text) => `  ${actionExplicitChord(id).padEnd(12)}${text}`;
	return [
		"LUUNA-AI User & Command Guide",
		"═══════════════════════════════════════════",
		"Primary commands:",
		row("app.help", "Open keyboard help"),
		row("file.save", "Save conversation transcript"),
		row("file.open", "Open or resume a saved session"),
		row("agent.model", "Open AI model selector"),
		row("agent.thinking", "Cycle thinking effort"),
		row("agent.mode", "Toggle PLAN / BUILD mode"),
		row("git.diff", "Open unified Git diff"),
		row("run.tests", "Run project test suite (npm test)"),
		row("run.build", "Build project artifacts (npm run build)"),
		row("app.menu", "Activate top menu bar"),
		"",
		"Composer:",
		row("composer.send", "Send the message"),
		row("composer.newline", "Insert a newline"),
		row("composer.cancel", "Cancel the generation / leave the composer"),
		"",
		"Navigation & editing:",
		row("window.next", "Switch between FILES, AGENT, and MESSAGE"),
		abortRow("edit.copyOrAbort", "Abort active AI generation or command"),
		row("view.clear", "Clear message history from AGENT screen"),
		row("search.findFile", "Filter and find files in tree"),
		row("app.exit", "Cleanly exit to DOS / shell"),
		"",
		"Slash commands:",
		"  /status /help /clear /compact /model /effort",
		"  /plan /build /mode /diff /test /run /save",
		"  /sessions /resume /open /new /fork /export",
		"",
		"Vim navigation:",
		`  ${pair("nav.down", "nav.up").padEnd(12)}Down / up (tree, panes, dialog lists)`,
		`  ${pair("nav.left", "nav.right").padEnd(12)}Collapse / expand in tree (parent / child)`,
		`  ${pair("nav.top", "nav.bottom").padEnd(12)}Jump to top / bottom`,
		`  ${pair("view.halfPageDown", "view.halfPageUp").padEnd(12)}Half page down / up`,
		row("nav.insert", "Insert mode (focus the message input)"),
		row("nav.commandLine", "Command line (prefills /)"),
		row("nav.find", "Find file in tree"),
		row("nav.help", "Keyboard help"),
		`  ${sequencePrefix("window.motionTree").padEnd(12)}Jump between windows (${motionKeys()})`,
		row("edit.deleteWord", "Delete word before cursor (in the input)"),
	];
}

const ABOUT_LINES = [
	"Luuna AI",
	"Version 1.0.2 Beta",
	"Retro DOS Frontend for Pi Agent",
	"",
	"A loving homage to",
	"Turbo Pascal 7.1",
	"Copyright (c) 1983, 1997",
	"Borland International, Inc.",
];

const PROVIDER_IDS = ["openrouter", "opencode", "deepseek", "gemini", "anthropic", "openai", "groq", "mistral", "xai", "together"];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
	cwd: "",
	model: null,
	thinkingLevel: null,
	planMode: false,
	sessionName: "NONAME00.PAS",
	contextTokens: null,
	gitInfo: { branch: null, added: null, removed: null, dirtyFiles: [], isRepo: false },
	isStreaming: false,
	requestStart: null,
	statusMessage: null,
	recentSessions: [],
	focus: "input",
	zoom: null,
	menuOpenIndex: null,
	menuHint: null,
	flash: null,
	flashTimer: null,
	spinnerFrame: 0,
	spinnerTimer: null,
	overlay: null,
	entries: [],
	streamingKind: null,
	streamingOpen: false,
	tree: [],
	treeCursor: 0,
	treeExpanded: new Set([""]),
	treeFilter: null,
	pinnedBottom: true,
	inputHistory: [],
	historyPos: null,
	savedCurrent: "",
	pendingChord: null,   // the first chord of a two-key sequence (e.g. "Ctrl+W")
	lastPrompt: null,     // the last prompt that was sent to the agent
	recentIndex: null,    // the recent session the next/prev actions walk to
	configScope: "project", // the tier the settings are written to ("global"|"project")
	find: { query: "", index: -1 }, // the find-in-agent-output state
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------------------------------------------------------------------------
// Dirty-flag render loop (mirrors the TUI's markDirty/loop)
// ---------------------------------------------------------------------------

let dirty = true;
function markDirty() { dirty = true; }
// NOTE: the render loop starts at the bottom of this file (startRenderLoop),
// after all const declarations it depends on.

function renderAll() {
	renderMenubar();
	renderTitles();
	renderPanel();
	renderTree();
	renderKeybar();
	syncInput();
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

function withMnemonic(label, mnemonic) {
	const m = (mnemonic || "").toLowerCase();
	if (!m) return esc(label);
	const idx = label.toLowerCase().indexOf(m);
	if (idx === -1) return esc(label);
	return esc(label.slice(0, idx)) + `<span class="mn">${esc(label[idx])}</span>` + esc(label.slice(idx + 1));
}

function renderMenubar() {
	const bar = $("menubar");
	bar.textContent = "";
	MAIN_MENUS.forEach((m, i) => {
		const el = document.createElement("span");
		el.className = "menu-item" + (state.menuOpenIndex === i ? " open" : "");
		el.innerHTML = " " + withMnemonic(m.title, m.mnemonic) + " ";
		el.addEventListener("click", (e) => { e.stopPropagation(); openMenuAt(i); });
		el.addEventListener("mouseenter", () => { if (state.menuOpenIndex !== null && state.menuOpenIndex !== i) openMenuAt(i); });
		bar.appendChild(el);
	});
}

function closeMenus() {
	state.menuOpenIndex = null;
	state.menuHint = null;
	document.querySelectorAll(".dropdown").forEach((d) => d.remove());
	markDirty();
}

function openMenuAt(index) {
	closeMenus();
	state.menuOpenIndex = index;
	state.menuHint = MAIN_MENUS[index].hint;
	const menu = MAIN_MENUS[index];

	const dd = document.createElement("div");
	dd.className = "dropdown";
	const items = [...menu.items];
	if (index === 0 && state.recentSessions.length > 0) {
		items.push({ separator: true });
		state.recentSessions.slice(0, 9).forEach((s, i) => {
			const label = typeof s === "string" ? s : s.label;
			items.push({ label: `${i + 1}. ${label}`, mnemonic: String(i + 1), action: `file.recent:${i}`, hint: `Open recent session: ${label}` });
		});
	}

	let selIdx = items.findIndex((it) => !it.separator);
	items.forEach((item, i) => {
		if (item.separator) {
			const sep = document.createElement("div");
			sep.className = "sep";
			dd.appendChild(sep);
			return;
		}
		const row = document.createElement("div");
		row.className = "row" + (i === selIdx ? " sel" : "");
		row.dataset.index = i;
		row.innerHTML = `<span>${withMnemonic(item.label, item.mnemonic)}</span><span class="sc">${esc(rowChord(item))}</span>`;
		row.addEventListener("mouseenter", () => {
			dd.querySelectorAll(".row").forEach((r) => r.classList.remove("sel"));
			row.classList.add("sel");
			state.menuHint = item.hint || menu.hint;
			markDirty();
		});
		row.addEventListener("click", (e) => {
			e.stopPropagation();
			closeMenus();
			if (item.action) dispatchCommand(item.action);
		});
		dd.appendChild(row);
	});

	document.body.appendChild(dd);
	const barRect = $("menubar").getBoundingClientRect();
	const itemEl = $("menubar").children[index];
	const x = itemEl ? itemEl.getBoundingClientRect().left : 8;
	dd.style.left = Math.min(x, window.innerWidth - dd.offsetWidth - 8) + "px";
	dd.style.top = barRect.bottom + "px";
	if (dd.getBoundingClientRect().bottom > window.innerHeight) dd.style.top = (window.innerHeight - dd.getBoundingClientRect().height - 8) + "px";
	markDirty();
}

function menuCurrentItem() {
	if (state.menuOpenIndex === null) return null;
	const dd = document.querySelector(".dropdown");
	if (!dd) return null;
	const sel = dd.querySelector(".row.sel");
	if (!sel) return null;
	return Number(sel.dataset.index);
}

// ---------------------------------------------------------------------------
// Command dispatch (mirrors App.dispatchCommand + handleAction in main.ts)
// ---------------------------------------------------------------------------

function dispatchCommand(command) {
	if (command.startsWith("file.recent:")) {
		const idx = Number.parseInt(command.slice("file.recent:".length), 10);
		const session = state.recentSessions[idx];
		if (session) void luuna.openSession(session.path ?? session.label);
		return;
	}
	switch (command) {
		case "app.exit": window.close(); break;
		case "app.palette": openCommandPalette(); break;
		case "app.theme": openThemePicker(); break;
		case "app.font": openSettingsDialog("appearance"); break;
		case "app.keybindings": openSettingsDialog("keybindings"); break;
		case "app.settings": openSettingsDialog("appearance"); break;
		case "file.save": saveSessionDialog(); break;
		case "file.open": openSessionSelector(); break;
		case "file.new": void luuna.newSession(); break;
		case "file.preview": previewSelectedFile(); break;
		case "file.chdir": changeDirectoryDialog(); break;
		case "file.export": void luuna.exportHtml(); break;
		case "edit.clearInput": $("input-textarea").value = ""; syncInput(); flashLocal("Message input line cleared"); break;
		case "view.clear": clearPanel(); flashLocal("Agent view cleared"); break;
		case "edit.lastAnswer": void showLastAnswer(); break;
		case "search.find": findFileDialog(); break;
		case "search.clear": state.treeFilter = null; flashLocal("File filter cleared (showing all files)"); markDirty(); break;
		case "search.grep": grepDialog(); break;
		case "run.command": runCommandDialog(); break;
		case "run.tests": void luuna.runCommand("npm test"); break;
		case "run.build": void luuna.runCommand("npm run build"); break;
		case "run.abort": case "agent.abort": void luuna.abort(); break;
		case "tools.model": void openModelSelector(); break;
		case "agent.cycle": void luuna.cycleModel(); break;
		case "agent.thinking": void luuna.cycleThinkingLevel(); break;
		case "agent.mode": void luuna.setPlanMode(!state.planMode); break;
		case "agent.compact": void luuna.compact(); break;
		case "agent.fork": void luuna.fork(); break;
		case "agent.clone": void luuna.clone(); break;
		case "git.status": void showGitStatus(); break;
		case "git.diff": void showDiff(); break;
		case "git.log": void showGitLog(); break;
		case "git.refresh": void refreshGitAndTree(); flashLocal("Git status refreshed"); break;
		case "tools.stats": void showStats(); break;
		case "tools.rename": renameSessionDialog(); break;
		case "tree.refresh": void refreshGitAndTree(); flashLocal("Project tree refreshed"); break;
		case "tools.env": void showEnvInfo(); break;
		case "opt.keys": openProviderDialog(); break;
		case "opt.addModel": openAddModelDialog(); break;
		case "opt.reloadModels": void luuna.reloadModels(); break;
		case "opt.compaction": void luuna.toggleAutoCompaction(); break;
		case "opt.retry": void luuna.toggleAutoRetry(); break;
		case "opt.steering": void luuna.toggleSteeringMode(); break;
		case "opt.followUp": void luuna.toggleFollowUpMode(); break;
		case "window.next": cycleFocus(); break;
		case "window.zoom": toggleZoom(); break;
		case "window.files": setFocus("tree"); flashLocal("Active window: FILES"); break;
		case "window.agent": setFocus("agent"); flashLocal(`Active window: ${state.sessionName}`); break;
		case "window.input": setFocus("input"); flashLocal("Active window: INPUT"); break;
		case "window.tile": state.zoom = null; applyZoom(); flashLocal("Tiled 3-pane layout restored"); break;
		case "help.show": openHelpDialog(); break;
		case "help.guide": openTextPopup("Pi & IDE Guide", buildGuideLines()); break;
		case "help.about": openAboutDialog(); break;
	}
}

function cycleFocus() {
	state.focus = state.focus === "input" ? "agent" : state.focus === "agent" ? "tree" : "input";
	flashLocal(`Active window: ${state.focus.toUpperCase()}`);
	applyFocus();
}

function setFocus(f) { state.focus = f; applyFocus(); }

function applyFocus() {
	$("win-tree").classList.toggle("focused", state.focus === "tree");
	$("win-agent").classList.toggle("focused", state.focus === "agent");
	$("win-input").classList.toggle("focused", state.focus === "input");
	if (state.focus === "input") $("input-textarea").focus({ preventScroll: true });
	else $("input-textarea").blur();
	markDirty();
}

function toggleZoom() {
	if (state.zoom) state.zoom = null;
	else state.zoom = state.focus === "tree" ? "tree" : "agent";
	applyZoom();
	flashLocal(state.zoom ? `${state.zoom.toUpperCase()} maximized (click [▲] to restore)` : "Windows restored");
}

function applyZoom() {
	const d = $("desktop");
	d.classList.toggle("zoom-agent", state.zoom === "agent");
	d.classList.toggle("zoom-tree", state.zoom === "tree");
}

// ---------------------------------------------------------------------------
// Agent panel (mirrors AgentPanel in agent-panel.ts)
// ---------------------------------------------------------------------------

const PASCAL_KEYWORDS = new Set([
	"program", "unit", "uses", "begin", "end", "var", "const", "type", "procedure", "function",
	"if", "then", "else", "case", "of", "while", "do", "repeat", "until", "for", "to", "downto",
	"array", "record", "set", "file", "with", "goto", "label", "nil", "not", "and", "or", "xor",
	"div", "mod", "in", "interface", "implementation", "import", "export", "class", "return",
	"async", "await", "let", "function",
]);

function addEntry(entry) {
	if (entry.kind === "__clear__") { state.entries = []; state.streamingOpen = false; state.streamingKind = null; markDirty(); return; }
	if (entry.kind === "__closeStream__") { state.streamingOpen = false; state.streamingKind = null; markDirty(); return; }
	if (entry.kind === "tool" || entry.kind === "error") state.streamingOpen = false;
	if (entry.kind === "user") {
		for (const line of String(entry.text).split("\n")) state.entries.push({ kind: "user", text: line });
	} else {
		state.entries.push(entry);
	}
	if (state.entries.length > 5000) state.entries.splice(0, state.entries.length - 5000);
	markDirty();
}

function appendDelta(kind, delta) {
	if (!state.streamingOpen || state.streamingKind !== kind) {
		state.streamingOpen = true;
		state.streamingKind = kind;
		state.entries.push({ kind, text: "" });
	}
	state.entries[state.entries.length - 1].text += delta;
	markDirty();
}

function clearPanel() {
	state.entries = [];
	state.streamingOpen = false;
	state.streamingKind = null;
	markDirty();
}

function getExportText() {
	const out = [];
	for (const e of state.entries) {
		switch (e.kind) {
			case "user": if (e.text) out.push(`\n### User:\n${e.text}`); break;
			case "agent": if (e.text) out.push(`\n### Assistant:\n${e.text}`); break;
			case "thinking": break;
			case "tool": out.push(`\n> [Tool ${e.tag ?? ""}] ${e.text}`); break;
			case "error": out.push(`\n> [Error] ${e.text}`); break;
			case "info": out.push(`\n> [Info] ${e.text}`); break;
		}
	}
	return out.join("\n").trim() + "\n";
}

function highlightCode(line) {
	if (line.trim().startsWith("//") || line.trim().startsWith("#") || line.trim().startsWith("{")) {
		return `<span class="codecom">${esc(line)}</span>`;
	}
	const parts = [];
	const regex = /("[^"]*"|'[^']*'|\b\d+\b|[a-zA-Z_]\w*|\s+|[^\w\s"']+)/g;
	let m;
	while ((m = regex.exec(line)) !== null) {
		const t = m[0];
		if (t.startsWith('"') || t.startsWith("'")) parts.push(`<span class="codestr">${esc(t)}</span>`);
		else if (/^\d+$/.test(t)) parts.push(`<span class="codenum">${esc(t)}</span>`);
		else if (PASCAL_KEYWORDS.has(t.toLowerCase())) parts.push(`<span class="codekw">${esc(t)}</span>`);
		else parts.push(esc(t));
	}
	return parts.join("");
}

function renderPanel() {
	const body = $("agent-body");
	const widthChars = Math.max(20, Math.floor(body.clientWidth / charWidth()));
	const html = [];
	let inCode = false;

	for (let i = 0; i < state.entries.length; i++) {
		const e = state.entries[i];
		// The entry the find overlay points at is marked, so it can be seen.
		const hit = i === state.find.index ? " find-hit" : "";
		switch (e.kind) {
			case "user":
				html.push(`<div class="entry-user${hit}"><span class="prompt">&gt; </span><span class="text">${esc(e.text)}</span></div>`);
				break;
			case "thinking":
				for (const raw of String(e.text).split("\n")) html.push(`<div class="entry-thinking${hit}">${esc(raw)}</div>`);
				break;
			case "agent": {
				for (const raw of String(e.text).split("\n")) {
					if (raw.startsWith("```")) { inCode = !inCode; html.push(`<div class="entry-agent codecom${hit}">${esc(raw.slice(0, widthChars))}</div>`); continue; }
					if (inCode) html.push(`<div class="entry-agent${hit}">${highlightCode(raw)}</div>`);
					else if (raw.startsWith("#")) html.push(`<div class="entry-agent mdhead${hit}">${esc(raw)}</div>`);
					else html.push(`<div class="entry-agent${hit}">${esc(raw)}</div>`);
				}
				break;
			}
			case "tool":
			case "error": {
				const tag = e.tag ?? (e.kind === "error" ? "[ERROR]" : "[OK]");
				let cls = "";
				if (e.isError) cls = "tag-error";
				else if (tag === "[RUN]" || tag === "[BASH]") cls = "tag-bash";
				else if (tag === "[WRITE]" || tag === "[EDIT]") cls = "tag-write";
				else if (tag === "[OK]") cls = "tag-ok";
				html.push(`<div class="entry-${e.kind}${hit}"><span class="tag ${cls}">${esc(tag.padEnd(8))}</span><span class="text">${esc(e.text)}</span></div>`);
				break;
			}
			case "info":
				html.push(`<div class="entry-info${hit}">${esc(e.text)}</div>`);
				break;
		}
	}

	if (state.isStreaming) {
		const frames = ["|", "/", "-", "\\"];
		const secs = state.requestStart ? (Date.now() - state.requestStart) / 1000 : 0;
		html.push(`<div class="thinking-indicator">╟ Thinking [ ${frames[state.spinnerFrame]} ] (${secs.toFixed(1)}s)</div>`);
	}

	body.innerHTML = html.join("");
	if (state.pinnedBottom) body.scrollTop = body.scrollHeight;
	// The find overlay scrolls its match into view.
	const hitEl = body.querySelector(".find-hit");
	if (hitEl) hitEl.scrollIntoView({ block: "center" });
	$("agent-linecounter").textContent = ` ${Math.min(body.scrollTop === 0 ? 1 : Math.ceil((body.scrollTop + body.clientHeight) / lineHeight()), countPanelLines())}:${countPanelLines()} `;
}

function countPanelLines() {
	return Math.max(1, Math.ceil($("agent-body").scrollHeight / lineHeight()));
}

/**
 * The width of one character of the live font, measured from a hidden probe
 * (100 "M" glyphs). The cache lives in `renderer/config.js` and is
 * invalidated whenever the font or the theme changes.
 */
function charWidth() {
	const m = Config.getMetrics();
	return m.charWidth || 8.4; // the 14px Consolas fallback
}

/** The height of one line of the live font, measured from the same probe. */
function lineHeight() {
	const m = Config.getMetrics();
	return m.lineHeight || 17.5; // the 14px Consolas fallback
}

$("agent-body").addEventListener("scroll", () => {
	const b = $("agent-body");
	state.pinnedBottom = b.scrollTop + b.clientHeight >= b.scrollHeight - 6;
});

// ---------------------------------------------------------------------------
// Project tree (mirrors ProjectTree in project-tree.ts)
// ---------------------------------------------------------------------------

function flattenVisible() {
	const out = [];
	const filter = state.treeFilter ? state.treeFilter.toLowerCase() : null;

	const walk = (nodes, depth) => {
		for (const n of nodes) {
			if (filter) {
				// Filter mode: show matching files and dirs containing matches.
				const selfMatch = !n.isDir && n.name.toLowerCase().includes(filter);
				const childMatch = n.isDir && subtreeHasMatch(n, filter);
				if (!selfMatch && !childMatch) continue;
			}
			out.push({ node: n, depth });
			if (n.isDir && state.treeExpanded.has(n.relPath) && n.children) walk(n.children, depth + 1);
		}
	};

	walk(state.tree, 0);
	if (state.treeCursor >= out.length) state.treeCursor = Math.max(0, out.length - 1);
	return out;
}

function subtreeHasMatch(node, filter) {
	if (!node.children) return false;
	for (const c of node.children) {
		if (!c.isDir && c.name.toLowerCase().includes(filter)) return true;
		if (c.isDir && subtreeHasMatch(c, filter)) return true;
	}
	return false;
}

function renderTree() {
	const body = $("tree-body");
	const rows = flattenVisible();
	const filterNote = state.treeFilter ? ` <span class="fcount">[filter: ${esc(state.treeFilter)}]</span>` : "";
	const html = [`<div class="trow dim">${esc(state.cwd)}${filterNote}</div>`];
	rows.forEach((r, i) => {
		const n = r.node;
		const indent = "  ".repeat(r.depth);
		const twist = n.isDir ? (state.treeExpanded.has(n.relPath) ? "▼ " : "▶ ") : "  ";
		const name = n.isDir ? n.name + "/" : (n.dirty ? n.name + " *" : n.name);
		const cls = n.isDir ? "dname" : (n.dirty ? "dirty" : "fname");
		const sel = i === state.treeCursor ? " sel" : "";
		html.push(`<div class="trow${sel}" data-i="${i}"><span class="twist">${twist}</span><span class="${cls}">${esc(indent)}${esc(name)}</span></div>`);
	});
	body.innerHTML = html.join("");
}

async function refreshGitAndTree() {
	await luuna.refreshGit();
	const res = await luuna.getTree();
	if (res.success) state.tree = res.data;
	markDirty();
}

function treeEnter(row) {
	const n = row.node;
	if (n.isDir) {
		if (state.treeExpanded.has(n.relPath)) state.treeExpanded.delete(n.relPath);
		else state.treeExpanded.add(n.relPath);
		markDirty();
	} else {
		previewFile(n);
	}
}

function previewFile(n) {
	void (async () => {
		const res = await luuna.readPreview(`${state.cwd}/${n.relPath}`);
		if (!res.success) { openTextPopup(n.name, ["(binary or unreadable file)"]); return; }
		const lines = res.data.truncated ? [...res.data.lines, "... (truncated)"] : res.data.lines;
		openTextPopup(n.name, lines);
	})();
}

function previewSelectedFile() {
	const rows = flattenVisible();
	const r = rows[state.treeCursor];
	if (r && !r.node.isDir) previewFile(r.node);
}

$("tree-body").addEventListener("click", (e) => {
	const rowEl = e.target.closest(".trow");
	if (!rowEl || rowEl.dataset.i === undefined) return;
	setFocus("tree");
	const i = Number(rowEl.dataset.i);
	const rows = flattenVisible();
	if (i < 0 || i >= rows.length) return;
	if (state.treeCursor === i) treeEnter(rows[i]);
	else { state.treeCursor = i; markDirty(); }
});

$("tree-body").addEventListener("dblclick", (e) => {
	const rowEl = e.target.closest(".trow");
	if (!rowEl || rowEl.dataset.i === undefined) return;
	const rows = flattenVisible();
	const i = Number(rowEl.dataset.i);
	if (i >= 0 && i < rows.length) treeEnter(rows[i]);
});

// ---------------------------------------------------------------------------
// Input line (mirror-highlighted textarea, history, submit)
// ---------------------------------------------------------------------------

const inputArea = $("input-textarea");
const inputMirror = $("input-mirror");

function syncInput() {
	const v = inputArea.value;
	const lines = v.split("\n");
	const effort = state.thinkingLevel && state.thinkingLevel !== "off" ? ` [${state.thinkingLevel}]` : "";
	$("input-title").textContent = `${state.model ?? "MESSAGE"}${effort} ${state.planMode ? "[PLAN]" : "[BUILD]"}${state.focus === "input" ? " ◄" : ""}`;

	const html = [];
	lines.forEach((line, i) => {
		const prefix = i === 0 ? `<span class="prompt">&gt; </span>` : `<span class="cont">  </span>`;
		html.push(prefix + esc(line));
	});
	// Trailing prompt line for the empty next row
	if (lines[lines.length - 1] !== "") html.push(`<span class="cont">  </span>`);
	inputMirror.innerHTML = html.join("\n") + "\n";

	// adaptive height like InputLine.getRequiredHeight
	const maxH = Math.max(3, Math.floor(window.innerHeight / 2 / lineHeight()));
	const h = Math.max(3, Math.min(maxH, lines.length + 2));
	$("win-input").style.height = `${h * lineHeight() + 14}px`;

	inputMirror.scrollTop = inputArea.scrollTop;
	inputMirror.scrollLeft = inputArea.scrollLeft;
	markDirty();
}

inputArea.addEventListener("input", (e) => { syncInput(); maybeOpenComposerMenu(e); });
inputArea.addEventListener("scroll", () => { inputMirror.scrollTop = inputArea.scrollTop; inputMirror.scrollLeft = inputArea.scrollLeft; });
inputArea.addEventListener("focus", () => { setFocus("input"); });
inputArea.addEventListener("keydown", (e) => {
	// Only the IME guard stays here. Every composer action (Enter, Shift+Enter,
	// Escape, the history arrows) is resolved by the GLOBAL handler through
	// the keymap, so a key is never handled twice.
	if (e.isComposing || e.keyCode === 229) return; // IME composition
});

function inputHistoryPrev() {
	if (state.inputHistory.length === 0) return;
	if (state.historyPos === null) { state.savedCurrent = inputArea.value; state.historyPos = state.inputHistory.length - 1; }
	else if (state.historyPos > 0) state.historyPos--;
	inputArea.value = state.inputHistory[state.historyPos] ?? "";
	syncInput();
}

function inputHistoryNext() {
	if (state.historyPos === null) return;
	if (state.historyPos < state.inputHistory.length - 1) {
		state.historyPos++;
		inputArea.value = state.inputHistory[state.historyPos] ?? "";
	} else {
		state.historyPos = null;
		inputArea.value = state.savedCurrent;
	}
	syncInput();
}

/**
 * Send the content of the composer. This is the `composer.send` action (and
 * the `composer.sendAlternate` one) — the global keydown handler owns the
 * chord, the textarea only ever sees the IME guard.
 */
function sendComposerMessage() {
	const text = inputArea.value.trim();
	if (!text) return true; // an empty composer consumes the key, but sends nothing
	state.inputHistory.push(inputArea.value);
	// The history size is the `historySize` of the app settings (200 by
	// default).
	const cfg = Config.currentConfig();
	const limit = (cfg && cfg.app && Number(cfg.app.historySize)) || Config.DEFAULT_HISTORY_SIZE;
	while (state.inputHistory.length > limit) state.inputHistory.shift();
	inputArea.value = "";
	state.historyPos = null;
	syncInput();
	void processInputSubmission(text);
	return true;
}

async function processInputSubmission(text) {
	const trimmed = text.trim();
	if (trimmed.startsWith("/")) {
		const handled = await handleSlashCommand(trimmed);
		if (handled) return;
	}
	state.lastPrompt = text;
	void luuna.prompt(text);
}

// ---------------------------------------------------------------------------
// Slash commands (mirrors App.handleSlashCommand in main.ts)
// ---------------------------------------------------------------------------

async function handleSlashCommand(text) {
	const [cmdWithSlash, ...argParts] = text.trim().split(/\s+/);
	const cmd = (cmdWithSlash || "").toLowerCase();
	const arg = argParts.join(" ").trim();

	switch (cmd) {
		case "/status":
		case "/stats": {
			addEntry({ kind: "user", text });
			const res = await luuna.getStats();
			const s = res.success ? res.data : null;
			const percent = s?.contextUsage?.percent != null ? `${s.contextUsage.percent}%` : "0%";
			const tokens = s?.tokens?.total ?? state.contextTokens ?? 0;
			const costStr = s?.cost !== undefined ? `$${s.cost.toFixed(4)}` : "$0.0000";
			const g = state.gitInfo;
			const branchStr = g?.branch ? `${g.branch} (+${g.added ?? 0} -${g.removed ?? 0})` : "no git repo";
			addEntry({ kind: "info", text: "=== LUUNA-AI SESSION STATUS ===" });
			addEntry({ kind: "info", text: `Session:      ${state.sessionName}` });
			addEntry({ kind: "info", text: `Active Model: ${state.model ?? "(none)"}` });
			addEntry({ kind: "info", text: `Effort Level: ${state.thinkingLevel ?? "default"}` });
			addEntry({ kind: "info", text: `Mode:         ${state.planMode ? "PLAN (Planning)" : "BUILD (Execution)"}` });
			addEntry({ kind: "info", text: `Directory:    ${state.cwd}` });
			addEntry({ kind: "info", text: `Context:      ${tokens} tokens (${percent})` });
			addEntry({ kind: "info", text: `Est. Cost:    ${costStr}` });
			addEntry({ kind: "info", text: `Git Status:   ${branchStr}` });
			flashLocal("Status displayed");
			return true;
		}
		case "/help":
		case "/?": openHelpDialog(); return true;
		case "/clear":
		case "/cls": clearPanel(); flashLocal("Agent view cleared"); return true;
		case "/compact": addEntry({ kind: "user", text }); void luuna.compact(); return true;
		case "/model": {
			if (!arg) { void openModelSelector(); return true; }
			let provider = "openrouter";
			let modelId = arg;
			if (arg.includes("/")) { const s = arg.indexOf("/"); provider = arg.slice(0, s).trim(); modelId = arg.slice(s + 1).trim(); }
			await luuna.addCustomModel({ provider, id: modelId, name: modelId, reasoning: true });
			await luuna.setModel({ provider, id: modelId, name: modelId });
			return true;
		}
		case "/effort":
		case "/thinking": {
			if (!arg) { void luuna.cycleThinkingLevel(); return true; }
			const res = await luuna.setThinkingLevel(arg);
			if (!res.success) { addEntry({ kind: "error", text: `Invalid thinking effort: ${arg}`, tag: "[ERROR]", isError: true }); flashLocal(res.error); }
			return true;
		}
		case "/plan":
			void luuna.setPlanMode(true);
			if (arg) void luuna.prompt(arg);
			return true;
		case "/build":
			void luuna.setPlanMode(false);
			if (arg) void luuna.prompt(arg);
			return true;
		case "/mode": void luuna.setPlanMode(!state.planMode); return true;
		case "/diff": void showDiff(); return true;
		case "/test":
		case "/tests": void luuna.runCommand("npm test"); return true;
		case "/run":
			if (arg) void luuna.runCommand(arg);
			else runCommandDialog();
			return true;
		case "/save":
			if (arg) {
				const res = await luuna.saveSessionFile(arg, getExportText());
				if (res.success) addEntry({ kind: "info", text: `Session saved: ${res.data}` });
				else flashLocal(res.error);
			} else saveSessionDialog();
			return true;
		case "/sessions":
		case "/session":
		case "/history":
		case "/resume":
		case "/open": {
			if (arg) { void luuna.openSession(arg); return true; }
			openSessionSelector();
			return true;
		}
		case "/new": void luuna.newSession(); return true;
		case "/fork": void luuna.fork(); return true;
		case "/tree":
		case "/files": setFocus("tree"); flashLocal("Active window: FILES"); return true;
		case "/export": void luuna.exportHtml(); return true;
		case "/exit":
		case "/quit": window.close(); return true;
	}
	return false;
}

// ---------------------------------------------------------------------------
// Dialog framework
// ---------------------------------------------------------------------------

function closeOverlay() {
	if (state.overlay) {
		// An overlay that owns a timer or a listener cleans it up here.
		if (typeof state.overlay.dispose === "function") {
			try { state.overlay.dispose(); } catch (err) { /* ignore */ }
		}
		state.overlay.el.remove();
		state.overlay = null;
	}
	closeMenus();
	// Hand keyboard focus back to the active window (input line, tree, agent).
	if (state.focus === "input") inputArea.focus({ preventScroll: true });
	markDirty();
}

function buildDialog({ title, bodyClass = "", width }) {
	const root = $("overlay-root");
	root.textContent = "";
	const backdrop = document.createElement("div");
	backdrop.className = "dialog-backdrop";
	const dlg = document.createElement("div");
	dlg.className = "dialog";
	if (width) dlg.style.width = width;
	dlg.innerHTML = `
		<div class="dlg-close" title="Close">■</div>
		<div class="dlg-title">${esc(title)}</div>
		<div class="dlg-body ${bodyClass}"></div>
		<div class="dlg-buttons"></div>`;
	backdrop.appendChild(dlg);
	root.appendChild(backdrop);
	backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) closeOverlay(); });
	dlg.querySelector(".dlg-close").addEventListener("click", closeOverlay);
	return { backdrop, dlg, body: dlg.querySelector(".dlg-body"), buttons: dlg.querySelector(".dlg-buttons") };
}

function addDialogButton(parent, label, onClick) {
	const btn = document.createElement("div");
	btn.className = "dlg-btn";
	const kIdx = label.indexOf("K");
	btn.innerHTML = kIdx >= 0 ? esc(label.slice(0, kIdx)) + `<span class="k">K</span>` + esc(label.slice(kIdx + 1)) : esc(label);
	btn.addEventListener("click", onClick);
	parent.appendChild(btn);
	return btn;
}

function openTextPopup(title, lines) {
	const { dlg, body, buttons } = buildDialog({ title, width: "min(760px, 86vw)" });
	for (const line of lines) {
		const div = document.createElement("div");
		div.className = "dline";
		div.textContent = line;
		body.appendChild(div);
	}
	addDialogButton(buttons, "     OK     ", closeOverlay);
	state.overlay = { kind: "text", el: backdropOf(dlg), onKey: (e) => { if (e.key === "Escape" || e.key === "Enter") { closeOverlay(); return true; } return false; } };
	dlg.querySelector(".dlg-body").focus?.();
}

function backdropOf(dlg) { return dlg.parentElement; }

function openHelpDialog() {
	const { dlg, body, buttons } = buildDialog({ title: "Help", width: "560px" });
	for (const line of buildHelpLines()) {
		const div = document.createElement("div");
		if (line.head) {
			div.className = "dline head";
			div.textContent = `── ${line.head} ──`;
		} else {
			div.className = "dline";
			div.innerHTML = `<span class="k">${esc(line.key.padEnd(11))}</span>${esc(line.text)}`;
		}
		body.appendChild(div);
	}
	addDialogButton(buttons, "     OK     ", closeOverlay);
	state.overlay = { kind: "help", el: backdropOf(dlg), onKey: (e) => { if (["Escape", "Enter"].includes(e.key)) { closeOverlay(); return true; } return false; } };
}

function openAboutDialog() {
	const { dlg, body, buttons } = buildDialog({ title: "About", width: "460px" });
	body.style.textAlign = "center";
	for (const line of ABOUT_LINES) {
		const div = document.createElement("div");
		div.className = "dline";
		div.textContent = line;
		body.appendChild(div);
	}
	addDialogButton(buttons, "     OK     ", closeOverlay);
	state.overlay = { kind: "about", el: backdropOf(dlg), onKey: (e) => { if (["Escape", "Enter"].includes(e.key)) { closeOverlay(); return true; } return false; } };
}

function openPromptDialog(title, prefill, onSubmit, options = {}) {
	const { dlg, body, buttons } = buildDialog({ title, width: "520px" });
	const input = document.createElement("input");
	input.className = "dlg-input";
	input.type = options.secret ? "password" : "text";
	input.value = prefill ?? "";
	body.style.whiteSpace = "normal";
	body.appendChild(input);
	setTimeout(() => { input.focus(); input.select(); }, 30);

	const submit = () => { const v = input.value; closeOverlay(); onSubmit(v); };
	addDialogButton(buttons, "     OK     ", submit);
	addDialogButton(buttons, "  Cancel  ", closeOverlay);

	state.overlay = {
		kind: "prompt",
		el: backdropOf(dlg),
		onKey: (e) => {
			if (e.key === "Escape") { closeOverlay(); return true; }
			if (e.target === input) {
				if (e.key === "Enter") { e.preventDefault(); submit(); return true; }
				return false; // let typing flow into the input
			}
			if (e.key === "Enter") { submit(); return true; }
			return false;
		},
	};
}

// --- model selector ---------------------------------------------------------

/**
 * The model selector. `onPicked` is called after a model was chosen — the
 * "regenerate with a different model" action uses it to send the last prompt
 * again.
 */
async function openModelSelector(onPicked) {
	const res = await luuna.getModels();
	if (!res.success) { flashLocal(res.error ?? "Unable to list models"); return; }
	const models = [...res.data, { id: "__custom__", name: "Enter custom model ID...", provider: "+" }];

	const { dlg, body, buttons } = buildDialog({ title: "Select AI Model", width: "640px" });
	let index = 0;

	const renderList = () => {
		body.textContent = "";
		models.forEach((m, i) => {
			const row = document.createElement("div");
			row.className = "listrow" + (i === index ? " sel" : "");
			row.innerHTML = `<span class="num">${esc(String(i + 1).padStart(2) + ".")}</span><span>${esc(m.provider + "/" + m.id)}</span><span class="sub">${esc(m.name ?? "")}</span>`;
			row.addEventListener("click", () => { index = i; renderList(); });
			row.addEventListener("dblclick", () => selectCurrent());
			body.appendChild(row);
		});
		const selEl = body.querySelector(".listrow.sel");
		if (selEl) selEl.scrollIntoView({ block: "nearest" });
	};
	const selectCurrent = () => {
		const m = models[index];
		closeOverlay();
		if (!m) return;
		if (m.id === "__custom__") {
			openPromptDialog("Enter Model (provider/model-id):", "", (input) => {
				const raw = (input || "").trim();
				if (!raw) return;
				let provider = "openrouter";
				let modelId = raw;
				if (raw.includes("/")) { const s = raw.indexOf("/"); provider = raw.slice(0, s).trim(); modelId = raw.slice(s + 1).trim(); }
				void (async () => {
					await luuna.addCustomModel({ provider, id: modelId, name: modelId, reasoning: true });
					await luuna.setModel({ provider, id: modelId, name: modelId });
					if (onPicked) onPicked({ provider, id: modelId, name: modelId });
				})();
			});
			return;
		}
		void (async () => {
			await luuna.setModel(m);
			if (onPicked) onPicked(m);
		})();
	};
	renderList();
	addDialogButton(buttons, "  Select  ", selectCurrent);
	addDialogButton(buttons, "  Cancel  ", closeOverlay);

	body.style.maxHeight = "50vh";
	state.overlay = {
		kind: "model",
		el: backdropOf(dlg),
		onKey: (e) => {
			if (e.key === "Escape") { closeOverlay(); return true; }
			if (vimListNav(e, makeListApi(models.length, () => index, (i) => { index = i; renderList(); }))) { e.preventDefault(); return true; }
			if (e.key === "ArrowUp") { index = Math.max(0, index - 1); renderList(); return true; }
			if (e.key === "ArrowDown") { index = Math.min(models.length - 1, index + 1); renderList(); return true; }
			if (e.key === "Home") { index = 0; renderList(); return true; }
			if (e.key === "End") { index = models.length - 1; renderList(); return true; }
			if (e.key === "Enter") { selectCurrent(); return true; }
			const n = Number(e.key);
			if (!Number.isNaN(n) && n >= 1 && n <= models.length) { index = n - 1; renderList(); return true; }
			return false;
		},
	};
}

// --- session selector ---------------------------------------------------------

async function openSessionSelector() {
	const { dlg, body, buttons } = buildDialog({ title: "Open Session", width: "680px" });
	body.textContent = "Loading sessions...";
	addDialogButton(buttons, "  Open  ", () => { });
	addDialogButton(buttons, "  Cancel  ", closeOverlay);

	const res = await luuna.getSessions();
	if (state.overlay) { closeOverlay(); }
	if (!res.success) { flashLocal(res.error ?? "Failed to list sessions"); return; }
	const sessions = res.data;
	if (sessions.length === 0) { flashLocal("No saved sessions found for this project"); return; }

	const b = buildDialog({ title: "Open Session", width: "680px" });
	let index = 0;
	const renderList = () => {
		b.body.textContent = "";
		sessions.forEach((s, i) => {
			const row = document.createElement("div");
			row.className = "listrow" + (i === index ? " sel" : "");
			row.innerHTML = `<span class="num">${esc(String(i + 1) + ".")}</span><span>${esc(String(s.title).slice(0, 26))}</span><span class="sub">${esc(s.date)}  ${esc(String(s.firstPrompt).slice(0, 34))}${s.kind === "transcript" ? " [md]" : ""}</span>`;
			row.addEventListener("click", () => { index = i; renderList(); });
			row.addEventListener("dblclick", () => selectCurrent());
			b.body.appendChild(row);
		});
		const selEl = b.body.querySelector(".listrow.sel");
		if (selEl) selEl.scrollIntoView({ block: "nearest" });
	};
	const selectCurrent = () => {
		const s = sessions[index];
		closeOverlay();
		if (s) void luuna.openSession(s.path);
	};
	renderList();
	b.buttons.textContent = "";
	addDialogButton(b.buttons, "  Open  ", selectCurrent);
	addDialogButton(b.buttons, "  Cancel  ", closeOverlay);
	b.body.style.maxHeight = "50vh";

	state.overlay = {
		kind: "session",
		el: backdropOf(b.dlg),
		onKey: (e) => {
			if (e.key === "Escape") { closeOverlay(); return true; }
			if (vimListNav(e, makeListApi(sessions.length, () => index, (i) => { index = i; renderList(); }))) { e.preventDefault(); return true; }
			if (e.key === "ArrowUp") { index = Math.max(0, index - 1); renderList(); return true; }
			if (e.key === "ArrowDown") { index = Math.min(sessions.length - 1, index + 1); renderList(); return true; }
			if (e.key === "Enter") { selectCurrent(); return true; }
			const n = Number(e.key);
			if (!Number.isNaN(n) && n >= 1 && n <= sessions.length) { const s = sessions[n - 1]; closeOverlay(); void luuna.openSession(s.path); return true; }
			return false;
		},
	};
}

// --- provider / API key config -------------------------------------------------

async function openProviderDialog() {
	const res = await luuna.getProviders();
	if (!res.success) { flashLocal(res.error ?? "Failed to load providers"); return; }
	const providers = res.data;

	const { dlg, body, buttons } = buildDialog({ title: "API Keys & LLM Providers", width: "700px" });
	let index = 0;
	const renderList = () => {
		body.textContent = "";
		providers.forEach((p, i) => {
			const row = document.createElement("div");
			row.className = "listrow" + (i === index ? " sel" : "");
			row.innerHTML = `<span class="num">${esc(String(i + 1) + ".")}</span><span>${esc(p.name.padEnd(26))}</span><span class="sub">${esc(p.masked ?? "(not set)")}  —  ${esc(p.description)}</span>`;
			row.addEventListener("click", () => { index = i; renderList(); });
			row.addEventListener("dblclick", () => editCurrent());
			body.appendChild(row);
		});
		const selEl = body.querySelector(".listrow.sel");
		if (selEl) selEl.scrollIntoView({ block: "nearest" });
	};
	const editCurrent = () => {
		const p = providers[index];
		if (!p) return;
		openPromptDialog(`Set ${p.name} API Key`, "", (key) => {
			void (async () => {
				await luuna.writeEnvKey(p.envVar, key ?? "");
				await openProviderDialog();
			})();
		}, { secret: true });
	};
	renderList();
	addDialogButton(buttons, "  Edit Key  ", editCurrent);
	addDialogButton(buttons, "  Cancel  ", closeOverlay);
	body.style.maxHeight = "50vh";

	state.overlay = {
		kind: "providerConfig",
		el: backdropOf(dlg),
		onKey: (e) => {
			if (e.key === "Escape") { closeOverlay(); return true; }
			if (vimListNav(e, makeListApi(providers.length, () => index, (i) => { index = i; renderList(); }))) { e.preventDefault(); return true; }
			if (e.key === "ArrowUp") { index = Math.max(0, index - 1); renderList(); return true; }
			if (e.key === "ArrowDown") { index = Math.min(providers.length - 1, index + 1); renderList(); return true; }
			if (e.key === "Enter") { editCurrent(); return true; }
			const n = Number(e.key);
			if (!Number.isNaN(n) && n >= 1 && n <= providers.length) { index = n - 1; renderList(); editCurrent(); return true; }
			return false;
		},
	};
}

// --- add custom model -----------------------------------------------------------

function openAddModelDialog() {
	const { dlg, body, buttons } = buildDialog({ title: "Add Custom Model", width: "560px" });
	body.style.whiteSpace = "normal";
	let fieldIndex = 0;
	let providerIdx = 0;
	const data = { modelId: "", name: "", reasoning: true };

	const fields = [
		{ label: "Provider", render: (el, focused) => { el.textContent = ` ◄ ${PROVIDER_IDS[providerIdx]} ► `; } },
		{ label: "Model ID", render: (el, focused) => { el.textContent = data.modelId + (focused ? "▌" : ""); } },
		{ label: "Display name", render: (el, focused) => { el.textContent = data.name + (focused ? "▌" : ""); } },
		{ label: "Reasoning", render: (el) => { el.textContent = data.reasoning ? "[X] enabled" : "[ ] disabled"; } },
	];

	const render = () => {
		body.textContent = "";
		fields.forEach((f, i) => {
			const row = document.createElement("div");
			row.className = "dlg-field" + (i === fieldIndex ? " focused" : "");
			row.innerHTML = `<span class="flabel">${esc(f.label)}</span>`;
			const val = document.createElement("span");
			val.className = "fvalue";
			f.render(val, i === fieldIndex);
			row.appendChild(val);
			row.addEventListener("click", () => { fieldIndex = i; render(); });
			body.appendChild(row);
		});
	};

	const save = () => {
		if (!data.modelId.trim()) { fieldIndex = 1; render(); return; }
		const provider = PROVIDER_IDS[providerIdx];
		const modelId = data.modelId.trim();
		const name = data.name.trim() || modelId;
		closeOverlay();
		void (async () => {
			await luuna.addCustomModel({ provider, id: modelId, name, reasoning: data.reasoning });
			await luuna.setModel({ provider, id: modelId, name });
		})();
	};

	addDialogButton(buttons, "  Save  ", save);
	addDialogButton(buttons, "  Cancel  ", closeOverlay);
	render();

	const typeInto = (ch) => {
		if (fieldIndex === 1) data.modelId += ch;
		else if (fieldIndex === 2) data.name += ch;
		render();
	};
	const backspace = () => {
		if (fieldIndex === 1) data.modelId = data.modelId.slice(0, -1);
		else if (fieldIndex === 2) data.name = data.name.slice(0, -1);
		render();
	};

	state.overlay = {
		kind: "addModel",
		el: backdropOf(dlg),
		onKey: (e) => {
			if (e.key === "Escape") { closeOverlay(); return true; }
			if (e.key === "Tab" || e.key === "ArrowDown") { fieldIndex = (fieldIndex + 1) % fields.length; render(); return true; }
			if (e.key === "ArrowUp") { fieldIndex = (fieldIndex + fields.length - 1) % fields.length; render(); return true; }
			if (e.key === "ArrowLeft" && fieldIndex === 0) { providerIdx = (providerIdx + PROVIDER_IDS.length - 1) % PROVIDER_IDS.length; render(); return true; }
			if (e.key === "ArrowRight" && fieldIndex === 0) { providerIdx = (providerIdx + 1) % PROVIDER_IDS.length; render(); return true; }
			if (e.key === "Enter") { save(); return true; }
			if (e.key === "Backspace") { backspace(); return true; }
			if (e.key === " " && fieldIndex === 3) { data.reasoning = !data.reasoning; render(); return true; }
			const altGr = e.getModifierState && e.getModifierState("AltGraph");
			if (e.key.length === 1 && fieldIndex >= 1 && fieldIndex <= 2 && ((!e.ctrlKey && !e.altKey) || altGr)) { typeInto(e.key); return true; }
			return false;
		},
	};
}

// --- misc dialogs ----------------------------------------------------------------

async function saveSessionDialog() {
	const defaultName = `${state.sessionName.replace(/\.PAS$/i, "")}.md`;
	const r = await luuna.saveDialog(defaultName);
	if (!r || r.canceled) return;
	const res = await luuna.saveSessionFile(r.path, getExportText());
	if (!res.success) flashLocal(res.error);
}

function renameSessionDialog() {
	openPromptDialog("Rename Session", "", (name) => {
		if (!name.trim()) return;
		void luuna.setSessionName(name.trim()).then(() => {
			state.sessionName = name.trim();
			addEntry({ kind: "info", text: `Session name: ${name.trim()}` });
			flashLocal(`Session renamed: "${name.trim()}"`);
		});
	});
}

async function changeDirectoryDialog() {
	const r = await luuna.openDirDialog();
	if (!r || r.canceled) return;
	void (async () => {
		const res = await luuna.changeDirectory(r.path);
		if (res.success) {
			const boot = await luuna.getState();
			if (boot.success) Object.assign(state, pickState(boot.data));
			// The new project has its own `.luuna/` tier: re-read the
			// configuration so its theme, font and shortcuts take effect at once.
			await applyConfiguration();
			await refreshGitAndTree();
		} else {
			flashLocal(res.error);
		}
	})();
}

function runCommandDialog() {
	openPromptDialog("Run command:", "", (cmd) => {
		if (cmd) void luuna.runCommand(cmd);
	});
}

function findFileDialog() {
	openPromptDialog("Find file:", "", (v) => {
		state.treeFilter = v.trim() || null;
		setFocus("tree");
		flashLocal(v ? `Filter: ${v}` : "Filter cleared");
	});
}

function grepDialog() {
	openPromptDialog("Search Text in Files (Grep)", "", (query) => {
		if (!query.trim()) return;
		void (async () => {
			flashLocal(`Searching for: ${query.trim()}`);
			const res = await luuna.gitGrep(query.trim());
			if (res.success) openTextPopup(`Search: ${query.trim()}`, res.data);
			else flashLocal(res.error ?? "Search failed");
		})();
	});
}

async function showLastAnswer() {
	const res = await luuna.getLastAssistantText();
	if (!res.success) openTextPopup("Last Assistant Response", [res.error ?? "No assistant messages in session."]);
	else openTextPopup("Last Assistant Response", String(res.data).split(/\r?\n/));
}

async function showGitStatus() {
	const res = await luuna.gitStatus();
	if (res.success) openTextPopup("Git status", res.data);
}

async function showGitLog() {
	const res = await luuna.gitLog();
	if (res.success) openTextPopup("Git Commit History", res.data);
}

async function showStats() {
	const res = await luuna.getStats();
	if (!res.success) { openTextPopup("Session stats", [res.error ?? "Unavailable"]); return; }
	const d = res.data;
	const cu = d.contextUsage;
	openTextPopup("Session stats", [
		`Messages:      ${d.totalMessages ?? "?"}`,
		`Tool calls:    ${d.toolCalls ?? "?"}`,
		`Tokens total:  ${d.tokens?.total ?? "?"}`,
		`  input:       ${d.tokens?.input ?? "?"}`,
		`  output:      ${d.tokens?.output ?? "?"}`,
		cu ? `Context:       ${cu.tokens ?? "?"} / ${cu.contextWindow} (${cu.percent ?? "?"}%)` : "Context:       n/a",
		`Cost:          ${typeof d.cost === "number" ? "$" + d.cost.toFixed(4) : "?"}`,
	]);
}

async function showEnvInfo() {
	const res = await luuna.systemInfo();
	if (res.success) openTextPopup("Environment Information", res.data);
}

async function showDiff() {
	const res = await luuna.gitDiff();
	if (!res.success) { flashLocal("Not a git repository or git unavailable"); return; }
	const { dlg, body, buttons } = buildDialog({ title: "Diff: working tree", width: "min(880px, 90vw)" });
	for (const line of String(res.data).split("\n")) {
		const div = document.createElement("div");
		let cls = "diff-ctx";
		if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) cls = "diff-meta";
		else if (line.startsWith("@@")) cls = "diff-hunk";
		else if (line.startsWith("+")) cls = "diff-plus";
		else if (line.startsWith("-")) cls = "diff-minus";
		div.className = cls;
		div.textContent = line || " ";
		body.appendChild(div);
	}
	addDialogButton(buttons, "     OK     ", closeOverlay);
	state.overlay = { kind: "diff", el: backdropOf(dlg), onKey: (e) => { if (["Escape", "Enter"].includes(e.key)) { closeOverlay(); return true; } return false; } };
}

// ---------------------------------------------------------------------------
// The configuration surfaces
//
// The command palette, the theme picker, the settings dialog, the composer
// popups and the find bar.
//
// Every write goes through `luuna.setConfig`; after a successful write the
// configuration is re-read and the theme, the font and the keymap overrides
// are re-applied. A failed write flashes the error and leaves the applied
// state alone.
// ---------------------------------------------------------------------------

/**
 * The secondary and the tertiary variant of a palette action.
 *
 * `Mod+Enter` runs the secondary variant of the highlighted action and
 * `Alt+Enter` the tertiary one; an action that defines no variant behaves
 * like a plain `Enter`.
 */
const ACTION_VARIANTS = {
	"agent.model": { secondary: "agent.cycleModel", tertiary: "session.regenerateModel" },
	"session.regenerate": { secondary: "session.regenerateModel" },
	"file.save": { secondary: "file.export" },
	"git.diff": { secondary: "git.status", tertiary: "git.log" },
	"view.zoomIn": { secondary: "view.zoomOut", tertiary: "view.zoomReset" },
	"edit.copyOrAbort": { secondary: "edit.lastAnswer" },
	"run.tests": { secondary: "run.build" },
	"app.settings": { secondary: "app.keybindings", tertiary: "app.theme" },
	"app.keybindings": { secondary: "app.theme" },
};

/**
 * The menu command that performs a registry action — the reverse of the
 * registry's menu aliases. Returns null when no menu item performs the action.
 */
function menuCommandForAction(actionId) {
	for (const menu of MAIN_MENUS) {
		for (const item of menu.items) {
			if (!item.action) continue;
			if (Keymap.resolveAlias(item.action) === actionId) return item.action;
		}
	}
	return null;
}

/**
 * Run a registry action: the keymap handler first, the menu command
 * otherwise. This is what the command palette runs.
 */
function runAction(actionId) {
	const handler = KEYMAP_HANDLERS[actionId];
	if (handler) { handler(actionId); return true; }
	const command = menuCommandForAction(actionId);
	if (command) { dispatchCommand(command); return true; }
	flashLocal(`No handler for "${actionId}"`);
	return false;
}

/** The registry actions the palette offers: those with a chord or a menu command. */
function paletteActions() {
	return Keymap.ACTIONS.filter((action) =>
		Keymap.chordsFor(action.id).length > 0 || !!menuCommandForAction(action.id));
}

/**
 * A case-insensitive subsequence score: every character of the query must
 * appear in the text, in order. A lower score is a better match; null means
 * "no match" at all.
 *
 * A subsequence match is what makes "cmdp" find "Command palette".
 */
function subsequenceScore(text, query) {
	if (!query) return 0;
	const t = String(text).toLowerCase();
	const q = String(query).toLowerCase();
	let at = 0;
	let last = -1;
	let score = 0;
	for (const ch of q) {
		const idx = t.indexOf(ch, at);
		if (idx === -1) return null;
		score += idx - last - 1;
		last = idx;
		at = idx + 1;
	}
	const direct = t.indexOf(q);
	if (direct === 0) score -= 100;
	else if (direct > 0) score -= 20;
	return score;
}

/** The categories of the registry, in the order the registry lists them. */
function registryCategories() {
	const out = [];
	for (const action of Keymap.ACTIONS) {
		if (!out.includes(action.category)) out.push(action.category);
	}
	return out;
}

/**
 * Write a settings file WITHOUT re-reading the configuration.
 *
 * A batch of writes (the "reset all to defaults" button) does the writes and
 * reloads once at the end — a reload per write would re-read both tiers' six
 * settings files and re-scan both theme directories, three times over.
 *
 * @param {string} scope "global" | "project"
 * @param {string} file "appearance" | "keybindings" | "app"
 * @param {Object} value the patch (or the whole file, with `replace`)
 * @param {boolean} [replace] make the value the whole file
 * @returns {Promise<boolean>} true when the write succeeded
 */
async function writeConfigRaw(scope, file, value, replace) {
	try {
		const res = await luuna.setConfig(scope, file, value, replace === true ? true : undefined);
		if (res && res.success === false) {
			flashLocal(`Config error: ${res.error}`);
			return false;
		}
		return true;
	} catch (err) {
		flashLocal(`Config error: ${err}`);
		return false;
	}
}

/**
 * Write a settings file and re-read the configuration, so the theme, the
 * font and the keymap overrides are applied again. A failed write flashes the
 * error and changes nothing.
 *
 * @param {string} scope "global" | "project"
 * @param {string} file "appearance" | "keybindings" | "app"
 * @param {Object} value the patch (or the whole file, with `replace`)
 * @param {boolean} [replace] make the value the whole file
 * @returns {Promise<boolean>} true when the write succeeded
 */
async function writeConfig(scope, file, value, replace) {
	const ok = await writeConfigRaw(scope, file, value, replace);
	if (!ok) return false;
	await applyConfiguration();
	return true;
}

// --- the command palette ---------------------------------------------------

/**
 * The `Mod+K` Action Panel: a search field, the actions grouped into
 * sections, the chord of every action on the right, and `Enter` to run the
 * highlighted action.
 */
function openCommandPalette() {
	const { dlg, body, buttons } = buildDialog({ title: "Command palette", bodyClass: "palette-body", width: "min(700px, 90vw)" });

	const search = document.createElement("input");
	search.className = "dlg-input palette-search";
	search.type = "text";
	search.placeholder = "Search for actions…";
	search.setAttribute("aria-label", "Search for actions");
	body.appendChild(search);

	const list = document.createElement("div");
	list.className = "palette-list";
	body.appendChild(list);

	const actions = paletteActions();
	let rows = [];
	let index = 0;

	const render = () => {
		const query = search.value.trim();
		const scored = [];
		for (const action of actions) {
			const score = subsequenceScore(action.label, query);
			if (score === null) continue;
			scored.push({ action, score, order: actions.indexOf(action) });
		}
		list.textContent = "";
		rows = [];
		for (const category of registryCategories()) {
			const inCategory = scored
				.filter((entry) => entry.action.category === category)
				.sort((a, b) => a.score - b.score || a.order - b.order);
			if (!inCategory.length) continue;
			const head = document.createElement("div");
			head.className = "palette-section";
			head.textContent = category;
			list.appendChild(head);
			for (const entry of inCategory) {
				const action = entry.action;
				const row = document.createElement("div");
				row.className = "listrow palette-row";
				row.dataset.i = String(rows.length);
				const label = document.createElement("span");
				label.className = "plabel";
				label.textContent = action.label;
				const chord = document.createElement("span");
				chord.className = "sc";
				chord.textContent = chordSetText(action.id);
				row.appendChild(label);
				row.appendChild(chord);
				list.appendChild(row);
				rows.push({ action, el: row });
			}
		}
		if (index >= rows.length) index = Math.max(0, rows.length - 1);
		mark();
	};

	const mark = () => {
		rows.forEach((row, i) => row.el.classList.toggle("sel", i === index));
		const sel = rows[index];
		if (sel) sel.el.scrollIntoView({ block: "nearest" });
	};

	const move = (delta) => {
		if (!rows.length) return;
		index = (index + delta + rows.length) % rows.length;
		mark();
	};

	list.addEventListener("click", (e) => {
		const rowEl = e.target.closest(".palette-row");
		if (!rowEl) return;
		index = Number(rowEl.dataset.i);
		mark();
	});
	list.addEventListener("dblclick", (e) => {
		const rowEl = e.target.closest(".palette-row");
		if (!rowEl) return;
		index = Number(rowEl.dataset.i);
		const row = rows[index];
		if (!row) return;
		closeOverlay();
		runAction(row.action.id);
	});
	search.addEventListener("input", () => { index = 0; render(); });

	render();
	addDialogButton(buttons, "  Close  ", closeOverlay);
	setTimeout(() => { search.focus(); search.select(); }, 30);

	state.overlay = {
		kind: "palette",
		el: backdropOf(dlg),
		onKey: (e) => {
			if (e.key === "Escape") { closeOverlay(); return true; }
			if (e.key === "ArrowDown") { move(1); return true; }
			if (e.key === "ArrowUp") { move(-1); return true; }
			if (e.key === "PageDown") { move(5); return true; }
			if (e.key === "PageUp") { move(-5); return true; }
			if (e.key === "Home") { index = 0; mark(); return true; }
			if (e.key === "End") { index = Math.max(0, rows.length - 1); mark(); return true; }
			if (e.key === "Enter") {
				const row = rows[index];
				if (!row) return true;
				const variant = (e.ctrlKey || e.metaKey) ? "secondary" : (e.altKey ? "tertiary" : null);
				const target = variant ? (ACTION_VARIANTS[row.action.id]?.[variant] ?? row.action.id) : row.action.id;
				closeOverlay();
				runAction(target);
				return true;
			}
			return false;
		},
	};
}

// --- the theme picker -------------------------------------------------------

/**
 * The theme overlay: the built-in and the user themes, the 16 palette values
 * as swatches, a live preview while the selection moves, `Enter` to keep the
 * theme and `Escape` to restore the previous one.
 */
function openThemePicker() {
	const cfg = Config.currentConfig();
	const map = Themes.mergeThemes(Themes.BUILTIN_THEMES, cfg ? cfg.themes : []);
	const themes = Object.values(map);
	const previous = appliedTheme ? { ...appliedTheme } : null;
	const appearance = (cfg && cfg.appearance) || { theme: "dos", font: null };
	let index = themes.findIndex((t) => t.id === appearance.theme);
	if (index < 0) index = 0;

	const { dlg, body, buttons } = buildDialog({ title: "Theme picker", bodyClass: "theme-body", width: "min(720px, 90vw)" });
	const list = document.createElement("div");
	list.className = "theme-list";
	body.appendChild(list);

	const render = () => {
		list.textContent = "";
		themes.forEach((theme, i) => {
			const resolved = Themes.resolveTheme(theme.id, map);
			const row = document.createElement("div");
			row.className = "listrow theme-row" + (i === index ? " sel" : "");
			const name = document.createElement("span");
			name.className = "tname";
			name.textContent = resolved.name;
			const desc = document.createElement("span");
			desc.className = "tsub";
			desc.textContent = resolved.description || "";
			const swatches = document.createElement("span");
			swatches.className = "theme-swatches";
			for (const paletteName of Themes.PALETTE_NAMES) {
				const swatch = document.createElement("span");
				swatch.className = "theme-swatch";
				swatch.style.backgroundColor = resolved.palette[paletteName];
				swatch.title = paletteName;
				swatches.appendChild(swatch);
			}
			row.appendChild(name);
			row.appendChild(desc);
			row.appendChild(swatches);
			row.addEventListener("click", () => { index = i; preview(); render(); });
			list.appendChild(row);
		});
	};

	/** Apply the selected theme as a live preview. */
	const preview = () => {
		const theme = Themes.resolveTheme(themes[index].id, map);
		const font = Config.fontFromSettings(appearance, theme);
		Themes.applyTheme(theme, font);
		Config.invalidateMetrics();
		appliedTheme = theme;
		markDirty();
	};

	/** Restore the theme that was in effect when the picker opened. */
	const restore = () => {
		if (!previous) return;
		const font = Config.fontFromSettings(appearance, previous);
		Themes.applyTheme(previous, font);
		Config.invalidateMetrics();
		appliedTheme = previous;
		markDirty();
	};

	const keep = async () => {
		const id = themes[index].id;
		closeOverlay();
		const ok = await writeConfig(state.configScope, "appearance", { theme: id });
		if (ok) { flashLocal(`Theme: ${id}`); return; }
		// A failed write must not change the applied state.
		restore();
	};

	render();
	addDialogButton(buttons, "    Use   ", () => { void keep(); });
	addDialogButton(buttons, "  Cancel  ", () => { restore(); closeOverlay(); });

	state.overlay = {
		kind: "theme",
		el: backdropOf(dlg),
		onKey: (e) => {
			if (e.key === "Escape") { restore(); closeOverlay(); return true; }
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				const delta = e.key === "ArrowDown" ? 1 : -1;
				index = (index + delta + themes.length) % themes.length;
				preview();
				render();
				return true;
			}
			if (e.key === "Home") { index = 0; preview(); render(); return true; }
			if (e.key === "End") { index = themes.length - 1; preview(); render(); return true; }
			if (e.key === "Enter") { void keep(); return true; }
			return false;
		},
	};
}

// --- the settings dialog ----------------------------------------------------

const SETTINGS_SECTIONS = [
	{ id: "appearance", label: "Appearance" },
	{ id: "keybindings", label: "Keybindings" },
	{ id: "config", label: "Config" },
];

/**
 * The settings dialog: a section list on the left, the content of the
 * section on the right. `Tab` moves between the two, the arrow keys move
 * inside the content and the vim motions move inside the section list.
 */
function openSettingsDialog(section) {
	const { dlg, body, buttons } = buildDialog({ title: "Settings", bodyClass: "settings-body", width: "min(920px, 94vw)" });

	const layout = document.createElement("div");
	layout.className = "settings-layout";
	const sectionList = document.createElement("div");
	sectionList.className = "settings-sections";
	const content = document.createElement("div");
	content.className = "settings-content";
	layout.appendChild(sectionList);
	layout.appendChild(content);
	body.appendChild(layout);

	let sectionIndex = Math.max(0, SETTINGS_SECTIONS.findIndex((s) => s.id === section));
	let mode = "content";
	let controller = null;

	const renderSections = () => {
		sectionList.textContent = "";
		SETTINGS_SECTIONS.forEach((s, i) => {
			const row = document.createElement("div");
			row.className = "listrow settings-section"
				+ (mode === "sections" && i === sectionIndex ? " sel" : "")
				+ (mode === "content" && i === sectionIndex ? " cur" : "");
			const label = document.createElement("span");
			label.textContent = (mode === "content" && i === sectionIndex ? "► " : "  ") + s.label;
			row.appendChild(label);
			row.addEventListener("click", () => {
				sectionIndex = i;
				mode = "content";
				showSection();
			});
			sectionList.appendChild(row);
		});
	};

	const showSection = () => {
		if (controller && typeof controller.dispose === "function") controller.dispose();
		content.textContent = "";
		controller = null;
		const id = SETTINGS_SECTIONS[sectionIndex].id;
		if (id === "appearance") controller = appearanceSection(content, showSection);
		else if (id === "keybindings") controller = keybindingsSection(content, showSection);
		else controller = configSection(content, showSection);
		renderSections();
	};

	showSection();
	addDialogButton(buttons, "  Close  ", closeOverlay);

	state.overlay = {
		kind: "settings",
		el: backdropOf(dlg),
		dispose: () => {
			// The keybinding recorder owns a timer — it must not outlive the
			// dialog.
			if (controller && typeof controller.dispose === "function") controller.dispose();
			controller = null;
		},
		onKey: (e) => {
			if (e.key === "Escape") {
				// A section may own the Escape (the keybinding recorder uses it
				// to cancel a recording).
				if (controller && typeof controller.escape === "function" && controller.escape()) return true;
				closeOverlay();
				return true;
			}
			if (mode === "sections") {
				if (e.key === "ArrowDown" || e.key === "ArrowUp") {
					const delta = e.key === "ArrowDown" ? 1 : -1;
					sectionIndex = (sectionIndex + delta + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length;
					showSection();
					return true;
				}
				if (vimListNav(e, makeListApi(SETTINGS_SECTIONS.length, () => sectionIndex, (i) => { sectionIndex = i; showSection(); }))) {
					e.preventDefault();
					return true;
				}
				if (e.key === "Enter" || e.key === "Tab") {
					mode = "content";
					renderSections();
					if (controller && typeof controller.focus === "function") controller.focus();
					return true;
				}
				return false;
			}
			if (e.key === "Tab") {
				mode = "sections";
				renderSections();
				if (document.activeElement && typeof document.activeElement.blur === "function") document.activeElement.blur();
				return true;
			}
			if (!controller) return false;
			return controller.key(e);
		},
	};
}

/**
 * The Appearance section: the theme list, the font family, the font size and
 * the line height. Every change applies live and is persisted in the scope
 * the Config section selected.
 */
function appearanceSection(host, refresh) {
	const cfg = Config.currentConfig();
	const appearance = (cfg && cfg.appearance) || { theme: "dos", font: null };
	const map = Themes.mergeThemes(Themes.BUILTIN_THEMES, cfg ? cfg.themes : []);
	const themes = Object.values(map);
	const active = Themes.resolveTheme(appearance.theme, map);
	let font = Config.fontFromSettings(appearance, active);
	let activeThemeId = appearance.theme;
	// The font family is written ONCE per change: the browser fires `change`
	// on Enter, and the dialog's own Enter handler persists the same value
	// again. The guard below makes the second write a no-op.
	let familySaved = font.family || "";
	let familyPending = null;

	const familyIndex = themes.length;
	const sizeIndex = themes.length + 1;
	const lineIndex = themes.length + 2;
	const resetIndex = themes.length + 3;
	let item = 0;

	// The tier the changes are written to (the Config section owns the
	// selector) — the section header has to say where a write lands.
	const scope = state.configScope === "global" ? "global" : "project";
	const scopeLabel = scope === "global" ? "Global" : "Project";
	const scopePath = () => {
		const dir = scope === "global" ? (cfg && cfg.paths || {}).globalConfigDir : (cfg && cfg.paths || {}).projectConfigDir;
		if (!dir) return "(unknown path)";
		const sep = dir.includes("\\") ? "\\" : "/";
		return `${dir.replace(/[\\/]+$/, "")}${sep}appearance.settings.json`;
	};

	const scopeHead = document.createElement("div");
	scopeHead.className = "dline head";
	scopeHead.textContent = `── Appearance (${scopeLabel} tier) ──`;
	host.appendChild(scopeHead);

	const scopeNote = document.createElement("div");
	scopeNote.className = "dline dim settings-note";
	scopeNote.textContent = scope === "global"
		? `Changes are written to ${scopePath()} — the global tier applies to every project.`
		: `Changes are written to ${scopePath()} — the project tier is a file in the repository, so it travels with the project.`;
	host.appendChild(scopeNote);

	const themeHead = document.createElement("div");
	themeHead.className = "dline head";
	themeHead.textContent = "── Theme ──";
	host.appendChild(themeHead);

	const themeRows = themes.map((theme, i) => {
		const resolved = Themes.resolveTheme(theme.id, map);
		const row = document.createElement("div");
		row.className = "listrow theme-row";
		const name = document.createElement("span");
		name.className = "tname";
		name.textContent = resolved.name;
		const desc = document.createElement("span");
		desc.className = "tsub";
		desc.textContent = resolved.description || "";
		const swatches = document.createElement("span");
		swatches.className = "theme-swatches";
		for (const paletteName of Themes.PALETTE_NAMES) {
			const swatch = document.createElement("span");
			swatch.className = "theme-swatch";
			swatch.style.backgroundColor = resolved.palette[paletteName];
			swatch.title = paletteName;
			swatches.appendChild(swatch);
		}
		row.appendChild(name);
		row.appendChild(desc);
		row.appendChild(swatches);
		row.addEventListener("click", () => { item = i; mark(); void applyTheme(theme); });
		host.appendChild(row);
		return row;
	});

	const fontHead = document.createElement("div");
	fontHead.className = "dline head";
	fontHead.textContent = "── Font ──";
	host.appendChild(fontHead);

	// The font family.
	const familyRow = document.createElement("div");
	familyRow.className = "dlg-field";
	const familyLabel = document.createElement("span");
	familyLabel.className = "flabel";
	familyLabel.textContent = "Font family";
	familyRow.appendChild(familyLabel);
	const familyValue = document.createElement("span");
	familyValue.className = "fvalue";
	const familyInput = document.createElement("input");
	familyInput.className = "dlg-input";
	familyInput.type = "text";
	familyInput.value = font.family || "";
	familyValue.appendChild(familyInput);
	familyRow.appendChild(familyValue);
	familyRow.addEventListener("click", () => { item = familyIndex; mark(); familyInput.focus(); });
	host.appendChild(familyRow);

	// The family that was in effect before the current edit. The family is
	// applied live, so by the time the write runs the new family is already
	// the live one — the value to restore when the write fails has to be
	// captured here, before the live apply.
	let familyBefore = null;

	familyInput.addEventListener("input", () => {
		if (familyBefore === null) familyBefore = font.family;
		font = { ...font, family: familyInput.value };
		Config.applyFont(font);
		Config.invalidateMetrics();
		markDirty();
	});
	familyInput.addEventListener("change", () => {
		void persistFamily(familyInput.value);
	});

	// The font size.
	const sizeRow = document.createElement("div");
	sizeRow.className = "dlg-field";
	const sizeLabel = document.createElement("span");
	sizeLabel.className = "flabel";
	sizeLabel.textContent = "Font size";
	sizeRow.appendChild(sizeLabel);
	const sizeValue = document.createElement("span");
	sizeValue.className = "fvalue stepper";
	const sizeText = document.createElement("span");
	sizeText.className = "sval";
	sizeText.textContent = String(font.size || "");
	const sizeDown = document.createElement("span");
	sizeDown.className = "sbtn";
	sizeDown.textContent = "◄";
	const sizeUp = document.createElement("span");
	sizeUp.className = "sbtn";
	sizeUp.textContent = "►";
	sizeValue.appendChild(sizeText);
	sizeValue.appendChild(sizeDown);
	sizeValue.appendChild(sizeUp);
	sizeRow.appendChild(sizeValue);
	sizeRow.addEventListener("click", (e) => {
		item = sizeIndex;
		mark();
		if (e.target === sizeDown) changeSize(-1);
		else if (e.target === sizeUp) changeSize(1);
	});
	host.appendChild(sizeRow);

	// The line height.
	const lineRow = document.createElement("div");
	lineRow.className = "dlg-field";
	const lineLabel = document.createElement("span");
	lineLabel.className = "flabel";
	lineLabel.textContent = "Line height";
	lineRow.appendChild(lineLabel);
	const lineValue = document.createElement("span");
	lineValue.className = "fvalue stepper";
	const lineText = document.createElement("span");
	lineText.className = "sval";
	lineText.textContent = Number(font.lineHeight ?? 1.25).toFixed(2);
	const lineDown = document.createElement("span");
	lineDown.className = "sbtn";
	lineDown.textContent = "◄";
	const lineUp = document.createElement("span");
	lineUp.className = "sbtn";
	lineUp.textContent = "►";
	lineValue.appendChild(lineText);
	lineValue.appendChild(lineDown);
	lineValue.appendChild(lineUp);
	lineRow.appendChild(lineValue);
	lineRow.addEventListener("click", (e) => {
		item = lineIndex;
		mark();
		if (e.target === lineDown) changeLineHeight(-1);
		else if (e.target === lineUp) changeLineHeight(1);
	});
	host.appendChild(lineRow);

	const note = document.createElement("div");
	note.className = "dline dim settings-note";
	note.textContent = "Changes apply live.";
	host.appendChild(note);

	const buttonRow = document.createElement("div");
	buttonRow.className = "settings-buttons";
	const resetButton = document.createElement("div");
	resetButton.className = "dlg-btn";
	resetButton.textContent = "  Reset appearance to defaults  ";
	resetButton.addEventListener("click", () => { item = resetIndex; mark(); void resetAppearance(); });
	buttonRow.appendChild(resetButton);
	host.appendChild(buttonRow);

	const mark = () => {
		themeRows.forEach((row, i) => {
			row.classList.toggle("sel", i === item);
			row.classList.toggle("active", themes[i].id === activeThemeId);
		});
		familyRow.classList.toggle("focused", item === familyIndex);
		sizeRow.classList.toggle("focused", item === sizeIndex);
		lineRow.classList.toggle("focused", item === lineIndex);
		resetButton.classList.toggle("focused", item === resetIndex);
	};

	const applyTheme = async (theme) => {
		const resolved = Themes.resolveTheme(theme.id, map);
		const before = appliedTheme ? { ...appliedTheme } : null;
		const nextFont = Config.fontFromSettings(appearance, resolved);
		Themes.applyTheme(resolved, nextFont);
		Config.invalidateMetrics();
		appliedTheme = resolved;
		activeThemeId = resolved.id;
		markDirty();
		const ok = await writeConfig(state.configScope, "appearance", { theme: resolved.id });
		if (ok) { flashLocal(`Theme: ${resolved.id}`); refresh(); return; }
		// A failed write must not change the applied state.
		if (before) {
			Themes.applyTheme(before, Config.fontFromSettings(appearance, before));
			Config.invalidateMetrics();
			appliedTheme = before;
			activeThemeId = before.id;
			markDirty();
		}
	};

	/** Put the font back the way it was (a failed write changes nothing). */
	const restoreFont = (previous) => {
		font = { ...previous };
		Config.applyFont(font);
		Config.invalidateMetrics();
		sizeText.textContent = String(font.size || "");
		lineText.textContent = Number(font.lineHeight ?? 1.25).toFixed(2);
		if (familyInput.value !== (font.family || "")) familyInput.value = font.family || "";
		markDirty();
	};

	/**
	 * Persist the font family — once per change.
	 *
	 * The browser fires `change` on Enter, and the dialog's Enter handler
	 * persists the same value as well. A write that is already running is
	 * reused, and a value that is already on disk is not written at all, so
	 * the family is written exactly once.
	 *
	 * @param {string} family
	 * @returns {Promise<boolean>} true when the family is (or already was) saved
	 */
	const persistFamily = (family) => {
		if (family === familySaved) { familyBefore = null; return familyPending || Promise.resolve(true); }
		if (familyPending) return familyPending;
		// The family is applied live, so `font` already holds the NEW family:
		// the value that has to be restored when the write fails is the one
		// that was in effect before the change.
		const restore = familyBefore !== null ? familyBefore : familySaved;
		familyPending = (async () => {
			const ok = await persistAppearance({ font: { family } });
			// A failed write must not change the applied state.
			if (!ok) { restoreFont({ ...font, family: restore }); familyBefore = null; return false; }
			familySaved = family;
			familyBefore = null;
			return true;
		})();
		return familyPending.finally(() => { familyPending = null; });
	};

	const changeSize = (delta) => {
		const before = { ...font };
		const size = Math.max(10, Math.min(32, Config.parseFontSize(font.size) + delta));
		font = { ...font, size: `${size}px` };
		sizeText.textContent = font.size;
		Config.applyFont(font);
		Config.invalidateMetrics();
		markDirty();
		void (async () => {
			const ok = await persistAppearance({ font: { size: font.size } });
			if (!ok) restoreFont(before);
		})();
	};

	const changeLineHeight = (delta) => {
		const before = { ...font };
		const line = Math.max(1, Math.min(2, Math.round(((font.lineHeight ?? 1.25) + delta * 0.05) * 100) / 100));
		font = { ...font, lineHeight: line };
		lineText.textContent = line.toFixed(2);
		Config.applyFont(font);
		Config.invalidateMetrics();
		markDirty();
		void (async () => {
			const ok = await persistAppearance({ font: { lineHeight: line } });
			if (!ok) restoreFont(before);
		})();
	};

	const resetAppearance = async () => {
		const ok = await writeConfig(state.configScope, "appearance", { theme: "dos", font: { ...Themes.DEFAULT_FONT } }, true);
		if (!ok) return;
		familySaved = Themes.DEFAULT_FONT.family || "";
		familyBefore = null;
		flashLocal("Appearance reset to defaults");
		refresh();
	};

	const activate = () => {
		if (item < themes.length) { void applyTheme(themes[item]); return; }
		if (item === familyIndex) { void persistFamily(familyInput.value); return; }
		if (item === sizeIndex) { changeSize(1); return; }
		if (item === lineIndex) { changeLineHeight(1); return; }
		if (item === resetIndex) { void resetAppearance(); }
	};

	const focusItem = () => {
		if (item === familyIndex) { familyInput.focus(); familyInput.select(); }
		else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
	};

	mark();

	return {
		focus: () => focusItem(),
		key: (e) => {
			if (e.key === "ArrowDown") { item = Math.min(resetIndex, item + 1); mark(); focusItem(); return true; }
			if (e.key === "ArrowUp") { item = Math.max(0, item - 1); mark(); focusItem(); return true; }
			if (e.key === "ArrowRight" && item === sizeIndex) { changeSize(1); return true; }
			if (e.key === "ArrowLeft" && item === sizeIndex) { changeSize(-1); return true; }
			if (e.key === "ArrowRight" && item === lineIndex) { changeLineHeight(1); return true; }
			if (e.key === "ArrowLeft" && item === lineIndex) { changeLineHeight(-1); return true; }
			if (e.key === "Enter") { activate(); return true; }
			return false;
		},
	};
}

/**
 * The origin of a binding, as the shortcuts editor labels it: "RAYCAST" for
 * the chords Raycast documents, "EXISTING" for the ones the app already had
 * and "LUUNA" for the ones LUUNA invented.
 */
const ORIGIN_LABELS = {
	raycast: "RAYCAST",
	existing: "EXISTING",
	luuna: "LUUNA",
};

/**
 * The Keybindings section: a search field over the action registry, the
 * actions grouped by category, and the recorder.
 *
 * `Enter` starts the recording, the next key is captured by the overlay's own
 * `onKey` (so it never reaches the global handler) and saved after ~1.5
 * seconds — or immediately with `Enter`. `Backspace` clears the binding,
 * `Delete` restores the default and a chord that belongs to another action is
 * refused.
 *
 * The section also says where the changes are written (the tier the Config
 * section selected), shows the origin of every binding and lists the three
 * deviations from Raycast of §C.5.
 */
function keybindingsSection(host, refresh) {
	const cfg = Config.currentConfig();
	const paths = (cfg && cfg.paths) || {};

	/** The tier the changes are written to ("global" | "project"). */
	const scope = state.configScope === "global" ? "global" : "project";
	const scopeLabel = scope === "global" ? "Global" : "Project";

	/** The file a write of this section lands in. */
	const scopeFile = () => {
		const dir = scope === "global" ? paths.globalConfigDir : paths.projectConfigDir;
		if (!dir) return "(unknown path)";
		const sep = dir.includes("\\") ? "\\" : "/";
		return `${dir.replace(/[\\/]+$/, "")}${sep}keybindings.settings.json`;
	};

	const scopeHead = document.createElement("div");
	scopeHead.className = "dline head";
	scopeHead.textContent = `── Keybindings (${scopeLabel} tier) ──`;
	host.appendChild(scopeHead);

	const scopeNote = document.createElement("div");
	scopeNote.className = "dline dim settings-note";
	scopeNote.textContent = scope === "global"
		? `Changes are written to ${scopeFile()} — the global tier applies to every project.`
		: `Changes are written to ${scopeFile()} — the project tier is a file in the repository, so it travels with the project.`;
	host.appendChild(scopeNote);

	// The app-settings defaults that took a chord away from another action.
	// The registry keeps exactly one owner per chord per scope, so a
	// configured send key of "Escape" takes the chord away from "Cancel / stop
	// generation" — the user has to learn about it, or the action would
	// simply show "(unbound)".
	const collisions = Keymap.defaultCollisions();
	if (collisions.length) {
		const warn = document.createElement("div");
		warn.className = "dline k";
		warn.textContent = `The app settings take a chord away: ${collisions
			.map((c) => `${c.ownerLabel} takes ${c.chord} away from ${c.label}`)
			.join("; ")}.`;
		host.appendChild(warn);
	}

	// The three deviations from Raycast (§C.5). The chords are interpolated
	// from the keymap, so a rebinding cannot make a note wrong.
	const deviations = document.createElement("div");
	deviations.className = "kb-notes";
	for (const text of [
		`Find in the tree is ${chordSetText("search.findFile")}, find in the agent output is ${chordSetText("agent.findInChat")} — off macOS the two cannot share the F key.`,
		`${chordSetText("view.zoomReset")} resets the font size and ${chordSetText("session.jump1")}…${chordSetText("session.jump9")} jump to the recent sessions — Raycast uses Cmd+0 for both.`,
		"The Alt+letter menu accelerators are not rebindable.",
	]) {
		const line = document.createElement("div");
		line.className = "dline dim";
		line.textContent = text;
		deviations.appendChild(line);
	}
	host.appendChild(deviations);

	const search = document.createElement("input");
	search.className = "dlg-input kb-search";
	search.type = "text";
	search.placeholder = "Search actions…";
	search.setAttribute("aria-label", "Search actions");
	host.appendChild(search);

	const list = document.createElement("div");
	list.className = "kb-list";
	host.appendChild(list);

	const message = document.createElement("div");
	message.className = "dline dim kb-msg";
	host.appendChild(message);

	let rows = [];
	let index = 0;
	let recording = null;
	let timer = null;
	// The groups the user opened (the nine recent-session jumps collapse into
	// one row, §C.3).
	const expanded = new Set();

	const setMessage = (text) => { message.textContent = text || ""; };

	const chordText = (action) => chordSetText(action.id) || "(unbound)";

	/** Every action of a group — the group row shows all of their chords. */
	const groupMembers = (group) => Keymap.ACTIONS.filter((a) => a.group === group);

	const groupChordText = (group) => {
		const labels = [];
		for (const member of groupMembers(group)) {
			for (const label of chordSetLabels(Keymap.chordsFor(member.id))) {
				if (!labels.includes(label)) labels.push(label);
			}
		}
		return labels.length ? labels.join(" / ") : "(unbound)";
	};

	/** The origin tag of a row. */
	const originTag = (origin) => {
		const tag = document.createElement("span");
		tag.className = "korigin";
		tag.textContent = ORIGIN_LABELS[origin] || "";
		return tag;
	};

	const emitActionRow = (action) => {
		const row = document.createElement("div");
		row.className = "listrow kb-row";
		row.dataset.i = String(rows.length);
		const label = document.createElement("span");
		label.className = "klabel";
		label.textContent = action.label;
		const chord = document.createElement("span");
		chord.className = "sc kb-chord";
		row.appendChild(label);
		row.appendChild(originTag(action.origin));
		row.appendChild(chord);
		row.addEventListener("click", () => { index = Number(row.dataset.i); mark(); });
		list.appendChild(row);
		const entry = { kind: "action", action, el: row, chordEl: chord };
		rows.push(entry);
		return entry;
	};

	const emitGroupRow = (group, members) => {
		const row = document.createElement("div");
		row.className = "listrow kb-row kb-grouprow";
		row.dataset.i = String(rows.length);
		const label = document.createElement("span");
		label.className = "klabel";
		label.textContent = group;
		const chord = document.createElement("span");
		chord.className = "sc kb-chord";
		row.appendChild(label);
		row.appendChild(originTag(members.length ? members[0].action.origin : "luuna"));
		row.appendChild(chord);
		row.addEventListener("click", () => { index = Number(row.dataset.i); mark(); });
		list.appendChild(row);
		const entry = { kind: "group", group, members: members.map((m) => m.action), el: row, chordEl: chord };
		rows.push(entry);
		return entry;
	};

	const render = () => {
		const query = search.value.trim();
		const matched = [];
		for (const action of Keymap.ACTIONS) {
			const score = subsequenceScore(action.label, query);
			if (score === null) continue;
			matched.push({ action, score });
		}
		list.textContent = "";
		rows = [];
		for (const category of registryCategories()) {
			const inCategory = matched.filter((entry) => entry.action.category === category);
			if (!inCategory.length) continue;
			const head = document.createElement("div");
			head.className = "kb-group";
			head.textContent = category;
			list.appendChild(head);
			const seenGroups = new Set();
			for (const entry of inCategory) {
				const group = entry.action.group;
				if (!group) { emitActionRow(entry.action); continue; }
				if (seenGroups.has(group)) continue;
				seenGroups.add(group);
				// The group collapses into ONE row that shows all of its
				// chords; the individual actions are listed when the group is
				// expanded, and each of them is still rebindable on its own.
				const members = inCategory.filter((e) => e.action.group === group);
				emitGroupRow(group, members);
				if (expanded.has(group)) {
					for (const member of members) emitActionRow(member.action);
				}
			}
		}
		if (index >= rows.length) index = Math.max(0, rows.length - 1);
		mark();
	};

	const mark = () => {
		rows.forEach((row, i) => {
			row.el.classList.toggle("sel", i === index);
			const isRecording = !!recording && row.kind === "action" && recording.actionId === row.action.id;
			row.el.classList.toggle("recording", isRecording);
			if (row.kind === "group") row.el.classList.toggle("expanded", expanded.has(row.group));
			if (isRecording) row.chordEl.textContent = recordingLabel();
			else if (row.kind === "group") row.chordEl.textContent = groupChordText(row.group);
			else row.chordEl.textContent = chordText(row.action);
		});
		const sel = rows[index];
		if (sel) sel.el.scrollIntoView({ block: "nearest" });
	};

	const recordingLabel = () => (recording && recording.chord
		? `${chordLabel(recording.chord)} (${Math.max(0, (recording.deadline - Date.now()) / 1000).toFixed(1)}s)`
		: "Press a key…");

	const tick = () => {
		if (!recording) return;
		const row = rows.find((r) => r.kind === "action" && r.action.id === recording.actionId);
		if (row) row.chordEl.textContent = recordingLabel();
		if (recording.chord && Date.now() >= recording.deadline) saveBinding(recording.chord);
	};

	const stopRecording = () => {
		if (timer) { clearInterval(timer); timer = null; }
		recording = null;
		search.focus();
	};

	const startRecording = () => {
		const row = rows[index];
		if (!row || row.kind !== "action") return;
		stopRecording();
		search.blur();
		recording = { actionId: row.action.id, chord: null, deadline: 0 };
		timer = setInterval(tick, 100);
		mark();
		setMessage(`Recording "${row.action.label}" — press a key, Enter saves, Esc cancels.`);
	};

	/** The actions the selected row stands for (a group row has nine). */
	const selectedActions = () => {
		const row = rows[index];
		if (!row) return [];
		return row.kind === "group" ? row.members : [row.action];
	};

	/** Does the OTHER tier bind this action already? */
	const otherTierOwns = (actionId) => {
		const tiers = (Config.currentConfig() || {}).tiers;
		if (!tiers) return false;
		const other = scope === "global" ? tiers.project : tiers.global;
		const bindings = (other && other.keybindings) || {};
		return Object.prototype.hasOwnProperty.call(bindings, actionId);
	};

	/**
	 * The keybindings of the tier this section writes to — the content of the
	 * tier's own `keybindings.settings.json`.
	 *
	 * A merge can never REMOVE a key, so "reset to default" has to replace the
	 * file; the tier's own content is what the replacement is built from.
	 */
	const tierBindings = () => {
		const tiers = (Config.currentConfig() || {}).tiers;
		if (!tiers) return null;
		const tier = tiers[scope];
		if (!tier || !tier.keybindings) return null;
		return tier.keybindings;
	};

	/**
	 * The message of a successful write. When the other tier binds the same
	 * action, the message has to say so: the project tier wins per key, so a
	 * write to the global tier can be shadowed by the project tier.
	 */
	const savedMessage = (actionId, text) => {
		const action = Keymap.actionById(actionId);
		const label = action ? action.label : actionId;
		const head = `${label} → ${text}`;
		if (!otherTierOwns(actionId)) return `${head} (${scopeLabel} tier)`;
		return scope === "global"
			? `${head} (saved to the global tier, but the project tier binds this action too — the project tier wins, so the binding in effect is unchanged)`
			: `${head} (saved to the project tier; the global tier binds this action too — the project tier wins)`;
	};

	const saveBinding = (chord) => {
		const actionId = recording ? recording.actionId : null;
		stopRecording();
		if (!actionId) return;
		const action = Keymap.actionById(actionId);
		// The chord has to be usable BEFORE it is written: a bare letter can
		// never fire for a global or a composer action, and a chord another
		// action owns (in the same scope) would be a conflict.
		const check = Keymap.validateBinding(actionId, chord);
		if (!check.ok) {
			let text = "";
			if (check.reason === "bare") {
				text = `"${chordLabel(chord)}" cannot be bound to ${action ? action.label : actionId}: a single key without a modifier is only active outside the composer, so it would never fire.`;
			} else if (check.reason === "conflict") {
				const other = Keymap.actionById(check.conflict.actionId);
				text = `"${chordLabel(chord)}" is already bound to ${other ? other.label : check.conflict.actionId}.`;
			} else {
				text = `"${chordLabel(chord)}" is not a valid chord.`;
			}
			setMessage(text);
			flashLocal(text);
			mark();
			return;
		}
		const before = Keymap.currentOverrides();
		const overrides = { ...before };
		overrides[actionId] = [chord];
		Keymap.applyOverrides(overrides);
		markDirty();
		mark();
		void (async () => {
			const ok = await writeConfig(state.configScope, "keybindings", { [actionId]: [chord] });
			// A failed write must not change the applied state.
			if (!ok) {
				Keymap.applyOverrides(before);
				markDirty();
				setMessage("The binding was not saved — the write failed.");
				mark();
				return;
			}
			setMessage(savedMessage(actionId, chordLabel(chord)));
			mark();
		})();
	};

	const clearBinding = () => {
		const actions = selectedActions();
		if (!actions.length) return;
		const before = Keymap.currentOverrides();
		const overrides = { ...before };
		const patch = {};
		for (const action of actions) { overrides[action.id] = []; patch[action.id] = []; }
		Keymap.applyOverrides(overrides);
		markDirty();
		setMessage(`${actions.length > 1 ? `${actions.length} actions` : actions[0].label} — (unbound)`);
		mark();
		void (async () => {
			const ok = await writeConfig(state.configScope, "keybindings", patch);
			// A failed write must not change the applied state.
			if (!ok) { Keymap.applyOverrides(before); markDirty(); }
			mark();
		})();
	};

	/**
	 * Reset the selected action(s) to their EFFECTIVE default.
	 *
	 * The effective default is the app-settings value when there is one (the
	 * configured send key, say) and the registry chord otherwise. It is
	 * restored by REMOVING the explicit override: writing the registry chord
	 * as an override would shadow the app tier, and the configured value could
	 * never be restored from the UI again.
	 *
	 * A merge can never remove a key, so the tier's own keybindings file is
	 * replaced by the same content without the reset actions.
	 */
	const resetToDefault = () => {
		const actions = selectedActions();
		if (!actions.length) return;
		const before = Keymap.currentOverrides();
		const overrides = { ...before };
		const labels = [];
		const fromApp = [];
		for (const action of actions) {
			delete overrides[action.id];
			const def = Keymap.effectiveDefaultFor(action.id);
			for (const label of chordSetLabels(def.chords)) if (!labels.includes(label)) labels.push(label);
			if (def.source === "app") fromApp.push(action.label);
		}
		Keymap.applyOverrides(overrides);
		markDirty();

		const names = actions.length > 1 ? `${actions.length} actions` : actions[0].label;
		const target = labels.length ? labels.join(" / ") : "(unbound)";
		let text = `${names} → ${target}`;
		if (fromApp.length) text += fromApp.length === 1
			? " (the app-settings default is in effect again)"
			: " (the app-settings defaults are in effect again)";
		const shadowed = actions.filter((a) => otherTierOwns(a.id));
		if (shadowed.length) {
			text += scope === "global"
				? " — the project tier binds this action too, and the project tier wins, so the binding in effect is unchanged"
				: " — the global tier binds this action too, so the global tier's binding is in effect";
		}
		setMessage(text);
		mark();

		// The tier's own file, without the reset actions. Without the tier view
		// the file cannot be rewritten safely, so the effective default is
		// written as an explicit override instead (it is the same binding —
		// the only difference is that a later change of the app tier would no
		// longer reach this action, which is the price of a missing tier).
		const tier = tierBindings();
		let value;
		let replace = false;
		if (tier) {
			value = { ...tier };
			for (const action of actions) delete value[action.id];
			replace = true;
		} else {
			value = {};
			for (const action of actions) {
				const chords = Keymap.effectiveDefaultFor(action.id).chords;
				// An empty list would mean "unbound", not "the default".
				if (chords.length) value[action.id] = chords;
			}
		}
		void (async () => {
			const ok = await writeConfig(state.configScope, "keybindings", value, replace);
			// A failed write must not change the applied state.
			if (!ok) {
				Keymap.applyOverrides(before);
				markDirty();
				setMessage("The default was not restored — the write failed.");
			}
			mark();
		})();
	};

	/** Open or close a group row. */
	const toggleGroup = (group) => {
		if (expanded.has(group)) expanded.delete(group);
		else expanded.add(group);
		render();
	};

	const move = (delta) => {
		if (!rows.length) return;
		index = (index + delta + rows.length) % rows.length;
		mark();
	};

	list.addEventListener("dblclick", (e) => {
		const rowEl = e.target.closest(".kb-row");
		if (!rowEl) return;
		index = Number(rowEl.dataset.i);
		mark();
		const row = rows[index];
		if (row && row.kind === "group") { toggleGroup(row.group); return; }
		startRecording();
	});
	search.addEventListener("input", () => { index = 0; render(); });

	render();
	setTimeout(() => { search.focus(); }, 30);

	return {
		focus: () => { search.focus(); },
		dispose: () => { if (timer) { clearInterval(timer); timer = null; } },
		escape: () => {
			// Escape cancels a recording; otherwise it belongs to the dialog.
			if (!recording) return false;
			stopRecording();
			mark();
			setMessage("Recording cancelled.");
			return true;
		},
		key: (e) => {
			if (recording) {
				if (e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey) { stopRecording(); mark(); setMessage("Recording cancelled."); return true; }
				// A BARE `Enter` commits the recording — it is the recorder's own
				// key, so a plain `Enter` can never be captured. A chord that
				// ENDS in Enter (`Ctrl+Enter`, `Shift+Enter`) is a chord like
				// any other and is recorded normally.
				if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
					if (recording.chord) saveBinding(recording.chord);
					else {
						stopRecording();
						mark();
						setMessage("A plain Enter is the recorder's own key and cannot be captured — record a chord such as Ctrl+Enter, or write \"Enter\" into the keybindings file.");
					}
					return true;
				}
				const chord = chordFromEvent(e);
				if (!chord) return true; // a bare modifier — swallow it
				recording.chord = chord;
				recording.deadline = Date.now() + 1500;
				tick();
				return true;
			}
			if (e.key === "ArrowDown") { move(1); return true; }
			if (e.key === "ArrowUp") { move(-1); return true; }
			if (e.key === "PageDown") { move(8); return true; }
			if (e.key === "PageUp") { move(-8); return true; }
			if (e.key === "Home") { index = 0; mark(); return true; }
			if (e.key === "End") { index = Math.max(0, rows.length - 1); mark(); return true; }
			if (e.key === "Enter") {
				const row = rows[index];
				if (row && row.kind === "group") { toggleGroup(row.group); return true; }
				startRecording();
				return true;
			}
			if (e.key === "Delete") {
				// The search field keeps its own Delete while it holds text —
				// the same guard the Backspace branch has. The guard is on the
				// CONTENT of the field, not on the focus: the user types a
				// query, clicks a row (which blurs the field but keeps the
				// text) and presses Delete — that must not reset a binding.
				if (search.value) return false;
				resetToDefault();
				return true;
			}
			if (e.key === "Backspace") {
				// The search field keeps its own Backspace while it holds text.
				if (search.value) return false;
				clearBinding();
				return true;
			}
			return false;
		},
	};
}

/**
 * The Config section: the paths of both tiers, the scope selector that
 * decides where the changes are written, the folder buttons, a reload and a
 * reset — and the errors the backend reports for a malformed file.
 */
function configSection(host, refresh) {
	const cfg = Config.currentConfig();
	// The cached configuration already carries the paths; the live ones are
	// fetched from the backend below, so a directory that changed since the
	// last reload is still shown correctly.
	const paths = { ...((cfg && cfg.paths) || {}) };
	const errors = (cfg && cfg.errors) || [];

	/** The value element of every path row, so they can be updated in place. */
	const pathCells = new Map();

	const pathRow = (label, key) => {
		const row = document.createElement("div");
		row.className = "dlg-field";
		const name = document.createElement("span");
		name.className = "flabel";
		name.textContent = label;
		const value = document.createElement("span");
		value.className = "fvalue settings-path";
		value.textContent = paths[key] || "(unknown)";
		row.appendChild(name);
		row.appendChild(value);
		host.appendChild(row);
		pathCells.set(key, value);
	};

	const globalHead = document.createElement("div");
	globalHead.className = "dline head";
	globalHead.textContent = "── Global ──";
	host.appendChild(globalHead);
	pathRow("Directory", "globalDir");
	pathRow("Config", "globalConfigDir");
	pathRow("Themes", "globalThemesDir");

	const projectHead = document.createElement("div");
	projectHead.className = "dline head";
	projectHead.textContent = "── Project ──";
	host.appendChild(projectHead);
	pathRow("Directory", "projectDir");
	pathRow("Config", "projectConfigDir");
	pathRow("Themes", "projectThemesDir");

	// The live paths come from the backend — the cached ones are only the
	// first paint, until the call comes back.
	void (async () => {
		try {
			const res = await luuna.configPaths();
			const live = res && res.success === false ? null : (res && res.data) || res;
			if (!live || typeof live !== "object") return;
			for (const [key, cell] of pathCells) {
				if (typeof live[key] !== "string" || !live[key]) continue;
				paths[key] = live[key];
				cell.textContent = live[key];
			}
		} catch (err) { /* the cached paths stay on screen */ }
	})();

	const scopeHead = document.createElement("div");
	scopeHead.className = "dline head";
	scopeHead.textContent = "── Scope ──";
	host.appendChild(scopeHead);

	const scopeRow = document.createElement("div");
	scopeRow.className = "dlg-field";
	const scopeLabel = document.createElement("span");
	scopeLabel.className = "flabel";
	scopeLabel.textContent = "Write changes to";
	scopeRow.appendChild(scopeLabel);
	const scopeValue = document.createElement("span");
	scopeValue.className = "fvalue stepper";
	const scopeText = document.createElement("span");
	scopeText.className = "sval";
	scopeText.textContent = state.configScope === "global" ? "Global" : "Project";
	const scopeDown = document.createElement("span");
	scopeDown.className = "sbtn";
	scopeDown.textContent = "◄";
	const scopeUp = document.createElement("span");
	scopeUp.className = "sbtn";
	scopeUp.textContent = "►";
	scopeValue.appendChild(scopeText);
	scopeValue.appendChild(scopeDown);
	scopeValue.appendChild(scopeUp);
	scopeRow.appendChild(scopeValue);
	host.appendChild(scopeRow);

	const scopeNote = document.createElement("div");
	scopeNote.className = "dline dim settings-note";
	scopeNote.textContent = "The project tier wins over the global tier, key by key.";
	host.appendChild(scopeNote);

	const buttonRow = document.createElement("div");
	buttonRow.className = "settings-buttons";
	const makeButton = (label, onClick) => {
		const button = document.createElement("div");
		button.className = "dlg-btn";
		button.textContent = label;
		button.addEventListener("click", onClick);
		buttonRow.appendChild(button);
		return button;
	};
	const openGlobal = makeButton("  Open global folder  ", () => openConfigFolder(paths.globalDir));
	const openProject = makeButton("  Open project folder  ", () => openConfigFolder(paths.projectDir));
	const reload = makeButton("  Reload configuration  ", () => void reloadConfiguration());
	const resetAll = makeButton("  Reset all to defaults  ", () => void resetEverything());
	host.appendChild(buttonRow);

	if (errors.length) {
		const errorHead = document.createElement("div");
		errorHead.className = "dline head";
		errorHead.textContent = "── Errors ──";
		host.appendChild(errorHead);
		for (const error of errors) {
			const line = document.createElement("div");
			line.className = "dline settings-errors";
			line.textContent = String(error);
			host.appendChild(line);
		}
	}

	const setScope = (scope) => {
		state.configScope = scope === "global" ? "global" : "project";
		scopeText.textContent = state.configScope === "global" ? "Global" : "Project";
		mark();
	};

	const openConfigFolder = (path) => {
		if (!path) { flashLocal("The configuration path is unknown"); return; }
		void luuna.openFolder(path);
	};

	const reloadConfiguration = async () => {
		await applyConfiguration();
		flashLocal("Configuration reloaded");
		refresh();
	};

	const resetEverything = async () => {
		const scope = state.configScope;
		// The three writes, then ONE reload: a reload per write would re-read
		// both tiers' settings files and re-scan both theme directories three
		// times over.
		let ok = await writeConfigRaw(scope, "keybindings", {}, true);
		if (ok) ok = await writeConfigRaw(scope, "appearance", { theme: "dos", font: { ...Themes.DEFAULT_FONT } }, true);
		if (ok) ok = await writeConfigRaw(scope, "app", {}, true);
		if (!ok) return;
		await applyConfiguration();
		flashLocal(`The ${scope} configuration is back to the defaults`);
		refresh();
	};

	const actions = [
		() => setScope(state.configScope === "global" ? "project" : "global"),
		() => openConfigFolder(paths.globalDir),
		() => openConfigFolder(paths.projectDir),
		() => void reloadConfiguration(),
		() => void resetEverything(),
	];
	let item = 0;

	const mark = () => {
		scopeRow.classList.toggle("focused", item === 0);
		openGlobal.classList.toggle("focused", item === 1);
		openProject.classList.toggle("focused", item === 2);
		reload.classList.toggle("focused", item === 3);
		resetAll.classList.toggle("focused", item === 4);
	};
	mark();

	return {
		focus: () => {},
		key: (e) => {
			if (e.key === "ArrowDown") { item = (item + 1) % actions.length; mark(); return true; }
			if (e.key === "ArrowUp") { item = (item + actions.length - 1) % actions.length; mark(); return true; }
			if (e.key === "Enter") { actions[item](); return true; }
			return false;
		},
	};
}

// --- the composer popups ----------------------------------------------------

/**
 * The slash commands the app understands — read from the handler itself, so
 * the list can never drift away from the implementation.
 */
const SLASH_COMMANDS = (() => {
	const fallback = ["/status", "/help", "/clear", "/compact", "/model", "/effort", "/plan",
		"/build", "/mode", "/diff", "/test", "/run", "/save", "/sessions", "/resume", "/open",
		"/new", "/fork", "/tree", "/export", "/exit"];
	try {
		const found = [];
		const re = /case\s+"(\/[^"]+)"/g;
		const source = String(handleSlashCommand);
		let match;
		while ((match = re.exec(source)) !== null) found.push(match[1]);
		if (found.length) return [...new Set(found)];
	} catch (err) { /* the fallback list is good enough */ }
	return fallback;
})();

/** The files of the project tree, as relative paths. */
function projectFiles() {
	const out = [];
	const walk = (nodes, prefix) => {
		for (const node of nodes || []) {
			const rel = node.relPath || (prefix ? `${prefix}/${node.name}` : node.name);
			if (node.isDir) walk(node.children, rel);
			else out.push(rel);
		}
	};
	walk(state.tree, "");
	return out;
}

/**
 * A small popup above the composer. The item that is chosen is INSERTED into
 * the composer — it is never sent.
 *
 * `typed` tells the two cases apart: when the popup was opened by the typed
 * trigger character, that character stays in the composer and the text typed
 * after it is replaced by the chosen item. When the popup was opened by a
 * chord, there is no trigger character and the item replaces the filter
 * region — the text that was typed after the popup opened.
 */
function openComposerMenu({ title, items, prefix, typed }) {
	// Only one popup at a time — the previous one has to release its listener.
	if (state.overlay) closeOverlay();
	const { dlg, body, buttons } = buildDialog({ title, bodyClass: "composer-body", width: "min(560px, 80vw)" });
	dlg.classList.add("composer-popup");
	const list = document.createElement("div");
	list.className = "cm-list";
	body.appendChild(list);
	let shown = items;
	let index = 0;
	// Where the text the filter applies to begins. A typed popup filters on
	// what follows the trigger character; a chord-opened one filters on what
	// the user types after the popup opened. When the composer did not have the
	// focus, the item goes to the end of the text.
	const openCaret = (document.activeElement === inputArea)
		? (inputArea.selectionStart ?? inputArea.value.length)
		: inputArea.value.length;
	const filterStart = typed ? prefix.length : openCaret;

	/** The text the filter applies to. */
	const query = () => {
		const value = inputArea.value;
		const caret = inputArea.selectionStart ?? value.length;
		return caret > filterStart ? value.slice(filterStart, caret) : "";
	};

	const render = () => {
		const q = query().trim();
		shown = q ? items.filter((item) => subsequenceScore(item.label, q) !== null) : items.slice();
		if (index >= shown.length) index = Math.max(0, shown.length - 1);
		list.textContent = "";
		shown.forEach((item, i) => {
			const row = document.createElement("div");
			row.className = "listrow" + (i === index ? " sel" : "");
			const label = document.createElement("span");
			label.textContent = item.label;
			row.appendChild(label);
			row.addEventListener("click", () => { index = i; choose(); });
			list.appendChild(row);
		});
	};

	const choose = () => {
		const item = shown[index];
		if (!item) return;
		const value = inputArea.value;
		const caret = inputArea.selectionStart ?? value.length;
		// The text the filter applies to is replaced by the chosen item; the
		// trigger character (when there is one) stays in the composer.
		const text = value.slice(0, filterStart) + item.body + value.slice(caret);
		const at = filterStart + item.body.length;
		inputArea.value = text;
		inputArea.setSelectionRange(at, at);
		syncInput();
		closeOverlay();
		setFocus("input");
	};

	// The composer keeps the focus, so typing narrows the list down.
	const onInput = () => { index = 0; render(); };
	inputArea.addEventListener("input", onInput);

	render();
	addDialogButton(buttons, "  Cancel  ", closeOverlay);
	setTimeout(() => {
		inputArea.focus();
		// The caret stays where it was — a chord-opened popup must not move it.
		const caret = typed ? inputArea.value.length : openCaret;
		inputArea.setSelectionRange(caret, caret);
	}, 30);

	state.overlay = {
		kind: "composerMenu",
		el: backdropOf(dlg),
		dispose: () => { inputArea.removeEventListener("input", onInput); },
		onKey: (e) => {
			if (e.key === "Escape") { closeOverlay(); return true; }
			if (e.key === "ArrowDown") { index = (index + 1) % Math.max(1, shown.length); render(); return true; }
			if (e.key === "ArrowUp") { index = (index + Math.max(1, shown.length) - 1) % Math.max(1, shown.length); render(); return true; }
			if (e.key === "Enter") { choose(); return true; }
			return false;
		},
	};
}

/** The slash-command menu: choosing an item inserts the command. */
function openSlashCommandMenu(typed) {
	const commands = SLASH_COMMANDS;
	const isTyped = typed !== false;
	openComposerMenu({
		title: "Slash commands",
		prefix: "/",
		typed: isTyped,
		// The trigger character is already in the composer, so the body of the
		// command is what gets inserted.
		items: commands.map((command) => ({ label: command, body: isTyped ? command.slice(1) : command })),
	});
}

/** The attach-context menu: choosing a file inserts a reference to it. */
function openAttachContextMenu(typed) {
	const files = projectFiles();
	const isTyped = typed === true;
	if (!files.length) {
		void (async () => {
			const res = await luuna.getTree();
			if (res && res.success && Array.isArray(res.data)) {
				state.tree = res.data;
				const loaded = projectFiles();
				if (loaded.length) { openAttachContextMenu(typed); return; }
			}
			flashLocal("No project files to attach");
		})();
		return;
	}
	openComposerMenu({
		title: "Attach context",
		prefix: "@",
		typed: isTyped,
		// The trigger character is already in the composer when it was typed.
		items: files.map((file) => ({ label: file, body: isTyped ? file : `@${file}` })),
	});
}

/**
 * The composer popups are triggered by a TYPED character — never by a chord —
 * so ordinary typing is never swallowed. The typed "/" and "@" stay in the
 * composer; the chosen item is inserted after them.
 *
 * @param {InputEvent} [e] the `input` event (its `data` is the typed text)
 */
function maybeOpenComposerMenu(e) {
	// Only a TYPED trigger character opens the menu — a deletion or a paste
	// must not.
	const typed = e && typeof e.data === "string" ? e.data : "";
	if (typed !== "/" && typed !== "@") return;
	const value = inputArea.value;
	const caret = inputArea.selectionStart ?? value.length;
	// The trigger character sits at the very start of the composer.
	if (caret !== 1) return;
	if (value[0] !== typed) return;
	if (typed === "/") { openSlashCommandMenu(true); return; }
	openAttachContextMenu(true);
}

// --- find in the agent output ------------------------------------------------

/** The text of an entry of the agent panel. */
function entryText(entry) {
	return entry && entry.text ? String(entry.text) : "";
}

/**
 * The find overlay over the agent panel: `Enter` jumps to the next match,
 * `Mod+G` and `Shift+Mod+G` to the next and the previous one, `Escape`
 * closes it.
 */
function openFindInChat() {
	const { dlg, body, buttons } = buildDialog({ title: "Find in agent output", bodyClass: "find-body", width: "min(560px, 80vw)" });
	const input = document.createElement("input");
	input.className = "dlg-input";
	input.type = "text";
	input.placeholder = "Find…";
	input.setAttribute("aria-label", "Find");
	body.appendChild(input);
	const status = document.createElement("div");
	status.className = "dline dim find-status";
	body.appendChild(status);

	state.find = { query: "", index: -1 };

	const jump = (delta) => {
		const query = state.find.query.trim().toLowerCase();
		if (!query) { status.textContent = ""; return; }
		const entries = state.entries;
		if (!entries.length) { status.textContent = "No match"; return; }
		let index = state.find.index;
		let found = -1;
		for (let step = 0; step < entries.length; step++) {
			index = (index + delta + entries.length) % entries.length;
			if (entryText(entries[index]).toLowerCase().includes(query)) { found = index; break; }
		}
		state.find.index = found;
		markDirty();
		status.textContent = found >= 0 ? `Match ${found + 1} of ${entries.length}` : "No match";
	};

	input.addEventListener("input", () => {
		state.find.query = input.value;
		state.find.index = -1;
		jump(1);
	});

	addDialogButton(buttons, "  Close  ", closeOverlay);
	setTimeout(() => { input.focus(); input.select(); }, 30);

	state.overlay = {
		kind: "find",
		el: backdropOf(dlg),
		dispose: () => {
			// The highlight must not survive the overlay.
			state.find = { query: "", index: -1 };
			markDirty();
		},
		onKey: (e) => {
			if (e.key === "Escape") { closeOverlay(); return true; }
			if (e.key === "Enter") { jump(e.shiftKey ? -1 : 1); return true; }
			if ((e.ctrlKey || e.metaKey) && (e.key === "g" || e.key === "G")) { jump(e.shiftKey ? -1 : 1); return true; }
			return false;
		},
	};
}

// ---------------------------------------------------------------------------
// Status bar / key bar
// ---------------------------------------------------------------------------

function flashLocal(message) {
	state.flash = message;
	if (state.flashTimer) clearTimeout(state.flashTimer);
	state.flashTimer = setTimeout(() => { state.flash = null; markDirty(); }, 3000);
	markDirty();
}

function renderKeybar() {
	const bar = $("keybar");
	const message = state.flash ?? state.statusMessage;
	const frames = ["|", "/", "-", "\\"];
	const secs = state.requestStart ? (Date.now() - state.requestStart) / 1000 : 0;
	const thinking = state.isStreaming;

	if (state.menuHint) {
		bar.innerHTML = `<span class="hintlabel"><span class="key">${esc(actionDisplayChord("app.help"))}</span> Help</span> <span class="sep">│</span> ${esc(state.menuHint)}`;
		return;
	}
	if (message) {
		bar.innerHTML = `<span class="flash">${esc(message)}</span>`;
		return;
	}
	bar.innerHTML = KEY_BAR_ITEMS.map(([actionId, label]) => `<span class="key">${esc(actionDisplayChord(actionId))}</span> ${label}`).join("&nbsp;&nbsp;")
		+ (thinking ? `<span class="thinkbadge"> Thinking [ ${frames[state.spinnerFrame]} ] ${secs.toFixed(1)}s </span>` : "");
}

function renderTitles() {
	$("win-tree").querySelector(".win-name").innerHTML = `FILES${state.treeFilter ? ` <span class="fcount">[${esc(state.treeFilter)}]</span>` : ""}`;
	const spin = state.isStreaming ? ` <span class="thinking-indicator">[${["|", "/", "-", "\\"][state.spinnerFrame]}]</span>` : "";
	$("win-agent").querySelector(".win-name").innerHTML = `${esc(state.sessionName || "NONAME00.PAS")}${spin}${state.focus === "agent" ? " ◄" : ""}`;
	syncInputTitlesOnly();
}

function syncInputTitlesOnly() {
	const effort = state.thinkingLevel && state.thinkingLevel !== "off" ? ` [${state.thinkingLevel}]` : "";
	$("input-title").textContent = `${state.model ?? "MESSAGE"}${effort} ${state.planMode ? "[PLAN]" : "[BUILD]"}${state.focus === "input" ? " ◄" : ""}`;
}

// ---------------------------------------------------------------------------
// Vim-style navigation engine
// The message input line is INSERT mode (normal typing); every other pane is
// NORMAL mode: hjkl move, gg/G jump, Ctrl+D/U half-page, i/enter insert,
// : command line, / find, ? help, Ctrl+W window motions.
// The chords themselves live in the keymap (`renderer/keymap.js`) — the
// functions below only implement what a motion DOES.
// ---------------------------------------------------------------------------

function vimPaneEl() {
	return state.focus === "tree" ? $("tree-body") : $("agent-body");
}

function agentScrollBy(px) {
	const b = $("agent-body");
	b.scrollTop += px;
	state.pinnedBottom = b.scrollTop + b.clientHeight >= b.scrollHeight - 6;
}

/** h in the tree: collapse the current dir, else jump to its parent. */
function treeVimH() {
	const rows = flattenVisible();
	const r = rows[state.treeCursor];
	if (!r) return;
	if (r.node.isDir && state.treeExpanded.has(r.node.relPath)) {
		state.treeExpanded.delete(r.node.relPath);
		markDirty();
		return;
	}
	for (let i = state.treeCursor - 1; i >= 0; i--) {
		const cand = rows[i];
		if (cand.node.isDir && r.node.relPath.startsWith(cand.node.relPath + "/")) {
			state.treeCursor = i;
			markDirty();
			return;
		}
	}
}

/** l in the tree: expand a dir / enter its first child / preview a file. */
function treeVimL() {
	const rows = flattenVisible();
	const r = rows[state.treeCursor];
	if (!r) return;
	if (r.node.isDir) {
		if (!state.treeExpanded.has(r.node.relPath)) {
			state.treeExpanded.add(r.node.relPath);
			markDirty();
		} else {
			const child = rows[state.treeCursor + 1];
			if (child && child.depth === r.depth + 1) { state.treeCursor++; markDirty(); }
		}
		return;
	}
	previewFile(r.node);
}

/** Shared vim motions for the list dialogs (model / session / providers). */
function vimListNav(e, api) {
	if (e.key === "j" && !e.ctrlKey && !e.altKey && !e.metaKey) { api.move(1); return true; }
	if (e.key === "k" && !e.ctrlKey && !e.altKey && !e.metaKey) { api.move(-1); return true; }
	if (e.key === "g" && !e.ctrlKey && !e.altKey && !e.metaKey) { api.jump(0); return true; }
	if (e.key === "G" && !e.ctrlKey && !e.altKey && !e.metaKey) { api.jump(api.count - 1); return true; }
	if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === "d") { api.move(5); return true; }
	if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === "u") { api.move(-5); return true; }
	return false;
}

function makeListApi(count, getIndex, setIndex) {
	const clamp = (i) => Math.max(0, Math.min(count - 1, i));
	return {
		count,
		move: (d) => setIndex(clamp(getIndex() + d)),
		jump: (i) => setIndex(clamp(i)),
	};
}

// ---------------------------------------------------------------------------
// Global keyboard handling
// ---------------------------------------------------------------------------

// --- Alt+letter accelerators -----------------------------------------------
//
// Under Electron the main process intercepts Alt+letter with before-input-event
// and preventDefaults it, so the page never sees the keydown; the accelerator
// arrives as `push:altKey` instead (handler further down). Under Tauri there is
// no pre-page key interception, so the keydown reaches us and we must resolve
// the menu from the key event itself.
//
// Two real-world wrinkles this handles:
//
//  1. A lone Alt press makes Windows enter "menu mode", where the next plain
//     letter is delivered WITHOUT altKey (that is how native menus work). So a
//     bare Alt followed by `f` must still open File.
//  2. Chromium reports e.key as the layout character ("f"), but an AltGr key on
//     some layouts reports "AltGraph" or an empty string; fall back to the
//     physical key (e.code === "KeyF").
const ALT_BURST_MS = 1500;
let altPendingSince = 0;

/** Physical Alt+<letter> fallback: "f" from either e.key or e.code ("KeyF"). */
function altDiagKey(e) {
	if (typeof e.key === "string" && e.key.length === 1) return e.key.toLowerCase();
	const code = typeof e.code === "string" ? e.code : "";
	const m = /^Key([A-Z])$/.exec(code);
	return m ? m[1].toLowerCase() : "";
}

/** True for a bare Alt press (either side). */
function isAltKey(e) {
	return e.key === "Alt" || e.code === "AltLeft" || e.code === "AltRight";
}

/**
 * The accelerator letter for an Alt+letter event. Ctrl+Alt is not an
 * accelerator (that is AltGr on many European layouts), so it is ignored.
 */
function altAcceleratorKey(e) {
	if (e.ctrlKey || e.metaKey) return "";
	if (altDiagKey(e) !== e.key.toLowerCase()) return "";
	return e.key.toLowerCase();
}

/**
 * A synthetic keyboard event for an `Alt+<letter>` accelerator. The physical
 * key is used so the chord is derived the same way a real keydown is.
 */
function altChordEvent(letter) {
	const upper = letter.toUpperCase();
	return {
		key: letter,
		code: /^[A-Z]$/.test(upper) ? `Key${upper}` : "",
		ctrlKey: false, metaKey: false, altKey: true, shiftKey: false,
	};
}

/**
 * The focus the keymap resolves against. The composer IS the message input,
 * so the textarea having the focus means the composer scope is active — even
 * when `state.focus` has not caught up yet.
 */
function keymapFocus() {
	if (state.focus === "input") return "input";
	if (typeof document !== "undefined" && document.activeElement === inputArea) return "input";
	return state.focus;
}

/**
 * The `Alt+<letter>` path, shared by the accelerators and by the Windows
 * "menu mode" burst: the keymap first (so `Alt+X` = app.exit is rebindable),
 * then the DOS menu mnemonics — those stay tied to MAIN_MENUS and are NOT
 * rebindable.
 *
 * Returns true when the key was consumed.
 */
function handleAltLetter(letter) {
	const hit = Keymap.resolve(altChordEvent(letter), { focus: keymapFocus() });
	if (hit && !hit.pending) {
		const handler = KEYMAP_HANDLERS[hit.actionId];
		if (handler && handler(hit.actionId)) return true;
	}
	const menuIdx = MAIN_MENUS.findIndex((m) => m.mnemonic.toLowerCase() === letter);
	if (menuIdx >= 0) { openMenuAt(menuIdx); return true; }
	return false;
}

/**
 * Handle the Windows "menu mode" burst: Alt was tapped (and swallowed), and
 * this keydown carries no altKey but belongs to that tap. Returns true when the
 * key was consumed.
 *
 * The freshness check compares e.timeStamp (measured from the page's time
 * origin) with performance.now(), which shares that clock — Date.now() does
 * not, and mixing the two rejects every burst.
 */
function altKeyBurst(e) {
	if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) { altPendingSince = 0; return false; }
	const letter = altDiagKey(e);
	if (!letter) { altPendingSince = 0; return false; }
	if (!altPendingSince) return false;
	const now = typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : null;
	if (now !== null && e.timeStamp > 0 && now - e.timeStamp > ALT_BURST_MS) { altPendingSince = 0; return false; }
	altPendingSince = 0;
	// The burst is an `Alt+<letter>` that lost its altKey on the way to us, so
	// it goes through exactly the same path as a real accelerator.
	return handleAltLetter(letter);
}

/** Remember a bare Alt press as the start of a possible menu-mode burst. */
function armAltBurst(e) {
	altPendingSince = isAltKey(e) && !e.ctrlKey && !e.metaKey && !e.shiftKey ? Date.now() : 0;
}

window.addEventListener("keyup", (e) => {
	// A real accelerator never leaves a stale burst armed.
	if (isAltKey(e)) return;
	altPendingSince = 0;
});

window.addEventListener("blur", () => { altPendingSince = 0; });

// ---------------------------------------------------------------------------
// The action handlers
//
// Every action of the registry that the app can already perform gets a
// handler here. A handler returns true when it CONSUMED the event (the caller
// then calls preventDefault) and false when it did not (the key keeps its
// native behaviour — e.g. the textarea inserting a newline itself).
//
// Every action of the registry that the app can perform has a handler here,
// including the ones Phase C2 added: the command palette, the theme picker,
// the settings dialog, the attach-context menu, the find bar and the
// regenerate-with-another-model action.
// ---------------------------------------------------------------------------

const KEYMAP_HANDLERS = {
	// --- General -----------------------------------------------------------
	"app.help": () => { openHelpDialog(); return true; },
	"app.menu": () => { if (state.menuOpenIndex !== null) closeMenus(); else openMenuAt(0); return true; },
	"app.exit": () => { void luuna.exit(); return true; },
	"app.palette": () => { openCommandPalette(); return true; },
	"app.settings": () => { openSettingsDialog("appearance"); return true; },
	"app.theme": () => { openThemePicker(); return true; },
	"app.keybindings": () => { openSettingsDialog("keybindings"); return true; },
	"app.font": () => { openSettingsDialog("appearance"); return true; },

	// --- Session -----------------------------------------------------------
	"file.new": () => { void luuna.newSession(); return true; },
	"file.save": () => { void saveSessionDialog(); return true; },
	"file.open": () => { void openSessionSelector(); return true; },
	"session.regenerate": () => regenerateLastResponse(),
	"session.regenerateModel": () => {
		if (!state.lastPrompt) { flashLocal("No previous prompt to regenerate"); return true; }
		void openModelSelector(() => regenerateLastResponse());
		return true;
	},
	"session.next": () => cycleRecentSession(1),
	"session.prev": () => cycleRecentSession(-1),

	// --- Agent -------------------------------------------------------------
	"agent.model": () => { void openModelSelector(); return true; },
	"agent.thinking": () => { void luuna.cycleThinkingLevel(); return true; },
	"agent.mode": () => { void luuna.setPlanMode(!state.planMode); return true; },
	"agent.fork": () => { void luuna.fork(); return true; },
	"agent.attachContext": () => { openAttachContextMenu(false); return true; },
	"agent.findInChat": () => { openFindInChat(); return true; },

	// --- Files, git, run ---------------------------------------------------
	"git.diff": () => { void showDiff(); return true; },
	"run.tests": () => { void luuna.runCommand("npm test"); return true; },
	"run.build": () => { void luuna.runCommand("npm run build"); return true; },
	"search.findFile": () => { findFileDialog(); return true; },

	// --- Edit and view -----------------------------------------------------
	"edit.copyOrAbort": () => copyOrAbort(),
	"edit.deleteWord": () => deleteWordBeforeCursor(),
	"view.clear": () => { clearPanel(); flashLocal("Agent view cleared"); return true; },
	"view.toggleSidebar": () => toggleSidebar(),
	"view.zoomOut": () => zoomFont(-1),
	"view.zoomIn": () => zoomFont(1),
	"view.zoomReset": () => zoomFont(0),
	"view.halfPageDown": () => halfPageScroll(1),
	"view.halfPageUp": () => halfPageScroll(-1),

	// --- Window ------------------------------------------------------------
	"window.next": () => { cycleFocus(); return true; },
	"window.motionTree": () => { setFocus("tree"); return true; },
	"window.motionAgent": () => { setFocus("agent"); return true; },
	"window.motionInput": () => { setFocus("input"); return true; },
	"window.motionCycle": () => { cycleFocus(); return true; },

	// --- Normal mode -------------------------------------------------------
	"nav.down": () => navDown(),
	"nav.up": () => navUp(),
	"nav.left": () => { treeVimH(); return true; },
	"nav.right": () => { treeVimL(); return true; },
	"nav.top": () => navTop(),
	"nav.bottom": () => navBottom(),
	"nav.insert": () => { setFocus("input"); return true; },
	"nav.commandLine": () => { inputArea.value = "/"; syncInput(); setFocus("input"); return true; },
	"nav.find": () => { findFileDialog(); return true; },
	"nav.help": () => { openHelpDialog(); return true; },

	// --- Pane navigation ---------------------------------------------------
	"tree.up": () => treeMove(-1),
	"tree.down": () => treeMove(1),
	"tree.pageUp": () => treeMove(-10),
	"tree.pageDown": () => treeMove(10),
	"tree.home": () => treeMoveTo(0),
	"tree.end": () => treeMoveTo(-1),
	"tree.open": () => treeOpen(),
	"tree.escape": () => { setFocus("input"); return true; },
	"agent.up": () => { agentScrollBy(-lineHeight()); return true; },
	"agent.down": () => { agentScrollBy(lineHeight()); return true; },
	"agent.pageUp": () => { agentScrollBy(-agentBody().clientHeight); return true; },
	"agent.pageDown": () => { agentScrollBy(agentBody().clientHeight); return true; },
	"agent.home": () => { agentBody().scrollTop = 0; return true; },
	"agent.end": () => { agentBody().scrollTop = agentBody().scrollHeight; return true; },
	"agent.focusInput": () => { setFocus("input"); return true; },
	"agent.escape": () => { setFocus("input"); return true; },

	// --- Composer ----------------------------------------------------------
	"composer.send": () => sendComposerMessage(),
	// The textarea inserts the newline itself — the chord must not be
	// prevented, or the line break would never appear.
	"composer.newline": () => false,
	"composer.sendAlternate": () => sendComposerMessage(),
	"composer.cancel": () => cancelComposer(),
	"composer.historyPrev": () => { if (inputArea.value.includes("\n")) return false; inputHistoryPrev(); return true; },
	"composer.historyNext": () => { if (inputArea.value.includes("\n")) return false; inputHistoryNext(); return true; },
};

// The nine "jump to recent session" actions share one handler.
for (let i = 1; i <= 9; i++) KEYMAP_HANDLERS[`session.jump${i}`] = () => openRecentSession(i - 1);

// --- the helpers of the handlers -------------------------------------------

/** The agent output pane. */
function agentBody() { return $("agent-body"); }

/** Re-send the last prompt that was sent to the agent. */
function regenerateLastResponse() {
	if (!state.lastPrompt) { flashLocal("No previous prompt to regenerate"); return false; }
	void luuna.prompt(state.lastPrompt);
	flashLocal("Regenerating the last response");
	return true;
}

/** Open one of the recent sessions (0-based). */
function openRecentSession(index) {
	const list = state.recentSessions || [];
	const session = list[index];
	if (!session) { flashLocal("No such recent session"); return false; }
	state.recentIndex = index;
	void luuna.openSession(session.path ?? session.label);
	flashLocal(`Recent session: ${session.label ?? session.path}`);
	return true;
}

/** Walk through the recent sessions (1 = next, -1 = previous). */
function cycleRecentSession(delta) {
	const list = state.recentSessions || [];
	if (!list.length) { flashLocal("No recent sessions"); return false; }
	if (state.recentIndex === null) state.recentIndex = delta > 0 ? -1 : 0;
	state.recentIndex = (state.recentIndex + delta + list.length) % list.length;
	return openRecentSession(state.recentIndex);
}

/** Copy the selection, or abort the running operation. */
function copyOrAbort() {
	// Let the input textarea copy its own selection natively.
	if (document.activeElement === inputArea && inputArea.selectionStart !== inputArea.selectionEnd) return false;
	const sel = window.getSelection()?.toString();
	if (sel && sel.length > 0) { void luuna.copyToClipboard(sel); }
	else { void luuna.abort(); }
	return true;
}

/** Delete the word before the cursor in the composer. */
function deleteWordBeforeCursor() {
	const pos = inputArea.selectionStart;
	if (pos > 0 && inputArea.selectionStart === inputArea.selectionEnd) {
		const before = inputArea.value.slice(0, pos);
		const m = before.match(/\S+\s*$/) ?? before.slice(-1).match(/./);
		const cut = m ? m[0] : "";
		inputArea.value = before.slice(0, pos - cut.length) + inputArea.value.slice(inputArea.selectionEnd);
		const np = pos - cut.length;
		inputArea.setSelectionRange(np, np);
		syncInput();
	}
	return true;
}

/** Cancel the generation, or leave the composer. */
function cancelComposer() {
	if (state.isStreaming) { void luuna.abort(); return true; }
	setFocus("tree");
	return true;
}

/**
 * Show or hide the file tree pane. The layout lives in the stylesheet
 * (`.no-tree`), so the toggle only flips the class.
 */
function toggleSidebar() {
	const desktop = $("desktop");
	const hidden = desktop.classList.contains("no-tree");
	desktop.classList.toggle("no-tree", !hidden);
	flashLocal(hidden ? "File tree shown" : "File tree hidden");
	markDirty();
	return true;
}

/** A half page scroll of the focused pane (1 = down, -1 = up). */
function halfPageScroll(direction) {
	const b = vimPaneEl();
	b.scrollTop += direction * b.clientHeight / 2;
	return true;
}

/** Move the tree cursor by `delta` rows. */
function treeMove(delta) {
	const rows = flattenVisible();
	if (!rows.length) return false;
	const next = Math.max(0, Math.min(rows.length - 1, state.treeCursor + delta));
	if (next !== state.treeCursor) { state.treeCursor = next; markDirty(); }
	return true;
}

/** Move the tree cursor to an absolute row (-1 = the last one). */
function treeMoveTo(index) {
	const rows = flattenVisible();
	if (!rows.length) return false;
	state.treeCursor = index < 0 ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index));
	markDirty();
	return true;
}

/** Open (toggle / preview) the tree entry under the cursor. */
function treeOpen() {
	const rows = flattenVisible();
	const r = rows[state.treeCursor];
	if (r) treeEnter(r);
	return true;
}

/** The vim "j" motion: the tree cursor or the agent scroll. */
function navDown() {
	if (state.focus === "tree") return treeMove(1);
	agentScrollBy(lineHeight());
	return true;
}

/** The vim "k" motion. */
function navUp() {
	if (state.focus === "tree") return treeMove(-1);
	agentScrollBy(-lineHeight());
	return true;
}

/** The "gg" motion: the top of the tree or of the agent output. */
function navTop() {
	if (state.focus === "tree") { state.treeCursor = 0; markDirty(); }
	else { agentBody().scrollTop = 0; }
	return true;
}

/** The "G" motion: the bottom of the tree or of the agent output. */
function navBottom() {
	if (state.focus === "tree") { treeMoveTo(-1); }
	else { agentBody().scrollTop = agentBody().scrollHeight; }
	return true;
}

// ---------------------------------------------------------------------------
// The keymap resolution
// ---------------------------------------------------------------------------

/**
 * The one keydown step of the app: the keymap resolves the event to at most
 * one action and the handler of that action decides what happens.
 *
 * A two-key sequence ("Ctrl+W,H", "G,G") works like this: the first chord is
 * a PREFIX, it is remembered in `state.pendingChord` and the next key is
 * resolved against it. A key that does not continue the sequence clears the
 * prefix and is resolved as if it had never been pressed — that is the old
 * "Not a window motion: fall through and handle this key normally".
 *
 * Returns true when the event was consumed (the caller must not touch it any
 * more).
 */
function handleKeymapKey(e) {
	const focus = keymapFocus();
	let hit = Keymap.resolve(e, { focus, pendingChord: state.pendingChord || null });
	if (!hit && state.pendingChord) {
		state.pendingChord = null;
		hit = Keymap.resolve(e, { focus, pendingChord: null });
	}
	if (!hit) {
		state.pendingChord = null;
		return false;
	}
	if (hit.pending) {
		// The first chord of a sequence: wait for the next key.
		state.pendingChord = hit.prefix;
		e.preventDefault();
		return true;
	}
	state.pendingChord = null;
	const handler = KEYMAP_HANDLERS[hit.actionId];
	if (!handler) return false; // the action exists but has no handler yet
	if (handler(hit.actionId, e)) { e.preventDefault(); return true; }
	return false;
}

// ---------------------------------------------------------------------------
// The font zoom
// ---------------------------------------------------------------------------

/** The theme that is currently applied. */
let appliedTheme = null;

/**
 * Change the font size (1 = in, -1 = out, 0 = reset), apply it and persist it
 * in the project scope of the appearance settings.
 */
function zoomFont(direction) {
	const cfg = Config.currentConfig();
	const font = Config.fontFromSettings(cfg ? cfg.appearance : null, appliedTheme);
	const size = Config.zoomFontSize(font.size, direction);
	const next = { ...font, size: `${size}px` };
	Config.applyFont(next);
	Config.invalidateMetrics();
	// Keep the configuration in memory in sync with what is on the screen.
	if (cfg && cfg.appearance) cfg.appearance.font = { ...(cfg.appearance.font ?? {}), size: next.size };
	markDirty();
	flashLocal(`Font size: ${size}px`);
	void persistAppearance({ font: { size: next.size } });
	return true;
}

/**
 * Write a patch into the appearance settings of the scope the user selected
 * in the Config section of the settings dialog. A successful write re-reads
 * the configuration, so the theme, the font and the keymap overrides are
 * applied again.
 */
async function persistAppearance(patch) {
	const ok = await writeConfig(state.configScope, "appearance", patch);
	if (!ok) return false;
	return true;
}

window.addEventListener("keydown", (e) => {
	// Second key of a Windows "menu mode" burst (bare Alt, then a plain letter
	// delivered without altKey). This must run FIRST, and before armAltBurst()
	// clears the armed flag:
	//  - the burst key looks like an ordinary letter to every later branch, so
	//    anything earlier would swallow it as a vim motion or menu mnemonic;
	//  - armAltBurst() resets altPendingSince for any non-Alt key, so it would
	//    erase the very state this check depends on.
	const wasArmed = !!altPendingSince;
	if (wasArmed && altKeyBurst(e)) { e.preventDefault(); return; }
	armAltBurst(e);

	// An IME composition is not a key press: the composing text must never be
	// swallowed by a chord (Enter would send a half-written word).
	if (e.isComposing || e.keyCode === 229) return;

	// Overlays get priority
	if (state.overlay) {
		if (state.overlay.onKey(e)) { e.preventDefault(); }
		else if (e.key === "Tab") e.preventDefault();
		return;
	}
	if (state.menuOpenIndex !== null) {
		const dd = document.querySelector(".dropdown");
		const rows = dd ? [...dd.querySelectorAll(".row")] : [];
		const curIdx = menuCurrentItem();
		const curPos = rows.findIndex((r) => Number(r.dataset.index) === curIdx);
		const items = currentMenuItems();

		if (e.key === "Escape") { closeMenus(); e.preventDefault(); return; }
		if (e.key === "Tab") { closeMenus(); e.preventDefault(); return; }
		if (e.key === "Home") { moveMenuSel(rows, 0); e.preventDefault(); return; }
		if (e.key === "End") { moveMenuSel(rows, rows.length - 1); e.preventDefault(); return; }
		if (e.key === "ArrowUp") { moveMenuSel(rows, curPos - 1); e.preventDefault(); return; }
		if (e.key === "ArrowDown") { moveMenuSel(rows, curPos + 1); e.preventDefault(); return; }
		if (e.key === "ArrowLeft") { openMenuAt((state.menuOpenIndex + MAIN_MENUS.length - 1) % MAIN_MENUS.length); e.preventDefault(); return; }
		if (e.key === "ArrowRight") { openMenuAt((state.menuOpenIndex + 1) % MAIN_MENUS.length); e.preventDefault(); return; }
		if (e.key === "Enter") {
			const pos = curPos >= 0 ? curPos : 0;
			const row = rows[pos];
			if (row) { const item = items?.[Number(row.dataset.index)]; closeMenus(); if (item?.action) dispatchCommand(item.action); }
			e.preventDefault();
			return;
		}
		if (e.key.length === 1 && !e.ctrlKey && !e.altKey) {
			e.preventDefault(); // menu owns plain keystrokes; never leak into windows
			const items2 = currentMenuItems();
			const idx = items2.findIndex((it) => !it.separator && (it.mnemonic || "").toLowerCase() === e.key.toLowerCase());
			if (idx >= 0) { const item = items2[idx]; closeMenus(); dispatchCommand(item.action); }
			return;
		}
		// F10 closes the open menu (and must not fall through to the "open" path
		// below, which would just reopen it). Function keys are otherwise not
		// menu commands, but they must still be owned by the menu so they never
		// reach the panes underneath.
		if (!e.ctrlKey && !e.metaKey && !e.altKey && /^F\d+$/.test(e.key)) {
			e.preventDefault();
			if (e.key === "F10") closeMenus();
			return;
		}
		return;
	}

	const mod = e.ctrlKey || e.metaKey;

	// The keymap: ONE resolution step for every chord the app owns. It
	// replaces the hardcoded F-key switch, the Ctrl block, the vim-motion
	// switch, the Tab handling and the pane navigation. The keymap knows the
	// scopes, so nothing has to be filtered here.
	if (handleKeymapKey(e)) return;

	// Alt+letter menu accelerators: under Electron the main process owns them
	// (before-input-event preventDefaults, so nothing reaches the page). Under
	// Tauri there is no pre-page key interception, so handle them here.
	// The keymap is consulted first (so `Alt+X` = app.exit is rebindable);
	// the DOS menu mnemonics are the fallback and are NOT rebindable.
	if (e.altKey && !mod && e.key.length === 1) {
		e.preventDefault(); // an accelerator never leaks into a window or the input
		const key = altAcceleratorKey(e);
		if (!key) return; // Ctrl+Alt (AltGr) or a non-letter: swallow, do nothing
		handleAltLetter(key);
	}
});

function currentMenuItems() {
	if (state.menuOpenIndex === null) return null;
	const base = MAIN_MENUS[state.menuOpenIndex].items;
	if (state.menuOpenIndex === 0 && state.recentSessions.length > 0) {
		const items = [...base, { separator: true }];
		state.recentSessions.slice(0, 9).forEach((s, i) => {
			const label = typeof s === "string" ? s : s.label;
			items.push({ label: `${i + 1}. ${label}`, mnemonic: String(i + 1), action: `file.recent:${i}` });
		});
		return items;
	}
	return base;
}

function moveMenuSel(rows, pos) {
	if (!rows.length) return;
	let p = pos;
	if (p < 0) p = rows.length - 1;
	if (p >= rows.length) p = 0;
	rows.forEach((r) => r.classList.remove("sel"));
	rows[p].classList.add("sel");
	const item = currentMenuItems()?.[Number(rows[p].dataset.index)];
	state.menuHint = item?.hint ?? MAIN_MENUS[state.menuOpenIndex].hint;
	markDirty();
}

document.addEventListener("mousedown", (e) => {
	if (state.menuOpenIndex !== null && !e.target.closest(".dropdown") && !e.target.closest("#menubar")) closeMenus();
});

// Window control buttons
document.querySelectorAll(".win-close").forEach((el) => {
	el.addEventListener("click", () => {
		if (el.dataset.win === "tree") { void refreshGitAndTree(); flashLocal("Files reloaded"); }
		else { clearPanel(); flashLocal("Agent view cleared"); }
	});
});
document.querySelectorAll(".win-zoom").forEach((el) => {
	el.addEventListener("click", () => {
		if (state.zoom) { state.zoom = null; flashLocal("Windows restored"); }
		else { state.zoom = el.dataset.win === "tree" ? "tree" : "agent"; flashLocal(`${state.zoom.toUpperCase()} maximized (click [▲] to restore)`); }
		applyZoom();
	});
});

// Native right-click menu (Copy / Paste / Select All on the focused element)
window.addEventListener("contextmenu", (e) => {
	e.preventDefault();
	void luuna.contextMenu();
});

// Clicking a window body focuses it
$("win-agent").addEventListener("mousedown", () => { if (state.focus !== "agent") { setFocus("agent"); } });
$("win-tree").addEventListener("mousedown", () => { if (state.focus !== "tree") { setFocus("tree"); } });
$("win-input").addEventListener("mousedown", () => { setTimeout(() => inputArea.focus(), 0); });

// ---------------------------------------------------------------------------
// Push handlers (main -> renderer)
// ---------------------------------------------------------------------------

luuna.on("push:state", (s) => {
	Object.assign(state, pickState(s));
	markDirty();
});

function pickState(s) {
	return {
		cwd: s.cwd, model: s.model, thinkingLevel: s.thinkingLevel, planMode: s.planMode,
		sessionName: s.sessionName, contextTokens: s.contextTokens, gitInfo: s.gitInfo,
		isStreaming: s.isStreaming, requestStart: s.requestStart, statusMessage: s.statusMessage,
		recentSessions: s.recentSessions ?? [],
	};
}

luuna.on("push:entry", (entry) => { addEntry(entry); });
luuna.on("push:delta", (d) => { appendDelta(d.kind, d.delta); });
luuna.on("push:textPopup", (p) => { openTextPopup(p.title, p.lines); });
// Alt+letter menu accelerator, intercepted by the main process and forwarded.
luuna.on("push:altKey", ({ menu }) => {
	closeOverlay();
	openMenuAt(menu);
});
luuna.on("push:bootError", (p) => {
	addEntry({ kind: "error", text: String(p.message), tag: "[ERROR]", isError: true });
	flashLocal(String(p.message).split("\n")[0]);
});

// Spinner animation while streaming
setInterval(() => {
	if (state.isStreaming) { state.spinnerFrame = (state.spinnerFrame + 1) % 4; markDirty(); }
}, 80);

// A configuration change (theme, font, keybindings) repaints the menu
// shortcut column, the key bar, the help screen and the guide.
if (Config && typeof Config.subscribe === "function") {
	Config.subscribe((cfg) => {
		appliedTheme = resolveCurrentTheme(cfg);
		Config.invalidateMetrics();
		markDirty();
	});
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/**
 * The last app-default collision the user was told about — so a reload does
 * not repeat the warning.
 */
let lastCollisionNote = "";

/**
 * The warning about the app-settings defaults that took a chord away from
 * another action.
 *
 * The registry keeps exactly one owner per chord per scope, so a configured
 * send key of "Escape" takes the chord away from "Cancel / stop generation".
 * The user has to learn about it — the action would otherwise just show
 * "(unbound)".
 *
 * @returns {string} the warning, or "" when there is none
 */
function collisionNote() {
	const collisions = Keymap.defaultCollisions();
	if (!collisions.length) return "";
	return collisions
		.map((c) => `${c.ownerLabel} takes ${c.chord} away from ${c.label}`)
		.join("; ");
}

/**
 * Read the effective configuration and apply it: the theme, the font and the
 * keybinding overrides. A broken configuration must never stop the app from
 * starting — the built-in DOS theme and the default keymap stay in effect and
 * the error is flashed in the key bar.
 */
async function applyConfiguration() {
	let cfg = null;
	try {
		cfg = await Config.loadConfig();
	} catch (err) {
		flashLocal(`Config error: ${err}`);
		return null;
	}
	appliedTheme = resolveCurrentTheme(cfg);
	// The metrics depend on the font that was just applied.
	Config.invalidateMetrics();
	if (cfg && cfg.errors && cfg.errors.length) {
		flashLocal(`Config error: ${String(cfg.errors[0]).split("\n")[0]}`);
	}
	// The app settings can take a chord away from another action — the user
	// is told once, not on every reload.
	const note = collisionNote();
	if (note && note !== lastCollisionNote) {
		lastCollisionNote = note;
		flashLocal(`Keybinding warning: ${note}`);
	}
	if (!note) lastCollisionNote = "";
	markDirty();
	return cfg;
}

/** The theme of the configuration in effect (built-ins + the user's themes). */
function resolveCurrentTheme(cfg) {
	if (!Themes || !cfg) return null;
	const map = Themes.mergeThemes(Themes.BUILTIN_THEMES, cfg.themes);
	return Themes.resolveTheme(cfg.appearance.theme, map);
}

(async function boot() {
	const res = await luuna.boot();
	if (res.success) {
		Object.assign(state, pickState(res.data));
		if (res.data.piError) {
			addEntry({ kind: "error", text: String(res.data.piError), tag: "[ERROR]", isError: true });
		} else if (!res.data.piRunning) {
			addEntry({ kind: "error", text: "Pi agent is not connected. Check that `pi` is installed and on PATH.", tag: "[ERROR]", isError: true });
		}
	}
	// The configuration (theme, font, keybindings) before the first paint.
	await applyConfiguration();
	state.treeExpanded = new Set([""]);
	await refreshGitAndTree();
	applyFocus();
	applyZoom();
	syncInput();
	addEntry({ kind: "info", text: `LUUNA-AI desktop ready. Project: ${state.cwd}` });
})();

// Start the dirty-flag render loop last (all declarations above are ready).
(function startRenderLoop() {
	if (dirty) { dirty = false; renderAll(); }
	requestAnimationFrame(startRenderLoop);
})();
