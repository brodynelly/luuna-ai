// LUUNA-AI â€” Tauri (native) backend.
//
// Faithful port of electron/main.cjs: owns the `pi --mode rpc` subprocess,
// the JSONL RPC protocol, git/filesystem/session/env operations, and pushes
// the same event payloads to the renderer ("push:state", "push:entry",
// "push:delta", "push:textPopup", "push:bootError").
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use chrono::TimeZone;

fn project_root() -> String {
	env!("CARGO_MANIFEST_DIR").replace("\\src-tauri", "").replace("/src-tauri", "")
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

struct PiChild {
	child: Child,
	stdin: Option<ChildStdin>,
}

struct AppState {
	cwd: String,
	model: Option<String>,
	thinking_level: Option<String>,
	plan_mode: bool,
	session_name: Option<String>,
	session_counter: u64,
	context_tokens: Option<f64>,
	git_info: Value,
	is_streaming: bool,
	is_bash: bool,
	request_start: Option<u64>,
	models_cache: Option<Value>,
	recent_sessions: Vec<(String, String)>, // (label, path)
	status_message: Option<String>,
	status_generation: u64,
	auto_compaction: bool,
	auto_retry: bool,
	steering_mode: String,
	follow_up_mode: String,
	pi_alive: bool,
	pi_started: bool,
	pi_error: Option<String>,
	renderer_ready: bool,
	entry_buffer: Vec<Value>,
}

impl Default for AppState {
	fn default() -> Self {
		Self {
			cwd: std::env::var("LUUNA_AI_DIR")
				.or_else(|_| std::env::var("TURBO_AI_DIR"))
				.unwrap_or_else(|_| project_root()),
			model: None,
			thinking_level: None,
			plan_mode: false,
			session_name: None,
			session_counter: 0,
			context_tokens: None,
			git_info: json!({"branch": null, "added": null, "removed": null, "dirtyFiles": [], "isRepo": false}),
			is_streaming: false,
			is_bash: false,
			request_start: None,
			models_cache: None,
			recent_sessions: Vec::new(),
			status_message: None,
			status_generation: 0,
			auto_compaction: true,
			auto_retry: true,
			steering_mode: "one-at-a-time".into(),
			follow_up_mode: "one-at-a-time".into(),
			pi_alive: false,
			pi_started: false,
			pi_error: None,
			renderer_ready: false,
			entry_buffer: Vec::new(),
		}
	}
}

struct Global {
	state: Mutex<AppState>,
	pi: Mutex<Option<PiChild>>,
	pending: Arc<Mutex<HashMap<String, Sender<Value>>>>,
	next_id: AtomicU64,
	app: Mutex<Option<AppHandle>>,
	boot_once: Mutex<()>,
}

fn now_ms() -> u64 {
	SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn effective_session_name(st: &AppState) -> String {
	match &st.session_name {
		Some(n) if !n.trim().is_empty() => n.trim().to_string(),
		_ => format!("NONAME{:02}.PAS", st.session_counter),
	}
}

fn state_snapshot(st: &AppState) -> Value {
	json!({
		"cwd": st.cwd,
		"model": st.model,
		"thinkingLevel": st.thinking_level,
		"planMode": st.plan_mode,
		"sessionName": effective_session_name(st),
		"contextTokens": st.context_tokens,
		"gitInfo": st.git_info,
		"isStreaming": st.is_streaming,
		"isBash": st.is_bash,
		"requestStart": st.request_start,
		"statusMessage": st.status_message,
		"autoCompaction": st.auto_compaction,
		"autoRetry": st.auto_retry,
		"steeringMode": st.steering_mode,
		"followUpMode": st.follow_up_mode,
		"recentSessions": st.recent_sessions.iter().map(|(l, p)| json!({"label": l, "path": p})).collect::<Vec<_>>(),
	})
}

fn emit(app: &AppHandle, event: &str, payload: Value) {
	let _ = app.emit(event, payload);
}

fn push_state(g: &Global) {
	if let Some(app) = g.app.lock().unwrap().clone() {
		let payload = state_snapshot(&g.state.lock().unwrap());
		emit(&app, "push:state", payload);
	}
}

fn push_entry(g: &Global, entry: Value) {
	if !g.state.lock().unwrap().renderer_ready {
		let mut st = g.state.lock().unwrap();
		st.entry_buffer.push(entry);
		if st.entry_buffer.len() > 500 {
			st.entry_buffer.remove(0);
		}
		return;
	}
	if let Some(app) = g.app.lock().unwrap().clone() {
		emit(&app, "push:entry", entry);
	}
}

fn flush_entry_buffer(g: &Global) {
	let buffered = {
		let mut st = g.state.lock().unwrap();
		st.renderer_ready = true;
		std::mem::take(&mut st.entry_buffer)
	};
	if let Some(app) = g.app.lock().unwrap().clone() {
		for entry in buffered {
			emit(&app, "push:entry", entry);
		}
	}
	push_state(g);
}

fn flash(g: &Global, message: &str) {
	let generation = {
		let mut st = g.state.lock().unwrap();
		st.status_generation += 1;
		st.status_message = Some(message.to_string());
		st.status_generation
	};
	push_state(g);
	if let Some(app) = g.app.lock().unwrap().clone() {
		let app2 = app.clone();
		std::thread::spawn(move || {
			std::thread::sleep(Duration::from_secs(3));
			let st = app2.state::<Arc<Global>>();
			let mut s = st.state.lock().unwrap();
			if s.status_generation == generation {
				s.status_message = None;
				drop(s);
				push_state(&st);
			}
		});
	}
}

// ---------------------------------------------------------------------------
// Pi RPC subprocess
// ---------------------------------------------------------------------------

fn windows_cmd_line(command: &str, args: &[&str]) -> Result<String, String> {
	for v in std::iter::once(command).chain(args.iter().copied()) {
		if v.contains('"') || v.contains('\r') || v.contains('\n') || v.contains('&') || v.contains('|') || v.contains('<') || v.contains('>') || v.contains('^') || v.contains('%') || v.contains('!') {
			return Err(format!("Unsafe character in Windows command argument: {}", v));
		}
	}
	let quoted: Vec<String> = args.iter().map(|a| format!("\"{}\"", a)).collect();
	let suffix = if quoted.is_empty() { String::new() } else { format!(" {}", quoted.join(" ")) };
	if command.chars().any(|c| c.is_whitespace()) {
		Ok(format!("\"\"{}{}\"\"", command, suffix))
	} else {
		Ok(format!("{}{}", command, suffix))
	}
}

fn spawn_pi(cwd: &str) -> Result<PiChild, String> {
	let command = std::env::var("PI_CMD").unwrap_or_else(|_| "pi".to_string());
	let args = ["--mode", "rpc", "--no-session"];
	let mut cmd = Command::new("cmd");
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		let cmdline = windows_cmd_line(&command, &args)?;
		cmd.args(["/d", "/s", "/c", &cmdline]).creation_flags(0x0800_0000);
	}
	#[cfg(not(windows))]
	{
		cmd.args([&command, args[0], args[1], args[2]]);
	}
	cmd.current_dir(cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
	let mut child = cmd.spawn().map_err(|_| "ERROR: Pi coding agent not found.".to_string())?;
	let stdin = child.stdin.take();
	Ok(PiChild { child, stdin })
}

fn rpc_send(g: &Global, mut cmd: Value) -> Result<(), String> {
	let mut pi_guard = g.pi.lock().unwrap();
	match pi_guard.as_mut() {
		Some(pi) => {
			if pi.stdin.is_none() {
				return Err("PI DISCONNECTED".into());
			}
			let line = cmd.to_string();
			let stdin = pi.stdin.as_mut().unwrap();
			stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
			stdin.write_all(b"\n").map_err(|e| e.to_string())?;
			stdin.flush().ok();
			Ok(())
		}
		None => Err("PI DISCONNECTED".into()),
	}
}

fn rpc_request(g: &Global, mut cmd: Value, timeout_ms: u64) -> Result<Value, String> {
	if !g.state.lock().unwrap().pi_alive {
		return Ok(json!({"type": "response", "command": cmd["type"].clone(), "success": false, "error": "PI DISCONNECTED"}));
	}
	let id = format!("tui-{}", g.next_id.fetch_add(1, Ordering::SeqCst));
	cmd["id"] = json!(id.clone());
	let (tx, rx) = channel();
	g.pending.lock().unwrap().insert(id.clone(), tx);
	if let Err(e) = rpc_send(g, cmd) {
		g.pending.lock().unwrap().remove(&id);
		return Err(e);
	}
	match rx.recv_timeout(Duration::from_millis(timeout_ms)) {
		Ok(v) => Ok(v),
		Err(_) => {
			g.pending.lock().unwrap().remove(&id);
			Ok(json!({"type": "response", "success": false, "id": id, "error": "timeout"}))
		}
	}
}

fn fail_pending(g: &Global, error: &str) {
	let mut pending = g.pending.lock().unwrap();
	for (_, tx) in pending.drain() {
		let _ = tx.send(json!({"type": "response", "command": "exit", "success": false, "error": error}));
	}
}

fn kill_pi(g: &Global) {
	let mut pi_guard = g.pi.lock().unwrap();
	if let Some(mut pi) = pi_guard.take() {
		pi.stdin = None;
		let _ = pi.child.kill();
		#[cfg(windows)]
		{
			let pid = pi.child.id();
			if pid != 0 {
				let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).creation_flags(0x0800_0000).spawn();
			}
		}
	}
	g.state.lock().unwrap().pi_alive = false;
}

// ---------------------------------------------------------------------------
// RPC event -> agent panel entries (port of src/rpc/events.ts)
// ---------------------------------------------------------------------------

fn tool_tag(name: &str) -> String {
	match name.to_lowercase().as_str() {
		"read" => "[READ]".into(),
		"edit" => "[EDIT]".into(),
		"write" => "[WRITE]".into(),
		"bash" => "[BASH]".into(),
		"grep" | "glob" | "find" | "list" => "[SEARCH]".into(),
		"task" => "[RUN]".into(),
		other => format!("[{}]", other.to_uppercase()),
	}
}

fn first_line(s: &str, max: usize) -> String {
	let line = s.split('\n').next().unwrap_or("");
	if line.chars().count() > max {
		let t: String = line.chars().take(max - 1).collect();
		format!("{}â€¦", t)
	} else {
		line.to_string()
	}
}

fn args_summary(args: Option<&Value>) -> String {
	if let Some(Value::Object(map)) = args {
		for key in ["path", "file_path", "filePath", "command", "pattern", "query", "url"] {
			if let Some(Value::String(v)) = map.get(key) {
				return v.clone();
			}
		}
	}
	String::new()
}

#[derive(Default)]
struct EvResult {
	entries: Vec<Value>,
	delta: Option<(String, String)>, // (kind, delta)
	stream_reset: bool,
	agent_started: bool,
	agent_ended: bool,
	error: Option<String>,
}

fn str_field(v: &Value, key: &str) -> Option<String> {
	v.get(key).and_then(|x| x.as_str()).map(|s| s.to_string())
}

fn event_to_entries(event: &Value) -> EvResult {
	let mut r = EvResult::default();
	match event["type"].as_str().unwrap_or("") {
		"agent_start" => r.agent_started = true,
		"agent_end" => r.agent_ended = true,
		"message_update" => {
			let e = &event["assistantMessageEvent"];
			match e["type"].as_str().unwrap_or("") {
				"text_delta" => {
					if let Some(d) = str_field(e, "delta") {
						r.delta = Some(("agent".into(), d));
					}
				}
				"thinking_delta" => {
					if let Some(d) = str_field(e, "delta") {
						r.delta = Some(("thinking".into(), d));
					}
				}
				"text_start" | "thinking_start" => r.stream_reset = true,
				"toolcall_end" => {
					if let Some(name) = e["toolCall"]["name"].as_str() {
						r.entries.push(json!({"kind": "tool", "text": "", "tag": tool_tag(name), "isError": false}));
					}
				}
				"error" => {
					let msg = str_field(e, "errorMessage").or_else(|| str_field(e, "reason")).unwrap_or_else(|| "Model error".into());
					r.entries.push(json!({"kind": "error", "text": msg, "tag": "[ERROR]", "isError": true}));
					r.error = Some(msg);
				}
				_ => {}
			}
		}
		"message_end" => {
			let msg = &event["message"];
			let is_err = msg["stopReason"] == json!("error") || !msg["errorMessage"].is_null() || !msg["error"].is_null();
			if is_err {
				let mut err = str_field(msg, "errorMessage").or_else(|| str_field(msg, "error"));
				if err.is_none() {
					if let Some(arr) = msg["content"].as_array() {
						let text: Vec<String> = arr
							.iter()
							.filter(|c| c["type"] == json!("text"))
							.filter_map(|c| str_field(c, "text"))
							.collect();
						if !text.is_empty() {
							err = Some(text.join("\n"));
						}
					}
				}
				let full = err.unwrap_or_else(|| "Model generation failed (check API key, rate limits or endpoint)".into());
				r.entries.push(json!({"kind": "error", "text": full, "tag": "[ERROR]", "isError": true}));
				r.error = Some(full);
			}
		}
		"tool_execution_start" => {
			let text = args_summary(event.get("args"));
			r.entries.push(json!({"kind": "tool", "text": text, "tag": tool_tag(event["toolName"].as_str().unwrap_or("tool")), "isError": false}));
		}
		"tool_execution_end" => {
			if event["isError"] == json!(true) {
				let text = args_summary(event.get("args"));
				r.entries.push(json!({"kind": "error", "text": text, "tag": "[ERROR]", "isError": true}));
			}
		}
		"auto_retry_start" => {
			let attempt = event["attempt"].as_u64().unwrap_or(0) + 1;
			let max = event["maxAttempts"].as_u64().unwrap_or(3);
			let msg = str_field(event, "errorMessage").unwrap_or_default();
			r.entries.push(json!({"kind": "info", "text": format!("Retrying ({}/{}): {}", attempt, max, first_line(&msg, 100))}));
		}
		"auto_retry_end" => {
			if event["success"] == json!(false) {
				let msg = str_field(event, "finalError").unwrap_or_default();
				r.entries.push(json!({"kind": "error", "text": format!("Retry failed: {}", first_line(&msg, 120)), "tag": "[ERROR]", "isError": true}));
			}
		}
		"compaction_end" => {
			if let Some(m) = str_field(event, "errorMessage") {
				r.entries.push(json!({"kind": "error", "text": format!("Compaction failed: {}", m), "tag": "[ERROR]", "isError": true}));
			} else {
				r.entries.push(json!({"kind": "info", "text": "Context compacted."}));
			}
		}
		"extension_error" => {
			let msg = str_field(event, "error").unwrap_or_else(|| "Extension error".into());
			r.entries.push(json!({"kind": "error", "text": first_line(&msg, 120), "tag": "[ERROR]", "isError": true}));
		}
		"extension_ui_request" => {
			if event["method"] == json!("notify") {
				let t = str_field(event, "notifyType").unwrap_or_else(|| "info".into());
				let is_err = t == "error";
				r.entries.push(json!({"kind": if is_err { "error" } else { "info" }, "text": str_field(event, "message").unwrap_or_default(), "tag": if is_err { json!("[ERROR]") } else { json!(null) }, "isError": is_err}));
			}
		}
		_ => {}
	}
	r
}

fn handle_rpc_event(g: &Global, event: Value) {
	let res = event_to_entries(&event);
	for entry in res.entries {
		push_entry(g, entry);
	}
	let mut need_state = false;
	{
		let mut st = g.state.lock().unwrap();
		if res.agent_started {
			st.is_streaming = true;
			if st.request_start.is_none() {
				st.request_start = Some(now_ms());
			}
			need_state = true;
		}
		if res.agent_ended {
			st.is_streaming = false;
			st.request_start = None;
			need_state = true;
		}
	}
	if res.agent_ended {
		push_entry(g, json!({"kind": "__closeStream__", "text": ""}));
		let app = g.app.lock().unwrap().clone();
		if let Some(app) = app {
			let g2 = app.state::<Arc<Global>>().inner().clone();
			std::thread::spawn(move || {
				poll_stats(&g2);
				poll_git(&g2);
			});
		}
	}
	if res.stream_reset {
		push_entry(g, json!({"kind": "__closeStream__", "text": ""}));
	}
	if let Some((kind, delta)) = res.delta {
		if let Some(app) = g.app.lock().unwrap().clone() {
			emit(&app, "push:delta", json!({"kind": kind, "delta": delta}));
		}
	}
	if let Some(err) = res.error {
		push_entry(g, json!({"kind": "__closeStream__", "text": ""}));
		flash(g, &format!("Error: {}", err));
		need_state = true;
	}
	if need_state {
		push_state(g);
	}
}

fn handle_line(g: &Global, line: &str) {
	let trimmed = line.trim();
	if trimmed.is_empty() {
		return;
	}
	let msg: Value = match serde_json::from_str(trimmed) {
		Ok(v) => v,
		Err(_) => return,
	};
	match msg["type"].as_str().unwrap_or("") {
		"response" => {
			let id = str_field(&msg, "id");
			if let Some(id) = id {
				let tx = g.pending.lock().unwrap().remove(&id);
				if let Some(tx) = tx {
					let _ = tx.send(msg);
					return;
				}
			}
			// unsolicited failure response
			if msg["success"] == json!(false) {
				let err = str_field(&msg, "error").unwrap_or_else(|| "Command failed".into());
				let command = str_field(&msg, "command").unwrap_or_else(|| "RPC".into());
				push_entry(g, json!({"kind": "error", "text": format!("{}: {}", command, err), "tag": "[ERROR]", "isError": true}));
				flash(g, &format!("Error: {}", err));
			}
		}
		_ => handle_rpc_event(g, msg),
	}
}

// ---------------------------------------------------------------------------
// Background polls
// ---------------------------------------------------------------------------

fn poll_stats(g: &Global) {
	let resp = rpc_request(g, json!({"type": "get_session_stats"}), 15000);
	if let Ok(resp) = resp {
		if resp["success"] == json!(true) {
			if let Some(tokens) = resp["data"]["contextUsage"]["tokens"].as_f64() {
				g.state.lock().unwrap().context_tokens = Some(tokens);
				push_state(g);
			}
		}
	}
}

fn poll_git(g: &Global) {
	let cwd = g.state.lock().unwrap().cwd.clone();
	let info = collect_git_info(&cwd);
	{
		let mut st = g.state.lock().unwrap();
		if st.cwd != cwd {
			return;
		}
		st.git_info = info.clone();
	}
	push_state(g);
}

fn start_git_poll(g: &Global) {
	if let Some(app) = g.app.lock().unwrap().clone() {
		let g2 = app.state::<Arc<Global>>().inner().clone();
		std::thread::spawn(move || loop {
			std::thread::sleep(Duration::from_secs(10));
			if g2.state.lock().unwrap().pi_alive {
				poll_git(&g2);
			} else {
				break;
			}
		});
	}
}

fn get_client_state(g: &Global) -> Result<Value, String> {
	let fallback = || json!({"success": false, "error": "PI DISCONNECTED"});
	let mut resp = rpc_request(g, json!({"type": "get_state"}), 15000).unwrap_or_else(|_| fallback());
	for _ in 0..3 {
		if resp["success"] == json!(true) {
			break;
		}
		std::thread::sleep(Duration::from_millis(500));
		resp = rpc_request(g, json!({"type": "get_state"}), 15000).unwrap_or_else(|_| fallback());
	}
	if resp["success"] == json!(true) && !resp["data"].is_null() {
		Ok(resp["data"].clone())
	} else {
		Err(str_field(&resp, "error").unwrap_or_else(|| "ERROR: Unable to connect to Pi.".into()))
	}
}

fn ensure_pi(g: &Global) -> Result<(), String> {
	let _guard = g.boot_once.lock().unwrap();
	{
		let st = g.state.lock().unwrap();
		if st.pi_started {
			drop(st);
			return if g.state.lock().unwrap().pi_alive {
				Ok(())
			} else {
				Err(g.state.lock().unwrap().pi_error.clone().unwrap_or_else(|| "ERROR: Unable to connect to Pi.".into()))
			};
		}
	}
	let cwd = g.state.lock().unwrap().cwd.clone();
	let result = (|| -> Result<(), String> {
		let mut child = spawn_pi(&cwd)?;
		let stdout = child.child.stdout.take();
		*g.pi.lock().unwrap() = Some(child);
		g.state.lock().unwrap().pi_alive = true;

		// stdout reader thread
		let g2 = g.app.lock().unwrap().clone().ok_or("app not ready")?;
		let g2 = g2.state::<Arc<Global>>().inner().clone();
		let pending = g.pending.clone();
		if let Some(stdout) = stdout {
			let pending2 = pending.clone();
			std::thread::spawn(move || {
				let reader = BufReader::new(stdout);
				for line in reader.lines() {
					match line {
						Ok(l) => {
							let msg: Value = match serde_json::from_str(l.trim()) {
								Ok(v) => v,
								Err(_) => continue,
							};
							if msg["type"] == json!("response") {
								if let Some(id) = str_field(&msg, "id") {
									let tx = pending2.lock().unwrap().remove(&id);
									if let Some(tx) = tx {
										let _ = tx.send(msg);
										continue;
									}
								}
								if msg["success"] == json!(false) {
									let err = str_field(&msg, "error").unwrap_or_else(|| "Command failed".into());
									let command = str_field(&msg, "command").unwrap_or_else(|| "RPC".into());
									push_entry(&g2, json!({"kind": "error", "text": format!("{}: {}", command, err), "tag": "[ERROR]", "isError": true}));
									flash(&g2, &format!("Error: {}", err));
								}
							} else {
								handle_rpc_event(&g2, msg);
							}
						}
						Err(_) => break,
					}
				}
				// process ended
				g2.state.lock().unwrap().pi_alive = false;
				fail_pending(&g2, "PI DISCONNECTED");
				push_entry(&g2, json!({"kind": "error", "text": "PI DISCONNECTED - the agent process exited.", "tag": "[ERROR]", "isError": true}));
				flash(&g2, "PI DISCONNECTED");
				push_state(&g2);
			});
		}

		let data = get_client_state(g)?;
		{
			let mut st = g.state.lock().unwrap();
			if let Some(m) = data["model"].as_object() {
				let provider = m.get("provider").and_then(|v| v.as_str()).unwrap_or("");
				let id = m.get("id").and_then(|v| v.as_str()).unwrap_or("");
				if !id.is_empty() {
					st.model = Some(format!("{}/{}", provider, id));
				}
			}
			if let Some(n) = str_field(&data, "sessionName") {
				st.session_name = Some(n);
			}
			if let Some(t) = str_field(&data, "thinkingLevel") {
				st.thinking_level = if t == "off" { None } else { Some(t) };
			}
			st.pi_started = true;
		}
		push_entry(g, json!({"kind": "info", "text": format!("Connected ({}). Session: {}", effective_session_name(&g.state.lock().unwrap()), str_field(&data, "sessionId").unwrap_or_else(|| "(new)".into()))}));
		poll_stats(g);
		poll_git(g);
		start_git_poll(g);
		Ok(())
	})();

	match result {
		Ok(()) => {
			g.state.lock().unwrap().pi_error = None;
			Ok(())
		}
		Err(e) => {
			let mut st = g.state.lock().unwrap();
			st.pi_error = Some(e.clone());
			Err(e)
		}
	}
}

// ---------------------------------------------------------------------------
// Filesystem / git helpers (port of src/commands/commands.ts)
// ---------------------------------------------------------------------------

fn exec_line(cmd: &str, args: &[&str], cwd: &str) -> Option<String> {
	let mut c = Command::new(cmd);
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		c.creation_flags(0x0800_0000);
	}
	let out = c.args(args).current_dir(cwd).output().ok()?;
	if out.status.success() {
		Some(String::from_utf8_lossy(&out.stdout).to_string())
	} else {
		None
	}
}

fn collect_git_info(cwd: &str) -> Value {
	let empty = json!({"branch": null, "added": null, "removed": null, "dirtyFiles": [], "isRepo": false});
	let status = match exec_line("git", &["status", "--porcelain=v1", "-z", "-b"], cwd) {
		Some(s) => s,
		None => return empty,
	};
	let records: Vec<&str> = status.split('\0').filter(|r| !r.is_empty()).collect();
	let mut branch: Option<String> = None;
	let mut dirty_files: Vec<String> = Vec::new();
	let mut index = 0;
	while index < records.len() {
		let record = records[index];
		if let Some(rest) = record.strip_prefix("## ") {
			branch = Some(if let Some(b) = rest.strip_prefix("No commits yet on ") {
				b.to_string()
			} else if let Some(b) = rest.strip_prefix("Initial commit on ") {
				b.to_string()
			} else if rest.starts_with("HEAD (no branch)") {
				"(detached)".to_string()
			} else {
				rest.split("...").next().unwrap_or(rest).to_string()
			});
		} else if record.len() > 3 {
			dirty_files.push(record[3..].replace('\\', "/"));
			let is_rename = record.starts_with('R') || record.starts_with('C');
			if is_rename {
				index += 1;
			}
		}
		index += 1;
	}
	let mut added: Option<i64> = None;
	let mut removed: Option<i64> = None;
	if let Some(numstat) = exec_line("git", &["diff", "--numstat"], cwd) {
		let mut a: i64 = 0;
		let mut r: i64 = 0;
		for line in numstat.lines() {
			let mut parts = line.split('\t');
			if let (Some(x), Some(y)) = (parts.next(), parts.next()) {
				if let (Ok(x), Ok(y)) = (x.parse::<i64>(), y.parse::<i64>()) {
					a += x;
					r += y;
				}
			}
		}
		added = Some(a);
		removed = Some(r);
	}
	let dirty: Vec<Value> = dirty_files.iter().map(|f| json!(f)).collect();
	json!({"branch": branch, "added": added, "removed": removed, "dirtyFiles": dirty, "isRepo": true})
}

fn read_preview_file(path: &str, max_lines: usize) -> Option<Value> {
	let content = std::fs::read(path).ok()?;
	// Binary sniff: NUL byte in the first 8000 bytes.
	if content[..content.len().min(8000)].contains(&0) {
		return None;
	}
	let text = String::from_utf8_lossy(&content);
	let mut lines: Vec<Value> = Vec::new();
	for l in text.lines().take(max_lines) {
		let t: String = l.chars().take(200).collect();
		lines.push(json!(t));
	}
	let total = text.lines().count();
	Some(json!({"lines": lines, "truncated": total > max_lines}))
}

fn scan_tree(dir: &str, rel: &str, depth: u32, budget: &mut u32, dirty: &[String]) -> Value {
	if depth > 10 || *budget == 0 {
		return json!([]);
	}
	let mut nodes: Vec<Value> = Vec::new();
	let entries = match std::fs::read_dir(dir) {
		Ok(e) => e,
		Err(_) => return json!([]),
	};
	for entry in entries.flatten() {
		let name = entry.file_name().to_string_lossy().to_string();
		if name.starts_with('.') && name != ".github" {
			continue;
		}
		if matches!(name.as_str(), "node_modules" | ".git" | "dist" | ".next" | "__pycache__" | ".turbo" | "coverage") {
			continue;
		}
		let full = entry.path();
		let rel_path = if rel.is_empty() { name.clone() } else { format!("{}/{}", rel, name) };
		let Ok(ft) = entry.file_type() else { continue };
		if ft.is_dir() {
			*budget -= 1;
			let children = scan_tree(full.to_string_lossy().as_ref(), &rel_path, depth + 1, budget, dirty);
			nodes.push(json!({"name": name, "relPath": rel_path, "isDir": true, "dirty": false, "children": children}));
		} else if ft.is_file() {
			*budget -= 1;
			let is_dirty = dirty.iter().any(|d| *d == rel_path);
			nodes.push(json!({"name": name, "relPath": rel_path, "isDir": false, "dirty": is_dirty, "children": null}));
		}
		if *budget == 0 {
			break;
		}
	}
	nodes.sort_by(|a, b| {
		let ad = a["isDir"].as_bool();
		let bd = b["isDir"].as_bool();
		bd.cmp(&ad).then_with(|| a["name"].as_str().cmp(&b["name"].as_str()))
	});
	json!(nodes)
}

fn pi_config_dir() -> std::path::PathBuf {
	match std::env::var("PI_CONFIG_DIR") {
		Ok(d) => std::path::PathBuf::from(d),
		Err(_) => dirs_home().join(".pi").join("agent"),
	}
}

fn dirs_home() -> std::path::PathBuf {
	std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).map(std::path::PathBuf::from).unwrap_or_else(|_| std::path::PathBuf::from("."))
}

fn parse_env_file(content: &str) -> HashMap<String, String> {
	let mut map = HashMap::new();
	for line in content.lines() {
		let t = line.trim();
		if t.is_empty() || t.starts_with('#') || !t.contains('=') {
			continue;
		}
		let (k, v) = t.split_once('=').unwrap();
		map.insert(k.trim().to_string(), v.trim().to_string());
	}
	map
}

fn read_env_key(cwd: &str, env_var: &str) -> Option<String> {
	if let Ok(v) = std::env::var(env_var) {
		if !v.trim().is_empty() {
			return Some(v.trim().to_string());
		}
	}
	let local = std::path::Path::new(cwd).join(".env");
	if let Ok(content) = std::fs::read_to_string(&local) {
		if let Some(v) = parse_env_file(&content).get(env_var) {
			return Some(v.clone());
		}
	}
	let pi_env = pi_config_dir().join(".env");
	if let Ok(content) = std::fs::read_to_string(&pi_env) {
		if let Some(v) = parse_env_file(&content).get(env_var) {
			return Some(v.clone());
		}
	}
	None
}

fn mask_api_key(key: &Option<String>) -> String {
	match key {
		None => "Not Set".into(),
		Some(k) if k.trim().is_empty() => "Not Set".into(),
		Some(k) => {
			let t = k.trim();
			if t.len() <= 8 {
				"Set (***)".into()
			} else {
				let tail: String = t.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
				format!("...{}", tail)
			}
		}
	}
}

fn atomic_write(path: &std::path::Path, content: &str) -> Result<(), String> {
	if let Some(dir) = path.parent() {
		let _ = std::fs::create_dir_all(dir);
	}
	let tmp = path.with_extension(format!("tmp.{}", std::process::id()));
	std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
	std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn save_custom_model(provider: &str, id: &str, name: &str, reasoning: bool) -> Result<(), String> {
	let file_path = pi_config_dir().join("models.json");
	let mut full: Map<String, Value> = if file_path.exists() {
		match serde_json::from_str(&std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?) {
			Ok(Value::Object(m)) => m,
			Ok(_) => Map::new(),
			Err(e) => return Err(format!("Cannot update malformed models.json: {}", e)),
		}
	} else {
		Map::new()
	};
	if !full.contains_key("providers") {
		full.insert("providers".into(), json!({}));
	}
	let providers = full.get_mut("providers").unwrap().as_object_mut().ok_or("providers is not an object")?;
	let p = provider.to_lowercase().trim().to_string();
	if !providers.contains_key(&p) {
		providers.insert(p.clone(), json!({"models": []}));
	}
	let entry = providers.get_mut(&p).unwrap().as_object_mut().ok_or("provider is not an object")?;
	if !entry.contains_key("models") || !entry["models"].is_array() {
		entry.insert("models".into(), json!([]));
	}
	let models = entry.get_mut("models").unwrap().as_array_mut().unwrap();
	models.retain(|m| m["id"].as_str().map(|s| s.to_lowercase()) != Some(id.to_lowercase()));
	models.push(json!({"id": id, "name": name, "reasoning": reasoning}));
	atomic_write(&file_path, &format!("{}\n", serde_json::to_string_pretty(&full).map_err(|e| e.to_string())?))
}

fn set_custom_model_reasoning(provider: &str, model_id: &str, reasoning: bool) -> Result<(), String> {
	let file_path = pi_config_dir().join("models.json");
	if !file_path.exists() {
		return save_custom_model(provider, model_id, model_id, reasoning);
	}
	let mut full: Value = serde_json::from_str(&std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
	let p = provider.to_lowercase().trim().to_string();
	if let Some(models) = full["providers"][&p]["models"].as_array_mut() {
		for m in models.iter_mut() {
			if m["id"].as_str().map(|s| s.eq_ignore_ascii_case(model_id)).unwrap_or(false) {
				m["reasoning"] = json!(reasoning);
				return atomic_write(&file_path, &format!("{}\n", serde_json::to_string_pretty(&full).map_err(|e| e.to_string())?));
			}
		}
	}
	save_custom_model(provider, model_id, model_id, reasoning)
}

fn read_enabled_models() -> Option<Vec<String>> {
	let path = pi_config_dir().join("settings.json");
	let data: Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
	let arr = data["enabledModels"].as_array()?;
	let list: Vec<String> = arr.iter().filter_map(|v| v.as_str().map(String::from)).collect();
	if list.is_empty() {
		None
	} else {
		Some(list)
	}
}

fn filter_enabled_models(models: Value) -> Value {
	let enabled = match read_enabled_models() {
		Some(e) => e,
		None => return models,
	};
	let arr = models.as_array().cloned().unwrap_or_default();
	let filtered: Vec<Value> = arr
		.iter()
		.filter(|m| {
			let key = format!("{}/{}", m["provider"].as_str().unwrap_or(""), m["id"].as_str().unwrap_or(""));
			enabled.iter().any(|e| *e == key)
		})
		.cloned()
		.collect();
	if filtered.is_empty() {
		models
	} else {
		json!(filtered)
	}
}

fn summarize_pi_session(file_path: &std::path::Path, project_cwd: &str) -> Option<Value> {
	let content = std::fs::read_to_string(file_path).ok()?;
	let meta = std::fs::metadata(file_path).ok()?;
	let mut session_cwd = String::new();
	let mut first_prompt = "(no prompt)".to_string();
	let mut model_name: Option<String> = None;
	let mut custom_name: Option<String> = None;
	for line in content.lines() {
		if line.trim().is_empty() {
			continue;
		}
		let Ok(obj) = serde_json::from_str::<Value>(line) else { continue };
		match obj["type"].as_str().unwrap_or("") {
			"session" => {
				if let Some(c) = str_field(&obj, "cwd") {
					session_cwd = c;
				}
				if let Some(n) = str_field(&obj, "sessionName") {
					custom_name = Some(n);
				}
			}
			"set_session_name" => {
				if let Some(n) = str_field(&obj, "name") {
					custom_name = Some(n);
				}
			}
			"model_change" => {
				if let Some(id) = str_field(&obj, "modelId") {
					model_name = match str_field(&obj, "provider") {
						Some(p) => Some(format!("{}/{}", p, id)),
						None => Some(id),
					};
				}
			}
			"message" => {
				if obj["message"]["role"] == json!("user") && first_prompt == "(no prompt)" {
					let mut text = String::new();
					if let Some(s) = obj["message"]["content"].as_str() {
						text = s.to_string();
					} else if let Some(arr) = obj["message"]["content"].as_array() {
						for c in arr {
							if c["type"] == json!("text") {
								if let Some(t) = str_field(c, "text") {
									text = t;
									break;
								}
							}
						}
					}
					if !text.is_empty() {
						let clean = text.trim();
						let clean = clean.strip_prefix(|c: char| c == '[').map(|s| s.to_string()).unwrap_or_else(|| clean.to_string());
						let clean = match clean.find("]") {
							Some(idx) if clean.starts_with("PLAN MODE") => clean[idx + 1..].trim().to_string(),
							_ => clean,
						};
						let mut c = clean;
						if c.len() > 50 {
							c = format!("{}â€¦", c.chars().take(49).collect::<String>());
						}
						first_prompt = if c.is_empty() { "(empty prompt)".into() } else { c };
					}
				}
			}
			_ => {}
		}
	}
	let norm = |s: &str| if cfg!(windows) { s.to_lowercase() } else { s.to_string() };
	if norm(&session_cwd) != norm(project_cwd) {
		return None;
	}
	let file = file_path.file_name()?.to_string_lossy().to_string();
	let date = chrono::Local.timestamp_millis_opt(meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis() as i64).single()?;
	json_ok(json!({
		"id": file,
		"title": custom_name.unwrap_or_else(|| file.replace(".jsonl", "").chars().take(24).collect::<String>()),
		"firstPrompt": first_prompt,
		"model": model_name,
		"date": date.format("%Y-%m-%d %H:%M").to_string(),
		"path": file_path.to_string_lossy(),
		"mtime": meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64,
		"kind": "pi",
	}))
}

fn json_ok(v: Value) -> Option<Value> {
	Some(v)
}

fn get_project_sessions(project_cwd: &str) -> Result<Value, String> {
	let mut results: Vec<(u64, Value)> = Vec::new();
	let base = pi_config_dir().join("sessions");
	if let Ok(dirs) = std::fs::read_dir(&base) {
		for d in dirs.flatten() {
			if !d.path().is_dir() {
				continue;
			}
			if let Ok(files) = std::fs::read_dir(d.path()) {
				for f in files.flatten() {
					let p = f.path();
					if p.extension().map(|e| e == "jsonl").unwrap_or(false) {
						if let Some(summary) = summarize_pi_session(&p, project_cwd) {
							let mtime = summary["mtime"].as_u64().unwrap_or(0);
							results.push((mtime, summary));
						}
					}
				}
			}
		}
	}
	if let Ok(files) = std::fs::read_dir(project_cwd) {
		for f in files.flatten() {
			let name = f.file_name().to_string_lossy().to_string();
			if !name.ends_with(".md") {
				continue;
			}
			let looks = name.starts_with("NONAME") || name.contains("SESSION") || name.contains("TASK") || name.to_lowercase().contains("session");
			if !looks {
				continue;
			}
			if let Ok(meta) = f.metadata() {
				if !meta.is_file() {
					continue;
				}
				let date_str = chrono::Local.timestamp_millis_opt(meta.modified().ok().map(|m| m.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as i64).unwrap_or(0)).unwrap_or(0)).single().map(|d| d.format("%Y-%m-%d %H:%M").to_string()).unwrap_or_default();
				let mtime = meta.modified().ok().and_then(|m| m.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
				results.push((mtime, json!({
					"id": name, "title": name, "firstPrompt": "Saved Markdown Transcript",
					"date": date_str,
					"path": f.path().to_string_lossy(), "mtime": mtime, "kind": "transcript",
				})));
			}
		}
	}
	results.sort_by(|a, b| b.0.cmp(&a.0));
	Ok(json!(results.into_iter().map(|(_, v)| v).collect::<Vec<_>>()))
}

fn parse_jsonl_session(file_path: &str) -> Result<Value, String> {
	let content = std::fs::read_to_string(file_path).map_err(|e| format!("Error loading session: {}", e))?;
	let mut entries: Vec<Value> = Vec::new();
	let mut model: Option<String> = None;
	let mut thinking: Option<String> = None;
	let mut title: Option<String> = None;
	for line in content.lines() {
		if line.trim().is_empty() {
			continue;
		}
		let Ok(obj) = serde_json::from_str::<Value>(line) else { continue };
		match obj["type"].as_str().unwrap_or("") {
			"session" => {
				if let Some(t) = str_field(&obj, "sessionName") {
					title = Some(t);
				}
			}
			"set_session_name" => {
				if let Some(t) = str_field(&obj, "name") {
					title = Some(t);
				}
			}
			"model_change" => {
				if let Some(id) = str_field(&obj, "modelId") {
					model = Some(match str_field(&obj, "provider") {
						Some(p) => format!("{}/{}", p, id),
						None => id,
					});
				}
			}
			"thinking_level_change" => {
				if let Some(t) = str_field(&obj, "thinkingLevel") {
					thinking = Some(t);
				}
			}
			"message" => {
				let role = obj["message"]["role"].as_str().unwrap_or("");
				let content_v = &obj["message"]["content"];
				if role == "user" {
					let mut text = String::new();
					if let Some(s) = content_v.as_str() {
						text = s.to_string();
					} else if let Some(arr) = content_v.as_array() {
						let parts: Vec<String> = arr
							.iter()
							.filter(|c| c["type"] == json!("text"))
							.filter_map(|c| str_field(c, "text"))
							.collect();
						text = parts.join("\n");
					}
					if !text.is_empty() {
						entries.push(json!({"kind": "user", "text": text}));
					}
				} else if role == "assistant" {
					if let Some(s) = content_v.as_str() {
						entries.push(json!({"kind": "agent", "text": s}));
					} else if let Some(arr) = content_v.as_array() {
						for part in arr {
							if part["type"] == json!("thinking") {
								if let Some(t) = str_field(part, "thinking") {
									entries.push(json!({"kind": "thinking", "text": t}));
								}
							} else if part["type"] == json!("text") {
								if let Some(t) = str_field(part, "text") {
									entries.push(json!({"kind": "agent", "text": t}));
								}
							} else if !part["name"].is_null() || part["type"] == json!("tool_call") || part["type"] == json!("tool_use") {
								let name = str_field(part, "name").unwrap_or_else(|| "tool".into());
								entries.push(json!({"kind": "tool", "tag": tool_tag(&name), "text": ""}));
							}
						}
					}
				}
			}
			"tool_execution_start" => {
				let name = str_field(&obj, "toolName").unwrap_or_else(|| "tool".into());
				entries.push(json!({"kind": "tool", "tag": tool_tag(&name), "text": args_summary(obj.get("args"))}));
			}
			_ => {}
		}
	}
	Ok(json!({"entries": entries, "model": model, "thinkingLevel": thinking, "title": title}))
}

fn get_system_info_lines(cwd: &str) -> Value {
	let mut mem_total = String::from("?");
	#[cfg(windows)]
	{
		if let Ok(out) = Command::new("wmic").args(["ComputerSystem", "get", "TotalPhysicalMemory"]).output() {
			let s = String::from_utf8_lossy(&out.stdout);
			if let Some(line) = s.lines().map(str::trim).find(|l| !l.is_empty() && l.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)) {
				if let Ok(bytes) = line.parse::<f64>() {
					mem_total = format!("{:.1} GB", bytes / 1024.0 / 1024.0 / 1024.0);
				}
			}
		}
	}
	#[cfg(not(windows))]
	{
		if let Ok(data) = std::fs::read_to_string("/proc/meminfo") {
			if let Some(line) = data.lines().find(|l| l.starts_with("MemTotal:")) {
				mem_total = line.replace("MemTotal:", "").trim().to_string();
			}
		}
	}
	json!([
		format!("Directory:  {}", cwd),
		format!("OS:         {} {}", std::env::consts::OS, std::env::consts::ARCH),
		format!("Host:       {}", hostname()),
		format!("Memory:     {}", mem_total),
		format!("PID:        {}", std::process::id()),
		format!("Node (pi):  external agent process"),
	])
}

fn hostname() -> String {
	std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "unknown".into())
}

fn run_bash_rpc(g: &Global, command: &str) -> Value {
	if g.state.lock().unwrap().is_bash {
		flash(g, "A command is already running");
		return json!({"success": false, "error": "A command is already running"});
	}
	{
		let mut st = g.state.lock().unwrap();
		st.is_bash = true;
		st.request_start = Some(now_ms());
	}
	push_entry(g, json!({"kind": "tool", "text": command, "tag": "[RUN]", "isError": false}));
	push_state(g);
	let resp = rpc_request(g, json!({"type": "bash", "command": command}), 600_000);
	{
		let mut st = g.state.lock().unwrap();
		st.is_bash = false;
		st.request_start = None;
	}
	let g2 = g.app.lock().unwrap().clone().map(|a| a.state::<Arc<Global>>().inner().clone());
	if let Some(g2) = g2 {
		std::thread::spawn(move || poll_git(&g2));
	}
	let resp = match resp {
		Ok(r) => r,
		Err(e) => {
			push_entry(g, json!({"kind": "error", "text": e, "tag": "[ERROR]", "isError": true}));
			push_state(g);
			return json!({"success": false, "error": e});
		}
	};
	if resp["success"] == json!(true) {
		let exit_code = resp["data"]["exitCode"].as_i64().unwrap_or(-1);
		let ok = exit_code == 0;
		let output = resp["data"]["output"].as_str().unwrap_or("");
		let out_line = output.lines().map(str::trim_end).find(|l| !l.is_empty()).unwrap_or("");
		let out_line = if out_line.chars().count() > 120 {
			format!("{}â€¦", out_line.chars().take(119).collect::<String>())
		} else {
			out_line.to_string()
		};
		let text = if out_line.is_empty() {
			format!("exit {}", exit_code)
		} else {
			format!("exit {}: {}", exit_code, out_line)
		};
		push_entry(g, json!({"kind": if ok { "tool" } else { "error" }, "text": text, "tag": if ok { "[OK]" } else { "[ERROR]" }, "isError": !ok}));
		push_state(g);
		return resp;
	}
	let err = str_field(&resp, "error").unwrap_or_else(|| "command failed".into());
	push_entry(g, json!({"kind": "error", "text": err, "tag": "[ERROR]", "isError": true}));
	push_state(g);
	json!({"success": false, "error": err})
}

fn load_recent_session(g: &Global, name: &str) {
	let target = std::path::Path::new(&g.state.lock().unwrap().cwd).join(name);
	let target = target.to_string_lossy().to_string();
	if target.ends_with(".jsonl") && std::path::Path::new(&target).exists() {
		let parsed = match parse_jsonl_session(&target) {
			Ok(p) => p,
			Err(e) => {
				flash(g, &e);
				return;
			}
		};
		let resp = rpc_request(g, json!({"type": "switch_session", "sessionPath": target}), 15000).unwrap_or(json!({"success": false, "error": "PI DISCONNECTED"}));
		if resp["success"] == json!(true) {
			push_entry(g, json!({"kind": "__clear__", "text": ""}));
			if let Some(arr) = parsed["entries"].as_array() {
				for entry in arr {
					push_entry(g, entry.clone());
				}
			}
			let mut st = g.state.lock().unwrap();
			if let Some(m) = str_field(&parsed, "model") {
				st.model = Some(m);
			}
			if let Some(t) = str_field(&parsed, "thinkingLevel") {
				st.thinking_level = if t == "off" { None } else { Some(t) };
			}
			let base = str_field(&parsed, "title").unwrap_or_else(|| std::path::Path::new(&target).file_name().map(|f| f.to_string_lossy().to_uppercase()).unwrap_or_default());
			st.session_name = Some(base.clone());
			st.recent_sessions.insert(0, (base.clone(), target.clone()));
			st.recent_sessions.truncate(9);
			drop(st);
			flash(g, &format!("Session resumed: {}", base));
			poll_stats(g);
		} else {
			flash(g, &str_field(&resp, "error").unwrap_or_else(|| "Failed to switch session in Pi".into()));
		}
		push_state(g);
		return;
	}
	let path = std::path::Path::new(&target);
	if path.exists() && path.is_file() {
		match read_preview_file(&target, 5000) {
			None => flash(g, "Transcript is too large or unreadable"),
			Some(preview) => {
				let mut lines = preview["lines"].as_array().cloned().unwrap_or_default();
				if preview["truncated"] == json!(true) {
					lines.push(json!("... (truncated)"));
				}
				let label = path.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
				if let Some(app) = g.app.lock().unwrap().clone() {
					emit(&app, "push:textPopup", json!({"title": format!("Transcript: {}", label), "lines": lines}));
				}
				let st = g.state.lock().unwrap();
				let recent = st.recent_sessions.iter().any(|(_, p)| p == &target);
				drop(st);
				if !recent {
					let mut st = g.state.lock().unwrap();
					st.recent_sessions.insert(0, (label.clone(), target.clone()));
					st.recent_sessions.truncate(9);
				}
				flash(g, &format!("Transcript opened: {}", label));
			}
		}
	} else {
		flash(g, &format!("Session not found: {}", name));
	}
}

fn select_model(g: &Global, m: Value) -> Value {
	let id = str_field(&m, "id").unwrap_or_default();
	let provider = str_field(&m, "provider").unwrap_or_default();
	if id.is_empty() {
		return json!({"success": false, "error": "invalid model"});
	}
	let resp = rpc_request(g, json!({"type": "set_model", "provider": provider, "modelId": id, "model": id}), 15000).unwrap_or(json!({"success": false, "error": "PI DISCONNECTED"}));
	if resp["success"] == json!(true) {
		let full = format!("{}/{}", provider, id);
		g.state.lock().unwrap().model = Some(full.clone());
		flash(g, &format!("Model: {}", full));
		let g2 = g.app.lock().unwrap().clone().map(|a| a.state::<Arc<Global>>().inner().clone());
		if let Some(g2) = g2 {
			std::thread::spawn(move || poll_stats(&g2));
		}
	} else {
		let err = str_field(&resp, "error").unwrap_or_else(|| "?".into());
		flash(g, &format!("Set model failed: {}", err));
	}
	push_state(g);
	resp
}

fn sync_custom_model_reasoning(g: &Global, enabled: bool) {
	let model = g.state.lock().unwrap().model.clone();
	if let Some(model) = model {
		if let Some(idx) = model.find('/') {
			let (provider, id) = model.split_at(idx);
			if let Err(e) = set_custom_model_reasoning(provider, &id[1..], enabled) {
				push_entry(g, json!({"kind": "error", "text": format!("Could not update models.json reasoning flag: {}", e), "tag": "[ERROR]", "isError": true}));
			}
		}
	}
}

fn cycle_thinking(g: &Global) -> Value {
	let resp = rpc_request(g, json!({"type": "cycle_thinking_level"}), 15000).unwrap_or(json!({"success": false, "error": "PI DISCONNECTED"}));
	let cycled = resp["data"]["level"].as_str().and_then(|s| {
		let s = s.trim().to_lowercase();
		if ["off", "minimal", "low", "medium", "high", "xhigh"].contains(&s.as_str()) {
			Some(s)
		} else {
			None
		}
	});
	if resp["success"] == json!(true) {
		if let Some(level) = cycled {
			{
				let mut st = g.state.lock().unwrap();
				st.thinking_level = if level == "off" { None } else { Some(level.clone()) };
			}
			sync_custom_model_reasoning(g, level != "off");
			flash(g, &format!("Thinking level: {}", level));
			push_entry(g, json!({"kind": "info", "text": format!("Thinking level set to: {}", level)}));
			push_state(g);
			return json!({"success": true, "data": {"level": level}});
		}
	}
	let levels = ["low", "medium", "high", "off"];
	let current = g.state.lock().unwrap().thinking_level.clone();
	let idx = current.as_deref().and_then(|c| levels.iter().position(|l| *l == c)).map(|i| i as isize).unwrap_or(-1);
	let next = levels[((idx + 1) as usize) % levels.len()];
	let resp = rpc_request(g, json!({"type": "set_thinking_level", "level": next}), 15000).unwrap_or(json!({"success": false, "error": "PI DISCONNECTED"}));
	if resp["success"] == json!(true) {
		{
			let mut st = g.state.lock().unwrap();
			st.thinking_level = if next == "off" { None } else { Some(next.to_string()) };
		}
		sync_custom_model_reasoning(g, next != "off");
		flash(g, &format!("Thinking effort set to: {}", next));
		push_entry(g, json!({"kind": "info", "text": format!("Thinking effort set to: {}", next)}));
		push_state(g);
		json!({"success": true, "data": {"level": next}})
	} else {
		let err = str_field(&resp, "error").unwrap_or_else(|| "Failed to cycle thinking effort".into());
		flash(g, &err);
		json!({"success": false, "error": err})
	}
}

fn send_prompt(g: &Global, text: &str) {
	let full = if g.state.lock().unwrap().plan_mode {
		format!("[PLAN MODE: Focus on analysis, architecture and step-by-step design without modifying code yet]\n{}", text)
	} else {
		text.to_string()
	};
	push_entry(g, json!({"kind": "user", "text": text}));
	{
		let mut st = g.state.lock().unwrap();
		st.is_streaming = true;
		st.request_start = Some(now_ms());
	}
	let _ = rpc_send(g, json!({"type": "prompt", "message": full}));
	push_state(g);
}

fn first_real_line(output: &str) -> String {
	let line = output.lines().map(str::trim_end).find(|l| !l.is_empty()).unwrap_or("");
	if line.chars().count() > 120 {
		format!("{}â€¦", line.chars().take(119).collect::<String>())
	} else {
		line.to_string()
	}
}

fn add_recent_session(g: &Global, label: &str, path: &str) {
	if label.trim().is_empty() || path.trim().is_empty() {
		return;
	}
	let norm = path.to_lowercase();
	{
		let mut st = g.state.lock().unwrap();
		st.recent_sessions.retain(|(_, p)| p.to_lowercase() != norm);
		st.recent_sessions.insert(0, (label.to_string(), path.to_string()));
		st.recent_sessions.truncate(9);
	}
	push_state(g);
}

// ---------------------------------------------------------------------------
#[cfg(windows)]
use std::os::windows::process::CommandExt;

// Tauri commands
// ---------------------------------------------------------------------------

type CmdResult = Result<Value, String>;

fn ok_data(data: Value) -> CmdResult {
	Ok(json!({"success": true, "data": data}))
}

fn fail_msg(error: impl std::fmt::Display) -> CmdResult {
	Ok(json!({"success": false, "error": error.to_string()}))
}

#[tauri::command]
async fn luuna_boot(app: AppHandle, g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	let _ = &app;
	let pi_err = {
		match ensure_pi(&g) {
			Ok(()) => None,
			Err(e) => Some(e),
		}
	};
	let st = g.state.lock().unwrap();
	Ok(json!({
		"success": true,
		"data": {
			"version": "1.0.2",
			"piRunning": st.pi_alive,
			"piError": pi_err,
			"cwd": st.cwd,
			"model": st.model,
			"thinkingLevel": st.thinking_level,
			"planMode": st.plan_mode,
			"sessionName": effective_session_name(&st),
			"contextTokens": st.context_tokens,
			"gitInfo": st.git_info,
			"isStreaming": st.is_streaming,
			"isBash": st.is_bash,
			"requestStart": st.request_start,
			"statusMessage": st.status_message,
			"recentSessions": st.recent_sessions.iter().map(|(l, p)| json!({"label": l, "path": p})).collect::<Vec<_>>(),
		}
	}))
}

#[tauri::command]
async fn luuna_prompt(g: tauri::State<'_, Arc<Global>>, text: String) -> CmdResult {
	send_prompt(&g, &text);
	ok_data(json!(true))
}

#[tauri::command]
async fn luuna_abort(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	let (is_bash, is_streaming) = {
		let st = g.state.lock().unwrap();
		(st.is_bash, st.is_streaming)
	};
	if is_bash {
		let _ = rpc_send(&g, json!({"type": "abort_bash"}));
		{
			let mut st = g.state.lock().unwrap();
			st.is_bash = false;
			st.request_start = None;
		}
		flash(&g, "Command aborted");
	} else if is_streaming {
		let _ = rpc_send(&g, json!({"type": "abort"}));
		{
			let mut st = g.state.lock().unwrap();
			st.is_streaming = false;
			st.request_start = None;
		}
		flash(&g, "Abort requested");
	} else {
		flash(&g, "No operation in progress");
	}
	push_state(&g);
	ok_data(json!(true))
}

#[tauri::command]
async fn luuna_run_command(g: tauri::State<'_, Arc<Global>>, command: String) -> CmdResult {
	let resp = run_bash_rpc(&g, &command);
	if resp["success"] == json!(true) {
		ok_data(resp["data"].clone())
	} else {
		fail_msg(str_field(&resp, "error").unwrap_or_else(|| "command failed".into()))
	}
}

#[tauri::command]
async fn luuna_get_state(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	ok_data(state_snapshot(&g.state.lock().unwrap()))
}

#[tauri::command]
async fn luuna_get_stats(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	let resp = rpc_request(&g, json!({"type": "get_session_stats"}), 15000).unwrap_or(json!({"success": false, "error": "PI DISCONNECTED"}));
	if resp["success"] == json!(true) {
		ok_data(resp["data"].clone())
	} else {
		fail_msg(str_field(&&resp, "error").unwrap_or_else(|| "unavailable".into()))
	}
}

fn models_response(g: &Global) -> CmdResult {
	if let Some(cached) = g.state.lock().unwrap().models_cache.clone() {
		return ok_data(cached);
	}
	let resp = rpc_request(g, json!({"type": "get_available_models"}), 15000).unwrap_or(json!({"success": false, "error": "PI DISCONNECTED"}));
	if resp["success"] == json!(true) && !resp["data"]["models"].is_null() {
		let filtered = filter_enabled_models(resp["data"]["models"].clone());
		g.state.lock().unwrap().models_cache = Some(filtered.clone());
		ok_data(filtered)
	} else {
		fail_msg(str_field(&&resp, "error").unwrap_or_else(|| "Unable to list models".into()))
	}
}

#[tauri::command]
async fn luuna_get_models(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	models_response(&g)
}

#[tauri::command]
async fn luuna_reload_models(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	g.state.lock().unwrap().models_cache = None;
	let resp = rpc_request(&g, json!({"type": "get_available_models"}), 15000).unwrap_or(json!({"success": false, "error": "PI DISCONNECTED"}));
	if resp["success"] == json!(true) && !resp["data"]["models"].is_null() {
		let filtered = filter_enabled_models(resp["data"]["models"].clone());
		let count = filtered.as_array().map(|a| a.len()).unwrap_or(0);
		g.state.lock().unwrap().models_cache = Some(filtered.clone());
		flash(&g, &format!("Reloaded {} available models.", count));
		push_entry(&g, json!({"kind": "info", "text": format!("Reloaded {} available models from Pi.", count)}));
		ok_data(filtered)
	} else {
		fail_msg(str_field(&&resp, "error").unwrap_or_else(|| "Failed to reload models".into()))
	}
}

#[tauri::command]
async fn luuna_set_model(g: tauri::State<'_, Arc<Global>>, m: Value) -> CmdResult {
	let resp = select_model(&g, m);
	if resp["success"] == json!(true) {
		ok_data(json!(true))
	} else {
		fail_msg(str_field(&&resp, "error").unwrap_or_else(|| "set model failed".into()))
	}
}

#[tauri::command]
async fn luuna_cycle_model(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	let resp = rpc_request(&g, json!({"type": "cycle_model"}), 15000).unwrap_or(json!({"success": false, "error": "PI DISCONNECTED"}));
	if resp["success"] == json!(true) {
		if let (Some(p), Some(id)) = (str_field(&resp["data"]["model"], "provider"), str_field(&resp["data"]["model"], "id")) {
			let full = format!("{}/{}", p, id);
			g.state.lock().unwrap().model = Some(full.clone());
			flash(&g, &format!("Model: {}", full));
			push_state(&g);
			return ok_data(json!(full));
		}
	}
	fail_msg(str_field(&&resp, "error").unwrap_or_else(|| "Cycle model failed".into()))
}

#[tauri::command]
async fn luuna_set_thinking_level(g: tauri::State<'_, Arc<Global>>, level: String) -> CmdResult {
	let parsed = level.trim().to_lowercase();
	if !["off", "minimal", "low", "medium", "high", "xhigh"].contains(&parsed.as_str()) {
		return fail_msg("Invalid effort. Use: off, minimal, low, medium, high, xhigh");
	}
	let resp = rpc_request(&g, json!({"type": "set_thinking_level", "level": parsed}), 15000).unwrap_or(json!({"success": false, "error": "PI DISCONNECTED"}));
	if resp["success"] != json!(true) {
		return fail_msg(str_field(&&resp, "error").unwrap_or_else(|| "Failed to set thinking effort".into()));
	}
	{
		let mut st = g.state.lock().unwrap();
		st.thinking_level = if parsed == "off" { None } else { Some(parsed.clone()) };
	}
	sync_custom_model_reasoning(&g, parsed != "off");
	flash(&g, &format!("Thinking effort: {}", parsed));
	push_entry(&g, json!({"kind": "info", "text": format!("Thinking effort set to: {}", parsed)}));
	push_state(&g);
	ok_data(json!(parsed))
}

#[tauri::command]
async fn luuna_cycle_thinking_level(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	let resp = cycle_thinking(&g);
	if resp["success"] == json!(true) {
		ok_data(resp["data"].clone())
	} else {
		fail_msg(str_field(&&resp, "error").unwrap_or_else(|| "failed".into()))
	}
}

#[tauri::command]
async fn luuna_set_plan_mode(g: tauri::State<'_, Arc<Global>>, on: bool) -> CmdResult {
	{
		let mut st = g.state.lock().unwrap();
		st.plan_mode = on;
	}
	let label = if on { "PLAN (Planning & Architecture)" } else { "BUILD (Autonomous Execution)" };
	flash(&g, &format!("Mode: {}", label));
	push_entry(&g, json!({"kind": "info", "text": format!("Active mode changed to: {}", label)}));
	push_state(&g);
	ok_data(json!(on))
}

#[tauri::command]
async fn luuna_new_session(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	let resp = rpc_request(&g, json!({"type": "new_session"}), 15000).unwrap_or(json!({"success": false, "error": "PI DISCONNECTED"}));
	if resp["success"] == json!(true) {
		let name;
		{
			let mut st = g.state.lock().unwrap();
			st.session_counter += 1;
			st.session_name = None;
			name = effective_session_name(&st);
		}
		push_entry(&g, json!({"kind": "__clear__", "text": ""}));
		push_entry(&g, json!({"kind": "info", "text": format!("New session started ({}).", name)}));
		let g2 = g.app.lock().unwrap().clone().map(|a| a.state::<Arc<Global>>().inner().clone());
		if let Some(g2) = g2 {
			std::thread::spawn(move || poll_stats(&g2));
		}
		push_state(&g);
		ok_data(json!(true))
	} else {
		fail_msg(str_field(&&resp, "error").unwrap_or_else(|| "Failed to start new session".into()))
	}
}

#[tauri::command]
async fn luuna_set_session_name(g: tauri::State<'_, Arc<Global>>, name: String) -> CmdResult {
	g.state.lock().unwrap().session_name = Some(name.trim().to_string());
	push_state(&g);
	ok_data(json!(true))
}

#[tauri::command]
async fn luuna_compact(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	flash(&g, "Compacting context memory...");
	let resp = rpc_request(&g, json!({"type": "compact"}), 60000).unwrap_or(json!({"success": false, "error": "PI DISCONNECTED"}));
	if resp["success"] == json!(true) {
		let msg = match resp["data"]["tokensBefore"].as_u64() {
			Some(t) if t > 0 => format!("Context compacted (was {} tokens)", t),
			_ => "Context memory compacted.".to_string(),
		};
		flash(&g, &msg);
		push_entry(&g, json!({"kind": "info", "text": msg.clone()}));
		ok_data(json!(msg))
	} else {
		fail_msg(str_field(&&resp, "error").unwrap_or_else(|| "Compaction failed".into()))
	}
}

#[tauri::command]
async fn luuna_fork(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	let resp = rpc_request(&g, json!({"type": "get_fork_messages"}), 15000).unwrap_or(json!({"success": false, "error": "PI DISCONNECTED"}));
	let messages = resp["data"]["messages"].as_array().cloned().unwrap_or_default();
	if resp["success"] != json!(true) || messages.is_empty() {
		return fail_msg("No previous prompts available to fork");
	}
	let last = messages.last().unwrap();
	let entry_id = str_field(last, "entryId").unwrap_or_default();
	let fork = rpc_request(&g, json!({"type": "fork", "entryId": entry_id}), 15000).unwrap_or(json!({"success": false, "error": "PI DISCONNECTED"}));
	if fork["success"] == json!(true) {
		let preview: String = last["text"].as_str().unwrap_or("").chars().take(25).collect();
		flash(&g, &format!("Forked session branch from: \"{}...\"", preview));
		push_entry(&g, json!({"kind": "__clear__", "text": ""}));
		push_entry(&g, json!({"kind": "info", "text": "Forked into new branch."}));
		ok_data(json!(true))
	} else {
		fail_msg(str_field(&&fork, "error").unwrap_or_else(|| "Fork failed".into()))
	}
}

#[tauri::command]
async fn luuna_clone(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	let resp = rpc_request(&g, json!({"type": "clone"}), 15000).unwrap_or(json!({"success": false, "error": "PI DISCONNECTED"}));
	if resp["success"] == json!(true) {
		flash(&g, "Active branch cloned into new session");
		ok_data(json!(true))
	} else {
		fail_msg(str_field(&&resp, "error").unwrap_or_else(|| "Clone failed".into()))
	}
}

#[tauri::command]
async fn luuna_export_html(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	flash(&g, "Exporting session to HTML...");
	let resp = rpc_request(&g, json!({"type": "export_html"}), 60000).unwrap_or(json!({"success": false, "error": "PI DISCONNECTED"}));
	if resp["success"] == json!(true) {
		let path = str_field(&resp["data"], "path").unwrap_or_default();
		flash(&g, &format!("Exported to {}", path));
		push_entry(&g, json!({"kind": "info", "text": format!("Session exported to: {}", path)}));
		ok_data(json!(path))
	} else {
		fail_msg(str_field(&resp, "error").unwrap_or_else(|| "Failed to export session".into()))
	}
}

#[tauri::command]
async fn luuna_get_last_assistant_text(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	let resp = rpc_request(&g, json!({"type": "get_last_assistant_text"}), 15000).unwrap_or(json!({"success": false, "error": "PI DISCONNECTED"}));
	match str_field(&resp["data"], "text") {
		Some(text) if resp["success"] == json!(true) => ok_data(json!(text)),
		_ => fail_msg(str_field(&&resp, "error").unwrap_or_else(|| "No assistant messages in session.".into())),
	}
}

#[tauri::command]
async fn luuna_toggle_auto_compaction(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	let enabled = {
		let mut st = g.state.lock().unwrap();
		st.auto_compaction = !st.auto_compaction;
		st.auto_compaction
	};
	let _ = rpc_request(&g, json!({"type": "set_auto_compaction", "enabled": enabled}), 15000);
	flash(&g, &format!("Auto-compaction: {}", if enabled { "ENABLED" } else { "DISABLED" }));
	ok_data(json!(enabled))
}

#[tauri::command]
async fn luuna_toggle_auto_retry(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	let enabled = {
		let mut st = g.state.lock().unwrap();
		st.auto_retry = !st.auto_retry;
		st.auto_retry
	};
	let _ = rpc_request(&g, json!({"type": "set_auto_retry", "enabled": enabled}), 15000);
	flash(&g, &format!("Auto-retry on error: {}", if enabled { "ENABLED" } else { "DISABLED" }));
	ok_data(json!(enabled))
}

#[tauri::command]
async fn luuna_toggle_steering_mode(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	let mode = {
		let mut st = g.state.lock().unwrap();
		st.steering_mode = if st.steering_mode == "all" { "one-at-a-time".to_string() } else { "all".to_string() };
		st.steering_mode.clone()
	};
	let _ = rpc_request(&g, json!({"type": "set_steering_mode", "mode": mode}), 15000);
	flash(&g, &format!("Steering delivery mode: {}", mode));
	ok_data(json!(mode))
}

#[tauri::command]
async fn luuna_toggle_follow_up_mode(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	let mode = {
		let mut st = g.state.lock().unwrap();
		st.follow_up_mode = if st.follow_up_mode == "all" { "one-at-a-time".to_string() } else { "all".to_string() };
		st.follow_up_mode.clone()
	};
	let _ = rpc_request(&g, json!({"type": "set_follow_up_mode", "mode": mode}), 15000);
	flash(&g, &format!("Follow-up delivery mode: {}", mode));
	ok_data(json!(mode))
}

#[tauri::command]
async fn luuna_get_tree(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	let (cwd, dirty) = {
		let st = g.state.lock().unwrap();
		(st.cwd.clone(), st.git_info["dirtyFiles"].as_array().cloned().unwrap_or_default())
	};
	let dirty: Vec<String> = dirty.into_iter().filter_map(|v| v.as_str().map(String::from)).collect();
	let mut budget: u32 = 8000;
	ok_data(scan_tree(&cwd, "", 0, &mut budget, &dirty))
}

#[tauri::command]
async fn luuna_refresh_git(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	poll_git(&g);
	ok_data(g.state.lock().unwrap().git_info.clone())
}

#[tauri::command]
async fn luuna_read_preview(g: tauri::State<'_, Arc<Global>>, file_path: String) -> CmdResult {
	match read_preview_file(&file_path, 500) {
		Some(p) => ok_data(p),
		None => fail_msg("binary or unreadable file"),
	}
}

#[tauri::command]
async fn luuna_git_diff(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	let cwd = g.state.lock().unwrap().cwd.clone();
	match exec_line("git", &["diff"], &cwd) {
		Some(d) => ok_data(json!(d)),
		None => fail_msg("Not a git repository or git unavailable"),
	}
}

#[tauri::command]
async fn luuna_git_status(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	poll_git(&g);
	let info = g.state.lock().unwrap().git_info.clone();
	let mut lines: Vec<Value> = Vec::new();
	if info["isRepo"] != json!(true) {
		lines.push(json!("Not a git repository."));
	} else {
		lines.push(json!(format!("Branch: {}", info["branch"].as_str().unwrap_or("?"))));
		lines.push(json!(""));
		let files = info["dirtyFiles"].as_array().cloned().unwrap_or_default();
		if files.is_empty() {
			lines.push(json!("Working tree clean."));
		} else {
			lines.push(json!(format!("Changed files ({}):", files.len())));
			for f in files.iter().take(40) {
				lines.push(json!(format!("  M {}", f.as_str().unwrap_or(""))));
			}
			if files.len() > 40 {
				lines.push(json!(format!("  ... and {} more", files.len() - 40)));
			}
		}
	}
	ok_data(json!(lines))
}

#[tauri::command]
async fn luuna_git_log(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	let cwd = g.state.lock().unwrap().cwd.clone();
	let out = exec_line("git", &["log", "--oneline", "-30", "--date=short", "--pretty=format:%h %ad %s"], &cwd).unwrap_or_default();
	let lines: Vec<Value> = out.lines().map(|l| json!(l)).collect();
	ok_data(json!(lines))
}

#[tauri::command]
async fn luuna_git_grep(g: tauri::State<'_, Arc<Global>>, query: String) -> CmdResult {
	let cwd = g.state.lock().unwrap().cwd.clone();
	match exec_line("git", &["grep", "-n", &query], &cwd) {
		Some(out) => ok_data(json!(out.lines().map(|l| json!(l)).collect::<Vec<_>>())),
		None => fail_msg("No matches or not a git repository"),
	}
}

#[tauri::command]
async fn luuna_save_session_file(g: tauri::State<'_, Arc<Global>>, filename: String, content: String) -> CmdResult {
	let target = std::path::Path::new(&g.state.lock().unwrap().cwd).join(&filename);
	match std::fs::write(&target, content) {
		Ok(()) => {
			let label = target.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
			let full = target.to_string_lossy().to_string();
			add_recent_session(&g, &label, &full);
			flash(&g, &format!("Session saved to {}", label));
			push_entry(&g, json!({"kind": "info", "text": format!("Session saved: {}", full)}));
			ok_data(json!(full))
		}
		Err(e) => fail_msg(e),
	}
}

#[tauri::command]
async fn luuna_change_directory(g: tauri::State<'_, Arc<Global>>, new_dir: String) -> CmdResult {
	if g.state.lock().unwrap().is_streaming || g.state.lock().unwrap().is_bash {
		return fail_msg("Finish or abort the active operation before changing directory");
	}
	let cleaned = new_dir.trim_start_matches(r"\\?\");
	let target = std::fs::canonicalize(cleaned).map(|p| p.to_string_lossy().trim_start_matches(r"\\?\").to_string()).map_err(|_| format!("Invalid directory: {}", new_dir))?;
	if !std::path::Path::new(&target).is_dir() {
		return fail_msg(format!("Invalid directory: {}", target));
	}
	if target == g.state.lock().unwrap().cwd {
		return ok_data(json!({"unchanged": true, "cwd": target}));
	}
	flash(&g, &format!("Connecting Pi in {}...", target));
	// Start a candidate client by swapping the current one out temporarily.
	let candidate = match spawn_pi(&target) {
		Ok(c) => c,
		Err(e) => {
			push_entry(&g, json!({"kind": "error", "text": format!("Change directory failed: {}", e), "tag": "[ERROR]", "isError": true}));
			return fail_msg(e);
		}
	};
	let old = g.pi.lock().unwrap().replace(candidate);
	if let Some(mut old) = old {
		old.stdin = None;
		let _ = old.child.kill();
	}
	// Restart reader machinery on the new process: simplest reliable path is
	// to restart the whole client state (reader thread watches pi_alive).
	{
		let mut st = g.state.lock().unwrap();
		st.cwd = target.clone();
		st.pi_alive = true;
		st.pi_started = false;
		st.models_cache = None;
		st.recent_sessions.clear();
		st.context_tokens = None;
		st.is_streaming = false;
		st.is_bash = false;
		st.request_start = None;
	}
	// The old reader thread terminated with the old process; spawn a fresh one.
	restart_reader(&g);
	match ensure_pi(&g) {
		Ok(()) => {
			push_entry(&g, json!({"kind": "__clear__", "text": ""}));
			let st = g.state.lock().unwrap();
			let msg = format!("Connected in {}. Session: {}", target, "(new)");
			drop(st);
			push_entry(&g, json!({"kind": "info", "text": msg.clone()}));
			flash(&g, &format!("Working directory: {}", target));
			ok_data(json!({"cwd": target}))
		}
		Err(e) => {
			push_entry(&g, json!({"kind": "error", "text": format!("Change directory failed: {}", e), "tag": "[ERROR]", "isError": true}));
			fail_msg(e)
		}
	}
}

fn restart_reader(g: &Global) {
	if let Some(app) = g.app.lock().unwrap().clone() {
		let g2 = app.state::<Arc<Global>>().inner().clone();
		let pending = g.pending.clone();
		let stdout = g.pi.lock().unwrap().as_mut().and_then(|pi| pi.child.stdout.take());
		if let Some(stdout) = stdout {
			std::thread::spawn(move || {
				let reader = BufReader::new(stdout);
				for line in reader.lines() {
					match line {
						Ok(l) => {
							let msg: Value = match serde_json::from_str(l.trim()) {
								Ok(v) => v,
								Err(_) => continue,
							};
							if msg["type"] == json!("response") {
								if let Some(id) = str_field(&msg, "id") {
									let tx = pending.lock().unwrap().remove(&id);
									if let Some(tx) = tx {
										let _ = tx.send(msg);
										continue;
									}
								}
							} else {
								handle_rpc_event(&g2, msg);
							}
						}
						Err(_) => break,
					}
				}
			});
		}
	}
}

#[tauri::command]
async fn luuna_get_sessions(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	let cwd = g.state.lock().unwrap().cwd.clone();
	match get_project_sessions(&cwd) {
		Ok(v) => ok_data(v),
		Err(e) => fail_msg(e),
	}
}

#[tauri::command]
async fn luuna_open_session(g: tauri::State<'_, Arc<Global>>, p: String) -> CmdResult {
	load_recent_session(&g, &p);
	ok_data(json!(true))
}

#[tauri::command]
async fn luuna_get_providers(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	let cwd = g.state.lock().unwrap().cwd.clone();
	let providers = [
		("openrouter", "OpenRouter (All Models)", "OPENROUTER_API_KEY", "100+ models: Claude, GPT, DeepSeek, Llama, Qwen"),
		("opencode", "OpenCode (MiMo, etc.)", "OPENCODE_API_KEY", "OpenCode AI platform and MiMo-V2.5 models"),
		("deepseek", "DeepSeek (V3 / R1)", "DEEPSEEK_API_KEY", "DeepSeek V3 (chat) and DeepSeek R1 (reasoner)"),
		("gemini", "Google Gemini", "GEMINI_API_KEY", "Gemini 2.5 Pro, 2.5 Flash, 2.0 Flash Thinking"),
		("anthropic", "Anthropic Claude", "ANTHROPIC_API_KEY", "Claude 3.7 Sonnet, 3.5 Sonnet, 3.5 Haiku"),
		("openai", "OpenAI", "OPENAI_API_KEY", "GPT-4o, GPT-4o-mini, o3-mini, o1"),
		("groq", "Groq", "GROQ_API_KEY", "Ultra-fast inference for Llama 3.3, Mixtral"),
		("mistral", "Mistral AI", "MISTRAL_API_KEY", "Mistral Large, Codestral"),
		("xai", "xAI Grok", "XAI_API_KEY", "Grok-beta, Grok-2"),
		("together", "Together AI", "TOGETHER_API_KEY", "Fast open source models hosting"),
	];
	let list: Vec<Value> = providers
		.iter()
		.map(|(id, name, env_var, desc)| {
			let key = read_env_key(&cwd, env_var);
			json!({"id": id, "name": name, "envVar": env_var, "description": desc, "masked": mask_api_key(&key)})
		})
		.collect();
	ok_data(json!(list))
}

#[tauri::command]
async fn luuna_write_env_key(g: tauri::State<'_, Arc<Global>>, env_var: String, value: String) -> CmdResult {
	if !env_var.chars().next().map(|c| c.is_ascii_alphabetic() || c == '_').unwrap_or(false) || !env_var.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
		return fail_msg(format!("Invalid environment variable name: {}", env_var));
	}
	if value.contains('\r') || value.contains('\n') {
		return fail_msg("API key must be a single line");
	}
	let cwd = g.state.lock().unwrap().cwd.clone();
	let local = std::path::Path::new(&cwd).join(".env");
	let content = std::fs::read_to_string(&local).unwrap_or_default();
	let mut lines: Vec<String> = if content.is_empty() { Vec::new() } else { content.lines().map(String::from).collect() };
	let mut found = false;
	for line in lines.iter_mut() {
		let trimmed = line.trim();
		if !trimmed.starts_with('#') && trimmed.contains('=') {
			let k = trimmed.split('=').next().unwrap_or("").trim();
			if k == env_var {
				*line = format!("{}={}", env_var, value.trim());
				found = true;
			}
		}
	}
	if !found {
		if let Some(last) = lines.last() {
			if !last.trim().is_empty() {
				lines.push(String::new());
			}
		}
		lines.push(format!("{}={}", env_var, value.trim()));
	}
	match atomic_write(&local, &format!("{}\n", lines.join("\n").trim())) {
		Ok(()) => {
			std::env::set_var(&env_var, value.trim());
			g.state.lock().unwrap().models_cache = None;
			flash(&g, &format!("Saved {}. Models updated.", env_var));
			push_entry(&g, json!({"kind": "info", "text": format!("Updated {} in .env", env_var)}));
			ok_data(json!(true))
		}
		Err(e) => fail_msg(e),
	}
}

#[tauri::command]
async fn luuna_add_custom_model(g: tauri::State<'_, Arc<Global>>, m: Value) -> CmdResult {
	let provider = str_field(&m, "provider").unwrap_or_default();
	let id = str_field(&m, "id").unwrap_or_default();
	let name = str_field(&m, "name").unwrap_or_default();
	let reasoning = m["reasoning"] == json!(true);
	match save_custom_model(&provider, &id, if name.is_empty() { &id } else { &name }, reasoning) {
		Ok(()) => {
			g.state.lock().unwrap().models_cache = None;
			flash(&g, &format!("Custom model {}/{} saved.", provider, id));
			push_entry(&g, json!({"kind": "info", "text": format!("Registered custom model: {}/{}", provider, id)}));
			ok_data(json!(true))
		}
		Err(e) => fail_msg(e),
	}
}

#[tauri::command]
async fn luuna_system_info(g: tauri::State<'_, Arc<Global>>) -> CmdResult {
	let cwd = g.state.lock().unwrap().cwd.clone();
	ok_data(get_system_info_lines(&cwd))
}

#[tauri::command]
async fn luuna_copy_to_clipboard(g: tauri::State<'_, Arc<Global>>, text: String) -> CmdResult {
	let len = text.len();
	#[cfg(windows)]
	{
		if let Ok(mut child) = Command::new("clip").stdin(Stdio::piped()).spawn() {
			if let Some(stdin) = child.stdin.as_mut() {
				let _ = stdin.write_all(text.as_bytes());
			}
		}
	}
	#[cfg(target_os = "macos")]
	{
		if let Ok(mut child) = Command::new("pbcopy").stdin(Stdio::piped()).spawn() {
			if let Some(stdin) = child.stdin.as_mut() {
				let _ = stdin.write_all(text.as_bytes());
			}
		}
	}
	flash(&g, &format!("Copied {} chars to clipboard", len));
	ok_data(json!(true))
}

#[tauri::command]
async fn luuna_show_in_folder(p: String) -> CmdResult {
	#[cfg(windows)]
	{
		let _ = Command::new("explorer").arg(format!("/select,{}", p)).spawn();
	}
	#[cfg(target_os = "macos")]
	{
		let _ = Command::new("open").args(["-R", &p]).spawn();
	}
	ok_data(json!(true))
}

#[tauri::command]
async fn luuna_save_dialog(default_name: String) -> CmdResult {
	let file = rfd::FileDialog::new()
		.set_title("Save Session As")
		.set_file_name(&default_name)
		.add_filter("Markdown transcript", &["md", "txt"])
		.save_file();
	match file {
		Some(p) => ok_data(json!(p.to_string_lossy().to_string())),
		None => ok_data(json!({"canceled": true})),
	}
}

#[tauri::command]
async fn luuna_open_dir_dialog() -> CmdResult {
	let dir = rfd::FileDialog::new().set_title("Change Directory").pick_folder();
	match dir {
		Some(p) => ok_data(json!(p.to_string_lossy().to_string())),
		None => ok_data(json!({"canceled": true})),
	}
}

#[tauri::command]
async fn luuna_context_menu() -> CmdResult {
	// Native popup menus are provided per-platform by the OS shell in Tauri;
	// the browser context menu is suppressed by the renderer instead.
	ok_data(json!(true))
}

#[tauri::command]
async fn luuna_exit(app: AppHandle) -> CmdResult {
	app.exit(0);
	ok_data(json!(true))
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

fn main() {
	let global = Arc::new(Global {
		state: Mutex::new(AppState::default()),
		pi: Mutex::new(None),
		pending: Arc::new(Mutex::new(HashMap::new())),
		next_id: AtomicU64::new(1),
		app: Mutex::new(None),
		boot_once: Mutex::new(()),
	});

	tauri::Builder::default()
		.manage(global.clone())
		.on_page_load(move |window, _payload| {
			// The renderer resubscribes on every page load: flush buffered
			// entries and push fresh state.
			let g2 = window.app_handle().state::<Arc<Global>>().inner().clone();
			flush_entry_buffer(&g2);
		})
		.setup(move |app| {
			*global.app.lock().unwrap() = Some(app.handle().clone());
			Ok(())
		})
		.on_window_event(|window, event| {
			if let tauri::WindowEvent::Destroyed = event {
				let g = window.app_handle().state::<Arc<Global>>();
				kill_pi(&g);
			}
		})
		.invoke_handler(tauri::generate_handler![
			luuna_boot, luuna_prompt, luuna_abort, luuna_run_command, luuna_get_state, luuna_get_stats,
			luuna_get_models, luuna_reload_models, luuna_set_model, luuna_cycle_model,
			luuna_set_thinking_level, luuna_cycle_thinking_level, luuna_set_plan_mode,
			luuna_new_session, luuna_set_session_name, luuna_compact, luuna_fork, luuna_clone,
			luuna_export_html, luuna_get_last_assistant_text, luuna_toggle_auto_compaction,
			luuna_toggle_auto_retry, luuna_toggle_steering_mode, luuna_toggle_follow_up_mode,
			luuna_get_tree, luuna_refresh_git, luuna_read_preview, luuna_git_diff, luuna_git_status,
			luuna_git_log, luuna_git_grep, luuna_save_session_file, luuna_change_directory,
			luuna_get_sessions, luuna_open_session, luuna_get_providers, luuna_write_env_key,
			luuna_add_custom_model, luuna_system_info, luuna_copy_to_clipboard, luuna_show_in_folder,
			luuna_save_dialog, luuna_open_dir_dialog, luuna_context_menu, luuna_exit,
		])
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}
