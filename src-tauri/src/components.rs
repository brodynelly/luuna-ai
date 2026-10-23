//! Standalone desktop operations; no runtime-owned data or arbitrary CLI arguments.
use crate::component_runner::Components;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
	collections::BTreeMap,
	path::{Path, PathBuf},
};

pub static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
const OWNER: &str = "luuna-ai-workbench-v1";
type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
pub enum Action {
	Tickets {},
	SaveTicket {
		id: Option<String>,
		title: String,
		description: String,
		kind: TicketType,
		priority: u8,
		assignee: String,
		labels: String,
	},
	MoveTicket {
		id: String,
		status: TicketStatus,
	},
	Dependency {
		id: String,
		dependency: String,
		remove: bool,
	},
	Prompts {
		archived: bool,
	},
	Prompt {
		name: String,
		version: Option<u64>,
	},
	SavePrompt {
		name: String,
		expected_version: Option<u64>,
		description: String,
		section: String,
		body: String,
		tags: Vec<String>,
	},
	ArchivePrompt {
		name: String,
		expected_version: u64,
		restore: bool,
	},
	Memory {
		query: String,
		domain: String,
		kind: Option<MemoryType>,
		classification: String,
	},
	SaveMemory {
		domain: String,
		id: Option<String>,
		kind: MemoryType,
		classification: Classification,
		fields: BTreeMap<String, String>,
		tags: String,
	},
	DeleteMemory {
		domain: String,
		id: String,
	},
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TicketType {
	Task,
	Bug,
	Feature,
	Epic,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TicketStatus {
	Open,
	InProgress,
	Closed,
}
#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum MemoryType {
	Convention,
	Pattern,
	Failure,
	Decision,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Classification {
	Foundational,
	Tactical,
	Observational,
}
impl TicketType {
	fn text(&self) -> &str {
		match self {
			Self::Task => "task",
			Self::Bug => "bug",
			Self::Feature => "feature",
			Self::Epic => "epic",
		}
	}
}
impl TicketStatus {
	fn text(&self) -> &str {
		match self {
			Self::Open => "open",
			Self::InProgress => "in_progress",
			Self::Closed => "closed",
		}
	}
}
impl MemoryType {
	fn text(&self) -> &str {
		match self {
			Self::Convention => "convention",
			Self::Pattern => "pattern",
			Self::Failure => "failure",
			Self::Decision => "decision",
		}
	}
	fn fields(&self) -> &[&str] {
		match self {
			Self::Convention => &["content"],
			Self::Pattern => &["name", "description"],
			Self::Failure => &["description", "resolution"],
			Self::Decision => &["title", "rationale"],
		}
	}
}
impl Classification {
	fn text(&self) -> &str {
		match self {
			Self::Foundational => "foundational",
			Self::Tactical => "tactical",
			Self::Observational => "observational",
		}
	}
}
fn identifier(value: &str) -> Result<()> {
	if value.is_empty()
		|| value.len() > 128
		|| value.starts_with('-')
		|| !value
			.bytes()
			.all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
	{
		return Err("Use an identifier containing only letters, digits, hyphens or underscores (maximum 128).".into());
	}
	Ok(())
}
fn content(value: &str, required: bool) -> Result<()> {
	if value.len() > 256 * 1024 || value.contains('\0') || (required && value.trim().is_empty()) {
		return Err("Required content is missing, contains NUL, or exceeds 256 KiB.".into());
	}
	Ok(())
}
fn no_links(path: &Path) -> Result<()> {
	let mut p = PathBuf::new();
	for part in path.components() {
		if matches!(part, std::path::Component::ParentDir) {
			return Err("Parent traversal is not allowed in a workbench root.".into());
		}
		p.push(part);
		if let Ok(m) = std::fs::symlink_metadata(&p) {
			#[cfg(windows)]
			let link = {
				use std::os::windows::fs::MetadataExt;
				m.file_attributes() & 0x400 != 0
			};
			#[cfg(not(windows))]
			let link = m.file_type().is_symlink();
			if link {
				return Err(
					"Workbench data paths cannot contain symbolic links or reparse points.".into(),
				);
			}
		}
	}
	Ok(())
}
fn read_json(path: &Path) -> Result<Value> {
	no_links(path)?;
	let bytes = std::fs::read(path)
		.map_err(|_| "Workbench ownership metadata is missing or unreadable.")?;
	if bytes.len() > 64 * 1024 {
		return Err("Invalid ownership metadata.".into());
	}
	serde_json::from_slice(&bytes).map_err(|_| "Invalid ownership metadata.".into())
}
fn write_json(path: &Path, value: Value) -> Result<()> {
	no_links(path)?;
	std::fs::write(path, serde_json::to_vec_pretty(&value).unwrap())
		.map_err(|_| "Cannot write workbench metadata.".into())
}
pub struct Workspace {
	pub key: String,
	pub project: String,
	pub root: PathBuf,
	pub path: PathBuf,
}
impl Workspace {
	pub fn new(root: PathBuf, cwd: &str) -> Result<Self> {
		let canonical = Path::new(cwd)
			.canonicalize()
			.map_err(|_| "Project directory is unavailable.")?;
		if !canonical.is_dir() {
			return Err("Project must be a directory.".into());
		}
		let project = canonical.to_string_lossy().to_string();
		let identity = if cfg!(windows) {
			project.to_lowercase()
		} else {
			project.clone()
		};
		let key = format!("{:x}", Sha256::digest(identity.as_bytes()));
		if !root.is_absolute() {
			return Err("Workbench root must be absolute.".into());
		}
		no_links(&root)?;
		let root_identity = root
			.to_string_lossy()
			.trim_start_matches(r"\\?\")
			.to_lowercase();
		let project_identity = canonical
			.to_string_lossy()
			.trim_start_matches(r"\\?\")
			.to_lowercase();
		let root_prefix = format!("{}{}", root_identity, std::path::MAIN_SEPARATOR);
		let project_prefix = format!("{}{}", project_identity, std::path::MAIN_SEPARATOR);
		if root_identity == project_identity
			|| root_identity.starts_with(&project_prefix)
			|| project_identity.starts_with(&root_prefix)
		{
			return Err("Workbench root must be separate from the selected project.".into());
		}
		for ancestor in root.ancestors() {
			if [".seeds", ".canopy", ".mulch"]
				.iter()
				.any(|n| ancestor.join(n).exists())
			{
				return Err(
					"Workbench root cannot be inside an existing component workspace.".into(),
				);
			}
		}
		if root.exists() {
			let marker = read_json(&root.join("owner.json"))?;
			if marker != json!({"owner":OWNER}) {
				return Err("Refusing a foreign workbench data root.".into());
			}
		}
		let path = root.join("projects").join(&key);
		no_links(&path)?;
		let ws = Self {
			key,
			project,
			root,
			path,
		};
		if ws.path.exists() {
			ws.verify()?;
		}
		Ok(ws)
	}
	fn verify(&self) -> Result<Value> {
		let value = read_json(&self.path.join("owner.json"))?;
		if value["owner"] != OWNER
			|| value["projectKey"] != self.key
			|| value["project"] != self.project
		{
			return Err("Project workspace ownership does not match.".into());
		}
		Ok(value)
	}
	pub fn check_key(&self, expected: &str) -> Result<()> {
		if expected != self.key {
			Err("Project changed. Reopen the workbench before editing.".into())
		} else {
			Ok(())
		}
	}
	fn component_ready(&self, name: &str) -> Result<bool> {
		let files: &[&str] = match name {
			"missions" => &[
				".seeds/config.yaml",
				".seeds/issues.jsonl",
				".seeds/plans.jsonl",
				".seeds/templates.jsonl",
			],
			"beacon" => &[
				".canopy/config.yaml",
				".canopy/prompts.jsonl",
				".canopy/schemas.jsonl",
			],
			"atlas" => &[".mulch/mulch.config.yaml"],
			_ => return Err("Unknown component.".into()),
		};
		let mut ready = true;
		for file in files {
			let path = self.path.join(file);
			no_links(&path)?;
			ready &= path.is_file();
		}
		if name == "atlas" {
			let path = self.path.join(".mulch/expertise");
			no_links(&path)?;
			ready &= path.is_dir();
		}
		Ok(ready)
	}
	fn stores_ready(&self) -> Result<bool> {
		let mut ready = true;
		for name in ["missions", "beacon", "atlas"] {
			ready &= self.component_ready(name)?;
		}
		Ok(ready)
	}
	pub fn status(&self) -> Result<Value> {
		let initialized = self.path.exists() && self.verify()?["initialized"] == true;
		let ready = initialized && self.stores_ready()?;
		let tools = Components::discover();
		Ok(
			json!({"projectKey":self.key,"project":self.project,"initialized":ready,"partial":self.path.exists() && !ready,"toolsAvailable":tools.is_ok(),"toolError":tools.err().map(|e|e.to_string())}),
		)
	}
	pub async fn initialize(&self, runner: &Components) -> Result<Value> {
		no_links(&self.root)?;
		if !self.root.exists() {
			std::fs::create_dir_all(&self.root)
				.map_err(|_| "Cannot create private workbench root.")?;
			write_json(&self.root.join("owner.json"), json!({"owner":OWNER}))?;
		}
		if !self.path.exists() {
			std::fs::create_dir_all(&self.path).map_err(|_| "Cannot create project workspace.")?;
			write_json(
				&self.path.join("owner.json"),
				json!({"owner":OWNER,"projectKey":self.key,"project":self.project,"initialized":false}),
			)?;
		}
		self.verify()?;
		for (name, directory) in [
			("missions", ".seeds"),
			("beacon", ".canopy"),
			("atlas", ".mulch"),
		] {
			if self.component_ready(name)? {
				continue;
			}
			let path = self.path.join(directory);
			no_links(&path)?;
			if path.exists() && name != "atlas" {
				let mut entries = std::fs::read_dir(&path)
					.map_err(|_| "Cannot inspect incomplete component directory.")?;
				if entries.next().is_some() {
					return Err(format!("Incomplete {name} store: existing data was preserved. Restore missing required artifacts from backup or recover the store with the component's documented tools, then Refresh. Automatic initialization is refused because it could overwrite records."));
				}
				// This succeeds only for an empty directory; never recurse or discard data.
				std::fs::remove_dir(&path).map_err(|_| {
					"Incomplete directory changed; no data was removed. Refresh before retrying initialization."
				})?;
			}
			self.call(runner, name, vec!["init".into()]).await?;
			if !self.component_ready(name)? {
				return Err(format!("{name} initialization did not create all required artifacts. Workspace remains partial; inspect the component before retrying."));
			}
		}
		if !self.stores_ready()? {
			return Err("Workspace remains incomplete; refresh and retry initialization.".into());
		}
		write_json(
			&self.path.join("owner.json"),
			json!({"owner":OWNER,"projectKey":self.key,"project":self.project,"initialized":true}),
		)?;
		self.status()
	}
	async fn call(&self, runner: &Components, name: &str, args: Vec<String>) -> Result<Value> {
		runner
			.call(name, &self.path, &args)
			.await
			.map_err(|e| e.to_string())
	}
	async fn prompt_version(
		&self,
		runner: &Components,
		name: &str,
		expected: u64,
	) -> Result<Value> {
		let current = self
			.call(runner, "beacon", vec!["show".into(), name.into()])
			.await?;
		if current["prompt"]["version"].as_u64() != Some(expected) {
			return Err(
				"Prompt version conflict. Refresh and review the latest source before saving."
					.into(),
			);
		}
		Ok(current)
	}
	pub async fn action(&self, runner: &Components, action: Action) -> Result<Value> {
		if self.verify()?["initialized"] != true || !self.stores_ready()? {
			return Err("Workspace is not ready. Initialize or recover its missing artifacts before continuing.".into());
		}
		match action {
			Action::Tickets {} => {
				let v = self
					.call(
						runner,
						"missions",
						vec![
							"list".into(),
							"--all".into(),
							"--limit".into(),
							"10001".into(),
						],
					)
					.await?;
				let issues = v["issues"]
					.as_array()
					.ok_or("Missions returned an invalid issue list.")?;
				if issues.len() > 10000 {
					return Err("Board exceeds 10,000 tickets; narrow the workspace using the CLI before loading.".into());
				}
				Ok(v)
			}
			Action::SaveTicket {
				id,
				title,
				description,
				kind,
				priority,
				assignee,
				labels,
			} => {
				content(&title, true)?;
				content(&description, false)?;
				content(&assignee, false)?;
				content(&labels, false)?;
				if priority > 4 {
					return Err("Priority must be 0 through 4.".into());
				}
				let editing = id.is_some();
				let mut args = if let Some(id) = id {
					identifier(&id)?;
					let old = self
						.call(runner, "missions", vec!["show".into(), id.clone()])
						.await?;
					for (key, value) in [("description", &description), ("assignee", &assignee)] {
						if value.is_empty()
							&& old["issue"][key].as_str().is_some_and(|s| !s.is_empty())
						{
							return Err(format!("The pinned Missions CLI cannot clear {key}; retain the value or edit it to new text."));
						}
					}
					vec!["update".into(), id]
				} else {
					vec!["create".into()]
				};
				// Equals flags preserve leading -- and deliberately empty values in Missions' parser.
				for (k, v) in [
					("title", title),
					("description", description),
					("type", kind.text().into()),
					("priority", priority.to_string()),
					("assignee", assignee),
					(if editing { "set-labels" } else { "labels" }, labels),
				] {
					args.push(format!("--{k}={v}"));
				}
				self.call(runner, "missions", args).await
			}
			Action::MoveTicket { id, status } => {
				identifier(&id)?;
				self.call(
					runner,
					"missions",
					vec!["update".into(), id, "--status".into(), status.text().into()],
				)
				.await
			}
			Action::Dependency {
				id,
				dependency,
				remove,
			} => {
				identifier(&id)?;
				identifier(&dependency)?;
				self.call(
					runner,
					"missions",
					vec![
						"dep".into(),
						if remove { "remove" } else { "add" }.into(),
						id,
						dependency,
					],
				)
				.await
			}
			Action::Prompts { archived } => {
				let mut args = vec!["list".into()];
				if archived {
					args.extend(["--status".into(), "archived".into()]);
				}
				self.call(runner, "beacon", args).await
			}
			Action::Prompt { name, version } => {
				identifier(&name)?;
				let source = self
					.call(
						runner,
						"beacon",
						vec![
							"show".into(),
							version
								.map(|v| format!("{name}@{v}"))
								.unwrap_or(name.clone()),
						],
					)
					.await?;
				let history = self
					.call(
						runner,
						"beacon",
						vec![
							"history".into(),
							name.clone(),
							"--limit".into(),
							"100".into(),
						],
					)
					.await?;
				let render = if version.is_none() {
					self.call(runner, "beacon", vec!["render".into(), name])
						.await?
				} else {
					Value::Null
				};
				Ok(
					json!({"source":source,"history":history,"render":render,"historical":version.is_some()}),
				)
			}
			Action::SavePrompt {
				name,
				expected_version,
				description,
				section,
				body,
				tags,
			} => {
				identifier(&name)?;
				identifier(&section)?;
				content(&description, true)?;
				content(&body, false)?;
				if tags.len() > 64 {
					return Err("At most 64 tags are supported.".into());
				}
				for tag in &tags {
					identifier(tag)?;
				}
				let mut args = vec![if expected_version.is_some() {
					"update"
				} else {
					"create"
				}
				.into()];
				if let Some(version) = expected_version {
					let current = self.prompt_version(runner, &name, version).await?;
					args.push(name);
					if let Some(old) = current["prompt"]["tags"].as_array() {
						for tag in old {
							if let Some(tag) = tag.as_str() {
								if !tags.iter().any(|t| t == tag) {
									args.extend(["--untag".into(), tag.into()]);
								}
							}
						}
					}
				} else {
					args.extend(["--name".into(), name]);
				}
				args.extend([
					"--description".into(),
					description,
					"--section".into(),
					format!("{section}={body}"),
				]);
				for tag in tags {
					args.extend(["--tag".into(), tag]);
				}
				self.call(runner, "beacon", args).await
			}
			Action::ArchivePrompt {
				name,
				expected_version,
				restore,
			} => {
				identifier(&name)?;
				self.prompt_version(runner, &name, expected_version).await?;
				self.call(
					runner,
					"beacon",
					if restore {
						vec!["update".into(), name, "--status".into(), "active".into()]
					} else {
						vec!["archive".into(), name]
					},
				)
				.await
			}
			Action::Memory {
				query,
				domain,
				kind,
				classification,
			} => {
				content(&query, false)?;
				if !domain.is_empty() {
					identifier(&domain)?;
				}
				if !["", "foundational", "tactical", "observational"]
					.contains(&classification.as_str())
				{
					return Err("Invalid classification.".into());
				}
				let kinds = kind.map(|t| vec![t]).unwrap_or(vec![
					MemoryType::Convention,
					MemoryType::Pattern,
					MemoryType::Failure,
					MemoryType::Decision,
				]);
				let mut records = vec![];
				for kind in kinds {
					let mut args = vec!["search".into()];
					if !query.is_empty() {
						args.push(query.clone());
					}
					args.extend(["--type".into(), kind.text().into()]);
					if !domain.is_empty() {
						args.extend(["--domain".into(), domain.clone()]);
					}
					let v = self.call(runner, "atlas", args).await?;
					for d in v["domains"]
						.as_array()
						.ok_or("Atlas returned invalid search output.")?
					{
						for record in d["matches"]
							.as_array()
							.ok_or("Atlas returned invalid domain matches.")?
						{
							if classification.is_empty()
								|| record["classification"] == classification
							{
								let mut r = record.clone();
								r["domain"] = d["domain"].clone();
								records.push(r);
							}
						}
					}
				}
				Ok(json!({"records":records}))
			}
			Action::SaveMemory {
				domain,
				id,
				kind,
				classification,
				fields,
				tags,
			} => {
				identifier(&domain)?;
				content(&tags, false)?;
				if fields.len() != kind.fields().len()
					|| kind.fields().iter().any(|key| !fields.contains_key(*key))
				{
					return Err("Record fields must match the selected expertise type.".into());
				}
				let mut args = if let Some(id) = id {
					identifier(&id)?;
					let shown = self
						.call(runner, "atlas", vec!["show".into(), id.clone()])
						.await?;
					let record = &shown["records"][0];
					if record["domain"] != domain
						|| record["record"]["id"] != id
						|| record["record"]["type"] != kind.text()
					{
						return Err(
							"Expertise identity/type changed; refresh before editing.".into()
						);
					}
					vec!["edit".into(), domain, id]
				} else {
					vec!["record".into(), domain, "--type".into(), kind.text().into()]
				};
				args.extend(["--classification".into(), classification.text().into()]);
				for (key, value) in fields {
					content(&value, true)?;
					args.extend([format!("--{key}"), value]);
				}
				if args[0] == "record" && !tags.is_empty() {
					args.extend(["--tags".into(), tags]);
				}
				self.call(runner, "atlas", args).await
			}
			Action::DeleteMemory { domain, id } => {
				identifier(&domain)?;
				identifier(&id)?;
				self.call(runner, "atlas", vec!["delete".into(), domain, id])
					.await
			}
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	fn temp_project() -> (tempfile::TempDir, Workspace) {
		let temp = tempfile::tempdir().unwrap();
		let project = temp.path().join("project");
		std::fs::create_dir(&project).unwrap();
		let ws = Workspace::new(temp.path().join("data"), project.to_str().unwrap()).unwrap();
		(temp, ws)
	}
	#[test]
	fn identity_isolation_and_read_only_status() {
		let (temp, ws) = temp_project();
		assert!(!ws.status().unwrap()["initialized"].as_bool().unwrap());
		assert!(!ws.root.exists());
		assert!(ws.check_key("stale").is_err());
		assert!(ws.check_key(&ws.key).is_ok());
		let project = temp.path().join("second");
		std::fs::create_dir(&project).unwrap();
		let second = Workspace::new(ws.root.clone(), project.to_str().unwrap()).unwrap();
		assert_ne!(ws.key, second.key);
		assert!(Workspace::new(project.clone(), project.to_str().unwrap()).is_err());
		std::fs::create_dir(&ws.root).unwrap();
		assert!(Workspace::new(ws.root.clone(), &ws.project).is_err());
	}
	#[test]
	fn closed_operations_and_required_fields() {
		assert!(serde_json::from_value::<Action>(json!({"op":"shell","args":["rm"]})).is_err());
		assert!(serde_json::from_value::<Action>(json!({"op":"tickets","path":"other"})).is_err());
		assert!(serde_json::from_value::<Action>(
			json!({"op":"moveTicket","id":"x","status":"blocked"})
		)
		.is_err());
		for bad in ["../a", "a/b", "--help", "a.b", ""] {
			assert!(identifier(bad).is_err());
		}
		assert!(identifier("review-12_a").is_ok());
		assert!(content(&"x".repeat(262145), false).is_err());
	}
	async fn act(ws: &Workspace, r: &Components, v: Value) -> Value {
		ws.action(r, serde_json::from_value(v).unwrap())
			.await
			.unwrap()
	}
	#[tokio::test]
	#[ignore = "requires real pinned CLIs; run npm run test:components"]
	async fn components_real_partial_recovery() {
		let (_temp, ws) = temp_project();
		let runner = Components::discover().expect("run npm run components:setup");
		ws.initialize(&runner).await.unwrap();
		let marker = std::fs::read(ws.path.join("owner.json")).unwrap();
		let seeds = ws.path.join(".seeds");
		let record = b"existing mission records must survive byte-for-byte\n";
		std::fs::write(seeds.join("issues.jsonl"), record).unwrap();
		let config = std::fs::read(seeds.join("config.yaml")).unwrap();
		std::fs::remove_file(seeds.join("config.yaml")).unwrap();
		assert_eq!(ws.status().unwrap()["partial"], true);
		assert_eq!(ws.status().unwrap()["initialized"], false);
		assert!(ws
			.action(&runner, Action::Tickets {})
			.await
			.unwrap_err()
			.contains("not ready"));
		assert!(ws
			.initialize(&runner)
			.await
			.unwrap_err()
			.contains("Incomplete missions"));
		assert_eq!(std::fs::read(seeds.join("issues.jsonl")).unwrap(), record);
		assert_eq!(std::fs::read(ws.path.join("owner.json")).unwrap(), marker);
		std::fs::write(seeds.join("config.yaml"), config).unwrap();
		let beacon = ws.path.join(".canopy");
		let prompt_bytes = b"existing prompt history must survive byte-for-byte\n";
		std::fs::write(beacon.join("prompts.jsonl"), prompt_bytes).unwrap();
		let config = std::fs::read(beacon.join("config.yaml")).unwrap();
		std::fs::remove_file(beacon.join("config.yaml")).unwrap();
		assert!(ws
			.initialize(&runner)
			.await
			.unwrap_err()
			.contains("Incomplete beacon"));
		assert_eq!(
			std::fs::read(beacon.join("prompts.jsonl")).unwrap(),
			prompt_bytes
		);
		std::fs::write(beacon.join("config.yaml"), config).unwrap();
		// Simulate a crash immediately after mkdir in a distinct new owned project.
		let (_empty_temp, empty) = temp_project();
		std::fs::create_dir_all(&empty.path).unwrap();
		write_json(&empty.root.join("owner.json"), json!({"owner":OWNER})).unwrap();
		write_json(
			&empty.path.join("owner.json"),
			json!({"owner":OWNER,"projectKey":empty.key,"project":empty.project,"initialized":false}),
		)
		.unwrap();
		std::fs::create_dir(empty.path.join(".canopy")).unwrap();
		empty.initialize(&runner).await.unwrap();
		assert!(empty.stores_ready().unwrap());
		let atlas = empty.path.join(".mulch");
		let record = b"existing atlas record bytes\n";
		std::fs::write(atlas.join("expertise/existing.jsonl"), record).unwrap();
		std::fs::remove_file(atlas.join("mulch.config.yaml")).unwrap();
		empty.initialize(&runner).await.unwrap();
		assert_eq!(
			std::fs::read(atlas.join("expertise/existing.jsonl")).unwrap(),
			record
		);
		// Missing expertise directory is recovered without changing existing config.
		let config = std::fs::read(atlas.join("mulch.config.yaml")).unwrap();
		std::fs::rename(atlas.join("expertise"), atlas.join("expertise-preserved")).unwrap();
		empty.initialize(&runner).await.unwrap();
		assert_eq!(
			std::fs::read(atlas.join("mulch.config.yaml")).unwrap(),
			config
		);
		assert_eq!(
			std::fs::read(atlas.join("expertise-preserved/existing.jsonl")).unwrap(),
			record
		);
		empty.initialize(&runner).await.unwrap();
		assert!(empty.stores_ready().unwrap());
		println!("Safe partial recovery passed: marker truth ignored without artifacts; populated Missions/Beacon preserved; empty Beacon and missing Atlas artifacts repaired.");
	}
	#[tokio::test]
	#[ignore = "requires npm run components:setup and Bun 1.4.3; never silently skipped by test:components"]
	async fn components_real_lifecycles() {
		let (_temp, ws) = temp_project();
		let runner = Components::discover().expect("run npm run components:setup");
		ws.initialize(&runner).await.unwrap();
		ws.initialize(&runner).await.unwrap();
		let long = format!(
			"O'Brien & $() <script>alert(1)</script>\nUnicode 日本語 🦉\n{}",
			"context ".repeat(6000)
		);
		let ticket=act(&ws,&runner,json!({"op":"saveTicket","id":null,"title":"First ticket","description":long,"kind":"task","priority":2,"assignee":"","labels":"test"})).await;
		let id = ticket["id"].as_str().unwrap();
		let second=act(&ws,&runner,json!({"op":"saveTicket","id":null,"title":"Second","description":"dependency","kind":"bug","priority":1,"assignee":"","labels":""})).await;
		let dep = second["id"].as_str().unwrap();
		act(
			&ws,
			&runner,
			json!({"op":"dependency","id":id,"dependency":dep,"remove":false}),
		)
		.await;
		act(
			&ws,
			&runner,
			json!({"op":"moveTicket","id":id,"status":"in_progress"}),
		)
		.await;
		let tickets = act(&ws, &runner, json!({"op":"tickets"})).await;
		assert_eq!(tickets["issues"].as_array().unwrap().len(), 2);
		let found = tickets["issues"]
			.as_array()
			.unwrap()
			.iter()
			.find(|t| t["id"] == id)
			.unwrap();
		assert_eq!(found["description"], long);
		assert_eq!(found["blockedBy"][0], dep);
		act(
			&ws,
			&runner,
			json!({"op":"dependency","id":id,"dependency":dep,"remove":true}),
		)
		.await;
		act(&ws,&runner,json!({"op":"saveTicket","id":id,"title":"Edited","description":"edited","kind":"feature","priority":0,"assignee":"me","labels":"updated"})).await;
		act(
			&ws,
			&runner,
			json!({"op":"moveTicket","id":id,"status":"closed"}),
		)
		.await;
		act(&ws,&runner,json!({"op":"savePrompt","name":"review","expected_version":null,"description":"Code review","section":"purpose","body":long,"tags":["test"]})).await;
		let p = act(
			&ws,
			&runner,
			json!({"op":"prompt","name":"review","version":null}),
		)
		.await;
		assert_eq!(p["source"]["prompt"]["version"], 1);
		assert_eq!(p["render"]["sections"][0]["body"], long);
		act(&ws,&runner,json!({"op":"savePrompt","name":"review","expected_version":1,"description":"Updated review","section":"purpose","body":"Review carefully","tags":["edited"]})).await;
		let stale: Action = serde_json::from_value(
			json!({"op":"archivePrompt","name":"review","expected_version":1,"restore":false}),
		)
		.unwrap();
		assert!(ws
			.action(&runner, stale)
			.await
			.unwrap_err()
			.contains("conflict"));
		let history = act(
			&ws,
			&runner,
			json!({"op":"prompt","name":"review","version":1}),
		)
		.await;
		assert!(history["render"].is_null());
		assert_eq!(history["history"]["versions"].as_array().unwrap().len(), 2);
		act(
			&ws,
			&runner,
			json!({"op":"archivePrompt","name":"review","expected_version":2,"restore":false}),
		)
		.await;
		assert_eq!(
			act(&ws, &runner, json!({"op":"prompts","archived":true})).await["prompts"]
				.as_array()
				.unwrap()
				.len(),
			1
		);
		for (kind, fields) in [
			("convention", json!({"content":"Use small modules"})),
			(
				"pattern",
				json!({"name":"Adapter","description":"Fixed public contract"}),
			),
			(
				"failure",
				json!({"description":"Lost context","resolution":"Explicit insert"}),
			),
			(
				"decision",
				json!({"title":"Private data","rationale":"Avoid imported history"}),
			),
		] {
			act(&ws,&runner,json!({"op":"saveMemory","domain":"project","id":null,"kind":kind,"classification":"tactical","fields":fields,"tags":"source:test"})).await;
		}
		let memories = act(
			&ws,
			&runner,
			json!({"op":"memory","query":"","domain":"","kind":null,"classification":""}),
		)
		.await;
		assert_eq!(memories["records"].as_array().unwrap().len(), 4);
		let rec = memories["records"]
			.as_array()
			.unwrap()
			.iter()
			.find(|r| r["type"] == "convention")
			.unwrap();
		let memory_id = rec["id"].as_str().unwrap();
		assert_eq!(rec["domain"], "project");
		act(&ws,&runner,json!({"op":"saveMemory","domain":"project","id":memory_id,"kind":"convention","classification":"foundational","fields":{"content":"Updated expertise"},"tags":""})).await;
		let search=act(&ws,&runner,json!({"op":"memory","query":"Updated","domain":"project","kind":"convention","classification":"foundational"})).await;
		assert_eq!(search["records"].as_array().unwrap().len(), 1);
		act(
			&ws,
			&runner,
			json!({"op":"deleteMemory","domain":"project","id":memory_id}),
		)
		.await;
		let reopened = Workspace::new(ws.root.clone(), &ws.project).unwrap();
		let runner = Components::discover().unwrap();
		assert!(reopened.status().unwrap()["initialized"].as_bool().unwrap());
		let persisted = act(&reopened, &runner, json!({"op":"tickets"})).await;
		assert_eq!(persisted["issues"].as_array().unwrap().len(), 2);
		let second_project = Path::new(&ws.project).parent().unwrap().join("project-b");
		std::fs::create_dir(&second_project).unwrap();
		let b = Workspace::new(ws.root.clone(), second_project.to_str().unwrap()).unwrap();
		b.initialize(&runner).await.unwrap();
		assert_eq!(
			act(&b, &runner, json!({"op":"tickets"})).await["issues"]
				.as_array()
				.unwrap()
				.len(),
			0
		);
		assert!(!Path::new(&ws.project).join(".seeds").exists());
		// Hooks are never executable through this adapter, even if manually added to the owned store.
		let cfg = ws.path.join(".mulch/mulch.config.yaml");
		let original = std::fs::read_to_string(&cfg).unwrap();
		std::fs::write(
			&cfg,
			format!("{original}\nhooks:\n  pre-record:\n    - echo unexpected-hook\n"),
		)
		.unwrap();
		let blocked = ws
			.action(
				&runner,
				serde_json::from_value(
					json!({"op":"memory","query":"","domain":"","kind":"convention","classification":""}),
				)
				.unwrap(),
			)
			.await;
		assert!(blocked.unwrap_err().contains("executable hooks"));
		println!("Real lifecycle passed: ticket/dependency/status, prompt/history/conflict/archive, four expertise types/edit/delete, >48KiB Unicode stdin, restart/project isolation, executable-hook refusal.");
	}
}
