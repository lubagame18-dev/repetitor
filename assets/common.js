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
  function aggregate(rows){
    const out = {};
    rows.slice().sort((a,b) => new Date(a.created_at) - new Date(b.created_at)).forEach(r => {
      const o = out[r.lesson_id] || (out[r.lesson_id] = {attempts:0, last:null, best:null, history:[]});
      const x = {score:r.score, total:r.total, wrong:r.wrong || [], at:r.created_at};
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

  function theoryHTML(l){
    const blocks = l.theory.map(t => `<div class="tblock">
      <h3>${esc(t.h)}</h3>
      ${t.t ? `<p>${mark(t.t)}</p>` : ""}
      ${t.list ? `<ul>${t.list.map(x => `<li>${mark(x)}</li>`).join("")}</ul>` : ""}
      ${t.table ? `<div class="tablewrap"><table><thead><tr>${t.table[0].map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${t.table.slice(1).map(r => `<tr>${r.map(c => `<td>${mark(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}
      ${t.ex?.length ? `<div class="ex">${t.ex.map(x => `<div>${mark(x)}</div>`).join("")}</div>` : ""}
      ${t.scheme ? `<div class="scheme">${esc(t.scheme)}</div>` : ""}
    </div>`).join("");
    const m = l.memo;
    return `<div class="theory">${blocks}
      ${m ? `<div class="memo"><img src="assets/kotik.webp" alt=""><div><b>${esc(m.h)}</b><p style="margin-top:4px">${mark(m.t)}</p>${m.ex?.length ? `<div class="ex">${m.ex.map(x => `<div>${mark(x)}</div>`).join("")}</div>` : ""}</div></div>` : ""}
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

  function shuffle(a){ a = a.slice(); for (let i = a.length-1; i > 0; i--){ const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]] = [a[j],a[i]]; } return a; }

  function toast(t){ const el = document.getElementById("toast"); if (!el) return; el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2600); }

  function genCode(){
    const a = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let s = "";
    const r = crypto.getRandomValues(new Uint32Array(7)); r.forEach(x => s += a[x % a.length]); return s;
  }

  const supa = () => {
    const c = window.APP_CONFIG || {};
    if (!c.SUPABASE_URL || !c.SUPABASE_ANON_KEY || c.SUPABASE_URL.includes("ВАШ") || !window.supabase) return null;
    return window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY);
  };

  return {esc, d, today, fmt, fmtShort, daysTo, pct, lvl, lvlColor, mark, aggregate, recText, hwState, blockStats, weakTags, avgAll, theoryHTML, practiceHTML, shuffle, toast, genCode, supa};
})();
