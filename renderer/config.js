/**
 * LUUNA-AI — the effective configuration.
 *
 * The renderer never touches the filesystem: it asks the backend for the
 * merged configuration (`window.luuna.getConfig()`), applies the theme and the
 * font through CSSOM writes on `document.documentElement`, and hands the
 * keybinding overrides to the keymap.
 *
 * The module works both as a classic browser script (it installs
 * `window.LuunaConfig`) and as a CommonJS module (so `node --test` can
 * require it). Every pure helper is exported; nothing touches the DOM at load
 * time.
 */
(function (root, factory) {
	"use strict";
	const api = factory();
	if (typeof module === "object" && module.exports) module.exports = api;
	if (root) root.LuunaConfig = api;
	if (typeof window !== "undefined" && window !== root) window.LuunaConfig = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
	"use strict";

	/** The font-size ladder used by the zoom actions and the settings stepper. */
	const FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32];

	/** The size the zoom actions reset to. */
	const DEFAULT_FONT_SIZE = 14;

	/** The fallback font (the values the stylesheet ships with). */
	const FALLBACK_FONT = {
		family: '"Consolas", "Lucida Console", "Courier New", monospace',
		size: "14px",
		lineHeight: 1.25,
	};

	/** The default send key of the composer (`app.settings.json`). */
	const DEFAULT_SEND_KEY = "Enter";

	/** The default newline key of the composer (`app.settings.json`). */
	const DEFAULT_NEWLINE_KEY = "Shift+Enter";

	/** The default number of composer messages the history keeps. */
	const DEFAULT_HISTORY_SIZE = 200;

	function isObject(v) {
		return !!v && typeof v === "object" && !Array.isArray(v);
	}

	/** The themes module, if it is loaded. */
	function themesApi() {
		return (typeof globalThis !== "undefined" && globalThis.LuunaThemes) || null;
	}

	/** The keymap module, if it is loaded. */
	function keymapApi() {
		return (typeof globalThis !== "undefined" && globalThis.LuunaKeymap) || null;
	}

	/** The bridge, if it is installed. */
	function bridge() {
		return (typeof globalThis !== "undefined" && globalThis.luuna) || null;
	}

	/** Unwrap the backend envelope (`{ success, data }`). */
	function unwrap(payload) {
		if (!isObject(payload)) return {};
		// A failure envelope carries no data — the caller reports the message.
		if (payload.success === false) return {};
		if (isObject(payload.data) && !isObject(payload.settings) && !isObject(payload.appearance)) return payload.data;
		return payload;
	}

	function normaliseFont(font) {
		if (!isObject(font)) return null;
		const out = { family: null, size: null, lineHeight: null };
		if (typeof font.family === "string" && font.family) out.family = font.family;
		if (typeof font.size === "string" && font.size) out.size = font.size;
		else if (typeof font.size === "number") out.size = font.size + "px";
		if (typeof font.lineHeight === "number") out.lineHeight = font.lineHeight;
		else if (typeof font.lineHeight === "string" && font.lineHeight) out.lineHeight = Number(font.lineHeight) || null;
		return out;
	}

	function normaliseKeybindings(keybindings) {
		const out = {};
		if (!isObject(keybindings)) return out;
		for (const [id, chords] of Object.entries(keybindings)) {
			if (Array.isArray(chords)) out[id] = chords.slice();
			else if (typeof chords === "string") out[id] = [chords];
		}
		return out;
	}

	/** The settings of one tier (global / project), as the backend reports them. */
	function normaliseTier(tier) {
		const t = isObject(tier) ? tier : {};
		return {
			appearance: isObject(t.appearance) ? { ...t.appearance } : {},
			keybindings: normaliseKeybindings(t.keybindings),
			app: isObject(t.app) ? { ...t.app } : {},
		};
	}

	/**
	 * The number of composer messages the history keeps.
	 *
	 * A malformed value falls back to the default — the history must never
	 * grow without a bound.
	 */
	function normaliseHistorySize(value) {
		const n = typeof value === "number" ? value : Number.parseInt(value, 10);
		if (!Number.isFinite(n) || n <= 0) return DEFAULT_HISTORY_SIZE;
		return Math.floor(n);
	}

	/**
	 * The chord a setting names, or null when the value is unusable.
	 *
	 * A chord the keymap cannot parse is refused, and so is a bare single
	 * character: the composer scope is only active while the input has the
	 * focus, and a bare letter is never matched there (it would swallow the
	 * typing), so such a send key could never fire.
	 */
	function validComposerChord(value) {
		if (typeof value !== "string" || !value.trim()) return null;
		const keymap = keymapApi();
		if (!keymap) return null;
		const canonical = keymap.normalizeBinding(value.trim());
		if (!canonical) return null;
		const parsed = keymap.parseBinding(canonical);
		if (!parsed.length) return null;
		const action = keymap.actionById("composer.send");
		if (action && keymap.bareAllowed && !keymap.bareAllowed(action, parsed[0])) return null;
		return canonical;
	}

	/**
	 * The chords the "app settings" tier configures: the send key and the
	 * newline key of the composer.
	 *
	 * They are DEFAULTS, not rebindings: an explicit rebinding in
	 * `keybindings.settings.json` still wins over them. A malformed, unknown
	 * or empty value falls back to the default, and two equal keys fall back
	 * as well — the composer must never end up unable to send.
	 *
	 * @param {Object} app the merged `app.settings.json`
	 * @returns {Object} `{ "<action.id>": ["Chord", …] }`
	 */
	function appKeyDefaults(app) {
		const settings = isObject(app) ? app : {};
		let send = validComposerChord(settings.sendKey) || DEFAULT_SEND_KEY;
		let newline = validComposerChord(settings.newlineKey) || DEFAULT_NEWLINE_KEY;
		if (send === newline) {
			send = DEFAULT_SEND_KEY;
			newline = DEFAULT_NEWLINE_KEY;
		}
		return { "composer.send": [send], "composer.newline": [newline] };
	}

	/**
	 * Normalise the payload the backend returns into the shape the renderer
	 * works with. A missing or partial payload yields the built-in defaults —
	 * a broken configuration must never stop the app from starting.
	 *
	 * @param {Object} payload `{ settings: { appearance, keybindings, app },
	 *   themes, paths, errors, tiers }` (or the `{ success, data }` envelope)
	 * @returns {Object} { appearance, keybindings, app, themes, paths, errors, tiers }
	 */
	function normaliseConfig(payload) {
		const p = unwrap(payload);
		const settings = isObject(p.settings) ? p.settings : {};
		const appearance = isObject(settings.appearance) ? settings.appearance : (isObject(p.appearance) ? p.appearance : {});
		const keybindings = isObject(settings.keybindings) ? settings.keybindings : (isObject(p.keybindings) ? p.keybindings : {});
		const app = isObject(settings.app) ? settings.app : (isObject(p.app) ? p.app : {});
		const themes = Array.isArray(p.themes) ? p.themes.filter((t) => isObject(t)) : [];
		const paths = isObject(p.paths) ? p.paths : {};
		const errors = Array.isArray(p.errors) ? p.errors.slice() : [];
		const tiers = isObject(p.tiers) ? p.tiers : {};

		return {
			appearance: {
				theme: typeof appearance.theme === "string" && appearance.theme ? appearance.theme : "dos",
				font: normaliseFont(appearance.font),
			},
			keybindings: normaliseKeybindings(keybindings),
			app: { ...app, historySize: normaliseHistorySize(app.historySize) },
			themes,
			paths: { ...paths },
			errors,
			// The settings of each tier on their own — the UI needs to know
			// which tier owns a key before it writes one.
			tiers: {
				global: normaliseTier(tiers.global),
				project: normaliseTier(tiers.project),
			},
		};
	}

	/**
	 * The effective font (R9): the user's `appearance.font` wins, then the
	 * theme's font, then the app default.
	 *
	 * @param {Object} appearance the appearance settings
	 * @param {Object} theme the resolved theme
	 * @returns {Object} { family, size, lineHeight }
	 */
	function fontFromSettings(appearance, theme) {
		const themeFont = isObject(theme) && isObject(theme.font) ? theme.font : null;
		const userFont = isObject(appearance) && isObject(appearance.font) ? appearance.font : null;
		const themes = themesApi();
		const fallback = (themes && themes.DEFAULT_FONT) || FALLBACK_FONT;

		const out = { family: null, size: null, lineHeight: null };
		if (themeFont) {
			if (typeof themeFont.family === "string" && themeFont.family) out.family = themeFont.family;
			if (typeof themeFont.size === "string" && themeFont.size) out.size = themeFont.size;
			else if (typeof themeFont.size === "number") out.size = themeFont.size + "px";
			if (typeof themeFont.lineHeight === "number") out.lineHeight = themeFont.lineHeight;
		}
		if (userFont) {
			if (typeof userFont.family === "string" && userFont.family) out.family = userFont.family;
			if (typeof userFont.size === "string" && userFont.size) out.size = userFont.size;
			else if (typeof userFont.size === "number") out.size = userFont.size + "px";
			if (typeof userFont.lineHeight === "number") out.lineHeight = userFont.lineHeight;
		}
		if (!out.family) out.family = fallback.family;
		if (!out.size) out.size = fallback.size;
		if (out.lineHeight === null || out.lineHeight === undefined) out.lineHeight = fallback.lineHeight;
		return out;
	}

	/** The numeric font size of a size value ("18px" → 18). */
	function parseFontSize(size) {
		if (typeof size === "number" && Number.isFinite(size)) return size;
		if (typeof size === "string") {
			const n = Number.parseFloat(size);
			if (Number.isFinite(n)) return n;
		}
		return DEFAULT_FONT_SIZE;
	}

	/**
	 * The next font size on the ladder.
	 *
	 * @param {number|string} size the current size
	 * @param {number} direction 1 = zoom in, -1 = zoom out, 0 = reset
	 * @returns {number} the new size
	 */
	function zoomFontSize(size, direction) {
		const current = parseFontSize(size);
		if (direction === 0) return DEFAULT_FONT_SIZE;
		if (direction > 0) {
			for (const step of FONT_SIZES) if (step > current) return step;
			return FONT_SIZES[FONT_SIZES.length - 1];
		}
		for (let i = FONT_SIZES.length - 1; i >= 0; i--) if (FONT_SIZES[i] < current) return FONT_SIZES[i];
		return FONT_SIZES[0];
	}

	// -----------------------------------------------------------------------
	// Metrics
	// -----------------------------------------------------------------------

	/** The cached font metrics; null until they are measured. */
	let metrics = null;

	/**
	 * A hidden probe element that measures the live font.
	 *
	 * The probe is styled through the CSSOM (never a `style=` attribute and
	 * never a `<style>` block — the CSP forbids both) and lives in the body, so
	 * it inherits the current `--font` / `--fs` / `--lh`.
	 *
	 * @returns {Object} `{ measure() }` — the char width (100 "M" glyphs) and
	 *   the line height of the live font.
	 */
	function createMetricsProbe() {
		let el = null;

		function ensure() {
			if (typeof document === "undefined" || !document.body) return null;
			if (el && el.isConnected) return el;
			el = document.createElement("div");
			el.setAttribute("aria-hidden", "true");
			el.style.setProperty("position", "absolute");
			el.style.setProperty("top", "0");
			el.style.setProperty("left", "0");
			el.style.setProperty("visibility", "hidden");
			el.style.setProperty("white-space", "pre");
			el.style.setProperty("pointer-events", "none");
			el.style.setProperty("margin", "0");
			el.style.setProperty("padding", "0");
			el.style.setProperty("border", "0");
			document.body.appendChild(el);
			return el;
		}

		function measure() {
			const probe = ensure();
			if (!probe) return { charWidth: 0, lineHeight: 0 };
			probe.textContent = "M".repeat(100);
			const box = probe.getBoundingClientRect();
			return {
				charWidth: box.width ? box.width / 100 : 0,
				lineHeight: box.height,
			};
		}

		function destroy() {
			if (el && el.parentNode) el.parentNode.removeChild(el);
			el = null;
		}

		return { measure, destroy, get element() { return el; } };
	}

	/** The shared probe instance. */
	let probe = null;

	/** Forget the cached metrics — they are re-measured on the next read. */
	function invalidateMetrics() {
		metrics = null;
	}

	/**
	 * The current font metrics, measured from the live font.
	 *
	 * @param {boolean} [refresh] measure again even when the cache is warm
	 */
	function getMetrics(refresh) {
		if (metrics && !refresh) return metrics;
		if (!probe) probe = createMetricsProbe();
		const measured = probe.measure();
		metrics = {
			charWidth: measured.charWidth || 0,
			lineHeight: measured.lineHeight || 0,
		};
		return metrics;
	}

	// -----------------------------------------------------------------------
	// Applying the configuration
	// -----------------------------------------------------------------------

	/**
	 * Apply a font to the document (CSSOM write, CSP-safe) and invalidate the
	 * metrics so they are re-measured.
	 */
	function applyFont(font) {
		if (!isObject(font)) return null;
		if (typeof document === "undefined" || !document.documentElement || !document.documentElement.style) return null;
		const style = document.documentElement.style;
		if (font.family) style.setProperty("--font", font.family);
		if (font.size !== undefined && font.size !== null) style.setProperty("--fs", String(font.size));
		if (font.lineHeight !== undefined && font.lineHeight !== null) style.setProperty("--lh", String(font.lineHeight));
		invalidateMetrics();
		return font;
	}

	/**
	 * Apply a configuration: the theme, the font and the keybinding overrides.
	 *
	 * The "app settings" tier (`app.settings.json`) is applied first — it only
	 * holds DEFAULTS (the send key and the newline key of the composer) — and
	 * the explicit rebindings of the keybindings tier are applied afterwards,
	 * so a rebinding always wins over an app setting.
	 *
	 * @param {Object} config
	 * @returns {Object} { theme, font }
	 */
	function applyConfig(config) {
		const cfg = config && config.appearance ? config : normaliseConfig(config);
		const themes = themesApi();
		const keymap = keymapApi();
		let theme = null;
		let font = null;

		if (themes) {
			const map = themes.mergeThemes(themes.BUILTIN_THEMES, cfg.themes);
			theme = themes.resolveTheme(cfg.appearance.theme, map);
			font = fontFromSettings(cfg.appearance, theme);
			themes.applyTheme(theme, font);
			applyFont(font);
		}
		if (keymap) {
			if (typeof keymap.applyDefaults === "function") keymap.applyDefaults(appKeyDefaults(cfg.app));
			if (typeof keymap.applyOverrides === "function") keymap.applyOverrides(cfg.keybindings);
		}

		return { theme, font };
	}

	// -----------------------------------------------------------------------
	// The current configuration and its subscribers
	// -----------------------------------------------------------------------

	/** The configuration in effect. */
	let current = null;

	/** The subscribers. */
	const subscribers = new Set();

	/**
	 * Subscribe to configuration changes.
	 *
	 * @param {Function} fn called with the new configuration
	 * @returns {Function} an unsubscribe function
	 */
	function subscribe(fn) {
		if (typeof fn !== "function") return () => {};
		subscribers.add(fn);
		return () => { subscribers.delete(fn); };
	}

	function notify(config) {
		for (const fn of Array.from(subscribers)) {
			try { fn(config); } catch (err) { /* a broken subscriber must not break the app */ }
		}
	}

	/** The configuration in effect (null before the first load). */
	function currentConfig() {
		return current;
	}

	/**
	 * Load the effective configuration from the backend, apply it and notify
	 * the subscribers. A failing backend must not abort the boot: the built-in
	 * DOS theme and the default keymap stay in effect.
	 *
	 * @returns {Promise<Object>} the applied configuration
	 */
	async function loadConfig() {
		const api = bridge();
		let payload = null;
		const errors = [];
		if (api && typeof api.getConfig === "function") {
			try {
				payload = await api.getConfig();
			} catch (err) {
				errors.push(String((err && err.message) || err));
				payload = null;
			}
			// The backend reports a failure as `{ success: false, error }` rather
			// than by rejecting, so the message has to be picked up here.
			if (isObject(payload) && payload.success === false) {
				errors.push(String(payload.error || "The configuration could not be read."));
				payload = null;
			}
		} else {
			errors.push("The configuration bridge is not available.");
		}
		const cfg = normaliseConfig(payload);
		if (errors.length) cfg.errors = cfg.errors.concat(errors);
		current = cfg;
		applyConfig(cfg);
		notify(cfg);
		return cfg;
	}

	return {
		FONT_SIZES,
		DEFAULT_FONT_SIZE,
		DEFAULT_SEND_KEY,
		DEFAULT_NEWLINE_KEY,
		DEFAULT_HISTORY_SIZE,
		normaliseConfig,
		normaliseHistorySize,
		appKeyDefaults,
		validComposerChord,
		fontFromSettings,
		parseFontSize,
		zoomFontSize,
		createMetricsProbe,
		invalidateMetrics,
		getMetrics,
		applyFont,
		applyConfig,
		subscribe,
		notify,
		currentConfig,
		loadConfig,
	};
});
