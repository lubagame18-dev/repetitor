/* Общая доска: ученик и учитель видят курсоры и рисунки друг друга в реальном времени.
   Живое движение – Supabase Realtime (broadcast + presence), сохранение – таблица board_items.

   В этой версии дополнительно к v54 (сглаженные штрихи, частичный ластик, контекстное меню,
   снимок 📸, встраивание сайтов, живые листы урока, инструмент touch, доп. листы в "_pages"):
   * штрихи/курсоры/черновики привязываются к элементам листа (якорь {i,dx,dy,ox,oy,tag}) –
     подчёркивание остаётся на своём предложении при разном макете (фикс «выше/ниже»);
   * текст – окошко-редактор на pointerup (а не в pointerdown): textarea + ручка размера +
     «Готово», Enter – сохранить, Shift+Enter – новая строка, Esc – отмена;
   * вложения – диалог «Куда выгрузить материал?»: на этот лист (без наложений) или
     отдельными листами; html листа обрезается ≤55000, data-URL картинок ≤52000;
   * инструмент «Переместить» (✥) таскает картинки и надписи (api.add + api.remove + broadcast);
   * хуки для тестов: mount() возвращает info/whenIdle/attach/addPage/openPage. */
window.Board = (() => {
  const W = 800;                        // логическая ширина листа
  const COLORS = ["#24183d", "#7b4cf5", "#ee5fa8", "#1f9d55", "#d6334a"];
  const PAGE_KEY = "_pages";            // служебный ключ для дополнительных листов доски
  const PAGE_HTML_MAX = 55000;          // board_add у ученика ограничивает item 60000 символов
  const ITEM_MAX = 52000;               // с запасом для одной картинки-объекта
  const TEXT_FONT = "600 22px Manrope, system-ui, sans-serif";
  const TEXT_LINE = 28;
  const TEXT_MAX = 4000;
  const DEFAULT_TEXT_W = 260;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const rid = () => Math.random().toString(36).slice(2, 10);
  const toast = t => { try { if (window.U && typeof U.toast === "function") U.toast(t); } catch (_) {} };
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const oneLine = s => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

  function mount(root, o){
    // o: {api, channelName, sb, role, name, pages:[{key,label,html}], page, onPage, live, menu}
    o = o || {};
    const provided = (Array.isArray(o.pages) && o.pages.length)
      ? o.pages
      : [{key:"p1", label:"Лист 1", html:`<div class="bd-sheet"></div>`}];
    const pagesArr = provided.map(p => ({key:String(p.key), label:p.label || "Лист", html:p.html || "", saved:false}));
    let page = (o.page && pagesArr.some(p => p.key === String(o.page))) ? String(o.page) : pagesArr[0].key;

    let items = new Map();             // id -> item
    let mine = [];                     // id своих объектов для «Отменить»
    let tool = "pen", color = COLORS[0], drawing = null, moving = null, textTap = null;
    let scale = 1, height = 1400;
    let editor = null;                 // окошко-редактор текста
    let saving = 0, openTok = 0;
    let bdEls = [], bdBoxes = [], bdMap = new Map();
    let anchorsDirty = true, boxesDirty = true, lastScale = 0, lastBgH = -1;
    let readyDone = false, readyResolve = null;
    const readyP = new Promise(res => { readyResolve = res; });
    const peers = new Map();           // key -> {name, role, page, raw, color, el}
    const drafts = new Map();          // key -> stroke being drawn by peer
    const me = rid();
    let channel = null, lastCursor = 0, lastDraft = 0, draftBuf = [];
    const imgCache = new Map(); const pageCache = new Map();

    root.innerHTML = `
      <div class="bd-bar">
        <div class="bd-pages" role="group" aria-label="Лист доски"><button data-pstep="-1" title="Предыдущий лист" aria-label="Предыдущий лист">‹</button>${pagesArr.map(p => `<button data-bpage="${esc(p.key)}" aria-pressed="${p.key === page}">${esc(p.label)}</button>`).join("")}<button data-pstep="1" title="Следующий лист" aria-label="Следующий лист">›</button></div>
        <div class="bd-who small muted" aria-live="polite"></div>
      </div>
      <div class="bd-body"><div class="bd-side"><div class="bd-tools" role="group" aria-label="Инструменты">
          <button data-tool="pen" title="Ручка">✎</button>
          <button data-tool="hl" title="Маркер">▮</button>
          <button data-tool="text" title="Текст">T</button>
          <button data-tool="move" title="Переместить">✥</button>
          <button data-tool="erase" title="Ластик: стирает только то, по чему провести" aria-label="Ластик"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 17l8-8 6 6-4 4H6z" fill="#f48fb1" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M11 9l4-4 6 6-4 4" fill="#fff" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M13 19h8" stroke="currentColor" stroke-width="1.5"/></svg></button>
          <button data-tool="hand" title="Листать">✋</button>
          ${COLORS.map(c => `<button class="bd-color" data-color="${c}" style="--bc:${c}" aria-label="Цвет"></button>`).join("")}
          <button data-tool="touch" title="Работать с сайтом или презентацией (нажимать внутри)">👆</button>
          <button data-act="attach" title="Прикрепить файл (фото, PDF-презентация, документ)">📎</button>
          <button data-act="embed" title="Встроить сайт: Wordwall, YouTube, Google Презентации, Canva…">🌐</button>
          <button data-act="camera" title="Фото с камеры">📷</button>
          <button data-act="undo" title="Отменить своё последнее">↶</button>
          <button data-act="snap" title="Снимок листа: картинка с заданиями и всеми пометками">📸</button>
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

    /* ---------- координаты и якоря к элементам листа ----------
       Ученик подчёркивает предложение, у учителя лист свёрстан иначе (другие поля/шрифт/масштаб) –
       штрих должен остаться на том же элементе. Для этого штрих хранит якорь: индекс элемента
       в .bd-bg (data-bd), смещение точки от его угла (dx/dy) и сам угол (ox/oy) в момент рисования. */
    function markAnchors(){
      bdEls = Array.from(bg.querySelectorAll("*"));
      bdEls.forEach((el, i) => el.setAttribute("data-bd", String(i)));
      bdMap = new Map(); boxesDirty = true; anchorsDirty = false;
    }
    function measureAnchors(){
      bdMap = new Map();
      if (!bdEls.length){ bdBoxes = []; return; }
      const br = bg.getBoundingClientRect();
      bdBoxes = bdEls.map(el => {
        const r = el.getBoundingClientRect();
        const b = {el, x:(r.left - br.left) / scale, y:(r.top - br.top) / scale, w:r.width / scale, h:r.height / scale};
        const i = +el.getAttribute("data-bd");
        if (Number.isFinite(i)) bdMap.set(i, b);
        return b;
      });
    }
    function shiftFor(a){
      if (!a || a.i == null || !Number.isFinite(+a.i)) return [0, 0];
      const b = bdMap.get(+a.i);
      if (!b) return [0, 0];                    // якорь не найден – рисуем как есть
      /* если на этой стороне под тем же индексом другой тег – листы разошлись сильнее макета:
         оставляем штрих на абсолютном месте, чтобы он не «прыгнул» к чужому элементу */
      if (a.tag && b.el.tagName && b.el.tagName !== a.tag) return [0, 0];
      return [b.x - a.ox, b.y - a.oy];
    }
    function shiftedPoints(s){
      if (!s) return [];
      if (!s.a) return s.p || [];
      const [dx, dy] = shiftFor(s.a);
      if (!dx && !dy) return s.p || [];
      return (s.p || []).map(([x, y]) => [x + dx, y + dy]);
    }
    function anchorAt(p){
      let best = null, area = Infinity;
      for (const b of bdBoxes){
        if (b.w <= 0 && b.h <= 0) continue;
        if (p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h){
          const a = b.w * b.h;
          if (a < area){ area = a; best = b; }
        }
      }
      if (!best) return null;
      const i = +best.el.getAttribute("data-bd");
      if (!Number.isFinite(i)) return null;
      return {i, dx:+(p[0] - best.x).toFixed(2), dy:+(p[1] - best.y).toFixed(2), ox:+best.x.toFixed(2), oy:+best.y.toFixed(2), tag:best.el.tagName};
    }

    /* ---------- размеры и перерисовка ---------- */
    function layout(){
      const bar = root.querySelector(".bd-bar"), side = root.querySelector(".bd-side .bd-tools");
      if (bar && side){ const top = 66 + bar.offsetHeight + 6; side.style.top = `calc(${top}px + env(safe-area-inset-top,0px))`; side.style.maxHeight = `calc(100vh - ${top + 10}px)`; }
      const stageW = Math.max(0, Math.round(stage.clientWidth || root.clientWidth || 0));
      scale = stageW > 0 ? stageW / W : 1;
      bg.style.width = W + "px"; bg.style.transform = `scale(${scale})`;
      if (anchorsDirty) markAnchors();
      const bgH = bg.scrollHeight;
      if (boxesDirty || scale !== lastScale || bgH !== lastBgH){ measureAnchors(); boxesDirty = false; lastScale = scale; lastBgH = bgH; }
      let maxY = 0;
      items.forEach(it => {
        if (it.t === "s"){ for (const q of shiftedPoints(it)) if (q[1] > maxY) maxY = q[1]; }
        else if (it.t === "i"){ const [w2, h2] = imageSize(it); maxY = Math.max(maxY, it.y + h2); }
        else { maxY = Math.max(maxY, it.y + (it.h || textHeight(it))); }
      });
      height = Math.max(1400, bgH + 200, maxY + 300);
      const cssW = stageW > 0 ? stageW : W;
      wrap.style.height = height * scale + "px";
      wrap.style.width = cssW + "px";
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, Math.round(cssW * dpr));
      cv.height = Math.max(1, Math.round(height * scale * dpr));
      cv.style.width = cssW + "px";
      cv.style.height = height * scale + "px";
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      redraw();
      placeEditor();
      placeCursors();
    }
    /* после КАЖДОЙ установки innerHTML листа: разметить/перемерить якоря, дождаться картинок и шрифтов */
    function afterSheet(){
      markAnchors();
      bg.querySelectorAll("img").forEach(im => {
        if (!im.complete){
          im.addEventListener("load", () => { boxesDirty = true; layout(); }, {once:true});
          im.addEventListener("error", () => { boxesDirty = true; layout(); }, {once:true});
        }
      });
      requestAnimationFrame(() => { if (root.isConnected) layout(); });
      setTimeout(() => { if (root.isConnected){ boxesDirty = true; layout(); } }, 120);
      setTimeout(() => { if (root.isConnected){ boxesDirty = true; layout(); } }, 500);
      try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (root.isConnected){ boxesDirty = true; layout(); } }); } catch (_) {}
    }

    function drawSeg(a, b, s){
      const [sx, sy] = s.a ? shiftFor(s.a) : [0, 0];
      const P = s.p, n = P.length;
      ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = s.c; ctx.lineWidth = s.w; ctx.globalAlpha = s.h ? 0.35 : 1;
      if (n < 3){ ctx.beginPath(); ctx.moveTo(a[0] + sx, a[1] + sy); ctx.lineTo((a[0] + b[0]) / 2 + sx, (a[1] + b[1]) / 2 + sy); ctx.stroke(); ctx.restore(); return; }
      const p0 = P[n - 3], p1 = P[n - 2], p2 = P[n - 1];
      ctx.beginPath();
      ctx.moveTo((p0[0] + p1[0]) / 2 + sx, (p0[1] + p1[1]) / 2 + sy);
      ctx.quadraticCurveTo(p1[0] + sx, p1[1] + sy, (p1[0] + p2[0]) / 2 + sx, (p1[1] + p2[1]) / 2 + sy);
      ctx.stroke(); ctx.restore();
    }
    function drawStroke(s){
      const pts = shiftedPoints(s);
      if (!pts.length) return;
      ctx.save();
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = s.c; ctx.lineWidth = s.w; ctx.globalAlpha = s.h ? 0.35 : 1;
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.1, pts[0][1]);
      else if (pts.length === 2) ctx.lineTo(pts[1][0], pts[1][1]);
      else {   // плавная линия: кривые через середины соседних точек
        for (let i = 1; i < pts.length - 1; i++) ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      }
      ctx.stroke(); ctx.restore();
    }
    function wrapLines(text, maxW){
      const out = [];
      ctx.save();
      ctx.font = TEXT_FONT;
      for (const raw of String(text == null ? "" : text).split("\n")){
        if (!raw){ out.push(""); continue; }
        let line = "";
        for (const word of raw.split(" ")){
          const test = line ? line + " " + word : word;
          if (line && ctx.measureText(test).width > maxW){ out.push(line); line = word; }
          else line = test;
        }
        out.push(line);
      }
      ctx.restore();
      return out;
    }
    function textLines(t){ return wrapLines(t.s, t.w || DEFAULT_TEXT_W); }
    function textHeight(t){ return Math.max(TEXT_LINE, textLines(t).length * TEXT_LINE); }
    function drawText(t){
      const lines = textLines(t);
      ctx.save(); ctx.fillStyle = t.c || COLORS[0]; ctx.font = TEXT_FONT; ctx.textBaseline = "top";
      lines.forEach((line, i) => { if (line) ctx.fillText(line, t.x, t.y + i * TEXT_LINE); });
      ctx.restore();
    }
    function imageSize(it){ const w = it.w || 480; return [w, it.h || w / (it.ratio || 1.5)]; }
    function drawImageItem(it){
      const [w2, h2] = imageSize(it);
      const cached = imgCache.get(it.src);
      if (cached && cached.complete && cached.naturalWidth){ ctx.drawImage(cached, it.x, it.y, w2, h2); return; }
      if (!cached){ const im = new Image(); im.onload = () => redraw(); im.onerror = () => redraw(); im.src = it.src; imgCache.set(it.src, im); }
      ctx.save(); ctx.fillStyle = "#f1eefb"; ctx.fillRect(it.x, it.y, w2, h2); ctx.restore();
    }
    function redraw(){
      ctx.clearRect(0, 0, W, height + 50);
      items.forEach(it => { if (it.t === "s") drawStroke(it); else if (it.t === "i") drawImageItem(it); else if (it.t === "t") drawText(it); });
      drafts.forEach(d => drawStroke(d));
      if (drawing && !drawing.erase) drawStroke(drawing);
      placeCursors();
    }
    function pos(e){ const r = cv.getBoundingClientRect(); const s = scale || 1; return [Math.round((e.clientX - r.left) / s * 10) / 10, Math.round((e.clientY - r.top) / s * 10) / 10]; }

    /* ---------- hit-test по объектам ---------- */
    function itemBox(it){
      if (it.t === "i"){ const [w2, h2] = imageSize(it); return {x:it.x, y:it.y, w:w2, h:h2}; }
      if (it.t === "t"){ return {x:it.x, y:it.y, w:it.w || DEFAULT_TEXT_W, h:it.h || textHeight(it)}; }
      return null;
    }
    function contains(b, p){ return p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h; }
    function entriesTopFirst(){ const a = Array.from(items.entries()); a.reverse(); return a; }
    function hitOf(p, types){
      for (const [id, it] of entriesTopFirst()){
        if (types && types.indexOf(it.t) < 0) continue;
        if (it.t === "s"){
          if (!types) continue;
          continue;
        }
        const b = itemBox(it);
        if (b && contains(b, p)) return id;
      }
      return null;
    }
    function hitAny(p){
      for (const [id, it] of entriesTopFirst()){
        if (it.t === "s"){ for (const q of shiftedPoints(it)) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 14 + (it.w || 3)) return id; }
        else { const b = itemBox(it); if (b && contains(b, p)) return id; }
      }
      return null;
    }

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
      box.innerHTML = `<button data-pstep="-1" title="Предыдущий лист" aria-label="Предыдущий лист">‹</button>` +
        pagesArr.map(p => `<button data-bpage="${esc(p.key)}" aria-pressed="${p.key === page}">${esc(p.label)}</button>`).join("") +
        `<button data-pstep="1" title="Следующий лист" aria-label="Следующий лист">›</button>`;
    }
    /* «живые» листы: урок прямо на доске (теория, задания, тест, письмо) – отвечать можно в самом листе, рисовать – поверх */
    let live = o.live || {};
    function paintLive(force){
      const fn = live[page]; if (!fn) return false;
      if (!force && bg.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return true;
      const y = scrollY; try { fn(bg); } catch(e) { console.warn(e); } if (scrollY !== y) scrollTo(0, y); return true;
    }
    async function openPage(key){
      if (!pagesArr.length) return;
      key = String(key);
      if (!pagesArr.some(p => p.key === key)) key = pagesArr[0].key;
      if (editor) closeEditor(true);
      moving = null; textTap = null;
      if (page && page !== key) pageCache.set(page, [...items.entries()].filter(([id]) => !id.startsWith("tmp") && !id.startsWith("er")).map(([id, item]) => ({id, item})));
      const tok = ++openTok;
      page = key;
      renderPageButtons();
      const pg = pagesArr.find(p => p.key === key);
      if (!paintLive(true)) bg.innerHTML = pg ? pg.html : "";
      afterSheet();
      if (live[key]) setTool("touch");
      items = new Map(); mine = []; drafts.clear();
      const cached = pageCache.get(key);
      if (cached) { cached.forEach(r => { if (r && r.item) items.set(String(r.id), r.item); }); }
      layout();
      if (!cached) {
        try {
          const list = await o.api.load(key) || [];
          if (tok !== openTok || page !== key) return;
          list.forEach(r => {
            if (!r) return;
            const it = r.item || r;
            if (!it || !it.t) return;
            const id = r.id != null ? String(r.id) : "r" + rid();
            items.set(id, it);
          });
          pageCache.set(key, list);
          layout();
        } catch(_) {}
      }
      sendPresence();
      if (typeof o.onPage === "function"){ try { o.onPage(key); } catch (_) {} }
    }
    /* раскладка вложений без наложений: низ самого нижнего объекта + 30, первый – на y=100 */
    function nextFreeY(){
      let bottom = 0;
      items.forEach(it => {
        if (it.t === "i" || it.t === "t"){
          const b = itemBox(it);
          if (b) bottom = Math.max(bottom, b.y + b.h);
        }
      });
      return bottom > 0 ? Math.round(bottom + 30) : 100;
    }

    /* ---------- дополнительные листы (презентации, документы, сайты) ---------- */
    function fitPageHtml(html){
      let h = String(html || "");
      if (h.length <= PAGE_HTML_MAX) return h;
      h = h.replace(/<img\b[^>]*>/gi, `<span class="small muted">[изображение не поместилось на лист]</span>`);
      if (h.length <= PAGE_HTML_MAX) return h;
      const room = PAGE_HTML_MAX - 120;
      let cut = room;
      const lt = h.lastIndexOf("<", room);
      if (lt > 100) cut = lt;
      return h.slice(0, cut) + "\n</div>";
    }
    async function persistPage(p){
      if (!p || p.saved) return;
      saving++;
      try {
        /* html уже приведён к лимиту в addPageP; повторная проверка – на случай прямого вызова */
        const html = fitPageHtml(p.html);
        if (html !== p.html){ p.html = html; if (page === p.key){ if (!paintLive(true)) bg.innerHTML = html; afterSheet(); layout(); } }
        try {
          const id = await o.api.add(PAGE_KEY, {t:"pg", key:p.key, label:p.label, html:p.html});
          p.saved = true; p.dbId = id;
        } catch (e1){
          const minimal = `<div class="bd-sheet"><h2>${esc(p.label)}</h2><p class="small muted">Материал слишком большой, чтобы сохраниться целиком.</p></div>`;
          try {
            const id = await o.api.add(PAGE_KEY, {t:"pg", key:p.key, label:p.label, html:minimal});
            p.saved = true; p.dbId = id; p.html = minimal;
            if (page === p.key){ if (!paintLive(true)) bg.innerHTML = minimal; afterSheet(); layout(); }
            /* у второй стороны уже мог быть более полный html – синхронизируем тем же ключом */
            if (p.broadcast) send("addpage", {key:p.key, label:p.label, html:minimal, update:true});
            toast("Лист слишком большой: сохранена краткая версия.");
          } catch (e2){
            toast("Лист доски не сохранится после перезагрузки: " + oneLine(e2 && e2.message || "нет связи"));
          }
        }
      } finally { saving--; }
    }
    function addPageP(label, html, broadcast){
      const key = "x" + Date.now().toString(36) + rid().slice(0, 3);
      /* обрезаем СИНХРОННО до push/broadcast: у обеих сторон должен быть один и тот же html */
      const clean = fitPageHtml(String(html || ""));
      const p = {key, label: String(label || "Лист").slice(0, 24), html: clean, saved: false, broadcast: !!broadcast};
      pagesArr.push(p);
      renderPageButtons();
      persistPage(p);
      if (broadcast) send("addpage", {key, label: p.label, html: clean});
      return key;
    }
    async function syncPages(){
      let rows = [];
      try { rows = await o.api.load(PAGE_KEY) || []; } catch (_) { return; }
      rows.forEach(r => {
        if (!r) return;
        const it = r.item || r;
        if (!it || (it.t !== "pg" && it.t !== "page") || !it.key) return;
        const ex = pagesArr.find(p => p.key === String(it.key));
        if (ex){ ex.saved = true; if (!ex.html && it.html) ex.html = String(it.html); return; }
        pagesArr.push({key:String(it.key), label:it.label || "Лист", html:String(it.html || ""), saved:true});
      });
      renderPageButtons();
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
      return addPageP(label || "Сайт", `<div class="bd-sheet bd-embed"><iframe src="${esc(src)}" style="width:100%;height:${hh}px;border:0;border-radius:12px;background:#fff" allow="autoplay; fullscreen; clipboard-write; encrypted-media; picture-in-picture" allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe><p class="small muted" style="margin-top:6px">Чтобы нажимать внутри сайта, выберите 👆 «Работать с сайтом». Чтобы рисовать поверх – ручку ✎.</p></div>`, true);
    }

    /* ---------- рисование ---------- */
    function setTool(t){
      tool = t;
      root.querySelectorAll("[data-tool]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tool === t)));
      cv.style.touchAction = t === "hand" ? "pan-y" : "none";
      cv.style.cursor = t === "hand" ? "grab" : t === "text" ? "text" : t === "move" ? "move" : t === "erase" ? `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'32\' height=\'32\'><circle cx=\'16\' cy=\'16\' r=\'12\' fill=\'rgba(255,255,255,.6)\' stroke=\'%23555\' stroke-width=\'1.5\'/></svg>').replace(/%2523/g, "%23")}") 16 16, cell` : "crosshair";
      cv.style.pointerEvents = t === "touch" ? "none" : "";
      bg.style.pointerEvents = t === "touch" ? "auto" : "";
    }
    function setColor(c){ color = c; root.querySelectorAll("[data-color]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.color === c))); }

    async function addItem(item){
      const pg = page;
      const tmp = "tmp" + rid();
      items.set(tmp, item); redraw();
      saving++;
      try {
        const id = String(await o.api.add(pg, item));
        items.delete(tmp);
        if (page === pg){ items.set(id, item); mine.push(id); layout(); }
        else redraw();
        send("add", {id, item, page:pg});
      } catch(_) {
        items.delete(tmp); redraw();
        toast("Не сохранилось на доске. Проверьте интернет.");
      } finally { saving--; }
    }
    async function removeRow(pg, id){
      for (let i = 0; i < 2; i++){
        try { await o.api.remove(pg, [id]); return true; }
        catch (_) { if (i === 0) await delay(600); }
      }
      return false;
    }
    async function removeIds(ids){
      if (!ids || !ids.length) return;
      const pg = page;
      ids.forEach(id => items.delete(String(id)));
      redraw(); layout();
      saving++;
      try { await o.api.remove(pg, ids.filter(id => !String(id).startsWith("tmp"))); } catch(_) {}
      finally { saving--; }
      send("remove", {ids, page:pg});
    }
    /* заменить объект: сначала сохраняем новую позицию, потом убираем старую (ретрай) */
    async function replaceItem(oldId, newItem, fallback){
      const pg = page;
      oldId = String(oldId);
      const old = items.get(oldId);
      if (!old){ await addItem(newItem); return; }
      if (oldId.startsWith("tmp")){ items.set(oldId, newItem); redraw(); layout(); return; }
      let newId;
      saving++;
      try {
        try { newId = String(await o.api.add(pg, newItem)); }
        catch (_) {
          if (items.has(oldId)){ items.set(oldId, fallback || old); redraw(); }
          toast("Не удалось сохранить. Объект остался на прежнем месте.");
          return;
        }
        if (page === pg){
          items.delete(oldId); items.set(newId, newItem); mine.push(newId);
          redraw(); layout();
        }
        const ok = await removeRow(pg, oldId);
        send("move", {id:oldId, newId, item:newItem, page:pg});
        if (!ok) toast("Старая копия могла остаться на доске.");
      } finally { saving--; }
    }

    /* ---------- окошко-редактор текста ---------- */
    function openEditor(opts){
      opts = opts || {};
      if (editor) closeEditor(true);
      const startX = opts.x != null ? opts.x : 40;
      const startY = opts.y != null ? opts.y : 40;
      const startW = opts.w || DEFAULT_TEXT_W;
      const startH = opts.h || TEXT_LINE * 3;
      const stageW = stage.clientWidth || 360;
      const el = document.createElement("div");
      el.className = "bd-editor";
      el.innerHTML = `<textarea class="bd-editor-ta" placeholder="Текст… (Enter – готово, Shift+Enter – новая строка)" aria-label="Текст на доске"></textarea>` +
        `<div class="bd-editor-tools"><button type="button" data-ed="done">Готово</button></div>` +
        `<span class="bd-editor-handle" title="Изменить размер"></span>`;
      wrap.appendChild(el);
      const ta = el.querySelector("textarea");
      ta.value = opts.s || "";
      let cssW = Math.round(startW * scale);
      cssW = Math.min(Math.max(cssW, 140), Math.max(140, stageW - 16));
      let cssH = Math.max(70, Math.round(startH * scale));
      el.style.width = cssW + "px";
      el.style.height = cssH + "px";
      el.style.left = Math.max(0, Math.min(Math.round(startX * scale), Math.max(0, stageW - cssW - 8))) + "px";
      el.style.top = Math.max(0, Math.round(startY * scale)) + "px";
      const ed = {
        el, ta, id: opts.id || null, c: opts.c || color,
        x: (parseFloat(el.style.left) || 0) / scale,
        y: (parseFloat(el.style.top) || 0) / scale,
        w: cssW / scale, h: cssH / scale,
        closed: false, armed: false, innerDown: false
      };
      editor = ed;
      try { ta.style.fontSize = Math.max(16, Math.min(26, Math.round(22 * scale))) + "px"; } catch (_) {}
      const stop = e => { e.stopPropagation(); };
      ["pointerdown", "mousedown", "click", "dblclick", "touchstart", "wheel"].forEach(t => el.addEventListener(t, stop, {passive:false}));
      /* нажатия внутри окошка (ручка, кнопка, сам textarea) не должны его закрывать */
      el.addEventListener("pointerdown", e => { ed.innerDown = true; e.stopPropagation(); });
      el.addEventListener("pointerup", () => { ed.innerDown = false; });
      el.addEventListener("pointercancel", () => { ed.innerDown = false; });
      el.addEventListener("keydown", e => e.stopPropagation());
      ta.addEventListener("keydown", e => {
        if (e.isComposing) return;
        if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey){ e.preventDefault(); closeEditor(true); }
        else if (e.key === "Escape"){ e.preventDefault(); closeEditor(false); }
      });
      ta.addEventListener("blur", () => {
        setTimeout(() => {
          if (editor !== ed || ed.closed) return;
          /* потеря фокуса из-за нажатия внутри окошка – возвращаем фокус, не закрываем */
          if (ed.innerDown || el.contains(document.activeElement)){
            if (ed.innerDown){ ed.innerDown = false; try { ta.focus({preventScroll:true}); } catch (_) {} }
            return;
          }
          closeEditor(ed.armed);
        }, 0);
      });
      const doneBtn = el.querySelector("[data-ed=done]");
      doneBtn.addEventListener("pointerdown", stop);
      doneBtn.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); closeEditor(true); });
      /* ручка изменения размера */
      const handle = el.querySelector(".bd-editor-handle");
      let rs = null;
      handle.addEventListener("pointerdown", e => {
        e.preventDefault(); e.stopPropagation();
        rs = {sx:e.clientX, sy:e.clientY, w:el.offsetWidth, h:el.offsetHeight};
        try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      });
      handle.addEventListener("pointermove", e => {
        if (!rs) return;
        const w = Math.max(140, Math.round(rs.w + e.clientX - rs.sx));
        const h = Math.max(70, Math.round(rs.h + e.clientY - rs.sy));
        el.style.width = w + "px"; el.style.height = h + "px";
        if (editor === ed){ ed.w = w / scale; ed.h = h / scale; }
      });
      const endResize = e => {
        if (!rs) return; rs = null;
        try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
        if (editor === ed){ try { ta.focus({preventScroll:true}); } catch (_) {} }
      };
      handle.addEventListener("pointerup", endResize);
      handle.addEventListener("pointercancel", endResize);
      /* фокус: сразу и ещё раз в requestAnimationFrame (на телефоне клавиатура открывается из жеста) */
      const tryFocus = () => {
        try { ta.focus({preventScroll:true}); } catch (_) { try { ta.focus(); } catch (_) {} }
      };
      tryFocus();
      if (document.activeElement === ta) ed.armed = true;
      const later = (n) => requestAnimationFrame(() => {
        if (editor !== ed || ed.closed) return;
        if (!ed.armed) tryFocus();
        if (document.activeElement === ta){ ed.armed = true; try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_) {} }
        else if (n > 0) setTimeout(() => later(n - 1), 40);
      });
      later(3);
    }
    function closeEditor(save){
      const ed = editor;
      if (!ed) return;
      editor = null; ed.closed = true;
      const x = Math.round((parseFloat(ed.el.style.left) || 0) / scale);
      const y = Math.round((parseFloat(ed.el.style.top) || 0) / scale);
      const w2 = Math.max(80, Math.round(ed.el.offsetWidth / scale));
      const h2 = Math.max(40, Math.round(ed.el.offsetHeight / scale));
      const text = String(ed.ta.value || "").trim();
      try { ed.el.remove(); } catch (_) {}
      if (!save) return;
      if (text){
        const item = {t:"t", x, y, w:w2, h:h2, s:text.slice(0, TEXT_MAX), c:ed.c};
        if (ed.id && items.has(String(ed.id))) replaceItem(ed.id, item, items.get(String(ed.id)));
        else addItem(item);
      } else if (ed.id && items.has(String(ed.id))){
        removeIds([ed.id]);
      }
    }
    function placeEditor(){
      if (!editor) return;
      const stageW = stage.clientWidth || 360;
      const cssW = Math.max(140, Math.round(editor.w * scale));
      const cssH = Math.max(70, Math.round(editor.h * scale));
      editor.el.style.width = cssW + "px";
      editor.el.style.height = cssH + "px";
      editor.el.style.left = Math.max(0, Math.min(Math.round(editor.x * scale), Math.max(0, stageW - cssW - 8))) + "px";
      editor.el.style.top = Math.max(0, Math.round(editor.y * scale)) + "px";
    }

    /* ---------- перемещение объектов ---------- */
    async function commitMove(mv){
      const it = items.get(mv.id);
      if (!it) return;
      const nx = Math.round(it.x), ny = Math.round(it.y);
      if (!mv.moved || (nx === Math.round(mv.orig.x) && ny === Math.round(mv.orig.y))){ redraw(); return; }
      const fallback = Object.assign({}, it, {x:mv.orig.x, y:mv.orig.y});
      await replaceItem(mv.id, Object.assign({}, it, {x:nx, y:ny}), fallback);
    }

    /* ---------- указатели ---------- */
    /* рисует только один указатель: второй палец, ладонь при стилусе и правая кнопка мыши не дают «зигзагов» */
    let penSeen = 0, lp = null;
    const lpClear = () => { if (lp){ clearTimeout(lp.timer); lp = null; } };
    cv.addEventListener("contextmenu", e => { e.preventDefault(); openMenu(e.clientX, e.clientY); });
    cv.addEventListener("pointerdown", e => {
      closeMenu();
      if (e.pointerType === "pen") penSeen = Date.now();
      if (e.button === 2 || (e.buttons & 2) || (e.pointerType === "pen" && (e.buttons & 32))){ e.preventDefault(); end(); openMenu(e.clientX, e.clientY); return; }
      if (e.pointerType === "touch" && Date.now() - penSeen < 4000) return;   // ладонь, пока пишут стилусом
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (drawing && drawing.pid !== e.pointerId){ end(); return; }         // второй палец – это не рисунок
      if (tool === "hand") return;
      const p = pos(e);
      lpClear();
      if (e.pointerType !== "mouse"){ const x = e.clientX, y = e.clientY; lp = {x, y, timer: setTimeout(() => { lp = null; cancelStroke(); openMenu(x, y); }, 550)}; }
      if (tool === "text"){   // редактор создаётся на pointerup: в pointerdown фокус теряется
        lpClear();
        textTap = {x:p[0], y:p[1], cx:e.clientX, cy:e.clientY};
        try { cv.setPointerCapture(e.pointerId); } catch(_) {}
        return;
      }
      if (tool === "move"){
        const id = hitOf(p, ["i", "t"]);
        if (!id) return;
        e.preventDefault(); lpClear();
        const it = items.get(id); if (!it) return;
        moving = {id, sx:p[0], sy:p[1], ox:it.x, oy:it.y, orig:{x:it.x, y:it.y}, moved:false};
        try { cv.setPointerCapture(e.pointerId); } catch(_) {}
        return;
      }
      try { cv.setPointerCapture(e.pointerId); } catch(_) {}
      if (tool === "erase"){ drawing = {erase:true, pid:e.pointerId, gone:new Set(), made:new Map()}; eraseAt(p); return; }
      drawing = {t:"s", c: tool === "hl" ? "#ffd23f" : color, w: tool === "hl" ? 18 : 3, h: tool === "hl", p:[p], pid:e.pointerId, sid: rid().slice(0, 6), a: anchorAt(p)};
      draftBuf = [p];
    });
    cv.addEventListener("pointermove", e => {
      const p = pos(e), now = performance.now();
      if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 8) lpClear();
      if (now - lastCursor > 45 && (!drawing || drawing.pid === e.pointerId)){ lastCursor = now; send("cursor", {x:p[0], y:p[1], a:anchorAt(p)}); }
      if (moving){
        const it = items.get(moving.id);
        if (!it){ moving = null; return; }
        const nx = Math.round(moving.ox + (p[0] - moving.sx));
        const ny = Math.round(moving.oy + (p[1] - moving.sy));
        if (nx !== it.x || ny !== it.y){ it.x = nx; it.y = ny; moving.moved = true; redraw(); }
        return;
      }
      if (!drawing || drawing.pid !== e.pointerId) return;
      if (drawing.erase){ (e.getCoalescedEvents ? e.getCoalescedEvents() : [e]).forEach(ev => eraseAt(pos(ev))); return; }
      let pts = (e.getCoalescedEvents ? e.getCoalescedEvents() : []).map(pos); if (!pts.length) pts.push(p);
      if (e.pointerType === "mouse"){   // мышь и тачпад: сглаживаем дрожание руки
        let prev = drawing.p[drawing.p.length - 1]; pts = pts.map(q => (prev = [Math.round((prev[0] + (q[0] - prev[0]) * 0.55) * 10) / 10, Math.round((prev[1] + (q[1] - prev[1]) * 0.55) * 10) / 10]));
      }
      for (const q of pts){
        const last = drawing.p[drawing.p.length - 1];
        if (Math.hypot(q[0] - last[0], q[1] - last[1]) < 1.5) continue;
        if (Math.hypot(q[0] - last[0], q[1] - last[1]) > 260) continue;      // случайный скачок указателя – пропускаем
        drawing.p.push(q); draftBuf.push(q); drawSeg(last, q, drawing);
      }
      if (drawing.p.length > 1500) drawing.p = drawing.p.filter((_, i2) => i2 % 2 === 0 || i2 === drawing.p.length - 1);
      if (now - lastDraft > 50 && draftBuf.length > 1){ lastDraft = now; send("draft", {sid:drawing.sid, c:drawing.c, w:drawing.w, h:drawing.h, p:draftBuf, a:drawing.a}); draftBuf = [draftBuf[draftBuf.length - 1]]; }
    });
    /* ластик стирает только то, по чему провели: линия делится на куски, стёртое пропадает */
    const ER = 12;
    function eraseAt(pt){
      const d = drawing; if (!d?.erase) return; let changed = false;
      const drop = id => { items.delete(id); if (id.startsWith("er")) d.made.delete(id); else d.gone.add(id); changed = true; };
      [...items.entries()].forEach(([id, it]) => {
        if (it.t !== "s") return;
        /* штрих с якорем сдвинут к текущему положению элемента – проверяем в его координатах */
        const [dx, dy] = it.a ? shiftFor(it.a) : [0, 0];
        const rx = pt[0] - dx, ry = pt[1] - dy;
        const r2 = (ER + (it.w || 3) / 2) ** 2;
        if (!it.p.some(q => (q[0] - rx) ** 2 + (q[1] - ry) ** 2 < r2)) return;
        const runs = []; let cur = [];
        it.p.forEach(q => { if ((q[0] - rx) ** 2 + (q[1] - ry) ** 2 < r2){ if (cur.length) runs.push(cur); cur = []; } else cur.push(q); }); if (cur.length) runs.push(cur);
        drop(id);
        runs.filter(x => x.length > 1).forEach(pp => { const nid = "er" + rid(), ni = {...it, p: pp}; items.set(nid, ni); d.made.set(nid, ni); });
      });
      const other = hitOf(pt, ["i", "t"]); if (other) drop(other);   // надпись или картинка – целиком
      if (changed) redraw();
    }
    async function eraseCommit(d){
      if (!d.gone.size && !d.made.size) return;
      const gone = [...d.gone]; if (gone.length) await removeIds(gone);
      for (const [nid, it] of d.made){ items.delete(nid); await addItem(it); }
      redraw();
    }
    function cancelStroke(){ if (drawing && !drawing.erase) send("draft", {sid:drawing.sid, p:[], end:true, drop:true}); drawing = null; redraw(); }
    function end(e){
      if (e && drawing && drawing.pid !== e.pointerId) return;
      lpClear();
      if (moving){
        const mv = moving; moving = null;
        commitMove(mv);
        return;
      }
      if (textTap){
        const t = textTap; textTap = null;
        if (!e || e.type === "pointercancel") return;
        const cx = e.clientX != null ? e.clientX : t.cx;
        const cy = e.clientY != null ? e.clientY : t.cy;
        if (Math.abs(cx - t.cx) > 10 || Math.abs(cy - t.cy) > 10) return;   // это был свайп, не клик
        if (editor){ closeEditor(true); return; }
        const hitId = hitOf([t.x, t.y], ["t"]);
        if (hitId){
          const it = items.get(hitId);
          if (it){ openEditor({x:it.x, y:it.y, w:it.w, h:it.h, s:it.s, c:it.c, id:hitId}); return; }
        }
        openEditor({x:t.x, y:t.y});
        return;
      }
      if (!drawing) return;
      const d = drawing; drawing = null;
      if (d.erase){ eraseCommit(d); return; }
      send("draft", {sid:d.sid, c:d.c, w:d.w, h:d.h, p:draftBuf, a:d.a, end:true});
      delete d.pid; delete d.sid;
      if (d.p.length) addItem(d);
    }
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", () => { moving = null; textTap = null; drawing = null; });
    cv.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") end(e); });

    /* снимок листа: всё, что на нём – задания, ответы, пометки ручкой */
    async function snapshot(){
      try {
        if (!window.html2canvas) await new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
        U.toast("Делаю снимок…");
        const shot = await window.html2canvas(wrap, {backgroundColor: "#fff", scale: Math.min(2, window.devicePixelRatio || 1), useCORS: true, logging: false});
        const label = (pagesArr.find(p => p.key === page)?.label || "лист").replace(/[\\/:*?"<>|]/g, "");
        const a = document.createElement("a"); a.href = shot.toDataURL("image/png"); a.download = `Доска – ${label} – ${new Date().toLocaleString("ru-RU").replace(/[:,]/g, "-")}.png`; a.click();
      } catch(_) { U.toast("Не получилось сделать снимок. Можно сделать снимок экрана: Win + Shift + S."); }
    }
    /* ---------- быстрая панель: правая кнопка мыши, кнопка стилуса или долгое нажатие ---------- */
    const menu = root.querySelector(".bd-menu");
    function openMenu(x, y){
      const extra = typeof o.menu === "function" ? (o.menu() || []) : [];
      const titles = {pen:"Ручка", hl:"Маркер", text:"Текст", move:"Переместить", erase:"Ластик", hand:"Листать"};
      const icons = {pen:"✎", hl:"▮", text:"T", move:"✥", erase:'<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 17l8-8 6 6-4 4H6z" fill="#f48fb1" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M11 9l4-4 6 6-4 4" fill="#fff" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M13 19h8" stroke="currentColor" stroke-width="1.5"/></svg>', hand:"✋"};
      menu.innerHTML = `<div class="bd-mrow">${["pen","hl","text","move","erase","hand"].map(t => `<button data-mtool="${t}" aria-pressed="${tool === t}" title="${titles[t]}">${icons[t]}</button>`).join("")}</div>
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

    root.addEventListener("click", async e => {
      const b = e.target.closest("button"); if (!b || !root.contains(b)) return;
      if (b.dataset.pstep){ stepPage(+b.dataset.pstep); return; }
      if (b.dataset.bpage){ openPage(b.dataset.bpage); if (o.role === "teacher") send("page", {page:b.dataset.bpage}); }
      if (b.dataset.tool) setTool(b.dataset.tool);
      if (b.dataset.color){ setColor(b.dataset.color); if (tool !== "pen" && tool !== "text") setTool("pen"); }
      if (b.dataset.act === "undo"){ const id = mine.pop(); if (id) removeIds([id]); }
      if (b.dataset.act === "snap") snapshot();
      if (b.dataset.act === "clear"){
        if (b.dataset.sure){ await o.api.clear(page); items.clear(); mine = []; redraw(); layout(); send("clear", {}); b.textContent = "🧹"; delete b.dataset.sure; }
        else { b.dataset.sure = "1"; b.textContent = "✔?"; b.title = "Нажмите ещё раз, чтобы очистить лист"; setTimeout(() => { b.textContent = "🧹"; delete b.dataset.sure; }, 3000); }
      }
    });

    /* ---------- вложения: файлы, буфер обмена, перетаскивание ---------- */
    const fileInput = document.createElement("input");
    fileInput.type = "file"; fileInput.multiple = true; fileInput.accept = "image/*,application/pdf,video/*,.docx,.pptx"; fileInput.style.display = "none";
    root.appendChild(fileInput);
    const dropHint = document.createElement("div"); dropHint.className = "bd-drop"; dropHint.textContent = "Отпустите файл — он появится на доске";
    wrap.appendChild(dropHint);

    /* диалог «Куда выгрузить материал?» */
    const dlg = document.createElement("div");
    dlg.className = "bd-dialog"; dlg.hidden = true;
    dlg.innerHTML = `<div class="bd-dialog-card" role="dialog" aria-modal="true" aria-label="Куда выгрузить материал">
      <h3>Куда выгрузить материал?</h3>
      <p class="bd-dialog-note">Можно положить картинками на текущий лист или сохранить отдельными листами доски.</p>
      <div class="bd-dialog-files"></div>
      <div class="bd-dialog-actions">
        <button type="button" data-bd-dest="inline">На этот лист</button>
        <button type="button" data-bd-dest="pages">Отдельными листами</button>
        <button type="button" data-bd-dest="cancel" class="bd-dialog-cancel">Отмена</button>
      </div></div>`;
    root.appendChild(dlg);
    function askDestination(files){
      return new Promise(resolve => {
        const filesBox = dlg.querySelector(".bd-dialog-files");
        if (filesBox) filesBox.innerHTML = files.map(f => `<div>${esc(f.name || "файл")}</div>`).join("");
        dlg.hidden = false;
        let done = false;
        const finish = val => {
          if (done) return; done = true;
          dlg.hidden = true;
          dlg.removeEventListener("click", onClick);
          document.removeEventListener("keydown", onKey, true);
          resolve(val);
        };
        const onClick = e => {
          const b = e.target.closest && e.target.closest("[data-bd-dest]");
          if (!b){ if (e.target === dlg) finish(null); return; }
          finish(b.dataset.bdDest === "cancel" ? null : b.dataset.bdDest);
        };
        const onKey = e => { if (e.key === "Escape"){ e.stopPropagation(); finish(null); } };
        dlg.addEventListener("click", onClick);
        document.addEventListener("keydown", onKey, true);
      });
    }

    function loadScript(src){
      return new Promise((res, rej) => {
        if (document.querySelector('script[src="' + src + '"]')) return res();
        const s = document.createElement("script"); s.src = src;
        s.onload = res; s.onerror = () => rej(new Error("не загрузился модуль"));
        document.head.appendChild(s);
      });
    }
    async function loadJSZip(){
      if (window.JSZip) return window.JSZip;
      await loadScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js");
      return window.JSZip;
    }
    /* подбираем JPEG так, чтобы data-URL влез в лимит одного объекта board_items */
    function fitDataUrl(cv2, maxChars, maxW){
      let c = cv2;
      const k = Math.min(1, (maxW || 1600) / c.width);
      if (k < 1){
        const c2 = document.createElement("canvas");
        c2.width = Math.max(1, Math.round(c.width * k)); c2.height = Math.max(1, Math.round(c.height * k));
        c2.getContext("2d").drawImage(c, 0, 0, c2.width, c2.height); c = c2;
      }
      let last = c.toDataURL("image/jpeg", 0.82);
      if (last.length <= maxChars) return last;
      for (const q of [0.72, 0.62, 0.52, 0.42, 0.32]){
        last = c.toDataURL("image/jpeg", q);
        if (last.length <= maxChars) return last;
      }
      let w = c.width, h = c.height;
      for (let i = 0; i < 7 && last.length > maxChars; i++){
        w = Math.max(120, Math.round(w * 0.8)); h = Math.max(90, Math.round(h * 0.8));
        const c2 = document.createElement("canvas"); c2.width = w; c2.height = h;
        c2.getContext("2d").drawImage(c, 0, 0, w, h); c = c2;
        last = c.toDataURL("image/jpeg", 0.7);
      }
      return last;
    }
    async function imageFileToItems(file){
      const url = URL.createObjectURL(file);
      try {
        const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("bad image")); i.src = url; });
        const k = Math.min(1, 1600 / im.width);
        const c2 = document.createElement("canvas");
        c2.width = Math.max(1, Math.round(im.width * k)); c2.height = Math.max(1, Math.round(im.height * k));
        c2.getContext("2d").drawImage(im, 0, 0, c2.width, c2.height);
        return [{src: fitDataUrl(c2, ITEM_MAX, 1600), ratio: im.width / im.height}];
      } catch (_) { toast("Не удалось открыть изображение"); return []; }
      finally { URL.revokeObjectURL(url); }
    }
    async function pdfToImages(file, budget, limit){
      try {
        if (!window.pdfjsLib) await loadScript("https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js");
        if (!window.pdfjsLib) throw new Error("PDF-модуль не загрузился (нет интернета)");
        const buf = await file.arrayBuffer();
        const doc = await pdfjsLib.getDocument({data:buf}).promise;
        const out = []; const n = Math.min(doc.numPages, limit || 8);
        for (let i = 1; i <= n; i++){
          const pg = await doc.getPage(i), vp = pg.getViewport({scale:1.4});
          const c2 = document.createElement("canvas");
          c2.width = Math.max(1, Math.round(vp.width)); c2.height = Math.max(1, Math.round(vp.height));
          await pg.render({canvasContext:c2.getContext("2d"), viewport:vp}).promise;
          out.push({src: fitDataUrl(c2, budget || ITEM_MAX, 1600), ratio: c2.width / c2.height});
        }
        return out;
      } catch (e) { toast("PDF не удалось открыть: " + oneLine(e && e.message)); return []; }
    }
    async function videoFrames(file, maxChars){
      const url = URL.createObjectURL(file);
      try {
        const v = document.createElement("video"); v.src = url; v.muted = true; v.playsInline = true;
        await new Promise(res => { v.onloadedmetadata = res; setTimeout(res, 2500); });
        const shots = [];
        for (const t of [0.5, Math.min(2, v.duration || 1), Math.min(4, v.duration || 2)]){
          await new Promise(res => { v.onseeked = res; try { v.currentTime = Math.max(0, Math.min(t, (v.duration || 1) - 0.05)); } catch (_) {} setTimeout(res, 900); });
          const c2 = document.createElement("canvas"); c2.width = v.videoWidth || 640; c2.height = v.videoHeight || 360;
          c2.getContext("2d").drawImage(v, 0, 0, c2.width, c2.height);
          shots.push({src: fitDataUrl(c2, maxChars || ITEM_MAX, 1200), ratio: c2.width / c2.height});
        }
        return shots;
      } catch (_) { return []; }
      finally { URL.revokeObjectURL(url); }
    }
    function imgsHTML(list, max){
      return (list || []).slice(0, max || 12).map(src => src ? `<div style="margin:12px 0"><img src="${src}" alt="" style="max-width:100%;border-radius:8px;border:1px solid #e6e2f2"></div>` : "").join("");
    }
    async function zipImage(zip, name, maxChars){
      try {
        const b64 = await zip.file(name).async("base64");
        const ext = (name.split(".").pop() || "png").toLowerCase();
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "svg" ? "image/svg+xml" : "image/png";
        const raw = "data:" + mime + ";base64," + b64;
        if (raw.length <= maxChars || mime === "image/svg+xml") return raw;
        const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("img")); i.src = raw; });
        let w = Math.min(1200, im.width), h = Math.max(1, Math.round(im.height * (w / im.width)));
        let out = "";
        for (let k = 0; k < 8; k++){
          const c2 = document.createElement("canvas"); c2.width = w; c2.height = h;
          c2.getContext("2d").drawImage(im, 0, 0, w, h);
          out = c2.toDataURL("image/jpeg", 0.72);
          if (out.length <= maxChars) return out;
          w = Math.round(w * 0.75); h = Math.max(1, Math.round(h * 0.75));
          if (w < 80) break;
        }
        return out;
      } catch (_) { return null; }
    }
    async function buildDocxPages(file){
      try {
        const JSZip = await loadJSZip(); const zip = await JSZip.loadAsync(file);
        const xml = await zip.file("word/document.xml").async("string");
        const paras = [...xml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)].map(m => [...m[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(x => x[1]).join("")).filter(Boolean);
        const text = paras.join("\n").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
        const body = esc(text.slice(0, 20000));
        const media = Object.keys(zip.files).filter(n => /^word\/media\//.test(n) && /\.(png|jpe?g|gif)$/i.test(n));
        const budget = PAGE_HTML_MAX - body.length - 1500;
        const count = Math.min(media.length, 6, Math.max(0, Math.floor(budget / 6000)));
        const per = count ? Math.max(2500, Math.min(12000, Math.floor(budget / count))) : 0;
        const imgs = [];
        for (const n of media.slice(0, count)) { const src = await zipImage(zip, n, per); if (src) imgs.push(src); }
        return [{label:"Документ", html:`<div class="bd-sheet"><h2>${esc(file.name)}</h2>${imgsHTML(imgs, imgs.length)}<div style="white-space:pre-line;font-size:15px;line-height:1.55">${body}</div></div>`}];
      } catch (e) { toast("Не удалось открыть документ: " + oneLine(e && e.message)); return []; }
    }
    async function buildPptxPages(file){
      try {
        const JSZip = await loadJSZip(); const zip = await JSZip.loadAsync(file);
        const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => (+a.match(/\d+/)[0]) - (+b.match(/\d+/)[0]));
        const out = []; let made = 0;
        for (const n of slides){
          made++;
          const num = n.match(/slide(\d+)\.xml/)[1];
          const xml = await zip.file(n).async("string");
          const text = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map(x => x[1]).join("\n").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
          const body = esc(text || "");
          const relName = "ppt/slides/_rels/slide" + num + ".xml.rels";
          let rels = "";
          try { rels = await zip.file(relName).async("string"); } catch (_) {}
          const map = {};
          [...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].forEach(m => { map[m[1]] = m[2]; });
          const ids = [...xml.matchAll(/r:embed="([^"]+)"/g)].map(m => m[1]);
          const budget = PAGE_HTML_MAX - body.length - 800;
          const count = Math.min(ids.length, 4, Math.max(0, Math.floor(budget / 6000)));
          const per = count ? Math.max(2500, Math.min(12000, Math.floor(budget / count))) : 0;
          const imgs = [];
          for (const id of ids.slice(0, count)){
            const tgt = map[id]; if (!tgt) continue;
            const full = tgt.replace(/^\.\.\//, "ppt/");
            const src = await zipImage(zip, full, per); if (src) imgs.push(src);
          }
          out.push({label:"Слайд " + made, html:`<div class="bd-sheet"><h2>Слайд ${made}</h2>${imgsHTML(imgs, imgs.length)}<div style="white-space:pre-line;font-size:16px;line-height:1.6">${body}</div></div>`});
        }
        return out;
      } catch (e) { toast("Не удалось открыть презентацию: " + oneLine(e && e.message)); return []; }
    }
    async function buildImagePage(file){
      const list = await imageFileToItems(file);
      if (!list.length) return [];
      const src = list[0].src;
      return [{label:file.name || "Картинка", html:`<div class="bd-sheet"><h2>${esc(file.name || "Картинка")}</h2><img src="${src}" alt="" style="width:100%;border-radius:8px;border:1px solid #e6e2f2"></div>`}];
    }
    async function buildPdfPages(file){
      const imgs = await pdfToImages(file, 48000, 60);
      return imgs.map((it, i) => ({label:"PDF " + (i + 1), html:`<div class="bd-sheet"><h2>${esc(file.name)} — страница ${i + 1}</h2><img src="${it.src}" alt="" style="width:100%;border-radius:8px;border:1px solid #e6e2f2"></div>`}));
    }
    async function buildVideoPage(file){
      /* на один лист 3 кадра; бюджет на кадр считаем так, чтобы html листа влез в лимит */
      const shots = await videoFrames(file, Math.min(12000, Math.floor((PAGE_HTML_MAX - 2500) / 3)));
      const frames = imgsHTML(shots.map(s => s.src), 3);
      return [{label:"Видео", html:`<div class="bd-sheet"><h2>${esc(file.name)}</h2><p class="small muted">Кадры видео добавлены на лист доски. Полный видеофайл доступен у учителя.</p>${frames}</div>`}];
    }
    function addImage(src, ratio, x, y, w){
      const width = w || 460, hh = width / (ratio || 1.5);
      addItem({t:"i", x: x == null ? 40 : x, y: y == null ? nextFreeY() : y, w:width, h:hh, ratio:ratio || 1.5, src});
      return hh;
    }
    async function attachInline(files){
      let y = nextFreeY(), made = 0;
      for (const f of files){
        let shots = [];
        if (/^image\//.test(f.type)) shots = await imageFileToItems(f);
        else if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) shots = await pdfToImages(f, ITEM_MAX, 8);
        else if (/^video\//.test(f.type)) shots = await videoFrames(f, ITEM_MAX);
        else if (/\.(docx|pptx)$/i.test(f.name)){ toast("Документы добавляются отдельными листами доски."); await attachPages([f]); continue; }
        else { toast("Формат «" + f.name + "» пока не преобразуется в картинки. Прикрепите фото, PDF или документ."); continue; }
        for (const it of shots){ const hh = addImage(it.src, it.ratio, 40, y, 480); y += hh + 30; made++; }
      }
      if (made) toast("Материал добавлен на доску");
    }
    async function attachPages(files){
      const keys = [];
      for (const f of files){
        let descs = [];
        if (/^image\//.test(f.type)) descs = await buildImagePage(f);
        else if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) descs = await buildPdfPages(f);
        else if (/^video\//.test(f.type)) descs = await buildVideoPage(f);
        else if (/\.(docx)$/i.test(f.name)) descs = await buildDocxPages(f);
        else if (/\.(pptx)$/i.test(f.name)) descs = await buildPptxPages(f);
        else { toast("Формат «" + f.name + "» пока не поддерживается."); continue; }
        for (const d of descs) keys.push(addPageP(d.label, d.html, true));
      }
      if (keys.length){
        openPage(keys[0]);
        if (o.role === "teacher") send("page", {page:keys[0]});
        toast("Добавлено листов: " + keys.length);
      } else {
        toast("Не удалось добавить материал отдельными листами");
      }
    }
    async function handleFiles(files){
      const list = Array.from(files || []).filter(Boolean);
      if (!list.length) return;
      const dest = await askDestination(list);
      if (!dest) return;
      if (dest === "inline") await attachInline(list);
      else await attachPages(list);
    }
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

    /* ---------- реальное время ---------- */
    function send(type, payload){ if (channel) channel.send({type:"broadcast", event:"ev", payload:{type, from:me, page, ...payload}}); }
    function sendPresence(){ if (channel) { try { const p = channel.track({id:me, name:o.name, role:o.role, page}); if (p && p.catch) p.catch(() => {}); } catch (_) {} } }
    function renderWho(){
      const list = [...peers.values()].filter(p => p.online);
      $(".bd-who").textContent = list.length ? "На доске: " + list.map(p => `${p.name} (${p.role === "teacher" ? "учитель" : "ученик"})`).join(", ") : (channel ? "Вы на доске одни" : "Доска без связи: рисунки сохраняются только у вас");
    }
    function cursorFor(id){
      let p = peers.get(id);
      if (!p){ p = {online:false, el:null}; peers.set(id, p); }
      if (!p.el){
        p.el = document.createElement("div"); p.el.className = "bd-cursor";
        p.el.innerHTML = `<svg viewBox="0 0 16 16" width="18" height="18"><path d="M1 1l5 14 2-6 6-2z" fill="currentColor" stroke="#fff" stroke-width="1"/></svg><span></span>`;
        curLayer.appendChild(p.el);
      }
      return p;
    }
    function placeCursor(p){
      if (!p || !p.el || !p.raw) return;
      let x = p.raw.x, y = p.raw.y;
      if (p.raw.a){ const [dx, dy] = shiftFor(p.raw.a); x += dx; y += dy; }
      p.el.style.transform = `translate(${x * scale}px, ${y * scale}px)`;
      p.el.hidden = !p.online || p.page !== page;
      p.el.style.color = p.role === "teacher" ? "#ee5fa8" : "#7b4cf5";
      const sp = p.el.querySelector("span"); if (sp) sp.dataset.n = p.name || "";
    }
    function placeCursors(){ peers.forEach(placeCursor); }
    if (o.sb && o.channelName){
      channel = o.sb.channel(o.channelName, {config:{broadcast:{self:false}, presence:{key:me}}});
      channel.on("broadcast", {event:"ev"}, ({payload:m}) => {
        if (!m || m.from === me) return;
        if (m.type === "addpage"){
          const ex = pagesArr.find(x => x.key === String(m.key));
          if (ex){
            /* сервер/вторая сторона могли сохранить усечённую версию – синхронизируем html по тому же ключу */
            if (typeof m.html === "string" && m.html !== ex.html){
              ex.html = m.html; ex.saved = true;
              if (page === ex.key){ if (!paintLive(true)) bg.innerHTML = m.html; afterSheet(); layout(); }
            } else ex.saved = true;
          } else if (m.key){
            pagesArr.push({key:String(m.key), label:m.label || "Лист", html:m.html || "", saved:true});
            renderPageButtons();
          }
          return;
        }
        if (m.type === "page" && o.role === "student"){ if (m.page !== page){ openPage(m.page); toast("Учитель открыл другой лист"); } return; }
        if (m.page !== page) return;
        if (m.type === "cursor"){
          const p = cursorFor(m.from); p.raw = {x:m.x, y:m.y, a:m.a || null}; placeCursor(p);
        }
        if (m.type === "draft"){
          const k = m.from + ":" + (m.sid || "");
          if (m.drop){ drafts.delete(k); redraw(); return; }
          let d = drafts.get(k);
          if (!d){ d = {t:"s", c:m.c, w:m.w, h:m.h, p:[], a:m.a || null}; drafts.set(k, d); }
          if (!d.a && m.a) d.a = m.a;
          (m.p || []).forEach(q => d.p.push(q));
          if (m.end) setTimeout(() => { drafts.delete(k); redraw(); }, 1500);
          redraw();
        }
        if (m.type === "add"){
          [...drafts.keys()].forEach(k => { if (k.startsWith(m.from + ":") && drafts.get(k).p.length >= ((m.item && m.item.p && m.item.p.length) || 0) - 2) drafts.delete(k); });
          if (m.id != null) items.set(String(m.id), m.item);
          redraw(); layout();
        }
        if (m.type === "remove"){ (m.ids || []).forEach(id => items.delete(String(id))); redraw(); layout(); }
        if (m.type === "move"){ if (m.id != null) items.delete(String(m.id)); if (m.newId != null) items.set(String(m.newId), m.item); redraw(); layout(); }
        if (m.type === "clear"){ items.clear(); mine = []; redraw(); layout(); }
      });
      channel.on("presence", {event:"sync"}, () => {
        const st = channel.presenceState();
        peers.forEach(p => p.online = false);
        Object.values(st).flat().forEach(x => { if (!x || x.id === me) return; const p = cursorFor(x.id); Object.assign(p, {online:true, name:x.name, role:x.role, page:x.page}); });
        peers.forEach(p => { if (p.el) p.el.hidden = !p.online || p.page !== page; });
        placeCursors();
        renderWho();
      });
      channel.subscribe(s => { if (s === "SUBSCRIBED"){ sendPresence(); renderWho(); } });
    }
    renderWho();

    /* ---------- запуск ---------- */
    let roT = 0; const ro = new ResizeObserver(() => { clearTimeout(roT); roT = setTimeout(layout, 30); }); ro.observe(stage); ro.observe(bg);
    setTool("pen"); setColor(COLORS[0]);

    /* ---------- хуки для тестов ---------- */
    function info(){
      const list = [];
      items.forEach((it, id) => {
        if (it.t === "s"){
          list.push({id, t:"s", p: shiftedPoints(it), c:it.c, w:it.w, hl:!!it.h, a:it.a || null});
        } else if (it.t === "i"){
          const [w2, h2] = imageSize(it);
          list.push({id, t:"i", x:it.x, y:it.y, w:w2, h:h2, ratio:it.ratio, src:it.src});
        } else if (it.t === "t"){
          list.push({id, t:"t", x:it.x, y:it.y, w:it.w || DEFAULT_TEXT_W, h:it.h || textHeight(it), s:it.s, c:it.c});
        }
      });
      const cur = pagesArr.find(p => p.key === page);
      return {
        ready: readyDone,
        page,
        scale,
        width: W,
        height,
        saving,
        anchors: bdBoxes.length,
        items: list,
        pages: pagesArr.map(p => ({key:p.key, label:p.label, htmlLen:(p.html || "").length, saved:!!p.saved})),
        pageHtmlLen: cur ? (cur.html || "").length : 0,
        editor: editor ? {open:true, id:editor.id || null, text:editor.ta.value} : null
      };
    }
    function destroy(){
      try { ro.disconnect(); } catch (_) {}
      clearTimeout(roT);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDocDown, true);
      document.removeEventListener("paste", onPaste);
      lpClear();
      if (editor){ const ed = editor; editor = null; ed.closed = true; try { ed.el.remove(); } catch (_) {} }
      peers.forEach(p => { if (p.el){ try { p.el.remove(); } catch (_) {} } });
      drafts.clear();
      if (channel && o.sb && typeof o.sb.removeChannel === "function"){ try { o.sb.removeChannel(channel); } catch (_) {} }
      channel = null;
      try { menu.remove(); } catch (_) {}
      try { readyResolve && readyResolve(info()); } catch (_) {}
      root.innerHTML = "";
    }
    async function boot(){
      try { await Promise.race([syncPages(), delay(5000)]); } catch (_) {}
      if (!root.isConnected) return;
      if (o.page && pagesArr.some(p => p.key === String(o.page))) page = String(o.page);
      await openPage(page);
      readyDone = true;
      try { readyResolve && readyResolve(info()); } catch (_) {}
    }
    boot();

    return {
      /* прежний контракт keep()/приложения */
      setMenu(fn){ o.menu = fn; },
      setLive(map, pagesNew){ live = map || {}; if (pagesNew){ pagesNew.forEach(p => { const i = pagesArr.findIndex(x => x.key === p.key); if (i >= 0) pagesArr[i] = {...pagesArr[i], ...p}; else pagesArr.push(p); }); renderPageButtons(); } },
      refresh(){ const painted = paintLive(false); if (painted || anchorsDirty){ afterSheet(); } boxesDirty = true; layout(); },
      open(key){ if (key && key !== page && pagesArr.some(p => p.key === key)) openPage(key); },
      destroy(){ destroy(); },
      relayout(){ layout(); },
      page: () => page,
      /* хуки для тестов (verifier): имена – часть контракта */
      info,
      ready: () => readyP,
      whenIdle: async () => { await readyP; while (saving > 0) await delay(50); return info(); },
      attach: files => handleFiles(files),
      addPage: (label, html, broadcast) => addPageP(label, html, broadcast),
      openPage,
      pages: () => pagesArr.map(p => ({key:p.key, label:p.label, saved:!!p.saved})),
      debug(){
        const v = info();
        v.raw = Array.from(items.entries()).map(([id, it]) => ({id, item:it}));
        v.anchorBoxes = bdBoxes.map(b => ({i:+b.el.getAttribute("data-bd"), x:b.x, y:b.y, w:b.w, h:b.h}));
        return v;
      }
    };
  }

  /* хранилище: Supabase (ученик – через функции, учитель – напрямую) или браузер */
  function api(kind, sb, ident){
    const lk = p => `${ident.lesson}:${p}`;
    if (!sb){
      const key = p => `oge-board-${ident.lesson}-${p}`;
      const get = p => { try { const v = JSON.parse(localStorage.getItem(key(p))); return Array.isArray(v) ? v : []; } catch(_) { return []; } };
      const put = (p, v) => { try { localStorage.setItem(key(p), JSON.stringify(v)); } catch(_) {} };
      return {
        load: async p => get(p),
        add: async (p, item) => { const l = get(p), id = Date.now() + Math.random().toString(36).slice(2, 6); l.push({id, item}); put(p, l); return id; },
        remove: async (p, ids) => { const set = new Set((ids || []).map(String)); put(p, get(p).filter(r => !set.has(String(r.id)))); },
        clear: async p => put(p, [])
      };
    }
    if (kind === "student") return {
      load: async p => { const {data, error} = await sb.rpc("board_load", {p_code: ident.code, p_lesson: lk(p)}); if (error) throw error; return data || []; },
      add: async (p, item) => { const {data, error} = await sb.rpc("board_add", {p_code: ident.code, p_lesson: lk(p), p_item: item}); if (error) throw error; return data; },
      remove: async (p, ids) => { const nums = (ids || []).map(Number).filter(Number.isFinite); if (!nums.length) return; await sb.rpc("board_remove", {p_code: ident.code, p_lesson: lk(p), p_ids: nums}); },
      clear: async () => {}
    };
    return {
      load: async p => { const {data, error} = await sb.from("board_items").select("id,item").eq("student_id", ident.studentId).eq("lesson_id", lk(p)).order("id"); if (error) throw error; return data || []; },
      add: async (p, item) => { const {data, error} = await sb.from("board_items").insert({student_id: ident.studentId, lesson_id: lk(p), item, author: "teacher"}).select("id").single(); if (error) throw error; return data.id; },
      remove: async (p, ids) => { const nums = (ids || []).map(Number).filter(Number.isFinite); if (!nums.length) return; await sb.from("board_items").delete().in("id", nums); },
      clear: async p => { await sb.from("board_items").delete().eq("student_id", ident.studentId).eq("lesson_id", lk(p)); }
    };
  }

  /* листы доски для занятия */
  function pages(course, l){
    if (l.free) return [{key:"p1", label:"Лист 1", html:`<div class="bd-sheet"></div>`}, {key:"p2", label:"Лист 2", html:`<div class="bd-sheet"></div>`},
      {key:"lined", label:"В линейку", html:`<div class="bd-sheet bd-lined"></div>`}, {key:"grid", label:"В клетку", html:`<div class="bd-sheet bd-grid"></div>`}];
    const out = [], noInputs = h => h.replace(/<button[\s\S]*?<\/button>/g, "").replace(/<input[^>]*>/g, '<span class="blank" style="min-width:160px"></span>');
    if (l.practice?.length) out.push({key:"practice", label:"Практика", html:`<div class="bd-sheet"><h2>${esc(l.title)}: практика</h2>${U.practiceHTML(l, false)}</div>`});
    if ((l.test || []).length) out.push({key:"test", label:"Тест", html:`<div class="bd-sheet"><h2>${esc(l.title)}: проверь себя</h2><ol>${(l.test || []).map(q => `<li style="margin-bottom:16px">${esc(q.q)}${q.pn ? "<br>" + esc(q.pn.w.join(" ")) : ""}${q.o ? "<br><span style='font-size:15px;color:#555'>" + q.o.map((x, k) => (k + 1) + ") " + esc(x)).join("   ") + "</span>" : ""}<span class="blank"></span></li>`).join("")}</ol><p class="small muted">Ответы не показываются: проверка — в разделе «Тест» урока.</p></div>`});
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
    if (kept && kept.key === key){ if (opts && "menu" in opts) kept.inst.setMenu(opts.menu); if (opts?.live) kept.inst.setLive(opts.live, opts.pages); kept.inst.refresh(); container.replaceChildren(kept.holder); requestAnimationFrame(() => kept && kept.inst.relayout()); return kept.inst; }
    release();
    const holder = document.createElement("div"); holder.className = "bd-holder"; container.replaceChildren(holder);
    const inst = mount(holder, opts); kept = {key, holder, inst}; return inst;
  }
  function release(){ if (kept){ try { kept.inst.destroy(); } catch(_) {} kept = null; } }
  const keptPage = () => kept?.inst.page();

  return {mount, api, pages, keep, release, keptPage};
})();
