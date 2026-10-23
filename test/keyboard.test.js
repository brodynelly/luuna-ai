"use strict";
/**
 * LUUNA-AI — the renderer-level keyboard regression guard.
 *
 * The keymap unit tests (`test/keymap.test.js`) cover the pure resolution
 * rules. They do NOT cover the renderer: the order in which the renderer
 * consults the keymap, the overlay and the menu, the Alt accelerators, and —
 * most importantly — the invariant that a keystroke never does two things.
 *
 * This file drives the REAL renderer. `renderer/renderer.js` is a browser
 * script (it has no exports and it touches the DOM while it loads), so it is
 * evaluated in a `node:vm` context with a stubbed DOM and a stubbed bridge.
 * The listeners that are exercised are the ones the file itself installs:
 * the harness never re-implements the key handling, it only feeds synthetic
 * keydown events into the listener the renderer registered on `window`.
 *
 * What the stub is and is not:
 *  - it IS honest about the event flow: the real `window.addEventListener`
 *    handler of the renderer runs, with the real `Keymap.resolve`, the real
 *    `KEYMAP_HANDLERS` and the real overlay/menu intercepts;
 *  - it is NOT a browser: there is no layout, no painting and no real event
 *    dispatch. The render loop is not driven (requestAnimationFrame is a
 *    no-op), so the assertions read the renderer's own state and the bridge
 *    calls instead of the painted DOM;
 *  - the timer functions are unref'd, so a pending flash timer can never keep
 *    the test process alive.
 *
 * Run it with:
 *   node --test test/keyboard.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// The pure modules the renderer consumes. They are required in the host realm;
// the renderer is evaluated in the vm context with them injected.
//
// The paths can be overridden with LUUNA_KEYMAP / LUUNA_CONFIG — that is how
// the harness is mutation-checked (a copy of a module with a deliberate
// defect). CI always uses the real files.
const KEYMAP_PATH = process.env.LUUNA_KEYMAP
	? path.resolve(process.env.LUUNA_KEYMAP)
	: path.join(__dirname, "..", "renderer", "keymap.js");
const CONFIG_PATH = process.env.LUUNA_CONFIG
	? path.resolve(process.env.LUUNA_CONFIG)
	: path.join(__dirname, "..", "renderer", "config.js");
const Keymap = require(KEYMAP_PATH);
require("../renderer/themes.js");
require(CONFIG_PATH);

// The renderer under test. The path can be overridden with LUUNA_RENDERER —
// that is how the harness itself is mutation-checked (a copy of the renderer
// with a deliberate defect). CI always uses the real file.
const RENDERER_PATH = process.env.LUUNA_RENDERER
	? path.resolve(process.env.LUUNA_RENDERER)
	: path.join(__dirname, "..", "renderer", "renderer.js");
const RENDERER_SOURCE = fs.readFileSync(RENDERER_PATH, "utf8");

// -----------------------------------------------------------------------
// The DOM stub
// -----------------------------------------------------------------------

/** A `classList` backed by a set of names. */
class StubClassList {
	constructor() { this.names = new Set(); }
	add(...names) { for (const n of names) if (n) this.names.add(n); }
	remove(...names) { for (const n of names) this.names.delete(n); }
	contains(name) { return this.names.has(name); }
	toggle(name, force) {
		const on = force === undefined ? !this.names.has(name) : !!force;
		if (on) this.names.add(name); else this.names.delete(name);
		return on;
	}
	get value() { return [...this.names].join(" "); }
}

/** A style object: `setProperty` records, plain assignments are plain. */
function makeStyle() {
	const props = new Map();
	return {
		props,
		setProperty(name, value) { props.set(name, String(value)); },
		removeProperty(name) { props.delete(name); },
		getPropertyValue(name) { return props.get(name) ?? ""; },
	};
}

/** Does `el` match the (simple) selector `sel`? */
function matchesSelector(el, sel) {
	for (const part of String(sel).trim().split(/\s+/)) {
		if (!part) continue;
		const m = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/.exec(part);
		if (!m) return false;
		if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
		for (const token of m[2].match(/[.#][\w-]+/g) || []) {
			if (token[0] === ".") { if (!el.classList.contains(token.slice(1))) return false; }
			else if (el.id !== token.slice(1)) return false;
		}
	}
	return true;
}

/** Every descendant of `root` that matches `sel` (document order). */
function findAll(root, sel) {
	const out = [];
	const walk = (node) => {
		for (const child of node.children) {
			if (matchesSelector(child, sel)) out.push(child);
			walk(child);
		}
	};
	walk(root);
	return out;
}

/** The document the stub elements belong to (set while a renderer is loaded). */
let DOC = null;

/** The tags that never have children. */
const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link"]);

/**
 * Parse a (small) HTML fragment into stub elements.
 *
 * The renderer builds its dialogs and its menu rows with `innerHTML`, so the
 * stub has to understand that much HTML — otherwise a lookup like
 * `dlg.querySelector(".dlg-close")` would find nothing.
 */
function parseHtml(html, doc) {
	const root = makeElement("div", doc);
	const stack = [root];
	const re = /<\/?([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:\s*=\s*"[^"]*")?)*)\s*\/?>|([^<]+)/g;
	let m;
	while ((m = re.exec(String(html))) !== null) {
		if (m[3] !== undefined) {
			const text = m[3];
			if (text.trim()) stack[stack.length - 1].appendChild(doc.createTextNode(text));
			continue;
		}
		const tag = m[1].toLowerCase();
		if (m[0][1] === "/") {
			if (stack.length > 1) stack.pop();
			continue;
		}
		const el = doc.createElement(tag);
		const attrRe = /([\w:-]+)(?:\s*=\s*"([^"]*)")?/g;
		let a;
		while ((a = attrRe.exec(m[2] || "")) !== null) {
			const value = a[2] === undefined ? "" : a[2];
			if (a[1] === "class") el.className = value;
			else if (a[1] === "id") el.id = value;
			else el.setAttribute(a[1], value);
		}
		stack[stack.length - 1].appendChild(el);
		if (!VOID_TAGS.has(tag) && !m[0].endsWith("/>")) stack.push(el);
	}
	return root;
}

/** A stub element. */
function makeElement(tag, doc = DOC) {
	const el = {
		tagName: String(tag || "div").toUpperCase(),
		id: "",
		children: [],
		parentElement: null,
		dataset: {},
		attributes: {},
		style: makeStyle(),
		classList: new StubClassList(),
		textContent: "",
		value: "",
		type: "",
		title: "",
		checked: false,
		disabled: false,
		scrollTop: 0,
		scrollLeft: 0,
		scrollHeight: 400,
		clientHeight: 200,
		clientWidth: 800,
		offsetWidth: 100,
		offsetHeight: 20,
		selectionStart: 0,
		selectionEnd: 0,
		_listeners: {},
		addEventListener(type, fn) {
			if (!el._listeners[type]) el._listeners[type] = [];
			el._listeners[type].push(fn);
		},
		removeEventListener(type, fn) {
			const list = el._listeners[type] || [];
			const i = list.indexOf(fn);
			if (i >= 0) list.splice(i, 1);
		},
		/**
		 * Fire the listeners of one event type — the stub's own dispatch.
		 *
		 * The renderer registers its handlers on the elements it creates (the
		 * font family field, the search field), and a test has to be able to
		 * reach them.
		 */
		fire(type, event) {
			const list = el._listeners[type] || [];
			const payload = Object.assign({ type, preventDefault() {}, stopPropagation() {} }, event || {});
			for (const fn of list.slice()) fn(payload);
			return list.length;
		},
		appendChild(child) { el.children.push(child); child.parentElement = el; return child; },
		removeChild(child) {
			const i = el.children.indexOf(child);
			if (i >= 0) el.children.splice(i, 1);
			child.parentElement = null;
			return child;
		},
		insertBefore(child) { return el.appendChild(child); },
		remove() { if (el.parentElement) el.parentElement.removeChild(el); },
		focus() {},
		blur() {},
		select() {},
		click() {},
		scrollIntoView() {},
		setSelectionRange(start, end) { el.selectionStart = start; el.selectionEnd = end; },
		setAttribute(name, value) {
			el.attributes[name] = String(value);
			if (name === "id") el.id = String(value);
			if (name.startsWith("data-")) el.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
		},
		getAttribute(name) { return name in el.attributes ? el.attributes[name] : null; },
		removeAttribute(name) { delete el.attributes[name]; },
		hasAttribute(name) { return name in el.attributes; },
		closest(sel) {
			let node = el;
			while (node) { if (matchesSelector(node, sel)) return node; node = node.parentElement; }
			return null;
		},
		matches(sel) { return matchesSelector(el, sel); },
		contains(other) { return findAll(el, "*").includes(other) || other === el; },
		querySelector(sel) { return findAll(el, sel)[0] || null; },
		querySelectorAll(sel) { return findAll(el, sel); },
		getBoundingClientRect() { return { width: 840, height: 17.5, top: 0, left: 0, right: 840, bottom: 17.5 }; },
	};
	// `className` and `classList` must stay in sync: the renderer sets
	// `row.className = "row sel"`.
	Object.defineProperty(el, "className", {
		get() { return el.classList.value; },
		set(v) { el.classList.names = new Set(String(v).split(/\s+/).filter(Boolean)); },
	});
	// `textContent` clears the children, like the real DOM does.
	Object.defineProperty(el, "textContent", {
		get() { return el._text || ""; },
		set(v) { el._text = String(v); el.children.length = 0; },
	});
	// `innerHTML` builds real children — the renderer creates its dialogs and
	// its menu rows that way.
	Object.defineProperty(el, "innerHTML", {
		get() { return el._html || ""; },
		set(v) {
			el._html = String(v);
			el.children.length = 0;
			if (!v) return;
			const parsed = parseHtml(v, doc || DOC);
			for (const child of parsed.children) {
				el.appendChild(child);
				child.parentElement = el;
			}
		},
	});
	return el;
}

// -----------------------------------------------------------------------
// The page skeleton
// -----------------------------------------------------------------------

/**
 * Build the page skeleton of `renderer/index.html` in the stub.
 *
 * The renderer is a port of that page, so it expects the very same ids and
 * classes (the menu bar, the three windows, the message input, the key bar
 * and the overlay root). Mirroring the skeleton keeps the stub honest: a
 * lookup that fails here would fail in the browser too.
 */
function buildPage(document) {
	const mk = (tag, attrs = {}, children = []) => {
		const el = document.createElement(tag);
		for (const [k, v] of Object.entries(attrs)) {
			if (k === "id") el.id = v;
			else if (k === "class") el.className = v;
			else el.setAttribute(k, v);
		}
		for (const c of children) el.appendChild(c);
		return el;
	};

	const body = document.body;
	body.appendChild(mk("div", { id: "menubar", role: "menubar" }));

	const desktop = mk("div", { id: "desktop" });
	desktop.appendChild(mk("section", { id: "win-tree", class: "window" }, [
		mk("div", { class: "win-close", "data-win": "tree" }),
		mk("div", { class: "win-zoom", "data-win": "tree" }),
		mk("div", { class: "win-title" }, [mk("span", { class: "win-name" })]),
		mk("div", { class: "win-body", id: "tree-body" }),
	]));
	desktop.appendChild(mk("section", { id: "win-agent", class: "window" }, [
		mk("div", { class: "win-close", "data-win": "agent" }),
		mk("div", { class: "win-zoom", "data-win": "agent" }),
		mk("div", { class: "win-title" }, [mk("span", { class: "win-name" })]),
		mk("div", { class: "win-body", id: "agent-body" }),
		mk("div", { class: "win-linecounter", id: "agent-linecounter" }),
	]));
	desktop.appendChild(mk("section", { id: "win-input", class: "window" }, [
		mk("div", { class: "win-zoom", "data-win": "agent" }),
		mk("div", { class: "win-title" }, [mk("span", { class: "win-name", id: "input-title" })]),
		mk("div", { class: "win-body input-wrap", id: "input-wrap" }, [
			mk("pre", { id: "input-mirror" }),
			mk("textarea", { id: "input-textarea" }),
		]),
	]));
	body.appendChild(desktop);

	body.appendChild(mk("div", { id: "keybar" }));
	body.appendChild(mk("div", { id: "overlay-root" }));
}

// -----------------------------------------------------------------------
// The bridge stub
// -----------------------------------------------------------------------

/** Every bridge method the renderer may call, with a harmless answer. */
const BRIDGE_METHODS = [
	"abort", "addCustomModel", "changeDirectory", "clone", "compact", "configPaths", "contextMenu",
	"copyToClipboard", "cycleModel", "cycleThinkingLevel", "exit", "exportHtml", "fork",
	"getLastAssistantText", "getModels", "getProviders", "getSessions", "getState", "getStats",
	"getTree", "gitDiff", "gitGrep", "gitLog", "gitStatus", "newSession", "openDirDialog",
	"openFolder", "openSession", "prompt", "readPreview", "refreshGit", "reloadModels",
	"runCommand", "saveDialog", "saveSessionFile", "setConfig", "setModel", "setPlanMode",
	"setSessionName", "setThinkingLevel", "systemInfo", "toggleAutoCompaction", "toggleAutoRetry",
	"toggleFollowUpMode", "toggleSteeringMode", "writeEnvKey",
];

/** Build a bridge stub that records every call. */
function makeBridge(calls) {
	// The configuration the stub holds. `getConfig` answers with it and
	// `setConfig` writes into it, so a write is visible in the next read —
	// exactly like the real backend. The TIERS are the source of truth; the
	// merged view is recomputed from them, the project tier winning per key.
	const config = {
		settings: { appearance: { theme: "dos" }, keybindings: {}, app: {} },
		tiers: {
			global: { appearance: {}, keybindings: {}, app: {} },
			project: { appearance: {}, keybindings: {}, app: {} },
		},
		themes: [], paths: {}, errors: [],
	};

	/** A deep merge of two settings blocks (the project tier wins). */
	const merge = (base, overlay) => {
		const out = Object.assign({}, base || {});
		for (const [key, value] of Object.entries(overlay || {})) {
			const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
			out[key] = (isObject(value) && isObject(out[key]))
				? merge(out[key], value)
				: JSON.parse(JSON.stringify(value));
		}
		return out;
	};

	/** Recompute the merged view of the two tiers. */
	const refresh = () => {
		const g = config.tiers.global;
		const p = config.tiers.project;
		config.settings = {
			appearance: merge(g.appearance, p.appearance),
			keybindings: merge(g.keybindings, p.keybindings),
			app: merge(g.app, p.app),
		};
	};

	const bridge = {
		on() { return () => {}; },
		async boot() {
			return {
				success: true,
				data: {
					cwd: "C:/work", model: "m", thinkingLevel: "medium", planMode: false,
					sessionName: "NONAME00.PAS", contextTokens: null, gitInfo: null,
					isStreaming: false, requestStart: null, statusMessage: null,
					piRunning: true, recentSessions: [],
				},
			};
		},
		async getState() {
			return {
				success: true,
				data: {
					cwd: "C:/work", sessionName: "NONAME00.PAS", recentSessions: [],
				},
			};
		},
		async getConfig() {
			return { success: true, data: JSON.parse(JSON.stringify(config)) };
		},
		async setConfig(scope, file, value, replace) {
			const tier = config.tiers[scope] || (config.tiers[scope] = { appearance: {}, keybindings: {}, app: {} });
			const bucket = tier[file] || (tier[file] = {});
			if (replace === true) for (const key of Object.keys(bucket)) delete bucket[key];
			Object.assign(bucket, JSON.parse(JSON.stringify(value || {})));
			refresh();
			return { success: true, data: { path: scope + "/" + file, value: bucket } };
		},
		async getTree() { return { success: true, data: [] }; },
		async getModels() { return { success: true, data: [] }; },
		async getSessions() { return { success: true, data: [] }; },
		async gitDiff() { return { success: false, error: "not a git repository" }; },
		async saveDialog() { return { canceled: true }; },
	};
	for (const name of BRIDGE_METHODS) {
		if (bridge[name]) continue;
		bridge[name] = async (...args) => {
			calls.push({ name, args });
			return { success: true, data: {} };
		};
	}
	// The methods with a bespoke answer above still have to be recorded.
	for (const name of ["getTree", "getModels", "getSessions", "gitDiff", "saveDialog", "setConfig"]) {
		const inner = bridge[name];
		bridge[name] = async (...args) => { calls.push({ name, args }); return inner(...args); };
	}
	// A bridge method the renderer grew in a later phase must not break the
	// harness: it is recorded like any other.
	const proxy = new Proxy(bridge, {
		get(target, prop) {
			if (prop in target) return target[prop];
			if (typeof prop !== "string") return undefined;
			return async (...args) => { calls.push({ name: prop, args }); return { success: true, data: {} }; };
		},
	});
	// The stub's configuration, so a test can seed a tier.
	proxy.config = config;
	proxy.seed = (scope, file, value) => {
		config.tiers[scope][file] = JSON.parse(JSON.stringify(value || {}));
		refresh();
	};
	return proxy;
}

// -----------------------------------------------------------------------
// The renderer under test
// -----------------------------------------------------------------------

/** A loaded renderer: the context, the DOM, the bridge and the helpers. */
let harness = null;

/**
 * Load the renderer into a fresh vm context.
 *
 * A fresh context per test is the only way to guarantee that no state leaks
 * between the tests (the renderer keeps its state, its timers and its
 * listeners in module scope).
 */
async function loadRenderer() {
	const calls = [];
	const listeners = new Map();
	const timers = new Set();
	const elements = new Map();

	const document = {
		documentElement: makeElement("html", null),
		body: makeElement("body", null),
		activeElement: null,
		getElementById(id) {
			const found = findAll(document.body, "#" + id)[0];
			if (found) return found;
			if (!elements.has(id)) {
				const el = makeElement("div", document);
				el.id = id;
				elements.set(id, el);
				document.body.appendChild(el);
			}
			return elements.get(id);
		},
		createElement(tag) { return makeElement(tag, document); },
		createTextNode(text) { const n = makeElement("#text", document); n.textContent = text; return n; },
		querySelector(sel) { return findAll(document.body, sel)[0] || null; },
		querySelectorAll(sel) { return findAll(document.body, sel); },
		addEventListener() {},
		removeEventListener() {},
	};
	DOC = document;
	buildPage(document);
	// The menu bar gets one child per top-level menu — the dropdown is
	// positioned under the menu that is open.
	const menubar = document.getElementById("menubar");
	for (let i = 0; i < 10; i++) menubar.appendChild(makeElement("div", document));

	const window = {
		addEventListener(type, fn) {
			if (!listeners.has(type)) listeners.set(type, []);
			listeners.get(type).push(fn);
		},
		removeEventListener() {},
		getSelection() { return { toString() { return ""; } }; },
		innerWidth: 1180,
		innerHeight: 780,
		close() { calls.push({ name: "window.close", args: [] }); },
		requestAnimationFrame() { return 0; }, // the render loop is not driven
	};

	const bridge = makeBridge(calls);

	// The timers of the renderer must never keep the test process alive.
	const setTimeoutStub = (fn, ms, ...rest) => {
		const t = setTimeout(fn, ms, ...rest);
		if (typeof t.unref === "function") t.unref();
		timers.add(t);
		return t;
	};
	const clearTimeoutStub = (t) => { timers.delete(t); clearTimeout(t); };
	const setIntervalStub = (fn, ms, ...rest) => {
		const t = setInterval(fn, ms, ...rest);
		if (typeof t.unref === "function") t.unref();
		timers.add(t);
		return t;
	};
	const clearIntervalStub = (t) => { timers.delete(t); clearInterval(t); };

	const sandbox = {
		window, document, luuna: bridge,
		navigator: { platform: "Win32", userAgent: "node" },
		performance, console,
		setTimeout: setTimeoutStub, clearTimeout: clearTimeoutStub,
		setInterval: setIntervalStub, clearInterval: clearIntervalStub,
		requestAnimationFrame: () => 0,
	};
	sandbox.globalThis = sandbox;
	sandbox.self = sandbox;
	vm.createContext(sandbox);
	sandbox.LuunaKeymap = Keymap;
	sandbox.LuunaThemes = globalThis.LuunaThemes;
	sandbox.LuunaConfig = globalThis.LuunaConfig;
	window.LuunaKeymap = Keymap;
	window.LuunaThemes = globalThis.LuunaThemes;
	window.LuunaConfig = globalThis.LuunaConfig;

	// The pure modules live in the host realm, so they see the host globals.
	// The bridge and the DOM have to be there as well, or the theme and the
	// font would never reach the stub document.
	globalThis.luuna = bridge;
	globalThis.document = document;
	globalThis.window = window;

	vm.runInContext(RENDERER_SOURCE, sandbox, { filename: "renderer.js" });

	// Let the boot chain settle (boot -> getConfig -> refreshGitAndTree).
	for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));

	const run = (expr) => vm.runInContext(expr, sandbox);
	const keydownHandlers = listeners.get("keydown") || [];

	return {
		run,
		calls,
		document,
		window,
		elements,
		timers,
		bridge,
		/**
		 * Put a settings block into one tier of the stub's configuration and
		 * re-merge the tiers, exactly like the backend does.
		 */
		seed(scope, file, value) { bridge.seed(scope, file, value); },
		/** The stub element with that id. */
		el(id) { return document.getElementById(id); },
		/** The keydown listener the renderer itself installed. */
		keydown(e) {
			assert.ok(keydownHandlers.length > 0, "the renderer installed no keydown listener");
			for (const fn of keydownHandlers) fn(e);
		},
		/** The name of the last bridge call. */
		lastCall() {
			return calls.length ? calls[calls.length - 1].name : null;
		},
		/** The names of every bridge call. */
		callNames() { return calls.map((c) => c.name); },
		dispose() {
			for (const t of timers) { clearTimeout(t); clearInterval(t); }
			timers.clear();
			DOC = null;
			delete globalThis.luuna;
			delete globalThis.document;
			delete globalThis.window;
		},
	};
}

// -----------------------------------------------------------------------
// The synthetic key events
// -----------------------------------------------------------------------

/** A synthetic keydown event. */
function keyEvent(over) {
	return Object.assign({
		key: "",
		code: "",
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		isComposing: false,
		keyCode: 0,
		timeStamp: performance.now(),
		target: null,
		defaultPrevented: false,
		preventDefault() { this.defaultPrevented = true; },
		stopPropagation() {},
	}, over);
}

/** A function key: F1 … F10. */
const fnKey = (n) => keyEvent({ key: "F" + n, code: "F" + n });

/** A letter key (the physical key is derived from the letter). */
function letterKey(ch, over) {
	const upper = ch.toUpperCase();
	return keyEvent(Object.assign({
		key: ch,
		code: /^[A-Z]$/.test(upper) ? "Key" + upper : "",
	}, over));
}

/** Ctrl+<ch>. */
const ctrlKey = (ch, over) => letterKey(ch, Object.assign({ ctrlKey: true }, over));

/** Alt+<ch>. */
const altKey = (ch, over) => letterKey(ch, Object.assign({ altKey: true }, over));

/** Shift+<ch>. */
const shiftKey = (ch, over) => letterKey(ch, Object.assign({ shiftKey: true }, over));

/** A named key ("Enter", "Escape", "Tab", "ArrowDown", …). */
const namedKey = (name, over) => keyEvent(Object.assign({ key: name, code: name }, over));

// -----------------------------------------------------------------------
// The fixtures
// -----------------------------------------------------------------------

/** A project tree with one expanded directory and two files. */
const TREE = [
	{ name: "src", relPath: "src", isDir: true, children: [
		{ name: "main.ts", relPath: "src/main.ts", isDir: false },
	] },
	{ name: "README.md", relPath: "README.md", isDir: false },
];

/** Put the renderer into a known state before a test. */
function reset(h, { focus = "agent", tree = null } = {}) {
	h.run(`state.focus = ${JSON.stringify(focus)};
		state.sessionName = "NONAME00.PAS";
		state.overlay = null;
		state.menuOpenIndex = null;
		state.pendingChord = null;
		state.entries = [];
		state.isStreaming = false;
		state.lastPrompt = null;
		state.inputHistory = [];
		state.historyPos = null;
		state.treeCursor = 0;
		state.treeExpanded = new Set(["src"]);
		state.treeFilter = null;
		state.flash = null;
		altPendingSince = 0;
		inputArea.value = "";
		inputArea.setSelectionRange(0, 0);
		${tree ? `state.tree = ${JSON.stringify(tree)};` : "state.tree = [];"}`);
	h.document.activeElement = focus === "input" ? h.el("input-textarea") : null;
	h.calls.length = 0;
}

// -----------------------------------------------------------------------
// The tests
// -----------------------------------------------------------------------

test.beforeEach(async () => {
	// The platform decides how `Mod` expands; the harness must not depend on
	// the machine the tests run on.
	Keymap.setPlatform("other");
	harness = await loadRenderer();
});
test.afterEach(() => {
	if (harness) { harness.dispose(); harness = null; }
	// The keymap is a singleton: a test that rebinds an action must not leak
	// the rebinding into the next one.
	Keymap.applyOverrides({});
	Keymap.applyDefaults({});
	Keymap.setPlatform(null);
});

// The harness must leave the process exactly as it found it.
test.after(() => {
	assert.equal(globalThis.luuna, undefined, "the bridge must not leak");
	assert.equal(globalThis.document, undefined, "the DOM must not leak");
	assert.equal(globalThis.window, undefined, "the window must not leak");
});

// --- the function keys ----------------------------------------------------

test("F1 opens the keyboard help", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(fnKey(1));
	assert.equal(harness.run("state.overlay && state.overlay.kind"), "help");
});

test("F2 saves the session", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(fnKey(2));
	assert.equal(harness.lastCall(), "saveDialog");
});

test("F3 opens the session selector", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(fnKey(3));
	assert.equal(harness.lastCall(), "getSessions");
});

test("F4 opens the model selector", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(fnKey(4));
	assert.equal(harness.lastCall(), "getModels");
});

test("F5 cycles the thinking effort", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(fnKey(5));
	assert.equal(harness.lastCall(), "cycleThinkingLevel");
});

test("F6 toggles the plan/build mode", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(fnKey(6));
	assert.equal(harness.lastCall(), "setPlanMode");
});

test("F7 opens the git diff", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(fnKey(7));
	assert.equal(harness.lastCall(), "gitDiff");
});

test("F8 runs the test suite", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(fnKey(8));
	assert.equal(harness.lastCall(), "runCommand");
	assert.equal(harness.calls[harness.calls.length - 1].args[0], "npm test");
});

test("F9 builds the project", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(fnKey(9));
	assert.equal(harness.lastCall(), "runCommand");
	assert.equal(harness.calls[harness.calls.length - 1].args[0], "npm run build");
});

test("F10 activates the menu bar", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(fnKey(10));
	assert.equal(harness.run("state.menuOpenIndex"), 0);
});

// --- the Alt+letter accelerators -----------------------------------------

test("Alt+F opens the File menu (the mnemonic fallback)", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(altKey("f"));
	assert.equal(harness.run("state.menuOpenIndex"), 0);
});

test("Alt+A opens the Agent menu", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(altKey("a"));
	assert.equal(harness.run("state.menuOpenIndex"), harness.run("MAIN_MENUS.findIndex(m => m.title === 'Agent')"));
});

test("Alt+G opens the Git menu", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(altKey("g"));
	assert.equal(harness.run("state.menuOpenIndex"), harness.run("MAIN_MENUS.findIndex(m => m.title === 'Git')"));
});

test("Alt+X exits — the keymap owns it, the File mnemonic does not", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(altKey("x"));
	assert.equal(harness.lastCall(), "exit");
	assert.equal(harness.run("state.menuOpenIndex"), null, "the File menu must not open");
});

test("an accelerator never leaks into the composer", () => {
	reset(harness, { focus: "input" });
	const e = altKey("f");
	harness.keydown(e);
	assert.equal(e.defaultPrevented, true, "an accelerator is always swallowed");
	assert.equal(harness.run("inputArea.value"), "", "nothing is typed into the composer");
});

test("the Windows Alt burst (a bare Alt, then a letter) opens the menu", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(keyEvent({ key: "Alt", code: "AltLeft" }));
	harness.keydown(letterKey("f"));
	assert.equal(harness.run("state.menuOpenIndex"), 0);
});

test("the Alt burst of a letter the keymap owns still runs the keymap action", () => {
	// The burst arrives without altKey, so the keymap only recognises it
	// through the synthetic Alt+<letter> chord of the accelerator path.
	reset(harness, { focus: "agent" });
	harness.keydown(keyEvent({ key: "Alt", code: "AltLeft" }));
	harness.keydown(letterKey("x"));
	assert.equal(harness.lastCall(), "exit");
	assert.equal(harness.run("state.menuOpenIndex"), null, "the File menu must not open");
});

test("the Alt burst wins over the vim motions", () => {
	// "h" is both the Help-menu mnemonic and the "collapse" motion. The burst
	// is handled first, so the menu opens and the tree is left alone.
	reset(harness, { focus: "tree", tree: TREE });
	harness.keydown(keyEvent({ key: "Alt", code: "AltLeft" }));
	harness.keydown(letterKey("h"));
	assert.equal(harness.run("state.menuOpenIndex"), harness.run("MAIN_MENUS.findIndex(m => m.title === 'Help')"));
	assert.equal(harness.run("state.treeExpanded.has('src')"), true, "the tree must not collapse");
});

// --- the Ctrl chords ------------------------------------------------------

test("Ctrl+F opens the find-file dialog", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(ctrlKey("f"));
	assert.equal(harness.run("state.overlay && state.overlay.kind"), "prompt");
});

test("Ctrl+C aborts the running operation", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(ctrlKey("c"));
	assert.equal(harness.lastCall(), "abort");
});

test("Ctrl+L clears the agent log", () => {
	reset(harness, { focus: "agent" });
	harness.run("state.entries = [{ kind: 'agent', text: 'hello' }];");
	harness.keydown(ctrlKey("l"));
	assert.equal(harness.run("state.entries.length"), 0);
});

test("Ctrl+U scrolls the focused pane up by half a page", () => {
	reset(harness, { focus: "agent" });
	harness.el("agent-body").scrollTop = 200;
	harness.keydown(ctrlKey("u"));
	assert.equal(harness.el("agent-body").scrollTop, 100);
});

test("Ctrl+D scrolls the focused pane down by half a page", () => {
	reset(harness, { focus: "agent" });
	harness.el("agent-body").scrollTop = 100;
	harness.keydown(ctrlKey("d"));
	assert.equal(harness.el("agent-body").scrollTop, 200);
});

test("Ctrl+W deletes the word before the cursor in the composer", () => {
	reset(harness, { focus: "input" });
	harness.run("inputArea.value = 'hello world'; inputArea.setSelectionRange(11, 11);");
	harness.keydown(ctrlKey("w"));
	assert.equal(harness.run("inputArea.value"), "hello ");
	assert.equal(harness.lastCall(), null, "the app-level Ctrl+W must not fire");
});

test("Ctrl+W outside the composer is the window-motion prefix", () => {
	reset(harness, { focus: "tree", tree: TREE });
	harness.keydown(ctrlKey("w"));
	assert.equal(harness.run("state.pendingChord"), "Ctrl+W");
	harness.keydown(letterKey("l"));
	assert.equal(harness.run("state.focus"), "input", "Ctrl+W,L focuses the composer");
	assert.equal(harness.run("state.pendingChord"), null);
});

// --- the composer ---------------------------------------------------------

test("Enter in the composer sends the message", () => {
	reset(harness, { focus: "input" });
	harness.run("inputArea.value = 'hello';");
	harness.keydown(namedKey("Enter"));
	assert.equal(harness.lastCall(), "prompt");
	assert.equal(harness.calls[harness.calls.length - 1].args[0], "hello");
});

test("Shift+Enter in the composer is not prevented — the textarea breaks the line", () => {
	reset(harness, { focus: "input" });
	harness.run("inputArea.value = 'hello';");
	const e = namedKey("Enter", { shiftKey: true });
	harness.keydown(e);
	assert.equal(e.defaultPrevented, false);
	assert.equal(harness.callNames().includes("prompt"), false, "Shift+Enter must not send");
});

test("Escape in the composer leaves the composer", () => {
	reset(harness, { focus: "input" });
	harness.keydown(namedKey("Escape"));
	assert.equal(harness.run("state.focus"), "tree");
});

test("ArrowUp in the composer walks the message history", () => {
	reset(harness, { focus: "input" });
	harness.run("state.inputHistory = ['first', 'second']; state.historyPos = null;");
	harness.keydown(namedKey("ArrowUp"));
	assert.equal(harness.run("inputArea.value"), "second");
});

// --- the bareAllowed safety net -------------------------------------------

test("typing in the composer is never swallowed by the keymap", () => {
	reset(harness, { focus: "input" });
	for (const ch of ["j", "k", "h", "l", "g", "i", "x", "q"]) {
		const e = letterKey(ch);
		harness.keydown(e);
		assert.equal(e.defaultPrevented, false, `the letter "${ch}" was swallowed`);
		assert.equal(harness.run("state.pendingChord"), null, `the letter "${ch}" started a sequence`);
	}
	assert.equal(harness.callNames().length, 0, "typing must not trigger any action");
});

test("the same letters DO act outside the composer", () => {
	// The difference is the scope: a bare letter is a motion in the tree.
	reset(harness, { focus: "tree", tree: TREE });
	const e = letterKey("j");
	harness.keydown(e);
	assert.equal(e.defaultPrevented, true, "the motion is consumed");
	assert.equal(harness.run("state.treeCursor"), 1);
});

test("the keymap itself returns null for a bare letter in the composer", () => {
	const hit = Keymap.resolve(letterKey("j"), { focus: "input" });
	assert.equal(hit, null, "a bare letter must not resolve to an action in the composer scope");
});

test("a bare letter in the composer does not start a sequence either", () => {
	reset(harness, { focus: "input" });
	harness.keydown(letterKey("g"));
	assert.equal(harness.run("state.pendingChord"), null);
});

// --- the order of the keydown steps --------------------------------------

test("the IME guard swallows a composing keystroke", () => {
	reset(harness, { focus: "input" });
	const e = letterKey("a", { isComposing: true, keyCode: 229 });
	harness.keydown(e);
	assert.equal(e.defaultPrevented, false);
	assert.equal(harness.run("state.pendingChord"), null);
	assert.equal(harness.callNames().length, 0, "a composition is not a key press");
});

test("a composing Enter does not send a half-written word", () => {
	// The IME owns the keystroke while it composes: without the guard the
	// composer would send the text that is still being written.
	reset(harness, { focus: "input" });
	harness.run("inputArea.value = 'han';");
	const e = namedKey("Enter", { isComposing: true, keyCode: 229 });
	harness.keydown(e);
	assert.equal(harness.callNames().includes("prompt"), false, "a composition must not be sent");
	assert.equal(harness.run("inputArea.value"), "han", "the composer keeps the text");
});

test("a composing function key does not reach the keymap", () => {
	reset(harness, { focus: "agent" });
	const e = fnKey(5);
	e.isComposing = true;
	e.keyCode = 229;
	harness.keydown(e);
	assert.equal(harness.callNames().includes("cycleThinkingLevel"), false, "a composition is not a key press");
});

test("an open overlay owns the keyboard — the keymap never sees the key", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(fnKey(1)); // the help overlay
	assert.equal(harness.run("state.overlay.kind"), "help");
	harness.calls.length = 0;

	harness.keydown(fnKey(5)); // would be agent.thinking
	assert.equal(harness.callNames().includes("cycleThinkingLevel"), false, "the overlay must swallow F5");

	harness.keydown(namedKey("Escape"));
	assert.equal(harness.run("state.overlay"), null, "Escape closes the overlay");
});

test("an open menu owns the keyboard — the keymap never sees the key", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(fnKey(10)); // the File menu
	assert.equal(harness.run("state.menuOpenIndex"), 0);
	harness.calls.length = 0;

	// A plain letter is a menu mnemonic ("n" = New session).
	harness.keydown(letterKey("n"));
	assert.equal(harness.callNames().includes("newSession"), true, "the menu owns the letter");
	assert.equal(harness.run("state.menuOpenIndex"), null, "the menu closed after the command");

	// A function key is owned by the menu as well: it must not reach the keymap.
	harness.keydown(fnKey(10));
	harness.calls.length = 0;
	harness.keydown(fnKey(5));
	assert.equal(harness.callNames().includes("cycleThinkingLevel"), false, "the menu must swallow F5");
	assert.equal(harness.run("state.menuOpenIndex"), 0, "the menu is still open");
});

test("the keymap is consulted before the Alt+letter accelerator", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(altKey("x"));
	assert.equal(harness.lastCall(), "exit", "the keymap owns Alt+X");
	assert.equal(harness.run("state.menuOpenIndex"), null, "the accelerator fallback must not run");
});

test("one keystroke does one thing: Enter sends, it does not also break the line", () => {
	reset(harness, { focus: "input" });
	harness.run("inputArea.value = 'hello';");
	harness.keydown(namedKey("Enter"));
	assert.equal(harness.callNames().filter((n) => n === "prompt").length, 1);
	assert.equal(harness.run("inputArea.value"), "", "the composer is cleared");
});

test("one keystroke does one thing: a motion does not also open a menu", () => {
	reset(harness, { focus: "tree", tree: TREE });
	harness.keydown(letterKey("j"));
	assert.equal(harness.run("state.menuOpenIndex"), null);
	assert.equal(harness.run("state.treeCursor"), 1);
});

test("a chord that matches no action leaves the key alone", () => {
	reset(harness, { focus: "tree", tree: TREE });
	const e = ctrlKey("q");
	harness.keydown(e);
	assert.equal(e.defaultPrevented, false, "an unbound chord is not swallowed");
	assert.equal(harness.run("state.pendingChord"), null);
});

// --- the vim motions ------------------------------------------------------

test("j and k move the tree cursor", () => {
	reset(harness, { focus: "tree", tree: TREE });
	harness.keydown(letterKey("j"));
	assert.equal(harness.run("state.treeCursor"), 1);
	harness.keydown(letterKey("j"));
	assert.equal(harness.run("state.treeCursor"), 2);
	harness.keydown(letterKey("k"));
	assert.equal(harness.run("state.treeCursor"), 1);
});

test("h collapses and l expands a directory", () => {
	reset(harness, { focus: "tree", tree: TREE });
	harness.keydown(letterKey("h"));
	assert.equal(harness.run("state.treeExpanded.has('src')"), false);
	harness.keydown(letterKey("l"));
	assert.equal(harness.run("state.treeExpanded.has('src')"), true);
});

test("gg jumps to the top and Shift+G to the bottom", () => {
	reset(harness, { focus: "tree", tree: TREE });
	harness.keydown(letterKey("g"));
	assert.equal(harness.run("state.pendingChord"), "G", "the sequence waits for the second key");
	harness.keydown(letterKey("g"));
	assert.equal(harness.run("state.treeCursor"), 0);
	assert.equal(harness.run("state.pendingChord"), null);

	harness.keydown(shiftKey("g"));
	assert.equal(harness.run("state.treeCursor"), 2, "the last row");
});

test("i focuses the composer", () => {
	reset(harness, { focus: "tree", tree: TREE });
	harness.keydown(letterKey("i"));
	assert.equal(harness.run("state.focus"), "input");
});

test(": prefills the slash command", () => {
	reset(harness, { focus: "tree", tree: TREE });
	harness.keydown(keyEvent({ key: ":", code: "Semicolon", shiftKey: true }));
	assert.equal(harness.run("inputArea.value"), "/");
	assert.equal(harness.run("state.focus"), "input");
});

test("/ opens the find dialog and ? the help", () => {
	reset(harness, { focus: "tree", tree: TREE });
	harness.keydown(keyEvent({ key: "/", code: "Slash" }));
	assert.equal(harness.run("state.overlay && state.overlay.kind"), "prompt");

	reset(harness, { focus: "tree", tree: TREE });
	harness.keydown(keyEvent({ key: "?", code: "Slash", shiftKey: true }));
	assert.equal(harness.run("state.overlay && state.overlay.kind"), "help");
});

// --- the pane navigation --------------------------------------------------

test("the tree pane: the arrows, Home, End and the page keys move the cursor", () => {
	reset(harness, { focus: "tree", tree: TREE });
	harness.keydown(namedKey("ArrowDown"));
	assert.equal(harness.run("state.treeCursor"), 1);
	harness.keydown(namedKey("ArrowUp"));
	assert.equal(harness.run("state.treeCursor"), 0);
	harness.keydown(namedKey("End"));
	assert.equal(harness.run("state.treeCursor"), 2);
	harness.keydown(namedKey("Home"));
	assert.equal(harness.run("state.treeCursor"), 0);
	harness.keydown(namedKey("PageDown"));
	assert.equal(harness.run("state.treeCursor"), 2);
	harness.keydown(namedKey("PageUp"));
	assert.equal(harness.run("state.treeCursor"), 0);
});

test("Enter in the tree opens the entry and Escape leaves the tree", () => {
	reset(harness, { focus: "tree", tree: TREE });
	harness.keydown(namedKey("Enter"));
	assert.equal(harness.run("state.treeExpanded.has('src')"), false, "Enter toggles the directory");
	harness.keydown(namedKey("Escape"));
	assert.equal(harness.run("state.focus"), "input");
});

test("the agent pane: the arrows and the page keys scroll the output", () => {
	reset(harness, { focus: "agent" });
	const body = harness.el("agent-body");
	body.scrollTop = 0;
	harness.keydown(namedKey("ArrowDown"));
	assert.equal(body.scrollTop, 17.5, "one line down");
	harness.keydown(namedKey("PageDown"));
	assert.equal(body.scrollTop, 17.5 + 200, "one page down");
	harness.keydown(namedKey("Home"));
	assert.equal(body.scrollTop, 0);
	harness.keydown(namedKey("End"));
	assert.equal(body.scrollTop, body.scrollHeight);
});

test("Enter in the agent pane focuses the composer, Escape leaves the agent pane", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(namedKey("Enter"));
	assert.equal(harness.run("state.focus"), "input");
});

// --- Tab and the window motions -------------------------------------------

test("Tab cycles the focus", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(namedKey("Tab"));
	assert.equal(harness.run("state.focus"), "tree");
	harness.keydown(namedKey("Tab"));
	assert.equal(harness.run("state.focus"), "input");
});

test("the window motions (Ctrl+W,…) move the focus", () => {
	for (const [letter, focus] of [["h", "tree"], ["j", "agent"], ["l", "input"]]) {
		reset(harness, { focus: "agent" });
		harness.keydown(ctrlKey("w"));
		assert.equal(harness.run("state.pendingChord"), "Ctrl+W");
		harness.keydown(letterKey(letter));
		assert.equal(harness.run("state.focus"), focus, `Ctrl+W,${letter}`);
	}
});

// --- the Raycast chords ---------------------------------------------------

test("Mod+N starts a new session", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(ctrlKey("n"));
	assert.equal(harness.lastCall(), "newSession");
});

test("Mod+] and Mod+[ walk the recent sessions", () => {
	reset(harness, { focus: "agent" });
	harness.run("state.recentSessions = [{ label: 'one', path: 'one' }];");
	harness.keydown(keyEvent({ key: "]", code: "BracketRight", ctrlKey: true }));
	assert.equal(harness.lastCall(), "openSession");
	harness.keydown(keyEvent({ key: "[", code: "BracketLeft", ctrlKey: true }));
	assert.equal(harness.lastCall(), "openSession");
});

test("Mod+1 jumps to the first recent session", () => {
	reset(harness, { focus: "agent" });
	harness.run("state.recentSessions = [{ label: 'one', path: 'one' }];");
	harness.keydown(ctrlKey("1"));
	assert.equal(harness.lastCall(), "openSession");
});

test("Mod+B toggles the file tree", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(ctrlKey("b"));
	assert.equal(harness.run("document.getElementById('desktop').classList.contains('no-tree')"), true);
});

test("Mod+= and Mod+- change the font size and persist it", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(keyEvent({ key: "=", code: "Equal", ctrlKey: true }));
	assert.ok(harness.callNames().includes("setConfig"), "the size is persisted");
	harness.keydown(keyEvent({ key: "-", code: "Minus", ctrlKey: true }));
	assert.ok(harness.callNames().includes("setConfig"), "the size is persisted");
});

test("Mod+K opens the command palette and Mod+, the settings", () => {
	reset(harness, { focus: "agent" });
	harness.keydown(ctrlKey("k"));
	assert.ok(harness.run("state.overlay"), "the palette opens");
	reset(harness, { focus: "agent" });
	harness.keydown(ctrlKey(","));
	assert.ok(harness.run("state.overlay"), "the settings open");
});

// --- the keybindings editor ------------------------------------------------

/** Let the pending promises of the renderer run. */
const tick = () => new Promise((r) => setImmediate(r));

/** The label of the row the keybindings editor has selected. */
function selectedLabel(h) {
	const sel = h.document.querySelector(".kb-row.sel");
	if (!sel) return null;
	const label = sel.querySelector(".klabel");
	return label ? label.textContent : null;
}

/** Move the selection of the keybindings editor to the row with that label. */
function selectRow(h, label) {
	for (let i = 0; i < 400; i++) {
		if (selectedLabel(h) === label) return true;
		h.keydown(namedKey("ArrowDown"));
	}
	return false;
}

/** The keybinding row whose label is that one. */
function rowByLabel(h, label) {
	return h.document.querySelectorAll(".kb-row").find((row) => {
		const l = row.querySelector(".klabel");
		return l && l.textContent === label;
	}) || null;
}

/**
 * The text of an element, including the text of its children.
 *
 * The stub does not aggregate `textContent` (the renderer sets it directly on
 * the elements it creates), so the text of a parsed fragment has to be
 * collected by hand.
 */
function textOf(el) {
	if (!el) return "";
	let out = el._text || "";
	for (const child of el.children) out += textOf(child);
	return out;
}

/** A chord list that came from the renderer realm, as a host array. */
const chords = (value) => Array.from(value || []);

/** Open the settings dialog on the keybindings section. */
function openKeybindings(h) {
	h.run("openSettingsDialog('keybindings')");
}

test("Delete in the keybindings search field edits the text instead of resetting a binding", async () => {
	reset(harness, { focus: "agent" });
	openKeybindings(harness);
	const search = harness.document.querySelector(".kb-search");
	assert.ok(search, "the search field exists");
	search.value = "palette";
	// The stub cannot focus, so the field is made the active element by hand.
	harness.document.activeElement = search;
	harness.calls.length = 0;

	const e = namedKey("Delete");
	harness.keydown(e);
	assert.equal(e.defaultPrevented, false, "the search field keeps its own Delete");
	await tick();
	assert.equal(harness.callNames().includes("setConfig"), false, "no binding was written");
	assert.deepEqual(Keymap.chordsFor("app.palette"), ["Mod+K"], "the binding is unchanged");
});

test("Delete with an empty search field restores the default binding", async () => {
	reset(harness, { focus: "agent" });
	// The tier holds the rebinding, so the reset has to remove it from the
	// tier's own file.
	harness.seed("project", "keybindings", { "app.palette": ["Mod+J"] });
	await harness.run("Config.loadConfig()");
	assert.deepEqual(Keymap.chordsFor("app.palette"), ["Mod+J"], "the rebinding is in effect");
	openKeybindings(harness);
	harness.document.activeElement = null;
	harness.calls.length = 0;

	harness.keydown(namedKey("Delete"));
	await tick();
	const write = harness.calls.find((c) => c.name === "setConfig");
	assert.ok(write, "the tier's keybindings file is rewritten");
	assert.deepEqual(Object.keys(write.args[2]), [], "the rebinding is gone from the file");
	assert.equal(write.args[3], true, "the file is replaced — a merge cannot remove a key");
	assert.deepEqual(Keymap.chordsFor("app.palette"), ["Mod+K"], "the registry chord is in effect again");
});

test("the chord labels of a keybinding row have no duplicates", () => {
	Keymap.applyOverrides({ "app.palette": ["Mod+C", "Ctrl+C"] });
	reset(harness, { focus: "agent" });
	openKeybindings(harness);
	const row = rowByLabel(harness, "Command palette");
	assert.ok(row, "the palette row exists");
	assert.equal(row.querySelector(".kb-chord").textContent, "Ctrl+C", "the label set has no duplicate");
	Keymap.applyOverrides({});
});

test("a keybinding row shows where its binding comes from", () => {
	reset(harness, { focus: "agent" });
	openKeybindings(harness);
	const raycast = rowByLabel(harness, "Command palette");
	assert.equal(raycast.querySelector(".korigin").textContent, "RAYCAST");
	const existing = rowByLabel(harness, "Find file in tree");
	assert.equal(existing.querySelector(".korigin").textContent, "EXISTING");
});

test("the keybindings editor names the tier it writes to and lists the deviations", () => {
	reset(harness, { focus: "agent" });
	openKeybindings(harness);
	const head = harness.document.querySelector(".dline.head");
	assert.match(head.textContent, /Keybindings \(Project tier\)/);
	const notes = harness.document.querySelector(".kb-notes").querySelectorAll(".dline");
	assert.equal(notes.length, 3, "the three deviations of the spec are listed");
	assert.match(textOf(notes[0]), /Find in the tree is/);
	assert.match(textOf(notes[2]), /not rebindable/);
});

test("a bare letter is refused for a global action, and nothing is written", async () => {
	reset(harness, { focus: "agent" });
	openKeybindings(harness);
	assert.equal(selectRow(harness, "Command palette"), true, "the palette row is selected");
	harness.keydown(namedKey("Enter"));   // start the recording
	harness.keydown(letterKey("k"));      // a bare letter
	harness.keydown(namedKey("Enter"));   // save it
	await tick();

	const message = harness.document.querySelector(".kb-msg").textContent;
	assert.match(message, /cannot be bound/, "the recorder explains the refusal");
	assert.equal(harness.callNames().includes("setConfig"), false, "no settings file was written");
	assert.deepEqual(Keymap.chordsFor("app.palette"), ["Mod+K"], "the binding is unchanged");
});

test("a chord of another scope is accepted for a global action", async () => {
	reset(harness, { focus: "agent" });
	openKeybindings(harness);
	assert.equal(selectRow(harness, "Command palette"), true);
	harness.keydown(namedKey("Enter"));    // start the recording
	harness.keydown(namedKey("ArrowUp"));  // the composer's history chord
	harness.keydown(namedKey("Enter"));    // save it
	await tick();

	const write = harness.calls.find((c) => c.name === "setConfig");
	assert.ok(write, "the binding is written");
	assert.deepEqual(chords(write.args[2]["app.palette"]), ["ArrowUp"]);
});

test("a genuine conflict is refused and the owner is named", async () => {
	reset(harness, { focus: "agent" });
	openKeybindings(harness);
	assert.equal(selectRow(harness, "Command palette"), true);
	harness.keydown(namedKey("Enter"));
	harness.keydown(ctrlKey("f"));
	harness.keydown(namedKey("Enter"));
	await tick();

	const message = harness.document.querySelector(".kb-msg").textContent;
	assert.match(message, /already bound to Find file in tree/);
	assert.equal(harness.callNames().includes("setConfig"), false, "no settings file was written");
});

test("a chord that ends in Enter is recorded like any other chord", async () => {
	reset(harness, { focus: "agent" });
	openKeybindings(harness);
	assert.equal(selectRow(harness, "Command palette"), true);
	harness.keydown(namedKey("Enter"));                       // start the recording
	harness.keydown(namedKey("Enter", { ctrlKey: true }));   // Ctrl+Enter — a chord, not the commit key
	harness.keydown(namedKey("Enter"));                       // commit it
	await tick();

	const write = harness.calls.find((c) => c.name === "setConfig");
	assert.ok(write, "the binding is written");
	const bound = chords(write.args[2]["app.palette"]);
	assert.equal(bound.length, 1, "one chord was bound");
	assert.match(bound[0], /Enter$/, "the chord ends in Enter");
	assert.match(bound[0], /^(Ctrl|Mod)\+/, "the chord keeps its modifier");
});

test("a plain Enter cannot be captured and the recorder says why", async () => {
	reset(harness, { focus: "agent" });
	openKeybindings(harness);
	assert.equal(selectRow(harness, "Command palette"), true);
	harness.keydown(namedKey("Enter"));   // start the recording
	harness.keydown(namedKey("Enter"));   // a bare Enter — the recorder's own key
	await tick();

	const message = harness.document.querySelector(".kb-msg").textContent;
	assert.match(message, /cannot be captured/, "the limitation is explained");
	assert.match(message, /Ctrl\+Enter/, "the way out is named");
	assert.equal(harness.callNames().includes("setConfig"), false, "no settings file was written");
});

test("the nine recent-session jumps collapse into one row that expands into nine", async () => {
	reset(harness, { focus: "agent" });
	openKeybindings(harness);
	const groups = harness.document.querySelectorAll(".kb-row.kb-grouprow");
	assert.equal(groups.length, 1, "the group collapses into a single row");
	assert.equal(groups[0].querySelector(".klabel").textContent, "Recent sessions");
	const chords = groups[0].querySelector(".kb-chord").textContent;
	for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
		assert.ok(chords.includes(`Ctrl+${n}`), `the group row shows Ctrl+${n}`);
	}
	const collapsed = harness.document.querySelectorAll(".klabel")
		.map((l) => l.textContent)
		.filter((t) => t.startsWith("Jump to recent session"));
	assert.equal(collapsed.length, 0, "the members are not listed while the group is closed");

	// Enter opens the group.
	assert.equal(selectRow(harness, "Recent sessions"), true);
	harness.keydown(namedKey("Enter"));
	const expanded = harness.document.querySelectorAll(".klabel")
		.map((l) => l.textContent)
		.filter((t) => t.startsWith("Jump to recent session"));
	assert.equal(expanded.length, 9, "the group expands into its nine members");
});

test("a member of the collapsed group is still rebindable on its own", async () => {
	reset(harness, { focus: "agent" });
	openKeybindings(harness);
	assert.equal(selectRow(harness, "Recent sessions"), true);
	harness.keydown(namedKey("Enter"));
	assert.equal(selectRow(harness, "Jump to recent session 1"), true, "the member row is selected");
	harness.keydown(namedKey("Enter"));      // start the recording
	harness.keydown(keyEvent({ key: "1", code: "Digit1", altKey: true, shiftKey: true }));
	harness.keydown(namedKey("Enter"));      // save it
	await tick();

	const write = harness.calls.find((c) => c.name === "setConfig");
	assert.ok(write, "the binding is written");
	assert.deepEqual(chords(write.args[2]["session.jump1"]), ["Alt+Shift+1"]);
});

test("both abort menu rows show the same, always-abort chord", () => {
	// On macOS `Mod+C` is ⌘C (copy the selection) and `Ctrl+C` is the chord
	// that always aborts. The rows must advertise the latter — which is why
	// they carry a per-row `shortcut` field instead of taking the first chord
	// of the action.
	Keymap.setPlatform("mac");
	reset(harness, { focus: "agent" });
	const chordOf = (menuIndex, label) => {
		harness.run(`openMenuAt(${menuIndex})`);
		const dd = harness.document.querySelector(".dropdown");
		const row = dd.querySelectorAll(".row").find((r) => textOf(r.children[0]).includes(label));
		assert.ok(row, `the "${label}" row exists`);
		return textOf(row.querySelector(".sc"));
	};
	const run = chordOf(3, "Abort command");
	const agent = chordOf(4, "Abort agent generation");
	assert.equal(run, "⌃C", "the abort row shows the always-abort chord");
	assert.equal(agent, "⌃C", "both abort rows show the same chord");
	assert.notEqual(run, "⌘C", "the copy chord is not advertised");
});

test("the configured send key sends the message, the plain Enter does not", async () => {
	reset(harness, { focus: "agent" });
	harness.run(`luuna.getConfig = async () => ({ success: true, data: {
		settings: { appearance: { theme: "dos" }, keybindings: {}, app: { sendKey: "Ctrl+Enter" } },
		themes: [], paths: {}, errors: [] } });`);
	await harness.run("Config.loadConfig()");
	assert.deepEqual(Keymap.chordsFor("composer.send"), ["Ctrl+Enter"], "the app settings configure the send key");

	reset(harness, { focus: "input" });
	harness.run("inputArea.value = 'hello';");
	harness.keydown(keyEvent({ key: "Enter", code: "Enter", ctrlKey: true }));
	assert.equal(harness.lastCall(), "prompt", "the configured key sends");
	assert.equal(harness.calls[harness.calls.length - 1].args[0], "hello");

	reset(harness, { focus: "input" });
	harness.run("inputArea.value = 'hello';");
	const plain = namedKey("Enter");
	harness.keydown(plain);
	assert.equal(harness.callNames().includes("prompt"), false, "the plain Enter does not send anymore");
});

test("the help screen and the guide show the configured send key", async () => {
	reset(harness, { focus: "agent" });
	harness.run(`luuna.getConfig = async () => ({ success: true, data: {
		settings: { appearance: { theme: "dos" }, keybindings: {}, app: { sendKey: "Ctrl+Enter" } },
		themes: [], paths: {}, errors: [] } });`);
	await harness.run("Config.loadConfig()");

	const help = harness.run("buildHelpLines()");
	const send = help.find((l) => l.text === "Send message");
	assert.ok(send, "the help screen lists the send action");
	assert.equal(send.key, "Ctrl+Enter", "the help screen shows the configured chord");

	const guide = harness.run("buildGuideLines()");
	assert.ok(guide.some((line) => /Ctrl\+Enter\s+Send the message/.test(line)),
		"the guide shows the configured chord");
});



// --- the second fix round ---------------------------------------------------

test("Delete restores the effective default, not the registry chord", async () => {
	reset(harness, { focus: "agent" });
	// The app tier configures the send key, the keybindings tier rebinds it.
	harness.seed("project", "app", { sendKey: "Ctrl+Enter" });
	harness.seed("project", "keybindings", { "composer.send": ["Mod+J"] });
	await harness.run("Config.loadConfig()");
	assert.deepEqual(Keymap.chordsFor("composer.send"), ["Mod+J"], "the explicit rebind wins over the app settings");

	openKeybindings(harness);
	assert.equal(selectRow(harness, "Send message"), true, "the send row is selected");
	harness.keydown(namedKey("Delete"));
	await tick();

	const write = harness.calls.find((c) => c.name === "setConfig");
	assert.ok(write, "the tier's keybindings file is rewritten");
	assert.deepEqual(Object.keys(write.args[2]), [], "no override is written — the app tier must not be shadowed");
	assert.equal(write.args[3], true, "the file is replaced — a merge cannot remove a key");
	assert.deepEqual(Keymap.chordsFor("composer.send"), ["Ctrl+Enter"], "the app-settings default is in effect again");
	const message = harness.document.querySelector(".kb-msg").textContent;
	assert.match(message, /app-settings default is in effect again/, "the message says what is in effect");
});

test("a failed font-family write restores the previous family", async () => {
	reset(harness, { focus: "agent" });
	harness.run("openSettingsDialog('appearance')");
	const content = harness.document.querySelector(".settings-content");
	const input = content.querySelector(".dlg-input");
	assert.ok(input, "the font family field exists");
	const before = harness.document.documentElement.style.getPropertyValue("--font");
	assert.ok(before, "the font is applied");

	// The write fails.
	harness.run("luuna.setConfig = async () => ({ success: false, error: 'disk full' });");
	input.value = "Arial";
	input.fire("input", {});
	assert.equal(harness.document.documentElement.style.getPropertyValue("--font"), "Arial", "the family is applied live");

	input.fire("change", {});
	await tick();
	await tick();
	assert.equal(harness.document.documentElement.style.getPropertyValue("--font"), before,
		"the failed write restored the previous family");
	assert.equal(input.value, before, "the field shows the restored family");
});

test("Delete with text in the search field does not reset a binding, even when the field is blurred", async () => {
	reset(harness, { focus: "agent" });
	openKeybindings(harness);
	const search = harness.document.querySelector(".kb-search");
	search.value = "palette";
	// The user clicked a row: the field lost the focus but kept its text.
	harness.document.activeElement = null;
	harness.calls.length = 0;

	const e = namedKey("Delete");
	harness.keydown(e);
	assert.equal(e.defaultPrevented, false, "the search field keeps its own Delete");
	await tick();
	assert.equal(harness.callNames().includes("setConfig"), false, "no binding was written");
});

test("Backspace with text in the search field does not clear a binding, even when the field is blurred", async () => {
	reset(harness, { focus: "agent" });
	openKeybindings(harness);
	const search = harness.document.querySelector(".kb-search");
	search.value = "palette";
	harness.document.activeElement = null;
	harness.calls.length = 0;

	const e = namedKey("Backspace");
	harness.keydown(e);
	assert.equal(e.defaultPrevented, false, "the search field keeps its own Backspace");
	await tick();
	assert.equal(harness.callNames().includes("setConfig"), false, "no binding was written");
});

test("the menu column shows the plain function key, like the key bar", () => {
	reset(harness, { focus: "agent" });
	const chordOf = (menuIndex, label) => {
		harness.run("openMenuAt(" + menuIndex + ")");
		const dd = harness.document.querySelector(".dropdown");
		const row = dd.querySelectorAll(".row").find((r) => textOf(r.children[0]).includes(label));
		assert.ok(row, "the \"" + label + "\" row exists");
		return textOf(row.querySelector(".sc"));
	};
	assert.equal(chordOf(4, "Select model"), "F4", "the menu shows the function key");
	assert.equal(chordOf(4, "Thinking effort"), "F5", "the menu shows the function key");
	// The key bar shows the same chord.
	assert.equal(harness.run("actionDisplayChord('agent.model')"), "F4");
	assert.equal(harness.run("actionDisplayChord('agent.thinking')"), "F5");
});

test("an app-settings default that takes a chord away warns", async () => {
	reset(harness, { focus: "agent" });
	harness.seed("project", "app", { sendKey: "Escape" });
	await harness.run("applyConfiguration()");
	assert.deepEqual(Keymap.chordsFor("composer.cancel"), [], "the cancel action lost its chord");

	// The keybindings editor names the action that lost its chord.
	openKeybindings(harness);
	const warn = harness.document.querySelector(".dline.k");
	assert.ok(warn, "the section warns about it");
	assert.match(warn.textContent, /takes Escape away from Cancel \/ stop generation/);

	// ... and the key bar says so too.
	assert.match(String(harness.run("state.flash")), /takes Escape away from Cancel \/ stop generation/);
});
