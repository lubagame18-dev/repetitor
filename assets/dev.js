/* Кабинет разработчика: ключи нейросети, оформление сайта, учителя и доступ к встроенным базам */
(() => {
const {esc, toast} = U;
const CFG = window.APP_CONFIG || {};
const sb = U.supa();
const D = {bSubj:"rus", bCourse:null, bMats:null, bLessons:null, session:null, me:null, secrets:[], settings:{}, teachers:[], stats:null, test:null};
const $ = s => document.querySelector(s);
const PROV = [["deepseek","DeepSeek","platform.deepseek.com → API keys"],["aitunnel","AITUNNEL (оплата из России)","aitunnel.ru → ключ API"],["openrouter","OpenRouter","openrouter.ai → Keys"],["openai","OpenAI","platform.openai.com → API keys"]];

async function load(){
  const me = await sb.rpc("me");
  if (me.error){ D.err = /function|does not exist|schema/i.test(me.error.message) ? "База ещё не настроена: в Supabase → SQL Editor выполните файл supabase/schema.sql." : U.authErr(me.error); D.me = null; return render(); }
  D.me = me.data; D.err = null;
  if (D.me?.role !== "developer") return render();
  const bc = await sb.from("course_data").select("key", {count: "exact", head: true}); D.baseCount = bc.count || 0;
  const [sec, st, te, stats] = await Promise.all([sb.rpc("dev_list_secrets"), sb.from("app_settings").select("key,value"), sb.from("teachers").select("*").order("created_at"), sb.rpc("dev_stats")]);
  D.secrets = sec.data || []; D.settings = Object.fromEntries((st.data || []).map(r => [r.key, r.value])); D.teachers = te.data || []; D.stats = stats.data;
  render();
}
const tail = k => D.secrets.find(s => s.key === k)?.tail;

/* ---------- встроенная база: файлы, ссылки, тексты и уроки в любой предмет и класс ---------- */
const bCourse = () => D.bCourse && U.coursesOf(D.bSubj).includes(D.bCourse) ? D.bCourse : U.coursesOf(D.bSubj)[0];
async function loadBaseCourse(){
  const key = bCourse(); D.bLoading = key;
  const [m, c] = await Promise.all([sb.from("materials").select("*").eq("course", key).eq("shared", true).order("id"), sb.from("course_data").select("data").eq("key", key).maybeSingle()]);
  if (D.bLoading !== key) return;
  D.bMats = m.data || []; D.bLessons = c.data?.data?.lessons || []; D.bLoaded = key; D.bLoading = null; render();
}
function baseEditor(){
  const key = bCourse(), C = U.getCourse(key);
  if (D.bLoaded !== key){ if (D.bLoading !== key) loadBaseCourse(); }
  const own = (D.bMats || []).filter(m => m.kind === "lesson"), mats = (D.bMats || []).filter(m => m.kind !== "lesson");
  const lessons = [...(D.bLessons || []).map(l => [l.id, l.title]), ...own.map(m => [m.lesson_id, m.title + " (добавлен)"])];
  const lname = id => id === "_course" ? "ко всему курсу" : (lessons.find(x => x[0] === id) || [id, id])[1];
  return `<div class="card stack" style="gap:12px">
    <p class="small muted">Выберите предмет и класс – и добавляйте файлы (листы, презентации, PDF, картинки), ссылки, тексты и уроки. Они попадут во встроенную базу: их видят репетиторы с тарифом «С материалами» или «Полный» и их ученики этого класса.</p>
    <div class="subjects">${U.SUBJECTS.map(x => `<button class="subj" data-bsubj="${x.k}" aria-pressed="${D.bSubj === x.k}"><span class="emo">${x.e}</span><span>${esc(x.n)}<small>${x.g[0] === 0 ? "дошкольники" : x.g[0] + "–" + x.g.at(-1) + " кл."}</small></span></button>`).join("")}</div>
    <div class="filters" role="group" aria-label="Класс или курс">${U.coursesOf(D.bSubj).map(k => { const c = U.getCourse(k); return `<button data-bcourse="${k}" aria-pressed="${k === key}">${esc(c.tag && /класс|ОГЭ|ЕГЭ/.test(c.tag) ? c.tag.replace(" · ФРП", "") : c.course)}</button>`; }).join("")}</div>
    <h3>${esc(C?.course || key)}</h3>
    <p class="small muted">${D.bLoaded === key ? `Уроков в базе: ${(D.bLessons || []).length}${own.length ? ` + добавлено вами: ${own.length}` : ""} · материалов: ${mats.length}` : "Загружаю…"}</p>
    ${mats.length ? `<div>${mats.map(m => `<div class="mat"><span class="ic">${{link:"🔗",file:"📎",text:"📝",tasks:"✏️"}[m.kind] || "•"}</span><div style="flex:1;min-width:0"><b>${esc(m.title || m.url || "Материал")}</b>${m.url ? ` · <a href="${esc(m.url)}" target="_blank" rel="noopener">открыть</a>` : ""}<div class="small muted">${esc(lname(m.lesson_id))}</div></div><button class="btn ghost sm" data-bdel="${m.id}">Удалить</button></div>`).join("")}</div>` : ""}
    <form class="stack" id="base-add" style="gap:8px">
      <label for="ba-lesson">Куда</label><select id="ba-lesson"><option value="_course">Ко всему курсу (раздел «Материалы курса»)</option>${lessons.map(([id, t]) => `<option value="${esc(id)}">${esc(t)}</option>`).join("")}</select>
      <label for="ba-files">Файлы (можно сразу несколько)</label><input type="file" id="ba-files" multiple>
      <label for="ba-url">или ссылка</label><input type="url" id="ba-url" placeholder="https://…">
      <label for="ba-title">Название (для ссылки или текста; у файлов – имя файла)</label><input type="text" id="ba-title">
      <label for="ba-body">или текст / задание</label><textarea id="ba-body"></textarea>
      <div class="row"><button class="btn" type="submit">Добавить во встроенную базу</button><span class="small muted" id="ba-msg"></span></div>
    </form>
    <form class="row" id="base-lesson" style="gap:8px;align-items:flex-end"><div style="flex:1;min-width:200px"><label for="bl-title">Новый урок в этот класс</label><input type="text" id="bl-title" placeholder="Тема урока" required></div><button class="btn ghost" type="submit">Добавить урок</button></form>
  </div>`;
}

function view(){
  if (!sb) return `<div class="card"><h2>Сервер не подключён</h2><p>Заполните config.js – см. README.</p></div>`;
  const msg = D.msg ? `<p class="formmsg ${D.msg.ok ? "good" : "bad"}" role="status">${esc(D.msg.t)}</p>` : "";
  // шаг 1: вход в свой кабинет (почта и пароль) – как в «Учу по ФРП»
  if (!D.session) return `<form class="card login stack" id="d-quick" autocomplete="off"><h2>Режим разработчика</h2>
    <p class="small muted">Вход по коду – без регистрации.</p>
    <label for="d-qname">Как вас зовут</label><input type="text" id="d-qname" autocomplete="name" placeholder="Например: Анна Сергеевна">
    <label for="d-qcode">Код разработчика</label>${U.pass("d-qcode", 'required autocomplete="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true"')}
    <button class="btn" type="submit">Войти по коду</button>${D.quickMsg ? `<p class="formmsg bad" role="status">${esc(D.quickMsg)}</p>` : ""}</form>
  <form class="card login stack" id="d-login" style="margin-top:16px"><h3>Или войдите в свой кабинет</h3>
    <p class="small muted">Почта и пароль, потом код разработчика.</p>
    <label for="d-email">Почта</label><input type="email" id="d-email" required autocomplete="username" value="${esc(CFG.DEV_EMAIL || D.lastEmail || "")}">
    <label for="d-pass">Пароль от кабинета</label>${U.pass("d-pass", 'required autocomplete="current-password"')}
    <button class="btn" type="submit">Войти</button>${msg}
    <div class="row between"><a class="linkbtn" href="./?role=teacher">Забыли пароль?</a><a class="linkbtn" href="./?role=signup">Нет кабинета – зарегистрироваться</a></div></form>`;
  if (D.err) return `<div class="card login stack"><h2>Не получилось</h2><p class="formmsg bad">${esc(D.err)}</p><div class="row"><button class="btn" data-act="retry">Попробовать снова</button><button class="btn ghost" data-act="logout">Выйти</button></div></div>`;
  if (!D.me) return `<p class="muted">Загружаю…</p>`;
  // шаг 2: код разработчика (проверяет сервер, в коде сайта его нет)
  if (D.me.role !== "developer") return `<form class="card login stack" id="d-code" autocomplete="off"><h2>Режим разработчика</h2>
    <p class="small">Кабинет: <b>${esc(D.me.email || "")}</b></p>
    <label for="d-codein">Код разработчика <span class="small muted">(не пароль от кабинета)</span></label>
    ${U.pass("d-codein", 'required autocomplete="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true"')}
    <p class="small muted">Код вводится один раз: после этого кабинет навсегда получает права разработчика.</p>
    <button class="btn" type="submit">Войти в режим разработчика</button>${msg}
    <div class="row between"><a class="linkbtn" href="teacher.html">Кабинет учителя</a><button class="linkbtn" type="button" data-act="logout">Выйти из кабинета</button></div></form>`;
  const prov = D.settings.__provider || "";
  const s = D.stats || {};
  const anon = D.session?.user?.is_anonymous;
  return (anon ? `<form class="card stack" id="d-keep" style="gap:8px;margin-bottom:16px"><div class="kicker">Сохраните вход</div>
    <p class="small">Вы вошли по коду без почты: вход действует только в этом браузере. Добавьте почту и пароль, чтобы заходить с любого устройства.</p>
    <label for="dk-email">Почта</label><input type="email" id="dk-email" required autocomplete="username">
    <label for="dk-pass">Пароль (не меньше 8 знаков)</label>${U.pass("dk-pass", 'required minlength="8" autocomplete="new-password"')}
    <div><button class="btn sm" type="submit">Сохранить</button></div></form>` : "") + `<section class="hero glass" style="min-height:150px"><span class="mono muted">Разработчик</span><h1>Настройки платформы</h1>
      <p>Учителей: ${s.teachers ?? "–"} · учеников: ${s.students ?? "–"} · попыток тестов: ${s.results ?? "–"} · работ: ${s.writings ?? "–"} · разборов ИИ: ${s.ai ?? "–"}</p><img class="cat" data-m src="${U.mascot()}" alt=""></section>

  <div class="section-title"><h2>Нейросеть</h2></div>
  <form class="card stack" id="ai-form" style="gap:10px">
    <p class="small muted">Ключи хранятся на сервере в закрытой таблице – сайт и учителя их не видят, их читает только серверная функция <b>ai</b>. Здесь показаны последние 4 символа.</p>
    <label for="ai-provider">Какую нейросеть использовать</label>
    <select id="ai-provider">${PROV.map(([k,n]) => `<option value="${k}" ${(tail("ai_provider") || "deepseek") === k ? "selected" : ""}>${n}</option>`).join("")}</select>
    ${PROV.map(([k,n,h]) => `<label for="key-${k}">Ключ ${n} ${tail("key_" + k) ? `<span class="chip good">сохранён …${esc(tail("key_" + k))}</span>` : ""}</label>
      <input type="password" id="key-${k}" autocomplete="off" placeholder="${tail("key_" + k) ? "оставьте пустым, чтобы не менять" : esc(h)}">`).join("")}
    <details><summary class="small"><b>Дополнительно</b></summary><div class="stack" style="gap:8px;margin-top:8px">
      <label for="ai-model">Модель (пусто – по умолчанию: deepseek-chat / gpt-4o-mini)</label><input type="text" id="ai-model" value="${esc(tail("ai_model") || "")}">
      <label for="ai-url">Свой адрес API, совместимый с OpenAI (пусто – по умолчанию)</label><input type="url" id="ai-url" value="${esc(tail("ai_url") || "")}">
    </div></details>
    <div class="row"><button class="btn" type="submit">Сохранить</button><button class="btn ghost" type="button" data-act="test">Проверить связь</button>
      <button class="btn ghost sm" type="button" data-act="del-keys">Удалить все ключи</button></div>
    ${D.test ? `<p class="small ${D.test.ok ? "" : ""}" style="color:${D.test.error ? "var(--bad)" : "var(--good)"}">${esc(D.test.error || "Нейросеть отвечает: " + (D.test.hello || "ok"))}</p>` : ""}
  </form>

  <div class="section-title"><h2>Тарифы и оплата</h2></div>
  <form class="card stack" id="pay-form" style="gap:10px">
    <div class="grid2 stats">${[["basic","Базовый"],["materials","С материалами"],["full","Полный"]].map(([k,n]) => `<div><label for="pr-${k}">${n}, ₽ в месяц</label><input type="text" inputmode="numeric" id="pr-${k}" value="${esc((D.settings.prices || {})[k] ?? {basic:100, materials:300, full:500}[k])}"></div>`).join("")}
      <div><label for="trial-days">Пробный период, дней (0 – без него)</label><input type="text" inputmode="numeric" id="trial-days" value="${esc(D.settings.trial_days ?? 7)}"></div></div>
    <p class="small muted">ЮKassa → Настройки → Магазин: «shopId» и «Секретный ключ». В ЮKassa → Интеграция → HTTP-уведомления вставьте адрес ниже и отметьте событие <b>payment.succeeded</b>.</p>
    <div class="linkbox"><input type="text" readonly value="${esc((window.APP_CONFIG || {}).SUPABASE_URL || "https://ВАШ-ПРОЕКТ.supabase.co")}/functions/v1/pay"></div>
    <label for="yk-shop">shopId ЮKassa ${tail("yk_shop") ? `<span class="chip good">сохранён: ${esc(tail("yk_shop"))}</span>` : ""}</label><input type="text" id="yk-shop" autocomplete="off">
    <label for="yk-secret">Секретный ключ ЮKassa ${tail("yk_secret") ? `<span class="chip good">сохранён …${esc(tail("yk_secret"))}</span>` : ""}</label><input type="password" id="yk-secret" autocomplete="off" placeholder="${tail("yk_secret") ? "оставьте пустым, чтобы не менять" : "live_… или test_…"}">
    <div><button class="btn" type="submit">Сохранить тарифы и оплату</button></div>
  </form>

  <div class="section-title"><h2>Встроенная база в Supabase</h2></div>
  <div class="card stack" style="gap:10px">
    <p>Сейчас в базе курсов: <b>${D.baseCount}</b>. Материалы хранятся в Supabase, а не на GitHub, поэтому их видят только репетиторы с тарифом «С материалами» или «Полный» и их ученики.</p>
    <p class="small muted">Загрузите файл <b>base.json</b> (его прислала нейросеть в чате). Повторная загрузка обновляет курсы, ничего не удаляя.</p>
    <div class="row"><input type="file" id="base-file" accept=".json,application/json" hidden><button class="btn" data-act="base-upload">Загрузить base.json</button></div>
  </div>

  <div class="section-title"><h2>Код разработчика</h2></div>
  <form class="card stack" id="code-form" style="gap:8px" autocomplete="off">
    <p class="small muted">Код, по которому учётная запись получает права разработчика. Хранится только в виде хэша.</p>
    <label for="nc-code">Новый код (не меньше 6 знаков)</label>${U.pass("nc-code", 'minlength="6" required autocomplete="off" data-lpignore="true" data-1p-ignore="true"')}
    <div><button class="btn" type="submit">Сменить код</button></div>
  </form>

  <div class="section-title"><h2>Встроенная база по предметам и классам</h2></div>
  ${baseEditor()}

  <div class="section-title"><h2>Методические материалы – общая база</h2></div>
  <div class="card stack" style="gap:10px">
    <p class="small muted">Уроки, материалы и задания, которые вы создаёте в режиме разработчика с галочкой «В общую базу», видят все учителя платформы и их ученики этого курса. Строение урока как в «Учу по ФРП»: теория маленькими блоками → примеры → мини-практика → задания → тест.</p>
    <div class="subjects">${U.SUBJECTS.map(x => `<a class="subj" href="teacher.html#mat-${x.k}" style="text-decoration:none;color:inherit"><span class="emo">${x.e}</span><span>${esc(x.n)}<small>${x.g[0] === 0 ? "дошкольники" : x.g[0] + "–" + x.g.at(-1) + " кл."}</small></span></a>`).join("")}</div>
    <div class="row"><a class="btn" href="teacher.html">Открыть кабинет учителя (все предметы)</a><a class="btn ghost" href="./?student">Посмотреть как ученик</a></div>
  </div>

  <div class="section-title"><h2>Оформление сайта</h2></div>
  <form class="card stack" id="look-form" style="gap:10px">
    <label for="lk-title">Название на экране входа</label><input type="text" id="lk-title" value="${esc(D.settings.title || "")}" placeholder="Подготовка к ОГЭ. Русский язык">
    <label for="lk-tag">Подпись-метка</label><input type="text" id="lk-tag" value="${esc(D.settings.school_tag || "")}" placeholder="Учу по ФРП · репетиторство">
    <div><b class="small">Фон по умолчанию для новых учеников</b><div style="margin-top:8px">${U.themesHTML(D.settings.default_theme || "lavender").replace(/<button[^>]*data-theme-pick="photo"[\s\S]*?<\/button>/, "")}</div></div>
    <div><button class="btn" type="submit">Сохранить оформление</button></div>
  </form>

  <div class="section-title"><h2>Учителя и встроенные базы</h2></div>
  <div class="card"><p class="small muted" style="margin-bottom:10px">Репетиторы регистрируются сами и появляются здесь после первого входа. Тариф и срок меняются автоматически после оплаты; здесь можно выдать их вручную (например, подарить месяц). «Базы вручную» открывают встроенные материалы независимо от тарифа.</p>
    <div class="tablewrap"><table><thead><tr><th>Почта</th><th>Имя</th><th>Роль</th><th>Тариф</th><th>Оплачено до</th><th>Базы вручную</th><th></th></tr></thead><tbody>
    ${D.teachers.map(t => `<tr data-tid="${t.id}"><td>${esc(t.email || "")}</td><td><input type="text" data-f="name" value="${esc(t.name || "")}" style="min-width:140px"></td>
      <td><select data-f="role" style="min-width:150px" ${t.id === D.me.id ? "disabled" : ""}><option value="teacher" ${t.role==="teacher"?"selected":""}>учитель</option><option value="developer" ${t.role==="developer"?"selected":""}>разработчик</option></select></td>
      <td><select data-f="plan" style="min-width:150px">${[["basic","Базовый · 100 ₽"],["materials","С материалами · 300 ₽"],["full","Полный · 500 ₽"]].map(([k,n]) => `<option value="${k}" ${t.plan===k?"selected":""}>${n}</option>`).join("")}</select>${t.trial ? '<div class="small muted">пробный</div>' : ""}</td>
      <td><input type="date" data-f="paid" value="${t.paid_until ? t.paid_until.slice(0, 10) : ""}" style="width:150px"></td>
      <td class="small">${Object.keys(U.PACKS).map(p => `<label style="display:flex;gap:6px;font-weight:600"><input type="checkbox" data-pack="${p}" ${(t.base_access || []).includes(p) ? "checked" : ""}> ${esc(U.PACKS[p])}</label>`).join("")}</td>
      <td><button class="btn sm" data-act="save-teacher">Сохранить</button></td></tr>`).join("")}
    </tbody></table></div></div>`;
}

function render(){
  $("#app").innerHTML = `<div class="shell" style="display:block"><header class="topnav"><div class="in glass"><span class="ttl">Кабинет разработчика</span><a class="btn ghost sm" href="teacher.html">Кабинет учителя</a>${D.session ? `<button class="btn ghost sm" data-act="logout">Выйти</button>` : ""}</div></header>
    <main class="main">${view()}</main></div>`;
}

document.addEventListener("submit", async e => {
  e.preventDefault();
  if (e.target.id === "code-form"){
    const v = $("#nc-code").value; if (v.length < 6){ toast("Код – не меньше 6 знаков"); return; }
    const {error} = await sb.rpc("dev_change_code", {p_code: v});
    toast(error ? "Не получилось: " + error.message : "Код разработчика изменён"); if (!error) $("#nc-code").value = ""; return;
  }
  if (e.target.id === "base-add"){
    const key = bCourse(), lid = $("#ba-lesson").value, files = [...$("#ba-files").files], url = $("#ba-url").value.trim(), title = $("#ba-title").value.trim(), body = $("#ba-body").value.trim();
    const msg = $("#ba-msg"), rows = [];
    if (!files.length && !url && !body){ msg.textContent = "Выберите файлы, вставьте ссылку или напишите текст."; return; }
    for (const [i, f] of files.entries()){
      msg.textContent = `Загружаю файл ${i + 1} из ${files.length}…`;
      if (f.size > 50e6){ toast(`${f.name}: больше 50 МБ – пропускаю`); continue; }
      const path = `${D.me.id}/base/${key}/${Date.now()}-${f.name.replace(/[^\wа-яё.\-]+/gi, "_")}`;
      const up = await sb.storage.from("materials").upload(path, f, {contentType: f.type || undefined});
      if (up.error){ toast(`${f.name}: ${up.error.message}`); continue; }
      rows.push({course: key, lesson_id: lid, kind: "file", title: f.name.replace(/\.[^.]+$/, ""), url: sb.storage.from("materials").getPublicUrl(path).data.publicUrl, shared: true});
    }
    if (url) rows.push({course: key, lesson_id: lid, kind: "link", title: title || url, url, shared: true});
    if (body) rows.push({course: key, lesson_id: lid, kind: "text", title: title || "Материал", body, shared: true});
    if (!rows.length){ msg.textContent = ""; return; }
    const {error} = await sb.from("materials").insert(rows);
    if (error){ msg.textContent = "Не сохранилось: " + error.message; return; }
    toast(`Добавлено во встроенную базу: ${rows.length}`); D.bLoaded = null; render(); return;
  }
  if (e.target.id === "base-lesson"){
    const key = bCourse(), t = $("#bl-title").value.trim(); if (!t) return;
    const lid = "b" + U.randHex(4), last = (D.bLessons || []).at(-1)?.date;
    const date = last ? U.iso(new Date(new Date(last + "T00:00:00").getTime() + 7 * 864e5)) : U.iso(new Date());
    const {error} = await sb.from("materials").insert({course: key, lesson_id: lid, kind: "lesson", title: t, shared: true, data: {title: t, date, oge: "Урок базы", learn: [t], theory: [], hw: ""}});
    if (error){ toast("Не сохранилось: " + error.message); return; }
    toast("Урок добавлен – теперь в него можно добавлять материалы"); D.bLoaded = null; render(); return;
  }
  if (e.target.id === "d-quick"){
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Проверяю…"; D.quickMsg = null;
    const code = $("#d-qcode").value, name = $("#d-qname").value.trim() || "Разработчик";
    try{
      const {data: a, error: ae} = await sb.auth.signInAnonymously({options: {data: {name}}});
      if (ae) throw /anonymous/i.test(ae.message) ? new Error("Вход по коду выключен в Supabase: Authentication → Sign In / Providers → включите «Allow anonymous sign-ins».") : ae;
      const {data, error} = await sb.rpc("dev_join", {p_code: code});
      if (error) throw /dev_join|does not exist/i.test(error.message) ? new Error("Обновите базу: в Supabase → SQL Editor заново выполните supabase/schema.sql.") : error;
      if (!data){ await sb.auth.signOut(); throw new Error("Код не подошёл."); }
      D.session = a.session; D.msg = null; toast("Вы в режиме разработчика"); render(); load();
    }catch(er){ D.quickMsg = er.message && /[а-яё]/i.test(er.message) ? er.message : U.authErr(er); D.session = null; render(); }
    return;
  }
  if (e.target.id === "d-keep"){
    const {error} = await sb.auth.updateUser({email: $("#dk-email").value.trim(), password: $("#dk-pass").value}, {emailRedirectTo: U.siteURL("dev.html")});
    if (error){ toast(U.authErr(error)); return; }
    toast("Проверьте почту и подтвердите адрес – после этого входите почтой и паролем"); return;
  }
  if (e.target.id === "d-login"){
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Вхожу…"; D.lastEmail = $("#d-email").value.trim();
    try{ const {data, error} = await sb.auth.signInWithPassword({email: D.lastEmail, password: $("#d-pass").value}); if (error) throw error; D.session = data.session; D.msg = null; render(); load(); }
    catch(er){ D.msg = {t: U.authErr(er)}; render(); }
  }
  if (e.target.id === "d-code"){
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Проверяю…";
    const {data, error} = await sb.rpc("dev_join", {p_code: $("#d-codein").value});
    if (error){ D.msg = {t: /dev_join|does not exist/i.test(error.message) ? "Обновите базу: в Supabase → SQL Editor заново выполните supabase/schema.sql." : U.authErr(error)}; render(); return; }
    if (!data){ D.msg = {t: "Код не подошёл."}; render(); return; }
    D.msg = null; toast("Вы в режиме разработчика"); load();
  }
  if (e.target.id === "ai-form"){
    const jobs = [["ai_provider", $("#ai-provider").value]];
    PROV.forEach(([k]) => { const v = $("#key-" + k).value.trim(); if (v) jobs.push(["key_" + k, v]); });
    jobs.push(["ai_model", $("#ai-model").value.trim()], ["ai_url", $("#ai-url").value.trim()]);
    for (const [k, v] of jobs){ const {error} = await sb.rpc("dev_set_secret", {p_key: k, p_value: v}); if (error){ toast("Не сохранилось: " + error.message); return; } }
    toast("Настройки нейросети сохранены"); load();
  }
  if (e.target.id === "pay-form"){
    const prices = {}; ["basic","materials","full"].forEach(k => prices[k] = Math.max(1, Math.round(+$("#pr-" + k).value.replace(/\D/g, "")) || 0));
    const days = Math.max(0, parseInt($("#trial-days").value, 10) || 0);
    let {error} = await sb.from("app_settings").upsert([{key: "prices", value: prices}, {key: "trial_days", value: days}]);
    if (!error && $("#yk-shop").value.trim()) error = (await sb.rpc("dev_set_secret", {p_key: "yk_shop", p_value: $("#yk-shop").value.trim()})).error;
    if (!error && $("#yk-secret").value.trim()) error = (await sb.rpc("dev_set_secret", {p_key: "yk_secret", p_value: $("#yk-secret").value.trim()})).error;
    toast(error ? "Не сохранилось: " + error.message : "Тарифы и оплата сохранены"); load(); return;
  }
  if (e.target.id === "look-form"){
    const pick = document.querySelector('[data-theme-pick][aria-pressed="true"]')?.dataset.themePick || "lavender";
    const rows = [{key: "title", value: $("#lk-title").value.trim()}, {key: "school_tag", value: $("#lk-tag").value.trim()}, {key: "default_theme", value: pick}];
    const {error} = await sb.from("app_settings").upsert(rows);
    if (error){ toast("Не сохранилось: " + error.message); return; }
    toast("Оформление сохранено"); load();
  }
});
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-act],[data-theme-pick],[data-bsubj],[data-bcourse],[data-bdel]"); if (!t) return;
  if (t.dataset.bsubj){ D.bSubj = t.dataset.bsubj; D.bCourse = null; D.bLoaded = null; render(); return; }
  if (t.dataset.bcourse){ D.bCourse = t.dataset.bcourse; D.bLoaded = null; render(); return; }
  if (t.dataset.bdel){
    if (!t.dataset.sure){ t.dataset.sure = "1"; t.textContent = "Точно удалить?"; return; }
    const {error} = await sb.from("materials").delete().eq("id", +t.dataset.bdel);
    if (error){ toast("Не удалось: " + error.message); return; }
    D.bLoaded = null; render(); return;
  }
  if (t.dataset.themePick){ document.querySelectorAll("[data-theme-pick]").forEach(b => b.setAttribute("aria-pressed", b === t)); U.applyTheme(t.dataset.themePick); return; }
  const a = t.dataset.act;
  if (a === "logout"){ await sb.auth.signOut(); D.session = null; D.me = null; D.err = null; D.msg = null; render(); }
  if (a === "retry"){ D.err = null; render(); load(); }
  if (a === "test"){
    t.disabled = true; t.textContent = "Проверяю…";
    const {data, error} = await sb.functions.invoke("ai", {body: {action: "test_key"}});
    let msg = null; if (error){ msg = error.message; try{ msg = (await error.context.json()).error || msg; }catch(_){} }
    D.test = error ? {error: "Ошибка: " + msg + ". Проверьте, что функция ai загружена в Supabase (README, шаг про нейросеть)."} : data; render();
  }
  if (a === "del-keys"){
    if (!t.dataset.sure){ t.dataset.sure = "1"; t.textContent = "Точно удалить?"; return; }
    for (const s of D.secrets){ await sb.rpc("dev_set_secret", {p_key: s.key, p_value: ""}); }
    toast("Ключи удалены"); load();
  }
  if (a === "base-upload"){
    const inp = $("#base-file"); inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return; let rows;
      try{ rows = JSON.parse(await f.text()); }catch(_){ toast("Это не тот файл: нужен base.json"); return; }
      if (!Array.isArray(rows) || !rows[0]?.key){ toast("Это не тот файл: нужен base.json"); return; }
      t.disabled = true; let done = 0;
      for (const r of rows){ const {error} = await sb.from("course_data").upsert({key: r.key, data: r.data, keys: r.keys || null, updated_at: new Date().toISOString()}); if (error){ toast("Ошибка на курсе " + r.key + ": " + error.message); t.disabled = false; return; } done++; t.textContent = `Загружаю… ${done}/${rows.length}`; }
      toast(`Загружено курсов: ${done}`); load();
    }; inp.click(); return;
  }
  if (a === "save-teacher"){
    const tr = t.closest("tr"), id = tr.dataset.tid;
    const paid = tr.querySelector('[data-f="paid"]').value;
    const row = {name: tr.querySelector('[data-f="name"]').value.trim() || null, base_access: [...tr.querySelectorAll("[data-pack]:checked")].map(x => x.dataset.pack),
                 plan: tr.querySelector('[data-f="plan"]').value, paid_until: paid ? new Date(paid + "T23:59:00").toISOString() : null, trial: false};
    const role = tr.querySelector('[data-f="role"]'); if (!role.disabled) row.role = role.value;
    const {error} = await sb.from("teachers").update(row).eq("id", id);
    toast(error ? "Не сохранилось: " + error.message : "Сохранено");
  }
});

(async () => {
  render();
  if (!sb) return;
  const {data} = await sb.auth.getSession(); D.session = data.session;
  if (D.session) load(); render();
})();
})();
