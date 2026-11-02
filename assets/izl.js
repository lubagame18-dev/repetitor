/* Озвучка текста изложения, как на экзамене: первое чтение → пауза 5 минут (черновик) → второе чтение.
   Голос – встроенный русский голос устройства (speechSynthesis); между абзацами паузы длиннее – по ним слышны микротемы. */
window.Izl = (() => {
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const ok = () => "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  let run = null;   // текущее чтение {box, stop}
  const voice = () => {
    const v = (speechSynthesis.getVoices() || []).filter(x => /^ru/i.test(x.lang));
    return v.find(x => /Google/i.test(x.name)) || v.find(x => /Svetlana|Dariya|Irina|Milena|Natalia|Ekaterina/i.test(x.name)) || v[0] || null;
  };
  if (ok()) try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => {}; } catch(_) {}

  /* кнопки плеера; paras – абзацы текста */
  function html(paras, key){
    if (!paras?.length) return "";
    return `<div class="izl-player card" data-izl="${esc(key || "")}" style="box-shadow:none">
      <div class="kicker">Прослушать текст, как на экзамене</div>
      <p class="small muted" style="margin:4px 0 8px">Текст звучит два раза. Между чтениями – 5 минут: запиши план и ключевые слова. Сам текст не открывай.</p>
      <div class="row izl-ctl" style="gap:6px;flex-wrap:wrap;align-items:center">
        <button class="btn sm" data-izl-act="r1">▶ Первое чтение</button>
        <button class="btn ghost sm" data-izl-act="r2">▶ Второе чтение</button>
        <button class="btn ghost sm" data-izl-act="stop" hidden>■ Стоп</button>
        <label class="small" style="display:flex;gap:6px;align-items:center">Темп <select data-izl-rate aria-label="Темп чтения"><option value="0.85">медленнее</option><option value="0.95" selected>как на экзамене</option><option value="1.05">быстрее</option></select></label>
      </div>
      <p class="izl-st small" aria-live="polite" style="margin-top:8px"></p>
      <script type="application/json" class="izl-data">${JSON.stringify(paras).replace(/</g, "\\u003c")}</script></div>`;
  }
  const sentences = p => (String(p).match(/[^.!?…]+[.!?…»"]*\s*/g) || [p]).map(x => x.trim()).filter(Boolean);
  function stop(){ if (run){ run.dead = true; clearInterval(run.timer); try { speechSynthesis.cancel(); } catch(_) {} const b = run.box; run = null; if (b.isConnected) ui(b, "", false); } }
  function ui(box, text, busy){
    const st = box.querySelector(".izl-st"); if (st) st.textContent = text;
    box.querySelector('[data-izl-act="stop"]').hidden = !busy;
    box.querySelectorAll('[data-izl-act="r1"],[data-izl-act="r2"]').forEach(b => b.disabled = !!busy);
  }
  function speak(box, paras, n, then){
    const rate = +(box.querySelector("[data-izl-rate]")?.value || 0.95), v = voice();
    if (!v){ ui(box, "На этом устройстве нет русского голоса. Попроси учителя прочитать текст или открой сайт в Chrome.", false); return; }
    const me = run = {box, dead: false};
    const q = []; paras.forEach((p, i) => { sentences(p).forEach(s => q.push({s})); if (i < paras.length - 1) q.push({pause: 2200}); });
    let k = 0;
    const next = () => {
      if (me.dead) return;
      if (k >= q.length){ run = null; then?.(); return; }
      const it = q[k++];
      ui(box, `${n}-е чтение · абзац ${Math.min(paras.length, 1 + q.slice(0, k).filter(x => x.pause).length)} из ${paras.length}`, true);
      if (it.pause){ setTimeout(next, it.pause); return; }
      const u = new SpeechSynthesisUtterance(it.s); u.lang = "ru-RU"; u.voice = v; u.rate = rate;
      u.onend = () => setTimeout(next, 350); u.onerror = () => setTimeout(next, 200);
      speechSynthesis.speak(u);
    };
    try { speechSynthesis.cancel(); } catch(_) {}
    next();
  }
  function pause(box){
    let left = 300; const me = run = {box, dead: false};
    const tick = () => { if (me.dead) return; const m = Math.floor(left / 60), s = String(left % 60).padStart(2, "0");
      ui(box, `Пауза ${m}:${s} – запиши план (3 микротемы) и ключевые слова каждого абзаца. Потом второе чтение.`, true);
      const r2 = box.querySelector('[data-izl-act="r2"]'); r2.disabled = false; r2.textContent = "▶ Второе чтение (без паузы)";
      if (left-- <= 0){ clearInterval(me.timer); run = null; ui(box, "Пауза закончилась – слушаем второй раз.", false); box.querySelector('[data-izl-act="r2"]').click(); } };
    me.timer = setInterval(tick, 1000); tick();
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-izl-act]"); if (!b) return;
    const box = b.closest(".izl-player"); if (!box) return;
    e.preventDefault();
    const a = b.dataset.izlAct; if (a === "stop"){ stop(); return; }
    if (!ok()){ ui(box, "Браузер не умеет читать вслух. Открой сайт в Chrome или попроси учителя прочитать текст.", false); return; }
    let paras = []; try { paras = JSON.parse(box.querySelector(".izl-data").textContent); } catch(_) {}
    stop();
    if (a === "r1") speak(box, paras, 1, () => { heard(); pause(box); });
    box.querySelector('[data-izl-act="r2"]').textContent = "▶ Второе чтение";
    const heard = () => document.dispatchEvent(new CustomEvent("izl-listened", {detail: {key: box.dataset.izl}}));
    if (a === "r2") speak(box, paras, 2, () => { heard(); ui(box, "Текст прочитан два раза. Допиши черновик и сожми каждый абзац.", false); });
  });
  return {html, stop, ok};
})();
