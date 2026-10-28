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

    root.innerHTML = `
      <div class="bd-bar">
        <div class="bd-pages" role="group" aria-label="Лист доски">${o.pages.map(p => `<button data-bpage="${p.key}">${esc(p.label)}</button>`).join("")}</div>
        <div class="bd-tools" role="group" aria-label="Инструменты">
          <button data-tool="pen" title="Ручка">✎</button>
          <button data-tool="hl" title="Маркер">▮</button>
          <button data-tool="text" title="Текст">T</button>
          <button data-tool="erase" title="Ластик">⌫</button>
          <button data-tool="hand" title="Листать">✋</button>
          ${COLORS.map(c => `<button class="bd-color" data-color="${c}" style="--bc:${c}" aria-label="Цвет"></button>`).join("")}
          <button data-act="undo" title="Отменить своё последнее">↶</button>
          ${o.role === "teacher" ? `<button data-act="clear" title="Очистить лист">Очистить</button>` : ""}
        </div>
        <div class="bd-who small muted" aria-live="polite"></div>
      </div>
      <div class="bd-stage"><div class="bd-wrap">
        <div class="bd-bg"></div>
        <canvas class="bd-cv"></canvas>
        <div class="bd-cursors"></div>
      </div></div>`;
    const $ = s => root.querySelector(s);
    const stage = $(".bd-stage"), wrap = $(".bd-wrap"), bg = $(".bd-bg"), cv = $(".bd-cv"), ctx = cv.getContext("2d"), curLayer = $(".bd-cursors");

    function layout(){
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
    function redraw(){
      ctx.clearRect(0, 0, W, height);
      items.forEach(it => it.t === "s" ? drawStroke(it) : drawText(it));
      drafts.forEach(drawStroke);
      if (drawing) drawStroke(drawing);
    }
    function pos(e){ const r = cv.getBoundingClientRect(); return [Math.round((e.clientX - r.left) / scale), Math.round((e.clientY - r.top) / scale)]; }

    /* ---------- лист ---------- */
    async function openPage(key){
      if (!o.pages.some(p => p.key === key)) key = o.pages[0].key;
      page = key;
      root.querySelectorAll("[data-bpage]").forEach(b => b.setAttribute("aria-pressed", b.dataset.bpage === key));
      bg.innerHTML = o.pages.find(p => p.key === key).html;
      items = new Map(); mine = []; drafts.clear();
      layout();
      try { const list = await o.api.load(key); list.forEach(r => items.set(String(r.id), r.item)); } catch(_) {}
      layout();
      sendPresence();
      o.onPage && o.onPage(key);
    }

    /* ---------- рисование ---------- */
    function setTool(t){ tool = t; root.querySelectorAll("[data-tool]").forEach(b => b.setAttribute("aria-pressed", b.dataset.tool === t)); cv.style.touchAction = t === "hand" ? "pan-y" : "none"; cv.style.cursor = t === "hand" ? "grab" : t === "text" ? "text" : "crosshair"; }
    function setColor(c){ color = c; root.querySelectorAll("[data-color]").forEach(b => b.setAttribute("aria-pressed", b.dataset.color === c)); }
    function hitTest(pt){
      let found = null;
      items.forEach((it, id) => {
        if (found) return;
        if (it.t === "s"){ for (const p of it.p){ if (Math.hypot(p[0] - pt[0], p[1] - pt[1]) < 14 + it.w){ found = id; break; } } }
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

    cv.addEventListener("pointerdown", e => {
      if (tool === "hand") return;
      const p = pos(e);
      if (tool === "text"){ placeText(p); return; }
      cv.setPointerCapture(e.pointerId);
      if (tool === "erase"){ const id = hitTest(p); if (id) removeIds([id]); drawing = {erase:true}; return; }
      drawing = {t:"s", c: tool === "hl" ? "#ffd23f" : color, w: tool === "hl" ? 18 : 3, h: tool === "hl", p:[p]};
      draftBuf = [p];
    });
    cv.addEventListener("pointermove", e => {
      const p = pos(e), now = performance.now();
      if (now - lastCursor > 45){ lastCursor = now; send("cursor", {x:p[0], y:p[1]}); }
      if (!drawing) return;
      if (drawing.erase){ const id = hitTest(p); if (id) removeIds([id]); return; }
      const last = drawing.p[drawing.p.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 2) return;
      drawing.p.push(p); draftBuf.push(p); redraw();
      if (now - lastDraft > 60){ lastDraft = now; send("draft", {c:drawing.c, w:drawing.w, h:drawing.h, p:draftBuf}); draftBuf = [p]; }
    });
    const end = () => {
      if (!drawing) return;
      const d = drawing; drawing = null;
      if (d.erase) return;
      send("draft", {c:d.c, w:d.w, h:d.h, p:draftBuf, end:true});
      if (d.p.length) addItem(d);
    };
    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end); cv.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") end(); });

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
      if (b.dataset.bpage){ openPage(b.dataset.bpage); if (o.role === "teacher") send("page", {page:b.dataset.bpage}); }
      if (b.dataset.tool) setTool(b.dataset.tool);
      if (b.dataset.color){ setColor(b.dataset.color); if (tool === "hl" || tool === "erase" || tool === "hand") setTool("pen"); }
      if (b.dataset.act === "undo"){ const id = mine.pop(); if (id) removeIds([id]); }
      if (b.dataset.act === "clear"){
        if (b.dataset.sure){ await o.api.clear(page); items.clear(); redraw(); send("clear", {}); b.textContent = "Очистить"; delete b.dataset.sure; }
        else { b.dataset.sure = "1"; b.textContent = "Точно очистить?"; setTimeout(() => { b.textContent = "Очистить"; delete b.dataset.sure; }, 3000); }
      }
    });

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
        if (m.type === "page" && o.role === "student"){ if (m.page !== page){ openPage(m.page); U.toast("Учитель открыл другой лист"); } return; }
        if (m.page !== page) return;
        if (m.type === "cursor"){
          const p = cursorFor(m.from); p.x = m.x; p.y = m.y;
          p.el.style.transform = `translate(${m.x * scale}px, ${m.y * scale}px)`; p.el.hidden = false;
          p.el.style.color = p.role === "teacher" ? "#ee5fa8" : "#7b4cf5";
          p.el.querySelector("span").dataset.n = p.name || "";
        }
        if (m.type === "draft"){
          const d = drafts.get(m.from) || {t:"s", c:m.c, w:m.w, h:m.h, p:[]};
          d.p.push(...m.p); drafts.set(m.from, d); if (m.end) setTimeout(() => { drafts.delete(m.from); redraw(); }, 1500); redraw();
        }
        if (m.type === "add"){ drafts.delete(m.from); items.set(m.id, m.item); redraw(); }
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
    return { destroy(){ ro.disconnect(); if (channel) o.sb.removeChannel(channel); } };
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
    const out = [], noInputs = h => h.replace(/<button[\s\S]*?<\/button>/g, "").replace(/<input[^>]*>/g, '<span class="blank" style="min-width:160px"></span>');
    if (l.practice?.length) out.push({key:"practice", label:"Практика", html:`<div class="bd-sheet"><h2>${esc(l.title)}: практика</h2>${U.practiceHTML(l, false)}</div>`});
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

  return {mount, api, pages};
})();
