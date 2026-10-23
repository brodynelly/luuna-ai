/**
 * LUUNA-AI — built-in themes.
 *
 * The 16 palette NAMES are canonical and fixed (see `CLAUDE.md`): a theme only
 * supplies VALUES for them. The values for the built-in themes live here and
 * nowhere else — the Rust backend only knows the names, so it can reject a
 * 17th name at the file boundary.
 *
 * Applying a theme is a CSSOM write on `document.documentElement`
 * (`setProperty`), never a stylesheet injection and never a `style=`
 * attribute: the app's CSP is `default-src 'self'; style-src 'self';
 * script-src 'self'`.
 *
 * The module works both as a classic browser script (it installs
 * `window.LuunaThemes`) and as a CommonJS module (so `node --test` can
 * require it).
 */
(function (root, factory) {
	"use strict";
	const api = factory();
	if (typeof module === "object" && module.exports) module.exports = api;
	if (root) root.LuunaThemes = api;
	if (typeof window !== "undefined" && window !== root) window.LuunaThemes = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
	"use strict";

	/**
	 * The 16 canonical palette names, in the order they appear in the `:root`
	 * block of `renderer/renderer.css`. Never add a 17th name and never use an
	 * ad-hoc colour outside this list.
	 */
	const PALETTE_NAMES = [
		"black", "blue", "green", "cyan", "red", "magenta", "brown", "lgray",
		"dgray", "lblue", "lgreen", "lcyan", "lred", "lmagenta", "yellow", "white",
	];

	/** The app's default font — the values the stylesheet ships with. */
	const DEFAULT_FONT = {
		family: '"Consolas", "Lucida Console", "Courier New", monospace',
		size: "14px",
		lineHeight: 1.25,
	};

	/**
	 * DOS Blue — the current royal-blue desktop. These values are byte-identical
	 * to the `:root` block of `renderer/renderer.css`; a user upgrading must see
	 * no visual change. `test/themes.test.js` compares the two.
	 */
	const DOS_BLUE = {
		id: "dos",
		name: "DOS Blue",
		description: "The classic royal-blue DOS desktop — the default.",
		palette: {
			black: "#000000",
			blue: "#0000AA",
			green: "#00AA00",
			cyan: "#00AAAA",
			red: "#AA0000",
			magenta: "#AA00AA",
			brown: "#AA5500",
			lgray: "#AAAAAA",
			dgray: "#555555",
			lblue: "#5555FF",
			lgreen: "#55FF55",
			lcyan: "#55FFFF",
			lred: "#FF5555",
			lmagenta: "#FF55FF",
			yellow: "#FFFF55",
			white: "#FFFFFF",
		},
		font: { family: DEFAULT_FONT.family, size: DEFAULT_FONT.size, lineHeight: DEFAULT_FONT.lineHeight },
	};

	/** Amber — a monochrome amber CRT phosphor. */
	const AMBER = {
		id: "amber",
		name: "Amber",
		description: "Monochrome amber CRT phosphor.",
		palette: {
			black: "#100B00",
			blue: "#241800",
			green: "#4A3200",
			cyan: "#5C3F00",
			red: "#6B4A00",
			magenta: "#553800",
			brown: "#8A5A00",
			lgray: "#C79A45",
			dgray: "#6B4F1E",
			lblue: "#A87A2A",
			lgreen: "#D9A94E",
			lcyan: "#E0B45C",
			lred: "#E8A050",
			lmagenta: "#D08E3C",
			yellow: "#F0C878",
			white: "#FFE2A8",
		},
		font: { family: DEFAULT_FONT.family, size: DEFAULT_FONT.size, lineHeight: DEFAULT_FONT.lineHeight },
	};

	/** Green Phosphor — green-on-black terminal phosphor. */
	const PHOSPHOR = {
		id: "phosphor",
		name: "Green Phosphor",
		description: "Green-on-black terminal phosphor.",
		palette: {
			black: "#000000",
			blue: "#001400",
			green: "#00AA00",
			cyan: "#00AA66",
			red: "#33AA00",
			magenta: "#00AA99",
			brown: "#006600",
			lgray: "#22CC22",
			dgray: "#007700",
			lblue: "#44DD44",
			lgreen: "#66FF66",
			lcyan: "#33FF99",
			lred: "#88FF44",
			lmagenta: "#44FFBB",
			yellow: "#AAFF66",
			white: "#AAFFAA",
		},
		font: { family: DEFAULT_FONT.family, size: DEFAULT_FONT.size, lineHeight: DEFAULT_FONT.lineHeight },
	};

	/** Paper — a light scheme for daylight and bright rooms. */
	const PAPER = {
		id: "paper",
		name: "Paper",
		description: "Light scheme for daylight and bright rooms.",
		palette: {
			black: "#1C1B17",
			blue: "#F5F2E6",
			green: "#D5E3C0",
			cyan: "#0F6E6E",
			red: "#B03A2B",
			magenta: "#8A2F8A",
			brown: "#8A5A2B",
			lgray: "#6B685C",
			dgray: "#96938A",
			lblue: "#2A5AA8",
			lgreen: "#2E6B2E",
			lcyan: "#0F6E6E",
			lred: "#B03A2B",
			lmagenta: "#8A2F8A",
			yellow: "#7A5B00",
			white: "#1C1B17",
		},
		font: { family: DEFAULT_FONT.family, size: DEFAULT_FONT.size, lineHeight: DEFAULT_FONT.lineHeight },
	};

	/** Midnight — dark blue-grey, low contrast. */
	const MIDNIGHT = {
		id: "midnight",
		name: "Midnight",
		description: "Dark blue-grey, low contrast.",
		palette: {
			black: "#0B0E13",
			blue: "#151A21",
			green: "#33513F",
			cyan: "#2F5157",
			red: "#5E3238",
			magenta: "#4A3A52",
			brown: "#4E4433",
			lgray: "#8A93A0",
			dgray: "#4C545F",
			lblue: "#5A7799",
			lgreen: "#6B8F73",
			lcyan: "#5F8B93",
			lred: "#96605F",
			lmagenta: "#836C8C",
			yellow: "#A99B6A",
			white: "#B7BFC9",
		},
		font: { family: DEFAULT_FONT.family, size: DEFAULT_FONT.size, lineHeight: DEFAULT_FONT.lineHeight },
	};

	/** Every theme that ships with the app, keyed by id. */
	const BUILTIN_THEMES = {
		dos: DOS_BLUE,
		amber: AMBER,
		phosphor: PHOSPHOR,
		paper: PAPER,
		midnight: MIDNIGHT,
	};

	function isObject(v) {
		return !!v && typeof v === "object" && !Array.isArray(v);
	}

	/**
	 * Merge theme lists into one map. Later lists shadow earlier ones by id, so
	 * a user theme shadows a built-in theme with the same id.
	 *
	 * @param {...(Object|Array)} lists theme maps or arrays of themes
	 * @returns {Object} map of id -> theme
	 */
	function mergeThemes(...lists) {
		const out = {};
		for (const list of lists) {
			if (!list) continue;
			if (Array.isArray(list)) {
				for (const theme of list) {
					if (isObject(theme) && typeof theme.id === "string" && theme.id) out[theme.id] = theme;
				}
			} else if (isObject(list)) {
				for (const [id, theme] of Object.entries(list)) {
					if (isObject(theme)) out[id] = { ...theme, id: theme.id || id };
				}
			}
		}
		return out;
	}

	/** The themes of a map (or list) as an array. */
	function themeList(themes) {
		if (!themes) return [];
		if (Array.isArray(themes)) return themes.filter((t) => isObject(t));
		return Object.values(themes).filter((t) => isObject(t));
	}

	/**
	 * Resolve a theme id to a complete theme.
	 *
	 * - an unknown id falls back to DOS Blue;
	 * - a palette name the theme omits (or misspells) falls back to the DOS Blue
	 *   value FOR THAT NAME ONLY — the rest of the theme still applies;
	 * - names outside the canonical 16 are ignored.
	 *
	 * @param {string} id
	 * @param {Object|Array} [themes] the theme map to look in (default: built-ins)
	 * @returns {Object} { id, name, description, palette (all 16 names), font }
	 */
	function resolveTheme(id, themes) {
		const source = themes === undefined || themes === null ? BUILTIN_THEMES : themes;
		let theme = null;
		if (Array.isArray(source)) {
			theme = source.find((t) => isObject(t) && t.id === id) || null;
		} else if (isObject(source)) {
			theme = isObject(source[id]) ? source[id] : null;
		}
		if (!theme) theme = DOS_BLUE;

		const palette = {};
		const src = isObject(theme.palette) ? theme.palette : {};
		for (const name of PALETTE_NAMES) {
			const value = src[name];
			palette[name] = typeof value === "string" && value ? value : DOS_BLUE.palette[name];
		}

		return {
			id: typeof theme.id === "string" && theme.id ? theme.id : (id || DOS_BLUE.id),
			name: typeof theme.name === "string" && theme.name ? theme.name : (theme.id || id || DOS_BLUE.name),
			description: typeof theme.description === "string" ? theme.description : "",
			palette,
			font: isObject(theme.font) ? { ...theme.font } : null,
		};
	}

	/**
	 * Apply a theme to the document (R8).
	 *
	 * Writes the 16 palette custom properties plus `--font`, `--fs` and `--lh`
	 * onto `document.documentElement`. No stylesheet is injected, no `style=`
	 * attribute is added and no `<style>` block is created — CSSOM writes are
	 * not blocked by `style-src 'self'`.
	 *
	 * @param {Object|string} theme the theme (or a theme id)
	 * @param {Object} [fontOverride] the effective font (see `config.js`)
	 * @returns {Object|null} the applied { palette, font }, or null without a DOM
	 */
	function applyTheme(theme, fontOverride) {
		const resolved = isObject(theme) && isObject(theme.palette)
			? resolveTheme((typeof theme.id === "string" && theme.id) || DOS_BLUE.id, { [(typeof theme.id === "string" && theme.id) || DOS_BLUE.id]: theme })
			: resolveTheme(typeof theme === "string" ? theme : DOS_BLUE.id, BUILTIN_THEMES);

		if (typeof document === "undefined" || !document.documentElement || !document.documentElement.style) return null;

		const style = document.documentElement.style;
		for (const name of PALETTE_NAMES) style.setProperty("--" + name, resolved.palette[name]);

		const font = fontOverride || resolved.font || DEFAULT_FONT;
		if (font.family) style.setProperty("--font", font.family);
		if (font.size !== undefined && font.size !== null) style.setProperty("--fs", String(font.size));
		if (font.lineHeight !== undefined && font.lineHeight !== null) style.setProperty("--lh", String(font.lineHeight));

		return { palette: resolved.palette, font: { ...font } };
	}

	return {
		PALETTE_NAMES,
		DEFAULT_FONT,
		DOS_BLUE,
		AMBER,
		PHOSPHOR,
		PAPER,
		MIDNIGHT,
		BUILTIN_THEMES,
		mergeThemes,
		themeList,
		resolveTheme,
		applyTheme,
	};
});
