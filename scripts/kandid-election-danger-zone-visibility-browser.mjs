// Real browser interaction with the actual sheet and readiness/review helpers.
// Synthetic injected responses only; no Auth session or database is accessed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const origin = "http://127.0.0.1:5190";
const output = resolve("deploy/election-danger-zone-visibility/evidence");
mkdirSync(output, { recursive: true });
const server = await createServer({
  configFile: false, envFile: false, root: process.cwd(),
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 5190, strictPort: true },
  optimizeDeps: { entries: ["scripts/fixtures/election-danger-zone-visibility.html"], include: ["react", "react-dom/client", "lucide-react"] },
});
let browser, ws, send;
const results = [], exceptions = [], blockedRequests = [];
try {
  await server.listen();
  const profile = mkdtempSync(join(tmpdir(), "kandid-danger-zone-visibility-"));
  browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", "--remote-allow-origins=*", `--user-data-dir=${profile}`,
    "--host-resolver-rules=MAP *.supabase.co ~NOTFOUND,MAP *.supabase.com ~NOTFOUND", "about:blank",
  ], { windowsHide: true, stdio: "ignore" });
  let port;
  for (let n = 0; n < 100; n++) {
    try { port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]); break; }
    catch { await delay(100); }
  }
  assert.ok(port, "fresh isolated browser must start");
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((accept, reject) => { ws.onopen = accept; ws.onerror = reject; });
  let serial = 0;
  const pending = new Map();
  send = (method, params = {}) => new Promise((accept, reject) => {
    const id = ++serial;
    pending.set(id, { accept, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`Browser timeout: ${method}`)); }, 15000).unref();
  });
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const item = pending.get(message.id); pending.delete(message.id);
      message.error ? item.reject(new Error(message.error.message)) : item.accept(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
    if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      const local = new URL(request.url).origin === origin;
      if (!local) blockedRequests.push(new URL(request.url).origin);
      void send(local ? "Fetch.continueRequest" : "Fetch.failRequest", local ? { requestId } : { requestId, errorReason: "BlockedByClient" });
    }
  };
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true });
    assert.ok(!result.exceptionDetails, result.exceptionDetails?.text);
    return result.result.value;
  };
  const wait = async expression => {
    for (let n = 0; n < 250; n++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`Condition not reached: ${expression}`);
  };
  const click = async selector => {
    const point = await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b)return null;b.scrollIntoView({block:'nearest',behavior:'instant'});const r=b.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);return {x,y,visible:hit===b||b.contains(hit)}})()`);
    assert.ok(point?.visible, `control is visible and unobscured: ${selector}`);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await delay(60);
  };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Network.setBypassServiceWorker", { bypass: true });
  await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  for (const width of [375, 820, 1440]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const [enabled, available] of [[false, false], [true, false], [false, true], [true, true]]) {
      const name = `${width}px feature-${enabled ? "ON" : "OFF"} backend-${available ? "ready" : "unavailable"}`;
      await send("Page.navigate", { url: `${origin}/scripts/fixtures/election-danger-zone-visibility.html?enabled=${enabled}&available=${available}` });
      await wait(`!!document.querySelector('.board-election-danger-primary')`);
      const evidence = await evaluate("window.acceptanceEvidence");
      assert.equal(evidence.readinessCalls, enabled ? 1 : 0, name);
      assert.equal(await evaluate(`!!document.querySelector('#election-removal-password')`), false);
      await click(".board-election-danger-primary");
      await wait(`document.querySelectorAll('.board-election-dependency-detail li').length===19`);
      assert.equal(await evaluate(`document.querySelector('.board-election-danger-primary').getAttribute('aria-expanded')`), "true");
      assert.equal(await evaluate(`!!document.querySelector('.board-election-danger-button')`), enabled && available, name);
      await click(".board-election-danger-primary");
      assert.equal(await evaluate(`!!document.querySelector('.board-election-dependency-detail')`), false, "Hide related collapses details");
      assert.equal(await evaluate(`!!document.querySelector('.board-election-danger-button')`), false);
      await click(".board-election-danger-primary");
      if (enabled && available) {
        await click(".board-election-danger-button");
        await wait(`!!document.querySelector('#election-removal-password')`);
        assert.equal(await evaluate(`document.querySelector('.board-election-danger-button').textContent.trim()`), "Confirm Removal");
        assert.equal(await evaluate(`document.querySelector('.board-election-danger-button').disabled`), true, "empty password cannot submit");
        assert.equal(await evaluate(`document.querySelector('#election-removal-password').required`), true);
        assert.ok(await evaluate(`document.body.textContent.includes('history remain intact')`));
        await click("#election-removal-password");
        await send("Input.insertText", { text: "synthetic-ui-only" });
        await wait(`!document.querySelector('.board-election-danger-button').disabled`);
        await click(".board-election-danger-button");
        await wait(`document.querySelectorAll('[role="alert"]').length===1`);
        assert.equal(await evaluate(`document.querySelector('#election-removal-password').value`), "", "password clears after submission");
        assert.equal(await evaluate("window.acceptanceEvidence.confirmationCalls"), 1);
        assert.equal(await evaluate(`document.querySelectorAll('.board-election-removal-error').length`), 1);
        assert.equal(await evaluate(`document.querySelector('.board-election-danger-button').disabled`), true);
      }
      const layout = await evaluate(`(()=>{const sheet=document.querySelector('[role="dialog"]'),footer=document.querySelector('.board-election-danger-footer');const rect=sheet.getBoundingClientRect();const buttons=[...footer.querySelectorAll('button')].map(b=>b.getBoundingClientRect());return {noOverflow:document.documentElement.scrollWidth<=innerWidth+1&&sheet.scrollWidth<=sheet.clientWidth+1,inViewport:rect.left>=-1&&rect.right<=innerWidth+1,noOverlap:buttons.every((a,i)=>buttons.slice(i+1).every(b=>a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1))}})()`);
      assert.ok(layout.noOverflow && layout.inViewport && layout.noOverlap, `${name}: ${JSON.stringify(layout)}`);
      const screenshot = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(output, `${width}-${enabled}-${available}.png`), Buffer.from(screenshot.data, "base64"));
      await click(".board-election-danger-quiet");
      await wait(`!!document.querySelector('#closed')`);
      results.push({ name, status: "PASS", layout, readinessCalls: evidence.readinessCalls, dangerZoneVisible: enabled && available });
    }
  }
  assert.deepEqual(exceptions, [], "no unhandled component exceptions");
  assert.equal(blockedRequests.some(origin => /supabase/.test(origin)), false, "no Supabase request was attempted");
  const result = { results, count: results.length, backend: "synthetic injected responses; no authenticated backend test claimed", productionRequests: 0, blockedExternalOrigins: [...new Set(blockedRequests)], exceptions };
  writeFileSync(join(output, "RESULTS.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (send && ws?.readyState === WebSocket.OPEN) {
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(output, "FAILURE.png"), Buffer.from(screenshot.data, "base64"));
    const diagnostic = await send("Runtime.evaluate", { expression: "({url:location.href,text:document.body.innerText,phase:document.querySelector('h2')?.textContent})", returnByValue: true });
    console.error(JSON.stringify({ diagnostic: diagnostic.result.value, exceptions, completed: results.length }));
  }
  throw error;
} finally {
  if (send && ws?.readyState === WebSocket.OPEN) {
    try { await send("Browser.close"); } catch { /* Browser may close its debugger first. */ }
  }
  ws?.close();
  browser?.kill();
  server.httpServer?.closeAllConnections();
  await server.close();
}
