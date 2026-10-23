"use strict";
/**
 * LUUNA-AI — keymap unit tests.
 *
 * The renderer has no build step, so the pure parts of `renderer/keymap.js`
 * are written as a UMD-style module that `node --test` can require.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const Keymap = require("../renderer/keymap.js");
const Config = require("../renderer/config.js");

/** A fake KeyboardEvent. */
function ev(key, opts = {}) {
	const o = opts || {};
	const code = o.code !== undefined ? o.code
		: key.length === 1 && /[a-zA-Z]/.test(key) ? "Key" + key.toUpperCase()
			: key.length === 1 && /[0-9]/.test(key) ? "Digit" + key
				: key;
	return {
		key,
		code,
		ctrlKey: !!o.ctrl,
		altKey: !!o.alt,
		shiftKey: !!o.shift,
		metaKey: !!o.meta,
	};
}

test.beforeEach(() => { Keymap.setPlatform("other"); });
test.afterEach(() => {
	// The keymap is a singleton: a test that applies an override or a default
	// must not leak it into the next one.
	Keymap.applyOverrides({});
	Keymap.applyDefaults({});
	Keymap.setPlatform(null);
});

// -----------------------------------------------------------------------
// The registry
// -----------------------------------------------------------------------

test("the registry holds every action of the spec, with unique ids", () => {
	const ids = Keymap.ACTIONS.map((a) => a.id);
	assert.equal(new Set(ids).size, ids.length, "action ids must be unique");
	for (const id of [
		"app.palette", "app.settings", "app.theme", "app.keybindings", "app.help", "app.menu", "app.exit",
		"file.new", "file.save", "file.open", "file.export", "file.chdir", "file.preview",
		"session.regenerate", "session.regenerateModel", "session.next", "session.prev",
		"agent.model", "agent.thinking", "agent.mode", "agent.fork", "agent.attachContext", "agent.findInChat",
		"agent.cycleModel", "agent.compact", "agent.clone", "agent.abort",
		"search.findFile", "search.grep", "search.clear", "tree.refresh",
		"git.diff", "git.status", "git.log", "git.refresh",
		"run.tests", "run.build", "run.command",
		"edit.copyOrAbort", "view.clear", "view.toggleSidebar", "view.zoomOut", "view.zoomIn", "view.zoomReset",
		"view.halfPageDown", "view.halfPageUp", "window.next", "window.tile",
		"composer.send", "composer.newline", "composer.sendAlternate", "composer.cancel",
		"composer.historyPrev", "composer.historyNext",
		"nav.down", "nav.up", "nav.left", "nav.right", "nav.top", "nav.bottom",
		"nav.insert", "nav.commandLine", "nav.find", "nav.help",
		"tree.up", "tree.end", "tree.open", "tree.escape",
		"agent.up", "agent.end", "agent.focusInput", "agent.escape",
	]) {
		assert.ok(ids.includes(id), `missing action: ${id}`);
	}
});

test("the nine recent-session jumps share one group", () => {
	const jumps = Keymap.ACTIONS.filter((a) => a.id.startsWith("session.jump"));
	assert.equal(jumps.length, 9);
	for (const jump of jumps) assert.equal(jump.group, "Recent sessions");
	assert.deepEqual(Keymap.chordsFor("session.jump9"), ["Mod+9"]);
});

test("menu-only actions exist with an empty chord list", () => {
	for (const id of ["file.export", "file.chdir", "search.grep", "git.log", "opt.keys", "help.about"]) {
		assert.deepEqual(Keymap.chordsFor(id), [], `${id} must be unbound by default`);
	}
});

test("the menu aliases resolve to the registry ids", () => {
	assert.equal(Keymap.resolveAlias("tools.model"), "agent.model");
	assert.equal(Keymap.resolveAlias("search.find"), "search.findFile");
	assert.equal(Keymap.resolveAlias("help.show"), "app.help");
	assert.deepEqual(Keymap.chordsFor("tools.model"), ["Mod+Shift+M", "F4"]);
	assert.deepEqual(Keymap.chordsFor("help.show"), ["F1", "Mod+/"]);
});

test("every default chord is already in its canonical form", () => {
	for (const action of Keymap.ACTIONS) {
		for (const chord of action.chords) {
			assert.equal(Keymap.normalizeBinding(chord), chord, `${action.id}: ${chord} is not canonical`);
		}
	}
});

test("a comma is a key, not a sequence separator", () => {
	assert.deepEqual(Keymap.chordsFor("app.settings"), ["Mod+,"]);
	assert.equal(Keymap.normalizeBinding("Mod+,"), "Mod+,");
	assert.equal(Keymap.normalizeBinding("Ctrl+W,H"), "Ctrl+W,H");
	assert.equal(Keymap.normalizeBinding("G,G"), "G,G");
});

// -----------------------------------------------------------------------
// The chord grammar
// -----------------------------------------------------------------------

test("parseChord reads modifiers and the key", () => {
	const chord = Keymap.parseChord("Mod+Shift+M");
	assert.equal(chord.key, "M");
	assert.equal(chord.primary, "Mod");
	assert.equal(chord.mods.shift, true);
	assert.equal(chord.mods.alt, false);
});

test("parseChord rejects malformed chords", () => {
	assert.equal(Keymap.parseChord("Mod+"), null, "an empty key is invalid");
	assert.equal(Keymap.parseChord("Mod+Ctrl+K"), null, "Mod and Ctrl are mutually exclusive");
	assert.equal(Keymap.parseChord("Hyper+K"), null, "an unknown modifier is invalid");
	assert.equal(Keymap.parseChord("Mod+F13"), null, "an unknown key is invalid");
	assert.equal(Keymap.parseChord(""), null);
	assert.equal(Keymap.parseChord(null), null);
});

test("normalizeChord is order independent and uses the canonical order", () => {
	assert.equal(Keymap.normalizeChord("shift+mod+m"), "Mod+Shift+M");
	assert.equal(Keymap.normalizeChord("Mod+Shift+M"), "Mod+Shift+M");
	assert.equal(Keymap.normalizeChord("Ctrl+Alt+Shift+X"), "Ctrl+Alt+Shift+X");
	assert.equal(Keymap.normalizeChord("alt+shift+f1"), "Alt+Shift+F1");
	assert.equal(Keymap.normalizeChord("ctrl+k"), "Ctrl+K");
	assert.equal(Keymap.normalizeChord("mod+ctrl+x"), null);
});

test("Mod expands to Ctrl off macOS and to Meta on macOS", () => {
	Keymap.setPlatform("other");
	let chord = Keymap.parseChord("Mod+K");
	assert.equal(chord.mods.ctrl, true);
	assert.equal(chord.mods.meta, false);

	Keymap.setPlatform("mac");
	chord = Keymap.parseChord("Mod+K");
	assert.equal(chord.mods.meta, true);
	assert.equal(chord.mods.ctrl, false);

	// Ctrl and Meta are never expanded.
	assert.equal(Keymap.parseChord("Ctrl+K").mods.ctrl, true);
	assert.equal(Keymap.parseChord("Meta+K").mods.meta, true);
});

test("the canonical form stays portable across platforms", () => {
	Keymap.setPlatform("other");
	assert.equal(Keymap.normalizeChord("Mod+K"), "Mod+K");
	Keymap.setPlatform("mac");
	assert.equal(Keymap.normalizeChord("Mod+K"), "Mod+K");
});

test("formatChord renders the platform's notation", () => {
	Keymap.setPlatform("other");
	assert.equal(Keymap.formatChord("Mod+K"), "Ctrl+K");
	assert.equal(Keymap.formatChord("Ctrl+Shift+L"), "Ctrl+Shift+L");
	assert.equal(Keymap.formatChord("Alt+X"), "Alt+X");
	Keymap.setPlatform("mac");
	assert.equal(Keymap.formatChord("Mod+K"), "⌘K");
	assert.equal(Keymap.formatChord("Mod+Shift+M"), "⌘⇧M");
	assert.equal(Keymap.formatChord("Alt+X"), "⌥X");
});

test("the key of an event is derived from the physical key", () => {
	assert.equal(Keymap.deriveKey(ev("j", { code: "KeyJ" })), "J", "a letter is uppercased");
	assert.equal(Keymap.deriveKey(ev("J", { code: "KeyJ" })), "J");
	assert.equal(Keymap.deriveKey(ev("!", { code: "Digit1" })), "1", "a digit keeps the digit");
	assert.equal(Keymap.deriveKey(ev("?", { code: "Slash" })), "?", "a symbol keeps its symbol");
	assert.equal(Keymap.deriveKey(ev("Enter")), "Enter");
	assert.equal(Keymap.deriveKey(ev(" ")), "Space");
});

test("Shift is a modifier for letters, digits and named keys only", () => {
	assert.equal(Keymap.eventChord(ev("K", { shift: true, code: "KeyK" })).mods.shift, true);
	assert.equal(Keymap.eventChord(ev("1", { shift: true, code: "Digit1" })).mods.shift, true);
	assert.equal(Keymap.eventChord(ev("Enter", { shift: true })).mods.shift, true);
	assert.equal(Keymap.eventChord(ev("?", { shift: true, code: "Slash" })).mods.shift, false);
});

// -----------------------------------------------------------------------
// resolve()
// -----------------------------------------------------------------------

test("resolve matches a modified chord", () => {
	const hit = Keymap.resolve(ev("f", { ctrl: true }), { focus: "tree" });
	assert.equal(hit.actionId, "search.findFile");
});

test("resolve requires every modifier to match exactly", () => {
	// Ctrl+Shift+F is "find in agent output" (Mod+Shift+F), not "find file".
	const hit = Keymap.resolve(ev("f", { ctrl: true, shift: true }), { focus: "tree" });
	assert.equal(hit.actionId, "agent.findInChat");
	assert.equal(Keymap.resolve(ev("f", { ctrl: true, alt: true }), { focus: "tree" }), null);
});

test("resolve honours the scope", () => {
	assert.equal(Keymap.resolve(ev("Enter"), { focus: "tree" }).actionId, "tree.open");
	assert.equal(Keymap.resolve(ev("Enter"), { focus: "agent" }).actionId, "agent.focusInput");
	assert.equal(Keymap.resolve(ev("Enter"), { focus: "input" }).actionId, "composer.send");
	assert.equal(Keymap.resolve(ev("Escape"), { focus: "input" }).actionId, "composer.cancel");
	assert.equal(Keymap.resolve(ev("ArrowUp"), { focus: "input" }).actionId, "composer.historyPrev");
	assert.equal(Keymap.resolve(ev("ArrowUp"), { focus: "tree" }).actionId, "tree.up");
	assert.equal(Keymap.resolve(ev("ArrowUp"), { focus: "agent" }).actionId, "agent.up");
	assert.equal(Keymap.resolve(ev("d", { ctrl: true }), { focus: "tree" }).actionId, "view.halfPageDown");
	assert.equal(Keymap.resolve(ev("d", { ctrl: true }), { focus: "input" }), null, "the half page chords are pane scoped");
});

test("a bare letter is only matched in the normal scope", () => {
	assert.equal(Keymap.resolve(ev("j", { code: "KeyJ" }), { focus: "tree" }).actionId, "nav.down");
	assert.equal(Keymap.resolve(ev("j", { code: "KeyJ" }), { focus: "agent" }).actionId, "nav.down");
	assert.equal(Keymap.resolve(ev("j", { code: "KeyJ" }), { focus: "input" }), null, "typing must never be swallowed");
	assert.equal(Keymap.resolve(ev("i", { code: "KeyI" }), { focus: "tree" }).actionId, "nav.insert");
	assert.equal(Keymap.resolve(ev("i", { code: "KeyI" }), { focus: "input" }), null);
});

test("the tree-only normal motions are restricted to the tree", () => {
	assert.equal(Keymap.resolve(ev("h", { code: "KeyH" }), { focus: "tree" }).actionId, "nav.left");
	assert.equal(Keymap.resolve(ev("h", { code: "KeyH" }), { focus: "agent" }), null);
	assert.equal(Keymap.resolve(ev("l", { code: "KeyL" }), { focus: "tree" }).actionId, "nav.right");
	assert.equal(Keymap.resolve(ev("l", { code: "KeyL" }), { focus: "agent" }), null);
});

test("the function keys and the exit chord still resolve", () => {
	assert.equal(Keymap.resolve(ev("F1"), { focus: "tree" }).actionId, "app.help");
	assert.equal(Keymap.resolve(ev("F2"), { focus: "tree" }).actionId, "file.save");
	assert.equal(Keymap.resolve(ev("F4"), { focus: "tree" }).actionId, "agent.model");
	assert.equal(Keymap.resolve(ev("F10"), { focus: "tree" }).actionId, "app.menu");
	assert.equal(Keymap.resolve(ev("x", { alt: true, code: "KeyX" }), { focus: "tree" }).actionId, "app.exit");
	assert.equal(Keymap.resolve(ev("Tab"), { focus: "tree" }).actionId, "window.next");
});

test("an overlay or an open menu owns the keyboard", () => {
	assert.equal(Keymap.resolve(ev("f", { ctrl: true }), { focus: "tree", overlayOpen: true }), null);
	assert.equal(Keymap.resolve(ev("f", { ctrl: true }), { focus: "tree", menuOpen: true }), null);
});

test("a two-key sequence resolves through its prefix", () => {
	const first = Keymap.resolve(ev("w", { ctrl: true }), { focus: "tree" });
	assert.equal(first.pending, true);
	assert.equal(first.prefix, "Ctrl+W");

	const second = Keymap.resolve(ev("h", { code: "KeyH" }), { focus: "tree", pendingChord: "Ctrl+W" });
	assert.equal(second.actionId, "window.motionTree");
	assert.equal(second.chord, "Ctrl+W,H");

	assert.equal(Keymap.resolve(ev("j", { code: "KeyJ" }), { focus: "tree", pendingChord: "Ctrl+W" }).actionId, "window.motionAgent");
	assert.equal(Keymap.resolve(ev("w", { ctrl: true }), { focus: "tree", pendingChord: "Ctrl+W" }), null, "a pending prefix is not re-armed");
});

test("the gg sequence jumps to the top, Shift+G to the bottom", () => {
	const first = Keymap.resolve(ev("g", { code: "KeyG" }), { focus: "tree" });
	assert.equal(first.pending, true);
	assert.equal(first.prefix, "G");
	const second = Keymap.resolve(ev("g", { code: "KeyG" }), { focus: "tree", pendingChord: "G" });
	assert.equal(second.actionId, "nav.top");
	assert.equal(Keymap.resolve(ev("G", { shift: true, code: "KeyG" }), { focus: "tree" }).actionId, "nav.bottom");
});

test("isBound reports whether an action owns the event", () => {
	assert.equal(Keymap.isBound("search.findFile", ev("f", { ctrl: true }), { focus: "tree" }), true);
	assert.equal(Keymap.isBound("agent.findInChat", ev("f", { ctrl: true }), { focus: "tree" }), false);
});

// -----------------------------------------------------------------------
// Overrides
// -----------------------------------------------------------------------

test("applyOverrides replaces the default chords of an action", () => {
	Keymap.applyOverrides({ "app.palette": ["Mod+J"] });
	assert.deepEqual(Keymap.chordsFor("app.palette"), ["Mod+J"]);
	assert.equal(Keymap.resolve(ev("j", { ctrl: true }), { focus: "tree" }).actionId, "app.palette");
	assert.equal(Keymap.resolve(ev("k", { ctrl: true }), { focus: "tree" }), null, "the old binding is gone");
	Keymap.applyOverrides({});
	assert.deepEqual(Keymap.chordsFor("app.palette"), ["Mod+K"]);
});

test("applyOverrides normalises the override chords", () => {
	Keymap.applyOverrides({ "app.palette": ["shift+mod+m"] });
	assert.deepEqual(Keymap.chordsFor("app.palette"), ["Mod+Shift+M"]);
	Keymap.applyOverrides({});
});

test("applyOverrides ignores unknown action ids and malformed chords", () => {
	Keymap.applyOverrides({ "app.nope": ["Mod+Q"], "app.palette": ["Mod+"] });
	assert.deepEqual(Keymap.chordsFor("app.palette"), ["Mod+K"], "a malformed chord is dropped");
	assert.deepEqual(Keymap.chordsFor("app.nope"), []);
	Keymap.applyOverrides({});
});

test("an empty override list unbinds an action", () => {
	Keymap.applyOverrides({ "app.palette": [] });
	assert.deepEqual(Keymap.chordsFor("app.palette"), []);
	assert.equal(Keymap.resolve(ev("k", { ctrl: true }), { focus: "tree" }), null);
	Keymap.applyOverrides({});
});

test("findConflict names the action that already owns the chord", () => {
	const conflict = Keymap.findConflict("Ctrl+F");
	assert.equal(conflict.actionId, "search.findFile");
	assert.equal(Keymap.findConflict("Ctrl+F", "search.findFile"), null, "an action does not conflict with itself");
	assert.equal(Keymap.findConflict("Mod+9").actionId, "session.jump9");
	assert.equal(Keymap.findConflict("Ctrl+Shift+Q"), null);
});

test("a conflict uses the expanded chord, so Mod and Ctrl collide off macOS", () => {
	Keymap.setPlatform("other");
	assert.ok(Keymap.findConflict("Mod+F"), "Mod+F and Ctrl+F are the same chord on Windows");
	Keymap.setPlatform("mac");
	assert.equal(Keymap.findConflict("Mod+F"), null, "Cmd+F and Ctrl+F are distinct on macOS");
});

// -----------------------------------------------------------------------
// The scope-aware conflict check
// -----------------------------------------------------------------------

test("a bare letter cannot be bound to a global action", () => {
	// The bare-letter rule: a global action is live everywhere, so a bare
	// letter would swallow the typing in the composer — it could never fire.
	const check = Keymap.validateBinding("app.palette", "K");
	assert.equal(check.ok, false);
	assert.equal(check.reason, "bare");
	assert.equal(Keymap.bareAllowed(Keymap.actionById("app.palette"), Keymap.parseChord("K")), false);
});

test("a bare letter cannot be bound to a composer action either", () => {
	const check = Keymap.validateBinding("composer.send", "S");
	assert.equal(check.ok, false);
	assert.equal(check.reason, "bare");
});

test("a bare letter is fine for an action that is inactive in the composer", () => {
	const check = Keymap.validateBinding("nav.down", "J");
	assert.equal(check.ok, true, JSON.stringify(check));
});

test("a chord of another scope is not a conflict", () => {
	// `Enter` belongs to the composer, the palette is a global action: the
	// two can never be live at the same time.
	const check = Keymap.validateBinding("app.palette", "Enter");
	assert.equal(check.ok, true, JSON.stringify(check));
	assert.equal(Keymap.findConflict("Enter", "app.palette"), null);
});

test("a chord of the same scope is still a conflict, and it is named", () => {
	const check = Keymap.validateBinding("app.palette", "Ctrl+F");
	assert.equal(check.ok, false);
	assert.equal(check.reason, "conflict");
	assert.equal(check.conflict.actionId, "search.findFile");
});

test("two actions of the same pane scope conflict", () => {
	// `tree.down` and `tree.up` are both live in the tree pane.
	Keymap.applyOverrides({ "tree.down": ["ArrowUp"] });
	const check = Keymap.validateBinding("tree.up", "ArrowUp");
	assert.equal(check.ok, false);
	assert.equal(check.reason, "conflict");
	assert.equal(check.conflict.actionId, "tree.down");
	// The agent pane is a different scope: the same chord is free there.
	const other = Keymap.validateBinding("agent.up", "ArrowUp");
	assert.equal(other.ok, true, JSON.stringify(other));
	Keymap.applyOverrides({});
});

test("the more specific scope wins the resolution", () => {
	// A global action and a composer action may share a chord: the composer
	// has it while the composer has the focus, the pane has it in the pane.
	Keymap.applyOverrides({ "app.palette": ["Enter"] });
	assert.equal(Keymap.resolve(ev("Enter"), { focus: "input" }).actionId, "composer.send");
	assert.equal(Keymap.resolve(ev("Enter"), { focus: "agent" }).actionId, "agent.focusInput");
	Keymap.applyOverrides({});
});

// -----------------------------------------------------------------------
// The app-settings tier (the send key of the composer)
// -----------------------------------------------------------------------

test("the app-settings default replaces the registry default", () => {
	Keymap.applyDefaults({ "composer.send": ["Ctrl+Enter"] });
	assert.deepEqual(Keymap.chordsFor("composer.send"), ["Ctrl+Enter"]);
	Keymap.applyDefaults({});
	assert.deepEqual(Keymap.chordsFor("composer.send"), ["Enter"]);
});

test("an explicit rebind wins over the app-settings default", () => {
	Keymap.applyDefaults({ "composer.send": ["Ctrl+Enter"] });
	Keymap.applyOverrides({ "composer.send": ["Alt+Enter"] });
	assert.deepEqual(Keymap.chordsFor("composer.send"), ["Alt+Enter"]);
	Keymap.applyOverrides({});
	Keymap.applyDefaults({});
	assert.deepEqual(Keymap.chordsFor("composer.send"), ["Enter"]);
});

test("an app-settings default takes a colliding registry chord away", () => {
	// `Mod+Enter` (the alternate send) is `Ctrl+Enter` off macOS: the
	// registry keeps exactly one owner per chord per scope.
	Keymap.setPlatform("other");
	Keymap.applyDefaults({ "composer.send": ["Ctrl+Enter"] });
	assert.deepEqual(Keymap.chordsFor("composer.send"), ["Ctrl+Enter"]);
	assert.deepEqual(Keymap.chordsFor("composer.sendAlternate"), []);
	Keymap.applyDefaults({});
	assert.deepEqual(Keymap.chordsFor("composer.sendAlternate"), ["Mod+Enter"]);
});

// -----------------------------------------------------------------------
// The chord labels
// -----------------------------------------------------------------------

test("the chord labels of a set are de-duplicated after the Mod expansion", () => {
	Keymap.setPlatform("other");
	assert.deepEqual(Keymap.formatChordSet(["Mod+C", "Ctrl+C"]), ["Ctrl+C"]);
	assert.deepEqual(Keymap.formatChordSet(["Mod+L", "Ctrl+L"]), ["Ctrl+L"]);
	Keymap.setPlatform("mac");
	assert.deepEqual(Keymap.formatChordSet(["Mod+C", "Ctrl+C"]), ["⌘C", "⌃C"]);
});

test("the explicitly spelled chord is the one that always applies", () => {
	assert.equal(Keymap.explicitChord("edit.copyOrAbort"), "Ctrl+C");
	assert.equal(Keymap.explicitChord("view.clear"), "Ctrl+L");
	// An action without an explicit spelling keeps its first chord.
	assert.equal(Keymap.explicitChord("app.palette"), "Mod+K");
	assert.equal(Keymap.explicitChord("app.help"), "F1");
	assert.equal(Keymap.explicitChord("agent.abort"), "");
});

// -----------------------------------------------------------------------
// The effective default (what "reset to default" restores)
// -----------------------------------------------------------------------

test("the effective default is the app-settings value when there is one", () => {
	Keymap.applyDefaults({ "composer.send": ["Ctrl+Enter"] });
	const def = Keymap.effectiveDefaultFor("composer.send");
	assert.equal(def.source, "app");
	assert.deepEqual(def.chords, ["Ctrl+Enter"]);
	// The registry chord is NOT the effective default any more — restoring it
	// would shadow the app tier.
	assert.deepEqual(Keymap.registryChordsFor("composer.send"), ["Enter"]);
});

test("the effective default is the registry chord when the app tier is silent", () => {
	const def = Keymap.effectiveDefaultFor("app.palette");
	assert.equal(def.source, "registry");
	assert.deepEqual(def.chords, ["Mod+K"]);
	assert.deepEqual(Keymap.defaultChordsFor("app.palette"), []);
});

test("the app-settings defaults of an action are readable on their own", () => {
	Keymap.applyDefaults({ "composer.send": ["Ctrl+Enter"], "composer.newline": ["Alt+Enter"] });
	assert.deepEqual(Keymap.defaultChordsFor("composer.send"), ["Ctrl+Enter"]);
	assert.deepEqual(Keymap.defaultChordsFor("composer.newline"), ["Alt+Enter"]);
	assert.deepEqual(Keymap.defaultChordsFor("app.palette"), []);
});

// -----------------------------------------------------------------------
// The app-settings default that takes a chord away from another action
// -----------------------------------------------------------------------

test("the collisions of the app tier name the action that lost its chord", () => {
	Keymap.applyDefaults({ "composer.send": ["Escape"] });
	// `composer.cancel` owns `Escape` in the composer scope: the app tier
	// takes it away, and the user has to learn about it.
	assert.deepEqual(Keymap.chordsFor("composer.cancel"), []);
	const collisions = Keymap.defaultCollisions();
	assert.equal(collisions.length, 1);
	assert.equal(collisions[0].actionId, "composer.cancel");
	assert.equal(collisions[0].label, "Cancel / stop generation");
	assert.equal(collisions[0].chord, "Escape");
	assert.equal(collisions[0].ownerId, "composer.send");
	assert.equal(collisions[0].ownerLabel, "Send message");
});

test("a default of another scope takes no chord away", () => {
	// `Ctrl+F` is the global "find file in tree" — the composer scope is a
	// different one, so the global action keeps its chord.
	Keymap.applyDefaults({ "composer.send": ["Ctrl+F"] });
	assert.deepEqual(Keymap.chordsFor("search.findFile"), ["Ctrl+F"]);
	assert.deepEqual(Keymap.defaultCollisions(), []);
});

test("an action with an app-settings default of its own loses nothing", () => {
	// The send key IS the registry chord of the send action: nothing was
	// taken away from it, so there is no collision to report.
	Keymap.applyDefaults({ "composer.send": ["Enter"] });
	assert.deepEqual(Keymap.defaultCollisions(), []);
});

// -----------------------------------------------------------------------
// The two invariants
// -----------------------------------------------------------------------

/** The expanded form of a chord — `Mod` is resolved for the platform. */
function expandedKey(chord) {
	return Keymap.parseBinding(chord).map((c) => {
		const mods = [];
		if (c.mods.ctrl) mods.push("Ctrl");
		if (c.mods.meta) mods.push("Meta");
		if (c.mods.alt) mods.push("Alt");
		if (c.mods.shift) mods.push("Shift");
		return (mods.length ? mods.join("+") + "+" : "") + c.key;
	}).join(",");
}

/**
 * The chords two actions share, when their scopes overlap.
 *
 * The registry must keep exactly one owner per chord per scope, so this list
 * has to be empty.
 */
function scopeCollisions() {
	const out = [];
	for (let i = 0; i < Keymap.ACTIONS.length; i++) {
		for (let j = i + 1; j < Keymap.ACTIONS.length; j++) {
			const a = Keymap.ACTIONS[i];
			const b = Keymap.ACTIONS[j];
			if (!Keymap.scopesOverlap(a, b)) continue;
			for (const ca of Keymap.chordsFor(a.id)) {
				for (const cb of Keymap.chordsFor(b.id)) {
					if (expandedKey(ca) === expandedKey(cb)) {
						out.push(a.id + " and " + b.id + " both own " + ca);
					}
				}
			}
		}
	}
	return out;
}

/** The synthetic key event a chord produces. */
function eventFor(chord) {
	const first = Keymap.parseBinding(chord)[0];
	const key = first.key;
	const code = /^[A-Z]$/.test(key) ? "Key" + key
		: /^[0-9]$/.test(key) ? "Digit" + key
			: key;
	return {
		key,
		code,
		ctrlKey: !!first.mods.ctrl,
		altKey: !!first.mods.alt,
		shiftKey: !!first.mods.shift,
		metaKey: !!first.mods.meta,
	};
}

/**
 * The resolution of the PREVIOUS implementation: the first action of the
 * registry order that matches. The scope rank replaced it, and it must not
 * change the behaviour of a single registry chord.
 */
function resolveRegistryOrder(event, ctx) {
	const chord = Keymap.eventChord(event);
	if (!chord) return null;
	for (const action of Keymap.ACTIONS) {
		if (!Keymap.scopeActive(action, ctx)) continue;
		for (const binding of Keymap.chordsFor(action.id)) {
			const seq = Keymap.parseBinding(binding);
			if (seq.length !== 1) continue;
			if (!Keymap.sameChord(seq[0], chord)) continue;
			return { actionId: action.id, chord: binding };
		}
	}
	for (const action of Keymap.ACTIONS) {
		if (!Keymap.scopeActive(action, ctx)) continue;
		for (const binding of Keymap.chordsFor(action.id)) {
			const seq = Keymap.parseBinding(binding);
			if (seq.length < 2) continue;
			if (!Keymap.sameChord(seq[0], chord)) continue;
			return { actionId: action.id, chord: binding, pending: true };
		}
	}
	return null;
}

test("INVARIANT 1: the registry keeps exactly one owner per chord per scope", () => {
	// The ten send keys of the review, on both platforms, with the app tier
	// applied. The count has to stay at zero.
	const sendKeys = [
		"Enter", "Ctrl+Enter", "Shift+Enter", "Mod+Enter", "Escape",
		"ArrowUp", "Ctrl+F", "Tab", "F1", "Alt+Enter",
	];
	let measured = 0;
	let pairs = 0;
	for (const platform of ["other", "mac"]) {
		Keymap.setPlatform(platform);
		for (const sendKey of sendKeys) {
			// The defaults of the app tier, exactly as the renderer applies
			// them: a send key equal to the newline key falls back to both
			// defaults, so the tier can never own one chord twice.
			Keymap.applyDefaults(Config.appKeyDefaults({ sendKey }));
			const collisions = scopeCollisions();
			measured += collisions.length;
			pairs++;
			assert.deepEqual(collisions, [], platform + " / sendKey " + sendKey);
		}
	}
	console.log("INVARIANT 1: " + measured + " collisions over " + pairs + " (platform, sendKey) pairs");
	assert.equal(measured, 0, "no collision at all");
});

test("INVARIANT 2: no pre-existing binding changed its behaviour", () => {
	// The scope-rank resolution must return the same action as the previous
	// registry-order resolution for EVERY registry chord, in the `input`,
	// `tree` and `agent` contexts — with and without the app tier.
	let differences = 0;
	let compared = 0;
	for (const platform of ["other", "mac"]) {
		Keymap.setPlatform(platform);
		for (const sendKey of [null, "Ctrl+Enter", "Escape"]) {
			if (sendKey) Keymap.applyDefaults({ "composer.send": [sendKey] });
			for (const focus of ["input", "tree", "agent"]) {
				for (const action of Keymap.ACTIONS) {
					for (const chord of Keymap.registryChordsFor(action.id)) {
						const event = eventFor(chord);
						const before = resolveRegistryOrder(event, { focus });
						const after = Keymap.resolve(event, { focus });
						const beforeId = before ? before.actionId : null;
						const afterId = after ? after.actionId : null;
						compared++;
						if (beforeId !== afterId) {
							differences++;
							assert.equal(afterId, beforeId,
								platform + " / " + focus + " / " + chord + ": " + beforeId + " -> " + afterId);
						}
					}
				}
			}
		}
	}
	console.log("INVARIANT 2: " + differences + " differences over " + compared + " comparisons");
	assert.ok(compared > 100, "only " + compared + " chords were compared");
	assert.equal(differences, 0, "the resolution changed the behaviour of a binding");
});
