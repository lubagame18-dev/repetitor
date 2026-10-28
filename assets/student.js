/* Приложение ученика: приглашение → анкета → входной тест → уроки по плану */
(() => {
const {esc, d, today, fmt, fmtShort, daysTo, pct, lvl, lvlColor, toast} = U;
const FIPI = "https://oge.fipi.ru/bank/index.php?proj=2F5EE3B12FE2A0EA40B06BF61A015416";
const RESHU = "https://rus-oge.sdamgia.ru";
const CFG = window.APP_CONFIG || {};
const sb = U.supa();
const S = {view:"home", open:null, sub:"theory", boardPage:"practice", test:null, token:null, profile:null, course:null,
           rows:[], results:{}, hwres:{}, hw:{}, sheets:{}, writings:{}, mats:[], photos:{}, board:null, drawer:false, invite:null, inviteInfo:null, regDone:null, regTheme:null, regMascot:null, forced:new Set()};
const $ = s => document.querySelector(s);
const LS = {get(k, def){ try{ return JSON.parse(localStorage.getItem("oge-" + k)) ?? def; }catch(e){ return def; } },
            set(k, v){ try{ localStorage.setItem("oge-" + k, JSON.stringify(v)); }catch(e){} }};
const I = {
  menu:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>',
  folder:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 6h6l2 2h10v11H3z"/></svg>',
  stats:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
  plan:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
  entry:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg>',
  book:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/></svg>',
  lock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  phone:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>',
  out:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 4h4v16h-4M10 17l5-5-5-5M15 12H3"/></svg>',
  pen:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20l4-1 11-11-3-3L5 16z"/></svg>',
  board:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21l4-4 4 4"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12l5 5 9-10"/></svg>',
  home2:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M4 9h16"/></svg>'
};

/* ---------- курс и даты ---------- */
const blockOf = l => S.course.blocks[l.block] || {name:"Свои уроки", color:U.ownColor()};
const tests = l => U.lessonTests(l);
const isOpen = l => d(l.date) <= today() || (S.profile?.unlocked || []).includes(l.id) || S.forced.has(l.id);
const grade = () => S.profile?.grade || 9;
const subjKey = () => S.profile?.subject || U.subjectOf(S.profile?.course);
const subjName = () => U.subj(subjKey()).n;
const entryTest = () => subjKey() === "rus" ? window.ENTRY_TESTS?.[String(grade())] : null;
const entryRes = () => U.aggregate(S.rows, "entry")["entry-" + grade()];

/* ---------- данные ---------- */
function recompute(){ S.results = U.aggregate(S.rows, "lesson"); S.hwres = U.aggregate(S.rows, "hw"); S.minis = U.aggregate(S.rows, "mini"); S.course = U.courseFor(S.profile, S.mats); U.applyTheme(LS.get("theme", null) || S.profile?.theme); U.setMascot(LS.get("mascot", null) || S.profile?.mascot); }
function saveSession(){ LS.set("session", {token:S.token, profile:S.profile}); }
async function load(){
  if (sb){
    const {data, error} = await sb.rpc("student_state", {p_code: S.token});
    if (error){ toast("Нет связи с сервером. Показываю сохранённое."); return; }
    if (!data){ logout("Вход устарел: учитель выдал новую ссылку. Войди заново."); return; }
    S.profile = data.profile; saveSession();
    S.rows = data.results || [];
    S.hw = Object.fromEntries((data.homework || []).map(h => [h.lesson_id, h]));
    S.sheets = Object.fromEntries((data.sheets || []).map(h => [h.lesson_id, h]));
    S.writings = Object.fromEntries((data.writings || []).map(h => [h.lesson_id, h]));
    S.mats = data.materials || [];
    S.base = data.course_data ? [{key: S.profile.course, data: data.course_data}] : [];
    U.loadBase(S.base);
    LS.set("cache", {rows:S.rows, hw:S.hw, sheets:S.sheets, writings:S.writings, mats:S.mats, base:S.base});
  } else {
    S.rows = LS.get("rows", []); S.hw = LS.get("hw", {}); S.writings = LS.get("writings", {}); S.sheets = {};
  }
  recompute();
}
function logout(msg){ LS.set("session", null); S.token = null; S.profile = null; S.view = "home"; render(); if (msg) toast(msg); }
async function sendResult(lesson_id, kind, score, total, wrong, dur){
  S.rows.push({lesson_id, kind, score, total, wrong, duration_sec:dur, created_at: new Date().toISOString()}); recompute();
  if (sb){
    const {error} = await sb.rpc("student_submit_result", {p_code:S.token, p_lesson:lesson_id, p_score:score, p_total:total, p_wrong:wrong, p_kind:kind, p_duration:dur ?? null});
    if (error) toast("Результат не отправлен: нет связи. Пройди тест ещё раз, когда появится интернет.");
    else liveAct(`${kind === "mini" ? "мини-практика" : kind === "hw" ? "ДЗ-тест" : kind === "entry" ? "входной тест" : "тест"}: ${score} из ${total}`);
  } else LS.set("rows", S.rows);
}
async function sendHw(lesson_id, note, silent){
  const prev = S.hw[lesson_id] || {};
  S.hw[lesson_id] = {...prev, lesson_id, note, status: prev.status === "accepted" ? "accepted" : "sent", sent_at: new Date().toISOString()};
  if (sb){ const {error} = await sb.rpc("student_submit_homework", {p_code:S.token, p_lesson:lesson_id, p_note:note}); if (error){ toast("Не отправилось. Проверь интернет."); return; } liveAct("отметил ДЗ"); }
  else LS.set("hw", S.hw);
  if (!silent) toast("ДЗ отмечено. Учитель увидит отметку.");
}
async function sendWriting(l, kind, body){
  const words = U.wordCount(body), photos = S.photos[l.id] || S.writings[l.id]?.photos || [];
  S.writings[l.id] = {lesson_id:l.id, kind, text_id:l.writing.text, body, words, photos, status:"sent", scores:{}, errors:{}, submitted_at:new Date().toISOString()};
  if (sb){ const {error} = await sb.rpc("student_submit_writing", {p_code:S.token, p_lesson:l.id, p_kind:kind, p_text:l.writing.text, p_body:body, p_words:words, p_photos:photos}); if (error){ toast("Не отправилось. Текст сохранён на устройстве – попробуй ещё раз."); return; } liveAct("прислал письменную работу"); }
  else LS.set("writings", S.writings);
  try{ localStorage.removeItem("oge-draft-" + l.id); }catch(_){}
  toast("Работа отправлена учителю на проверку.");
}

/* фото рукописной работы: уменьшаем на устройстве и отправляем через серверную функцию */
function uploadPhoto(lessonId){
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.capture = "environment";
  inp.onchange = () => { const f = inp.files[0]; if (!f) return; const img = new Image();
    img.onload = async () => {
      const k = Math.min(1, 1800 / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = img.width * k; c.height = img.height * k; c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL("image/jpeg", .82); URL.revokeObjectURL(img.src);
      const list = S.photos[lessonId] = [...(S.photos[lessonId] || S.writings[lessonId]?.photos || [])];
      if (!sb){ list.push(data); render(); return; }
      toast("Загружаю фото…");
      const {data: r, error} = await sb.functions.invoke("ai", {body:{action:"upload_work", code:S.token, lesson:lessonId, data}});
      if (error || !r?.url){ toast("Фото не загрузилось. Проверь интернет."); return; }
      list.push(r.url); render(); toast("Фото прикреплено. Не забудь отправить работу.");
    };
    img.src = URL.createObjectURL(f); };
  inp.click();
}
/* ---------- живая связь с учителем: где ученик сейчас, мгновенные обновления ---------- */
let live = null, liveT = 0;
const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || (S.view === "folder" && S.sub === "board");
function liveStart(){
  if (!sb || !S.profile?.teacher || live) return;
  live = sb.channel(`live-${S.profile.teacher}`, {config:{presence:{key:"s-" + S.profile.id}, broadcast:{self:false}}});
  live.on("broadcast", {event:"cmd"}, async ({payload:m}) => {
    const mine = [S.profile.id, ...(S.profile.subjects || []).map(x => x.id)];   // команда по любому предмету этого ученика
    if (!m?.cmd || (!mine.includes(m.to) && m.to !== "all")) return;
    if (m.type === "refresh"){ await load(); if (!typing()) render(); toast(m.msg || "Учитель обновил твои материалы"); }
    if (m.type === "call"){
      if (m.url) S.profile.call_url = m.url;
      const bar = document.getElementById("callbar");
      bar.innerHTML = `<span>📞 Учитель начал занятие</span><a class="btn sm" href="${esc(S.profile.call_url || "#")}" target="_blank" rel="noopener">Подключиться</a><button class="btn ghost sm" data-go="myboard">Доска</button><button class="iconbtn" aria-label="Скрыть" onclick="this.parentElement.hidden=true">✕</button>`;
      bar.hidden = false; return;
    }
    if (m.type === "goto" && m.lesson === "free"){ S.view = "myboard"; S.drawer = false; if (m.page) S.boardPage = m.page; render(); toast("Учитель открыл личную доску"); return; }
    if (m.type === "goto" && S.course){
      const l = S.course.lessons.find(x => x.id === m.lesson); if (!l) return;
      S.forced.add(l.id); S.open = l.id; S.sub = m.sub || "theory"; if (m.page) S.boardPage = m.page; S.view = "folder"; S.drawer = false;
      render(); scrollTo(0, 0); toast(`Учитель открыл урок «${l.title}»`);
    }
  });
  live.subscribe(st => { if (st === "SUBSCRIBED") liveTrack(true); });
}
function liveTrack(now){
  if (!live) return;
  clearTimeout(liveT);
  liveT = setTimeout(() => {
    const l = S.view === "folder" && S.course?.lessons.find(x => x.id === S.open);
    const TAB = {theory:"Теория", practice:"Практика", board:"Доска", writing:"Письмо", mats:"Материалы", hw:"Домашка", test:"Тест"};
    const where = S.view === "myboard" ? "на личной доске" : S.view === "folder" ? `урок «${l?.title || ""}» · ${TAB[S.sub] || ""}` : S.view === "test" ? `проходит ${S.test?.kind === "entry" ? "входной тест" : "тест"}: ${S.test?.title || ""}` : ({home:"на главной", lessons:"смотрит уроки", stats:"смотрит статистику", plan:"смотрит план", entry:"входной тест", look:"меняет оформление"}[S.view] || "");
    live.track({role:"student", id:S.profile.id, name:S.profile.name, where, lesson: l?.id || null, at: Date.now()}).catch(() => {});
  }, now ? 0 : 250);
}
/* сообщить учителю о сделанном – у него всё обновится сразу */
function liveAct(text){ if (live) live.send({type:"broadcast", event:"act", payload:{act:true, id:S.profile.id, name:S.profile.name, text}}).catch(() => {}); }

/* время в папке урока: раз в минуту, пока вкладка на экране */
setInterval(() => {
  if (S.view !== "folder" || !S.open || document.hidden || !S.token) return;
  if (sb) sb.rpc("student_ping", {p_code:S.token, p_lesson:S.open, p_seconds:60}).then(() => {}, () => {});
  else { const t = LS.get("time", {}); t[S.open] = (t[S.open] || 0) + 60; LS.set("time", t); }
}, 60000);

/* ---------- вход и регистрация ---------- */
function authHero(sub){
  return `<section class="hero glass"><span class="mono muted">${esc(CFG.SCHOOL_TAG || "Учу по ФРП · репетиторство")}</span>
    <h1>${esc(sub)}</h1><p>Уроки в папках, общая доска, сочинения и карта успеха.</p>
    <img class="cat" data-m src="${U.mascot()}" alt="Котик-отличник в очках и академической шапочке"></section>`;
}
function viewRegister(){
  if (S.regDone) return authHero("Добро пожаловать!") + `<div class="card login stack">
    <h2>Регистрация прошла</h2>
    <p>Твой логин: <b class="tnum" style="font-size:1.3rem">${esc(S.regDone.login)}</b></p>
    <p class="small muted">Запиши его. С логином и паролем можно войти с другого телефона или компьютера.</p>
    <button class="btn" data-go="${entryTest() ? "entry" : "home"}">${entryTest() ? "Пройти входной тест" : "Начать"}</button></div>`;
  if (S.inviteInfo === false) return authHero("Ссылка уже использована") + `<div class="card login stack">
    <p>Эта ссылка одноразовая и уже сработала. Если ты зарегистрировался, войди логином и паролем. Если нет – попроси у учителя новую ссылку.</p>
    <button class="btn" data-act="to-login">Войти</button></div>`;
  const inf = S.inviteInfo || {};
  return authHero("Регистрация ученика") + `<form class="card login stack" id="reg-form">
    <h2>Расскажи о себе</h2>
    <label for="r-name">Имя и фамилия</label><input type="text" id="r-name" required autocomplete="name" value="${esc(inf.name || "")}">
    <p><span class="chip">${U.subj(inf.subject || "rus").e} ${esc(U.subj(inf.subject || "rus").n)}</span></p>
    <label for="r-grade">Класс</label>
    <select id="r-grade" required>${U.subj(inf.subject || "rus").g.map(g => `<option value="${g}" ${(inf.grade ?? 9) === g ? "selected" : ""}>${U.gradeName(g)}</option>`).join("")}</select>
    <fieldset style="border:0;padding:0;margin:0"><legend style="font-weight:800;font-size:.88rem;margin-bottom:8px">Цели (можно несколько)</legend>
      <div class="goals">${U.GOALS.filter(x => U.subj(inf.subject || "rus").exam || !["ОГЭ","ЕГЭ"].includes(x)).map(x => `<label><input type="checkbox" name="goal" value="${esc(x)}" ${(() => { const ex = U.subj(inf.subject || "rus").exam && (inf.grade ?? 9) === 9; return (ex && x === "ОГЭ") || (!ex && x === "Контрольные и домашние") ? "checked" : ""; })()}> ${esc(x === "ОГЭ" || x === "ЕГЭ" || x === "ВПР" ? "Подготовка к " + x : x)}</label>`).join("")}</div></fieldset>
    <div><b style="font-size:.88rem">Фон кабинета – по настроению</b><p class="small muted" style="margin:2px 0 8px">Потом можно поменять в разделе «Оформление».</p>${U.themesHTML(S.regTheme || inf.theme)}</div>
    <div><b style="font-size:.88rem">Помощник на уроках</b><p class="small muted" style="margin:2px 0 8px">Можно загрузить свою картинку.</p>${U.mascotsHTML(S.regMascot || "kotik")}</div>
    <label for="r-contact">Телефон или Telegram (твой или родителя)</label><input type="text" id="r-contact" autocomplete="tel">
    <label for="r-pass">Придумай пароль (не меньше 6 символов)</label><input type="password" id="r-pass" minlength="6" required autocomplete="new-password">
    <label for="r-pass2">Повтори пароль</label><input type="password" id="r-pass2" minlength="6" required autocomplete="new-password">
    <p class="small" id="r-err" hidden style="color:var(--bad)"></p>
    <button class="btn" type="submit">Зарегистрироваться</button>
  </form>`;
}
function viewLogin(){
  const role = S.role || "student";
  return authHero(CFG.TITLE || "Учу по ФРП · уроки") + `<div class="card login stack">
    <div class="filters" role="group" aria-label="Кто входит"><button data-role="student" aria-pressed="${role==="student"}">Я ученик</button><button data-role="teacher" aria-pressed="${role==="teacher"}">Я учитель</button></div>
    ${role === "teacher" && S.signup ? (S.signupDone ? `<div class="stack" style="gap:8px"><h3>Почти готово!</h3><p>Мы отправили письмо на <b>${esc(S.signupDone)}</b>. Откройте его и нажмите ссылку – кабинет откроется, и начнётся пробный период.</p><button class="btn ghost sm" data-act="to-signin">Уже подтвердила – войти</button></div>`
    : `<form class="stack" id="signup-form" style="gap:10px">
      <h3>Регистрация репетитора</h3>
      <label for="su-name">Имя и отчество (так вас увидят ученики)</label><input type="text" id="su-name" required autocomplete="name">
      <label for="su-email">Почта</label><input type="email" id="su-email" autocomplete="username" required>
      <label for="su-pass">Пароль (не меньше 8 символов)</label><input type="password" id="su-pass" minlength="8" autocomplete="new-password" required>
      <button class="btn" type="submit">Зарегистрироваться</button>
      <p class="small" id="su-err" hidden style="color:var(--bad)"></p>
      <p class="small muted">Сначала – бесплатный пробный период со всеми возможностями. Потом тариф от 100 ₽ в месяц.</p>
      <button class="btn ghost sm" type="button" data-act="to-signin">У меня уже есть кабинет – войти</button></form>`)
    : role === "teacher" ? `<form class="stack" id="teacher-form" style="gap:10px">
      <label for="tl-email">Почта</label><input type="email" id="tl-email" autocomplete="username" required>
      <label for="tl-pass">Пароль</label><input type="password" id="tl-pass" autocomplete="current-password" required>
      <button class="btn" type="submit">Войти в кабинет учителя</button>
      <p class="small" id="tl-err" hidden style="color:var(--bad)">Почта или пароль не подходят.</p>
      <button class="btn ghost sm" type="button" data-act="to-signup">Я репетитор, хочу кабинет – зарегистрироваться</button></form>`
    : `<form class="stack" id="login-form" style="gap:10px">
    ${sb ? `<label for="l-login">Логин</label><input type="text" id="l-login" autocapitalize="characters" autocomplete="username" placeholder="Например, K7M3QPA" required>
    <label for="l-pass">Пароль</label><input type="password" id="l-pass" autocomplete="current-password" required>`
    : `<p class="small muted">Демо-режим: сервер ещё не подключён, всё сохраняется только на этом устройстве.</p>
       <label for="l-login">Имя</label><input type="text" id="l-login" required>
       <label for="l-grade">Класс</label><select id="l-grade">${[5,6,7,8,9,10,11].map(g => `<option value="${g}" ${g===9?"selected":""}>${g} класс</option>`).join("")}</select>`}
    <button class="btn" type="submit">Войти</button>
    <p class="small" id="login-err" hidden style="color:var(--bad)">Логин или пароль не подходят.</p>
    <p class="small muted">Впервые здесь? Открой ссылку-приглашение от учителя.</p></form>`}
    <button class="btn ghost" data-act="install">📲 Скачать на телефон</button>
  </div>`;
}

/* ---------- оболочка ---------- */
function drawerHTML(){
  const p = S.profile, ini = (p.name || "?").split(/\s+/).map(x => x[0]).slice(0,2).join("").toUpperCase();
  const nav = [["home","Главная",I.home],["lessons","Мои уроки",I.folder],["myboard","Личная доска",I.board],["stats","Статистика",I.stats],["plan","План работы",I.plan], entryTest() && ["entry","Входной тест",I.entry],["look","Оформление",I.pen]].filter(Boolean);
  const mine = p.subjects?.length ? p.subjects : [{id:p.id, subject:subjKey(), grade:p.grade}];
  const others = U.SUBJECTS.filter(x => !mine.some(m => m.subject === x.k) && x.g.includes(+p.grade));
  const cur = S.view === "folder" ? "lessons" : S.view === "test" ? (S.test?.kind === "entry" ? "entry" : "lessons") : S.view;
  return `<div class="me"><div class="avatar">${esc(ini)}</div><div style="min-width:0"><b>${esc(p.name)}</b><div class="small muted">${p.grade ? p.grade + " класс" : ""}${p.goal ? " · " + esc(p.goal) : ""}</div>${p.pair ? `<div class="small pairtag">👥 в паре: ${esc(p.pair.name.split(" ")[0])}</div>` : ""}</div></div>
   <div class="group"><span class="mono">Предметы</span>
     ${mine.map(m => m.id === p.id ? `<button class="navitem" data-go="lessons" ${cur==="lessons"?'aria-current="page"':""}><span class="emo">${U.subj(m.subject).e}</span>${esc(U.subj(m.subject).n)}<span class="chip" style="margin-left:auto">${U.gradeName(m.grade).replace(" класс", " кл.")}</span></button>`
       : `<button class="navitem" data-switch="${m.id}"><span class="emo">${U.subj(m.subject).e}</span>${esc(U.subj(m.subject).n)}<span class="chip" style="margin-left:auto">${U.gradeName(m.grade).replace(" класс", " кл.")}</span></button>`).join("")}
     ${others.map(x => `<button class="navitem" disabled title="Подключает учитель"><span class="emo">${x.e}</span>${esc(x.n)}<span class="lock">${I.lock}</span></button>`).join("")}</div>
   <div class="group"><span class="mono">Разделы</span>
     ${nav.map(([k,n,ic]) => `<button class="navitem" data-go="${k}" ${cur===k?'aria-current="page"':""}>${ic}${n}</button>`).join("")}</div>
   <div class="group"><span class="mono">Ещё</span>
     ${p.call_url ? `<a class="navitem" href="${esc(p.call_url)}" target="_blank" rel="noopener">📞 Созвон с учителем</a>` : ""}
     ${CFG.BOT_USERNAME ? `<a class="navitem" href="https://t.me/${esc(CFG.BOT_USERNAME.replace(/^@/,""))}" target="_blank" rel="noopener">${I.entry}Бот в Telegram</a>` : ""}
     <button class="navitem" data-act="logout">${I.out}Выйти</button></div>
   ${!sb ? '<p class="small muted" style="padding:0 8px">Демо-режим: данные хранятся на этом устройстве.</p>' : ""}
   <div class="drawer-foot"><button class="btn" data-act="install" style="width:100%;justify-content:center">${I.phone.replace('<svg','<svg width="18" height="18"')} Скачать на телефон</button></div>`;
}
const TITLES = {myboard:"Личная доска", look:"Оформление", home:"Главная", lessons:"Мои уроки", folder:"Урок", test:"Тест", stats:"Статистика", plan:"План работы", entry:"Входной тест", install:"Установить на телефон"};

/* ---------- экраны ---------- */
function folderHTML(l){
  const b = blockOf(l), i = S.course.lessons.indexOf(l), open = isOpen(l), nx = nextLesson();
  const r = S.results[l.id], hr = S.hwres[l.id], w = S.writings[l.id], hs = U.hwState(S.course, l.id, S.hw);
  return `<button class="folder ${open ? "" : "locked"} ${l === nx ? "next" : ""}" style="--c:${b.color}" data-open="${l.id}" aria-label="Урок ${i+1}: ${esc(l.title)}${open ? "" : ", откроется " + fmt(l.date)}">
    <span class="back"></span><span class="papers"><i></i><i></i></span>
    <span class="front">
      ${open ? "" : `<span class="lockico">${I.lock}</span>`}
      <span class="num">№ ${String(i+1).padStart(2,"0")} · ${fmt(l.date,{day:"numeric",month:"short"}).toUpperCase()}</span>
      <span class="ttl">${esc(l.title)}</span>
      <span class="meta">${open ? `${r ? `<span class="pill">тест ${pct(r.best)}%</span>` : ""}${hr ? `<span class="pill">ДЗ ${pct(hr.best)}%</span>` : ""}${w?.max ? `<span class="pill">✍ ${w.total}/${w.max}</span>` : ""}${hs.c==="bad" ? '<span class="pill">ДЗ!</span>' : ""}<span class="arrow">→</span>`
        : `<span class="pill">откроется ${fmt(l.date,{day:"numeric",month:"short"})}</span>`}</span>
    </span></button>`;
}
const nextLesson = () => S.course?.lessons.find(l => d(l.date) >= today()) || null;
const lastPast = () => S.course ? [...S.course.lessons].reverse().find(l => d(l.date) < today()) || null : null;

function noCourse(){
  const er = entryRes();
  return `<div class="card stack"><h2>План работы готовится</h2>
    <p>Учитель составляет план: ${esc(subjName())}, ${esc(U.gradeName(grade()))}${entryTest() ? ", по результатам входного теста" : ""}. Как только план будет готов, здесь появятся папки уроков.</p>
    ${er || !entryTest() ? "" : `<div><button class="btn" data-go="entry">Пройти входной тест</button></div>`}</div>`;
}

function viewHome(){
  const p = S.profile, er = entryRes(), et = entryTest();
  const cards = [];
  if (et && !er) cards.push(`<div class="card accent"><div class="kicker">Сначала</div><h2 style="margin-top:6px">Входной тест</h2>
      <p class="small" style="margin:6px 0 12px">${et.q.length} вопросов по материалу прошлого года. По результатам учитель выстроит план.</p>
      <button class="btn" data-go="entry">Начать</button></div>`);
  if (S.course){
    const nx = nextLesson(), due = nx ? S.course.lessons[S.course.lessons.indexOf(nx)-1] : null, lp = lastPast(), isToday = nx && daysTo(nx.date) === 0;
    if (nx) cards.push(`<div class="card ${er ? "accent" : ""}"><div class="kicker">${isToday ? "Урок сегодня" : "Следующий урок"}</div>
      <h2 style="margin-top:6px">${fmt(nx.date,{weekday:"long",day:"numeric",month:"long"})}</h2>
      <p style="margin:6px 0 12px"><span class="dot" style="background:${blockOf(nx).color}"></span> ${esc(nx.oge)} · <b>${esc(nx.title)}</b></p>
      <div class="row">${isOpen(nx) ? `<button class="btn" data-open="${nx.id}">Открыть папку</button><button class="btn ghost" data-open="${nx.id}" data-sub="board">На доску</button>` : `<span class="chip">${I.lock.replace('<svg','<svg width="14" height="14"')} откроется в день урока</span><span class="chip tnum">через ${daysTo(nx.date)} дн.</span>`}</div></div>`);
    if (due){
      const hs = U.hwState(S.course, due.id, S.hw), hr = S.hwres[due.id], w = S.writings[due.id];
      cards.push(`<div class="card"><div class="kicker">Сдать ${isToday ? "сегодня" : "к " + fmtShort(nx.date)}</div>
        <h3 style="margin-top:6px">ДЗ: ${esc(due.title)}</h3>
        <ul class="small" style="margin:8px 0 10px;padding-left:18px">
          ${due.hwtest?.length ? `<li>${hr ? `ДЗ-тест: <b>${pct(hr.best)}%</b>` : `<a href="#" data-open="${due.id}" data-sub="hw">Пройти ДЗ-тест</a>`}</li>` : ""}
          ${due.writing ? `<li>${w ? `${esc(U.KIND_NAME[w.kind] || "Работа")}: ${w.status === "sent" ? "отправлено" : "проверено"}` : `<a href="#" data-open="${due.id}" data-sub="writing">Написать: ${esc(U.KIND_NAME[due.writing.type])}</a>`}</li>` : ""}
          ${due.hw ? `<li>${esc(due.hw)}</li>` : ""}</ul>
        <span class="chip ${hs.c}">${hs.t}</span></div>`);
    }
    const testTodo = lp && !S.results[lp.id] && tests(lp).test.length ? lp : null;
    if (testTodo) cards.push(`<div class="card"><div class="kicker">Тест после урока</div><h3 style="margin-top:6px">${esc(testTodo.title)}</h3>
        <p class="small muted" style="margin:6px 0 12px">${tests(testTodo).test.length} вопросов, результат увидит учитель.</p>
        <button class="btn" data-test="${testTodo.id}" data-kind="lesson">Пройти тест</button></div>`);
  }
  const avg = S.course ? U.avgAll(S.course, S.results) : null, avgHw = S.course ? U.avgAll(S.course, S.hwres) : null;
  const exam = (S.course?.events || []).find(e => e.kind === "exam" && daysTo(e.date) >= 0);
  const nx = nextLesson();
  return `<section class="hero glass"><span class="mono muted">${esc(p.grade != null ? U.gradeName(p.grade) : "")} · ${esc(subjName().toLowerCase())}</span><span class="mono r muted">${new Date().toLocaleDateString("ru-RU")}</span>
    <h1>Привет, ${esc((p.name || "").split(" ")[0])}!</h1>${p.pair ? `<p class="small" style="margin-top:4px">👥 Напарник: ${esc(p.pair.name)}. Доска на уроке общая.</p>` : ""}<p>${S.course ? esc(S.course.course) : "План работы скоро появится."}</p>
    <img class="cat" data-m src="${U.mascot()}" alt="Котик-отличник"></section>
  <div class="section-title"><h2>Сейчас</h2></div>
  <div class="grid2">${p.call_url ? `<div class="card"><div class="kicker">Занятие онлайн</div><h3 style="margin-top:6px">Созвон с учителем</h3><p class="small muted" style="margin:6px 0 12px">Ссылка всегда одна и та же. Во время занятия держи открытыми созвон и доску.</p><div class="row"><a class="btn" href="${esc(p.call_url)}" target="_blank" rel="noopener">📞 Подключиться</a><button class="btn ghost" data-go="myboard">Личная доска</button></div></div>` : ""}
    ${cards.join("") || (S.course ? (S.course.lessons.length ? `<div class="card"><h2>Курс завершён</h2><p class="muted">Удачи на экзамене!</p></div>` : `<div class="card"><h2>Уроки скоро появятся</h2><p class="muted">Учитель добавляет материалы по предмету «${esc(subjName())}».</p></div>`) : noCourse())}
    ${S.course ? `<div class="card"><div class="kicker">Итоги</div><div class="row" style="margin-top:8px;gap:22px">
      <div><div class="big tnum">${avg ?? "–"}${avg!=null?"%":""}</div><div class="small muted">тесты на уроках</div></div>
      <div><div class="big tnum">${avgHw ?? "–"}${avgHw!=null?"%":""}</div><div class="small muted">качество ДЗ</div></div>
      ${exam ? `<div><div class="big tnum">${daysTo(exam.date)}</div><div class="small muted">дн. до ${esc(exam.short || exam.title)}</div></div>` : ""}</div></div>` : ""}
  </div>
  ${S.course ? `<div class="section-title"><h2>Ближайшие уроки</h2><button class="btn ghost sm" data-go="lessons">Все уроки</button></div>
  <div class="folders">${(() => { const L = S.course.lessons, i = Math.max(0, L.indexOf(nx || L.at(-1)) - 1); return L.slice(i, i + 4).map(folderHTML).join(""); })()}</div>` : ""}`;
}

function viewLessons(){
  if (!S.course) return `<div class="section-title" style="margin-top:6px"><h2>Мои уроки · ${esc(subjName().toLowerCase())}</h2></div>` + noCourse();
  let out = "", month = "";
  const items = [...S.course.lessons.map(l => ({date:l.date, l})), ...(S.course.events || []).map(e => ({date:e.date, e}))].sort((a,b) => a.date < b.date ? -1 : 1);
  for (const it of items){
    const m = fmt(it.date, {month:"long", year:"numeric"});
    if (m !== month){ month = m; out += `<div class="month">${m[0].toUpperCase() + m.slice(1)}</div>`; }
    out += it.l ? folderHTML(it.l) : `<div class="event glass ${it.e.kind}">${fmt(it.e.date)} – ${esc(it.e.title)}</div>`;
  }
  if (!S.course.lessons.length) return `<div class="section-title" style="margin-top:6px"><h2>Мои уроки · ${esc(subjName().toLowerCase())}</h2></div>
    <div class="card"><p>Учитель ещё не добавил уроки. Как только добавит – здесь появятся папки.</p></div>`;
  return `<div class="section-title" style="margin-top:6px"><h2>Мои уроки · ${esc(subjName().toLowerCase())}</h2><span class="chip">${esc(S.course.tag || "")}</span><span class="chip">${S.course.lessons.length} уроков</span></div>
    <p class="small muted">Папка открывается в день урока. Пройденные уроки остаются открытыми.</p>
    <div class="legend" style="margin:10px 0 4px">${Object.values(S.course.blocks).filter(b => S.course.lessons.some(l => blockOf(l) === b)).map(b => `<span><i class="dot" style="background:${b.color}"></i>${esc(b.name)}</span>`).join("")}</div>
    <div class="folders">${out}</div>`;
}

const toBoard = page => `<div class="toboard"><button class="btn ghost sm" data-sub="board" data-bpage="${page}">${I.board.replace('<svg','<svg width="16" height="16"')} Открыть на доске</button></div>`;

function writingBody(l){
  const w = l.writing, mine = S.writings[l.id];
  const kind = w.type === "choice" ? (mine?.kind && mine.kind !== "izl" ? mine.kind : LS.get("etype", "13.3")) : w.type;
  const src = U.writingSource(S.course, l, w.type === "choice" ? kind : null);
  let draft = ""; try{ draft = localStorage.getItem("oge-draft-" + l.id) || ""; }catch(_){}
  const locked = mine && mine.status !== "redo";
  const body = locked ? mine.body : (draft || mine?.body || "");
  const minW = ["thesis","example"].includes(w.type) ? 0 : 70, words = U.wordCount(body);
  return `<div class="theory">${U.stepHTML(w.step)}</div>
    <div class="card" style="margin-top:14px;box-shadow:none"><div class="kicker">На уроке</div><p style="margin-top:4px">${esc(w.classwork)}</p>
      <div class="kicker" style="margin-top:10px">Домашнее письмо</div><p style="margin-top:4px"><b>${esc(w.task)}</b></p></div>
    ${w.type === "choice" ? `<div class="row" style="margin-top:14px" role="group" aria-label="Тип сочинения">${["13.1","13.2","13.3"].map(k => `<button class="btn ${k===kind?"":"ghost"} sm" data-etype="${k}" ${locked?"disabled":""}>${k}</button>`).join("")}</div>` : ""}
    <div style="margin-top:16px"><div class="kicker">Текст «${esc(src.title)}»</div>
      <div class="ttext" style="white-space:normal">${src.html}</div>
      <p style="margin-top:10px"><b>Тема:</b> ${esc(src.topic)}</p></div>
    ${toBoard("text")}
    <div class="stack" style="margin-top:14px;gap:8px">
      <label for="essay">Твой текст</label>
      <textarea id="essay" class="essay-area" ${locked?"readonly":""} data-lesson="${l.id}" placeholder="Пиши здесь. Черновик сохраняется автоматически.">${esc(body)}</textarea>
      <div class="row between"><span class="chip tnum" id="wc">${words} сл.${minW?` / нужно не меньше ${minW}`:""}</span>
        ${!locked ? `<button class="btn" data-act="send-writing" data-kind="${w.type === "izl" ? "izl" : kind}">${mine?.status==="redo"?"Отправить исправленное":"Отправить на проверку"}</button>` : ""}</div>
      ${["13.1","13.2","13.3","choice"].includes(w.type) && !locked ? `<details class="small"><summary><b>Проверь себя перед отправкой</b></summary><ul style="margin:6px 0 0;padding-left:18px">
        <li>Первый абзац – прямой ответ на вопрос темы (приём «зеркало»: повтори слова вопроса).</li><li>Два примера из текста с номерами предложений.</li><li>После каждого примера – пояснение: что он доказывает.</li><li>Примеры связаны между собой.</li><li>Вывод возвращает к тезису.</li><li>Не меньше 70 слов, абзацы.</li></ul></details>` : ""}
    </div>
    <div class="card" style="margin-top:14px;box-shadow:none"><div class="kicker">Пишешь от руки?</div>
      <p class="small" style="margin:4px 0 8px">Сфотографируй работу – учитель проверит по фото. Можно несколько страниц.</p>
      <div class="row">${(S.photos[l.id] || mine?.photos || []).map((u, k) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Страница ${k+1}" style="width:72px;height:96px;object-fit:cover;border-radius:10px;border:1px solid var(--line)"></a>`).join("")}
      ${!locked ? `<button class="btn ghost sm" data-act="photo">📷 Прикрепить фото</button>` : ""}</div></div>
    ${U.writingResultHTML(S.course, mine)}`;
}

function materialsHTML(l){
  const M = l.materials || [];
  if (!M.length) return `<p class="muted">Учитель пока не добавил материалы к этому уроку.</p>`;
  return M.map(m => {
    const ic = {link:"🔗", file:"📎", text:"📝", tasks:"✏️"}[m.kind] || "•";
    let inner = "";
    if (m.kind === "link" || m.kind === "file") inner = `<a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title || m.url)}</a>${m.body ? `<p class="small muted">${esc(m.body)}</p>` : ""}
      ${m.kind === "file" && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(m.url || "") ? `<img src="${esc(m.url)}" alt="" style="margin-top:8px;border-radius:12px;max-height:340px">` : ""}`;
    if (m.kind === "text") inner = `<b>${esc(m.title || "Материал")}</b><div style="white-space:pre-line;margin-top:6px">${esc(m.body || "")}</div>`;
    if (m.kind === "tasks") inner = `<b>${esc(m.title || "Задания")}</b>${U.miniHTML({id: "m" + m.id}, 0, m.data?.mini, false)}${m.data?.test?.length ? `<p class="small muted" style="margin-top:8px">Вопросы теста из этого набора – во вкладке «Тест».</p>` : ""}`;
    return `<div class="mat"><span class="ic">${ic}</span><div style="min-width:0;flex:1">${inner}</div></div>`;
  }).join("") + toBoard(M.some(m => m.kind === "text" || m.kind === "tasks") ? "m" + M.find(m => m.kind === "text" || m.kind === "tasks").id : "blank");
}

function viewFolder(){
  const L = S.course.lessons, l = L.find(x => x.id === S.open), b = blockOf(l), i = L.indexOf(l);
  const r = S.results[l.id], hr = S.hwres[l.id], sh = S.sheets[l.id] || {}, h = S.hw[l.id] || {}, hs = U.hwState(S.course, l.id, S.hw), due = L[i+1];
  const T = tests(l), M = l.materials || [];
  const tabs = [["theory","Теория",I.book], (l.practice?.length || sh.url) && ["practice","Практика",I.pen], ["board","Доска",I.board],
    l.writing && ["writing","Письмо",I.pen], (M.length || l.stub) && ["mats","Материалы",I.folder], (l.hw || l.hwtest?.length) && ["hw","Домашка",I.home2],
    T.test.length && ["test","Тест",I.check]].filter(Boolean);
  if (!tabs.some(t => t[0] === S.sub)) S.sub = "theory";
  const miniDone = l.theory.filter((t, k) => t.mini?.length && S.minis[`${l.id}:${k}`]).length, miniAll = l.theory.filter(t => t.mini?.length).length;
  let pane = "";
  if (S.sub === "theory") pane = (l.theory.length ? U.theoryHTML(l) : `<p class="muted">Теорию к этому уроку учитель даст на занятии – загляни во вкладку «Материалы».</p>`)
      + (l.practice?.length ? `<div class="card" style="margin-top:16px;box-shadow:none"><div class="kicker">Дальше</div><p style="margin-top:4px">Теория и мини-практика пройдены – переходи к заданиям в формате экзамена.</p><div style="margin-top:8px"><button class="btn sm" data-sub="practice">К практике →</button></div></div>` : "") + toBoard("theory");
  if (S.sub === "practice") pane = `${sh.url ? `<p style="margin-bottom:10px"><a class="btn yellow sm" href="${esc(sh.url)}" target="_blank" rel="noopener">${esc(sh.name || "Рабочий лист")}</a></p>` : ""}
      ${sh.note ? `<p class="small" style="margin-bottom:8px">${esc(sh.note)}</p>` : ""}${U.practiceHTML(l, false)}${toBoard("practice")}
      ${S.course.goal === "ОГЭ" ? `<p class="small muted" style="margin-top:14px">Реальные задания: <a href="${FIPI}" target="_blank" rel="noopener">открытый банк ФИПИ</a> · <a href="${RESHU}" target="_blank" rel="noopener">«Решу ОГЭ»</a></p>` : ""}
      ${S.course.goal === "ЕГЭ" ? `<p class="small muted" style="margin-top:14px">Реальные задания: <a href="https://ege.fipi.ru/bank/" target="_blank" rel="noopener">открытый банк ФИПИ</a> · <a href="https://rus-ege.sdamgia.ru" target="_blank" rel="noopener">«Решу ЕГЭ»</a></p>` : ""}`;
  if (S.sub === "board") pane = `<div class="board glass" id="board"></div><p class="small muted" style="margin-top:8px">Доска общая с учителем${S.profile.pair ? ` и с ${esc(S.profile.pair.name.split(" ")[0])}` : ""}: видно курсоры и всё, что рисуют. Чтобы листать на телефоне – выбери ✋, увеличить – двумя пальцами.</p>`;
  if (S.sub === "writing") pane = writingBody(l);
  if (S.sub === "mats") pane = materialsHTML(l);
  if (S.sub === "hw") pane = `<ol style="margin:0;padding-left:20px">
        ${l.hw ? `<li>${esc(l.hw)}</li>` : ""}${l.writing ? `<li>Письмо: ${esc(l.writing.task)} <a href="#" data-sub="writing">Открыть</a></li>` : ""}${l.hwtest?.length ? `<li>ДЗ-тест: ${l.hwtest.length} вопросов – проверь, как усвоил тему.</li>` : ""}</ol>
      <div class="row" style="margin-top:12px"><span class="chip ${hs.c}">${hs.t}</span>${due?`<span class="chip">срок: ${fmt(due.date,{weekday:"short",day:"numeric",month:"long"})}</span>`:""}</div>
      ${l.hwtest?.length ? `<div class="card" style="margin-top:14px;box-shadow:none"><div class="kicker">ДЗ-тест</div>
        ${hr ? `<div class="row" style="margin-top:6px"><span class="big tnum" style="color:${lvlColor(pct(hr.last))}">${pct(hr.last)}%</span><span class="small muted">лучший ${pct(hr.best)}% · попыток: ${hr.attempts}</span></div>
          <p class="expl small"><b>Рекомендация:</b> ${esc(U.recText(hr.last))}</p>` : `<p class="muted" style="margin-top:6px">Пройди после того, как сделаешь домашнее задание.</p>`}
        <div style="margin-top:10px"><button class="btn" data-test="${l.id}" data-kind="hw">${hr ? "Пройти ещё раз" : "Начать ДЗ-тест"}</button></div></div>` : ""}
      ${h.comment ? `<p class="expl small"><b>Комментарий учителя:</b> ${esc(h.comment)}</p>` : ""}
      ${h.status !== "accepted" ? `<div class="stack" style="margin-top:12px;gap:8px"><label for="hw-note">Комментарий или ссылка на фото работы</label>
        <textarea id="hw-note" placeholder="Например, ссылка на фото в Google Диске">${esc(h.note || "")}</textarea>
        <div><button class="btn yellow" data-act="send-hw">${h.status ? "Обновить отметку" : "Я сделал ДЗ"}</button></div></div>` : ""}`;
  if (S.sub === "test") pane = `${r ? `<div class="row"><span class="big tnum" style="color:${lvlColor(pct(r.last))}">${pct(r.last)}%</span>
        <span class="small muted">последняя попытка · лучший ${pct(r.best)}% · попыток: ${r.attempts}</span></div>
        <p class="expl small"><b>Рекомендация:</b> ${esc(U.recText(r.last))}</p>` : `<p class="muted">${T.test.length} вопросов по теме. Пройди в конце урока.</p>`}
      <div class="row" style="margin-top:12px"><button class="btn" data-test="${l.id}" data-kind="lesson">${r ? "Пройти ещё раз" : "Начать тест"}</button></div>`;
  return `<div class="row between" style="margin-bottom:12px"><button class="btn ghost sm" data-go="lessons">← Все уроки</button>
    <div class="row">${i>0 && isOpen(L[i-1])?`<button class="btn ghost sm" data-open="${L[i-1].id}">‹ № ${i}</button>`:""}${i<L.length-1 && isOpen(L[i+1])?`<button class="btn ghost sm" data-open="${L[i+1].id}">№ ${i+2} ›</button>`:""}
      <button class="btn ghost sm" data-act="download" title="Скачать урок как документ Word">⤓ Скачать</button></div></div>
  <article class="window glass" style="--c:${b.color}">
    <div class="head">
      <div class="corners"><div class="mono muted">Дата:<br><b style="color:var(--ink)">${fmt(l.date,{day:"numeric",month:"long",year:"numeric"})}</b></div><div class="mono muted">${esc(l.oge.split(" ")[0])}:<br><b style="color:var(--ink)">${esc(l.oge.replace(/^\S+\s*/,"") || l.oge)}</b></div></div>
      <h1>${esc(l.title)}</h1>
      <div class="rule">✦</div>
      <p class="mono muted">${esc(b.name)} · урок ${i+1} из ${L.length}</p>
    </div>
    <div class="tabs" role="group" aria-label="Разделы урока"><span class="lights" aria-hidden="true"><i></i><i></i><i></i></span>${tabs.map(([k,n,ic]) => `<button data-sub="${k}" aria-pressed="${S.sub===k}">${ic}${n}</button>`).join("")}</div>
    <div class="pane">${pane}</div>
    <div class="foot mono muted"><span>${miniAll ? `мини-практика ${miniDone}/${miniAll}` : `${l.learn.length} темы урока`}</span><span>тест ${r ? pct(r.best) + "%" : "–"} · дз ${hr ? pct(hr.best) + "%" : "–"}</span></div>
  </article>`;
}

const viewLook = () => `<div class="section-title" style="margin-top:6px"><h2>Оформление</h2></div>
  <div class="card stack"><h3>Тема</h3><p class="small muted">Фон, стекло, папки и кнопки меняются вместе – в одной цветовой гамме. Своё фото: цвета папок подберутся по нему. Фото хранится только на этом устройстве.</p>${U.themesHTML(LS.get("theme", null) || S.profile.theme)}</div>
  <div class="card stack" style="margin-top:16px"><h3>Помощник</h3><p class="small muted">Встречает на главной, подсказывает в памятках и хвалит за тесты. Можно загрузить свою картинку (PNG с прозрачным фоном – будет как наклейка).</p>${U.mascotsHTML(LS.get("mascot", null) || S.profile.mascot)}</div>`;

function startTest(id, kind){
  let qs, title;
  if (kind === "entry"){ const et = entryTest(); qs = et.q; title = et.title; id = "entry-" + grade(); }
  else { const l = S.course.lessons.find(x => x.id === id); qs = kind === "hw" ? l.hwtest : tests(l).test; title = l.title; }
  S.test = {id, kind, qs, title, i:0, picked:null, score:0, wrong:[], t0:Date.now(), order:qs.map(q => U.shuffle(q.o.map((_,k) => k)))};
  S.view = "test"; render(); scrollTo(0,0);
}
function viewTest(){
  const T = S.test, n = T.qs.length, label = {hw:"ДЗ-тест", entry:"Входной тест", lesson:"Тест по уроку"}[T.kind];
  const back = T.kind === "entry" ? `data-go="entry"` : `data-open="${T.id}" data-sub="${T.kind==="hw"?"hw":"test"}"`;
  if (T.i >= n){
    const p = Math.round(T.score / n * 100);
    return `<article class="card" style="text-align:center">
        <span class="tag">${label} завершён</span><h1 style="margin:12px 0 4px;font-size:1.8rem">${esc(T.title)}</h1>
        <img data-m src="${U.mascot()}" alt="" style="width:150px;margin-top:8px">
        <div class="big tnum" style="font-size:2.6rem;color:${lvlColor(p)}">${T.score} из ${n}</div>
        <p style="margin:4px 0 14px;font-weight:800">${p===100?"Котик ставит сто баллов!":p>=80?"Отличный результат!":p>=60?"Неплохо, есть что повторить.":T.kind==="entry"?"Спасибо! Учитель увидит, с чего начать.":"Тему повторим на уроке."}</p>
        ${T.kind === "entry" ? "" : `<p class="expl small" style="text-align:left"><b>Рекомендация:</b> ${esc(U.recText({score:T.score,total:n,wrong:T.wrong}))}</p>`}
        <div class="row" style="justify-content:center;margin-top:14px"><button class="btn" ${back}>${T.kind==="entry"?"Посмотреть результаты":"В папку"}</button><button class="btn ghost" data-go="stats">Статистика</button></div>
      </article>`;
  }
  const q = T.qs[T.i], ord = T.order[T.i];
  return `<div class="row between" style="margin-bottom:10px"><button class="btn ghost sm" ${back}>✕ Выйти</button><span class="chip tnum">${label} · ${T.i+1} из ${n}</span></div>
  <div class="progress"><i style="width:${T.i/n*100}%"></i></div>
  <article class="card" style="margin-top:14px">
    <div class="kicker">${esc(T.title)}</div>
    <p class="q">${esc(q.q)}</p>
    <div class="opts">${ord.map(k => { let c = ""; if (T.picked != null){ if (k === q.a) c = "ok"; else if (k === T.picked) c = "no"; }
      return `<button class="opt ${c}" data-pick="${k}" ${T.picked!=null?"disabled":""}>${esc(q.o[k])}</button>`; }).join("")}</div>
    ${T.picked != null ? `${T.kind === "entry" ? "" : `<div class="expl"><b>${T.picked===q.a?"Верно.":"Неверно."}</b> ${esc(q.e)}</div>`}
      <div style="margin-top:14px"><button class="btn" data-act="next-q">${T.i===n-1?"Завершить":"Дальше"}</button></div>` : ""}
  </article>`;
}

function viewEntry(){
  const et = entryTest(), er = entryRes();
  if (!et) return `<div class="card"><p>Входной тест для этого класса пока не готов.</p></div>`;
  return `<div class="section-title" style="margin-top:6px"><h2>${esc(et.title)}</h2></div>
    ${er ? window.entryHTML(et, er) + `<div class="card" style="margin-top:16px"><h3>Что дальше</h3><p style="margin-top:6px">${S.course ? "Учитель уже составил план – уроки ждут в разделе «Мои уроки». Темы с ошибками повторим в первую очередь." : "Учитель составит план по этим результатам. Темы с ошибками разберём в первую очередь."}</p>
      <div class="row" style="margin-top:12px">${S.course ? `<button class="btn" data-go="lessons">Мои уроки</button>` : ""}<button class="btn ghost" data-act="retry-entry">Пройти ещё раз</button></div></div>`
    : `<div class="card stack"><p>${esc(et.note)} ${et.q.length} вопросов, правильные ответы не показываются – это нормально: тест нужен, чтобы понять, с чего начать.</p>
      <div><button class="btn" data-act="start-entry">Начать тест</button></div></div>`}`;
}

function viewStats(){
  const et = entryTest(), er = entryRes();
  return `<div class="section-title" style="margin-top:6px"><h2>Статистика</h2></div>
    ${S.course ? window.mapHTML(S.course, S.results, S.hwres, S.writings) : ""}
    ${et && er ? `<div class="section-title"><h2>Входной тест</h2></div>${window.entryHTML(et, er)}` : ""}
    ${!S.course && !er ? noCourse() : ""}`;
}

function viewPlan(){
  if (!S.course){
    const er = entryRes(), et = entryTest();
    return `<div class="section-title" style="margin-top:6px"><h2>План работы</h2></div>${noCourse()}${er ? `<div class="section-title"><h2>Темы, с которых начнём</h2></div>${window.entryHTML(et, er, true)}` : ""}`;
  }
  const L = S.course.lessons;
  const rows = [...L.map(l => ({date:l.date, l})), ...(S.course.events || []).map(e => ({date:e.date, e}))].sort((a,b) => a.date < b.date ? -1 : 1);
  return `<div class="section-title" style="margin-top:6px"><h2>План работы</h2><span class="chip">${esc(S.course.course)}</span></div>
  <div class="tablewrap glass"><table style="min-width:760px"><thead><tr><th>№</th><th>Дата</th><th>Тема</th><th>Домашнее задание</th><th>Письмо</th><th>Тест / ДЗ</th></tr></thead><tbody>
  ${rows.map(x => x.e ? `<tr class="ev"><td></td><td class="tnum">${fmtShort(x.date)}</td><td colspan="4">${esc(x.e.title)}</td></tr>` :
   `<tr><td class="tnum">${L.indexOf(x.l)+1}</td><td class="tnum" style="white-space:nowrap">${fmtShort(x.date)}</td><td><i class="dot" style="background:${blockOf(x.l).color}"></i> <b>${esc(x.l.oge)}</b><br>${esc(x.l.title)}</td><td class="small">${esc(x.l.hw || "–")}</td><td class="small">${esc(x.l.writing?.task || "–")}</td><td class="tnum">${S.results[x.l.id]?pct(S.results[x.l.id].best)+"%":"–"} / ${S.hwres[x.l.id]?pct(S.hwres[x.l.id].best)+"%":"–"}</td></tr>`).join("")}
  </tbody></table></div>`;
}

const FREE = {id:"free", title:"Личная доска", free:true, theory:[], practice:[], materials:[]};
const viewMyBoard = () => `<div class="section-title" style="margin-top:6px"><h2>Личная доска</h2><span class="small muted">общая с учителем${S.profile.pair ? " и напарником" : ""}, всё сохраняется</span></div>
  <div class="board glass" id="board"></div>`;
/* установка на телефон: Android/Chrome – системное окно, iPhone – подсказка */
let installEvt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; });
async function install(){
  if (installEvt){ installEvt.prompt(); const r = await installEvt.userChoice.catch(() => null); if (r?.outcome === "accepted") toast("Готово! Иконка появится на экране телефона."); installEvt = null; return; }
  if (window.matchMedia("(display-mode: standalone)").matches){ toast("Приложение уже установлено."); return; }
  S.view = "install"; S.drawer = false; render(); scrollTo(0, 0);
}
const viewInstall = () => `<div class="section-title" style="margin-top:6px"><h2>Скачать на телефон</h2></div>
  <p class="small muted" style="margin-bottom:12px">Приложение ставится прямо с сайта, без магазина: на экране появится иконка, и уроки будут открываться на весь экран.</p>
  ${installEvt ? `<div style="margin-bottom:14px"><button class="btn" data-act="install">📲 Установить сейчас</button></div>` : ""}
  <div class="grid2"><div class="card"><h3>iPhone и iPad</h3><ol class="small" style="margin:8px 0 0;padding-left:20px"><li>Открой сайт в Safari.</li><li>«Поделиться» (квадрат со стрелкой) → «На экран Домой».</li><li>«Добавить» – появится иконка с котиком.</li></ol></div>
  <div class="card"><h3>Android</h3><ol class="small" style="margin:8px 0 0;padding-left:20px"><li>Открой сайт в Chrome.</li><li>Меню ⋮ → «Добавить на главный экран».</li><li>Открывай иконку с котиком как приложение.</li></ol></div></div>`;

/* ---------- отрисовка ---------- */
function render(){
  if (S.board){ S.board.destroy(); S.board = null; }
  const app = $("#app");
  if (S.invite){ app.innerHTML = `<main class="main">${viewRegister()}</main>`; return; }
  if (!S.profile){ app.innerHTML = `<main class="main">${viewLogin()}</main>`; return; }
  const v = S.view;
  const body = v==="home"?viewHome():v==="lessons"?viewLessons():v==="folder"?viewFolder():v==="test"?viewTest():v==="stats"?viewStats():v==="plan"?viewPlan():v==="entry"?viewEntry():v==="look"?viewLook():v==="myboard"?viewMyBoard():viewInstall();
  app.innerHTML = `<div class="shell">
    <div class="drawer-back" ${S.drawer ? "" : "hidden"} data-act="close-drawer"></div>
    <nav class="drawer glass ${S.drawer ? "open" : ""}" aria-label="Меню">${drawerHTML()}</nav>
    <div style="min-width:0">
      <header class="topnav"><div class="in glass">
        <button class="iconbtn menu-btn" data-act="open-drawer" aria-label="Открыть меню">${I.menu}</button>
        <span class="ttl">${esc(TITLES[v] || "")}</span>
        <img data-m src="${U.mascot()}" alt="" style="width:38px;height:38px;object-fit:contain">
      </div></header>
      <main class="main">${body}</main>
    </div></div>`;
  if (v === "folder" && S.sub === "board"){
    const l = S.course.lessons.find(x => x.id === S.open);
    S.board = Board.mount($("#board"), {
      api: Board.api("student", sb, {code:S.token, lesson:l.id}),
      sb, channelName: sb ? `board-${S.profile.board_owner || S.profile.id}-${l.id}` : null, page: S.boardPage,
      role: "student", name: S.profile.name, pages: Board.pages(S.course, l), onPage: p => S.boardPage = p
    });
  }
  if (v === "myboard"){
    S.board = Board.mount($("#board"), {api: Board.api("student", sb, {code:S.token, lesson:"free"}), sb, channelName: sb ? `board-${S.profile.board_owner || S.profile.id}-free` : null,
      page: S.boardPage, role: "student", name: S.profile.name, pages: Board.pages(S.course || {}, FREE), onPage: p => S.boardPage = p});
  }
  if (S.profile && sb){ liveStart(); liveTrack(); }
}

/* ---------- события ---------- */
document.addEventListener("submit", async e => {
  e.preventDefault();
  if (e.target.id === "signup-form"){
    const err = $("#su-err"), email = $("#su-email").value.trim();
    if (!sb){ err.textContent = "Сервер ещё не подключён."; err.hidden = false; return; }
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
    const {data, error} = await sb.auth.signUp({email, password: $("#su-pass").value, options: {data: {name: $("#su-name").value.trim()}, emailRedirectTo: location.origin + location.pathname.replace(/index\.html$/, "") + "teacher.html"}});
    btn.disabled = false;
    if (error){ err.textContent = /registered|exists/i.test(error.message) ? "Эта почта уже зарегистрирована – войдите." : "Не получилось: " + error.message; err.hidden = false; return; }
    if (data.session){ location.href = "teacher.html"; return; }   // если подтверждение почты выключено
    S.signupDone = email; render(); return;
  }
  if (e.target.id === "teacher-form"){
    const err = $("#tl-err");
    if (!sb){ location.href = "teacher.html"; return; }
    const {error} = await sb.auth.signInWithPassword({email: $("#tl-email").value.trim(), password: $("#tl-pass").value});
    if (error){ err.hidden = false; return; }
    location.href = "teacher.html"; return;
  }
  if (e.target.id === "login-form"){
    const btn = e.target.querySelector("button"); btn.disabled = true;
    if (sb){
      const {data} = await sb.rpc("student_login", {p_login: $("#l-login").value, p_password: $("#l-pass").value});
      btn.disabled = false;
      if (!data){ $("#login-err").hidden = false; return; }
      S.token = data.token; S.profile = data.profile;
    } else {
      btn.disabled = false;
      const g = +$("#l-grade").value, goals = g === 9 ? ["ОГЭ"] : g >= 10 ? ["ЕГЭ"] : ["Контрольные и домашние"];
      S.token = "local"; S.profile = {id:"local", name:$("#l-login").value.trim(), grade:g, goals, goal:goals.join(", "), course: U.planFor(g, goals), start_date: U.iso(new Date()), dates:{}, unlocked:[]};
    }
    saveSession(); await load(); S.view = "home"; render();
  }
  if (e.target.id === "reg-form"){
    const err = $("#r-err"), show = t => { err.textContent = t; err.hidden = false; };
    const name = $("#r-name").value.trim(), g = +$("#r-grade").value, p1 = $("#r-pass").value, p2 = $("#r-pass2").value;
    const goals = [...document.querySelectorAll('input[name=goal]:checked')].map(x => x.value);
    if (!goals.length) return show("Отметь хотя бы одну цель.");
    if (name.split(/\s+/).length < 2) return show("Напиши имя и фамилию.");
    if (p1.length < 6) return show("Пароль – не меньше 6 символов.");
    if (p1 !== p2) return show("Пароли не совпадают.");
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
    if (sb){
      const {data, error} = await sb.rpc("student_register", {p_invite:S.invite, p_name:name, p_grade:g, p_goals:goals, p_contact:$("#r-contact").value.trim(), p_password:p1, p_course:U.planFor(S.inviteInfo?.subject || "rus", g, goals), p_theme:S.regTheme});
      btn.disabled = false;
      if (error || !data) return show("Не получилось: ссылка уже использована или нет связи. Попроси у учителя новую ссылку.");
      S.token = data.token; S.profile = data.profile;
      if (S.regMascot){ S.profile.mascot = S.regMascot; sb.rpc("student_set_mascot", {p_code:S.token, p_mascot:S.regMascot}).then(() => {}, () => {}); }
    } else {
      btn.disabled = false;
      S.token = "local"; S.profile = {id:"local", subject:"rus", mascot:S.regMascot, name, grade:g, goals, goal:goals.join(", "), course: U.planFor(g, goals), start_date: U.iso(new Date()), dates:{}, unlocked:[], login:"DEMO", theme:S.regTheme};
    }
    saveSession(); await load();
    S.regDone = {login: S.profile.login}; history.replaceState(null, "", location.pathname); render();
    setTimeout(() => liveAct("зарегистрировался"), 1500);
  }
});
document.addEventListener("input", e => {
  if (e.target.id !== "essay") return;
  try{ localStorage.setItem("oge-draft-" + e.target.dataset.lesson, e.target.value); }catch(_){}
  const l = S.course.lessons.find(x => x.id === e.target.dataset.lesson), minW = ["thesis","example"].includes(l.writing.type) ? 0 : 70, n = U.wordCount(e.target.value);
  const wc = $("#wc"); wc.textContent = `${n} сл.${minW ? ` / нужно не меньше ${minW}` : ""}`; wc.className = "chip tnum " + (minW && n < minW ? "bad" : n ? "good" : "");
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && S.drawer){ S.drawer = false; render(); } });
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-go],[data-open],[data-test],[data-pick],[data-act],[data-sub],[data-etype],[data-theme-pick],[data-mascot-pick],[data-role],[data-switch]"); if (!t) return;
  if (t.dataset.role){ S.role = t.dataset.role; render(); return; }
  if (t.dataset.switch){
    if (!sb) return;
    const {data} = await sb.rpc("student_switch", {p_code:S.token, p_target:t.dataset.switch});
    if (!data){ toast("Не получилось переключиться. Проверь интернет."); return; }
    if (live){ sb.removeChannel(live); live = null; }
    S.token = data.token; S.profile = data.profile; S.view = "home"; S.drawer = false; S.forced = new Set(); saveSession(); await load(); render(); scrollTo(0, 0);
    toast(`Предмет: ${subjName()}`); return;
  }
  if (t.dataset.mascotPick){
    const set = k => { U.setMascot(k);
      if (S.invite){ S.regMascot = k; document.querySelectorAll("[data-mascot-pick]").forEach(b => b.setAttribute("aria-pressed", b.dataset.mascotPick === k)); return; }
      LS.set("mascot", k); if (S.profile) S.profile.mascot = k; saveSession();
      if (sb && S.token) sb.rpc("student_set_mascot", {p_code:S.token, p_mascot:k}).then(() => {}, () => {}); render(); };
    let hasOwn = false; try{ hasOwn = !!localStorage.getItem("oge-mascot-img"); }catch(_){}
    if (t.dataset.mascotPick === "own" && (!hasOwn || t.getAttribute("aria-pressed") === "true"))
      U.pickMascot(() => { set("own"); const box = t.closest(".mascots")?.parentElement; if (S.invite && box) box.querySelector(".mascots").outerHTML = U.mascotsHTML("own").replace(/<input[^>]*>/, ""); });
    else set(t.dataset.mascotPick);
    return;
  }
  if (t.dataset.themePick){
    const set = k => { if (S.invite){ S.regTheme = k; U.applyTheme(k); document.querySelectorAll("[data-theme-pick]").forEach(b => b.setAttribute("aria-pressed", b.dataset.themePick === k)); return; }
      LS.set("theme", k); U.applyTheme(k); if (S.profile) S.profile.theme = k; saveSession();
      if (sb && S.token) sb.rpc("student_set_theme", {p_code:S.token, p_theme:k}).then(() => {}, () => {}); render(); };
    if (t.dataset.themePick === "photo") U.pickPhoto(() => set("photo")); else set(t.dataset.themePick);
    return;
  }
  if (t.tagName === "A" && !t.href.startsWith("http")) e.preventDefault();
  if (t.dataset.go){
    if (S.regDone){ S.invite = null; S.regDone = null; }
    S.view = t.dataset.go; S.drawer = false; render(); scrollTo(0,0); return;
  }
  if (t.dataset.open){
    const l = S.course.lessons.find(x => x.id === t.dataset.open);
    if (!isOpen(l)){ toast(`Папка откроется в день урока – ${fmt(l.date,{day:"numeric",month:"long"})}.`); return; }
    S.open = l.id; S.sub = t.dataset.sub || "theory"; S.view = "folder"; S.drawer = false; render(); scrollTo(0,0); return;
  }
  if (t.dataset.sub){ S.sub = t.dataset.sub; if (t.dataset.bpage) S.boardPage = t.dataset.bpage; render(); if (t.dataset.bpage) document.querySelector(".window .tabs")?.scrollIntoView({behavior:"smooth"}); return; }
  if (t.dataset.etype){ LS.set("etype", t.dataset.etype); render(); return; }
  if (t.dataset.test){ startTest(t.dataset.test, t.dataset.kind || "lesson"); return; }
  if (t.dataset.pick && S.test.picked == null){
    const T = S.test, q = T.qs[T.i], k = +t.dataset.pick;
    T.picked = k; if (k === q.a) T.score++; else T.wrong.push(q.tag); render(); return;
  }
  const a = t.dataset.act;
  if (a === "install"){ install(); return; }
  if (a === "to-signup"){ S.signup = true; S.signupDone = null; render(); return; }
  if (a === "to-signin"){ S.signup = false; render(); return; }
  if (a === "open-drawer"){ S.drawer = true; render(); }
  if (a === "close-drawer"){ S.drawer = false; render(); }
  if (a === "start-entry" || a === "retry-entry") startTest(null, "entry");
  if (a === "to-login"){ S.invite = null; history.replaceState(null, "", location.pathname); render(); }
  if (a === "next-q"){
    const T = S.test; T.i++; T.picked = null;
    if (T.i >= T.qs.length){
      await sendResult(T.id, T.kind, T.score, T.qs.length, T.wrong, Math.round((Date.now() - T.t0) / 1000));
      if (T.kind === "hw" && !S.hw[T.id]?.status) await sendHw(T.id, `ДЗ-тест пройден: ${T.score}/${T.qs.length}`, true);
    }
    render(); scrollTo(0,0);
  }
  if (a === "mini-check"){
    const box = t.closest(".mini"), [lid, bi] = t.dataset.miniId.split(":");
    let mini;
    if (lid.startsWith("m")) mini = S.mats.find(m => "m" + m.id === lid)?.data?.mini;
    else mini = S.course.lessons.find(x => x.id === lid)?.theory[+bi]?.mini;
    if (!mini) return;
    let ok = 0;
    box.querySelectorAll("[data-mq]").forEach(inp => {
      const m = mini[+inp.dataset.mq], good = U.miniCheck(inp.value, m.a), ans = inp.parentElement.querySelector(".ans");
      inp.classList.toggle("ok", good); inp.classList.toggle("no", !good); if (good) ok++;
      ans.hidden = good; ans.textContent = good ? "" : "Верно: " + m.a.split("|")[0];
    });
    box.querySelector(".mini-res").textContent = ok === mini.length ? "Всё верно! Идём дальше." : `Верно ${ok} из ${mini.length}. Посмотри подсказки и попробуй ещё раз.`;
    if (!t.dataset.sent){ t.dataset.sent = "1"; sendResult(`${lid}:${bi}`, "mini", ok, mini.length, []); }
    return;
  }
  if (a === "download"){
    const l = S.course.lessons.find(x => x.id === S.open);
    U.downloadDoc(`${l.title} – рабочий лист`, U.lessonDocHTML(l, false)); return;
  }
  if (a === "photo"){ uploadPhoto(S.open); return; }
  if (a === "send-hw"){ await sendHw(S.open, $("#hw-note").value.trim()); render(); }
  if (a === "send-writing"){
    const l = S.course.lessons.find(x => x.id === S.open), body = $("#essay").value.trim(), n = U.wordCount(body);
    const minW = ["thesis","example"].includes(l.writing.type) ? 0 : 70;
    const hasPhoto = (S.photos[l.id] || []).length;
    if (!body && !hasPhoto){ toast("Напиши текст или прикрепи фото работы."); return; }
    if (minW && n < minW && !hasPhoto && !t.dataset.sure){ t.dataset.sure = "1"; t.textContent = `Всего ${n} слов. Всё равно отправить?`; return; }
    await sendWriting(l, t.dataset.kind, body); render();
  }
  if (a === "logout") logout();
});

/* ---------- запуск ---------- */
(async () => {
  const qp = new URLSearchParams(location.search);
  const invite = qp.get("invite");
  const sess = LS.get("session", null);
  /* оформление сайта из кабинета разработчика */
  if (sb){ try{ const {data} = await sb.from("app_settings").select("key,value");
    const st = Object.fromEntries((data || []).map(r => [r.key, r.value]));
    if (st.title) CFG.TITLE = st.title; if (st.school_tag) CFG.SCHOOL_TAG = st.school_tag;
    if (st.default_theme && !sess?.profile?.theme && !LS.get("theme", null)) U.applyTheme(st.default_theme);
  }catch(_){} }
  if (invite){
    S.invite = invite;
    if (sb){ const {data} = await sb.rpc("invite_info", {p_invite: invite}); S.inviteInfo = data || false; if (data?.theme){ S.regTheme = data.theme; U.applyTheme(data.theme); } }
    else S.inviteInfo = {};
  } else if (!sess?.token && sb && !qp.has("student")){
    const {data} = await sb.auth.getSession(); if (data?.session){ location.replace("teacher.html"); return; }
  } else if (sess?.token){
    S.token = sess.token; S.profile = sess.profile; recompute();
    const c = LS.get("cache", null);
    if (c && sb){ S.rows = c.rows || []; S.hw = c.hw || {}; S.sheets = c.sheets || {}; S.writings = c.writings || {}; S.mats = c.mats || []; U.loadBase(c.base); recompute(); }
    render(); await load();
  }
  render();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
})();
