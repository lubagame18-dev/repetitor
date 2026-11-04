/* Статический сервер каталога repetitor для проверок (без npm).
   Использование:
     node _test/serve.mjs            – сервер на http://127.0.0.1:8765
     import { startServer } from "./serve.mjs" – для run.mjs/board.mjs/e2e.mjs */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");
export const TEST_ROOT = path.join(REPO_ROOT, "_test");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

export function startServer({ root = REPO_ROOT, port = 8765, host = "127.0.0.1" } = {}) {
  const server = http.createServer((req, res) => {
    let p;
    try {
      p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    } catch (_) {
      res.writeHead(400); res.end("bad url"); return;
    }
    let file = path.join(root, p);
    // защита от выхода за корень
    if (!file.startsWith(root)) { res.writeHead(403); res.end("forbidden"); return; }
    try {
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end("not found: " + p); return; }
      const ext = path.extname(file).toLowerCase();
      const body = fs.readFileSync(file);
      res.writeHead(200, {
        "content-type": MIME[ext] || "application/octet-stream",
        "content-length": body.length,
        "cache-control": "no-store, no-cache, must-revalidate",
        "access-control-allow-origin": "*",
      });
      res.end(body);
    } catch (e) {
      res.writeHead(500); res.end("server error: " + e.message);
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", err => {
      if (err && err.code === "EADDRINUSE") reject(new Error(`Порт ${port} занят: остановите старый сервер или задайте PORT`));
      else reject(err);
    });
    server.listen(port, host, () => {
      const url = `http://${host}:${port}`;
      resolve({
        url, server, port,
        close: () => new Promise(r => server.close(() => r())),
      });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = +process.env.PORT || 8765;
  startServer({ port }).then(s => {
    console.log("Репетитор: " + s.url);
    console.log("Стенд доски: " + s.url + "/_test/board.html");
  }).catch(e => { console.error(e.message); process.exit(1); });
}
