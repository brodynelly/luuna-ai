/**
 * CDP probe: inspect the RUNNING Tauri app's real DOM and exercise its menu
 * keyboard handling in-process. Requires the app launched with
 * WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333.
 *
 * This is the authoritative check: no screen capture, no occlusion, no
 * fake window API.
 */
const PORT = process.argv[2] || "9333";

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

function cdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () => resolve({
      send(method, params) {
        return new Promise((res, rej) => {
          const msgId = ++id;
          pending.set(msgId, { res, rej });
          ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
        });
      },
      close() { ws.close(); },
    });
    ws.onerror = (e) => reject(new Error("ws error"));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    };
  });
}

async function evaluate(client, expression) {
  const r = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error("eval threw: " + JSON.stringify(r.exceptionDetails.exception));
  return r.result.value;
}

(async () => {
  const list = await targets();
  const page = list.find((t) => t.type === "page") || list[0];
  if (!page || !page.webSocketDebuggerUrl) {
    console.log("NO_PAGE_TARGET " + JSON.stringify(list.map((t) => ({ type: t.type, url: t.url }))));
    process.exit(1);
  }
  const client = await cdp(page.webSocketDebuggerUrl);
  await client.send("Runtime.enable");

  const script = `(() => {
    const out = {};
    const g = (id) => document.getElementById(id);
    const box = (id) => { const e = g(id); if (!e) return null; const b = e.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), w: Math.round(b.width) }; };

    out.viewport = { innerW: window.innerWidth, innerH: window.innerHeight, dpr: window.devicePixelRatio };
    out.hasTauri = !!window.__TAURI__;
    out.hasLuunaBridge = !!window.luuna;
    out.bridgeMethods = window.luuna ? Object.keys(window.luuna).length : 0;

    out.titlebar = box("titlebar");
    out.titlebarVisible = g("titlebar") ? getComputedStyle(g("titlebar")).display !== "none" : false;
    out.captionText = g("titlebar") ? g("titlebar").textContent.trim() : null;
    out.menubar = box("menubar");
    out.desktop = box("desktop");
    out.keybar = box("keybar");
    out.docScrollH = document.documentElement.scrollHeight;
    out.overflow = document.documentElement.scrollHeight > window.innerHeight;
    out.captionButtons = ["tb-min","tb-max","tb-close"].map((id) => {
      const e = g(id); if (!e) return id + ":MISSING";
      const b = e.getBoundingClientRect();
      return id + ":present " + Math.round(b.width) + "x" + Math.round(b.height) + " right=" + Math.round(b.right);
    });
    out.menuTitles = [...document.querySelectorAll("#menubar .menu-item")].map((e) => e.textContent.trim());

    // Exercise the REAL key handler in-process.
    const key = (k, opts) => window.dispatchEvent(new KeyboardEvent("keydown",
      Object.assign({ key: k, bubbles: true, cancelable: true }, opts || {})));
    const dd = () => document.querySelector(".dropdown");
    const selIdx = () => { const d = dd(); if (!d) return null; const s = d.querySelector(".row.sel"); return s ? Number(s.dataset.index) : null; };
    const steps = [];
    const rec = (label) => steps.push(label + " open=" + (dd() ? "yes" : "no") + " sel=" + selIdx());

    key("F10");            rec("F10");
    key("ArrowDown");      rec("ArrowDown");
    key("ArrowDown");      rec("ArrowDown2");
    key("ArrowUp");        rec("ArrowUp");
    key("ArrowRight");     rec("ArrowRight");
    key("Escape");         rec("Escape");
    key("F10");            rec("F10 reopen");
    key("F10");            rec("F10 toggle-close");
    key("o", { altKey: true }); rec("Alt+O");
    key("Escape");
    key("f", { altKey: true }); rec("Alt+F");
    out.keySteps = steps;
    return JSON.stringify(out);
  })()`;

  const raw = await evaluate(client, script);
  console.log("CDP_RESULT=" + raw);
  client.close();
})().catch((e) => { console.log("CDP_FATAL " + (e && e.message)); process.exit(1); });
