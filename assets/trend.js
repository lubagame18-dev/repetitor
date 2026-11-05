/* Динамика успеваемости: волнистая линия результатов занятий/тем от начала до текущего занятия.
   Общий модуль для ученика (assets/student.js) и учителя (assets/teacher.js). */
window.Trend = (() => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const KIND = {lesson:"тест урока", hw:"ДЗ-тест", mini:"мини-практика", entry:"входной тест", self:"самообучение", oge:"ОГЭ", quiz:"тест по темам", test:"тест"};

  /* строки результатов -> точки графика: [{p, label, sub, at, kind}] */
  function pointsFromRows(rows, opts = {}){
    const titleOf = typeof opts.titleOf === "function" ? opts.titleOf : () => "";
    const out = (rows || []).filter(r => r && +r.total > 0).map(r => {
      const total = +r.total || 1, score = Math.max(0, Math.min(total, +r.score || 0));
      return {
        p: Math.round(score / total * 100),
        label: String(titleOf(r) || KIND[r.kind] || "занятие").slice(0, 80),
        sub: `${score} из ${total}`,
        at: r.created_at || r.at || "",
        kind: r.kind || "",
      };
    }).sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
    return out.slice(-(opts.limit || 30));
  }
  /* точки quiz_results (у теста по темам нет kind, но есть title) */
  function pointsFromQuizzes(list, opts = {}){
    const rows = (list || []).map(q => ({lesson_id: q.quiz_id || "", kind: "quiz", score: q.score, total: q.total, created_at: q.created_at || q.at || ""}));
    return pointsFromRows(rows, {limit: opts.limit || 30, titleOf: r => (opts.titleOf && opts.titleOf(r)) || "тест по темам"});
  }
  function smoothPath(pts){
    if (!pts.length) return "";
    if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
    let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++){
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return d;
  }
  function chart(points, opts = {}){
    const data = (points || []).filter(x => x && Number.isFinite(+x.p));
    if (!data.length) return `<div class="card trend" data-trend data-points="0"><div class="kicker">${esc(opts.title || "Динамика успеваемости")}</div><p class="small muted" style="margin-top:6px">${esc(opts.empty || "График появится, когда пройдено первое занятие.")}</p></div>`;
    const W = 720, H = 230, L = 36, R = 18, T = 16, B = 38, iw = W - L - R, ih = H - T - B;
    const n = data.length;
    const pts = data.map((d, i) => ({
      ...d,
      x: L + (n === 1 ? iw / 2 : iw * i / (n - 1)),
      y: T + ih * (1 - Math.max(0, Math.min(100, +d.p)) / 100),
    }));
    const line = smoothPath(pts);
    const area = `${line} L${pts[n - 1].x.toFixed(1)},${(T + ih).toFixed(1)} L${pts[0].x.toFixed(1)},${(T + ih).toFixed(1)} Z`;
    const grid = [0, 25, 50, 75, 100].map(v => {
      const y = T + ih * (1 - v / 100);
      return `<line x1="${L}" y1="${y.toFixed(1)}" x2="${W - R}" y2="${y.toFixed(1)}" class="trend-grid"/><text x="${L - 8}" y="${(y + 4).toFixed(1)}" class="trend-y" text-anchor="end">${v}</text>`;
    }).join("");
    const step = Math.max(1, Math.ceil(n / 6));
    const labels = pts.map((p, i) => (i % step === 0 || i === n - 1)
      ? `<text x="${p.x.toFixed(1)}" y="${H - 12}" class="trend-x" text-anchor="middle">${esc(String(p.label || "").slice(0, 14))}</text>` : "").join("");
    const dots = pts.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.2" class="trend-dot" data-p="${p.p}"><title>${esc(p.label)}: ${p.p}% (${esc(p.sub || "")}) · ${esc(String(p.at || "").slice(0, 10))}</title></circle>`).join("");
    const last = pts[n - 1], first = pts[0];
    const delta = n > 1 ? last.p - first.p : 0;
    const trendWord = n < 2 ? "" : delta > 5 ? `рост +${delta}%` : delta < -5 ? `снижение ${delta}%` : "стабильно";
    return `<div class="trend" data-trend data-points="${n}" data-last="${last.p}" data-first="${first.p}">
      <div class="row between" style="gap:8px;flex-wrap:wrap;align-items:flex-start"><div><div class="kicker">${esc(opts.title || "Динамика успеваемости")}</div>
        <div class="small muted">по темам и занятиям от начала до текущего · ${n} ${n === 1 ? "точка" : n < 5 ? "точки" : "точек"}${trendWord ? " · " + trendWord : ""}</div></div>
        <span class="chip ${delta < -5 ? "bad" : delta > 5 ? "good" : ""}">сейчас ${last.p}%</span></div>
      <svg class="trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title || "Динамика успеваемости")}: линия результатов занятий">
        ${grid}
        <path d="${area}" class="trend-area"/>
        <path d="${line}" class="trend-line"/>
        ${dots}
        ${labels}
      </svg>
      <div class="small muted trend-legend">${esc(first.label)} — ${first.p}% · ${esc(last.label)} — ${last.p}%${n > 1 ? ` · ${delta >= 0 ? "+" : ""}${delta}%` : ""}</div>
    </div>`;
  }
  /* подключить стили один раз */
  try {
    if (!document.getElementById("trend-css")){
      const st = document.createElement("style");
      st.id = "trend-css";
      st.textContent = `.trend{background:var(--glass-2);border:1px solid var(--line);border-radius:18px;padding:12px 14px 8px}
.trend .row{margin-bottom:2px}.trend-svg{display:block;width:100%;height:auto;margin-top:6px;overflow:visible}
.trend-grid{stroke:var(--hair,#e6e1f0);stroke-width:1;stroke-dasharray:3 4}
.trend-y{fill:var(--muted,#8a839c);font-size:11px;font-weight:700}
.trend-x{fill:var(--muted,#8a839c);font-size:11px}
.trend-area{fill:color-mix(in srgb,var(--violet,#7b4cf5) 14%,transparent);stroke:none}
.trend-line{fill:none;stroke:var(--violet,#7b4cf5);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.trend-dot{fill:var(--glass-2,#fff);stroke:var(--violet,#7b4cf5);stroke-width:2.5}
.trend-dot:hover{fill:var(--violet,#7b4cf5)}
.trend-legend{margin-top:2px}
@media (max-width:560px){.trend{padding:10px 10px 6px}.trend-x{font-size:10px}}`;
      document.head.appendChild(st);
    }
  } catch(_) {}
  return {pointsFromRows, pointsFromQuizzes, chart, smoothPath};
})();
