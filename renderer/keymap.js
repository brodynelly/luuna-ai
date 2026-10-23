/**
 * LUUNA-AI — the keymap: the action registry and the chord algebra.
 *
 * Every user-facing action has a stable string ID, a human label, a category, a
 * scope and a default chord list. The registry is the single source of truth
 * for the menu shortcut column, the key bar, the help screen, the guide, the
 * command palette and the shortcuts editor.
 *
 * The shape is copied from Raycast (see `docs/raycast-keybindings.md`): an
 * action ID → a default chord → a user override → the UI renders whatever is
 * currently bound. LUUNA deliberately diverges from Raycast in one place: it
 * makes EVERY binding rebindable, including the navigational ones.
 *
 * Chord grammar (§C.2 of the spec):
 *
 *     Modifiers+Key
 *     primary (Mod | Ctrl | Meta) → Alt → Shift → Key
 *
 * Matching is order-independent: a chord is a modifier SET plus a key, so
 * `Shift+Mod+M` and `Mod+Shift+M` are the same binding. The canonical order is
 * only used when a chord is serialised.
 *
 * `Mod` is the portable alias: it expands to `Meta` (Cmd) on macOS and to
 * `Ctrl` everywhere else. `Ctrl` and `Meta` are always distinct.
 *
 * A binding may be a two-key sequence, written with a comma: `"Ctrl+W,H"`,
 * `"G,G"`.
 *
 * The module works both as a classic browser script (it installs
 * `window.LuunaKeymap`) and as a CommonJS module (so `node --test` can
 * require it). It never touches the DOM.
 */
(function (root, factory) {
	"use strict";
	const api = factory();
	if (typeof module === "object" && module.exports) module.exports = api;
	if (root) root.LuunaKeymap = api;
	if (typeof window !== "undefined" && window !== root) window.LuunaKeymap = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
	"use strict";

	// -----------------------------------------------------------------------
	// The action registry
	// -----------------------------------------------------------------------

	/**
	 * Every dispatchable action of the app. `chords` is the DEFAULT chord list
	 * (possibly empty for menu-only actions — those can still be given a
	 * shortcut from the settings UI).
	 *
	 * `origin` records where the default came from: "raycast" (taken from
	 * `docs/raycast-keybindings.md`), "existing" (already in the app today) or
	 * "luuna" (specific to LUUNA, not a Raycast chord).
	 */
	const ACTIONS = [
		// --- General -------------------------------------------------------
		{ id: "app.palette", label: "Command palette", category: "General", scope: "global", chords: ["Mod+K"], origin: "raycast" },
		{ id: "app.settings", label: "Settings…", category: "General", scope: "global", chords: ["Mod+,"], origin: "luuna" },
		{ id: "app.theme", label: "Theme picker…", category: "General", scope: "global", chords: ["Mod+Shift+T"], origin: "luuna" },
		{ id: "app.keybindings", label: "Keyboard shortcuts…", category: "General", scope: "global", chords: ["Mod+Shift+K"], origin: "luuna" },
		{ id: "app.font", label: "Font settings…", category: "General", scope: "global", chords: [], origin: "luuna" },
		{ id: "app.help", label: "Keyboard help", category: "General", scope: "global", chords: ["F1", "Mod+/"], origin: "existing" },
		{ id: "app.menu", label: "Activate menu bar", category: "General", scope: "global", chords: ["F10"], origin: "existing" },
		{ id: "app.exit", label: "Exit", category: "General", scope: "global", chords: ["Alt+X"], origin: "existing" },

		// --- Session --------------------------------------------------------
		{ id: "file.new", label: "New session", category: "Session", scope: "global", chords: ["Mod+N"], origin: "raycast" },
		{ id: "file.save", label: "Save session to file…", category: "Session", scope: "global", chords: ["F2"], origin: "existing" },
		{ id: "file.open", label: "Open saved session…", category: "Session", scope: "global", chords: ["F3"], origin: "existing" },
		{ id: "file.export", label: "Export session to HTML…", category: "Session", scope: "global", chords: [], origin: "existing" },
		{ id: "file.chdir", label: "Change directory…", category: "Session", scope: "global", chords: [], origin: "existing" },
		{ id: "file.preview", label: "Preview selected file", category: "Session", scope: "global", chords: [], origin: "existing" },
		{ id: "session.regenerate", label: "Regenerate last response", category: "Session", scope: "global", chords: ["Mod+R"], origin: "raycast" },
		{ id: "session.regenerateModel", label: "Regenerate with a different model", category: "Session", scope: "global", chords: ["Mod+Shift+R"], origin: "raycast" },
		{ id: "session.next", label: "Next recent session", category: "Session", scope: "global", chords: ["Mod+]"], origin: "raycast" },
		{ id: "session.prev", label: "Previous recent session", category: "Session", scope: "global", chords: ["Mod+["], origin: "raycast" },
		{ id: "session.jump1", label: "Jump to recent session 1", category: "Session", scope: "global", chords: ["Mod+1"], group: "Recent sessions", origin: "raycast" },
		{ id: "session.jump2", label: "Jump to recent session 2", category: "Session", scope: "global", chords: ["Mod+2"], group: "Recent sessions", origin: "raycast" },
		{ id: "session.jump3", label: "Jump to recent session 3", category: "Session", scope: "global", chords: ["Mod+3"], group: "Recent sessions", origin: "raycast" },
		{ id: "session.jump4", label: "Jump to recent session 4", category: "Session", scope: "global", chords: ["Mod+4"], group: "Recent sessions", origin: "raycast" },
		{ id: "session.jump5", label: "Jump to recent session 5", category: "Session", scope: "global", chords: ["Mod+5"], group: "Recent sessions", origin: "raycast" },
		{ id: "session.jump6", label: "Jump to recent session 6", category: "Session", scope: "global", chords: ["Mod+6"], group: "Recent sessions", origin: "raycast" },
		{ id: "session.jump7", label: "Jump to recent session 7", category: "Session", scope: "global", chords: ["Mod+7"], group: "Recent sessions", origin: "raycast" },
		{ id: "session.jump8", label: "Jump to recent session 8", category: "Session", scope: "global", chords: ["Mod+8"], group: "Recent sessions", origin: "raycast" },
		{ id: "session.jump9", label: "Jump to recent session 9", category: "Session", scope: "global", chords: ["Mod+9"], group: "Recent sessions", origin: "raycast" },

		// --- Agent ----------------------------------------------------------
		{ id: "agent.model", label: "Select model…", category: "Agent", scope: "global", chords: ["Mod+Shift+M", "F4"], origin: "raycast" },
		{ id: "agent.thinking", label: "Thinking effort…", category: "Agent", scope: "global", chords: ["Mod+Shift+U", "F5"], origin: "raycast" },
		{ id: "agent.mode", label: "Toggle plan/build mode", category: "Agent", scope: "global", chords: ["F6"], origin: "existing" },
		{ id: "agent.fork", label: "Fork session…", category: "Agent", scope: "global", chords: ["Mod+Shift+B"], origin: "raycast" },
		{ id: "agent.attachContext", label: "Attach context to the message", category: "Agent", scope: "global", chords: ["Mod+Shift+A"], origin: "raycast" },
		{ id: "agent.findInChat", label: "Find in agent output", category: "Agent", scope: "global", chords: ["Mod+Shift+F"], origin: "raycast" },
		{ id: "agent.cycleModel", label: "Cycle to next model", category: "Agent", scope: "global", chords: [], origin: "existing" },
		{ id: "agent.compact", label: "Compact context", category: "Agent", scope: "global", chords: [], origin: "existing" },
		{ id: "agent.clone", label: "Clone active branch", category: "Agent", scope: "global", chords: [], origin: "existing" },
		{ id: "agent.abort", label: "Abort generation", category: "Agent", scope: "global", chords: [], origin: "existing" },

		// --- Files, search, git, run ----------------------------------------
		{ id: "search.findFile", label: "Find file in tree", category: "Files & search", scope: "global", chords: ["Ctrl+F"], origin: "existing" },
		{ id: "search.grep", label: "Search text in files…", category: "Files & search", scope: "global", chords: [], origin: "existing" },
		{ id: "search.clear", label: "Clear file filter", category: "Files & search", scope: "global", chords: [], origin: "existing" },
		{ id: "tree.refresh", label: "Refresh project tree", category: "Files & search", scope: "global", chords: [], origin: "existing" },
		{ id: "git.diff", label: "Unified git diff", category: "Files & search", scope: "global", chords: ["F7"], origin: "existing" },
		{ id: "git.status", label: "Git status", category: "Files & search", scope: "global", chords: [], origin: "existing" },
		{ id: "git.log", label: "Git history", category: "Files & search", scope: "global", chords: [], origin: "existing" },
		{ id: "git.refresh", label: "Refresh git status", category: "Files & search", scope: "global", chords: [], origin: "existing" },
		{ id: "run.tests", label: "Run test suite", category: "Files & search", scope: "global", chords: ["F8"], origin: "existing" },
		{ id: "run.build", label: "Build project", category: "Files & search", scope: "global", chords: ["F9"], origin: "existing" },
		{ id: "run.command", label: "Run command…", category: "Files & search", scope: "global", chords: [], origin: "existing" },

		// --- Edit and view --------------------------------------------------
		{ id: "edit.copyOrAbort", label: "Copy selection / cancel operation", category: "Edit & view", scope: "global", chords: ["Mod+C", "Ctrl+C"], origin: "existing" },
		{ id: "edit.clearInput", label: "Clear message input", category: "Edit & view", scope: "global", chords: [], origin: "existing" },
		{ id: "edit.lastAnswer", label: "Copy last answer…", category: "Edit & view", scope: "global", chords: [], origin: "existing" },
		{ id: "view.clear", label: "Clear agent log", category: "Edit & view", scope: "global", chords: ["Mod+L", "Ctrl+L"], origin: "existing" },
		{ id: "view.toggleSidebar", label: "Toggle file tree", category: "Edit & view", scope: "global", chords: ["Mod+B", "Mod+Shift+S"], origin: "raycast" },
		{ id: "view.zoomOut", label: "Font zoom out", category: "Edit & view", scope: "global", chords: ["Mod+-"], origin: "raycast" },
		{ id: "view.zoomIn", label: "Font zoom in", category: "Edit & view", scope: "global", chords: ["Mod+="], origin: "raycast" },
		{ id: "view.zoomReset", label: "Font zoom reset", category: "Edit & view", scope: "global", chords: ["Mod+0"], origin: "raycast" },
		{ id: "view.halfPageDown", label: "Half page down", category: "Edit & view", scope: ["tree", "agent"], chords: ["Mod+D", "Ctrl+D"], origin: "existing" },
		{ id: "view.halfPageUp", label: "Half page up", category: "Edit & view", scope: ["tree", "agent"], chords: ["Mod+U", "Ctrl+U"], origin: "existing" },

		// --- Window ---------------------------------------------------------
		{ id: "window.next", label: "Cycle focus", category: "Window", scope: "global", chords: ["Tab"], origin: "existing" },
		{ id: "window.motionTree", label: "Window motion: focus tree", category: "Window", scope: ["tree", "agent"], chords: ["Ctrl+W,H"], origin: "existing" },
		{ id: "window.motionAgent", label: "Window motion: focus agent", category: "Window", scope: ["tree", "agent"], chords: ["Ctrl+W,J", "Ctrl+W,K"], origin: "existing" },
		{ id: "window.motionInput", label: "Window motion: focus input", category: "Window", scope: ["tree", "agent"], chords: ["Ctrl+W,L"], origin: "existing" },
		{ id: "window.motionCycle", label: "Window motion: cycle focus", category: "Window", scope: ["tree", "agent"], chords: ["Ctrl+W,W"], origin: "existing" },
		{ id: "window.zoom", label: "Zoom / restore window", category: "Window", scope: "global", chords: [], origin: "existing" },
		{ id: "window.files", label: "Focus project files", category: "Window", scope: "global", chords: [], origin: "existing" },
		{ id: "window.agent", label: "Focus agent output", category: "Window", scope: "global", chords: [], origin: "existing" },
		{ id: "window.input", label: "Focus message input", category: "Window", scope: "global", chords: [], origin: "existing" },
		{ id: "window.tile", label: "Tile windows", category: "Window", scope: "global", chords: [], origin: "existing" },

		// --- Composer (scope: the message input has the focus) ---------------
		{ id: "composer.send", label: "Send message", category: "Composer", scope: "composer", chords: ["Enter"], origin: "raycast" },
		{ id: "composer.newline", label: "Newline", category: "Composer", scope: "composer", chords: ["Shift+Enter"], origin: "raycast" },
		{ id: "composer.sendAlternate", label: "Alternate send", category: "Composer", scope: "composer", chords: ["Mod+Enter"], origin: "raycast" },
		{ id: "composer.cancel", label: "Cancel / stop generation", category: "Composer", scope: "composer", chords: ["Escape"], origin: "existing" },
		{ id: "composer.historyPrev", label: "Previous message", category: "Composer", scope: "composer", chords: ["ArrowUp"], origin: "raycast" },
		{ id: "composer.historyNext", label: "Next message", category: "Composer", scope: "composer", chords: ["ArrowDown"], origin: "raycast" },
		// Ctrl+W deletes the word before the cursor in the composer. Outside the
		// composer it is the prefix of the window-motion sequences
		// ("Ctrl+W,H"), so the two never collide: their scopes are disjoint.
		{ id: "edit.deleteWord", label: "Delete word before cursor", category: "Composer", scope: "composer", chords: ["Ctrl+W"], origin: "existing" },

		// --- Normal mode (scope: the composer does NOT have the focus) ------
		{ id: "nav.down", label: "Move down", category: "Normal mode", scope: "normal", chords: ["J"], origin: "existing" },
		{ id: "nav.up", label: "Move up", category: "Normal mode", scope: "normal", chords: ["K"], origin: "existing" },
		{ id: "nav.left", label: "Collapse / parent", category: "Normal mode", scope: "normal", panes: ["tree"], chords: ["H"], origin: "existing" },
		{ id: "nav.right", label: "Expand / child", category: "Normal mode", scope: "normal", panes: ["tree"], chords: ["L"], origin: "existing" },
		{ id: "nav.top", label: "Jump to top", category: "Normal mode", scope: "normal", chords: ["G,G"], origin: "existing" },
		// The app's "jump to bottom" is the SHIFTED G (e.key "G"), while the
		// unmodified G key starts the "gg" sequence — the key derivation of
		// §C.2 uses the physical key, so the two must not share a chord.
		{ id: "nav.bottom", label: "Jump to bottom", category: "Normal mode", scope: "normal", chords: ["Shift+G"], origin: "existing" },
		{ id: "nav.insert", label: "Insert mode (focus input)", category: "Normal mode", scope: "normal", chords: ["I"], origin: "existing" },
		{ id: "nav.commandLine", label: "Command line (prefill /)", category: "Normal mode", scope: "normal", chords: [":"], origin: "existing" },
		{ id: "nav.find", label: "Find file in tree", category: "Normal mode", scope: "normal", chords: ["/"], origin: "existing" },
		{ id: "nav.help", label: "Help", category: "Normal mode", scope: "normal", chords: ["?"], origin: "existing" },

		// --- Pane navigation -------------------------------------------------
		{ id: "tree.up", label: "Tree: move up", category: "Navigation", scope: "tree", chords: ["ArrowUp"], origin: "existing" },
		{ id: "tree.down", label: "Tree: move down", category: "Navigation", scope: "tree", chords: ["ArrowDown"], origin: "existing" },
		{ id: "tree.pageUp", label: "Tree: page up", category: "Navigation", scope: "tree", chords: ["PageUp"], origin: "existing" },
		{ id: "tree.pageDown", label: "Tree: page down", category: "Navigation", scope: "tree", chords: ["PageDown"], origin: "existing" },
		{ id: "tree.home", label: "Tree: jump to top", category: "Navigation", scope: "tree", chords: ["Home"], origin: "existing" },
		{ id: "tree.end", label: "Tree: jump to bottom", category: "Navigation", scope: "tree", chords: ["End"], origin: "existing" },
		{ id: "tree.open", label: "Tree: open", category: "Navigation", scope: "tree", chords: ["Enter"], origin: "existing" },
		{ id: "tree.escape", label: "Tree: leave the tree", category: "Navigation", scope: "tree", chords: ["Escape"], origin: "existing" },
		{ id: "agent.up", label: "Agent: move up", category: "Navigation", scope: "agent", chords: ["ArrowUp"], origin: "existing" },
		{ id: "agent.down", label: "Agent: move down", category: "Navigation", scope: "agent", chords: ["ArrowDown"], origin: "existing" },
		{ id: "agent.pageUp", label: "Agent: page up", category: "Navigation", scope: "agent", chords: ["PageUp"], origin: "existing" },
		{ id: "agent.pageDown", label: "Agent: page down", category: "Navigation", scope: "agent", chords: ["PageDown"], origin: "existing" },
		{ id: "agent.home", label: "Agent: jump to top", category: "Navigation", scope: "agent", chords: ["Home"], origin: "existing" },
		{ id: "agent.end", label: "Agent: jump to bottom", category: "Navigation", scope: "agent", chords: ["End"], origin: "existing" },
		{ id: "agent.focusInput", label: "Agent: focus the message input", category: "Navigation", scope: "agent", chords: ["Enter"], origin: "existing" },
		{ id: "agent.escape", label: "Agent: leave the agent pane", category: "Navigation", scope: "agent", chords: ["Escape"], origin: "existing" },

		// --- Tools and options ----------------------------------------------
		{ id: "tools.stats", label: "Session statistics…", category: "Tools", scope: "global", chords: [], origin: "existing" },
		{ id: "tools.rename", label: "Rename session…", category: "Tools", scope: "global", chords: [], origin: "existing" },
		{ id: "tools.env", label: "Environment & system info…", category: "Tools", scope: "global", chords: [], origin: "existing" },
		{ id: "opt.keys", label: "Configure API keys & providers…", category: "Options", scope: "global", chords: [], origin: "existing" },
		{ id: "opt.addModel", label: "Add custom model…", category: "Options", scope: "global", chords: [], origin: "existing" },
		{ id: "opt.reloadModels", label: "Reload models list", category: "Options", scope: "global", chords: [], origin: "existing" },
		{ id: "opt.compaction", label: "Auto-compaction on/off", category: "Options", scope: "global", chords: [], origin: "existing" },
		{ id: "opt.retry", label: "Auto-retry on error", category: "Options", scope: "global", chords: [], origin: "existing" },
		{ id: "opt.steering", label: "Steering delivery mode…", category: "Options", scope: "global", chords: [], origin: "existing" },
		{ id: "opt.followUp", label: "Follow-up delivery mode…", category: "Options", scope: "global", chords: [], origin: "existing" },

		// --- Help ------------------------------------------------------------
		{ id: "help.guide", label: "Pi & IDE Guide…", category: "Help", scope: "global", chords: [], origin: "existing" },
		{ id: "help.about", label: "About…", category: "Help", scope: "global", chords: [], origin: "existing" },
	];

	/**
	 * Action IDs the app's menus use that differ from the registry IDs. The
	 * registry keeps the canonical ID; the alias lets the menu look the chord up
	 * under the name it already uses.
	 */
	const ALIASES = {
		"tools.model": "agent.model",
		"search.find": "search.findFile",
		"agent.cycle": "agent.cycleModel",
		"run.abort": "edit.copyOrAbort",
		"help.show": "app.help",
	};

	// -----------------------------------------------------------------------
	// The chord grammar
	// -----------------------------------------------------------------------

	/**
	 * The named keys — the same list the Rust side validates against
	 * (`src-tauri/src/config.rs`, `NAMED_KEYS`).
	 */
	const NAMED_KEYS = {
		enter: "Enter",
		escape: "Escape",
		tab: "Tab",
		backspace: "Backspace",
		delete: "Delete",
		space: "Space",
		home: "Home",
		end: "End",
		pageup: "PageUp",
		pagedown: "PageDown",
		arrowup: "ArrowUp",
		arrowdown: "ArrowDown",
		arrowleft: "ArrowLeft",
		arrowright: "ArrowRight",
		f1: "F1", f2: "F2", f3: "F3", f4: "F4", f5: "F5", f6: "F6",
		f7: "F7", f8: "F8", f9: "F9", f10: "F10", f11: "F11", f12: "F12",
	};

	let platformOverride = null;

	/** "mac" on macOS, "other" everywhere else. */
	function detectPlatform() {
		const nav = typeof navigator !== "undefined" ? navigator : null;
		const probe = (nav && (nav.platform || nav.userAgent)) || "";
		return /Mac/i.test(probe) ? "mac" : "other";
	}

	/** The platform used for `Mod` expansion. */
	function currentPlatform() {
		return platformOverride || detectPlatform();
	}

	/**
	 * Force the platform ("mac" | "other") — used by the tests. Pass null to
	 * go back to auto-detection.
	 */
	function setPlatform(value) {
		platformOverride = value === "mac" || value === "other" ? value : null;
		return currentPlatform();
	}

	/** Split a chord into its modifier parts and its key part. */
	function splitChord(text) {
		if (typeof text !== "string") return null;
		const s = text.trim();
		if (!s) return null;
		// "Mod++" — the key itself is a plus sign.
		if (s.endsWith("++")) {
			const head = s.slice(0, -2);
			const mods = head ? head.split("+") : [];
			if (mods.some((m) => m === "")) return null;
			return { mods, key: "+" };
		}
		const cut = s.lastIndexOf("+");
		if (cut < 0) return { mods: [], key: s };
		const mods = s.slice(0, cut).split("+");
		if (mods.some((m) => m === "")) return null;
		return { mods, key: s.slice(cut + 1) };
	}

	/** The canonical form of a key: a named key, an uppercase letter, a digit or a symbol. */
	function canonicalKey(raw) {
		if (typeof raw !== "string" || raw === "") return null;
		if (raw === "+") return "+";
		if (raw === " ") return "Space";
		const named = NAMED_KEYS[raw.toLowerCase()];
		if (named) return named;
		if (raw.length === 1) return /[a-z]/.test(raw) ? raw.toUpperCase() : raw;
		return null;
	}

	/**
	 * Parse a chord string.
	 *
	 * @param {string} str e.g. "Mod+Shift+M"
	 * @param {string} [plat] "mac" | "other" (default: the detected platform)
	 * @returns {Object|null} { mods: {ctrl, alt, shift, meta} (Mod expanded),
	 *   key, primary ("Mod"|"Ctrl"|"Meta"|null), raw } — or null when the chord
	 *   is malformed.
	 */
	function parseChord(str, plat) {
		const parts = splitChord(str);
		if (!parts) return null;

		let primary = null;
		let alt = false;
		let shift = false;
		let ctrl = false;
		let meta = false;

		for (const raw of parts.mods) {
			const m = raw.toLowerCase();
			if (m === "alt") {
				if (alt) return null;
				alt = true;
			} else if (m === "shift") {
				if (shift) return null;
				shift = true;
			} else if (m === "ctrl") {
				if (primary) return null; // at most one primary modifier
				primary = "Ctrl";
				ctrl = true;
			} else if (m === "meta") {
				if (primary) return null;
				primary = "Meta";
				meta = true;
			} else if (m === "mod") {
				if (primary) return null;
				primary = "Mod";
			} else {
				return null; // unknown modifier
			}
		}

		const key = canonicalKey(parts.key);
		if (!key) return null;

		// The shift state of a symbol key is already encoded in the symbol
		// itself (`Shift+/` is the `?` key), so the modifier is dropped — this
		// keeps the stored chord equal to the chord a key event derives. (The
		// Rust side does exactly the same.)
		if (shift && key.length === 1 && !/^[A-Za-z0-9]$/.test(key)) shift = false;

		const mods = { ctrl, alt, shift, meta };
		if (primary === "Mod") {
			if ((plat || currentPlatform()) === "mac") mods.meta = true;
			else mods.ctrl = true;
		}

		return { mods, key, primary, raw: String(str).trim() };
	}

	/** Serialise a parsed chord back into its canonical form. */
	function serializeChord(chord) {
		if (!chord) return null;
		const parts = [];
		if (chord.primary === "Mod") parts.push("Mod");
		else if (chord.primary === "Ctrl") parts.push("Ctrl");
		else if (chord.primary === "Meta") parts.push("Meta");
		if (chord.mods.alt) parts.push("Alt");
		if (chord.mods.shift) parts.push("Shift");
		parts.push(chord.key);
		return parts.join("+");
	}

	/**
	 * The canonical, order-independent form of a chord.
	 *
	 * @param {string} str
	 * @param {string} [plat]
	 * @returns {string|null} e.g. "Mod+Shift+M" — or null when malformed.
	 */
	function normalizeChord(str, plat) {
		const chord = parseChord(str, plat);
		return chord ? serializeChord(chord) : null;
	}

	/**
	 * Split a binding into the parts of a sequence.
	 *
	 * A comma is a sequence separator UNLESS it directly follows a `+` — that
	 * way `Ctrl+,` (bind the comma key) survives. A bare single character is
	 * always a key, never a sequence. (The Rust side does exactly the same.)
	 */
	function splitSequence(text) {
		if (typeof text !== "string") return [];
		if (!text.includes("+") && text.length === 1) return [text];
		const parts = [];
		let start = 0;
		let prev = "";
		for (let i = 0; i < text.length; i++) {
			const ch = text[i];
			if (ch === "," && prev !== "+") {
				parts.push(text.slice(start, i));
				start = i + 1;
			}
			prev = ch;
		}
		parts.push(text.slice(start));
		return parts;
	}

	/**
	 * The canonical form of a binding: a chord, or a two-key sequence written
	 * with a comma ("Ctrl+W,H").
	 */
	function normalizeBinding(str, plat) {
		if (typeof str !== "string" || !str.trim()) return null;
		const parts = splitSequence(str.trim());
		if (!parts.length || parts.some((p) => !p.trim())) return null;
		const normalised = parts.map((p) => normalizeChord(p, plat));
		if (normalised.some((p) => !p)) return null;
		return normalised.join(",");
	}

	/** Parse a binding into its chords. */
	function parseBinding(str, plat) {
		if (typeof str !== "string" || !str.trim()) return [];
		const out = [];
		for (const part of splitSequence(str.trim())) {
			const chord = parseChord(part, plat);
			if (!chord) return [];
			out.push(chord);
		}
		return out;
	}

	/**
	 * The display form of a chord: "⌘K" on macOS, "Ctrl+K" everywhere else.
	 *
	 * @param {string|Object} value a chord string or a parsed chord
	 * @param {string} [plat]
	 */
	function formatChord(value, plat) {
		const chord = typeof value === "string" ? parseChord(value, plat) : value;
		if (!chord) return "";
		const mods = chord.mods || {};
		if ((plat || currentPlatform()) === "mac") {
			let out = "";
			if (mods.meta) out += "⌘";
			if (mods.alt) out += "⌥";
			if (mods.shift) out += "⇧";
			if (mods.ctrl) out += "⌃";
			return out + chord.key;
		}
		let out = "";
		if (mods.ctrl) out += "Ctrl+";
		else if (mods.meta) out += "Meta+";
		if (mods.alt) out += "Alt+";
		if (mods.shift) out += "Shift+";
		return out + chord.key;
	}

	/** The display form of a binding (a sequence is comma-separated). */
	function formatBinding(value, plat) {
		if (typeof value !== "string") return formatChord(value, plat);
		return splitSequence(value.trim()).map((part) => formatChord(part, plat)).join(",");
	}

	/**
	 * The display labels of a chord set, de-duplicated.
	 *
	 * `Mod` expands to `Ctrl` off macOS, so a registry entry like
	 * `["Mod+C", "Ctrl+C"]` would render as "Ctrl+C / Ctrl+C". The *stored*
	 * chords keep both spellings (they are meaningful on macOS), but the
	 * label collapses: the two spellings are the same key there.
	 *
	 * Every surface that renders a chord set goes through this helper, so
	 * they can never disagree.
	 *
	 * @param {string[]} chords
	 * @param {string} [plat]
	 * @returns {string[]}
	 */
	function formatChordSet(chords, plat) {
		const seen = new Set();
		const out = [];
		for (const chord of Array.isArray(chords) ? chords : []) {
			const label = formatBinding(chord, plat);
			if (!label || seen.has(label)) continue;
			seen.add(label);
			out.push(label);
		}
		return out;
	}

	// -----------------------------------------------------------------------
	// Keyboard events → chords
	// -----------------------------------------------------------------------

	/**
	 * The key of a keyboard event.
	 *
	 * 1. a named key → that name;
	 * 2. `Key([A-Z])` → the uppercase letter (the physical key, not the
	 *    produced character);
	 * 3. `Digit([0-9])` → the digit;
	 * 4. a single printable character → that character;
	 * 5. otherwise → `e.key` verbatim.
	 */
	function deriveKey(event) {
		if (!event) return null;
		const key = event.key;
		if (typeof key !== "string" || key === "") return null;
		if (key === " ") return "Space";
		const named = NAMED_KEYS[key.toLowerCase()];
		if (named) return named;
		const code = typeof event.code === "string" ? event.code : "";
		const letter = /^Key([A-Za-z])$/.exec(code);
		if (letter) return letter[1].toUpperCase();
		const digit = /^Digit([0-9])$/.exec(code);
		if (digit) return digit[1];
		if (key.length === 1) return key;
		return key;
	}

	/**
	 * The canonical chord of a keyboard event: a modifier set plus a key.
	 *
	 * `Shift` is a modifier for letters, digits and named keys — for a symbol
	 * the produced character already encodes the shift (`Shift+/` is `?`), so
	 * the shift is dropped there.
	 */
	function eventChord(event) {
		if (!event) return null;
		const key = deriveKey(event);
		if (!key) return null;
		const mods = {
			ctrl: !!event.ctrlKey,
			alt: !!event.altKey,
			shift: !!event.shiftKey,
			meta: !!event.metaKey,
		};
		if (mods.shift && key.length === 1 && !/^[A-Z0-9]$/.test(key)) mods.shift = false;
		let primary = null;
		if (mods.ctrl) primary = "Ctrl";
		else if (mods.meta) primary = "Meta";
		return { mods, key, primary, raw: key };
	}

	/** True when two chords match exactly (all modifiers and the key). */
	function sameChord(a, b) {
		if (!a || !b) return false;
		if (a.key !== b.key) return false;
		return a.mods.ctrl === b.mods.ctrl && a.mods.alt === b.mods.alt
			&& a.mods.shift === b.mods.shift && a.mods.meta === b.mods.meta;
	}

	// -----------------------------------------------------------------------
	// Overrides
	// -----------------------------------------------------------------------

	/** User overrides, keyed by action id. */
	let overrides = {};

	/**
	 * The default chords of the actions the "app settings" tier configures
	 * (the send key and the newline key of the composer).
	 *
	 * They are *defaults*, not rebindings: they replace the registry default,
	 * while an explicit rebinding of the keybindings tier still wins.
	 */
	let defaults = {};

	/** The registry index. */
	const BY_ID = new Map();
	for (const action of ACTIONS) BY_ID.set(action.id, action);

	/** The canonical ID of an action (resolving the menu aliases). */
	function resolveAlias(actionId) {
		return Object.prototype.hasOwnProperty.call(ALIASES, actionId) ? ALIASES[actionId] : actionId;
	}

	/** The registry entry of an action id (resolving the menu aliases). */
	function actionById(actionId) {
		if (typeof actionId !== "string") return null;
		return BY_ID.get(resolveAlias(actionId)) || null;
	}

	/**
	 * Apply the user's keybinding overrides.
	 *
	 * @param {Object} settings `{ "<action.id>": ["Chord", …] }` — an unknown
	 *   action id is ignored, a malformed chord is dropped.
	 */
	function applyOverrides(settings) {
		const next = {};
		if (settings && typeof settings === "object" && !Array.isArray(settings)) {
			for (const [id, chords] of Object.entries(settings)) {
				const action = BY_ID.get(resolveAlias(id));
				if (!action) continue; // unknown action id — never break the app
				if (!Array.isArray(chords)) continue;
				const list = [];
				for (const chord of chords) {
					const normalised = normalizeBinding(chord);
					if (normalised) list.push(normalised);
				}
				// An override that holds nothing but malformed chords is
				// rejected: the action keeps its default. An empty list is a
				// deliberate "unbind".
				if (!list.length && chords.length) continue;
				next[action.id] = list;
			}
		}
		overrides = next;
	}

	/** A copy of the current overrides. */
	function currentOverrides() {
		const out = {};
		for (const [id, chords] of Object.entries(overrides)) out[id] = chords.slice();
		return out;
	}

	/**
	 * Replace the DEFAULT chords of an action.
	 *
	 * The "app settings" tier (`app.settings.json`) holds settings that are
	 * not rebindings but defaults — the send key and the newline key of the
	 * composer. They replace the registry default; an explicit rebinding of
	 * the keybindings tier still wins over them.
	 *
	 * @param {Object} defaultsById `{ "<action.id>": ["Chord", …] }`
	 */
	function applyDefaults(defaultsById) {
		const next = {};
		if (defaultsById && typeof defaultsById === "object" && !Array.isArray(defaultsById)) {
			for (const [id, chords] of Object.entries(defaultsById)) {
				const action = BY_ID.get(resolveAlias(id));
				if (!action) continue;
				const list = [];
				for (const chord of Array.isArray(chords) ? chords : [chords]) {
					const normalised = normalizeBinding(chord);
					if (normalised) list.push(normalised);
				}
				// An empty or malformed list leaves the registry default alone.
				if (list.length) next[action.id] = list;
			}
		}
		defaults = next;
	}

	/** A copy of the current app-settings defaults. */
	function currentDefaults() {
		const out = {};
		for (const [id, chords] of Object.entries(defaults)) out[id] = chords.slice();
		return out;
	}

	/**
	 * The chords currently bound to an action: the user's override when there
	 * is one, the app-settings default when there is one, the registry
	 * default otherwise.
	 *
	 * A registry chord that an app-settings default has taken over is
	 * dropped: the registry keeps exactly one owner per chord per scope, and
	 * the configured key wins.
	 *
	 * @param {string} actionId
	 * @returns {string[]}
	 */
	function chordsFor(actionId) {
		const action = actionById(actionId);
		if (!action) return [];
		if (Object.prototype.hasOwnProperty.call(overrides, action.id)) return overrides[action.id].slice();
		if (Object.prototype.hasOwnProperty.call(defaults, action.id)) return defaults[action.id].slice();
		const list = action.chords.map((c) => normalizeBinding(c)).filter(Boolean);
		return list.filter((c) => !defaultCollides(action, c));
	}

	/**
	 * The registry chords of an action — the chords of the registry entry,
	 * normalised. This is the lowest tier of ownership: the chords an action
	 * has when neither the keybindings tier nor the app-settings tier says
	 * anything about it.
	 *
	 * @param {string} actionId
	 * @returns {string[]}
	 */
	function registryChordsFor(actionId) {
		const action = actionById(actionId);
		if (!action) return [];
		return action.chords.map((c) => normalizeBinding(c)).filter(Boolean);
	}

	/**
	 * The app-settings chords of an action (`app.settings.json` → `sendKey` /
	 * `newlineKey`), or an empty list when the app tier says nothing about it.
	 *
	 * @param {string} actionId
	 * @returns {string[]}
	 */
	function defaultChordsFor(actionId) {
		const action = actionById(actionId);
		if (!action) return [];
		if (!Object.prototype.hasOwnProperty.call(defaults, action.id)) return [];
		return defaults[action.id].slice();
	}

	/**
	 * The effective DEFAULT of an action: the app-settings value when there is
	 * one, the registry chord otherwise.
	 *
	 * "Reset to default" restores THIS — not the registry chord, which would
	 * shadow the app tier and lose the configured send key for good.
	 *
	 * @param {string} actionId
	 * @returns {Object} `{ source: "app"|"registry", chords: string[] }`
	 */
	function effectiveDefaultFor(actionId) {
		const action = actionById(actionId);
		if (!action) return { source: "registry", chords: [] };
		const app = defaultChordsFor(action.id);
		if (app.length) return { source: "app", chords: app };
		const chords = registryChordsFor(action.id).filter((c) => !defaultCollides(action, c));
		return { source: "registry", chords };
	}

	/**
	 * The action whose app-settings default has taken this chord away.
	 *
	 * Only a default of an action in the SAME scope can take a chord away —
	 * the composer and the panes are live at different times.
	 *
	 * @param {Object} action the registry entry
	 * @param {string} chord
	 * @returns {Object|null} the registry entry of the owner
	 */
	function defaultOwner(action, chord) {
		for (const [id, list] of Object.entries(defaults)) {
			if (id === action.id) continue;
			const other = BY_ID.get(id);
			if (!other) continue;
			if (!scopesOverlap(action, other)) continue;
			for (const candidate of list) {
				if (sameBinding(candidate, chord)) return other;
			}
		}
		return null;
	}

	/**
	 * Has an app-settings default taken this chord away from the action?
	 *
	 * @param {Object} action the registry entry
	 * @param {string} chord
	 * @returns {boolean}
	 */
	function defaultCollides(action, chord) {
		return !!defaultOwner(action, chord);
	}

	/**
	 * The actions whose registry chord an app-settings default has taken away.
	 *
	 * The app tier may configure a chord that another action of the SAME scope
	 * owns (with `sendKey: "Escape"` the "Cancel / stop generation" action
	 * loses its chord). The registry keeps exactly one owner per chord per
	 * scope, so the registry chord is dropped — but the user has to learn
	 * about it, or the action simply shows "(unbound)".
	 *
	 * @returns {Object[]} `{ actionId, label, chord, ownerId, ownerLabel }`
	 */
	function defaultCollisions() {
		const out = [];
		for (const action of ACTIONS) {
			// An action with an app-settings default of its own does not own its
			// registry chords at all — nothing was taken away from it.
			if (Object.prototype.hasOwnProperty.call(defaults, action.id)) continue;
			for (const chord of registryChordsFor(action.id)) {
				const owner = defaultOwner(action, chord);
				if (!owner) continue;
				out.push({
					actionId: action.id,
					label: action.label,
					chord,
					ownerId: owner.id,
					ownerLabel: owner.label,
				});
			}
		}
		return out;
	}

	/**
	 * Do the two bindings name the same chord (or the same sequence)?
	 *
	 * @param {string} a
	 * @param {string} b
	 * @param {string} [plat]
	 * @returns {boolean}
	 */
	function sameBinding(a, b, plat) {
		const first = parseBinding(a, plat);
		const second = parseBinding(b, plat);
		if (!first.length || first.length !== second.length) return false;
		return first.every((chord, i) => sameChord(chord, second[i]));
	}

	/**
	 * The chord of an action that is spelled out explicitly — the one written
	 * with `Ctrl` or `Meta` instead of the platform-dependent `Mod` alias.
	 *
	 * It is the same chord on every platform, so it is the one to advertise
	 * when the meaning of a row is the platform-independent one: the abort
	 * rows show `Ctrl+C` (the chord that always aborts) and not `Mod+C`
	 * (which copies the selection when there is one).
	 *
	 * @param {string} actionId
	 * @returns {string} the chord, or "" when the action is unbound
	 */
	function explicitChord(actionId) {
		const chords = chordsFor(actionId);
		for (const chord of chords) {
			const parsed = parseChord(chord);
			if (parsed && parsed.primary && parsed.primary !== "Mod") return chord;
		}
		return chords.length ? chords[0] : "";
	}

	// -----------------------------------------------------------------------
	// Resolution
	// -----------------------------------------------------------------------

	function scopeMatches(scope, focus) {
		if (scope === "global") return true;
		if (scope === "composer") return focus === "input";
		if (scope === "normal") return focus !== "input";
		if (scope === "tree") return focus === "tree";
		if (scope === "agent") return focus === "agent";
		return false;
	}

	/** Is the action's scope active in the current context? */
	function scopeActive(action, ctx) {
		const focus = (ctx && ctx.focus) || "agent";
		if (action.panes && action.panes.length && !action.panes.includes(focus)) return false;
		const scopes = Array.isArray(action.scope) ? action.scope : [action.scope || "global"];
		return scopes.some((scope) => scopeMatches(scope, focus));
	}

	/** The scopes of an action (always an array). */
	function scopesOf(action) {
		if (!action) return [];
		return Array.isArray(action.scope) ? action.scope.slice() : [action.scope || "global"];
	}

	/**
	 * The scopes an action really lives in.
	 *
	 * An action that is restricted to panes (the tree-only vim motions) lives
	 * in those panes, not in the "normal mode" scope.
	 */
	function effectiveScopes(action) {
		const panes = (action && action.panes) || [];
		if (panes.length) return panes.slice();
		return scopesOf(action);
	}

	/**
	 * The specificity of an action's scope.
	 *
	 * When two actions could match the same key, the more specific one wins:
	 * the composer (it has the focus), then the panes, then the normal mode
	 * and last the global scope (which is live everywhere). That is what makes
	 * a global action and a composer action able to share a chord without
	 * fighting over it.
	 */
	function scopeRank(action) {
		let best = 0;
		for (const scope of effectiveScopes(action)) {
			const rank = scope === "composer" ? 4 : (scope === "tree" || scope === "agent") ? 3 : scope === "normal" ? 2 : 1;
			if (rank > best) best = rank;
		}
		return best;
	}

	/**
	 * Can the two actions be live at the same time?
	 *
	 * Two actions of the same scope can — they are both live in that scope —
	 * so a chord one of them owns is a conflict. Actions of *different*
	 * scopes never are: the more specific scope wins, so a global action and
	 * a composer action never fire for the same key.
	 */
	function scopesOverlap(a, b) {
		const sa = effectiveScopes(a);
		for (const scope of effectiveScopes(b)) if (sa.includes(scope)) return true;
		return false;
	}

	/**
	 * A bare (unmodified) single-character chord is only ever matched by an
	 * action that is inactive while the composer has the focus, so typing in
	 * the composer is never swallowed. That is the normal scope and the pane
	 * scopes (tree / agent) — never a global or a composer action.
	 *
	 * The shortcuts editor uses this to REFUSE such a binding: a global
	 * action that owns a bare letter could never fire, and the user would be
	 * left without the key they just gave up.
	 *
	 * @param {Object} action the registry entry
	 * @param {Object} chord a parsed chord
	 * @returns {boolean}
	 */
	function bareAllowed(action, chord) {
		if (!action || !chord) return false;
		const bare = !chord.mods.ctrl && !chord.mods.alt && !chord.mods.shift && !chord.mods.meta
			&& chord.key.length === 1;
		if (!bare) return true;
		const scopes = effectiveScopes(action);
		return scopes.includes("normal") || scopes.includes("tree") || scopes.includes("agent");
	}

	/**
	 * Resolve a keyboard event to at most one action.
	 *
	 * When more than one action could match, the most specific scope wins
	 * (the composer, then a pane, then the normal mode, then the global
	 * scope) and the registry order breaks the tie. That is what lets a
	 * global action and a composer action share a chord: the composer keeps
	 * it while the composer has the focus, the global action owns it
	 * everywhere else.
	 *
	 * @param {Object} event a KeyboardEvent (or anything with the same shape)
	 * @param {Object} ctx `{ focus, overlayOpen, menuOpen, pendingChord }`
	 * @returns {Object|null} `{ actionId, chord }` — with `pending: true` and
	 *   `prefix` when the event is the first chord of a sequence.
	 */
	function resolve(event, ctx) {
		const context = ctx || {};
		if (context.overlayOpen || context.menuOpen) return null; // the overlay owns the keyboard
		const chord = eventChord(event);
		if (!chord) return null;

		// The second key of a sequence: only the chords that continue the
		// pending prefix may match.
		if (context.pendingChord) {
			let best = null;
			let bestRank = 0;
			for (const action of ACTIONS) {
				if (!scopeActive(action, context)) continue;
				for (const binding of chordsFor(action.id)) {
					const seq = parseBinding(binding);
					if (seq.length !== 2) continue;
					if (serializeChord(seq[0]) !== context.pendingChord) continue;
					if (!sameChord(seq[1], chord)) continue;
					if (!bareAllowed(action, chord)) continue;
					const rank = scopeRank(action);
					if (best && rank <= bestRank) continue;
					best = { actionId: action.id, chord: binding, sequence: binding };
					bestRank = rank;
				}
			}
			return best;
		}

		// An exact match wins over a sequence prefix.
		let best = null;
		let bestRank = 0;
		for (const action of ACTIONS) {
			if (!scopeActive(action, context)) continue;
			for (const binding of chordsFor(action.id)) {
				const seq = parseBinding(binding);
				if (seq.length !== 1) continue;
				if (!sameChord(seq[0], chord)) continue;
				if (!bareAllowed(action, chord)) continue;
				const rank = scopeRank(action);
				if (best && rank <= bestRank) continue;
				best = { actionId: action.id, chord: binding };
				bestRank = rank;
			}
		}
		if (best) return best;

		// The first chord of a sequence: the renderer waits for the next key.
		let prefix = null;
		let prefixRank = 0;
		for (const action of ACTIONS) {
			if (!scopeActive(action, context)) continue;
			for (const binding of chordsFor(action.id)) {
				const seq = parseBinding(binding);
				if (seq.length < 2) continue;
				if (!sameChord(seq[0], chord)) continue;
				if (!bareAllowed(action, chord)) continue;
				const rank = scopeRank(action);
				if (prefix && rank <= prefixRank) continue;
				prefix = { actionId: action.id, chord: binding, pending: true, prefix: serializeChord(seq[0]) };
				prefixRank = rank;
			}
		}

		return prefix;
	}

	/**
	 * Is the action bound to this keyboard event?
	 *
	 * @param {string} actionId
	 * @param {Object} event
	 * @param {Object} [ctx]
	 */
	function isBound(actionId, event, ctx) {
		const id = resolveAlias(actionId);
		const hit = resolve(event, ctx);
		return !!hit && hit.actionId === id;
	}

	/**
	 * The action that already owns a chord — the conflict check of the
	 * shortcuts editor. The comparison uses the EXPANDED chord, so `Mod+F` and
	 * `Ctrl+F` collide on Windows but not on macOS.
	 *
	 * The scope matters too: two actions that can never be live at the same
	 * time do not conflict. A global action may therefore take a chord that a
	 * composer action owns — the composer wins while the composer has the
	 * focus (see `scopeRank`), the global action owns the key everywhere else.
	 * Two actions of the same scope (or of two scopes that overlap) still
	 * conflict and are named.
	 *
	 * Without an action id the search answers the other question — "who owns
	 * this chord?" — and reports the first owner it finds.
	 *
	 * @param {string} binding a chord or a sequence
	 * @param {string} [actionId] the action being rebound (excluded from the search)
	 * @param {string} [plat]
	 * @returns {Object|null} `{ actionId, chord }` of the owner
	 */
	function findConflict(binding, actionId, plat) {
		const target = parseBinding(binding, plat);
		if (!target.length) return null;
		const skip = actionId ? resolveAlias(actionId) : null;
		const subject = skip ? actionById(skip) : null;
		for (const action of ACTIONS) {
			if (skip && action.id === skip) continue;
			// The two actions must be able to be live at the same time.
			if (subject && !scopesOverlap(subject, action)) continue;
			for (const candidate of chordsFor(action.id)) {
				const seq = parseBinding(candidate, plat);
				if (seq.length !== target.length) continue;
				let equal = true;
				for (let i = 0; i < seq.length; i++) {
					if (!sameChord(seq[i], target[i])) { equal = false; break; }
				}
				if (equal) return { actionId: action.id, chord: candidate };
			}
		}
		return null;
	}

	/**
	 * Can this action own this binding at all?
	 *
	 * A bare (unmodified) single-character chord is only ever matched by an
	 * action that is inactive while the composer has the focus, so a global or
	 * a composer action could never own one: the recorder has to refuse it
	 * instead of writing a binding that would never fire.
	 *
	 * @param {Object} action the registry entry
	 * @param {string} binding a chord or a sequence
	 * @param {string} [plat]
	 * @returns {boolean}
	 */
	function bindingAllowed(action, binding, plat) {
		if (!action) return false;
		const seq = parseBinding(binding, plat);
		if (!seq.length) return false;
		return seq.every((chord) => bareAllowed(action, chord));
	}

	/**
	 * Check a binding before it is written: can the action own it, and does
	 * another action already own it?
	 *
	 * @param {string} actionId the action being rebound
	 * @param {string} binding a chord or a sequence
	 * @param {string} [plat]
	 * @returns {Object} `{ ok: true }` or `{ ok: false, reason, conflict }`
	 *   — `reason` is "malformed", "bare" or "conflict"
	 */
	function validateBinding(actionId, binding, plat) {
		const action = actionById(actionId);
		if (!action) return { ok: false, reason: "unknown", conflict: null };
		const seq = parseBinding(binding, plat);
		if (!seq.length) return { ok: false, reason: "malformed", conflict: null };
		if (!bindingAllowed(action, binding, plat)) {
			return { ok: false, reason: "bare", conflict: null };
		}
		const conflict = findConflict(binding, action.id, plat);
		if (conflict) return { ok: false, reason: "conflict", conflict };
		return { ok: true, conflict: null };
	}

	return {
		ACTIONS,
		ALIASES,
		NAMED_KEYS,
		parseChord,
		normalizeChord,
		normalizeBinding,
		parseBinding,
		serializeChord,
		formatChord,
		formatBinding,
		formatChordSet,
		deriveKey,
		eventChord,
		sameChord,
		detectPlatform,
		setPlatform,
		resolveAlias,
		actionById,
		applyOverrides,
		currentOverrides,
		applyDefaults,
		currentDefaults,
		chordsFor,
		registryChordsFor,
		defaultChordsFor,
		effectiveDefaultFor,
		defaultCollisions,
		explicitChord,
		scopeActive,
		scopesOf,
		effectiveScopes,
		scopeRank,
		scopesOverlap,
		sameBinding,
		bareAllowed,
		bindingAllowed,
		validateBinding,
		resolve,
		isBound,
		findConflict,
		get platform() { return currentPlatform(); },
	};
});
