/* Фейковый Supabase для офлайн-проверок repetitor (без npm и без сети).
   Внедряется через Page.addScriptToEvaluateOnNewDocument ДО скриптов страницы.
   Перед ним внедряется скрипт, задающий:
     window.__MOCK_CFG = {
       db: {tables:{...}, tokens:{<token>:<students.id>}, seq:5000},  // общая база в localStorage
       session: <сессия учителя | null>,       // auth.getSession
       reset: true|false                        // перезаписать базу (только первая вкладка)
     }
   Общее состояние вкладок: localStorage + BroadcastChannel (broadcast/presence каналов и запись базы).
   Хелперы для теста: window.__MOCK.LOG / dbTable() / broadcastLog() / rpcLog() / presenceOf(). */
(function () {
  "use strict";
  /* на about:blank localStorage недоступен (SecurityError) — там мок не нужен,
     на реальной странице скрипт выполнится заново */
  try { if (typeof location !== "undefined" && location.protocol === "about:") return; } catch (_) {}
  const CFG = window.__MOCK_CFG || {};
  const DB_KEY = "mock-db-v1";
  const VER_KEY = "mock-db-ver";
  const TAB = Math.random().toString(36).slice(2, 9);
  const LOG = { broadcasts: [], rpcs: [], from: [], involves: [] };
  const say = (...a) => { try { console.log("[mock-sb]", ...a); } catch (_) {} };
  let writeSeq = 0; // версия базы обязана меняться на каждую запись (даже в одну и ту же мс)

  /* ---------- общая база (localStorage, несколько вкладок) ---------- */
  function blankDB() { return { tables: {}, tokens: {}, seq: 5000 }; }
  function writeDB(db) {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      localStorage.setItem(VER_KEY, String(Date.now()) + "-" + TAB + "-" + (++writeSeq));
    } catch (e) { say("db write error", e && e.message); }
  }
  if (CFG.reset || !localStorage.getItem(DB_KEY)) writeDB(CFG.db || blankDB());
  let DB = null, lastVer = null;
  function db() {
    let ver = null;
    try { ver = localStorage.getItem(VER_KEY); } catch (_) {}
    if (!DB || ver !== lastVer) {
      try {
        const raw = localStorage.getItem(DB_KEY);
        DB = raw ? JSON.parse(raw) : (CFG.db || blankDB());
      } catch (_) { DB = DB || CFG.db || blankDB(); }
      lastVer = ver;
    }
    DB.tables = DB.tables || {};
    DB.tokens = DB.tokens || {};
    return DB;
  }
  function table(name) {
    const d = db();
    return (d.tables[name] = d.tables[name] || []);
  }
  function nextId() { const d = db(); d.seq = (d.seq || 5000) + 1; return d.seq; }
  function saveDB() { writeDB(db()); post({ kind: "db", from: TAB }); }
  function log(kind, rec) { LOG[kind].push(Object.assign({ at: Date.now(), tab: TAB }, rec)); if (LOG[kind].length > 800) LOG[kind].shift(); }

  /* ---------- межвкладочная шина ---------- */
  let bc = null;
  try { if (typeof BroadcastChannel !== "undefined") bc = new BroadcastChannel("mock-supabase"); } catch (_) {}
  function post(msg) { try { if (bc) bc.postMessage(msg); } catch (_) {} }

  /* ---------- каналы: broadcast + presence ---------- */
  const channels = new Set();
  const presence = new Map(); // channel -> Map(key -> state)
  function presenceMap(name) { if (!presence.has(name)) presence.set(name, new Map()); return presence.get(name); }
  function presenceStateOf(name) {
    const out = {};
    presenceMap(name).forEach((st, k) => { (out[k] = out[k] || []).push(st); });
    return out;
  }
  function fire(ch, kind, event, payload) {
    (ch._handlers || []).filter(h => h.kind === kind && (!h.filter.event || h.filter.event === event))
      .forEach(h => { try { h.cb(payload); } catch (e) { say("handler", e && e.message); } });
  }
  function firePresence(name) {
    channels.forEach(ch => { if (ch.name === name) fire(ch, "presence", "sync", { event: "sync" }); });
  }
  function fireBroadcast(name, event, payload) {
    channels.forEach(ch => { if (ch.name === name) fire(ch, "broadcast", event, { payload }); });
  }
  if (bc) bc.onmessage = ev => {
    const m = ev.data || {};
    if (!m || m.from === TAB) return;
    if (m.kind === "bc") fireBroadcast(m.channel, m.event, m.payload);
    else if (m.kind === "presence") {
      const map = presenceMap(m.channel);
      if (m.state) map.set(m.key, m.state); else map.delete(m.key);
      firePresence(m.channel);
    } else if (m.kind === "presence-req") {
      presenceMap(m.channel).forEach((st, k) => post({ kind: "presence", channel: m.channel, key: k, state: st, from: TAB }));
    }
  };

  function createChannel(name, cfg) {
    cfg = cfg || {};
    const key = (cfg.presence && cfg.presence.key) || ("k-" + TAB + "-" + Math.random().toString(36).slice(2, 6));
    const ch = {
      name, cfg, _handlers: [], _key: key, _state: null, _sub: false,
      on(kind, filter, cb) { ch._handlers.push({ kind, filter: filter || {}, cb }); return ch; },
      subscribe(cb) {
        ch._sub = true;
        setTimeout(() => { try { cb && cb("SUBSCRIBED"); } catch (e) { say("sub cb", e && e.message); } }, 0);
        post({ kind: "presence-req", channel: name, from: TAB });
        setTimeout(() => firePresence(name), 30);
        return ch;
      },
      send(msg) {
        const type = msg && msg.payload && msg.payload.type;
        log("broadcasts", { channel: name, event: msg && msg.event, type, payload: msg && msg.payload });
        post({ kind: "bc", channel: name, event: msg && msg.event, payload: msg && msg.payload, from: TAB });
        return Promise.resolve("ok");
      },
      track(state) {
        ch._state = state;
        presenceMap(name).set(key, state);
        post({ kind: "presence", channel: name, key, state, from: TAB });
        setTimeout(() => firePresence(name), 0);
        return Promise.resolve("ok");
      },
      untrack() {
        ch._state = null;
        presenceMap(name).delete(key);
        post({ kind: "presence", channel: name, key, state: null, from: TAB });
        setTimeout(() => firePresence(name), 0);
        return Promise.resolve("ok");
      },
      presenceState() { return presenceStateOf(name); },
      unsubscribe() { channels.delete(ch); },
    };
    channels.add(ch);
    return ch;
  }
  function removeChannel(ch) { channels.delete(ch); }

  /* ---------- auth ---------- */
  const auth = {
    async getSession() { return { data: { session: CFG.session || null }, error: null }; },
    onAuthStateChange(cb) {
      const sub = { unsubscribe() {} };
      setTimeout(() => { try { cb && cb("SIGNED_IN", CFG.session || null); } catch (_) {} }, 0);
      return { data: { subscription: sub } };
    },
    async signInWithPassword() { return { data: { session: CFG.session || null, user: (CFG.session && CFG.session.user) || null }, error: null }; },
    async signOut() { return { error: null }; },
    async updateUser() { return { data: { user: (CFG.session && CFG.session.user) || null }, error: null }; },
    async signUp() { return { data: { session: CFG.session || null, user: { id: "mock-user", email: "mock@test" } }, error: null }; },
    async signInAnonymously() { return { data: { session: CFG.session || null }, error: null }; },
    async resetPasswordForEmail() { return { error: null }; },
    async resend() { return { error: null }; },
    async setSession() { return { error: null }; },
  };

  /* ---------- storage / functions ---------- */
  function storageBucket(bucket) {
    return {
      async upload(path) { return { data: { path }, error: null }; },
      getPublicUrl(path) { return { data: { publicUrl: "mock://" + bucket + "/" + path } }; },
      async remove() { return { data: {}, error: null }; },
    };
  }
  /* Детерминированная «нейросеть»: generate_tasks отдаёт 2-3 вопроса с объяснением и темой.
     Форма ответа = data, который возвращает ai() в teacher.js: { title, mini:[], test:[{q,o,a,e,tag}] }. */
  function mockAiResult(action, body) {
    if (action === "generate_tasks") {
      const topic = String(body.topic || "Тема").slice(0, 200);
      const want = Math.max(1, Math.min(3, +body.count || 3));       // в моке не больше 3 вопросов
      const test = [];
      for (let i = 0; i < want; i++) {
        test.push({
          q: `ИИ: ${topic} — вопрос ${i + 1}. Выберите верный вариант.`,
          o: [`Вариант А (${i + 1})`, `Вариант Б (${i + 1})`, `Вариант В (${i + 1})`, `Вариант Г (${i + 1})`],
          a: i % 4,
          e: `Объяснение ИИ по теме «${topic}», вопрос ${i + 1}: верный вариант отмечен в ключе.`,
          tag: topic,
        });
      }
      return { title: "ИИ-задания: " + topic, mini: [], test, meta: { action: "generate_tasks", mock: true } };
    }
    return { title: "", mini: [], test: [], meta: { action, mock: true } };
  }
  const functions = {
    async invoke(name, opts) {
      const body = (opts && opts.body) || {};
      if (name === "ai") {
        const data = mockAiResult(String(body.action || ""), body);
        log("involves", { name, action: body.action });
        return { data, error: null, name, body };
      }
      log("involves", { name, action: body.action });
      return { data: null, error: null, name, body };
    },
  };

  /* ---------- from(): select/insert/update/delete/upsert + фильтры ---------- */
  const eq = (a, b) => String(a) === String(b);
  function applyFilters(rows, filters) {
    return rows.filter(r => filters.every(([op, col, val]) => {
      if (op === "eq") return eq(r[col], val);
      if (op === "in") return (val || []).some(v => eq(r[col], v));
      if (op === "neq") return !eq(r[col], val);
      return true;
    }));
  }
  function runQuery(q) {
    const rows = table(q.table);
    const out = { data: null, error: null };
    if (q.op === "select") {
      let list = applyFilters(rows.slice(), q.filters);
      (q.orders || []).forEach(([col, o]) => {
        const dir = o && o.ascending === false ? -1 : 1;
        list.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * dir);
      });
      if (q.limitN != null) list = list.slice(0, q.limitN);
      out.data = q.singleMode ? (list[0] || null) : list;
      return out;
    }
    if (q.op === "insert") {
      const added = [];
      const sessUid = (CFG.session && CFG.session.user && CFG.session.user.id) || null;
      (q.rows || []).forEach(row => {
        const rec = Object.assign({}, row);
        if (rec.id == null) rec.id = nextId();
        /* как default auth.uid() в схеме: у таблиц с teacher_id владелец – текущий учитель */
        if (rec.teacher_id == null && sessUid) rec.teacher_id = sessUid;
        if (!rec.created_at) rec.created_at = new Date().toISOString();
        added.push(rec);
      });
      rows.push(...added);
      saveDB();
      log("from", { table: q.table, op: "insert", n: added.length });
      out.data = q.returning ? (q.singleMode ? added[0] : added) : null;
      return out;
    }
    if (q.op === "update") {
      const hit = applyFilters(rows, q.filters);
      hit.forEach(r => Object.assign(r, q.row));
      saveDB();
      log("from", { table: q.table, op: "update", n: hit.length });
      out.data = q.returning ? (q.singleMode ? (hit[0] || null) : hit) : null;
      return out;
    }
    if (q.op === "upsert") {
      const row = Object.assign({}, q.row);
      const cols = String(q.onConflict || "").split(",").map(s => s.trim()).filter(Boolean);
      let exist = cols.length ? rows.find(r => cols.every(c => eq(r[c], row[c]))) : null;
      if (exist) Object.assign(exist, row);
      else { if (row.id == null) row.id = nextId(); rows.push(row); exist = row; }
      saveDB();
      log("from", { table: q.table, op: "upsert", n: 1 });
      out.data = q.returning ? exist : null;
      return out;
    }
    if (q.op === "delete") {
      const before = rows.length;
      const keep = rows.filter(r => !applyFilters([r], q.filters).length);
      table(q.table).length = 0;
      table(q.table).push(...keep);
      saveDB();
      log("from", { table: q.table, op: "delete", n: before - keep.length });
      out.data = null;
      return out;
    }
    return out;
  }
  function from(tableName) {
    const q = { table: tableName, op: "select", cols: "*", filters: [], orders: [], limitN: null, singleMode: false, rows: null, row: null, onConflict: null, returning: false };
    const api = {
      select(cols) {
        if (q.op === "insert" || q.op === "upsert") { q.returning = cols || "*"; } else { q.op = "select"; q.cols = cols || "*"; }
        return api;
      },
      insert(rows) { q.op = "insert"; q.rows = [].concat(rows); return api; },
      update(row) { q.op = "update"; q.row = row; return api; },
      upsert(row, opts) { q.op = "upsert"; q.row = row; q.onConflict = opts && opts.onConflict; return api; },
      delete() { q.op = "delete"; return api; },
      eq(col, val) { q.filters.push(["eq", col, val]); return api; },
      neq(col, val) { q.filters.push(["neq", col, val]); return api; },
      in(col, vals) { q.filters.push(["in", col, vals]); return api; },
      order(col, opts) { q.orders.push([col, opts]); return api; },
      limit(n) { q.limitN = n; return api; },
      single() { q.singleMode = true; return api; },
      then(resolve, reject) {
        let r;
        try { r = runQuery(q); } catch (e) { r = { data: null, error: { message: String(e && e.message || e) } }; }
        return Promise.resolve(r).then(resolve, reject);
      },
      catch(fn) { return api.then(v => v, fn); },
    };
    return api;
  }

  /* ---------- rpc ---------- */
  function teacherRow() {
    const want = (CFG.session && CFG.session.user && CFG.session.user.id) || "t-1001";
    return table("teachers").find(t => String(t.id) === String(want)) || table("teachers")[0] || null;
  }
  function rowByToken(code) {
    if (!code) return null;
    const id = db().tokens[code];
    if (id == null) return null;
    return table("students").find(r => String(r.id) === String(id)) || null;
  }
  function siblingsOf(row) {
    return table("students").filter(r => String(r.person_id || r.id) === String(row.person_id || row.id));
  }
  function profileOf(row) {
    if (!row) return null;
    const subs = siblingsOf(row).map(r => ({ id: r.id, subject: r.subject, course: r.course, grade: r.grade, name: r.name }));
    return {
      id: row.id, name: row.name, login: row.code, teacher: row.teacher || row.teacher_id,
      grade: row.grade, subject: row.subject, course: row.course,
      person_id: row.person_id || row.id, subjects: subs, board_owner: row.id,
      call_url: row.call_url || "", theme: row.theme || null, mascot: null, pair: null,
      unlocked: row.unlocked || [], dates: row.dates || {}, start_date: row.start_date || null,
      goals: row.goals || [], goal: row.goal || "",
    };
  }
  function courseDataFor(key) {
    const r = table("course_data").find(x => x.key === key);
    return r ? r.data : null;
  }
  function boardLessonKey(row) { return row; }
  function boardRows(code, lesson) {
    const row = rowByToken(code);
    if (!row) return [];
    return table("board_items")
      .filter(r => eq(r.student_id, row.id) && r.lesson_id === lesson)
      .sort((a, b) => a.id - b.id)
      .map(r => ({ id: r.id, item: r.item }));
  }
  const RPC = {
    me: () => teacherRow(),
    student_state: ({ p_code }) => {
      const row = rowByToken(p_code);
      if (!row) return null;
      const profile = profileOf(row);
      return {
        profile,
        results: table("results").filter(r => eq(r.student_id, row.id)),
        homework: table("homework").filter(r => eq(r.student_id, row.id)),
        sheets: table("sheets").filter(r => eq(r.student_id, row.id)),
        writings: table("writings").filter(r => eq(r.student_id, row.id)),
        materials: table("materials"),
        works: table("works").filter(r => eq(r.student_id, row.id)),
        course_data: courseDataFor(profile.course),
      };
    },
    student_switch: ({ p_code, p_target }) => {
      const row = table("students").find(r => eq(r.id, p_target));
      if (!row) throw new Error("no such student row");
      const token = "TOKEN-" + row.id + "-" + Math.random().toString(36).slice(2, 6);
      db().tokens[token] = row.id;
      saveDB();
      return { token, profile: profileOf(row) };
    },
    board_load: ({ p_code, p_lesson }) => boardRows(p_code, p_lesson),
    board_add: ({ p_code, p_lesson, p_item }) => {
      const row = rowByToken(p_code);
      if (!row) throw new Error("no student by token");
      const rec = { id: nextId(), student_id: row.id, lesson_id: p_lesson, item: p_item, author: "student", created_at: new Date().toISOString() };
      table("board_items").push(rec);
      saveDB();
      return rec.id;
    },
    board_remove: ({ p_code, p_lesson, p_ids }) => {
      const row = rowByToken(p_code);
      if (!row) return true;
      const ids = new Set((p_ids || []).map(String));
      const keep = table("board_items").filter(r => !(eq(r.student_id, row.id) && r.lesson_id === p_lesson && ids.has(String(r.id))));
      table("board_items").length = 0;
      table("board_items").push(...keep);
      saveDB();
      return true;
    },
    /* ---------- тесты по темам: контракт supabase/schema.sql ---------- */
    quiz_get: ({ p_token, token }) => {
      const id = String(p_token || token || "");
      if (id.length < 6 || id.length > 32) return null;              // как length(p_token) between 6 and 32
      const q = table("quizzes").find(r => String(r.id) === id);
      if (!q) return null;
      return { id: q.id, title: q.title, data: q.data || {}, created_at: q.created_at };
    },
    quiz_submit: ({ p_code, p_token, p_score, p_total, p_details, p_needs_work }) => {
      const row = rowByToken(p_code);
      if (!row) throw new Error("unknown code");
      const score = +p_score, total = +p_total;
      if (!(Number.isFinite(score) && Number.isFinite(total) && total >= 0 && total <= 200 && score >= 0 && score <= total)) throw new Error("bad score");
      const q = table("quizzes").find(r => String(r.id) === String(p_token));
      if (!q) throw new Error("quiz not found");
      if (String(q.teacher_id) !== String(row.teacher_id)) throw new Error("not your quiz");
      if (q.student_id != null && String(q.student_id) !== String(row.id)) throw new Error("quiz for another student");
      const details = p_details && typeof p_details === "object" ? p_details : {};
      if (JSON.stringify(details).length > 60000) throw new Error("too big");
      const needs = Array.isArray(p_needs_work) ? p_needs_work.map(String) : [];
      table("quiz_results").push({
        id: nextId(), quiz_id: String(q.id), student_id: row.id, score, total,
        details, needs_work: needs, created_at: new Date().toISOString(),
      });
      saveDB();
      return null;                                                    // function returns void
    },
    student_quizzes: ({ p_code }) => {
      const row = rowByToken(p_code);
      if (!row) return { quizzes: [], results: [] };
      const byDateDesc = (a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""));
      const results = table("quiz_results")
        .filter(r => String(r.student_id) === String(row.id))
        .sort(byDateDesc)
        .slice(0, 100)
        .map(r => {
          const q = table("quizzes").find(x => String(x.id) === String(r.quiz_id));
          return { quiz_id: r.quiz_id, title: q ? q.title : "", score: r.score, total: r.total, details: r.details || {}, needs_work: r.needs_work || [], created_at: r.created_at };
        });
      const quizzes = table("quizzes")
        .filter(q => String(q.teacher_id) === String(row.teacher_id) && (q.student_id == null || String(q.student_id) === String(row.id)))
        .sort(byDateDesc)
        .slice(0, 50)
        .map(q => {
          const last = table("quiz_results")
            .filter(r => String(r.quiz_id) === String(q.id) && String(r.student_id) === String(row.id))
            .sort(byDateDesc)[0] || null;
          return {
            id: q.id, title: q.title, created_at: q.created_at,
            topics: Array.isArray(q.data && q.data.topics) ? q.data.topics.length : 0,
            questions: Array.isArray(q.data && q.data.questions) ? q.data.questions.length : 0,
            last: last ? { score: last.score, total: last.total, at: last.created_at } : null,
          };
        });
      return { quizzes, results };
    },
    student_ping: () => true,
    student_save_work: () => true,
    student_submit_result: () => true,
    student_submit_homework: () => true,
    student_submit_writing: () => true,
    student_set_mascot: () => true,
    student_set_theme: () => true,
    invite_info: () => null,
    teacher_by_code: () => null,
    student_login: () => null,
    student_register: () => null,
    student_signup: () => null,
    teacher_add_subject: () => null,
    teacher_new_invite: () => null,
    teacher_set_pair: () => null,
    teacher_set_theme: () => true,
    dev_join: () => null,
    upload_work: () => null,
  };
  async function rpc(name, params) {
    log("rpcs", { name, keys: params ? Object.keys(params) : [] });
    const fn = RPC[name];
    if (!fn) { say("rpc unknown:", name); return { data: null, error: null }; }
    try { return { data: await fn(params || {}), error: null }; }
    catch (e) { say("rpc error", name, e && e.message); return { data: null, error: { message: String((e && e.message) || e) } }; }
  }

  /* ---------- публичный клиент ---------- */
  const client = {
    auth, functions,
    storage: { from: storageBucket },
    from,
    rpc,
    channel: createChannel,
    removeChannel,
    async removeAllChannels() { channels.clear(); },
    realtime: { connect() {}, disconnect() {} },
  };
  /* Не даём CDN-скрипту supabase-js (если сеть в Chrome доступна) перезаписать заглушку:
     иначе приложение создаст настоящий клиент и уйдёт на реальный вход. */
  const sbMock = { createClient: () => client };
  try { Object.defineProperty(window, "supabase", { value: sbMock, writable: false, configurable: false }); }
  catch (_) { window.supabase = sbMock; }

  /* ---------- хелперы для тестов ---------- */
  window.__MOCK = {
    TAB,
    CFG,
    LOG,
    client,
    tables: () => { const d = db(); const out = {}; Object.keys(d.tables).forEach(k => { out[k] = JSON.parse(JSON.stringify(d.tables[k])); }); return out; },
    dbTable: name => JSON.parse(JSON.stringify(table(name))),
    tokens: () => JSON.parse(JSON.stringify(db().tokens || {})),
    reset: seed => { writeDB(seed || blankDB()); },
    broadcastLog: () => JSON.parse(JSON.stringify(LOG.broadcasts.slice(-160))),
    rpcLog: () => JSON.parse(JSON.stringify(LOG.rpcs.slice(-160))),
    involveLog: () => JSON.parse(JSON.stringify(LOG.involves.slice(-60))),
    /** последний вызов rpc с именем name (для проверок quiz_submit/quiz_get) */
    lastRpc: (name) => {
      const list = LOG.rpcs.filter(r => r.name === name);
      return list.length ? JSON.parse(JSON.stringify(list[list.length - 1])) : null;
    },
    rpcNames: () => [...new Set(LOG.rpcs.map(r => r.name))],
    channels: () => [...channels].map(c => c.name),
    presenceOf: name => JSON.parse(JSON.stringify(presenceStateOf(name))),
    lastCmd: () => {
      const list = LOG.broadcasts.filter(b => b.event === "cmd" && b.payload && b.payload.cmd);
      return list.length ? JSON.parse(JSON.stringify(list[list.length - 1].payload)) : null;
    },
    cmdList: () => JSON.parse(JSON.stringify(LOG.broadcasts.filter(b => b.event === "cmd" && b.payload && b.payload.cmd).map(b => b.payload))),
  };
  say("готов", TAB);
})();
