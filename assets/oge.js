/* «Мой ОГЭ»: задания экзамена, уровень по каждому, самооценка, отработка слабых зон и пробный вариант тестовой части.
   Общий для ученика (может заниматься) и учителя (только смотрит). */
(() => {
const {esc, lvlColor} = U;
const TASKS = [
  ["1", "Сжатое изложение"], ["2", "Грамматическая основа"], ["3", "Синтаксический анализ"], ["4", "Пунктуационный анализ"], ["5", "Запятые в предложении"],
  ["6", "Орфографический анализ"], ["7", "Пропущенные буквы"], ["8", "Грамматические нормы"], ["9", "Словосочетание"], ["10", "Анализ содержания текста"],
  ["11", "Средства выразительности"], ["12", "Лексический анализ"], ["13", "Сочинение-рассуждение"], ["С", "Итоговое собеседование"]];
const isOge = c => !!c && (c.goal === "ОГЭ" || /ОГЭ/.test(c.tag || "")) && c.lessons.some(l => /Задани/.test(l.oge || ""));
/* номера заданий по подписи урока: «Задание 3–5 · …», «Задания 1 и 13 · …», «Собеседование · …» */
function tasksOf(l){
  const s = l.oge || "";
  if (/Собеседован/.test(s)) return ["С"];
  const m = s.match(/Задани[ея]\s+(\d+)(?:\s*[–-]\s*(\d+))?(?:\s+и\s+(\d+))?/); if (!m) return [];
  const a = +m[1], b = m[2] ? +m[2] : a, out = [];
  for (let i = a; i <= b; i++) out.push(String(i));
  if (m[3]) out.push(m[3]);
  return out;
}
const P = r => Math.round(r.score / r.total * 100);
function stats(c, rows, writings){
  const by = Object.fromEntries(TASKS.map(([n]) => [n, {vals: [], lessons: [], drills: [], rate: null}]));
  c.lessons.forEach(l => tasksOf(l).forEach(n => by[n]?.lessons.push(l)));
  const last = (kind, lid) => rows.filter(r => r.kind === kind && r.lesson_id === lid).at(-1);
  TASKS.forEach(([n]) => {
    const x = by[n];
    x.lessons.forEach(l => { const a = last("lesson", l.id), b = last("hw", l.id); if (a) x.vals.push(P(a)); if (b) x.vals.push(P(b));
      const sd = rows.filter(r => /^self:(quiz|trainer|tf|games):/.test(r.lesson_id || "") && r.lesson_id.endsWith(":" + l.id)).at(-1); if (sd) x.vals.push(P(sd)); });
    x.drills = rows.filter(r => r.lesson_id === "oge:" + n); x.drills.slice(-3).forEach(r => x.vals.push(P(r)));
    const rate = rows.filter(r => r.lesson_id === "oge:rate:" + n).at(-1); x.rate = rate ? rate.score : null;
  });
  const W = Object.values(writings || {}).filter(w => w.max > 0);
  W.filter(w => w.kind === "izl").forEach(w => by["1"].vals.push(Math.round(w.total / w.max * 100)));
  W.filter(w => w.kind !== "izl").forEach(w => by["13"].vals.push(Math.round(w.total / w.max * 100)));
  /* в тестовой части пробника каждое задание – отдельный вопрос с тегом «Задание N» */
  rows.filter(r => r.lesson_id === "oge:mock").slice(-2).forEach(r => {
    const per = Math.max(1, Math.round(r.total / 11)), wrong = {};
    (r.wrong || []).forEach(w => { const n = (String(w).match(/\(Задание (\d+)\)/) || [])[1]; if (n) wrong[n] = (wrong[n] || 0) + 1; });
    TASKS.slice(1, 12).forEach(([n]) => by[n].vals.push(Math.max(0, Math.round(100 * (1 - (wrong[n] || 0) / per)))));
  });
  TASKS.forEach(([n]) => { const v = by[n].vals; by[n].p = v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; });
  /* прогноз: тестовая часть 2–12 (по 1 баллу) + изложение (7) + сочинение (8 по проекту 2027 года); грамотность – отдельно */
  const part = (n, max) => by[n].p != null ? by[n].p / 100 * max : null;
  const test = TASKS.slice(1, 12).map(([n]) => part(n, 1)), known = test.filter(x => x != null);
  const izl = part("1", 7), ess = part("13", 8);
  const errs = {}; W.forEach(w => Object.entries(w.errors || {}).forEach(([k, v]) => errs[k] = (errs[k] || 0) + (+v || 0)));
  return {by, forecast: {test: known.length ? Math.round(known.reduce((a, b) => a + b, 0) / known.length * 11) : null, testKnown: known.length, izl: izl != null ? Math.round(izl) : null, ess: ess != null ? Math.round(ess) : null},
    errsPerWork: W.length ? Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, Math.round(v / W.length * 10) / 10])) : null, works: W.length};
}
const level = p => p == null ? {t: "нет данных", c: ""} : p < 50 ? {t: "слабая зона", c: "bad"} : p < 75 ? {t: "нужно закрепить", c: "mid"} : {t: "уверенно", c: "good"};
function compare(rate, p){
  if (rate == null || p == null) return "";
  const self = (rate - 1) * 25;   // 1…5 → 0…100
  if (self - p >= 35) return `<p class="small" style="color:var(--bad);margin-top:6px">Ты оцениваешь себя выше, чем показывают результаты (${p}%). Сделай отработку – проверь себя.</p>`;
  if (p - self >= 35) return `<p class="small" style="color:var(--good);margin-top:6px">Ты знаешь лучше, чем думаешь: результат ${p}%. Можно смелее!</p>`;
  return `<p class="small muted" style="margin-top:6px">Самооценка совпадает с результатами.</p>`;
}
function html(c, rows, writings, opts = {}){
  if (!isOge(c)) return "";
  const st = stats(c, rows, writings), me = !opts.teacher, F = st.forecast;
  const weak = TASKS.map(([n, name]) => ({n, name, ...st.by[n]})).filter(x => x.p != null && x.p < 75 && x.n !== "С").sort((a, b) => a.p - b.p).slice(0, 3);
  const untouched = TASKS.filter(([n]) => n !== "С" && st.by[n].p == null && st.by[n].lessons.some(l => opts.isOpen ? opts.isOpen(l) : true)).map(([n]) => n);
  const sum = [F.test, F.izl, F.ess].filter(x => x != null);
  const ep = st.errsPerWork, EN = {orf: "орфогр.", punct: "пункт.", gram: "грамм.", speech: "речевых"};
  return `<div class="grid2 stats">
    <div class="card"><div class="kicker">Прогноз без грамотности</div><div class="big tnum" style="margin-top:6px">${sum.length ? sum.reduce((a, b) => a + b, 0) : "–"}<span class="small muted"> из 26</span></div>
      <div class="small muted">тест 2–12: ${F.test ?? "–"} из 11${F.testKnown && F.testKnown < 11 ? ` (по ${F.testKnown} заданиям)` : ""} · изложение: ${F.izl ?? "–"} из 7 · сочинение: ${F.ess ?? "–"} из 8</div></div>
    <div class="card"><div class="kicker">Грамотность (ГК1–ГК4)</div><div class="big tnum" style="margin-top:6px">${st.works ? st.works + " раб." : "–"}</div>
      <div class="small muted">${ep ? "ошибок на работу: " + Object.entries(EN).map(([k, n]) => `${ep[k] ?? 0} ${n}`).join(", ") : "оценит учитель по изложениям и сочинениям"}</div></div></div>
  <div class="card" style="margin-top:12px"><p class="small">Для «5» нужно 33 из 37 баллов (по проекту 2027 года – из 38) и не меньше 9 баллов за грамотность, для «4» – от 26 баллов и не меньше 6 за грамотность.</p>
    ${weak.length ? `<div class="kicker" style="margin-top:10px">Что отработать в первую очередь</div><div class="row" style="margin-top:6px">${weak.map(x => `<span class="chip bad">№ ${x.n} · ${esc(x.name)} · ${x.p}%</span>${me ? `<button class="btn sm" data-oge-drill="${x.n}">Отработать</button>` : ""}`).join("")}</div>` : ""}
    ${untouched.length ? `<p class="small muted" style="margin-top:8px">Ещё без результатов: задания ${untouched.join(", ")}.</p>` : ""}
    ${me ? `<div class="row" style="margin-top:12px"><button class="btn yellow" data-oge-mock>📝 Пробный вариант: задания 2–12</button></div>` : ""}</div>
  <div class="oge-grid">${TASKS.map(([n, name]) => { const x = st.by[n], lv = level(x.p);
    return `<div class="card oge-task"><div class="row between" style="flex-wrap:nowrap"><span class="oge-n">${n === "С" ? "С" : "№ " + n}</span><span class="chip ${lv.c}">${lv.t}</span></div>
      <b style="display:block;margin-top:6px">${esc(name)}</b>
      <div class="bar" style="margin-top:6px"><span class="small muted">${x.vals.length} рез.${x.drills.length ? ` · отработок: ${x.drills.length}` : ""}</span><span class="tnum" style="text-align:right;font-weight:800;color:${x.p != null ? lvlColor(x.p) : "var(--muted)"}">${x.p != null ? x.p + "%" : "–"}</span><span class="track"><i style="width:${x.p || 0}%;background:${lvlColor(x.p)}"></i></span></div>
      <div class="small" style="margin-top:8px">${me ? "Насколько ты уверен?" : "Самооценка ученика:"} <span class="oge-rate" role="group" aria-label="Самооценка задания ${n}">${[1, 2, 3, 4, 5].map(k => me ? `<button class="${x.rate >= k ? "on" : ""}" data-oge-rate="${n}" data-v="${k}" aria-label="${k} из 5">★</button>` : `<i class="${x.rate >= k ? "on" : ""}">★</i>`).join("")}</span></div>
      ${compare(x.rate, x.p)}
      ${me ? `<div class="row" style="margin-top:8px;gap:6px">${x.lessons.length && n !== "С" ? `<button class="btn ghost sm" data-oge-drill="${n}">Отработать</button>` : ""}${x.lessons[0] && (!opts.isOpen || opts.isOpen(x.lessons[0])) ? `<button class="btn ghost sm" data-open="${x.lessons[0].id}">Теория</button>` : ""}</div>` : ""}</div>`; }).join("")}</div>`;
}
/* вопросы для отработки: из тестов и ДЗ-тестов уроков задания (сначала – открытые уроки) */
function drillQs(c, n, isOpen){
  const ls = c.lessons.filter(l => tasksOf(l).includes(n)), open = ls.filter(l => !isOpen || isOpen(l));
  return Play.quizFromLessons(open.length ? open : ls).map(q => ({...q, tag: q.tag || q.lt}));
}
function mockQs(c, isOpen){
  const out = [];
  TASKS.slice(1, 12).forEach(([n]) => { const qs = U.shuffle(drillQs(c, n, isOpen)).slice(0, 2); qs.forEach(q => out.push({...q, tag: "Задание " + n})); });
  return out;
}
window.OGE = {TASKS, isOge, tasksOf, stats, html, drillQs, mockQs};
})();
