/* Кабинет учителя */
(() => {
const {esc, d, today, fmt, fmtShort, pct, lvl, lvlColor, toast} = U;
const CFG = window.APP_CONFIG || {};
const sb = U.supa();
const T = {session:null, view:"students", sel:null, open:null, sub:"theory", review:null, students:[], rows:[], hw:[], sheets:[], loading:false, confirmDel:null};
const $ = s => document.querySelector(s);
const course = id => COURSES[id] || COURSES[CFG.DEFAULT_COURSE || "oge-rus"];
const studentLink = s => `${location.origin}${location.pathname.replace(/teacher\.html$/, "")}?code=${s.code}`;

async function loadAll(){
  if (!sb || !T.session) return;
  T.loading = true; render();
  const [st, rs, hw, sh] = await Promise.all([
    sb.from("students").select("*").order("created_at"),
    sb.from("results").select("*").order("created_at"),
    sb.from("homework").select("*"),
    sb.from("sheets").select("*")
  ]);
  const err = st.error || rs.error || hw.error || sh.error;
  if (err) toast("Ошибка загрузки: " + err.message);
  T.students = st.data || []; T.rows = rs.data || []; T.hw = hw.data || []; T.sheets = sh.data || [];
  T.loading = false; render();
}
function sData(s){
  const results = U.aggregate(T.rows.filter(r => r.student_id === s.id));
  const hw = Object.fromEntries(T.hw.filter(h => h.student_id === s.id).map(h => [h.lesson_id, h]));
  const c = course(s.course);
  const last = T.rows.filter(r => r.student_id === s.id).map(r => r.created_at).sort().at(-1);
  return {results, hw, c, last, waiting: Object.values(hw).filter(h => h.status === "sent").length};
}
const sheetFor = (c, lid) => T.sheets.find(x => x.course === c && x.lesson_id === lid) || {};

/* ---------- экраны ---------- */
function viewNoServer(){
  return `<div class="card stack"><h2>Сервер ещё не подключён</h2>
    <p>Кабинет учителя работает через Supabase: там хранятся ученики, их тесты и домашние задания. Откройте файл <b>config.js</b> и вставьте адрес проекта и ключ <b>anon</b> – пошагово это описано в файле ИНСТРУКЦИЯ.md.</p>
    <p class="muted small">Пока можно смотреть материалы курса и ключи: вкладка «Курс».</p>
    <div><button class="btn" data-view="course">Открыть материалы курса</button></div></div>`;
}
function viewLogin(){
  return `<form class="card login stack" id="t-login">
    <h2>Вход для учителя</h2>
    <label for="t-email">Почта</label><input type="email" id="t-email" autocomplete="username" required>
    <label for="t-pass">Пароль</label><input type="password" id="t-pass" autocomplete="current-password" required>
    <button class="btn" type="submit">Войти</button>
    <p class="small" id="t-err" hidden style="color:var(--bad)"></p>
    <p class="small muted">Учётную запись учителя создаёт владелец в Supabase: Authentication → Users → Add user.</p>
  </form>`;
}

function viewStudents(){
  const courses = Object.entries(COURSES);
  return `<div class="section-title" style="margin-top:4px"><h1 style="font-size:1.4rem">Ученики</h1>
    <button class="btn ghost sm" data-act="reload">Обновить</button></div>
  ${T.loading ? `<p class="muted">Загружаю…</p>` : ""}
  <div class="grid2">${T.students.map(s => { const x = sData(s), avg = U.avgAll(x.c, x.results);
    return `<button class="card" data-student="${s.id}" style="text-align:left;color:inherit">
      <div class="row between"><h2>${esc(s.name)}</h2>${x.waiting?`<span class="chip mid">ДЗ на проверку: ${x.waiting}</span>`:""}</div>
      <p class="small muted" style="margin-top:4px">${esc(x.c.course)} · код ${esc(s.code)}</p>
      <div class="row" style="margin-top:10px;gap:20px">
        <div><div class="big tnum" style="color:${avg!=null?lvlColor(avg):"inherit"}">${avg ?? "–"}${avg!=null?"%":""}</div><div class="small muted">средний тест</div></div>
        <div><div class="big tnum">${Object.keys(x.results).length}/${x.c.lessons.length}</div><div class="small muted">тестов</div></div>
      </div>
      <p class="small muted" style="margin-top:8px">${x.last ? "Последний тест: " + new Date(x.last).toLocaleString("ru-RU",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}) : "Тестов пока нет"}</p>
    </button>`; }).join("") || (T.loading ? "" : `<div class="card"><p class="muted">Учеников пока нет. Добавьте первого.</p></div>`)}</div>

  <div class="section-title"><h2>Добавить ученика</h2></div>
  <form class="card stack" id="add-student" style="gap:8px">
    <label for="ns-name">Имя и фамилия</label><input type="text" id="ns-name" required placeholder="Например, Артём Иванов">
    <label for="ns-course">Курс</label>
    <select id="ns-course">${courses.map(([k,c]) => `<option value="${k}">${esc(c.course)}</option>`).join("")}</select>
    <label for="ns-note">Заметка (класс, контакт родителя)</label><input type="text" id="ns-note">
    <div><button class="btn" type="submit">Добавить и получить код</button></div>
  </form>

  <div class="section-title"><h2>Ждут проверки</h2></div>
  <div class="card">${(() => { const w = T.hw.filter(h => h.status === "sent"); if (!w.length) return '<p class="muted">Все домашние задания проверены.</p>';
    return `<ul style="margin:0;padding-left:20px">${w.map(h => { const s = T.students.find(x => x.id === h.student_id); const l = s && course(s.course).lessons.find(x => x.id === h.lesson_id);
      return s && l ? `<li><a href="#" data-student="${s.id}" data-review="${l.id}">${esc(s.name)} – ${esc(l.title)}</a> <span class="small muted">${new Date(h.sent_at).toLocaleDateString("ru-RU")}</span></li>` : ""; }).join("")}</ul>`; })()}</div>`;
}

function viewStudent(){
  const s = T.students.find(x => x.id === T.sel); if (!s) return viewStudents();
  const x = sData(s), c = x.c, blocks = U.blockStats(c, x.results), weak = U.weakTags(c, x.results);
  return `<div class="topbar"><button class="btn ghost sm" data-view="students">← Все ученики</button><button class="btn ghost sm" data-act="reload">Обновить</button></div>
  <section class="banner" style="min-height:0">
    <span class="tag">${esc(c.course)}</span>
    <h1 style="max-width:100%">${esc(s.name)}</h1>
    <p style="max-width:100%">${s.note ? esc(s.note) + " · " : ""}код входа: <b>${esc(s.code)}</b></p>
  </section>
  <div class="card stack" style="margin-top:14px;gap:8px">
    <label for="slink">Ссылка для ученика</label>
    <div class="row" style="flex-wrap:nowrap"><input type="text" id="slink" readonly value="${esc(studentLink(s))}"><button class="btn sm" data-act="copy">Копировать</button></div>
  </div>
  <div class="grid2" style="margin-top:14px">
    <div class="card"><div class="kicker">Средний тест</div><div class="big tnum" style="color:${lvlColor(U.avgAll(c,x.results))}">${U.avgAll(c,x.results) ?? "–"}${U.avgAll(c,x.results)!=null?"%":""}</div></div>
    <div class="card"><div class="kicker">ДЗ на проверку</div><div class="big tnum">${x.waiting}</div></div>
  </div>
  <div class="section-title"><h2>Карта успеха</h2></div>
  <div class="card"><div class="bars">${blocks.map(b => `<div class="bar">
      <span><i class="dot" style="background:${b.b.color}"></i> <b>${esc(b.b.name)}</b> <span class="small muted">${esc(b.b.tasks)} · ${b.done}/${b.n}</span></span>
      <span class="tnum" style="text-align:right;font-weight:800">${b.avg!=null?b.avg+"%":"–"}</span>
      <span class="track"><i style="width:${b.avg||0}%;background:${lvlColor(b.avg)}"></i></span></div>`).join("")}</div></div>
  <div class="section-title"><h2>Что повторить</h2></div>
  <div class="card">${weak.length ? `<ul style="margin:0;padding-left:20px">${weak.map(([t,n]) => `<li><b>${esc(t)}</b> <span class="small muted">– ошибок: ${n}</span></li>`).join("")}</ul>` : '<p class="muted">Ошибок в последних тестах нет.</p>'}</div>
  <div class="section-title"><h2>Занятия</h2></div>
  <div class="tablewrap"><table style="min-width:720px"><thead><tr><th>№</th><th>Дата</th><th>Тема</th><th>Тест</th><th>Рекомендация</th><th>ДЗ</th></tr></thead><tbody>
  ${c.lessons.map((l,i) => { const r = x.results[l.id], h = x.hw[l.id], hs = U.hwState(c, l.id, x.hw);
    return `<tr><td class="tnum">${i+1}</td><td class="tnum">${fmtShort(l.date)}</td><td><i class="dot" style="background:${c.blocks[l.block].color}"></i> ${esc(l.title)}</td>
      <td class="tnum">${r ? `<span class="chip ${lvl(pct(r.last))}">${pct(r.last)}%</span><div class="small muted">лучший ${pct(r.best)}% · ${r.attempts} поп.</div>` : "–"}</td>
      <td class="small">${r ? esc(U.recText(r.last)) : ""}</td>
      <td><span class="chip ${hs.c}">${hs.t}</span>${h?.note?`<div class="small" style="margin-top:4px">${/^https?:/.test(h.note)?`<a href="${esc(h.note)}" target="_blank" rel="noopener">ссылка ученика</a>`:esc(h.note)}</div>`:""}
        <div style="margin-top:6px"><button class="btn ghost sm" data-review="${l.id}">Проверить</button></div>
        ${T.review === l.id ? `<div class="stack" style="gap:6px;margin-top:8px;min-width:220px">
          <input type="text" id="rv-grade" placeholder="Оценка" value="${esc(h?.grade||"")}">
          <textarea id="rv-comment" placeholder="Комментарий ученику">${esc(h?.comment||"")}</textarea>
          <div class="row"><button class="btn sm" data-act="review" data-st="accepted">Принять</button><button class="btn ghost sm" data-act="review" data-st="redo">На доработку</button></div></div>` : ""}</td></tr>`; }).join("")}
  </tbody></table></div>
  <div class="section-title"><h2>Управление</h2></div>
  <div class="card row">
    <button class="btn ghost sm" data-act="new-code">Выдать новый код</button>
    <button class="btn ${T.confirmDel===s.id?"danger":"ghost"} sm" data-act="del-student">${T.confirmDel===s.id?"Нажмите ещё раз, чтобы удалить навсегда":"Удалить ученика"}</button>
  </div>`;
}

function viewCourse(){
  const cid = T.courseId || Object.keys(COURSES)[0], c = course(cid);
  return `<div class="section-title" style="margin-top:4px"><h1 style="font-size:1.4rem">Материалы курса</h1>
    <select id="course-pick" style="width:auto">${Object.entries(COURSES).map(([k,x]) => `<option value="${k}" ${k===cid?"selected":""}>${esc(x.course)}</option>`).join("")}</select></div>
  <p class="muted small">Теория, практика с ключами, тест с ответами и ссылка на рабочий лист для каждого занятия.</p>
  <div class="tablewrap" style="margin-top:12px"><table style="min-width:560px"><thead><tr><th>№</th><th>Дата</th><th>Задание</th><th>Тема</th><th>Лист</th></tr></thead><tbody>
  ${c.lessons.map((l,i) => `<tr><td class="tnum">${i+1}</td><td class="tnum">${fmtShort(l.date)}</td><td>${esc(l.oge)}</td><td><a href="#" data-lesson="${l.id}"><i class="dot" style="background:${c.blocks[l.block].color}"></i> ${esc(l.title)}</a></td><td>${sheetFor(cid, l.id).url ? "✓" : "–"}</td></tr>`).join("")}
  </tbody></table></div>`;
}

function viewLesson(){
  const cid = T.courseId || Object.keys(COURSES)[0], c = course(cid), l = c.lessons.find(x => x.id === T.open), i = c.lessons.indexOf(l), b = c.blocks[l.block];
  const keys = (window.COURSE_KEYS?.[cid] || {})[l.id] || [];
  const lk = {...l, practice: l.practice.map((p,k) => ({...p, key: keys[k]}))};
  const sh = sheetFor(cid, l.id);
  const tabs = [["theory","Теория"],["practice","Практика и ключи"],["test","Тест с ответами"],["sheet","Рабочий лист и ДЗ"]];
  let body = "";
  if (T.sub === "theory") body = U.theoryHTML(l);
  if (T.sub === "practice") body = U.practiceHTML(lk, true);
  if (T.sub === "test") body = `<ol style="padding-left:20px">${l.test.map(q => `<li style="margin-bottom:12px"><b>${esc(q.q)}</b><ul>${q.o.map((o,k) => `<li ${k===q.a?'style="color:var(--good);font-weight:800"':""}>${esc(o)}${k===q.a?" ✓":""}</li>`).join("")}</ul><p class="small muted">Правило: ${esc(q.tag)}. ${esc(q.e)}</p></li>`).join("")}</ol>`;
  if (T.sub === "sheet") body = `<p><b>Домашнее задание:</b> ${esc(l.hw)}</p>
    <div class="stack" style="gap:8px;margin-top:14px">
      ${sb && T.session ? `<label for="sh-name">Название рабочего листа</label><input type="text" id="sh-name" value="${esc(sh.name||"")}" placeholder="Например, Причастный оборот – рабочий лист">
      <label for="sh-url">Ссылка (Учу по ФРП, Google Диск, GitHub)</label><input type="url" id="sh-url" value="${esc(sh.url||"")}">
      <label for="sh-note">Заметка для ученика</label><input type="text" id="sh-note" value="${esc(sh.note||"")}">
      <div><button class="btn sm" data-act="save-sheet">Сохранить – ученики курса увидят ссылку</button></div>` : `<p class="muted small">Чтобы прикреплять рабочие листы, подключите Supabase и войдите.</p>`}
    </div>`;
  return `<div class="topbar"><button class="btn ghost sm" data-view="course">← Все занятия</button>
    <div class="row">${i>0?`<button class="btn ghost sm" data-lesson="${c.lessons[i-1].id}">‹ № ${i}</button>`:""}${i<c.lessons.length-1?`<button class="btn ghost sm" data-lesson="${c.lessons[i+1].id}">№ ${i+2} ›</button>`:""}</div></div>
  <div class="open-head" style="--c:${b.color}"><span class="tag">№ ${String(i+1).padStart(2,"0")} · ${esc(l.oge)}</span><h1>${esc(l.title)}</h1><p>${fmt(l.date,{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</p></div>
  <div class="card" style="margin-top:14px"><div class="kicker">План занятия</div><ul style="margin:6px 0 0;padding-left:20px">${l.learn.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>
  <div class="tabs-inner">${tabs.map(([k,n]) => `<button data-sub="${k}" aria-pressed="${T.sub===k}">${n}</button>`).join("")}</div>
  <div class="sheet" style="margin-top:20px">${body}</div>`;
}

function render(){
  const nav = $("#t-nav");
  const logged = !!(sb && T.session);
  nav.innerHTML = `<button class="btn ${["students","student"].includes(T.view)?"":"ghost"} sm" data-view="students">Ученики</button>
    <button class="btn ${["course","lesson"].includes(T.view)?"":"ghost"} sm" data-view="course">Курс</button>
    ${logged ? `<button class="btn ghost sm" data-act="logout">Выйти</button>` : ""}`;
  let html;
  if (["course","lesson"].includes(T.view)) html = T.view === "course" ? viewCourse() : viewLesson();
  else if (!sb) html = viewNoServer();
  else if (!T.session) html = viewLogin();
  else html = T.view === "student" ? viewStudent() : viewStudents();
  $("#app").innerHTML = html;
}

/* ---------- события ---------- */
document.addEventListener("submit", async e => {
  e.preventDefault();
  if (e.target.id === "t-login"){
    const {data, error} = await sb.auth.signInWithPassword({email: $("#t-email").value.trim(), password: $("#t-pass").value});
    if (error){ const el = $("#t-err"); el.textContent = "Не получилось войти: проверьте почту и пароль."; el.hidden = false; return; }
    T.session = data.session; await loadAll();
  }
  if (e.target.id === "add-student"){
    const name = $("#ns-name").value.trim(); if (!name) return;
    const {data, error} = await sb.from("students").insert({name, course: $("#ns-course").value, note: $("#ns-note").value.trim(), code: U.genCode()}).select().single();
    if (error){ toast("Не удалось добавить: " + error.message); return; }
    T.students.push(data); T.sel = data.id; T.view = "student"; render(); toast("Ученик добавлен. Отправьте ему ссылку.");
  }
});
document.addEventListener("change", e => { if (e.target.id === "course-pick"){ T.courseId = e.target.value; render(); } });
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-view],[data-student],[data-lesson],[data-sub],[data-review],[data-act]"); if (!t) return;
  if (t.tagName === "A") e.preventDefault();
  if (t.dataset.view){ T.view = t.dataset.view; T.confirmDel = null; render(); scrollTo(0,0); return; }
  if (t.dataset.student){ T.sel = t.dataset.student; T.view = "student"; T.review = t.dataset.review || null; render(); scrollTo(0,0); return; }
  if (t.dataset.lesson){ T.open = t.dataset.lesson; T.view = "lesson"; T.sub = "theory"; render(); scrollTo(0,0); return; }
  if (t.dataset.sub){ T.sub = t.dataset.sub; render(); return; }
  if (t.dataset.review && !t.dataset.act){ T.review = T.review === t.dataset.review ? null : t.dataset.review; render(); return; }
  const a = t.dataset.act;
  if (a === "reload") loadAll();
  if (a === "logout"){ await sb.auth.signOut(); T.session = null; render(); }
  if (a === "copy"){ const inp = $("#slink"); try{ await navigator.clipboard.writeText(inp.value); toast("Ссылка скопирована"); }catch(_){ inp.select(); toast("Выделено – скопируйте вручную"); } }
  if (a === "review"){
    const row = {student_id: T.sel, lesson_id: T.review, status: t.dataset.st, grade: $("#rv-grade").value.trim(), comment: $("#rv-comment").value.trim(), reviewed_at: new Date().toISOString()};
    const {error} = await sb.from("homework").upsert(row, {onConflict: "student_id,lesson_id"});
    if (error){ toast("Не сохранилось: " + error.message); return; }
    const i = T.hw.findIndex(h => h.student_id === row.student_id && h.lesson_id === row.lesson_id);
    if (i >= 0) T.hw[i] = {...T.hw[i], ...row}; else T.hw.push(row);
    T.review = null; render(); toast(row.status === "accepted" ? "ДЗ принято" : "Отправлено на доработку");
  }
  if (a === "save-sheet"){
    const cid = T.courseId || Object.keys(COURSES)[0];
    const row = {teacher_id: T.session.user.id, course: cid, lesson_id: T.open, name: $("#sh-name").value.trim(), url: $("#sh-url").value.trim(), note: $("#sh-note").value.trim()};
    const {error} = await sb.from("sheets").upsert(row, {onConflict: "teacher_id,course,lesson_id"});
    if (error){ toast("Не сохранилось: " + error.message); return; }
    T.sheets = T.sheets.filter(x => !(x.course === cid && x.lesson_id === T.open)).concat(row); render(); toast("Рабочий лист прикреплён");
  }
  if (a === "new-code"){
    const code = U.genCode();
    const {error} = await sb.from("students").update({code}).eq("id", T.sel);
    if (error){ toast("Не получилось: " + error.message); return; }
    T.students.find(x => x.id === T.sel).code = code; render(); toast("Новый код выдан, старый больше не работает");
  }
  if (a === "del-student"){
    if (T.confirmDel !== T.sel){ T.confirmDel = T.sel; render(); return; }
    const {error} = await sb.from("students").delete().eq("id", T.sel);
    if (error){ toast("Не удалось удалить: " + error.message); return; }
    T.students = T.students.filter(x => x.id !== T.sel); T.confirmDel = null; T.view = "students"; render(); toast("Ученик удалён");
  }
});

/* ---------- запуск ---------- */
(async () => {
  render();
  if (!sb) return;
  const {data} = await sb.auth.getSession();
  T.session = data.session;
  sb.auth.onAuthStateChange((_e, s) => { T.session = s; });
  if (T.session) await loadAll(); else render();
})();
})();
