/* Кабинет учителя: ученики 5–11 классов, приглашения, входные тесты, планы и даты, пары,
   проверка работ (с черновой оценкой нейросети), своя база материалов, доска */
(() => {
const {esc, d, today, fmt, fmtShort, pct, lvl, lvlColor, toast} = U;
const CFG = window.APP_CONFIG || {};
const RECOVERY = /type=recovery/.test(location.hash), LINK_ERR = /error_description=/.test(location.hash) ? decodeURIComponent((location.hash.match(/error_description=([^&]+)/) || [])[1] || "").replace(/\+/g, " ") : "";
const sb = U.supa();
const T = {subject:"all", matSubject:null, addSubj:"rus", session:null, me:null, view:"students", grade:"all", sel:null, open:null, sub:"method", review:null, wreview:null,
           students:[], rows:[], hw:[], writings:[], sheets:[], mats:[], act:[], reports:[], ai:{},
           online:{}, feed:[], live:null, loading:false, confirmDel:null, courseId:null, board:null, boardLesson:null, drawer:false, justInvited:null, gen:null, busy:false};
const $ = s => document.querySelector(s);
const GRADES = [0,1,2,3,4,5,6,7,8,9,10,11];
const ST_COLS = "id,teacher_id,name,course,code,note,created_at,grade,goal,goals,contact,invite_token,registered_at,start_date,dates,unlocked,pair_id,theme,subject,person_id,call_url";
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
  const [st, rs, hw, wr, sh, mt, ac, ar, wk] = await Promise.all([
    sb.from("students").select(ST_COLS).order("created_at"),
    sb.from("results").select("*").order("created_at"),
    sb.from("homework").select("*"), sb.from("writings").select("*"), sb.from("sheets").select("*"),
    sb.from("materials").select("*").order("id"), sb.from("activity").select("*"),
    sb.from("ai_reports").select("*").order("created_at", {ascending: false}).limit(200), sb.from("works").select("*")
  ]);
  const err = [st, rs, hw, wr, sh, mt, ac, ar].find(x => x.error)?.error;
  if (err) toast("Ошибка загрузки: " + err.message + ". Выполните заново supabase/schema.sql.");
  T.students = st.data || []; T.rows = rs.data || []; T.hw = hw.data || []; T.writings = wr.data || []; T.sheets = sh.data || [];
  T.mats = mt.data || []; T.act = ac.data || []; T.reports = ar.data || []; T.works = wk.data || [];
  await ensureCourses([...new Set([...T.students.map(x => x.course), curCourse()])]);
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
function courseOptions(g, subject){
  const keys = U.coursesOf(subject || "rus"), fit = k => { const c = U.getCourse(k); return c.grade === g || (c.grades || []).includes(g); };
  return [...keys.filter(fit), ...keys.filter(k => !fit(k))].map(k => [k, U.getCourse(k).course + (access(k) ? "" : " – база не открыта"), access(k)]);
}
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
        <div data-online="${s.id}"></div>
        <p class="small" style="margin-top:4px"><b>${U.subj(subjOfS(s)).e} ${esc(U.subj(subjOfS(s)).n)}</b></p>
        <p class="small muted">${s.grade != null ? U.gradeName(s.grade) : "класс не указан"}${s.goal ? " · " + esc(s.goal) : ""} · логин ${esc(s.code)}</p>
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
    <h1>${esc(pending(s) ? "Ожидает регистрации" : s.name)}</h1><p>${s.goal ? esc(s.goal) + " · " : ""}логин ${esc(s.code)}</p><div data-online="${s.id}" style="margin-top:6px"></div><img class="cat" data-m src="${U.mascot()}" alt=""></section>
  ${inviteBox(s)}
  <div class="grid2" style="margin-top:16px">
    <div class="card stack" style="gap:6px"><div class="kicker">Анкета</div>
      <p><b>Класс:</b> ${s.grade || "–"}</p><p><b>Цели:</b> ${esc((s.goals || []).join(", ") || s.goal || "–")}</p><p><b>Контакт:</b> ${esc(s.contact || "–")}</p>
      <p><b>Зарегистрирован:</b> ${s.registered_at ? new Date(s.registered_at).toLocaleDateString("ru-RU") : "нет"}</p>
      <div class="row" style="margin-top:6px"><button class="btn ghost sm" data-act="new-invite">${pending(s) ? "Новая ссылка" : "Сбросить пароль (новая ссылка)"}</button></div></div>
    <form class="card stack" id="plan-form" style="gap:8px"><div class="kicker">План работы</div>
      <label for="pl-course">Курс</label>
      <select id="pl-course"><option value="">– не выбран –</option>${courseOptions(s.grade ?? 9, subjOfS(s)).map(([k,n,ok]) => `<option value="${k}" ${k===s.course?"selected":""} ${ok?"":"disabled"}>${esc(n)}</option>`).join("")}</select>
      <p class="small muted">Подсказка по целям ученика: ${esc(U.getCourse(U.planFor(subjOfS(s), s.grade ?? 9, s.goals || []))?.course || "–")}.</p>
      <label for="pl-start">Дата первого урока (дальше – раз в неделю)</label><input type="date" id="pl-start" value="${esc(s.start_date || "")}">
      <p class="small muted">Дату любого урока можно поменять отдельно – в таблице уроков ниже.</p>
      <div><button class="btn sm" type="submit">Сохранить план</button></div></form>
    <div class="card stack" style="gap:8px"><div class="kicker">Предметы ученика</div>
      <div class="stack" style="gap:6px">${siblings(s).map(o => `<button class="subj" ${o.id === s.id ? 'aria-pressed="true"' : `data-student="${o.id}"`}><span class="emo">${U.subj(subjOfS(o)).e}</span><span>${esc(U.subj(subjOfS(o)).n)}<small>${o.grade != null ? U.gradeName(o.grade) : ""}${U.getCourse(o.course) ? " · " + esc(U.getCourse(o.course).course) : ""}</small></span></button>`).join("")}</div>
      ${pending(s) ? `<p class="small muted">Второй предмет можно добавить после регистрации.</p>` : `<label for="as-subj">Добавить предмет – вход у ученика останется тем же</label>
      <select id="as-subj">${U.SUBJECTS.filter(x => !siblings(s).some(o => subjOfS(o) === x.k)).map(x => `<option value="${x.k}">${x.e} ${esc(x.n)}</option>`).join("")}</select>
      <select id="as-grade" aria-label="Класс">${U.subj(U.SUBJECTS.find(x => !siblings(s).some(o => subjOfS(o) === x.k))?.k || "rus").g.map(g => `<option value="${g}" ${g === s.grade ? "selected" : ""}>${U.gradeName(g)}</option>`).join("")}</select>
      <div><button class="btn sm" data-act="add-subject">Добавить предмет</button></div>`}</div>
    <div class="card stack" style="gap:8px"><div class="kicker">Занятие онлайн</div>
      <p class="small muted">Ссылка на созвон: Яндекс Телемост, VK Звонки, Сферум или любая другая – своя для каждого ученика. «Начать занятие» сразу открывает звонок, общую доску и задания текущего урока, а ученику приходит приглашение: он выбирает доску, звонок или то и другое (можно с разных устройств).</p>
      <div class="linkbox"><input type="url" id="call-url" value="${esc(s.call_url || "")}" placeholder="${esc(T.me?.call_url || "https://telemost.yandex.ru/j/…")}"><button class="btn ghost sm" data-act="save-call">Сохранить</button></div>
      <div class="row"><button class="btn sm" data-act="start-lesson">📞 Начать занятие</button><button class="btn ghost sm" data-boardfor="free">Личная доска</button>
        <a class="btn ghost sm" href="https://telemost.yandex.ru/" target="_blank" rel="noopener">Создать встречу в Телемосте</a></div></div>
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
      <td><div class="stack" style="gap:6px"><button class="btn sm" data-act="start-lesson" data-rl="${l.id}" title="Звонок, доска и задания этого урока">▶ Урок</button><button class="btn yellow sm" data-boardfor="${l.id}">Доска</button>${l.practice?.length ? `<button class="btn ghost sm" data-workfor="${l.id}">Тетрадь${(T.works || []).some(w => w.student_id === s.id && w.lesson_id === l.id) ? " ✓" : ""}</button>` : ""}<button class="btn ghost sm" data-goto="${l.id}" title="Откроет этот урок на экране ученика">Показать ученику</button></div></td></tr>
      ${T.review === l.id ? `<tr><td colspan="11"><div class="stack" style="gap:6px;max-width:520px"><b>ДЗ: ${esc(l.title)}</b><p class="small">${esc(l.hw || "")}</p>
          ${hr ? `<p class="small muted">ДЗ-тест: ${esc(U.recText(hr.last))}</p>` : ""}
          <input type="text" id="rv-grade" placeholder="Оценка" value="${esc(h?.grade||"")}"><textarea id="rv-comment" placeholder="Комментарий ученику">${esc(h?.comment||"")}</textarea>
          <div class="row"><button class="btn sm" data-act="review" data-st="accepted">Принять</button><button class="btn ghost sm" data-act="review" data-st="redo">На доработку</button></div></div></td></tr>` : ""}
      ${T.wreview === l.id ? `<tr><td colspan="11"><div style="max-width:760px">${writingReviewHTML(s, x, l)}</div></td></tr>` : ""}`; }).join("")}
  </tbody></table></div>
  <p class="small muted" style="margin-top:8px">«Время» – сколько ученик провёл в папке урока. «Выполнено» – доля сделанного: мини-практика, тест, ДЗ-тест, письмо и отметка ДЗ.</p>`
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

function materialsTab(cid, l){
  const own = T.mats.filter(m => m.course === cid && m.lesson_id === l.id && m.kind !== "lesson" && !m.student_id);
  const g = T.gen && T.gen.lesson === l.id ? T.gen : null;
  return `${own.length ? own.map(m => `<div class="mat"><span class="ic">${{link:"🔗",file:"📎",text:"📝",tasks:"✏️"}[m.kind]}</span><div style="flex:1;min-width:0">
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
  const tabs = [["method","Методика"],["theory","Теория"], l.practice.length && ["practice","Практика"], l.writing && ["writing","Письмо"], Tt.test.length && ["test","Тест"], l.hwtest?.length && ["hwtest","ДЗ-тест"], ["mats","Свои материалы"], ["sheet","Лист и ДЗ"], l.custom && ["edit","Изменить урок"]].filter(Boolean);
  if (!tabs.some(t => t[0] === T.sub)) T.sub = "method";
  const testList = qs => `<ol style="padding-left:20px">${qs.map(q => `<li style="margin-bottom:12px"><b>${esc(q.q)}</b><ul>${q.o.map((o,k) => `<li ${k===q.a?'style="color:var(--good);font-weight:800"':""}>${esc(o)}${k===q.a?" ✓":""}</li>`).join("")}</ul><p class="small muted">${q.tag ? "Правило: " + esc(q.tag) + ". " : ""}${esc(q.e || "")}</p></li>`).join("")}</ol>`;
  let body = "";
  if (!ok) body = `<p>${I.lock} Материалы этого урока откроются в тарифе «С материалами». <a href="#" data-view="sub">Выбрать тариф</a></p>`;
  else {
  if (T.sub === "method") body = `${l.method ? `<p><b>Главное:</b> ${esc(l.method.focus)}</p>` : ""}
      <div class="tablewrap method"><table><thead><tr><th>Минуты</th><th>Этап</th><th>Что делаем</th></tr></thead><tbody>${methodPlan(l).map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <p class="small muted" style="margin-top:6px">Расчёт на 60 минут. Теория идёт маленькими блоками, после каждого – мини-практика.${l.writing ? " Письменную линию не сокращаем: умение писать формируется только регулярной практикой." : ""}</p>
      ${l.method?.tips?.length ? `<h3 style="margin-top:14px">Методические советы</h3><ul>${l.method.tips.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${l.stub ? `<p class="small" style="margin-top:12px">Содержание урока – по ФРП. Добавьте материалы и задания во вкладке «Свои материалы» – можно составить их нейросетью.</p>` : ""}`;
  if (T.sub === "theory") body = U.theoryHTML(l, true) + (Tt.mini.length ? `<div class="tblock">${U.miniHTML({id:"own"}, 0, Tt.mini, true)}</div>` : "");
  if (T.sub === "practice") body = `<p class="small muted">Ключи видите только вы. ✎ – изменить ключ${T.me?.role === "developer" ? " (в режиме разработчика – сразу во встроенной базе для всех)" : " (ваши ключи – только для вас)"}.</p>` + lk.practice.map((p, k) => `<div class="task">
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

/* ---------- урок онлайн: звонок + общая доска + интерактивные задания ученика, всё сразу ---------- */
const isoToday = () => U.iso(new Date());
function lessonNow(c){
  const L = c?.lessons || []; if (!L.length) return "free";
  return (L.find(l => l.date >= isoToday()) || L[L.length - 1]).id;
}
function callOf(s){ return ($("#call-url")?.value.trim()) || s.call_url || T.me?.call_url || ""; }
function roomSend(type){
  const r = T.room; if (!r) return;
  const s = T.students.find(x => x.id === r.sid), c = U.courseFor(s, T.mats), l = r.lesson === "free" ? FREE : c?.lessons.find(x => x.id === r.lesson);
  r.to.forEach(id => cmd(id, type, {lesson: r.lesson, url: r.url, title: l?.title || ""}));
  roomTrack();
}
function roomTrack(){ if (T.live && T.liveOk) T.live.track({role:"teacher", room: T.room ? {to: T.room.to, lesson: T.room.lesson, url: T.room.url, at: T.room.at} : null}).catch(() => {}); }
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
    const dates = r.lesson === "free" || r.lesson === r.planned ? base : replanDates(o, base, r.planned, r.lesson) || base;
    if (JSON.stringify(dates) !== JSON.stringify(o.dates || {})){ if (await upd(id, {dates})){ changed = true; cmd(id, "refresh", {msg: "Учитель перестроил план уроков"}); } }
  }
  r.moved = r.lesson !== "free" && r.lesson !== r.planned;
  if (changed){ render(); const s = T.students.find(x => x.id === r.sid), P = U.courseFor(s, T.mats)?.lessons.find(x => x.id === r.planned);
    toast(r.moved ? `План перестроен: «${P?.title || "урок по плану"}» перенесён на следующее занятие, остальные сдвинулись` : "План уроков возвращён как был"); }
}
function startRoom(s, lesson, keepPlan){
  const url = callOf(s), c = U.courseFor(s, T.mats), planned = c?.lessons.length ? lessonNow(c) : null;
  if (url) window.open(url, "_blank", "noopener");
  const to = [s.id, s.pair_id].filter(Boolean);
  T.room = {sid: s.id, to, lesson: lesson || planned || "free", planned, base: Object.fromEntries(to.map(id => [id, {...(T.students.find(x => x.id === id)?.dates || {})}])), url, at: Date.now(), tab: null, who: s.id};
  T.sel = s.id; T.view = "room"; T.drawer = false; render(); scrollTo(0, 0);
  roomSend("lesson"); if (T.room.lesson !== planned && !keepPlan) roomReplan();
  toast(!url ? "Урок начат без звонка: вставьте ссылку на созвон вверху." : T.online[s.id] ? "Ученику пришло приглашение на урок" : "Ученик пока не в сети – приглашение появится, как только он зайдёт");
}
function roomPane(s, c, l){
  const tab = T.room.tab || (l.practice?.length ? "work" : "theory");
  const who = T.students.find(x => x.id === T.room.who) || s, pair = s.pair_id && T.students.find(x => x.id === s.pair_id);
  let body = "";
  if (tab === "work"){
    const keys = keysFor(who.course, l), st = Object.fromEntries((T.works || []).filter(w => w.student_id === who.id && w.lesson_id === l.id).map(w => [w.task, w.data]));
    body = (pair ? `<div class="seg" role="group" aria-label="Чья тетрадь">${[s, pair].map(o => `<button data-act="room-who" data-id="${o.id}" aria-pressed="${o.id === who.id}">${esc(o.name.split(" ")[0])}</button>`).join("")}</div>` : "")
      + `<p class="small muted">Тетрадь ${esc(who.name.split(" ")[0])} – обновляется вживую, рядом ключи.</p>`
      + `<div id="wk-view">${l.practice.map((p, i) => Work.task({...p, key: keys[i]}, i, st[i] || {}, true).replace('class="task wk"', 'class="task wk ro"')).join("")}</div>`;
  }
  if (tab === "theory") body = l.theory?.length ? U.theoryHTML(l, true) : `<p class="muted">У этого урока нет теории.</p>`;
  if (tab === "mats") body = (l.materials || []).length ? (l.materials || []).map(m => `<div class="mat"><span class="ic">${{link:"🔗", file:"📎", text:"📝", tasks:"✏️"}[m.kind] || "•"}</span><div style="min-width:0;flex:1">${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title || m.url)}</a>` : `<b>${esc(m.title || "Материал")}</b>`}${m.body ? `<div class="small" style="white-space:pre-line">${esc(m.body)}</div>` : ""}</div></div>`).join("") : `<p class="muted">Своих материалов к уроку нет.</p>`;
  const tabs = [l.practice?.length && ["work", "Тетрадь"], ["theory", "Теория"], ["mats", "Материалы"]].filter(Boolean);
  return `<div class="seg" role="group" aria-label="Материалы урока">${tabs.map(([k, n]) => `<button data-act="room-tab" data-tab="${k}" aria-pressed="${tab === k}">${n}</button>`).join("")}</div><div class="room-pane">${body}</div>`;
}
function viewRoom(){
  const r = T.room, s = r && T.students.find(x => x.id === r.sid);
  if (!s){ T.view = "students"; return viewStudents(); }
  const c = U.courseFor(s, T.mats) || {lessons: [], blocks: {}}, l = r.lesson === "free" ? FREE : c.lessons.find(x => x.id === r.lesson) || FREE;
  const pair = s.pair_id && T.students.find(x => x.id === s.pair_id);
  return `<div class="roombar glass">
      <div class="row" style="gap:8px;min-width:0"><span class="live-dot" aria-hidden="true"></span><b>Урок: ${esc(s.name)}${pair ? " и " + esc(pair.name) : ""}</b><span data-online="${s.id}"></span></div>
      <div class="row" style="gap:8px">
        <select id="room-lesson" aria-label="Урок"><option value="free" ${r.lesson === "free" ? "selected" : ""}>Свободная доска</option>${c.lessons.map((x, i) => `<option value="${x.id}" ${x.id === r.lesson ? "selected" : ""}>№ ${i + 1} · ${esc(x.title)}</option>`).join("")}</select>
        ${r.url ? `<a class="btn sm" href="${esc(r.url)}" target="_blank" rel="noopener">📞 Звонок</a>` : `<span class="linkbox" style="min-width:240px"><input type="url" id="room-url" placeholder="Ссылка на созвон (Телемост)"><button class="btn sm" data-act="room-url">📞</button></span>`}
        <button class="btn ghost sm" data-act="room-invite" title="Ещё раз отправить приглашение">Позвать</button>
        <button class="btn ghost sm" data-act="room-end">Завершить</button></div>
      ${r.moved ? `<div class="small" style="flex-basis:100%">Сегодня вместо урока по плану – папки перенесены на следующие занятия. <button class="linkbtn" data-act="room-undo">Вернуть план</button></div>` : r.planned && r.lesson === "free" ? "" : ""}</div>
  <div class="room">
    <article class="window glass room-board" style="--c:${blockOf(c, l).color}"><div class="head"><h1 style="font-size:1.25rem">${esc(l.title)}</h1></div>
      <div class="pane"><div class="board glass" id="board"></div></div></article>
    <article class="window glass room-side"><div class="pane">${l.free ? `<p class="muted">Свободная доска: листы в клетку, в линейку и пустые. Чтобы дать задания, выберите урок вверху.</p>` : roomPane(s, c, l)}</div></article>
  </div>`;
}
function render(){
  if (T.board){ T.board.destroy(); T.board = null; }
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
      <main class="main">${["students","course","student"].includes(T.view) && T.session ? subBanner() : ""}${html}</main></div></div>`;
  if (sb && T.session){ liveStart(); paintOnline(); T.stale = false; }
  if (["board","room"].includes(T.view) && sb && T.session && $("#board")){
    const bl = T.view === "room" ? T.room.lesson : T.boardLesson;
    const s = T.students.find(x => x.id === T.sel), c = U.courseFor(s, T.mats) || {lessons: [], blocks: {}}, l = bl === "free" ? FREE : c.lessons.find(x => x.id === bl) || FREE, owner = ownerOf(s);
    T.board = Board.mount($("#board"), {api: Board.api("teacher", sb, {studentId: owner, lesson: l.id}), sb, channelName: `board-${owner}-${l.id}`, role: "teacher", name: T.me?.name || CFG.TEACHER_NAME || "Учитель", pages: Board.pages(c, l)});
  }
}

/* ключи к заданиям: из базы + свои правки учителя */
function keysFor(cid, l){
  const base = [...((window.COURSE_KEYS?.[cid] || {})[l.id] || [])];
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
  U.loadBase(data); return true;
}
/* установка на телефон */
let installEvt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; });

/* ---------- живая связь: кто из учеников сейчас на платформе и где; мгновенные обновления ---------- */
const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || ["board","room"].includes(T.view);
function liveStart(){
  if (!sb || !T.session || T.live) return;
  T.live = sb.channel(`live-${T.session.user.id}`, {config:{presence:{key:"t-" + T.session.user.id}, broadcast:{self:false}}});
  T.live.on("presence", {event:"sync"}, () => {
    T.online = {}; Object.values(T.live.presenceState()).flat().forEach(p => { if (p.role === "student") T.online[p.id] = p; });
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
/* точечно обновляем значки «онлайн», не перерисовывая страницу (чтобы не сбить ввод и доску) */
function paintOnline(){
  document.querySelectorAll("[data-online]").forEach(el => { const p = T.online[el.dataset.online]; el.innerHTML = p ? `<span class="live">онлайн${p.where ? " · " + esc(p.where) : ""}</span>` : ""; });
  const n = Object.keys(T.online).length, el = document.getElementById("online-count"); if (el) el.innerHTML = n ? `<span class="live">сейчас онлайн: ${n}</span>` : "";
}
let refT = 0;
function refreshSoon(){
  clearTimeout(refT);
  refT = setTimeout(async () => {
    const [rs, hw, wr, ac, st] = await Promise.all([sb.from("results").select("*").order("created_at"), sb.from("homework").select("*"), sb.from("writings").select("*"), sb.from("activity").select("*"), sb.from("students").select(ST_COLS).order("created_at")]);
    if (!st.error) T.students = st.data;
    if (!rs.error) T.rows = rs.data; if (!hw.error) T.hw = hw.data; if (!wr.error) T.writings = wr.data; if (!ac.error) T.act = ac.data;
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
    const row = {name: nick ? "(" + nick + ")" : "(ожидает регистрации)", grade: g, subject: $("#ns-subj").value, course: "", code: U.genCode(), invite_token: U.randHex(18)};
    const {data, error} = await sb.from("students").insert(row).select(ST_COLS).single();
    if (error){ toast(/row-level security/.test(error.message) ? "Подписка закончилась – продлите её в разделе «Подписка»." : "Не удалось создать: " + error.message); return; }
    T.students.push(data); T.justInvited = data; render(); toast("Ссылка создана – скопируйте и отправьте ученику");
  }
  if (id === "plan-form"){
    if (await upd(T.sel, {course: $("#pl-course").value, start_date: $("#pl-start").value || null})){ render(); cmd(T.sel, "refresh", {msg:"Учитель обновил твой план"}); toast("План сохранён – ученик увидит уроки по этим датам"); }
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
document.addEventListener("change", async e => {
  if (e.target.id === "room-lesson" && T.room){ T.room.lesson = e.target.value; T.room.tab = null; roomSend("lesson"); render(); roomReplan(); return; }
  if (e.target.id === "course-pick"){ T.courseId = e.target.value; render(); return; }
  if (e.target.id === "ns-subj"){ T.addSubj = e.target.value; const sel = $("#ns-grade"); sel.innerHTML = U.subj(T.addSubj).g.map(g => `<option value="${g}" ${g===9?"selected":""}>${U.gradeName(g)}</option>`).join(""); return; }
  if (e.target.id === "as-subj"){ const sel = $("#as-grade"); sel.innerHTML = U.subj(e.target.value).g.map(g => `<option value="${g}">${U.gradeName(g)}</option>`).join(""); const s = T.students.find(x => x.id === T.sel); if (s && U.subj(e.target.value).g.includes(s.grade)) sel.value = s.grade; return; }
  if (e.target.id === "am-kind"){ document.querySelectorAll("#add-mat [data-k]").forEach(el => el.hidden = !el.dataset.k.split(" ").includes(e.target.value)); return; }
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
    cmd(s.id, "goto", {lesson: t.dataset.goto, sub: t.dataset.sub2 || "theory", page: t.dataset.page});
    if (s.pair_id) cmd(s.pair_id, "goto", {lesson: t.dataset.goto, sub: t.dataset.sub2 || "theory", page: t.dataset.page});
    toast(T.online[s.id] ? "Урок открыт у ученика" : "Ученик сейчас не в сети – урок откроется, когда он зайдёт и вы нажмёте ещё раз"); return;
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
      if (!T.me?.call_url && v){ await sb.rpc("teacher_set_call", {p_url: v}); if (T.me) T.me.call_url = v; }
      cmd(T.sel, "refresh", {msg: "Учитель добавил ссылку на занятие"}); render(); toast(T.me?.call_url === v ? "Ссылка сохранена (и стала ссылкой по умолчанию для всех учеников)" : "Ссылка сохранена");
    }
    return;
  }
  if (a === "start-lesson"){ const s = T.students.find(x => x.id === (t.dataset.id || T.sel)); if (s) startRoom(s, t.dataset.rl); return; }
  if (a === "room-tab"){ T.room.tab = t.dataset.tab; render(); return; }
  if (a === "room-who"){ T.room.who = t.dataset.id; T.room.tab = "work"; render(); return; }
  if (a === "room-undo"){ T.room.lesson = T.room.planned; T.room.tab = null; roomSend("lesson"); render(); roomReplan(); return; }
  if (a === "join-room"){ const s = T.students.find(x => x.id === t.dataset.id); document.getElementById("callbar").hidden = true; if (s) startRoom(s, t.dataset.rl, true); return; }
  if (a === "room-invite"){ roomSend("lesson"); toast("Приглашение отправлено ещё раз"); return; }
  if (a === "room-url"){ const u = $("#room-url").value.trim(); if (!/^https?:\/\//.test(u)){ toast("Вставьте ссылку, которая начинается с https://"); return; }
    T.room.url = u; window.open(u, "_blank", "noopener"); const s = T.students.find(x => x.id === T.room.sid);
    upd(s.id, {call_url: u});
    roomSend("lesson"); render(); return; }
  if (a === "room-end"){ const r = T.room, sid = r?.sid; T.room = null; roomTrack(); r?.to.forEach(id => cmd(id, "endlesson", {lesson: r.lesson})); T.view = "student"; T.sel = sid; render(); toast("Урок завершён"); return; }
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
    const row = {status: t.dataset.st, scores, errors, comment: $("#w-comment").value.trim(), reviewed_at: new Date().toISOString(),
                 total: crit.length ? Object.values(scores).reduce((x,y) => x+y, 0) : null, max: crit.length ? crit.reduce((x,[,,m]) => x+m, 0) : null};
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
  if (T.session) await loadAll(); else render();
})();
})();
