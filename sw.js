/* Офлайн-кэш приложения ученика. При обновлении файлов увеличьте номер версии. */
const CACHE = "oge-rus-v23";
const FILES = ["./", "index.html", "config.js", "assets/app.css", "assets/common.js", "assets/student.js", "assets/map.js", "assets/board.js", "assets/work.js", "assets/call.js", "assets/kotik.webp", "courses/catalog.js", "courses/extra-catalog.js", "courses/school.js", "courses/entry.js", "assets/look.js", "assets/mascots/duck.webp", "assets/mascots/lamb.webp", "assets/mascots/hedgehog.webp", "assets/bg/bordo.webp", "assets/bg/lemon.webp", "assets/bg/peach.webp", "assets/bg/hvoya.webp", "icons/icon-192.png", "manifest.webmanifest"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
/* Сначала сеть (свежие материалы), без сети – из кэша. Запросы к Supabase не кэшируем. */
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.hostname.endsWith("supabase.co")) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && url.origin === location.origin){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, {ignoreSearch: true}))
  );
});
