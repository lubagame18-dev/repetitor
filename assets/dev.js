/* Кабинет разработчика: ключи нейросети, оформление сайта, учителя и доступ к встроенным базам */
(() => {
const {esc, toast} = U;
const sb = U.supa();
const D = {session:null, me:null, secrets:[], settings:{}, teachers:[], stats:null, test:null};
const $ = s => document.querySelector(s);
const PROV = [["deepseek","DeepSeek","platform.deepseek.com → API keys"],["aitunnel","AITUNNEL (оплата из России)","aitunnel.ru → ключ API"],["openrouter","OpenRouter","openrouter.ai → Keys"],["openai","OpenAI","platform.openai.com → API keys"]];

async function load(){
  const me = await sb.rpc("me"); D.me = me.data;
  if (D.me?.role !== "developer") return render();
  const [sec, st, te, stats] = await Promise.all([sb.rpc("dev_list_secrets"), sb.from("app_settings").select("key,value"), sb.from("teachers").select("*").order("created_at"), sb.rpc("dev_stats")]);
  D.secrets = sec.data || []; D.settings = Object.fromEntries((st.data || []).map(r => [r.key, r.value])); D.teachers = te.data || []; D.stats = stats.data;
  render();
}
const tail = k => D.secrets.find(s => s.key === k)?.tail;

function view(){
  if (!sb) return `<div class="card"><h2>Сервер не подключён</h2><p>Заполните config.js – см. README.</p></div>`;
  if (!D.session) return `<form class="card login stack" id="d-login"><h2>Вход разработчика</h2>
    <label for="d-email">Почта</label><input type="email" id="d-email" required autocomplete="username">
    <label for="d-pass">Пароль</label><input type="password" id="d-pass" required autocomplete="current-password">
    <button class="btn" type="submit">Войти</button><p class="small" id="d-err" hidden style="color:var(--bad)"></p></form>`;
  if (!D.me) return `<p class="muted">Загружаю…</p>`;
  if (D.me.role !== "developer") return `<div class="card"><h2>Нет доступа</h2><p>Этот раздел – только для разработчика. <a href="teacher.html">Кабинет учителя</a></p></div>`;
  const prov = D.settings.__provider || "";
  const s = D.stats || {};
  return `<section class="hero glass" style="min-height:150px"><span class="mono muted">Разработчик</span><h1>Настройки платформы</h1>
      <p>Учителей: ${s.teachers ?? "–"} · учеников: ${s.students ?? "–"} · попыток тестов: ${s.results ?? "–"} · работ: ${s.writings ?? "–"} · разборов ИИ: ${s.ai ?? "–"}</p><img class="cat" src="assets/kotik.webp" alt=""></section>

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

  <div class="section-title"><h2>Оформление сайта</h2></div>
  <form class="card stack" id="look-form" style="gap:10px">
    <label for="lk-title">Название на экране входа</label><input type="text" id="lk-title" value="${esc(D.settings.title || "")}" placeholder="Подготовка к ОГЭ. Русский язык">
    <label for="lk-tag">Подпись-метка</label><input type="text" id="lk-tag" value="${esc(D.settings.school_tag || "")}" placeholder="Учу по ФРП · репетиторство">
    <div><b class="small">Фон по умолчанию для новых учеников</b><div style="margin-top:8px">${U.themesHTML(D.settings.default_theme || "lavender").replace(/<button[^>]*data-theme-pick="photo"[\s\S]*?<\/button>/, "")}</div></div>
    <div><button class="btn" type="submit">Сохранить оформление</button></div>
  </form>

  <div class="section-title"><h2>Учителя и встроенные базы</h2></div>
  <div class="card"><p class="small muted" style="margin-bottom:10px">Учитель появляется здесь после первого входа в кабинет. Отметьте, какие встроенные базы ему открыты (купленные).</p>
    <div class="tablewrap"><table><thead><tr><th>Почта</th><th>Имя</th><th>Роль</th>${Object.values(U.PACKS).map(n => `<th>${esc(n)}</th>`).join("")}<th></th></tr></thead><tbody>
    ${D.teachers.map(t => `<tr data-tid="${t.id}"><td>${esc(t.email || "")}</td><td><input type="text" data-f="name" value="${esc(t.name || "")}" style="min-width:140px"></td>
      <td><select data-f="role" style="min-width:150px" ${t.id === D.me.id ? "disabled" : ""}><option value="teacher" ${t.role==="teacher"?"selected":""}>учитель</option><option value="developer" ${t.role==="developer"?"selected":""}>разработчик</option></select></td>
      ${Object.keys(U.PACKS).map(p => `<td><input type="checkbox" data-pack="${p}" ${(t.base_access || []).includes(p) ? "checked" : ""} aria-label="${esc(U.PACKS[p])}"></td>`).join("")}
      <td><button class="btn sm" data-act="save-teacher">Сохранить</button></td></tr>`).join("")}
    </tbody></table></div></div>`;
}

function render(){
  $("#app").innerHTML = `<div class="shell" style="display:block"><header class="topnav"><div class="in glass"><span class="ttl">Кабинет разработчика</span><a class="btn ghost sm" href="teacher.html">Кабинет учителя</a>${D.session ? `<button class="btn ghost sm" data-act="logout">Выйти</button>` : ""}</div></header>
    <main class="main">${view()}</main></div>`;
}

document.addEventListener("submit", async e => {
  e.preventDefault();
  if (e.target.id === "d-login"){
    const {data, error} = await sb.auth.signInWithPassword({email: $("#d-email").value.trim(), password: $("#d-pass").value});
    if (error){ const el = $("#d-err"); el.textContent = "Не получилось войти."; el.hidden = false; return; }
    D.session = data.session; render(); load();
  }
  if (e.target.id === "ai-form"){
    const jobs = [["ai_provider", $("#ai-provider").value]];
    PROV.forEach(([k]) => { const v = $("#key-" + k).value.trim(); if (v) jobs.push(["key_" + k, v]); });
    jobs.push(["ai_model", $("#ai-model").value.trim()], ["ai_url", $("#ai-url").value.trim()]);
    for (const [k, v] of jobs){ const {error} = await sb.rpc("dev_set_secret", {p_key: k, p_value: v}); if (error){ toast("Не сохранилось: " + error.message); return; } }
    toast("Настройки нейросети сохранены"); load();
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
  const t = e.target.closest("[data-act],[data-theme-pick]"); if (!t) return;
  if (t.dataset.themePick){ document.querySelectorAll("[data-theme-pick]").forEach(b => b.setAttribute("aria-pressed", b === t)); U.applyTheme(t.dataset.themePick); return; }
  const a = t.dataset.act;
  if (a === "logout"){ await sb.auth.signOut(); D.session = null; D.me = null; render(); }
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
  if (a === "save-teacher"){
    const tr = t.closest("tr"), id = tr.dataset.tid;
    const row = {name: tr.querySelector('[data-f="name"]').value.trim() || null, base_access: [...tr.querySelectorAll("[data-pack]:checked")].map(x => x.dataset.pack)};
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
