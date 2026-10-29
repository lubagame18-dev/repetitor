/* Общие функции для ученика и учителя */
window.U = (() => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const d = iso => new Date(iso + "T00:00:00");
  const today = () => { const t = new Date(); t.setHours(0,0,0,0); return t; };
  const fmt = (iso, o = {day:"numeric", month:"long"}) => d(iso).toLocaleDateString("ru-RU", o);
  const fmtShort = iso => d(iso).toLocaleDateString("ru-RU", {day:"2-digit", month:"2-digit"});
  const daysTo = iso => Math.round((d(iso) - today()) / 864e5);
  const pct = r => r ? Math.round(r.score / r.total * 100) : null;
  const lvl = p => p == null ? "" : p >= 80 ? "good" : p >= 60 ? "mid" : "bad";
  const lvlColor = p => p == null ? "var(--chip)" : `var(--${lvl(p)})`;

  /* разметка теории: [[x:слово]] и т. п. */
  function mark(s){
    return esc(s).replace(/\[\[([xwspoab]):(.+?)\]\]/g, (_, k, t) => `<span class="u-${k}">${t}</span>`);
  }

  /* результаты: массив попыток → по занятиям */
  function aggregate(rows, kind = "lesson"){
    const out = {};
    rows.filter(r => (r.kind || "lesson") === kind).sort((a,b) => new Date(a.created_at) - new Date(b.created_at)).forEach(r => {
      const o = out[r.lesson_id] || (out[r.lesson_id] = {attempts:0, last:null, best:null, history:[]});
      const x = {score:r.score, total:r.total, wrong:r.wrong || [], at:r.created_at, duration_sec:r.duration_sec};
      o.attempts++; o.last = x; o.history.push(x);
      if (!o.best || pct(x) >= pct(o.best)) o.best = x;
    });
    return out;
  }

  function recText(res){
    if (!res) return null;
    const p = pct(res), tags = [...new Set(res.wrong || [])];
    if (p >= 80 && !tags.length) return "Отлично! Тема закреплена, можно двигаться дальше.";
    if (p >= 80) return "Хороший результат. Повтори правило: " + tags.join("; ") + ".";
    if (p >= 60) return "Тема почти усвоена. Повтори: " + tags.join("; ") + ". Реши 5 заданий из банка ФИПИ по этим правилам.";
    return "Тему разберём ещё раз в начале следующего занятия. Повтори: " + tags.join("; ") + " – и пройди тест повторно.";
  }

  function hwState(course, id, hw){
    const L = course.lessons, i = L.findIndex(l => l.id === id), due = L[i+1]?.date, h = hw[id];
    if (h?.status === "accepted") return {t:"Принято" + (h.grade ? ` · ${h.grade}` : ""), c:"good"};
    if (h?.status === "redo") return {t:"На доработку", c:"bad"};
    if (h?.status === "sent") return {t:"Отправлено", c:"mid"};
    if (due && d(due) < today()) return {t:"Не сдано", c:"bad"};
    if (d(L[i].date) > today()) return {t:"Будет на занятии", c:""};
    return {t:"Сдать " + (due ? fmtShort(due) : ""), c:""};
  }

  function blockStats(course, results){
    return Object.entries(course.blocks).map(([k,b]) => {
      const ls = course.lessons.filter(l => l.block === k);
      const v = ls.map(l => pct(results[l.id]?.best)).filter(x => x != null);
      return {k, b, n:ls.length, done:v.length, avg: v.length ? Math.round(v.reduce((a,c) => a+c, 0) / v.length) : null};
    });
  }
  function weakTags(course, results, n = 6){
    const c = {};
    course.lessons.forEach(l => (results[l.id]?.last?.wrong || []).forEach(t => c[t] = (c[t]||0) + 1));
    return Object.entries(c).sort((a,b) => b[1]-a[1]).slice(0, n);
  }
  function avgAll(course, results){
    const v = course.lessons.map(l => pct(results[l.id]?.best)).filter(x => x != null);
    return v.length ? Math.round(v.reduce((a,b) => a+b, 0) / v.length) : null;
  }

  /* мини-практика: answer – варианты через «|»; заглавная гласная внутри слова – ударение, тогда регистр важен */
  const normAns = (s, keepCase) => { s = String(s || "").replace(/ё/g, "е").replace(/Ё/g, "Е").replace(/[\s.,;:!?«»"'()\[\]–—-]+/g, ""); return keepCase ? s : s.toLowerCase(); };
  function miniCheck(ans, right){
    return String(right).split("|").some(r => { const kc = /[а-яё][АЕЁИОУЫЭЮЯ]/.test(r); return normAns(ans, kc) === normAns(r, kc); });
  }
  function miniHTML(l, bi, mini, withKeys){
    if (!mini?.length) return "";
    return `<div class="mini" data-mini="${esc(l.id)}:${bi}"><div class="kicker"><span class="step-badge">${bi+1}</span> Мини-практика – сразу закрепляем</div>
      ${mini.map((m, k) => `<div class="mini-q"><p>${esc(m.q)}</p>${withKeys ? `<b>${esc(m.a.split("|")[0])}</b>` : `<input type="text" data-mq="${k}" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="Ответ">`}<span class="ans" hidden></span></div>`).join("")}
      ${withKeys ? "" : `<div class="row" style="margin-top:10px"><button class="btn sm" data-act="mini-check" data-mini-id="${esc(l.id)}:${bi}">Проверить</button><span class="small muted mini-res"></span></div>`}</div>`;
  }
  function theoryHTML(l, withKeys){
    const blocks = l.theory.map((t, bi) => `<div class="tblock">
      <h3>${esc(t.h)}</h3>
      ${t.t ? `<p>${mark(t.t)}</p>` : ""}
      ${t.list ? `<ul>${t.list.map(x => `<li>${mark(x)}</li>`).join("")}</ul>` : ""}
      ${t.table ? `<div class="tablewrap"><table><thead><tr>${t.table[0].map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${t.table.slice(1).map(r => `<tr>${r.map(c => `<td>${mark(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}
      ${t.ex?.length ? `<div class="ex">${t.ex.map(x => `<div>${mark(x)}</div>`).join("")}</div>` : ""}
      ${t.scheme ? `<div class="scheme">${esc(t.scheme)}</div>` : ""}
      ${miniHTML(l, bi, t.mini, withKeys)}
    </div>`).join("");
    const m = l.memo;
    return `<div class="theory">${blocks}
      ${m ? `<div class="memo"><img data-m src="${U.mascot ? U.mascot() : "assets/kotik.webp"}" alt=""><div><b>${esc(m.h)}</b><p style="margin-top:4px">${mark(m.t)}</p>${m.ex?.length ? `<div class="ex">${m.ex.map(x => `<div>${mark(x)}</div>`).join("")}</div>` : ""}</div></div>` : ""}
      ${/\[\[[xwspoa]:/.test(JSON.stringify(l.theory)) ? "" : "<!--"}<div class="legend-signs muted"><span><span class="u-s">подлежащее</span></span><span><span class="u-p">сказуемое</span></span><span><span class="u-o">дополнение</span></span><span><span class="u-w">определение</span></span><span><span class="u-a">обстоятельство</span></span><span><span class="u-x">слово</span> – определяемое</span></div>${/\[\[[xwspoa]:/.test(JSON.stringify(l.theory)) ? "" : "-->"}
    </div>`;
  }

  function practiceHTML(l, withKeys){
    return l.practice.map((p, i) => `<div class="task">
      <b>Задание ${i+1}.</b> ${esc(p.t)}
      ${p.text ? `<div class="ttext">${esc(p.text)}</div>` : ""}
      ${p.items?.length ? `<ol class="items">${p.items.map((x, k) => `<li>${/^\d+\)/.test(x) ? "" : (k + 1) + ") "}${esc(x)}${withKeys ? "" : '<span class="blank"></span>'}</li>`).join("")}</ol>` : ""}
      ${!withKeys && p.lines ? Array.from({length:p.lines}, () => '<span class="blank"></span>').join("") : ""}
      ${!withKeys && !p.items?.length && !p.lines ? '<span class="blank"></span><span class="blank"></span>' : ""}
      ${withKeys && p.key ? `<div class="key"><b>Ключ:</b> ${esc(p.key)}</div>` : ""}
    </div>`).join("");
  }

  /* ---------- письменная линия ---------- */
  const KIND_NAME = {"thesis":"Тезис", "example":"Пример + пояснение", "13.1":"Сочинение 13.1", "13.2":"Сочинение 13.2", "13.3":"Сочинение 13.3", "izl":"Сжатое изложение", "choice":"Сочинение выбранного типа"};
  const wordCount = s => (String(s || "").match(/[A-Za-zА-Яа-яЁё0-9]+(?:-[A-Za-zА-Яа-яЁё0-9]+)*/g) || []).length;
  function stepHTML(st){
    return `<div class="tblock"><h3>${esc(st.h)}</h3>${st.t ? `<p>${mark(st.t)}</p>` : ""}
      ${st.list ? `<ul>${st.list.map(x => `<li>${mark(x)}</li>`).join("")}</ul>` : ""}
      ${st.ex?.length ? `<div class="ex">${st.ex.map(x => `<div>${mark(x)}</div>`).join("")}</div>` : ""}</div>`;
  }
  /* kind – для «choice» реальный тип, который выбрал ученик */
  function writingSource(course, l, kind){
    const w = l.writing;
    if (w.type === "izl"){
      const t = course.izl[w.text];
      return {title: t.title, topic: "Напишите сжатое изложение (не менее 70 слов).", html: t.paras.map(p => `<p style="margin-bottom:8px">${esc(p)}</p>`).join("")};
    }
    const t = course.texts[w.text], k = ["thesis","example"].includes(w.type) ? "13.3" : (w.type === "choice" ? (kind || "13.3") : w.type);
    return {title: t.title, topic: t.topics[k], kind: k, html: `<p>${esc(t.text)}</p>`};
  }
  function critFor(course, kind){ return kind === "izl" ? course.criteria.izl : ["13.1","13.2","13.3"].includes(kind) ? course.criteria.essay : null; }
  function writingResultHTML(course, w){
    if (!w) return "";
    if (w.status === "sent") return `<p class="chip mid" style="margin-top:10px">Отправлено, ждёт проверки</p>`;
    const crit = critFor(course, w.kind) || [];
    const errs = course.criteria.errors.filter(([k]) => w.errors?.[k] != null);
    return `<div class="expl" style="margin-top:12px">
      ${w.max ? `<div class="row between"><b>Оценка: ${w.total} из ${w.max}</b><span class="chip ${lvl(Math.round(w.total / w.max * 100))}">${Math.round(w.total / w.max * 100)}%</span></div>` : `<b>${w.status === "redo" ? "На доработку" : "Проверено"}</b>`}
      ${crit.length ? `<ul style="margin:8px 0 0;padding-left:18px">${crit.map(([k, n, m]) => `<li>${k} – ${esc(n)}: <b>${w.scores?.[k] ?? "–"}</b> из ${m}</li>`).join("")}</ul>` : ""}
      ${errs.length ? `<p class="small" style="margin-top:6px">Ошибки: ${errs.map(([k, n]) => `${n} – ${w.errors[k]}`).join(", ")}</p>` : ""}
      ${w.comment ? `<p style="margin-top:6px"><b>Комментарий:</b> ${esc(w.comment)}</p>` : ""}</div>`;
  }
  function writingStats(course, writings){
    const list = course.lessons.map(l => ({l, w: writings[l.lesson_id || l.id]})).filter(x => x.w && x.w.max);
    const by = k => list.filter(x => k === "izl" ? x.w.kind === "izl" : x.w.kind === k);
    const avg = arr => arr.length ? Math.round(arr.reduce((a, x) => a + x.w.total / x.w.max * 100, 0) / arr.length) : null;
    const errs = {}; Object.values(writings).forEach(w => Object.entries(w.errors || {}).forEach(([k, v]) => errs[k] = (errs[k] || 0) + (+v || 0)));
    return {list, essays: list.filter(x => x.w.kind !== "izl"), izl: by("izl"), t131: avg(by("13.1")), t132: avg(by("13.2")), t133: avg(by("13.3")), avgIzl: avg(by("izl")), errs, sent: Object.values(writings).length};
  }
  function sparkHTML(arr){
    if (!arr.length) return '<p class="muted small">Пока нет проверенных работ.</p>';
    return `<div class="spark">${arr.map(x => { const p = Math.round(x.w.total / x.w.max * 100); return `<i title="${esc(x.l.title)}: ${x.w.total}/${x.w.max}" style="height:${Math.max(6, p)}%;background:${lvlColor(p)}"></i>`; }).join("")}</div>
      <div class="row between small muted"><span>${fmtShort(arr[0].l.date)}</span><span>${fmtShort(arr.at(-1).l.date)}</span></div>`;
  }

  /* ---------- предметы и классы ---------- */
  const R = (a, b) => Array.from({length: b - a + 1}, (_, i) => a + i);
  // g – классы (0 – дошкольники); exam – есть ОГЭ/ЕГЭ
  const SUBJECTS = [
    {k:"rus",   n:"Русский язык",        e:"📘", g:R(1, 11), exam:true},
    {k:"lit",   n:"Литература",          e:"📖", g:R(5, 11), exam:true},
    {k:"read",  n:"Литературное чтение", e:"📚", g:R(1, 4)},
    {k:"math",  n:"Математика",          e:"📐", g:R(1, 11), exam:true},
    {k:"phys",  n:"Физика",              e:"🔭", g:R(7, 11), exam:true},
    {k:"chem",  n:"Химия",               e:"⚗️", g:R(8, 11), exam:true},
    {k:"bio",   n:"Биология",            e:"🌿", g:R(5, 11), exam:true},
    {k:"geo",   n:"География",           e:"🌍", g:R(5, 11), exam:true},
    {k:"hist",  n:"История",             e:"🏛️", g:R(5, 11), exam:true},
    {k:"soc",   n:"Обществознание",      e:"⚖️", g:R(6, 11), exam:true},
    {k:"inf",   n:"Информатика",         e:"💻", g:R(5, 11), exam:true},
    {k:"eng",   n:"Английский язык",     e:"🇬🇧", g:R(1, 11), exam:true},
    {k:"ger",   n:"Немецкий язык",       e:"🇩🇪", g:R(1, 11), exam:true},
    {k:"fre",   n:"Французский язык",    e:"🇫🇷", g:R(1, 11), exam:true},
    {k:"chi",   n:"Китайский язык",      e:"🇨🇳", g:R(1, 11), exam:true},
    {k:"world", n:"Окружающий мир",      e:"🌱", g:R(1, 4)},
    {k:"prep",  n:"Подготовка к школе",  e:"✏️", g:[0]}
  ];
  const subj = k => SUBJECTS.find(x => x.k === k) || SUBJECTS[0];
  const gradeName = g => +g === 0 ? "дошкольник" : g + " класс";
  /* предмет курса по его ключу: oge-rus, rus-7, math-5, ege-phys … */
  const subjectOf = key => { const m = String(key || "").match(/^(?:oge|ege)-(\w+)$|^(\w+)-\d+$/); return m ? (m[1] || m[2]) : "rus"; };

  /* план по предмету, классу и целям */
  const GOALS = ["ОГЭ","ЕГЭ","ВПР","Контрольные и домашние","Олимпиада"];
  /* цели, которые подходят классу: ОГЭ – 8–9 класс, ЕГЭ – 10–11, ВПР – 4–8 и 10–11, олимпиада – с 4 класса */
  function goalsFor(subject, grade){
    const S = subj(subject), g = +grade;
    return GOALS.filter(x => x === "ОГЭ" ? S.exam && g >= 8 && g <= 9 : x === "ЕГЭ" ? S.exam && g >= 10 : x === "ВПР" ? (g >= 4 && g <= 8) || g >= 10 : x === "Олимпиада" ? g >= 4 : true);
  }
  const goalLabel = x => ["ОГЭ","ЕГЭ","ВПР"].includes(x) ? "Подготовка к " + x : x;
  function goalsHTML(subject, grade, name, checked){
    const list = goalsFor(subject, grade), def = checked?.length ? checked : [list.includes("ОГЭ") && +grade === 9 ? "ОГЭ" : list.includes("ЕГЭ") && +grade === 11 ? "ЕГЭ" : "Контрольные и домашние"];
    return list.map(x => `<label><input type="checkbox" name="${name}" value="${esc(x)}" ${def.includes(x) ? "checked" : ""}> ${esc(goalLabel(x))}</label>`).join("");
  }
  function planFor(subject, grade, goals){
    if (Array.isArray(grade) || grade === undefined){ goals = grade; grade = subject; subject = "rus"; } // старый вызов planFor(grade, goals)
    goals = goals || []; const S = subj(subject);
    if (S.exam && +grade === 9 && goals.includes("ОГЭ")) return "oge-" + S.k;
    if (S.exam && +grade >= 10 && goals.includes("ЕГЭ")) return "ege-" + S.k;
    return S.k + "-" + grade;
  }
  /* курс, которого нет во встроенной базе (например, «Физика, 8 класс»): пустой, уроки добавляет учитель */
  function getCourse(key){
    if (!key) return null;
    const C = window.COURSES = window.COURSES || {};
    if (C[key]) return C[key];
    const cat = window.CATALOG?.[key];
    if (cat) return C[key] = {...cat, subject: subjectOf(key), kind: "builtin", virtual: true, locked: true,
      blocks: {own: {name: "Уроки", tasks: "", color: "#8b5cf6"}}, lessons: [], events: [], texts: {}, izl: {}, criteria: window.RUS_CRITERIA || {errors: [], essay: [], izl: []},
      methodology: [{h: "Встроенная база", t: `Готовый курс: ${cat.n} уроков с теорией, мини-практикой, заданиями и тестами. Открывается в тарифе с материалами.`}]};
    const m = String(key).match(/^(oge|ege)-(\w+)$|^(\w+)-(\d+)$/); if (!m) return null;
    const S = subj(m[2] || m[3]), exam = m[1], g = m[4];
    if (!SUBJECTS.some(x => x.k === (m[2] || m[3]))) return null;
    const rusCrit = window.RUS_CRITERIA || {errors: [], essay: [], izl: []};
    return C[key] = {course: exam ? `Подготовка к ${exam.toUpperCase()}. ${S.n}` : `${S.n}, ${gradeName(g)}`, tag: exam ? exam.toUpperCase() : gradeName(g),
      subject: S.k, grade: exam ? (exam === "oge" ? 9 : 11) : +g, goal: exam ? exam.toUpperCase() : "Школа", kind: "own", virtual: true,
      blocks: {own: {name: "Уроки", tasks: "", color: "#8b5cf6"}}, lessons: [], events: [], texts: {}, izl: {}, criteria: rusCrit,
      methodology: [{h: "Курс", t: "Это ваш курс: уроки, материалы, задания и тесты добавляете вы (или составляет нейросеть) в разделе «Материалы и база». Строение урока то же: теория маленькими блоками → примеры → мини-практика → задания → тест."}]};
  }
  /* все курсы предмета: встроенные и пустые по классам */
  function coursesOf(subject){
    const S = subj(subject), keys = [];
    S.g.forEach(g => { if (subject === "rus" && g === 9) keys.push("oge-rus"); keys.push(S.k + "-" + g); if (S.exam && g === 9 && subject !== "rus") keys.push("oge-" + S.k); });
    if (S.exam) keys.push("ege-" + S.k);
    return [...new Set(keys)].filter(k => getCourse(k));
  }
  /* встроенная база приходит из Supabase (по подписке) */
  function loadBase(rows){
    window.COURSES = window.COURSES || {};
    (rows || []).forEach(r => { window.COURSES[r.key] = r.data; if (r.keys){ window.COURSE_KEYS = window.COURSE_KEYS || {}; window.COURSE_KEYS[r.key] = r.keys; } });
    if (U.applyTheme && U.theme) U.applyTheme(U.theme().k);   // перекрасить разделы новых курсов в цвета темы
  }
  const packOf = course => { const c = getCourse(course); if (!c || (c.virtual && !c.locked)) return null; return /^rus-\d+$/.test(course) ? "school-rus" : course; };
  const PACKS = {"oge-rus":"Подготовка к ОГЭ", "ege-rus":"Подготовка к ЕГЭ", "school-rus":"Школьная программа 5–11 (ФРП)"};
  const iso = dt => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;

  /* курс ученика: даты (первый урок + еженедельно, плюс правки отдельных дат), свои уроки и материалы учителя */
  function courseFor(p, mats){
    const base = getCourse(p?.course); if (!base) return null;
    const start = p.start_date ? new Date(p.start_date + "T00:00:00") : null, ov = p.dates || {};
    mats = (mats || []).filter(m => m.course === p.course && (!m.student_id || m.student_id === p.id));
    const own = mats.filter(m => m.kind === "lesson").map(m => ({...emptyLesson(), ...m.data, id: m.lesson_id, custom: true, mid: m.id}));
    let lessons = base.lessons.map((l, i) => ({...l, date: start ? iso(new Date(start.getTime() + i * 7 * 864e5)) : l.date}));
    lessons = [...lessons, ...own].map(l => ({...l, date: ov[l.id] || l.date, materials: mats.filter(m => m.kind !== "lesson" && m.lesson_id === l.id)}))
      .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    return {...base, events: start ? (base.events || []).filter(e => e.kind === "exam") : base.events, lessons};
  }
  function emptyLesson(){ return {block: "own", oge: "Свой урок", title: "Новый урок", learn: [], theory: [], practice: [], test: [], hwtest: [], hw: "", writing: null, stub: true}; }

  /* задания из материала «tasks» (свои или от нейросети): {mini:[{q,a}], test:[{q,o,a,e}]} */
  function lessonTests(l){
    const extra = (l.materials || []).filter(m => m.kind === "tasks");
    return {test: [...(l.test || []), ...extra.flatMap(m => m.data?.test || [])], mini: extra.flatMap(m => m.data?.mini || [])};
  }

  /* скачать урок как документ Word: «Тема – рабочий лист» и отдельно «Тема – ключи» */
  function downloadDoc(name, html){
    const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(name)}</title>
      <style>body{font-family:"Times New Roman";font-size:14pt;line-height:1.4}h1{font-size:18pt}h2,h3{font-size:15pt}.ttext,.ex,.scheme{background:#f3eefc;padding:6pt}.blank{border-bottom:1px solid #999;height:20pt}table{border-collapse:collapse}td,th{border:1px solid #999;padding:3pt}.key{color:#1c6b3f}</style></head><body>${html}</body></html>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff", doc], {type: "application/msword"}));
    a.download = name.replace(/[\\/:*?"<>|]/g, "") + ".doc"; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function lessonDocHTML(l, withKeys){
    const strip = h => h.replace(/<button[\s\S]*?<\/button>/g, "").replace(/<input[^>]*>/g, '<span class="blank"></span>');
    return `<h1>${esc(l.title)}</h1><p>${esc(l.oge || "")} · ${fmt(l.date)}</p>${strip(theoryHTML(l, withKeys))}
      ${l.practice?.length ? `<h2>Практика</h2>${practiceHTML(l, withKeys)}` : ""}${l.hw ? `<h2>Домашнее задание</h2><p>${esc(l.hw)}</p>` : ""}`;
  }

  /* ---------- входы и пароли ---------- */
  /* поле пароля с «глазком» */
  const pass = (id, attrs = "") => `<div class="passbox"><input type="password" id="${id}" ${attrs}><button type="button" class="eye" data-eye="${id}" aria-label="Показать пароль" title="Показать пароль">👁</button></div>`;
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-eye]"); if (!b) return;
    const i = document.getElementById(b.dataset.eye); if (!i) return;
    const show = i.type === "password"; i.type = show ? "text" : "password";
    b.classList.toggle("on", show); b.setAttribute("aria-label", show ? "Скрыть пароль" : "Показать пароль"); i.focus();
  });
  /* понятные ошибки входа */
  function authErr(e){
    const m = String(e?.message || e || "");
    if (e?.name === "TypeError" || /fetch|network|load failed/i.test(m)) return "Нет связи с сервером. Проверьте интернет; если не помогает – попробуйте с VPN или другим интернетом (у некоторых операторов сервер недоступен).";
    if (/invalid login|invalid_grant|credentials/i.test(m)) return "Неверная почта или пароль.";
    if (/not confirmed/i.test(m)) return "Почта ещё не подтверждена: откройте письмо и нажмите ссылку. Письма нет – нажмите «Отправить письмо ещё раз».";
    if (/already registered|exists/i.test(m)) return "Эта почта уже зарегистрирована – войдите.";
    if (/rate limit|too many/i.test(m)) return "Слишком много попыток за короткое время. Подождите немного и попробуйте снова.";
    if (/password.*(6|8|short|least)/i.test(m)) return "Пароль слишком короткий.";
    if (/email.*(invalid|valid)/i.test(m)) return "Проверьте адрес почты.";
    if (/same|different/i.test(m)) return "Новый пароль должен отличаться от старого.";
    return m || "Что-то пошло не так. Попробуйте ещё раз.";
  }
  /* одноразовые почтовые ящики не принимаем */
  const tempMail = email => /@(mailinator|guerrillamail|sharklasers|10minutemail|tempmail|temp-mail|tmpmail|yopmail|throwawaymail|trashmail|getnada|dispostable|fakeinbox|maildrop|mohmal|emailondeck|moakt|mail\.tm|burnermail|dropmail|1secmail|minuteinbox|tempail|emailfake|fakemail|discard|33mail)\./i.test(email);
  const siteURL = page => location.origin + location.pathname.replace(/[^/]*$/, "") + (page || "");

  const randHex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, "0")).join("");

  function shuffle(a){ a = a.slice(); for (let i = a.length-1; i > 0; i--){ const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]] = [a[j],a[i]]; } return a; }

  function toast(t){ const el = document.getElementById("toast"); if (!el) return; el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2600); }

  function genCode(){
    const a = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let s = "";
    const r = crypto.getRandomValues(new Uint32Array(7)); r.forEach(x => s += a[x % a.length]); return s;
  }

  const supa = () => {
    const c = window.APP_CONFIG || {};
    if (!c.SUPABASE_URL || !c.SUPABASE_ANON_KEY || c.SUPABASE_URL.includes("ВАШ") || !window.supabase) return null;
    return window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY, {realtime: {params: {eventsPerSecond: 50}}});
  };

  return {goalsFor, goalsHTML, goalLabel, pass, authErr, tempMail, siteURL, loadBase, SUBJECTS, subj, gradeName, subjectOf, getCourse, coursesOf, miniCheck, miniHTML, GOALS, planFor, packOf, PACKS, iso, emptyLesson, lessonTests, downloadDoc, lessonDocHTML, courseFor, randHex, KIND_NAME, wordCount, stepHTML, writingSource, critFor, writingResultHTML, writingStats, sparkHTML, esc, d, today, fmt, fmtShort, daysTo, pct, lvl, lvlColor, mark, aggregate, recText, hwState, blockStats, weakTags, avgAll, theoryHTML, practiceHTML, shuffle, toast, genCode, supa};
})();
