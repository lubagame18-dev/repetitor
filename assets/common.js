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
      <div class="legend-signs muted"><span><span class="u-s">подлежащее</span></span><span><span class="u-p">сказуемое</span></span><span><span class="u-o">дополнение</span></span><span><span class="u-w">определение</span></span><span><span class="u-a">обстоятельство</span></span><span><span class="u-x">слово</span> – определяемое</span></div>
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

  /* план по классу и целям */
  const GOALS = ["ОГЭ","ЕГЭ","ВПР","Контрольные и домашние","Олимпиада"];
  function planFor(grade, goals){
    goals = goals || [];
    if (+grade === 9 && goals.includes("ОГЭ")) return "oge-rus";
    if (+grade >= 10 && goals.includes("ЕГЭ")) return "ege-rus";
    return "rus-" + grade;
  }
  const packOf = course => /^rus-\d+$/.test(course) ? "school-rus" : course;
  const PACKS = {"oge-rus":"Подготовка к ОГЭ", "ege-rus":"Подготовка к ЕГЭ", "school-rus":"Школьная программа 5–11 (ФРП)"};
  const iso = dt => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;

  /* курс ученика: даты (первый урок + еженедельно, плюс правки отдельных дат), свои уроки и материалы учителя */
  function courseFor(p, mats){
    const base = window.COURSES?.[p?.course]; if (!base) return null;
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

  return {miniCheck, miniHTML, GOALS, planFor, packOf, PACKS, iso, emptyLesson, lessonTests, downloadDoc, lessonDocHTML, courseFor, randHex, KIND_NAME, wordCount, stepHTML, writingSource, critFor, writingResultHTML, writingStats, sparkHTML, esc, d, today, fmt, fmtShort, daysTo, pct, lvl, lvlColor, mark, aggregate, recText, hwState, blockStats, weakTags, avgAll, theoryHTML, practiceHTML, shuffle, toast, genCode, supa};
})();
