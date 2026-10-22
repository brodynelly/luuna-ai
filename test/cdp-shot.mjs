/**
 * Capture the running Tauri app's own rendered surface as a PNG via CDP.
 * This cannot be occluded by other windows, unlike a screen grab.
 *
 * Usage: node test/cdp-shot.mjs <out.png>
 */
import { writeFileSync } from "node:fs";

const PORT = process.env.CDP_PORT || "9333";
const out = process.argv[2] || "cdp-shot.png";

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page") || list[0];
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
  const c = await connect();
  const r = await c.send("Page.captureScreenshot", { format: "png" });
  const b64 = r.result && r.result.data;
  if (!b64) { console.log("NO_DATA " + JSON.stringify(r).slice(0, 300)); process.exit(1); }
  writeFileSync(out, Buffer.from(b64, "base64"));
  console.log("saved " + out);
  c.close();
})().catch((e) => { console.log("FATAL " + e.message); process.exit(1); });
