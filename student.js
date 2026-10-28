/* Приложение ученика */
(() => {
const {esc, d, today, fmt, fmtShort, daysTo, pct, lvl, lvlColor, toast} = U;
const FIPI = "https://oge.fipi.ru/bank/index.php?proj=2F5EE3B12FE2A0EA40B06BF61A015416";
const RESHU = "https://rus-oge.sdamgia.ru";
const CFG = window.APP_CONFIG || {};
const sb = U.supa();
const S = {view:"home", open:null, sub:"theory", test:null, student:null, course:null, rows:[], results:{}, hw:{}, sheets:{}};
const $ = s => document.querySelector(s);
const LS = {get(k, def){ try{ return JSON.parse(localStorage.getItem("oge-" + k)) ?? def; }catch(e){ return def; } },
            set(k, v){ try{ localStorage.setItem("oge-" + k, JSON.stringify(v)); }catch(e){} }};

/* ---------- данные ---------- */
async function login(code){
  code = code.trim().toUpperCase();
  if (sb){
    const {data, error} = await sb.rpc("student_login", {p_code: code});
    if (error || !data) return false;
    S.student = {...data, code};
  } else {
    S.student = {id:"local", name: code, course: CFG.DEFAULT_COURSE || "oge-rus", code};
  }
  LS.set("student", S.student);
  S.course = COURSES[S.student.course] || COURSES[CFG.DEFAULT_COURSE || "oge-rus"];
  await load();
  return true;
}
async function load(){
  if (sb){
    const {data, error} = await sb.rpc("student_state", {p_code: S.student.code});
    if (error){ toast("Нет связи с сервером. Показываю сохранённое."); return; }
    const st = data || {};
    S.rows = st.results || [];
    S.hw = Object.fromEntries((st.homework || []).map(h => [h.lesson_id, h]));
    S.sheets = Object.fromEntries((st.sheets || []).map(h => [h.lesson_id, h]));
    LS.set("cache", {rows:S.rows, hw:S.hw, sheets:S.sheets});
  } else {
    S.rows = LS.get("rows", []); S.hw = LS.get("hw", {}); S.sheets = {};
  }
  S.results = U.aggregate(S.rows);
}
async function sendResult(lesson_id, score, total, wrong){
  const row = {lesson_id, score, total, wrong, created_at: new Date().toISOString()};
  S.rows.push(row); S.results = U.aggregate(S.rows);
  if (sb){
    const {error} = await sb.rpc("student_submit_result", {p_code:S.student.code, p_lesson:lesson_id, p_score:score, p_total:total, p_wrong:wrong});
    if (error) toast("Результат не отправлен: нет связи. Пройди тест ещё раз, когда появится интернет.");
  } else LS.set("rows", S.rows);
}
async function sendHw(lesson_id, note){
  const prev = S.hw[lesson_id] || {};
  S.hw[lesson_id] = {...prev, lesson_id, note, status: prev.status === "accepted" ? "accepted" : "sent", sent_at: new Date().toISOString()};
  if (sb){
    const {error} = await sb.rpc("student_submit_homework", {p_code:S.student.code, p_lesson:lesson_id, p_note:note});
    if (error){ toast("Не отправилось. Проверь интернет."); return; }
  } else LS.set("hw", S.hw);
  toast("ДЗ отмечено. Учитель увидит отметку.");
}

/* ---------- расписание ---------- */
const L = () => S.course.lessons, B = () => S.course.blocks;
const idx = id => L().findIndex(l => l.id === id);
const nextLesson = () => L().find(l => d(l.date) >= today()) || null;
const lastPast = () => [...L()].reverse().find(l => d(l.date) < today()) || null;
const hwState = id => U.hwState(S.course, id, S.hw);

/* ---------- экраны ---------- */
const ICONS = {
  home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>',
  folders:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 6h6l2 2h10v11H3z"/></svg>',
  map:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
  plan:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>'
};
function renderTabs(){
  const bar = $("#tabbar"); bar.hidden = !S.student;
  if (!S.student) return;
  const t = [["home","Главная"],["folders","Папки"],["map","Карта успеха"],["plan","План"]];
  $("#tabs").innerHTML = t.map(([k,n]) => `<button data-tab="${k}" ${S.view===k||(k==="folders"&&["folder","test"].includes(S.view))?'aria-current="page"':""}>${ICONS[k]}<span>${n}</span></button>`).join("");
}

function folderHTML(l){
  const b = B()[l.block], r = S.results[l.id], p = pct(r?.best), nx = nextLesson(), hs = hwState(l.id);
  const cls = l === nx ? "next" : d(l.date) < today() ? "past" : "";
  return `<button class="folder ${cls}" style="--c:${b.color}" data-open="${l.id}">
    <span class="back"></span><span class="tab">№ ${String(idx(l.id)+1).padStart(2,"0")}</span>
    <span class="front"><span class="clip"></span>
      <span class="date">${fmt(l.date,{weekday:"short",day:"numeric",month:"short"})} · ${esc(l.oge)}</span>
      <span class="ttl">${esc(l.title)}</span>
      <span class="meta">${p!=null?`<span class="pill">тест ${p}%</span>`:""}${l===nx?'<span class="pill">следующее</span>':""}${hs.c==="good"?'<span class="pill">ДЗ ✓</span>':hs.c==="bad"?'<span class="pill">ДЗ!</span>':""}</span>
    </span></button>`;
}

function viewLogin(){
  return `<section class="banner">
    <span class="tag">${esc(CFG.SCHOOL_TAG || "Учу по ФРП · репетиторство")}</span>
    <h1>${esc(CFG.TITLE || "Подготовка к ОГЭ. Русский язык")}</h1>
    <p>Папки занятий, домашки, тесты и карта успеха.</p>
    <img class="cat" src="assets/kotik.webp" alt="Котик-отличник в очках и академической шапочке">
  </section>
  <form class="card login stack" id="login-form">
    <h2>Вход для ученика</h2>
    <p class="muted small">${sb ? "Введи код, который дал учитель." : "Демо-режим: сервер ещё не подключён, результаты сохранятся только на этом телефоне. Введи своё имя."}</p>
    <label for="code">${sb ? "Код ученика" : "Имя"}</label>
    <input type="text" id="code" autocomplete="off" ${sb ? 'autocapitalize="characters" placeholder="Например, K7M3QPA"' : 'placeholder="Например, Артём"'} required>
    <button class="btn" type="submit">Войти</button>
    <p class="small" id="login-err" hidden style="color:var(--bad)">Код не найден. Проверь буквы или спроси у учителя.</p>
  </form>`;
}

function viewHome(){
  const nx = nextLesson(), due = nx ? L()[idx(nx.id)-1] : null, lp = lastPast();
  const isToday = nx && daysTo(nx.date) === 0;
  const testTodo = lp && !S.results[lp.id] ? lp : (isToday && !S.results[nx.id] ? nx : null);
  const avg = U.avgAll(S.course, S.results), done = L().filter(l => S.results[l.id]).length;
  const exam = (S.course.events || []).find(e => e.kind === "exam" && daysTo(e.date) >= 0);
  return `<section class="banner">
    <span class="tag">${esc(S.course.tag || "ОГЭ 2027")}</span>
    <h1>${esc(S.course.course)}</h1>
    <p>Привет, ${esc(S.student.name)}! Занятия по четвергам.</p>
    <img class="cat" src="assets/kotik.webp" alt="Котик-отличник">
  </section>
  <div class="section-title"><h2>Сейчас</h2>${CFG.BOT_USERNAME?`<a class="btn yellow sm" href="https://t.me/${esc(CFG.BOT_USERNAME.replace(/^@/,""))}" target="_blank" rel="noopener">Бот в Telegram</a>`:""}</div>
  <div class="grid2">
    ${nx ? `<div class="card accent">
      <div class="kicker">${isToday ? "Занятие сегодня" : "Следующее занятие"}</div>
      <h2 style="margin-top:6px">${fmt(nx.date,{weekday:"long",day:"numeric",month:"long"})}</h2>
      <p style="margin:6px 0 10px"><span class="dot" style="background:${B()[nx.block].color}"></span> ${esc(nx.oge)} · <b>${esc(nx.title)}</b></p>
      <div class="row"><button class="btn" data-open="${nx.id}">Открыть папку</button>${!isToday?`<span class="chip tnum">через ${daysTo(nx.date)} дн.</span>`:""}</div>
    </div>` : `<div class="card"><h2>Курс завершён</h2><p class="muted">Удачи на экзамене!</p></div>`}
    ${due ? (() => { const hs = hwState(due.id); return `<div class="card">
      <div class="kicker">Сдать ${isToday ? "сегодня" : "на занятии " + fmtShort(nx.date)}</div>
      <h3 style="margin-top:6px">ДЗ: ${esc(due.title)}</h3>
      <p class="small" style="margin:6px 0 10px">${esc(due.hw)}</p>
      <div class="row">${!S.hw[due.id]?.status || S.hw[due.id]?.status==="redo" ? `<button class="btn yellow" data-open="${due.id}" data-sub="hw">Отметить «Сделал»</button>` : ""}<span class="chip ${hs.c}">${hs.t}</span></div>
    </div>`; })() : ""}
    ${testTodo ? `<div class="card">
      <div class="kicker">Тест после занятия</div>
      <h3 style="margin-top:6px">${esc(testTodo.title)}</h3>
      <p class="small muted" style="margin:6px 0 10px">${testTodo.test.length} вопросов, результат увидит учитель.</p>
      <button class="btn" data-test="${testTodo.id}">Пройти тест</button>
    </div>` : ""}
    <div class="card">
      <div class="kicker">Итоги</div>
      <div class="row" style="margin-top:8px;gap:22px">
        <div><div class="big tnum">${avg ?? "–"}${avg!=null?"%":""}</div><div class="small muted">средний тест</div></div>
        <div><div class="big tnum">${done}/${L().length}</div><div class="small muted">тестов</div></div>
        ${exam ? `<div><div class="big tnum">${daysTo(exam.date)}</div><div class="small muted">дн. до: ${esc(exam.short || exam.title)}</div></div>` : ""}
      </div>
    </div>
  </div>
  <div class="section-title"><h2>Ближайшие папки</h2><button class="btn ghost sm" data-tab="folders">Все папки</button></div>
  <div class="folders">${(() => { const i = Math.max(0, idx((nx || L().at(-1)).id) - 1); return L().slice(i, i + 4).map(folderHTML).join(""); })()}</div>
  <div class="section-title"><h2>Установить на телефон</h2></div>
  <div class="card small"><ol style="margin:0;padding-left:20px">
    <li>iPhone: открой этот сайт в Safari → «Поделиться» → «На экран Домой» → «Добавить».</li>
    <li>Android: меню Chrome (⋮) → «Добавить на главный экран».</li>
    <li>На экране появится иконка с котиком – открывай как приложение.</li></ol></div>
  <div class="row" style="margin-top:18px"><button class="btn ghost sm" data-act="logout">Выйти</button>${!sb?'<span class="small muted">Демо-режим: результаты хранятся на этом устройстве.</span>':""}</div>`;
}

function viewFolders(){
  let out = "", month = "";
  const items = [...L().map(l => ({date:l.date, l})), ...(S.course.events || []).map(e => ({date:e.date, e}))].sort((a,b) => a.date < b.date ? -1 : 1);
  for (const it of items){
    const m = fmt(it.date, {month:"long", year:"numeric"});
    if (m !== month){ month = m; out += `<div class="month">${m[0].toUpperCase() + m.slice(1)}</div>`; }
    out += it.l ? folderHTML(it.l) : `<div class="event ${it.e.kind}">${fmt(it.e.date)} – ${esc(it.e.title)}</div>`;
  }
  return `<div class="section-title" style="margin-top:4px"><h1 style="font-size:1.4rem">Папки занятий</h1><span class="chip">${L().length} занятий</span></div>
    <div class="legend" style="margin-bottom:6px">${Object.values(B()).map(b => `<span><i class="dot" style="background:${b.color}"></i>${esc(b.name)}</span>`).join("")}</div>
    <div class="folders">${out}</div>`;
}

function viewFolder(){
  const l = L().find(x => x.id === S.open), b = B()[l.block], i = idx(l.id);
  const r = S.results[l.id], sh = S.sheets[l.id] || {}, h = S.hw[l.id] || {}, hs = hwState(l.id), due = L()[i+1];
  const tabs = [["theory","Теория"],["practice","Практика"],["hw","Домашка"],["test","Тест"]];
  let body = "";
  if (S.sub === "theory") body = `<div class="sheet"><span class="tag label">Теория</span>${U.theoryHTML(l)}</div>`;
  if (S.sub === "practice") body = `<div class="sheet"><span class="tag label">Практика на занятии</span>
      ${sh.url ? `<p style="margin-bottom:10px"><a class="btn yellow sm" href="${esc(sh.url)}" target="_blank" rel="noopener">${esc(sh.name || "Рабочий лист")}</a></p>` : ""}
      ${sh.note ? `<p class="small" style="margin-bottom:8px">${esc(sh.note)}</p>` : ""}
      ${U.practiceHTML(l, false)}
      <p class="small muted" style="margin-top:14px">Тренировка: <a href="${FIPI}" target="_blank" rel="noopener">открытый банк ФИПИ</a> · <a href="${RESHU}" target="_blank" rel="noopener">«Решу ОГЭ»</a></p></div>`;
  if (S.sub === "hw") body = `<div class="sheet"><span class="tag label">Домашнее задание</span>
      <p>${esc(l.hw)}</p>
      <div class="row" style="margin-top:10px"><span class="chip ${hs.c}">${hs.t}</span>${due?`<span class="chip">срок: ${fmt(due.date,{weekday:"short",day:"numeric",month:"long"})}</span>`:""}</div>
      ${h.comment ? `<p class="expl small"><b>Комментарий учителя:</b> ${esc(h.comment)}</p>` : ""}
      ${h.status !== "accepted" ? `<div class="stack" style="margin-top:12px;gap:8px">
        <label for="hw-note">Комментарий или ссылка на фото работы</label>
        <textarea id="hw-note" placeholder="Например, ссылка на фото в Google Диске">${esc(h.note || "")}</textarea>
        <div><button class="btn yellow" data-act="send-hw">${h.status ? "Обновить отметку" : "Я сделал ДЗ"}</button></div></div>` : ""}</div>`;
  if (S.sub === "test") body = `<div class="sheet"><span class="tag label">Тест</span>
      ${r ? `<div class="row"><span class="big tnum" style="color:${lvlColor(pct(r.last))}">${pct(r.last)}%</span>
        <span class="small muted">последняя попытка · лучший ${pct(r.best)}% · попыток: ${r.attempts}</span></div>
        <p class="expl small"><b>Рекомендация:</b> ${esc(U.recText(r.last))}</p>` : `<p class="muted">${l.test.length} вопросов по теме. Пройди тест после занятия.</p>`}
      <div class="row" style="margin-top:12px"><button class="btn" data-test="${l.id}">${r ? "Пройти ещё раз" : "Начать тест"}</button></div></div>`;
  return `<div class="row" style="margin-bottom:12px"><button class="btn ghost sm" data-tab="folders">← Все папки</button>
    ${i>0?`<button class="btn ghost sm" data-open="${L()[i-1].id}">‹ № ${i}</button>`:""}${i<L().length-1?`<button class="btn ghost sm" data-open="${L()[i+1].id}">№ ${i+2} ›</button>`:""}</div>
  <div class="open-head" style="--c:${b.color}">
    <span class="tag">№ ${String(i+1).padStart(2,"0")} · ${esc(l.oge)}</span>
    <h1>${esc(l.title)}</h1>
    <p>${fmt(l.date,{weekday:"long",day:"numeric",month:"long",year:"numeric"})} · ${esc(b.name)}</p>
  </div>
  <div class="card" style="margin-top:14px"><div class="kicker">На занятии</div><ul style="margin:6px 0 0;padding-left:20px">${l.learn.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>
  <div class="tabs-inner" role="group" aria-label="Разделы папки">${tabs.map(([k,n]) => `<button data-sub="${k}" aria-pressed="${S.sub===k}">${n}</button>`).join("")}</div>
  <div style="margin-top:20px">${body}</div>`;
}

function startTest(id){
  const l = L().find(x => x.id === id);
  S.test = {id, i:0, picked:null, score:0, wrong:[], order:l.test.map(q => U.shuffle(q.o.map((_,k) => k)))};
  S.view = "test"; render(); scrollTo(0,0);
}
function viewTest(){
  const T = S.test, l = L().find(x => x.id === T.id), b = B()[l.block];
  if (T.i >= l.test.length){
    const p = Math.round(T.score / l.test.length * 100);
    return `<div class="open-head" style="--c:${b.color}"><span class="tag">Тест завершён</span><h1>${esc(l.title)}</h1></div>
      <div class="card" style="margin-top:16px;text-align:center">
        <img src="assets/kotik.webp" alt="" style="width:150px">
        <div class="big tnum" style="font-size:2.6rem;color:${lvlColor(p)}">${T.score} из ${l.test.length}</div>
        <p style="margin:4px 0 14px;font-weight:800">${p===100?"Котик ставит сто баллов!":p>=80?"Отличный результат!":p>=60?"Неплохо, есть что повторить.":"Тему повторим на занятии."}</p>
        <p class="expl small" style="text-align:left"><b>Рекомендация:</b> ${esc(U.recText({score:T.score,total:l.test.length,wrong:T.wrong}))}</p>
        <div class="row" style="justify-content:center;margin-top:14px"><button class="btn" data-open="${l.id}">В папку</button><button class="btn ghost" data-tab="map">Карта успеха</button></div>
      </div>`;
  }
  const q = l.test[T.i], ord = T.order[T.i];
  return `<div class="row between" style="margin-bottom:10px"><button class="btn ghost sm" data-open="${l.id}" data-sub="test">✕ Выйти</button><span class="chip tnum">Вопрос ${T.i+1} из ${l.test.length}</span></div>
  <div class="progress"><i style="width:${T.i/l.test.length*100}%"></i></div>
  <div class="card" style="margin-top:14px">
    <div class="kicker" style="color:${b.color}">${esc(l.title)}</div>
    <p class="q">${esc(q.q)}</p>
    <div class="opts">${ord.map(k => { let c = ""; if (T.picked != null){ if (k === q.a) c = "ok"; else if (k === T.picked) c = "no"; }
      return `<button class="opt ${c}" data-pick="${k}" ${T.picked!=null?"disabled":""}>${esc(q.o[k])}</button>`; }).join("")}</div>
    ${T.picked != null ? `<div class="expl"><b>${T.picked===q.a?"Верно.":"Неверно."}</b> ${esc(q.e)}</div>
      <div style="margin-top:14px"><button class="btn" data-act="next-q">${T.i===l.test.length-1?"Завершить":"Дальше"}</button></div>` : ""}
  </div>`;
}

function viewMap(){
  const blocks = U.blockStats(S.course, S.results), weak = U.weakTags(S.course, S.results);
  const hwAll = L().filter(l => { const n = L()[idx(l.id)+1]; return n && d(n.date) <= today(); });
  const hwOk = hwAll.filter(l => ["sent","accepted"].includes(S.hw[l.id]?.status)).length;
  return `<div class="section-title" style="margin-top:4px"><h1 style="font-size:1.4rem">Карта успеха</h1></div>
  <div class="grid2">
    <div class="card"><div class="kicker">Домашние задания</div><div class="big tnum" style="margin-top:6px">${hwOk}/${hwAll.length}</div><div class="small muted">отмечено к сроку</div></div>
    <div class="card"><div class="kicker">Тесты</div><div class="big tnum" style="margin-top:6px">${L().filter(l => S.results[l.id]).length}/${L().length}</div><div class="small muted">пройдено</div></div>
  </div>
  <div class="section-title"><h2>По блокам ОГЭ</h2></div>
  <div class="card"><div class="bars">${blocks.map(x => `<div class="bar">
      <span><i class="dot" style="background:${x.b.color}"></i> <b>${esc(x.b.name)}</b> <span class="small muted">${esc(x.b.tasks)} · ${x.done}/${x.n}</span></span>
      <span class="tnum" style="text-align:right;font-weight:800;color:${x.avg!=null?lvlColor(x.avg):"var(--muted)"}">${x.avg!=null?x.avg+"%":"–"}</span>
      <span class="track"><i style="width:${x.avg||0}%;background:${lvlColor(x.avg)}"></i></span></div>`).join("")}</div></div>
  <div class="section-title"><h2>Все занятия</h2></div>
  <div class="card"><div class="heat">${L().map((l,i) => { const p = pct(S.results[l.id]?.best); return `<button data-open="${l.id}" data-sub="test" title="${esc(l.title)}" style="background:${lvlColor(p)};color:${p!=null?"#fff":"var(--muted)"}">${i+1}</button>`; }).join("")}</div>
    <div class="legend" style="margin-top:12px"><span><i class="dot" style="background:var(--good)"></i>80–100%</span><span><i class="dot" style="background:var(--mid)"></i>60–79%</span><span><i class="dot" style="background:var(--bad)"></i>ниже 60%</span><span><i class="dot" style="background:var(--chip);border:1px solid var(--line)"></i>нет теста</span></div></div>
  <div class="section-title"><h2>Что повторить</h2></div>
  <div class="card">${weak.length ? `<ul style="margin:0;padding-left:20px">${weak.map(([t,n]) => `<li><b>${esc(t)}</b> <span class="muted small">– ошибок: ${n}</span></li>`).join("")}</ul>`
    : `<div class="row" style="flex-wrap:nowrap"><img class="catmini" src="assets/kotik.webp" alt=""><p class="muted">Здесь появятся правила, в которых были ошибки в последних тестах.</p></div>`}</div>`;
}

function viewPlan(){
  const rows = [...L().map(l => ({date:l.date, l})), ...(S.course.events || []).map(e => ({date:e.date, e}))].sort((a,b) => a.date < b.date ? -1 : 1);
  return `<div class="section-title" style="margin-top:4px"><h1 style="font-size:1.4rem">План занятий</h1><span class="chip">по четвергам</span></div>
  <div class="tablewrap"><table style="min-width:640px"><thead><tr><th>№</th><th>Дата</th><th>Тема</th><th>Домашнее задание</th><th>Тест</th></tr></thead><tbody>
  ${rows.map(x => x.e ? `<tr class="ev"><td></td><td class="tnum">${fmtShort(x.date)}</td><td colspan="3">${esc(x.e.title)}</td></tr>` :
   `<tr><td class="tnum">${idx(x.l.id)+1}</td><td class="tnum" style="white-space:nowrap">${fmtShort(x.date)}</td><td><i class="dot" style="background:${B()[x.l.block].color}"></i> <b>${esc(x.l.oge)}</b><br>${esc(x.l.title)}</td><td class="small">${esc(x.l.hw)}</td><td class="tnum">${S.results[x.l.id]?pct(S.results[x.l.id].best)+"%":"–"}</td></tr>`).join("")}
  </tbody></table></div>`;
}

function render(){
  renderTabs();
  if (!S.student){ $("#app").innerHTML = viewLogin(); return; }
  const v = S.view;
  $("#app").innerHTML = v==="home"?viewHome():v==="folders"?viewFolders():v==="folder"?viewFolder():v==="test"?viewTest():v==="map"?viewMap():viewPlan();
}

/* ---------- события ---------- */
document.addEventListener("submit", async e => {
  if (e.target.id !== "login-form") return;
  e.preventDefault();
  const btn = e.target.querySelector("button"); btn.disabled = true;
  const ok = await login($("#code").value);
  btn.disabled = false;
  if (!ok){ $("#login-err").hidden = false; return; }
  render();
});
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-tab],[data-open],[data-test],[data-pick],[data-act],[data-sub]"); if (!t) return;
  if (t.dataset.tab){ S.view = t.dataset.tab; render(); scrollTo(0,0); return; }
  if (t.dataset.open){ S.open = t.dataset.open; S.sub = t.dataset.sub || "theory"; S.view = "folder"; render(); scrollTo(0,0); return; }
  if (t.dataset.sub){ S.sub = t.dataset.sub; render(); return; }
  if (t.dataset.test){ startTest(t.dataset.test); return; }
  if (t.dataset.pick && S.test.picked == null){
    const T = S.test, q = L().find(x => x.id === T.id).test[T.i], k = +t.dataset.pick;
    T.picked = k; if (k === q.a) T.score++; else T.wrong.push(q.tag); render(); return;
  }
  const a = t.dataset.act;
  if (a === "next-q"){
    const T = S.test, l = L().find(x => x.id === T.id);
    T.i++; T.picked = null;
    if (T.i >= l.test.length) await sendResult(l.id, T.score, l.test.length, T.wrong);
    render(); scrollTo(0,0);
  }
  if (a === "send-hw"){ await sendHw(S.open, $("#hw-note").value.trim()); render(); }
  if (a === "logout"){ LS.set("student", null); S.student = null; render(); }
});

/* ---------- запуск ---------- */
(async () => {
  const urlCode = new URLSearchParams(location.search).get("code");
  const saved = LS.get("student", null);
  if (urlCode) await login(urlCode);
  else if (saved){
    S.student = saved; S.course = COURSES[saved.course] || COURSES["oge-rus"];
    const c = LS.get("cache", null);
    if (c && sb){ S.rows = c.rows; S.hw = c.hw; S.sheets = c.sheets; S.results = U.aggregate(S.rows); }
    render(); await load();
  }
  render();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
})();
