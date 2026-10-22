/**
 * CDP helper: evaluate an expression in the running Tauri app and print the
 * result. Requires the app launched with
 * WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333.
 *
 * Usage: node test/cdp-eval.mjs "<javascript expression>"
 */
const PORT = process.env.CDP_PORT || "9333";
const expr = process.argv[2];

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page") || list[0];
  if (!page || !page.webSocketDebuggerUrl) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws error")); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise((res) => {
    const msgId = ++id;
    pending.set(msgId, res);
    ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
  });
  return { send, close: () => ws.close() };
}

(async () => {
  if (!expr) { console.log("usage: node test/cdp-eval.mjs \"<expr>\""); process.exit(2); }
  const c = await connect();
  await c.send("Runtime.enable");
  const r = await c.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    console.log("EXCEPTION " + JSON.stringify(r.result.exceptionDetails.exception));
  } else {
    const v = r.result && r.result.result ? r.result.result.value : undefined;
    console.log(typeof v === "string" ? v : JSON.stringify(v));
  }
  c.close();
})().catch((e) => { console.log("CDP_FATAL " + e.message); process.exit(1); });
