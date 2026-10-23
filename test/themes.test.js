"use strict";
/**
 * LUUNA-AI — theme unit tests.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Themes = require("../renderer/themes.js");

/** The `:root` palette of the stylesheet, read from the file itself. */
function stylesheetPalette() {
	const css = fs.readFileSync(path.join(__dirname, "..", "renderer", "renderer.css"), "utf8");
	const start = css.indexOf(":root {");
	assert.ok(start >= 0, "the stylesheet must have a :root block");
	const end = css.indexOf("}", start);
	const block = css.slice(start, end);
	const out = {};
	const re = /--([a-z]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g;
	let m;
	while ((m = re.exec(block)) !== null) out[m[1]] = m[2];
	return out;
}

test("the palette has exactly the 16 canonical names", () => {
	assert.equal(Themes.PALETTE_NAMES.length, 16);
	assert.deepEqual(Themes.PALETTE_NAMES, [
		"black", "blue", "green", "cyan", "red", "magenta", "brown", "lgray",
		"dgray", "lblue", "lgreen", "lcyan", "lred", "lmagenta", "yellow", "white",
	]);
});

test("the five built-in themes ship with the app", () => {
	assert.deepEqual(Object.keys(Themes.BUILTIN_THEMES), ["dos", "amber", "phosphor", "paper", "midnight"]);
});

test("every built-in theme defines all 16 palette names", () => {
	for (const [id, theme] of Object.entries(Themes.BUILTIN_THEMES)) {
		assert.deepEqual(Object.keys(theme.palette).sort(), [...Themes.PALETTE_NAMES].sort(), `${id} must define every name`);
		for (const [name, value] of Object.entries(theme.palette)) {
			assert.match(value, /^#[0-9a-fA-F]{6}$/, `${id}.${name} must be a hex colour`);
		}
	}
});

test("DOS Blue is byte-identical to the current :root palette", () => {
	const css = stylesheetPalette();
	const names = Themes.PALETTE_NAMES;
	for (const name of names) {
		assert.equal(css[name], Themes.DOS_BLUE.palette[name], `--${name} must not change`);
	}
	assert.equal(Object.keys(css).length, names.length, "the stylesheet has exactly 16 colour literals");
});

test("resolveTheme falls back to DOS Blue for an unknown id", () => {
	const theme = Themes.resolveTheme("does-not-exist");
	assert.equal(theme.id, "dos");
	assert.deepEqual(theme.palette, Themes.DOS_BLUE.palette);
});

test("resolveTheme falls back per name, not per theme", () => {
	const partial = { id: "mine", name: "Mine", palette: { blue: "#123456" } };
	const theme = Themes.resolveTheme("mine", { mine: partial });
	assert.equal(theme.palette.blue, "#123456", "the supplied name applies");
	assert.equal(theme.palette.cyan, Themes.DOS_BLUE.palette.cyan, "a missing name falls back to DOS Blue");
	assert.equal(Object.keys(theme.palette).length, 16, "the resolved palette is always complete");
});

test("resolveTheme ignores names outside the canonical 16", () => {
	const theme = Themes.resolveTheme("mine", { mine: { id: "mine", palette: { blue: "#123456", chartreuse: "#00FF00" } } });
	assert.equal(theme.palette.chartreuse, undefined);
	assert.equal(Object.keys(theme.palette).length, 16);
});

test("a user theme shadows the built-in theme with the same id", () => {
	const user = { id: "amber", name: "My amber", palette: { blue: "#010203" } };
	const merged = Themes.mergeThemes(Themes.BUILTIN_THEMES, [user]);
	assert.equal(merged.amber.name, "My amber");
	const theme = Themes.resolveTheme("amber", merged);
	assert.equal(theme.palette.blue, "#010203");
	assert.equal(theme.palette.red, Themes.DOS_BLUE.palette.red, "the missing names still fall back to DOS Blue");
});

test("a user theme with a new id is added to the built-ins", () => {
	const merged = Themes.mergeThemes(Themes.BUILTIN_THEMES, [{ id: "mine", palette: {} }]);
	assert.equal(Object.keys(merged).length, 6);
	assert.ok(merged.mine);
	assert.equal(Themes.resolveTheme("mine", merged).id, "mine");
});

test("applyTheme is a no-op without a DOM", () => {
	assert.equal(Themes.applyTheme(Themes.DOS_BLUE), null);
	assert.doesNotThrow(() => Themes.applyTheme("amber", { family: "x", size: "12px", lineHeight: 1 }));
});

test("the default font is the one the stylesheet ships with", () => {
	assert.equal(Themes.DEFAULT_FONT.size, "14px");
	assert.equal(Themes.DEFAULT_FONT.lineHeight, 1.25);
	assert.match(Themes.DEFAULT_FONT.family, /Consolas/);
});
