/* Офлайн-кэш приложения ученика. При обновлении файлов увеличьте номер версии. */
const CACHE = "oge-rus-v96";
const FILES = ["./", "index.html", "config.js", "assets/app.css", "assets/common.js", "assets/student.js", "assets/map.js", "assets/board.js", "assets/quiz.js", "assets/trend.js", "assets/supabase.js", "assets/work.js", "assets/call.js", "assets/play.js", "assets/izl.js", "assets/oge.js", "assets/play-banks.js", "assets/selfdata.js", "assets/play-5.js", "assets/kotik.webp", "courses/catalog.js", "courses/extra-catalog.js", "courses/school.js", "courses/entry.js", "assets/look.js", "assets/mascots/duck.webp", "assets/mascots/lamb.webp", "assets/mascots/hedgehog.webp", "assets/bg/bordo.webp", "assets/bg/lemon.webp", "assets/bg/peach.webp", "assets/bg/hvoya.webp", "icons/icon-192.png", "manifest.webmanifest"];

self.addEventListener("install", e => {
  /* каждый файл кэшируем отдельно: один отсутствующий не должен ломать установку SW */
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
/* Скрипты, стили, картинки и уроки – сначала из кэша (мгновенно на планшете; версия ?v=NN меняется при каждом обновлении).
   HTML – сначала сеть, но не дольше 3 секунд, иначе кэш. Запросы к Supabase не кэшируем. */
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.hostname.endsWith("supabase.co") || url.origin !== location.origin) return;
  const isDoc = e.request.mode === "navigate" || /\.html$/.test(url.pathname) || url.pathname.endsWith("/");
  if (isDoc){
    e.respondWith(new Promise(resolve => {
      let done = false;
      const fromCache = () => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match("index.html"));
      const t = setTimeout(() => fromCache().then(r => { if (r && !done){ done = true; resolve(r); } }), 3000);
      fetch(e.request).then(res => {
        clearTimeout(t);
        if (res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        if (!done){ done = true; resolve(res); }
      }).catch(() => { clearTimeout(t); if (!done) fromCache().then(r => { done = true; resolve(r || Response.error()); }); });
    }));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, {ignoreSearch: true}))));
});
