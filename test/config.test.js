"use strict";
/**
 * LUUNA-AI — configuration unit tests.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const Config = require("../renderer/config.js");
require("../renderer/themes.js");
require("../renderer/keymap.js");

test("normaliseConfig tolerates a missing payload", () => {
	const cfg = Config.normaliseConfig(null);
	assert.equal(cfg.appearance.theme, "dos");
	assert.deepEqual(cfg.keybindings, {});
	assert.deepEqual(cfg.themes, []);
	assert.deepEqual(cfg.errors, []);
});

test("normaliseConfig reads the settings of the backend", () => {
	const cfg = Config.normaliseConfig({
		settings: {
			appearance: { theme: "amber", font: { family: "Consolas", size: "18px", lineHeight: 1.4 } },
			keybindings: { "app.palette": ["Mod+J"] },
			app: { sendKey: "Enter" },
		},
		themes: [{ id: "mine", palette: { blue: "#000000" } }],
		paths: { globalDir: "C:/Users/x/.luuna" },
	});
	assert.equal(cfg.appearance.theme, "amber");
	assert.equal(cfg.appearance.font.size, "18px");
	assert.deepEqual(cfg.keybindings, { "app.palette": ["Mod+J"] });
	assert.equal(cfg.app.sendKey, "Enter");
	assert.equal(cfg.themes.length, 1);
	assert.equal(cfg.paths.globalDir, "C:/Users/x/.luuna");
});

test("normaliseConfig unwraps the backend envelope", () => {
	const cfg = Config.normaliseConfig({
		success: true,
		data: { settings: { appearance: { theme: "paper" } } },
	});
	assert.equal(cfg.appearance.theme, "paper");
});

test("normaliseConfig accepts a partial payload", () => {
	const cfg = Config.normaliseConfig({ settings: { appearance: { theme: "phosphor" } } });
	assert.equal(cfg.appearance.theme, "phosphor");
	assert.equal(cfg.appearance.font, null);
	assert.deepEqual(cfg.keybindings, {});
});

test("a malformed font is normalised to null", () => {
	assert.equal(Config.normaliseConfig({ settings: { appearance: { font: "big" } } }).appearance.font, null);
});

test("the user font wins over the theme font", () => {
	const theme = { font: { family: "Theme", size: "12px", lineHeight: 1.1 } };
	const font = Config.fontFromSettings({ font: { family: "User", size: "18px" } }, theme);
	assert.equal(font.family, "User");
	assert.equal(font.size, "18px");
	assert.equal(font.lineHeight, 1.1, "the untouched field comes from the theme");
});

test("the theme font wins over the app default", () => {
	const theme = { font: { family: "Theme", size: "12px", lineHeight: 1.1 } };
	const font = Config.fontFromSettings({}, theme);
	assert.equal(font.family, "Theme");
	assert.equal(font.size, "12px");
});

test("the app default is the last resort", () => {
	const font = Config.fontFromSettings({}, null);
	assert.match(font.family, /Consolas/);
	assert.equal(font.size, "14px");
	assert.equal(font.lineHeight, 1.25);
});

test("zoomFontSize walks the size ladder", () => {
	assert.equal(Config.zoomFontSize(14, 1), 16);
	assert.equal(Config.zoomFontSize(14, -1), 13);
	assert.equal(Config.zoomFontSize(14, 0), 14, "0 resets to the default size");
	assert.equal(Config.zoomFontSize("18px", 1), 20);
	assert.equal(Config.zoomFontSize("18px", -1), 16);
	assert.equal(Config.zoomFontSize(32, 1), 32, "the ladder does not overflow");
	assert.equal(Config.zoomFontSize(10, -1), 10);
	assert.equal(Config.zoomFontSize(15, 1), 16);
	assert.equal(Config.zoomFontSize(15, -1), 14);
});

test("the metrics probe is safe without a DOM", () => {
	const probe = Config.createMetricsProbe();
	assert.doesNotThrow(() => probe.measure());
	const measured = probe.measure();
	assert.equal(typeof measured.charWidth, "number");
	assert.equal(typeof measured.lineHeight, "number");
	assert.doesNotThrow(() => probe.destroy());
});

test("invalidateMetrics clears the cached metrics", () => {
	assert.doesNotThrow(() => Config.invalidateMetrics());
	const metrics = Config.getMetrics();
	assert.equal(typeof metrics.charWidth, "number");
	assert.equal(typeof metrics.lineHeight, "number");
});

test("applying a configuration applies the theme and the overrides", () => {
	const Keymap = require("../renderer/keymap.js");
	const cfg = Config.normaliseConfig({
		settings: {
			appearance: { theme: "amber" },
			keybindings: { "app.palette": ["Mod+J"] },
		},
	});
	const applied = Config.applyConfig(cfg);
	assert.equal(applied.theme.id, "amber");
	assert.deepEqual(Keymap.chordsFor("app.palette"), ["Mod+J"]);
	Keymap.applyOverrides({});
});

test("subscribers are notified and can unsubscribe", () => {
	const seen = [];
	const off = Config.subscribe((cfg) => seen.push(cfg));
	Config.notify({ marker: true });
	assert.equal(seen.length, 1);
	off();
	Config.notify({ marker: true });
	assert.equal(seen.length, 1);
});

test("a failure envelope falls back to the defaults", () => {
	const cfg = Config.normaliseConfig({ success: false, error: "the disk is on fire" });
	assert.equal(cfg.appearance.theme, "dos");
	assert.equal(cfg.settings, undefined);
});

test("loadConfig reports a failing backend and keeps the defaults", async () => {
	const previous = globalThis.luuna;
	globalThis.luuna = {
		getConfig: async () => ({ success: false, error: "the disk is on fire" }),
	};
	try {
		const cfg = await Config.loadConfig();
		assert.equal(cfg.appearance.theme, "dos");
		assert.ok(cfg.errors.some((e) => /on fire/.test(e)), "the backend message is reported");
	} finally {
		if (previous === undefined) delete globalThis.luuna;
		else globalThis.luuna = previous;
	}
});

// -----------------------------------------------------------------------
// The app-settings tier (the send key of the composer)
// -----------------------------------------------------------------------

test("the app settings configure the send key of the composer", () => {
	const defaults = Config.appKeyDefaults({ sendKey: "Ctrl+Enter" });
	assert.deepEqual(defaults["composer.send"], ["Ctrl+Enter"]);
	assert.deepEqual(defaults["composer.newline"], ["Shift+Enter"], "the newline key keeps its default");
});

test("the app settings configure the newline key of the composer", () => {
	const defaults = Config.appKeyDefaults({ sendKey: "Ctrl+Enter", newlineKey: "Alt+Enter" });
	assert.deepEqual(defaults["composer.send"], ["Ctrl+Enter"]);
	assert.deepEqual(defaults["composer.newline"], ["Alt+Enter"]);
});

test("a malformed send key falls back to the default", () => {
	const defaults = Config.appKeyDefaults({ sendKey: "Hyper+K" });
	assert.deepEqual(defaults["composer.send"], ["Enter"], "the composer must never be unable to send");
});

test("an empty send key falls back to the default", () => {
	assert.deepEqual(Config.appKeyDefaults({ sendKey: "" })["composer.send"], ["Enter"]);
	assert.deepEqual(Config.appKeyDefaults({})["composer.send"], ["Enter"]);
	assert.deepEqual(Config.appKeyDefaults(null)["composer.send"], ["Enter"]);
});

test("a bare send key falls back to the default", () => {
	// A bare letter is never matched in the composer: it would swallow the
	// typing, so it could never send anything.
	assert.deepEqual(Config.appKeyDefaults({ sendKey: "K" })["composer.send"], ["Enter"]);
});

test("two equal keys fall back to the defaults", () => {
	const defaults = Config.appKeyDefaults({ sendKey: "Ctrl+Enter", newlineKey: "Ctrl+Enter" });
	assert.deepEqual(defaults["composer.send"], ["Enter"]);
	assert.deepEqual(defaults["composer.newline"], ["Shift+Enter"]);
});

test("the app settings are applied as defaults, an explicit rebind wins", () => {
	const Keymap = require("../renderer/keymap.js");
	const cfg = Config.normaliseConfig({
		settings: { app: { sendKey: "Ctrl+Enter" }, keybindings: { "composer.send": ["Alt+Enter"] } },
	});
	Config.applyConfig(cfg);
	assert.deepEqual(Keymap.chordsFor("composer.send"), ["Alt+Enter"], "the rebind wins over the app setting");
	Keymap.applyOverrides({});
	Keymap.applyDefaults({});
	assert.deepEqual(Keymap.chordsFor("composer.send"), ["Enter"]);
});

test("the history size is normalised", () => {
	assert.equal(Config.normaliseConfig({ settings: { app: { historySize: 50 } } }).app.historySize, 50);
	assert.equal(Config.normaliseConfig({ settings: { app: {} } }).app.historySize, 200);
	assert.equal(Config.normaliseConfig({ settings: { app: { historySize: "nonsense" } } }).app.historySize, 200);
	assert.equal(Config.normaliseConfig({ settings: { app: { historySize: 0 } } }).app.historySize, 200);
});

test("the tiers of the backend are kept apart", () => {
	const cfg = Config.normaliseConfig({
		settings: { keybindings: { "app.palette": ["Mod+J"] } },
		tiers: {
			global: { keybindings: { "app.palette": ["Mod+K"] } },
			project: { keybindings: { "app.palette": ["Mod+J"] } },
		},
	});
	assert.deepEqual(cfg.tiers.global.keybindings, { "app.palette": ["Mod+K"] });
	assert.deepEqual(cfg.tiers.project.keybindings, { "app.palette": ["Mod+J"] });
	// A payload without the tiers still yields empty ones.
	const bare = Config.normaliseConfig({});
	assert.deepEqual(bare.tiers.global.keybindings, {});
	assert.deepEqual(bare.tiers.project.keybindings, {});
});
