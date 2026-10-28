/* Кабинет учителя: ученики 5–11 классов, приглашения, входные тесты, планы и даты, пары,
   проверка работ (с черновой оценкой нейросети), своя база материалов, доска */
(() => {
const {esc, d, today, fmt, fmtShort, pct, lvl, lvlColor, toast} = U;
const CFG = window.APP_CONFIG || {};
const sb = U.supa();
const T = {session:null, me:null, view:"students", grade:"all", sel:null, open:null, sub:"method", review:null, wreview:null,
           students:[], rows:[], hw:[], writings:[], sheets:[], mats:[], act:[], reports:[], ai:{},
           loading:false, confirmDel:null, courseId:null, board:null, boardLesson:null, drawer:false, justInvited:null, gen:null, busy:false};
const $ = s => document.querySelector(s);
const GRADES = [5,6,7,8,9,10,11];
const ST_COLS = "id,teacher_id,name,course,code,note,created_at,grade,goal,goals,contact,invite_token,registered_at,start_date,dates,unlocked,pair_id,theme";
const inviteLink = tok => `${location.origin}${location.pathname.replace(/teacher\.html$/, "")}?invite=${tok}`;
const BLOCK_OWN = {name:"Свои уроки", color:"#8b5cf6"};
const blockOf = (c, l) => c.blocks[l.block] || BLOCK_OWN;
const I = {
  menu:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  users:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/></svg>',
  book:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/></svg>',
  method:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h10M4 18h7"/></svg>',
  out:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 4h4v16h-4M10 17l5-5-5-5M15 12H3"/></svg>',
  pen:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20l4-1 11-11-3-3L5 16z"/></svg>',
  code:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg>',
  lock:'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'
};
const access = cid => !sb || (T.me?.base_access || []).includes(U.packOf(cid));
const curCourse = () => T.courseId || CFG.DEFAULT_COURSE || "oge-rus";
/* курс в разделе «Материалы»: встроенный + свои уроки учителя (общие для всех учеников) */
const teacherCourse = cid => U.courseFor({course: cid}, T.mats);

async function loadAll(){
  if (!sb || !T.session) return;
  T.loading = true; render();
  const me = await sb.rpc("me"); T.me = me.data || {base_access: []};
  if (T.me.theme && !localStorage.getItem("oge-theme-t")) U.applyTheme(T.me.theme);
  const [st, rs, hw, wr, sh, mt, ac, ar] = await Promise.all([
    sb.from("students").select(ST_COLS).order("created_at"),
    sb.from("results").select("*").order("created_at"),
    sb.from("homework").select("*"), sb.from("writings").select("*"), sb.from("sheets").select("*"),
    sb.from("materials").select("*").order("id"), sb.from("activity").select("*"),
    sb.from("ai_reports").select("*").order("created_at", {ascending: false}).limit(200)
  ]);
  const err = [st, rs, hw, wr, sh, mt, ac, ar].find(x => x.error)?.error;
  if (err) toast("Ошибка загрузки: " + err.message + ". Выполните заново supabase/schema.sql.");
  T.students = st.data || []; T.rows = rs.data || []; T.hw = hw.data || []; T.writings = wr.data || []; T.sheets = sh.data || [];
  T.mats = mt.data || []; T.act = ac.data || []; T.reports = ar.data || [];
  T.loading = false; render();
}
function sData(s){
  const rows = T.rows.filter(r => r.student_id === s.id);
  const c = U.courseFor(s, T.mats);
  const hw = Object.fromEntries(T.hw.filter(h => h.student_id === s.id).map(h => [h.lesson_id, h]));
  const writings = Object.fromEntries(T.writings.filter(h => h.student_id === s.id).map(h => [h.lesson_id, h]));
  const entry = U.aggregate(rows, "entry")["entry-" + s.grade];
  const time = {}; T.act.filter(a => a.student_id === s.id).forEach(a => time[a.lesson_id] = (time[a.lesson_id] || 0) + a.seconds);
  const minis = U.aggregate(rows, "mini");
  const last = [...rows.map(r => r.created_at), ...Object.values(writings).map(w => w.submitted_at)].filter(Boolean).sort().at(-1);
  const results = U.aggregate(rows, "lesson"), hwres = U.aggregate(rows, "hw");
  /* полнота урока: мини-практика, тест, ДЗ-тест, письмо, отметка ДЗ – что из этого есть в уроке */
  const done = l => {
    const parts = [];
    const mb = l.theory.map((t, k) => t.mini?.length ? k : -1).filter(k => k >= 0);
    if (mb.length) parts.push(mb.filter(k => minis[`${l.id}:${k}`]).length / mb.length);
    if (U.lessonTests(l).test.length) parts.push(results[l.id] ? 1 : 0);
    if (l.hwtest?.length) parts.push(hwres[l.id] ? 1 : 0);
    if (l.writing) parts.push(writings[l.id] ? 1 : 0);
    if (l.hw) parts.push(hw[l.id] ? 1 : 0);
    return parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length * 100) : null;
  };
  return {c, entry, hw, writings, last, time, minis, done, results, hwres,
    waiting: Object.values(hw).filter(h => h.status === "sent").length + Object.values(writings).filter(w => w.status === "sent").length};
}
const sheetFor = (c, lid) => T.sheets.find(x => x.course === c && x.lesson_id === lid) || {};
const pending = s => !s.registered_at;
const ownerOf = s => s.pair_id && s.pair_id < s.id ? s.pair_id : s.id;
function courseOptions(g){
  const all = Object.entries(COURSES).map(([k, c]) => [k, c]);
  const fit = ([, c]) => c.grade === g || (c.grades || []).includes(g);
  return [...all.filter(fit), ...all.filter(x => !fit(x))].map(([k, c]) => [k, c.course + (access(k) ? "" : " – база не открыта"), access(k)]);
}
const mins = sec => sec ? Math.max(1, Math.round(sec / 60)) + " мин" : "–";

/* ---------- экраны ---------- */
function viewNoServer(){
  return `<div class="card stack"><h2>Сервер ещё не подключён</h2>
    <p>Кабинет работает через Supabase: там хранятся ученики, тесты, сочинения, домашки и доска. Вставьте адрес проекта и ключ <b>anon</b> в файл <b>config.js</b> – пошагово в README.</p>
    <p class="muted small">Материалы курса и методика доступны и без сервера.</p>
    <div class="row"><button class="btn" data-view="course">Материалы курса</button><button class="btn ghost" data-view="methodology">Методика курса</button></div></div>`;
}
function viewLogin(){
  return `<form class="card login stack" id="t-login"><h2>Вход для учителя</h2>
    <label for="t-email">Почта</label><input type="email" id="t-email" autocomplete="username" required>
    <label for="t-pass">Пароль</label><input type="password" id="t-pass" autocomplete="current-password" required>
    <button class="btn" type="submit">Войти</button>
    <p class="small" id="t-err" hidden style="color:var(--bad)"></p>
    <p class="small muted">Учётную запись учителя создают в Supabase: Authentication → Users → Add user.</p></form>`;
}

function inviteBox(s){
  if (!s.invite_token) return "";
  return `<div class="card stack" style="gap:8px;margin-top:14px"><div class="kicker">Одноразовая ссылка для регистрации</div>
    <div class="linkbox"><input type="text" id="ilink" readonly value="${esc(inviteLink(s.invite_token))}"><button class="btn sm" data-act="copy">Копировать</button></div>
    <p class="small muted">Отправьте ученику. Он заполнит анкету, выберет цели и фон, придумает пароль и пройдёт входной тест. После регистрации ссылка перестанет работать, а вход – логином <b>${esc(s.code)}</b> и паролем.</p></div>`;
}

function viewStudents(){
  const list = T.students.filter(s => T.grade === "all" || String(s.grade) === T.grade || (T.grade === "new" && pending(s)));
  const wait = T.writings.filter(w => w.status === "sent").length + T.hw.filter(h => h.status === "sent").length;
  const nameOf = id => T.students.find(x => x.id === id);
  return `<section class="hero glass" style="min-height:150px"><span class="mono muted">Кабинет учителя</span>
      <h1>Ученики</h1><p>${T.students.length} учеников · на проверку: ${wait}</p><img class="cat" src="assets/kotik.webp" alt=""></section>
    <div class="section-title"><div class="filters" role="group" aria-label="Класс">${[["all","Все"],...GRADES.map(g => [String(g), g + " кл."]),["new","Ждут регистрации"]].map(([k,n]) => `<button data-grade="${k}" aria-pressed="${T.grade===k}">${n}</button>`).join("")}</div>
      <button class="btn ghost sm" data-act="reload">Обновить</button></div>
    ${T.loading ? `<p class="muted">Загружаю…</p>` : ""}
    <div class="grid2">${list.map(s => { const x = sData(s), avg = x.c ? U.avgAll(x.c, x.results) : null, p = s.pair_id && nameOf(s.pair_id);
      return `<button class="card" data-student="${s.id}" style="text-align:left">
        <div class="row between"><h2>${esc(pending(s) ? "Ожидает регистрации" : s.name)}</h2>${x.waiting ? `<span class="chip mid">проверить: ${x.waiting}</span>` : ""}</div>
        <p class="small muted" style="margin-top:4px">${s.grade ? s.grade + " класс" : "класс не указан"}${s.goal ? " · " + esc(s.goal) : ""} · логин ${esc(s.code)}</p>
        ${p ? `<p class="small" style="margin-top:4px">👥 в паре с ${esc(p.name)}</p>` : ""}
        <div class="row" style="margin-top:10px;gap:20px">
          <div><div class="big tnum" style="font-size:1.5rem;color:${x.entry ? lvlColor(pct(x.entry.last)) : "inherit"}">${x.entry ? pct(x.entry.last) + "%" : "–"}</div><div class="small muted">входной тест</div></div>
          <div><div class="big tnum" style="font-size:1.5rem;color:${avg!=null ? lvlColor(avg) : "inherit"}">${avg ?? "–"}${avg!=null?"%":""}</div><div class="small muted">тесты уроков</div></div>
        </div>
        <p class="small muted" style="margin-top:8px">${pending(s) ? "Ссылка отправлена, ученик ещё не зарегистрировался" : !x.c ? "План ещё не выбран" : x.last ? "Активность: " + new Date(x.last).toLocaleString("ru-RU",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}) : "Активности пока нет"}</p>
      </button>`; }).join("") || (T.loading ? "" : `<div class="card"><p class="muted">Здесь пока никого нет.</p></div>`)}</div>

    <div class="section-title"><h2>Добавить ученика</h2></div>
    <form class="card stack" id="add-student" style="gap:8px">
      <p class="small muted">Создаётся одноразовая ссылка. Ученик сам заполнит анкету, выберет класс и цели – план выстроится автоматически, а результаты входного теста появятся здесь.</p>
      <label for="ns-name">Как вы его называете (для себя, необязательно)</label><input type="text" id="ns-name" placeholder="Например, Артём, 9А">
      <label for="ns-grade">Класс</label><select id="ns-grade">${GRADES.map(g => `<option value="${g}" ${g===9?"selected":""}>${g} класс</option>`).join("")}</select>
      <div><button class="btn" type="submit">Создать ссылку-приглашение</button></div>
    </form>
    ${T.justInvited ? inviteBox(T.justInvited) : ""}

    <div class="section-title"><h2>Ждут проверки</h2></div>
    <div class="card">${(() => {
      const items = [...T.writings.filter(w => w.status === "sent").map(w => ({w, s:nameOf(w.student_id)})), ...T.hw.filter(h => h.status === "sent").map(h => ({h, s:nameOf(h.student_id)}))].filter(x => x.s);
      if (!items.length) return '<p class="muted">Всё проверено.</p>';
      return `<ul style="margin:0;padding-left:20px">${items.map(x => { const c = U.courseFor(x.s, T.mats), lid = (x.w || x.h).lesson_id, l = c?.lessons.find(y => y.id === lid); if (!l) return "";
        return x.w ? `<li><a href="#" data-student="${x.s.id}" data-wreview="${l.id}">${esc(x.s.name)} – ${esc(U.KIND_NAME[x.w.kind] || "письмо")}: ${esc(l.title)}</a> <span class="small muted">${x.w.words || 0} сл.${x.w.photos?.length ? " · фото: " + x.w.photos.length : ""}</span></li>`
                   : `<li><a href="#" data-student="${x.s.id}" data-review="${l.id}">${esc(x.s.name)} – ДЗ: ${esc(l.title)}</a></li>`; }).join("")}</ul>`; })()}</div>`;
}

function writingReviewHTML(s, x, l){
  const w = x.writings[l.id], c = x.c;
  if (!w) return `<p class="muted small">Ученик ещё не прислал работу.</p>`;
  const src = l.writing ? U.writingSource(c, l, w.kind) : {title:"", topic:"", html:""}, crit = U.critFor(c, w.kind);
  const ai = T.ai[s.id + l.id] || w.ai;
  return `<div class="stack" style="gap:10px;margin-top:8px">
    <p class="small"><b>${esc(U.KIND_NAME[w.kind] || w.kind)}</b>${src.title ? ` · текст «${esc(src.title)}»` : ""} · ${w.words || 0} сл. · ${new Date(w.submitted_at).toLocaleString("ru-RU",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</p>
    ${src.topic ? `<p class="small"><b>Тема:</b> ${esc(src.topic)}</p><details class="small"><summary>Исходный текст</summary><div class="ttext">${src.html}</div></details>` : ""}
    ${w.body ? `<div class="ttext" style="white-space:pre-wrap;background:var(--field)">${esc(w.body)}</div>` : ""}
    ${w.photos?.length ? `<div class="row">${w.photos.map((u, k) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Страница ${k+1}" style="width:120px;height:160px;object-fit:cover;border-radius:12px;border:1px solid var(--line)"></a>`).join("")}</div>` : ""}
    ${w.body ? `<div class="ai-box"><div class="row between"><b>Нейросеть</b><button class="btn sm" data-act="ai-check" ${T.busy ? "disabled" : ""}>${T.busy === "check" ? "Проверяю…" : ai ? "Проверить заново" : "Проверить по критериям"}</button></div>
      ${ai ? (ai.error ? `<p class="small" style="color:var(--bad);margin-top:6px">${esc(ai.error)}</p>` : `<div class="small" style="margin-top:8px">
        <p><b>Баллы:</b> ${Object.entries(ai.scores || {}).map(([k, v]) => `${esc(k)} – ${v}`).join(", ")} · <b>Ошибки:</b> ${c.criteria.errors.filter(([k]) => ai.errors?.[k] != null).map(([k, n]) => `${esc(n)} – ${ai.errors[k]}`).join(", ")}${ai.errors?.fact ? `, фактические – ${ai.errors.fact}` : ""}</p>
        ${ai.found?.length ? `<ul style="margin:6px 0 0;padding-left:18px">${ai.found.slice(0, 12).map(f => `<li>«${esc(f.fragment)}» → ${esc(f.fix)} <span class="muted">(${esc({orf:"орфография",punct:"пунктуация",gram:"грамматика",speech:"речь",fact:"факт",logic:"логика"}[f.type] || f.type)})</span></li>`).join("")}</ul>` : ""}
        ${ai.comment ? `<p style="margin-top:6px"><b>Комментарий:</b> ${esc(ai.comment)}</p>` : ""}
        <div style="margin-top:8px"><button class="btn ghost sm" data-act="ai-apply">Подставить в оценку</button></div>
        <p class="muted" style="margin-top:6px">Это черновик: проверьте и поправьте баллы сами – ученик видит только вашу оценку.</p></div>`) : `<p class="small muted" style="margin-top:6px">Нейросеть предложит баллы по критериям ОГЭ, найдёт ошибки и напишет комментарий. Ключ нейросети подключает разработчик.</p>`}</div>` : ""}
    ${crit ? `<div class="crit">${crit.map(([k,n,m]) => `<label for="sc-${k}">${k} – ${esc(n)}</label><select id="sc-${k}" data-crit="${k}">${Array.from({length:m+1},(_,i) => `<option ${(w.scores?.[k] ?? -1) === i ? "selected" : ""}>${i}</option>`).join("")}</select>`).join("")}</div>` : ""}
    <div class="crit">${c.criteria.errors.map(([k,n]) => `<label for="er-${k}">Ошибки: ${esc(n)}</label><input type="text" inputmode="numeric" id="er-${k}" data-err="${k}" style="width:70px" value="${esc(w.errors?.[k] ?? "")}">`).join("")}</div>
    <label for="w-comment">Комментарий ученику</label><textarea id="w-comment">${esc(w.comment || "")}</textarea>
    <div class="row"><button class="btn sm" data-act="wsave" data-st="reviewed">Сохранить оценку</button><button class="btn ghost sm" data-act="wsave" data-st="redo">Вернуть на доработку</button></div></div>`;
}

function aiReportHTML(s, x){
  const rep = T.reports.find(r => r.student_id === s.id && r.kind === "analysis"), b = rep?.body;
  return `<div class="ai-box stack" style="gap:10px"><div class="row between"><div><div class="kicker">Разбор нейросети</div>
      <p class="small muted" style="margin-top:2px">Анализирует тесты, мини-практику, ДЗ, сочинения и время занятий – и предлагает, как поправить план.</p></div>
      <button class="btn sm" data-act="ai-analyze" ${T.busy ? "disabled" : ""}>${T.busy === "analyze" ? "Анализирую…" : rep ? "Обновить разбор" : "Сделать разбор"}</button></div>
    ${b?.error ? `<p class="small" style="color:var(--bad)">${esc(b.error)}</p>` : b ? `<p>${esc(b.summary || "")}</p>
      ${b.strengths?.length ? `<p class="small"><b>Сильные стороны:</b> ${b.strengths.map(esc).join("; ")}</p>` : ""}
      ${b.weak?.length ? `<div class="small"><b>Слабые места:</b><ul style="margin:4px 0 0;padding-left:18px">${b.weak.map(w => `<li><b>${esc(w.topic)}</b> – ${esc(w.why)}</li>`).join("")}</ul></div>` : ""}
      ${b.time ? `<p class="small"><b>Время и полнота:</b> ${esc(b.time)}</p>` : ""}${b.essay ? `<p class="small"><b>Письмо:</b> ${esc(b.essay)}</p>` : ""}
      ${b.plan?.length ? `<div class="small"><b>Предложения к плану:</b>${b.plan.map((p, k) => `<div class="mat"><span class="ic">+</span><div style="flex:1"><b>${esc(p.title)}</b><p class="muted">${esc(p.why)}</p>${p.tasks?.length ? `<ul style="margin:4px 0 0;padding-left:18px">${p.tasks.map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
          ${x.c ? `<button class="btn ghost sm" style="margin-top:6px" data-act="ai-addlesson" data-k="${k}">Добавить урок в план ученика</button>` : ""}</div></div>`).join("")}</div>` : ""}
      <p class="small muted">${new Date(rep.created_at).toLocaleString("ru-RU",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</p>` : ""}</div>`;
}

function viewStudent(){
  const s = T.students.find(x => x.id === T.sel); if (!s) return viewStudents();
  const x = sData(s), c = x.c, et = window.ENTRY_TESTS?.[String(s.grade)];
  const unlocked = s.unlocked || [], others = T.students.filter(o => o.id !== s.id && !pending(o));
  return `<div class="row between" style="margin-bottom:12px"><button class="btn ghost sm" data-view="students">← Все ученики</button><button class="btn ghost sm" data-act="reload">Обновить</button></div>
  <section class="hero glass" style="min-height:150px"><span class="mono muted">${s.grade ? s.grade + " класс" : "класс не указан"} · ${esc(c ? c.course : "план не выбран")}</span>
    <h1>${esc(pending(s) ? "Ожидает регистрации" : s.name)}</h1><p>${s.goal ? esc(s.goal) + " · " : ""}логин ${esc(s.code)}</p><img class="cat" src="assets/kotik.webp" alt=""></section>
  ${inviteBox(s)}
  <div class="grid2" style="margin-top:16px">
    <div class="card stack" style="gap:6px"><div class="kicker">Анкета</div>
      <p><b>Класс:</b> ${s.grade || "–"}</p><p><b>Цели:</b> ${esc((s.goals || []).join(", ") || s.goal || "–")}</p><p><b>Контакт:</b> ${esc(s.contact || "–")}</p>
      <p><b>Зарегистрирован:</b> ${s.registered_at ? new Date(s.registered_at).toLocaleDateString("ru-RU") : "нет"}</p>
      <div class="row" style="margin-top:6px"><button class="btn ghost sm" data-act="new-invite">${pending(s) ? "Новая ссылка" : "Сбросить пароль (новая ссылка)"}</button></div></div>
    <form class="card stack" id="plan-form" style="gap:8px"><div class="kicker">План работы</div>
      <label for="pl-course">Курс</label>
      <select id="pl-course"><option value="">– не выбран –</option>${courseOptions(s.grade || 9).map(([k,n,ok]) => `<option value="${k}" ${k===s.course?"selected":""} ${ok?"":"disabled"}>${esc(n)}</option>`).join("")}</select>
      <p class="small muted">Подсказка по целям ученика: ${esc(COURSES[U.planFor(s.grade || 9, s.goals || [])]?.course || "–")}.</p>
      <label for="pl-start">Дата первого урока (дальше – раз в неделю)</label><input type="date" id="pl-start" value="${esc(s.start_date || "")}">
      <p class="small muted">Дату любого урока можно поменять отдельно – в таблице уроков ниже.</p>
      <div><button class="btn sm" type="submit">Сохранить план</button></div></form>
    <div class="card stack" style="gap:8px"><div class="kicker">Работа в паре</div>
      <p class="small muted">Двое учеников видят одну общую доску на каждом уроке и курсоры друг друга. Результаты и работы у каждого свои.</p>
      <label for="pair-pick">Напарник</label>
      <select id="pair-pick"><option value="">– занимается один –</option>${others.map(o => `<option value="${o.id}" ${o.id === s.pair_id ? "selected" : ""}>${esc(o.name)}${o.grade ? ", " + o.grade + " кл." : ""}</option>`).join("")}</select>
      <div><button class="btn sm" data-act="save-pair">Сохранить</button></div></div>
  </div>
  ${!pending(s) ? `<div class="section-title"><h2>Анализ и план</h2></div>${aiReportHTML(s, x)}` : ""}
  <div class="section-title"><h2>Входной тест</h2></div>
  ${et && x.entry ? window.entryHTML(et, x.entry) : `<div class="card"><p class="muted">${pending(s) ? "Тест будет доступен после регистрации." : "Ученик ещё не прошёл входной тест."}</p></div>`}
  ${c ? `<div class="section-title"><h2>Карта успеха</h2></div>${window.mapHTML(c, x.results, x.hwres, x.writings)}
  <div class="section-title"><h2>Уроки</h2><div class="row"><button class="btn ghost sm" data-act="shift" title="Перенести все будущие уроки на неделю вперёд">Каникулы: сдвинуть будущие уроки на неделю</button></div></div>
  <div class="tablewrap glass"><table style="min-width:1040px"><thead><tr><th>№</th><th>Дата</th><th>Тема</th><th>Доступ</th><th>Время</th><th>Выполнено</th><th>Тест</th><th>ДЗ-тест</th><th>Письмо</th><th>ДЗ</th><th></th></tr></thead><tbody>
  ${c.lessons.map((l,i) => { const r = x.results[l.id], hr = x.hwres[l.id], h = x.hw[l.id], w = x.writings[l.id], hs = U.hwState(c, l.id, x.hw), dn = x.done(l);
    const byDate = d(l.date) <= today(), early = unlocked.includes(l.id);
    const wcell = !w ? "–" : w.status === "sent" ? `<span class="chip mid">ждёт</span>` : w.max ? `<span class="chip ${lvl(Math.round(w.total/w.max*100))}">${w.total}/${w.max}</span>` : `<span class="chip">${w.status === "redo" ? "доработка" : "проверено"}</span>`;
    return `<tr><td class="tnum">${i+1}</td><td><input type="date" value="${esc(l.date)}" data-date="${l.id}" style="width:150px;padding:6px 8px" aria-label="Дата урока ${i+1}">${s.dates?.[l.id] ? '<div class="small muted">перенесён</div>' : ""}</td>
      <td><i class="dot" style="background:${blockOf(c, l).color}"></i> ${esc(l.title)}${l.writing ? `<div class="small muted">${esc(U.KIND_NAME[l.writing.type])}</div>` : ""}${l.custom ? '<div class="small muted">свой урок</div>' : ""}</td>
      <td>${byDate ? '<span class="chip good">открыт</span>' : early ? `<button class="btn ghost sm" data-unlock="${l.id}" data-on="0">Закрыть</button>` : `<button class="btn ghost sm" data-unlock="${l.id}" data-on="1">${I.lock} Открыть сейчас</button>`}</td>
      <td class="tnum">${mins(x.time[l.id])}</td>
      <td class="tnum">${dn == null ? "–" : `<span class="chip ${lvl(dn)}">${dn}%</span>`}</td>
      <td class="tnum">${r ? `<span class="chip ${lvl(pct(r.last))}">${pct(r.last)}%</span><div class="small muted">лучш. ${pct(r.best)}% · ${r.attempts}${r.last?.duration_sec ? " · " + mins(r.last.duration_sec) : ""}</div>` : "–"}</td>
      <td class="tnum">${hr ? `<span class="chip ${lvl(pct(hr.last))}">${pct(hr.last)}%</span>` : "–"}</td>
      <td>${wcell}${w ? `<div style="margin-top:4px"><button class="btn ghost sm" data-wreview="${l.id}">Проверить</button></div>` : ""}</td>
      <td><span class="chip ${hs.c}">${hs.t}</span>${h?.note?`<div class="small" style="margin-top:4px">${/^https?:/.test(h.note)?`<a href="${esc(h.note)}" target="_blank" rel="noopener">ссылка ученика</a>`:esc(h.note)}</div>`:""}<div style="margin-top:4px"><button class="btn ghost sm" data-review="${l.id}">Оценить</button></div></td>
      <td><button class="btn yellow sm" data-boardfor="${l.id}">Доска</button></td></tr>
      ${T.review === l.id ? `<tr><td colspan="11"><div class="stack" style="gap:6px;max-width:520px"><b>ДЗ: ${esc(l.title)}</b><p class="small">${esc(l.hw || "")}</p>
          ${hr ? `<p class="small muted">ДЗ-тест: ${esc(U.recText(hr.last))}</p>` : ""}
          <input type="text" id="rv-grade" placeholder="Оценка" value="${esc(h?.grade||"")}"><textarea id="rv-comment" placeholder="Комментарий ученику">${esc(h?.comment||"")}</textarea>
          <div class="row"><button class="btn sm" data-act="review" data-st="accepted">Принять</button><button class="btn ghost sm" data-act="review" data-st="redo">На доработку</button></div></div></td></tr>` : ""}
      ${T.wreview === l.id ? `<tr><td colspan="11"><div style="max-width:760px">${writingReviewHTML(s, x, l)}</div></td></tr>` : ""}`; }).join("")}
  </tbody></table></div>
  <p class="small muted" style="margin-top:8px">«Время» – сколько ученик провёл в папке урока. «Выполнено» – доля сделанного: мини-практика, тест, ДЗ-тест, письмо и отметка ДЗ.</p>`
  : `<div class="section-title"><h2>План</h2></div><div class="card"><p>План ещё не выбран: выберите курс выше. Для ${s.grade || "этого"} класса подходит: ${esc(COURSES[U.planFor(s.grade || 9, s.goals || [])]?.course || "–")}.</p></div>`}
  <div class="section-title"><h2>Управление</h2></div>
  <div class="card row"><button class="btn ${T.confirmDel===s.id?"danger":"ghost"} sm" data-act="del-student">${T.confirmDel===s.id?"Нажмите ещё раз, чтобы удалить навсегда":"Удалить ученика"}</button></div>`;
}

function viewBoard(){
  const s = T.students.find(x => x.id === T.sel), c = U.courseFor(s, T.mats), l = c.lessons.find(x => x.id === T.boardLesson);
  const p = s.pair_id && T.students.find(x => x.id === s.pair_id);
  return `<div class="row between" style="margin-bottom:12px"><button class="btn ghost sm" data-student="${s.id}">← ${esc(s.name)}</button>
    <span class="small muted">Ученик: папка № ${c.lessons.indexOf(l)+1} → «Доска»</span></div>
  <article class="window glass" style="--c:${blockOf(c, l).color}"><div class="head"><div class="corners"><div class="mono muted">Доска</div><div class="mono muted">${esc(s.name)}${p ? " и " + esc(p.name) : ""}</div></div><h1>${esc(l.title)}</h1></div>
    <div class="pane"><div class="board glass" id="board"></div>
    <p class="small muted" style="margin-top:8px">Когда вы переключаете лист, у ${p ? "учеников" : "ученика"} он переключается тоже. «Очистить» стирает лист у всех.</p></div></article>`;
}

function viewMethodology(){
  const c = COURSES[curCourse()];
  return `<section class="hero glass" style="min-height:150px"><span class="mono muted">${esc(c.course)}</span><h1>Методика курса</h1><img class="cat" src="assets/kotik.webp" alt=""></section>
  <div class="section-title"><h2>Курс</h2>${coursePick()}</div>
  <div class="stack" style="margin-top:10px;gap:26px">${(c.methodology || []).map(m => `<div class="sheet"><span class="tag label">${esc(m.h)}</span>${m.t ? `<p>${U.mark(m.t)}</p>` : ""}${m.list ? `<ul>${m.list.map(x => `<li>${U.mark(x)}</li>`).join("")}</ul>` : ""}${m.table ? `<div class="tablewrap"><table><thead><tr>${m.table[0].map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${m.table.slice(1).map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}</div>`).join("")}</div>`;
}
const coursePick = () => `<select id="course-pick" style="width:auto;max-width:100%">${Object.entries(COURSES).map(([k,x]) => `<option value="${k}" ${k===curCourse()?"selected":""}>${esc(x.course)}${access(k) ? "" : " 🔒"}</option>`).join("")}</select>`;

function viewCourse(){
  const cid = curCourse(), c = teacherCourse(cid), ok = access(cid);
  return `<section class="hero glass" style="min-height:150px"><span class="mono muted">${ok ? "База открыта" : "Встроенная база"}</span><h1>${esc(c.course)}</h1>
    <p>${ok ? "Методика урока, теория с мини-практикой, задания с ключами, тесты, письмо. Добавляйте свои материалы в любую папку." : "Эта база пока не открыта. Названия уроков видны, материалы – после покупки."}</p><img class="cat" src="assets/kotik.webp" alt=""></section>
  <div class="section-title"><h2>Уроки</h2>${coursePick()}</div>
  ${!ok ? `<div class="card" style="margin-bottom:16px"><p>Чтобы открыть базу «${esc(U.PACKS[U.packOf(cid)])}», напишите разработчику платформы. Свои уроки и материалы можно добавлять и без неё.</p></div>` : ""}
  <div class="folders">${c.lessons.map((l,i) => `<button class="folder ${ok || l.custom ? "" : "locked"}" style="--c:${blockOf(c, l).color}" data-lesson="${l.id}"><span class="back"></span><span class="papers"><i></i><i></i></span>
    <span class="front">${ok || l.custom ? "" : `<span class="lockico">${I.lock}</span>`}<span class="num">№ ${String(i+1).padStart(2,"0")}${l.custom ? " · СВОЙ" : ""}</span><span class="ttl">${esc(l.title)}</span>
    <span class="meta"><span class="pill">${esc(l.oge)}</span>${l.materials?.length ? `<span class="pill">+${l.materials.length}</span>` : ""}${sheetFor(cid, l.id).url ? '<span class="pill">лист ✓</span>' : ""}<span class="arrow">→</span></span></span></button>`).join("")}</div>
  ${sb && T.session ? `<div class="section-title"><h2>Свой урок</h2></div>
  <form class="card stack" id="own-lesson" style="gap:8px"><p class="small muted">Урок появится в курсе у всех ваших учеников этого курса. Материалы, задания и тест добавите внутри папки.</p>
    <label for="ol-title">Тема</label><input type="text" id="ol-title" required>
    <label for="ol-date">Дата (по плану курса)</label><input type="date" id="ol-date" required>
    <div><button class="btn sm" type="submit">Создать папку</button></div></form>` : ""}`;
}

function methodPlan(l){
  return [["0–5", "Проверка ДЗ", "Ошибки ДЗ-теста и письменной работы (видны в кабинете ученика): 2–3 правила вслух."],
          ["5–25", "Теория → примеры → мини-практика", "Каждый блок теории: коротко правило, разбор на примерах, сразу мини-практика (ученик отвечает в папке, проверка мгновенная). Затем следующий блок. Темы: " + (l.learn.join("; ") || l.title) + "."],
          ["25–40", "Задания формата экзамена", "Раздел «Практика» на общей доске, затем реальные задания из открытого банка ФИПИ."],
          ["40–55", l.writing ? "Письменная линия" : "Отработка", l.writing ? l.writing.classwork : "Задания из своих материалов или созданные нейросетью; самопроверка по ключам."],
          ["55–60", "Тест и ДЗ", "Тест по уроку в приложении; объяснить ДЗ" + (l.writing ? ", письмо" : "") + " и ДЗ-тест."]];
}

function materialsTab(cid, l){
  const own = T.mats.filter(m => m.course === cid && m.lesson_id === l.id && m.kind !== "lesson" && !m.student_id);
  const g = T.gen && T.gen.lesson === l.id ? T.gen : null;
  return `${own.length ? own.map(m => `<div class="mat"><span class="ic">${{link:"🔗",file:"📎",text:"📝",tasks:"✏️"}[m.kind]}</span><div style="flex:1;min-width:0">
      <b>${esc(m.title || m.url || "Материал")}</b>${m.url ? ` · <a href="${esc(m.url)}" target="_blank" rel="noopener">открыть</a>` : ""}
      ${m.kind === "text" ? `<div class="small" style="white-space:pre-line;margin-top:4px">${esc((m.body || "").slice(0, 400))}</div>` : ""}
      ${m.kind === "tasks" ? `<p class="small muted">Мини-практика: ${m.data?.mini?.length || 0} · вопросы теста: ${m.data?.test?.length || 0}</p>` : ""}</div>
      <button class="btn ghost sm" data-delmat="${m.id}">Удалить</button></div>`).join("") : `<p class="muted">Своих материалов к этому уроку пока нет.</p>`}
    ${sb && T.session ? `<form class="card stack" id="add-mat" style="gap:8px;margin-top:14px;box-shadow:none"><div class="kicker">Добавить в папку</div>
      <select id="am-kind"><option value="link">Ссылка (Учу по ФРП, Google Диск, видео)</option><option value="file">Файл с компьютера (лист, картинка, PDF)</option><option value="text">Текст / задание</option></select>
      <label for="am-title">Название</label><input type="text" id="am-title" placeholder="${esc(l.title)} – рабочий лист">
      <div class="stack" style="gap:8px" data-k="link"><label for="am-url">Ссылка</label><input type="url" id="am-url"></div>
      <div class="stack" style="gap:8px" data-k="file" hidden><label for="am-file">Файл</label><input type="file" id="am-file"></div>
      <div class="stack" style="gap:8px" data-k="text link file"><label for="am-body">Текст (для файла и ссылки – короткое пояснение)</label><textarea id="am-body"></textarea></div>
      <p class="small muted">Материал увидят все ваши ученики этого курса в папке урока: открыть на общей доске или скачать.</p>
      <div><button class="btn sm" type="submit">Добавить</button></div></form>
    <div class="ai-box stack" style="gap:8px;margin-top:14px"><div class="kicker">Задания от нейросети</div>
      <label for="ag-topic">Тема</label><input type="text" id="ag-topic" value="${esc(g?.topic || l.title)}">
      <label for="ag-notes">Пожелания (необязательно)</label><input type="text" id="ag-notes" value="${esc(g?.notes || "")}" placeholder="Например, на причастный оборот после определяемого слова">
      <label for="ag-count">Сколько заданий</label><select id="ag-count">${[4,6,8,10].map(n => `<option ${n === (g?.count || 6) ? "selected" : ""}>${n}</option>`).join("")}</select>
      <div><button class="btn sm" data-act="ai-gen" ${T.busy ? "disabled" : ""}>${T.busy === "gen" ? "Составляю…" : "Составить мини-практику и тест"}</button></div>
      ${g?.res?.error ? `<p class="small" style="color:var(--bad)">${esc(g.res.error)}</p>` : ""}
      ${g?.res && !g.res.error ? `<div class="card" style="box-shadow:none"><b>${esc(g.res.title || g.topic)}</b>
        ${U.miniHTML({id:"preview"}, 0, g.res.mini, true)}
        <ol class="small" style="padding-left:20px;margin-top:10px">${(g.res.test || []).map(q => `<li style="margin-bottom:8px">${esc(q.q)}<ul>${q.o.map((o, k) => `<li ${k === q.a ? 'style="color:var(--good);font-weight:800"' : ""}>${esc(o)}</li>`).join("")}</ul></li>`).join("")}</ol>
        <p class="small muted">Проверьте задания перед сохранением.</p>
        <div class="row"><button class="btn sm" data-act="ai-save">Сохранить в папку</button><button class="btn ghost sm" data-act="ai-gen">Составить заново</button></div></div>` : ""}</div>` : ""}`;
}

function viewLesson(){
  const cid = curCourse(), c = teacherCourse(cid), l = c.lessons.find(x => x.id === T.open); if (!l) { T.view = "course"; return viewCourse(); }
  const i = c.lessons.indexOf(l), b = blockOf(c, l), ok = access(cid) || l.custom;
  const keys = (window.COURSE_KEYS?.[cid] || {})[l.id] || [];
  const lk = {...l, practice: l.practice.map((p,k) => ({...p, key: keys[k]}))};
  const sh = sheetFor(cid, l.id), Tt = U.lessonTests(l);
  const tabs = [["method","Методика"],["theory","Теория"], l.practice.length && ["practice","Практика"], l.writing && ["writing","Письмо"], Tt.test.length && ["test","Тест"], l.hwtest?.length && ["hwtest","ДЗ-тест"], ["mats","Свои материалы"], ["sheet","Лист и ДЗ"], l.custom && ["edit","Изменить урок"]].filter(Boolean);
  if (!tabs.some(t => t[0] === T.sub)) T.sub = "method";
  const testList = qs => `<ol style="padding-left:20px">${qs.map(q => `<li style="margin-bottom:12px"><b>${esc(q.q)}</b><ul>${q.o.map((o,k) => `<li ${k===q.a?'style="color:var(--good);font-weight:800"':""}>${esc(o)}${k===q.a?" ✓":""}</li>`).join("")}</ul><p class="small muted">${q.tag ? "Правило: " + esc(q.tag) + ". " : ""}${esc(q.e || "")}</p></li>`).join("")}</ol>`;
  let body = "";
  if (!ok) body = `<p>${I.lock} Материалы этого урока – во встроенной базе «${esc(U.PACKS[U.packOf(cid)])}». Чтобы открыть её, напишите разработчику платформы.</p>`;
  else {
  if (T.sub === "method") body = `${l.method ? `<p><b>Главное:</b> ${esc(l.method.focus)}</p>` : ""}
      <div class="tablewrap method"><table><thead><tr><th>Минуты</th><th>Этап</th><th>Что делаем</th></tr></thead><tbody>${methodPlan(l).map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <p class="small muted" style="margin-top:6px">Расчёт на 60 минут. Теория идёт маленькими блоками, после каждого – мини-практика.${l.writing ? " Письменную линию не сокращаем: умение писать формируется только регулярной практикой." : ""}</p>
      ${l.method?.tips?.length ? `<h3 style="margin-top:14px">Методические советы</h3><ul>${l.method.tips.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${l.stub ? `<p class="small" style="margin-top:12px">Содержание урока – по ФРП. Добавьте материалы и задания во вкладке «Свои материалы» – можно составить их нейросетью.</p>` : ""}`;
  if (T.sub === "theory") body = U.theoryHTML(l, true) + (Tt.mini.length ? `<div class="tblock">${U.miniHTML({id:"own"}, 0, Tt.mini, true)}</div>` : "");
  if (T.sub === "practice") body = U.practiceHTML(lk, true);
  if (T.sub === "writing"){
    const w = l.writing, kinds = w.type === "choice" ? ["13.1","13.2","13.3"] : [w.type === "izl" ? "izl" : (["thesis","example"].includes(w.type) ? "13.3" : w.type)];
    body = `<div class="theory">${U.stepHTML(w.step)}</div>
      <p style="margin-top:12px"><b>На уроке:</b> ${esc(w.classwork)}</p><p><b>Домашнее письмо:</b> ${esc(w.task)}</p>
      ${kinds.map(k => `<p style="margin-top:10px"><b>Тема${kinds.length>1?" "+k:""}:</b> ${esc(U.writingSource(c, l, k).topic)}</p>`).join("")}
      ${w.type === "izl" ? `<p class="small"><b>Микротемы (ключ):</b></p><ol class="small">${c.izl[w.text].micro.map(m => `<li>${esc(m)}</li>`).join("")}</ol>` : ""}
      <details style="margin-top:8px"><summary><b>Текст</b></summary><div class="ttext">${U.writingSource(c, l, kinds[0]).html}</div></details>`;
  }
  if (T.sub === "test") body = testList(Tt.test);
  if (T.sub === "hwtest") body = testList(l.hwtest);
  if (T.sub === "mats") body = materialsTab(cid, l);
  if (T.sub === "edit"){
    const m = T.mats.find(x => x.id === l.mid);
    body = `<form class="stack" id="edit-lesson" style="gap:8px"><label for="el-title">Тема</label><input type="text" id="el-title" value="${esc(l.title)}">
      <label for="el-date">Дата</label><input type="date" id="el-date" value="${esc(m?.data?.date || l.date)}">
      <label for="el-theory">Теория: блоки через пустую строку, первая строка блока – заголовок</label>
      <textarea id="el-theory" style="min-height:220px">${esc((l.theory || []).map(t => t.h + "\n" + (t.t || "") + (t.list ? "\n" + t.list.join("\n") : "")).join("\n\n"))}</textarea>
      <label for="el-hw">Домашнее задание</label><textarea id="el-hw">${esc(l.hw || "")}</textarea>
      <div class="row"><button class="btn sm" type="submit">Сохранить</button><button class="btn ghost sm" type="button" data-act="del-lesson">Удалить урок</button></div></form>`;
  }
  if (T.sub === "sheet") body = `${l.hw ? `<p><b>Домашнее задание:</b> ${esc(l.hw)}</p>` : ""}
      <div class="row" style="margin-top:10px"><button class="btn yellow sm" data-act="dl-sheet">⤓ Скачать рабочий лист (Word)</button>${l.practice.length ? `<button class="btn ghost sm" data-act="dl-keys">⤓ Скачать ключи</button>` : ""}</div>
      <div class="stack" style="gap:8px;margin-top:14px">
      ${sb && T.session ? `<label for="sh-name">Название рабочего листа</label><input type="text" id="sh-name" value="${esc(sh.name||"")}" placeholder="${esc(l.title)} – рабочий лист">
      <label for="sh-url">Ссылка (Учу по ФРП, Google Диск, GitHub)</label><input type="url" id="sh-url" value="${esc(sh.url||"")}">
      <label for="sh-note">Заметка для ученика</label><input type="text" id="sh-note" value="${esc(sh.note||"")}">
      <div><button class="btn sm" data-act="save-sheet">Сохранить – ученики курса увидят ссылку</button></div>` : `<p class="muted small">Чтобы прикреплять рабочие листы, подключите Supabase и войдите.</p>`}</div>`;
  }
  return `<div class="row between" style="margin-bottom:12px"><button class="btn ghost sm" data-view="course">← Все уроки</button>
    <div class="row">${i>0?`<button class="btn ghost sm" data-lesson="${c.lessons[i-1].id}">‹ № ${i}</button>`:""}${i<c.lessons.length-1?`<button class="btn ghost sm" data-lesson="${c.lessons[i+1].id}">№ ${i+2} ›</button>`:""}</div></div>
  <article class="window glass" style="--c:${b.color}">
    <div class="head"><div class="corners"><div class="mono muted">Дата по плану:<br><b style="color:var(--ink)">${fmt(l.date,{day:"numeric",month:"long",year:"numeric"})}</b></div><div class="mono muted">${esc(c.goal || "Раздел")}:<br><b style="color:var(--ink)">${esc(l.oge)}</b></div></div>
      <h1>${esc(l.title)}</h1><div class="rule">✦</div><p class="mono muted">${esc(b.name)} · урок ${i+1} из ${c.lessons.length}</p></div>
    <div class="tabs"><span class="lights" aria-hidden="true"><i></i><i></i><i></i></span>${tabs.map(([k,n]) => `<button data-sub="${k}" aria-pressed="${T.sub===k}">${n}</button>`).join("")}</div>
    <div class="pane">${body}</div></article>`;
}

function viewLook(){
  return `<div class="section-title" style="margin-top:6px"><h2>Оформление</h2></div>
  <div class="card stack"><p>Фон кабинета по настроению или своё фото (фото хранится только на этом устройстве).</p>${U.themesHTML(localStorage.getItem("oge-theme-t") || T.me?.theme)}</div>`;
}

function render(){
  if (T.board){ T.board.destroy(); T.board = null; }
  const logged = !!(sb && T.session);
  let html;
  if (T.view === "methodology") html = viewMethodology();
  else if (T.view === "look") html = viewLook();
  else if (["course","lesson"].includes(T.view)) html = T.view === "course" ? viewCourse() : viewLesson();
  else if (!sb) html = viewNoServer();
  else if (!T.session) html = viewLogin();
  else html = T.view === "student" ? viewStudent() : T.view === "board" ? viewBoard() : viewStudents();
  const cur = ["students","student","board"].includes(T.view) ? "students" : ["course","lesson"].includes(T.view) ? "course" : T.view;
  const nav = [["students","Ученики",I.users],["course","Материалы и база",I.book],["methodology","Методика курса",I.method],["look","Оформление",I.pen]];
  $("#app").innerHTML = `<div class="shell">
    <div class="drawer-back" ${T.drawer ? "" : "hidden"} data-act="close-drawer"></div>
    <nav class="drawer glass ${T.drawer ? "open" : ""}" aria-label="Меню">
      <div class="me"><img src="assets/kotik.webp" alt="" style="width:44px"><div><b>${esc(T.me?.name || CFG.TEACHER_NAME || "Учитель")}</b><div class="small muted">${T.me?.role === "developer" ? "Учитель и разработчик" : "Кабинет учителя"}</div></div></div>
      <div class="group"><span class="mono">Разделы</span>${nav.map(([k,n,ic]) => `<button class="navitem" data-view="${k}" ${cur===k?'aria-current="page"':""}>${ic}${n}</button>`).join("")}
        ${T.me?.role === "developer" ? `<a class="navitem" href="dev.html">${I.code}Кабинет разработчика</a>` : ""}</div>
      <div class="group"><span class="mono">Классы</span>${GRADES.map(g => `<button class="navitem" data-view="students" data-grade="${g}">${I.users}${g} класс<span class="chip" style="margin-left:auto">${T.students.filter(s => s.grade === g).length}</span></button>`).join("")}</div>
      ${logged ? `<div class="group"><button class="navitem" data-act="logout">${I.out}Выйти</button></div>` : ""}
    </nav>
    <div style="min-width:0">
      <header class="topnav"><div class="in glass"><button class="iconbtn menu-btn" data-act="open-drawer" aria-label="Открыть меню">${I.menu}</button><span class="ttl">Кабинет учителя</span><span class="avatar">${esc((T.me?.name || CFG.TEACHER_NAME || "У")[0])}</span></div></header>
      <main class="main">${html}</main></div></div>`;
  if (T.view === "board" && sb && T.session){
    const s = T.students.find(x => x.id === T.sel), c = U.courseFor(s, T.mats), l = c.lessons.find(x => x.id === T.boardLesson), owner = ownerOf(s);
    T.board = Board.mount($("#board"), {api: Board.api("teacher", sb, {studentId: owner, lesson: l.id}), sb, channelName: `board-${owner}-${l.id}`, role: "teacher", name: T.me?.name || CFG.TEACHER_NAME || "Учитель", pages: Board.pages(c, l)});
  }
}

/* ---------- нейросеть ---------- */
async function ai(body){
  const {data, error} = await sb.functions.invoke("ai", {body});
  if (error){ let msg = error.message; try{ msg = (await error.context.json()).error || msg; }catch(_){} return {error: "Нейросеть недоступна: " + msg}; }
  return data;
}
const upd = async (id, row) => { const {error} = await sb.from("students").update(row).eq("id", id); if (error){ toast("Не сохранилось: " + error.message); return false; } Object.assign(T.students.find(x => x.id === id), row); return true; };

/* ---------- события ---------- */
document.addEventListener("submit", async e => {
  e.preventDefault();
  const id = e.target.id;
  if (id === "t-login"){
    const {data, error} = await sb.auth.signInWithPassword({email: $("#t-email").value.trim(), password: $("#t-pass").value});
    if (error){ const el = $("#t-err"); el.textContent = "Не получилось войти: проверьте почту и пароль."; el.hidden = false; return; }
    T.session = data.session; await loadAll();
  }
  if (id === "add-student"){
    const g = +$("#ns-grade").value, nick = $("#ns-name").value.trim();
    const row = {name: nick ? "(" + nick + ")" : "(ожидает регистрации)", grade: g, course: "", code: U.genCode(), invite_token: U.randHex(18)};
    const {data, error} = await sb.from("students").insert(row).select(ST_COLS).single();
    if (error){ toast("Не удалось создать: " + error.message); return; }
    T.students.push(data); T.justInvited = data; render(); toast("Ссылка создана – скопируйте и отправьте ученику");
  }
  if (id === "plan-form"){
    if (await upd(T.sel, {course: $("#pl-course").value, start_date: $("#pl-start").value || null})){ render(); toast("План сохранён – ученик увидит уроки по этим датам"); }
  }
  if (id === "own-lesson"){
    const cid = curCourse(), lid = "c" + U.randHex(4);
    const row = {course: cid, lesson_id: lid, kind: "lesson", title: $("#ol-title").value.trim(),
                 data: {title: $("#ol-title").value.trim(), date: $("#ol-date").value, learn: [$("#ol-title").value.trim()], oge: "Свой урок", theory: [], hw: ""}};
    const {data, error} = await sb.from("materials").insert(row).select().single();
    if (error){ toast("Не сохранилось: " + error.message); return; }
    T.mats.push(data); T.open = lid; T.view = "lesson"; T.sub = "edit"; render(); scrollTo(0,0); toast("Папка создана – заполните урок");
  }
  if (id === "edit-lesson"){
    const cid = curCourse(), l = teacherCourse(cid).lessons.find(x => x.id === T.open), m = T.mats.find(x => x.id === l.mid);
    const theory = $("#el-theory").value.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean).map(b => { const [h, ...rest] = b.split("\n"); return {h: h.trim(), t: rest.join("\n").trim()}; });
    const data = {...m.data, title: $("#el-title").value.trim(), date: $("#el-date").value, theory, hw: $("#el-hw").value.trim(), learn: [$("#el-title").value.trim()]};
    const {error} = await sb.from("materials").update({data, title: data.title}).eq("id", m.id);
    if (error){ toast("Не сохранилось: " + error.message); return; }
    m.data = data; m.title = data.title; T.sub = "theory"; render(); toast("Урок сохранён");
  }
  if (id === "add-mat"){
    const cid = curCourse(), kind = $("#am-kind").value, title = $("#am-title").value.trim();
    let url = $("#am-url").value.trim(), body = $("#am-body").value.trim();
    if (kind === "file"){
      const f = $("#am-file").files[0]; if (!f){ toast("Выберите файл."); return; }
      if (f.size > 20e6){ toast("Файл больше 20 МБ."); return; }
      const path = `${T.session.user.id}/${cid}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
      const up = await sb.storage.from("materials").upload(path, f, {contentType: f.type || undefined});
      if (up.error){ toast("Файл не загрузился: " + up.error.message); return; }
      url = sb.storage.from("materials").getPublicUrl(path).data.publicUrl;
    }
    if (kind === "link" && !url){ toast("Вставьте ссылку."); return; }
    if (kind === "text" && !body){ toast("Напишите текст."); return; }
    const {data, error} = await sb.from("materials").insert({course: cid, lesson_id: T.open, kind, title: title || null, url: url || null, body: body || null}).select().single();
    if (error){ toast("Не сохранилось: " + error.message); return; }
    T.mats.push(data); render(); toast("Материал добавлен в папку");
  }
});
document.addEventListener("change", async e => {
  if (e.target.id === "course-pick"){ T.courseId = e.target.value; render(); return; }
  if (e.target.id === "am-kind"){ document.querySelectorAll("#add-mat [data-k]").forEach(el => el.hidden = !el.dataset.k.split(" ").includes(e.target.value)); return; }
  if (e.target.dataset.date){
    const s = T.students.find(x => x.id === T.sel), dates = {...(s.dates || {}), [e.target.dataset.date]: e.target.value};
    if (!e.target.value) delete dates[e.target.dataset.date];
    if (await upd(s.id, {dates})){ render(); toast("Дата урока изменена"); }
  }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && T.drawer){ T.drawer = false; render(); } });
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-view],[data-student],[data-lesson],[data-sub],[data-review],[data-wreview],[data-boardfor],[data-unlock],[data-grade],[data-act],[data-delmat],[data-theme-pick]"); if (!t) return;
  if (t.tagName === "A") e.preventDefault();
  if (t.dataset.themePick){
    const set = k => { try{ localStorage.setItem("oge-theme-t", k); }catch(_){} U.applyTheme(k); if (sb && T.session) sb.rpc("teacher_set_theme", {p_theme: k}).then(() => {}, () => {}); render(); };
    t.dataset.themePick === "photo" ? U.pickPhoto(() => set("photo")) : set(t.dataset.themePick); return;
  }
  if (t.dataset.view){ T.view = t.dataset.view; if (t.dataset.grade) T.grade = t.dataset.grade; T.confirmDel = null; T.drawer = false; T.justInvited = null; render(); scrollTo(0,0); return; }
  if (t.dataset.grade){ T.grade = t.dataset.grade; render(); return; }
  if (t.dataset.student){ T.sel = t.dataset.student; T.view = "student"; T.review = t.dataset.review || null; T.wreview = t.dataset.wreview || null; T.drawer = false; render(); if (!T.review && !T.wreview) scrollTo(0,0); return; }
  if (t.dataset.lesson){ T.open = t.dataset.lesson; T.view = "lesson"; T.sub = "method"; T.gen = null; render(); scrollTo(0,0); return; }
  if (t.dataset.sub){ T.sub = t.dataset.sub; render(); return; }
  if (t.dataset.boardfor){ T.boardLesson = t.dataset.boardfor; T.view = "board"; render(); scrollTo(0,0); return; }
  if (t.dataset.delmat){
    if (!t.dataset.sure){ t.dataset.sure = "1"; t.textContent = "Точно удалить?"; return; }
    const {error} = await sb.from("materials").delete().eq("id", +t.dataset.delmat);
    if (error){ toast("Не удалось: " + error.message); return; }
    T.mats = T.mats.filter(m => m.id !== +t.dataset.delmat); render(); return;
  }
  if (t.dataset.unlock){
    const s = T.students.find(x => x.id === T.sel), set = new Set(s.unlocked || []);
    t.dataset.on === "1" ? set.add(t.dataset.unlock) : set.delete(t.dataset.unlock);
    if (await upd(s.id, {unlocked: [...set]})){ render(); toast(t.dataset.on === "1" ? "Урок открыт для ученика" : "Урок снова закрыт до дня занятия"); }
    return;
  }
  if (t.dataset.review && !t.dataset.act){ T.review = T.review === t.dataset.review ? null : t.dataset.review; T.wreview = null; render(); return; }
  if (t.dataset.wreview && !t.dataset.act){ T.wreview = T.wreview === t.dataset.wreview ? null : t.dataset.wreview; T.review = null; render(); return; }
  const a = t.dataset.act;
  if (a === "open-drawer"){ T.drawer = true; render(); }
  if (a === "close-drawer"){ T.drawer = false; render(); }
  if (a === "reload") loadAll();
  if (a === "logout"){ await sb.auth.signOut(); T.session = null; T.me = null; render(); }
  if (a === "copy"){ const inp = $("#ilink"); try{ await navigator.clipboard.writeText(inp.value); toast("Ссылка скопирована"); }catch(_){ inp.select(); toast("Выделено – скопируйте вручную"); } }
  if (a === "new-invite"){
    const {data, error} = await sb.rpc("teacher_new_invite", {p_student: T.sel});
    if (error){ toast("Не получилось: " + error.message); return; }
    T.students.find(x => x.id === T.sel).invite_token = data; render(); toast("Новая ссылка готова. Старый вход ученика отключён.");
  }
  if (a === "save-pair"){
    const v = $("#pair-pick").value || null, s = T.students.find(x => x.id === T.sel);
    const {error} = await sb.rpc("teacher_set_pair", {p_a: s.id, p_b: v});
    if (error){ toast("Не получилось: " + error.message); return; }
    T.students.forEach(x => { if (x.id === s.id || x.pair_id === s.id || x.id === v || x.pair_id === v) x.pair_id = null; });
    if (v){ s.pair_id = v; T.students.find(x => x.id === v).pair_id = s.id; }
    render(); toast(v ? "Пара сохранена: доска на уроках общая" : "Ученик занимается один");
  }
  if (a === "shift"){
    const s = T.students.find(x => x.id === T.sel), c = U.courseFor(s, T.mats), dates = {...(s.dates || {})}, now = U.iso(new Date());
    c.lessons.filter(l => l.date >= now).forEach(l => dates[l.id] = U.iso(new Date(new Date(l.date + "T00:00:00").getTime() + 7 * 864e5)));
    if (await upd(s.id, {dates})){ render(); toast("Будущие уроки перенесены на неделю"); }
  }
  if (a === "review"){
    const row = {student_id: T.sel, lesson_id: T.review, status: t.dataset.st, grade: $("#rv-grade").value.trim(), comment: $("#rv-comment").value.trim(), reviewed_at: new Date().toISOString()};
    const {error} = await sb.from("homework").upsert(row, {onConflict: "student_id,lesson_id"});
    if (error){ toast("Не сохранилось: " + error.message); return; }
    const i = T.hw.findIndex(h => h.student_id === row.student_id && h.lesson_id === row.lesson_id);
    if (i >= 0) T.hw[i] = {...T.hw[i], ...row}; else T.hw.push(row);
    T.review = null; render(); toast(row.status === "accepted" ? "ДЗ принято" : "Отправлено на доработку");
  }
  if (a === "ai-check"){
    const s = T.students.find(x => x.id === T.sel), c = U.courseFor(s, T.mats), l = c.lessons.find(x => x.id === T.wreview), w = T.writings.find(x => x.student_id === s.id && x.lesson_id === l.id);
    const src = l.writing ? U.writingSource(c, l, w.kind) : {};
    const srcText = l.writing ? (l.writing.type === "izl" ? c.izl[l.writing.text].paras.join("\n") : c.texts[l.writing.text].text) : "";
    T.busy = "check"; render();
    const r = await ai({action: "check_essay", student_id: s.id, lesson_id: l.id, topic: src.topic, source: srcText});
    T.busy = false; T.ai[s.id + l.id] = r; if (!r.error) w.ai = r; render();
  }
  if (a === "ai-apply"){
    const w = T.writings.find(x => x.student_id === T.sel && x.lesson_id === T.wreview), r = T.ai[T.sel + T.wreview] || w.ai;
    Object.entries(r.scores || {}).forEach(([k, v]) => { const el = document.querySelector(`[data-crit="${k}"]`); if (el) el.value = String(v); });
    Object.entries(r.errors || {}).forEach(([k, v]) => { const el = document.querySelector(`[data-err="${k}"]`); if (el) el.value = String(v); });
    if (r.comment && !$("#w-comment").value.trim()) $("#w-comment").value = r.comment;
    toast("Баллы подставлены – проверьте и сохраните");
  }
  if (a === "ai-analyze"){
    const s = T.students.find(x => x.id === T.sel), x = sData(s), et = window.ENTRY_TESTS?.[String(s.grade)];
    const entryWeak = x.entry ? [...new Set(x.entry.last.wrong || [])] : [];
    T.busy = "analyze"; render();
    const r = await ai({action: "analyze_student", student_id: s.id, entry_weak: entryWeak,
      lessons: (x.c?.lessons || []).map(l => ({id: l.id, date: l.date, title: l.title, раздел: l.oge, выполнено: x.done(l), минут: Math.round((x.time[l.id] || 0) / 60)}))});
    T.busy = false;
    T.reports.unshift({student_id: s.id, kind: "analysis", body: r, created_at: new Date().toISOString()}); render();
  }
  if (a === "ai-addlesson"){
    const s = T.students.find(x => x.id === T.sel), rep = T.reports.find(r => r.student_id === s.id && r.kind === "analysis"), p = rep.body.plan[+t.dataset.k];
    const c = U.courseFor(s, T.mats), next = c.lessons.find(l => l.date >= U.iso(new Date()));
    const date = next ? next.date : U.iso(new Date(Date.now() + 7 * 864e5));
    const lid = "c" + U.randHex(4);
    const row = {course: s.course, lesson_id: lid, student_id: s.id, kind: "lesson", title: p.title,
      data: {title: p.title, date, oge: "Повторение", learn: [p.title], theory: [{h: "Зачем этот урок", t: p.why}, ...(p.tasks?.length ? [{h: "План урока", list: p.tasks}] : [])], hw: ""}};
    const {data, error} = await sb.from("materials").insert(row).select().single();
    if (error){ toast("Не сохранилось: " + error.message); return; }
    T.mats.push(data); t.disabled = true; render(); toast(`Урок «${p.title}» добавлен на ${fmt(date)} – дату можно поменять в таблице`);
  }
  if (a === "ai-gen"){
    const l = teacherCourse(curCourse()).lessons.find(x => x.id === T.open);
    T.gen = {lesson: l.id, topic: $("#ag-topic").value.trim() || l.title, notes: $("#ag-notes").value.trim(), count: +$("#ag-count").value};
    T.busy = "gen"; render();
    const c = COURSES[curCourse()];
    T.gen.res = await ai({action: "generate_tasks", topic: T.gen.topic, notes: T.gen.notes, count: T.gen.count, grade: c.grade, exam: c.goal === "ОГЭ" || c.goal === "ЕГЭ" ? c.goal : ""});
    T.busy = false; render();
  }
  if (a === "ai-save"){
    const g = T.gen, mini = (g.res.mini || []).filter(m => m.q && m.a), test = (g.res.test || []).filter(q => q.q && q.o?.length >= 2 && q.o[q.a] != null);
    const {data, error} = await sb.from("materials").insert({course: curCourse(), lesson_id: g.lesson, kind: "tasks", title: g.res.title || g.topic, data: {mini, test}}).select().single();
    if (error){ toast("Не сохранилось: " + error.message); return; }
    T.mats.push(data); T.gen = null; render(); toast("Задания сохранены: мини-практика – в «Материалах», вопросы – в тесте урока");
  }
  if (a === "del-lesson"){
    if (!t.dataset.sure){ t.dataset.sure = "1"; t.textContent = "Точно удалить урок?"; return; }
    const l = teacherCourse(curCourse()).lessons.find(x => x.id === T.open);
    const {error} = await sb.from("materials").delete().eq("id", l.mid);
    if (error){ toast("Не удалось: " + error.message); return; }
    T.mats = T.mats.filter(m => m.id !== l.mid); T.view = "course"; render(); toast("Урок удалён");
  }
  if (a === "dl-sheet" || a === "dl-keys"){
    const cid = curCourse(), l = teacherCourse(cid).lessons.find(x => x.id === T.open), keys = (window.COURSE_KEYS?.[cid] || {})[l.id] || [];
    if (a === "dl-sheet") U.downloadDoc(`${l.title} – рабочий лист`, U.lessonDocHTML(l, false));
    else U.downloadDoc(`${l.title} – ключи`, `<h1>${esc(l.title)} – ключи</h1>${U.practiceHTML({...l, practice: l.practice.map((p, k) => ({...p, key: keys[k]}))}, true)}`);
  }
  if (a === "wsave"){
    const s = T.students.find(x => x.id === T.sel), c = U.courseFor(s, T.mats);
    const w = T.writings.find(x => x.student_id === T.sel && x.lesson_id === T.wreview), crit = U.critFor(c, w.kind) || [];
    const scores = {}; crit.forEach(([k]) => scores[k] = +document.querySelector(`[data-crit="${k}"]`).value);
    const errors = {}; c.criteria.errors.forEach(([k]) => { const v = document.querySelector(`[data-err="${k}"]`).value.trim(); if (v !== "") errors[k] = +v || 0; });
    const row = {status: t.dataset.st, scores, errors, comment: $("#w-comment").value.trim(), reviewed_at: new Date().toISOString(),
                 total: crit.length ? Object.values(scores).reduce((x,y) => x+y, 0) : null, max: crit.length ? crit.reduce((x,[,,m]) => x+m, 0) : null};
    const {error} = await sb.from("writings").update(row).eq("student_id", T.sel).eq("lesson_id", T.wreview);
    if (error){ toast("Не сохранилось: " + error.message); return; }
    Object.assign(w, row); T.wreview = null; render(); toast(row.status === "redo" ? "Работа возвращена на доработку" : "Оценка сохранена – ученик её видит");
  }
  if (a === "save-sheet"){
    const cid = curCourse();
    const row = {teacher_id: T.session.user.id, course: cid, lesson_id: T.open, name: $("#sh-name").value.trim(), url: $("#sh-url").value.trim(), note: $("#sh-note").value.trim()};
    const {error} = await sb.from("sheets").upsert(row, {onConflict: "teacher_id,course,lesson_id"});
    if (error){ toast("Не сохранилось: " + error.message); return; }
    T.sheets = T.sheets.filter(x => !(x.course === cid && x.lesson_id === T.open)).concat(row); render(); toast("Рабочий лист прикреплён");
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
  try{ const th = localStorage.getItem("oge-theme-t"); if (th) U.applyTheme(th); }catch(_){}
  render();
  if (!sb) return;
  const {data} = await sb.auth.getSession();
  T.session = data.session;
  sb.auth.onAuthStateChange((_e, s) => { T.session = s; });
  if (T.session) await loadAll(); else render();
})();
})();
