// LUUNA-AI — configuration tiers, theme discovery and the chord grammar.
//
// Everything the user can configure lives in plain JSON under a `.luuna/`
// directory: a global tier in `~/.luuna/` and a project tier in
// `<cwd>/.luuna/`. The project tier is resolved against the *current* project
// directory, so a repository can carry its own theme, font and keyboard map
// and it travels with the repo.
//
// This module holds the pure logic — path resolution, the two-tier merge,
// theme discovery/validation and the chord grammar of the keymap spec.
// The Tauri commands in `main.rs` are thin wrappers around it.
//
// Robustness rule (R26): a malformed settings file or theme file is *skipped*
// and reported, never fatal. Nothing in here may panic.

use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

use crate::atomic_write;
use crate::dirs_home;

/// The 16 canonical DOS palette names, in `:root` order.
///
/// Only the *names* live here — the colour values live exclusively in
/// `renderer/themes.js`, so there is exactly one source of truth for each.
/// A theme file that declares a name outside this list is rejected.
pub const PALETTE_NAMES: [&str; 16] = [
	"black",
	"blue",
	"green",
	"cyan",
	"red",
	"magenta",
	"brown",
	"lgray",
	"dgray",
	"lblue",
	"lgreen",
	"lcyan",
	"lred",
	"lmagenta",
	"yellow",
	"white",
];

/// The three settings files, without the `.settings.json` suffix.
pub const SETTINGS_FILES: [&str; 3] = ["appearance", "keybindings", "app"];

/// The named keys the chord grammar accepts.
pub const NAMED_KEYS: [&str; 26] = [
	"Enter",
	"Escape",
	"Tab",
	"Backspace",
	"Delete",
	"Space",
	"Home",
	"End",
	"PageUp",
	"PageDown",
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"F1",
	"F2",
	"F3",
	"F4",
	"F5",
	"F6",
	"F7",
	"F8",
	"F9",
	"F10",
	"F11",
	"F12",
];

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/// The global configuration tier: `~/.luuna/`.
pub fn global_dir() -> PathBuf {
	dirs_home().join(".luuna")
}

/// The project configuration tier: `<cwd>/.luuna/`.
pub fn project_dir(cwd: &str) -> PathBuf {
	Path::new(cwd).join(".luuna")
}

/// The tier directory for a scope name.
pub fn tier_dir(scope: &str, cwd: &str) -> Result<PathBuf, String> {
	match scope {
		"global" => Ok(global_dir()),
		"project" => Ok(project_dir(cwd)),
		other => Err(format!(
			"Unknown config scope \"{}\" (expected \"global\" or \"project\")",
			other
		)),
	}
}

/// The on-disk path of one settings file in one tier.
///
/// The project tier needs the current working directory, so `cwd` is an
/// explicit parameter here (it is ignored for the global tier).
pub fn settings_path(scope: &str, file: &str, cwd: &str) -> Result<PathBuf, String> {
	if !SETTINGS_FILES.contains(&file) {
		return Err(format!(
			"Unknown settings file \"{}\" (expected one of {})",
			file,
			SETTINGS_FILES.join(", ")
		));
	}
	let tier = tier_dir(scope, cwd)?;
	Ok(tier
		.join("config")
		.join(format!("{}.settings.json", file)))
}

/// The theme directory of one tier.
pub fn themes_dir(tier: &Path) -> PathBuf {
	tier.join("themes")
}

/// The directory layout of both tiers, for the Config section of the UI.
pub fn paths_json(cwd: &str) -> Value {
	let g = global_dir();
	let p = project_dir(cwd);
	json!({
		"globalDir": g.to_string_lossy(),
		"globalConfigDir": g.join("config").to_string_lossy(),
		"globalThemesDir": themes_dir(&g).to_string_lossy(),
		"projectDir": p.to_string_lossy(),
		"projectConfigDir": p.join("config").to_string_lossy(),
		"projectThemesDir": themes_dir(&p).to_string_lossy(),
		"cwd": cwd,
	})
}

// ---------------------------------------------------------------------------
// JSON merge
// ---------------------------------------------------------------------------

/// Deep-merge two JSON values.
///
/// Objects merge recursively, key by key. Everything else — arrays, scalars,
/// `null` — is *replaced* by the overlay, never concatenated.
pub fn merge_json(base: &Value, overlay: &Value) -> Value {
	match (base, overlay) {
		(Value::Object(b), Value::Object(o)) => {
			let mut out = b.clone();
			for (k, v) in o {
				let merged = match out.get(k) {
					Some(existing) => merge_json(existing, v),
					None => v.clone(),
				};
				out.insert(k.clone(), merged);
			}
			Value::Object(out)
		}
		_ => overlay.clone(),
	}
}

/// Merge the two tiers of one settings file: the project tier wins.
pub fn merge_tier_values(global: Option<&Value>, project: Option<&Value>) -> Value {
	let mut merged = Value::Object(Map::new());
	if let Some(g) = global {
		merged = merge_json(&merged, g);
	}
	if let Some(p) = project {
		merged = merge_json(&merged, p);
	}
	merged
}

/// Read and parse a JSON file. The error message names the file.
pub fn read_json_file(path: &Path) -> Result<Value, String> {
	let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {}", path.display(), e))?;
	serde_json::from_str::<Value>(&text)
		.map_err(|e| format!("{}: malformed JSON ({})", path.display(), e))
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/// Load the merged settings of both tiers for the given project directory.
///
/// Returns `({ "appearance": …, "keybindings": …, "app": … }, errors)`.
/// The error list holds one note per malformed file; a missing file is not an
/// error (the tier simply contributes nothing).
pub fn load_settings(cwd: &str) -> (Value, Vec<String>) {
	load_settings_in(&global_dir(), &project_dir(cwd))
}

/// The tier-explicit form of [`load_settings`] — testable without touching
/// the user's home directory.
pub fn load_settings_in(global: &Path, project: &Path) -> (Value, Vec<String>) {
	let mut errors: Vec<String> = Vec::new();
	let mut out = Map::new();
	for file in SETTINGS_FILES.iter() {
		let file_name = format!("{}.settings.json", file);
		let global_path = global.join("config").join(&file_name);
		let project_path = project.join("config").join(&file_name);
		let global_value = read_optional(&global_path, &mut errors);
		let project_value = read_optional(&project_path, &mut errors);
		out.insert(
			(*file).to_string(),
			merge_tier_values(global_value.as_ref(), project_value.as_ref()),
		);
	}
	(Value::Object(out), errors)
}

/// Load the settings of each tier ON ITS OWN.
///
/// The merged view ([`load_settings`]) hides which tier owns a key, and the
/// UI needs to know: a write to the global tier is shadowed by a project-tier
/// binding of the same key (the project tier wins per key), so the message
/// of such a write has to say so.
///
/// Returns `(global, project, errors)`, each tier shaped like the merged
/// view: `{ "appearance": …, "keybindings": …, "app": … }`.
pub fn load_tier_settings(cwd: &str) -> (Value, Value, Vec<String>) {
	load_tier_settings_in(&global_dir(), &project_dir(cwd))
}

/// The tier-explicit form of [`load_tier_settings`] — testable without
/// touching the user's home directory.
pub fn load_tier_settings_in(global: &Path, project: &Path) -> (Value, Value, Vec<String>) {
	let mut errors: Vec<String> = Vec::new();
	let mut global_out = Map::new();
	let mut project_out = Map::new();
	for file in SETTINGS_FILES.iter() {
		let file_name = format!("{}.settings.json", file);
		let global_value = read_optional(&global.join("config").join(&file_name), &mut errors);
		let project_value = read_optional(&project.join("config").join(&file_name), &mut errors);
		global_out.insert(
			(*file).to_string(),
			global_value.unwrap_or(Value::Object(Map::new())),
		);
		project_out.insert(
			(*file).to_string(),
			project_value.unwrap_or(Value::Object(Map::new())),
		);
	}
	(Value::Object(global_out), Value::Object(project_out), errors)
}

/// Read a file that may be missing. A missing file is fine; a malformed file
/// is reported and treated as absent.
fn read_optional(path: &Path, errors: &mut Vec<String>) -> Option<Value> {
	if !path.is_file() {
		return None;
	}
	match read_json_file(path) {
		Ok(v) => Some(v),
		Err(e) => {
			errors.push(e);
			None
		}
	}
}

/// Merge a patch into one settings file of one tier and write it back.
///
/// The existing file is read first and the patch is deep-merged into it, so a
/// partial patch never drops the other keys. The write is atomic (temp file +
/// rename) and creates the directory tree on demand.
///
/// With `replace` the patch becomes the whole file instead of a merge. That is
/// what the "reset to defaults" button needs: a merge can only ever add or
/// overwrite keys, so it can never *remove* an override. A replace also
/// overwrites a malformed file, which is the only way to recover one from
/// inside the app.
pub fn write_settings(
	scope: &str,
	file: &str,
	patch: &Value,
	cwd: &str,
	replace: bool,
) -> Result<(PathBuf, Value), String> {
	let path = settings_path(scope, file, cwd)?;
	let merged = if replace {
		patch.clone()
	} else {
		let mut current = Value::Object(Map::new());
		if path.is_file() {
			current = read_json_file(&path)
				.map_err(|e| format!("{} (refusing to overwrite a malformed file)", e))?;
		}
		merge_json(&current, patch)
	};
	let text = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;
	atomic_write(&path, &format!("{}\n", text))?;
	Ok((path, merged))
}

/// Validate and canonicalise a `keybindings.settings.json` payload.
///
/// The shape is `{ "<action.id>": ["Chord", …] }`. Every chord is run through
/// [`canonical_chord`], so a malformed binding is rejected at the boundary
/// instead of silently poisoning the keymap.
pub fn canonicalize_keybindings(v: &Value) -> Result<Value, String> {
	let obj = v.as_object().ok_or("keybindings must be a JSON object")?;
	let mut out = Map::new();
	for (action, chords) in obj {
		let list = chords
			.as_array()
			.ok_or_else(|| format!("keybinding for \"{}\" must be an array of chords", action))?;
		let mut canon: Vec<Value> = Vec::with_capacity(list.len());
		for chord in list {
			let s = chord
				.as_str()
				.ok_or_else(|| format!("keybinding for \"{}\" must be a string", action))?;
			canon.push(Value::String(canonical_chord(s)?));
		}
		out.insert(action.clone(), Value::Array(canon));
	}
	Ok(Value::Object(out))
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

/// Validate a theme definition and return its normalised form.
///
/// * `id` is required (a non-empty string).
/// * `name` is optional and defaults to the `id`.
/// * `palette` is optional (a partial palette is tolerated) but every name it
///   declares must be one of the 16 canonical names.
/// * `font` is optional.
pub fn validate_theme(v: &Value) -> Result<Value, String> {
	let obj = v.as_object().ok_or("theme must be a JSON object")?;
	let id = obj
		.get("id")
		.and_then(|x| x.as_str())
		.map(|s| s.trim())
		.filter(|s| !s.is_empty())
		.ok_or("theme is missing the required \"id\" field")?;
	let name = match obj.get("name") {
		None | Some(Value::Null) => id.to_string(),
		Some(Value::String(s)) if s.trim().is_empty() => id.to_string(),
		Some(Value::String(s)) => s.trim().to_string(),
		Some(_) => return Err("theme \"name\" must be a string".to_string()),
	};
	let mut palette = Map::new();
	if let Some(p) = obj.get("palette") {
		if !p.is_null() {
			let pmap = p.as_object().ok_or("theme \"palette\" must be an object")?;
			for (k, val) in pmap {
				if !PALETTE_NAMES.contains(&k.as_str()) {
					return Err(format!(
						"unknown palette name \"{}\" (the canonical names are {})",
						k,
						PALETTE_NAMES.join(", ")
					));
				}
				let s = val
					.as_str()
					.ok_or_else(|| format!("palette entry \"{}\" must be a string", k))?;
				palette.insert(k.clone(), Value::String(s.to_string()));
			}
		}
	}
	let mut out = obj.clone();
	out.insert("id".to_string(), Value::String(id.to_string()));
	out.insert("name".to_string(), Value::String(name));
	out.insert("palette".to_string(), Value::Object(palette));
	if let Some(f) = obj.get("font") {
		if !f.is_null() {
			out.insert("font".to_string(), validate_font(f)?);
		}
	}
	Ok(Value::Object(out))
}

/// Validate the optional `font` block of a theme.
fn validate_font(v: &Value) -> Result<Value, String> {
	let obj = v.as_object().ok_or("theme \"font\" must be an object")?;
	let mut out = Map::new();
	for (k, val) in obj {
		match k.as_str() {
			"family" | "size" => {
				let s = val
					.as_str()
					.ok_or_else(|| format!("font \"{}\" must be a string", k))?;
				out.insert(k.clone(), Value::String(s.to_string()));
			}
			"lineHeight" => {
				let n = val
					.as_f64()
					.ok_or_else(|| "font \"lineHeight\" must be a number".to_string())?;
				out.insert(k.clone(), json!(n));
			}
			_ => {
				out.insert(k.clone(), val.clone());
			}
		}
	}
	Ok(Value::Object(out))
}

/// Discover the user themes of both tiers.
///
/// Returns `(themes, errors)`. A project theme shadows a global theme with
/// the same `id`; a malformed file is skipped and reported.
pub fn load_themes(cwd: &str) -> (Vec<Value>, Vec<String>) {
	load_themes_in(&global_dir(), &project_dir(cwd))
}

/// The tier-explicit form of [`load_themes`].
pub fn load_themes_in(global: &Path, project: &Path) -> (Vec<Value>, Vec<String>) {
	let mut errors: Vec<String> = Vec::new();
	let mut themes: Vec<Value> = Vec::new();
	for (tier, source) in [(global, "global"), (project, "project")] {
		for path in theme_files(tier) {
			let file_name = path
				.file_name()
				.and_then(|n| n.to_str())
				.unwrap_or("")
				.to_string();
			let stem = file_name
				.strip_suffix(".theme.json")
				.unwrap_or(file_name.as_str())
				.to_string();
			let mut value = match read_json_file(&path) {
				Ok(v) => v,
				Err(e) => {
					errors.push(e);
					continue;
				}
			};
			// The file stem is the fallback id; an explicit "id" wins — and an
			// explicit but malformed one is rejected by the validation below.
			let has_id = value
				.get("id")
				.map(|v| !v.is_null())
				.unwrap_or(false);
			if !has_id {
				if let Some(obj) = value.as_object_mut() {
					obj.insert("id".to_string(), Value::String(stem));
				}
			}
			let theme = match validate_theme(&value) {
				Ok(t) => t,
				Err(e) => {
					errors.push(format!("{}: {}", path.display(), e));
					continue;
				}
			};
			let mut theme = theme;
			if let Some(obj) = theme.as_object_mut() {
				obj.insert("source".to_string(), Value::String(source.to_string()));
			}
			let id = theme
				.get("id")
				.and_then(|v| v.as_str())
				.unwrap_or("")
				.to_string();
			match themes
				.iter()
				.position(|t| t.get("id").and_then(|v| v.as_str()) == Some(id.as_str()))
			{
				Some(pos) => themes[pos] = theme,
				None => themes.push(theme),
			}
		}
	}
	(themes, errors)
}

/// The theme files of one tier, sorted by name for a stable order.
fn theme_files(tier: &Path) -> Vec<PathBuf> {
	let dir = themes_dir(tier);
	let mut files: Vec<PathBuf> = match std::fs::read_dir(&dir) {
	 Ok(rd) => rd
			.filter_map(|e| e.ok())
			.map(|e| e.path())
			.filter(|p| {
				p.is_file()
					&& p.file_name()
						.and_then(|n| n.to_str())
						.map(|n| n.ends_with(".theme.json"))
						.unwrap_or(false)
			})
			.collect(),
		Err(_) => Vec::new(),
	};
	files.sort();
	files
}

/// Find one theme by id across both tiers (the project tier shadows the
/// global tier).
pub fn find_theme(cwd: &str, id: &str) -> Result<Value, String> {
	let (themes, _errors) = load_themes(cwd);
	themes
		.into_iter()
		.find(|t| t.get("id").and_then(|v| v.as_str()) == Some(id))
		.ok_or_else(|| format!("no theme with id \"{}\"", id))
}

// ---------------------------------------------------------------------------
// Chord grammar
// ---------------------------------------------------------------------------

/// Canonicalise a chord (or a two-key sequence) into the canonical form.
///
/// The canonical modifier order is `<primary> → Alt → Shift → <key>`, where
/// `<primary>` is exactly one of `Mod`, `Ctrl`, `Meta`. Matching is
/// order-independent; the canonical order is only what gets *serialised*.
///
/// A sequence is written with a comma (`"Ctrl+W,H"`, `"G,G"`); every part is
/// canonicalised on its own.
///
/// Errors: unknown modifiers, more than one primary modifier, a repeated
/// modifier, a missing key and a key that is neither a named key nor a single
/// character.
pub fn canonical_chord(s: &str) -> Result<String, String> {
	let trimmed = s.trim();
	if trimmed.is_empty() {
		return Err("empty chord".to_string());
	}
	let parts = split_sequence(trimmed)?;
	let mut out: Vec<String> = Vec::with_capacity(parts.len());
	for part in parts {
		out.push(canonical_one(part)?);
	}
	Ok(out.join(","))
}

/// Split a chord into the parts of a sequence.
///
/// A comma is a sequence separator unless it directly follows a `+` — that
/// way `Ctrl+,` (bind the comma key) survives. A bare single character is
/// always a key, never a sequence.
fn split_sequence(s: &str) -> Result<Vec<&str>, String> {
	if !s.contains('+') && s.chars().count() == 1 {
		return Ok(vec![s]);
	}
	let mut parts: Vec<&str> = Vec::new();
	let mut start = 0usize;
	let mut prev = '\0';
	for (i, ch) in s.char_indices() {
		if ch == ',' && prev != '+' {
			parts.push(&s[start..i]);
			start = i + ch.len_utf8();
		}
		prev = ch;
	}
	parts.push(&s[start..]);
	if parts.iter().any(|p| p.trim().is_empty()) {
		return Err(format!("invalid chord sequence \"{}\"", s));
	}
	Ok(parts)
}

/// Canonicalise one chord of a sequence.
fn canonical_one(seg: &str) -> Result<String, String> {
	let s = seg.trim();
	if s.is_empty() {
		return Err("empty chord".to_string());
	}
	let mut rest = s;
	let mut primary: Option<&'static str> = None;
	let mut alt = false;
	let mut shift = false;
	loop {
		let idx = match rest.find('+') {
			Some(i) => i,
			None => break,
		};
		let cand = &rest[..idx];
		let norm = match normalize_modifier(cand) {
			Some(m) => m,
			None => {
				// Not a modifier: the `+` belongs to the key, so the rest of
				// the string is the key. A multi-letter candidate is almost
				// certainly a typo'd modifier — say so.
				if cand.len() > 1 && cand.chars().all(|c| c.is_alphabetic()) {
					return Err(format!("unknown modifier \"{}\"", cand));
				}
				break;
			}
		};
		match norm {
			"Mod" | "Ctrl" | "Meta" => {
				if primary.is_some() {
					return Err(format!(
						"chord \"{}\" contains more than one primary modifier",
						s
					));
				}
				primary = Some(norm);
			}
			"Alt" => {
				if alt {
					return Err(format!("chord \"{}\" repeats the Alt modifier", s));
				}
				alt = true;
			}
			"Shift" => {
				if shift {
					return Err(format!("chord \"{}\" repeats the Shift modifier", s));
				}
				shift = true;
			}
			_ => unreachable!(),
		}
		rest = &rest[idx + 1..];
	}
	let key = canonical_key(rest)?;
	// The shift state of a symbol key is already encoded in the symbol itself
	// (`Shift+/` is the `?` key), so the modifier is dropped — this keeps the
	// stored chord equal to the chord a key event derives.
	if shift && is_symbol_key(&key) {
		shift = false;
	}
	let mut out = String::new();
	if let Some(p) = primary {
		out.push_str(p);
		out.push('+');
	}
	if alt {
		out.push_str("Alt+");
	}
	if shift {
		out.push_str("Shift+");
	}
	out.push_str(&key);
	Ok(out)
}

/// The canonical spelling of a modifier, matched case-insensitively.
fn normalize_modifier(cand: &str) -> Option<&'static str> {
	for m in ["Mod", "Ctrl", "Meta", "Alt", "Shift"].iter() {
		if cand.eq_ignore_ascii_case(m) {
			return Some(m);
		}
	}
	None
}

/// The canonical spelling of a key: a named key or a single character.
fn canonical_key(raw: &str) -> Result<String, String> {
	// A literal space is the `Space` key.
	if raw == " " {
		return Ok("Space".to_string());
	}
	let s = raw.trim();
	if s.is_empty() {
		return Err("chord is missing a key".to_string());
	}
	for named in NAMED_KEYS.iter() {
		if s.eq_ignore_ascii_case(named) {
			return Ok((*named).to_string());
		}
	}
	let mut chars = s.chars();
	let first = match chars.next() {
		Some(c) => c,
		None => return Err("chord is missing a key".to_string()),
	};
	if chars.next().is_some() {
		return Err(format!(
			"invalid key \"{}\" (expected a named key or a single character)",
			s
		));
	}
	if first.is_whitespace() {
		return Err(format!("invalid key \"{}\" (whitespace is not a key)", s));
	}
	if first.is_ascii_alphabetic() {
		return Ok(first.to_ascii_uppercase().to_string());
	}
	Ok(first.to_string())
}

/// True for a single-character key that is not a letter or a digit.
fn is_symbol_key(key: &str) -> bool {
	let mut chars = key.chars();
	match (chars.next(), chars.next()) {
		(Some(c), None) => !c.is_alphanumeric(),
		_ => false,
	}
}

/// Expand the portable `Mod` alias: `Meta` on macOS, `Ctrl` everywhere else.
///
/// The stored form always keeps `Mod` — that is what makes the settings files
/// portable between macOS and Windows. The expansion happens when a chord is
/// *matched*, and the renderer owns the matching; this helper exists so the
/// grammar has one definition on each side of the bridge.
#[allow(dead_code)]
pub fn expand_chord(s: &str, mac: bool) -> Result<String, String> {
	let canonical = canonical_chord(s)?;
	let mut out: Vec<String> = Vec::with_capacity(1);
	for part in canonical.split(',') {
		let expanded = if part == "Mod" {
			if mac { "Meta" } else { "Ctrl" }.to_string()
		} else if let Some(rest) = part.strip_prefix("Mod+") {
			format!("{}+{}", if mac { "Meta" } else { "Ctrl" }, rest)
		} else {
			part.to_string()
		};
		out.push(expanded);
	}
	Ok(out.join(","))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
	use super::*;

	/// A throw-away directory for a test case.
	fn temp_dir(tag: &str) -> PathBuf {
		let stamp = std::time::SystemTime::now()
			.duration_since(std::time::UNIX_EPOCH)
			.map(|d| d.as_nanos())
			.unwrap_or(0);
		let mut p = std::env::temp_dir();
		p.push(format!("luuna-config-{}-{}-{}", tag, std::process::id(), stamp));
		std::fs::create_dir_all(&p).unwrap();
		p
	}

	fn write_file(path: &Path, content: &str) {
		std::fs::create_dir_all(path.parent().unwrap()).unwrap();
		std::fs::write(path, content).unwrap();
	}

	// -- merge_json ---------------------------------------------------------

	#[test]
	fn merge_json_merges_objects_recursively() {
		let base = json!({"theme": "dos", "font": {"family": "Consolas", "size": "14px"}});
		let overlay = json!({"font": {"size": "16px"}});
		let merged = merge_json(&base, &overlay);
		assert_eq!(merged["theme"], json!("dos"));
		assert_eq!(merged["font"]["family"], json!("Consolas"));
		assert_eq!(merged["font"]["size"], json!("16px"));
	}

	#[test]
	fn merge_json_replaces_arrays_and_scalars() {
		let base = json!({"chords": ["Ctrl+C", "Mod+C"], "size": 14, "on": true});
		let overlay = json!({"chords": ["Ctrl+Shift+C"], "size": 18, "on": false});
		let merged = merge_json(&base, &overlay);
		assert_eq!(merged["chords"], json!(["Ctrl+Shift+C"]));
		assert_eq!(merged["size"], json!(18));
		assert_eq!(merged["on"], json!(false));
	}

	#[test]
	fn merge_json_replaces_an_object_with_a_scalar() {
		let base = json!({"font": {"family": "Consolas"}});
		let merged = merge_json(&base, &json!({"font": "inherit"}));
		assert_eq!(merged["font"], json!("inherit"));
	}

	// -- the two-tier merge -------------------------------------------------

	#[test]
	fn tier_merge_lets_the_project_win() {
		let global = json!({"theme": "dos", "font": {"family": "Consolas", "size": "14px"}});
		let project = json!({"theme": "midnight", "font": {"size": "18px"}});
		let merged = merge_tier_values(Some(&global), Some(&project));
		// The project tier wins on the keys it declares ...
		assert_eq!(merged["theme"], json!("midnight"));
		assert_eq!(merged["font"]["size"], json!("18px"));
		// ... and the global tier still supplies the keys it does not.
		assert_eq!(merged["font"]["family"], json!("Consolas"));
	}

	#[test]
	fn tier_merge_replaces_arrays_wholesale() {
		let global = json!({"app.palette": ["Mod+K", "Mod+P"]});
		let project = json!({"app.palette": ["Mod+J"]});
		let merged = merge_tier_values(Some(&global), Some(&project));
		assert_eq!(merged["app.palette"], json!(["Mod+J"]));
	}

	#[test]
	fn tier_merge_with_a_missing_tier() {
		let global = json!({"theme": "dos"});
		let merged = merge_tier_values(Some(&global), None);
		assert_eq!(merged["theme"], json!("dos"));
		let merged = merge_tier_values(None, Some(&global));
		assert_eq!(merged["theme"], json!("dos"));
	}

	#[test]
	fn load_settings_in_merges_both_tiers() {
		let global = temp_dir("settings-global");
		let project = temp_dir("settings-project");
		write_file(
			&global.join("config").join("appearance.settings.json"),
			"{\"theme\": \"dos\", \"font\": {\"size\": \"14px\"}}",
		);
		write_file(
			&project.join("config").join("appearance.settings.json"),
			"{\"theme\": \"midnight\"}",
		);
		write_file(
			&global.join("config").join("keybindings.settings.json"),
			"{\"app.palette\": [\"Mod+K\"]}",
		);
		let (settings, errors) = load_settings_in(&global, &project);
		assert!(errors.is_empty(), "unexpected errors: {:?}", errors);
		assert_eq!(settings["appearance"]["theme"], json!("midnight"));
		assert_eq!(settings["appearance"]["font"]["size"], json!("14px"));
		assert_eq!(settings["keybindings"]["app.palette"], json!(["Mod+K"]));
		// A file that was never written is an empty object, not an error.
		assert_eq!(settings["app"], json!({}));
		let _ = std::fs::remove_dir_all(&global);
		let _ = std::fs::remove_dir_all(&project);
	}

	#[test]
	fn load_settings_in_skips_a_malformed_file() {
		let global = temp_dir("settings-bad-global");
		let project = temp_dir("settings-bad-project");
		write_file(
			&global.join("config").join("app.settings.json"),
			"{ this is not json",
		);
		write_file(
			&project.join("config").join("app.settings.json"),
			"{\"sendKey\": \"Enter\"}",
		);
		let (settings, errors) = load_settings_in(&global, &project);
		assert_eq!(errors.len(), 1, "expected one error, got {:?}", errors);
		assert!(errors[0].contains("app.settings.json"));
		// The malformed tier is skipped, the other one still applies.
		assert_eq!(settings["app"]["sendKey"], json!("Enter"));
		let _ = std::fs::remove_dir_all(&global);
		let _ = std::fs::remove_dir_all(&project);
	}

	#[test]
	fn load_tier_settings_in_keeps_the_tiers_apart() {
		let global = temp_dir("tiers-global");
		let project = temp_dir("tiers-project");
		write_file(
			&global.join("config").join("keybindings.settings.json"),
			"{\"app.palette\": [\"Mod+K\"]}",
		);
		write_file(
			&project.join("config").join("keybindings.settings.json"),
			"{\"search.findFile\": [\"Ctrl+F\"]}",
		);
		let (global_tier, project_tier, errors) = load_tier_settings_in(&global, &project);
		assert!(errors.is_empty(), "unexpected errors: {:?}", errors);
		// Each tier holds only its own bindings.
		assert_eq!(global_tier["keybindings"]["app.palette"], json!(["Mod+K"]));
		assert_eq!(global_tier["keybindings"]["search.findFile"], Value::Null);
		assert_eq!(project_tier["keybindings"]["search.findFile"], json!(["Ctrl+F"]));
		assert_eq!(project_tier["keybindings"]["app.palette"], Value::Null);
		// A file that was never written is an empty object, not an error.
		assert_eq!(global_tier["app"], json!({}));
		let _ = std::fs::remove_dir_all(&global);
		let _ = std::fs::remove_dir_all(&project);
	}

	// -- theme validation ---------------------------------------------------

	#[test]
	fn theme_validation_rejects_an_unknown_palette_name() {
		let theme = json!({"id": "x", "palette": {"black": "#000000", "chartreuse": "#00ff00"}});
		let err = validate_theme(&theme).unwrap_err();
		assert!(err.contains("chartreuse"), "unexpected error: {}", err);
	}

	#[test]
	fn theme_validation_tolerates_a_missing_palette_name() {
		let theme = json!({"id": "x", "palette": {"black": "#000000"}});
		let ok = validate_theme(&theme).unwrap();
		assert_eq!(ok["palette"].as_object().unwrap().len(), 1);
		// A missing `name` falls back to the id, a missing palette is empty.
		let bare = validate_theme(&json!({"id": "x"})).unwrap();
		assert_eq!(bare["name"], json!("x"));
		assert_eq!(bare["palette"], json!({}));
	}

	#[test]
	fn theme_validation_requires_an_id() {
		let err = validate_theme(&json!({"palette": {}})).unwrap_err();
		assert!(err.contains("id"), "unexpected error: {}", err);
	}

	#[test]
	fn theme_validation_accepts_every_canonical_name() {
		let mut palette = Map::new();
		for name in PALETTE_NAMES.iter() {
			palette.insert((*name).to_string(), json!("#000000"));
		}
		let theme = json!({"id": "full", "palette": Value::Object(palette)});
		let ok = validate_theme(&theme).unwrap();
		assert_eq!(ok["palette"].as_object().unwrap().len(), PALETTE_NAMES.len());
	}

	#[test]
	fn theme_discovery_shadows_the_global_tier() {
		let global = temp_dir("themes-global");
		let project = temp_dir("themes-project");
		write_file(
			&themes_dir(&global).join("midnight.theme.json"),
			"{\"id\": \"midnight\", \"name\": \"Global Midnight\"}",
		);
		write_file(
			&themes_dir(&project).join("midnight.theme.json"),
			"{\"id\": \"midnight\", \"name\": \"Project Midnight\"}",
		);
		write_file(
			&themes_dir(&project).join("paper.theme.json"),
			"{\"id\": \"paper\", \"name\": \"Paper\"}",
		);
		let (themes, errors) = load_themes_in(&global, &project);
		assert!(errors.is_empty(), "unexpected errors: {:?}", errors);
		assert_eq!(themes.len(), 2);
		let midnight = themes
			.iter()
			.find(|t| t["id"] == json!("midnight"))
			.expect("midnight theme");
		assert_eq!(midnight["name"], json!("Project Midnight"));
		assert_eq!(midnight["source"], json!("project"));
		let paper = themes.iter().find(|t| t["id"] == json!("paper")).unwrap();
		assert_eq!(paper["source"], json!("project"));
		let _ = std::fs::remove_dir_all(&global);
		let _ = std::fs::remove_dir_all(&project);
	}

	#[test]
	fn theme_discovery_rejects_a_malformed_id() {
		let global = temp_dir("themes-bad-id");
		let project = temp_dir("themes-bad-id-project");
		write_file(
			&themes_dir(&global).join("broken.theme.json"),
			"{\"id\": 42}",
		);
		let (themes, errors) = load_themes_in(&global, &project);
		assert!(themes.is_empty());
		assert_eq!(errors.len(), 1, "expected one error, got {:?}", errors);
		let _ = std::fs::remove_dir_all(&global);
		let _ = std::fs::remove_dir_all(&project);
	}

	#[test]
	fn theme_discovery_skips_a_malformed_file() {
		let global = temp_dir("themes-bad");
		let project = temp_dir("themes-bad-project");
		write_file(&themes_dir(&global).join("broken.theme.json"), "{ nope");
		write_file(
			&themes_dir(&global).join("ok.theme.json"),
			"{\"id\": \"ok\", \"name\": \"Ok\"}",
		);
		let (themes, errors) = load_themes_in(&global, &project);
		assert_eq!(themes.len(), 1);
		assert_eq!(themes[0]["id"], json!("ok"));
		assert_eq!(errors.len(), 1, "expected one error, got {:?}", errors);
		let _ = std::fs::remove_dir_all(&global);
		let _ = std::fs::remove_dir_all(&project);
	}

	// -- chord grammar ------------------------------------------------------

	#[test]
	fn canonical_chord_normalises_the_modifier_order() {
		assert_eq!(canonical_chord("Mod+Shift+M").unwrap(), "Mod+Shift+M");
		assert_eq!(canonical_chord("Shift+Mod+M").unwrap(), "Mod+Shift+M");
		assert_eq!(canonical_chord("Ctrl+Alt+X").unwrap(), "Ctrl+Alt+X");
		assert_eq!(canonical_chord("Alt+Ctrl+X").unwrap(), "Ctrl+Alt+X");
		assert_eq!(canonical_chord("Shift+Alt+Meta+K").unwrap(), "Meta+Alt+Shift+K");
	}

	#[test]
	fn canonical_chord_normalises_the_key() {
		assert_eq!(canonical_chord("ctrl+f").unwrap(), "Ctrl+F");
		assert_eq!(canonical_chord("mod+enter").unwrap(), "Mod+Enter");
		assert_eq!(canonical_chord("g").unwrap(), "G");
		assert_eq!(canonical_chord("Mod+,").unwrap(), "Mod+,");
		assert_eq!(canonical_chord("Mod++").unwrap(), "Mod++");
		// A whitespace key is not a key.
		assert!(canonical_chord("Mod+ ").is_err());
	}

	#[test]
	fn canonical_chord_rejects_an_unknown_modifier() {
		let err = canonical_chord("Hyper+K").unwrap_err();
		assert!(err.contains("Hyper"), "unexpected error: {}", err);
	}

	#[test]
	fn canonical_chord_rejects_a_bad_key() {
		assert!(canonical_chord("Mod+").is_err());
		assert!(canonical_chord("Ctrl+NotAKey").is_err());
		assert!(canonical_chord("").is_err());
		assert!(canonical_chord("   ").is_err());
	}

	#[test]
	fn canonical_chord_rejects_two_primary_modifiers() {
		let err = canonical_chord("Mod+Ctrl+K").unwrap_err();
		assert!(err.contains("primary"), "unexpected error: {}", err);
	}

	#[test]
	fn canonical_chord_canonicalises_a_sequence() {
		assert_eq!(canonical_chord("Ctrl+W,H").unwrap(), "Ctrl+W,H");
		assert_eq!(canonical_chord("g,g").unwrap(), "G,G");
	}

	#[test]
	fn canonical_chord_drops_the_shift_of_a_symbol_key() {
		// The shift state of a symbol is encoded in the symbol itself, so the
		// modifier is dropped — the stored chord then equals the chord a key
		// event derives.
		assert_eq!(canonical_chord("Shift+?").unwrap(), "?");
		assert_eq!(canonical_chord("Mod+Shift+?").unwrap(), "Mod+?");
		// A digit, a letter or a named key keeps it.
		assert_eq!(canonical_chord("Shift+1").unwrap(), "Shift+1");
		assert_eq!(canonical_chord("Shift+K").unwrap(), "Shift+K");
		assert_eq!(canonical_chord("Shift+Enter").unwrap(), "Shift+Enter");
	}

	#[test]
	fn expand_chord_expands_the_portable_modifier() {
		assert_eq!(expand_chord("Mod+K", false).unwrap(), "Ctrl+K");
		assert_eq!(expand_chord("Mod+K", true).unwrap(), "Meta+K");
		assert_eq!(expand_chord("Mod+Shift+M", false).unwrap(), "Ctrl+Shift+M");
		// Ctrl and Meta are never expanded.
		assert_eq!(expand_chord("Ctrl+F", true).unwrap(), "Ctrl+F");
		assert_eq!(expand_chord("Meta+F", false).unwrap(), "Meta+F");
	}

	// -- keybindings --------------------------------------------------------

	#[test]
	fn canonicalize_keybindings_canonicalises_every_chord() {
		let payload = json!({"app.palette": ["shift+mod+m"], "app.help": ["f1", "Mod+/"]});
		let canon = canonicalize_keybindings(&payload).unwrap();
		assert_eq!(canon["app.palette"], json!(["Mod+Shift+M"]));
		assert_eq!(canon["app.help"], json!(["F1", "Mod+/"]));
	}

	#[test]
	fn canonicalize_keybindings_rejects_a_malformed_chord() {
		let payload = json!({"app.palette": ["Hyper+K"]});
		assert!(canonicalize_keybindings(&payload).is_err());
		let payload = json!({"app.palette": "Mod+K"});
		assert!(canonicalize_keybindings(&payload).is_err());
	}

	// -- write_settings ------------------------------------------------------

	/// The project tier of a throw-away directory, as the `&str` the API takes.
	fn project_cwd(dir: &Path) -> &str {
		dir.to_str().unwrap()
	}

	/// The settings of a throw-away project tier only.
	fn read_project_settings(cwd: &Path) -> Value {
		let tier = project_dir(project_cwd(cwd));
		let (settings, _) = load_settings_in(&tier, &tier);
		settings
	}

	#[test]
	fn write_settings_merges_a_patch_into_the_existing_file() {
		let cwd = temp_dir("write-merge");
		let c = project_cwd(&cwd);
		write_settings("project", "appearance", &json!({"theme": "dos"}), c, false).unwrap();
		write_settings("project", "appearance", &json!({"font": {"size": "16px"}}), c, false)
			.unwrap();
		let settings = read_project_settings(&cwd);
		let appearance = &settings["appearance"];
		assert_eq!(appearance["theme"], json!("dos"));
		assert_eq!(appearance["font"]["size"], json!("16px"));
	}

	#[test]
	fn write_settings_with_replace_drops_the_other_keys() {
		let cwd = temp_dir("write-replace");
		let c = project_cwd(&cwd);
		write_settings("project", "appearance", &json!({"theme": "dos", "font": {"size": "16px"}}), c, false)
			.unwrap();
		// A merge can never remove a key, so the reset path needs a replace.
		write_settings("project", "appearance", &json!({"theme": "midnight"}), c, true).unwrap();
		let settings = read_project_settings(&cwd);
		let appearance = &settings["appearance"];
		assert_eq!(appearance["theme"], json!("midnight"));
		assert!(appearance.get("font").is_none());
	}

	#[test]
	fn write_settings_refuses_to_overwrite_a_malformed_file() {
		let cwd = temp_dir("write-malformed");
		let c = project_cwd(&cwd);
		let path = settings_path("project", "appearance", c).unwrap();
		write_file(&path, "{ this is not json");
		let err = write_settings("project", "appearance", &json!({"theme": "dos"}), c, false)
			.unwrap_err();
		assert!(err.contains("refusing to overwrite"), "unexpected error: {}", err);
		// The malformed file is still there, untouched.
		assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ this is not json");
	}

	#[test]
	fn write_settings_with_replace_recovers_a_malformed_file() {
		let cwd = temp_dir("write-recover");
		let c = project_cwd(&cwd);
		let path = settings_path("project", "appearance", c).unwrap();
		write_file(&path, "{ this is not json");
		write_settings("project", "appearance", &json!({"theme": "dos"}), c, true).unwrap();
		let settings = read_project_settings(&cwd);
		assert_eq!(settings["appearance"]["theme"], json!("dos"));
	}
}
