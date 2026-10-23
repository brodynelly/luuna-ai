"use strict";
/**
 * Mutation check for the second fix round.
 *
 * Each mutation breaks one of the fixed behaviours in a COPY of the renderer
 * (or of the keymap) and runs the test suite against the copy — the affected
 * test has to fail.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "luuna-mut-"));

const MUTATIONS = [
	{
		name: "reset writes the registry chord again (the app tier is shadowed)",
		file: "renderer/renderer.js",
		from: `			const def = Keymap.effectiveDefaultFor(action.id);`,
		to: `			const def = { source: "registry", chords: Keymap.registryChordsFor(action.id) };`,
		expect: "Delete restores the effective default, not the registry chord",
	},
	{
		name: "the font family is snapshotted after the live apply",
		file: "renderer/renderer.js",
		from: `		const restore = familyBefore !== null ? familyBefore : familySaved;`,
		to: `		const restore = font.family;`,
		expect: "a failed font-family write restores the previous family",
	},
	{
		name: "the Delete guard looks at the focus again",
		file: "renderer/renderer.js",
		from: `			if (e.key === "Delete") {
				// The search field keeps its own Delete while it holds text —
				// the same guard the Backspace branch has. The guard is on the
				// CONTENT of the field, not on the focus: the user types a
				// query, clicks a row (which blurs the field but keeps the
				// text) and presses Delete — that must not reset a binding.
				if (search.value) return false;`,
		to: `			if (e.key === "Delete") {
				if (document.activeElement === search && search.value) return false;`,
		expect: "Delete with text in the search field does not reset a binding, even when the field is blurred",
	},
	{
		name: "the Backspace guard looks at the focus again",
		file: "renderer/renderer.js",
		from: `			if (e.key === "Backspace") {
				// The search field keeps its own Backspace while it holds text.
				if (search.value) return false;`,
		to: `			if (e.key === "Backspace") {
				if (document.activeElement === search && search.value) return false;`,
		expect: "Backspace with text in the search field does not clear a binding, even when the field is blurred",
	},
	{
		name: "the menu column shows the first chord again",
		file: "renderer/renderer.js",
		from: `	if (item.shortcutAction) return actionExplicitChord(id);
	return actionDisplayChord(id);`,
		to: `	if (item.shortcutAction) return actionExplicitChord(id);
	return actionChord(id);`,
		expect: "the menu column shows the plain function key, like the key bar",
	},
	{
		name: "the recorder commits on a modified Enter again",
		file: "renderer/renderer.js",
		from: `				if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {`,
		to: `				if (e.key === "Enter") {`,
		expect: "a chord that ends in Enter is recorded like any other chord",
	},
	{
		name: "the app-default collision is not reported",
		file: "renderer/keymap.js",
		from: `			for (const chord of registryChordsFor(action.id)) {
				const owner = defaultOwner(action, chord);
				if (!owner) continue;`,
		to: `			for (const chord of registryChordsFor(action.id)) {
				const owner = null;
				if (!owner) continue;`,
		expect: "an app-settings default that takes a chord away warns",
		testFile: "test/keyboard.test.js",
	},
];

let failed = 0;
for (const mutation of MUTATIONS) {
	const source = fs.readFileSync(path.join(ROOT, mutation.file), "utf8");
	if (!source.includes(mutation.from)) {
		console.log("SKIP  " + mutation.name + " (the target text is gone)");
		failed++;
		continue;
	}
	const copy = source.replace(mutation.from, mutation.to);
	const target = path.join(tmp, path.basename(mutation.file));
	fs.writeFileSync(target, copy);
	const env = Object.assign({}, process.env);
	if (mutation.file === "renderer/renderer.js") env.LUUNA_RENDERER = target;
	else env.LUUNA_KEYMAP = target;
	const file = mutation.testFile || (mutation.file === "renderer/renderer.js" ? "test/keyboard.test.js" : "test/keymap.test.js");
	let output = "";
	let ok = false;
	try {
		output = execFileSync(process.execPath, ["--test", "--test-name-pattern", mutation.expect, file], {
			cwd: ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
		});
		ok = true;
	} catch (err) {
		output = String(err.stdout || "") + String(err.stderr || "");
	}
	const failedTest = /not ok \d+ - /.test(output) || /✖/.test(output);
	if (failedTest) {
		console.log("OK    " + mutation.name + " -> " + mutation.expect + " fails");
	} else {
		console.log("FAIL  " + mutation.name + " -> " + mutation.expect + " still passes");
		failed++;
	}
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
