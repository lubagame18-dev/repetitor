/* Приложение ученика: приглашение → анкета → входной тест → уроки по плану */
(() => {
const {esc, d, today, fmt, fmtShort, daysTo, pct, lvl, lvlColor, toast} = U;
const FIPI = "https://oge.fipi.ru/bank/index.php?proj=2F5EE3B12FE2A0EA40B06BF61A015416";
const RESHU = "https://rus-oge.sdamgia.ru";
const CFG = window.APP_CONFIG || {};
const sb = U.supa();/* встроенные готовые материалы по классам (подгружаются лениво по предмету) */
try { const k0 = (LS.get("session")?.profile?.course) || CFG.DEFAULT_COURSE; if (window.BuiltinLoader && k0) BuiltinLoader.ensure(k0); } catch (e) { }
const S = {view:"home", open:null, sub:"theory", boardPage:"practice", test:null, token:null, profile:null, course:null,
           rows:[], results:{}, hwres:{}, hw:{}, sheets:{}, writings:{}, mats:[], photos:{}, board:null, drawer:false, invite:null, inviteInfo:null, regDone:null, regTheme:null, regMascot:null, forced:new Set(), syncPending:false,
           quizToken:null, quiz:null, qz:null, quizzes:null, qzResults:[], qzBusy:false};
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
document.addEventListener("builtin-loaded", function(){ try { recompute(); render(); } catch (e) { } });
function recompute(){ if (S.labPick == null) S.labPick = LS.get("labPick", null); S.results = U.aggregate(S.rows, "lesson"); S.hwres = U.aggregate(S.rows, "hw"); S.minis = U.aggregate(S.rows, "mini"); S.course = U.courseFor(S.profile, S.mats); U.applyTheme(LS.get("theme", null) || S.profile?.theme); U.setMascot(LS.get("mascot", null) || S.profile?.mascot); }
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
    S.works = {}; (data.works || []).forEach(w => (S.works[w.lesson_id] = S.works[w.lesson_id] || {})[w.task] = w.data);
    S.base = data.course_data ? [{key: S.profile.course, data: data.course_data}] : [];
    if ((!S.base.length || U.builtinNewer(S.profile?.course, data.course_data)) && window.BuiltinLoader && S.profile?.course) BuiltinLoader.ensure(S.profile.course).then(ok => { if (ok && window.BUILTIN_COURSES?.[S.profile.course]) { S.base = [{key: S.profile.course, data: window.BUILTIN_COURSES[S.profile.course]}]; U.loadBase(S.base); recompute(); render(); } });
    U.loadBase(S.base);
    LS.set("cache", {rows:S.rows, hw:S.hw, sheets:S.sheets, writings:S.writings, mats:S.mats, base:S.base});
  } else {
    S.rows = LS.get("rows", []); S.hw = LS.get("hw", {}); S.writings = LS.get("writings", {}); S.sheets = {}; S.works = LS.get("works", {});
  }
  recompute();
}
function logout(msg){ LS.set("session", null); S.token = null; S.profile = null; S.view = "home"; render(); if (msg) toast(msg); }
async function sendResult(lesson_id, kind, score, total, wrong, dur, answers){
  S.rows.push({lesson_id, kind, score, total, wrong, duration_sec:dur, created_at: new Date().toISOString()}); recompute();
  if (sb){
    const {error} = await sb.rpc("student_submit_result", {p_code:S.token, p_lesson:lesson_id, p_score:score, p_total:total, p_wrong:wrong, p_kind:kind, p_duration:dur ?? null, ...(answers ? {p_answers: answers} : {})});
    if (error && kind !== "self") toast("Результат не отправлен: нет связи. Пройди тест ещё раз, когда появится интернет.");
    else if (kind !== "self") liveAct(`${kind === "mini" ? "мини-практика" : kind === "hw" ? "ДЗ-тест" : kind === "entry" ? "входной тест" : kind === "oge" ? "отработка ОГЭ" : "тест"}: ${score} из ${total}`);
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
const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || (S.view === "folder" && S.sub === "board") || S.view === "room";
/* если обновление от учителя пришло, пока ученик печатал, – дорисовываем, когда закончит */
document.addEventListener("focusout", () => {
  if (!S.syncPending) return;
  setTimeout(() => {
    if (!S.syncPending) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) return;
    S.syncPending = false; render();
  }, 150);
});
/* урок, который открыл учитель, может быть другого предмета (другая запись ученика) или только что добавлен – переключаемся и подгружаем */
async function ensureLesson(m){
  const has = () => !m.lesson || m.lesson === "free" || !!S.course?.lessons.find(x => x.id === m.lesson);
  if (has()) return true;
  if (sb && m.to && m.to !== "all" && m.to !== S.profile.id && (S.profile.subjects || []).some(x => x.id === m.to)){
    const {data} = await sb.rpc("student_switch", {p_code: S.token, p_target: m.to});
    if (data){ const was = S.profile.teacher; S.token = data.token; S.profile = data.profile; S.forced = new Set(); saveSession(); toast(`Учитель открыл урок по предмету «${subjName()}»`);
      if (data.profile.teacher !== was && live){ sb.removeChannel(live); live = null; setTimeout(liveStart, 50); } }
  }
  await load();
  if (!has()){ await new Promise(r => setTimeout(r, 1200)); await load(); }
  return has();
}
/* общий показ урока по команде учителя: и в комнате (слева доска), и в папке (вне комнаты) */
function showLessonView(l, m){
  S.forced.add(l.id); S.open = l.id;
  if (m && m.sub) S.sub = m.sub;
  if (m && m.tab) S.sub = m.tab;
  if (m && m.page) S.boardPage = m.page;
  if (S.view === "room" || (S.joinHow && S.room)){        // ученик уже на уроке – не выкидываем из комнаты
    S.room = {...(S.room || {}), lesson: l.id};
    S.test = null; S.testInRoom = false; S.view = "room"; S.drawer = false;
    render(); liveTrack();
  } else {
    S.view = "folder"; S.drawer = false; render(); scrollTo(0, 0);
  }
}
function liveStart(){
  if (!sb || !S.profile?.teacher || live) return;
  live = sb.channel(`live-${S.profile.teacher}`, {config:{presence:{key:"s-" + S.profile.id}, broadcast:{self:false}}});
  live.on("broadcast", {event:"act"}, ({payload:m}) => onSync(m));
  live.on("broadcast", {event:"cmd"}, async ({payload:m}) => {
    const mine = [S.profile.id, ...(S.profile.subjects || []).map(x => x.id)];   // команда по любому предмету этого ученика
    if (!m?.cmd || (!mine.includes(m.to) && m.to !== "all")) return;
    if (m.type === "izlpick"){ S.labPick = m.key; LS.set("labPick", m.key); if (S.view === "folder" && S.course?.lessons.find(x => x.id === S.open)?.lab === "izl") S.sub = "lab"; render(); toast("Учитель выбрал текст для изложения: " + (m.title || "")); return; }
    if (m.type === "refresh"){
      await load();
      const focused = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
      if (!typing() || (S.view === "room" && !focused) || (S.view === "folder" && S.sub !== "board" && !focused)) render();
      else S.syncPending = true;   // не сбрасываем ввод – отрисуем, когда ученик закончит печатать
      toast(m.msg || "Учитель обновил твои материалы");
      return;
    }
    if (m.type === "quiz"){
      if (!m.token) return;
      if (S.view === "quiz" && S.qz && !S.qz.done){ toast("Сначала закончи текущий тест"); return; }
      toast(`Учитель прислал тест: ${m.title || "новый тест"}`);
      await openQuiz(m.token);
      return;
    }
    if (m.type === "lesson"){
      const ok = await ensureLesson(m);
      if (!ok){ toast("Урок не загрузился – попросите учителя открыть ещё раз или обновите страницу"); return; }
      await load();               // свежие материалы и заметки учителя к моменту показа
      invite({lesson: m.lesson, url: m.url, title: m.title, at: Date.now()});
      return;
    }
    if (m.type === "room-pull"){   // учитель позвал: сразу на урок, без окна-приглашения
      const ok = await ensureLesson(m);
      if (!ok){ toast("Урок не загрузился – попросите учителя открыть ещё раз"); return; }
      await load();
      if (S.view !== "room") S.preRoom = {view: S.view, open: S.open, sub: S.sub};
      S.room = {...(S.room || {}), lesson: m.lesson, url: m.url || S.room?.url || S.profile.call_url || "", at: Date.now()};
      if (m.lesson && m.lesson !== "free") S.forced.add(m.lesson);
      if (m.tab){ S.sub = m.tab; S.boardPage = m.tab; }
      if (S.test && !S.testInRoom){ S.test = null; }
      const j = joinedNow(); applyJoin(S.joinHow || j?.how || LS.get("join-how", null) || "board", true); toast("Учитель позвал тебя на урок"); return;
    }
    if (m.type === "room-goto"){
      const changed = !S.room || S.room.lesson !== m.lesson;
      const ok = await ensureLesson(m);
      if (!ok){ toast("Урок не загрузился – попросите учителя открыть ещё раз или обновите страницу"); return; }
      if (changed) await load();   // новый урок – сразу свежие материалы; смена вкладки – без задержки
      if (!S.room) S.room = {lesson: m.lesson, at: Date.now()};
      if (S.joinHow === "call") return;
      if (m.lesson && m.lesson !== "free") S.forced.add(m.lesson);
      S.room.lesson = m.lesson; S.open = m.lesson; S.test = null; S.testInRoom = false; if (m.tab){ S.sub = m.tab; S.boardPage = m.tab; } if (m.page) S.boardPage = m.page;
      closeJoin(); S.view = "room"; S.drawer = false; render(); scrollTo(0, 0);
      const TAB = {theory:"Теория", mnemo:"Запоминалки", practice:"Практика", writing:"Письмо", mats:"Материалы", hw:"Домашка", test:"Тест"};
      toast(`Учитель перенёс тебя: ${roomLesson().title}${m.tab ? " · " + (TAB[m.tab] || "") : ""}`); liveTrack(); return;
    }
    if (m.type === "endlesson"){ try { sessionStorage.removeItem(JK); } catch(_) {} if (window.Call) Call.leave(true); S.joinHow = null; S.room = null; S.roomEnded = Date.now(); document.getElementById("callbar").hidden = true; closeJoin(); if (S.view === "room"){ const pr = S.preRoom; S.preRoom = null; if (pr && pr.view !== "room" && pr.view !== "test"){ S.view = pr.view; S.open = pr.open; S.sub = pr.sub; } else S.view = "home"; render(); } toast("Учитель завершил урок. Молодец!"); return; }
    if (m.type === "call"){
      if (m.url) S.profile.call_url = m.url;
      const bar = document.getElementById("callbar");
      bar.innerHTML = `<span>📞 Учитель начал занятие</span>${S.profile.call_url ? `<a class="btn sm" href="${esc(S.profile.call_url)}" target="_blank" rel="noopener">Подключиться</a>` : `<span class="small muted">Ссылка на созвон пока не добавлена — попросите учителя вставить её в карточке ученика.</span>`}<button class="btn ghost sm" data-go="myboard">Доска</button><button class="iconbtn" aria-label="Скрыть" onclick="this.parentElement.hidden=true">✕</button>`;
      bar.hidden = false; return;
    }
    if (m.type === "goto" && m.lesson === "free"){ S.view = "myboard"; S.drawer = false; if (m.page) S.boardPage = m.page; render(); toast("Учитель открыл личную доску"); return; }
    if (m.type === "goto"){
      /* «Показать ученику»: сразу показываем урок (если он уже загружен), затем догружаем свежие материалы
         и показываем заново – без обновления страницы и без молчаливого игнора для новых/других предметов */
      const known = S.course?.lessons.find(x => x.id === m.lesson);
      if (known) showLessonView(known, m);
      else toast("Учитель открывает урок…");
      const ok = await ensureLesson(m);
      if (!ok){ toast("Урок не загрузился – попросите учителя открыть ещё раз или обновите страницу"); return; }
      await load();
      const l = S.course?.lessons.find(x => x.id === m.lesson);
      if (!l){ toast("Урок ещё не пришёл – обновите страницу и попросите открыть снова"); return; }
      showLessonView(l, m);
      toast(`Учитель открыл урок «${l.title}»`);
      return;
    }
  });
  let presenceBusy = false;
  live.on("presence", {event:"sync"}, async () => {
    if (presenceBusy) return;
    /* ученик проходит тест или смотрит раздел «Тесты» – не выдёргиваем его в комнату урока */
    if (S.view === "quiz" || S.view === "quizzes") return;
    const mine = [S.profile.id, ...(S.profile.subjects || []).map(x => x.id)];
    const t = Object.values(live.presenceState()).flat().find(p => p.role === "teacher" && p.room && p.room.to?.some(id => mine.includes(id)));
    if (!(t && (t.room.at || 0) > (S.roomEnded || 0) && (!S.room || S.room.lesson !== t.room.lesson))) return;
    presenceBusy = true;
    try {
      const myRow = (S.profile.subjects || []).find(x => (t.room.to || []).includes(x.id));
      const ok = await ensureLesson({lesson: t.room.lesson, to: myRow?.id || S.profile.id});
      if (!ok) return;
      await load();   // свежие материалы к моменту приглашения/входа в комнату
      if (S.view === "quiz" || S.view === "quizzes") return;   // тест могли открыть, пока грузили данные
      const title = S.course?.lessons.find(x => x.id === t.room.lesson)?.title || t.room.title || "";
      invite({...t.room, title});
    } finally { presenceBusy = false; }
  });
  live.subscribe(st => { if (st === "SUBSCRIBED") liveTrack(true); });
}
function liveTrack(now){
  if (!live) return;
  clearTimeout(liveT);
  liveT = setTimeout(() => {
    const l = S.view === "folder" && S.course?.lessons.find(x => x.id === S.open);
    const TAB = {theory:"Теория", mnemo:"Запоминалки", practice:"Практика", board:"Доска", writing:"Письмо", mats:"Материалы", hw:"Домашка", test:"Тест"};
    const rl = S.view === "room" && roomLesson();
    if (rl){ live.track({role:"student", id:S.profile.id, name:S.profile.name, where:`на уроке «${rl.title}» · ${S.test && S.testInRoom ? "проходит тест" : ({theory:"теория", practice:"практика", writing:"письмо", mats:"материалы", hw:"домашка", test:"тест"}[S.sub] || "доска")}`, lesson: rl.id, tab: S.sub, at: Date.now()}).catch(() => {}); return; }
    const where = S.view === "myboard" ? "на личной доске" : S.view === "folder" ? `урок «${l?.title || ""}» · ${TAB[S.sub] || ""}` : S.view === "test" ? `проходит ${S.test?.kind === "entry" ? "входной тест" : "тест"}: ${S.test?.title || ""}` : S.view === "quiz" ? `проходит тест по темам: ${S.quiz?.title || ""}` : ({home:"на главной", lessons:"смотрит уроки", quizzes:"смотрит тесты", stats:"смотрит статистику", plan:"смотрит план", entry:"входной тест", look:"меняет оформление"}[S.view] || "");
    live.track({role:"student", id:S.profile.id, name:S.profile.name, where, lesson: l?.id || null, at: Date.now()}).catch(() => {});
  }, now ? 0 : 250);
}
/* сообщить учителю о сделанном – у него всё обновится сразу */
function liveAct(text){ if (live) live.send({type:"broadcast", event:"act", payload:{act:true, dev:DEV, id:S.profile.id, name:S.profile.name, text}}).catch(() => {}); }
/* одно и то же у ученика на всех его устройствах: задания, черновики, результаты */
const DEV = Math.random().toString(36).slice(2, 10);
function syncSend(extra){ if (live) live.send({type:"broadcast", event:"act", payload:{sync:true, dev:DEV, id:S.profile.id, ...extra}}).catch(() => {}); }
const draftT = {};
function saveDraft(lid, task, text){
  clearTimeout(draftT[lid + task]);
  draftT[lid + task] = setTimeout(() => { (S.works[lid] = S.works[lid] || {})[task] = {a: text};
    if (sb) sb.rpc("student_save_work", {p_code: S.token, p_lesson: lid, p_task: task, p_data: {a: text}}).then(() => {}, () => {});
    syncSend({draft: true, lesson: lid, task, text}); }, 1200);
}
let syncT = 0;
function onSync(m){
  const mine = [S.profile.id, ...(S.profile.subjects || []).map(x => x.id)];
  if (!m || m.dev === DEV || !mine.includes(m.id)) return;
  if (m.work){
    (S.works[m.lesson] = S.works[m.lesson] || {})[m.task] = m.data;
    const el = document.querySelector(`#wk-root [data-task="${m.task}"]`), l = U.findLesson(S.course, m.lesson);
    if (el && l?.practice?.[m.task] && (S.open === m.lesson) && !el.contains(document.activeElement)) el.outerHTML = Work.task(l.practice[m.task], m.task, m.data);
    return;
  }
  if (m.draft){
    (S.works[m.lesson] = S.works[m.lesson] || {})[m.task] = {a: m.text};
    try { localStorage.setItem((m.task === 901 ? "izl-draft-" : "oge-draft-") + m.lesson, m.text); } catch(_) {}
    const ta = document.querySelector(m.task === 901 ? `#izl-draft[data-lesson="${m.lesson}"]` : `#essay[data-lesson="${m.lesson}"]`);
    if (ta && document.activeElement !== ta && !ta.readOnly) ta.value = m.text;
    return;
  }
  if (m.act){ clearTimeout(syncT); syncT = setTimeout(async () => { await load(); if (!/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") && !S.test) render(); }, 700); }
}

/* интерактивная тетрадь: сохраняем через секунду тишины, учителю – сразу */
const workT = {}, workLive = {};
function saveWork(lessonId, i, st){
  const k = lessonId + ":" + i;
  try{ const all = LS.get("works", {}); (all[lessonId] = all[lessonId] || {})[i] = st; LS.set("works", all); }catch(_){}
  clearTimeout(workLive[k]); workLive[k] = setTimeout(() => { if (live) live.send({type:"broadcast", event:"act", payload:{act:true, work:true, dev:DEV, id:S.profile.id, name:S.profile.name, lesson:lessonId, task:i, data:st, text:"работает в тетради"}}).catch(() => {}); }, 300);
  clearTimeout(workT[k]); workT[k] = setTimeout(() => { if (sb) sb.rpc("student_save_work", {p_code:S.token, p_lesson:lessonId, p_task:i, p_data:st}).then(() => {}, () => toast("Не сохранилось: нет связи. Отметки остались на устройстве.")); }, 1000);
}

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
    ${inf.goals?.length ? `<p>Класс: <b>${esc(U.gradeName(inf.grade ?? 9))}</b> · ${inf.goals.map(x => `<span class="chip">${esc(U.goalLabel(x))}</span>`).join(" ")}</p>
      <p class="small muted">Класс и подготовку выбрал учитель – план уже настроен.</p><input type="hidden" id="r-grade" value="${esc(inf.grade ?? 9)}">`
    : `<label for="r-grade">Класс</label>
    <select id="r-grade" required>${U.subj(inf.subject || "rus").g.map(g => `<option value="${g}" ${(inf.grade ?? 9) === g ? "selected" : ""}>${U.gradeName(g)}</option>`).join("")}</select>
    <fieldset style="border:0;padding:0;margin:0"><legend style="font-weight:800;font-size:.88rem;margin-bottom:8px">Цели (можно несколько)</legend>
      <div class="goals" id="r-goals">${U.goalsHTML(inf.subject || "rus", inf.grade ?? 9, "goal")}</div></fieldset>`}
    <div><b style="font-size:.88rem">Фон кабинета – по настроению</b><p class="small muted" style="margin:2px 0 8px">Потом можно поменять в разделе «Оформление».</p>${U.themesHTML(S.regTheme || inf.theme)}</div>
    <div><b style="font-size:.88rem">Помощник на уроках</b><p class="small muted" style="margin:2px 0 8px">Можно загрузить свою картинку.</p>${U.mascotsHTML(S.regMascot || "kotik")}</div>
    <label for="r-contact">Телефон или Telegram (твой или родителя)</label><input type="text" id="r-contact" autocomplete="tel">
    <label for="r-pass">Придумай пароль (не меньше 6 символов)</label>${U.pass("r-pass", 'minlength="6" required autocomplete="new-password"')}
    <label for="r-pass2">Повтори пароль</label>${U.pass("r-pass2", 'minlength="6" required autocomplete="new-password"')}
    <p class="small" id="r-err" hidden style="color:var(--bad)"></p>
    <button class="btn" type="submit">Зарегистрироваться</button>
  </form>`;
}
function viewLogin(){
  const role = S.role || "student", msg = `<p class="formmsg ${S.authMsg?.ok ? "good" : "bad"}" id="authmsg" role="status">${S.authMsg ? esc(S.authMsg.t) : ""}</p>`;
  let body = "";
  if (role === "student") body = `<form class="stack" id="login-form" style="gap:10px">
    ${sb ? `<label for="l-login">Логин (его выдали при регистрации)</label><input type="text" id="l-login" autocapitalize="characters" autocomplete="username" placeholder="Например, K7M3QPA" required>
    <label for="l-pass">Пароль</label>${U.pass("l-pass", 'autocomplete="current-password" required')}`
    : `<p class="small muted">Демо-режим: сервер ещё не подключён, всё сохраняется только на этом устройстве.</p>
       <label for="l-login">Имя</label><input type="text" id="l-login" required>
       <label for="l-grade">Класс</label><select id="l-grade">${[5,6,7,8,9,10,11].map(g => `<option value="${g}" ${g===9?"selected":""}>${g} класс</option>`).join("")}</select>`}
    <button class="btn" type="submit">Войти</button>${msg}
    <p class="small muted">Забыл пароль – попроси учителя прислать новую ссылку.</p>
    ${sb ? `<div class="regline"><span>Нет логина?</span><button class="linkbtn" type="button" data-authmode="signup">Зарегистрироваться</button></div>` : ""}</form>`;
  if (role === "student"){ if (S.mode === "signup"){
    const sub = U.subj(S.sSubj || "rus");
    body = `<form class="stack" id="ssignup-form" style="gap:10px">
    <h3>Регистрация ученика</h3>
    <label for="ss-code">Код учителя</label><input type="text" id="ss-code" required autocapitalize="characters" placeholder="Например, 4F2A9C" value="${esc(S.tcode || "")}">
    <p class="small muted">${S.tname ? `Учитель: <b>${esc(S.tname)}</b>` : "Код скажет учитель – он есть у него в кабинете."}</p>
    <label for="ss-name">Имя и фамилия</label><input type="text" id="ss-name" required autocomplete="name">
    <label for="ss-subj">Предмет</label><select id="ss-subj">${U.SUBJECTS.map(x => `<option value="${x.k}" ${x.k === sub.k ? "selected" : ""}>${x.e} ${esc(x.n)}</option>`).join("")}</select>
    <label for="ss-grade">Класс</label><select id="ss-grade">${sub.g.map(g => `<option value="${g}" ${g === (sub.g.includes(9) ? 9 : sub.g[0]) ? "selected" : ""}>${U.gradeName(g)}</option>`).join("")}</select>
    <fieldset style="border:0;padding:0;margin:0"><legend style="font-weight:800;font-size:.88rem;margin-bottom:8px">Цели</legend>
      <div class="goals">${U.goalsHTML(sub.k, sub.g.includes(9) ? 9 : sub.g[0], "sgoal")}</div></fieldset>
    <label for="ss-contact">Телефон или Telegram (твой или родителя)</label><input type="text" id="ss-contact" autocomplete="tel">
    <label for="ss-pass">Придумай пароль (не меньше 6 знаков)</label>${U.pass("ss-pass", 'minlength="6" required autocomplete="new-password"')}
    <label for="ss-pass2">Повтори пароль</label>${U.pass("ss-pass2", 'minlength="6" required autocomplete="new-password"')}
    <button class="btn" type="submit">Зарегистрироваться</button>${msg}
    <div class="regline"><span>Уже есть логин?</span><button class="linkbtn" type="button" data-authmode="in">Войти</button></div></form>`;
  }}
  else if (role === "teacher" && S.mode === "forgot") body = `<form class="stack" id="forgot-form" style="gap:10px">
    <h3>Восстановить пароль</h3><p class="small muted">Пришлём письмо со ссылкой: по ней вы зададите новый пароль.</p>
    <label for="fg-email">Почта</label><input type="email" id="fg-email" autocomplete="username" required value="${esc(S.lastEmail || "")}">
    <button class="btn" type="submit">Прислать ссылку</button>${msg}
    <button class="linkbtn" type="button" data-authmode="in">← Назад ко входу</button></form>`;
  else if (role === "teacher" && S.mode !== "signup") body = `<form class="stack" id="teacher-form" style="gap:10px">
    <label for="tl-email">Почта</label><input type="email" id="tl-email" autocomplete="username" required value="${esc(S.lastEmail || "")}">
    <label for="tl-pass">Пароль</label>${U.pass("tl-pass", 'autocomplete="current-password" required')}
    <button class="btn" type="submit">Войти в кабинет учителя</button>${msg}
    <button class="linkbtn" type="button" data-authmode="forgot">Забыли пароль?</button>
    <div class="regline"><span>Нет кабинета?</span><button class="linkbtn" type="button" data-authmode="signup">Зарегистрироваться</button></div>
    <div class="regline"><span>Есть код разработчика?</span><a class="linkbtn" href="dev.html">Режим разработчика</a></div>
    ${S.authMsg?.resend ? `<button class="btn ghost sm" type="button" data-act="resend">Отправить письмо ещё раз</button>` : ""}</form>`;
  else body = S.signupDone ? `<div class="stack" style="gap:8px"><h3>Почти готово!</h3><p>Мы отправили письмо на <b>${esc(S.signupDone)}</b>. Откройте его и нажмите ссылку – кабинет откроется, и начнётся пробный период.</p>
      <p class="small muted">Письма нет? Проверьте «Спам» или отправьте ещё раз.</p>${msg}
      <div class="row"><button class="btn ghost sm" data-act="resend">Отправить письмо ещё раз</button><button class="btn ghost sm" data-authmode="in">Уже подтвердила – войти</button></div></div>`
    : `<form class="stack" id="signup-form" style="gap:10px">
      <h3>Регистрация репетитора</h3>
      <label for="su-name">Имя и отчество (так вас увидят ученики)</label><input type="text" id="su-name" required autocomplete="name">
      <label for="su-email">Почта</label><input type="email" id="su-email" autocomplete="username" required>
      <label for="su-pass">Придумайте пароль (не меньше 8 знаков)</label>${U.pass("su-pass", 'minlength="8" autocomplete="new-password" required')}
      <button class="btn" type="submit">Зарегистрироваться</button>${msg}
      <p class="small muted">Сначала – бесплатный пробный период со всеми возможностями, потом тариф от 100 ₽ в месяц.</p>
      <div class="regline"><span>Уже есть кабинет?</span><button class="linkbtn" type="button" data-authmode="in">Войти</button></div></form>`;
  return authHero(CFG.TITLE || "Учу по ФРП · уроки") + `<div class="card login stack">
    <div class="authtabs two" role="group" aria-label="Кто входит"><button data-role="student" aria-pressed="${role==="student"}">Я ученик</button><button data-role="teacher" aria-pressed="${role==="teacher"}">Я учитель</button></div>
    ${body}
    <button class="btn ghost" data-act="install">📲 Скачать на телефон</button>
  </div>`;
}

/* ---------- оболочка ---------- */
/* аватар: фото профиля или инициалы */
const avatarHTML = (p, cls) => p.avatar ? `<img class="${cls || "avatar"}" src="${esc(p.avatar)}" alt="" style="object-fit:cover">` : `<span class="${cls || "avatar"}">${esc((p.name || "?").split(/\s+/).map(x => x[0]).slice(0,2).join("").toUpperCase())}</span>`;
function viewProfile(){
  const p = S.profile;
  return `<div class="section-title" style="margin-top:6px"><h2>Мой профиль</h2></div>
    <div class="card stack" style="gap:12px;max-width:560px">
      <div class="row" style="gap:14px;align-items:center">${avatarHTML(p, "avatar big")}<div><b style="font-size:1.2rem">${esc(p.name)}</b><div class="small muted">${p.grade ? p.grade + " класс" : ""}</div></div></div>
      <div class="row" style="gap:8px"><button class="btn ghost sm" data-act="avatar-pick">📷 ${p.avatar ? "Сменить фото" : "Выбрать фото"}</button>${p.avatar ? `<button class="btn ghost sm" data-act="avatar-del">Убрать фото</button>` : ""}</div>
      <label for="pf-school">Школа</label><input id="pf-school" maxlength="160" value="${esc(p.school || "")}" placeholder="Например: школа № 12, г. Челябинск">
      <div><button class="btn" data-act="profile-save">Сохранить</button></div>
      <p class="small muted">Школу и фото видит только твой учитель.</p></div>`;
}
async function saveProfile(school, avatar){
  if (!sb){ Object.assign(S.profile, {school, ...(avatar !== undefined ? {avatar: avatar || null} : {})}); saveSession(); return true; }
  const {error} = await sb.rpc("student_set_profile", {p_code: S.token, p_school: school ?? S.profile.school ?? "", p_avatar: avatar === undefined ? null : avatar});
  if (error){ toast("Не сохранилось. Проверь интернет."); return false; }
  Object.assign(S.profile, {school: school ?? S.profile.school, ...(avatar !== undefined ? {avatar: avatar || null} : {})}); saveSession(); return true;
}
function pickAvatar(){
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
  inp.onchange = () => { const f = inp.files[0]; if (!f) return; const img = new Image();
    img.onload = async () => { const k = Math.min(1, 400 / Math.min(img.width, img.height)), c = document.createElement("canvas"), sz = Math.round(Math.min(img.width, img.height) * k);
      c.width = c.height = sz; c.getContext("2d").drawImage(img, (img.width - Math.min(img.width, img.height)) / 2, (img.height - Math.min(img.width, img.height)) / 2, Math.min(img.width, img.height), Math.min(img.width, img.height), 0, 0, sz, sz);
      const data = c.toDataURL("image/jpeg", .85); URL.revokeObjectURL(img.src);
      if (!sb){ await saveProfile(undefined, data); render(); return; }
      toast("Загружаю фото…");
      const {data: r, error} = await sb.functions.invoke("ai", {body: {action: "upload_work", code: S.token, lesson: "avatar", data}});
      if (error || !r?.url){ toast("Фото не загрузилось. Проверь интернет."); return; }
      if (await saveProfile(undefined, r.url)){ render(); toast("Фото профиля обновлено"); } };
    img.src = URL.createObjectURL(f); };
  inp.click();
}
function drawerHTML(){
  const p = S.profile, ini = (p.name || "?").split(/\s+/).map(x => x[0]).slice(0,2).join("").toUpperCase();
  const nav = [["home","Главная",I.home],["lessons","Мои уроки",I.folder],["quizzes","Тесты",I.check],["self","Самообучение",I.book], window.OGE?.isOge(S.course) && ["oge","Мой ОГЭ",I.stats],["myboard","Личная доска",I.board],["stats","Статистика",I.stats],["plan","План работы",I.plan], entryTest() && ["entry","Входной тест",I.entry],["look","Оформление",I.pen]].filter(Boolean);
  const mine = p.subjects?.length ? p.subjects : [{id:p.id, subject:subjKey(), grade:p.grade}];
  const others = U.SUBJECTS.filter(x => !mine.some(m => m.subject === x.k) && x.g.includes(+p.grade));
  const cur = S.view === "folder" ? "lessons" : S.view === "quiz" ? "quizzes" : S.view === "test" ? (S.test?.kind === "entry" ? "entry" : "lessons") : S.view;
  return `<button class="me me-btn" data-go="profile" title="Мой профиль: школа, фото">${avatarHTML(p)}<div style="min-width:0;text-align:left"><b>${esc(p.name)}</b><div class="small muted">${p.grade ? p.grade + " класс" : ""}${p.goal ? " · " + esc(U.goalLabel(p.goal)) : ""}</div>${p.pair ? `<div class="small pairtag">👥 в паре: ${esc(p.pair.name.split(" ")[0])}</div>` : ""}</div></button>
   <div class="group"><span class="mono">Предметы</span>
     ${mine.map(m => m.id === p.id ? `<button class="navitem" data-go="lessons" ${cur==="lessons"?'aria-current="page"':""}><span class="emo">${U.subj(m.subject).e}</span><span>${esc(U.subj(m.subject).n)}${mine.filter(x => x.subject === m.subject).length > 1 && U.getCourse(m.course) ? `<small class="muted" style="display:block;font-weight:600">${esc(U.getCourse(m.course).tag || U.getCourse(m.course).course)}</small>` : ""}</span><span class="chip" style="margin-left:auto">${U.gradeName(m.grade).replace(" класс", " кл.")}</span></button>`
       : `<button class="navitem" data-switch="${m.id}"><span class="emo">${U.subj(m.subject).e}</span><span>${esc(U.subj(m.subject).n)}${mine.filter(x => x.subject === m.subject).length > 1 && U.getCourse(m.course) ? `<small class="muted" style="display:block;font-weight:600">${esc(U.getCourse(m.course).tag || U.getCourse(m.course).course)}</small>` : ""}</span><span class="chip" style="margin-left:auto">${U.gradeName(m.grade).replace(" класс", " кл.")}</span></button>`).join("")}
     ${others.map(x => `<button class="navitem" disabled title="Подключает учитель"><span class="emo">${x.e}</span>${esc(x.n)}<span class="lock">${I.lock}</span></button>`).join("")}</div>
   ${S.room && S.view !== "room" ? `<div class="group"><button class="navitem" data-act="join-open"><span class="live-dot" aria-hidden="true"></span>Подключиться к уроку</button></div>` : ""}
   <div class="group"><span class="mono">Разделы</span>
     ${nav.map(([k,n,ic]) => `<button class="navitem" data-go="${k}" ${cur===k?'aria-current="page"':""}>${ic}${n}</button>`).join("")}</div>
   <div class="group"><span class="mono">Ещё</span>
     ${p.call_url ? `<a class="navitem" href="${esc(p.call_url)}" target="_blank" rel="noopener">📞 Созвон с учителем</a>` : ""}
     ${CFG.BOT_USERNAME ? `<a class="navitem" href="https://t.me/${esc(CFG.BOT_USERNAME.replace(/^@/,""))}" target="_blank" rel="noopener">${I.entry}Бот в Telegram</a>` : ""}
     <button class="navitem" data-act="logout">${I.out}Выйти</button></div>
   ${!sb ? '<p class="small muted" style="padding:0 8px">Демо-режим: данные хранятся на этом устройстве.</p>' : ""}
   <div class="drawer-foot"><button class="btn" data-act="install" style="width:100%;justify-content:center">${I.phone.replace('<svg','<svg width="18" height="18"')} Скачать на телефон</button></div>`;
}
const TITLES = {profile:"Мой профиль", oge:"Мой ОГЭ", self:"Самообучение", room:"Урок с учителем", myboard:"Личная доска", look:"Оформление", home:"Главная", lessons:"Мои уроки", folder:"Урок", test:"Тест", stats:"Статистика", plan:"План работы", entry:"Входной тест", install:"Установить на телефон", quiz:"Тест по темам", quizzes:"Тесты"};

/* ---------- экраны ---------- */
function folderHTML(l){
  const b = blockOf(l), i = S.course.lessons.indexOf(l), open = isOpen(l), nx = nextLesson();
  const r = S.results[l.id], hr = S.hwres[l.id], w = S.writings[l.id], hs = U.hwState(S.course, l.id, S.hw);
  return `<button class="folder ${open ? "" : "locked"} ${l === nx ? "next" : ""}" style="--c:${b.color}" data-open="${l.id}" aria-label="Урок ${i+1}: ${esc(l.title)}${open ? "" : ", откроется " + fmt(l.date)}">
    <span class="back"></span><span class="papers"><i></i><i></i></span>
    <span class="front">
      ${open ? "" : `<span class="lockico">${I.lock}</span>`}
      <span class="num">№ ${String(i+1).padStart(2,"0")} · ${fmt(l.date,{day:"numeric",month:"short"}).toUpperCase()}${U.lessonTime(S.profile, l) ? " · " + esc(U.lessonTime(S.profile, l)) : ""}</span>
      <span class="ttl">${esc(l.title)}</span>
      <span class="meta">${open ? `${(G => `${G.lesson ? `<span class="pill">урок: ${G.lesson.g}</span>` : ""}${G.home ? `<span class="pill">ДЗ: ${G.home.g}</span>` : ""}`)(U.lessonGrades(l, S.results, S.hwres, S.hw, S.writings))}${w?.max ? `<span class="pill">✍ ${w.total}/${w.max}</span>` : ""}${hs.c==="bad" ? '<span class="pill">ДЗ!</span>' : ""}<span class="arrow">→</span>`
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

/* в день урока – напоминание: одна кнопка запускает урок с видеозвонком */
function todayLesson(){ return S.course?.lessons.find(l => daysTo(l.date) === 0) || null; }
function todayCard(){
  const l = todayLesson(); if (!l || S.room) return "";
  return `<div class="card accent today-card" role="region" aria-label="Сегодня занятие"><div class="kicker"><span class="live-dot" aria-hidden="true"></span> Сегодня у вас занятие${U.lessonTime(S.profile, l) ? " в " + esc(U.lessonTime(S.profile, l)) : ""}</div>
    <h2 style="margin-top:6px">${esc(l.title)}</h2>
    <p class="small" style="margin:6px 0 12px"><span class="dot" style="background:${blockOf(l).color}"></span> ${esc(l.oge || "")}. Когда придёт время урока, нажми кнопку – откроются доска, материалы урока и видеозвонок с учителем.</p>
    <div class="row"><button class="btn" data-act="start-today" data-l="${l.id}">▶ Начать урок</button><button class="btn ghost" data-open="${l.id}">Открыть папку</button></div></div>`;
}
function viewHome(){
  const p = S.profile, er = entryRes(), et = entryTest();
  const cards = [];
  if (S.room) cards.push(`<div class="card accent"><div class="kicker"><span class="live-dot" aria-hidden="true"></span> Идёт урок</div><h2 style="margin-top:6px">${esc(roomLesson().title)}</h2>
      <p class="small" style="margin:6px 0 12px">Учитель ждёт. Выбери, что открыть на этом устройстве: доску, звонок или то и другое.</p>
      <button class="btn" data-act="join-open">Подключиться к уроку</button></div>`);
  if (et && !er) cards.push(`<div class="card accent"><div class="kicker">Сначала</div><h2 style="margin-top:6px">Входной тест</h2>
      <p class="small" style="margin:6px 0 12px">${et.q.length} вопросов по материалу прошлого года. По результатам учитель выстроит план.</p>
      <button class="btn" data-go="entry">Начать</button></div>`);
  if (S.course){
    const tc = todayCard(); if (tc) cards.unshift(tc);
    const nx = nextLesson(), due = nx ? S.course.lessons[S.course.lessons.indexOf(nx)-1] : null, lp = lastPast(), isToday = nx && daysTo(nx.date) === 0;
    if (nx && !tc) cards.push(`<div class="card ${er ? "accent" : ""}"><div class="kicker">${isToday ? "Урок сегодня" : "Следующий урок"}</div>
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
    <p class="small muted">Папка открывается в день урока. Пройденные уроки остаются открытыми.</p>${todayCard()}
    ${(() => { const cm = S.mats.filter(m => m.course === S.profile.course && m.lesson_id === "_course"); return cm.length ? `<div class="card" style="margin:12px 0"><div class="kicker">Материалы курса</div>${cm.map(m => `<div class="mat"><span class="ic">${{link:"🔗",file:"📎",text:"📝"}[m.kind] || "•"}</span><div style="flex:1;min-width:0">${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title || "Материал")}</a>` : `<b>${esc(m.title || "Материал")}</b>`}${m.body ? `<div class="small" style="white-space:pre-line">${esc(m.body)}</div>` : ""}</div></div>`).join("")}</div>` : ""; })()}
    <div class="legend" style="margin:10px 0 4px">${Object.values(S.course.blocks).filter(b => S.course.lessons.some(l => blockOf(l) === b)).map(b => `<span><i class="dot" style="background:${b.color}"></i>${esc(b.name)}</span>`).join("")}</div>
    <div class="folders">${out}</div>`;
}

const toBoard = page => `<div class="toboard"><button class="btn ghost sm" data-sub="board" data-bpage="${page}">${I.board.replace('<svg','<svg width="16" height="16"')} Открыть на доске</button></div>`;

/* тренажёр изложений: библиотека текстов, выбранный учителем текст, статус каждого */
const listens = id => S.rows.filter(r => r.lesson_id === id + ":l").length;
function izlPlayer(l, t){
  if (!t) return "";
  if (t.audio) return `<div class="izl-player card" style="box-shadow:none"><div class="kicker">Запись текста${t.author ? " · " + esc(t.author) : ""}</div>
    <p class="small muted" style="margin:4px 0 8px">Слушаем два раза. Между чтениями – 5 минут: план и ключевые слова. ${listens(l.id) ? `Прослушано раз: <b>${listens(l.id)}</b>.` : ""}</p>
    <audio controls preload="none" src="${esc(t.audio)}" data-listen="${l.id}" style="width:100%"></audio>
    <div class="row" style="gap:6px;margin-top:6px"><button class="btn ghost sm" data-act="izl-pause">⏱ Пауза 5 минут</button><span class="small izl-st" aria-live="polite"></span></div></div>`;
  return window.Izl ? Izl.html(t.paras, l.id) : "";
}
function labHTML(l){
  const L = S.course.labLessons || [];
  if (!L.length) return `<p class="muted">Тексты появятся, когда учитель их добавит.</p>`;
  const cur = L.find(x => x.id === S.labPick);
  const st = x => { const w = S.writings[x.id], n = listens(x.id);
    return `${n ? `<span class="chip">🎧 ${n}</span>` : ""}${w ? (w.max ? `<span class="chip ${U.lvl(Math.round(w.total / w.max * 100))}">✍ ${w.total}/${w.max}</span>` : `<span class="chip mid">✍ ${w.status === "redo" ? "доработать" : "отправлено"}</span>`) : ""}`; };
  return `<p class="small muted" style="margin-bottom:10px">Текст выбирает учитель на уроке или ты сам. 🎧 – сколько раз слушал, ✍ – изложение и баллы.</p>
    <div class="lab-list">${L.map(x => `<button class="lab-item ${x.id === S.labPick ? "on" : ""}" data-lab="${x.id}"><span style="min-width:0"><b>${esc(x.title)}</b><span class="small muted"> · ${x.audio ? "🎙 запись" : "озвучка"}${x.author ? " · " + esc(x.author) : ""}</span></span><span class="row" style="gap:4px;flex:none">${st(x)}</span></button>`).join("")}</div>
    ${cur ? `<div style="margin-top:16px"><div class="section-title" style="margin:0 0 8px"><h2 style="font-size:1.2rem">«${esc(cur.title)}»</h2></div>${writingBody(cur)}</div>` : ""}`;
}
function writingBody(l){
  const w = l.writing, mine = S.writings[l.id];
  const kind = w.type === "choice" ? (mine?.kind && mine.kind !== "izl" ? mine.kind : LS.get("etype", "13.3")) : w.type;
  const src = U.writingSource(S.course, l, w.type === "choice" ? kind : null);
  let draft = ""; try{ draft = localStorage.getItem("oge-draft-" + l.id) || ""; }catch(_){}
  if (!draft) draft = S.works?.[l.id]?.[900]?.a || "";
  const locked = mine && mine.status !== "redo";
  const body = locked ? mine.body : (draft || mine?.body || "");
  const minW = ["thesis","example"].includes(w.type) ? 0 : 70, words = U.wordCount(body);
  return `<div class="theory">${U.stepHTML(w.step)}</div>
    <div class="card" style="margin-top:14px;box-shadow:none"><div class="kicker">На уроке</div><p style="margin-top:4px">${esc(w.classwork)}</p>
      <div class="kicker" style="margin-top:10px">Домашнее письмо</div><p style="margin-top:4px"><b>${esc(w.task)}</b></p></div>
    ${w.type === "choice" ? `<div class="row" style="margin-top:14px" role="group" aria-label="Тип сочинения">${["13.1","13.2","13.3"].map(k => `<button class="btn ${k===kind?"":"ghost"} sm" data-etype="${k}" ${locked?"disabled":""}>${k}</button>`).join("")}</div>` : ""}
    <div style="margin-top:16px"><div class="kicker">Текст «${esc(src.title)}»</div>
      ${w.type === "izl" ? izlPlayer(l, S.course.izl?.[w.text]) : ""}
      ${w.type === "izl" && !locked ? `<div class="stack" style="margin-top:10px;gap:6px"><label for="izl-draft" class="small"><b>Черновик</b> (видишь только ты): план и ключевые слова</label>
        <textarea id="izl-draft" class="essay-area" style="min-height:150px" data-lesson="${l.id}" placeholder="1. Микротема: …\n   ключевые слова: …\n2. Микротема: …\n   ключевые слова: …\n3. Микротема: …\n   ключевые слова: …">${esc((() => { try { return localStorage.getItem("izl-draft-" + l.id) || S.works?.[l.id]?.[901]?.a || ""; } catch(_) { return S.works?.[l.id]?.[901]?.a || ""; } })())}</textarea></div>` : ""}
      ${w.type === "izl" ? `<details style="margin-top:10px"><summary class="small">Показать текст (только если на уроке его не читали и озвучка не работает)</summary><div class="ttext" style="white-space:normal">${src.html}</div></details>` : `<div class="ttext" style="white-space:normal">${src.html}</div>`}
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
    if (m.kind === "tasks" && m.data?.kind === "game") return `<div class="mat"><span class="ic">🎮</span><div style="min-width:0;flex:1"><b>${esc(m.title || m.data.theme?.title || "Игра")}</b><p class="small muted">Игра от учителя: ${Play.gamesFor(m.data.theme || {}).map(k => Play.GAMES[k].n).join(", ")}</p>
      <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">${(m.data.game && Play.gamesFor(m.data.theme || {}).includes(m.data.game)) ? `<button class="btn sm" data-play-game="${m.id}" data-g="${m.data.game}">▶ ${esc(Play.GAMES[m.data.game].n)}</button>` : ""}<button class="btn ghost sm" data-play-game="${m.id}">Все игры</button></div></div></div>`;
    if (m.kind === "tasks") inner = `<b>${esc(m.title || "Задания")}</b>${U.miniHTML({id: "m" + m.id}, 0, m.data?.mini, false)}${m.data?.test?.length ? `<p class="small muted" style="margin-top:8px">Вопросы теста из этого набора – во вкладке «Тест».</p>` : ""}`;
    return `<div class="mat"><span class="ic">${ic}</span><div style="min-width:0;flex:1">${inner}</div></div>`;
  }).join("") + toBoard(M.some(m => m.kind === "text" || m.kind === "tasks") ? "m" + M.find(m => m.kind === "text" || m.kind === "tasks").id : "blank");
}

/* вкладки папки урока – одни и те же в папке и на уроке онлайн */
function lessonTabs(l){
  const sh = S.sheets[l.id] || {}, T = tests(l), M = l.materials || [];
  return [l.lab === "izl" && ["lab","Тренажёр",I.pen], ["theory","Теория",I.book], U.hasMnemo(l) && ["mnemo","Запоминалки",I.book], (l.practice?.length || sh.url) && ["practice","Практика",I.pen], ["board","Доска",I.board],
    l.writing && ["writing","Письмо",I.pen], (M.length || l.stub) && ["mats","Материалы",I.folder], (l.hw || l.hwtest?.length) && ["hw","Домашка",I.home2],
    T.test.length && ["test","Тест",I.check]].filter(Boolean);
}
function lessonPane(l, sub){
  const L = S.course?.lessons || [], i = L.indexOf(l);
  const r = S.results[l.id], hr = S.hwres[l.id], sh = S.sheets[l.id] || {}, h = S.hw[l.id] || {}, hs = U.hwState(S.course || {lessons: []}, l.id, S.hw), due = L[i+1];
  const T = tests(l);
  S.sub = sub;
  let pane = "";
  if (S.sub === "theory") pane = (l.theory.length ? U.theoryHTML(l) : `<p class="muted">Теорию к этому уроку учитель даст на занятии – загляни во вкладку «Материалы».</p>`)
      + (l.practice?.length ? `<div class="card" style="margin-top:16px;box-shadow:none"><div class="kicker">Дальше</div><p style="margin-top:4px">Теория и мини-практика пройдены – переходи к заданиям в формате экзамена.</p><div style="margin-top:8px"><button class="btn sm" data-sub="practice">К практике →</button></div></div>` : "") + toBoard("theory");
  if (S.sub === "practice") pane = `${sh.url ? `<p style="margin-bottom:10px"><a class="btn yellow sm" href="${esc(sh.url)}" target="_blank" rel="noopener">${esc(sh.name || "Рабочий лист")}</a></p>` : ""}
      ${sh.note ? `<p class="small" style="margin-bottom:8px">${esc(sh.note)}</p>` : ""}
      <div class="wk-root" id="wk-root">${Work.toolbar()}${l.practice.map((p, i) => Work.task(p, i, (S.works?.[l.id] || {})[i] || {})).join("")}</div>
      <p class="small muted" style="margin-top:8px">Всё, что ты отмечаешь, сохраняется само и сразу видно учителю.</p>${toBoard("practice")}
      ${S.course.goal === "ОГЭ" ? `<p class="small muted" style="margin-top:14px">Реальные задания: <a href="${FIPI}" target="_blank" rel="noopener">открытый банк ФИПИ</a> · <a href="${RESHU}" target="_blank" rel="noopener">«Решу ОГЭ»</a></p>` : ""}
      ${S.course.goal === "ЕГЭ" ? `<p class="small muted" style="margin-top:14px">Реальные задания: <a href="https://ege.fipi.ru/bank/" target="_blank" rel="noopener">открытый банк ФИПИ</a> · <a href="https://rus-ege.sdamgia.ru" target="_blank" rel="noopener">«Решу ЕГЭ»</a></p>` : ""}`;
  if (S.sub === "board") pane = `<div class="board glass" id="board"></div><p class="small muted" style="margin-top:8px">Доска общая с учителем${S.profile.pair ? ` и с ${esc(S.profile.pair.name.split(" ")[0])}` : ""}: видно курсоры и всё, что рисуют. Чтобы листать на телефоне – выбери ✋, увеличить – двумя пальцами.</p>`;
  if (S.sub === "mnemo") pane = U.mnemoTabHTML(l);
  if (S.sub === "writing") pane = writingBody(l);
  if (S.sub === "lab") pane = labHTML(l);
  if (S.sub === "mats") pane = materialsHTML(l);
  if (S.sub === "hw") pane = `<ol style="margin:0;padding-left:20px">
        ${l.hw ? `<li>${esc(l.hw)}</li>` : ""}${l.writing ? `<li>Письмо: ${esc(l.writing.task)} <a href="#" data-sub="writing">Открыть</a></li>` : ""}${l.hwtest?.length ? `<li>ДЗ-тест: ${l.hwtest.length} вопросов – проверь, как усвоил тему.</li>` : ""}</ol>
      <div class="row" style="margin-top:12px"><span class="chip ${hs.c}">${hs.t}</span>${due?`<span class="chip">срок: ${fmt(due.date,{weekday:"short",day:"numeric",month:"long"})}</span>`:""}${U.gradeChip(U.lessonGrades(l, S.results, S.hwres, S.hw, S.writings).home, "Оценка за ДЗ")}</div>
      ${l.hwtest?.length ? `<div class="card" style="margin-top:14px;box-shadow:none"><div class="kicker">ДЗ-тест</div>
        ${hr ? `<div class="row" style="margin-top:6px"><span class="big tnum" style="color:${lvlColor(pct(hr.last))}">${pct(hr.last)}%</span><span class="small muted">лучший ${pct(hr.best)}% · попыток: ${hr.attempts}</span></div>
          <p class="expl small"><b>Рекомендация:</b> ${esc(U.recText(hr.last))}</p>` : `<p class="muted" style="margin-top:6px">Пройди после того, как сделаешь домашнее задание.</p>`}
        <div style="margin-top:10px"><button class="btn" data-test="${l.id}" data-kind="hw">${hr ? "Пройти ещё раз" : "Начать ДЗ-тест"}</button></div></div>` : ""}
      ${h.comment ? `<p class="expl small"><b>Комментарий учителя:</b> ${esc(h.comment)}</p>` : ""}
      ${h.status !== "accepted" ? `<div class="stack" style="margin-top:12px;gap:8px"><label for="hw-note">Комментарий или ссылка на фото работы</label>
        <textarea id="hw-note" placeholder="Например, ссылка на фото в Google Диске">${esc(h.note || "")}</textarea>
        <div><button class="btn yellow" data-act="send-hw">${h.status ? "Обновить отметку" : "Я сделал ДЗ"}</button></div></div>` : ""}`;
  if (S.sub === "test") pane = `${r ? `<div class="row"><span class="big tnum" style="color:${lvlColor(pct(r.last))}">${pct(r.last)}%</span>
        <span class="small muted">последняя попытка · лучший ${pct(r.best)}% · попыток: ${r.attempts}</span>${U.gradeChip(U.lessonGrades(l, S.results, S.hwres, S.hw, S.writings).lesson, "Оценка за урок")}</div>
        <p class="small muted" style="margin-top:4px">Оценка за урок ставится по первой попытке теста: 85% и выше – «5», от 65% – «4», от 45% – «3».</p>
        <p class="expl small"><b>Рекомендация:</b> ${esc(U.recText(r.last))}</p>` : `<p class="muted">${T.test.length} вопросов по теме. Пройди в конце урока.</p>`}
      <div class="row" style="margin-top:12px"><button class="btn" data-test="${l.id}" data-kind="lesson">${r ? "Пройти ещё раз" : "Начать тест"}</button></div>`;
  return pane;
}
function viewFolder(){
  const L = S.course.lessons, l = L.find(x => x.id === S.open), b = blockOf(l), i = L.indexOf(l);
  const r = S.results[l.id], hr = S.hwres[l.id];
  const tabs = lessonTabs(l);
  if (!tabs.some(t => t[0] === S.sub)) S.sub = "theory";
  const miniDone = l.theory.filter((t, k) => t.mini?.length && S.minis[`${l.id}:${k}`]).length, miniAll = l.theory.filter(t => t.mini?.length).length;
  const pane = lessonPane(l, S.sub);
  return `<div class="row between" style="margin-bottom:12px"><button class="btn ghost sm" data-go="lessons">← Все уроки</button>
    <div class="row">${i>0 && isOpen(L[i-1])?`<button class="btn ghost sm" data-open="${L[i-1].id}">‹ № ${i}</button>`:""}${i<L.length-1 && isOpen(L[i+1])?`<button class="btn ghost sm" data-open="${L[i+1].id}">№ ${i+2} ›</button>`:""}
      <button class="btn sm" data-act="start-room" title="Доска с заданиями и звонок с учителем">▶ Начать урок</button>
      <button class="btn ghost sm" data-act="download" title="Скачать урок как документ Word">⤓ Скачать</button></div></div>
  <article class="window glass" style="--c:${b.color}">
    <div class="head">
      <div class="corners"><div class="mono muted">Дата:<br><b style="color:var(--ink)">${fmt(l.date,{day:"numeric",month:"long",year:"numeric"})}</b></div><div class="mono muted">${esc((l.oge || "Урок").split(" ")[0])}:<br><b style="color:var(--ink)">${esc(((l.oge || "Урок").replace(/^\S+\s*/,"") || l.oge || "Урок"))}</b></div></div>
      <h1>${esc(l.title)}</h1>
      <div class="rule">✦</div>
      <p class="mono muted">${esc(b.name)} · урок ${i+1} из ${L.length}</p>
    </div>
    <div class="tabs" role="group" aria-label="Разделы урока"><span class="lights" aria-hidden="true"><i></i><i></i><i></i></span>${tabs.map(([k,n,ic]) => `<button data-sub="${k}" aria-pressed="${S.sub===k}">${ic}${n}</button>`).join("")}</div>
   
    <div class="card" style="margin:0 0 14px;border-left:4px solid var(--violet)">
  <div class="kicker">Твой план на этот урок</div>
  <ol style="margin:8px 0 10px;padding-left:20px;line-height:1.7">
    <li>${S.sub === "theory" || miniDone ? "✅" : "•"} <b>Теория</b> — прочитай микротемы</li>
    <li>${miniAll && miniDone === miniAll ? "✅" : "•"} <b>Отработка</b> — мини-практика после каждой микротемы (${miniDone}/${miniAll || 0})</li>
    <li>${r ? "✅" : "•"} <b>Тест по уроку</b> — проверь себя${r ? " (лучший: " + pct(r.best) + "%)" : ""}</li>
    <li>${hr || S.hw[l.id]?.status ? "✅" : "•"} <b>Домашка</b> — закрепи и сдай</li>
  </ol>
  ${(() => {
    const next = !(S.sub === "theory" || miniDone) ? ["theory", "Начать с теории"] : (!miniAll || miniDone < miniAll) ? ["practice", "Перейти к отработке"] : (!r ? ["test", "Пройти тест"] : [null, null]);
    if (next[0]) return '<button class="btn sm" data-sub="' + next[0] + '">' + next[1] + ' →</button>';
    return (l.hw || l.hwtest?.length) && !hr ? '<button class="btn sm" data-sub="hw">Сделать домашку →</button>' : '<span class="chip">Урок пройден — можно закрыть ✅</span>';
  })()}
  ${L[i + 1] ? '<p class="small muted" style="margin:10px 0 0">Следующий урок: <b>' + esc(L[i + 1].title) + '</b> · ' + fmt(L[i + 1].date, { day: "numeric", month: "long" }) + '</p>' : '<p class="small muted" style="margin:10px 0 0">Это последний урок курса.</p>'}
</div>
    <div class="pane">${pane}</div>
    <div class="foot mono muted"><span>${miniAll ? `мини-практика ${miniDone}/${miniAll}` : `${(l.learn || []).length} темы урока`}</span><span>тест ${r ? pct(r.best) + "%" : "–"} · дз ${hr ? pct(hr.best) + "%" : "–"}</span></div>
  </article>`;
}

const viewLook = () => `<div class="section-title" style="margin-top:6px"><h2>Оформление</h2></div>
  <div class="card stack"><h3>Тема</h3><p class="small muted">Фон, стекло, папки и кнопки меняются вместе – в одной цветовой гамме. Своё фото: цвета папок подберутся по нему. Фото хранится только на этом устройстве.</p>${U.themesHTML(LS.get("theme", null) || S.profile.theme)}</div>
  <div class="card stack" style="margin-top:16px"><h3>Помощник</h3><p class="small muted">Встречает на главной, подсказывает в памятках и хвалит за тесты. Можно загрузить свою картинку (PNG с прозрачным фоном – будет как наклейка).</p>${U.mascotsHTML(LS.get("mascot", null) || S.profile.mascot)}</div>`;

function startTest(id, kind){
  let qs, title;
  if (kind === "entry"){ const et = entryTest(); qs = et.q; title = et.title; id = "entry-" + grade(); }
  else { const l = S.course.lessons.find(x => x.id === id); qs = kind === "hw" ? l.hwtest : tests(l).test; title = l.title; }
  S.test = {id, kind, qs, title, i:0, picked:null, score:0, wrong:[], t0:Date.now(), order:qs.map(q => q.o ? U.shuffle(q.o.map((_,k) => k)) : [])};
  S.testInRoom = S.view === "room"; if (!S.testInRoom) S.view = "test";
  testLive({start: true}); render(); if (!S.testInRoom) scrollTo(0,0); liveTrack();
}
function viewTest(){
  const T = S.test, n = T.qs.length, label = {hw:"ДЗ-тест", entry:"Входной тест", lesson:"Тест по уроку"}[T.kind];
  const back = S.testInRoom ? `data-act="test-close"` : T.kind === "entry" ? `data-go="entry"` : `data-open="${T.id}" data-sub="${T.kind==="hw"?"hw":"test"}"`;
  if (T.i >= n){
    const p = Math.round(T.score / n * 100);
    return `<article class="card" style="text-align:center">
        <span class="tag">${label} завершён</span><h1 style="margin:12px 0 4px;font-size:1.8rem">${esc(T.title)}</h1>
        <img data-m src="${U.mascot()}" alt="" style="width:150px;margin-top:8px">
        <div class="big tnum" style="font-size:2.6rem;color:${lvlColor(p)}">${T.score} из ${n}</div>
        ${T.kind === "lesson" || T.kind === "hw" ? `<p style="margin:2px 0" class="tnum">${T.kind === "lesson" ? (S.results[T.id]?.attempts > 1 ? "Пересдача: оценка за урок остаётся по первой попытке" : `Оценка за урок: <b style="font-size:1.4rem">${U.grade5(p)}</b>`) : `Результат ДЗ-теста – в оценку за ДЗ: <b style="font-size:1.4rem">${U.grade5(p)}</b>`}</p>` : ""}
        <p style="margin:4px 0 14px;font-weight:800">${p===100?"Котик ставит сто баллов!":p>=80?"Отличный результат!":p>=60?"Неплохо, есть что повторить.":T.kind==="entry"?"Спасибо! Учитель увидит, с чего начать.":"Тему повторим на уроке."}</p>
        ${(T.kind === "lesson" || T.kind === "hw") && (T.marks || []).some(x => x === false) ? `<p class="small" style="margin-bottom:8px">Ошибки в вопросах: <b>${T.marks.map((x, i) => x === false ? i + 1 : null).filter(Boolean).join(", ")}</b>. Правильные ответы разберёте с учителем.</p>` : ""}
        ${T.kind === "entry" ? "" : `<p class="expl small" style="text-align:left"><b>Рекомендация:</b> ${esc(U.recText({score:T.score,total:n,wrong:T.wrong}))}</p>`}
        <div class="row" style="justify-content:center;margin-top:14px"><button class="btn" ${back}>${T.kind==="entry"?"Посмотреть результаты":"В папку"}</button><button class="btn ghost" data-go="stats">Статистика</button></div>
      </article>`;
  }
  const q = T.qs[T.i], ord = T.order[T.i];
  /* тест урока и ДЗ-тест: ученик не видит правильных ответов (их видит учитель), только «ответ принят» */
  const quiet = T.kind === "lesson" || T.kind === "hw";
  const head = `<div class="row between" style="margin-bottom:10px"><button class="btn ghost sm" ${back}>✕ Выйти</button><span class="chip tnum">${label} · ${T.i+1} из ${n}</span></div>
    <div class="progress"><i style="width:${T.i/n*100}%"></i></div>`;
  const nextBtn = `<div style="margin-top:14px"><button class="btn" data-act="next-q">${T.i===n-1?"Завершить":"Дальше"}</button></div>`;
  if (q.pn){   // расставить запятые прямо в предложении
    const done = T.picked != null, sel = done ? (T.pnSel || []) : [];
    return head + `<article class="card" style="margin-top:14px"><div class="kicker">${esc(T.title)}</div><p class="q">${esc(q.q)}</p>
      <p class="small muted">Нажимай между словами, чтобы поставить или убрать запятую.</p>
      <div class="test-pn">${U.pnHTML(q.pn, sel, {ro: done, key: done && !quiet && T.kind !== "entry"})}</div>
      ${done ? `${quiet ? `<div class="expl"><b>Ответ принят.</b> Разбор – вместе с учителем.</div>` : T.kind === "entry" ? "" : `<div class="expl"><b>${T.picked ? "Верно." : "Неверно."}</b> ${T.picked ? "" : "Правильно: " + esc(U.pnText(q.pn, q.pn.a)) + " "}${esc(q.e || "")}</div>`}${nextBtn}`
        : `<div style="margin-top:12px"><button class="btn" data-act="pn-answer">Ответить</button></div>`}</article>`;
  }
  if (!q.o){   // вопрос с вводом ответа
    const done = T.picked != null, ok = done && T.picked === 1;
    return `<div class="row between" style="margin-bottom:10px"><button class="btn ghost sm" ${back}>✕ Выйти</button><span class="chip tnum">${label} · ${T.i+1} из ${n}</span></div>
    <div class="progress"><i style="width:${T.i/n*100}%"></i></div>
    <article class="card" style="margin-top:14px"><div class="kicker">${esc(T.title)}</div><p class="q">${esc(q.q)}</p>
      <form class="row" id="tin-form" style="flex-wrap:nowrap"><input type="text" id="tin" autocomplete="off" autocapitalize="none" spellcheck="false" ${done ? "readonly" : ""} value="${esc(T.typed || "")}" style="${done ? `border-color:${ok ? "var(--good)" : "var(--bad)"}` : ""}"><button class="btn" type="submit" ${done ? "hidden" : ""}>Ответить</button></form>
      ${done ? `${T.kind === "entry" ? "" : quiet ? `<div class="expl"><b>Ответ принят.</b></div>` : `<div class="expl"><b>${ok ? "Верно." : "Неверно."}</b> ${ok ? "" : "Правильно: " + esc(String(q.a).split("|")[0]) + ". "}${esc(q.e || "")}</div>`}
        <div style="margin-top:14px"><button class="btn" data-act="next-q">${T.i===n-1?"Завершить":"Дальше"}</button></div>` : ""}
    </article>`;
  }
  return `<div class="row between" style="margin-bottom:10px"><button class="btn ghost sm" ${back}>✕ Выйти</button><span class="chip tnum">${label} · ${T.i+1} из ${n}</span></div>
  <div class="progress"><i style="width:${T.i/n*100}%"></i></div>
  <article class="card" style="margin-top:14px">
    <div class="kicker">${esc(T.title)}</div>
    <p class="q">${esc(q.q)}</p>
    <div class="opts">${ord.map(k => { let c = ""; if (T.picked != null){ if (quiet) c = k === T.picked ? "chosen" : ""; else if (k === q.a) c = "ok"; else if (k === T.picked) c = "no"; }
      return `<button class="opt ${c}" data-pick="${k}" ${T.picked!=null?"disabled":""}>${esc(q.o[k])}</button>`; }).join("")}</div>
    ${T.picked != null ? `${T.kind === "entry" ? "" : quiet ? `<div class="expl"><b>Ответ принят.</b></div>` : `<div class="expl"><b>${T.picked===q.a?"Верно.":"Неверно."}</b> ${esc(q.e)}</div>`}
      <div style="margin-top:14px"><button class="btn" data-act="next-q">${T.i===n-1?"Завершить":"Дальше"}</button></div>` : ""}
  </article>`;
}

/* ---------- тесты по темам: ссылка index.html?quiz=КОД, объяснения, повтор, карта ---------- */
const Quiz = window.Quiz || null;
const quizDate = x => { try { return new Date(x).toLocaleDateString("ru-RU", {day:"numeric",month:"long",year:"numeric"}); } catch(_) { return ""; } };
async function openQuiz(token){
  if (!token) return false;
  if (!Quiz){ toast("Модуль тестов не загрузился – обновите страницу."); return false; }
  if (S.view === "quiz" && S.qz && !S.qz.done){ toast("Сначала закончи текущий тест"); return false; }
  if (!sb){ toast("Тест откроется, когда появится связь с сервером."); return false; }
  let r;
  try { r = await sb.rpc("quiz_get", {p_token: token}); } catch(e){ r = {error:e}; }
  if (r?.error || !r?.data){ toast("Тест не найден или нет связи. Попросите у учителя новую ссылку."); return false; }
  const data = r.data, questions = Quiz.normQuestions(data.data);
  if (!questions.length){ toast("В этом тесте пока нет вопросов."); return false; }
  S.quiz = {id: data.id || token, title: data.title || data.data?.title || "Тест по темам", data: data.data || {}, questions};
  S.qz = {i:0, attempt:1, picked:null, revealed:false, log:[], done:false, result:null};
  S.quizToken = null;                       // ссылка уже открыта – не переоткрывать после выхода/входа
  S.view = "quiz"; S.drawer = false;
  render(); scrollTo(0, 0); liveTrack();
  return true;
}
/* ссылка ?quiz=: если ученик не был залогинен, токен ждёт входа/регистрации и открывается после load */
async function openDeepQuiz(){
  if (!S.quizToken || !S.profile || S.invite) return false;
  return await openQuiz(S.quizToken);
}
function quizPick(k){
  const Q = S.quiz, A = S.qz;
  if (!Q || !A || A.done || A.revealed) return;
  const q = Q.questions[A.i]; if (!q || !(k >= 0 && k < q.o.length)) return;
  A.picked = k; A.revealed = true;
  A.log[A.i] = {i:A.i, topic:q.topic, topicId:q.topicId, first:(A.attempt === 1 && k === q.a), attempts:A.attempt, ok:k === q.a, picked:k};
  render();
}
function quizRetry(){
  const A = S.qz; if (!A || A.done || A.attempt !== 1) return;
  A.attempt = 2; A.picked = null; A.revealed = false; render();
}
function quizNext(){
  const Q = S.quiz, A = S.qz; if (!Q || !A || A.done) return;
  if (A.i >= Q.questions.length - 1){ finishQuiz(); return; }
  A.i++; A.attempt = 1; A.picked = null; A.revealed = false;
  render(); scrollTo(0, 0);
}
function quizRestart(){
  if (!S.quiz || !S.quiz.questions?.length) return;
  S.qz = {i:0, attempt:1, picked:null, revealed:false, log:[], done:false, result:null};
  S.quizToken = null; S.view = "quiz"; S.drawer = false;
  render(); scrollTo(0, 0); liveTrack();
}
async function finishQuiz(){
  const Q = S.quiz, A = S.qz; if (!Q || !A || A.done) return;
  const n = Q.questions.length, topics = Quiz.summarize(Q.questions, A.log);
  const score = A.log.filter(x => x && x.ok).length;
  const needsWork = topics.filter(t => t.needsWork).map(t => t.title);
  A.done = true;
  A.result = {score, total:n, pct: n ? Math.round(score / n * 100) : 0, topics, needsWork};
  const at = new Date().toISOString();
  S.qzResults = [{quiz_id:Q.id, title:Q.title, score, total:n, details:{questions:A.log, topics}, needs_work:needsWork, created_at:at}, ...(S.qzResults || [])].slice(0, 100);
  if (S.quizzes) S.quizzes = S.quizzes.map(x => x.id === Q.id ? {...x, last:{score, total:n, at}} : x);
  S.view = "quiz"; S.drawer = false;
  render(); scrollTo(0, 0); liveTrack();
  liveAct(`прошёл тест по темам: ${score}/${n}`);
  if (!sb) return;
  try {
    const {error} = await sb.rpc("quiz_submit", {p_code:S.token, p_token:Q.id, p_score:score, p_total:n, p_details:{questions:A.log, topics}, p_needs_work:needsWork});
    if (error) toast("Результат не отправлен учителю: нет связи. Покажи этот экран учителю.");
  } catch(e){ toast("Результат не отправлен учителю: нет связи. Покажи этот экран учителю."); }
}
function viewQuizResult(){
  const Q = S.quiz, A = S.qz, R = A?.result;
  if (!Q || !R) return `<div class="card"><p>Итог теста не сохранился на этом устройстве.</p><div class="row" style="margin-top:10px"><button class="btn" data-go="quizzes">Все тесты</button><button class="btn ghost" data-go="home">На главную</button></div></div>`;
  const stats = Quiz.topicStats([{details:{topics:R.topics}}]);
  return `<div class="quiz-wrap"><article class="quiz-card card quiz-result" data-qresult="1">
    <div class="kicker">Тест по темам завершён</div>
    <h1 style="font-size:1.5rem;margin:6px 0 2px">${esc(Q.title)}</h1>
    <div class="quiz-score" data-score="${R.score}" data-total="${R.total}" data-pct="${R.pct}">${R.score} <small>из ${R.total} · ${R.pct}%</small></div>
    <p style="margin:0">${R.pct === 100 ? "Котик ставит сто баллов!" : R.pct >= 80 ? "Отличный результат!" : R.pct >= 60 ? "Неплохо, есть что повторить." : "Есть темы, которые надо разобрать с учителем."}</p>
    <div><b>Надо доработать:</b> ${R.needsWork.length ? `<div class="quiz-topics">${R.needsWork.map(t => `<span class="chip bad">${esc(t)}</span>`).join("")}</div>` : `<div class="quiz-topics"><span class="chip good">все темы освоены</span></div>`}</div>
    <div class="section-title" style="margin:2px 0 0"><h2 style="font-size:1.1rem">Карта тем</h2></div>
    <div id="qz-map">${Quiz.graphHTML(stats)}</div>
    <div class="quiz-actions"><button class="btn" data-go="home">На главную</button><button class="btn ghost" data-qagain="1">Пройти снова</button><button class="btn ghost" data-go="quizzes">Все тесты</button></div>
  </article></div>`;
}
function viewQuiz(){
  const Q = S.quiz, A = S.qz;
  if (!Q || !A || !Q.questions.length) return `<div class="card"><p>Тест не открыт.</p><div class="row" style="margin-top:10px"><button class="btn" data-go="quizzes">Все тесты</button><button class="btn ghost" data-go="home">На главную</button></div></div>`;
  if (A.done) return viewQuizResult();
  const n = Q.questions.length, q = Q.questions[A.i] || Q.questions[0], ok = A.revealed && A.picked === q.a;
  const last = A.i === n - 1;
  const expl = q.e ? esc(q.e) : `Правильный ответ: ${esc(q.o[q.a])}`;
  const opts = q.o.map((o, k) => {
    let c = "";
    if (A.revealed){ if (ok && k === q.a) c = "ok"; else if (!ok && k === A.picked) c = "no"; }
    return `<button class="quiz-opt${c ? " " + c : ""}" data-qopt="${k}" ${A.revealed ? "disabled" : ""}><span class="n">${k + 1}.</span><span>${esc(o)}</span></button>`;
  }).join("");
  const fb = A.revealed ? `<div class="quiz-fb ${ok ? "ok" : "no"}"><b>${ok ? "Верно!" : "Неверно."}</b><div class="quiz-expl">${expl}</div>${!ok && A.attempt === 1 ? `<div class="small muted">Это первая попытка. Попробуй ещё раз – тот же вопрос, вторая попытка из двух.</div>` : !ok && A.attempt === 2 ? `<div class="small muted">Тема попадает в «Надо доработать».</div>` : ""}</div>` : "";
  const act = !A.revealed ? "" : (ok || A.attempt === 2)
    ? `<div class="quiz-actions"><button class="btn" data-qnext="1">${last ? "Завершить" : "Дальше"}</button></div>`
    : `<div class="quiz-actions"><button class="btn" data-qretry="1">Попробовать ещё раз</button></div>`;
  return `<div class="quiz-wrap">
    <div class="row between" style="margin-bottom:10px"><button class="btn ghost sm" data-go="home">← На главную</button><span class="chip tnum">Вопрос ${A.i + 1} из ${n}</span></div>
    <article class="quiz-card card">
      <div class="kicker">Тест по темам</div>
      <h1 style="font-size:1.4rem;margin:6px 0 2px">${esc(Q.title)}</h1>
      <div class="quiz-progress"><span class="small muted">Вопрос ${A.i + 1} из ${n}${A.attempt === 2 ? " · 2-я попытка" : ""}</span><div class="bar"><i style="width:${Math.round(A.i / n * 100)}%"></i></div></div>
      ${q.topic ? `<div class="row" style="gap:6px;margin:2px 0 4px"><span class="quiz-topic-chip">${esc(q.topic)}</span></div>` : ""}
      <p class="quiz-q">${esc(q.q)}</p>
      <div class="quiz-opts">${opts}</div>
      ${fb}${act}
    </article></div>`;
}
function quizItemHTML(item){
  const last = item.last;
  return `<div class="qz-item"><div style="min-width:0"><b>${esc(item.title || "Тест по темам")}</b><div class="small muted">${item.questions || 0} ${item.questions === 1 ? "вопрос" : "вопросов"}${item.topics ? " · " + item.topics + " тем" : ""}${last ? ` · последний: ${last.score} из ${last.total}` : " · ещё не проходил"}</div></div>
    <button class="btn sm" data-quiz="${esc(item.id)}">${last ? "Пройти снова" : "Пройти"}</button></div>`;
}
function viewQuizzes(){
  const list = S.quizzes || [], results = S.qzResults || [];
  const stats = Quiz ? Quiz.topicStats(results) : [];
  let body;
  if (!sb) body = `<div class="card"><p>Тесты доступны при подключении к серверу.</p></div>`;
  else if (S.qzBusy && !S.quizzes) body = `<div class="card"><p class="muted">Загружаю тесты…</p></div>`;
  else if (!list.length) body = `<div class="card"><p>Учитель пока не присылал тестов по темам. Когда пришлёт ссылку – тест появится здесь.</p></div>`;
  else body = `<div class="quiz-list">${list.map(quizItemHTML).join("")}</div>`;
  const hist = results.length ? `<div class="section-title"><h2>История попыток</h2></div><div class="quiz-list">${results.slice(0, 20).map(r => `<div class="qz-item"><div style="min-width:0"><b>${esc(r.title || "Тест по темам")}</b><div class="small muted">${esc(r.created_at ? quizDate(r.created_at) : "")}</div></div><span class="chip ${(r.total && r.score / r.total >= 0.6) ? "good" : "bad"}">${r.score} / ${r.total}</span></div>`).join("")}</div>` : "";
  return `<div class="section-title" style="margin-top:6px"><h2>Тесты</h2><span class="chip">${list.length}</span></div>
    <p class="small muted" style="margin-bottom:12px">Тесты по темам от учителя: сразу объяснение, при ошибке – вторая попытка. По итогам видно, что уже освоено, а что надо доработать.</p>
    ${body}
    <div class="section-title"><h2>Карта тем</h2></div>
    <div id="qz-map">${Quiz ? Quiz.graphHTML(stats) : "<p class='small muted'>Модуль тестов не загрузился.</p>"}</div>
    ${hist}`;
}
async function loadQuizzes(force){
  if (!sb || !S.profile) return false;
  if (S.qzBusy) return false;
  if (S.quizzes && !force) return true;
  S.qzBusy = true;
  try {
    const {data, error} = await sb.rpc("student_quizzes", {p_code: S.token});
    if (error || !data){ if (force) toast("Не удалось загрузить тесты: проверь интернет."); return false; }
    S.quizzes = data.quizzes || [];
    S.qzResults = data.results || [];
    return true;
  } catch(e){ if (force) toast("Не удалось загрузить тесты: проверь интернет."); return false; }
  finally { S.qzBusy = false; }
}
async function openQuizzes(){
  if (S.regDone){ S.invite = null; S.regDone = null; }
  S.view = "quizzes"; S.drawer = false; S.qzBusy = true;
  render(); scrollTo(0, 0); liveTrack();
  S.qzBusy = false;
  if (await loadQuizzes(true)){ if (S.view === "quizzes") render(); }
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

/* ---------- самообучение ---------- */
function selfLessons(){ return (S.course?.lessons || []).filter(l => isOpen(l) && !l.custom); }
function selfLesson(){ const L = selfLessons(); return L.find(l => l.id === S.selfL) || lastPast() || L[L.length - 1] || null; }
function selfGames(){ return (S.course?.lessons || []).flatMap(l => (l.materials || []).filter(m => m.kind === "tasks" && m.data?.kind === "game").map(m => ({m, l}))); }
function viewSelf(){
  if (!S.course) return noCourse();
  const L = selfLessons(), l = selfLesson(), best = LS.get("self-best", {}) || {};
  const card = (act, emo, h, d, extra = "") => `<button class="pl-card" data-act="${act}" ${extra}><span class="pl-emo">${emo}</span><b>${h}</b><span class="small muted">${d}</span>${best[act] ? `<span class="chip" style="margin-top:4px">лучший: ${esc(best[act])}</span>` : ""}</button>`;
  const games = selfGames(), themes = (window.PLAY_BANKS?.themes || []);
  return `<div class="section-title" style="margin-top:6px"><h2>Самообучение</h2></div>
    <p class="muted" style="margin-bottom:12px">Тренируйся сам: повторяй теорию, проверяй себя, играй. Учитель видит, что ты занимался.</p>
    ${L.length ? `<div class="card" style="margin-bottom:14px"><label for="self-l" class="small"><b>Урок для тренировки</b></label>
      <select id="self-l" style="width:100%;margin-top:6px">${L.map(x => `<option value="${x.id}" ${x === l ? "selected" : ""}>${esc(x.title)}</option>`).join("")}</select></div>` : `<div class="card" style="margin-bottom:14px"><p class="muted">Уроки откроются в дни занятий – а пока можно тренировать ударения, орфографию и играть.</p></div>`}
    <h3 style="margin:6px 0 10px">По уроку</h3>
    <div class="pl-grid" style="margin-bottom:18px">
      ${l ? card("self-trainer", "🎯", "Тренажёр урока", "Теория по шагам, вопросы с подсказками и работа над ошибками") : ""}
      ${l ? card("self-tf", "✅", "Верно или неверно", "Быстрые карточки по вопросам урока") : ""}
      ${l ? card("self-cards", "🧠", "Карточки-запоминалки", "Правила, исключения, мнемотехники – переворачивай и запоминай") : ""}
      ${l ? card("self-quiz", "📝", "Тест для самопроверки", "Вопросы урока в случайном порядке") : ""}
      ${l ? card("self-lgames", "🎮", "Игры по уроку", "Викторина на время, найди пару, мемори") : ""}
      ${L.length > 1 ? card("self-mix", "🔀", "Повторение всего", "Вопросы из всех пройденных уроков вперемешку") : ""}
    </div>
    <h3 style="margin:6px 0 10px">Тренировки</h3>
    <div class="pl-grid" style="margin-bottom:18px">
      ${card("self-stress", "🔊", "Карточки ударений", "Нажми на ударную гласную: звони́т, то́рты, щаве́ль…")}
      ${card("self-spell", "✍️", "Вставь букву", "Орфография: корни, приставки, суффиксы, Н и НН, Ь")}
    </div>
    ${games.length ? `<h3 style="margin:6px 0 10px">Игры от учителя</h3><div class="pl-grid" style="margin-bottom:18px">${games.map(({m, l: gl}) => `<button class="pl-card" data-play-game="${m.id}"><span class="pl-emo">🎮</span><b>${esc(m.title || m.data.theme?.title || "Игра")}</b><span class="small muted">${esc(gl.title)}</span></button>`).join("")}</div>` : ""}
    <h3 style="margin:6px 0 10px">Игры по темам</h3>
    <div class="pl-grid">${themes.map(t => `<button class="pl-card" data-play-theme="${t.id}"><span class="pl-emo">🕹️</span><b>${esc(t.title)}</b><span class="small muted">${Play.gamesFor(t).map(k => Play.GAMES[k].n).join(" · ")}</span></button>`).join("")}</div>`;
}
/* результат самообучения уходит учителю: вид «self», в lesson_id – режим и урок, в wrong – ошибки */
const SELF_MODE = {"self-trainer":"trainer", "self-tf":"tf", "self-cards":"cards", "self-quiz":"quiz", "self-lgames":"games", "self-mix":"mix", "self-stress":"stress", "self-spell":"spell"};
function viewOge(){
  if (!OGE.isOge(S.course)) return viewSelf();
  return `<div class="section-title" style="margin-top:6px"><h2>Мой ОГЭ</h2></div>
    <p class="muted" style="margin-bottom:12px">Все задания экзамена: как ты справляешься с каждым, где слабые зоны и что отработать. Отметь звёздами, насколько уверен в каждом задании, – и сравни с результатами.</p>
    ${OGE.html(S.course, S.rows, S.writings, {isOpen})}`;
}
function ogeAct(t){
  const isO = l => isOpen(l);
  if (t.dataset.ogeRate){ sendResult(`oge:rate:${t.dataset.ogeRate}`, "oge", +t.dataset.v, 5, []); render(); return; }
  if (t.dataset.ogeDrill != null){
    const n = t.dataset.ogeDrill, name = (OGE.TASKS.find(x => x[0] === n) || [])[1] || "";
    Play.onDone = r => { liveAct(`отработка ОГЭ, задание ${n}: ${r.ok} из ${r.n}`); if (r.n) sendResult("oge:" + n, "oge", r.ok, Math.min(r.n, 100), (r.wrong || []).slice(0, 30)); if (S.view === "oge") setTimeout(render, 50); };
    Play.quizRun(`Задание ${n}. ${name}`, OGE.drillQs(S.course, n, isO), "Отработка ОГЭ", 12); return;
  }
  if (t.dataset.ogeMock != null){
    const qs = OGE.mockQs(S.course, isO);
    Play.onDone = r => { liveAct(`пробный вариант ОГЭ: ${r.ok} из ${r.n}`); if (r.n) sendResult("oge:mock", "oge", r.ok, Math.min(r.n, 100), (r.wrong || []).slice(0, 30)); if (S.view === "oge") setTimeout(render, 50); };
    Play.quizRun("Пробный вариант: задания 2–12", qs, "ОГЭ", 30, true);
  }
}
function selfDone(act, lid){
  return r => {
    liveAct(`самообучение · ${r.title}: ${r.ok} из ${r.n}`);
    const n = Math.min(r.n || 0, 100), ok = Math.min(Math.max(r.ok || 0, 0), n);
    if (n > 0) sendResult(`self:${SELF_MODE[act] || act.replace(/^theme-/, "t-")}:${lid || "-"}`.slice(0, 40), "self", ok, n, (r.wrong || []).slice(0, 30));
    try { const b = LS.get("self-best", {}) || {}; const pc = r.n ? Math.round(r.ok / r.n * 100) : 0; const prev = parseInt(b[act] || "0"); if (pc >= prev){ b[act] = pc + "%"; LS.set("self-best", b); } } catch(_) {}
  };
}
function selfAct(a, t){
  const l = selfLesson();
  Play.onDone = selfDone(a, ["self-stress", "self-spell", "self-mix"].includes(a) ? "" : l?.id);
  if (a === "self-trainer") Play.trainer(l);
  if (a === "self-tf") Play.tfCards(l.title, Play.tfFromQuiz(Play.quizFromLessons([l])));
  if (a === "self-cards") Play.flashcards(l.title, Play.cardsFromLessons([l]));
  if (a === "self-quiz") Play.quizRun(l.title, Play.quizFromLessons([l]));
  if (a === "self-lgames") Play.chooseGame({title: l.title, quiz: Play.quizFromLessons([l]).filter(q => Array.isArray(q.o))});
  if (a === "self-mix") Play.quizRun("Повторение пройденного", Play.quizFromLessons(selfLessons()), "Повторение");
  if (a === "self-stress") Play.stress(PLAY_BANKS.stress);
  if (a === "self-spell") Play.spell(PLAY_BANKS.spell);
}
function playGame(mid, g){
  const m = (S.course?.lessons || []).flatMap(l => l.materials || []).find(x => String(x.id) === String(mid)); if (!m) return;
  const th = {...(m.data.theme || {}), title: m.title || m.data.theme?.title || "Игра"};
  Play.onDone = selfDone("game", String(mid));
  if (g) Play.game(g, th); else Play.chooseGame(th);
}

/* успеваемость по всем предметам: с сервера (если функция есть), иначе – только текущий предмет */
function progressList(){
  if (sb && !S.progLoading && (!S.prog || Date.now() - S.progAt > 60000)){
    S.progLoading = true;
    sb.rpc("student_progress", {p_code: S.token}).then(({data, error}) => { S.progLoading = false; S.progAt = Date.now(); if (!error && Array.isArray(data)){ S.prog = data; if (S.view === "stats") render(); } });
  }
  const cur = {subject: S.profile.subject || subjKey(), ...U.subjectNow(S.rows, Object.values(S.writings))};
  if (!S.prog) return [cur];
  return S.prog.map(x => x.id === S.profile.id ? cur : {subject: x.subject, ...U.subjectNow(x.results, x.writings)});
}
function viewStats(){
  const et = entryTest(), er = entryRes();
  return `<div class="section-title" style="margin-top:6px"><h2>Статистика</h2></div>
    ${U.progressHTML(progressList())}
    ${S.course ? window.mapHTML(S.course, S.results, S.hwres, S.writings, S.hw) : ""}
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

/* ---------- урок с учителем: ученик выбирает, что открыть на этом устройстве ---------- */
const JOIN = {both: "Доска и видеозвонок", board: "Только доска и задания", call: "Только видеозвонок"};
function roomLesson(){ const id = S.room?.lesson; return !id || id === "free" ? FREE : S.course?.lessons.find(x => x.id === id) || FREE; }
function callURL(){ return S.room?.url || S.profile.call_url || ""; }
function closeJoin(){ document.getElementById("joinbox")?.remove(); }
/* видеозвонок прямо на платформе – окошко сбоку внизу */
function startCall(){
  if (!window.Call) return;
  Call.join({sb, room: `${S.profile.teacher}-${S.profile.board_owner || S.profile.id}`, me: "s-" + S.profile.id, name: S.profile.name.split(" ")[0],
    onConnected: (id, name) => {
      toast(`${name || "Учитель"} на связи`);
      if (S.room && S.joinHow !== "call" && S.view !== "room"){ S.open = roomLesson().id; S.view = "room"; S.drawer = false; render(); scrollTo(0, 0); }
    }});
  if (S.joinHow === "call") Call.setSize("large");
}
/* приглашение учителя (или ученик сам начал урок – self) */
/* ученик уже подключился к уроку (в том числе до перезагрузки страницы) – смена урока и материалов не требует подключаться заново */
const JK = "joined-room";
const joinedNow = () => { try { const j = JSON.parse(sessionStorage.getItem(JK) || "null"); return j && j.teacher === S.profile?.teacher && Date.now() - j.t < 4 * 3600e3 && (!S.roomEnded || S.roomEnded < j.t) ? j : null; } catch(_) { return null; } };
function invite(r, self){
  const same = S.room && S.room.lesson === r.lesson;
  S.room = {...(S.room || {}), ...r, url: r.url || S.room?.url || S.profile.call_url || "", self};
  if (r.lesson && r.lesson !== "free") S.forced.add(r.lesson);
  if (S.view === "room" || (S.joinHow && (Call.active() || S.joinHow === "board"))){
    if (!same){ if (S.joinHow !== "call"){ S.open = r.lesson; S.test = null; S.testInRoom = false; S.view = "room"; } closeJoin(); render(); toast(`Учитель открыл урок «${roomLesson().title}»`); }
    return; }
  const j = joinedNow();
  if (j && !self){ applyJoin(j.how || "board", true); return; }
  const how = LS.get("join-how", null);
  if (how && JOIN[how] && !self){ applyJoin(how, true); return; }
  joinBox(self);
}
function joinBox(self){
  closeJoin(); const l = roomLesson(), url = callURL(), how = LS.get("join-how", null);
  const box = document.createElement("div"); box.id = "joinbox"; box.className = "joinbox";
  box.innerHTML = `<div class="card stack" role="dialog" aria-modal="true" aria-labelledby="jb-h" style="gap:10px">
    <div class="kicker">${self ? "Начинаем урок" : "Учитель начал урок"}</div><h2 id="jb-h" style="margin:0">${esc(l.title)}</h2>
    <p class="small muted">Что открыть на этом устройстве? Видеозвонок – маленьким окошком сбоку, доска и задания не закрываются. С двух устройств можно выбрать разное: например, звонок на телефоне, доску на компьютере.</p>
    <button class="btn" data-act="join" data-how="both">🖊 + 🎥 ${JOIN.both}</button>
    <button class="btn ghost" data-act="join" data-how="board">🖊 ${JOIN.board}</button>
    <button class="btn ghost" data-act="join" data-how="call">🎥 ${JOIN.call}</button>
    <label class="row small" style="gap:8px"><input type="checkbox" id="jb-remember" ${how ? "checked" : ""} style="width:auto"> Запомнить выбор на этом устройстве</label>
    ${url ? `<p class="small muted">Если видеозвонок не соединяется – <a href="${esc(url)}" target="_blank" rel="noopener">звонок по ссылке учителя</a>.</p>` : ""}
    <button class="linkbtn" data-act="join-close">Позже</button></div>`;
  document.body.appendChild(box); box.querySelector("[data-how]")?.focus();
}
function applyJoin(how, auto){
  closeJoin(); const l = roomLesson(); S.joinHow = how;
  try { sessionStorage.setItem(JK, JSON.stringify({teacher: S.profile.teacher, how, t: Date.now()})); } catch(_) {}
  if (S.room?.self) liveAct2({room: true, lesson: S.room.lesson, title: l.title}, `начинает урок «${l.title}» (${JOIN[how].toLowerCase()})`);
  if (how !== "board") startCall();
  if (how === "call"){ toast(auto ? "Видеозвонок – на этом устройстве (так ты выбрал раньше)" : "Видеозвонок включён"); liveTrack(); return; }
  S.open = l.id; S.test = null; S.view = "room"; S.drawer = false; render(); scrollTo(0, 0);
  if (auto) toast(`Учитель начал урок – открыта доска${how === "both" ? " и видеозвонок" : ""}`);
}
function viewRoom(){
  const l = roomLesson(), url = callURL(), how = LS.get("join-how", null);
  const tabs = l.free ? [] : lessonTabs(l).filter(t => t[0] !== "board");
  const sub = tabs.some(t => t[0] === S.sub) ? S.sub : tabs[0]?.[0];
  const pane = S.test && S.testInRoom ? viewTest() : sub ? lessonPane(l, sub) : "";
  return `<div class="roombar glass"><div class="row" style="gap:8px;min-width:0"><span class="live-dot" aria-hidden="true"></span><b>Урок с учителем</b><span class="small muted">${esc(l.title)}</span></div>
      <div class="row" style="gap:8px">${window.Call && !Call.active() ? `<button class="btn sm" data-act="call-start">🎥 Видеозвонок</button>` : ""}
      ${url ? `<a class="btn ghost sm" href="${esc(url)}" target="_blank" rel="noopener" title="Если видеозвонок не соединяется">Звонок по ссылке</a>` : ""}
      ${how ? `<button class="btn ghost sm" data-act="join-reset" title="Сейчас: ${esc(JOIN[how] || "")}">Выбор устройства</button>` : ""}
      <button class="btn ghost sm" data-act="room-leave">Выйти</button></div></div>
  <div class="room room-one">
    <article class="window glass room-board" style="--c:${l.free ? "var(--violet)" : blockOf(l).color}"><div class="head"><h1 style="font-size:1.25rem">${esc(l.title)}</h1></div>
      <p class="small muted room-hint">Урок прямо на доске: листы вверху. 👆 – отвечать (нажимать, вписывать буквы), ✎ – писать поверх. Доска общая с учителем${S.profile.pair ? ` и с ${esc(S.profile.pair.name.split(" ")[0])}` : ""}.</p>
      <div class="pane"><div class="board glass" id="board"></div></div></article>
  </div>`;
}
/* урок на доске: разделы урока – «живые» листы, в них отвечают; рисовать можно поверх */
function roomBoardPages(l){
  if (l.free) return {pages: Board.pages(S.course || {}, l), live: {}};
  const tabs = lessonTabs(l).filter(t => t[0] !== "board"), live = {};
  tabs.forEach(([k]) => live[k] = el => {
    const html = k === "test" && S.test && S.testInRoom ? viewTest() : lessonPane(l, k);
    el.innerHTML = `<div class="bd-sheet bd-live">${html}</div>`;
    const root = el.querySelector("#wk-root"); if (root){ const states = (S.works = S.works || {})[l.id] = S.works[l.id] || {}; Work.bind(root, states, (i, st) => saveWork(l.id, i, st)); }
  });
  const extra = Board.pages(S.course || {}, l).filter(p => !["practice", "test", "theory", "text"].includes(p.key));
  return {pages: [...tabs.map(([k, n]) => ({key: k, label: n, html: ""})), ...extra], live};
}
/* тест ученика – вживую у учителя */
/* каждый ответ ученика – в журнал теста: учитель видит его вживую и после теста */
function logAns(q, given, right, ok){ const T = S.test; (T.log = T.log || [])[T.i] = {n: T.i + 1, q: String(q.q).slice(0, 200), given: String(given ?? "").slice(0, 200), right: String(right ?? "").slice(0, 200), ok: !!ok}; }
function testLive(extra){
  const T = S.test; if (!T || T.kind === "entry") return;
  const q = T.qs[T.i];
  liveAct2({test: true, lesson: T.id, kind: T.kind, title: T.title, i: T.i, n: T.qs.length, score: T.score,
    q: q ? {q: q.q, o: q.o || null, a: q.a, pn: q.pn || null} : null, picked: T.picked, typed: T.typed || "", log: (T.log || []).filter(Boolean), ...extra});
}
function liveAct2(extra, text){ if (live) live.send({type:"broadcast", event:"act", payload:{act:true, dev:DEV, id:S.profile.id, name:S.profile.name, text, ...extra}}).catch(() => {}); }
/* ---------- отрисовка ---------- */
function render(){
  S.syncPending = false;
  const app = $("#app");
  if (S.invite){ app.innerHTML = `<main class="main">${viewRegister()}</main>`; return; }
  if (!S.profile){ app.innerHTML = `<main class="main">${viewLogin()}</main>`; return; }
  /* урок ещё не загрузился (после перезагрузки) – пока показываем главную, маршрут не теряем */
  const wait = S.view === "folder" && !(S.course?.lessons || []).some(l => l.id === S.open);
  const v = wait ? "home" : S.view;
  if (!wait) try { sessionStorage.setItem("s-route", JSON.stringify({view: v, open: S.open, sub: S.sub, y: v === S.routeV ? scrollY : 0})); S.routeV = v; } catch(_) {}
  if (S.routeY){ const y = S.routeY; S.routeY = 0; requestAnimationFrame(() => scrollTo(0, y)); }
  const body = v==="home"?viewHome():v==="lessons"?viewLessons():v==="folder"?viewFolder():v==="test"?viewTest():v==="stats"?viewStats():v==="plan"?viewPlan():v==="entry"?viewEntry():v==="look"?viewLook():v==="myboard"?viewMyBoard():v==="room"?viewRoom():v==="self"?viewSelf():v==="oge"?viewOge():v==="profile"?viewProfile():v==="quiz"?viewQuiz():v==="quizzes"?viewQuizzes():viewInstall();
  app.innerHTML = `<div class="shell">
    <div class="drawer-back" ${S.drawer ? "" : "hidden"} data-act="close-drawer"></div>
    <nav class="drawer glass ${S.drawer ? "open" : ""}" aria-label="Меню">${drawerHTML()}</nav>
    <div style="min-width:0">
      <header class="topnav"><div class="in glass">
        <button class="iconbtn menu-btn" data-act="open-drawer" aria-label="Открыть меню">${I.menu}</button>
        <span class="ttl">${esc(TITLES[v] || "")}</span>
        <span class="row" style="gap:6px;align-items:center"><img data-m src="${U.mascot()}" alt="" style="width:38px;height:38px;object-fit:contain"><button class="iconbtn" data-go="profile" aria-label="Мой профиль" style="padding:0">${avatarHTML(S.profile, "avatar sm")}</button></span>
      </div></header>
      <main class="main">${body}</main>
    </div></div>`;
  if (v === "folder" && S.sub === "board"){
    const l = S.course.lessons.find(x => x.id === S.open);
    S.board = Board.keep($("#board"), "s:" + l.id, {
      api: Board.api("student", sb, {code:S.token, lesson:l.id}),
      sb, channelName: sb ? `board-${S.profile.board_owner || S.profile.id}-${l.id}` : null, page: S.boardPage,
      role: "student", name: S.profile.name, pages: Board.pages(S.course, l), onPage: p => S.boardPage = p
    });
  }
  if (v === "folder" && S.sub === "practice" && $("#wk-root")){
    const l = S.course.lessons.find(x => x.id === S.open), states = (S.works = S.works || {})[l.id] = S.works[l.id] || {};
    Work.bind($("#wk-root"), states, (i, st) => saveWork(l.id, i, st));
  }
  if (v === "room"){
    const l = roomLesson();
    const {pages, live} = roomBoardPages(l);
    S.board = Board.keep($("#board"), "r:" + l.id, {api: Board.api("student", sb, {code:S.token, lesson:l.id}), sb, channelName: sb ? `board-${S.profile.board_owner || S.profile.id}-${l.id}` : null,
      page: S.boardPage, role: "student", name: S.profile.name, pages, live, onPage: p => S.boardPage = p});
    if (S.boardPage) S.board?.open(S.boardPage);
  }
  if (v === "myboard"){
    S.board = Board.keep($("#board"), "s:free", {api: Board.api("student", sb, {code:S.token, lesson:"free"}), sb, channelName: sb ? `board-${S.profile.board_owner || S.profile.id}-free` : null,
      page: S.boardPage, role: "student", name: S.profile.name, pages: Board.pages(S.course || {}, FREE), onPage: p => S.boardPage = p});
  }
  if (!$("#board")){ Board.release(); S.board = null; }
  if (S.profile && sb){ liveStart(); liveTrack(); }
}

/* ---------- события ---------- */
document.addEventListener("submit", async e => {
  e.preventDefault();
  /* сообщение – без перерисовки, чтобы не стирать то, что уже введено */
  const say = (t, ok, extra) => { S.authMsg = {t, ok, ...(extra || {})}; const el = $("#authmsg");
    if (el && !extra?.resend){ el.textContent = t; el.className = "formmsg " + (ok ? "good" : "bad"); e.target.querySelectorAll("button[type=submit]").forEach(b => { b.disabled = false; }); } else render(); };
  if (e.target.id === "signup-form"){
    const email = $("#su-email").value.trim(), pw = $("#su-pass").value;
    if (!sb) return say("Сервер ещё не подключён.");
    if (U.tempMail(email)) return say("Одноразовые почтовые ящики не подходят – укажите свою постоянную почту.");
    if (pw.length < 8) return say("Пароль – не меньше 8 знаков.");
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Регистрирую…";
    try{
      const {data, error} = await sb.auth.signUp({email, password: pw, options: {data: {name: $("#su-name").value.trim()}, emailRedirectTo: U.siteURL("teacher.html")}});
      if (error) throw error;
      if (data.session){ location.href = "teacher.html"; return; }   // подтверждение почты выключено
      if (data.user && !data.user.identities?.length){ S.role = "teacher"; S.lastEmail = email; return say("Эта почта уже зарегистрирована – войдите."); }
      S.signupDone = email; S.lastEmail = email; S.authMsg = null; render();
    }catch(er){ btn.textContent = "Зарегистрироваться"; say(U.authErr(er)); }
    return;
  }
  if (e.target.id === "tin-form"){
    const T = S.test, q = T.qs[T.i], v = $("#tin").value.trim(); if (!v) return;
    T.typed = v; const ok = U.miniCheck(v, q.a); T.picked = ok ? 1 : 0; (T.marks = T.marks || [])[T.i] = ok; logAns(q, v, String(q.a).split("|")[0], ok); if (ok) T.score++; else T.wrong.push(q.tag || "ввод ответа"); testLive({ok}); render(); return;
  }
  if (e.target.id === "ssignup-form"){
    const code = $("#ss-code").value.trim().toUpperCase(), name = $("#ss-name").value.trim(), sub = $("#ss-subj").value, g = +$("#ss-grade").value, p1 = $("#ss-pass").value;
    const goals = [...document.querySelectorAll('input[name=sgoal]:checked')].map(x => x.value);
    if (name.split(/\s+/).length < 2) return say("Напиши имя и фамилию.");
    if (!goals.length) return say("Отметь хотя бы одну цель.");
    if (p1.length < 6) return say("Пароль – не меньше 6 знаков.");
    if (p1 !== $("#ss-pass2").value) return say("Пароли не совпадают.");
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Регистрирую…";
    try{
      const {data, error} = await sb.rpc("student_signup", {p_teacher_code: code, p_name: name, p_subject: sub, p_grade: g, p_goals: goals, p_contact: $("#ss-contact").value.trim(), p_password: p1, p_course: U.planFor(sub, g, goals), p_theme: null});
      if (error) throw error;
      S.token = data.token; S.profile = data.profile; saveSession(); await load();
      S.invite = "self"; S.regDone = {login: S.profile.login}; S.mode = "in"; S.authMsg = null; history.replaceState(null, "", location.pathname); render();
      setTimeout(() => liveAct("зарегистрировался"), 1500);
    }catch(er){
      btn.textContent = "Зарегистрироваться";
      const m = er.message || "";
      say(/code not found/.test(m) ? "Такого кода учителя нет. Проверь код." : /inactive/.test(m) ? "У учителя сейчас не оплачен кабинет – напиши ему." : U.authErr(er));
    }
    return;
  }
  if (e.target.id === "forgot-form"){
    const email = $("#fg-email").value.trim(); S.lastEmail = email;
    if (!sb) return say("Сервер ещё не подключён.");
    try{ const {error} = await sb.auth.resetPasswordForEmail(email, {redirectTo: U.siteURL("teacher.html")}); if (error) throw error; say("Письмо отправлено. Откройте его и нажмите ссылку – там зададите новый пароль.", true); }
    catch(er){ say(U.authErr(er)); }
    return;
  }
  if (e.target.id === "teacher-form"){
    const email = $("#tl-email").value.trim(); S.lastEmail = email;
    if (!sb){ location.href = "teacher.html"; return; }
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Вхожу…";
    try{ const {error} = await sb.auth.signInWithPassword({email, password: $("#tl-pass").value}); if (error) throw error; location.href = "teacher.html"; }
    catch(er){ btn.textContent = "Войти в кабинет учителя"; say(U.authErr(er), false, /not confirmed/i.test(er.message || "") ? {resend: true} : null); }
    return;
  }
  if (e.target.id === "login-form"){
    const btn = e.target.querySelector("button"); btn.disabled = true;
    if (sb){
      const {data} = await sb.rpc("student_login", {p_login: $("#l-login").value, p_password: $("#l-pass").value});
      btn.disabled = false;
      if (!data){ say("Логин или пароль не подходят."); return; }
      S.token = data.token; S.profile = data.profile;
    } else {
      btn.disabled = false;
      const g = +$("#l-grade").value, goals = g === 9 ? ["ОГЭ"] : g >= 10 ? ["ЕГЭ"] : ["Контрольные и домашние"];
      S.token = "local"; S.profile = {id:"local", name:$("#l-login").value.trim(), grade:g, goals, goal:goals.join(", "), course: U.planFor(g, goals), start_date: U.iso(new Date()), dates:{}, unlocked:[]};
    }
    saveSession(); await load(); S.view = "home"; render();
    if (S.quizToken) await openDeepQuiz();   // пришли по ссылке на тест – открываем после входа
  }
  if (e.target.id === "reg-form"){
    const err = $("#r-err"), show = t => { err.textContent = t; err.hidden = false; };
    const name = $("#r-name").value.trim(), g = +$("#r-grade").value, p1 = $("#r-pass").value, p2 = $("#r-pass2").value;
    const goals = S.inviteInfo?.goals?.length ? S.inviteInfo.goals : [...document.querySelectorAll('input[name=goal]:checked')].map(x => x.value);
    if (!goals.length) return show("Отметь хотя бы одну цель.");
    if (name.split(/\s+/).length < 2) return show("Напиши имя и фамилию.");
    if (p1.length < 6) return show("Пароль – не меньше 6 символов.");
    if (p1 !== p2) return show("Пароли не совпадают.");
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
    if (sb){
      const {data, error} = await sb.rpc("student_register", {p_invite:S.invite, p_name:name, p_grade:g, p_goals:goals, p_contact:$("#r-contact").value.trim(), p_password:p1, p_course:S.inviteInfo?.course || U.planFor(S.inviteInfo?.subject || "rus", g, goals), p_theme:S.regTheme});
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
document.addEventListener("change", async e => {
  if (e.target.id === "self-l"){ S.selfL = e.target.value; render(); return; }
  if (e.target.id === "ss-subj"){
    const sub = U.subj(e.target.value); S.sSubj = sub.k;
    const g0 = sub.g.includes(9) ? 9 : sub.g[0];
    $("#ss-grade").innerHTML = sub.g.map(g => `<option value="${g}" ${g === g0 ? "selected" : ""}>${U.gradeName(g)}</option>`).join("");
    e.target.closest("form").querySelector(".goals").innerHTML = U.goalsHTML(sub.k, g0, "sgoal");
  }
  if (e.target.id === "ss-grade") e.target.closest("form").querySelector(".goals").innerHTML = U.goalsHTML($("#ss-subj").value, e.target.value, "sgoal");
  if (e.target.id === "r-grade" && $("#r-goals")) $("#r-goals").innerHTML = U.goalsHTML(S.inviteInfo?.subject || "rus", e.target.value, "goal");
  if (e.target.id === "ss-code" && sb && e.target.value.trim().length >= 6){
    const {data} = await sb.rpc("teacher_by_code", {p_code: e.target.value}); S.tcode = e.target.value.trim().toUpperCase();
    const hint = e.target.nextElementSibling; if (hint) hint.innerHTML = data ? `Учитель: <b>${esc(data.name)}</b>` : `<span style="color:var(--bad)">Такого кода нет – проверь.</span>`;
  }
});
document.addEventListener("input", e => {
  if (e.target.id === "izl-draft"){ try{ localStorage.setItem("izl-draft-" + e.target.dataset.lesson, e.target.value); }catch(_){} saveDraft(e.target.dataset.lesson, 901, e.target.value); return; }
  if (e.target.id !== "essay") return;
  try{ localStorage.setItem("oge-draft-" + e.target.dataset.lesson, e.target.value); }catch(_){}
  saveDraft(e.target.dataset.lesson, 900, e.target.value);
  const l = U.findLesson(S.course, e.target.dataset.lesson), minW = ["thesis","example"].includes(l.writing.type) ? 0 : 70, n = U.wordCount(e.target.value);
  const wc = $("#wc"); wc.textContent = `${n} сл.${minW ? ` / нужно не меньше ${minW}` : ""}`; wc.className = "chip tnum " + (minW && n < minW ? "bad" : n ? "good" : "");
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && S.drawer){ S.drawer = false; render(); } });
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-lab],[data-oge-rate],[data-oge-drill],[data-oge-mock],[data-play-game],[data-play-theme],[data-quiz],[data-qopt],[data-qretry],[data-qnext],[data-qagain],[data-go],[data-open],[data-test],[data-pick],[data-act],[data-sub],[data-etype],[data-theme-pick],[data-mascot-pick],[data-role],[data-switch],[data-authmode]"); if (!t) return;
  if (t?.dataset.lab){ e.preventDefault(); S.labPick = t.dataset.lab; LS.set("labPick", S.labPick); render(); return; }
  if (t.dataset.ogeRate || t.dataset.ogeDrill != null || t.dataset.ogeMock != null){ e.preventDefault(); ogeAct(t); return; }
  if (t.dataset.role){ S.role = t.dataset.role; S.mode = "in"; S.authMsg = null; S.signupDone = null; render(); return; }
  if (t.dataset.authmode){ if (t.dataset.authmode !== "signup") S.signupDone = null; S.mode = t.dataset.authmode; S.authMsg = null; render(); return; }
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
  if (t.dataset.playGame){ playGame(t.dataset.playGame, t.dataset.g); return; }
  if (t.dataset.playTheme){ const th = (PLAY_BANKS.themes || []).find(x => x.id === t.dataset.playTheme); if (th){ Play.onDone = selfDone("theme-" + th.id, ""); Play.chooseGame(th); } return; }
  if (t.dataset.act && t.dataset.act.startsWith("self-")){ selfAct(t.dataset.act, t); return; }
  /* тесты по темам: ссылка/список → прохождение → объяснение → повтор → итог */
  if (t.dataset.quiz){ openQuiz(t.dataset.quiz); return; }
  if (t.dataset.qopt != null && S.qz){ quizPick(+t.dataset.qopt); return; }
  if (t.dataset.qretry !== undefined){ quizRetry(); return; }
  if (t.dataset.qnext !== undefined){ quizNext(); return; }
  if (t.dataset.qagain !== undefined){ quizRestart(); return; }
  if (t.dataset.go){
    if (S.regDone){ S.invite = null; S.regDone = null; }
    if (t.dataset.go === "quizzes"){ openQuizzes(); return; }
    if (S.quizToken){ openDeepQuiz(); return; }   // токен из ссылки ждал окончания регистрации
    S.view = t.dataset.go; S.drawer = false; render(); scrollTo(0,0); return;
  }
  if (t.dataset.open){
    const l = S.course.lessons.find(x => x.id === t.dataset.open);
    if (!isOpen(l)){ toast(`Папка откроется в день урока – ${fmt(l.date,{day:"numeric",month:"long"})}.`); return; }
    S.open = l.id; S.sub = t.dataset.sub || "theory"; S.view = "folder"; S.drawer = false; render(); scrollTo(0,0); return;
  }
  if (t.dataset.sub){ if (S.view === "room" && S.test && S.testInRoom){ if (S.test.i < S.test.qs.length) testLive({quit: true}); S.test = null; S.testInRoom = false; }
    S.sub = t.dataset.sub; try { LS.set("seen:" + S.open + ":" + S.sub, 1); } catch (e) { } if (S.view === "room") liveTrack(); if (t.dataset.bpage) S.boardPage = t.dataset.bpage; render(); if (t.dataset.bpage) document.querySelector(".window .tabs")?.scrollIntoView({behavior:"smooth"}); return; }
  if (t.dataset.etype){ LS.set("etype", t.dataset.etype); render(); return; }
  if (t.dataset.test){ startTest(t.dataset.test, t.dataset.kind || "lesson"); return; }
  if (t.dataset.pick && S.test.picked == null){
    const T = S.test, q = T.qs[T.i], k = +t.dataset.pick;
    T.picked = k; (T.marks = T.marks || [])[T.i] = k === q.a; logAns(q, q.o[k], q.o[q.a], k === q.a); if (k === q.a) T.score++; else T.wrong.push(q.tag); testLive(); render(); return;
  }
  const a = t.dataset.act;
  if (a === "install"){ install(); return; }
  if (a === "avatar-pick"){ pickAvatar(); return; }
  if (a === "avatar-del"){ if (await saveProfile(undefined, "")) render(); return; }
  if (a === "profile-save"){ if (await saveProfile($("#pf-school").value.trim())){ toast("Профиль сохранён"); render(); } return; }
  if (a === "join"){ if (t.tagName !== "A") e.preventDefault(); const how = t.dataset.how; if ($("#jb-remember")?.checked) LS.set("join-how", how); else LS.set("join-how", null); applyJoin(how, false); return; }
  if (a === "join-close"){ closeJoin(); render(); return; }
  if (a === "join-open"){ joinBox(S.room?.self); return; }
  if (a === "join-reset"){ LS.set("join-how", null); joinBox(S.room?.self); return; }
  if (a === "call-start"){ S.joinHow = S.joinHow === "board" ? "both" : (S.joinHow || "both"); startCall(); render(); return; }
  if (a === "test-close"){ if (S.test && S.test.i < S.test.qs.length) testLive({quit: true}); S.test = null; S.testInRoom = false; render(); liveTrack(); return; }
  if (a === "room-leave"){ S.test = null; S.testInRoom = false; S.view = S.room?.lesson && S.room.lesson !== "free" ? "folder" : "home"; if (S.view === "folder") S.open = S.room.lesson; render(); return; }
  if (a === "start-today"){
    const id = t.dataset.l, how = LS.get("join-how", null); S.forced.add(id);
    invite({lesson: id, url: S.profile.call_url || "", at: Date.now()}, true);
    if (document.getElementById("joinbox")) applyJoin(how && JOIN[how] ? how : "both", false);
    return;
  }
  if (a === "start-room"){ invite({lesson: S.open, url: S.profile.call_url || "", at: Date.now()}, true); return; }
  if (a === "resend"){
    const email = S.signupDone || S.lastEmail || $("#tl-email")?.value.trim(); if (!email || !sb) return;
    const {error} = await sb.auth.resend({type: "signup", email, options: {emailRedirectTo: U.siteURL("teacher.html")}});
    S.authMsg = error ? {t: U.authErr(error)} : {t: "Письмо отправлено ещё раз.", ok: true}; render(); return;
  }
  if (a === "open-drawer"){ S.drawer = true; render(); }
  if (a === "close-drawer"){ S.drawer = false; render(); }
  if (a === "start-entry" || a === "retry-entry") startTest(null, "entry");
  if (a === "to-login"){ S.invite = null; history.replaceState(null, "", location.pathname); render(); }
  if (a === "pn-answer"){
    const T = S.test, q = T.qs[T.i], sel = U.pnSel(document.querySelector(".test-pn .pn")), ok = U.pnOk(q.pn, sel);
    T.pnSel = sel; T.typed = U.pnText(q.pn, sel); T.picked = ok ? 1 : 0; (T.marks = T.marks || [])[T.i] = ok; logAns(q, T.typed, U.pnText(q.pn, q.pn.a), ok); if (ok) T.score++; else T.wrong.push(q.tag || "запятые");
    testLive({ok, sel}); render(); return;
  }
  if (a === "next-q"){
    const T = S.test; T.i++; T.picked = null; T.typed = "";
    testLive(T.i >= T.qs.length ? {done: true} : {});
    if (T.i >= T.qs.length){
      await sendResult(T.id, T.kind, T.score, T.qs.length, T.wrong, Math.round((Date.now() - T.t0) / 1000), T.kind === "entry" ? null : (T.log || []));
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
  if (a === "photo"){ uploadPhoto($("#essay")?.dataset.lesson || S.open); return; }
  if (a === "izl-pause"){ const box = t.closest(".izl-player"), stl = box?.querySelector(".izl-st"); let left = 300; clearInterval(S.izlT);
    S.izlT = setInterval(() => { if (!stl?.isConnected || left < 0){ clearInterval(S.izlT); if (stl?.isConnected) stl.textContent = "Пауза закончилась – слушаем второй раз."; return; } stl.textContent = `Пауза ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} – план и ключевые слова`; left--; }, 1000); return; }
  if (a === "send-hw"){ await sendHw(S.open, $("#hw-note").value.trim()); render(); }
  if (a === "send-writing"){
    const l = U.findLesson(S.course, $("#essay")?.dataset.lesson || S.open), body = $("#essay").value.trim(), n = U.wordCount(body);
    const minW = ["thesis","example"].includes(l.writing.type) ? 0 : 70;
    const hasPhoto = (S.photos[l.id] || []).length;
    if (!body && !hasPhoto){ toast("Напиши текст или прикрепи фото работы."); return; }
    if (minW && n < minW && !hasPhoto && !t.dataset.sure){ t.dataset.sure = "1"; t.textContent = `Всего ${n} слов. Всё равно отправить?`; return; }
    await sendWriting(l, t.dataset.kind, body); render();
  }
  if (a === "logout") logout();
});

/* прослушивания текста изложения – учитель видит, сколько раз слушали */
document.addEventListener("ended", e => { const id = e.target?.dataset?.listen; if (id){ sendResult(id + ":l", "self", 1, 1, []); render(); } }, true);
document.addEventListener("izl-listened", e => { const id = e.detail?.key; if (id && /^izl:|^oge-/.test(id)){ sendResult(id + ":l", "self", 1, 1, []); } });

/* ---------- запуск ---------- */
(async () => {
  const qp = new URLSearchParams(location.search);
  const invite = qp.get("invite");
  if (qp.get("role")) S.role = qp.get("role");
  if (S.role === "signup"){ S.role = "teacher"; S.mode = "signup"; }
  if (qp.get("t")){ S.role = "student"; S.mode = "signup"; S.tcode = qp.get("t").toUpperCase(); }
  if (qp.get("msg")) S.authMsg = {t: qp.get("msg")};
  if (qp.get("quiz")) S.quizToken = qp.get("quiz").trim();   // ссылка учителя на тест по темам
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
    /* после перезагрузки – на тот же экран и ту же вкладку урока */
    try { const rt = JSON.parse(sessionStorage.getItem("s-route") || "null");
      if (rt && ["home","lessons","self","oge","myboard","stats","plan","look","folder","room","test","quizzes"].includes(rt.view)){
        S.view = rt.view === "room" || rt.view === "test" ? (rt.open ? "folder" : "home") : rt.view; S.open = rt.open || null; if (rt.sub) S.sub = rt.sub === "board" && rt.view !== "room" ? "theory" : rt.sub; S.routeY = rt.y || 0; }
    } catch(_) {}
    const c = LS.get("cache", null);
    if (c && sb){ S.rows = c.rows || []; S.hw = c.hw || {}; S.sheets = c.sheets || {}; S.writings = c.writings || {}; S.mats = c.mats || []; U.loadBase(c.base); recompute(); }
    render(); await load();
    /* ссылка ?quiz= или восстановленный раздел «Тесты» – открываем после загрузки профиля */
    if (S.quizToken) await openDeepQuiz();
    else if (S.view === "quizzes") await openQuizzes();
  }
  render();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
window.__app = {S, render, openQuiz, openQuizzes, loadQuizzes};   // для отладки и автотестов
})();
