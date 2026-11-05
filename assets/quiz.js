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

  /* агрегат по темам из попыток: [{details:{topics:[{id,title,total,ok,first,needsWork}]}, ...}] */
  function topicStats(results){
    const map = new Map();
    (results || []).forEach(r => {
      const topics = r?.details?.topics;
      if (!Array.isArray(topics)) return;
      topics.forEach(t => {
        if (!t || !t.title) return;
        const key = t.id || t.title;
        const o = map.get(key) || {id: t.id || "", title: String(t.title), total: 0, ok: 0, first: 0, attempts: 0, needs: 0};
        o.total += +t.total || 0; o.ok += +t.ok || 0; o.first += +t.first || 0;
        o.attempts += 1; if (t.needsWork) o.needs += 1;
        map.set(key, o);
      });
    });
    return [...map.values()].map(o => ({
      ...o,
      pct: o.total ? Math.round(o.ok / o.total * 100) : 0,
      firstPct: o.total ? Math.round(o.first / o.total * 100) : 0,
    })).sort((a, b) => a.pct - b.pct || a.firstPct - b.firstPct || a.title.localeCompare(b.title));
  }

  /* визуальная карта тем: слабые сверху, полоска — доля верных, красным — темы на доработку */
  function graphHTML(stats, opts){
    opts = opts || {};
    if (!stats || !stats.length) return `<p class="small muted">${esc(opts.empty || "Пока нет результатов тестов по темам – соберите тест, и здесь появится карта.")}</p>`;
    const weak = stats.filter(s => s.needs > 0 || s.pct < 60);
    return `<div class="qz-graph">
      <div class="qz-graph-legend small muted"><span><i class="qz-dot good"></i> освоено</span><span><i class="qz-dot mid"></i> повторить</span><span><i class="qz-dot bad"></i> надо доработать</span></div>
      ${stats.map(s => {
        const bad = s.needs > 0 || s.pct < 60, mid = !bad && (s.pct < 80);
        return `<div class="qz-topic ${bad ? "bad" : mid ? "mid" : "good"}" title="Верно ${s.ok} из ${s.total} ответов; с первой попытки ${s.first} из ${s.total}">
          <div class="qz-topic-row"><b>${esc(s.title)}</b><span class="chip ${bad ? "bad" : mid ? "mid" : "good"}">${s.pct}%</span></div>
          <div class="qz-bar"><i style="width:${Math.max(2, s.pct)}%"></i></div>
          <div class="small muted">попыток: ${s.attempts} · с первой попытки: ${s.firstPct}%${s.needs ? " · ошибок после повтора: " + s.needs : ""}</div>
        </div>`;
      }).join("")}
      ${weak.length ? `<div class="qz-need small"><b>Надо доработать:</b> ${weak.map(s => esc(s.title)).join("; ")}</div>` : `<div class="qz-need ok small"><b>Все темы освоены.</b> Можно переходить к новым.</div>`}
    </div>`;
  }

  /* краткий итог по темам одной попытки (для сохранения в quiz_results.details) */
  function summarize(questions, log){
    const map = new Map();
    questions.forEach((q, i) => {
      const row = log[i] || {};
      const key = q.topicId || q.topic || ("q" + i);
      const o = map.get(key) || {id: q.topicId || "", title: q.topic || "Без темы", total: 0, ok: 0, first: 0, needsWork: false};
      o.total += 1; if (row.ok) o.ok += 1; if (row.first) o.first += 1;
      if (!row.ok) o.needsWork = true;
      map.set(key, o);
    });
    return [...map.values()];
  }

  return {newId, link, questionsFromTests, normQuestions, topicStats, graphHTML, summarize};
})();
