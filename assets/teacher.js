/* Кабинет учителя: ученики 5–11 классов, приглашения, входные тесты, планы и даты, пары,
   проверка работ (с черновой оценкой нейросети), своя база материалов, доска */
(() => {
const {esc, d, today, fmt, fmtShort, pct, lvl, lvlColor, toast} = U;
const CFG = window.APP_CONFIG || {};
const RECOVERY = /type=recovery/.test(location.hash), LINK_ERR = /error_description=/.test(location.hash) ? decodeURIComponent((location.hash.match(/error_description=([^&]+)/) || [])[1] || "").replace(/\+/g, " ") : "";
const sb = U.supa();
const T = {subject:"all", matSubject:null, addSubj:"rus", session:null, me:null, view:"students", grade:"all", sel:null, open:null, sub:"method", review:null, wreview:null,
           students:[], rows:[], hw:[], writings:[], sheets:[], mats:[], act:[], reports:[], ai:{},
           online:{}, feed:[], live:null, loading:false, confirmDel:null, courseId:null, board:null, boardLesson:null, drawer:false, justInvited:null, gen:null, busy:false, lastShow:null,
           qzQuizzes:[], qzResults:[], qzSel:null, qzSelSid:null, qzCount:3, qzBusy:false, qzDraft:null, qzSaved:null};
const $ = s => document.querySelector(s);
const GRADES = [0,1,2,3,4,5,6,7,8,9,10,11];
const ST_COLS = "id,teacher_id,name,course,code,note,created_at,grade,goal,goals,contact,invite_token,registered_at,start_date,dates,unlocked,pair_id,theme,subject,person_id,call_url,covered,covered_manual,school,avatar";
const inviteLink = tok => `${location.origin}${location.pathname.replace(/teacher\.html$/, "")}?invite=${tok}`;
const blockOf = (c, l) => c.blocks[l.block] || {name:"Свои уроки", color:U.ownColor()};
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
const access = cid => { const c = U.getCourse(cid); return !c || !c.locked; };
const curCourse = () => T.courseId || CFG.DEFAULT_COURSE || "oge-rus";
const FREE = {id:"free", title:"Личная доска", free:true, theory:[], practice:[], materials:[], learn:[]};
const subjOfS = s => s.subject || U.subjectOf(s.course);
const siblings = s => T.students.filter(o => (o.person_id || o.id) === (s.person_id || s.id));
/* курс в разделе «Материалы»: встроенный + свои уроки учителя (общие для всех учеников) */
const teacherCourse = cid => U.courseFor({course: cid}, T.mats);

async function loadAll(){
  if (!sb || !T.session) return;
  T.loading = true; render();
  const me = await sb.rpc("me"); T.me = me.data || {base_access: []};
  if (me.error) toast(/does not exist|function/i.test(me.error.message) ? "База ещё не настроена: выполните supabase/schema.sql в Supabase." : U.authErr(me.error));
  T.loaded = new Set();
  if (T.me.theme && !localStorage.getItem("oge-theme-t")) U.applyTheme(T.me.theme);
  const [st, rs, hw, wr, sh, mt, ac, ar, wk, qz, qr] = await Promise.all([
    sb.from("students").select(ST_COLS).order("created_at"),
    sb.from("results").select("*").order("created_at"),
    sb.from("homework").select("*"), sb.from("writings").select("*"), sb.from("sheets").select("*"),
    sb.from("materials").select("*").order("id"), sb.from("activity").select("*"),
    sb.from("ai_reports").select("*").order("created_at", {ascending: false}).limit(200), sb.from("works").select("*"),
    sb.from("topic_quizzes").select("*").order("created_at", {ascending: false}),
    sb.from("topic_quiz_results").select("*").order("created_at", {ascending: false})
  ]);
  const err = [st, rs, hw, wr, sh, mt, ac, ar].find(x => x.error)?.error;
  if (err) toast("Ошибка загрузки: " + err.message + ". Выполните заново supabase/schema.sql.");
  T.students = st.data || []; T.rows = rs.data || []; T.hw = hw.data || []; T.writings = wr.data || []; T.sheets = sh.data || [];
  T.mats = mt.data || []; T.act = ac.data || []; T.reports = ar.data || []; T.works = wk.data || [];
  T.qzQuizzes = qz.data || []; T.qzResults = qr.data || [];
  await ensureCourses([...new Set([...T.students.map(x => x.course), curCourse()])]);
  T.loading = false; render(); onlineNow(); paintOnline();
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
function courseOptions(g, subject){
  const keys = U.coursesOf(subject || "rus"), fit = k => { const c = U.getCourse(k); return c.grade === g || (c.grades || []).includes(g); };
  return [...keys.filter(fit), ...keys.filter(k => !fit(k))].map(k => [k, U.getCourse(k).course + (access(k) ? "" : " – база не открыта"), access(k), fit(k)]);
}
const goalOpts = (subj, g) => `<option value="">– пусть выберет ученик –</option>` + U.goalsFor(subj, g).map(x => `<option value="${esc(x)}">${esc(U.goalLabel(x))}</option>`).join("");
const mins = sec => sec ? Math.max(1, Math.round(sec / 60)) + " мин" : "–";

/* ---------- экраны ---------- */
function viewNoServer(){
  return `<div class="card stack"><h2>Сервер ещё не подключён</h2>
    <p>Кабинет работает через Supabase: там хранятся ученики, тесты, сочинения, домашки и доска. Вставьте адрес проекта и ключ <b>anon</b> в файл <b>config.js</b> – пошагово в README.</p>
    <p class="muted small">Материалы курса и методика доступны и без сервера.</p>
    <div class="row"><button class="btn" data-view="course">Материалы курса</button><button class="btn ghost" data-view="methodology">Методика курса</button></div></div>`;
}
/* код разработчика прямо в кабинете: проверяет сервер, вводится один раз */
function viewDevCode(){
  if (T.me?.role === "developer") return `<div class="card login stack"><h2>Вы разработчик</h2><p>Ключи нейросети, тарифы, оплата, встроенная база и учителя – в кабинете разработчика.</p><div><a class="btn" href="dev.html">Открыть кабинет разработчика</a></div></div>`;
  return `<form class="card login stack" id="devcode-form" autocomplete="off"><h2>Режим разработчика</h2>
    <p class="small">Кабинет: <b>${esc(T.me?.email || T.session?.user?.email || "")}</b></p>
    <label for="dc-code">Код разработчика <span class="small muted">(не пароль от кабинета)</span></label>
    ${U.pass("dc-code", 'required autocomplete="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true"')}
    <p class="small muted">Код вводится один раз: после этого кабинет навсегда получает права разработчика.</p>
    <button class="btn" type="submit">Войти в режим разработчика</button><p class="formmsg bad" id="dc-err" role="status"></p></form>`;
}
function viewNewPass(){
  return `<form class="card login stack" id="newpass-form"><h2>Новый пароль</h2>
    <p class="small muted">Придумайте новый пароль для кабинета${T.session?.user?.email ? " " + esc(T.session.user.email) : ""}.</p>
    <label for="np-pass">Новый пароль (не меньше 8 знаков)</label>${U.pass("np-pass", 'minlength="8" autocomplete="new-password" required')}
    <button class="btn" type="submit">Сохранить пароль</button><p class="formmsg bad" id="np-err" hidden></p></form>`;
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
  const list = T.students.filter(s => (T.subject === "all" || subjOfS(s) === T.subject) && (T.grade === "all" || String(s.grade) === T.grade || (T.grade === "new" && pending(s))));
  const usedSubj = U.SUBJECTS.filter(x => T.students.some(s => subjOfS(s) === x.k));
  const wait = T.writings.filter(w => w.status === "sent").length + T.hw.filter(h => h.status === "sent").length;
  const nameOf = id => T.students.find(x => x.id === id);
  return `<section class="hero glass" style="min-height:150px"><span class="mono muted">Кабинет учителя</span>
      <h1>Ученики</h1><p>${T.students.length} учеников · на проверку: ${wait}</p><div id="online-count" style="margin-top:6px"></div><img class="cat" data-m src="${U.mascot()}" alt=""></section>
    ${usedSubj.length > 1 ? `<div class="filters" role="group" aria-label="Предмет" style="margin-top:22px">${[["all","Все предметы",""], ...usedSubj.map(x => [x.k, x.n, x.e])].map(([k,n,e]) => `<button data-subjf="${k}" aria-pressed="${T.subject===k}">${e} ${esc(n)}</button>`).join("")}</div>` : ""}
    <div class="section-title"><div class="filters" role="group" aria-label="Класс">${[["all","Все классы"],...GRADES.map(g => [String(g), g === 0 ? "дошк." : g + " кл."]),["new","Ждут регистрации"]].map(([k,n]) => `<button data-grade="${k}" aria-pressed="${T.grade===k}">${n}</button>`).join("")}</div>
      <button class="btn ghost sm" data-act="reload">Обновить</button></div>
    ${T.loading ? `<p class="muted">Загружаю…</p>` : ""}
    <div class="grid2">${list.map(s => { const x = sData(s), avg = x.c ? U.avgAll(x.c, x.results) : null, p = s.pair_id && nameOf(s.pair_id);
      return `<button class="card" data-student="${s.id}" style="text-align:left">
        <div class="row between"><h2>${esc(pending(s) ? "Ожидает регистрации" : s.name)}</h2>${x.waiting ? `<span class="chip mid">проверить: ${x.waiting}</span>` : ""}</div>
        ${!pending(s) ? `<div class="row" style="gap:8px;margin:6px 0"><span class="btn sm" role="button" tabindex="0" data-act="start-lesson" data-id="${s.id}">▶ Начать занятие</span>${(() => { const nx = x.c?.lessons.find(l => l.date >= U.iso(new Date()) && !s.covered?.[l.id]); return nx ? `<span class="small muted">следующий: ${U.fmt(nx.date, {day: "numeric", month: "short"})}${U.lessonTime(s, nx) ? " в " + esc(U.lessonTime(s, nx)) : ""}</span>` : ""; })()}</div>` : ""}
        <div data-online="${s.id}"></div>
        <p class="small" style="margin-top:4px"><b>${U.subj(subjOfS(s)).e} ${esc(U.subj(subjOfS(s)).n)}</b></p>
        <p class="small muted">${s.grade != null ? U.gradeName(s.grade) : "класс не указан"}${s.goal ? " · " + esc(U.goalLabel(s.goal)) : ""}${s.school ? " · " + esc(s.school) : ""} · логин ${esc(s.code)}</p>
        ${p ? `<p class="small" style="margin-top:4px">👥 в паре с ${esc(p.name)}</p>` : ""}
        <div class="row" style="margin-top:10px;gap:20px">
          <div><div class="big tnum" style="font-size:1.5rem;color:${x.entry ? lvlColor(pct(x.entry.last)) : "inherit"}">${x.entry ? pct(x.entry.last) + "%" : "–"}</div><div class="small muted">входной тест</div></div>
          <div><div class="big tnum" style="font-size:1.5rem;color:${avg!=null ? lvlColor(avg) : "inherit"}">${avg ?? "–"}${avg!=null?"%":""}</div><div class="small muted">тесты уроков</div></div>
        </div>
        <p class="small muted" style="margin-top:8px">${pending(s) ? "Ссылка отправлена, ученик ещё не зарегистрировался" : !x.c ? "План ещё не выбран" : x.last ? "Активность: " + new Date(x.last).toLocaleString("ru-RU",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}) : "Активности пока нет"}</p>
      </button>`; }).join("") || (T.loading ? "" : `<div class="card"><p class="muted">Здесь пока никого нет.</p></div>`)}</div>

    <div class="section-title"><h2>Добавить ученика</h2></div>
    <form class="card stack" id="add-student" style="gap:8px">
      <p class="small muted">Выберите предмет – создастся одноразовая ссылка. Ученик заполнит анкету, выберет цели – план по предмету выстроится автоматически, материалы предмета откроются сразу. Если ученик уже есть, второй предмет добавляется в его карточке – вход останется тем же.</p>
      <label for="ns-name">Как вы его называете (для себя, необязательно)</label><input type="text" id="ns-name" placeholder="Например, Артём, 9А">
      <label for="ns-subj">Предмет</label><select id="ns-subj">${U.SUBJECTS.map(x => `<option value="${x.k}" ${x.k===T.addSubj?"selected":""}>${x.e} ${esc(x.n)}</option>`).join("")}</select>
      <label for="ns-grade">Класс</label><select id="ns-grade">${U.subj(T.addSubj).g.map(g => `<option value="${g}" ${g===9?"selected":""}>${U.gradeName(g)}</option>`).join("")}</select>
      <label for="ns-goal">Подготовка</label><select id="ns-goal">${goalOpts(T.addSubj, 9)}</select>
      <p class="small muted">Если выбрать подготовку, ученик не будет выбирать её сам: класс и план настроятся как здесь.</p>
      <div><button class="btn" type="submit">Создать ссылку-приглашение</button></div>
    </form>
    ${T.justInvited ? inviteBox(T.justInvited) : ""}
    ${T.me?.join_code ? `<div class="card stack" style="gap:8px;margin-top:14px"><div class="kicker">Ученики могут зарегистрироваться сами</div>
      <p>Ваш код для учеников: <b class="tnum" style="font-size:1.3rem;letter-spacing:.08em">${esc(T.me.join_code)}</b></p>
      <div class="linkbox"><input type="text" id="jlink" readonly value="${esc(U.siteURL("?t=" + T.me.join_code))}"><button class="btn sm" data-act="copy-join">Копировать ссылку</button></div>
      <p class="small muted">Ученик открывает ссылку (или на главной: «Я ученик» → «Зарегистрироваться» и вводит код), выбирает предмет, класс и цели – и сразу появляется у вас в списке. Ссылка многоразовая.</p></div>` : ""}

    <div class="section-title"><h2>Ждут проверки</h2></div>
    <div class="card">${(() => {
      const items = [...T.writings.filter(w => w.status === "sent").map(w => ({w, s:nameOf(w.student_id)})), ...T.hw.filter(h => h.status === "sent").map(h => ({h, s:nameOf(h.student_id)}))].filter(x => x.s);
      if (!items.length) return '<p class="muted">Всё проверено.</p>';
      return `<ul style="margin:0;padding-left:20px">${items.map(x => { const c = U.courseFor(x.s, T.mats), lid = (x.w || x.h).lesson_id, l = U.findLesson(c, lid); if (!l) return "";
        return x.w ? `<li><a href="#" data-student="${x.s.id}" data-wreview="${l.id}">${esc(x.s.name)} – ${esc(U.KIND_NAME[x.w.kind] || "письмо")}: ${esc(l.title)}</a> <span class="small muted">${x.w.words || 0} сл.${x.w.photos?.length ? " · фото: " + x.w.photos.length : ""}</span></li>`
                   : `<li><a href="#" data-student="${x.s.id}" data-review="${l.id}">${esc(x.s.name)} – ДЗ: ${esc(l.title)}</a></li>`; }).join("")}</ul>`; })()}</div>`;
}

/* тренажёр изложений у учителя: тексты, что ученик слушал и написал, выбор текста на уроке, свои записи */
function labPaneT(s, c, room){
  const L = c.labLessons || [], x = sData(s), cur = T.labPick?.[s.id];
  const n = id => T.rows.filter(r => r.student_id === s.id && r.lesson_id === id + ":l").length;
  const row = l => { const w = x.writings[l.id], t = c.izl[l.labKey];
    return `<li class="lab-row ${cur === l.id ? "on" : ""}"><div class="row between" style="gap:8px;flex-wrap:wrap"><span style="min-width:0"><b>${esc(l.title)}</b> <span class="small muted">${t.audio ? "🎙 запись" : "озвучка"}${t.author ? " · " + esc(t.author) : ""}</span></span>
      <span class="row" style="gap:4px;flex-wrap:wrap">${n(l.id) ? `<span class="chip">🎧 ${n(l.id)}</span>` : ""}${w ? (w.max ? `<span class="chip ${U.lvl(Math.round(w.total / w.max * 100))}">✍ ${w.total}/${w.max}</span>` : `<span class="chip mid">✍ ${w.status === "redo" ? "на доработке" : "ждёт проверки"}</span>`) : ""}
      ${room ? `<button class="btn ${cur === l.id ? "" : "ghost"} sm" data-act="lab-pick" data-id="${l.id}" data-sid="${s.id}">${cur === l.id ? "✓ Работаем" : "Работаем с этим"}</button>` : ""}
      ${w ? `<button class="btn ghost sm" data-act="lab-review" data-id="${l.id}" data-sid="${s.id}">${T.wreview === l.id ? "Скрыть" : "Проверить"}</button>` : ""}
      ${t.mid && t.mine ? `<button class="iconbtn" data-act="lab-del" data-mid="${t.mid}" aria-label="Удалить текст">🗑</button>` : ""}</span></div>
      ${t.audio && room ? `<audio controls preload="none" src="${esc(t.audio)}" style="width:100%;margin-top:6px"></audio>` : ""}
      ${T.wreview === l.id && T.sel === s.id ? writingReviewHTML(s, x, l) : ""}</li>`; };
  return `<p class="small muted" style="margin-bottom:8px">${room ? "Нажмите «Работаем с этим» – текст сразу откроется у ученика. " : ""}🎧 – сколько раз ученик слушал текст, ✍ – изложение и баллы.</p>
    <ol class="lab-rows">${L.map(row).join("")}</ol>
    <details class="card" style="box-shadow:none;margin-top:12px"${T.labAddOpen ? " open" : ""}><summary><b>➕ Добавить текст с аудиозаписью</b></summary>
      <div class="stack" style="gap:6px;margin-top:8px">
        <p class="small muted">Например, запись из открытого банка ФИПИ: скачайте mp3 и загрузите сюда. Записи видят только ваши ученики.</p>
        <label class="small" for="lb-title">Название</label><input id="lb-title" maxlength="120" placeholder="Например: «О дружбе» (банк ФИПИ)">
        <label class="small" for="lb-author">Автор или источник</label><input id="lb-author" maxlength="160" placeholder="Например: открытый банк ФИПИ, автор текста">
        <label class="small" for="lb-file">Аудиофайл (mp3, m4a)</label><input id="lb-file" type="file" accept="audio/*">
        <label class="small" for="lb-url">…или ссылка на аудио</label><input id="lb-url" type="url" placeholder="https://…mp3">
        <label class="small" for="lb-text">Текст (по желанию; абзацы – через пустую строку). Нужен нейросети для проверки, ученику не показывается</label><textarea id="lb-text" rows="5"></textarea>
        <label class="small" for="lb-micro">Микротемы (каждая с новой строки, по желанию)</label><textarea id="lb-micro" rows="3"></textarea>
        <div><button class="btn sm" data-act="lab-add" data-course="${esc(s.course)}" data-lid="${esc(c.lessons.find(l => l.lab === "izl")?.id || "")}" ${T.busy === "lab" ? "disabled" : ""}>${T.busy === "lab" ? "Загружаю…" : "Добавить текст"}</button></div></div></details>`;
}
async function labAct(a, t){
  if (a === "lab-pick"){ const sid = t.dataset.sid, s = T.students.find(x => x.id === sid), c = U.courseFor(s, T.mats), l = c.labLessons.find(x => x.id === t.dataset.id);
    (T.labPick = T.labPick || {})[sid] = l.id; [sid, s.pair_id].filter(Boolean).forEach(id => cmd(id, "izlpick", {key: l.id, title: l.title})); render(); toast(`У ученика открыт текст «${l.title}»`); return; }
  if (a === "lab-review"){ T.sel = t.dataset.sid; T.wreview = T.wreview === t.dataset.id ? null : t.dataset.id; render(); return; }
  if (a === "lab-del"){ if (!t.dataset.sure){ t.dataset.sure = "1"; t.textContent = "✔?"; return; }
    const {error} = await sb.from("materials").delete().eq("id", +t.dataset.mid); if (error){ toast("Не удалилось: " + error.message); return; }
    T.mats = T.mats.filter(m => m.id !== +t.dataset.mid); render(); cmd("all", "refresh", {msg: "Учитель обновил тексты для изложения"}); return; }
  if (a === "lab-add"){
    const title = $("#lb-title").value.trim(), author = $("#lb-author").value.trim(), f = $("#lb-file").files[0]; let audio = $("#lb-url").value.trim();
    const paras = $("#lb-text").value.split(/\n\s*\n/).map(x => x.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 8), micro = $("#lb-micro").value.split("\n").map(x => x.trim()).filter(Boolean).slice(0, 6);
    if (!title){ toast("Напишите название текста"); return; }
    if (!f && !/^https?:\/\//.test(audio)){ toast("Загрузите аудиофайл или вставьте ссылку на запись"); return; }
    if (f && f.size > 40 * 1024 * 1024){ toast("Файл больше 40 МБ"); return; }
    T.busy = "lab"; T.labAddOpen = true; render();
    if (f){ const path = `${T.session.user.id}/izl-${Date.now()}.${(f.name.split(".").pop() || "mp3").toLowerCase().replace(/[^a-z0-9]/g, "")}`;
      const up = await sb.storage.from("materials").upload(path, f, {contentType: f.type || "audio/mpeg"});
      if (up.error){ T.busy = false; render(); toast("Файл не загрузился: " + up.error.message); return; }
      audio = sb.storage.from("materials").getPublicUrl(path).data.publicUrl; }
    const {data, error} = await sb.from("materials").insert({course: t.dataset.course, lesson_id: t.dataset.lid, kind: "tasks", title, shared: false, data: {kind: "izl-text", title, author, audio, paras, micro}}).select().single();
    T.busy = false;
    if (error){ render(); toast("Не сохранилось: " + error.message); return; }
    T.mats.push(data); T.labAddOpen = false; render(); cmd("all", "refresh", {msg: "Учитель добавил текст для изложения"}); toast("Текст добавлен в тренажёр"); return;
  }
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
    ${w.photos?.length ? `<div class="row">${w.photos.map((u, k) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Страница ${k+1}" style="width:120px;height:160px;object-fit:cover;border-radius:12px;border:1px solid var(--line)"></a>`).join("")}</div>
      <div class="row" style="gap:6px"><button class="btn ${w.body ? "ghost" : ""} sm" data-act="ocr-ai" ${T.busy ? "disabled" : ""}>${T.busy === "ocr" ? "Распознаю…" : "📝 Распознать текст с фото (нейросеть)"}</button>
        <button class="btn ghost sm" data-act="ocr-local" ${T.busy ? "disabled" : ""}>${T.busy === "ocr-local" ? "Распознаю…" : "Распознать в браузере"}</button></div>
      <p class="small muted">Текст переписывается с сохранением ошибок ученика – потом его можно проверить нейросетью по критериям. Рукописный текст лучше читает нейросеть, распознавание в браузере подходит для печатного и очень разборчивого почерка.</p>` : ""}
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
    <label for="w-fix">Что доработать (каждый пункт с новой строки – ученик увидит списком)</label><textarea id="w-fix" placeholder="«дощечка» → «дощечка» – правописание суффиксов&#10;Нет пояснения ко второму примеру">${esc((w.scores?._fix || []).join("\n"))}</textarea>
    <div class="row"><button class="btn sm" data-act="wsave" data-st="reviewed">Сохранить оценку</button><button class="btn ghost sm" data-act="wsave" data-st="redo">Вернуть на доработку</button></div></div>`;
}

/* журнал самообучения ученика и отработки ОГЭ: режим, урок, результат, ошибки */
const SELF_NAMES = {trainer:"Тренажёр урока", tf:"Верно или неверно", cards:"Карточки-запоминалки", quiz:"Тест для самопроверки", games:"Игры по уроку", mix:"Повторение всего", stress:"Ударения", spell:"Вставь букву", game:"Игра от учителя"};
function selfLogHTML(s, c){
  const rows = T.rows.filter(r => r.student_id === s.id && (r.kind === "self" || r.kind === "oge" || /^(self|oge):/.test(r.lesson_id || "")) && !/^oge:rate:/.test(r.lesson_id || "")).slice().reverse();
  if (!rows.length) return `<div class="card"><p class="muted">Ученик пока не занимался самостоятельно. Здесь появятся тренажёры, игры, отработка заданий ОГЭ – с результатом и ошибками.</p></div>`;
  const week = rows.filter(r => Date.now() - new Date(r.created_at) < 7 * 864e5), avg = a => a.length ? Math.round(a.reduce((p, r) => p + r.score / r.total * 100, 0) / a.length) : null;
  const title = lid => c?.lessons.find(l => l.id === lid)?.title || "";
  const nameOf = r => { const [k, m, lid] = String(r.lesson_id).split(":");
    if (k === "oge") return {n: m === "mock" ? "Пробный вариант ОГЭ" : "Отработка ОГЭ: задание " + m, t: ""};
    if (m?.startsWith("t-")) return {n: "Игра по теме", t: (window.PLAY_BANKS?.themes || []).find(x => x.id === m.slice(2))?.title || ""};
    if (m === "game") return {n: SELF_NAMES.game, t: (T.mats.find(x => String(x.id) === lid)?.title) || ""};
    return {n: SELF_NAMES[m] || m, t: title(lid)}; };
  const errs = {}; rows.forEach(r => (r.wrong || []).forEach(w => errs[w] = (errs[w] || 0) + 1));
  const top = Object.entries(errs).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return `<div class="grid2 stats"><div class="card"><div class="kicker">За 7 дней</div><div class="big tnum" style="margin-top:6px">${week.length}</div><div class="small muted">занятий, средний результат ${avg(week) ?? "–"}${avg(week) != null ? "%" : ""}</div></div>
    <div class="card"><div class="kicker">Всего</div><div class="big tnum" style="margin-top:6px">${rows.length}</div><div class="small muted">последнее: ${new Date(rows[0].created_at).toLocaleString("ru-RU", {day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"})}</div></div></div>
    ${top.length ? `<div class="card" style="margin-top:12px"><div class="kicker">Чаще всего ошибается</div><ul style="margin:6px 0 0;padding-left:18px">${top.map(([w, n]) => `<li>${esc(w)}${n > 1 ? ` <span class="small muted">×${n}</span>` : ""}</li>`).join("")}</ul></div>` : ""}
    <div class="tablewrap"><table><thead><tr><th>Когда</th><th>Что</th><th>Результат</th><th>Ошибки</th></tr></thead><tbody>
    ${rows.slice(0, 30).map(r => { const nm = nameOf(r), p = Math.round(r.score / r.total * 100);
      return `<tr><td class="small tnum" style="white-space:nowrap">${new Date(r.created_at).toLocaleString("ru-RU", {day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"})}</td><td><b>${esc(nm.n)}</b>${nm.t ? `<br><span class="small muted">${esc(nm.t)}</span>` : ""}</td>
        <td class="tnum" style="color:${U.lvlColor(p)};font-weight:800">${r.score}/${r.total}</td><td class="small">${(r.wrong || []).length ? `<details><summary>${r.wrong.length}</summary><ul style="margin:4px 0 0;padding-left:16px">${r.wrong.map(w => `<li>${esc(w)}</li>`).join("")}</ul></details>` : "–"}</td></tr>`; }).join("")}
    </tbody></table></div>`;
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

/* ---------- тест по темам: сборка из тестов уроков + нейросеть, ссылка ученику, карта ошибок ---------- */
const QZ_COUNTS = [2, 3, 5];
function qzState(s){
  if (T.qzSelSid !== s.id){
    T.qzSelSid = s.id; T.qzSel = new Set(); T.qzCount = 3; T.qzDraft = null; T.qzSaved = null; T.qzBusy = false;
  }
  if (!(T.qzSel instanceof Set)) T.qzSel = new Set(Array.isArray(T.qzSel) ? T.qzSel : []);
  return T;
}
const qzQuestions = l => { try { return window.Quiz ? Quiz.questionsFromTests(U.lessonTests(l).test, l.title, l.id) : []; } catch(_){ return []; } };
function qzResultsFor(s){ return [...(T.qzResults || [])].filter(r => r.student_id === s.id).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)); }
function qzTopicLast(s){
  const map = new Map();
  qzResultsFor(s).forEach(r => (r.details?.topics || []).forEach(t => { const k = t.id || t.title; if (!map.has(k)) map.set(k, t); }));
  return map;
}
const qzQuizById = id => (T.qzQuizzes || []).find(q => q.id === id) || null;
const qzDate = iso => iso ? new Date(iso).toLocaleDateString("ru-RU", {day:"numeric", month:"short"}) : "";
const qzPct = (ok, total) => total ? Math.round(+ok / +total * 100) : 0;
function qzDraftHTML(d){
  const groups = new Map();
  d.questions.forEach((q, i) => {
    const k = q.topicId || q.topic || "other";
    const g = groups.get(k) || {title: q.topic || "Без темы", list: []};
    g.list.push({q, i}); groups.set(k, g);
  });
  return `<div class="stack" style="gap:10px;border-top:1px solid var(--line);padding-top:12px">
    <div class="row between" style="gap:8px;flex-wrap:wrap"><b>Предпросмотр: вопросов ${d.questions.length} · тем ${d.topics.length}</b><span class="small muted">Лишние вопросы можно убрать</span></div>
    <label for="qz-title">Название теста</label><input id="qz-title" maxlength="120" value="${esc(d.title)}">
    ${[...groups.values()].map(g => `<div class="qz-topic"><div class="qz-topic-row"><b>${esc(g.title)}</b><span class="chip">${g.list.length}</span></div><ol style="margin:6px 0 0;padding-left:18px">${g.list.map(({q, i}) => `<li style="margin:6px 0">${esc(q.q)} <button class="linkbtn" data-act="qz-drop" data-i="${i}">убрать</button></li>`).join("")}</ol></div>`).join("")}
    <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn" data-act="qz-save" ${T.qzBusy ? "disabled" : ""}>Сохранить и получить ссылку</button><span class="small muted">вопросов: ${d.questions.length}</span></div></div>`;
}
function quizCardHTML(s, c){
  const st = qzState(s);
  const results = qzResultsFor(s);
  const stats = window.Quiz ? Quiz.topicStats(results) : [];
  const last = qzTopicLast(s);
  const saved = st.qzSaved;
  const draft = st.qzDraft ? qzDraftHTML(st.qzDraft) : "";
  const picks = c.lessons.map(l => {
    const n = qzQuestions(l).length, t = last.get(l.id), covered = s.covered_manual?.[l.id] || s.covered?.[l.id];
    const extra = [`${n} вопр.`]; if (covered) extra.push("пройдено"); if (t?.total) extra.push("тест: " + qzPct(t.ok, t.total) + "%");
    const ttl = String(l.title || "");
    const short = ttl.length > 44 ? ttl.slice(0, 44).trimEnd() + "…" : ttl;
    return `<label class="pick ${st.qzSel.has(l.id) ? "on" : ""}" title="${esc(ttl)}"><input type="checkbox" data-qz-topic="${esc(l.id)}" value="${esc(l.id)}" ${st.qzSel.has(l.id) ? "checked" : ""}><span>${esc(short)} <span class="small muted">· ${esc(extra.join(" · "))}</span></span></label>`;
  }).join("");
  const linkSaved = saved ? `<div class="stack" style="gap:8px;border-top:1px solid var(--line);padding-top:12px">
      <div class="kicker">Тест сохранён – ссылка готова</div><b>${esc(saved.title || "Тест по темам")}</b>
      <div class="linkbox"><input type="text" id="qz-link" readonly value="${esc(Quiz.link(saved.id))}"><button class="btn ghost sm" data-act="qz-copy" data-id="${esc(saved.id)}">Копировать</button></div>
      <div class="row" style="gap:8px;flex-wrap:wrap"><a class="btn ghost sm" data-qz-link href="${esc(Quiz.link(saved.id))}" target="_blank" rel="noopener">Открыть ссылку</a><button class="btn sm" data-act="qz-open" data-id="${esc(saved.id)}" data-title="${esc(saved.title || "")}">Открыть у ученика</button></div>
      <p class="small muted">Отправьте ссылку в чат или откройте тест у ученика: если он сейчас в сети, тест появится сам.</p></div>` : "";
  const quizzes = (T.qzQuizzes || []).filter(q => q.student_id === s.id).slice(0, 8);
  const list = quizzes.length ? `<div class="stack" style="gap:8px;border-top:1px solid var(--line);padding-top:12px"><div class="kicker">Сохранённые тесты этого ученика</div><div class="quiz-list">${quizzes.map(q => {
      const lr = results.find(r => r.quiz_id === q.id), n = Array.isArray(q.data?.questions) ? q.data.questions.length : 0;
      return `<div class="qz-item"><div style="min-width:0"><b>${esc(q.title || "Тест по темам")}</b><div class="small muted">${qzDate(q.created_at)} · вопросов: ${n}${lr ? ` · ${lr.score}/${lr.total}` : ""}</div></div><div class="row" style="gap:6px;flex-wrap:wrap">${lr ? `<span class="chip ${lvl(qzPct(lr.score, lr.total))}">${lr.score}/${lr.total}</span>` : ""}<a class="btn ghost sm" data-qz-link href="${esc(Quiz.link(q.id))}" target="_blank" rel="noopener">Открыть</a><button class="btn ghost sm" data-act="qz-copy" data-id="${esc(q.id)}">Копировать</button><button class="btn sm" data-act="qz-open" data-id="${esc(q.id)}" data-title="${esc(q.title || "")}">Ученику</button></div></div>`;
    }).join("")}</div></div>` : "";
  const resTable = results.length ? `<div style="border-top:1px solid var(--line);padding-top:12px"><div class="kicker">Попытки</div><div class="tablewrap"><table style="min-width:560px"><thead><tr><th>Дата</th><th>Тест</th><th>Результат</th><th>Надо доработать</th></tr></thead><tbody>${results.slice(0, 10).map(r => `<tr><td class="small">${qzDate(r.created_at)}</td><td class="small">${esc(qzQuizById(r.quiz_id)?.title || "Тест по темам")}</td><td><span class="chip ${lvl(qzPct(r.score, r.total))}">${r.score}/${r.total}</span></td><td>${(Array.isArray(r.needs_work) ? r.needs_work : []).map(n => `<span class="chip bad">${esc(n)}</span>`).join(" ") || "–"}</td></tr>`).join("")}</tbody></table></div></div>` : "";
  return `<div class="section-title"><h2>Тест по темам</h2><span class="small muted">Соберите тест из нескольких пройденных тем – ученик получит ссылку, а ошибки лягут на карту тем.</span></div>
    <div class="card stack" id="qz-card" style="gap:12px">
      ${st.qzDraft ? `<div class="kicker">Предпросмотр: вопросов ${st.qzDraft.questions.length} · тем ${st.qzDraft.topics.length}</div>` : ""}
      <div class="kicker">1. Выберите темы</div>
      <div style="max-height:260px;overflow:auto"><div class="picks">${picks || `<span class="small muted">В курсе пока нет уроков.</span>`}</div></div>
      <div class="row" style="gap:8px;flex-wrap:wrap"><label class="small" for="qz-count">Вопросов на тему</label>
        <select id="qz-count" style="width:auto">${QZ_COUNTS.map(n => `<option ${n === st.qzCount ? "selected" : ""}>${n}</option>`).join("")}</select>
        <button class="btn sm" data-act="qz-build" ${st.qzBusy ? "disabled" : ""}>${st.qzBusy ? "Собираю…" : "Собрать тест"}</button>
        <span class="small muted">выбрано тем: ${st.qzSel.size}</span></div>
      ${draft}${linkSaved}${list}
      <div style="border-top:1px solid var(--line);padding-top:12px"><div class="kicker">Карта тем</div><div id="qz-map">${window.Quiz ? Quiz.graphHTML(stats) : `<p class="small muted">Модуль тестов не загрузился – обновите страницу.</p>`}</div></div>
      ${resTable}</div>`;
}
async function qzBuild(s){
  const c = U.courseFor(s, T.mats); if (!c) return;
  const sel = [...qzState(s).qzSel].map(id => U.findLesson(c, id)).filter(Boolean);
  if (!sel.length){ toast("Отметьте хотя бы одну тему"); return; }
  if (sel.length > 20){ toast("Выберите не больше 20 тем"); return; }
  if (!window.Quiz){ toast("Модуль тестов не загрузился – обновите страницу"); return; }
  const count = Math.max(1, Math.min(10, +T.qzCount || 3));
  T.qzBusy = true; T.qzDraft = null; T.qzSaved = null; render();
  const topics = [], questions = []; let aiErr = "";
  for (const l of sel){
    topics.push({id: l.id, title: l.title});
    let qs = qzQuestions(l).slice(0, count);
    if (qs.length < count){
      try {
        const r = await ai({action: "generate_tasks", topic: l.title, count: count - qs.length, grade: s.grade});
        if (r?.error) aiErr = r.error;
        else qs = [...qs, ...Quiz.questionsFromTests(Array.isArray(r?.test) ? r.test : [], l.title, l.id)];
      } catch(e){ aiErr = e.message || String(e); }
    }
    questions.push(...qs.slice(0, count));
  }
  T.qzBusy = false;
  if (!questions.length){ render(); toast(aiErr ? "Нейросеть не помогла: " + aiErr : "В выбранных темах нет готовых вопросов с вариантами ответа"); return; }
  const names = topics.map(t => t.title).slice(0, 3).map(x => String(x).slice(0, 40));
  T.qzDraft = {title: `Тест по темам: ${names.join("; ")}${topics.length > 3 ? " и др." : ""}`.slice(0, 120), topics, questions};
  render();
  if (aiErr) toast("Часть вопросов нейросеть не добавила: " + aiErr);
  else toast(`Собрано вопросов: ${questions.length}. Проверьте и сохраните.`);
}
async function qzSave(s){
  const d = T.qzDraft; if (!d || !d.questions.length){ toast("Сначала соберите тест"); return; }
  if (!window.Quiz){ toast("Модуль тестов не загрузился – обновите страницу"); return; }
  const title = ((($("#qz-title") && $("#qz-title").value) || d.title || "").trim().slice(0, 120)) || "Тест по темам";
  const id = Quiz.newId(), data = {title, subject: subjOfS(s), grade: s.grade ?? null, topics: d.topics, questions: d.questions};
  T.qzBusy = true; render();
  const {data: row, error} = await sb.from("topic_quizzes").insert({id, student_id: s.id, title, course: s.course, data}).select().single();
  T.qzBusy = false;
  if (error){ toast("Не сохранилось: " + error.message); render(); return; }
  T.qzQuizzes = [row || {id, student_id: s.id, title, course: s.course, data, created_at: new Date().toISOString()}, ...(T.qzQuizzes || [])];
  T.qzSaved = T.qzQuizzes[0]; T.qzDraft = null; T.qzSel = new Set();
  render(); toast("Тест сохранён. Ссылка готова – отправьте её ученику.");
}
async function qzCopy(id){
  const link = window.Quiz ? Quiz.link(id) : String(id || "");
  try { await navigator.clipboard.writeText(link); toast("Ссылка скопирована"); }
  catch(_){
    try { const ta = document.createElement("textarea"); ta.value = link; document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast("Ссылка скопирована"); }
    catch(__){ toast("Ссылка: " + link); }
  }
}
function qzOpen(s, id, title){
  if (!id) return;
  cmd(s.id, "quiz", {token: id, title: title || "Тест по темам"});
  if (s.pair_id) cmd(s.pair_id, "quiz", {token: id, title: title || "Тест по темам"});
  toast(T.online[s.id] ? "Тест отправлен ученику" : "Ученик сейчас не в сети – тест ждёт его в разделе «Тесты»");
}

function viewStudent(){
  const s = T.students.find(x => x.id === T.sel); if (!s) return viewStudents();
  const x = sData(s), c = x.c, et = window.ENTRY_TESTS?.[String(s.grade)];
  const unlocked = s.unlocked || [], others = T.students.filter(o => o.id !== s.id && !pending(o));
  return `<div class="row between" style="margin-bottom:12px"><button class="btn ghost sm" data-view="students">← Все ученики</button><button class="btn ghost sm" data-act="reload">Обновить</button></div>
  <section class="hero glass" style="min-height:150px"><span class="mono muted">${s.grade ? s.grade + " класс" : "класс не указан"} · ${esc(c ? c.course : "план не выбран")}</span>
    ${!pending(s) ? `<div class="row" style="gap:8px;margin:8px 0"><button class="btn" data-act="start-lesson">▶ Начать занятие</button>${T.room?.sid === s.id || T.me?.room?.sid === s.id ? `<button class="btn ghost" data-act="room-back">↩ Вернуться к идущему уроку</button>` : ""}</div>` : ""}
    <h1 style="display:flex;gap:12px;align-items:center">${s.avatar ? `<img src="${esc(s.avatar)}" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover;flex:none">` : ""}${esc(pending(s) ? "Ожидает регистрации" : s.name)}</h1><p>${s.goal ? esc(U.goalLabel(s.goal)) + " · " : ""}${s.school ? esc(s.school) + " · " : ""}логин ${esc(s.code)}</p><div data-online="${s.id}" style="margin-top:6px"></div><img class="cat" data-m src="${U.mascot()}" alt=""></section>
  ${inviteBox(s)}
  <div class="grid2" style="margin-top:16px">
    <div class="card stack" style="gap:6px"><div class="kicker">Анкета</div>
      <p><b>Класс:</b> ${s.grade || "–"}</p><p><b>Цели:</b> ${esc((s.goals || []).map(U.goalLabel).join(", ") || s.goal || "–")}</p><p><b>Школа:</b> ${esc(s.school || "–")}</p><p><b>Контакт:</b> ${esc(s.contact || "–")}</p>
      <p><b>Зарегистрирован:</b> ${s.registered_at ? new Date(s.registered_at).toLocaleDateString("ru-RU") : "нет"}</p>
      <div class="row" style="margin-top:6px"><button class="btn ghost sm" data-act="new-invite">${pending(s) ? "Новая ссылка" : "Сбросить пароль (новая ссылка)"}</button></div></div>
    <form class="card stack" id="plan-form" style="gap:8px"><div class="kicker">План работы</div>
      <p class="small muted">Отметьте курсы, по которым занимается ученик, – можно несколько (например, программа класса и ВПР). Каждый курс – своя папка уроков у ученика, вход тот же.</p>
      ${(() => { const all = courseOptions(s.grade ?? 9, subjOfS(s)), have = new Set(siblings(s).filter(o => subjOfS(o) === subjOfS(s)).map(o => o.course));
        const box = ([k, n, ok]) => `<label class="pick ${have.has(k) ? "on" : ""}"><input type="checkbox" class="pl-c" value="${k}" ${have.has(k) ? "checked" : ""} ${ok ? "" : "disabled"}><span>${esc(n)}</span></label>`;
        return `<div class="picks">${all.filter(x => x[3]).map(box).join("")}</div><details><summary class="small">Курсы других классов</summary><div class="picks" style="margin-top:6px">${all.filter(x => !x[3]).map(box).join("")}</div></details>`; })()}
      <p class="small muted">Подсказка по целям ученика: ${esc(U.getCourse(U.planFor(subjOfS(s), s.grade ?? 9, s.goals || []))?.course || "–")}. Даты и время уроков – в карточке «Расписание».</p>
      <div><button class="btn sm" type="submit">Сохранить план</button></div></form>
    <div class="card stack" style="gap:8px"><div class="kicker">Предметы ученика</div>
      <div class="stack" style="gap:6px">${siblings(s).map(o => `<button class="subj" ${o.id === s.id ? 'aria-pressed="true"' : `data-student="${o.id}"`}><span class="emo">${U.subj(subjOfS(o)).e}</span><span>${esc(U.subj(subjOfS(o)).n)}<small>${o.grade != null ? U.gradeName(o.grade) : ""}${U.getCourse(o.course) ? " · " + esc(U.getCourse(o.course).course) : ""}</small></span></button>`).join("")}</div>
      ${pending(s) ? `<p class="small muted">Второй предмет можно добавить после регистрации.</p>` : `<label for="as-subj">Добавить предмет – вход у ученика останется тем же</label>
      <select id="as-subj">${U.SUBJECTS.filter(x => !siblings(s).some(o => subjOfS(o) === x.k)).map(x => `<option value="${x.k}">${x.e} ${esc(x.n)}</option>`).join("")}</select>
      <select id="as-grade" aria-label="Класс">${U.subj(U.SUBJECTS.find(x => !siblings(s).some(o => subjOfS(o) === x.k))?.k || "rus").g.map(g => `<option value="${g}" ${g === s.grade ? "selected" : ""}>${U.gradeName(g)}</option>`).join("")}</select>
      <div><button class="btn sm" data-act="add-subject">Добавить предмет</button></div>`}</div>
    ${c && !pending(s) || c ? `<div class="card stack" style="gap:8px"><div class="kicker">Расписание</div>
      <p class="small muted">Отметьте дни и время – даты будущих уроков расставятся сами (можно каждый день). Любую дату и время потом можно поправить в таблице уроков.</p>
      <div class="picks wd" role="group" aria-label="Дни недели">${["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].map((d, k) => `<label class="pick ${(s.dates?._days || []).includes((k + 1) % 7) ? "on" : ""}"><input type="checkbox" class="sched-wd" value="${(k + 1) % 7}" ${(s.dates?._days || []).includes((k + 1) % 7) ? "checked" : ""}><span>${d}</span></label>`).join("")}</div>
      <div class="sched-row"><label for="sched-time">Время</label><input type="time" id="sched-time" class="tinput" value="${esc(s.dates?._time || "")}">
        <label for="sched-from">начиная с</label><input type="date" id="sched-from" class="tinput" value="${esc(U.iso(new Date()))}"></div>
      <div><button class="btn sm" data-act="sched-apply">Расставить даты</button></div></div>` : ""}
    <div class="card stack" style="gap:8px"><div class="kicker">Занятие онлайн</div>
      <p class="small muted">Ссылка на созвон: Яндекс Телемост, VK Звонки, Сферум или любая другая – своя для каждого ученика. «Начать занятие» сразу открывает звонок, общую доску и задания текущего урока, а ученику приходит приглашение: он выбирает доску, звонок или то и другое (можно с разных устройств).</p>
      <div class="linkbox"><input type="url" id="call-url" value="${esc(s.call_url || "")}" placeholder="${esc(T.me?.call_url || "https://telemost.yandex.ru/j/…")}"><button class="btn ghost sm" data-act="save-call">Сохранить</button></div>
      <div class="row"><button class="btn sm" data-act="start-lesson">📞 Начать занятие</button><button class="btn ghost sm" data-boardfor="free">Личная доска</button>
        <a class="btn ghost sm" href="https://telemost.yandex.ru/" target="_blank" rel="noopener" data-act="new-meeting">Создать встречу в Телемосте</a></div>
      <p class="small muted">Создайте встречу, скопируйте её ссылку и вернитесь сюда – ссылка сама закрепится за учеником. Или просто вставьте её в поле: сохранять не нужно.</p></div>
    ${!pending(s) && sb ? `<div class="card stack" style="gap:8px"><div class="kicker">Урок из другого класса или предмета</div>
      <p class="small muted">Любой урок базы – для повторения, опережения или другой программы. Он копируется в план только этого ученика${s.pair_id ? " и напарника" : ""}, вместе с заданиями и ключами.</p>${takePick(s, "student")}</div>` : ""}
    <div class="card stack" style="gap:8px"><div class="kicker">Работа в паре</div>
      <p class="small muted">Двое учеников видят одну общую доску на каждом уроке и курсоры друг друга. Результаты и работы у каждого свои.</p>
      <label for="pair-pick">Напарник</label>
      <select id="pair-pick"><option value="">– занимается один –</option>${others.map(o => `<option value="${o.id}" ${o.id === s.pair_id ? "selected" : ""}>${esc(o.name)}${o.grade ? ", " + o.grade + " кл." : ""}</option>`).join("")}</select>
      <div><button class="btn sm" data-act="save-pair">Сохранить</button></div></div>
  </div>
  ${!pending(s) ? `<div class="section-title"><h2>Анализ и план</h2></div>${aiReportHTML(s, x)}` : ""}
  ${c ? quizCardHTML(s, c) : ""}
  <div class="section-title"><h2>Входной тест</h2></div>
  ${et && x.entry ? window.entryHTML(et, x.entry) : `<div class="card"><p class="muted">${pending(s) ? "Тест будет доступен после регистрации." : "Ученик ещё не прошёл входной тест."}</p></div>`}
  ${T.liveTest?.[s.id] && !T.liveTest[s.id].done && !T.liveTest[s.id].quit ? `<div class="section-title"><h2>Сейчас проходит тест</h2></div><div class="card" data-livetest="${s.id}">${liveTestHTML(T.liveTest[s.id])}</div>` : ""}
  ${(() => { const L = T.rows.filter(r => r.student_id === s.id && (r.kind === "lesson" || r.kind === "hw") && r.answers?.length).slice(-4).reverse(); if (!L.length) return "";
    return `<div class="section-title"><h2>Последние тесты – ответы</h2></div><div class="card">${L.map(r => { const l = U.findLesson(c, r.lesson_id); return `<div style="margin-bottom:10px"><b>${r.kind === "hw" ? "ДЗ-тест" : "Тест"}: ${esc(l?.title || r.lesson_id)}</b> <span class="chip ${U.lvl(Math.round(r.score / r.total * 100))}">${r.score}/${r.total}</span> <span class="small muted">${new Date(r.created_at).toLocaleString("ru-RU", {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"})}</span>${answersHTML(r.answers, false)}</div>`; }).join("")}</div>`; })()}
  ${!pending(s) ? `<div class="section-title"><h2>Самообучение и отработка</h2></div>${selfLogHTML(s, c)}` : ""}
  ${!pending(s) && c?.labLessons?.length ? `<div class="section-title"><h2>Тренажёр изложений</h2></div><div class="card">${labPaneT(s, c, false)}</div>` : ""}
  ${!pending(s) && window.OGE?.isOge(c) ? `<div class="section-title"><h2>ОГЭ по заданиям</h2><span class="small muted">так видит ученик в разделе «Мой ОГЭ»</span></div>${OGE.html(c, T.rows.filter(r => r.student_id === s.id), x.writings, {teacher: true})}` : ""}
  <div style="margin-top:16px">${U.progressHTML(T.students.filter(o => (o.person_id || o.id) === (s.person_id || s.id) && !pending(o)).map(o => ({subject: o.subject || U.subjectOf(o.course), ...U.subjectNow(T.rows.filter(r => r.student_id === o.id), T.writings.filter(w => w.student_id === o.id))})))}</div>
  ${c ? `<div class="section-title"><h2>Карта успеха</h2></div>${window.mapHTML(c, x.results, x.hwres, x.writings, x.hw)}
  <div class="section-title"><h2>Уроки</h2><div class="row"><button class="btn ghost sm" data-act="shift" title="Перенести все будущие уроки на неделю вперёд">Каникулы: сдвинуть будущие уроки на неделю</button></div></div>
  <div class="tablewrap glass"><table style="min-width:1140px"><thead><tr><th>№</th><th>Дата</th><th>Тема</th><th>Доступ</th><th>Пройдено</th><th>Время</th><th>Выполнено</th><th>Тест</th><th>ДЗ-тест</th><th>Письмо</th><th>ДЗ</th><th></th></tr></thead><tbody>
  ${c.lessons.map((l,i) => { const r = x.results[l.id], hr = x.hwres[l.id], h = x.hw[l.id], w = x.writings[l.id], hs = U.hwState(c, l.id, x.hw), dn = x.done(l);
    const byDate = d(l.date) <= today(), early = unlocked.includes(l.id);
    const manualDate = s.covered_manual?.[l.id], coveredDate = manualDate || s.covered?.[l.id];
    const wcell = !w ? "–" : w.status === "sent" ? `<span class="chip mid">ждёт</span>` : w.max ? `<span class="chip ${lvl(Math.round(w.total/w.max*100))}">${w.total}/${w.max}</span>` : `<span class="chip">${w.status === "redo" ? "доработка" : "проверено"}</span>`;
    return `<tr><td class="tnum">${i+1}</td><td><div class="dt-cell"><input type="date" class="tinput" value="${esc(l.date)}" data-date="${l.id}" aria-label="Дата урока ${i+1}"><input type="time" class="tinput" value="${esc(U.lessonTime(s, l))}" data-ltime="${l.id}" aria-label="Время урока ${i+1}"></div>${s.dates?.[l.id] ? '<div class="small muted">перенесён</div>' : ""}</td>
      <td><i class="dot" style="background:${blockOf(c, l).color}"></i> ${esc(l.title)}${l.writing ? `<div class="small muted">${esc(U.KIND_NAME[l.writing.type])}</div>` : ""}${l.custom ? (T.mats.find(m => m.id === l.mid)?.student_id ? `<div class="small muted">из курса «${esc(l.oge)}» <button class="linkbtn" data-act="del-copy" data-mid="${l.mid}">убрать</button></div>` : '<div class="small muted">свой урок</div>') : ""}</td>
      <td>${byDate ? '<span class="chip good">открыт</span>' : early ? `<button class="btn ghost sm" data-unlock="${l.id}" data-on="0">Закрыть</button>` : `<button class="btn ghost sm" data-unlock="${l.id}" data-on="1">${I.lock} Открыть сейчас</button>`}</td>
      <td>${coveredDate ? `<span class="chip good" title="${manualDate ? "Отмечено вручную" : "Пройдено на уроке"}">✓ ${fmt(coveredDate, {day: "numeric", month: "short"})}</span> <button class="linkbtn" data-act="covered-toggle" data-lid="${esc(l.id)}" data-on="0">убрать</button>` : `<button class="btn ghost sm" data-act="covered-toggle" data-lid="${esc(l.id)}" data-on="1">Отметить</button>`}</td>
      <td class="tnum">${mins(x.time[l.id])}</td>
      <td class="tnum">${dn == null ? "–" : `<span class="chip ${lvl(dn)}">${dn}%</span>`}</td>
      <td class="tnum">${r ? `<span class="chip ${lvl(pct(r.last))}">${pct(r.last)}%</span><div class="small muted">лучш. ${pct(r.best)}% · ${r.attempts}${r.last?.duration_sec ? " · " + mins(r.last.duration_sec) : ""}</div>` : "–"}</td>
      <td class="tnum">${hr ? `<span class="chip ${lvl(pct(hr.last))}">${pct(hr.last)}%</span>` : "–"}</td>
      <td>${wcell}${w ? `<div style="margin-top:4px"><button class="btn ghost sm" data-wreview="${l.id}">Проверить</button></div>` : ""}</td>
      <td><span class="chip ${hs.c}">${hs.t}</span>${h?.note?`<div class="small" style="margin-top:4px">${/^https?:/.test(h.note)?`<a href="${esc(h.note)}" target="_blank" rel="noopener">ссылка ученика</a>`:esc(h.note)}</div>`:""}<div style="margin-top:4px"><button class="btn ghost sm" data-review="${l.id}">Оценить</button></div></td>
      <td><div class="stack" style="gap:6px"><button class="btn sm" data-act="start-lesson" data-rl="${l.id}" title="Звонок, доска и задания этого урока">▶ Урок</button><button class="btn yellow sm" data-boardfor="${l.id}">Доска</button>${l.practice?.length ? `<button class="btn ghost sm" data-workfor="${l.id}">Тетрадь${(T.works || []).some(w => w.student_id === s.id && w.lesson_id === l.id) ? " ✓" : ""}</button>` : ""}<button class="btn ghost sm" data-goto="${l.id}" title="Откроет этот урок на экране ученика">Показать ученику</button></div></td></tr>
      ${T.review === l.id ? `<tr><td colspan="12"><div class="stack" style="gap:6px;max-width:520px"><b>ДЗ: ${esc(l.title)}</b><p class="small">${esc(l.hw || "")}</p>
          ${hr ? `<p class="small muted">ДЗ-тест: ${esc(U.recText(hr.last))}</p>` : ""}
          <input type="text" id="rv-grade" placeholder="Оценка" value="${esc(h?.grade||"")}"><textarea id="rv-comment" placeholder="Комментарий ученику">${esc(h?.comment||"")}</textarea>
          <div class="row"><button class="btn sm" data-act="review" data-st="accepted">Принять</button><button class="btn ghost sm" data-act="review" data-st="redo">На доработку</button></div></div></td></tr>` : ""}
      ${T.wreview === l.id ? `<tr><td colspan="12"><div style="max-width:760px">${writingReviewHTML(s, x, l)}</div></td></tr>` : ""}`; }).join("")}
  </tbody></table></div>
  <p class="small muted" style="margin-top:8px">«Время» – сколько ученик провёл в папке урока. «Выполнено» – доля сделанного: мини-практика, тест, ДЗ-тест, письмо и отметка ДЗ. «Пройдено» – отметка вручную (очно или на другой платформе): на «Выполнено» не влияет.</p>`
  : `<div class="section-title"><h2>План</h2></div><div class="card"><p>План ещё не выбран: выберите курс выше. Подходит: ${esc(U.getCourse(U.planFor(subjOfS(s), s.grade ?? 9, s.goals || []))?.course || "–")}.</p></div>`}
  <div class="section-title"><h2>Управление</h2></div>
  <div class="card row"><button class="btn ${T.confirmDel===s.id?"danger":"ghost"} sm" data-act="del-student">${T.confirmDel===s.id?"Нажмите ещё раз, чтобы удалить навсегда":"Удалить ученика"}</button></div>`;
}

/* тетрадь ученика: его подчёркивания, буквы, знаки и ответы – вживую, рядом ключи */
function viewWork(){
  const s = T.students.find(x => x.id === T.sel), c = U.courseFor(s, T.mats) || {lessons: []}, l = c.lessons.find(x => x.id === T.workLesson);
  if (!l) return viewStudent();
  const keys = keysFor(s.course, l), st = Object.fromEntries((T.works || []).filter(w => w.student_id === s.id && w.lesson_id === l.id).map(w => [w.task, w.data]));
  return `<div class="row between" style="margin-bottom:12px"><button class="btn ghost sm" data-student="${s.id}">← ${esc(s.name)}</button>
    <div class="row"><span data-online="${s.id}"></span><button class="btn sm" data-goto="${l.id}" data-sub2="practice">Открыть у ученика</button></div></div>
  <article class="window glass" style="--c:${blockOf(c, l).color}"><div class="head"><div class="corners"><div class="mono muted">Тетрадь</div><div class="mono muted">${esc(s.name)}</div></div><h1>${esc(l.title)}</h1></div>
    <div class="pane"><p class="small muted">Видно в реальном времени: как только ученик отмечает или вписывает, здесь обновляется.</p>
      <div id="wk-view">${l.practice.map((p, i) => Work.task({...p, key: keys[i]}, i, st[i] || {}, true).replace('class="task wk"', 'class="task wk ro"')).join("")}</div></div></article>`;
}

function viewBoard(){
  const s = T.students.find(x => x.id === T.sel), c = U.courseFor(s, T.mats) || {lessons: [], blocks: {}}, l = T.boardLesson === "free" ? FREE : c.lessons.find(x => x.id === T.boardLesson);
  const p = s.pair_id && T.students.find(x => x.id === s.pair_id);
  return `<div class="row between" style="margin-bottom:12px"><button class="btn ghost sm" data-student="${s.id}">← ${esc(s.name)}</button>
    <button class="btn sm" data-goto="${l.id}" data-sub2="board">Позвать ${p ? "учеников" : "ученика"} на доску</button></div>
  <article class="window glass" style="--c:${blockOf(c, l).color}"><div class="head"><div class="corners"><div class="mono muted">Доска</div><div class="mono muted">${esc(s.name)}${p ? " и " + esc(p.name) : ""}</div></div><h1>${esc(l.title)}</h1></div>
    <div class="pane"><div class="board glass" id="board"></div>
    <p class="small muted" style="margin-top:8px">Когда вы переключаете лист, у ${p ? "учеников" : "ученика"} он переключается тоже. «Очистить» стирает лист у всех.</p></div></article>`;
}

function viewMethodology(){
  const c = U.getCourse(curCourse());
  return `<section class="hero glass" style="min-height:150px"><span class="mono muted">${esc(c.course)}</span><h1>Методика курса</h1><img class="cat" data-m src="${U.mascot()}" alt=""></section>
  <div class="section-title"><h2>Курс</h2>${coursePick()}</div>
  ${cmats.length ? `<div class="card" style="margin-bottom:16px"><div class="kicker">Материалы курса</div>${cmats.map(m => `<div class="mat"><span class="ic">${{link:"🔗",file:"📎",text:"📝"}[m.kind] || "•"}</span><div style="flex:1;min-width:0"><b>${esc(m.title || "Материал")}</b>${m.url ? ` · <a href="${esc(m.url)}" target="_blank" rel="noopener">открыть</a>` : ""}${m.body ? `<div class="small" style="white-space:pre-line">${esc(m.body.slice(0, 300))}</div>` : ""}</div>${m.shared ? '<span class="chip">встроенная база</span>' : ""}</div>`).join("")}</div>` : ""}
  <div class="stack" style="margin-top:10px;gap:26px">${(c.methodology || []).map(m => `<div class="sheet"><span class="tag label">${esc(m.h)}</span>${m.t ? `<p>${U.mark(m.t)}</p>` : ""}${m.list ? `<ul>${m.list.map(x => `<li>${U.mark(x)}</li>`).join("")}</ul>` : ""}${m.table ? `<div class="tablewrap"><table><thead><tr>${m.table[0].map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${m.table.slice(1).map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}</div>`).join("")}</div>`;
}
const matSubject = () => T.matSubject || U.subjectOf(curCourse());
const coursePick = () => `<select id="course-pick" style="width:auto;max-width:100%">${U.coursesOf(matSubject()).map(k => `<option value="${k}" ${k===curCourse()?"selected":""}>${esc(U.getCourse(k).course)}${access(k) ? "" : " 🔒"}</option>`).join("")}</select>`;
const subjectPick = () => `<div class="subjects" role="group" aria-label="Предмет" style="margin-top:18px">${U.SUBJECTS.map(x => `<button class="subj" data-matsubj="${x.k}" aria-pressed="${matSubject() === x.k}"><span class="emo">${x.e}</span><span>${esc(x.n)}<small>${x.g[0] === 0 ? "дошкольники" : x.g[0] + "–" + x.g.at(-1) + " кл."}</small></span></button>`).join("")}</div>`;

function viewCourse(){
  const cid = curCourse(), c = teacherCourse(cid), ok = access(cid);
  if (c.locked && T.me?.base) return `<section class="hero glass" style="min-height:150px"><span class="mono muted">Встроенная база</span><h1>${esc(c.course)}</h1><p>Загружаю курс…</p></section>${subjectPick()}`;
  const cmats = T.mats.filter(m => m.course === cid && m.lesson_id === "_course");
  return `<section class="hero glass" style="min-height:150px"><span class="mono muted">${c.locked ? "Встроенная база · по подписке" : c.virtual ? "Ваш курс" : "База открыта"}</span><h1>${esc(c.course)}</h1>
    <p>${c.locked ? `Готовый курс: ${c.n} уроков с теорией, мини-практикой, заданиями и тестами. Открывается в тарифе «С материалами» (300 ₽ в месяц). Свои уроки можно добавлять и сейчас.` : c.virtual ? "Уроки, теорию, материалы, задания и тесты добавляете вы – или составляет нейросеть. Ученики курса видят их сразу." : ok ? "Методика урока, теория с мини-практикой, задания с ключами, тесты, письмо. Добавляйте свои материалы в любую папку." : "Эта база пока не открыта. Названия уроков видны, материалы – после покупки."}</p><img class="cat" data-m src="${U.mascot()}" alt=""></section>
  ${subjectPick()}
  <div class="section-title"><h2>Курс</h2>${coursePick()}</div>
  ${!c.lessons.length && !c.locked ? `<div class="card" style="margin-bottom:16px"><p>Уроков пока нет. Создайте первый урок ниже – он сразу появится у учеников этого курса. Материалы, задания и тесты добавляются внутри папки (можно составить нейросетью).</p></div>` : ""}
  ${!ok ? `<div class="card row between" style="margin-bottom:16px"><p>${I.lock} Материалы курса откроются в тарифе «С материалами» или «Полный».</p><button class="btn sm" data-view="sub">Выбрать тариф</button></div>
    <div class="folders" style="margin-bottom:24px">${(c.titles || []).map((t, i) => `<button class="folder locked" style="--c:${U.ownColor()}" data-view="sub"><span class="back"></span><span class="papers"><i></i><i></i></span><span class="front"><span class="lockico">${I.lock}</span><span class="num">№ ${String(i+1).padStart(2,"0")}</span><span class="ttl">${esc(t)}</span></span></button>`).join("")}</div>` : ""}
  <div class="folders">${c.lessons.map((l,i) => `<button class="folder ${ok || l.custom ? "" : "locked"}" style="--c:${blockOf(c, l).color}" data-lesson="${l.id}"><span class="back"></span><span class="papers"><i></i><i></i></span>
    <span class="front">${ok || l.custom ? "" : `<span class="lockico">${I.lock}</span>`}<span class="num">№ ${String(i+1).padStart(2,"0")}${l.custom ? " · СВОЙ" : ""}</span><span class="ttl">${esc(l.title)}</span>
    <span class="meta"><span class="pill">${esc(l.oge)}</span>${l.materials?.length ? `<span class="pill">+${l.materials.length}</span>` : ""}${sheetFor(cid, l.id).url ? '<span class="pill">лист ✓</span>' : ""}<span class="arrow">→</span></span></span></button>`).join("")}</div>
  ${sb && T.session ? `<div class="section-title"><h2>Свой урок</h2></div>
  <form class="card stack" id="own-lesson" style="gap:8px"><p class="small muted">Урок появится в курсе у всех ваших учеников этого курса. Материалы, задания и тест добавите внутри папки.</p>
    <label for="ol-title">Тема</label><input type="text" id="ol-title" required>
    <label for="ol-date">Дата (по плану курса)</label><input type="date" id="ol-date" required>
    ${T.me?.role === "developer" ? `<label class="small" style="display:flex;gap:8px;align-items:center;font-weight:700"><input type="checkbox" id="ol-shared"> В общую базу – для всех учителей</label>` : ""}
    <div><button class="btn sm" type="submit">Создать папку</button></div></form>` : ""}`;
}

function methodPlan(l){
  return [["0–5", "Проверка ДЗ", "Ошибки ДЗ-теста и письменной работы (видны в кабинете ученика): 2–3 правила вслух."],
          ["5–25", "Теория → примеры → мини-практика", "Каждый блок теории: коротко правило, разбор на примерах, сразу мини-практика (ученик отвечает в папке, проверка мгновенная). Затем следующий блок. Темы: " + (l.learn.join("; ") || l.title) + "."],
          ["25–40", "Задания формата экзамена", "Раздел «Практика» на общей доске, затем реальные задания из открытого банка ФИПИ."],
          ["40–55", l.writing ? "Письменная линия" : "Отработка", l.writing ? l.writing.classwork : "Задания из своих материалов или созданные нейросетью; самопроверка по ключам."],
          ["55–60", "Тест и ДЗ", "Тест по уроку в приложении; объяснить ДЗ" + (l.writing ? ", письмо" : "") + " и ДЗ-тест."]];
}

/* ---------- конструктор игр (как Wordwall): своя тема → любые игры платформы ---------- */
const GAME_KINDS = {pairs: ["Пары", "Каждая строка: слово = значение\nбить баклуши = бездельничать\nводить за нос = обманывать\nзарубить на носу = запомнить"],
  groups: ["Группы", "Каждая строка: Группа: слово, слово, слово\nС Ь: ночь, рожь, мышь\nБез Ь: врач, мяч, ёж"],
  quiz: ["Вопросы", "Каждая строка: вопрос | верный ответ | неверный | неверный\nКак пишется «р..сток»? | росток | расток\nСколько звуков в слове «ёж»? | 3 | 2 | 4"]};
function gameForm(l){
  const f = T.gform || {kind: "pairs", title: "", text: "", game: ""};
  return `<div class="card stack" id="game-form" style="gap:8px;margin-top:14px;box-shadow:none"><div class="kicker">🎮 Игра к уроку (как в Wordwall)</div>
    <p class="small muted">Введите свою тему – платформа сама сделает из неё игры: викторину на время, «Найди пару», сортировку, мемори, «Верно или неверно». Игра появится у учеников в папке урока, в комнате урока и в «Самообучении».</p>
    <label for="gm-title">Название</label><input id="gm-title" value="${esc(f.title || "")}" placeholder="${esc(l.title)} – игра">
    <label for="gm-kind">Что вводим</label><select id="gm-kind">${Object.entries(GAME_KINDS).map(([k, v]) => `<option value="${k}" ${k === f.kind ? "selected" : ""}>${v[0]}</option>`).join("")}</select>
    <label for="gm-text">Содержание</label><textarea id="gm-text" rows="7" placeholder="${esc(GAME_KINDS[f.kind][1])}">${esc(f.text || "")}</textarea>
    <div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn ghost sm" data-act="game-fill">Взять вопросы из теста урока</button><button type="button" class="btn ghost sm" data-act="game-try">▶ Проверить</button><button type="button" class="btn sm" data-act="game-save">Сохранить в урок</button></div>
    ${T.me?.role === "developer" ? `<label class="small" style="display:flex;gap:8px;align-items:center;font-weight:700"><input type="checkbox" id="gm-shared"> В общую базу – для всех учителей</label>` : ""}
    <p class="small" id="gm-err" style="color:var(--bad)"></p></div>`;
}
function gameRead(){ return {kind: $("#gm-kind")?.value || "pairs", title: $("#gm-title")?.value || "", text: $("#gm-text")?.value || ""}; }
async function gameAct(a, t){
  const cid = curCourse(), l = teacherCourse(cid).lessons.find(x => x.id === T.open);
  if (a === "game-play"){ const m = T.mats.find(x => String(x.id) === t.dataset.mid); if (m){ Play.onDone = null; Play.chooseGame({...m.data.theme, title: m.title || m.data.theme?.title}); } return; }
  if (!l) return;
  const f = T.gform = gameRead();
  if (a === "game-fill"){
    const qs = U.lessonTests(l).test.filter(q => Array.isArray(q.o));
    if (!qs.length){ toast("В тесте урока нет вопросов с вариантами"); return; }
    f.kind = "quiz"; f.title = f.title || l.title; f.text = qs.map(q => [q.q, q.o[q.a], ...q.o.filter((_, k) => k !== q.a)].map(x => String(x).replace(/\|/g, "/")).join(" | ")).join("\n"); render(); return;
  }
  const th = Play.parseTheme(f.kind, f.text, f.title || l.title);
  if (th.error){ const el = $("#gm-err"); if (el) el.textContent = th.error; return; }
  if (a === "game-try"){ Play.onDone = null; Play.chooseGame(th); return; }
  if (a === "game-save"){
    const {data, error} = await sb.from("materials").insert({course: cid, lesson_id: l.id, kind: "tasks", title: th.title, shared: !!$("#gm-shared")?.checked, data: {kind: "game", theme: th, game: Play.gamesFor(th)[0]}}).select().single();
    if (error){ toast("Не сохранилось: " + error.message); return; }
    T.mats.push(data); T.gform = null; render(); cmd("all", "refresh", {msg: "Учитель добавил игру"}); toast("Игра сохранена в урок");
  }
}

function materialsTab(cid, l){
  const own = T.mats.filter(m => m.course === cid && m.lesson_id === l.id && m.kind !== "lesson" && m.kind !== "keys" && !m.student_id && m.data?.kind !== "test-edit" && m.data?.kind !== "content-edit");
  const g = T.gen && T.gen.lesson === l.id ? T.gen : null;
  return `${own.length ? own.map(m => m.data?.kind === "game" ? `<div class="mat"><span class="ic">🎮</span><div style="flex:1;min-width:0"><b>${esc(m.title || "Игра")}</b>
      <p class="small muted">Игры: ${Play.gamesFor(m.data.theme || {}).map(k => Play.GAMES[k].n).join(", ")}</p><div class="row" style="gap:6px;margin-top:4px"><button class="btn ghost sm" data-act="game-play" data-mid="${m.id}">▶ Посмотреть</button></div></div>
      ${m.shared ? '<span class="chip">общая база</span>' : ""}${m.teacher_id === T.session?.user.id ? `<button class="btn ghost sm" data-delmat="${m.id}">Удалить</button>` : ""}</div>` : `<div class="mat"><span class="ic">${{link:"🔗",file:"📎",text:"📝",tasks:"✏️"}[m.kind]}</span><div style="flex:1;min-width:0">
      <b>${esc(m.title || m.url || "Материал")}</b>${m.url ? ` · <a href="${esc(m.url)}" target="_blank" rel="noopener">открыть</a>` : ""}
      ${m.kind === "text" ? `<div class="small" style="white-space:pre-line;margin-top:4px">${esc((m.body || "").slice(0, 400))}</div>` : ""}
      ${m.kind === "tasks" ? `<p class="small muted">Мини-практика: ${m.data?.mini?.length || 0} · вопросы теста: ${m.data?.test?.length || 0}</p>` : ""}</div>
      ${m.shared ? '<span class="chip">общая база</span>' : ""}${m.teacher_id === T.session?.user.id ? `<button class="btn ghost sm" data-delmat="${m.id}">Удалить</button>` : ""}</div>`).join("") : `<p class="muted">Своих материалов к этому уроку пока нет.</p>`}
    ${sb && T.session ? `<form class="card stack" id="add-mat" style="gap:8px;margin-top:14px;box-shadow:none"><div class="kicker">Добавить в папку</div>
      <select id="am-kind"><option value="link">Ссылка (Учу по ФРП, Google Диск, видео)</option><option value="file">Файл с компьютера (лист, картинка, PDF)</option><option value="text">Текст / задание</option></select>
      <label for="am-title">Название</label><input type="text" id="am-title" placeholder="${esc(l.title)} – рабочий лист">
      <div class="stack" style="gap:8px" data-k="link"><label for="am-url">Ссылка</label><input type="url" id="am-url"></div>
      <div class="stack" style="gap:8px" data-k="file" hidden><label for="am-file">Файл</label><input type="file" id="am-file"></div>
      <div class="stack" style="gap:8px" data-k="text link file"><label for="am-body">Текст (для файла и ссылки – короткое пояснение)</label><textarea id="am-body"></textarea></div>
      <p class="small muted">Материал увидят все ваши ученики этого курса в папке урока: открыть на общей доске или скачать.</p>
      ${T.me?.role === "developer" ? `<label class="small" style="display:flex;gap:8px;align-items:center;font-weight:700"><input type="checkbox" id="am-shared"> В общую базу – для всех учителей</label>` : ""}
      <div><button class="btn sm" type="submit">Добавить</button></div></form>
    ${gameForm(l)}
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
        ${T.me?.role === "developer" ? `<label class="small" style="display:flex;gap:8px;align-items:center;font-weight:700"><input type="checkbox" id="ag-shared"> В общую базу – для всех учителей</label>` : ""}
        <div class="row"><button class="btn sm" data-act="ai-save">Сохранить в папку</button><button class="btn ghost sm" data-act="ai-gen">Составить заново</button></div></div>` : ""}</div>` : ""}`;
}

function viewLesson(){
  const cid = curCourse(), c = teacherCourse(cid), l = c.lessons.find(x => x.id === T.open); if (!l) { T.view = "course"; return viewCourse(); }
  const i = c.lessons.indexOf(l), b = blockOf(c, l), ok = access(cid) || l.custom;
  const keys = keysFor(cid, l);
  const lk = {...l, practice: l.practice.map((p,k) => ({...p, key: keys[k]}))};
  const sh = sheetFor(cid, l.id), Tt = U.lessonTests(l);
  const tabs = [["method","Методика"],["theory","Теория"], U.hasMnemo(l) && ["mnemo","Запоминалки"], l.practice.length && ["practice","Практика"], l.writing && ["writing","Письмо"], ["test","Тест"], ["hwtest","ДЗ-тест"], ["mats","Свои материалы"], ["sheet","Лист и ДЗ"], l.custom && ["edit","Изменить урок"]].filter(Boolean);
  if (!tabs.some(t => t[0] === T.sub)) T.sub = "method";
  const testList = qs => `<ol style="padding-left:20px">${qs.map(q => `<li style="margin-bottom:12px"><b>${esc(q.q)}</b>${q.pn ? U.pnHTML(q.pn, q.pn.a, {ro: true}) : !q.o ? `<div class="small">Ответ: ${esc(String(q.a).split("|")[0])}</div>` : ""}<ul>${(q.o || []).map((o,k) => `<li ${k===q.a?'style="color:var(--good);font-weight:800"':""}>${esc(o)}${k===q.a?" ✓":""}</li>`).join("")}</ul><p class="small muted">${q.tag ? "Правило: " + esc(q.tag) + ". " : ""}${esc(q.e || "")}</p></li>`).join("")}</ol>`;
  let body = "";
  if (!ok) body = `<p>${I.lock} Материалы этого урока откроются в тарифе «С материалами». <a href="#" data-view="sub">Выбрать тариф</a></p>`;
  else {
  if (T.sub === "method") body = `${l.method ? `<p><b>Главное:</b> ${esc(l.method.focus)}</p>` : ""}
      <div class="tablewrap method"><table><thead><tr><th>Минуты</th><th>Этап</th><th>Что делаем</th></tr></thead><tbody>${methodPlan(l).map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <p class="small muted" style="margin-top:6px">Расчёт на 60 минут. Теория идёт маленькими блоками, после каждого – мини-практика.${l.writing ? " Письменную линию не сокращаем: умение писать формируется только регулярной практикой." : ""}</p>
      ${l.method?.tips?.length ? `<h3 style="margin-top:14px">Методические советы</h3><ul>${l.method.tips.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${l.stub ? `<p class="small" style="margin-top:12px">Содержание урока – по ФРП. Добавьте материалы и задания во вкладке «Свои материалы» – можно составить их нейросетью.</p>` : ""}`;
  if (T.sub === "theory" && ceOpen({cid, lid: l.id, sid: null}, "theory")) body = ceEditor({cid, lid: l.id, sid: null}, l, "theory");
  else if (T.sub === "theory") body = ceBar({cid, lid: l.id, sid: null}, l, "theory") + U.theoryHTML(l, true) + (Tt.mini.length ? `<div class="tblock">${U.miniHTML({id:"own"}, 0, Tt.mini, true)}</div>` : "");
  if (T.sub === "practice" && ceOpen({cid, lid: l.id, sid: null}, "practice")) body = ceEditor({cid, lid: l.id, sid: null}, l, "practice");
  else if (T.sub === "practice") body = ceBar({cid, lid: l.id, sid: null}, l, "practice") + `<p class="small muted">Ключи видите только вы. ✎ – изменить ключ${T.me?.role === "developer" ? " (в режиме разработчика – сразу во встроенной базе для всех)" : " (ваши ключи – только для вас)"}.</p>` + lk.practice.map((p, k) => `<div class="task">
      <b>Задание ${k+1}.</b> ${esc(p.t)}${p.text ? `<div class="ttext">${esc(p.text)}</div>` : ""}${p.items?.length ? `<ol class="items">${p.items.map((x, j) => `<li>${/^\d+\)/.test(x) ? "" : (j + 1) + ") "}${esc(x)}</li>`).join("")}</ol>` : ""}
      ${T.editKey === k ? `<div class="keyedit"><textarea id="key-edit" aria-label="Ключ">${esc(p.key || "")}</textarea><div class="stack" style="gap:6px"><button class="btn sm" data-act="key-save" data-k="${k}">Сохранить</button><button class="btn ghost sm" data-act="key-cancel">Отмена</button></div></div>`
        : `<div class="key"><b>Ключ:</b> ${esc(p.key || "– нет –")} <button class="btn ghost sm" data-act="key-edit" data-k="${k}" style="margin-left:6px">✎</button></div>`}</div>`).join("");
  if (T.sub === "writing"){
    const w = l.writing, kinds = w.type === "choice" ? ["13.1","13.2","13.3"] : [w.type === "izl" ? "izl" : (["thesis","example"].includes(w.type) ? "13.3" : w.type)];
    body = `<div class="theory">${U.stepHTML(w.step)}</div>
      <p style="margin-top:12px"><b>На уроке:</b> ${esc(w.classwork)}</p><p><b>Домашнее письмо:</b> ${esc(w.task)}</p>
      ${kinds.map(k => `<p style="margin-top:10px"><b>Тема${kinds.length>1?" "+k:""}:</b> ${esc(U.writingSource(c, l, k).topic)}</p>`).join("")}
      ${w.type === "izl" ? `<p class="small"><b>Микротемы (ключ):</b></p><ol class="small">${c.izl[w.text].micro.map(m => `<li>${esc(m)}</li>`).join("")}</ol>` : ""}
      <details style="margin-top:8px"><summary><b>Текст</b></summary><div class="ttext">${U.writingSource(c, l, kinds[0]).html}</div></details>`;
  }
  if (T.sub === "mnemo") body = U.mnemoTabHTML(l);
  if (T.sub === "test") body = testEditor(cid, l, "test");
  if (T.sub === "hwtest") body = testEditor(cid, l, "hwtest");
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
  const studs = T.students.filter(x => x.registered_at && x.course);
  const toPlan = sb && T.session && ok && studs.length ? `<div class="card row" style="gap:8px;margin-bottom:12px"><span class="small"><b>В план ученика</b> (на ближайший урок, остальные сдвинутся):</span>
    <select id="lt-student" style="width:auto" aria-label="Ученик">${studs.map(x => `<option value="${x.id}">${esc(x.name)} · ${esc(U.subj(subjOfS(x)).n)}${x.grade != null ? ", " + x.grade + " кл." : ""}</option>`).join("")}</select>
    <button class="btn sm" data-act="lesson-to">Добавить</button></div>` : "";
  return toPlan + `<div class="row between" style="margin-bottom:12px"><button class="btn ghost sm" data-view="course">← Все уроки</button>
    <div class="row">${i>0?`<button class="btn ghost sm" data-lesson="${c.lessons[i-1].id}">‹ № ${i}</button>`:""}${i<c.lessons.length-1?`<button class="btn ghost sm" data-lesson="${c.lessons[i+1].id}">№ ${i+2} ›</button>`:""}</div></div>
  <article class="window glass" style="--c:${b.color}">
    <div class="head"><div class="corners"><div class="mono muted">Дата по плану:<br><b style="color:var(--ink)">${fmt(l.date,{day:"numeric",month:"long",year:"numeric"})}</b></div><div class="mono muted">${esc(c.goal || "Раздел")}:<br><b style="color:var(--ink)">${esc(l.oge)}</b></div></div>
      <h1>${esc(l.title)}</h1><div class="rule">✦</div><p class="mono muted">${esc(b.name)} · урок ${i+1} из ${c.lessons.length}</p></div>
    <div class="tabs"><span class="lights" aria-hidden="true"><i></i><i></i><i></i></span>${tabs.map(([k,n]) => `<button data-sub="${k}" aria-pressed="${T.sub===k}">${n}</button>`).join("")}</div>
    <div class="pane">${body}</div></article>`;
}

const PLANS = [
  {k:"basic", n:"Базовый", d:"Для своих материалов", list:["Ученики по всем предметам и классам","Свои уроки, тесты, ссылки и файлы","Общая доска, личная доска, созвон","Карта успеха и статистика учеников"]},
  {k:"materials", n:"С материалами", d:"Готовая база + анализ", list:["Всё из «Базового»","Встроенная база: ОГЭ, ЕГЭ, школьная программа по ФРП","Мини-практика, тесты и ключи к урокам","Нейросеть: анализ ученика и гибкий план"]},
  {k:"full", n:"Полный", d:"Всё + нейросеть", list:["Всё из «С материалами»","Проверка сочинений и изложений нейросетью","Составление заданий и тестов нейросетью","Все новые возможности первыми"]}
];
const PRICE = k => (T.me?.prices || {})[k] ?? {basic:100, materials:300, full:500}[k];
const fmtD = x => x ? new Date(x).toLocaleDateString("ru-RU", {day:"numeric", month:"long", year:"numeric"}) : "";
function subBanner(){
  const m = T.me; if (!m || m.role === "developer") return "";
  const left = m.paid_until ? Math.ceil((new Date(m.paid_until) - Date.now()) / 864e5) : -1;
  if (!m.active) return `<div class="card row between" style="margin-bottom:16px;outline:2px solid var(--bad)"><p><b>Подписка закончилась.</b> Ученики и материалы сохранены; чтобы добавлять новых учеников и пользоваться базой, продлите подписку.</p><button class="btn sm" data-view="sub">Продлить</button></div>`;
  if (m.trial || left <= 5) return `<div class="card row between" style="margin-bottom:16px"><p>${m.trial ? "Пробный период" : "Подписка"}: осталось ${left} дн. (до ${fmtD(m.paid_until)}).</p><button class="btn sm ghost" data-view="sub">${m.trial ? "Выбрать тариф" : "Продлить"}</button></div>`;
  return "";
}
function viewSub(){
  const m = T.me || {};
  return `<section class="hero glass" style="min-height:150px"><span class="mono muted">Подписка</span><h1>Тарифы</h1>
      <p>${m.role === "developer" ? "У разработчика открыто всё." : m.active ? `Сейчас: «${esc((PLANS.find(p => p.k === m.active) || {}).n || "")}»${m.trial ? " (пробный период)" : ""} до ${fmtD(m.paid_until)}.` : "Подписки сейчас нет."}</p><img class="cat" data-m src="${U.mascot()}" alt=""></section>
    <div class="grid2" style="margin-top:18px">${PLANS.map(p => `<div class="card stack ${m.active === p.k && !m.trial ? "accent" : ""}" style="gap:10px">
      <div class="kicker">${esc(p.d)}</div><h2 style="font-family:var(--f-display);font-size:1.5rem">${esc(p.n)}</h2>
      <div><span class="big tnum">${PRICE(p.k)} ₽</span> <span class="muted">в месяц</span></div>
      <ul class="small" style="margin:0;padding-left:18px">${p.list.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      <div style="margin-top:auto"><button class="btn" data-pay="${p.k}">${m.active === p.k && !m.trial ? "Продлить на 30 дней" : "Оплатить 30 дней"}</button></div></div>`).join("")}</div>
    <p class="small muted" style="margin-top:12px">Оплата картой или через СБП на странице ЮKassa. Доступ открывается сразу после оплаты. Если сменить тариф, новый действует 30 дней с дня оплаты.</p>`;
}

function viewLook(){
  return `<div class="section-title" style="margin-top:6px"><h2>Оформление</h2></div>
  <div class="card stack"><h3>Тема</h3><p class="small muted">Фон, стекло, папки и кнопки – в одной гамме. Своё фото: цвета подберутся по нему (хранится только на этом устройстве).</p>${U.themesHTML(localStorage.getItem("oge-theme-t") || T.me?.theme)}</div>
  <div class="card stack" style="margin-top:16px"><h3>Помощник</h3>${U.mascotsHTML(localStorage.getItem("oge-mascot-t") || "kotik")}</div>`;
}

/* ---------- уроки из любого класса и предмета: копия в план конкретного ученика (и напарника) ---------- */
const nextWeek = d => U.iso(new Date(new Date(d + "T00:00:00").getTime() + 7 * 864e5));
function nextLessonDate(s){ const L = U.courseFor(s, T.mats)?.lessons || []; return (L.find(l => l.date >= isoToday()) || {}).date || isoToday(); }
async function insertLesson(s, srcCid, srcLid, date, shift){
  await ensureCourses([srcCid]);
  const src = teacherCourse(srcCid), l = src?.lessons.find(x => x.id === srcLid);
  if (!l || !(access(srcCid) || l.custom)){ toast("Этот урок недоступен в вашем тарифе"); return null; }
  const lid = "x" + U.randHex(4), keys = keysFor(srcCid, l);
  const data = {title: l.title, date, learn: l.learn?.length ? l.learn : [l.title], oge: src.course, theory: l.theory || [], practice: l.practice || [], test: l.test || [], hwtest: l.hwtest || [], hw: l.hw || "", writing: null, method: l.method || null, from: `${srcCid}/${srcLid}`};
  const ids = [s.id, s.pair_id].filter(id => { const o = T.students.find(x => x.id === id); return o && o.course === s.course; });
  for (const id of ids){
    const o = T.students.find(x => x.id === id), dates = {...(o.dates || {})};
    if (shift){ const L = U.courseFor(o, T.mats)?.lessons || [], k = L.findIndex(x => x.date >= date);
      if (k >= 0){ const slots = [...L.slice(k).map(x => x.date), nextWeek(L[L.length - 1].date)]; L.slice(k).forEach((x, j) => dates[x.id] = slots[j + 1]); } }
    const {data: m, error} = await sb.from("materials").insert({course: s.course, lesson_id: lid, kind: "lesson", student_id: id, title: l.title, data}).select().single();
    if (error){ toast("Не сохранилось: " + error.message); return null; }
    T.mats.push(m);
    if (shift) await upd(id, {dates});
    cmd(id, "refresh", {msg: `В план добавлен урок «${l.title}»`});
  }
  if (keys.some(k => k)){ const {data: km} = await sb.from("materials").insert({course: s.course, lesson_id: lid, kind: "keys", title: "Ключи", data: Object.fromEntries(keys.map((k, i) => [i, k]).filter(x => x[1]))}).select().single(); if (km) T.mats.push(km); }
  return lid;
}
function takePick(s, mode){
  const tk = T.take = T.take || {}, subj = tk.subj || subjOfS(s), cids = U.coursesOf(subj);
  const cid = cids.includes(tk.course) ? tk.course : cids.includes(s.course) ? s.course : cids[0];
  const c = cid && teacherCourse(cid);
  if (c?.locked && T.me?.base && window.CATALOG?.[cid] && !T.loaded?.has(cid)) ensureCourses([cid]).then(ok => ok && render());
  const L = !c ? [] : access(cid) ? c.lessons : c.lessons.filter(l => l.custom);
  return `<div class="stack" style="gap:8px">
    <div class="row" style="gap:8px"><select id="tk-subj" aria-label="Предмет" style="width:auto">${U.SUBJECTS.map(x => `<option value="${x.k}" ${x.k === subj ? "selected" : ""}>${x.e} ${esc(x.n)}</option>`).join("")}</select>
    <select id="tk-course" aria-label="Класс и курс" style="width:auto;max-width:100%">${cids.map(k => `<option value="${k}" ${k === cid ? "selected" : ""}>${esc(U.getCourse(k).course)}${access(k) ? "" : " 🔒"}</option>`).join("")}</select></div>
    ${L.length ? `<select id="tk-lesson" aria-label="Урок">${L.map((l, i) => `<option value="${l.id}">№ ${i + 1} · ${esc(l.title)}</option>`).join("")}</select>`
      : `<p class="small muted">${c?.locked && T.me?.base ? "Загружаю уроки…" : access(cid) ? "В этом курсе пока нет уроков." : "Курс откроется в тарифе «С материалами»."}</p>`}
    ${mode === "student" ? `<label for="tk-date">Дата урока</label><input type="date" id="tk-date" value="${esc(nextLessonDate(s))}" style="width:auto">
      <label class="small row" style="gap:8px"><input type="checkbox" id="tk-shift" checked style="width:auto"> Вместо урока на эту дату – следующие уроки сдвинутся</label>` : ""}
    ${L.length ? `<div><button class="btn sm" data-act="take" data-mode="${mode}">${mode === "room" ? "Провести сейчас" : "Добавить в план ученика"}</button></div>` : ""}</div>`;
}
/* ---------- урок онлайн: звонок + общая доска + интерактивные задания ученика, всё сразу ---------- */
const isoToday = () => U.iso(new Date());
/* урок по плану: тот, чья дата ближе всего к сегодняшней (сегодняшний – в первую очередь; при равенстве – ближайший следующий) */
function lessonNow(c){
  const L = c?.lessons || []; if (!L.length) return "free";
  const t0 = new Date(isoToday() + "T00:00:00").getTime(), dist = l => new Date(l.date + "T00:00:00").getTime() - t0;
  return L.reduce((best, l) => { const a = Math.abs(dist(l)), b = Math.abs(dist(best)); return a < b || (a === b && dist(l) > 0 && dist(best) < 0) ? l : best; }, L[0]).id;
}
/* у каждого ученика своя ссылка на созвон: что вставлено – сразу закрепляется за ним */
const isCall = u => /^https?:\/\/\S+$/.test(u || "");
async function saveCall(s, u, quiet){
  u = (u || "").trim(); if (!isCall(u) || u === s.call_url) return false;
  if (!(await upd(s.id, {call_url: u}))) return false;
  if (T.room?.sid === s.id) T.room.url = u;
  cmd(s.id, "refresh", {msg: "Учитель добавил ссылку на занятие"});
  if (!quiet) toast(`Ссылка закреплена за учеником: ${s.name}`);
  return true;
}
function callOf(s){ const v = $("#call-url")?.value.trim(); return isCall(v) ? v : s.call_url || ""; }
/* «Создать встречу в Телемосте» → скопировали ссылку → вернулись на сайт: подхватываем её из буфера обмена */
window.addEventListener("focus", async () => {
  const sid = T.awaitLink; if (!sid || !navigator.clipboard?.readText) return;
  try{
    const u = (await navigator.clipboard.readText()).trim(), s = T.students.find(x => x.id === sid);
    if (s && /^https:\/\/telemost\.(yandex|360\.yandex)\.ru\/j\/\S+$/.test(u) && u !== s.call_url){ T.awaitLink = null; if (await saveCall(s, u)) render(); }
  }catch(_){}
});
function roomSend(type){
  const r = T.room; if (!r) return;
  const s = T.students.find(x => x.id === r.sid), c = U.courseFor(s, T.mats), l = r.lesson === "free" ? FREE : c?.lessons.find(x => x.id === r.lesson);
  r.to.forEach(id => cmd(id, type, {lesson: r.lesson, url: r.url, title: l?.title || ""}));
  roomTrack();
}
/* идущий урок хранится на сервере: после случайного выхода или с другого устройства к нему можно вернуться */
let roomSaveT = 0;
function roomBanner(){
  if (!T.session || T.view === "room") return "";
  const rm = T.room || (T.me?.room && Date.now() - (T.me.room.at || 0) < 5 * 3600e3 ? T.me.room : null); if (!rm) return "";
  const st = T.students.find(x => x.id === rm.sid); if (!st) return "";
  const l = U.courseFor(st, T.mats)?.lessons.find(x => x.id === rm.lesson);
  return `<div class="card accent row between" style="gap:10px;flex-wrap:wrap;margin-bottom:14px"><div style="min-width:0"><div class="kicker"><span class="live-dot" aria-hidden="true"></span> Идёт урок</div>
    <b>${esc(st.name)}</b>${l ? ` · ${esc(l.title)}` : ""}</div>
    <div class="row" style="gap:8px"><button class="btn" data-act="room-back">↩ Вернуться к уроку</button>${T.room ? "" : `<button class="btn ghost sm" data-act="room-forget">Урок уже закончился</button>`}</div></div>`;
}
function roomPersist(){
  clearTimeout(roomSaveT);
  roomSaveT = setTimeout(() => { if (!sb || !T.session) return; const r = T.room;
    sb.rpc("teacher_set_room", {p_room: r ? {sid: r.sid, lesson: r.lesson, tab: r.shown || r.tab || null, at: r.at || Date.now(), to: r.to} : null}).then(() => {}, () => {}); }, 400);
}
function roomTrack(){ roomPersist(); if (T.live && T.liveOk) T.live.track({role:"teacher", room: T.room ? {to: T.room.to, lesson: T.room.lesson, url: T.room.url, at: T.room.at} : null}).catch(() => {}); }
/* учитель решил провести сегодня другой урок: он встаёт на дату урока по плану, а пропущенные папки сдвигаются на следующие занятия */
function replanDates(s, base, planned, chosen){
  const c = U.courseFor({...s, dates: base}, T.mats), L = c?.lessons || [];
  const pi = L.findIndex(l => l.id === planned), qi = L.findIndex(l => l.id === chosen);
  if (pi < 0 || qi < 0 || pi === qi) return null;
  const next = d => U.iso(new Date(new Date(d + "T00:00:00").getTime() + 7 * 864e5));
  const seq = qi > pi ? [L[qi], ...L.slice(pi, qi)] : [L[qi], ...L.slice(pi)];
  const slots = qi > pi ? L.slice(pi, qi + 1).map(l => l.date) : [...L.slice(pi).map(l => l.date), next(L[L.length - 1].date)];
  const dates = {...base}; seq.forEach((l, k) => dates[l.id] = slots[k]); return dates;
}
async function roomReplan(){
  const r = T.room; if (!r?.planned) return;
  const ids = r.to.filter(id => { const o = T.students.find(x => x.id === id); return o && o.course === T.students.find(x => x.id === r.sid).course; });
  let changed = false;
  for (const id of ids){
    const o = T.students.find(x => x.id === id), base = r.base[id] || {};
    const keep = r.lesson === "free" || r.lesson === r.planned || r.covered?.has(r.planned) || r.keepPlan;
    const dates = keep ? base : replanDates(o, base, r.planned, r.lesson) || base;
    if (JSON.stringify(dates) !== JSON.stringify(o.dates || {})){ if (await upd(id, {dates})){ changed = true; cmd(id, "refresh", {msg: "Учитель перестроил план уроков"}); } }
  }
  r.moved = r.lesson !== "free" && r.lesson !== r.planned && !r.covered?.has(r.planned) && !r.keepPlan;
  if (changed){ render(); const s = T.students.find(x => x.id === r.sid), P = U.courseFor(s, T.mats)?.lessons.find(x => x.id === r.planned);
    toast(r.moved ? `План перестроен: «${P?.title || "урок по плану"}» перенесён на следующее занятие, остальные сдвинулись` : "План уроков возвращён как был"); }
}
/* пройдено на уроке: урок, с которым работали не меньше 3 минут, отмечается в результатах ученика и открывается ему */
const COVER_MS = 180000;
async function roomCover(force){
  const r = T.room; if (!r || r.lesson === "free" || r.covered.has(r.lesson)) return;
  if (!force && Date.now() - r.since < COVER_MS) return;
  if (force && Date.now() - r.since < 60000) return;
  r.covered.add(r.lesson);
  for (const id of r.to){
    const o = T.students.find(x => x.id === id); if (!o) continue;
    const covered = {...(o.covered || {}), [r.lesson]: isoToday()}, unlocked = [...new Set([...(o.unlocked || []), r.lesson])];
    await upd(id, {covered, unlocked});
  }
}
async function roomSetLesson(lid){
  const r = T.room; if (!r || lid === r.lesson) return;
  await roomCover(false);
  r.lesson = lid; r.since = Date.now(); r.tab = null;
  roomSend("lesson"); render(); roomReplan();
}
function startCallT(s){
  if (!window.Call || !T.session) return;
  Call.join({sb, room: `${s.teacher_id || T.session.user.id}-${ownerOf(s)}`, me: "t-" + T.session.user.id, name: T.me?.name || CFG.TEACHER_NAME || "Учитель",
    onConnected: (id, name) => { toast(`${name || "Ученик"} подключился к видеозвонку`); if (T.room && T.view !== "room"){ T.sel = T.room.sid; T.view = "room"; render(); scrollTo(0, 0); } }});
}
/* присоединиться к уже идущему уроку (с другого устройства или после выхода): ничего не сбрасываем, ученику ничего не шлём, звонок – по кнопке */
/* выбор урока на занятии: сначала курс (любой курс предмета, любой класс), потом тема */
function roomPicker(s, c, r){
  const own = s.course, cids = [...new Set([own, ...U.coursesOf(subjOfS(s))])].filter(Boolean), cid = r.pickCourse && cids.includes(r.pickCourse) ? r.pickCourse : own;
  if (cid !== own){ const cc = teacherCourse(cid); if (cc?.locked && T.me?.base && window.CATALOG?.[cid] && !T.loaded?.has(cid)) ensureCourses([cid]).then(ok => ok && render()); }
  const L = cid === own ? c.lessons : (() => { const cc = teacherCourse(cid); return !cc ? [] : access(cid) ? cc.lessons : cc.lessons.filter(l => l.custom); })();
  return `<select id="room-course" aria-label="Курс" style="width:auto;max-width:260px">${cids.map(k => `<option value="${k}" ${k === cid ? "selected" : ""}>${esc(U.getCourse(k)?.course || k)}${k === own ? " · план ученика" : access(k) ? "" : " 🔒"}</option>`).join("")}</select>
    <select id="room-lesson" aria-label="Тема" style="width:auto;max-width:320px"><option value="free" ${r.lesson === "free" ? "selected" : ""}>Свободная доска</option>${L.map((x, i) => `<option value="${x.id}" ${cid === own && x.id === r.lesson ? "selected" : ""}>№ ${i + 1} · ${esc(x.title)}${cid === own && x.id === r.planned ? " · по плану" : ""}${cid === own && (r.covered.has(x.id) || s.covered?.[x.id]) ? " · пройден" : ""}</option>`).join("")}${cid !== own ? `<option value="" selected disabled>– выберите тему –</option>` : ""}</select>`;
}
function joinRoom(s, rm){
  const c = U.courseFor(s, T.mats), planned = c?.lessons.length ? lessonNow(c) : null, to = rm.to?.length ? rm.to : [s.id, s.pair_id].filter(Boolean);
  T.room = {sid: s.id, to, lesson: rm.lesson || planned || "free", planned, keepPlan: true, since: Date.now(), covered: new Set(),
    base: Object.fromEntries(to.map(id => [id, {...(T.students.find(x => x.id === id)?.dates || {})}])), url: callOf(s), at: rm.at || Date.now(), tab: rm.tab || null, shown: rm.tab || null, who: s.id, joined: true};
  T.sel = s.id; T.view = "room"; T.drawer = false; render(); scrollTo(0, 0);
  toast("Вы на идущем уроке. Видеозвонок – кнопкой «🎥 Видеозвонок», если нужен на этом устройстве");
}
function startRoom(s, lesson, keepPlan){
  let url = callOf(s); if (url && url !== s.call_url) saveCall(s, url, true);
  if (!url){ toast("Ссылка на созвон не добавлена: откройте Телемост, скопируйте ссылку встречи и вставьте её в поле «Ссылка на созвон» — ученик получит её сразу."); }
  const c = U.courseFor(s, T.mats), planned = c?.lessons.length ? lessonNow(c) : null;
  const to = [s.id, s.pair_id].filter(Boolean);
  T.room = {sid: s.id, to, lesson: lesson || planned || "free", planned, keepPlan: !!keepPlan, since: Date.now(), covered: new Set(),
    base: Object.fromEntries(to.map(id => [id, {...(T.students.find(x => x.id === id)?.dates || {})}])), url, at: Date.now(), tab: null, who: s.id};
  T.sel = s.id; T.view = "room"; T.drawer = false; render(); scrollTo(0, 0);
  startCallT(s);
  roomSend("lesson"); if (T.room.lesson !== planned && !keepPlan) roomReplan();
  toast(T.online[s.id] ? "Ученику пришло приглашение на урок" : "Ученик пока не в сети – приглашение появится, как только он зайдёт");
}
const ROOM_TABS = {lab: "Тренажёр", theory: "Теория", mnemo: "Запоминалки", practice: "Практика", writing: "Письмо", mats: "Материалы", hw: "Домашка", test: "Тест"};
function roomTabs(l){
  return [l.lab === "izl" && ["lab"], ["theory"], U.hasMnemo(l) && ["mnemo"], l.practice?.length && ["practice"], l.writing && ["writing"], ((l.materials || []).length || l.stub) && ["mats"], (l.hw || l.hwtest?.length) && ["hw"], U.lessonTests(l).test.length && ["test"]]
    .filter(Boolean).map(([k]) => [k, ROOM_TABS[k]]);
}
/* ответы ученика: что выбрал, что верно */
function answersHTML(list, open){
  const L = (list || []).filter(Boolean); if (!L.length) return "";
  return `<details class="small" ${open ? "open" : ""} style="margin-top:8px"><summary><b>Ответы ученика (${L.filter(x => x.ok).length} из ${L.length} верно)</b></summary><ol class="ans-list">${L.map(x => `<li class="${x.ok ? "ok" : "bad"}"><b>${esc(x.q)}</b><br>${x.ok ? "✓" : "✗"} ответ ученика: <b>${esc(x.given || "–")}</b>${x.ok ? "" : ` · верно: <b>${esc(x.right)}</b>`}</li>`).join("")}</ol></details>`;
}
function liveTestHTML(m){
  if (!m) return `<p class="small muted">Когда ученик начнёт тест, здесь будет видно каждый его ответ.</p>`;
  const kind = m.kind === "hw" ? "ДЗ-тест" : "Тест";
  if (m.quit) return `<p class="small muted">${kind}: ученик вышел из теста на вопросе ${m.i + 1} из ${m.n}.</p>${answersHTML(m.log, true)}`;
  if (m.done) return `<div class="row"><span class="chip ${U.lvl(Math.round(m.score / m.n * 100))}">${kind} завершён: ${m.score} из ${m.n}</span></div>${answersHTML(m.log, true)}`;
  const q = m.q; if (!q) return "";
  const answered = m.picked != null;
  return `<div class="kicker"><span class="live-dot" aria-hidden="true"></span> ${kind} идёт · вопрос ${m.i + 1} из ${m.n} · верно ${m.score}</div>
    <p style="margin:6px 0"><b>${esc(q.q)}</b></p>
    ${q.pn ? `<div class="small">Ключ:</div>${U.pnHTML(q.pn, q.pn.a, {ro: true})}${answered ? `<div class="small">Ответ ученика – ${m.ok ? "верно" : "неверно"}:</div>${U.pnHTML(q.pn, m.sel || [], {ro: true, key: true})}` : ""}`
      : q.o ? `<ul class="lt-opts">${q.o.map((o, k) => `<li class="${k === q.a ? "ok" : ""} ${answered && k === m.picked ? (k === q.a ? "pick good" : "pick bad") : ""}">${esc(o)}${k === q.a ? " ✓" : ""}${answered && k === m.picked ? " ← ответ ученика" : ""}</li>`).join("")}</ul>`
      : `<p class="small">Ответ ученика: <b>${answered ? esc(m.typed) : "…"}</b>${answered ? (m.ok ? " – верно" : " – неверно") : ""} · ключ: ${esc(String(q.a).split("|")[0])}</p>`}
    ${answered ? "" : `<p class="small muted">Ученик думает…</p>`}${answersHTML(m.log, false)}`;
}
function roomPane(s, c, l, tab){
  const who = T.students.find(x => x.id === T.room.who) || s, pair = s.pair_id && T.students.find(x => x.id === s.pair_id);
  const whoSeg = pair ? `<div class="seg" role="group" aria-label="Чьи ответы" style="margin-bottom:10px">${[s, pair].map(o => `<button data-act="room-who" data-id="${o.id}" aria-pressed="${o.id === who.id}">${esc(o.name.split(" ")[0])}</button>`).join("")}</div>` : "";
  const ctx = {cid: s.course, lid: l.id, sid: s.id};
  if ((tab === "theory" || tab === "practice") && ceOpen(ctx, tab) && !T.ce.modal) return ceEditor(ctx, l, tab);
  if (tab === "theory") return ceBar(ctx, l, "theory") + (l.theory?.length ? U.theoryHTML(l, true) : `<p class="muted">У этого урока нет теории – добавьте блок или см. «Материалы».</p>`);
  if (tab === "mnemo") return U.mnemoTabHTML(l);
  if (tab === "practice"){
    const keys = keysFor(who.course, l), st = Object.fromEntries((T.works || []).filter(w => w.student_id === who.id && w.lesson_id === l.id).map(w => [w.task, w.data]));
    return ceBar(ctx, l, "practice") + whoSeg + `<p class="small muted">Тетрадь ${esc(who.name.split(" ")[0])} – обновляется вживую, рядом ключи.</p>`
      + `<div id="wk-view">${l.practice.map((p, i) => Work.task({...p, key: keys[i]}, i, st[i] || {}, true).replace('class="task wk"', 'class="task wk ro"')).join("")}</div>`;
  }
  if (tab === "lab") return labPaneT(who, c, true);
  if (tab === "writing"){
    const w = (T.writings || []).find(x => x.student_id === who.id && x.lesson_id === l.id);
    const izl = l.writing?.type === "izl" && c.izl?.[l.writing.text];
    return whoSeg + `<p><b>Задание:</b> ${esc(l.writing.task || "")}</p>${izl && window.Izl ? `<p class="small muted" style="margin-top:6px">Ученик может включить озвучку у себя во вкладке «Письмо». Или прочитайте сами: текст ниже (ученику он скрыт).</p>${Izl.html(izl.paras, "t" + l.id)}<details style="margin-top:8px"><summary class="small">Текст «${esc(izl.title)}» и микротемы</summary>${izl.paras.map((p, i) => `<p style="margin:6px 0"><b>${i + 1}.</b> ${esc(p)}</p>`).join("")}<p class="small"><b>Микротемы:</b> ${izl.micro.map(esc).join(" · ")}</p></details>` : ""}${w ? `<div class="card" style="box-shadow:none;margin-top:10px"><div class="kicker">Работа ученика · ${w.status === "sent" ? "ждёт проверки" : "проверено"}</div><div style="white-space:pre-line;margin-top:6px">${esc(w.body || "")}</div>${(w.photos || []).map(u => `<img src="${esc(u)}" alt="Фото работы" style="max-height:260px;border-radius:10px;margin-top:8px">`).join("")}</div>` : `<p class="small muted">Ученик ещё не прислал работу.</p>`}`;
  }
  if (tab === "mats") return (l.materials || []).length ? (l.materials || []).map(m => m.data?.kind === "game" ? `<div class="mat"><span class="ic">🎮</span><div style="min-width:0;flex:1"><b>${esc(m.title || "Игра")}</b> <button class="btn ghost sm" data-act="game-play" data-mid="${m.id}">▶ Посмотреть</button><p class="small muted">Ученик видит игру во вкладке «Материалы».</p></div></div>` : `<div class="mat"><span class="ic">${{link:"🔗", file:"📎", text:"📝", tasks:"✏️"}[m.kind] || "•"}</span><div style="min-width:0;flex:1">${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title || m.url)}</a>` : `<b>${esc(m.title || "Материал")}</b>`}${m.body ? `<div class="small" style="white-space:pre-line">${esc(m.body)}</div>` : ""}</div></div>`).join("") : `<p class="muted">Своих материалов к уроку нет.</p>`;
  if (tab === "hw"){
    const h = (T.hw || []).find(x => x.student_id === who.id && x.lesson_id === l.id);
    return whoSeg + `<ol style="padding-left:20px">${l.hw ? `<li>${esc(l.hw)}</li>` : ""}${l.hwtest?.length ? `<li>ДЗ-тест: ${l.hwtest.length} вопросов.</li>` : ""}</ol>
      <p class="small">Статус у ученика: <b>${h?.status === "accepted" ? "принято" : h?.status === "redo" ? "на доработке" : h?.status ? "сдано" : "не сдано"}</b>${h?.note ? " · " + esc(h.note) : ""}</p>
      <div class="card" style="box-shadow:none;margin-top:10px" id="live-test">${liveTestHTML(T.liveTest?.[who.id]?.lesson === l.id && T.liveTest[who.id].kind === "hw" ? T.liveTest[who.id] : null)}</div>`;
  }
  if (tab === "test"){
    const qs = U.lessonTests(l).test, rs = (T.rows || []).filter(x => x.student_id === who.id && x.lesson_id === l.id && x.kind === "lesson");
    return whoSeg + `<div class="card" style="box-shadow:none;margin-bottom:12px" id="live-test">${liveTestHTML(T.liveTest?.[who.id]?.lesson === l.id && T.liveTest[who.id].kind !== "hw" ? T.liveTest[who.id] : null)}</div>
      ${rs.length ? `<p class="small">Попытки: ${rs.map(x => `<span class="chip">${x.score}/${x.total}</span>`).join(" ")}</p>${rs.at(-1)?.answers ? answersHTML(rs.at(-1).answers, false).replace("Ответы ученика", "Ответы последней попытки") : ""}` : ""}
      <details><summary class="small">Все вопросы с ответами (${qs.length})</summary><ol style="padding-left:20px">${qs.map(q => `<li style="margin:8px 0"><b>${esc(q.q)}</b>${q.pn ? U.pnHTML(q.pn, q.pn.a, {ro: true}) : q.o ? `<ul>${q.o.map((o, k) => `<li ${k === q.a ? 'style="color:var(--good);font-weight:800"' : ""}>${esc(o)}${k === q.a ? " ✓" : ""}</li>`).join("")}</ul>` : `<div class="small">Ответ: ${esc(String(q.a).split("|")[0])}</div>`}</li>`).join("")}</ol></details>`;
  }
  return "";
}
function viewRoom(){
  const r = T.room, s = r && T.students.find(x => x.id === r.sid);
  if (!s){ T.view = "students"; return viewStudents(); }
  const c = U.courseFor(s, T.mats) || {lessons: [], blocks: {}}, l = r.lesson === "free" ? FREE : c.lessons.find(x => x.id === r.lesson) || FREE;
  const pair = s.pair_id && T.students.find(x => x.id === s.pair_id);
  const tabs = l.free ? [] : roomTabs(l), tab = tabs.some(t => t[0] === r.tab) ? r.tab : tabs[0]?.[0]; r.shown = tab || null;
  const where = T.online[s.id];
  return `<div class="roombar glass">
      <div class="row" style="gap:8px;min-width:0"><span class="live-dot" aria-hidden="true"></span><b>Урок: ${esc(s.name)}${pair ? " и " + esc(pair.name) : ""}</b><span data-online="${s.id}"></span></div>
      <div class="row" style="gap:8px">
        ${roomPicker(s, c, r)}
        ${window.Call && !Call.active() ? `<button class="btn sm" data-act="call-start">🎥 Видеозвонок</button>` : ""}
        ${r.url ? `<a class="btn ghost sm" href="${esc(r.url)}" target="_blank" rel="noopener" title="Если видеозвонок не соединяется">Звонок по ссылке</a>` : ""}
        <button class="btn ghost sm" data-act="room-invite" title="Ученик сразу окажется на уроке, чем бы он ни занимался">Позвать</button>
        <button class="btn ghost sm" data-act="room-end">Завершить</button></div>
      ${r.moved ? `<div class="small" style="flex-basis:100%">Сегодня вместо урока по плану – папки перенесены на следующие занятия. <button class="linkbtn" data-act="room-undo">Вернуть план</button></div>` : ""}</div>
  ${r.take ? `<div class="card" style="margin-bottom:14px"><div class="kicker">Сегодня – урок из другого класса или предмета</div><p class="small muted">Урок встанет на сегодняшнее занятие, папки по плану сдвинутся на следующие.</p>${takePick(s, "room")}</div>` : ""}
  <div class="room">
    <article class="window glass room-board" style="--c:${blockOf(c, l).color}"><div class="head row between" style="gap:8px;flex-wrap:wrap"><h1 style="font-size:1.25rem">${esc(l.title)}</h1>
      <span class="row" style="gap:8px;align-items:center"><span class="small muted" data-where="${s.id}">${where ? `Ученик сейчас: ${esc(where.where || "")}` : "Ученик пока не на уроке"}</span>
      <button class="btn sm" data-act="room-move" title="Открыть ученику этот урок и этот лист">➜ Перенести ученика сюда</button></span></div>
      <p class="small muted room-hint">Урок прямо на доске: листы вверху – теория, задания, тест, письмо. 👆 – работать с листом (нажимать, вписывать), ✎ – писать поверх. Ученик видит тот же лист.</p>
      <div class="pane"><div class="board glass" id="board"></div></div></article>
    ${tabs.length ? `<article class="window glass room-side" style="--c:${blockOf(c, l).color}">
      <div class="tabs" role="group" aria-label="Разделы урока">${tabs.map(([k, n]) => `<button data-act="room-tab" data-tab="${k}" aria-pressed="${tab === k}">${n}</button>`).join("")}</div>
      <div class="pane"><p class="small muted" style="margin-bottom:8px">Заметки учителя: ключи, ответы, ход теста и подсказки. На доске слева – лист ученика (чтобы пометки совпадали).</p><div class="room-pane">${roomPane(s, c, l, tab)}</div></div></article>` : ""}
  </div>`;
}
function render(){
  const need = ["course","lesson","methodology"].includes(T.view) ? [curCourse()] : T.view === "student" ? [T.students.find(x => x.id === T.sel)?.course] : [];
  if (T.me?.base && need.some(k => k && window.CATALOG?.[k] && !T.loaded?.has(k))){ ensureCourses(need).then(ok => ok && render()); }
  const logged = !!(sb && T.session);
  let html;
  if (T.view === "methodology") html = viewMethodology();
  else if (T.view === "look") html = viewLook();
  else if (T.view === "sub" && sb && T.session) html = viewSub();
  else if (T.view === "devcode" && sb && T.session) html = viewDevCode();
  else if (["course","lesson"].includes(T.view)) html = T.view === "course" ? viewCourse() : viewLesson();
  else if (!sb) html = viewNoServer();
  else if (T.view === "newpass") html = viewNewPass();
  else if (!T.session) html = viewLogin();
  else html = T.view === "student" ? viewStudent() : T.view === "board" ? viewBoard() : T.view === "work" ? viewWork() : T.view === "room" ? viewRoom() : viewStudents();
  const cur = ["students","student","board","room"].includes(T.view) ? "students" : ["course","lesson"].includes(T.view) ? "course" : T.view;
  const nav = [["students","Ученики",I.users],["course","Материалы и база",I.book],["methodology","Методика курса",I.method],["sub","Подписка",I.code.replace(/<path[^>]*\/>/, '<path d="M3 7h18v10H3zM3 11h18"/>')],["look","Оформление",I.pen]];
  $("#app").innerHTML = `<div class="shell">
    <div class="drawer-back" ${T.drawer ? "" : "hidden"} data-act="close-drawer"></div>
    <nav class="drawer glass ${T.drawer ? "open" : ""}" aria-label="Меню">
      <div class="me"><img data-m src="${U.mascot()}" alt="" style="width:44px"><div><b>${esc(T.me?.name || CFG.TEACHER_NAME || "Учитель")}</b><div class="small muted">${T.me?.role === "developer" ? "Учитель и разработчик" : "Кабинет учителя"}</div></div></div>
      <div class="group"><span class="mono">Разделы</span>${nav.map(([k,n,ic]) => `<button class="navitem" data-view="${k}" ${cur===k?'aria-current="page"':""}>${ic}${n}</button>`).join("")}
        ${T.me?.role === "developer" ? `<a class="navitem" href="dev.html">${I.code}Кабинет разработчика</a>` : logged ? `<button class="navitem" data-view="devcode" ${T.view === "devcode" ? 'aria-current="page"' : ""}>${I.code}Режим разработчика</button>` : ""}</div>
      <div class="group"><span class="mono">Предметы</span>${U.SUBJECTS.map(x => { const n = T.students.filter(s => subjOfS(s) === x.k).length;
        return `<button class="navitem" data-view="students" data-subjf="${x.k}" ${T.view === "students" && T.subject === x.k ? 'aria-current="page"' : ""}><span class="emo">${x.e}</span>${esc(x.n)}${n ? `<span class="chip" style="margin-left:auto">${n}</span>` : ""}</button>`; }).join("")}</div>
      ${logged ? `<div class="group"><button class="navitem" data-act="logout">${I.out}Выйти</button></div>` : ""}
      <div class="drawer-foot"><button class="btn" data-act="install" style="width:100%;justify-content:center">📲 Скачать на телефон</button></div>
    </nav>
    <div style="min-width:0">
      <header class="topnav"><div class="in glass"><button class="iconbtn menu-btn" data-act="open-drawer" aria-label="Открыть меню">${I.menu}</button><span class="ttl">Кабинет учителя</span><span class="avatar">${esc((T.me?.name || CFG.TEACHER_NAME || "У")[0])}</span></div></header>
      <main class="main">${roomBanner()}${["students","course","student"].includes(T.view) && T.session ? subBanner() : ""}${html}</main></div></div>`;
  if (sb && T.session){ liveStart(); paintOnline(); T.stale = false; }
  if (["board","room"].includes(T.view) && sb && T.session && $("#board")){
    const bl = T.view === "room" ? T.room.lesson : T.boardLesson;
    const s = T.students.find(x => x.id === T.sel), c = U.courseFor(s, T.mats) || {lessons: [], blocks: {}}, l = bl === "free" ? FREE : c.lessons.find(x => x.id === bl) || FREE, owner = ownerOf(s);
    const {pages, live} = roomBoardPages(s, c, l);
    const menu = () => !s || l === FREE ? [] : [{label: "✨ Добавить тему или объяснение", run: () => ceModal(s, l, "theory")}, {label: "🧩 Сгенерировать задания", run: () => ceModal(s, l, "practice")},
      {label: "🎯 Отработать слабую зону", run: () => ceModal(s, l, "practice", weakReq(s, l))}];
    T.board = Board.keep($("#board"), `t:${owner}:${l.id}`, {api: Board.api("teacher", sb, {studentId: owner, lesson: l.id}), sb, channelName: `board-${owner}-${l.id}`, role: "teacher", name: T.me?.name || CFG.TEACHER_NAME || "Учитель", pages, live, page: T.view === "room" ? T.room?.shown || pages[0]?.key : undefined, onPage: p => { if (T.view === "room" && T.room){ T.room.tab = T.room.shown = p; roomPersist(); } }, menu});
  }
  if (!$("#board")){ Board.release(); T.board = null; }
  if (T.session && !T.loading && T.routeReady) try { sessionStorage.setItem("t-route", JSON.stringify({view: T.view, sel: T.sel, open: T.open, sub: T.sub, courseId: T.courseId, matSubject: T.matSubject, boardLesson: T.boardLesson, workLesson: T.workLesson, room: T.room ? {sid: T.room.sid, lesson: T.room.lesson} : null, y: scrollY})); } catch(_) {}
  /* правка урока поверх доски: ученик черновик не видит, получает только сохранённый блок */
  document.querySelector(".ce-modal-back")?.remove();
  if (T.ce?.modal && sb && T.session){
    const l = ceLesson(T.ce.ctx);
    if (l){ const box = document.createElement("div"); box.className = "ce-modal-back"; box.innerHTML = `<div class="ce-modal glass" role="dialog" aria-modal="true" aria-label="Нейросеть на уроке"><div class="row between" style="margin-bottom:8px"><b>${T.ce.kind === "theory" ? "Новая тема или объяснение" : "Новые задания"} · ${esc(l.title)}</b><button class="iconbtn" data-act="ce-close" aria-label="Закрыть">✕</button></div>${ceEditor(T.ce.ctx, l, T.ce.kind)}</div>`; document.body.appendChild(box); }
  }
}
/* листы доски на уроке: разделы урока – «живые» (как у учителя справа раньше), плюс чистые листы и материалы */
function roomBoardPages(s, c, l){
  if (T.view !== "room" || l === FREE || l.free) return {pages: Board.pages(c, l), live: {}};
  const tabs = roomTabs(l), live = {};
  tabs.forEach(([k]) => live[k] = el => { el.innerHTML = `<div class="bd-sheet bd-live">${roomPane(s, c, l, k)}</div>`; });
  const extra = Board.pages(c, l).filter(p => !["practice", "test", "theory", "text"].includes(p.key));
  return {pages: [...tabs.map(([k, n]) => ({key: k, label: n, html: ""})), ...extra], live};
}
function weakReq(s, l){
  const rows = T.rows.filter(r => r.student_id === s.id && (r.lesson_id === l.id || r.lesson_id.endsWith(":" + l.id)) && r.wrong?.length).slice(-4);
  const wrong = [...new Set(rows.flatMap(r => r.wrong))].slice(0, 12);
  return wrong.length ? `Задания на отработку ошибок ученика по этой теме. Ошибки: ${wrong.join("; ")}` : "Задания на отработку самых частых ошибок по этой теме, от простого к трудному";
}
function ceModal(s, l, kind, req){
  const ctx = {cid: s.course, lid: l.id, sid: s.id}, l2 = ceLesson(ctx) || l;
  const keys = kind === "practice" ? keysFor(ctx.cid, l2) : [];
  T.ce = {key: ceKey(ctx), ctx, kind, modal: true, edit: null, req: req || "", all: false, n: kind === "theory" ? 1 : 3,
    items: JSON.parse(JSON.stringify(kind === "theory" ? (l2.theory || []) : (l2.practice || []).map((p, k) => ({...p, key: keys[k] ?? p.key}))))};
  render(); setTimeout(() => document.getElementById("ce-req")?.focus(), 30);
}

/* ---------- редактор тестов: вопросы как тест, правка, добавление, догенерация ---------- */
const TE_LIM = {q: 300, o: 120, e: 300, a: 80};
const teDraft = (l, kind) => T.td && T.td.lid === l.id && T.td.kind === kind ? T.td : null;
function teStart(l, kind){
  if (!teDraft(l, kind)) T.td = {lid: l.id, kind, qs: JSON.parse(JSON.stringify((kind === "test" ? l.test : l.hwtest) || [])), edit: null};
  return T.td;
}
function teOwnRow(cid, lid){ return T.mats.find(m => m.kind === "tasks" && m.data?.kind === "test-edit" && m.course === cid && m.lesson_id === lid && m.teacher_id === T.session?.user.id && !m.student_id); }
function teCheck(q){
  if (!q.q || !q.q.trim()) return "нет текста вопроса";
  if (q.q.length > TE_LIM.q) return `вопрос длиннее ${TE_LIM.q} знаков`;
  if (q.pn){ if (!q.pn.w?.length || q.pn.w.length < 3) return "нужно предложение"; if (!q.pn.a.length) return "в предложении нет ни одной запятой"; }
  else if (Array.isArray(q.o)){
    const o = q.o.map(x => String(x).trim());
    if (o.length < 2 || o.length > 6) return "нужно от 2 до 6 вариантов";
    if (o.some(x => !x)) return "есть пустой вариант";
    if (new Set(o.map(x => x.toLowerCase())).size !== o.length) return "варианты повторяются";
    if (o.some(x => x.length > TE_LIM.o)) return `вариант длиннее ${TE_LIM.o} знаков`;
    if (!(q.a >= 0 && q.a < o.length)) return "не отмечен верный ответ";
  } else if (!String(q.a || "").trim()) return "нет правильного ответа";
  if ((q.e || "").length > TE_LIM.e) return `пояснение длиннее ${TE_LIM.e} знаков`;
  return "";
}
function teQHTML(q, i, d){
  const kindName = q.pn ? "Расставить запятые" : Array.isArray(q.o) ? (q.tf ? "Верно / неверно" : "Выбор ответа") : "Ввод ответа";
  if (d && d.edit === i){
    return `<li class="te-q editing"><div class="kicker">${kindName}</div>
      <label class="small" for="te-q">Вопрос (до ${TE_LIM.q} знаков)</label><textarea id="te-q" maxlength="${TE_LIM.q}" rows="2">${esc(q.q || "")}</textarea>
      ${q.pn ? `<label class="small" for="te-pn" style="margin-top:6px">Предложение с правильно расставленными запятыми – ученик увидит его без запятых и расставит сам</label><textarea id="te-pn" rows="2" maxlength="300">${esc(U.pnText(q.pn, q.pn.a))}</textarea>`
      : Array.isArray(q.o) ? `<div class="small muted" style="margin-top:6px">Варианты: отметьте кружком верный (2–6 вариантов)</div>
        ${q.o.map((o, k) => `<div class="row te-opt" style="gap:6px;margin-top:4px"><input type="radio" name="te-a" value="${k}" ${k === q.a ? "checked" : ""} aria-label="Верный ответ" style="width:auto">
          <input class="te-o" value="${esc(o)}" maxlength="${TE_LIM.o}" ${q.tf ? "readonly" : ""} style="flex:1">${q.tf || q.o.length <= 2 ? "" : `<button class="iconbtn" data-act="te-odel" data-k="${k}" aria-label="Удалить вариант">✕</button>`}</div>`).join("")}
        ${q.tf || q.o.length >= 6 ? "" : `<button class="btn ghost sm" data-act="te-oadd" style="margin-top:6px">+ вариант</button>`}`
      : `<label class="small" for="te-ans" style="margin-top:6px">Правильный ответ (несколько вариантов – через «|», например: «росток|ростки»)</label><input id="te-ans" value="${esc(q.a || "")}" maxlength="${TE_LIM.a}">`}
      <label class="small" for="te-e" style="margin-top:6px">Пояснение после ответа (правило)</label><textarea id="te-e" maxlength="${TE_LIM.e}" rows="2">${esc(q.e || "")}</textarea>
      <div class="row" style="gap:8px;margin-top:8px"><button class="btn sm" data-act="te-ok">Готово</button><button class="btn ghost sm" data-act="te-cancel">Отмена</button><span class="small" id="te-err" style="color:var(--bad)"></span></div></li>`;
  }
  const err = d ? teCheck(q) : "";
  return `<li class="te-q"><div class="row" style="justify-content:space-between;gap:8px;align-items:flex-start"><b style="flex:1">${esc(q.q)}</b>
      <span class="row te-tools" style="gap:2px;flex:none"><button class="iconbtn" data-act="te-edit" data-i="${i}" title="Изменить" aria-label="Изменить">✎</button><button class="iconbtn" data-act="te-up" data-i="${i}" title="Выше" aria-label="Выше">↑</button><button class="iconbtn" data-act="te-down" data-i="${i}" title="Ниже" aria-label="Ниже">↓</button><button class="iconbtn" data-act="te-del" data-i="${i}" title="Удалить" aria-label="Удалить">🗑</button></span></div>
    ${q.pn ? U.pnHTML(q.pn, q.pn.a, {ro: true}) : Array.isArray(q.o) ? `<div class="te-opts">${q.o.map((o, k) => `<span class="te-o-view ${k === q.a ? "ok" : ""}">${k === q.a ? "✓ " : ""}${esc(o)}</span>`).join("")}</div>` : `<div class="te-opts"><span class="te-o-view ok">✓ ${esc(String(q.a).split("|").join(" / "))}</span></div>`}
    ${q.e ? `<p class="small muted" style="margin-top:4px">${esc(q.e)}</p>` : ""}${err ? `<p class="small" style="color:var(--bad)">⚠ ${esc(err)}</p>` : ""}</li>`;
}
function testEditor(cid, l, kind){
  const d = teDraft(l, kind), qs = d ? d.qs : ((kind === "test" ? l.test : l.hwtest) || []), own = teOwnRow(cid, l.id);
  const extra = kind === "test" ? U.lessonTests(l).test.slice((l.test || []).length) : [];
  return `<div class="te">
    <div class="row te-bar" style="gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <button class="btn ghost sm" data-act="te-add" data-qk="choice">+ Выбор ответа</button>
      <button class="btn ghost sm" data-act="te-add" data-qk="input">+ Ввод ответа</button>
      <button class="btn ghost sm" data-act="te-add" data-qk="tf">+ Верно / неверно</button>
      <button class="btn ghost sm" data-act="te-add" data-qk="pn">+ Расставить запятые</button>
      <button class="btn ghost sm" data-act="te-ai" ${T.busy === "te-ai" ? "disabled" : ""}>${T.busy === "te-ai" ? "Нейросеть пишет…" : "✨ Догенерировать 5 вопросов"}</button>
      ${d ? `<button class="btn sm" data-act="te-save">Сохранить тест (${qs.length})</button><button class="btn ghost sm" data-act="te-drop">Не сохранять</button>` : ""}
      ${!d && (own?.data?.[kind]) ? `<button class="btn ghost sm" data-act="te-reset">Вернуть исходный тест</button>` : ""}
    </div>
    <p class="small muted" style="margin-bottom:8px">${d ? "Есть несохранённые изменения. " : l.edited && own?.data?.[kind] ? "Тест изменён вами – ученики видят вашу версию. " : ""}Формат платформы: вопрос до ${TE_LIM.q} знаков; выбор ответа – 2–6 вариантов, один верный; ввод ответа – слово или фраза (варианты через «|»); пояснение – правило, до ${TE_LIM.e} знаков.${T.me?.role === "developer" ? " Режим разработчика: правка сохраняется во встроенную базу для всех учителей." : ""}</p>
    ${qs.length ? `<ol class="te-list">${qs.map((q, i) => teQHTML(q, i, d)).join("")}</ol>` : `<p class="muted">Вопросов пока нет – добавьте первый.</p>`}
    ${extra.length ? `<p class="small muted" style="margin-top:10px">Ещё ${extra.length} вопр. добавлены из ваших наборов заданий (вкладка «Свои материалы»).</p>` : ""}
  </div>`;
}
function teReadForm(){
  const d = T.td; if (!d || d.edit == null) return;
  const q = d.qs[d.edit]; if (!q) return;
  const val = id => document.getElementById(id)?.value ?? "";
  q.q = val("te-q").trim(); q.e = val("te-e").trim();
  if (q.pn) q.pn = U.pnParse(val("te-pn"));
  else if (Array.isArray(q.o)){ q.o = [...document.querySelectorAll(".te-o")].map(x => x.value.trim()); const r = document.querySelector('input[name="te-a"]:checked'); q.a = r ? +r.value : -1; }
  else q.a = val("te-ans").trim();
}
async function teAct(a, t){
  const cid = curCourse(), l = teacherCourse(cid).lessons.find(x => x.id === T.open), kind = T.sub === "hwtest" ? "hwtest" : "test";
  if (!l) return;
  if (a === "te-add"){ const d = teStart(l, kind); teReadForm(); const qk = t.dataset.qk;
    d.qs.push(qk === "pn" ? {q: "Расставьте запятые.", pn: {w: [], a: []}, a: "", e: ""} : qk === "input" ? {q: "", a: "", e: ""} : qk === "tf" ? {q: "", o: ["Верно", "Неверно"], a: 0, e: "", tf: true} : {q: "", o: ["", ""], a: 0, e: ""}); d.edit = d.qs.length - 1; d.isNew = true; render(); document.getElementById("te-q")?.focus(); return; }
  if (a === "te-edit"){ const d = teStart(l, kind); teReadForm(); d.edit = +t.dataset.i; d.isNew = false; render(); document.getElementById("te-q")?.focus(); return; }
  if (["te-up", "te-down", "te-del"].includes(a)){ const d = teStart(l, kind); teReadForm(); d.edit = null; const i = +t.dataset.i, j = a === "te-up" ? i - 1 : i + 1;
    if (a === "te-del") d.qs.splice(i, 1); else if (j >= 0 && j < d.qs.length) [d.qs[i], d.qs[j]] = [d.qs[j], d.qs[i]]; render(); return; }
  if (a === "te-oadd" || a === "te-odel"){ teReadForm(); const q = T.td.qs[T.td.edit]; if (a === "te-oadd") q.o.push(""); else { const k = +t.dataset.k; q.o.splice(k, 1); if (q.a === k) q.a = 0; else if (q.a > k) q.a--; } render(); return; }
  if (a === "te-ok"){ teReadForm(); const q = T.td.qs[T.td.edit], err = teCheck(q); if (err){ const el = document.getElementById("te-err"); if (el) el.textContent = "Исправьте: " + err; return; } T.td.edit = null; T.td.isNew = false; render(); return; }
  if (a === "te-cancel"){ const d = T.td; if (d.isNew) d.qs.splice(d.edit, 1); d.edit = null; d.isNew = false; render(); return; }
  if (a === "te-drop"){ T.td = null; render(); return; }
  if (a === "te-ai"){
    const d = teStart(l, kind); teReadForm(); d.edit = null; T.busy = "te-ai"; render();
    const c = COURSES[cid] || {};
    const r = await ai({action: "generate_tasks", topic: l.title, count: 5, grade: c.grade, exam: c.goal === "ОГЭ" || c.goal === "ЕГЭ" ? c.goal : "",
      notes: `Только вопросы теста по теме урока «${l.title}». Формат: 4 варианта, один верный, короткое пояснение-правило. Не повторять: ${d.qs.slice(0, 12).map(q => q.q).join(" | ").slice(0, 900)}`});
    T.busy = false;
    if (r?.error){ toast(r.error); render(); return; }
    const add = (r?.test || []).filter(q => q.q && Array.isArray(q.o) && !teCheck({...q, q: String(q.q).slice(0, TE_LIM.q)})).map(q => ({q: String(q.q).slice(0, TE_LIM.q), o: q.o.map(x => String(x).slice(0, TE_LIM.o)), a: q.a, e: String(q.e || "").slice(0, TE_LIM.e)}));
    d.qs.push(...add); toast(add.length ? `Добавлено вопросов: ${add.length}. Проверьте и сохраните.` : "Нейросеть не вернула подходящих вопросов"); render(); return;
  }
  if (a === "te-save"){
    const d = T.td; teReadForm(); if (d.edit != null){ const err = teCheck(d.qs[d.edit]); if (err){ toast("Вопрос " + (d.edit + 1) + ": " + err); return; } d.edit = null; }
    const bad = d.qs.map((q, i) => [i, teCheck(q)]).find(x => x[1]); if (bad){ toast(`Вопрос ${bad[0] + 1}: ${bad[1]}`); render(); return; }
    const qs = d.qs.map(q => q.pn ? {q: q.q, pn: q.pn, a: q.pn.a.join(","), e: q.e || "", tag: q.tag || l.title} : Array.isArray(q.o) ? {q: q.q, o: q.o, a: q.a, e: q.e || "", ...(q.tf ? {tf: true} : {}), tag: q.tag || l.title} : {q: q.q, a: q.a, e: q.e || "", tag: q.tag || l.title});
    const own = teOwnRow(cid, l.id), data = {...(own?.data || {kind: "test-edit"}), kind: "test-edit", [kind]: qs};
    const res = own ? await sb.from("materials").update({data}).eq("id", own.id).select().single()
      : await sb.from("materials").insert({course: cid, lesson_id: l.id, kind: "tasks", title: "Правка теста", shared: T.me?.role === "developer", data}).select().single();
    if (res.error){ toast("Не сохранилось: " + res.error.message); return; }
    if (own) Object.assign(own, res.data); else T.mats.push(res.data);
    T.td = null; render(); cmd("all", "refresh", {msg: "Учитель обновил тест"}); toast("Тест сохранён – ученики увидят новую версию"); return;
  }
  if (a === "te-reset"){
    const own = teOwnRow(cid, l.id); if (!own) return;
    if (!t.dataset.sure){ t.dataset.sure = "1"; t.textContent = "Точно вернуть исходный?"; return; }
    const data = {...own.data}; delete data[kind];
    const res = data.test || data.hwtest ? await sb.from("materials").update({data}).eq("id", own.id).select().single() : await sb.from("materials").delete().eq("id", own.id);
    if (res.error){ toast("Не получилось: " + res.error.message); return; }
    if (data.test || data.hwtest) own.data = data; else T.mats = T.mats.filter(m => m !== own);
    render(); cmd("all", "refresh", {msg: "Учитель обновил тест"}); toast("Возвращён исходный тест"); return;
  }
}

/* ---------- редактор теории и практики: правка, свои блоки, догенерация нейросетью (в том числе прямо на уроке) ----------
   Пока учитель правит, ученик ничего не видит; после «Сохранить» блок появляется у ученика (у всех или только у этого). */
const CE_LIM = {h: 120, t: 900, line: 300, n: 12};
const ceKey = ctx => `${ctx.cid}|${ctx.lid}|${ctx.sid || ""}`;
const ceOpen = (ctx, kind) => T.ce && T.ce.key === ceKey(ctx) && T.ce.kind === kind;
function ceRow(ctx, kind){ return T.mats.find(m => m.kind === "tasks" && m.data?.kind === "content-edit" && m.course === ctx.cid && m.lesson_id === ctx.lid && m.teacher_id === T.session?.user.id && (m.student_id || null) === (ctx.sid || null) && m.data?.[kind]); }
function ceBar(ctx, l, kind){
  const own = ceRow(ctx, kind);
  return `<div class="row ce-bar" style="gap:6px;flex-wrap:wrap;margin-bottom:10px">
    <button class="btn ghost sm" data-act="ce-open" data-k="${kind}" data-ctx="${esc(ceKey(ctx))}">✎ ${kind === "theory" ? "Править теорию" : "Править задания"}</button>
    <button class="btn ghost sm" data-act="ce-open" data-k="${kind}" data-ctx="${esc(ceKey(ctx))}" data-gen="1">✨ ${kind === "theory" ? "Добавить тему / объяснение" : "Догенерировать задания"}</button>
    ${own ? `<span class="chip">${ctx.sid ? "изменено для этого ученика" : "изменено вами"}</span><button class="btn ghost sm" data-act="ce-reset" data-k="${kind}" data-ctx="${esc(ceKey(ctx))}">Вернуть исходное</button>` : ""}</div>`;
}
const lines = v => String(v || "").split("\n").map(x => x.trim()).filter(Boolean);
function ceItemHTML(kind, it, i, d){
  if (d.edit === i){
    if (kind === "theory") return `<li class="te-q editing"><label class="small" for="ce-h">Заголовок</label><input id="ce-h" maxlength="${CE_LIM.h}" value="${esc(it.h || "")}">
      <label class="small" for="ce-t">Объяснение</label><textarea id="ce-t" rows="3" maxlength="${CE_LIM.t}">${esc(it.t || "")}</textarea>
      <label class="small" for="ce-list">Пункты правила (каждый с новой строки)</label><textarea id="ce-list" rows="3">${esc((it.list || []).join("\n"))}</textarea>
      <label class="small" for="ce-ex">Примеры (каждый с новой строки; разметка: [[s:подлежащее]], [[p:сказуемое]], [[o:орфограмма]])</label><textarea id="ce-ex" rows="2">${esc((it.ex || []).join("\n"))}</textarea>
      <label class="small" for="ce-mini">Мини-практика: «вопрос = ответ» (варианты ответа через «|»)</label><textarea id="ce-mini" rows="2">${esc((it.mini || []).map(m => m.q + " = " + m.a).join("\n"))}</textarea>
      <div class="row" style="gap:8px;margin-top:8px"><button class="btn sm" data-act="ce-ok">Готово</button><button class="btn ghost sm" data-act="ce-cancel">Отмена</button></div></li>`;
    return `<li class="te-q editing"><label class="small" for="ce-t">Формулировка задания</label><textarea id="ce-t" rows="3" maxlength="${CE_LIM.t}">${esc(it.t || "")}</textarea>
      <label class="small" for="ce-items">Предложения или слова для листа (каждое с новой строки; пропуск буквы – «..»; знаки, которые ставит ученик, не пишите)</label><textarea id="ce-items" rows="4">${esc((it.items || []).join("\n"))}</textarea>
      <label class="small" for="ce-key">Ключ (видите только вы)</label><textarea id="ce-key" rows="2">${esc(it.key || "")}</textarea>
      <div class="row" style="gap:8px;margin-top:8px"><button class="btn sm" data-act="ce-ok">Готово</button><button class="btn ghost sm" data-act="ce-cancel">Отмена</button></div></li>`;
  }
  const tools = `<span class="row te-tools" style="gap:2px;flex:none"><button class="iconbtn" data-act="ce-edit" data-i="${i}" aria-label="Изменить">✎</button><button class="iconbtn" data-act="ce-up" data-i="${i}" aria-label="Выше">↑</button><button class="iconbtn" data-act="ce-down" data-i="${i}" aria-label="Ниже">↓</button><button class="iconbtn" data-act="ce-del" data-i="${i}" aria-label="Удалить">🗑</button></span>`;
  const fresh = it._new ? ` <span class="chip mid">новое</span>` : "";
  if (kind === "theory") return `<li class="te-q"><div class="row" style="justify-content:space-between;gap:8px;align-items:flex-start"><b style="flex:1">${esc(it.h)}${fresh}</b>${tools}</div>
    ${it.t ? `<p class="small">${U.mark(it.t)}</p>` : ""}${it.list?.length ? `<ul class="small">${it.list.map(x => `<li>${U.mark(x)}</li>`).join("")}</ul>` : ""}${it.ex?.length ? `<div class="small muted">${it.ex.map(x => U.mark(x)).join("<br>")}</div>` : ""}${it.mini?.length ? `<p class="small">Мини-практика: ${it.mini.length}</p>` : ""}${it.table ? `<p class="small muted">+ таблица</p>` : ""}</li>`;
  return `<li class="te-q"><div class="row" style="justify-content:space-between;gap:8px;align-items:flex-start"><span style="flex:1">${esc(it.t)}${fresh}</span>${tools}</div>
    ${it.items?.length ? `<ol class="small" style="margin:4px 0 0;padding-left:18px">${it.items.map(x => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}<p class="small" style="color:var(--good)">Ключ: ${esc(it.key || "–")}</p></li>`;
}
function ceEditor(ctx, l, kind){
  const d = T.ce, room = !!ctx.sid;
  return `<div class="te ce"><div class="row te-bar" style="gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <button class="btn ghost sm" data-act="ce-add">+ ${kind === "theory" ? "Блок теории" : "Задание"}</button>
      <button class="btn sm" data-act="ce-save">${room ? "Сохранить и показать ученику" : "Сохранить"} (${d.items.length})</button><button class="btn ghost sm" data-act="ce-close">Закрыть без сохранения</button></div>
    <div class="ai-box stack" style="gap:6px;margin-bottom:12px"><label class="small" for="ce-req"><b>✨ Нейросеть: что добавить?</b> ${kind === "theory" ? "Например: «объясни разницу между -тся и -ться с примерами» или «слабая зона: вводные слова в начале предложения»." : "Например: «5 предложений на запятые при деепричастном обороте, посложнее»."}</label>
      <textarea id="ce-req" rows="2">${esc(d.req || "")}</textarea>
      <div class="row" style="gap:6px"><select id="ce-n" aria-label="Сколько">${[1, 2, 3, 4, 5].map(n => `<option ${n === (d.n || (kind === "theory" ? 1 : 3)) ? "selected" : ""}>${n}</option>`).join("")}</select>
        <button class="btn sm" data-act="ce-ai" ${T.busy === "ce-ai" ? "disabled" : ""}>${T.busy === "ce-ai" ? "Нейросеть пишет…" : kind === "theory" ? "Сгенерировать блок" : "Сгенерировать задания"}</button></div>
      <p class="small muted">${room ? "Ученик не видит черновик – новое появится у него только после сохранения." : "Черновик видите только вы."} Сгенерированное отмечено «новое» – проверьте перед сохранением.</p></div>
    ${room ? `<label class="small" style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><input type="checkbox" id="ce-all" ${d.all ? "checked" : ""}> Сохранить для всех учеников этого курса (иначе – только для этого ученика)</label>` : ""}
    <ol class="te-list">${d.items.map((it, i) => ceItemHTML(kind, it, i, d)).join("") || `<p class="muted">Пусто – добавьте ${kind === "theory" ? "блок" : "задание"}.</p>`}</ol></div>`;
}
function ceRead(){
  const d = T.ce; if (!d || d.edit == null) return;
  const it = d.items[d.edit], v = id => document.getElementById(id)?.value ?? "";
  if (d.kind === "theory"){ it.h = v("ce-h").trim().slice(0, CE_LIM.h); it.t = v("ce-t").trim().slice(0, CE_LIM.t); it.list = lines(v("ce-list")).slice(0, CE_LIM.n); it.ex = lines(v("ce-ex")).slice(0, CE_LIM.n);
    it.mini = lines(v("ce-mini")).map(x => { const k = x.lastIndexOf("="); return k > 0 ? {q: x.slice(0, k).trim(), a: x.slice(k + 1).trim()} : null; }).filter(m => m && m.q && m.a).slice(0, 6); }
  else { it.t = v("ce-t").trim().slice(0, CE_LIM.t); it.items = lines(v("ce-items")).slice(0, 15); it.key = v("ce-key").trim().slice(0, 1200); }
}
const ceClean = (kind, it) => { const o = {...it}; delete o._new; ["list", "ex", "mini", "items"].forEach(k => { if (Array.isArray(o[k]) && !o[k].length) delete o[k]; }); if (!o.t) delete o.t; return o; };
const ceBad = (kind, it) => kind === "theory" ? (!it.h ? "у блока нет заголовка" : "") : (!it.t ? "у задания нет формулировки" : !it.key ? "у задания нет ключа" : "");
function ceCtxOf(key){ const [cid, lid, sid] = String(key).split("|"); return {cid, lid, sid: sid || null}; }
function ceLesson(ctx){
  if (ctx.sid){ const s = T.students.find(x => x.id === ctx.sid); return U.courseFor(s, T.mats)?.lessons.find(x => x.id === ctx.lid); }
  return teacherCourse(ctx.cid).lessons.find(x => x.id === ctx.lid);
}
async function ceAct(a, t){
  if (a === "ce-open"){
    const ctx = ceCtxOf(t.dataset.ctx), l = ceLesson(ctx), kind = t.dataset.k; if (!l) return;
    if (!ceOpen(ctx, kind)){
      const keys = kind === "practice" ? keysFor(ctx.cid, l) : [];
      T.ce = {key: ceKey(ctx), ctx, kind, edit: null, req: "", all: false, items: JSON.parse(JSON.stringify(kind === "theory" ? (l.theory || []) : (l.practice || []).map((p, k) => ({...p, key: keys[k] ?? p.key}))))};
    }
    render(); if (t.dataset.gen) setTimeout(() => document.getElementById("ce-req")?.focus(), 30); return;
  }
  const d = T.ce; if (!d) return;
  const l = ceLesson(d.ctx); if (!l) return;
  if (a === "ce-close"){ T.ce = null; render(); return; }
  if (a === "ce-add"){ ceRead(); d.items.push(d.kind === "theory" ? {h: "", t: "", list: [], ex: [], mini: [], _new: true} : {t: "", items: [], key: "", _new: true}); d.edit = d.items.length - 1; render(); document.getElementById(d.kind === "theory" ? "ce-h" : "ce-t")?.focus(); return; }
  if (a === "ce-edit"){ ceRead(); d.edit = +t.dataset.i; render(); return; }
  if (a === "ce-ok"){ ceRead(); const err = ceBad(d.kind, d.items[d.edit]); if (err){ toast("Исправьте: " + err); return; } d.edit = null; render(); return; }
  if (a === "ce-cancel"){ const it = d.items[d.edit]; if (it && ceBad(d.kind, it)) d.items.splice(d.edit, 1); d.edit = null; render(); return; }
  if (["ce-up", "ce-down", "ce-del"].includes(a)){ ceRead(); d.edit = null; const i = +t.dataset.i, j = a === "ce-up" ? i - 1 : i + 1;
    if (a === "ce-del") d.items.splice(i, 1); else if (j >= 0 && j < d.items.length) [d.items[i], d.items[j]] = [d.items[j], d.items[i]]; render(); return; }
  if (a === "ce-ai"){
    ceRead(); d.edit = null; d.req = $("#ce-req")?.value.trim() || ""; d.n = +($("#ce-n")?.value || 1); d.all = !!$("#ce-all")?.checked;
    const c = COURSES[d.ctx.cid] || U.getCourse(d.ctx.cid) || {};
    T.busy = "ce-ai"; render();
    const cur = d.kind === "theory" ? d.items.map(b => `${b.h}: ${b.t || ""} ${(b.list || []).join("; ")}`).join("\n") : d.items.map(p => p.t).join("\n");
    const r = await ai({action: "edit_lesson", kind: d.kind, title: l.title, current: cur, request: d.req || (d.kind === "theory" ? "Добавь блок, который помогает понять тему: особые случаи и типичные ошибки" : "Добавь задания на отработку темы, включая трудные случаи"), count: d.n, grade: c.grade, exam: c.goal === "ОГЭ" || c.goal === "ЕГЭ" ? c.goal : ""});
    T.busy = false;
    if (r?.error){ toast(r.error); render(); return; }
    const add = d.kind === "theory"
      ? (r?.blocks || []).filter(b => b?.h).map(b => ({h: String(b.h).slice(0, CE_LIM.h), t: String(b.t || "").slice(0, CE_LIM.t), list: (b.list || []).map(String).slice(0, CE_LIM.n), ex: (b.ex || []).map(String).slice(0, CE_LIM.n), mini: (b.mini || []).filter(m => m?.q && m?.a).map(m => ({q: String(m.q), a: String(m.a)})).slice(0, 4), _new: true}))
      : (r?.tasks || []).filter(p => p?.t && p?.key).map(p => ({t: String(p.t).slice(0, CE_LIM.t), key: String(p.key).slice(0, 1200), ...(Array.isArray(p.items) && p.items.length ? {items: p.items.map(String).slice(0, 15)} : {}), _new: true}));
    d.items.push(...add); toast(add.length ? `Добавлено: ${add.length}. Проверьте и сохраните.` : "Нейросеть не вернула подходящего"); render(); return;
  }
  if (a === "ce-save"){
    ceRead(); if ($("#ce-all")) d.all = $("#ce-all").checked;
    const bad = d.items.map((it, i) => [i, ceBad(d.kind, it)]).find(x => x[1]); if (bad){ toast(`${d.kind === "theory" ? "Блок" : "Задание"} ${bad[0] + 1}: ${bad[1]}`); d.edit = bad[0]; render(); return; }
    const items = d.items.map(it => ceClean(d.kind, it)), sid = d.all ? null : d.ctx.sid, ctx = {...d.ctx, sid};
    const own = ceRow(ctx, d.kind) || T.mats.find(m => m.kind === "tasks" && m.data?.kind === "content-edit" && m.course === ctx.cid && m.lesson_id === ctx.lid && m.teacher_id === T.session?.user.id && (m.student_id || null) === (sid || null));
    const data = {...(own?.data || {}), kind: "content-edit", [d.kind]: items};
    const res = own ? await sb.from("materials").update({data}).eq("id", own.id).select().single()
      : await sb.from("materials").insert({course: ctx.cid, lesson_id: ctx.lid, kind: "tasks", title: d.kind === "theory" ? "Правка теории" : "Правка практики", student_id: sid, shared: !sid && T.me?.role === "developer", data}).select().single();
    if (res.error){ toast("Не сохранилось: " + res.error.message); return; }
    if (own) Object.assign(own, res.data); else T.mats.push(res.data);
    T.ce = null; render(); cmd(sid || "all", "refresh", {msg: d.kind === "theory" ? "Учитель добавил материал к уроку" : "Учитель обновил задания"});
    toast(sid ? "Сохранено – ученик уже видит" : "Сохранено для всех учеников курса"); return;
  }
}
async function ceReset(t){
  const ctx = ceCtxOf(t.dataset.ctx), kind = t.dataset.k, own = ceRow(ctx, kind); if (!own) return;
  if (!t.dataset.sure){ t.dataset.sure = "1"; t.textContent = "Точно вернуть исходное?"; return; }
  const data = {...own.data}; delete data[kind];
  const res = data.theory || data.practice ? await sb.from("materials").update({data}).eq("id", own.id).select().single() : await sb.from("materials").delete().eq("id", own.id);
  if (res.error){ toast("Не получилось: " + res.error.message); return; }
  if (data.theory || data.practice) own.data = data; else T.mats = T.mats.filter(m => m !== own);
  render(); cmd(ctx.sid || "all", "refresh", {msg: "Учитель обновил урок"}); toast("Возвращено исходное");
}

/* ключи к заданиям: из базы + свои правки учителя */
function keysFor(cid, l){
  const base = [...(!l.pEdited && (window.COURSE_KEYS?.[cid] || {})[l.id] || (l.practice || []).map(p => p.key))];
  const own = T.mats.find(m => m.kind === "keys" && m.course === cid && m.lesson_id === l.id && m.teacher_id === T.session?.user.id);
  Object.entries(own?.data || {}).forEach(([k, v]) => base[+k] = v);
  return base;
}
/* встроенная база грузится по курсам, когда нужна (вся база – десятки мегабайт) */
async function ensureCourses(keys){
  if (!sb || !T.me?.base) return false;
  keys = keys.filter(k => k && window.CATALOG?.[k] && !T.loaded?.has(k)); if (!keys.length) return false;
  keys.forEach(k => T.loaded.add(k));
  const {data, error} = await sb.from("course_data").select("key,data,keys").in("key", keys);
  if (error){ keys.forEach(k => T.loaded.delete(k)); return false; }
  U.loadBase(data);
  /* новые авторские курсы с сайта важнее старой копии в базе */
  if (window.BuiltinLoader) for (const k of keys){ const row = (data || []).find(r => r.key === k); if (U.builtinNewer(k, row?.data)) await BuiltinLoader.ensure(k); }
  return true;
}
/* установка на телефон */
let installEvt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; });

/* ---------- живая связь: кто из учеников сейчас на платформе и где; мгновенные обновления ---------- */
const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || ["board","room"].includes(T.view);
/* канал «онлайн и команды»: свой, а у разработчика – ещё каналы других его кабинетов (ученики могут быть закреплены за любым) */
function liveStart(){
  if (!sb || !T.session) return;
  if (!T.live) T.live = {chans: new Map(),
    send(m){ return Promise.all([...this.chans.values()].map(c => c.send(m))); },
    track(x){ return Promise.all([...this.chans.values()].map(c => c.track(x))); },
    presenceState(){ return Object.assign({}, ...[...this.chans.values()].map(c => c.presenceState())); }};
  const ids = new Set([T.session.user.id, ...T.students.map(s => s.teacher_id).filter(Boolean)]);
  ids.forEach(id => { if (!T.live.chans.has(id)) liveChan(id); });
}
function liveChan(id){
  const ch = sb.channel(`live-${id}`, {config:{presence:{key:"t-" + T.session.user.id}, broadcast:{self:false}}});
  T.live.chans.set(id, ch);
  ch.on("presence", {event:"sync"}, () => {
    onlineNow();
    paintOnline();
  }).on("broadcast", {event:"act"}, ({payload:m}) => {
    if (!m?.act) return;
    if (m.work){
      T.works = (T.works || []).filter(w => !(w.student_id === m.id && w.lesson_id === m.lesson && w.task === m.task)).concat({student_id: m.id, lesson_id: m.lesson, task: m.task, data: m.data});
      if ((T.view === "work" && T.sel === m.id && T.workLesson === m.lesson) || (T.view === "room" && T.room?.who === m.id && T.room.lesson === m.lesson)){
        const s = T.students.find(x => x.id === m.id), c = U.courseFor(s, T.mats), l = c?.lessons.find(x => x.id === m.lesson), el = document.querySelector(`#wk-view [data-task="${m.task}"]`);
        if (l && el){ const keys = keysFor(s.course, l); el.outerHTML = Work.task({...l.practice[m.task], key: keys[m.task]}, m.task, m.data, true).replace('class="task wk"', 'class="task wk ro"'); }
      }
      return;
    }
    if (m.test){
      T.liveTest = T.liveTest || {}; T.liveTest[m.id] = m;
      const el = document.getElementById("live-test");
      if (el && T.view === "room" && T.room?.who === m.id && T.room.lesson === m.lesson) el.innerHTML = liveTestHTML(m);
      const card = document.querySelector(`[data-livetest="${m.id}"]`);
      if (card) card.innerHTML = liveTestHTML(m);
      else if (T.view === "student" && T.sel === m.id && !m.done && !m.quit && !typing()) render();
      if (m.done){ toast(`${m.name.split(" ")[0]}: тест «${m.title}» – ${m.score} из ${m.n}`); refreshSoon(); }
      return;
    }
    if (m.room && T.room?.to.includes(m.id)){ toast(`${m.name.split(" ")[0]}: ${m.text}`); return; }
    if (m.room){
      const bar = document.getElementById("callbar");
      bar.innerHTML = `<span>🎒 ${esc(m.name.split(" ")[0])} начинает урок «${esc(m.title || "")}»</span><button class="btn sm" data-act="join-room" data-id="${esc(m.id)}" data-rl="${esc(m.lesson)}">📞 Подключиться</button><button class="iconbtn" aria-label="Скрыть" onclick="this.parentElement.hidden=true">✕</button>`;
      bar.hidden = false;
    }
    T.feed.unshift({...m, at: Date.now()}); T.feed = T.feed.slice(0, 30);
    toast(`${m.name.split(" ")[0]}: ${m.text}`); refreshSoon();
  }).subscribe(st => { if (st === "SUBSCRIBED"){ T.liveOk = true; roomTrack(); } });
}
/* кто онлайн: ученик может войти под любым своим предметом – онлайн считаются все его записи (один человек) */
function onlineNow(){
  T.online = {}; if (!T.live) return;
  const person = x => x.person_id || x.id;
  Object.values(T.live.presenceState()).flat().forEach(p => { if (p.role !== "student") return;
    T.online[p.id] = p; const me = T.students.find(x => x.id === p.id);
    if (me) T.students.filter(x => person(x) === person(me)).forEach(x => { if (!T.online[x.id]) T.online[x.id] = p; }); });
  /* «Показать ученику», нажатое пока ученик был не в сети: досылаем, как только он зашёл */
  const now = new Set(Object.keys(T.online).filter(k => !k.startsWith("p:")));
  if (T.lastShow && Date.now() - T.lastShow.at < 15 * 60e3){
    [T.lastShow.id, T.lastShow.pair].filter(Boolean).forEach(id => {
      if (now.has(id) && !showPrev.has(id)) cmd(id, "goto", T.lastShow.payload);
    });
  }
  showPrev = now;
}
let showPrev = new Set();
/* точечно обновляем значки «онлайн», не перерисовывая страницу (чтобы не сбить ввод и доску) */
function paintOnline(){
  document.querySelectorAll("[data-where]").forEach(el => { const p = T.online[el.dataset.where]; el.textContent = p ? "Ученик сейчас: " + (p.where || "") : "Ученик пока не на уроке"; });
  document.querySelectorAll("[data-online]").forEach(el => { const p = T.online[el.dataset.online]; el.innerHTML = p ? `<span class="live">онлайн${p.where ? " · " + esc(p.where) : ""}</span>` : ""; });
  const n = Object.keys(T.online).length, el = document.getElementById("online-count"); if (el) el.innerHTML = n ? `<span class="live">сейчас онлайн: ${n}</span>` : "";
}
let refT = 0;
function refreshSoon(){
  clearTimeout(refT);
  refT = setTimeout(async () => {
    const [rs, hw, wr, ac, st, qz, qr] = await Promise.all([sb.from("results").select("*").order("created_at"), sb.from("homework").select("*"), sb.from("writings").select("*"), sb.from("activity").select("*"), sb.from("students").select(ST_COLS).order("created_at"),
      sb.from("topic_quizzes").select("*").order("created_at", {ascending: false}), sb.from("topic_quiz_results").select("*").order("created_at", {ascending: false})]);
    if (!st.error) T.students = st.data;
    if (!rs.error) T.rows = rs.data; if (!hw.error) T.hw = hw.data; if (!wr.error) T.writings = wr.data; if (!ac.error) T.act = ac.data;
    if (!qz.error) T.qzQuizzes = qz.data || []; if (!qr.error) T.qzResults = qr.data || [];
    if (!typing()) render(); else T.stale = true;
  }, 500);
}
/* команда ученику: обновить данные или открыть урок */
function cmd(to, type, extra){ if (T.live) T.live.send({type:"broadcast", event:"cmd", payload:{cmd:true, to, type, ...extra}}).catch(() => {}); }

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
  if (id === "devcode-form"){
    const btn = e.target.querySelector("button[type=submit]"), err = $("#dc-err"); btn.disabled = true; btn.textContent = "Проверяю…";
    const {data, error} = await sb.rpc("dev_join", {p_code: $("#dc-code").value});
    btn.disabled = false; btn.textContent = "Войти в режим разработчика";
    if (error){ err.textContent = /dev_join|does not exist/i.test(error.message) ? "Обновите базу: в Supabase → SQL Editor заново выполните supabase/schema.sql." : U.authErr(error); return; }
    if (!data){ err.textContent = "Код не подошёл. Если код ещё не задан – выполните в SQL Editor: select public.dev_set_code('ваш-код');"; return; }
    toast("Вы в режиме разработчика"); await loadAll(); T.view = "devcode"; render(); return;
  }
  if (id === "newpass-form"){
    const pw = $("#np-pass").value, err = $("#np-err");
    if (pw.length < 8){ err.textContent = "Пароль – не меньше 8 знаков."; err.hidden = false; return; }
    const {error} = await sb.auth.updateUser({password: pw});
    if (error){ err.textContent = U.authErr(error); err.hidden = false; return; }
    history.replaceState(null, "", location.pathname); T.view = "students"; toast("Пароль изменён. Вы в кабинете."); await loadAll(); return;
  }
  if (id === "t-login"){
    const {data, error} = await sb.auth.signInWithPassword({email: $("#t-email").value.trim(), password: $("#t-pass").value});
    if (error){ const el = $("#t-err"); el.textContent = "Не получилось войти: проверьте почту и пароль."; el.hidden = false; return; }
    T.session = data.session; await loadAll();
  }
  if (id === "add-student"){
    const g = +$("#ns-grade").value, nick = $("#ns-name").value.trim();
    const subj = $("#ns-subj").value, goal = $("#ns-goal").value;
    const row = {name: nick ? "(" + nick + ")" : "(ожидает регистрации)", grade: g, subject: subj, course: goal ? U.planFor(subj, g, [goal]) : "", code: U.genCode(), invite_token: U.randHex(18), ...(goal ? {goals: [goal], goal} : {})};
    const {data, error} = await sb.from("students").insert(row).select(ST_COLS).single();
    if (error){ toast(/row-level security/.test(error.message) ? "Подписка закончилась – продлите её в разделе «Подписка»." : "Не удалось создать: " + error.message); return; }
    T.students.push(data); T.justInvited = data; render(); toast("Ссылка создана – скопируйте и отправьте ученику");
  }
  if (id === "plan-form"){
    const s = T.students.find(x => x.id === T.sel), picked = [...document.querySelectorAll(".pl-c:checked")].map(x => x.value);
    if (!picked.length){ toast("Отметьте хотя бы один курс"); return; }
    const sib = siblings(s).filter(o => subjOfS(o) === subjOfS(s)), have = new Set(sib.map(o => o.course));
    if (!picked.includes(s.course)){ if (!(await upd(s.id, {course: picked.find(k => !have.has(k)) || picked[0]}))) return; have.add(s.course); }
    let added = 0;
    for (const k of picked.filter(k => !have.has(k))){
      const {error} = await sb.rpc("teacher_add_subject", {p_student: s.id, p_subject: subjOfS(s), p_grade: U.getCourse(k)?.grade || s.grade || 9, p_course: k});
      if (error){ toast("Не добавился курс: " + (U.getCourse(k)?.course || k)); } else added++;
    }
    await loadAll(); cmd(s.id, "refresh", {msg:"Учитель обновил твой план"}); toast(added ? `План сохранён, добавлено курсов: ${added}` : "План сохранён");
  }
  if (id === "own-lesson"){
    const cid = curCourse(), lid = "c" + U.randHex(4);
    const row = {course: cid, lesson_id: lid, kind: "lesson", shared: !!$("#ol-shared")?.checked, title: $("#ol-title").value.trim(),
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
    m.data = data; m.title = data.title; T.sub = "theory"; render(); cmd("all", "refresh", {msg:"Учитель обновил урок"}); toast("Урок сохранён");
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
    const {data, error} = await sb.from("materials").insert({course: cid, lesson_id: T.open, kind, title: title || null, url: url || null, body: body || null, shared: !!$("#am-shared")?.checked}).select().single();
    if (error){ toast("Не сохранилось: " + error.message); return; }
    T.mats.push(data); render(); cmd("all", "refresh", {msg:"Учитель добавил материал"}); toast("Материал добавлен в папку");
  }
});
document.addEventListener("paste", e => {
  if (!["call-url", "room-url"].includes(e.target.id)) return;
  setTimeout(async () => { const s = T.students.find(x => x.id === (e.target.id === "room-url" ? T.room?.sid : T.sel)); if (s && await saveCall(s, e.target.value)) render(); }, 0);
});
document.addEventListener("change", async e => {
  if (e.target.id === "call-url" || e.target.id === "room-url"){ const s = T.students.find(x => x.id === (e.target.id === "room-url" ? T.room?.sid : T.sel)); if (s && await saveCall(s, e.target.value)) render(); return; }
  if (e.target.id === "qz-count"){ T.qzCount = Math.max(1, Math.min(10, +e.target.value || 3)); return; }
  if (e.target.dataset.qzTopic){
    const s = T.students.find(x => x.id === T.sel); if (!s) return;
    const st = qzState(s), lid = e.target.dataset.qzTopic;
    e.target.checked ? st.qzSel.add(lid) : st.qzSel.delete(lid);
    const lab = e.target.closest("label"); if (lab) lab.classList.toggle("on", e.target.checked);
    return;
  }
  if (e.target.id === "tk-subj"){ T.take = {subj: e.target.value}; render(); return; }
  if (e.target.id === "tk-course"){ T.take = {...(T.take || {}), course: e.target.value}; render(); return; }
  if (e.target.id === "room-course" && T.room){ T.room.pickCourse = e.target.value; render(); return; }
  if (e.target.id === "room-lesson" && T.room){
    const r = T.room, s = T.students.find(x => x.id === r.sid), cid = r.pickCourse || s.course, lid = e.target.value;
    if (!lid) return;
    if (lid === "free" || cid === s.course){ roomSetLesson(lid); return; }
    // тема из другого курса: копируется ученику на сегодняшнее занятие и сразу открывается у него
    e.target.disabled = true;
    const P = isoToday(), nid = await insertLesson(s, cid, lid, P, false); if (!nid){ e.target.disabled = false; return; }
    r.to.forEach(id => r.base[id] = {...(T.students.find(x => x.id === id)?.dates || {})});
    r.pickCourse = null; await roomSetLesson(nid); toast("Тема открыта у ученика"); return;
  }
  if (e.target.id === "course-pick"){ T.courseId = e.target.value; render(); return; }
  if (e.target.id === "ns-subj"){ T.addSubj = e.target.value; const sel = $("#ns-grade"); sel.innerHTML = U.subj(T.addSubj).g.map(g => `<option value="${g}" ${g===9?"selected":""}>${U.gradeName(g)}</option>`).join(""); $("#ns-goal").innerHTML = goalOpts(T.addSubj, sel.value); return; }
  if (e.target.id === "ns-grade"){ $("#ns-goal").innerHTML = goalOpts($("#ns-subj").value, e.target.value); return; }
  if (e.target.id === "as-subj"){ const sel = $("#as-grade"); sel.innerHTML = U.subj(e.target.value).g.map(g => `<option value="${g}">${U.gradeName(g)}</option>`).join(""); const s = T.students.find(x => x.id === T.sel); if (s && U.subj(e.target.value).g.includes(s.grade)) sel.value = s.grade; return; }
  if (e.target.id === "gm-kind"){ T.gform = gameRead(); render(); return; }
  if (e.target.id === "am-kind"){ document.querySelectorAll("#add-mat [data-k]").forEach(el => el.hidden = !el.dataset.k.split(" ").includes(e.target.value)); return; }
  if (e.target.dataset.ltime){
    const s = T.students.find(x => x.id === T.sel), dates = {...(s.dates || {})}, k = "t:" + e.target.dataset.ltime;
    if (e.target.value && e.target.value !== dates._time) dates[k] = e.target.value; else delete dates[k];
    if (await upd(s.id, {dates})){ render(); cmd(s.id, "refresh", {msg:"Учитель изменил время урока"}); toast("Время урока изменено"); }
    return;
  }
  if (e.target.dataset.date){
    const s = T.students.find(x => x.id === T.sel), dates = {...(s.dates || {}), [e.target.dataset.date]: e.target.value};
    if (!e.target.value) delete dates[e.target.dataset.date];
    if (await upd(s.id, {dates})){ render(); cmd(s.id, "refresh", {msg:"Учитель перенёс урок"}); toast("Дата урока изменена"); }
  }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && T.drawer){ T.drawer = false; render(); } });
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-view],[data-student],[data-lesson],[data-sub],[data-review],[data-wreview],[data-boardfor],[data-unlock],[data-grade],[data-act],[data-delmat],[data-theme-pick],[data-mascot-pick],[data-goto],[data-subjf],[data-matsubj],[data-pay],[data-workfor]"); if (!t) return;
  if (t.dataset.pay){
    t.disabled = true; t.textContent = "Открываю оплату…";
    const {data, error} = await sb.functions.invoke("pay", {body: {action: "create", plan: t.dataset.pay, return_url: location.origin + location.pathname + "#paid"}});
    let msg = data?.error; if (error){ msg = error.message; try{ msg = (await error.context.json()).error || msg; }catch(_){} }
    if (msg || !data?.url){ toast(msg || "Оплата недоступна"); t.disabled = false; t.textContent = "Оплатить 30 дней"; return; }
    location.href = data.url; return;
  }
  if (t.dataset.matsubj){ T.matSubject = t.dataset.matsubj; T.courseId = U.coursesOf(T.matSubject)[0]; T.view = "course"; render(); return; }
  if (t.tagName === "A") e.preventDefault();
  if (t.dataset.mascotPick){
    const set = k => { try{ localStorage.setItem("oge-mascot-t", k); }catch(_){} U.setMascot(k); render(); };
    let hasOwn = false; try{ hasOwn = !!localStorage.getItem("oge-mascot-img"); }catch(_){}
    if (t.dataset.mascotPick === "own" && (!hasOwn || t.getAttribute("aria-pressed") === "true")) U.pickMascot(() => set("own")); else set(t.dataset.mascotPick);
    return;
  }
  if (t.dataset.themePick){
    const set = k => { try{ localStorage.setItem("oge-theme-t", k); }catch(_){} U.applyTheme(k); if (sb && T.session) sb.rpc("teacher_set_theme", {p_theme: k}).then(() => {}, () => {}); render(); };
    t.dataset.themePick === "photo" ? U.pickPhoto(() => set("photo")) : set(t.dataset.themePick); return;
  }
  if (t.dataset.view){ T.view = t.dataset.view; if (t.dataset.grade) T.grade = t.dataset.grade; if (t.dataset.subjf) T.subject = t.dataset.subjf; T.confirmDel = null; T.drawer = false; T.justInvited = null; render(); scrollTo(0,0); return; }
  if (t.dataset.grade){ T.grade = t.dataset.grade; render(); return; }
  if (t.dataset.subjf){ T.subject = t.dataset.subjf; render(); return; }
  if (t.dataset.student){ T.sel = t.dataset.student; T.view = "student"; T.review = t.dataset.review || null; T.wreview = t.dataset.wreview || null; T.drawer = false; render(); if (!T.review && !T.wreview) scrollTo(0,0); return; }
  if (t.dataset.lesson){ T.open = t.dataset.lesson; T.view = "lesson"; T.sub = "method"; T.gen = null; render(); scrollTo(0,0); return; }
  if (t.dataset.sub){ T.sub = t.dataset.sub; render(); return; }
  if (t.dataset.goto){
    const s = T.students.find(x => x.id === T.sel);
    if (!s) return;
    const payload = {lesson: t.dataset.goto, sub: t.dataset.sub2 || "theory", page: t.dataset.page};
    cmd(s.id, "goto", payload);
    if (s.pair_id) cmd(s.pair_id, "goto", payload);
    T.lastShow = {at: Date.now(), id: s.id, pair: s.pair_id || null, payload};   // досылаем, если ученик зайдёт позже
    toast(T.online[s.id] ? "Урок открыт у ученика" : "Ученик сейчас не в сети – урок откроется сам, как только он зайдёт"); return;
  }
  if (t.dataset.workfor){ T.workLesson = t.dataset.workfor; T.view = "work"; render(); scrollTo(0, 0); return; }
  if (t.dataset.boardfor === "free"){ cmd(T.sel, "goto", {lesson: "free"}); const s = T.students.find(x => x.id === T.sel); if (s?.pair_id) cmd(s.pair_id, "goto", {lesson: "free"}); }
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
    if (await upd(s.id, {unlocked: [...set]})){ render(); cmd(s.id, "refresh", {msg: t.dataset.on === "1" ? "Учитель открыл урок" : "Расписание обновлено"}); toast(t.dataset.on === "1" ? "Урок открыт для ученика" : "Урок снова закрыт до дня занятия"); }
    return;
  }
  if (t.dataset.review && !t.dataset.act){ T.review = T.review === t.dataset.review ? null : t.dataset.review; T.wreview = null; render(); return; }
  if (t.dataset.wreview && !t.dataset.act){ T.wreview = T.wreview === t.dataset.wreview ? null : t.dataset.wreview; T.review = null; render(); return; }
  const a = t.dataset.act;
  if (a === "covered-toggle"){
    const s = T.students.find(x => x.id === T.sel), lid = t.dataset.lid; if (!s || !lid) return;
    const on = t.dataset.on === "1", covered = {...(s.covered || {})}, manual = {...(s.covered_manual || {})};
    if (on){ covered[lid] = isoToday(); manual[lid] = isoToday(); } else { delete covered[lid]; delete manual[lid]; }
    if (await upd(s.id, {covered, covered_manual: manual})){
      const l = U.findLesson(U.courseFor(s, T.mats), lid);
      render(); cmd(s.id, "refresh", {msg: on ? `Учитель отметил тему пройденной: «${l?.title || ""}»` : "Учитель снял отметку «пройдено»"});
      toast(on ? "Отмечено: тема пройдена" : "Отметка «пройдено» снята");
    }
    return;
  }
  if (a === "qz-build"){ const s = T.students.find(x => x.id === T.sel); if (s) await qzBuild(s); return; }
  if (a === "qz-drop"){
    const d = T.qzDraft; if (!d) return;
    const i = +t.dataset.i;
    if (Number.isInteger(i) && i >= 0 && i < d.questions.length) d.questions.splice(i, 1);
    if (!d.questions.length) T.qzDraft = null;
    render(); return;
  }
  if (a === "qz-save"){ const s = T.students.find(x => x.id === T.sel); if (s) await qzSave(s); return; }
  if (a === "qz-copy"){ await qzCopy(t.dataset.id || T.qzSaved?.id); return; }
  if (a === "qz-open"){ const s = T.students.find(x => x.id === T.sel); if (s) qzOpen(s, t.dataset.id, t.dataset.title); return; }
  if (a && a.startsWith("te-")){ await teAct(a, t); return; }
  if (a && a.startsWith("game-")){ await gameAct(a, t); return; }
  if (a === "ce-reset"){ await ceReset(t); return; }
  if (a && a.startsWith("lab-")){ await labAct(a, t); return; }
  if (a && a.startsWith("ce-")){ await ceAct(a, t); return; }
  if (a === "key-edit"){ T.editKey = +t.dataset.k; render(); $("#key-edit")?.focus(); return; }
  if (a === "key-cancel"){ T.editKey = null; render(); return; }
  if (a === "key-save"){
    const cid = curCourse(), l = teacherCourse(cid).lessons.find(x => x.id === T.open), k = +t.dataset.k, v = $("#key-edit").value.trim();
    if (T.me?.role === "developer" && window.COURSE_KEYS?.[cid] && !l.custom){
      const all = {...(window.COURSE_KEYS[cid] || {})}; const arr = [...(all[l.id] || [])]; arr[k] = v; all[l.id] = arr;
      const {error} = await sb.from("course_data").update({keys: all, updated_at: new Date().toISOString()}).eq("key", cid);
      if (error){ toast("Не сохранилось: " + error.message); return; }
      window.COURSE_KEYS[cid] = all; toast("Ключ обновлён во встроенной базе");
    } else {
      const own = T.mats.find(m => m.kind === "keys" && m.course === cid && m.lesson_id === l.id && m.teacher_id === T.session.user.id);
      const data = {...(own?.data || {}), [k]: v};
      const q = own ? sb.from("materials").update({data}).eq("id", own.id).select().single() : sb.from("materials").insert({course: cid, lesson_id: l.id, kind: "keys", title: "Ключи", data}).select().single();
      const {data: row, error} = await q;
      if (error){ toast("Не сохранилось: " + error.message); return; }
      if (own) own.data = data; else T.mats.push(row);
      toast("Ключ сохранён");
    }
    T.editKey = null; render(); return;
  }
  if (a === "install"){
    if (installEvt){ installEvt.prompt(); installEvt = null; }
    else if (window.matchMedia("(display-mode: standalone)").matches) toast("Приложение уже установлено.");
    else toast("iPhone: Safari → «Поделиться» → «На экран Домой». Android: Chrome → ⋮ → «Добавить на главный экран».");
    return;
  }
  if (a === "add-subject"){
    const s = T.students.find(x => x.id === T.sel), sub = $("#as-subj").value, g = +$("#as-grade").value;
    const {data, error} = await sb.rpc("teacher_add_subject", {p_student: s.id, p_subject: sub, p_grade: g, p_course: U.planFor(sub, g, s.goals || [])});
    if (error){ toast(/subject exists/.test(error.message) ? "Этот предмет у ученика уже есть" : "Не получилось: " + error.message); return; }
    await loadAll(); cmd(s.id, "refresh", {msg: `Добавлен предмет: ${U.subj(sub).n}`}); toast(`Предмет «${U.subj(sub).n}» добавлен. Ученик увидит его в меню под тем же логином.`); return;
  }
  if (a === "save-call"){
    const v = $("#call-url").value.trim();
    if (v && !/^https?:\/\//.test(v)){ toast("Вставьте ссылку целиком, начиная с https://"); return; }
    if (await upd(T.sel, {call_url: v || null})){
      cmd(T.sel, "refresh", {msg: "Учитель добавил ссылку на занятие"}); render(); toast("Ссылка закреплена за учеником");
    }
    return;
  }
  if (a === "sched-apply"){
    const s = T.students.find(x => x.id === T.sel), c = U.courseFor(s, T.mats); if (!s || !c) return;
    const days = [...document.querySelectorAll(".sched-wd:checked")].map(x => +x.value), time = $("#sched-time").value, from = $("#sched-from").value || U.iso(new Date());
    if (!days.length){ toast("Отметьте хотя бы один день недели"); return; }
    const L = c.lessons.filter(l => !s.covered?.[l.id] && l.date >= from);
    const first = c.lessons.find(l => !s.covered?.[l.id] && l.date >= from);
    const todo = first ? c.lessons.slice(c.lessons.indexOf(first)).filter(l => !s.covered?.[l.id]) : L;
    const dates = {...(s.dates || {}), _days: days, _time: time || undefined};
    if (!time) delete dates._time;
    let dt = new Date(from + "T00:00:00"); let k = 0, guard = 0;
    while (k < todo.length && guard++ < 2000){ if (days.includes(dt.getDay())){ dates[todo[k].id] = U.iso(dt); k++; } dt = new Date(dt.getTime() + 864e5); }
    if (await upd(s.id, {dates})){ render(); cmd(s.id, "refresh", {msg: "Учитель обновил расписание"}); toast(`Даты расставлены: ${todo.length} уроков с ${U.fmt(from)}`); }
    return;
  }
  if (a === "start-lesson"){ const s = T.students.find(x => x.id === (t.dataset.id || T.sel)); if (!s) return;
    if (T.room?.sid === s.id && !t.dataset.rl){ T.sel = s.id; T.view = "room"; render(); scrollTo(0, 0); return; }
    const rm = T.me?.room; if (!T.room && rm?.sid === s.id && Date.now() - (rm.at || 0) < 5 * 3600e3 && !t.dataset.rl){ joinRoom(s, rm); return; }
    startRoom(s, t.dataset.rl); return; }
  if (a === "room-tab"){ T.room.tab = t.dataset.tab; render(); roomPersist(); return; }
  if (a === "room-back"){ if (T.room){ T.sel = T.room.sid; T.view = "room"; render(); scrollTo(0, 0); return; }
    const rm = T.me?.room, st = rm && T.students.find(x => x.id === rm.sid); if (!st){ toast("Урок уже завершён"); T.me.room = null; render(); return; }
    joinRoom(st, rm); return; }
  if (a === "room-forget"){ if (T.me) T.me.room = null; if (!T.room) sb.rpc("teacher_set_room", {p_room: null}).then(() => {}, () => {}); render(); return; }
  if (a === "room-who"){ T.room.who = t.dataset.id; T.room.tab = "work"; render(); return; }
  if (a === "room-undo"){ T.room.lesson = T.room.planned; T.room.since = Date.now(); T.room.tab = null; roomSend("lesson"); render(); roomReplan(); return; }
  if (a === "room-move"){ const r = T.room, l = r.lesson, tab = Board.keptPage() || r.shown || r.tab || null; r.shown = tab; r.to.forEach(id => cmd(id, "room-goto", {lesson: l, tab}));
    roomTrack(); toast(T.online[r.sid] ? "Ученик перенесён сюда" : "Ученик не в сети – откроется здесь, когда зайдёт"); return; }
  if (a === "call-start"){ const s = T.students.find(x => x.id === T.room?.sid); if (s) startCallT(s); render(); return; }
  if (a === "join-room"){ const s = T.students.find(x => x.id === t.dataset.id); document.getElementById("callbar").hidden = true; if (s) startRoom(s, t.dataset.rl, true); return; }
  if (a === "del-copy"){
    const m = T.mats.find(x => x.id === +t.dataset.mid); if (!m) return;
    const {error} = await sb.from("materials").delete().eq("id", m.id); if (error){ toast("Не удалилось: " + error.message); return; }
    T.mats = T.mats.filter(x => x.id !== m.id); cmd(m.student_id, "refresh", {msg: "Учитель изменил план"}); render(); toast("Урок убран из плана ученика"); return;
  }
  if (a === "new-meeting"){ T.awaitLink = T.view === "room" ? T.room.sid : T.sel; window.open("https://telemost.yandex.ru/", "_blank", "noopener"); return; }
  if (a === "room-take"){ T.room.take = !T.room.take; render(); return; }
  if (a === "take"){
    const room = t.dataset.mode === "room", s = T.students.find(x => x.id === (room ? T.room.sid : T.sel)), cid = $("#tk-course").value, lid = $("#tk-lesson")?.value;
    if (!s || !lid) return;
    t.disabled = true;
    if (room){
      const r = T.room; if (r.moved){ r.lesson = r.planned; await roomReplan(); }
      const P = U.courseFor(s, T.mats)?.lessons.find(x => x.id === r.planned)?.date || isoToday();
      const nid = await insertLesson(s, cid, lid, P, true); if (!nid){ t.disabled = false; return; }
      r.to.forEach(id => r.base[id] = {...(T.students.find(x => x.id === id)?.dates || {})});
      await roomCover(false); r.planned = nid; r.lesson = nid; r.since = Date.now(); r.take = false; r.moved = false; r.tab = null; T.take = null; roomSend("lesson"); render(); toast("Урок открыт у ученика, план сдвинут на занятие вперёд"); return;
    }
    const nid = await insertLesson(s, cid, lid, $("#tk-date").value || nextLessonDate(s), $("#tk-shift").checked);
    if (nid){ T.take = null; render(); toast("Урок добавлен в план ученика"); } else t.disabled = false;
    return;
  }
  if (a === "lesson-to"){
    const s = T.students.find(x => x.id === $("#lt-student").value); if (!s) return;
    const d0 = nextLessonDate(s), nid = await insertLesson(s, curCourse(), T.open, d0, true);
    if (nid) toast(`Урок добавлен в план: ${s.name}, ${fmt(d0, {day: "numeric", month: "long"})}. Следующие уроки сдвинулись.`); return;
  }
  if (a === "room-invite"){ const r = T.room; r.to.forEach(id => cmd(id, "room-pull", {lesson: r.lesson, url: r.url, tab: r.shown || r.tab || null})); roomTrack(); toast(T.online[r.sid] ? "Ученик перенесён на урок" : "Ученик не в сети – перенесётся, как только откроет приложение"); return; }
  if (a === "room-url"){ const u = $("#room-url").value.trim(); if (!/^https?:\/\//.test(u)){ toast("Вставьте ссылку, которая начинается с https://"); return; }
    T.room.url = u; window.open(u, "_blank", "noopener"); const s = T.students.find(x => x.id === T.room.sid);
    await saveCall(s, u, true);
    roomSend("lesson"); render(); return; }
  if (a === "room-end"){ if (T.me) T.me.room = null; await roomCover(true); if (window.Call) Call.leave(true); const r = T.room, sid = r?.sid; T.room = null; roomTrack(); r?.to.forEach(id => cmd(id, "endlesson", {lesson: r.lesson})); T.view = "student"; T.sel = sid; render(); toast("Урок завершён"); return; }
  if (a === "open-drawer"){ T.drawer = true; render(); }
  if (a === "close-drawer"){ T.drawer = false; render(); }
  if (a === "reload") loadAll();
  if (a === "logout"){ await sb.auth.signOut(); location.href = "./"; }
  if (a === "copy-join"){ const inp = $("#jlink"); try{ await navigator.clipboard.writeText(inp.value); toast("Ссылка скопирована"); }catch(_){ inp.select(); toast("Выделено – скопируйте вручную"); } return; }
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
    render(); cmd(s.id, "refresh", {msg:"Учитель обновил работу в паре"}); if (v) cmd(v, "refresh", {msg:"Учитель обновил работу в паре"}); toast(v ? "Пара сохранена: доска на уроках общая" : "Ученик занимается один");
  }
  if (a === "shift"){
    const s = T.students.find(x => x.id === T.sel), c = U.courseFor(s, T.mats), dates = {...(s.dates || {})}, now = U.iso(new Date());
    c.lessons.filter(l => l.date >= now).forEach(l => dates[l.id] = U.iso(new Date(new Date(l.date + "T00:00:00").getTime() + 7 * 864e5)));
    if (await upd(s.id, {dates})){ render(); cmd(s.id, "refresh", {msg:"Учитель перенёс уроки"}); toast("Будущие уроки перенесены на неделю"); }
  }
  if (a === "review"){
    const row = {student_id: T.sel, lesson_id: T.review, status: t.dataset.st, grade: $("#rv-grade").value.trim(), comment: $("#rv-comment").value.trim(), reviewed_at: new Date().toISOString()};
    const {error} = await sb.from("homework").upsert(row, {onConflict: "student_id,lesson_id"});
    if (error){ toast("Не сохранилось: " + error.message); return; }
    const i = T.hw.findIndex(h => h.student_id === row.student_id && h.lesson_id === row.lesson_id);
    if (i >= 0) T.hw[i] = {...T.hw[i], ...row}; else T.hw.push(row);
    T.review = null; render(); cmd(T.sel, "refresh", {msg:"Учитель проверил ДЗ"}); toast(row.status === "accepted" ? "ДЗ принято" : "Отправлено на доработку");
  }
  if (a === "ai-check"){
    const s = T.students.find(x => x.id === T.sel), c = U.courseFor(s, T.mats), l = U.findLesson(c, T.wreview), w = T.writings.find(x => x.student_id === s.id && x.lesson_id === l.id);
    const src = l.writing ? U.writingSource(c, l, w.kind) : {};
    const srcText = l.writing ? (l.writing.type === "izl" ? c.izl[l.writing.text].paras.join("\n") : c.texts[l.writing.text].text) : "";
    T.busy = "check"; render();
    const r = await ai({action: "check_essay", student_id: s.id, lesson_id: l.id, topic: src.topic, source: srcText});
    T.busy = false; T.ai[s.id + l.id] = r; if (!r.error) w.ai = r; render();
  }
  if (a === "ocr-ai" || a === "ocr-local"){
    const w = T.writings.find(x => x.student_id === T.sel && x.lesson_id === T.wreview); if (!w?.photos?.length) return;
    T.busy = a === "ocr-ai" ? "ocr" : "ocr-local"; render();
    let text = "", err = "";
    try {
      if (a === "ocr-ai"){ const r = await ai({action: "ocr_work", student_id: T.sel, lesson_id: T.wreview}); if (r.error) err = r.error; else text = r.text || ""; }
      else {
        if (!window.Tesseract) await new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"; sc.onload = ok; sc.onerror = () => no(new Error("не загрузился модуль распознавания")); document.head.appendChild(sc); });
        for (const u of w.photos){ const res = await window.Tesseract.recognize(u, "rus"); text += (text ? "\n\n" : "") + (res.data.text || "").trim(); }
        if (text) await sb.from("writings").update({body: text, words: U.wordCount(text)}).eq("student_id", T.sel).eq("lesson_id", T.wreview);
      }
    } catch(e){ err = e.message || String(e); }
    T.busy = false;
    if (err){ render(); toast("Не распознано: " + err); return; }
    w.body = text; w.words = U.wordCount(text); render(); toast("Текст распознан – проверьте его и запустите проверку по критериям");
  }
  if (a === "ai-apply"){
    const w = T.writings.find(x => x.student_id === T.sel && x.lesson_id === T.wreview), r = T.ai[T.sel + T.wreview] || w.ai;
    Object.entries(r.scores || {}).forEach(([k, v]) => { const el = document.querySelector(`[data-crit="${k}"]`); if (el) el.value = String(v); });
    Object.entries(r.errors || {}).forEach(([k, v]) => { const el = document.querySelector(`[data-err="${k}"]`); if (el) el.value = String(v); });
    if (r.comment && !$("#w-comment").value.trim()) $("#w-comment").value = r.comment;
    const TYPE = {orf:"орфография", punct:"пунктуация", gram:"грамматика", speech:"речь", fact:"факт", logic:"логика"};
    if (r.found?.length && !$("#w-fix").value.trim()) $("#w-fix").value = r.found.slice(0, 15).map(f => `«${f.fragment}» → ${f.fix}${TYPE[f.type] ? " (" + TYPE[f.type] + ")" : ""}`).join("\n");
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
    T.mats.push(data); t.disabled = true; render(); cmd(s.id, "refresh", {msg:"В план добавлен новый урок"}); toast(`Урок «${p.title}» добавлен на ${fmt(date)} – дату можно поменять в таблице`);
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
    const {data, error} = await sb.from("materials").insert({course: curCourse(), lesson_id: g.lesson, kind: "tasks", shared: !!$("#ag-shared")?.checked, title: g.res.title || g.topic, data: {mini, test}}).select().single();
    if (error){ toast("Не сохранилось: " + error.message); return; }
    T.mats.push(data); T.gen = null; render(); cmd("all", "refresh", {msg:"Учитель добавил задания"}); toast("Задания сохранены: мини-практика – в «Материалах», вопросы – в тесте урока");
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
    const fix = $("#w-fix").value.split("\n").map(x => x.trim()).filter(Boolean).slice(0, 30);
    const total = crit.length ? crit.reduce((x, [k]) => x + (scores[k] || 0), 0) : null;
    if (fix.length) scores._fix = fix;
    const row = {status: t.dataset.st, scores, errors, comment: $("#w-comment").value.trim(), reviewed_at: new Date().toISOString(),
                 total, max: crit.length ? crit.reduce((x,[,,m]) => x+m, 0) : null};
    const {error} = await sb.from("writings").update(row).eq("student_id", T.sel).eq("lesson_id", T.wreview);
    if (error){ toast("Не сохранилось: " + error.message); return; }
    Object.assign(w, row); T.wreview = null; render(); cmd(T.sel, "refresh", {msg:"Учитель проверил твою работу"}); toast(row.status === "redo" ? "Работа возвращена на доработку" : "Оценка сохранена – ученик её видит");
  }
  if (a === "save-sheet"){
    const cid = curCourse();
    const row = {teacher_id: T.session.user.id, course: cid, lesson_id: T.open, name: $("#sh-name").value.trim(), url: $("#sh-url").value.trim(), note: $("#sh-note").value.trim()};
    const {error} = await sb.from("sheets").upsert(row, {onConflict: "teacher_id,course,lesson_id"});
    if (error){ toast("Не сохранилось: " + error.message); return; }
    T.sheets = T.sheets.filter(x => !(x.course === cid && x.lesson_id === T.open)).concat(row); render(); cmd("all", "refresh", {msg:"Учитель прикрепил рабочий лист"}); toast("Рабочий лист прикреплён");
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
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  try{ const th = localStorage.getItem("oge-theme-t"); if (th) U.applyTheme(th); U.setMascot(localStorage.getItem("oge-mascot-t")); }catch(_){}
  render();
  if (!sb) return;
  const {data} = await sb.auth.getSession();
  T.session = data.session;
  sb.auth.onAuthStateChange((ev, s) => { T.session = s; if (ev === "PASSWORD_RECOVERY"){ T.view = "newpass"; render(); } });
  if (RECOVERY && T.session){ T.view = "newpass"; render(); return; }
  if (LINK_ERR && !T.session){ location.replace("./?role=teacher&msg=" + encodeURIComponent("Ссылка из письма устарела или уже использована. Просто войдите почтой и паролем.")); return; }
  if (!T.session){ location.replace("./?role=teacher"); return; }   // вход – на главной, по одной ссылке
  if (location.hash === "#paid" && sb){
    history.replaceState(null, "", location.pathname);
    const {data: ss} = await sb.auth.getSession();
    if (ss?.session){ T.session = ss.session; toast("Проверяю оплату…"); await sb.functions.invoke("pay", {body: {action: "check"}}).catch(() => {}); T.view = "sub"; }
  }
  const hm = location.hash.match(/^#mat-(\w+)/);
  if (hm){ T.matSubject = hm[1]; T.courseId = U.coursesOf(hm[1])[0]; T.view = "course"; }
  /* после перезагрузки – туда же, где был учитель (в том числе обратно на урок) */
  let rt = null; if (!hm && location.hash !== "#paid") try { rt = JSON.parse(sessionStorage.getItem("t-route") || "null"); } catch(_) {}
  if (rt && ["students","student","course","lesson","methodology","look","sub","board","work"].includes(rt.view)) ["view","sel","open","sub","courseId","matSubject","boardLesson","workLesson"].forEach(k => { if (rt[k] != null) T[k] = rt[k]; });
  if (T.session) await loadAll(); else render();
  if (rt && T.session){
    const st = rt.room && T.students.find(x => x.id === rt.room.sid);
    if (rt.view === "room" && st) joinRoom(st, {...(T.me?.room?.sid === st.id ? T.me.room : {}), lesson: rt.room.lesson, sid: st.id});
    else if (["student","board","work"].includes(T.view) && !T.students.find(x => x.id === T.sel)){ T.view = "students"; render(); }
    if (rt.y && T.view !== "room") requestAnimationFrame(() => scrollTo(0, rt.y));
  }
  T.routeReady = true;
})();
})();
