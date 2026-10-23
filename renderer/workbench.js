/* Standalone component views. Every durable record comes from the native CLI adapter. */
(function () {
	"use strict";
	let root, body, notice, projectLabel, previousFocus, observedCwd;
	let generation = 0, project = null, current = "tickets", busy = false, active = false;
	let uncertain = false;
	let rows = [], filter = "", archived = false, memoryFilters = { query: "", domain: "", kind: "", classification: "" };
	const labels = { tickets: "Kanban board", prompts: "Prompt library", memory: "Expertise memory" };
	const memoryFields = { convention: ["content"], pattern: ["name", "description"], failure: ["description", "resolution"], decision: ["title", "rationale"] };
	function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }
	function button(text, fn, id) { const b = el("button", text); b.type = "button"; if (id) b.id = id; b.addEventListener("click", () => { if (!busy) fn(); }); return b; }
	function message(text, error) { notice.textContent = text; notice.className = error ? "wb-notice wb-error" : "wb-notice"; }
	function setBusy(value) { busy = value; root.setAttribute("aria-busy", String(value)); root.querySelectorAll("button,input,select,textarea").forEach(n => { n.disabled = value || n.dataset.readonly === "true" || (uncertain && !["wb-refresh", "wb-close"].includes(n.id)); }); }
	function field(form, name, label, value, options) {
		const wrap = el("label", label, "wb-field"); let input;
		if (Array.isArray(options)) { input = el("select"); options.forEach(item => { const pair = Array.isArray(item) ? item : [item, item]; const option = el("option", pair[1]); option.value = pair[0]; input.appendChild(option); }); }
		else input = el(options === "large" ? "textarea" : "input");
		input.name = name; input.id = `wb-${name}`; input.value = value == null ? "" : String(value); wrap.appendChild(input); form.appendChild(wrap); return input;
	}
	function form(title) { body.replaceChildren(); const f = el("form", null, "wb-form"); f.appendChild(el("h2", title)); f.addEventListener("submit", e => e.preventDefault()); body.appendChild(f); return f; }
	function values(f) { const result = {}; f.querySelectorAll("[name]").forEach(n => result[n.name] = n.value); return result; }
	async function run(fn) {
		if (busy) return;
		const epoch = generation, priorFocus = document.activeElement; setBusy(true); message("Working…");
		try { await fn(); if (epoch === generation && active) message("Ready. Context stays here until you choose Insert into message."); }
		catch (e) { if (epoch === generation && active) { uncertain = /outcome may be uncertain/.test(e.message || ""); message(e.message || String(e), true); } }
		finally {
			if (epoch === generation && active) {
				setBusy(false);
				if (!root.contains(document.activeElement) || document.activeElement.disabled) {
					const target = priorFocus && priorFocus.isConnected && root.contains(priorFocus) && !priorFocus.disabled ? priorFocus : root.querySelector("button:not(:disabled)");
					if (target) target.focus();
				}
			}
		}
	}
	async function action(payload) {
		const epoch = generation, key = project.projectKey;
		const response = await luuna.workbenchAction(key, payload);
		if (epoch !== generation || !active || key !== project.projectKey) throw new Error("Project changed; discarded the previous project's result.");
		if (!response.success) throw new Error(response.error);
		if (response.data.projectKey !== key) throw new Error("Project changed; refresh the workbench.");
		return response.data.result;
	}
	function close() { generation++; active = false; busy = false; if (root) root.hidden = true; if (previousFocus && previousFocus.isConnected) previousFocus.focus(); }
	function insert(source, text) {
		const draft = document.getElementById("input-textarea");
		draft.value += `${draft.value ? "\n\n" : ""}[${source}]\n${text}`;
		draft.dispatchEvent(new Event("input", { bubbles: true })); close(); draft.focus();
	}
	function preview(parent, title, text) { parent.appendChild(el("h3", title)); parent.appendChild(el("pre", text, "wb-preview")); }
	function sectionsText(sections) { return (sections || []).map(s => `## ${s.name}\n${s.body || ""}`).join("\n\n"); }
	function mount() {
		if (root) return;
		root = el("section", null, "wb-window"); root.id = "workbench"; root.hidden = true; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Project component workbench");
		const heading = el("header"); heading.appendChild(el("strong", "WORKBENCH • STANDALONE PROJECT TOOLS")); heading.appendChild(button("Close [Esc]", close, "wb-close")); root.appendChild(heading);
		projectLabel = el("div", "", "wb-project"); root.appendChild(projectLabel);
		const nav = el("nav"); Object.keys(labels).forEach(view => nav.appendChild(button(labels[view], () => { current = view; filter = ""; void run(load); }, `wb-nav-${view}`))); nav.appendChild(button("Refresh", () => void run(refresh), "wb-refresh")); root.appendChild(nav);
		notice = el("div", "", "wb-notice"); notice.setAttribute("role", "status"); root.appendChild(notice);
		body = el("div", null, "wb-body"); root.appendChild(body); document.body.appendChild(root);
		root.addEventListener("keydown", e => {
			if (e.key === "Escape") { e.preventDefault(); close(); }
			if (e.key === "Tab") { const items = Array.from(root.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)")); const first = items[0], last = items[items.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
			e.stopPropagation();
		});
	}
	async function refresh() {
		uncertain = false;
		const epoch = generation;
		const response = await luuna.workbenchStatus();
		if (epoch !== generation || !active) return;
		if (!response.success) throw new Error(response.error);
		project = response.data; projectLabel.textContent = project.project;
		if (!project.initialized) {
			body.replaceChildren(el("h2", "Your project's private workbench"), el("p", "Create a separate LUUNA-AI workspace for tickets, prompts and expertise. Existing project and Luuna runtime stores are never imported or changed."));
			body.appendChild(el("p", "Prerequisites: Bun 1.4.3 and pinned sources. Run npm run components:setup in the LUUNA-AI checkout. Installed apps can set LUUNA_AI_COMPONENTS_ROOT to that checkout's .tools directory."));
			if (project.toolError) body.appendChild(el("p", project.toolError, "wb-error"));
			body.appendChild(button(project.partial ? "Retry initialization" : "Initialize private workspace", () => void run(async () => { const r = await luuna.workbenchInitialize(project.projectKey); if (!r.success) throw new Error(r.error); project = r.data; await load(); }), "wb-initialize")); return;
		}
		await load();
	}
	async function load() {
		if (!project || !project.initialized) { await refresh(); return; }
		body.replaceChildren();
		root.querySelectorAll("nav button").forEach(b => b.classList.toggle("selected", b.id === `wb-nav-${current}`));
		if (current === "tickets") { const data = await action({ op: "tickets" }); rows = data.issues; board(); }
		else if (current === "prompts") { const data = await action({ op: "prompts", archived }); rows = data.prompts; prompts(); }
		else { const data = await action({ op: "memory", ...memoryFilters, kind: memoryFilters.kind || null }); rows = data.records; memory(); }
	}
	function toolbar(newText, newFn) { const bar = el("div", null, "wb-toolbar"); bar.appendChild(el("h2", labels[current])); bar.appendChild(button(newText, newFn, "wb-new")); body.appendChild(bar); return bar; }
	function board() {
		body.replaceChildren(); toolbar("New ticket", () => ticketForm());
		const grid = el("div", null, "wb-board"); body.appendChild(grid);
		[["open", "Open"], ["in_progress", "In progress"], ["closed", "Closed"]].forEach(([status, title]) => {
			const column = el("section", null, "wb-column"); column.dataset.status = status; column.appendChild(el("h3", `${title} (${rows.filter(r => r.status === status).length})`)); grid.appendChild(column);
			rows.filter(r => r.status === status).forEach(r => {
				const card = el("article", null, "wb-card"); card.dataset.id = r.id;
				card.appendChild(button(r.title, () => ticketForm(r), "ticket-" + r.id));
				const shortId = r.id.length > 24 ? `${r.id.slice(0, 8)}…${r.id.slice(-8)}` : r.id;
				const metadata = el("small", `${shortId} · P${r.priority} · ${r.type}`);
				metadata.title = r.id; metadata.setAttribute("aria-label", `${r.id}, priority ${r.priority}, ${r.type}`); card.appendChild(metadata);
				const blocked = (r.blockedBy || []).filter(id => !rows.some(t => t.id === id && t.status === "closed"));
				if (blocked.length) card.appendChild(el("p", "Blocked by " + blocked.join(", "), "wb-blocked"));
				if (r.assignee) card.appendChild(el("p", "Assigned: " + r.assignee));
				const move = el("div", null, "wb-actions"); [["open", "Open"], ["in_progress", "Start"], ["closed", "Close"]].filter(([s]) => s !== status).forEach(([s, text]) => { const b = button(text, () => void run(async () => { await action({ op: "moveTicket", id: r.id, status: s }); await load(); })); b.dataset.move = s; move.appendChild(b); }); card.appendChild(move); column.appendChild(card);
			});
			if (!rows.some(r => r.status === status)) column.appendChild(el("p", "No tickets.", "wb-empty"));
		});
	}
	function ticketForm(r) {
		const f = form(r ? `Ticket ${r.id}` : "New ticket");
		field(f, "title", "Title", r && r.title); field(f, "description", "Description", r && r.description, "large");
		field(f, "kind", "Type", r ? r.type : "task", ["task", "bug", "feature", "epic"]); field(f, "priority", "Priority (0 highest → 4 lowest)", r ? r.priority : 2, ["0", "1", "2", "3", "4"]);
		field(f, "assignee", "Assignee", r && r.assignee); field(f, "labels", "Labels (comma-separated)", r && (r.labels || []).join(","));
		const buttons = el("div", null, "wb-actions"); f.appendChild(buttons);
		buttons.appendChild(button("Save ticket", () => void run(async () => { const v = values(f); delete v.dependency; await action({ op: "saveTicket", id: r ? r.id : null, ...v, priority: Number(v.priority) }); await load(); }), "wb-save")); buttons.appendChild(button("Back", board));
		if (r) {
			f.appendChild(el("p", `${r.status} · Created ${r.createdAt} · Updated ${r.updatedAt}`));
			buttons.appendChild(button("Insert into message", () => insert(`Missions ${r.id}`, `${r.title}\nStatus: ${r.status}; priority ${r.priority}\n${r.description || ""}`), "wb-insert"));
			f.appendChild(el("h3", "Dependencies"));
			(r.blockedBy || []).forEach(id => { const row = el("div", id + " ", "wb-actions"); row.appendChild(button("Remove dependency", () => void run(async () => { await action({ op: "dependency", id: r.id, dependency: id, remove: true }); await load(); }))); f.appendChild(row); });
			const input = field(f, "dependency", "Dependency ticket ID", "");
			f.appendChild(button("Add dependency", () => void run(async () => { await action({ op: "dependency", id: r.id, dependency: input.value, remove: false }); await load(); }), "wb-add-dependency"));
		}
	}
	function prompts() {
		body.replaceChildren(); const bar = toolbar("New prompt", () => promptForm());
		const search = field(bar, "filter", "Search", filter); search.addEventListener("input", () => { filter = search.value; draw(); });
		bar.appendChild(button(archived ? "Show current" : "Show archived", () => { archived = !archived; void run(load); }, "wb-archive-filter"));
		const list = el("div", null, "wb-list"); body.appendChild(list);
		function draw() { list.replaceChildren(); rows.filter(r => `${r.name} ${r.description || ""} ${(r.tags || []).join(" ")}`.toLowerCase().includes(filter.toLowerCase())).forEach(r => { const card = el("article", null, "wb-card"); card.appendChild(button(r.name, () => void run(() => promptDetail(r.name)))); card.appendChild(el("small", `v${r.version} · ${r.status} · ${(r.tags || []).join(", ")}`)); card.appendChild(el("p", r.description || "")); list.appendChild(card); }); if (!list.children.length) list.appendChild(el("p", "No matching prompts. Create one to begin.")); }
		draw();
	}
	async function promptDetail(name, version) {
		const data = await action({ op: "prompt", name, version: version || null }), p = data.source.prompt;
		body.replaceChildren(); const bar = el("div", null, "wb-toolbar"); body.appendChild(bar); bar.appendChild(el("h2", `${p.name} · v${p.version}${version ? " · historical source" : ""}`));
		bar.appendChild(button("Back", prompts));
		if (!version) {
			bar.appendChild(button("Edit prompt", () => promptForm(p), "wb-edit"));
			bar.appendChild(button(p.status === "archived" ? "Restore prompt" : "Archive prompt", () => void run(async () => { await action({ op: "archivePrompt", name, expected_version: p.version, restore: p.status === "archived" }); await load(); }), "wb-archive"));
			bar.appendChild(button("Insert into message", () => insert(`Beacon ${p.name}@${p.version}`, sectionsText(data.render.sections)), "wb-insert"));
			preview(body, "Current rendered composition", sectionsText(data.render.sections));
			body.appendChild(el("p", "Resolved from: " + JSON.stringify(data.render.resolvedFrom || [])));
		}
		preview(body, version ? "Historical source (not a historical render)" : "Prompt source", sectionsText(p.sections));
		body.appendChild(el("p", `Created ${p.createdAt} · Updated ${p.updatedAt}`));
		const versions = el("div", null, "wb-actions"); versions.id = "wb-history"; versions.appendChild(el("strong", "Source history:"));
		(data.history.versions || []).forEach(v => versions.appendChild(button(`v${v.version}`, () => void run(() => promptDetail(name, v.version))))); body.appendChild(versions);
	}
	function promptForm(p) {
		const f = form(p ? `Edit ${p.name}@${p.version}` : "New prompt");
		const name = field(f, "name", "Name (letters, digits, hyphens, underscores)", p && p.name); if (p) { name.disabled = true; name.dataset.readonly = "true"; }
		field(f, "description", "Description", p && p.description);
		const sections = p && p.sections && p.sections.length ? p.sections : [{ name: "purpose", body: "" }];
		const select = field(f, "section", "Section (only this section changes)", sections[0].name, sections.map(s => s.name));
		const text = field(f, "body", "Section body", sections[0].body, "large"); select.addEventListener("change", () => { text.value = sections.find(s => s.name === select.value).body; });
		field(f, "tags", "Tags (comma-separated identifiers)", p && (p.tags || []).join(","));
		const buttons = el("div", null, "wb-actions"); f.appendChild(buttons);
		buttons.appendChild(button("Save prompt", () => void run(async () => { const v = values(f); await action({ op: "savePrompt", ...v, tags: v.tags.split(",").map(s => s.trim()).filter(Boolean), expected_version: p ? p.version : null }); await load(); await promptDetail(v.name); }), "wb-save")); buttons.appendChild(button("Back", prompts));
	}
	function memory() {
		body.replaceChildren(); const bar = toolbar("New expertise", () => memoryForm());
		field(bar, "query", "Search text", memoryFilters.query); field(bar, "domain", "Domain filter", memoryFilters.domain);
		field(bar, "kind", "Type", memoryFilters.kind, [["", "All types"], ...Object.keys(memoryFields)]); field(bar, "classification", "Classification", memoryFilters.classification, [["", "All classifications"], "foundational", "tactical", "observational"]);
		bar.appendChild(button("Search expertise", () => { memoryFilters = values(bar); void run(load); }, "wb-search"));
		const list = el("div", null, "wb-list"); body.appendChild(list);
		rows.forEach(r => { const card = el("article", null, "wb-card"); card.appendChild(button(r.title || r.name || r.content || r.description, () => memoryForm(r))); card.appendChild(el("small", `${r.domain} · ${r.type} · ${r.classification} · ${r.id}`)); card.appendChild(el("p", (r.tags || []).join(", "))); list.appendChild(card); });
		if (!rows.length) list.appendChild(el("p", "No matching expertise. Capture a convention, pattern, failure or decision."));
	}
	function memoryForm(r) {
		const f = form(r ? `Expertise ${r.id}` : "Capture expertise");
		const domain = field(f, "domain", "Domain", r ? r.domain : "project"); const kind = field(f, "kind", "Type", r ? r.type : "convention", Object.keys(memoryFields));
		if (r) [domain, kind].forEach(n => { n.disabled = true; n.dataset.readonly = "true"; });
		field(f, "classification", "Classification", r ? r.classification : "tactical", ["foundational", "tactical", "observational"]);
		const fields = el("div"); f.appendChild(fields);
		function draw() { fields.replaceChildren(); memoryFields[kind.value].forEach(key => field(fields, key, key[0].toUpperCase() + key.slice(1), r && r[key], "large")); }
		kind.addEventListener("change", draw); draw();
		const tags = field(f, "tags", "Provenance / tags (comma-separated, creation only)", r ? (r.tags || []).join(",") : "source:luuna-ai"); if (r) { tags.disabled = true; tags.dataset.readonly = "true"; }
		const buttons = el("div", null, "wb-actions"); f.appendChild(buttons);
		buttons.appendChild(button("Save expertise", () => void run(async () => { const v = values(f); await action({ op: "saveMemory", domain: v.domain, id: r ? r.id : null, kind: v.kind, classification: v.classification, fields: values(fields), tags: v.tags }); await load(); }), "wb-save")); buttons.appendChild(button("Back", memory));
		if (r) {
			f.appendChild(el("p", `Recorded ${r.recorded_at || "unknown"} · Updated ${r.updated_at || r.recorded_at || "unknown"} · Tags ${(r.tags || []).join(", ")}`));
			buttons.appendChild(button("Insert into message", () => insert(`Atlas ${r.domain}/${r.id} · ${r.type} · ${r.classification}`, memoryFields[r.type].map(k => `${k}: ${r[k]}`).join("\n")), "wb-insert"));
			buttons.appendChild(button("Delete expertise…", () => { const confirm = el("div", null, "wb-confirm"); confirm.appendChild(el("p", `Delete only ${r.id} from ${r.domain}? This cannot be undone.`)); confirm.appendChild(button("Confirm delete", () => void run(async () => { await action({ op: "deleteMemory", domain: r.domain, id: r.id }); await load(); }), "wb-confirm-delete")); confirm.appendChild(button("Cancel", () => confirm.remove())); f.appendChild(confirm); }, "wb-delete"));
		}
	}
	window.luunaWorkbench = { open(view) { mount(); previousFocus = document.activeElement; current = view || "tickets"; generation++; project = null; busy = false; active = true; root.hidden = false; body.replaceChildren(); root.querySelector("button").focus(); void run(refresh); }, isOpen() { return active; }, close };
	luuna.on("push:state", s => {
		if (!s.cwd) return;
		const changed = observedCwd !== undefined && observedCwd !== s.cwd;
		observedCwd = s.cwd;
		if (active && changed) { generation++; project = null; busy = false; body.replaceChildren(); void run(refresh); }
	});
})();
