/* Мини-драйвер Chrome DevTools Protocol для проверок без npm-зависимостей.
   Запуск: node _test/cdp.mjs (внутри не запускается; подключайте как модуль).
   Требуется Node 22+ (глобальный WebSocket) и локальный Chrome/Edge. */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME_CANDIDATES = [
  process.env.CHROME,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

export function findChrome(){
  for (const p of CHROME_CANDIDATES) { try { if (fs.existsSync(p)) return p; } catch (_) {} }
  throw new Error("Chrome/Edge не найден. Задайте CHROME=путь.");
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Set(); this.closed = false; }
  static async connect(url){
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = e => rej(new Error("ws error " + (e?.message || ""))); });
    const c = new CDP(ws);
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.id && c.pending.has(m.id)){
        const { res, rej, timer } = c.pending.get(m.id); c.pending.delete(m.id); clearTimeout(timer);
        m.error ? rej(new Error(m.error.message + " " + JSON.stringify(m.error.data || ""))) : res(m.result);
      } else if (m.method){ c.handlers.forEach(h => h(m)); }
    };
    ws.onclose = () => { c.closed = true; c.pending.forEach(({rej}) => rej(new Error("CDP closed"))); c.pending.clear(); };
    return c;
  }
  send(method, params = {}, sessionId){
    if (this.closed) return Promise.reject(new Error("CDP closed"));
    const id = ++this.id;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { this.pending.delete(id); rej(new Error("CDP timeout: " + method)); }, 30000);
      this.pending.set(id, { res, rej, timer });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(fn){ this.handlers.add(fn); return () => this.handlers.delete(fn); }
}

export async function launch({ port = 9333, width = 1440, height = 1000, headless = true, userDataDir, extraArgs = [] } = {}){
  const chrome = findChrome();
  const dir = userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cdp-"));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dir}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows", "--force-device-scale-factor=1",
    `--window-size=${width},${height}`,
    ...(headless ? ["--headless=new"] : []),
    ...extraArgs,
    "about:blank",
  ];
  const proc = spawn(chrome, args, { stdio: "ignore", windowsHide: true });
  let version;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); version = await r.json(); break; } catch (_) { await sleep(100); }
  }
  if (!version) { try { proc.kill(); } catch (_) {} throw new Error("Chrome не запустился на порту " + port); }
  const browser = await CDP.connect(version.webSocketDebuggerUrl);
  const browserProc = proc, tmpDir = dir;
  return {
    browser, proc: browserProc, port, tmpDir,
    async newPage(url = "about:blank"){
      const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
      const info = await r.json();
      const cdp = await CDP.connect(info.webSocketDebuggerUrl);
      const page = new Page(cdp, info.targetId);
      await page.init({ width, height });
      return page;
    },
    async close(){
      try { await browser.send("Browser.close"); } catch (_) {}
      await sleep(300);
      try { browserProc.kill(); } catch (_) {}
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    },
  };
}

class Page {
  constructor(cdp, targetId){ this.cdp = cdp; this.targetId = targetId; this.console = []; this.errors = []; }
  async init({ width, height }){
    this.cdp.on(m => {
      if (m.method === "Runtime.consoleAPICalled"){
        const text = (m.params.args || []).map(a => a.value ?? a.description ?? "").join(" ");
        this.console.push({ type: m.params.type, text });
      }
      if (m.method === "Runtime.exceptionThrown"){
        const d = m.params.exceptionDetails;
        this.errors.push(d.exception?.description || d.text || "exception");
      }
    });
    await this.cdp.send("Page.enable");
    await this.cdp.send("Runtime.enable");
    await this.cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  }
  async inject(script, source = "inject.js"){
    const r = await this.cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: script, runImmediately: true });
    this._injected = this._injected || [];
    this._injected.push(r.identifier);
    return r.identifier;
  }
  async goto(url, { wait = "load", timeout = 20000 } = {}){
    await this.cdp.send("Page.navigate", { url });
    if (wait === "load"){
      const t0 = Date.now();
      while (Date.now() - t0 < timeout){
        const st = await this.eval("document.readyState").catch(() => null);
        if (st === "complete") return;
        await sleep(80);
      }
      throw new Error("Не дождались load: " + url);
    }
  }
  async eval(expression, { awaitPromise = true, byValue = true } = {}){
    const r = await this.cdp.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: byValue, userGesture: true });
    if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + "\n" + expression.slice(0, 300));
    return r.result?.value;
  }
  async waitFor(expr, { timeout = 8000, interval = 100, label = expr } = {}){
    const t0 = Date.now();
    let lastErr;
    while (Date.now() - t0 < timeout){
      try { const v = await this.eval(expr); if (v) return v; } catch (e) { lastErr = e; }
      await sleep(interval);
    }
    throw new Error(`Не дождались: ${label}` + (lastErr ? " (" + lastErr.message + ")" : ""));
  }
  async click(selector, { index = 0 } = {}){
    const ok = await this.eval(`(() => { const els = document.querySelectorAll(${JSON.stringify(selector)}); const el = els[${index}]; if (!el) return false; el.scrollIntoView({block:"center"}); el.click(); return true; })()`);
    if (!ok) throw new Error("Нет элемента для клика: " + selector);
    await sleep(60);
  }
  async mouse(type, x, y, { button = "left", clickCount = 1 } = {}){
    await this.cdp.send("Input.dispatchMouseEvent", { type, x, y, button, clickCount, buttons: type === "mouseReleased" ? 0 : type === "mouseMoved" ? 0 : 1 });
  }
  async drag(x1, y1, x2, y2, steps = 8){
    await this.mouse("mousePressed", x1, y1);
    for (let i = 1; i <= steps; i++) await this.mouse("mouseMoved", x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps);
    await this.mouse("mouseReleased", x2, y2);
    await sleep(60);
  }
  async rect(selector){
    const v = await this.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return {x:r.x, y:r.y, w:r.width, h:r.height, top:r.top, left:r.left}; })()`);
    if (!v) throw new Error("Нет элемента: " + selector);
    return v;
  }
  async screenshot(file){
    const r = await this.cdp.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    return file;
  }
  async close(){ try { await this.cdp.send("Page.close"); } catch (_) {} try { this.cdp.ws.close(); } catch (_) {} }
  async key(key, code = key){
    await this.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code });
    await this.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
  }
}

export { sleep };
