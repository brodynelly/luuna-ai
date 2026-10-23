/**
 * LUUNA-AI Desktop — renderer.
 * Faithful HTML/CSS port of the Turbo Pascal 7 UI (menus, tiled windows, DOS
 * palette, overlays, slash commands). All backend work goes through the
 * `luuna` bridge into the Rust backend over Tauri IPC. NOTE: do NOT re-declare
 * `luuna` as a global const — the provider installs it as a global property.
 */
"use strict";

// ---------------------------------------------------------------------------
// Static UI data (mirrors src/ui/menu-bar.ts, status-bar.ts, help.ts,
// provider-dialog.ts)
// ---------------------------------------------------------------------------

const MAIN_MENUS = [
	{ title: "File", mnemonic: "F", hint: "File management commands (Save, Open, New session, Preview, Change dir, Export, Exit)", items: [
		{ label: "Save session to file...", mnemonic: "S", shortcut: "F2", action: "file.save", hint: "Save current conversation log to a file" },
		{ label: "Open saved session...", mnemonic: "O", shortcut: "F3", action: "file.open", hint: "Open and load a saved session file" },
		{ label: "New session", mnemonic: "N", action: "file.new", hint: "Start a new session with the Pi coding agent" },
		{ label: "Open file preview...", mnemonic: "P", action: "file.preview", hint: "Preview selected file from project explorer" },
		{ label: "Change directory...", mnemonic: "D", action: "file.chdir", hint: "Reconnect Pi and start a new session in another project directory" },
		{ label: "Export session to HTML...", mnemonic: "E", action: "file.export", hint: "Export conversation transcript to HTML document" },
		{ separator: true },
		{ label: "Exit", mnemonic: "x", shortcut: "Alt+X", action: "app.exit", hint: "Exit Luuna-AI and return to DOS / shell" },
	] },
	{ title: "Edit", mnemonic: "E", hint: "Text editing and view commands (Clear input, Clear agent log, Find in tree)", items: [
		{ label: "Clear message input", mnemonic: "I", action: "edit.clearInput", hint: "Clear current text in the prompt input line" },
		{ label: "Clear agent log", mnemonic: "C", shortcut: "Ctrl+L", action: "view.clear", hint: "Clear agent message history from screen" },
		{ separator: true },
		{ label: "Copy last answer...", mnemonic: "L", action: "edit.lastAnswer", hint: "Inspect clean text of the last assistant reply" },
		{ label: "Find in file tree...", mnemonic: "F", shortcut: "Ctrl+F", action: "search.find", hint: "Filter files in the project tree" },
		{ label: "Reset file filter", mnemonic: "R", action: "search.clear", hint: "Clear file tree filter and show all files" },
	] },
	{ title: "Search", mnemonic: "S", hint: "Search and filter files in workspace", items: [
		{ label: "Find file by name...", mnemonic: "F", shortcut: "Ctrl+F", action: "search.find", hint: "Filter and find files in the project tree" },
		{ label: "Search text in files...", mnemonic: "T", action: "search.grep", hint: "Search tracked workspace files with git grep" },
		{ separator: true },
		{ label: "Clear search filter", mnemonic: "C", action: "search.clear", hint: "Reset active search filter in project tree" },
	] },
	{ title: "Run", mnemonic: "R", hint: "Execute commands, tests, build and abort operations", items: [
		{ label: "Run command...", mnemonic: "R", action: "run.command", hint: "Execute custom command in agent bash tool" },
		{ label: "Run test suite", mnemonic: "T", shortcut: "F8", action: "run.tests", hint: "Run project test suite (npm test)" },
		{ label: "Build project", mnemonic: "B", shortcut: "F9", action: "run.build", hint: "Build project artifacts (npm run build)" },
		{ separator: true },
		{ label: "Abort command", mnemonic: "A", shortcut: "Ctrl+C", action: "run.abort", hint: "Cancel running shell / bash command" },
	] },
	{ title: "Agent", mnemonic: "A", hint: "Pi agent control, model selection, reasoning effort, and plan/build modes", items: [
		{ label: "Select model...", mnemonic: "M", shortcut: "F4", action: "tools.model", hint: "Choose active LLM model provider and identifier" },
		{ label: "Thinking effort...", mnemonic: "E", shortcut: "F5", action: "agent.thinking", hint: "Cycle reasoning effort (off -> low -> medium -> high)" },
		{ label: "Plan / Build mode...", mnemonic: "P", shortcut: "F6", action: "agent.mode", hint: "Toggle between PLAN and BUILD execution modes" },
		{ separator: true },
		{ label: "Cycle to next model", mnemonic: "C", action: "agent.cycle", hint: "Quickly toggle to the next enabled LLM model" },
		{ label: "Compact context memory", mnemonic: "K", action: "agent.compact", hint: "Summarize conversation to free context window tokens" },
		{ label: "Fork session branch...", mnemonic: "F", action: "agent.fork", hint: "Create a new branch from an earlier user message" },
		{ label: "Clone active branch", mnemonic: "L", action: "agent.clone", hint: "Duplicate active conversation branch into a new session" },
		{ separator: true },
		{ label: "Abort agent generation", mnemonic: "A", shortcut: "Ctrl+C", action: "agent.abort", hint: "Abort ongoing LLM generation or tool execution" },
	] },
	{ title: "Git", mnemonic: "G", hint: "Git version control operations (Status, Diff, History, Refresh)", items: [
		{ label: "Diff working tree...", mnemonic: "D", shortcut: "F7", action: "git.diff", hint: "View unified git diff of working tree changes" },
		{ label: "Status...", mnemonic: "S", action: "git.status", hint: "Show git repository branch and modified files" },
		{ label: "Commit history...", mnemonic: "L", action: "git.log", hint: "View recent git commits log in a popup" },
		{ separator: true },
		{ label: "Refresh git status", mnemonic: "R", action: "git.refresh", hint: "Rescan git status and dirty file markers" },
	] },
	{ title: "Tools", mnemonic: "T", hint: "Session statistics, session rename, and environment metrics", items: [
		{ label: "Kanban board...", mnemonic: "K", action: "workbench.tickets", hint: "Manage standalone Missions tickets" },
		{ label: "Prompt library...", mnemonic: "P", action: "workbench.prompts", hint: "Compose and version Beacon prompts" },
		{ label: "Expertise memory...", mnemonic: "X", action: "workbench.memory", hint: "Capture and search project Atlas expertise" },
		{ separator: true },
		{ label: "Session statistics...", mnemonic: "S", action: "tools.stats", hint: "Display token usage, context usage, and cost" },
		{ label: "Rename session...", mnemonic: "N", action: "tools.rename", hint: "Set a custom display name for the current session" },
		{ separator: true },
		{ label: "Refresh project tree", mnemonic: "R", action: "tree.refresh", hint: "Rescan project directory for new/deleted files" },
		{ label: "Environment & system info...", mnemonic: "E", action: "tools.env", hint: "Show Node.js, OS, memory, PID and terminal info" },
	] },
	{ title: "Options", mnemonic: "O", hint: "Pi agent settings, API keys, custom models, and delivery modes", items: [
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
		{ label: "Next pane", mnemonic: "N", shortcut: "Tab", action: "window.next", hint: "Switch active window (Files / Agent / Message)" },
		{ label: "Zoom / Restore window", mnemonic: "Z", action: "window.zoom", hint: "Toggle active window between tiled and full screen" },
		{ separator: true },
		{ label: "Project files", mnemonic: "P", action: "window.files", hint: "Focus project file explorer window (FILES.PAS)" },
		{ label: "Agent output", mnemonic: "A", action: "window.agent", hint: "Focus agent message log window (AGENT.PAS)" },
		{ label: "Message input", mnemonic: "M", action: "window.input", hint: "Focus message prompt input window (MESSAGE)" },
		{ separator: true },
		{ label: "Tile windows", mnemonic: "T", action: "window.tile", hint: "Restore standard 3-pane tiled desktop layout" },
	] },
	{ title: "Help", mnemonic: "H", hint: "Help system, key reference and About dialog", items: [
		{ label: "Keyboard help...", mnemonic: "H", shortcut: "F1", action: "help.show", hint: "Display list of hotkeys and shortcuts" },
		{ label: "Pi & IDE Guide...", mnemonic: "G", action: "help.guide", hint: "Comprehensive guide to Luuna-AI and Pi features" },
		{ separator: true },
		{ label: "About...", mnemonic: "A", action: "help.about", hint: "Information about Luuna AI tribute and version" },
	] },
];

const KEY_BAR_ITEMS = [["F1", "Help"], ["F2", "Save"], ["F3", "Open"], ["F4", "Model"], ["F5", "Effort"], ["F6", "Mode"], ["F7", "Diff"], ["F8", "Test"], ["F9", "Build"], ["F10", "Menu"]];

const HELP_LINES = [
	["F1", "Help screen & shortcuts"], ["F2", "Save session to file"], ["F3", "Open saved session file"],
	["F4", "Select AI model (from Pi)"], ["F5", "Thinking effort level"], ["F6", "Toggle PLAN / BUILD mode"],
	["F7", "Unified git diff viewer"], ["F8", "Run tests (npm test)"], ["F9", "Run build (npm run build)"],
	["F10", "Menu bar toggle"], ["Tab", "Switch active window"], ["Alt+F..H", "Direct menu shortcuts"],
	["Ctrl+F", "Find in files (filter tree)"], ["Ctrl+L", "Clear agent message history"],
	["Ctrl+C", "Copy selection / cancel command"], ["Alt+X", "Exit to DOS / terminal"],
	["Esc", "Close dialog / cancel / unfocus"],
	["H/J/K/L", "Vim move (tree, panes, lists)"],
	["gg / G", "Vim jump to top / bottom"],
	["Ctrl+D / U", "Vim half page down / up"],
	["i", "Insert mode: focus message input"],
	[":", "Command line (slash commands)"],
	["/", "Find file in tree"],
	["?", "This help screen"],
	["Ctrl+W", "Window motion h/j/k/l · del word"],
];

const GUIDE_LINES = [
	"LUUNA-AI User & Command Guide",
	"═══════════════════════════════════════════",
	"Workbench: Tools > Kanban, Prompt library, Expertise memory. Explicit initialization and draft insertion.",
	"Primary commands:",
	"  F1          Open keyboard help",
	"  F2          Save conversation transcript",
	"  F3          Open or resume a saved session",
	"  F4          Open AI model selector",
	"  F5          Cycle thinking effort",
	"  F6          Toggle PLAN / BUILD mode",
	"  F7          Open unified Git diff",
	"  F8          Run project test suite (npm test)",
	"  F9          Build project artifacts (npm run build)",
	"  F10         Activate top menu bar",
	"",
	"Navigation & editing:",
	"  Tab         Switch between FILES, AGENT, and MESSAGE",
	"  Ctrl+C      Abort active AI generation or command",
	"  Ctrl+L      Clear message history from AGENT screen",
	"  Ctrl+F      Filter and find files in tree",
	"  Alt+X       Cleanly exit to DOS / shell",
	"",
	"Slash commands:",
	"  /status /help /clear /compact /model /effort",
	"  /plan /build /mode /diff /test /run /save",
	"  /sessions /resume /open /new /fork /export",
	"",
	"Vim navigation:",
	"  j / k       Down / up (tree, panes, dialog lists)",
	"  h / l       Collapse / expand in tree (parent / child)",
	"  gg / G      Jump to top / bottom",
	"  Ctrl+D / U  Half page down / up",
	"  i           Insert mode (focus the message input)",
	"  :           Command line (prefills /)",
	"  /           Find file in tree",
	"  ?           Keyboard help",
	"  Ctrl+W h/j/k/l  Jump between windows (w cycles)",
	"  Ctrl+W (input)  Delete word before cursor",
];

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
		row.innerHTML = `<span>${withMnemonic(item.label, item.mnemonic)}</span>` + (item.shortcut ? `<span class="sc">${esc(item.shortcut)}</span>` : `<span class="sc"></span>`);
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
	if (command.startsWith("workbench.")) { closeMenus(); window.luunaWorkbench.open(command.split(".")[1]); return; }
	if (command.startsWith("file.recent:")) {
		const idx = Number.parseInt(command.slice("file.recent:".length), 10);
		const session = state.recentSessions[idx];
		if (session) void luuna.openSession(session.path ?? session.label);
		return;
	}
	switch (command) {
		case "app.exit": window.close(); break;
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
		case "help.guide": openTextPopup("Pi & IDE Guide", GUIDE_LINES); break;
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

	for (const e of state.entries) {
		switch (e.kind) {
			case "user":
				html.push(`<div class="entry-user"><span class="prompt">&gt; </span><span class="text">${esc(e.text)}</span></div>`);
				break;
			case "thinking":
				for (const raw of String(e.text).split("\n")) html.push(`<div class="entry-thinking">${esc(raw)}</div>`);
				break;
			case "agent": {
				for (const raw of String(e.text).split("\n")) {
					if (raw.startsWith("```")) { inCode = !inCode; html.push(`<div class="entry-agent codecom">${esc(raw.slice(0, widthChars))}</div>`); continue; }
					if (inCode) html.push(`<div class="entry-agent">${highlightCode(raw)}</div>`);
					else if (raw.startsWith("#")) html.push(`<div class="entry-agent mdhead">${esc(raw)}</div>`);
					else html.push(`<div class="entry-agent">${esc(raw)}</div>`);
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
				html.push(`<div class="entry-${e.kind}"><span class="tag ${cls}">${esc(tag.padEnd(8))}</span><span class="text">${esc(e.text)}</span></div>`);
				break;
			}
			case "info":
				html.push(`<div class="entry-info">${esc(e.text)}</div>`);
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
	$("agent-linecounter").textContent = ` ${Math.min(body.scrollTop === 0 ? 1 : Math.ceil((body.scrollTop + body.clientHeight) / lineHeight()), countPanelLines())}:${countPanelLines()} `;
}

function countPanelLines() {
	return Math.max(1, Math.ceil($("agent-body").scrollHeight / lineHeight()));
}
function charWidth() { return 8.4; } // approx for 14px Consolas
function lineHeight() { return 17.5; }

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

inputArea.addEventListener("input", syncInput);
inputArea.addEventListener("scroll", () => { inputMirror.scrollTop = inputArea.scrollTop; inputMirror.scrollLeft = inputArea.scrollLeft; });
inputArea.addEventListener("focus", () => { setFocus("input"); });
inputArea.addEventListener("keydown", (e) => {
	if (e.isComposing || e.keyCode === 229) return; // IME composition
	if (state.overlay || state.menuOpenIndex !== null) return; // dialogs/menus own the keyboard
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		const text = inputArea.value.trim();
		if (text) {
			state.inputHistory.push(inputArea.value);
			if (state.inputHistory.length > 200) state.inputHistory.shift();
			inputArea.value = "";
			state.historyPos = null;
			syncInput();
			void processInputSubmission(text);
		}
		return;
	}
	if (e.key === "ArrowUp" && !inputArea.value.includes("\n")) {
		e.preventDefault();
		inputHistoryPrev();
		return;
	}
	if (e.key === "ArrowDown" && !inputArea.value.includes("\n")) {
		e.preventDefault();
		inputHistoryNext();
		return;
	}
	if (e.key === "Escape") {
		if (state.isStreaming) void luuna.abort();
		else { setFocus("tree"); e.stopPropagation(); } // don't let the window handler bounce focus back
	}
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

async function processInputSubmission(text) {
	const trimmed = text.trim();
	if (trimmed.startsWith("/")) {
		const handled = await handleSlashCommand(trimmed);
		if (handled) return;
	}
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
	for (const [key, desc] of HELP_LINES) {
		const div = document.createElement("div");
		div.className = "dline";
		div.innerHTML = `<span class="k">${esc(key.padEnd(11))}</span>${esc(desc)}`;
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

async function openModelSelector() {
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
				})();
			});
			return;
		}
		void luuna.setModel(m);
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
		bar.innerHTML = `<span class="hintlabel"><span class="key">F1</span> Help</span> <span class="sep">│</span> ${esc(state.menuHint)}`;
		return;
	}
	if (message) {
		bar.innerHTML = `<span class="flash">${esc(message)}</span>`;
		return;
	}
	bar.innerHTML = KEY_BAR_ITEMS.map(([k, label]) => `<span class="key">${k}</span> ${label}`).join("&nbsp;&nbsp;")
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
// ---------------------------------------------------------------------------

state.pendingG = false;   // awaiting the second "g" of gg
state.pendingCw = false;  // awaiting the follow-up key of Ctrl+W

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
	if (letter === "x") { void luuna.exit(); return true; }
	const menuIdx = MAIN_MENUS.findIndex((m) => m.mnemonic.toLowerCase() === letter);
	if (menuIdx >= 0) { openMenuAt(menuIdx); return true; }
	return false;
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

window.addEventListener("keydown", (e) => {
	if (window.luunaWorkbench && window.luunaWorkbench.isOpen()) {
		if (e.key === "Escape") { e.preventDefault(); window.luunaWorkbench.close(); }
		return;
	}
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

	// Second key of Ctrl+W: window motion (h/j/k/l) or w = cycle.
	if (state.pendingCw) {
		state.pendingCw = false;
		if (!mod && !e.altKey) {
			const k = e.key.toLowerCase();
			if (k === "w") { cycleFocus(); e.preventDefault(); return; }
			const target = k === "h" ? "tree" : k === "l" ? "input" : (k === "j" || k === "k") ? "agent" : null;
			if (target) { setFocus(target); e.preventDefault(); return; }
		}
		// Not a window motion: fall through and handle this key normally.
	}

	// Function keys
	if (!mod && !e.altKey && e.key.startsWith("F") && /^F\d+$/.test(e.key)) {
		e.preventDefault();
		switch (e.key) {
			case "F1": openHelpDialog(); return;
			case "F2": saveSessionDialog(); return;
			case "F3": void openSessionSelector(); return;
			case "F4": void openModelSelector(); return;
			case "F5": void luuna.cycleThinkingLevel(); return;
			case "F6": void luuna.setPlanMode(!state.planMode); return;
			case "F7": void showDiff(); return;
			case "F8": void luuna.runCommand("npm test"); return;
			case "F9": void luuna.runCommand("npm run build"); return;
			case "F10": if (state.menuOpenIndex !== null) closeMenus(); else openMenuAt(0); return;
		}
	}

	// Alt+letter menu accelerators: under Electron the main process owns them
	// (before-input-event preventDefaults, so nothing reaches the page). Under
	// Tauri there is no pre-page key interception, so handle them here.
	// Alt+X is the one accelerator with no menu behind it: it exits.
	if (e.altKey && !mod && e.key.length === 1) {
		e.preventDefault(); // an accelerator never leaks into a window or the input
		const key = altAcceleratorKey(e);
		if (!key) return; // Ctrl+Alt (AltGr) or a non-letter: swallow, do nothing
		if (key === "x") { void luuna.exit(); return; }
		const menuIdx = MAIN_MENUS.findIndex((m) => m.mnemonic.toLowerCase() === key);
		if (menuIdx >= 0) { openMenuAt(menuIdx); return; }
	}

	// Ctrl shortcuts
	if (mod && !e.altKey) {
		const k = e.key.toLowerCase();
		if (k === "l") { e.preventDefault(); clearPanel(); flashLocal("Agent view cleared"); return; }
		if (k === "f") { e.preventDefault(); findFileDialog(); return; }
		if (k === "c") {
			// Let the input textarea copy its own selection natively.
			if (document.activeElement === inputArea && inputArea.selectionStart !== inputArea.selectionEnd) return;
			const sel = window.getSelection()?.toString();
			if (sel && sel.length > 0) { void luuna.copyToClipboard(sel); }
			else { void luuna.abort(); }
			e.preventDefault();
			return;
		}
		// Vim half-page scroll (normal mode only)
		if ((k === "d" || k === "u") && state.focus !== "input") {
			const b = vimPaneEl();
			b.scrollTop += (k === "d" ? 1 : -1) * b.clientHeight / 2;
			e.preventDefault();
			return;
		}
		// Ctrl+W: window motion prefix; in the input, delete word before cursor
		if (k === "w") {
			e.preventDefault();
			if (state.focus === "input") {
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
			} else {
				state.pendingCw = true;
			}
			return;
		}
	}

	// --- Vim normal-mode motions (input line is insert mode) ---
	if (!mod && !e.altKey && state.focus !== "input") {
		if (state.pendingG) {
			state.pendingG = false;
			if (e.key === "g") {
				e.preventDefault();
				if (state.focus === "tree") { state.treeCursor = 0; markDirty(); }
				else { const b = $("agent-body"); b.scrollTop = 0; }
				return;
			}
		}
		const rows = state.focus === "tree" ? flattenVisible() : null;
		let handled = true;
		switch (e.key) {
			case "j":
				if (state.focus === "tree") { state.treeCursor = Math.min(rows.length - 1, state.treeCursor + 1); markDirty(); }
				else agentScrollBy(lineHeight());
				break;
			case "k":
				if (state.focus === "tree") { state.treeCursor = Math.max(0, state.treeCursor - 1); markDirty(); }
				else agentScrollBy(-lineHeight());
				break;
			case "h": if (state.focus === "tree") treeVimH(); break;
			case "l": if (state.focus === "tree") treeVimL(); break;
			case "G":
				if (state.focus === "tree") { state.treeCursor = Math.max(0, rows.length - 1); markDirty(); }
				else { const b = $("agent-body"); b.scrollTop = b.scrollHeight; }
				break;
			case "i": setFocus("input"); break;
			case ":":
				inputArea.value = "/";
				syncInput();
				setFocus("input");
				break;
			case "/": findFileDialog(); break;
			case "?": openHelpDialog(); break;
			default: handled = false;
		}
		if (handled) { e.preventDefault(); return; }
		if (e.key === "g") { state.pendingG = true; e.preventDefault(); return; }
	}

	if (e.key === "Tab" && !mod && !e.altKey) {
		e.preventDefault();
		cycleFocus();
		return;
	}

	// Tree navigation
	if (state.focus === "tree") {
		const rows = flattenVisible();
		switch (e.key) {
			case "ArrowUp": state.treeCursor = Math.max(0, state.treeCursor - 1); markDirty(); return e.preventDefault();
			case "ArrowDown": state.treeCursor = Math.min(rows.length - 1, state.treeCursor + 1); markDirty(); return e.preventDefault();
			case "PageUp": state.treeCursor = Math.max(0, state.treeCursor - 10); markDirty(); return e.preventDefault();
			case "PageDown": state.treeCursor = Math.min(rows.length - 1, state.treeCursor + 10); markDirty(); return e.preventDefault();
			case "Home": state.treeCursor = 0; markDirty(); return e.preventDefault();
			case "End": state.treeCursor = rows.length - 1; markDirty(); return e.preventDefault();
			case "Enter": { const r = rows[state.treeCursor]; if (r) treeEnter(r); return e.preventDefault(); }
			case "Escape": setFocus("input"); return e.preventDefault();
		}
	}

	if (state.focus === "agent") {
		const body = $("agent-body");
		switch (e.key) {
			case "ArrowUp": body.scrollTop -= lineHeight(); return;
			case "ArrowDown": body.scrollTop += lineHeight(); return;
			case "PageUp": body.scrollTop -= body.clientHeight; return;
			case "PageDown": body.scrollTop += body.clientHeight; return;
			case "Home": body.scrollTop = 0; return;
			case "End": body.scrollTop = body.scrollHeight; return;
			case "Enter": case "Escape": setFocus("input"); return e.preventDefault();
		}
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

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

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
