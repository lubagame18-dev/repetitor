/* Тесты по темам: сборка вопросов, ссылка, подсчёт ошибок по темам и визуальная карта.
   Используется кабинетом учителя (assets/teacher.js) и приложением ученика (assets/student.js). */
window.Quiz = (() => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const ALPHA = "abcdefghijkmnpqrstuvwxyz23456789";

  /* короткий код теста для ссылки index.html?quiz=КОД */
  function newId(n = 10){
    const r = crypto.getRandomValues(new Uint8Array(n));
    return [...r].map(x => ALPHA[x % ALPHA.length]).join("");
  }
  function link(id){
    try { const u = new URL("index.html", location.href); u.hash = ""; u.search = "?quiz=" + encodeURIComponent(id); return u.href; }
    catch(_){ return location.origin + "/index.html?quiz=" + encodeURIComponent(id); }
  }

  /* вопросы из теста урока (массив l.test): {q, o:[...], a:index, e:"объяснение", tag:"тема"} */
  function questionsFromTests(list, topic, topicId){
    const out = [];
    (list || []).forEach(q => {
      if (!q || !q.q) return;
      if (!Array.isArray(q.o) || q.o.length < 2) return;      // pn/сложные форматы пропускаем
      const a = +q.a;
      if (!Number.isInteger(a) || a < 0 || a >= q.o.length) return;
      out.push({
        q: String(q.q).slice(0, 500),
        o: q.o.slice(0, 6).map(x => String(x).slice(0, 200)),
        a, e: String(q.e || q.tag || "").slice(0, 500),
        topic: String(topic || "").slice(0, 120), topicId: String(topicId || ""),
      });
    });
    return out;
  }

  /* сколько тем и вопросов в тесте */
  function normQuestions(data){
    const src = Array.isArray(data?.questions) ? data.questions : [];
    return src.filter(q => q && q.q && Array.isArray(q.o) && q.o.length >= 2 && Number.isInteger(+q.a) && +q.a >= 0 && +q.a < q.o.length)
      .map(q => ({q: String(q.q), o: q.o.map(String), a: +q.a, e: String(q.e || ""), topic: String(q.topic || ""), topicId: String(q.topicId || "")}));
  }

  /* агрегат по темам из попыток: [{created_at, details:{topics:[{id,title,total,ok,first,needsWork}]}, ...}]
     pct – общий процент по всем попыткам; lastPct/prevPct – по последней и предыдущей попытке (для динамики) */
  function topicStats(results){
    const map = new Map();
    const list = (results || []).map((r, i) => ({r, i, at: r && r.created_at ? Date.parse(r.created_at) || 0 : 0}))
      .sort((x, y) => (x.at - y.at) || (y.i - x.i)).map(x => x.r);          /* от старых к новым */
    list.forEach(r => {
      const topics = r?.details?.topics;
      if (!Array.isArray(topics)) return;
      topics.forEach(t => {
        if (!t || !t.title) return;
        const key = t.id || t.title;
        const o = map.get(key) || {id: t.id || "", title: String(t.title), total: 0, ok: 0, first: 0, attempts: 0, needs: 0, hist: []};
        o.total += +t.total || 0; o.ok += +t.ok || 0; o.first += +t.first || 0;
        o.attempts += 1; if (t.needsWork) o.needs += 1;
        o.hist.push({p: (+t.total) ? Math.round((+t.first || 0) / (+t.total) * 100) : 0, nw: !!t.needsWork});
        map.set(key, o);
      });
    });
    return [...map.values()].map(o => {
      const last = o.hist[o.hist.length - 1], prev = o.hist.length > 1 ? o.hist[o.hist.length - 2] : null;
      return {
        ...o,
        pct: o.total ? Math.round(o.ok / o.total * 100) : 0,
        firstPct: o.total ? Math.round(o.first / o.total * 100) : 0,
        lastPct: last.p, lastNeeds: last.nw, prevPct: prev ? prev.p : null,
        delta: prev ? last.p - prev.p : null,
      };
    }).sort((a, b) => a.lastPct - b.lastPct || a.title.localeCompare(b.title));
  }
  const topicLevel = s => (s.lastNeeds || s.lastPct < 60) ? "bad" : s.lastPct < 80 ? "mid" : "good";

  /* карта тем: слабые сверху, у каждой темы – процент, стрелка к прошлой попытке и полоска; ниже коротко «что пройти» */
  function graphHTML(stats, opts){
    opts = opts || {};
    if (!stats || !stats.length) return `<p class="small muted">${esc(opts.empty || "Пока нет результатов тестов по темам – соберите тест, и здесь появится карта.")}</p>`;
    const lv = stats.map(topicLevel);
    const bad = stats.filter((s, i) => lv[i] === "bad"), mid = stats.filter((s, i) => lv[i] === "mid");
    const arrow = s => s.delta == null ? "" : s.delta > 0 ? `<span class="small" style="color:var(--good,#1a8f4a)" title="было ${s.prevPct}%">↑ +${s.delta}</span>` : s.delta < 0 ? `<span class="small" style="color:var(--bad,#c0392b)" title="было ${s.prevPct}%">↓ ${Math.abs(s.delta)}</span>` : `<span class="small muted" title="было ${s.prevPct}%">=</span>`;
    return `<div class="qz-graph">
      <div class="qz-graph-legend small muted"><span><i class="qz-dot good"></i> от 80%</span><span><i class="qz-dot mid"></i> 60–79%</span><span><i class="qz-dot bad"></i> ниже 60%</span></div>
      ${stats.map((s, i) => `<div class="qz-topic ${lv[i]}" title="Всего верно ${s.ok} из ${s.total}; попыток: ${s.attempts}">
          <div class="qz-topic-row"><b>${esc(s.title)}</b><span class="row" style="gap:8px;align-items:center">${arrow(s)}<span class="chip ${lv[i]}">${s.lastPct}%</span></span></div>
          <div class="qz-bar"><i style="width:${Math.max(2, s.lastPct)}%"></i></div>
        </div>`).join("")}
      <div class="qz-need ${bad.length || mid.length ? "" : "ok"} small">${bad.length ? `<div><b>Надо доработать:</b> ${bad.map(s => esc(s.title)).join("; ")}</div>` : ""}${mid.length ? `<div><b>Закрепить:</b> ${mid.map(s => esc(s.title)).join("; ")}</div>` : ""}${bad.length || mid.length ? "" : "<b>Все темы освоены.</b> Можно переходить к новым."}</div>
      <p class="small muted" style="margin:6px 0 0">Процент – верные ответы с первой попытки в последнем тесте; стрелка – изменение к прошлому.</p>
    </div>`;
  }

  /* краткий итог по темам одной попытки (для сохранения в quiz_results.details) */
  function summarize(questions, log){
    const map = new Map();
    questions.forEach((q, i) => {
      const row = log[i] || {};
      const key = q.topicId || q.topic || ("q" + i);
      const o = map.get(key) || {id: q.topicId || "", title: q.topic || "Без темы", total: 0, ok: 0, first: 0, needsWork: false};
      o.total += 1; if (row.first) o.ok += 1; if (row.first) o.first += 1;   /* процент – только верные с первой попытки: ошибка снижает результат, даже если исправился */
      if (!row.ok) o.needsWork = true;
      map.set(key, o);
    });
    return [...map.values()];
  }

  return {newId, link, questionsFromTests, normQuestions, topicStats, topicLevel, graphHTML, summarize};
})();
