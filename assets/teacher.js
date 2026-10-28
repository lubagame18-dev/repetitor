/* Кабинет учителя */
(() => {
const {esc, d, today, fmt, fmtShort, pct, lvl, lvlColor, toast} = U;
const CFG = window.APP_CONFIG || {};
const sb = U.supa();
const T = {session:null, view:"students", sel:null, open:null, sub:"method", review:null, wreview:null, students:[], rows:[], hw:[], writings:[], sheets:[], loading:false, confirmDel:null, courseId:null, board:null, boardLesson:null};
const $ = s => document.querySelector(s);
const course = id => COURSES[id] || COURSES[CFG.DEFAULT_COURSE || "oge-rus"];
const studentLink = s => `${location.origin}${location.pathname.replace(/teacher\.html$/, "")}?code=${s.code}`;

async function loadAll(){
  if (!sb || !T.session) return;
  T.loading = true; render();
  const [st, rs, hw, wr, sh] = await Promise.all([
    sb.from("students").select("*").order("created_at"),
    sb.from("results").select("*").order("created_at"),
    sb.from("homework").select("*"),
    sb.from("writings").select("*"),
    sb.from("sheets").select("*")
  ]);
  const err = st.error || rs.error || hw.error || wr.error || sh.error;
  if (err) toast("Ошибка загрузки: " + err.message + ". Возможно, нужно заново выполнить schema.sql.");
  T.students = st.data || []; T.rows = rs.data || []; T.hw = hw.data || []; T.writings = wr.data || []; T.sheets = sh.data || [];
  T.loading = false; render();
}
function sData(s){
  const rows = T.rows.filter(r => r.student_id === s.id);
  const results = U.aggregate(rows, "lesson"), hwres = U.aggregate(rows, "hw");
  const hw = Object.fromEntries(T.hw.filter(h => h.student_id === s.id).map(h => [h.lesson_id, h]));
  const writings = Object.fromEntries(T.writings.filter(h => h.student_id === s.id).map(h => [h.lesson_id, h]));
  const c = course(s.course);
  const last = [...rows.map(r => r.created_at), ...Object.values(writings).map(w => w.submitted_at)].filter(Boolean).sort().at(-1);
  return {results, hwres, hw, writings, c, last,
    waiting: Object.values(hw).filter(h => h.status === "sent").length,
    wWaiting: Object.values(writings).filter(w => w.status === "sent").length};
}
const sheetFor = (c, lid) => T.sheets.find(x => x.course === c && x.lesson_id === lid) || {};

/* ---------- экраны ---------- */
function viewNoServer(){
  return `<div class="card stack"><h2>Сервер ещё не подключён</h2>
    <p>Кабинет учителя работает через Supabase: там хранятся ученики, их тесты, сочинения, домашки и доска. Откройте файл <b>config.js</b> и вставьте адрес проекта и ключ <b>anon</b> – пошагово это описано в README.</p>
    <p class="muted small">Пока можно смотреть материалы курса, методику и ключи: вкладки «Курс» и «Методика».</p>
    <div class="row"><button class="btn" data-view="course">Материалы курса</button><button class="btn ghost" data-view="methodology">Методика курса</button></div></div>`;
}
function viewLogin(){
  return `<form class="card login stack" id="t-login">
    <h2>Вход для учителя</h2>
    <label for="t-email">Почта</label><input type="email" id="t-email" autocomplete="username" required>
    <label for="t-pass">Пароль</label><input type="password" id="t-pass" autocomplete="current-password" required>
    <button class="btn" type="submit">Войти</button>
    <p class="small" id="t-err" hidden style="color:var(--bad)"></p>
    <p class="small muted">Учётную запись учителя создают в Supabase: Authentication → Users → Add user.</p>
  </form>`;
}

function viewStudents(){
  const courses = Object.entries(COURSES);
  const waitHw = T.hw.filter(h => h.status === "sent"), waitW = T.writings.filter(w => w.status === "sent");
  const nameOf = id => T.students.find(x => x.id === id);
  return `<div class="section-title" style="margin-top:4px"><h1 style="font-size:1.4rem">Ученики</h1>
    <button class="btn ghost sm" data-act="reload">Обновить</button></div>
  ${T.loading ? `<p class="muted">Загружаю…</p>` : ""}
  <div class="grid2">${T.students.map(s => { const x = sData(s), avg = U.avgAll(x.c, x.results), avgHw = U.avgAll(x.c, x.hwres), ws = U.writingStats(x.c, x.writings);
    const ess = ws.essays.length ? Math.round(ws.essays.reduce((a,y) => a + y.w.total/y.w.max*100, 0)/ws.essays.length) : null;
    return `<button class="card" data-student="${s.id}" style="text-align:left;color:inherit">
      <div class="row between"><h2>${esc(s.name)}</h2>${x.waiting + x.wWaiting ? `<span class="chip mid">на проверку: ${x.waiting + x.wWaiting}</span>` : ""}</div>
      <p class="small muted" style="margin-top:4px">${esc(x.c.course)} · код ${esc(s.code)}</p>
      <div class="row" style="margin-top:10px;gap:18px">
        <div><div class="big tnum" style="color:${avg!=null?lvlColor(avg):"inherit"}">${avg ?? "–"}${avg!=null?"%":""}</div><div class="small muted">занятия</div></div>
        <div><div class="big tnum" style="color:${avgHw!=null?lvlColor(avgHw):"inherit"}">${avgHw ?? "–"}${avgHw!=null?"%":""}</div><div class="small muted">ДЗ</div></div>
        <div><div class="big tnum" style="color:${ess!=null?lvlColor(ess):"inherit"}">${ess ?? "–"}${ess!=null?"%":""}</div><div class="small muted">сочинения</div></div>
      </div>
      <p class="small muted" style="margin-top:8px">${x.last ? "Последняя активность: " + new Date(x.last).toLocaleString("ru-RU",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}) : "Активности пока нет"}</p>
    </button>`; }).join("") || (T.loading ? "" : `<div class="card"><p class="muted">Учеников пока нет. Добавьте первого.</p></div>`)}</div>

  <div class="section-title"><h2>Ждут проверки</h2></div>
  <div class="card">${waitHw.length + waitW.length ? `<ul style="margin:0;padding-left:20px">
    ${waitW.map(w => { const s = nameOf(w.student_id), l = s && course(s.course).lessons.find(x => x.id === w.lesson_id);
      return s && l ? `<li><a href="#" data-student="${s.id}" data-wreview="${l.id}">${esc(s.name)} – ${esc(U.KIND_NAME[w.kind] || "письмо")}: ${esc(l.title)}</a> <span class="small muted">${w.words} сл., ${new Date(w.submitted_at).toLocaleDateString("ru-RU")}</span></li>` : ""; }).join("")}
    ${waitHw.map(h => { const s = nameOf(h.student_id), l = s && course(s.course).lessons.find(x => x.id === h.lesson_id);
      return s && l ? `<li><a href="#" data-student="${s.id}" data-review="${l.id}">${esc(s.name)} – ДЗ: ${esc(l.title)}</a> <span class="small muted">${new Date(h.sent_at).toLocaleDateString("ru-RU")}</span></li>` : ""; }).join("")}</ul>` : '<p class="muted">Всё проверено.</p>'}</div>

  <div class="section-title"><h2>Добавить ученика</h2></div>
  <form class="card stack" id="add-student" style="gap:8px">
    <label for="ns-name">Имя и фамилия</label><input type="text" id="ns-name" required placeholder="Например, Артём Иванов">
    <label for="ns-course">Курс</label>
    <select id="ns-course">${courses.map(([k,c]) => `<option value="${k}">${esc(c.course)}</option>`).join("")}</select>
    <label for="ns-note">Заметка (класс, контакт родителя)</label><input type="text" id="ns-note">
    <div><button class="btn" type="submit">Добавить и получить код</button></div>
  </form>`;
}

function writingReviewHTML(s, x, l){
  const w = x.writings[l.id], c = x.c;
  if (!w) return `<p class="muted small">Ученик ещё не прислал работу.</p>`;
  const src = U.writingSource(c, l, w.kind);
  const crit = U.critFor(c, w.kind);
  return `<div class="stack" style="gap:10px;margin-top:8px">
    <p class="small"><b>${esc(U.KIND_NAME[w.kind] || w.kind)}</b> · текст «${esc(src.title)}» · ${w.words} сл. · ${new Date(w.submitted_at).toLocaleString("ru-RU",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</p>
    <p class="small"><b>Тема:</b> ${esc(src.topic)}</p>
    <details class="small"><summary>Исходный текст</summary><div class="ttext" style="margin-top:6px">${src.html}</div></details>
    <div class="ttext" style="white-space:pre-wrap;background:var(--bg);border:1px solid var(--line)">${esc(w.body)}</div>
    ${crit ? `<div class="crit">${crit.map(([k,n,m]) => `<label for="sc-${k}">${k} – ${esc(n)}</label><select id="sc-${k}" data-crit="${k}">${Array.from({length:m+1},(_,i) => `<option ${(w.scores?.[k] ?? -1) === i ? "selected" : ""}>${i}</option>`).join("")}</select>`).join("")}</div>` : ""}
    <div class="crit">${c.criteria.errors.map(([k,n]) => `<label for="er-${k}">Ошибки: ${esc(n)}</label><input type="text" inputmode="numeric" id="er-${k}" data-err="${k}" style="width:70px" value="${esc(w.errors?.[k] ?? "")}">`).join("")}</div>
    <label for="w-comment">Комментарий ученику</label><textarea id="w-comment">${esc(w.comment || "")}</textarea>
    <div class="row"><button class="btn sm" data-act="wsave" data-st="reviewed">Сохранить оценку</button><button class="btn ghost sm" data-act="wsave" data-st="redo">Вернуть на доработку</button></div>
  </div>`;
}

function viewStudent(){
  const s = T.students.find(x => x.id === T.sel); if (!s) return viewStudents();
  const x = sData(s), c = x.c;
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
  <div class="section-title"><h2>Карта успеха</h2></div>
  ${window.mapHTML(c, x.results, x.hwres, x.writings)}
  <div class="section-title"><h2>Занятия</h2></div>
  <div class="tablewrap"><table style="min-width:860px"><thead><tr><th>№</th><th>Дата</th><th>Тема</th><th>Тест</th><th>ДЗ-тест</th><th>Письмо</th><th>ДЗ</th><th></th></tr></thead><tbody>
  ${c.lessons.map((l,i) => { const r = x.results[l.id], hr = x.hwres[l.id], h = x.hw[l.id], w = x.writings[l.id], hs = U.hwState(c, l.id, x.hw);
    const wcell = !w ? "–" : w.status === "sent" ? `<span class="chip mid">ждёт</span>` : w.max ? `<span class="chip ${lvl(Math.round(w.total/w.max*100))}">${w.total}/${w.max}</span>` : `<span class="chip">${w.status === "redo" ? "доработка" : "проверено"}</span>`;
    return `<tr><td class="tnum">${i+1}</td><td class="tnum">${fmtShort(l.date)}</td><td><i class="dot" style="background:${c.blocks[l.block].color}"></i> ${esc(l.title)}<div class="small muted">${esc(U.KIND_NAME[l.writing.type])}</div></td>
      <td class="tnum">${r ? `<span class="chip ${lvl(pct(r.last))}">${pct(r.last)}%</span><div class="small muted">лучш. ${pct(r.best)}% · ${r.attempts}</div>` : "–"}</td>
      <td class="tnum">${hr ? `<span class="chip ${lvl(pct(hr.last))}">${pct(hr.last)}%</span><div class="small muted">${hr.attempts} поп.</div>` : "–"}</td>
      <td>${wcell}<div style="margin-top:4px">${w ? `<button class="btn ghost sm" data-wreview="${l.id}">Проверить</button>` : ""}</div></td>
      <td><span class="chip ${hs.c}">${hs.t}</span>${h?.note?`<div class="small" style="margin-top:4px">${/^https?:/.test(h.note)?`<a href="${esc(h.note)}" target="_blank" rel="noopener">ссылка ученика</a>`:esc(h.note)}</div>`:""}
        <div style="margin-top:4px"><button class="btn ghost sm" data-review="${l.id}">Оценить ДЗ</button></div></td>
      <td><button class="btn yellow sm" data-boardfor="${l.id}">Доска</button></td></tr>
      ${T.review === l.id ? `<tr><td colspan="8"><div class="stack" style="gap:6px;max-width:520px">
          <b>ДЗ: ${esc(l.title)}</b><p class="small">${esc(l.hw)}</p>
          ${r || hr ? `<p class="small muted">${hr ? "ДЗ-тест: " + esc(U.recText(hr.last)) : ""}</p>` : ""}
          <input type="text" id="rv-grade" placeholder="Оценка" value="${esc(h?.grade||"")}">
          <textarea id="rv-comment" placeholder="Комментарий ученику">${esc(h?.comment||"")}</textarea>
          <div class="row"><button class="btn sm" data-act="review" data-st="accepted">Принять</button><button class="btn ghost sm" data-act="review" data-st="redo">На доработку</button></div></div></td></tr>` : ""}
      ${T.wreview === l.id ? `<tr><td colspan="8"><div style="max-width:720px">${writingReviewHTML(s, x, l)}</div></td></tr>` : ""}`; }).join("")}
  </tbody></table></div>
  <div class="section-title"><h2>Управление</h2></div>
  <div class="card row">
    <button class="btn ghost sm" data-act="new-code">Выдать новый код</button>
    <button class="btn ${T.confirmDel===s.id?"danger":"ghost"} sm" data-act="del-student">${T.confirmDel===s.id?"Нажмите ещё раз, чтобы удалить навсегда":"Удалить ученика"}</button>
  </div>`;
}

function viewBoard(){
  const s = T.students.find(x => x.id === T.sel), c = course(s.course), l = c.lessons.find(x => x.id === T.boardLesson);
  return `<div class="topbar"><button class="btn ghost sm" data-student="${s.id}">← ${esc(s.name)}</button>
    <span class="small muted">Отправьте ученику: открыть папку № ${c.lessons.indexOf(l)+1} → «Доска»</span></div>
  <div class="open-head" style="--c:${c.blocks[l.block].color}"><span class="tag">Доска · ${esc(s.name)}</span><h1>${esc(l.title)}</h1></div>
  <div class="board" id="board" style="margin-top:14px"></div>
  <p class="small muted" style="margin-top:8px">Когда вы переключаете лист, у ученика он переключается тоже. «Очистить» стирает лист у обоих.</p>`;
}

function viewMethodology(){
  const c = course(T.courseId || Object.keys(COURSES)[0]);
  return `<div class="section-title" style="margin-top:4px"><h1 style="font-size:1.4rem">Методика курса</h1></div>
  <div class="stack">${(c.methodology || []).map(m => `<div class="sheet"><span class="tag label">${esc(m.h)}</span>${m.t ? `<p>${U.mark(m.t)}</p>` : ""}${m.list ? `<ul>${m.list.map(x => `<li>${U.mark(x)}</li>`).join("")}</ul>` : ""}${m.table ? `<div class="tablewrap"><table><thead><tr>${m.table[0].map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${m.table.slice(1).map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}</div>`).join("")}</div>`;
}

function viewCourse(){
  const cid = T.courseId || Object.keys(COURSES)[0], c = course(cid);
  return `<div class="section-title" style="margin-top:4px"><h1 style="font-size:1.4rem">Материалы курса</h1>
    <select id="course-pick" style="width:auto">${Object.entries(COURSES).map(([k,x]) => `<option value="${k}" ${k===cid?"selected":""}>${esc(x.course)}</option>`).join("")}</select></div>
  <p class="muted small">Методика занятия, теория, практика с ключами, оба теста с ответами, письменная линия и рабочий лист.</p>
  <div class="tablewrap" style="margin-top:12px"><table style="min-width:640px"><thead><tr><th>№</th><th>Дата</th><th>Задание</th><th>Тема</th><th>Письмо</th><th>Лист</th></tr></thead><tbody>
  ${c.lessons.map((l,i) => `<tr><td class="tnum">${i+1}</td><td class="tnum">${fmtShort(l.date)}</td><td>${esc(l.oge)}</td><td><a href="#" data-lesson="${l.id}"><i class="dot" style="background:${c.blocks[l.block].color}"></i> ${esc(l.title)}</a></td><td class="small">${esc(U.KIND_NAME[l.writing.type])}</td><td>${sheetFor(cid, l.id).url ? "✓" : "–"}</td></tr>`).join("")}
  </tbody></table></div>`;
}

function methodPlan(l){
  const w = l.writing;
  return [["0–5", "Проверка ДЗ", "Ошибки ДЗ-теста и письменной работы (в кабинете ученика): 2–3 правила вслух."],
          ["5–7", "Устная минутка", "Чтение вслух одного абзаца текста письменной линии: паузы, ударения."],
          ["7–25", "Новая тема", l.learn.join("; ") + "."],
          ["25–40", "Практика на доске", "Задания раздела «Практика»: ученик работает на общей доске, учитель видит его курсор и правит сразу."],
          ["40–55", "Письменная линия", w.classwork],
          ["55–60", "Тест и ДЗ", "Тест по занятию в приложении; объяснить ДЗ, письмо и ДЗ-тест."]];
}
function viewLesson(){
  const cid = T.courseId || Object.keys(COURSES)[0], c = course(cid), l = c.lessons.find(x => x.id === T.open), i = c.lessons.indexOf(l), b = c.blocks[l.block];
  const keys = (window.COURSE_KEYS?.[cid] || {})[l.id] || [];
  const lk = {...l, practice: l.practice.map((p,k) => ({...p, key: keys[k]}))};
  const sh = sheetFor(cid, l.id);
  const tabs = [["method","Методика"],["theory","Теория"],["practice","Практика и ключи"],["writing","Письмо"],["test","Тест"],["hwtest","ДЗ-тест"],["sheet","Рабочий лист и ДЗ"]];
  const testList = qs => `<ol style="padding-left:20px">${qs.map(q => `<li style="margin-bottom:12px"><b>${esc(q.q)}</b><ul>${q.o.map((o,k) => `<li ${k===q.a?'style="color:var(--good);font-weight:800"':""}>${esc(o)}${k===q.a?" ✓":""}</li>`).join("")}</ul><p class="small muted">Правило: ${esc(q.tag)}. ${esc(q.e)}</p></li>`).join("")}</ol>`;
  let body = "";
  if (T.sub === "method"){
    const plan = methodPlan(l);
    body = `<p><b>Главное:</b> ${esc(l.method.focus)}</p>
      <div class="tablewrap method"><table><thead><tr><th>Минуты</th><th>Этап</th><th>Что делаем</th></tr></thead><tbody>${plan.map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <p class="small muted" style="margin-top:6px">Расчёт на 60 минут. Если занятие 45 минут – сократите новую тему и практику на 7–8 минут каждую, письменную линию не сокращайте.</p>
      <h3 style="margin-top:14px">Методические советы</h3><ul>${l.method.tips.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`;
  }
  if (T.sub === "theory") body = U.theoryHTML(l);
  if (T.sub === "practice") body = U.practiceHTML(lk, true);
  if (T.sub === "writing"){
    const w = l.writing, kinds = w.type === "choice" ? ["13.1","13.2","13.3"] : [w.type === "izl" ? "izl" : (["thesis","example"].includes(w.type) ? "13.3" : w.type)];
    body = `<div class="theory">${U.stepHTML(w.step)}</div>
      <p style="margin-top:12px"><b>На занятии:</b> ${esc(w.classwork)}</p><p><b>Домашнее письмо:</b> ${esc(w.task)}</p>
      ${kinds.map(k => { const src = U.writingSource(c, l, k); return `<p style="margin-top:10px"><b>Тема${kinds.length>1?" "+k:""}:</b> ${esc(src.topic)}</p>`; }).join("")}
      ${w.type === "izl" ? `<p class="small"><b>Микротемы (ключ):</b></p><ol class="small">${c.izl[w.text].micro.map(m => `<li>${esc(m)}</li>`).join("")}</ol>` : ""}
      <details style="margin-top:8px"><summary><b>Текст</b></summary><div class="ttext" style="margin-top:6px">${U.writingSource(c, l, kinds[0]).html}</div></details>`;
  }
  if (T.sub === "test") body = testList(l.test);
  if (T.sub === "hwtest") body = testList(l.hwtest);
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
  <div class="tabs-inner">${tabs.map(([k,n]) => `<button data-sub="${k}" aria-pressed="${T.sub===k}">${n}</button>`).join("")}</div>
  <div class="sheet" style="margin-top:20px">${body}</div>`;
}

function render(){
  if (T.board){ T.board.destroy(); T.board = null; }
  const logged = !!(sb && T.session);
  $("#t-nav").innerHTML = `<button class="btn ${["students","student","board"].includes(T.view)?"":"ghost"} sm" data-view="students">Ученики</button>
    <button class="btn ${["course","lesson"].includes(T.view)?"":"ghost"} sm" data-view="course">Курс</button>
    <button class="btn ${T.view==="methodology"?"":"ghost"} sm" data-view="methodology">Методика</button>
    ${logged ? `<button class="btn ghost sm" data-act="logout">Выйти</button>` : ""}`;
  let html;
  if (T.view === "methodology") html = viewMethodology();
  else if (["course","lesson"].includes(T.view)) html = T.view === "course" ? viewCourse() : viewLesson();
  else if (!sb) html = viewNoServer();
  else if (!T.session) html = viewLogin();
  else html = T.view === "student" ? viewStudent() : T.view === "board" ? viewBoard() : viewStudents();
  $("#app").innerHTML = html;
  if (T.view === "board" && sb && T.session){
    const s = T.students.find(x => x.id === T.sel), c = course(s.course), l = c.lessons.find(x => x.id === T.boardLesson);
    T.board = Board.mount($("#board"), {
      api: Board.api("teacher", sb, {studentId: s.id, lesson: l.id}),
      sb, channelName: `board-${s.id}-${l.id}`, role: "teacher", name: CFG.TEACHER_NAME || "Учитель", pages: Board.pages(c, l)
    });
  }
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
  const t = e.target.closest("[data-view],[data-student],[data-lesson],[data-sub],[data-review],[data-wreview],[data-boardfor],[data-act]"); if (!t) return;
  if (t.tagName === "A") e.preventDefault();
  if (t.dataset.view){ T.view = t.dataset.view; T.confirmDel = null; render(); scrollTo(0,0); return; }
  if (t.dataset.student){ T.sel = t.dataset.student; T.view = "student"; T.review = t.dataset.review || null; T.wreview = t.dataset.wreview || null; render(); if (!T.review && !T.wreview) scrollTo(0,0); return; }
  if (t.dataset.lesson){ T.open = t.dataset.lesson; T.view = "lesson"; T.sub = "method"; render(); scrollTo(0,0); return; }
  if (t.dataset.sub){ T.sub = t.dataset.sub; render(); return; }
  if (t.dataset.boardfor){ T.boardLesson = t.dataset.boardfor; T.view = "board"; render(); scrollTo(0,0); return; }
  if (t.dataset.review && !t.dataset.act){ T.review = T.review === t.dataset.review ? null : t.dataset.review; T.wreview = null; render(); return; }
  if (t.dataset.wreview && !t.dataset.act){ T.wreview = T.wreview === t.dataset.wreview ? null : t.dataset.wreview; T.review = null; render(); return; }
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
  if (a === "wsave"){
    const s = T.students.find(x => x.id === T.sel), c = course(s.course);
    const w = T.writings.find(x => x.student_id === T.sel && x.lesson_id === T.wreview);
    const crit = U.critFor(c, w.kind) || [];
    const scores = {}; crit.forEach(([k]) => scores[k] = +document.querySelector(`[data-crit="${k}"]`).value);
    const errors = {}; c.criteria.errors.forEach(([k]) => { const v = document.querySelector(`[data-err="${k}"]`).value.trim(); if (v !== "") errors[k] = +v || 0; });
    const upd = {status: t.dataset.st, scores, errors, comment: $("#w-comment").value.trim(), reviewed_at: new Date().toISOString(),
                 total: crit.length ? Object.values(scores).reduce((x,y) => x+y, 0) : null, max: crit.length ? crit.reduce((x,[,,m]) => x+m, 0) : null};
    const {error} = await sb.from("writings").update(upd).eq("student_id", T.sel).eq("lesson_id", T.wreview);
    if (error){ toast("Не сохранилось: " + error.message); return; }
    Object.assign(w, upd); T.wreview = null; render(); toast(upd.status === "redo" ? "Работа возвращена на доработку" : "Оценка сохранена – ученик её видит");
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
