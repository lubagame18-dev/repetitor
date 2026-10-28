/* Карта успеха: общая для ученика и учителя */
(() => {
const {esc, pct, lvlColor} = U;
function mapHTML(course, results, hwres, writings){
  const blocks = U.blockStats(course, results), hwBlocks = U.blockStats(course, hwres), weak = U.weakTags(course, results), weakHw = U.weakTags(course, hwres);
  const ws = U.writingStats(course, writings);
  const errNames = Object.fromEntries(course.criteria.errors);
  const bar = (name, color, sub, val) => `<div class="bar"><span><i class="dot" style="background:${color}"></i> <b>${esc(name)}</b> <span class="small muted">${esc(sub)}</span></span>
      <span class="tnum" style="text-align:right;font-weight:800;color:${val!=null?lvlColor(val):"var(--muted)"}">${val!=null?val+"%":"–"}</span>
      <span class="track"><i style="width:${val||0}%;background:${lvlColor(val)}"></i></span></div>`;
  const allWeak = {}; [...weak, ...weakHw].forEach(([t,n]) => allWeak[t] = (allWeak[t]||0) + n);
  const weakList = Object.entries(allWeak).sort((a,b) => b[1]-a[1]).slice(0,8);
  return `<div class="grid2 stats">
    <div class="card"><div class="kicker">Тесты на занятиях</div><div class="big tnum" style="margin-top:6px">${U.avgAll(course, results) ?? "–"}${U.avgAll(course, results)!=null?"%":""}</div><div class="small muted">${course.lessons.filter(l => results[l.id]).length} из ${course.lessons.length}</div></div>
    <div class="card"><div class="kicker">Качество ДЗ</div><div class="big tnum" style="margin-top:6px">${U.avgAll(course, hwres) ?? "–"}${U.avgAll(course, hwres)!=null?"%":""}</div><div class="small muted">ДЗ-тестов: ${course.lessons.filter(l => hwres[l.id]).length}</div></div>
    <div class="card"><div class="kicker">Сочинения</div><div class="big tnum" style="margin-top:6px">${ws.essays.length ? Math.round(ws.essays.reduce((a,x) => a + x.w.total/x.w.max*100, 0)/ws.essays.length) + "%" : "–"}</div><div class="small muted">проверено: ${ws.essays.length}</div></div>
    <div class="card"><div class="kicker">Изложения</div><div class="big tnum" style="margin-top:6px">${ws.avgIzl ?? "–"}${ws.avgIzl!=null?"%":""}</div><div class="small muted">проверено: ${ws.izl.length}</div></div>
  </div>
  <div class="section-title"><h2>Письменная линия</h2></div>
  <div class="card stack">
    <div><div class="kicker">Сочинения по неделям</div>${U.sparkHTML(ws.essays)}</div>
    <div class="bars">${bar("Сочинение 13.1", "#e5484d", "средства языка", ws.t131)}${bar("Сочинение 13.2", "#e5484d", "смысл фрагмента", ws.t132)}${bar("Сочинение 13.3", "#e5484d", "нравственный вопрос", ws.t133)}${bar("Изложение", "#ff8a3d", "сжатие", ws.avgIzl)}</div>
    ${Object.keys(ws.errs).length ? `<div><div class="kicker">Ошибки в письменных работах (всего)</div><div class="row" style="margin-top:6px">${Object.entries(ws.errs).map(([k,v]) => `<span class="chip">${esc(errNames[k] || k)}: ${v}</span>`).join("")}</div></div>` : ""}
  </div>
  <div class="section-title"><h2>По блокам ОГЭ</h2></div>
  <div class="card"><div class="legend" style="margin-bottom:10px"><span>верхняя полоса – тесты на занятиях, нижняя – ДЗ-тесты</span></div>
    <div class="bars">${blocks.map((x,i) => `${bar(x.b.name, x.b.color, x.b.tasks + " · занятия", x.avg)}${bar("", "transparent", "домашка", hwBlocks[i].avg)}`).join("")}</div></div>
  <div class="section-title"><h2>Все занятия</h2></div>
  <div class="card">
    <div class="small muted" style="margin-bottom:6px">Занятие</div>
    <div class="heat">${course.lessons.map((l,i) => { const p = pct(results[l.id]?.best); return `<button data-open="${l.id}" data-sub="test" title="${esc(l.title)}" style="background:${lvlColor(p)};color:${p!=null?"#fff":"var(--muted)"}">${i+1}</button>`; }).join("")}</div>
    <div class="small muted" style="margin:12px 0 6px">Домашка</div>
    <div class="heat">${course.lessons.map((l,i) => { const p = pct(hwres[l.id]?.best); return `<button data-open="${l.id}" data-sub="hw" title="${esc(l.title)}" style="background:${lvlColor(p)};color:${p!=null?"#fff":"var(--muted)"}">${i+1}</button>`; }).join("")}</div>
    <div class="legend" style="margin-top:12px"><span><i class="dot" style="background:var(--good)"></i>80–100%</span><span><i class="dot" style="background:var(--mid)"></i>60–79%</span><span><i class="dot" style="background:var(--bad)"></i>ниже 60%</span><span><i class="dot" style="background:var(--chip);border:1px solid var(--line)"></i>нет теста</span></div></div>
  <div class="section-title"><h2>Что повторить</h2></div>
  <div class="card">${weakList.length ? `<ul style="margin:0;padding-left:20px">${weakList.map(([t,n]) => `<li><b>${esc(t)}</b> <span class="muted small">– ошибок: ${n}</span></li>`).join("")}</ul>`
    : `<div class="row" style="flex-wrap:nowrap"><img class="catmini" src="assets/kotik.webp" alt=""><p class="muted">Здесь появятся правила, в которых были ошибки в последних тестах.</p></div>`}</div>`;
}
window.mapHTML = mapHTML;
})();
