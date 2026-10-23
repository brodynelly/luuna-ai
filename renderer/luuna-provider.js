/**
 * LUUNA-AI — the `window.luuna` bridge.
 *
 * The renderer only knows the `window.luuna` API. This shim installs it over
 * Tauri IPC: every method is a `luuna_*` command, and the event listeners
 * subscribe to the backend's push channels.
 */
(function () {
	"use strict";
	if (window.luuna) return; // a bridge is already installed
	if (!window.__TAURI__) return; // plain browser / not under Tauri
	window.__TAURI_MODE = true;
	const { invoke } = window.__TAURI__.core;
	const { listen } = window.__TAURI__.event;

	window.luuna = {
		boot: () => invoke("luuna_boot"),
		getState: () => invoke("luuna_get_state"),
		getStats: () => invoke("luuna_get_stats"),
		prompt: (text) => invoke("luuna_prompt", { text }),
		abort: () => invoke("luuna_abort"),
		runCommand: (command) => invoke("luuna_run_command", { command }),
		getModels: () => invoke("luuna_get_models"),
		reloadModels: () => invoke("luuna_reload_models"),
		setModel: (m) => invoke("luuna_set_model", { m }),
		cycleModel: () => invoke("luuna_cycle_model"),
		setThinkingLevel: (level) => invoke("luuna_set_thinking_level", { level }),
		cycleThinkingLevel: () => invoke("luuna_cycle_thinking_level"),
		setPlanMode: (on) => invoke("luuna_set_plan_mode", { on }),
		newSession: () => invoke("luuna_new_session"),
		setSessionName: (name) => invoke("luuna_set_session_name", { name }),
		compact: () => invoke("luuna_compact"),
		fork: () => invoke("luuna_fork"),
		clone: () => invoke("luuna_clone"),
		exportHtml: () => invoke("luuna_export_html"),
		getLastAssistantText: () => invoke("luuna_get_last_assistant_text"),
		toggleAutoCompaction: () => invoke("luuna_toggle_auto_compaction"),
		toggleAutoRetry: () => invoke("luuna_toggle_auto_retry"),
		toggleSteeringMode: () => invoke("luuna_toggle_steering_mode"),
		toggleFollowUpMode: () => invoke("luuna_toggle_follow_up_mode"),
		getTree: () => invoke("luuna_get_tree"),
		refreshGit: () => invoke("luuna_refresh_git"),
		readPreview: (filePath) => invoke("luuna_read_preview", { filePath }),
		gitDiff: () => invoke("luuna_git_diff"),
		gitStatus: () => invoke("luuna_git_status"),
		gitLog: () => invoke("luuna_git_log"),
		gitGrep: (query) => invoke("luuna_git_grep", { query }),
		saveSessionFile: (filename, content) => invoke("luuna_save_session_file", { filename, content }),
		changeDirectory: (newDir) => invoke("luuna_change_directory", { newDir }),
		getSessions: () => invoke("luuna_get_sessions"),
		openSession: (p) => invoke("luuna_open_session", { p }),
		getProviders: () => invoke("luuna_get_providers"),
		writeEnvKey: (envVar, value) => invoke("luuna_write_env_key", { envVar, value }),
		addCustomModel: (m) => invoke("luuna_add_custom_model", { m }),
		systemInfo: () => invoke("luuna_system_info"),
		copyToClipboard: (text) => invoke("luuna_copy_to_clipboard", { text }),
		showInFolder: (p) => invoke("luuna_show_in_folder", { p }),
		openFolder: (p) => invoke("luuna_open_folder", { p }),
		saveDialog: async (defaultName) => {
			const res = await invoke("luuna_save_dialog", { defaultName });
			if (res && typeof res === "object" && "success" in res) {
				return res.success && typeof res.data === "string" ? { canceled: false, path: res.data } : { canceled: true };
			}
			return res && res.canceled ? res : { canceled: true };
		},
		openDirDialog: async () => {
			const res = await invoke("luuna_open_dir_dialog");
			if (res && typeof res === "object" && "success" in res) {
				return res.success && typeof res.data === "string" ? { canceled: false, path: res.data } : { canceled: true };
			}
			return res && res.canceled ? res : { canceled: true };
		},
		contextMenu: () => invoke("luuna_context_menu"),
		exit: () => invoke("luuna_exit"),
		// Configuration — the `.luuna/` tiers, user themes and keybindings.
		getConfig: () => invoke("luuna_get_config"),
		// `replace` makes the value the whole file instead of a merge; it is
		// omitted rather than sent as `undefined`, which Tauri would reject.
		setConfig: (scope, file, value, replace) =>
			invoke("luuna_set_config", replace === undefined ? { scope, file, value } : { scope, file, value, replace }),
		listThemes: () => invoke("luuna_list_themes"),
		readTheme: (id) => invoke("luuna_read_theme", { id }),
		configPaths: () => invoke("luuna_config_paths"),
		on: (channel, listener) => {
			let unlisten = null;
			listen(channel, (event) => listener(event.payload)).then((u) => { unlisten = u; });
			return () => { if (unlisten) unlisten(); };
		},
	};

	// ------------------------------------------------------------------
	// Frameless window affordances
	//
	// Under Tauri the window is created with decorations:false, so the OS draws
	// no title bar and no caption buttons. The app draws no caption strip of its
	// own either — the DOS menu bar is the topmost element.
	//
	// That leaves one thing to wire: without any chrome the window would be
	// impossible to move or maximize, so the menu bar background becomes the drag
	// region (see renderer.css #menubar). Menu items opt out, so pressing one
	// still opens a menu rather than starting a drag.
	// ------------------------------------------------------------------

	function whenReady(fn) {
		if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once: true });
		else fn();
	}

	/** Resolve the Tauri window object, or null when the API is unavailable. */
	async function currentWindow() {
		try {
			const w = window.__TAURI__ && window.__TAURI__.window;
			if (!w) return null;
			// Tauri 2: getCurrentWindow(); Tauri 1: WebviewWindow.getCurrent().
			if (typeof w.getCurrentWindow === "function") return w.getCurrentWindow();
			if (typeof w.WebviewWindow === "function" && typeof w.WebviewWindow.getCurrent === "function") return w.WebviewWindow.getCurrent();
			return null;
		} catch (err) {
			return null;
		}
	}

	function wireWindowAffordances() {
		const bar = document.getElementById("menubar");
		if (!bar) return; // markup not present — nothing to wire

		/** True when the event landed on an actual menu item (not the bar itself). */
		const isMenuItem = (target) =>
			!!target && typeof target.closest === "function" && !!target.closest(".menu-item");

		const win = () => currentWindow();

		// Drag the window by the menu bar background. Deliberately not on
		// .menu-item, or a press on "File" would move the window instead of
		// opening the menu.
		bar.addEventListener("mousedown", async (e) => {
			if (e.button !== 0 || isMenuItem(e.target)) return;
			const w = await win();
			if (w && typeof w.startDragging === "function") {
				try { await w.startDragging(); } catch (err) { /* ignore */ }
			}
		});

		// Double-click the bar background toggles maximize, like a native caption.
		bar.addEventListener("dblclick", async (e) => {
			if (isMenuItem(e.target)) return;
			const w = await win();
			try {
				if (w && typeof w.toggleMaximize === "function") await w.toggleMaximize();
			} catch (err) { /* ignore */ }
		});
	}

	whenReady(wireWindowAffordances);
})();
