/* Обвязка стенда доски v54 (_test/board.html) для проверок без npm.
   Глобально: window.__board (хелперы), window.__boards = {teacher, student} (результаты Board.mount).
   Доски: teacher 1100px, student 380px, общий in-memory api и fake-канал (broadcast+presence).
   Хелперы рассчитаны на контракт board.js v54 + порт:
   mount().{info, whenIdle, attach, addPage, openPage, refresh, destroy, ready, debug}.
   Ключевые ожидания см. _test/README.md. */
(function () {
  "use strict";
  const LESSON = "L1";
  const CHANNEL = "live-test";
  const W = 800;                 // логическая ширина листа из board.js
  const PAGE_HTML_MAX = 55000;   // лимит html одного листа (board_add у ученика)
  const PAGE_KEY = "_pages";     // ключ api для доп. листов (v54)

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  /* ---------- fake-канал: broadcast + presence между досками ---------- */
  const HUB = (() => {
    const channels = new Set();
    let chSeq = 0;
    const log = [];              // журнал доставленных broadcast-сообщений (для диагностики bg/bgreq)

    function makeChannel(name, cfg) {
      cfg = cfg || {};
      const ch = {
        name, cfg, uid: "ch" + (++chSeq), state: null, handlers: [], subscribed: false,
        on(kind, filter, cb) { ch.handlers.push({ kind, filter: filter || {}, cb }); return ch; },
        subscribe(cb) {
          ch.subscribed = true;
          setTimeout(() => { try { cb && cb("SUBSCRIBED"); } catch (e) { console.error("subscribe cb", e); } }, 0);
          return ch;
        },
        send(msg) { deliver(ch, msg); return ch; },
        track(st) { ch.state = Object.assign({}, st); setTimeout(() => presenceSync(ch.name), 0); return Promise.resolve("ok"); },
        untrack() { ch.state = null; setTimeout(() => presenceSync(ch.name), 0); return Promise.resolve("ok"); },
        presenceState() { return presenceState(ch.name); },
        unsubscribe() { channels.delete(ch); },
      };
      channels.add(ch);
      return ch;
    }
    const presKey = ch => (ch.cfg.presence && ch.cfg.presence.key) || ch.uid;
    function presenceState(name) {
      const out = {};
      channels.forEach(ch => {
        if (ch.name !== name || !ch.state) return;
        const k = presKey(ch);
        (out[k] = out[k] || []).push(clone(ch.state));
      });
      return out;
    }
    function presenceSync(name) {
      const data = presenceState(name);
      channels.forEach(ch => {
        if (ch.name !== name) return;
        ch.handlers.filter(h => h.kind === "presence" && h.filter.event === "sync")
          .forEach(h => { try { h.cb(data); } catch (e) { console.error("presence handler", e); } });
      });
    }
    function deliver(from, msg) {
      if (!msg || msg.type !== "broadcast") return;
      /* журнал: тесты/диагностика видят, что реально ушло по каналу (bg/bgreq/ev …) */
      try {
        log.push({ at: Date.now(), event: msg.event, payload: clone(msg.payload) });
        if (log.length > 400) log.splice(0, log.length - 400);
      } catch (_) {}
      channels.forEach(ch => {
        if (ch === from || ch.name !== from.name) return;
        ch.handlers.filter(h => h.kind === "broadcast" && h.filter.event === msg.event)
          .forEach(h => { try { h.cb({ payload: clone(msg.payload) }); } catch (e) { console.error("broadcast handler", e); } });
      });
    }
    return {
      makeChannel,
      removeChannel: ch => channels.delete(ch),
      presenceState,
      reset: () => { channels.clear(); log.length = 0; },
      count: () => channels.size,
      log,
      clearLog: () => { log.length = 0; },
      /** сообщения канала (опционально — только payload.type / event) */
      messages: (type) => log.map(x => x.payload).filter(p => p && (type == null || p.type === type)),
      sent: (type) => log.some(x => x.payload && x.payload.type === type),
    };
  })();

  /* ---------- общий in-memory api: load/add/remove/clear по lesson+page ---------- */
  const store = new Map(); // "lesson:page" -> [{id, item}]
  let idSeq = 1;
  const storeKey = page => LESSON + ":" + page;
  const api = {
    async load(page) { await sleep(6); return (store.get(storeKey(page)) || []).map(r => ({ id: r.id, item: clone(r.item) })); },
    async add(page, item) {
      await sleep(10);
      const id = idSeq++;
      const arr = store.get(storeKey(page)) || [];
      arr.push({ id, item: clone(item) });
      store.set(storeKey(page), arr);
      return id;
    },
    async remove(page, ids) {
      await sleep(6);
      const s = new Set((ids || []).map(String));
      store.set(storeKey(page), (store.get(storeKey(page)) || []).filter(r => !s.has(String(r.id))));
      return true;
    },
    async clear(page) { await sleep(6); store.set(storeKey(page), []); return true; },
  };
  const cloneRow = r => ({ id: r.id, item: clone(r.item) });
  function dump(page) { return (store.get(storeKey(page)) || []).map(cloneRow); }
  function storeAll() { const o = {}; store.forEach((v, k) => { o[k] = v.map(cloneRow); }); return o; }
  function seed(page, rows) { store.set(storeKey(page), (rows || []).map(r => ({ id: r.id != null ? r.id : idSeq++, item: clone(r.item) }))); }
  function clearStore() { store.clear(); idSeq = 1; }

  /* ---------- листы доски для стенда ---------- */
  /* ВАЖНО: у .sentence пустой «промежуток» снизу (margin-bottom:150px) — это нужно сценарию G
     («якорь в пустом месте»): точка ниже текста не принадлежит ни одному дочернему элементу,
     поэтому старый anchorAt() цеплялся к .bd-sheet и штрих «уезжал» при сдвиге макета. */
  function pagesFor() {
    return [
      {
        key: "theory", label: "Теория",
        html: '<div class="bd-sheet"><h2>Правило</h2>' +
          '<p>Первое предложение листа для проверки якоря.</p>' +
          '<p class="sentence" style="margin-bottom:150px">Яблоко лежит на столе.</p>' +
          '<p>Третье предложение.</p></div>',
      },
      { key: "p2", label: "Лист 2", html: '<div class="bd-sheet"><h2>Лист 2</h2><p>Текст второго листа.</p></div>' },
      { key: "blank", label: "Чистый лист", html: '<div class="bd-sheet bd-lined"></div>' },
    ];
  }

  /* ---------- «живой урок»: РАЗНЫЙ HTML листа у учителя и ученика ----------
     В приложении teacher.js рисует живой лист через roomPane() (ключи/ответы — TEACHER-KEYS),
     а student.js — через lessonPane() (STUDENT-SHEET). Раньше из-за этого совпадали только
     абсолютные координаты, но не текст под штрихом. Стенд повторяет этот раскол: у учителя
     лист заметно длиннее и с другими блоками, у ученика — свой набор/порядок и высота.
     live-функции обязаны работать и на detached-элементе: board.js рисует в него лист,
     отвечая на "bgreq", когда страница у ученика не открыта. */
  const LIVE_PAGES = ["theory"];
  function teacherLiveHtml(key) {
    return '<div class="bd-sheet bd-live" data-live="teacher">' +
      '<h2>TEACHER-KEYS · Теория</h2>' +
      '<p id="teacher-note">Ключи и ответы учителя (roomPane, панель комнаты).</p>' +
      '<div class="bd-live-keys"><p>1) Ответ A</p><p>2) Ответ B</p><p>3) Ответ C</p><p>4) Ответ D</p></div>' +
      '<p>Длинный блок пояснений учителя, которого нет в листе ученика.</p>' +
      '<p>Ещё один абзац учителя: у ученика такого блока нет.</p>' +
      '<p>Комментарий к домашнему заданию и критерии оценивания.</p>' +
      '</div>';
  }
  function studentLiveHtml(key) {
    return '<div class="bd-sheet bd-live" data-live="student">' +
      '<h2>STUDENT-SHEET · Теория</h2>' +
      '<p id="student-sent" style="margin-bottom:130px">Предложение листа ученика для проверки.</p>' +
      '<p>Второй абзац ученика.</p>' +
      '<div class="bd-live-extra"><p>Пометка ученика в конце листа.</p></div>' +
      '</div>';
  }
  function liveHtml(side, key) { return side === "teacher" ? teacherLiveHtml(key) : studentLiveHtml(key); }
  /** карта live-функций для Board.mount: live[key] = host => host.innerHTML = ... */
  function liveMap(side) {
    const m = {};
    LIVE_PAGES.forEach(key => {
      m[key] = host => { host.innerHTML = liveHtml(side, key); };
    });
    return m;
  }
  /** отрисовать live-лист в detached-контейнер (эмуляция ответа на "bgreq", когда лист не открыт) */
  function liveRenderDetached(side, key) {
    const d = document.createElement("div");
    liveMap(side)[key](d);
    return d.innerHTML;
  }

  /* ---------- заглушка U (board.js ждёт U.toast/theoryHTML/practiceHTML) ---------- */
  const toasts = [];
  window.__toasts = toasts;
  window.U = window.U || {
    toast(msg) { toasts.push(String(msg)); },
    practiceHTML() { return ""; },
    theoryHTML() { return ""; },
  };

  /* ---------- монтирование досок ---------- */
  const ROOT_IDS = { teacher: "bd-teacher", student: "bd-student" };
  const handles = { teacher: null, student: null };
  const mountOpts = { teacher: { live: false, page: "theory" }, student: { live: false, page: "theory" } };
  window.__boards = { teacher: null, student: null };

  function root(side) { return document.getElementById(ROOT_IDS[side]); }
  function cv(side) { const r = root(side); return r && r.querySelector(".bd-cv"); }

  async function readyOf(h, side) {
    if (!h) return;
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      let info = null;
      try { if (typeof h.info === "function") info = h.info(); } catch (_) {}
      if (info && info.ready) { await sleep(60); return; }
      if (!info && typeof h.ready === "function") {
        try { await Promise.race([Promise.resolve(h.ready()).catch(() => {}), sleep(2500)]); } catch (_) {}
        await sleep(80);
        return;
      }
      if (!h.info && !h.ready) {
        // доска без хуков: ждём кнопок/канваса и немного тишины
        const r = root(side);
        if (r && r.querySelector(".bd-cv") && r.querySelector("[data-bpage]")) { await sleep(200); return; }
      }
      await sleep(60);
    }
    throw new Error("доска «" + side + "» не готова (info().ready не стал true)");
  }
  async function idleOf(h) {
    if (!h) return;
    try {
      if (typeof h.whenIdle === "function") await Promise.race([Promise.resolve(h.whenIdle()).catch(() => {}), sleep(8000)]);
    } catch (_) {}
  }
  async function settle(sides) {
    for (const s of sides) await readyOf(handles[s], s);
    for (const s of sides) await idleOf(handles[s]);
    await sleep(150);
  }

  /** opts: { live:boolean, page:string, pages:[...] } — режим запоминается до remount */
  function mountBoard(side, opts) {
    const el = root(side);
    if (!el) throw new Error("Нет контейнера " + ROOT_IDS[side]);
    opts = opts || {};
    const prev = mountOpts[side];
    const live = opts.live != null ? !!opts.live : !!prev.live;
    const page = opts.page ? String(opts.page) : (prev.page || "theory");
    mountOpts[side] = { live, page };
    el.innerHTML = "";
    const cfg = {
      api,
      channelName: CHANNEL,
      sb: { channel: (n, c) => HUB.makeChannel(n, c), removeChannel: ch => HUB.removeChannel(ch) },
      role: side,
      name: side === "teacher" ? "Любовь Игоревна" : "Ученик",
      pages: opts.pages || pagesFor(),
      page,
    };
    if (live) cfg.live = liveMap(side);
    const h = window.Board.mount(el, cfg);
    if (!h) throw new Error("Board.mount(«" + side + "») вернул пустое значение");
    handles[side] = h;
    window.__boards[side] = h;
    return h;
  }
  function destroyBoard(side) {
    try { handles[side] && handles[side].destroy && handles[side].destroy(); } catch (e) { console.warn("destroy", e); }
    handles[side] = null;
    window.__boards[side] = null;
    const el = root(side);
    if (el) el.innerHTML = "";
  }
  /** opts: { live:boolean, pages:{teacher,student}, page:{teacher,student} } — по умолчанию статический режим */
  function mountBoth(opts) {
    opts = opts || {};
    const pp = opts.page || {};
    const pages = opts.pages || {};
    const live = opts.live != null ? !!opts.live : false;
    destroyBoard("teacher"); destroyBoard("student");
    mountBoard("teacher", { live, page: pp.teacher || "theory", pages: pages.teacher });
    mountBoard("student", { live, page: pp.student || "theory", pages: pages.student });
    return true;
  }
  async function mountBothReady(opts) { mountBoth(opts); await settle(["teacher", "student"]); return true; }
  /** «живой урок»: обе доски с РАЗНЫМ live-HTML (teacher TEACHER-KEYS / student STUDENT-SHEET) */
  async function mountLiveBoth(opts) {
    opts = opts || {};
    mountBoth({ live: true, page: { teacher: opts.teacherPage || "theory", student: opts.studentPage || "theory" } });
    await settle(["teacher", "student"]);
    return true;
  }
  /** только учитель в live-режиме (вариант F4 «без ученика») */
  async function mountLiveTeacher(opts) {
    opts = opts || {};
    destroyBoard("teacher"); destroyBoard("student");
    mountBoard("teacher", { live: true, page: opts.page || "theory" });
    await settle(["teacher"]);
    return true;
  }
  /** досадить ученика в live-режиме, НЕ трогая уже смонтированного учителя (сценарий «учитель открыл первым») */
  async function mountLiveStudent(opts) {
    opts = opts || {};
    destroyBoard("student");
    mountBoard("student", { live: true, page: opts.page || "theory" });
    await settle(["student"]);
    return true;
  }
  function remount(side) { destroyBoard(side); mountBoard(side); return true; }
  async function remountReady(side) { remount(side); await settle([side]); return true; }

  /** SMOKE: проверить, что Board.keep() переиспользует тот же инстанс и release() его убирает */
  function keepProbe(side) {
    if (typeof window.Board.keep !== "function" || typeof window.Board.release !== "function") {
      return { ok: false, hasKeep: typeof window.Board.keep === "function", hasRelease: typeof window.Board.release === "function", err: "Board.keep/release отсутствуют" };
    }
    const host = document.createElement("div");
    host.className = "bd-keep-probe";
    host.style.cssText = "position:absolute;left:-3000px;top:0;width:420px;height:300px;overflow:hidden";
    document.body.appendChild(host);
    const opts = {
      api, channelName: CHANNEL + "-probe",
      sb: { channel: (n, c) => HUB.makeChannel(n, c), removeChannel: ch => HUB.removeChannel(ch) },
      role: side, name: "probe", pages: pagesFor(), page: "p2",
    };
    let a = null, b = null, err = null;
    try { a = window.Board.keep(host, "probe-" + side, opts); b = window.Board.keep(host, "probe-" + side, opts); }
    catch (e) { err = String(e && e.message || e); }
    const same = !!(a && b && a === b);
    try { window.Board.release(); } catch (_) {}
    try { host.remove(); } catch (_) {}
    return { ok: !err, same, err, hasKeep: true, hasRelease: true };
  }

  /* ---------- геометрия (логические координаты листа) ---------- */
  function cvRect(side) { const c = cv(side); return c ? c.getBoundingClientRect() : null; }
  function scaleOf(side) {
    try {
      const h = handles[side];
      const info = h && typeof h.info === "function" ? h.info() : null;
      if (info && info.scale > 0) return info.scale;
    } catch (_) {}
    const c = cv(side);
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return r.width ? r.width / W : null;
  }
  /** логические координаты листа -> координаты окна */
  function point(side, lx, ly) {
    const r = cvRect(side), s = scaleOf(side);
    if (!r || !s) return null;
    return { x: r.left + lx * s, y: r.top + ly * s };
  }
  /** rect элемента листа в логических координатах */
  function logicalRect(side, sel) {
    const c = cvRect(side), s = scaleOf(side);
    const r0 = root(side);
    const el = r0 && r0.querySelector(sel);
    if (!c || !s || !el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: (r.left - c.left) / s, y: (r.top - c.top) / s,
      w: r.width / s, h: r.height / s,
      right: (r.right - c.left) / s, bottom: (r.bottom - c.top) / s,
    };
  }
  /** доля закрашенных пикселей canvas в логическом прямоугольнике + bbox краски */
  function ink(side, box) {
    const c = cv(side);
    if (!c) return null;
    const ctx = c.getContext("2d");
    const k = c.width / W; // логический px -> пиксель canvas
    const x0 = Math.max(0, Math.floor((box.x || 0) * k));
    const y0 = Math.max(0, Math.floor((box.y || 0) * k));
    const w = Math.min(c.width - x0, Math.ceil((box.w != null ? box.w : W) * k));
    const h = Math.min(c.height - y0, Math.ceil((box.h != null ? box.h : 400) * k));
    if (w <= 0 || h <= 0) return { count: 0, frac: 0, bbox: null };
    const d = ctx.getImageData(x0, y0, w, h).data;
    let count = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        if (d[(yy * w + xx) * 4 + 3] > 10) {
          count++;
          const lx = (x0 + xx) / k, ly = (y0 + yy) / k;
          if (lx < minX) minX = lx;
          if (lx > maxX) maxX = lx;
          if (ly < minY) minY = ly;
          if (ly > maxY) maxY = ly;
        }
      }
    }
    return {
      count, frac: count / (w * h),
      bbox: count ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 } : null,
    };
  }
  function canvasInk(side) {
    const c = cv(side);
    if (!c) return 0;
    return ink(side, { x: 0, y: 0, w: W, h: (c.height / (c.width / W)) }).frac;
  }

  /* ---------- кнопки/инструменты ---------- */
  const textOf = b => ((b.title || "") + " " + (b.getAttribute("aria-label") || "") + " " + (b.textContent || "") + " " + (b.dataset.tool || "") + " " + (b.dataset.act || "")).toLowerCase();
  function findButton(side, re) {
    const r = root(side);
    if (!r) return null;
    return [...r.querySelectorAll("button")].find(b => re.test(textOf(b))) || null;
  }
  function clickButton(side, re) { const b = findButton(side, re); if (!b) return false; b.click(); return true; }
  function toolbarText(side) {
    const r = root(side);
    return [...(r ? r.querySelectorAll("button") : [])].map(textOf);
  }
  /** выбрать инструмент по data-tool (например "pen"); учтите: live-лист по умолчанию включает 👆 touch */
  function setTool(side, name) {
    const r = root(side);
    const b = r && r.querySelector('[data-tool="' + name + '"]');
    if (!b) return false;
    b.click();
    return true;
  }
  function currentTool(side) {
    const r = root(side);
    const b = r && r.querySelector('[data-tool][aria-pressed="true"]');
    return b ? b.dataset.tool : null;
  }

  /* ---------- окошко-редактор текста (.bd-editor) ---------- */
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && cs.display !== "none" && cs.visibility !== "hidden" && +cs.opacity > 0;
  }
  function visible(sel) { return [...document.querySelectorAll(sel)].filter(isVisible); }

  function textEditor() {
    let el = visible(".bd-editor")[0] || visible(".bd-inline")[0] || null;
    let raw = null;
    if (el) {
      raw = el.matches("textarea,[contenteditable='true'],[contenteditable='']")
        ? el
        : (el.querySelector("textarea.bd-editor-ta, .bd-inline-ta, textarea, [contenteditable='true']") || el);
    } else {
      const boxes = visible("textarea, [contenteditable='true'], [contenteditable=''], .bd-input, .bd-inline");
      const box = boxes[boxes.length - 1] || null;
      if (!box) return null;
      raw = box;
      el = box.closest(".bd-editor, .bd-inline") || box;
    }
    const br = el.getBoundingClientRect();
    let handle = null;
    const hs = visible(".bd-editor-handle, .bd-inline-resize, .bd-inline-handle, [data-bd-resize], [data-resize]");
    if (hs.length) {
      const hEl = hs[hs.length - 1];
      const r = hEl.getBoundingClientRect();
      const cls = String(hEl.className && hEl.className.baseVal !== undefined ? hEl.className.baseVal : hEl.className || "");
      handle = { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, by: "class", cls, el: hEl };
    } else {
      // запасной поиск ручки (если класс другой): маленький элемент у правого нижнего угла
      for (const cand of document.querySelectorAll("body *")) {
        if (cand === el || el.contains(cand) || cand.contains(el)) continue;
        const r = cand.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || r.width > 90 || r.height > 90) continue;
        if (!isVisible(cand)) continue;
        if (!(Math.abs(r.left - br.right) < 90 && Math.abs(r.top - br.bottom) < 90)) continue;
        const cs = getComputedStyle(cand);
        const cls = String(cand.className && cand.className.baseVal !== undefined ? cand.className.baseVal : cand.className || "");
        const byCursor = /nwse|resize|se-resize/i.test(cs.cursor);
        const byClass = /resize|handle|grip/i.test(cls) || cand.hasAttribute("data-handle") || cand.hasAttribute("data-resize") || cand.getAttribute("role") === "separator";
        if (byCursor || byClass) {
          handle = { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, by: byCursor ? "cursor" : "class", cls };
          break;
        }
      }
    }
    const focused = !!(document.activeElement && (el.contains(document.activeElement) || document.activeElement === raw));
    const value = raw && raw.value !== undefined ? raw.value : (raw ? raw.textContent || "" : "");
    return {
      el, ta: raw,
      box: { x: br.left, y: br.top, w: br.width, h: br.height, cx: br.left + br.width / 2, cy: br.top + br.height / 2 },
      handle, tag: raw ? raw.tagName : "", value, focused,
    };
  }
  function editorBoxNow() { const ed = textEditor(); return ed ? ed.box : null; }
  function editorFocused() { const ed = textEditor(); return ed ? !!ed.focused : false; }

  /* ---------- вспомогательные для макета ---------- */
  /** искусственный сдвиг макета: padding-top листа (DOM-структура та же — якоря data-bd не съезжают) */
  function shiftLayout(side, px) {
    const r = root(side);
    const sheet = r && (r.querySelector(".bd-bg .bd-sheet") || r.querySelector(".bd-bg > *"));
    if (!sheet) return false;
    sheet.style.paddingTop = Math.max(0, px) + "px";
    return true;
  }
  /** пересчитать layout/якоря после изменения макета */
  async function relayout(side) {
    const h = handles[side];
    let ok = false;
    try { if (h && typeof h.refresh === "function") { h.refresh(); ok = true; } } catch (_) {}
    if (!ok) { try { if (h && typeof h.relayout === "function") { h.relayout(); ok = true; } } catch (_) {} }
    if (!ok) {
      const r = root(side);
      const stage = r && r.querySelector(".bd-stage");
      if (stage) {
        const prev = stage.style.width;
        stage.style.width = (stage.getBoundingClientRect().width - 3) + "px";
        await sleep(80);
        stage.style.width = prev || "";
      }
    }
    await sleep(220);
    return ok;
  }
  function pageButtons(side) {
    const r = root(side);
    if (!r) return [];
    return [...r.querySelectorAll("[data-bpage]")].map(b => (b.textContent || "").trim());
  }
  function currentPage(side) {
    const r = root(side);
    if (!r) return null;
    const b = r.querySelector("[data-bpage][aria-pressed='true']");
    return b ? b.dataset.bpage : null;
  }
  function pageKeys(side) {
    const r = root(side);
    if (!r) return [];
    return [...r.querySelectorAll("[data-bpage]")].map(b => b.dataset.bpage);
  }
  function openPage(side, key) {
    const r = root(side);
    if (!r) return false;
    const b = [...r.querySelectorAll("[data-bpage]")].find(x => x.dataset.bpage === key);
    if (b) { b.click(); return true; }
    const h = handles[side];
    try { if (h && typeof h.openPage === "function") { h.openPage(key); return true; } } catch (_) {}
    return false;
  }
  function info(side) {
    const h = handles[side];
    try {
      const v = h && typeof h.info === "function" ? h.info() : null;
      if (v !== null && v !== undefined) return clone(v);
    } catch (e) { return { error: String(e) }; }
    return null;
  }
  function debug(side) {
    const h = handles[side];
    try { return h && typeof h.debug === "function" ? clone(h.debug()) : null; } catch (e) { return { error: String(e) }; }
  }
  async function whenIdle(side) { await idleOf(handles[side]); return true; }

  /* ---------- единый фон «живого» листа (bg / bgreq) ---------- */
  function bgEl(side) {
    const r = root(side);
    return r ? r.querySelector(".bd-bg") : null;
  }
  /** HTML фона доски (то, что реально нарисовано под canvas) */
  function bgHtml(side) {
    const el = bgEl(side);
    return el ? el.innerHTML : "";
  }
  /** "remote" (лист ученика), "own" (свой live-лист) или "static" (обычный лист) */
  function bgSource(side) {
    const i = info(side);
    return i && i.bgSource != null ? String(i.bgSource) : null;
  }
  function bgDebug(side) {
    const d = debug(side);
    return d && d.remoteBgPages != null ? d.remoteBgPages : null;
  }
  function waitBgSource(side, want, timeout) {
    const t0 = Date.now(), lim = timeout || 6000;
    return (async () => {
      while (Date.now() - t0 < lim) {
        if (bgSource(side) === want) return true;
        await sleep(80);
      }
      throw new Error("bgSource(«" + side + "») не стал «" + want + "» за " + lim + "мс (сейчас: " + String(bgSource(side)) + ")");
    })();
  }
  function waitBgContains(side, text, timeout) {
    const t0 = Date.now(), lim = timeout || 6000;
    return (async () => {
      while (Date.now() - t0 < lim) {
        const h = bgHtml(side);
        if (h.indexOf(text) >= 0) return true;
        await sleep(80);
      }
      throw new Error("в фоне «" + side + "» нет «" + text + "» за " + lim + "мс (html " + bgHtml(side).length + " симв.)");
    })();
  }
  /** дождаться, пока доска откроет лист key */
  function waitPage(side, key, timeout) {
    const t0 = Date.now(), lim = timeout || 6000;
    return (async () => {
      while (Date.now() - t0 < lim) {
        const i = info(side);
        if (i && i.page === key) return true;
        await sleep(60);
      }
      throw new Error("доска «" + side + "» не открыла лист «" + key + "» за " + lim + "мс (page=" + JSON.stringify(info(side) && info(side).page) + ")");
    })();
  }
  /** что за элемент листа закреплён якорем i (data-bd) на этой стороне */
  function elementAtAnchor(side, i) {
    if (i == null || i === "") return null;
    const r0 = root(side), els = r0 && [...r0.querySelectorAll("[data-bd]")];
    const el = els && els.find(e => +e.getAttribute("data-bd") === +i);
    if (!el) return null;
    const c = cvRect(side), s = scaleOf(side);
    const rr = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || ""),
      id: el.id || "",
      text: (el.textContent || "").trim().slice(0, 80),
      x: c && s ? (rr.left - c.left) / s : null,
      y: c && s ? (rr.top - c.top) / s : null,
      w: s ? rr.width / s : null,
      h: s ? rr.height / s : null,
    };
  }
  /** какой элемент листа лежит под логической точкой: для проверки «в каком элементе штрих».
     Считаем геометрически (самый маленький содержащий элемент), как anchorAt в board.js:
     так результат не зависит от прокрутки/pointer-events и одинаков на обеих досках. */
  const CONTENT_TAGS = { P: 1, LI: 1, TD: 1, TH: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, TABLE: 1, IMG: 1, PRE: 1, BLOCKQUOTE: 1, FIGCAPTION: 1, IFRAME: 1, VIDEO: 1 };
  function elementUnderPoint(side, lx, ly) {
    const c = cvRect(side), s = scaleOf(side), r0 = root(side);
    if (!c || !s || !r0) return null;
    let best = null, area = Infinity;
    r0.querySelectorAll(".bd-bg [data-bd]").forEach(el => {
      const r = el.getBoundingClientRect();
      const x = (r.left - c.left) / s, y = (r.top - c.top) / s, w = r.width / s, h = r.height / s;
      if (w <= 0 && h <= 0) return;
      if (lx >= x && lx <= x + w && ly >= y && ly <= y + h) {
        const a = w * h;
        if (a < area) { area = a; best = { el, box: { x, y, w, h } }; }
      }
    });
    if (!best) return { tag: "(ничего)", cls: "", id: "", text: "", insideGap: true };
    const el = best.el;
    const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || "");
    const isRoot = /(^|\s)(bd-sheet|bd-live|bd-bg)(\s|$)/.test(cls);
    return {
      tag: el.tagName, cls, id: el.id || "", text: (el.textContent || "").trim().slice(0, 60),
      box: best.box,
      /* пустое место: под точкой только корневая обёртка листа, а не абзац/текст */
      insideGap: isRoot || (!CONTENT_TAGS[el.tagName] && !el.children.length && !(el.textContent || "").trim()),
    };
  }
  /** журнал сообщений fake-канала (payloads), можно фильтровать по payload.type */
  function channelLog(type) { return HUB.messages(type == null ? null : type); }
  function channelHas(type) { return HUB.log.some(x => x.payload && x.payload.type === type); }
  function channelClear() { HUB.clearLog(); return true; }
  /** подождать, пока по каналу уйдёт сообщение типа type */
  function waitChannel(type, timeout) {
    const t0 = Date.now(), lim = timeout || 6000;
    return (async () => {
      while (Date.now() - t0 < lim) {
        if (channelHas(type)) return true;
        await sleep(60);
      }
      throw new Error("по каналу не ушло сообщение «" + type + "» за " + lim + "мс");
    })();
  }

  /* ---------- вложения: File в странице + attach(files) ---------- */
  function makeFile(f) {
    const bin = atob(f.b64 || "");
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new File([u8], f.name || "file", { type: f.type || "application/octet-stream" });
  }
  /** files: [{name,type,b64}]. Не ждёт выбора в диалоге — тест сам кликает кнопку. */
  function attachFiles(side, files) {
    const h = handles[side];
    if (!h) throw new Error("нет доски «" + side + "»");
    const list = (files || []).map(makeFile);
    if (typeof h.attach === "function") {
      Promise.resolve().then(() => h.attach(list)).catch(e => console.error("attach", e));
      return list.length;
    }
    const inp = root(side) && root(side).querySelector("input[type=file]");
    if (inp) {
      try {
        const dt = new DataTransfer();
        list.forEach(f => dt.items.add(f));
        inp.files = dt.files;
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        return list.length;
      } catch (e) { console.error("DataTransfer", e); }
    }
    throw new Error("у доски «" + side + "» нет attach(files) и input[type=file] — вложения недоступны");
  }

  /* ---------- task-24: зум/пан, инлайн-текст, вставка в точку, API доски ---------- */
  function apiNames(side) { const h = handles[side]; return h ? Object.keys(h) : []; }
  async function boardCall(side, method, ...args) {
    const h = handles[side];
    if (!h || typeof h[method] !== "function") throw new Error("у доски «" + side + "» нет API " + method + "()");
    const res = await h[method](...args);
    try { return res === undefined ? null : JSON.parse(JSON.stringify(res)); } catch (_) { return res; }
  }
  function lastPoint(side) {
    try { const h = handles[side]; if (h && typeof h.lastPoint === "function") return h.lastPoint(); } catch (_) {}
    const i = info(side); return i && i.lastPoint ? i.lastPoint : null;
  }
  function boardView(side) {
    try { const h = handles[side]; if (h && typeof h.getView === "function") return h.getView(); } catch (_) {}
    const i = info(side);
    return i ? { zoom: i.zoom, scale: i.scale, scrollX: i.scrollX, scrollY: i.scrollY } : null;
  }
  function zoomOf(side) { const v = boardView(side); return v && v.zoom != null ? +v.zoom : null; }
  /** скроллируемый контейнер доски (stage) */
  function scrollEl(side) {
    const r = root(side); if (!r) return null;
    let el = cv(side);
    while (el && el !== r.parentElement) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2)) return el;
      el = el.parentElement;
    }
    return r.querySelector(".bd-stage");
  }
  function scrollInfo(side) {
    const el = scrollEl(side);
    if (!el) return null;
    return { top: el.scrollTop, left: el.scrollLeft, maxTop: Math.max(0, el.scrollHeight - el.clientHeight), maxLeft: Math.max(0, el.scrollWidth - el.clientWidth), h: el.clientHeight, w: el.clientWidth };
  }
  function setScroll(side, { top, left } = {}) {
    const el = scrollEl(side); if (!el) return false;
    if (top != null) el.scrollTop = top;
    if (left != null) el.scrollLeft = left;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
    try { handles[side] && handles[side].relayout && handles[side].relayout(); } catch (_) {}
    return true;
  }
  function zoomBtn(side, kind) { const r = root(side); return r ? r.querySelector('[data-zoom="' + kind + '"]') : null; }
  function clickZoom(side, kind) {
    const b = zoomBtn(side, kind);
    if (b) { b.click(); return true; }
    const texts = { in: /\+|увелич/i, out: /−|уменьш/i, reset: /100\s*%/, fit: /по\s*ширине|fit/i };
    return clickButton(side, texts[kind] || new RegExp(kind, "i"));
  }
  function zoomLabel(side) { const el = root(side) && root(side).querySelector("[data-zoom-label]"); return el ? el.textContent : null; }
  function extendBtn(side) {
    const r = root(side); if (!r) return null;
    return r.querySelector('[data-act="extend"], [data-extend]') || [...r.querySelectorAll("button")].find(b => /расшир/i.test((b.title || "") + (b.textContent || ""))) || null;
  }
  function extendBoard(side) { const b = extendBtn(side); if (!b) return false; b.click(); return true; }
  function setZoom(side, z, cx, cy) { const h = handles[side]; if (!h || typeof h.setZoom !== "function") throw new Error("нет setZoom у «" + side + "»"); h.setZoom(z, cx, cy); return true; }
  function zoomBy(side, d) { const h = handles[side]; if (!h || typeof h.zoomBy !== "function") throw new Error("нет zoomBy у «" + side + "»"); h.zoomBy(d); return true; }
  function fitWidth(side) { const h = handles[side]; if (!h || typeof h.fitWidth !== "function") throw new Error("нет fitWidth у «" + side + "»"); h.fitWidth(); return true; }
  function wheelBoard(side, { deltaY = -120, ctrlKey = true, altKey = false, lx = 400, ly = 300 } = {}) {
    const c = cv(side); if (!c) return false;
    const p = point(side, lx, ly); if (!p) return false;
    const mk = () => new WheelEvent("wheel", { deltaY, ctrlKey, altKey, bubbles: true, cancelable: true, clientX: p.x, clientY: p.y });
    c.dispatchEvent(mk());
    const stage = scrollEl(side) || c.parentElement;
    if (stage) stage.dispatchEvent(mk());
    return true;
  }
  /** инлайн-редактор текста: `.bd-inline` (старые `.bd-editor`-классы сохраняются) */
  function inlineInfo(side) {
    if (side === undefined) side = "teacher";
    const r = root(side) || document;
    const el = [...r.querySelectorAll(".bd-inline, [data-bd-inline]")].find(isVisible) || null;
    if (!el) return { exists: false };
    const ta = el.querySelector(".bd-inline-ta, .bd-editor-ta, textarea");
    const dragEl = el.querySelector(".bd-inline-drag, [data-bd-inline-drag]");
    const resizeEl = el.querySelector(".bd-inline-resize, .bd-editor-handle, [data-bd-inline-resize]");
    const c = cvRect(side), s = scaleOf(side), br = el.getBoundingClientRect();
    const box = { x: br.left, y: br.top, w: br.width, h: br.height, cx: br.left + br.width / 2, cy: br.top + br.height / 2 };
    const logical = c && s ? { x: (br.left - c.left) / s, y: (br.top - c.top) / s, w: br.width / s, h: br.height / s } : null;
    const rectOf = e => { if (!e) return null; const q = e.getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height, cx: q.left + q.width / 2, cy: q.top + q.height / 2 }; };
    const dragStyle = dragEl ? getComputedStyle(dragEl) : null;
    return {
      exists: true, el, ta, box, logical,
      drag: rectOf(dragEl), resize: rectOf(resizeEl),
      dragVisible: !!(dragStyle && +dragStyle.opacity > 0.05 && dragStyle.display !== "none"),
      value: ta && ta.value != null ? ta.value : "",
      focused: !!(document.activeElement && (el.contains(document.activeElement) || document.activeElement === ta)),
    };
  }
  function inlineType(side, text) {
    const inf = inlineInfo(side);
    if (!inf.exists || !inf.ta) throw new Error("нет .bd-inline textarea на доске «" + side + "»");
    const ta = inf.ta;
    ta.focus();
    ta.value = String(text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  /** hover по инлайн-редактору (появляется ручка-перетаскивание) */
  function hoverInline(side, where = "center") {
    const inf = inlineInfo(side);
    if (!inf.exists) return false;
    const b = inf.box;
    const p = where === "drag" && inf.drag ? { x: inf.drag.cx, y: inf.drag.cy } : { x: b.cx, y: b.cy };
    const fire = (target, evName, Ev) => { try { target.dispatchEvent(new Ev(evName, { bubbles: true, clientX: p.x, clientY: p.y })); } catch (_) {} };
    fire(inf.el, "mousemove", MouseEvent); fire(inf.el, "mouseover", MouseEvent);
    fire(inf.el, "pointermove", PointerEvent); fire(document.body, "mousemove", MouseEvent);
    return true;
  }
  /** paste: ClipboardEvent с DataTransfer на document (текст и/или картинка) */
  function pasteBoard(side, { text = "", b64 = "", type = "image/png", name = "paste.png" } = {}) {
    const dt = new DataTransfer();
    if (text) dt.setData("text/plain", String(text));
    if (b64) {
      const bin = atob(b64), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      try { dt.items.add(new File([u8], name, { type })); } catch (e) { console.error("paste file", e); }
    }
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    return true;
  }
  /** элементы доски: [{id, item}] из debug().raw (клон) */
  function items(side) { const d = debug(side); return d && Array.isArray(d.raw) ? d.raw : []; }
  function itemsJson(side) { try { return JSON.stringify(items(side)); } catch (_) { return "[]"; } }
  function countItems(side, t) { return items(side).filter(r => (t == null || (r.item && r.item.t === t))).length; }

  window.__board = {
    LESSON, CHANNEL, W, PAGE_HTML_MAX, PAGE_KEY, LIVE_PAGES, sleep, clone,
    HUB, api, store, dump, storeAll, seed, clearStore,
    pagesFor, teacherLiveHtml, studentLiveHtml, liveHtml, liveMap, liveRenderDetached,
    mountOpts, mountBoard, destroyBoard, mountBoth, mountBothReady, mountLiveBoth, mountLiveTeacher, mountLiveStudent,
    remount, remountReady, keepProbe, handles, toasts,
    root, cv, scaleOf, cvRect, point, logicalRect, ink, canvasInk,
    findButton, clickButton, toolbarText, setTool, currentTool,
    textEditor, editorBoxNow, editorFocused, isVisible,
    shiftLayout, relayout, pageButtons, pageKeys, currentPage, openPage, waitPage,
    info, debug, whenIdle, ready: () => Promise.all([readyOf(handles.teacher, "teacher"), readyOf(handles.student, "student")]),
    bgEl, bgHtml, bgSource, bgDebug, waitBgSource, waitBgContains, elementAtAnchor, elementUnderPoint,
    channelLog, channelHas, channelClear, waitChannel,
    makeFile, attachFiles,
    apiNames, boardCall, lastPoint, boardView, zoomOf, scrollEl, scrollInfo, setScroll,
    zoomBtn, clickZoom, zoomLabel, extendBtn, extendBoard, setZoom, zoomBy, fitWidth, wheelBoard,
    inlineInfo, inlineType, hoverInline, pasteBoard, items, itemsJson, countItems,
  };
})();
