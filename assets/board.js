/* Общая доска: ученик и учитель видят курсоры и рисунки друг друга в реальном времени.
   Живое движение – Supabase Realtime (broadcast + presence), сохранение – таблица board_items. */
window.Board = (() => {
  const W = 800;                        // логическая ширина листа
  const COLORS = ["#24183d", "#7b4cf5", "#ee5fa8", "#1f9d55", "#d6334a"];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  function mount(root, o){
    // o: {api, channelName, sb, role, name, pages:[{key,label,html}], page, onPage}
    let page = o.page || o.pages[0].key;
    let items = new Map();             // id -> item
    let mine = [];                     // id своих объектов для «Отменить»
    let tool = "pen", color = COLORS[0], drawing = null, scale = 1, height = 1400;
    const peers = new Map();           // key -> {name, role, x, y, page, color, el}
    const drafts = new Map();          // key -> stroke being drawn by peer
    const me = Math.random().toString(36).slice(2, 9);
    let channel = null, lastCursor = 0, lastDraft = 0, draftBuf = [];
    const imgCache = new Map(); const pageCache = new Map(); const pagesArr = o.pages.slice();

    root.innerHTML = `
      <div class="bd-bar">
        <div class="bd-pages" role="group" aria-label="Лист доски"><button data-pstep="-1" title="Предыдущий лист" aria-label="Предыдущий лист">‹</button>${o.pages.map(p => `<button data-bpage="${p.key}">${esc(p.label)}</button>`).join("")}<button data-pstep="1" title="Следующий лист" aria-label="Следующий лист">›</button></div>
        <div class="bd-who small muted" aria-live="polite"></div>
      </div>
      <div class="bd-body"><div class="bd-side"><div class="bd-tools" role="group" aria-label="Инструменты">
          <button data-tool="pen" title="Ручка">✎</button>
          <button data-tool="hl" title="Маркер">▮</button>
          <button data-tool="text" title="Текст">T</button>
          <button data-tool="erase" title="Ластик">⌫</button>
          <button data-tool="hand" title="Листать">✋</button>
          ${COLORS.map(c => `<button class="bd-color" data-color="${c}" style="--bc:${c}" aria-label="Цвет"></button>`).join("")}
          <button data-tool="touch" title="Работать с сайтом или презентацией (нажимать внутри)">👆</button>
          <button data-act="attach" title="Прикрепить файл (фото, PDF-презентация, документ)">📎</button>
          <button data-act="embed" title="Встроить сайт: Wordwall, YouTube, Google Презентации, Canva…">🌐</button>
          <button data-act="camera" title="Фото с камеры">📷</button>
          <button data-act="undo" title="Отменить своё последнее">↶</button>
          ${o.role === "teacher" ? `<button data-act="clear" title="Очистить лист">🧹</button>` : ""}
        </div></div>
      <div class="bd-stage"><div class="bd-wrap">
        <div class="bd-bg"></div>
        <canvas class="bd-cv"></canvas>
        <div class="bd-cursors"></div>
      </div></div></div>
      <div class="bd-menu" hidden role="menu" aria-label="Быстрые действия"></div>`;
    const $ = s => root.querySelector(s);
    const stage = $(".bd-stage"), wrap = $(".bd-wrap"), bg = $(".bd-bg"), cv = $(".bd-cv"), ctx = cv.getContext("2d"), curLayer = $(".bd-cursors");

    function layout(){
      const bar = root.querySelector(".bd-bar"), side = root.querySelector(".bd-side .bd-tools");
      if (bar && side){ const top = 66 + bar.offsetHeight + 6; side.style.top = `calc(${top}px + env(safe-area-inset-top,0px))`; side.style.maxHeight = `calc(100vh - ${top + 10}px)`; }
      const w = stage.clientWidth; scale = w / W;
      bg.style.width = W + "px"; bg.style.transform = `scale(${scale})`;
      const bgH = bg.scrollHeight;
      let maxY = 0; items.forEach(it => { const ys = it.t === "s" ? it.p.map(p => p[1]) : [it.y]; maxY = Math.max(maxY, ...ys); });
      height = Math.max(1400, bgH + 200, maxY + 300);
      wrap.style.height = height * scale + "px"; wrap.style.width = w + "px";
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(w * dpr); cv.height = Math.round(height * scale * dpr);
      cv.style.width = w + "px"; cv.style.height = height * scale + "px";
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      redraw();
    }
    function drawStroke(s){
      if (!s.p.length) return;
      ctx.save();
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = s.c; ctx.lineWidth = s.w; ctx.globalAlpha = s.h ? 0.35 : 1;
      ctx.beginPath(); ctx.moveTo(s.p[0][0], s.p[0][1]);
      if (s.p.length === 1) ctx.lineTo(s.p[0][0] + 0.1, s.p[0][1]);
      for (let i = 1; i < s.p.length; i++) ctx.lineTo(s.p[i][0], s.p[i][1]);
      ctx.stroke(); ctx.restore();
    }
    function drawText(t){
      ctx.save(); ctx.fillStyle = t.c; ctx.font = "600 22px Nunito, system-ui, sans-serif"; ctx.textBaseline = "top";
      String(t.s).split("\n").forEach((line, i) => ctx.fillText(line, t.x, t.y + i * 28)); ctx.restore();
    }
    function drawImageItem(it){
      const w = it.w || 480, h = it.h || w / (it.ratio || 1.5);
      const cached = imgCache.get(it.src);
      if (cached && cached.complete && cached.naturalWidth){ ctx.drawImage(cached, it.x, it.y, w, h); return; }
      if (!cached){ const im = new Image(); im.onload = () => { imgCache.set(it.src, im); redraw(); }; im.src = it.src; imgCache.set(it.src, im); }
      ctx.save(); ctx.fillStyle = "#f1eefb"; ctx.fillRect(it.x, it.y, w, h); ctx.restore();
    }
    function drawSeg(a, b, s){
      ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = s.c; ctx.lineWidth = s.w; ctx.globalAlpha = s.h ? 0.35 : 1;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.restore();
    }
    function redraw(){
      ctx.clearRect(0, 0, W, height + 50);
      items.forEach(it => { if (it.t === "s") drawStroke(it); else if (it.t === "i") drawImageItem(it); else drawText(it); });
      drafts.forEach(drawStroke);
      if (drawing && !drawing.erase) drawStroke(drawing);
    }
    function pos(e){ const r = cv.getBoundingClientRect(); return [Math.round((e.clientX - r.left) / scale), Math.round((e.clientY - r.top) / scale)]; }

    /* ---------- лист ---------- */
    function stepPage(dir){
      const i = pagesArr.findIndex(x => x.key === page);
      const nx = pagesArr[(i + dir + pagesArr.length) % pagesArr.length];
      if (!nx) return;
      openPage(nx.key);
      if (o.role === "teacher") send("page", { page: nx.key });
    }
    const onKey = e => {
      if (!root.isConnected) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") { stepPage(1); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { stepPage(-1); }
    };
    document.addEventListener("keydown", onKey);
    /* свайп по доске для листания (инструмент «рука») */
    let swipeX = null;
    wrap.addEventListener("pointerdown", e => { if (tool === "hand") swipeX = e.clientX; });
    wrap.addEventListener("pointerup", e => {
      if (tool !== "hand" || swipeX == null) return;
      const dx = e.clientX - swipeX; swipeX = null;
      if (Math.abs(dx) > 60) stepPage(dx < 0 ? 1 : -1);
    });
    function renderPageButtons(){
      const box = root.querySelector(".bd-pages"); if (!box) return;
      box.innerHTML = pagesArr.map(p => `<button data-bpage="${p.key}" aria-pressed="${p.key === page}">${esc(p.label)}</button>`).join("");
    }
    async function openPage(key){
      if (!pagesArr.some(p => p.key === key)) key = pagesArr[0].key;
      page = key;
      renderPageButtons();
      bg.innerHTML = (pagesArr.find(p => p.key === key) || pagesArr[0]).html;
      items = new Map(); mine = []; drafts.clear();
      const cached = pageCache.get(key);
      if (cached) { cached.forEach(r => items.set(String(r.id), r.item)); }
      layout();
      if (!cached) {
        try { const list = await o.api.load(key); list.forEach(r => items.set(String(r.id), r.item)); pageCache.set(key, list); } catch(_) {}
        layout();
      }
      sendPresence();
      o.onPage && o.onPage(key);
    }
    /* добавить лист доски (вложение/презентация) и при желании показать всем */
    function addPage(label, html, broadcast){
      const key = "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      label = label.slice(0, 24);
      pagesArr.push({ key, label, html });
      renderPageButtons();
      if (broadcast){ send("addpage", { key, label, html }); o.api.add("_pages", {t: "pg", key, label, html}).catch(() => {}); }
      return key;
    }
    /* встроить сайт (Wordwall, YouTube, Google Презентации, Canva, любая страница с разрешённым встраиванием) */
    function embedURL(u){
      u = String(u || "").trim(); if (!/^https?:\/\//i.test(u)) u = "https://" + u;
      let m;
      if ((m = u.match(/youtu\.be\/([\w-]+)/) || u.match(/youtube\.com\/watch\?v=([\w-]+)/))) return "https://www.youtube.com/embed/" + m[1];
      if ((m = u.match(/docs\.google\.com\/presentation\/d\/([\w-]+)/))) return "https://docs.google.com/presentation/d/" + m[1] + "/embed?start=false&loop=false";
      if ((m = u.match(/wordwall\.net\/(?:ru\/)?resource\/(\d+)/))) return "https://wordwall.net/embed/resource/" + m[1];
      if (/canva\.com\/design\//.test(u) && !/[?&]embed/.test(u)) return u.split("?")[0].replace(/\/(edit|view)$/, "/view") + "?embed";
      if ((m = u.match(/rutube\.ru\/video\/([\w]+)/))) return "https://rutube.ru/play/embed/" + m[1];
      return u;
    }
    function embedPage(url, label, h){
      const src = embedURL(url), hh = Math.max(300, Math.min(2400, +h || 560));
      return addPage(label || "Сайт", `<div class="bd-sheet bd-embed"><iframe src="${esc(src)}" style="width:100%;height:${hh}px;border:0;border-radius:12px;background:#fff" allow="autoplay; fullscreen; clipboard-write; encrypted-media; picture-in-picture" allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe><p class="small muted" style="margin-top:6px">Чтобы нажимать внутри сайта, выберите 👆 «Работать с сайтом». Чтобы рисовать поверх – ручку ✎.</p></div>`, true);
    }

    /* ---------- рисование ---------- */
    function setTool(t){ tool = t; root.querySelectorAll("[data-tool]").forEach(b => b.setAttribute("aria-pressed", b.dataset.tool === t)); cv.style.touchAction = t === "hand" ? "pan-y" : "none"; cv.style.cursor = t === "hand" ? "grab" : t === "text" ? "text" : "crosshair"; cv.style.pointerEvents = t === "touch" ? "none" : ""; bg.style.pointerEvents = t === "touch" ? "auto" : ""; }
    function setColor(c){ color = c; root.querySelectorAll("[data-color]").forEach(b => b.setAttribute("aria-pressed", b.dataset.color === c)); }
    function hitTest(pt){
      let found = null;
      items.forEach((it, id) => {
        if (found) return;
        if (it.t === "s"){ for (const p of it.p){ if (Math.hypot(p[0] - pt[0], p[1] - pt[1]) < 14 + it.w){ found = id; break; } } }
        else if (it.t === "i"){ const w = it.w || 480, h = it.h || w / (it.ratio || 1.5); if (pt[0] >= it.x && pt[0] <= it.x + w && pt[1] >= it.y && pt[1] <= it.y + h) found = id; }
        else if (pt[0] >= it.x - 6 && pt[0] <= it.x + 12 * String(it.s).length + 6 && pt[1] >= it.y - 6 && pt[1] <= it.y + 30 * String(it.s).split("\n").length) found = id;
      });
      return found;
    }
    async function addItem(item){
      const tmp = "tmp" + Math.random(); items.set(tmp, item); redraw();
      try {
        const id = String(await o.api.add(page, item));
        items.delete(tmp); items.set(id, item); mine.push(id);
        send("add", {id, item});
      } catch(_) { items.delete(tmp); redraw(); U.toast("Не сохранилось на доске. Проверьте интернет."); }
    }
    async function removeIds(ids){
      ids.forEach(id => items.delete(id)); redraw();
      try { await o.api.remove(page, ids.filter(id => !id.startsWith("tmp"))); } catch(_) {}
      send("remove", {ids});
    }

    /* рисует только один указатель: второй палец, ладонь при стилусе и правая кнопка мыши не дают «зигзагов» */
    let penSeen = 0, lp = null;
    const lpClear = () => { if (lp){ clearTimeout(lp.timer); lp = null; } };
    cv.addEventListener("contextmenu", e => { e.preventDefault(); openMenu(e.clientX, e.clientY); });
    cv.addEventListener("pointerdown", e => {
      closeMenu();
      if (e.pointerType === "pen") penSeen = Date.now();
      if (e.button === 2 || (e.buttons & 2) || (e.pointerType === "pen" && (e.buttons & 32))){ e.preventDefault(); end(); openMenu(e.clientX, e.clientY); return; }
      if (e.pointerType === "touch" && Date.now() - penSeen < 4000) return;   // ладонь, пока пишут стилусом
      if (drawing && drawing.pid !== e.pointerId){ end(); return; }         // второй палец – это не рисунок
      if (tool === "hand") return;
      const p = pos(e);
      lpClear();
      if (e.pointerType !== "mouse"){ const x = e.clientX, y = e.clientY; lp = {x, y, timer: setTimeout(() => { lp = null; cancelStroke(); openMenu(x, y); }, 550)}; }
      if (tool === "text"){ lpClear(); placeText(p); return; }
      try { cv.setPointerCapture(e.pointerId); } catch(_) {}
      if (tool === "erase"){ const id = hitTest(p); if (id) removeIds([id]); drawing = {erase:true, pid:e.pointerId}; return; }
      drawing = {t:"s", c: tool === "hl" ? "#ffd23f" : color, w: tool === "hl" ? 18 : 3, h: tool === "hl", p:[p], pid:e.pointerId, sid: Math.random().toString(36).slice(2, 8)};
      draftBuf = [p];
    });
    cv.addEventListener("pointermove", e => {
      const p = pos(e), now = performance.now();
      if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 8) lpClear();
      if (now - lastCursor > 45 && (!drawing || drawing.pid === e.pointerId)){ lastCursor = now; send("cursor", {x:p[0], y:p[1]}); }
      if (!drawing || drawing.pid !== e.pointerId) return;
      if (drawing.erase){ const id = hitTest(p); if (id) removeIds([id]); return; }
      const pts = (e.getCoalescedEvents ? e.getCoalescedEvents() : []).map(pos); if (!pts.length) pts.push(p);
      for (const q of pts){
        const last = drawing.p[drawing.p.length - 1];
        if (Math.hypot(q[0] - last[0], q[1] - last[1]) < 1.5) continue;
        if (Math.hypot(q[0] - last[0], q[1] - last[1]) > 260) continue;      // случайный скачок указателя – пропускаем
        drawing.p.push(q); draftBuf.push(q); drawSeg(last, q, drawing);
      }
      if (drawing.p.length > 1500) drawing.p = drawing.p.filter((_, i2) => i2 % 2 === 0 || i2 === drawing.p.length - 1);
      if (now - lastDraft > 50 && draftBuf.length > 1){ lastDraft = now; send("draft", {sid:drawing.sid, c:drawing.c, w:drawing.w, h:drawing.h, p:draftBuf}); draftBuf = [draftBuf[draftBuf.length - 1]]; }
    });
    function cancelStroke(){ if (drawing && !drawing.erase) send("draft", {sid:drawing.sid, p:[], end:true, drop:true}); drawing = null; redraw(); }
    function end(e){
      if (e && drawing && drawing.pid !== e.pointerId) return;
      lpClear();
      if (!drawing) return;
      const d = drawing; drawing = null;
      if (d.erase) return;
      send("draft", {sid:d.sid, c:d.c, w:d.w, h:d.h, p:draftBuf, end:true});
      delete d.pid; delete d.sid;
      if (d.p.length) addItem(d);
    }
    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end); cv.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") end(e); });

    /* ---------- быстрая панель: правая кнопка мыши, кнопка стилуса или долгое нажатие ---------- */
    const menu = root.querySelector(".bd-menu");
    function openMenu(x, y){
      const extra = typeof o.menu === "function" ? (o.menu() || []) : [];
      menu.innerHTML = `<div class="bd-mrow">${["pen","hl","text","erase","hand"].map(t => `<button data-mtool="${t}" aria-pressed="${tool === t}" title="${{pen:"Ручка", hl:"Маркер", text:"Текст", erase:"Ластик", hand:"Листать"}[t]}">${{pen:"✎", hl:"▮", text:"T", erase:"⌫", hand:"✋"}[t]}</button>`).join("")}</div>
        <div class="bd-mrow">${COLORS.map(c => `<button class="bd-color" data-mcolor="${c}" style="--bc:${c}" aria-pressed="${color === c}" aria-label="Цвет"></button>`).join("")}</div>
        <div class="bd-mlist"><button data-mact="undo">↶ Отменить</button><button data-mact="blank">📄 Чистый лист</button>${extra.map((m, i) => `<button data-mext="${i}">${esc(m.label)}</button>`).join("")}</div>`;
      if (menu.parentElement !== document.body) document.body.appendChild(menu);   // над всеми окнами (у «стеклянных» окон свой слой)
      menu.hidden = false;
      const mw = menu.offsetWidth, mh = menu.offsetHeight;
      menu.style.left = Math.max(4, Math.min(x, innerWidth - mw - 4)) + "px";
      menu.style.top = Math.max(4, Math.min(y, innerHeight - mh - 4)) + "px";
      menu.onclick = ev => {
        const b = ev.target.closest("button"); if (!b) return;
        if (b.dataset.mtool) setTool(b.dataset.mtool);
        if (b.dataset.mcolor){ setColor(b.dataset.mcolor); if (tool !== "pen" && tool !== "text") setTool("pen"); }
        if (b.dataset.mact === "undo") root.querySelector('[data-act="undo"]')?.click();
        if (b.dataset.mact === "blank"){ const bl = pagesArr.find(p => p.key === "blank") || pagesArr.find(p => p.key === "p1"); if (bl){ openPage(bl.key); if (o.role === "teacher") send("page", {page: bl.key}); } }
        if (b.dataset.mext != null){ try { extra[+b.dataset.mext].run(); } catch(_) {} }
        closeMenu();
      };
    }
    function closeMenu(){ if (menu && !menu.hidden){ menu.hidden = true; menu.innerHTML = ""; } }
    const onDocDown = e => { if (menu && !menu.hidden && !menu.contains(e.target)) closeMenu(); };
    document.addEventListener("pointerdown", onDocDown, true);

    function placeText(p){
      const box = document.createElement("textarea");
      box.className = "bd-input"; box.rows = 2;
      box.style.left = p[0] * scale + "px"; box.style.top = p[1] * scale + "px";
      box.placeholder = "Текст… (Enter – готово)";
      wrap.appendChild(box); box.focus();
      const done = () => { const s = box.value.trim(); box.remove(); if (s) addItem({t:"t", x:p[0], y:p[1], s:s.slice(0, 400), c:color}); };
      box.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey){ e.preventDefault(); done(); } if (e.key === "Escape") box.remove(); });
      box.addEventListener("blur", done);
    }

    root.addEventListener("click", async e => {
      const b = e.target.closest("button"); if (!b || !root.contains(b)) return;
      if (b.dataset.pstep){ stepPage(+b.dataset.pstep); return; }
      if (b.dataset.bpage){ openPage(b.dataset.bpage); if (o.role === "teacher") send("page", {page:b.dataset.bpage}); }
      if (b.dataset.tool) setTool(b.dataset.tool);
      if (b.dataset.color){ setColor(b.dataset.color); if (tool === "hl" || tool === "erase" || tool === "hand") setTool("pen"); }
      if (b.dataset.act === "undo"){ const id = mine.pop(); if (id) removeIds([id]); }
      if (b.dataset.act === "clear"){
        if (b.dataset.sure){ await o.api.clear(page); items.clear(); redraw(); send("clear", {}); b.textContent = "🧹"; delete b.dataset.sure; }
        else { b.dataset.sure = "1"; b.textContent = "✔?"; b.title = "Нажмите ещё раз, чтобы очистить лист"; setTimeout(() => { b.textContent = "🧹"; delete b.dataset.sure; }, 3000); }
      }
    });

    /* ---------- вложения: файлы, буфер обмена, перетаскивание ---------- */
    const fileInput = document.createElement("input");
    fileInput.type = "file"; fileInput.multiple = true; fileInput.accept = "image/*,application/pdf,video/*,.docx,.pptx"; fileInput.style.display = "none";
    root.appendChild(fileInput);
    const dropHint = document.createElement("div"); dropHint.className = "bd-drop"; dropHint.textContent = "Отпустите файл — он появится на доске";
    wrap.appendChild(dropHint);

    function addImage(src, ratio, x, y, w){
      const width = w || 460, hh = width / (ratio || 1.5);
      addItem({ t: "i", x: x ?? (40 + Math.round(Math.random() * 40)), y: y ?? 120, w: width, h: hh, ratio: ratio || 1.5, src });
      return hh;
    }
    function canvasToJpeg(cv2, maxW, q){
      const k = Math.min(1, (maxW || 1600) / cv2.width);
      if (k < 1){ const c2 = document.createElement("canvas"); c2.width = Math.round(cv2.width * k); c2.height = Math.round(cv2.height * k); c2.getContext("2d").drawImage(cv2, 0, 0, c2.width, c2.height); cv2 = c2; }
      return cv2.toDataURL("image/jpeg", q || 0.78);
    }
    async function imageFileToItems(file){
      const url = URL.createObjectURL(file);
      try {
        const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
        const k = Math.min(1, 1600 / im.width), c2 = document.createElement("canvas");
        c2.width = Math.round(im.width * k); c2.height = Math.round(im.height * k);
        c2.getContext("2d").drawImage(im, 0, 0, c2.width, c2.height);
        return [{ src: canvasToJpeg(c2, 1600, 0.78), ratio: im.width / im.height }];
      } finally { URL.revokeObjectURL(url); }
    }
    async function pdfToItems(file){
      try {
        if (!window.pdfjsLib) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
        if (!window.pdfjsLib) return [];
        const buf = await file.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        const n = Math.min(doc.numPages, 60); let first = null;
        U.toast(`Открываю презентацию: ${n} стр.…`);
        for (let i = 1; i <= n; i++) {
          const pg = await doc.getPage(i), vp0 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: Math.min(2, 1400 / vp0.width) });
          const c2 = document.createElement("canvas"); c2.width = vp.width; c2.height = vp.height;
          await pg.render({ canvasContext: c2.getContext("2d"), viewport: vp }).promise;
          const key = addPage(`Слайд ${i}`, `<div class="bd-slide"><img src="${canvasToJpeg(c2, 1400, 0.74)}" alt="Слайд ${i}"></div>`, true);
          if (!first) first = key;
        }
        if (first){ openPage(first); if (o.role === "teacher") send("page", {page: first}); }
        items2LengthMsg = `Презентация открыта: ${n} слайдов. Листайте стрелками ‹ ›, рисуйте поверх.`;
        return [];
      } catch (e) { U.toast("PDF не удалось открыть: " + e.message); return []; }
    }
    async function videoToItems(file){
      const url = URL.createObjectURL(file);
      try {
        const v = document.createElement("video"); v.src = url; v.muted = true; v.playsInline = true;
        await new Promise(res => { v.onloadedmetadata = res; setTimeout(res, 2500); });
        const shots = [];
        for (const t of [0.5, Math.min(2, v.duration || 1), Math.min(4, v.duration || 2)]) {
          await new Promise(res => { v.onseeked = res; v.currentTime = Math.min(t, (v.duration || 1) - 0.05); setTimeout(res, 900); });
          const c2 = document.createElement("canvas"); c2.width = v.videoWidth || 640; c2.height = v.videoHeight || 360;
          c2.getContext("2d").drawImage(v, 0, 0, c2.width, c2.height);
          shots.push({ src: canvasToJpeg(c2, 1200, 0.75), ratio: c2.width / c2.height });
        }
        addPage("Видео (кадры)", `<div class="bd-sheet"><h2>${esc(file.name)}</h2><p class="small muted">Кадры видео добавлены на доску. Полный видеофайл доступен у учителя.</p></div>`, false);
        return shots;
      } finally { URL.revokeObjectURL(url); }
    }

    async function loadJSZip(){
      if (window.JSZip) return window.JSZip;
      await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      return window.JSZip;
    }
    async function dataUrl(zip, name) {
      try {
        const b64 = await zip.file(name).async("base64");
        const ext = (name.split(".").pop() || "png").toLowerCase();
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "svg" ? "image/svg+xml" : "image/png";
        return "data:" + mime + ";base64," + b64;
      } catch (e) { return null; }
    }
    function imgsHTML(list, max) {
      return (list || []).slice(0, max || 12).map(src => src ? `<div style="margin:12px 0"><img src="${src}" alt="" style="max-width:100%;border-radius:8px;border:1px solid #e6e2f2"></div>` : "").join("");
    }
    async function docxPages(file){
      try {
        const JSZip = await loadJSZip(); const zip = await JSZip.loadAsync(file);
        const xml = await zip.file("word/document.xml").async("string");
        const paras = [...xml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)].map(m => [...m[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(x => x[1]).join("")).filter(Boolean);
        const text = paras.join("\n").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
        const media = Object.keys(zip.files).filter(n => /^word\/media\//.test(n) && /\.(png|jpe?g|gif)$/i.test(n)).slice(0, 12);
        const imgs = [];
        for (const n of media) imgs.push(await dataUrl(zip, n));
        addPage("Документ", `<div class="bd-sheet"><h2>${esc(file.name)}</h2>${imgsHTML(imgs, 12)}<div style="white-space:pre-line;font-size:15px;line-height:1.55">${esc((text || "").slice(0, 20000))}</div></div>`, true);
        U.toast("Документ добавлен листом доски" + (imgs.length ? " (изображений: " + imgs.length + ")" : ""));
      } catch (e) { U.toast("Не удалось открыть документ: " + e.message); }
    }
    async function pptxPages(file){
      try {
        const JSZip = await loadJSZip(); const zip = await JSZip.loadAsync(file);
        const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => (+a.match(/\d+/)[0]) - (+b.match(/\d+/)[0]));
        let made = 0;
        for (const n of slides) {
          made++;
          const num = n.match(/slide(\d+)\.xml/)[1];
          const xml = await zip.file(n).async("string");
          const text = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map(x => x[1]).join("\n").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
          /* изображения слайда: r:embed -> rels -> media */
          const relName = "ppt/slides/_rels/slide" + num + ".xml.rels";
          let rels = "";
          try { rels = await zip.file(relName).async("string"); } catch (e) { }
          const map = {};
          [...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].forEach(m => { map[m[1]] = m[2]; });
          const ids = [...xml.matchAll(/r:embed="([^"]+)"/g)].map(m => m[1]);
          const imgs = [];
          for (const id of ids.slice(0, 6)) {
            const tgt = map[id]; if (!tgt) continue;
            const full = tgt.replace(/^\.\.\//, "ppt/");
            const src = await dataUrl(zip, full);
            if (src) imgs.push(src);
          }
          addPage("Слайд " + made, `<div class="bd-slide bd-pptx"><div class="bd-slide-in">${imgs.length ? `<div class="bd-slide-imgs">${imgsHTML(imgs, 4)}</div>` : ""}<div class="bd-slide-txt">${esc(text || "").split("\n").map((x, k) => k ? `<p>${x}</p>` : `<h2>${x}</h2>`).join("")}</div></div></div>`, true);
        }
        U.toast("Добавлено слайдов: " + made + ". Для точного вида сохраните презентацию как PDF или встройте ссылку Google Презентаций / Canva через 🌐.");
      } catch (e) { U.toast("Не удалось открыть презентацию: " + e.message); }
    }
    async function handleFiles(files){
      let y = 100;
      for (const f of files) {
        let items2 = [];
        if (/^image\//.test(f.type)) items2 = await imageFileToItems(f);
        else if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) items2 = await pdfToItems(f);
        else if (/^video\//.test(f.type)) items2 = await videoToItems(f);
        else if (/\.(docx)$/i.test(f.name)) { await docxPages(f); continue; }
        else if (/\.(pptx)$/i.test(f.name)) { await pptxPages(f); continue; }
        else { U.toast("Формат «" + f.name + "» пока не преобразуется в изображения. Прикрепите фото или PDF."); continue; }
        items2.forEach(it => { const hh = addImage(it.src, it.ratio, 40, y, 480); y += hh + 30; });
      }
      U.toast(items2LengthMsg);
    }
    let items2LengthMsg = "Материал добавлен на доску";
    root.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b || !root.contains(b)) return;
      if (b.dataset.act === "attach") fileInput.click();
      if (b.dataset.act === "embed"){
        if (root.querySelector(".bd-embedform")) return;
        const f = document.createElement("form"); f.className = "bd-embedform card";
        f.innerHTML = `<b>Встроить сайт на доску</b><p class="small muted" style="margin:4px 0 8px">Ссылка на Wordwall, YouTube, RuTube, Google Презентации, Canva или любую страницу, которая разрешает встраивание. Сайт появится отдельным листом у вас обоих.</p>
          <input name="u" placeholder="https://…" required style="width:100%"><div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap"><input name="l" placeholder="Название листа" style="flex:1;min-width:140px"><label class="small">Высота <input name="h" type="number" value="560" min="300" max="2400" step="20" style="width:90px"></label><button class="btn sm">Встроить</button><button type="button" class="btn ghost sm" data-x>Отмена</button></div>`;
        root.querySelector(".bd-bar").after(f); f.u.focus();
        f.addEventListener("submit", ev => { ev.preventDefault(); const key = embedPage(f.u.value, f.l.value || "Сайт", f.h.value); f.remove(); openPage(key); if (o.role === "teacher") send("page", {page: key}); setTool("touch"); });
        f.querySelector("[data-x]").onclick = () => f.remove();
      }
      if (b.dataset.act === "camera"){ const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.capture = "environment"; inp.onchange = () => inp.files?.length && handleFiles([...inp.files]); inp.click(); }
    });
    fileInput.addEventListener("change", () => { if (fileInput.files?.length) handleFiles([...fileInput.files]); fileInput.value = ""; });
    wrap.addEventListener("dragover", e => { e.preventDefault(); dropHint.style.display = "flex"; });
    wrap.addEventListener("dragleave", () => { dropHint.style.display = "none"; });
    wrap.addEventListener("drop", e => { e.preventDefault(); dropHint.style.display = "none"; if (e.dataTransfer?.files?.length) handleFiles([...e.dataTransfer.files]); });
    const onPaste = e => {
      if (!root.isConnected) return;
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); handleFiles(files); }
    };
    document.addEventListener("paste", onPaste);

    /* ---------- реальное время ---------- */
    function send(type, payload){ if (channel) channel.send({type:"broadcast", event:"ev", payload:{type, from:me, page, ...payload}}); }
    function sendPresence(){ if (channel) channel.track({id:me, name:o.name, role:o.role, page}).catch(() => {}); }
    function renderWho(){
      const list = [...peers.values()].filter(p => p.online);
      $(".bd-who").textContent = list.length ? "На доске: " + list.map(p => `${p.name} (${p.role === "teacher" ? "учитель" : "ученик"})`).join(", ") : (channel ? "Вы на доске одни" : "Доска без связи: рисунки сохраняются только у вас");
    }
    function cursorFor(id){
      let p = peers.get(id);
      if (!p){ p = {online:false}; peers.set(id, p); }
      if (!p.el){
        p.el = document.createElement("div"); p.el.className = "bd-cursor";
        p.el.innerHTML = `<svg viewBox="0 0 16 16" width="18" height="18"><path d="M1 1l5 14 2-6 6-2z" fill="currentColor" stroke="#fff" stroke-width="1"/></svg><span></span>`;
        curLayer.appendChild(p.el);
      }
      return p;
    }
    if (o.sb && o.channelName){
      channel = o.sb.channel(o.channelName, {config:{broadcast:{self:false}, presence:{key:me}}});
      channel.on("broadcast", {event:"ev"}, ({payload:m}) => {
        if (m.from === me) return;
        if (m.type === "addpage"){ if (!pagesArr.some(x => x.key === m.key)){ pagesArr.push({ key: m.key, label: m.label, html: m.html }); renderPageButtons(); } return; }
        if (m.type === "page" && o.role === "student"){ if (m.page !== page){ openPage(m.page); U.toast("Учитель открыл другой лист"); } return; }
        if (m.page !== page) return;
        if (m.type === "cursor"){
          const p = cursorFor(m.from); p.x = m.x; p.y = m.y;
          p.el.style.transform = `translate(${m.x * scale}px, ${m.y * scale}px)`; p.el.hidden = false;
          p.el.style.color = p.role === "teacher" ? "#ee5fa8" : "#7b4cf5";
          p.el.querySelector("span").dataset.n = p.name || "";
        }
        if (m.type === "draft"){
          const k = m.from + ":" + (m.sid || "");
          if (m.drop){ drafts.delete(k); redraw(); return; }
          const d = drafts.get(k) || {t:"s", c:m.c, w:m.w, h:m.h, p:[]};
          d.p.push(...m.p); drafts.set(k, d); if (m.end) setTimeout(() => { drafts.delete(k); redraw(); }, 1500); redraw();
        }
        if (m.type === "add"){ [...drafts.keys()].forEach(k => { if (k.startsWith(m.from + ":") && drafts.get(k).p.length >= (m.item.p?.length || 0) - 2) drafts.delete(k); }); items.set(m.id, m.item); redraw(); }
        if (m.type === "remove"){ m.ids.forEach(id => items.delete(id)); redraw(); }
        if (m.type === "clear"){ items.clear(); redraw(); }
      });
      channel.on("presence", {event:"sync"}, () => {
        const st = channel.presenceState();
        peers.forEach(p => p.online = false);
        Object.values(st).flat().forEach(x => { if (x.id === me) return; const p = cursorFor(x.id); Object.assign(p, {online:true, name:x.name, role:x.role, page:x.page}); });
        peers.forEach(p => { if (p.el) p.el.hidden = !p.online || p.page !== page; });
        renderWho();
      });
      channel.subscribe(s => { if (s === "SUBSCRIBED") sendPresence(); renderWho(); });
    }
    renderWho();

    const ro = new ResizeObserver(() => layout()); ro.observe(stage);
    setTool("pen"); setColor(COLORS[0]); openPage(page);
    /* сохранённые листы (презентации, встроенные сайты) – общие для учителя и ученика */
    (async () => {
      try {
        const list = await o.api.load("_pages");
        let added = false;
        list.forEach(r => { const it = r.item; if (it && it.t === "pg" && !pagesArr.some(x => x.key === it.key)){ pagesArr.push({key: it.key, label: it.label, html: it.html, dbId: r.id}); added = true; } });
        if (added){ renderPageButtons(); if (!pagesArr.some(x => x.key === page) || o.page === page) openPage(o.page && pagesArr.some(x => x.key === o.page) ? o.page : page); }
      } catch(_) {}
    })();
    return { setMenu(fn){ o.menu = fn; }, destroy(){ ro.disconnect(); menu?.remove(); document.removeEventListener("pointerdown", onDocDown, true); document.removeEventListener("keydown", onKey); document.removeEventListener("paste", onPaste); if (channel) o.sb.removeChannel(channel); }, relayout(){ layout(); }, page: () => page };
  }

  /* хранилище: Supabase (ученик – через функции, учитель – напрямую) или браузер */
  function api(kind, sb, ident){
    const lk = p => `${ident.lesson}:${p}`;
    if (!sb){
      const key = p => `oge-board-${ident.lesson}-${p}`;
      const get = p => { try { return JSON.parse(localStorage.getItem(key(p))) || []; } catch(_) { return []; } };
      const put = (p, v) => { try { localStorage.setItem(key(p), JSON.stringify(v)); } catch(_) {} };
      return {
        load: async p => get(p),
        add: async (p, item) => { const l = get(p), id = Date.now() + Math.random().toString(36).slice(2, 6); l.push({id, item}); put(p, l); return id; },
        remove: async (p, ids) => put(p, get(p).filter(r => !ids.includes(String(r.id)))),
        clear: async p => put(p, [])
      };
    }
    if (kind === "student") return {
      load: async p => { const {data, error} = await sb.rpc("board_load", {p_code: ident.code, p_lesson: lk(p)}); if (error) throw error; return data || []; },
      add: async (p, item) => { const {data, error} = await sb.rpc("board_add", {p_code: ident.code, p_lesson: lk(p), p_item: item}); if (error) throw error; return data; },
      remove: async (p, ids) => { if (!ids.length) return; await sb.rpc("board_remove", {p_code: ident.code, p_lesson: lk(p), p_ids: ids.map(Number)}); },
      clear: async () => {}
    };
    return {
      load: async p => { const {data, error} = await sb.from("board_items").select("id,item").eq("student_id", ident.studentId).eq("lesson_id", lk(p)).order("id"); if (error) throw error; return data; },
      add: async (p, item) => { const {data, error} = await sb.from("board_items").insert({student_id: ident.studentId, lesson_id: lk(p), item, author: "teacher"}).select("id").single(); if (error) throw error; return data.id; },
      remove: async (p, ids) => { if (!ids.length) return; await sb.from("board_items").delete().in("id", ids.map(Number)); },
      clear: async p => { await sb.from("board_items").delete().eq("student_id", ident.studentId).eq("lesson_id", lk(p)); }
    };
  }

  /* листы доски для занятия */
  function pages(course, l){
    if (l.free) return [{key:"p1", label:"Лист 1", html:`<div class="bd-sheet"></div>`}, {key:"p2", label:"Лист 2", html:`<div class="bd-sheet"></div>`},
      {key:"lined", label:"В линейку", html:`<div class="bd-sheet bd-lined"></div>`}, {key:"grid", label:"В клетку", html:`<div class="bd-sheet bd-grid"></div>`}];
    const out = [], noInputs = h => h.replace(/<button[\s\S]*?<\/button>/g, "").replace(/<input[^>]*>/g, '<span class="blank" style="min-width:160px"></span>');
    if (l.practice?.length) out.push({key:"practice", label:"Практика", html:`<div class="bd-sheet"><h2>${esc(l.title)}: практика</h2>${U.practiceHTML(l, false)}</div>`});
    if ((l.test || []).length) out.push({key:"test", label:"Тест", html:`<div class="bd-sheet"><h2>${esc(l.title)}: проверь себя</h2><ol>${(l.test || []).map(q => `<li style="margin-bottom:16px">${esc(q.q)}${q.o ? "<br><span style='font-size:15px;color:#555'>" + q.o.map((x, k) => (k + 1) + ") " + esc(x)).join("   ") + "</span>" : ""}<span class="blank"></span></li>`).join("")}</ol><p class="small muted">Ответы не показываются: проверка — в разделе «Тест» урока.</p></div>`});
    out.push({key:"theory", label:"Теория", html:`<div class="bd-sheet">${noInputs(U.theoryHTML(l))}</div>`});
    const w = l.writing, txt = w ? (w.type === "izl" ? course.izl?.[w.text] : course.texts?.[w.text]) : null;
    if (txt) out.push({key:"text", label:"Текст для письма", html:`<div class="bd-sheet"><h2>${esc(txt.title)}</h2>${w.type === "izl" ? txt.paras.map(p => `<p>${esc(p)}</p>`).join("") : `<p>${esc(txt.text)}</p>`}</div>`});
    (l.materials || []).forEach((m, i) => {
      if (m.kind === "text") out.push({key:"m" + m.id, label: m.title || "Материал " + (i + 1), html:`<div class="bd-sheet"><h2>${esc(m.title || "")}</h2><div style="white-space:pre-line">${esc(m.body || "")}</div></div>`});
      if (m.kind === "file" && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(m.url || "")) out.push({key:"m" + m.id, label: m.title || "Картинка", html:`<div class="bd-sheet"><h2>${esc(m.title || "")}</h2><img src="${esc(m.url)}" alt="" style="width:100%"></div>`});
      if (m.kind === "tasks" && (m.data?.mini?.length || m.data?.test?.length)) out.push({key:"m" + m.id, label: m.title || "Задания", html:`<div class="bd-sheet"><h2>${esc(m.title || "Задания")}</h2><ol>${[...(m.data.mini || []).map(x => x.q), ...(m.data.test || []).map(x => x.q + " " + x.o.map((o, k) => `${k + 1}) ${o}`).join("; "))].map(q => `<li style="margin-bottom:14px">${esc(q)}<span class="blank"></span></li>`).join("")}</ol></div>`});
    });
    out.push({key:"blank", label:"Чистый лист", html:`<div class="bd-sheet bd-lined"></div>`});
    return out;
  }

  /* доска не пересоздаётся при каждой перерисовке экрана: тот же лист, то же соединение */
  let kept = null;
  function keep(container, key, opts){
    if (!container) return null;
    if (kept && kept.key === key){ if (opts && "menu" in opts) kept.inst.setMenu(opts.menu); container.replaceChildren(kept.holder); requestAnimationFrame(() => kept && kept.inst.relayout()); return kept.inst; }
    release();
    const holder = document.createElement("div"); holder.className = "bd-holder"; container.replaceChildren(holder);
    const inst = mount(holder, opts); kept = {key, holder, inst}; return inst;
  }
  function release(){ if (kept){ try { kept.inst.destroy(); } catch(_) {} kept = null; } }
  const keptPage = () => kept?.inst.page();

  return {mount, api, pages, keep, release, keptPage};
})();
