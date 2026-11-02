/* Самообучение и игры: тренажёр урока, карточки «верно/неверно», запоминалки, ударения, орфография,
   игры в духе Wordwall (викторина на время, найди пару, сортировка, мемори, верно/неверно на скорость).
   Все игры работают с одной «темой»: {title, pairs:[[a,b]], groups:[[группа,[слова]]], quiz:[{q,o,a,e}]}. */
window.Play = (() => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const mk = s => (window.U && U.mark) ? U.mark(s) : esc(s);
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const check = (ans, right) => (window.U && U.miniCheck) ? U.miniCheck(ans, right) : String(ans).trim().toLowerCase() === String(right).split("|")[0].toLowerCase();
  let ov = null, onDone = null, timers = [], missed = [];
  const miss = t => { if (t && missed.length < 40) missed.push(String(t).replace(/\s+/g, " ").slice(0, 140)); };
  const clearTimers = () => { timers.forEach(t => clearInterval(t)); timers = []; };

  /* ---------- оболочка ---------- */
  function shell(title, sub){
    close(true); missed = [];
    ov = document.createElement("div"); ov.className = "play-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true");
    ov.innerHTML = `<div class="play-box"><div class="play-head"><div style="min-width:0"><div class="kicker">${esc(sub || "Самообучение")}</div><h2 class="play-title">${esc(title)}</h2></div>
      <div class="row" style="gap:8px;align-items:center"><span class="play-stat small"></span><button class="iconbtn play-x" aria-label="Закрыть">✕</button></div></div>
      <div class="play-prog"><i></i></div><div class="play-body"></div></div>`;
    document.body.appendChild(ov); document.body.classList.add("play-open");
    ov.querySelector(".play-x").onclick = () => close();
    ov.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
    setTimeout(() => ov?.querySelector(".play-x")?.focus(), 30);
    return ov.querySelector(".play-body");
  }
  function close(silent){ clearTimers(); if (ov){ ov.remove(); ov = null; document.body.classList.remove("play-open"); } if (!silent) onDone = null; }
  const prog = (i, n) => { const b = ov?.querySelector(".play-prog i"); if (b) b.style.width = Math.round(100 * i / Math.max(1, n)) + "%"; };
  const stat = t => { const el = ov?.querySelector(".play-stat"); if (el) el.textContent = t; };
  function finish(body, title, ok, n, extra){
    prog(1, 1); stat("");
    const pct = n ? Math.round(ok / n * 100) : 0, star = pct >= 90 ? "🏆" : pct >= 70 ? "🌟" : pct >= 40 ? "👍" : "💪";
    body.innerHTML = `<div class="play-end"><div class="play-emo">${star}</div><h3>${ok} из ${n}${n ? ` · ${pct}%` : ""}</h3><p class="muted">${pct >= 90 ? "Отлично! Тема усвоена." : pct >= 70 ? "Хорошо! Повтори ошибки – и будет отлично." : "Повтори теорию и попробуй ещё раз."}</p>${extra || ""}
      <div class="row" style="gap:8px;justify-content:center;margin-top:12px"><button class="btn" data-again>Ещё раз</button><button class="btn ghost" data-close>Закрыть</button></div></div>`;
    try { onDone && onDone({title, ok, n, wrong: [...new Set(missed)]}); } catch(_) {}
    missed = [];
    return new Promise(res => { body.querySelector("[data-again]").onclick = () => res("again"); body.querySelector("[data-close]").onclick = () => { close(); res("close"); }; });
  }

  /* ---------- данные из уроков ---------- */
  const choiceOk = q => Array.isArray(q.o) && q.o.length >= 2 && q.a >= 0 && q.a < q.o.length;
  function quizFromLessons(ls){
    const out = [];
    ls.forEach(l => [...(l.test || []), ...(l.hwtest || [])].forEach(q => { if (q && q.q) out.push({...q, lt: l.title}); }));
    return out;
  }
  function tfFromQuiz(qs){
    return qs.filter(choiceOk).map(q => { const right = Math.random() < 0.5, wrong = q.o.map((_, k) => k).filter(k => k !== q.a);
      const k = right || !wrong.length ? q.a : wrong[Math.floor(Math.random() * wrong.length)];
      return {s: q.q, c: q.o[k], ok: k === q.a, e: q.e || "", r: q.o[q.a]}; });
  }
  function cardsFromLessons(ls){
    const out = [];
    ls.forEach(l => {
      (l.mnemo || []).forEach(([h, t, e]) => out.push({f: "🧠 " + h, b: t + (e ? "<div class='sp-ex'>" + mk(e) + "</div>" : ""), raw: true, lt: l.title}));
      if (l.memo) out.push({f: "💡 " + l.memo.h, b: mk(l.memo.t) + (l.memo.ex?.length ? "<div class='sp-ex'>" + l.memo.ex.map(mk).join("<br>") + "</div>" : ""), raw: true, lt: l.title});
      (l.special || []).forEach(([c, e, n]) => out.push({f: "⚠️ " + c, b: (e ? mk(e) : "") + (n ? "<div class='small muted'>" + mk(n) + "</div>" : ""), raw: true, lt: l.title}));
      (l.theory || []).forEach(t => (t.mini || []).forEach(m => out.push({f: m.q, b: esc(String(m.a).split("|")[0]), raw: true, lt: l.title})));
    });
    return out;
  }
  /* приводим тему к нужному виду */
  function quizOf(th){
    if (th.quiz?.length) return th.quiz.filter(q => choiceOk(q) || typeof q.a === "string");
    if (th.pairs?.length >= 3) return th.pairs.map(([a, b]) => { const others = shuffle(th.pairs.filter(p => p[1] !== b).map(p => p[1])).slice(0, 3); const o = shuffle([b, ...others]); return {q: a, o, a: o.indexOf(b)}; });
    if (th.groups?.length >= 2){ const names = th.groups.map(g => g[0]); return th.groups.flatMap(([g, items]) => items.map(it => ({q: it, o: names, a: names.indexOf(g)}))); }
    return [];
  }
  function pairsOf(th){
    if (th.pairs?.length) return th.pairs;
    if (th.quiz?.length) return th.quiz.filter(choiceOk).map(q => [q.q, q.o[q.a]]).filter(([a, b]) => a.length <= 90 && String(b).length <= 50)
      .filter((p, i, arr) => arr.findIndex(x => x[1] === p[1]) === i);
    return [];
  }
  const groupsOf = th => th.groups?.length >= 2 ? th.groups : null;
  const GAMES = {
    quiz:   {n: "Викторина на время", d: "Как можно больше верных ответов за 60 секунд", e: "⏱️", ok: th => quizOf(th).filter(choiceOk).length >= 3},
    match:  {n: "Найди пару", d: "Соедини слово и значение", e: "🔗", ok: th => pairsOf(th).length >= 3},
    sort:   {n: "Сортировка", d: "Разложи слова по группам", e: "🗂️", ok: th => !!groupsOf(th)},
    memory: {n: "Мемори", d: "Открывай карточки и находи пары", e: "🃏", ok: th => pairsOf(th).length >= 3},
    tf:     {n: "Верно или неверно", d: "Быстрые ответы за 45 секунд", e: "⚡", ok: th => pairsOf(th).length >= 3 || quizOf(th).filter(choiceOk).length >= 3}
  };
  const gamesFor = th => Object.keys(GAMES).filter(k => GAMES[k].ok(th));

  /* ---------- вопрос (выбор или ввод) ---------- */
  function askHTML(q, i){
    if (q.pn && window.U?.pnHTML) return `<p class="play-q">${mk(q.q)}</p><p class="small muted">Нажимай между словами, чтобы поставить запятую.</p>${U.pnHTML(q.pn)}<button class="btn play-pnok" style="margin-top:8px">Проверить</button>`;
    if (choiceOk(q)) return `<p class="play-q">${mk(q.q)}</p><div class="play-opts">${q.o.map((o, k) => `<button class="play-opt" data-k="${k}">${esc(o)}</button>`).join("")}</div>`;
    return `<p class="play-q">${mk(q.q)}</p><form class="row play-inp" style="gap:8px"><input autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="Ответ" style="flex:1"><button class="btn">Проверить</button></form>`;
  }
  function ask(box, q, hint){
    return new Promise(res => {
      box.innerHTML = askHTML(q) + (hint ? `<button class="linkbtn play-hintbtn">💡 Подсказка</button><div class="play-hint" hidden>${mk(hint)}</div>` : "") + `<div class="play-fb" aria-live="polite"></div>`;
      const fb = box.querySelector(".play-fb");
      const hb = box.querySelector(".play-hintbtn"); if (hb) hb.onclick = () => { box.querySelector(".play-hint").hidden = false; hb.remove(); };
      const done = (ok, given) => {
        box.querySelectorAll("button.play-opt, .play-inp input, .play-inp button").forEach(b => b.disabled = true);
        const right = q.pn ? U.pnText(q.pn, q.pn.a).replace(/[.!?]$/, "") : choiceOk(q) ? q.o[q.a] : String(q.a).split("|")[0];
        if (!ok) miss(q.tag && q.tag !== q.q ? `(${q.tag}) ${q.q} → ${right}` : `${q.q} → ${right}`);
        fb.innerHTML = `<div class="play-res ${ok ? "ok" : "bad"}"><b>${ok ? "Верно!" : "Неверно."}</b>${ok ? "" : ` Правильный ответ: <b>${esc(right)}</b>.`}${q.e ? `<div class="small" style="margin-top:4px">${mk(q.e)}</div>` : ""}</div><button class="btn play-next" style="margin-top:10px">Дальше →</button>`;
        fb.querySelector(".play-next").onclick = () => res({ok, given}); fb.querySelector(".play-next").focus();
      };
      box.querySelectorAll(".play-opt").forEach(b => b.onclick = () => { const k = +b.dataset.k, ok = k === q.a; b.classList.add(ok ? "ok" : "bad"); if (!ok) box.querySelector(`.play-opt[data-k="${q.a}"]`)?.classList.add("ok"); done(ok, q.o[k]); });
      const pb = box.querySelector(".play-pnok"); if (pb) pb.onclick = () => { const p = box.querySelector(".pn"), sel = U.pnSel(p), ok = U.pnOk(q.pn, sel); pb.disabled = true; p.outerHTML = U.pnHTML(q.pn, sel, {ro: true, key: true}); done(ok, U.pnText(q.pn, sel)); };
      const f = box.querySelector(".play-inp"); if (f){ f.querySelector("input").focus(); f.onsubmit = e => { e.preventDefault(); const v = f.querySelector("input").value; if (!v.trim()) return; done(check(v, q.a), v); }; }
    });
  }

  /* ---------- тренажёр урока: теория → проверь себя → работа над ошибками ---------- */
  async function trainer(l){
    const body = shell(l.title, "Тренажёр урока");
    const steps = [];
    (l.mnemo || []).length && steps.push({t: "th", h: "Как запомнить", html: l.mnemo.map(([h, t, e]) => `<p><b>🧠 ${mk(h)}</b><br>${mk(t)}${e ? `<br><span class="sp-ex">${mk(e)}</span>` : ""}</p>`).join("")});
    (l.theory || []).forEach((t, bi) => {
      steps.push({t: "th", h: t.h, html: `${t.t ? `<p>${mk(t.t)}</p>` : ""}${t.list ? `<ul>${t.list.map(x => `<li>${mk(x)}</li>`).join("")}</ul>` : ""}${t.table ? `<div class="tablewrap"><table>${t.table.map((r, i) => `<tr>${r.map(c => i ? `<td>${mk(c)}</td>` : `<th>${esc(c)}</th>`).join("")}</tr>`).join("")}</table></div>` : ""}${t.ex?.length ? `<div class="ex">${t.ex.map(x => `<div>${mk(x)}</div>`).join("")}</div>` : ""}`});
      (t.mini || []).forEach(m => steps.push({t: "q", q: {q: m.q, a: m.a}, hint: t.h}));
    });
    if (l.special?.length) steps.push({t: "th", h: "Особые случаи", html: l.special.map(([c, e, n]) => `<p><b>${mk(c)}</b>${e ? `<br>${mk(e)}` : ""}${n ? `<br><span class="small muted">${mk(n)}</span>` : ""}</p>`).join("")});
    const hint = l.algo?.steps?.[0] || l.memo?.t || "";
    shuffle(quizFromLessons([l])).slice(0, 10).forEach(q => steps.push({t: "q", q, hint}));
    const qn = steps.filter(s => s.t === "q").length;
    if (!qn){ body.innerHTML = `<p class="muted">В этом уроке пока нет вопросов для тренажёра.</p>`; return; }
    const run = async () => {
      let ok = 0, n = 0; const wrong = [];
      for (let i = 0; i < steps.length; i++){
        prog(i, steps.length); const s = steps[i];
        if (s.t === "th"){
          await new Promise(res => { body.innerHTML = `<div class="play-th"><div class="kicker">Теория</div><h3>${esc(s.h)}</h3>${s.html}</div><button class="btn play-next" style="margin-top:12px">Понятно, дальше →</button>`; body.querySelector(".play-next").onclick = res; body.querySelector(".play-next").focus(); });
        } else { n++; stat(`Вопрос ${n} из ${qn}`); const r = await ask(body, s.q, s.hint); if (r.ok) ok++; else wrong.push(s); }
      }
      let fixed = 0;
      if (wrong.length){
        await new Promise(res => { body.innerHTML = `<div class="play-th"><div class="kicker">Работа над ошибками</div><h3>Ошибок: ${wrong.length}</h3><p>Ответь на эти вопросы ещё раз – теперь с подсказкой.</p></div><button class="btn play-next" style="margin-top:12px">Начать →</button>`; body.querySelector(".play-next").onclick = res; });
        for (let i = 0; i < wrong.length; i++){ stat(`Ошибка ${i + 1} из ${wrong.length}`); const r = await ask(body, wrong[i].q, wrong[i].hint || wrong[i].q.e); if (r.ok) fixed++; }
      }
      const r = await finish(body, l.title, ok, n, wrong.length ? `<p class="small">Исправлено в работе над ошибками: ${fixed} из ${wrong.length}</p>` : "");
      if (r === "again") run();
    };
    run();
  }

  /* ---------- вопросы подряд (тест для самопроверки) ---------- */
  async function quizRun(title, qs, sub, max, keepOrder){
    const body = shell(title, sub || "Тест для самопроверки");
    if (!qs.length){ body.innerHTML = `<p class="muted">Вопросов пока нет.</p>`; return; }
    const run = async () => { let ok = 0; const list = (keepOrder ? qs : shuffle(qs)).slice(0, max || 15);
      for (let i = 0; i < list.length; i++){ prog(i, list.length); stat(`${i + 1} из ${list.length}`); if ((await ask(body, list[i])).ok) ok++; }
      if ((await finish(body, title, ok, list.length)) === "again") run(); };
    run();
  }

  /* ---------- карточки «верно / неверно» ---------- */
  async function tfCards(title, items){
    const body = shell(title, "Карточки «верно – неверно»");
    if (!items.length){ body.innerHTML = `<p class="muted">Нет карточек.</p>`; return; }
    const run = async () => { let ok = 0; const list = shuffle(items).slice(0, 15);
      for (let i = 0; i < list.length; i++){
        prog(i, list.length); stat(`${i + 1} из ${list.length}`); const it = list[i];
        const r = await new Promise(res => {
          body.innerHTML = `<div class="tf-card"><p class="play-q">${mk(it.s)}</p><div class="tf-claim">${esc(it.c)}</div></div><div class="row tf-btns"><button class="btn tf-yes">✓ Верно</button><button class="btn ghost tf-no">✕ Неверно</button></div><div class="play-fb"></div>`;
          const go = ans => { const good = ans === it.ok; if (!good) miss(`${it.s || it.q || ""}${it.r ? " → " + it.r : ""}`); body.querySelectorAll(".tf-btns button").forEach(b => b.disabled = true);
            body.querySelector(".play-fb").innerHTML = `<div class="play-res ${good ? "ok" : "bad"}"><b>${good ? "Да!" : "Нет."}</b> ${it.ok ? "Это верно." : `Верно: <b>${esc(it.r)}</b>.`}${it.e ? `<div class="small">${mk(it.e)}</div>` : ""}</div><button class="btn play-next" style="margin-top:10px">Дальше →</button>`;
            body.querySelector(".play-next").onclick = () => res(good); body.querySelector(".play-next").focus(); };
          body.querySelector(".tf-yes").onclick = () => go(true); body.querySelector(".tf-no").onclick = () => go(false);
        });
        if (r) ok++;
      }
      if ((await finish(body, title, ok, list.length)) === "again") run(); };
    run();
  }

  /* ---------- карточки-запоминалки (переворот, «знаю / повторить») ---------- */
  function flashcards(title, cards){
    const body = shell(title, "Карточки-запоминалки");
    if (!cards.length){ body.innerHTML = `<p class="muted">Нет карточек для повторения.</p>`; return; }
    let queue = shuffle(cards).slice(0, 24), known = 0; const total = queue.length;
    const show = () => {
      prog(known, total); stat(`Запомнено ${known} из ${total}`);
      if (!queue.length){ finish(body, title, known, total).then(r => r === "again" && flashcards(title, cards)); return; }
      const c = queue[0];
      body.innerHTML = `<button class="fc" aria-label="Перевернуть карточку"><div class="fc-in"><div class="fc-f">${mk(c.f)}</div><div class="fc-b" hidden>${c.raw ? c.b : mk(c.b)}</div></div><span class="small muted fc-tip">Нажми, чтобы перевернуть</span></button>
        <div class="row" style="gap:8px;justify-content:center;margin-top:12px"><button class="btn" data-k>✓ Знаю</button><button class="btn ghost" data-r>↻ Ещё повторю</button></div>${c.lt ? `<p class="small muted" style="text-align:center;margin-top:6px">${esc(c.lt)}</p>` : ""}`;
      const fc = body.querySelector(".fc"); fc.onclick = () => { fc.classList.toggle("on"); fc.querySelector(".fc-f").hidden = fc.classList.contains("on"); fc.querySelector(".fc-b").hidden = !fc.classList.contains("on"); fc.querySelector(".fc-tip").hidden = true; };
      body.querySelector("[data-k]").onclick = () => { queue.shift(); known++; show(); };
      body.querySelector("[data-r]").onclick = () => { queue.push(queue.shift()); show(); };
    };
    show();
  }

  /* ---------- ударения ---------- */
  function stress(words){
    const body = shell("Карточки ударений", "Орфоэпия");
    const list = shuffle(words).slice(0, 15); let i = 0, ok = 0;
    const V = /[аеёиоуыэюяАЕЁИОУЫЭЮЯ]/;
    const next = () => {
      if (i >= list.length){ finish(body, "Ударения", ok, list.length).then(r => r === "again" && stress(words)); return; }
      prog(i, list.length); stat(`${i + 1} из ${list.length}`);
      const w = list[i], right = [...w].findIndex(ch => /[АЕЁИОУЫЭЮЯ]/.test(ch) || ch === "ё"), low = w.toLowerCase();
      body.innerHTML = `<p class="play-q">Нажми на ударную гласную:</p><div class="st-word">${[...low].map((ch, k) => V.test(ch) ? `<button class="st-v" data-k="${k}">${ch}</button>` : `<span>${ch}</span>`).join("")}</div><div class="play-fb"></div>`;
      body.querySelectorAll(".st-v").forEach(b => b.onclick = () => {
        const good = +b.dataset.k === right; if (good) ok++; else miss("ударение: " + w);
        body.querySelectorAll(".st-v").forEach(x => { x.disabled = true; if (+x.dataset.k === right) x.classList.add("ok"); });
        if (!good) b.classList.add("bad");
        const shown = [...low].map((ch, k) => k === right ? ch + "́" : ch).join("");
        body.querySelector(".play-fb").innerHTML = `<div class="play-res ${good ? "ok" : "bad"}"><b>${good ? "Верно!" : "Неверно."}</b> Правильно: <b>${esc(shown)}</b></div><button class="btn play-next" style="margin-top:10px">Дальше →</button>`;
        const nb = body.querySelector(".play-next"); nb.onclick = () => { i++; next(); }; nb.focus();
      });
    };
    next();
  }

  /* ---------- орфография: вставь букву ---------- */
  function spell(items){
    const body = shell("Вставь букву", "Орфография");
    const list = shuffle(items).slice(0, 15); let i = 0, ok = 0;
    const next = () => {
      if (i >= list.length){ finish(body, "Орфография", ok, list.length).then(r => r === "again" && spell(items)); return; }
      prog(i, list.length); stat(`${i + 1} из ${list.length}`);
      const [w, a, opts, rule] = list[i], vs = shuffle(opts.split("|"));
      body.innerHTML = `<div class="sp-word">${esc(w).replace("..", '<span class="sp-gap">?</span>')}</div><div class="play-opts">${vs.map(v => `<button class="play-opt" data-v="${esc(v)}">${v === "–" ? "ничего" : esc(v)}</button>`).join("")}</div><div class="play-fb"></div>`;
      body.querySelectorAll(".play-opt").forEach(b => b.onclick = () => {
        const good = b.dataset.v === a; if (good) ok++; else miss(`${w.replace("..", a === "–" ? "" : a.toUpperCase())} – ${rule}`);
        body.querySelectorAll(".play-opt").forEach(x => { x.disabled = true; if (x.dataset.v === a) x.classList.add("ok"); }); if (!good) b.classList.add("bad");
        body.querySelector(".sp-gap").textContent = a === "–" ? "" : a; body.querySelector(".sp-gap").classList.add("done");
        body.querySelector(".play-fb").innerHTML = `<div class="play-res ${good ? "ok" : "bad"}"><b>${good ? "Верно!" : "Неверно."}</b> ${esc(rule)}</div><button class="btn play-next" style="margin-top:10px">Дальше →</button>`;
        const nb = body.querySelector(".play-next"); nb.onclick = () => { i++; next(); }; nb.focus();
      });
    };
    next();
  }

  /* ---------- игры ---------- */
  function timer(sec, onTick, onEnd){ let left = sec; onTick(left); const t = setInterval(() => { left--; onTick(left); if (left <= 0){ clearInterval(t); onEnd(); } }, 1000); timers.push(t); return () => clearInterval(t); }

  function gQuiz(th){
    const body = shell(th.title, GAMES.quiz.n); const qs = quizOf(th).filter(choiceOk); let score = 0, done = 0, pool = shuffle(qs), over = false;
    const next = () => { if (over) return; if (!pool.length) pool = shuffle(qs); const q = pool.pop();
      body.innerHTML = `<p class="play-q">${mk(q.q)}</p><div class="play-opts">${q.o.map((o, k) => `<button class="play-opt" data-k="${k}">${esc(o)}</button>`).join("")}</div>`;
      body.querySelectorAll(".play-opt").forEach(b => b.onclick = () => { if (over) return; const good = +b.dataset.k === q.a; done++; if (good) score++; b.classList.add(good ? "ok" : "bad"); setTimeout(next, good ? 250 : 700); }); };
    timer(60, s => { stat(`⏱ ${s} с · очки: ${score}`); prog(60 - s, 60); }, () => { over = true; finish(body, th.title, score, done, `<p class="small">Ответов за минуту: ${done}</p>`).then(r => r === "again" && gQuiz(th)); });
    next();
  }
  function gMatch(th){
    const body = shell(th.title, GAMES.match.n); const pairs = shuffle(pairsOf(th)).slice(0, 6); let sel = null, found = 0, miss = 0, t0 = Date.now();
    const L = pairs.map((p, i) => ({i, s: p[0]})), R = shuffle(pairs.map((p, i) => ({i, s: p[1]})));
    body.innerHTML = `<p class="small muted">Нажми слово слева, потом его пару справа.</p><div class="mt-grid"><div>${L.map(x => `<button class="mt-c" data-side="l" data-i="${x.i}">${esc(x.s)}</button>`).join("")}</div><div>${R.map(x => `<button class="mt-c" data-side="r" data-i="${x.i}">${esc(x.s)}</button>`).join("")}</div></div>`;
    body.querySelectorAll(".mt-c").forEach(b => b.onclick = () => {
      if (b.classList.contains("ok")) return;
      if (!sel || sel.dataset.side === b.dataset.side){ body.querySelectorAll(".mt-c.sel").forEach(x => x.classList.remove("sel")); sel = b; b.classList.add("sel"); return; }
      if (sel.dataset.i === b.dataset.i){ [sel, b].forEach(x => { x.classList.remove("sel"); x.classList.add("ok"); x.disabled = true; }); found++; prog(found, pairs.length); stat(`Найдено ${found} из ${pairs.length}`);
        if (found === pairs.length){ const sec = Math.round((Date.now() - t0) / 1000); setTimeout(() => finish(body, th.title, pairs.length, pairs.length + miss, `<p class="small">Время: ${sec} с · ошибок: ${miss}</p>`).then(r => r === "again" && gMatch(th)), 400); } }
      else { miss++; const a = sel; [a, b].forEach(x => x.classList.add("bad")); setTimeout(() => [a, b].forEach(x => x.classList.remove("bad", "sel")), 500); }
      sel = null;
    });
    stat(`Найдено 0 из ${pairs.length}`);
  }
  function gSort(th){
    const body = shell(th.title, GAMES.sort.n); const groups = groupsOf(th); const items = shuffle(groups.flatMap(([g, list]) => list.map(s => ({s, g})))).slice(0, 16); let i = 0, ok = 0;
    const next = () => {
      if (i >= items.length){ finish(body, th.title, ok, items.length).then(r => r === "again" && gSort(th)); return; }
      prog(i, items.length); stat(`${i + 1} из ${items.length}`); const it = items[i];
      body.innerHTML = `<div class="so-item">${esc(it.s)}</div><div class="so-groups">${groups.map(([g]) => `<button class="so-g" data-g="${esc(g)}">${esc(g)}<span class="so-n">${items.slice(0, i).filter(x => x.g === g && x.done).map(x => esc(x.s)).join(", ")}</span></button>`).join("")}</div><div class="play-fb"></div>`;
      body.querySelectorAll(".so-g").forEach(b => b.onclick = () => { const good = b.dataset.g === it.g; it.done = true; if (good) ok++;
        b.classList.add(good ? "ok" : "bad"); if (!good) body.querySelector(`.so-g[data-g="${CSS.escape(it.g)}"]`)?.classList.add("ok");
        body.querySelectorAll(".so-g").forEach(x => x.disabled = true); setTimeout(() => { i++; next(); }, good ? 400 : 1100); });
    };
    next();
  }
  function gMemory(th){
    const body = shell(th.title, GAMES.memory.n); const pairs = shuffle(pairsOf(th)).slice(0, 6);
    const cards = shuffle(pairs.flatMap((p, i) => [{i, s: p[0]}, {i, s: p[1]}])); let open = [], found = 0, moves = 0, lock = false;
    body.innerHTML = `<div class="mm-grid">${cards.map((c, k) => `<button class="mm-c" data-k="${k}" aria-label="Карточка"><span>${esc(c.s)}</span></button>`).join("")}</div>`;
    stat(`Ходов: 0`);
    body.querySelectorAll(".mm-c").forEach(b => b.onclick = () => {
      if (lock || b.classList.contains("up")) return; b.classList.add("up"); open.push(b);
      if (open.length === 2){ moves++; stat(`Ходов: ${moves}`); const [a, c] = open; const same = cards[+a.dataset.k].i === cards[+c.dataset.k].i;
        if (same){ a.classList.add("ok"); c.classList.add("ok"); open = []; found++; prog(found, pairs.length);
          if (found === pairs.length) setTimeout(() => finish(body, th.title, pairs.length, pairs.length, `<p class="small">Ходов: ${moves} (идеально – ${pairs.length})</p>`).then(r => r === "again" && gMemory(th)), 500); }
        else { lock = true; setTimeout(() => { a.classList.remove("up"); c.classList.remove("up"); open = []; lock = false; }, 900); } }
    });
  }
  function gTF(th){
    const body = shell(th.title, GAMES.tf.n); const pairs = pairsOf(th), qs = quizOf(th).filter(choiceOk);
    const make = () => { if (pairs.length >= 3){ const p = pairs[Math.floor(Math.random() * pairs.length)], right = Math.random() < 0.5;
        const b = right ? p[1] : shuffle(pairs.filter(x => x[1] !== p[1]))[0][1]; return {s: p[0], c: b, ok: right, r: p[1]}; }
      return tfFromQuiz([qs[Math.floor(Math.random() * qs.length)]])[0]; };
    let score = 0, done = 0, over = false;
    const next = () => { if (over) return; const it = make();
      body.innerHTML = `<div class="tf-card"><p class="play-q">${mk(it.s)}</p><div class="tf-claim">${esc(it.c)}</div></div><div class="row tf-btns"><button class="btn tf-yes">✓ Верно</button><button class="btn ghost tf-no">✕ Неверно</button></div>`;
      const go = ans => { if (over) return; const good = ans === it.ok; done++; if (good) score++; body.querySelector(".tf-card").classList.add(good ? "ok" : "bad"); setTimeout(next, good ? 250 : 650); };
      body.querySelector(".tf-yes").onclick = () => go(true); body.querySelector(".tf-no").onclick = () => go(false); };
    timer(45, s => { stat(`⏱ ${s} с · очки: ${score}`); prog(45 - s, 45); }, () => { over = true; finish(body, th.title, score, done).then(r => r === "again" && gTF(th)); });
    next();
  }
  function game(type, th){ ({quiz: gQuiz, match: gMatch, sort: gSort, memory: gMemory, tf: gTF}[type] || gQuiz)(th); }

  /* выбор игры для темы */
  function chooseGame(th){
    const body = shell(th.title, "Выбери игру"); const ks = gamesFor(th);
    body.innerHTML = ks.length ? `<div class="pl-grid">${ks.map(k => `<button class="pl-card" data-g="${k}"><span class="pl-emo">${GAMES[k].e}</span><b>${GAMES[k].n}</b><span class="small muted">${GAMES[k].d}</span></button>`).join("")}</div>` : `<p class="muted">Для этой темы мало данных для игры.</p>`;
    body.querySelectorAll("[data-g]").forEach(b => b.onclick = () => game(b.dataset.g, th));
  }

  /* ---------- конструктор темы учителя: текст → тема ---------- */
  function parseTheme(kind, text, title){
    const lines = String(text || "").split("\n").map(x => x.trim()).filter(Boolean);
    const th = {title: (title || "").trim() || "Игра"};
    if (kind === "pairs"){ th.pairs = lines.map(x => x.split(/\s*[=–—]\s*|\s+-\s+/)).filter(p => p.length >= 2 && p[0] && p[1]).map(p => [p[0].slice(0, 80), p.slice(1).join(" – ").slice(0, 80)]);
      if (th.pairs.length < 3) return {error: "Нужно хотя бы 3 пары: «слово = значение» на каждой строке"}; }
    if (kind === "groups"){ th.groups = lines.map(x => x.split(":")).filter(p => p.length >= 2).map(([g, ...rest]) => [g.trim().slice(0, 40), rest.join(":").split(/[,;]/).map(s => s.trim()).filter(Boolean).slice(0, 15)]).filter(g => g[0] && g[1].length >= 2);
      if (th.groups.length < 2) return {error: "Нужно хотя бы 2 группы: «Группа: слово, слово, слово» на каждой строке"}; }
    if (kind === "quiz"){ th.quiz = lines.map(x => x.split("|").map(s => s.trim())).filter(p => p.length >= 3 && p.every(Boolean)).map(p => { const o = shuffle(p.slice(1, 7)); return {q: p[0].slice(0, 200), o, a: o.indexOf(p[1])}; });
      if (th.quiz.length < 3) return {error: "Нужно хотя бы 3 вопроса: «вопрос | верный | неверный | неверный»"}; }
    return th;
  }

  return {
    trainer, quizRun, tfCards, flashcards, stress, spell, game, chooseGame, close, GAMES, gamesFor, parseTheme,
    quizFromLessons, tfFromQuiz, cardsFromLessons, quizOf, pairsOf,
    set onDone(f){ onDone = f; }, get onDone(){ return onDone; }
  };
})();
