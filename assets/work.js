/* Интерактивная работа с заданием – как в тетради:
   подчёркивание членов предложения (обозначения как в учебнике), крестик над определяемым словом,
   маркер, подписи над словами, вставка пропущенных букв (..), раскрытие скобок ((не)был → не был / небыл / не-был),
   расстановка знаков между словами и поле для ответа.
   Состояние задания: {m:{слово:тип}, l:{слово:подпись}, g:{пропуск:буквы}, b:{скобка:вариант}, s:{промежуток:знак}, a:ответ} */
window.Work = (() => {
  const {esc} = U;
  const TOOLS = [
    ["s", "Подлежащее", "u-s"], ["p", "Сказуемое", "u-p"], ["o", "Дополнение", "u-o"],
    ["w", "Определение · прич. оборот", "u-w"], ["a", "Обстоятельство · дееприч. оборот", "u-a"],
    ["x", "Определяемое слово", "u-x"], ["h", "Маркер", "u-h"], ["lbl", "Подпись", ""], ["pn", "Знаки , – :", ""], ["er", "Ластик", ""]
  ];
  const PUNCT = ["", ",", "–", ":", ";"];
  const BR = ["orig", "space", "join", "hyph"];
  let tool = "s";

  /* разбор строки на слова, пропуски и скобки; i – общий счётчик слов/пропусков/скобок задания */
  function line(text, cnt, st, ro){
    const out = [];
    String(text).split(/(\s+)/).forEach(chunk => {
      if (!chunk) return;
      if (/^\s+$/.test(chunk)){ out.push(chunk.includes("\n") ? "<br>" : " "); return; }
      // хвостовая пунктуация (кроме «..» пропуска в конце слова)
      let lead = "", core = chunk, tail = "";
      const ml = core.match(/^[«"“(\[]+(?!\d+\))(?![а-яёa-z]+\))/i); if (ml && !/^\((не|ни|по|в|кое|что|на|из|за|без|с|до|от|о|пол|полу|из-за|из-под)\)/i.test(core)){ lead = ml[0]; core = core.slice(lead.length); }
      const mt = core.match(/([,!?;:»"”)\]…]+|(?<!\.)\.(?!\.))+$/); if (mt && !/\.\.$/.test(core)){ tail = mt[0]; core = core.slice(0, -tail.length); }
      if (!core){ out.push(esc(chunk)); return; }
      const wi = cnt.w++, mark = st.m?.[wi], lbl = st.l?.[wi];
      let inner = esc(core);
      // пропуски «..» и «..(3)»
      inner = inner.replace(/\.\.(\(\d+\))?/g, (_, num) => { const gi = cnt.g++, v = st.g?.[gi] || "";
        return `${num ? `<sup class="wk-num">${num}</sup>` : ""}<input class="wk-gap" data-g="${gi}" value="${esc(v)}" size="${Math.max(1, v.length || 1)}" maxlength="3" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Пропущенная буква" ${ro ? "readonly" : ""}>`; });
      // раскрытие скобок: (не)был
      inner = inner.replace(/^\(([а-яёa-z\-]+)\)(?=[а-яёa-z])/i, (_, p) => { const bi = cnt.b++, v = st.b?.[bi] || "orig";
        const shown = v === "space" ? p + " " : v === "join" ? p : v === "hyph" ? p + "-" : `(${p})`;
        return `<button type="button" class="wk-br ${v !== "orig" ? "on" : ""}" data-b="${bi}" title="Нажмите: раздельно → слитно → через дефис" ${ro ? "disabled" : ""}>${esc(shown)}</button>`; });
      const cls = mark ? (TOOLS.find(t => t[0] === mark) || [])[2] || "" : "";
      out.push(`${esc(lead)}<span class="wk-w ${cls} ${lbl ? "has-l" : ""}" data-w="${wi}">${lbl ? `<span class="wk-l">${esc(lbl)}</span>` : ""}${inner}</span>${esc(tail)}`);
      const si = wi, pm = st.s?.[si] || "";
      out.push(`<span class="wk-slot ${pm ? "on" : ""}" data-s="${si}" aria-label="Знак после слова">${esc(pm)}</span>`);
    });
    return out.join("");
  }

  /* задание целиком: формулировка, материал (текст, пункты), поле ответа */
  function task(p, i, st = {}, ro = false){
    const cnt = {w: 0, g: 0, b: 0};
    let instr = p.t || "", body = [];
    const parts = String(instr).split(/\n\s*\n/);
    if (parts.length > 1){ instr = parts[0]; body.push(parts.slice(1).join("\n")); }
    if (p.text) body.push(p.text);
    const items = (p.items || []).map((x, k) => `<li>${/^\d+\)/.test(x) ? "" : `<span class="wk-n">${k + 1})</span> `}${line(x, cnt, st, ro)}</li>`).join("");
    return `<div class="task wk" data-task="${i}">
      <b>Задание ${i + 1}.</b> ${esc(instr)}
      ${body.map(b => `<div class="ttext wk-text">${line(b, cnt, st, ro)}</div>`).join("")}
      ${items ? `<ol class="items wk-items">${items}</ol>` : ""}
      <label class="wk-alabel" for="wk-a-${i}">Ответ</label>
      <textarea class="wk-ans" id="wk-a-${i}" data-ans="${i}" rows="2" placeholder="${ro ? "" : "Напиши ответ или пояснение"}" ${ro ? "readonly" : ""}>${esc(st.a || "")}</textarea>
      ${p.key !== undefined && ro ? `<div class="key"><b>Ключ:</b> ${esc(p.key || "–")}</div>` : ""}
    </div>`;
  }

  const toolbar = () => `<div class="wk-bar" role="toolbar" aria-label="Инструменты">${TOOLS.map(([k, n, c]) => `<button type="button" data-tool="${k}" aria-pressed="${tool === k}" title="${esc(n)}"><span class="${c}">${k === "x" ? "сл<span class='u-x'>о</span>во" : k === "lbl" ? "Аб" : k === "pn" ? ", –" : k === "er" ? "⌫" : k === "h" ? "маркер" : "слово"}</span><small>${esc(n)}</small></button>`).join("")}</div>
    <p class="small muted wk-hint">Выбери инструмент и нажми на слово. «Знаки» – нажимай между словами: запятая → тире → двоеточие → точка с запятой → убрать. В пропуски впиши буквы, скобки нажимай.</p>`;

  /* обработчики: один раз на контейнер; onChange(i, state) вызывается после каждого изменения */
  function bind(root, states, onChange){
    const changed = i => onChange && onChange(i, states[i]);
    const S = i => states[i] = states[i] || {};
    root.addEventListener("click", e => {
      const tb = e.target.closest("[data-tool]");
      if (tb){ tool = tb.dataset.tool; root.querySelectorAll("[data-tool]").forEach(b => b.setAttribute("aria-pressed", b === tb)); root.classList.toggle("wk-pn", tool === "pn"); return; }
      const tk = e.target.closest("[data-task]"); if (!tk || tk.classList.contains("ro")) return;
      const i = +tk.dataset.task, st = S(i);
      const br = e.target.closest("[data-b]");
      if (br){ const bi = br.dataset.b, cur = (st.b = st.b || {})[bi] || "orig"; st.b[bi] = BR[(BR.indexOf(cur) + 1) % BR.length];
        const p = br.textContent.replace(/[()\s-]/g, ""), v = st.b[bi]; br.textContent = v === "space" ? p + " " : v === "join" ? p : v === "hyph" ? p + "-" : `(${p})`; br.classList.toggle("on", v !== "orig"); changed(i); return; }
      const sl = e.target.closest("[data-s]");
      if (sl && tool === "pn"){ const si = sl.dataset.s, cur = (st.s = st.s || {})[si] || ""; const nx = PUNCT[(PUNCT.indexOf(cur) + 1) % PUNCT.length];
        if (nx) st.s[si] = nx; else delete st.s[si]; sl.textContent = nx; sl.classList.toggle("on", !!nx); changed(i); return; }
      const w = e.target.closest("[data-w]"); if (!w || e.target.closest("input")) return;
      const wi = w.dataset.w;
      if (tool === "pn") return;
      if (tool === "er"){ if (st.m) delete st.m[wi]; if (st.l) delete st.l[wi]; TOOLS.forEach(t => t[2] && w.classList.remove(t[2])); w.classList.remove("has-l"); w.querySelector(".wk-l")?.remove(); changed(i); return; }
      if (tool === "lbl"){
        const v = prompt("Подпись над словом (например: сущ., прич., гл., м. р., 1 скл.):", st.l?.[wi] || ""); if (v === null) return;
        st.l = st.l || {}; w.querySelector(".wk-l")?.remove();
        if (v.trim()){ st.l[wi] = v.trim().slice(0, 30); const sp = document.createElement("span"); sp.className = "wk-l"; sp.textContent = st.l[wi]; w.prepend(sp); w.classList.add("has-l"); } else { delete st.l[wi]; w.classList.remove("has-l"); }
        changed(i); return;
      }
      const T = TOOLS.find(t => t[0] === tool); st.m = st.m || {};
      TOOLS.forEach(t => t[2] && w.classList.remove(t[2]));
      if (st.m[wi] === tool) delete st.m[wi]; else { st.m[wi] = tool; w.classList.add(T[2]); }
      changed(i);
    });
    root.addEventListener("input", e => {
      const tk = e.target.closest("[data-task]"); if (!tk) return; const i = +tk.dataset.task, st = S(i);
      if (e.target.dataset.g !== undefined){ (st.g = st.g || {})[e.target.dataset.g] = e.target.value; e.target.size = Math.max(1, e.target.value.length); changed(i); }
      if (e.target.dataset.ans !== undefined){ st.a = e.target.value; changed(i); }
    });
  }
  return {task, toolbar, bind, TOOLS};
})();
