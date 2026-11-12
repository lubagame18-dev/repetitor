/* Общая доска: ученик и учитель видят курсоры и рисунки друг друга в реальном времени.
   Живое движение – Supabase Realtime (broadcast + presence), сохранение – таблица board_items.

   В этой версии дополнительно к v54 (сглаженные штрихи, частичный ластик, контекстное меню,
   снимок 📸, встраивание сайтов, живые листы урока, инструмент touch, доп. листы в "_pages"):
   * штрихи/курсоры/черновики привязываются к элементам листа (якорь {i,dx,dy,ox,oy,tag}) –
     подчёркивание остаётся на своём предложении при разном макете (фикс «выше/ниже»);
   * текст – окошко-редактор на pointerup (а не в pointerdown): textarea + ручка размера +
     «Готово», Enter – сохранить, Shift+Enter – новая строка, Esc – отмена;
   * вложения – диалог «Куда выгрузить материал?»: на этот лист (без наложений) или
     отдельными листами; html листа обрезается ≤55000, data-URL картинок ≤52000;
   * инструмент «Переместить» (✥) таскает картинки и надписи (api.add + api.remove + broadcast);
   * ЕДИНЫЙ ФОН ЖИВОГО ЛИСТА: на уроке живой лист у учителя и ученика собирается по-разному
     (у учителя – ключи/ответы/заметки), поэтому одинаковые координаты штриха попадали в разные
     места. Теперь ученик – источник правды для фона: он присылает html листа по каналу
     ("bg" {page,html,rev}, дебаунс 240 мс, без повторов), учитель показывает ровно этот html
     и просит лист через "bgreq" {page}, если ученик ещё не присылал (в т.ч. отрисовка в
     detached div для не открытой у ученика страницы). Свои пометки учителя (штрихи/надписи)
     остаются объектами доски и синхронизируются как раньше; ключи/ответы/заметки учитель
     видит в панели урока. Без второго участника всё работает как раньше;
   * ЯКОРЯ В ПУСТЫХ МЕСТАХ: если пометка стоит в пустоте (самый маленький содержащий элемент –
     корневой .bd-sheet/обёртка > ~40% листа), якорь берётся у ближайшего содержательного блока
     (p, li, td/th, h1-h4, table, img, div с текстом): предпочтительно выше точки, иначе ниже;
   * хуки для тестов: mount() возвращает info/whenIdle/attach/addPage/openPage/pages/refresh,
     info().bgSource ("remote"|"own"|"static"), debug().remoteBgPages.

   v63 «доска как Miro» (дополнительно):
   * точечный ластик: ER=7, стирает только реально под точкой; штрих делится на куски,
     надпись/картинка удаляются только при точном попадании; видимый круг-курсор .bd-erasecur;
   * инлайн-текст .bd-inline вместо большого окна: textarea без «Готово», авто-размер
     (120..460 × до 300 логических), Enter – сохранить, Shift+Enter – перенос, Esc – отмена,
     blur – сохранить; при наведении/фокусе ручка-перетаскивание ✥ .bd-inline-drag,
     правый нижний угол .bd-inline-resize (старые классы .bd-editor/.bd-editor-handle сохранены);
   * зум/пан: scale = CSS px на логический px, ручной зум 0.5..3, кнопки −/100%/+ /По ширине,
     колесо Ctrl/Alt/Meta – зум к точке под курсором, «рука» таскает холст (scroll .bd-stage),
     «Расширить лист»; рисование/якоря считаются от rect канваса (учитывают скролл и масштаб);
   * вставка в точку: paste текста открывает .bd-inline в lastPoint, картинка из буфера и
     drag&drop файлов вставляются в точку; API для панели учителя: insertText/insertNote/
     insertImage/insertPage/pasteAtPoint/getView/setZoom/zoomBy/fitWidth/extendHeight/lastPoint;
   * заполнение .blank на основном листе: тап T по пропуску открывает редактор над ним.

   v64 «выделение и размеры»:
   * выделение объекта (move-tap / API select): пунктирная рамка .bd-selbox[data-bd-sel] с data-id,
     ручка .bd-sel-resize и панель .bd-sel-bar с [data-sel=del|minus|plus|reset];
   * удаление: 🗑, Delete/Backspace (без фокуса в полях), пункт «Удалить» в контекстном меню;
   * ресайз картинки за угол (пропорции; Shift – свободно, мин 40), «Сбросить» к базовому bw/bh;
   * текст с полем sz (12..96, по умолчанию 22): drawText/wrapLines/textHeight/инлайн-редактор
     учитывают sz, A−/A+ меняют sz (шаг 2), угол меняет w/h, «Сбросить» – sz=22 и авто-ширина;
   * API select(id)/selected()/deleteSelected(); info().selected = {id,type,x,y,w,h,sz?} | null. */
window.Board = (() => {
  const W = 800;                        // логическая ширина листа
  const COLORS = ["#24183d", "#7b4cf5", "#ee5fa8", "#1f9d55", "#d6334a"];
  const PAGE_KEY = "_pages";            // служебный ключ для дополнительных листов доски
  const PAGE_HTML_MAX = 55000;          // board_add у ученика ограничивает item 60000 символов
  const ITEM_MAX = 52000;               // с запасом для одной картинки-объекта
  const TEXT_FONT = "600 22px Manrope, system-ui, sans-serif";
  const TEXT_LINE = 28;
  const TEXT_SZ_MIN = 12, TEXT_SZ_MAX = 96, TEXT_SZ_DEFAULT = 22;   // размер шрифта надписи (sz)
  const SEL_MIN = 40;                                               // минимальный размер объекта при ресайзе (логические px)
  const TEXT_MAX = 4000;
  const DEFAULT_TEXT_W = 260;
  const TEXT_MIN_W = 120;               // авто-ширина инлайн-редактора
  const TEXT_MAX_W = 460;               // авто-ширина/максимум логических px
  const TEXT_MAX_H = 300;               // авто-высота инлайн-редактора
  const ZOOM_MIN = 0.25, ZOOM_MAX = 4;   // ручной зум: CSS px на логический px
  const ER_SIZES = {s:4, m:7, l:16};   // размеры ластика: маленький / средний / большой (логические px)
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const rid = () => Math.random().toString(36).slice(2, 10);
  const toast = t => { try { if (window.U && typeof U.toast === "function") U.toast(t); } catch (_) {} };
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const oneLine = s => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

  function mount(root, o){
    // o: {api, channelName, sb, role, name, pages:[{key,label,html}], page, onPage, live, menu}
    o = o || {};
    const provided = (Array.isArray(o.pages) && o.pages.length)
      ? o.pages
      : [{key:"p1", label:"Лист 1", html:`<div class="bd-sheet"></div>`}];
    const pagesArr = provided.map(p => ({key:String(p.key), label:p.label || "Лист", html:p.html || "", saved:false}));
    let page = (o.page && pagesArr.some(p => p.key === String(o.page))) ? String(o.page) : pagesArr[0].key;

    let items = new Map();             // id -> item
    const isTemp = id => /^(tmp|er|rtmp:|rtxt:)/.test(String(id));
    const textHeld = new Map();        // удалённая печать: ключ → исходный объект, пока его правят
    let ER = ER_SIZES.m; try { const sv = localStorage.getItem("bd-er"); if (sv && ER_SIZES[sv]) ER = ER_SIZES[sv]; } catch (_) {}
    const stamp = new Map();           // id -> когда менялся (для сверки с базой: свежие изменения не трогаем)
    const st8 = (...ids) => { const t = Date.now(); ids.flat().forEach(i => { if (i != null) stamp.set(String(i), t); }); };
    const fresh8 = id => Date.now() - (stamp.get(String(id)) || 0) < 8000;
    let mine = [];                     // id своих объектов для «Отменить»
    /* история действий по листам: {added:[id], removed:[объекты]} – отмена и возврат, в т.ч. случайного удаления */
    const hmap = new Map(); let histMute = 0, histBusy = false, hbatch = null;
    const HS = () => { let h = hmap.get(page); if (!h){ h = {u: [], r: []}; hmap.set(page, h); } return h; };
    function hpush(a){
      if (histMute || !a || (!a.added.length && !a.removed.length)) return;
      if (hbatch){ hbatch.added.push(...a.added); hbatch.removed.push(...a.removed); return; }
      const h = HS(); h.u.push(a); if (h.u.length > 200) h.u.shift(); h.r.length = 0; histState();
    }
    function histState(){
      const h = HS();
      root.querySelectorAll('[data-act="undo"]').forEach(b => { b.disabled = !h.u.length; b.style.opacity = h.u.length ? "" : ".45"; });
      root.querySelectorAll('[data-act="redo"]').forEach(b => { b.disabled = !h.r.length; b.style.opacity = h.r.length ? "" : ".45"; });
    }
    async function applyAct(a){
      histMute++;
      try {
        const inv = {added: [], removed: []};
        const rem = a.added.map(String).filter(id => items.has(id)).map(id => ({id, item: items.get(id)}));
        if (rem.length){ await removeIds(rem.map(r => r.id)); inv.removed.push(...rem.map(r => r.item)); }
        for (const it of a.removed){ const nid = await addItem(it); if (nid != null) inv.added.push(nid); }
        return inv;
      } finally { histMute--; }
    }
    async function undo(){
      if (histBusy) return; const h = HS(), a = h.u.pop();
      if (!a){ toast("Нечего отменять"); histState(); return; }
      histBusy = true;
      try { const inv = await applyAct(a); HS().r.push(inv); } finally { histBusy = false; histState(); }
    }
    async function redo(){
      if (histBusy) return; const h = HS(), a = h.r.pop();
      if (!a){ toast("Нечего возвращать"); histState(); return; }
      histBusy = true;
      try { const inv = await applyAct(a); HS().u.push(inv); } finally { histBusy = false; histState(); }
    }
    let tool = "pen", color = COLORS[0], drawing = null, moving = null, textTap = null;
    let scale = 1, height = 1400;
    let editor = null;                 // инлайн-редактор текста
    let saving = 0, openTok = 0;
    let bdEls = [], bdBoxes = [], bdMap = new Map();
    let anchorsDirty = true, boxesDirty = true, lastScale = 0, lastBgH = -1;
    let readyDone = false, readyResolve = null;
    const readyP = new Promise(res => { readyResolve = res; });
    const peers = new Map();           // key -> {name, role, page, raw, color, el}
    const drafts = new Map();          // key -> stroke being drawn by peer
    const me = rid();
    let channel = null, lastCursor = 0, lastDraft = 0, draftBuf = [];
    const imgCache = new Map(); const pageCache = new Map();
    /* вид: масштаб/скролл/последняя точка; инлайн-текст, ластик-курсор, панорама рукой */
    let fitMode = true;                // «По ширине»: scale = stage.clientWidth / W
    let zoom = 1;                      // абсолютный масштаб, CSS px на логический px
    let lastViewScale = 0;
    let extraWidth = 0, widthL = W;      // «бесконечный» холст вправо: логическая ширина растёт при рисовании у правого края
    let extraHeight = 0;               // кнопка «Расширить лист»
    let lastPoint = {x: 140, y: 160};  // последняя точка клика по листу (логические)
    let pan = null;                    // перетаскивание холста инструментом «рука»
    let lastGrow = 0;                  // авто-расширение высоты при рисовании у нижнего края
    let lastClipText = "", lastClipFiles = [];   // последнее содержимое буфера (для «Вставить»/pasteAtPoint)
    let lastWheelSig = "", lastWheelAt = 0;      // дедупликация повторно отправленного wheel-события
    let selectedId = null;                       // выделенный объект (картинка/надпись)
    let selResize = null;                        // текущий жест ресайза рамкой выделения
    let selBusy = false;                         // идёт сохранение изменения выделенного (защита от двойных кликов)
    let selQueue = Promise.resolve();            // очередь сохранений (A+/A−/reset) — без гонок replaceItem
    let selPending = 0;                          // сколько изменений выделенного ещё не сохранено (для whenIdle)

    /* ---------- общий фон «живого» листа: ученик – источник правды ----------
       На уроке живой лист собирается по-разному: у учителя roomPane (ключи, ответы, подсказки,
       заметки), у ученика lessonPane (пустые поля, задания). Поэтому одинаковые координаты штриха
       попадали в разные места. Теперь ученик присылает свой html листа учителю, и учитель на доске
       показывает ровно его. Свои пометки учителя (штрихи/надписи) остаются обычными объектами
       доски и синхронизируются как раньше; ключи/ответы учитель видит в панели урока. */
    const isTeacher = o.role === "teacher", isStudent = o.role === "student";
    const remoteBg = new Map();        // page -> html, присланный учеником (только у учителя)
    const liveBgCache = new Map();     // page -> html, отрисованный учеником для ответа на bgreq
    const lastBgSent = new Map();      // page -> подпись уже отправленного html (без повторов)
    const BG_MAX = 300000;             // предохранитель: слишком большой html не гоняем по каналу
    let bgSource = "static";           // "remote" | "own" | "static" – что сейчас на фоне
    let bgSendT = 0, bgReqT = 0, bgReqPage = "", bgReqAt = 0;

    root.innerHTML = `
      <div class="bd-bar">
        <div class="bd-pages" role="group" aria-label="Лист доски"><button data-pstep="-1" title="Предыдущий лист" aria-label="Предыдущий лист">‹</button>${pagesArr.map(p => `<button data-bpage="${esc(p.key)}" aria-pressed="${p.key === page}">${esc(p.label)}</button>`).join("")}<button data-pstep="1" title="Следующий лист" aria-label="Следующий лист">›</button></div>
        <div class="bd-who small muted" aria-live="polite"></div>
      </div>
      <div class="bd-body"><div class="bd-side"><div class="bd-tools" role="group" aria-label="Инструменты">
          <button data-tool="pen" data-l="Ручка" title="Ручка">✎</button>
          <button data-tool="hl" data-l="Маркер" title="Маркер (полупрозрачный)">🖍</button>
          <button data-tool="text" data-l="Текст" title="Написать текст: нажмите на лист">T</button>
          <button data-tool="move" data-l="Двигать" title="Двигать надпись или картинку">✥</button>
          <button data-tool="erase" data-l="Ластик" title="Ластик: стирает только то, по чему провести" aria-label="Ластик"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 17l8-8 6 6-4 4H6z" fill="#f48fb1" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M11 9l4-4 6 6-4 4" fill="#fff" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M13 19h8" stroke="currentColor" stroke-width="1.5"/></svg></button>
          <div class="bd-esz" hidden role="group" aria-label="Размер ластика">
            <button data-esz="s" title="Ластик маленький" aria-label="Маленький"><i style="width:6px;height:6px"></i></button>
            <button data-esz="m" title="Ластик средний" aria-label="Средний"><i style="width:11px;height:11px"></i></button>
            <button data-esz="l" title="Ластик большой" aria-label="Большой"><i style="width:18px;height:18px"></i></button>
          </div>
          <button data-tool="hand" data-l="Рука" title="Листать холст рукой (или двумя пальцами)">✋</button>
          <span class="bd-sep"></span>
          ${COLORS.map(c => `<button class="bd-color" data-color="${c}" style="--bc:${c}" aria-label="Цвет"></button>`).join("")}
          <span class="bd-sep"></span>
          <button data-zoom="in" title="Увеличить" aria-label="Увеличить">+</button>
          <button data-zoom="reset" title="Масштаб 100%" data-zoom-label aria-label="Масштаб 100%">100%</button>
          <button data-zoom="out" title="Уменьшить" aria-label="Уменьшить">−</button>
          <button data-zoom="fit" data-l="По ширине" title="По ширине экрана" aria-label="По ширине">⇔</button>
          <span class="bd-sep"></span>
          <button data-act="undo" data-l="Отмена" title="Отменить (Ctrl+Z)">↶</button>
          <button data-act="redo" data-l="Вернуть" title="Вернуть (Ctrl+Shift+Z)">↷</button>
          <button data-tool="touch" data-l="Нажимать" title="Нажимать и вводить внутри листа, сайта или презентации">👆</button>
          <button data-act="attach" data-l="Файл" title="Прикрепить фото, PDF или документ">📎</button>
          <span class="bd-sep"></span>
          <button data-act="embed" data-l="Сайт" title="Встроить сайт: Wordwall, YouTube, Google Презентации, Canva…" ${o.role === "teacher" ? "" : "hidden"}>🌐</button>
          <button data-act="camera" data-l="Камера" title="Фото с камеры" ${o.role === "teacher" ? "" : "hidden"}>📷</button>
          <button data-act="stick" data-l="Задание" title="Прикрепить задание урока на холст" ${o.role === "teacher" ? "" : "hidden"}>📌</button>
          <button data-act="snap" data-l="Снимок" title="Снимок листа со всеми пометками" ${o.role === "teacher" ? "" : "hidden"}>📸</button>
          ${o.role === "teacher" ? `<button data-act="clear" data-l="Очистить" title="Очистить лист">🧹</button>` : ""}
          <button data-act="extend" hidden>↕</button><button data-act="insert-text" hidden>📝</button><button data-act="insert-image" hidden>🖼</button>
        </div></div>
      <div class="bd-stage"><div class="bd-wrap">
        <div class="bd-bg"></div>
        <canvas class="bd-cv"></canvas>
        <div class="bd-cursors"></div>
        <div class="bd-erasecur" hidden></div>
        <div class="bd-selbox" data-bd-sel hidden><span class="bd-sel-resize" data-bd-selresize></span></div>
        <div class="bd-sel-bar" data-bd-selbar hidden role="toolbar" aria-label="Действия с объектом">
          <button type="button" data-sel="del" title="Удалить (Delete)">🗑</button>
          <button type="button" data-sel="minus" title="Меньше шрифт (A−)">A−</button>
          <button type="button" data-sel="plus" title="Больше шрифт (A+)">A+</button>
          <button type="button" data-sel="reset" title="Сбросить размер">Сбросить</button>
        </div>
      </div></div></div>
      <div class="bd-menu" hidden role="menu" aria-label="Быстрые действия"></div>`;
    const $ = s => root.querySelector(s);
    const stage = $(".bd-stage"), wrap = $(".bd-wrap"), bg = $(".bd-bg"), cv = $(".bd-cv"), ctx = cv.getContext("2d"), curLayer = $(".bd-cursors");
    const eraseCur = $(".bd-erasecur");
    const selBox = $(".bd-selbox"), selResizeEl = $(".bd-sel-resize"), selBar = $(".bd-sel-bar");

    /* ---------- координаты и якоря к элементам листа ----------
       Ученик подчёркивает предложение, у учителя лист свёрстан иначе (другие поля/шрифт/масштаб) –
       штрих должен остаться на том же элементе. Для этого штрих хранит якорь: индекс элемента
       в .bd-bg (data-bd), смещение точки от его угла (dx/dy) и сам угол (ox/oy) в момент рисования. */
    function markAnchors(){
      bdEls = Array.from(bg.querySelectorAll("*"));
      bdEls.forEach((el, i) => el.setAttribute("data-bd", String(i)));
      bdMap = new Map(); boxesDirty = true; anchorsDirty = false;
    }
    function measureAnchors(){
      bdMap = new Map();
      if (!bdEls.length){ bdBoxes = []; return; }
      const br = bg.getBoundingClientRect();
      bdBoxes = bdEls.map(el => {
        const r = el.getBoundingClientRect();
        const b = {el, x:(r.left - br.left) / scale, y:(r.top - br.top) / scale, w:r.width / scale, h:r.height / scale, content:isContentBlock(el)};
        const i = +el.getAttribute("data-bd");
        if (Number.isFinite(i)) bdMap.set(i, b);
        return b;
      });
    }
    function shiftFor(a){
      if (!a || a.i == null || !Number.isFinite(+a.i)) return [0, 0];
      const b = bdMap.get(+a.i);
      if (!b) return [0, 0];                    // якорь не найден – рисуем как есть
      /* если на этой стороне под тем же индексом другой тег – листы разошлись сильнее макета:
         оставляем штрих на абсолютном месте, чтобы он не «прыгнул» к чужому элементу */
      if (a.tag && b.el.tagName && b.el.tagName !== a.tag) return [0, 0];
      return [b.x - a.ox, b.y - a.oy];
    }
    function shiftedPoints(s){
      if (!s) return [];
      if (!s.a) return s.p || [];
      const [dx, dy] = shiftFor(s.a);
      if (!dx && !dy) return s.p || [];
      return (s.p || []).map(([x, y]) => [x + dx, y + dy]);
    }
    /* содержательный блок листа: к нему привязываем пометку, если она стоит «в пустоте».
       Корневые обёртки (.bd-sheet, прямые дети фона) и пустые контейнеры сюда не входят. */
    const CONTENT_TAGS = {P:1, LI:1, TD:1, TH:1, H1:1, H2:1, H3:1, H4:1, H5:1, H6:1, TABLE:1, IMG:1, PRE:1, BLOCKQUOTE:1, FIGCAPTION:1, IFRAME:1, VIDEO:1};
    function isContentBlock(el){
      if (!el || !el.tagName) return false;
      if (el.parentElement === bg) return false;                        // корневая обёртка листа
      const tag = el.tagName;
      if (el.classList && (el.classList.contains("bd-sheet") || el.classList.contains("bd-embed"))) return false;
      if (CONTENT_TAGS[tag]) return true;
      if (tag === "DIV" || tag === "SECTION" || tag === "ARTICLE" || tag === "FIGURE"){
        if (!oneLine(el.textContent)) return false;                     // пустая обёртка
        return !el.querySelector("p,li,div,section,article,h1,h2,h3,h4,table,img,pre,blockquote,iframe,video");
      }
      return false;
    }
    /* ближайший по вертикали содержательный блок: предпочитаем тот, что выше точки, иначе ниже */
    function nearestContent(p, skip){
      let above = null, below = null;
      for (const b of bdBoxes){
        if (b === skip || !b.content || b.w <= 0 || b.h <= 0) continue;
        const bottom = b.y + b.h, top = b.y;
        if (bottom <= p[1] + 2){
          const d = p[1] - bottom;
          if (!above || d < above.d || (d === above.d && b.w * b.h < above.area)) above = {b, d, area:b.w * b.h};
        } else if (top >= p[1] - 2){
          const d = top - p[1];
          if (!below || d < below.d || (d === below.d && b.w * b.h < below.area)) below = {b, d, area:b.w * b.h};
        }
      }
      return above ? above.b : (below ? below.b : null);
    }
    function anchorAt(p){
      let best = null, area = Infinity;
      for (const b of bdBoxes){
        if (b.w <= 0 && b.h <= 0) continue;
        if (p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h){
          const a = b.w * b.h;
          if (a < area){ area = a; best = b; }
        }
      }
      /* «в пустоте» самый маленький содержащий элемент – это весь лист или обёртка:
         тогда привязываем пометку к ближайшему содержательному блоку (обычно к абзацу выше),
         чтобы при сдвиге макета она осталась сразу после нужного текста, а не уехала от него */
      if (best && !best.content){
        const near = nearestContent(p, best);
        if (near) best = near;
      }
      if (!best) return null;
      const i = +best.el.getAttribute("data-bd");
      if (!Number.isFinite(i)) return null;
      return {i, dx:+(p[0] - best.x).toFixed(2), dy:+(p[1] - best.y).toFixed(2), ox:+best.x.toFixed(2), oy:+best.y.toFixed(2), tag:best.el.tagName};
    }

    /* ---------- размеры, масштаб и перерисовка ---------- */
    function fitScale(){ const w = Math.max(0, stage.clientWidth || root.clientWidth || 0); return w > 0 ? w / W : 1; }
    function updateZoomLabel(){
      const b = root.querySelector("[data-zoom-label]");
      if (b) b.textContent = Math.round(scale * 100) + "%";
    }
    function layout(){
      const bar = root.querySelector(".bd-bar"), side = root.querySelector(".bd-side .bd-tools");
      if (bar && side){ const top = 66 + bar.offsetHeight + 6; side.style.top = `calc(${top}px + env(safe-area-inset-top,0px))`; side.style.maxHeight = `calc(100vh - ${top + 10}px)`; }
      if (fitMode) zoom = fitScale();
      else zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
      scale = zoom;
      if (scale !== lastViewScale){ lastViewScale = scale; try { viewChanged(); } catch (_) {} }
      bg.style.width = W + "px"; bg.style.transform = `scale(${scale})`;
      if (anchorsDirty) markAnchors();
      const bgH = bg.scrollHeight;
      if (boxesDirty || scale !== lastScale || bgH !== lastBgH){ measureAnchors(); boxesDirty = false; lastScale = scale; lastBgH = bgH; }
      let maxY = 0, maxX = 0;
      items.forEach(it => {
        if (it.t === "s"){ for (const q of shiftedPoints(it)){ if (q[1] > maxY) maxY = q[1]; if (q[0] > maxX) maxX = q[0]; } }
        else if (it.t === "i"){ const [w2, h2] = imageSize(it); maxY = Math.max(maxY, it.y + h2); if (it.x + w2 > W + 4) maxX = Math.max(maxX, it.x + w2); }
        else { maxY = Math.max(maxY, it.y + (it.h || textHeight(it))); if (it.x > W - 200) maxX = Math.max(maxX, it.x + (it.w || 300)); }
      });
      height = Math.max(1400, bgH + 200, maxY + 300) + extraHeight;
      widthL = Math.max(W, maxX > W - 40 ? maxX + 400 : 0, W + extraWidth);
      const cssW = Math.max(1, Math.round(widthL * scale));
      const cssH = Math.max(1, Math.round(height * scale));
      wrap.style.width = cssW + "px";
      wrap.style.height = cssH + "px";
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, Math.round(cssW * dpr));
      cv.height = Math.max(1, Math.round(cssH * dpr));
      cv.style.width = cssW + "px";
      cv.style.height = cssH + "px";
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      updateZoomLabel();
      redraw();
      placeEditor();
      placeCursors();
      placeEraseCur();
    }
    /* экран -> логические координаты листа (учитывает скролл и масштаб через rect канваса) */
    function toLogical(clientX, clientY){ const r = cv.getBoundingClientRect(); const s = scale || 1; return [Math.round((clientX - r.left) / s * 10) / 10, Math.round((clientY - r.top) / s * 10) / 10]; }
    function viewCenterLogical(){
      const sr = stage.getBoundingClientRect(), r = cv.getBoundingClientRect();
      return [Math.round((sr.left + sr.width / 2 - r.left) / scale), Math.round((sr.top + sr.height / 2 - r.top) / scale)];
    }
    function clampZoom(z){ z = +z; if (!Number.isFinite(z)) z = 1; return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)); }
    function setZoom(z, clientX, clientY){
      const zz = clampZoom(z);
      let lx, ly, cx, cy;
      if (clientX != null && clientY != null){ const r = cv.getBoundingClientRect(); lx = (clientX - r.left) / scale; ly = (clientY - r.top) / scale; cx = clientX; cy = clientY; }
      else { [lx, ly] = viewCenterLogical(); const sr = stage.getBoundingClientRect(); cx = sr.left + sr.width / 2; cy = sr.top + sr.height / 2; }
      fitMode = false; zoom = zz; layout();
      const sr = stage.getBoundingClientRect();
      stage.scrollLeft = Math.max(0, Math.round(lx * scale - (cx - sr.left)));
      stage.scrollTop = Math.max(0, Math.round(ly * scale - (cy - sr.top)));
      placeEraseCur();
      return scale;
    }
    function zoomBy(d){ return setZoom(scale + (+d || 0)); }
    function fitWidth(){ fitMode = true; zoom = 1; layout(); stage.scrollLeft = 0; stage.scrollTop = 0; return scale; }
    function extendHeight(px){ extraHeight += Math.max(100, Math.round(+px || 800)); layout(); return height; }
    /* вид относительно «по ширине»: ведущий и ведомый экраны разного размера видят одно и то же место */
    function getRelView(){ return {fit: fitMode, z: +(scale / fitScale()).toFixed(3), x: Math.round(stage.scrollLeft / scale), y: Math.round(stage.scrollTop / scale)}; }
    function setRelView(v){
      if (!v || typeof v !== "object") return null;
      applyingView = true;
      try {
        if (v.fit){ fitMode = true; layout(); }
        else { fitMode = false; zoom = clampZoom((+v.z || 1) * fitScale()); layout(); }
        stage.scrollLeft = Math.max(0, Math.round((+v.x || 0) * scale)); stage.scrollTop = Math.max(0, Math.round((+v.y || 0) * scale));
      } finally { setTimeout(() => { applyingView = false; }, 150); }
      return scale;
    }
    let applyingView = false, viewT = 0, lastViewSig = "";
    function viewChanged(){
      if (applyingView || typeof o.onView !== "function") return;
      clearTimeout(viewT);
      viewT = setTimeout(() => { const v = getRelView(), sig = JSON.stringify(v); if (sig === lastViewSig) return; lastViewSig = sig; try { o.onView(v); } catch (_) {} }, 160);
    }
    function getView(){ return {zoom:scale, scale, scrollX:stage.scrollLeft, scrollY:stage.scrollTop, x:Math.round(stage.scrollLeft / scale), y:Math.round(stage.scrollTop / scale)}; }
    function maybeGrowWidth(p){
      if (!p || p[0] < widthL - 100) return;
      const now = performance.now();
      if (now - lastGrowW < 400) return;
      lastGrowW = now;
      extraWidth = Math.max(extraWidth, widthL - W) + Math.max(300, Math.round(W * 0.4));
      layout();
    }
    let lastGrowW = 0;
    function maybeGrowHeight(p){
      if (p) maybeGrowWidth(p);
      if (!p || p[1] < height - 120) return;
      const now = performance.now();
      if (now - lastGrow < 500) return;
      lastGrow = now;
      extraHeight += Math.max(300, Math.round(height * 0.25));
      layout();
    }
    /* после КАЖДОЙ установки innerHTML листа: разметить/перемерить якоря, дождаться картинок и шрифтов */
    function afterSheet(){
      markAnchors();
      bg.querySelectorAll("img").forEach(im => {
        if (!im.complete){
          im.addEventListener("load", () => { boxesDirty = true; layout(); }, {once:true});
          im.addEventListener("error", () => { boxesDirty = true; layout(); }, {once:true});
        }
      });
      requestAnimationFrame(() => { if (root.isConnected) layout(); });
      setTimeout(() => { if (root.isConnected){ boxesDirty = true; layout(); } }, 120);
      setTimeout(() => { if (root.isConnected){ boxesDirty = true; layout(); } }, 500);
      try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (root.isConnected){ boxesDirty = true; layout(); } }); } catch (_) {}
    }

    function drawSeg(a, b, s){
      const [sx, sy] = s.a ? shiftFor(s.a) : [0, 0];
      const P = s.p, n = P.length;
      ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = s.c; ctx.lineWidth = s.w; ctx.globalAlpha = s.h ? 0.35 : 1;
      if (n < 3){ ctx.beginPath(); ctx.moveTo(a[0] + sx, a[1] + sy); ctx.lineTo((a[0] + b[0]) / 2 + sx, (a[1] + b[1]) / 2 + sy); ctx.stroke(); ctx.restore(); return; }
      const p0 = P[n - 3], p1 = P[n - 2], p2 = P[n - 1];
      ctx.beginPath();
      ctx.moveTo((p0[0] + p1[0]) / 2 + sx, (p0[1] + p1[1]) / 2 + sy);
      ctx.quadraticCurveTo(p1[0] + sx, p1[1] + sy, (p1[0] + p2[0]) / 2 + sx, (p1[1] + p2[1]) / 2 + sy);
      ctx.stroke(); ctx.restore();
    }
    function drawStroke(s){
      const pts = shiftedPoints(s);
      if (!pts.length) return;
      ctx.save();
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = s.c; ctx.lineWidth = s.w; ctx.globalAlpha = s.h ? 0.35 : 1;
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.1, pts[0][1]);
      else if (pts.length === 2) ctx.lineTo(pts[1][0], pts[1][1]);
      else {   // плавная линия: кривые через середины соседних точек
        for (let i = 1; i < pts.length - 1; i++) ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      }
      ctx.stroke(); ctx.restore();
    }
    /* ---------- текст: размер шрифта sz у каждой надписи (12..96, по умолчанию 22) ---------- */
    function textSz(t){ const z = +((t && t.sz) || TEXT_SZ_DEFAULT); return Math.min(TEXT_SZ_MAX, Math.max(TEXT_SZ_MIN, Number.isFinite(z) ? z : TEXT_SZ_DEFAULT)); }
    function textFont(sz){ return `600 ${sz}px Manrope, system-ui, sans-serif`; }
    function textLineH(sz){ return Math.max(10, Math.round((+sz || TEXT_SZ_DEFAULT) * TEXT_LINE / TEXT_SZ_DEFAULT)); }
    function wrapLines(text, maxW, sz){
      const z = +sz || TEXT_SZ_DEFAULT;
      const out = [];
      ctx.save();
      ctx.font = textFont(z);
      for (const raw of String(text == null ? "" : text).split("\n")){
        if (!raw){ out.push(""); continue; }
        let line = "";
        for (const word of raw.split(" ")){
          const test = line ? line + " " + word : word;
          if (line && ctx.measureText(test).width > maxW){ out.push(line); line = word; }
          else line = test;
        }
        out.push(line);
      }
      ctx.restore();
      return out;
    }
    function textLines(t){ return wrapLines(t.s, t.w || DEFAULT_TEXT_W, textSz(t)); }
    function textHeight(t){ const lh = textLineH(textSz(t)); return Math.max(lh, textLines(t).length * lh); }
    function drawText(t){
      const z = textSz(t), lh = textLineH(z);
      const lines = textLines(t);
      ctx.save(); ctx.font = textFont(z);
      if (t.note){
        const widest = Math.max(TEXT_MIN_W, ...lines.map(l => ctx.measureText(l || " ").width)) + 16;
        const hh = Math.max(lh, lines.length * lh) + 10;
        ctx.fillStyle = "rgba(123,76,245,.12)";
        ctx.strokeStyle = "rgba(123,76,245,.35)"; ctx.lineWidth = 1;
        if (ctx.roundRect){ ctx.beginPath(); ctx.roundRect(t.x - 6, t.y - 5, widest, hh, 8); ctx.fill(); ctx.stroke(); }
        else ctx.fillRect(t.x - 6, t.y - 5, widest, hh);
      }
      ctx.fillStyle = t.c || COLORS[0]; ctx.font = textFont(z); ctx.textBaseline = "top";
      lines.forEach((line, i) => { if (line) ctx.fillText(line, t.x, t.y + i * lh); });
      ctx.restore();
    }
    function imageSize(it){ const w = it.w || 480; return [w, it.h || w / (it.ratio || 1.5)]; }
    function drawImageItem(it){
      const [w2, h2] = imageSize(it);
      const cached = imgCache.get(it.src);
      if (cached && cached.complete && cached.naturalWidth){ ctx.drawImage(cached, it.x, it.y, w2, h2); return; }
      if (!cached){ const im = new Image(); im.onload = () => redraw(); im.onerror = () => redraw(); im.src = it.src; imgCache.set(it.src, im); }
      ctx.save(); ctx.fillStyle = "#f1eefb"; ctx.fillRect(it.x, it.y, w2, h2); ctx.restore();
    }
    function redraw(){
      ctx.clearRect(0, 0, widthL, height + 50);
      items.forEach(it => { if (it.t === "s") drawStroke(it); else if (it.t === "i") drawImageItem(it); else if (it.t === "t") drawText(it); });
      drafts.forEach(d => drawStroke(d));
      if (drawing && !drawing.erase) drawStroke(drawing);
      placeCursors();
      placeSelection();
    }
    function pos(e){ const r = cv.getBoundingClientRect(); const s = scale || 1; return [Math.round((e.clientX - r.left) / s * 10) / 10, Math.round((e.clientY - r.top) / s * 10) / 10]; }

    /* ---------- hit-test по объектам ---------- */
    function itemBox(it){
      if (it.t === "i"){ const [w2, h2] = imageSize(it); return {x:it.x, y:it.y, w:w2, h:h2}; }
      if (it.t === "t"){ return {x:it.x, y:it.y, w:it.w || DEFAULT_TEXT_W, h:it.h || textHeight(it)}; }
      return null;
    }
    function contains(b, p){ return p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h; }
    function entriesTopFirst(){ const a = Array.from(items.entries()); a.reverse(); return a; }
    function hitOf(p, types){
      for (const [id, it] of entriesTopFirst()){
        if (types && types.indexOf(it.t) < 0) continue;
        if (it.t === "s"){
          if (!types) continue;
          continue;
        }
        const b = itemBox(it);
        if (b && contains(b, p)) return id;
      }
      return null;
    }
    function hitAny(p){
      for (const [id, it] of entriesTopFirst()){
        if (it.t === "s"){ for (const q of shiftedPoints(it)) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 14 + (it.w || 3)) return id; }
        else { const b = itemBox(it); if (b && contains(b, p)) return id; }
      }
      return null;
    }
    /* пропуск для заполнения на основном листе (.blank / input / span.blank) под точкой тапа */
    function blankAt(p){
      let best = null, area = Infinity;
      for (const b of bdBoxes){
        const el = b.el;
        if (!el || !el.matches || b.w <= 0 || b.h <= 0) continue;
        if (!(el.matches(".blank, span.blank, input, textarea") || (el.classList && el.classList.contains("blank")))) continue;
        if (p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h){
          const a = b.w * b.h;
          if (a < area){ area = a; best = b; }
        }
      }
      return best;
    }

    /* ---------- выделение объекта: рамка .bd-selbox, панель .bd-sel-bar, удаление, ресайз ---------- */
    function selectedItem(){
      if (selectedId == null) return null;
      const it = items.get(String(selectedId));
      return it && (it.t === "i" || it.t === "t") ? it : null;
    }
    function selectedInfo(){
      const it = selectedItem();
      if (!it) return null;
      const b = itemBox(it);
      const o = {id:String(selectedId), type:it.t, x:Math.round(b.x), y:Math.round(b.y), w:Math.round(b.w), h:Math.round(b.h)};
      if (it.t === "t") o.sz = textSz(it);
      return o;
    }
    function select(id){
      if (id == null || id === ""){ selectedId = null; selResize = null; placeSelection(); return null; }
      const it = items.get(String(id));
      if (!it || (it.t !== "i" && it.t !== "t")){ selectedId = null; selResize = null; placeSelection(); return null; }
      selectedId = String(id);
      /* база для кнопки «Сбросить»: исходный размер картинки (у старых объектов – текущий) */
      if (it.t === "i" && (it.bw == null || it.bh == null)){ it.bw = it.w; it.bh = it.h; }
      placeSelection();
      return selectedInfo();
    }
    function placeSelection(){
      if (!selBox) return;
      const it = selectedItem();
      if (!it){ selBox.hidden = true; if (selBar) selBar.hidden = true; return; }
      const b = itemBox(it);
      const x = b.x * scale, y = b.y * scale, w2 = Math.max(2, b.w * scale), h2 = Math.max(2, b.h * scale);
      selBox.hidden = false;
      selBox.setAttribute("data-id", String(selectedId));
      selBox.style.left = Math.round(x) + "px";
      selBox.style.top = Math.round(y) + "px";
      selBox.style.width = Math.round(w2) + "px";
      selBox.style.height = Math.round(h2) + "px";
      if (selResizeEl) selResizeEl.hidden = false;
      if (selBar){
        const isT = it.t === "t";
        selBar.hidden = false;
        selBar.querySelectorAll('[data-sel="minus"], [data-sel="plus"]').forEach(b2 => { b2.hidden = !isT; });
        /* панель над рамкой, если не влезает – под ней; не вылезаем за пределы листа */
        const bw = selBar.offsetWidth || 190, bh = selBar.offsetHeight || 32;
        let bx = Math.round(x + w2 / 2 - bw / 2);
        let by = Math.round(y - bh - 8);
        if (by < 2) by = Math.round(y + h2 + 8);
        const maxX = Math.max(2, Math.round(widthL * scale) - bw - 4);
        const maxY = Math.max(2, Math.round(height * scale) - bh - 4);
        selBar.style.left = Math.max(2, Math.min(bx, maxX)) + "px";
        selBar.style.top = Math.max(2, Math.min(by, maxY)) + "px";
      }
    }
    async function deleteSelected(){
      const it = selectedItem();
      if (!it) return false;
      const id = String(selectedId);
      select(null);
      await removeIds([id]);
      return true;
    }
    /* сохранить изменённый объект: replaceItem (add новых размеров + remove старого), выделение – на новый id */
    async function persistSelected(newItem, fallback){
      const id = selectedId != null ? String(selectedId) : null;
      if (!id || selBusy) return null;
      selBusy = true;
      try {
        const nid = await replaceItem(id, newItem, fallback);
        if (nid != null){ selectedId = String(nid); placeSelection(); }
        else redraw();
        return nid;
      } finally { selBusy = false; }
    }
    function enqueueSelPersist(snapshot, fallback){
      if (selectedId == null) return;
      selPending++;
      selQueue = selQueue.then(() => persistSelected(snapshot, fallback)).catch(() => null).finally(() => { selPending--; });
    }
    async function changeTextSz(delta){
      const it = selectedItem();
      if (!it || it.t !== "t") return false;
      const z = Math.min(TEXT_SZ_MAX, Math.max(TEXT_SZ_MIN, textSz(it) + (+delta || 0)));
      if (z === textSz(it)) return false;
      const base = Object.assign({}, it);
      const ni = Object.assign({}, it, {sz:z});
      ni.h = textHeight(ni);
      items.set(String(selectedId), ni);
      redraw(); placeSelection();
      enqueueSelPersist(Object.assign({}, ni), base);
      return true;
    }
    async function resetSelected(){
      const it = selectedItem();
      if (!it) return false;
      const base = Object.assign({}, it);
      let ni;
      if (it.t === "i"){
        const r = +it.ratio || (it.w && it.h ? it.w / it.h : 1.5);
        const bw = +it.bw || 480, bh = +it.bh || Math.round(bw / (r || 1.5));
        ni = Object.assign({}, it, {w:bw, h:bh});
      } else {
        const sz = TEXT_SZ_DEFAULT;
        const tb = autoTextBox(it.s, sz);
        ni = Object.assign({}, it, {sz, w:tb.w, h:0});
        ni.h = textHeight(ni);
      }
      items.set(String(selectedId), ni);
      redraw(); placeSelection();
      enqueueSelPersist(Object.assign({}, ni), base);
      return true;
    }
    function selBarAction(kind){
      if (kind === "del") return deleteSelected();
      if (kind === "minus") return changeTextSz(-2);
      if (kind === "plus") return changeTextSz(2);
      if (kind === "reset") return resetSelected();
      return false;
    }
    /* ресайз за угол .bd-sel-resize: картинка – с пропорциями (Shift – свободно), текст – ширина/высота */
    function startSelResize(e){
      const it = selectedItem();
      if (!it) return;
      e.preventDefault(); e.stopPropagation();
      const b = itemBox(it);
      selResize = {sx:e.clientX, sy:e.clientY, w:b.w, h:b.h, ratio:(b.w || 1) / (b.h || 1), base:Object.assign({}, it), changed:false};
      try { selResizeEl.setPointerCapture(e.pointerId); } catch (_) {}
    }
    function onSelResizeMove(e){
      if (!selResize) return;
      const it = selectedItem();
      if (!it){ endSelResize(e); return; }
      e.preventDefault();
      const dx = (e.clientX - selResize.sx) / scale, dy = (e.clientY - selResize.sy) / scale;
      const sw = selResize.w, sh = selResize.h;
      if (it.t === "i"){
        if (e.shiftKey){
          it.w = Math.max(SEL_MIN, Math.round(sw + dx));
          it.h = Math.max(SEL_MIN, Math.round(sh + dy));
        } else {
          const k = Math.max(0.08, Math.max((sw + dx) / sw, (sh + dy) / sh));
          const w = Math.max(SEL_MIN, Math.round(sw * k));
          it.w = w;
          it.h = Math.max(SEL_MIN, Math.round(w / (selResize.ratio || 1.5)));
        }
      } else {
        it.w = Math.max(SEL_MIN, Math.round(sw + dx));
        it.h = Math.max(20, Math.round(sh + dy));
        if (it.sz == null) it.sz = TEXT_SZ_DEFAULT;
      }
      selResize.changed = true;
      redraw(); placeSelection();
    }
    function endSelResize(e){
      const sr = selResize;
      if (!sr) return;
      selResize = null;
      try { selResizeEl.releasePointerCapture(e.pointerId); } catch (_) {}
      const it = selectedItem();
      if (!it || !sr.changed) return;
      enqueueSelPersist(Object.assign({}, it), sr.base);
    }
    if (selResizeEl){
      selResizeEl.addEventListener("pointerdown", startSelResize);
      selResizeEl.addEventListener("pointermove", onSelResizeMove);
      selResizeEl.addEventListener("pointerup", endSelResize);
      selResizeEl.addEventListener("pointercancel", endSelResize);
    }
    if (selBar){
      selBar.addEventListener("pointerdown", e => e.stopPropagation());
      selBar.addEventListener("click", e => {
        const b = e.target.closest("[data-sel]"); if (!b) return;
        e.preventDefault(); e.stopPropagation();
        selBarAction(b.dataset.sel);
      });
    }

    /* ---------- лист ---------- */
    function stepPage(dir){
      const i = pagesArr.findIndex(x => x.key === page);
      const nx = pagesArr[(i + dir + pagesArr.length) % pagesArr.length];
      if (!nx) return;
      openPage(nx.key);
      if (o.role === "teacher") send("page", { page: nx.key });
    }
    const onKey = e => {
      if (!root.isConnected) return;
      const ae = document.activeElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(ae?.tagName || "") || ae?.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "z" || e.key === "Z" || e.key === "я" || e.key === "Я")){ e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y" || e.key === "н" || e.key === "Н")){ e.preventDefault(); redo(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedItem()){
        e.preventDefault(); deleteSelected(); return;
      }
      if (e.key === "Escape" && selectedItem()){ e.preventDefault(); select(null); return; }
      if (e.key === "ArrowRight" || e.key === "PageDown") { stepPage(1); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { stepPage(-1); }
    };
    document.addEventListener("keydown", onKey);
    /* инструмент «рука» теперь панорамирует холст (см. pointer-обработчики канваса) */
    function renderPageButtons(){
      const box = root.querySelector(".bd-pages"); if (!box) return;
      box.innerHTML = `<button data-pstep="-1" title="Предыдущий лист" aria-label="Предыдущий лист">‹</button>` +
        pagesArr.map(p => `<button data-bpage="${esc(p.key)}" aria-pressed="${p.key === page}">${esc(p.label)}</button>`).join("") +
        `<button data-pstep="1" title="Следующий лист" aria-label="Следующий лист">›</button>`;
    }
    /* «живые» листы: урок прямо на доске (теория, задания, тест, письмо) – отвечать можно в самом листе, рисовать – поверх */
    let live = o.live || {};
    function paintLive(force){
      /* учитель: если ученик уже присылал этот лист – показываем ровно его html (один и тот же фон
         у обеих сторон), а свои ключи/заметки учитель видит в панели урока */
      if (isTeacher && remoteBg.has(page)){
        const html = remoteBg.get(page);
        const busy = !force && bg.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
        if (!busy && bg.innerHTML !== html){
          const y = scrollY;
          try { bg.innerHTML = html; } catch(e) { console.warn(e); }
          if (scrollY !== y) scrollTo(0, y);
          boxesDirty = true;
        }
        bgSource = "remote";
        cancelBgReq();
        return true;
      }
      const fn = live[page]; if (!fn) return false;
      if (!force && bg.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return true;
      const y = scrollY; try { fn(bg); } catch(e) { console.warn(e); } if (scrollY !== y) scrollTo(0, y);
      bgSource = "own";
      if (isTeacher) requestBg(page);          // свой вариант – только до ответа ученика
      else if (isStudent) bgSendSoon(page);    // ученик делится листом с учителем
      return true;
    }

    /* ---------- общий фон живого листа: ученик присылает html, учитель просит его ---------- */
    function bgSignature(html){
      const s = String(html || "");
      let h = 5381;
      for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
      return s.length + ":" + h;
    }
    /* html живого листа у ученика: текущая страница – как есть, другая – рисуем в detached div */
    function liveHtmlFor(k){
      k = String(k || page);
      if (k === page) return bg.innerHTML;
      const cached = liveBgCache.get(k);
      if (cached != null) return cached;
      const fn = live[k];
      if (!fn) return null;
      const d = document.createElement("div");
      fn(d);
      const html = d.innerHTML;
      liveBgCache.set(k, html);
      return html;
    }
    function bgSendSoon(k){
      if (!isStudent || !channel) return;
      k = String(k || page);
      clearTimeout(bgSendT);
      bgSendT = setTimeout(() => { bgSendT = 0; sendBgNow(k); }, 150);
    }
    /* ученик: после отрисовки живого листа отправляем его html учителю (без повторов) */
    function sendBgNow(k){
      if (!isStudent || !channel) return;
      k = String(k || page);
      if (!live[k]) return;                    // у статичных листов html и так одинаковый у обеих сторон
      try {
        const html = liveHtmlFor(k);
        if (html == null || html.length > BG_MAX) return;
        const sig = bgSignature(html);
        if (lastBgSent.get(k) === sig) return;
        lastBgSent.set(k, sig);
        send("bg", {page:k, html, rev:Date.now()});
      } catch(e) { try { console.warn("bg", e); } catch(_) {} }
    }
    /* ученик: учитель просит лист (bgreq) – отвечаем даже для не текущей страницы */
    function answerBgReq(k){
      if (!isStudent || !channel) return;
      k = String(k || page);
      try {
        const html = liveHtmlFor(k);
        if (html == null || html.length > BG_MAX) return;
        lastBgSent.set(k, bgSignature(html));
        send("bg", {page:k, html, rev:Date.now()});
      } catch(e) { try { console.warn("bgreq", e); } catch(_) {} }
    }
    /* учитель: приняли лист ученика – сохраняем и, если он открыт, показываем */
    function applyRemoteBg(k, html){
      if (!isTeacher || typeof html !== "string" || !html) return;
      k = String(k);
      remoteBg.set(k, html);
      if (k !== String(page)) return;          // не текущая страница – только запомнили
      cancelBgReq();
      if (bgSource === "remote" && bg.innerHTML === html) return;
      const y = scrollY;
      try { bg.innerHTML = html; } catch(e) { try { console.warn("bg", e); } catch(_) {} return; }
      if (scrollY !== y) scrollTo(0, y);
      bgSource = "remote";
      boxesDirty = true;
      afterSheet();
      layout();
    }
    function sendBgReq(k){ if (!isTeacher || !channel) return; try { send("bgreq", {page:String(k || page)}); } catch(_) {} }
    /* учитель: своего варианта листа мало – просим у ученика (и один повтор, если ответа нет) */
    function requestBg(k){
      if (!isTeacher || !channel) return;
      k = String(k || page);
      if (remoteBg.has(k) || k !== String(page)) return;
      const now = Date.now();
      if (bgReqPage === k && now - bgReqAt < 1200) return;
      bgReqPage = k; bgReqAt = now;
      sendBgReq(k);
      clearTimeout(bgReqT);
      bgReqT = setTimeout(() => {
        bgReqT = 0;
        if (!isTeacher || !channel || remoteBg.has(k) || String(page) !== k) return;
        bgReqPage = k; bgReqAt = Date.now();
        sendBgReq(k);
      }, 900);
    }
    function cancelBgReq(){ if (bgReqT){ clearTimeout(bgReqT); bgReqT = 0; } }
    function studentOnline(){
      for (const p of peers.values()) if (p.online && p.role !== "teacher") return true;
      return false;
    }
    function maybeRequestBg(){
      if (!isTeacher || !channel) return;
      if (remoteBg.has(page) || !live[page]) return;
      if (studentOnline()){
        /* ученик появился/сменил лист – просим фон заново, даже если недавно уже просили:
           первое сообщение могло уйти до подписки канала */
        bgReqAt = 0; bgReqPage = "";
        requestBg(page);
      }
    }
    async function openPage(key){
      if (!pagesArr.length) return;
      key = String(key);
      if (!pagesArr.some(p => p.key === key)) key = pagesArr[0].key;
      if (editor) closeEditor(true);
      moving = null; textTap = null; selectedId = null; selResize = null;
      if (page && page !== key) pageCache.set(page, [...items.entries()].filter(([id]) => !isTemp(id)).map(([id, item]) => ({id, item})));
      const tok = ++openTok;
      page = key;
      renderPageButtons();
      const pg = pagesArr.find(p => p.key === key);
      if (!paintLive(true)){ bg.innerHTML = pg ? pg.html : ""; bgSource = "static"; }
      afterSheet();
      if (live[key]) setTool("touch");
      items = new Map(); mine = []; drafts.clear(); setTimeout(histState, 0);
      const cached = pageCache.get(key);
      if (cached) { cached.forEach(r => { if (r && r.item) items.set(String(r.id), r.item); }); }
      layout();
      if (cached) setTimeout(() => resync(true), 50);   // пока лист был закрыт, записи могли измениться
      if (!cached) {
        try {
          const list = await o.api.load(key) || [];
          if (tok !== openTok || page !== key) return;
          list.forEach(r => {
            if (!r) return;
            const it = r.item || r;
            if (!it || !it.t) return;
            const id = r.id != null ? String(r.id) : "r" + rid();
            items.set(id, it);
          });
          pageCache.set(key, list);
          layout();
        } catch(_) {}
      }
      sendPresence();
      if (typeof o.onPage === "function"){ try { o.onPage(key); } catch (_) {} }
    }
    /* раскладка вложений без наложений: низ самого нижнего объекта + 30, первый – на y=100 */
    function nextFreeY(){
      let bottom = 0;
      items.forEach(it => {
        if (it.t === "i" || it.t === "t"){
          const b = itemBox(it);
          if (b) bottom = Math.max(bottom, b.y + b.h);
        }
      });
      return bottom > 0 ? Math.round(bottom + 30) : 100;
    }

    /* ---------- дополнительные листы (презентации, документы, сайты) ---------- */
    function fitPageHtml(html){
      let h = String(html || "");
      if (h.length <= PAGE_HTML_MAX) return h;
      h = h.replace(/<img\b[^>]*>/gi, `<span class="small muted">[изображение не поместилось на лист]</span>`);
      if (h.length <= PAGE_HTML_MAX) return h;
      const room = PAGE_HTML_MAX - 120;
      let cut = room;
      const lt = h.lastIndexOf("<", room);
      if (lt > 100) cut = lt;
      return h.slice(0, cut) + "\n</div>";
    }
    async function persistPage(p){
      if (!p || p.saved) return;
      saving++;
      try {
        /* html уже приведён к лимиту в addPageP; повторная проверка – на случай прямого вызова */
        const html = fitPageHtml(p.html);
        if (html !== p.html){ p.html = html; if (page === p.key){ if (!paintLive(true)){ bg.innerHTML = html; bgSource = "static"; } afterSheet(); layout(); } }
        try {
          const id = await o.api.add(PAGE_KEY, {t:"pg", key:p.key, label:p.label, html:p.html});
          p.saved = true; p.dbId = id;
        } catch (e1){
          const minimal = `<div class="bd-sheet"><h2>${esc(p.label)}</h2><p class="small muted">Материал слишком большой, чтобы сохраниться целиком.</p></div>`;
          try {
            const id = await o.api.add(PAGE_KEY, {t:"pg", key:p.key, label:p.label, html:minimal});
            p.saved = true; p.dbId = id; p.html = minimal;
            if (page === p.key){ if (!paintLive(true)){ bg.innerHTML = minimal; bgSource = "static"; } afterSheet(); layout(); }
            /* у второй стороны уже мог быть более полный html – синхронизируем тем же ключом */
            if (p.broadcast) send("addpage", {key:p.key, label:p.label, html:minimal, update:true});
            toast("Лист слишком большой: сохранена краткая версия.");
          } catch (e2){
            toast("Лист доски не сохранится после перезагрузки: " + oneLine(e2 && e2.message || "нет связи"));
          }
        }
      } finally { saving--; }
    }
    function addPageP(label, html, broadcast){
      const key = "x" + Date.now().toString(36) + rid().slice(0, 3);
      /* обрезаем СИНХРОННО до push/broadcast: у обеих сторон должен быть один и тот же html */
      const clean = fitPageHtml(String(html || ""));
      const p = {key, label: String(label || "Лист").slice(0, 24), html: clean, saved: false, broadcast: !!broadcast};
      pagesArr.push(p);
      renderPageButtons();
      persistPage(p);
      if (broadcast) send("addpage", {key, label: p.label, html: clean});
      return key;
    }
    /* вставка нового листа из панели учителя: добавить, открыть у себя и показать ученику */
    function insertPageAt(label, html, broadcast, opts){
      const bcast = broadcast !== false;
      const key = addPageP(label, html, bcast);
      if (!opts || opts.open !== false){
        openPage(key);
        if (o.role === "teacher" && bcast) send("page", {page:key});
      }
      return key;
    }
    async function syncPages(){
      let rows = [];
      try { rows = await o.api.load(PAGE_KEY) || []; } catch (_) { return; }
      rows.forEach(r => {
        if (!r) return;
        const it = r.item || r;
        if (!it || (it.t !== "pg" && it.t !== "page") || !it.key) return;
        const ex = pagesArr.find(p => p.key === String(it.key));
        if (ex){ ex.saved = true; if (!ex.html && it.html) ex.html = String(it.html); return; }
        pagesArr.push({key:String(it.key), label:it.label || "Лист", html:String(it.html || ""), saved:true});
      });
      renderPageButtons();
    }
    /* встроить сайт (Wordwall, YouTube, Google Презентации, Canva, любая страница с разрешённым встраиванием) */
    function embedURL(u){
      u = String(u || "").trim(); if (!/^https?:\/\//i.test(u)) u = "https://" + u;
      let m;
      if ((m = u.match(/youtu\.be\/([\w-]+)/) || u.match(/youtube\.com\/watch\?v=([\w-]+)/))) return "https://www.youtube.com/embed/" + m[1];
      if ((m = u.match(/docs\.google\.com\/presentation\/d\/([\w-]+)/))) return "https://docs.google.com/presentation/d/" + m[1] + "/embed?start=false&loop=false";
      if ((m = u.match(/wordwall\.net\/(?:ru\/)?resource\/(\d+)/))) return "https://wordwall.net/embed/resource/" + m[1];
      if (/canva\.com\/design\//.test(u) && !/[?&]embed/.test(u)) return u.split("?")[0].replace(/\/(edit|view)$/, "/view") + "?embed";
      if ((m = u.match(/rutube\.ru\/video\/([\w]+)/))) return "https://rutube.ru/play/embed/" + m[1];
      return u;
    }
    function embedPage(url, label, h){
      const src = embedURL(url), hh = Math.max(300, Math.min(2400, +h || 560));
      return addPageP(label || "Сайт", `<div class="bd-sheet bd-embed"><iframe src="${esc(src)}" style="width:100%;height:${hh}px;border:0;border-radius:12px;background:#fff" allow="autoplay; fullscreen; clipboard-write; encrypted-media; picture-in-picture" allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe><p class="small muted" style="margin-top:6px">Чтобы нажимать внутри сайта, выберите 👆 «Работать с сайтом». Чтобы рисовать поверх – ручку ✎.</p></div>`, true);
    }

    /* ---------- рисование ---------- */
    function placeEraseCur(ev){
      if (!eraseCur) return;
      if (tool !== "erase"){ eraseCur.hidden = true; return; }
      eraseCur.hidden = false;
      const d = Math.max(10, Math.round(2 * ER * scale));
      eraseCur.style.width = eraseCur.style.height = d + "px";
      if (ev && ev.clientX != null){
        const r = wrap.getBoundingClientRect();
        eraseCur.style.left = (ev.clientX - r.left - d / 2) + "px";
        eraseCur.style.top = (ev.clientY - r.top - d / 2) + "px";
      }
    }
    function setTool(t){
      tool = t;
      root.querySelectorAll("[data-tool]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tool === t)));
      cv.style.touchAction = "none";
      cv.style.cursor = t === "hand" ? "grab" : t === "text" ? "text" : t === "move" ? "move" : t === "erase" ? "none" : "crosshair";
      cv.style.pointerEvents = t === "touch" ? "none" : "";
      bg.style.pointerEvents = t === "touch" ? "auto" : "";
      if (eraseCur) eraseCur.hidden = t !== "erase";
      const esz = root.querySelector(".bd-esz"); if (esz){ esz.hidden = t !== "erase"; syncEraseSize(); }
    }
    function syncEraseSize(){
      const cur = Object.keys(ER_SIZES).find(k => ER_SIZES[k] === ER) || "m";
      root.querySelectorAll("[data-esz]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.esz === cur)));
    }
    function setColor(c){ color = c; root.querySelectorAll("[data-color]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.color === c))); }

    async function addItem(item){
      const pg = page;
      const tmp = "tmp" + rid();
      items.set(tmp, item); redraw();
      send("add", {id:tmp, item, page:pg, opt:true});     // сразу показываем второй стороне, не ждём базу
      saving++;
      try {
        const id = String(await o.api.add(pg, item));
        items.delete(tmp);
        if (page === pg){ items.set(id, item); mine.push(id); layout(); }
        else redraw();
        send("add", {id, item, page:pg, tmp});
        st8(id);
        if (page === pg) hpush({added:[id], removed:[]});
        return id;
      } catch(_) {
        items.delete(tmp); redraw();
        send("remove", {ids:["rtmp:" + tmp], page:pg});
        toast("Не сохранилось на доске. Проверьте интернет.");
        return null;
      } finally { saving--; }
    }
    async function removeRow(pg, id){
      for (let i = 0; i < 2; i++){
        try { await o.api.remove(pg, [id]); return true; }
        catch (_) { if (i === 0) await delay(600); }
      }
      return false;
    }
    async function removeIds(ids, snap){
      if (!ids || !ids.length) return;
      const pg = page;
      hpush({added:[], removed: ids.map(id => items.get(String(id)) || (snap && snap.get(String(id)))).filter(Boolean)});
      st8(ids);
      ids.forEach(id => items.delete(String(id)));
      if (selectedId != null && ids.some(id => String(id) === String(selectedId))) selectedId = null;
      redraw(); layout();
      send("remove", {ids, page:pg});                       // сначала второй стороне, потом база
      saving++;
      try { await o.api.remove(pg, ids.filter(id => !String(id).startsWith("tmp"))); } catch(_) {}
      finally { saving--; }
    }
    /* заменить объект: сначала сохраняем новую позицию, потом убираем старую (ретрай). Возвращает новый id. */
    async function replaceItem(oldId, newItem, fallback){
      const pg = page;
      oldId = String(oldId);
      const old = items.get(oldId);
      if (!old){ await addItem(newItem); return null; }
      if (oldId.startsWith("tmp")){ items.set(oldId, newItem); redraw(); layout(); return oldId; }
      let newId;
      const optId = "tmp" + rid();
      send("move", {id:oldId, newId:optId, item:newItem, page:pg, opt:true});     // второй стороне – сразу
      saving++;
      try {
        try { newId = String(await o.api.add(pg, newItem)); }
        catch (_) {
          if (items.has(oldId)){ items.set(oldId, fallback || old); redraw(); }
          send("move", {id:"rtmp:" + optId, newId:oldId, item:fallback || old, page:pg});
          toast("Не удалось сохранить. Объект остался на прежнем месте.");
          return null;
        }
        if (page === pg){
          items.delete(oldId); items.set(newId, newItem); mine.push(newId);
          if (selectedId != null && String(selectedId) === oldId) selectedId = String(newId);
          redraw(); layout();
        }
        const ok = await removeRow(pg, oldId);
        send("move", {id:oldId, newId, item:newItem, page:pg, tmp:optId});
        st8(oldId, newId);
        if (page === pg) hpush({added:[newId], removed:[fallback || old]});
        if (!ok) toast("Старая копия могла остаться на доске.");
      } finally { saving--; }
      return newId;
    }

    /* ---------- инлайн-редактор текста: маленькое окошко в точке, без «окна» и «Готово» ---------- */
    function autoSizeInline(ed){
      const el = ed.el, ta = ed.ta;
      let cs = null; try { cs = getComputedStyle(ta); } catch (_) {}
      const szv = +((ed && ed.sz) || TEXT_SZ_DEFAULT);
      const fs = Math.max(16, Math.min(120, Math.round(szv * scale)));
      const lh = Math.max(10, Math.round(fs * TEXT_LINE / TEXT_SZ_DEFAULT));
      ta.style.fontSize = fs + "px";
      ta.style.lineHeight = lh + "px";
      const padX = 26, padY = 12;
      /* минимум 180 CSS px: окошко не «прыгает» при вводе короткой строки (и ручка размера остаётся на месте) */
      const minCssW = Math.max(180, TEXT_MIN_W * scale);
      const maxPx = Math.max(minCssW, Math.min(TEXT_MAX_W * scale, (stage.clientWidth || 360) - 24));
      if (!ed.manual){
        ctx.save();
        ctx.font = `600 ${fs}px ${(cs && cs.fontFamily) || "Manrope, system-ui, sans-serif"}`;
        const lines = String(ta.value || "").split("\n");
        let widest = 0;
        for (const L of lines) widest = Math.max(widest, ctx.measureText(L || " ").width);
        if (!widest) widest = ctx.measureText("Печатайте").width;
        ctx.restore();
        const cssW = Math.min(maxPx, Math.max(minCssW, widest + padX));
        el.style.width = Math.round(cssW) + "px";
        ed.w = cssW / scale;
      } else {
        const cssW = Math.min(maxPx, Math.max(minCssW, ed.w * scale));
        el.style.width = Math.round(cssW) + "px";
        ed.w = cssW / scale;
      }
      const maxH = Math.max(lh + padY, TEXT_MAX_H * scale);
      const minH = lh + padY;
      ta.style.height = "auto";
      let need = Math.max(minH, ta.scrollHeight + 4);
      if (ed.manual) need = Math.max(need, ed.h * scale);
      const cssH = Math.min(maxH, Math.max(minH, need));
      el.style.height = Math.round(cssH) + "px";
      ta.style.height = Math.max(1, Math.round(cssH - padY)) + "px";
      ed.h = cssH / scale;
    }
    function openEditor(opts){
      opts = opts || {};
      if (editor) closeEditor(true);
      if (selectedId != null) select(null);
      const startX = opts.x != null ? +opts.x : 40;
      const startY = opts.y != null ? +opts.y : 40;
      const startSz = Math.min(TEXT_SZ_MAX, Math.max(TEXT_SZ_MIN, +opts.sz || TEXT_SZ_DEFAULT));
      const el = document.createElement("div");
      el.className = "bd-editor bd-inline";
      el.setAttribute("data-bd-inline", "");
      el.innerHTML = `<span class="bd-inline-drag" data-bd-inline-drag title="Перетащить" aria-hidden="true">✥</span>` +
        `<textarea class="bd-inline-ta bd-editor-ta" data-bd-inline-ta placeholder="Печатайте… (Enter – готово)" aria-label="Текст на доске"></textarea>` +
        `<span class="bd-inline-resize bd-editor-handle" data-bd-inline-resize title="Изменить размер"></span>`;
      wrap.appendChild(el);
      const ta = el.querySelector("textarea");
      ta.value = opts.s || "";
      const ed = {
        el, ta, id: opts.id || null, c: opts.c || color,
        x: Math.round(startX), y: Math.round(startY),
        w: opts.w ? +opts.w : TEXT_MIN_W, h: opts.h ? +opts.h : textLineH(startSz),
        manual: !!(opts.w || opts.h), note: !!opts.note, blank: opts.blank || null,
        sz: startSz,
        closed: false, armed: false, innerDown: false
      };
      editor = ed;
      el.style.left = Math.round(ed.x * scale) + "px";
      el.style.top = Math.round(ed.y * scale) + "px";
      autoSizeInline(ed);
      const stop = e => { e.stopPropagation(); };
      ["pointerdown", "mousedown", "click", "dblclick", "touchstart", "wheel"].forEach(t => el.addEventListener(t, stop, {passive:false}));
      el.addEventListener("pointerdown", e => { ed.innerDown = true; e.stopPropagation(); });
      el.addEventListener("pointerup", () => { ed.innerDown = false; });
      el.addEventListener("pointercancel", () => { ed.innerDown = false; });
      el.addEventListener("keydown", e => e.stopPropagation());
      /* «наведение»: синтетические mousemove/mouseover (тесты) и реальные — показывают ручку ✥ */
      const markHover = () => { try { el.classList.add("bd-hover"); } catch (_) {} };
      el.addEventListener("pointermove", markHover, {passive:true});
      el.addEventListener("mousemove", markHover, {passive:true});
      el.addEventListener("pointerdown", markHover, {passive:true});
      ta.addEventListener("input", () => { autoSizeInline(ed); textDraftSend(ed); });
      ta.addEventListener("keydown", e => {
        if (e.isComposing) return;
        if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey){ e.preventDefault(); closeEditor(true); }
        else if (e.key === "Escape"){ e.preventDefault(); closeEditor(false); }
      });
      ta.addEventListener("blur", () => {
        setTimeout(() => {
          if (editor !== ed || ed.closed) return;
          /* потеря фокуса из-за нажатия внутри окошка – возвращаем фокус, не закрываем */
          if (ed.innerDown || el.contains(document.activeElement)){
            if (ed.innerDown){ ed.innerDown = false; try { ta.focus({preventScroll:true}); } catch (_) {} }
            return;
          }
          closeEditor(ed.armed);
        }, 0);
      });
      /* ручка-перетаскивание ✥: появляется при наведении на окошко */
      const drag = el.querySelector(".bd-inline-drag");
      let ds = null;
      drag.addEventListener("pointerdown", e => {
        e.preventDefault(); e.stopPropagation();
        ed.innerDown = true;
        ds = {sx:e.clientX, sy:e.clientY, x:ed.x, y:ed.y};
        try { drag.setPointerCapture(e.pointerId); } catch (_) {}
      });
      drag.addEventListener("pointermove", e => {
        if (!ds || editor !== ed) return;
        ed.x = Math.round(ds.x + (e.clientX - ds.sx) / scale);
        ed.y = Math.round(ds.y + (e.clientY - ds.sy) / scale);
        el.style.left = Math.round(ed.x * scale) + "px";
        el.style.top = Math.round(ed.y * scale) + "px";
      });
      const endDrag = e => {
        if (!ds) return; ds = null;
        ed.innerDown = false;
        try { drag.releasePointerCapture(e.pointerId); } catch (_) {}
        if (editor === ed){ try { ta.focus({preventScroll:true}); } catch (_) {} }
      };
      drag.addEventListener("pointerup", endDrag);
      drag.addEventListener("pointercancel", endDrag);
      /* ручка изменения размера (правый нижний угол) */
      const handle = el.querySelector(".bd-editor-handle");
      let rs = null;
      handle.addEventListener("pointerdown", e => {
        e.preventDefault(); e.stopPropagation();
        ed.innerDown = true;
        rs = {sx:e.clientX, sy:e.clientY, w:el.offsetWidth, h:el.offsetHeight};
        ed.manual = true;
        try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      });
      handle.addEventListener("pointermove", e => {
        if (!rs || editor !== ed) return;
        const w = Math.max(TEXT_MIN_W * scale, Math.round(rs.w + e.clientX - rs.sx));
        const h = Math.max(24, Math.round(rs.h + e.clientY - rs.sy));
        el.style.width = w + "px"; el.style.height = h + "px";
        ta.style.height = Math.max(1, h - 12) + "px";
        ed.w = w / scale; ed.h = h / scale;
      });
      const endResize = e => {
        if (!rs) return; rs = null;
        ed.innerDown = false;
        try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
        if (editor === ed){ try { ta.focus({preventScroll:true}); } catch (_) {} }
      };
      handle.addEventListener("pointerup", endResize);
      handle.addEventListener("pointercancel", endResize);
      /* фокус: сразу и ещё раз в requestAnimationFrame (на телефоне клавиатура открывается из жеста) */
      const tryFocus = () => {
        try { ta.focus({preventScroll:true}); } catch (_) { try { ta.focus(); } catch (_) {} }
      };
      tryFocus();
      if (document.activeElement === ta) ed.armed = true;
      const later = (n) => requestAnimationFrame(() => {
        if (editor !== ed || ed.closed) return;
        if (!ed.armed) tryFocus();
        if (document.activeElement === ta){ ed.armed = true; try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_) {} }
        else if (n > 0) setTimeout(() => later(n - 1), 40);
      });
      later(3);
      return ed;
    }
    /* печать видно сразу: пока текст набирается, вторая сторона видит его по мере ввода */
    let tdT = 0;
    function textDraftSend(ed, drop, commit){
      if (!ed) return;
      if (!ed.sid) ed.sid = rid();
      clearTimeout(tdT);
      const go = () => {
        if (drop){ send("tdraft", {sid:ed.sid, drop:true, commit:!!commit, page}); return; }
        const text = String(ed.ta.value || "");
        if (!text.trim()) return;
        const item = {t:"t", x:Math.round(ed.x), y:Math.round(ed.y), w:Math.max(TEXT_MIN_W, Math.round(ed.w || (ed.el.offsetWidth / scale))), h:Math.max(textLineH(ed.sz), Math.round(ed.h || (ed.el.offsetHeight / scale))), s:text.slice(0, TEXT_MAX), c:ed.c, sz:Math.min(TEXT_SZ_MAX, Math.max(TEXT_SZ_MIN, +ed.sz || TEXT_SZ_DEFAULT))};
        if (ed.note) item.note = true; if (ed.blank) item.blank = true;
        send("tdraft", {sid:ed.sid, item, edId: ed.id != null ? String(ed.id) : null, page});
      };
      if (drop) go(); else tdT = setTimeout(go, 90);
    }
    function closeEditor(save){
      const ed = editor;
      if (!ed) return;
      editor = null; ed.closed = true;
      /* размеры берём из авто-размера (ed.w/ed.h), а не из offsetWidth: там ещё рамка 1px */
      const w2 = Math.max(TEXT_MIN_W, Math.round(ed.w || (ed.el.offsetWidth / scale)));
      const h2 = Math.max(textLineH(ed.sz), Math.round(ed.h || (ed.el.offsetHeight / scale)));
      const text = String(ed.ta.value || "").trim();
      try { ed.el.remove(); } catch (_) {}
      textDraftSend(ed, true, save && !!text);
      if (!save) return;
      if (text){
        const item = {t:"t", x:Math.round(ed.x), y:Math.round(ed.y), w:w2, h:h2, s:text.slice(0, TEXT_MAX), c:ed.c, sz:Math.min(TEXT_SZ_MAX, Math.max(TEXT_SZ_MIN, +ed.sz || TEXT_SZ_DEFAULT))};
        if (ed.note) item.note = true;
        if (ed.blank) item.blank = true;
        if (ed.id && items.has(String(ed.id))) replaceItem(ed.id, item, items.get(String(ed.id)));
        else addItem(item);
      } else if (ed.id && items.has(String(ed.id))){
        removeIds([ed.id]);
      }
    }
    function placeEditor(){
      if (!editor) return;
      const ed = editor;
      ed.el.style.left = Math.round(ed.x * scale) + "px";
      ed.el.style.top = Math.round(ed.y * scale) + "px";
      autoSizeInline(ed);
    }

    /* ---------- перемещение объектов ---------- */
    async function commitMove(mv){
      const it = items.get(mv.id);
      if (!it) return;
      const nx = Math.round(it.x), ny = Math.round(it.y);
      if (!mv.moved || (nx === Math.round(mv.orig.x) && ny === Math.round(mv.orig.y))){ redraw(); return; }
      const fallback = Object.assign({}, it, {x:mv.orig.x, y:mv.orig.y});
      await replaceItem(mv.id, Object.assign({}, it, {x:nx, y:ny}), fallback);
    }

    /* ---------- вставка в точку: текст/заметка/картинка, paste, API для панели учителя ---------- */
    function autoTextBox(text, sz){
      const z = Math.min(TEXT_SZ_MAX, Math.max(TEXT_SZ_MIN, +sz || TEXT_SZ_DEFAULT));
      const lines = wrapLines(text, TEXT_MAX_W, z);
      const lh = textLineH(z);
      ctx.save(); ctx.font = textFont(z);
      let widest = 0;
      for (const L of lines) widest = Math.max(widest, ctx.measureText(L || " ").width);
      ctx.restore();
      const w = Math.min(TEXT_MAX_W, Math.max(TEXT_MIN_W, Math.ceil(widest) + 16));
      const h = Math.min(TEXT_MAX_H, Math.max(lh, lines.length * lh + 8));
      return {w, h};
    }
    function insertPoint(x, y){
      if (x != null && y != null && Number.isFinite(+x) && Number.isFinite(+y)) return {x:Math.round(+x), y:Math.round(+y)};
      return {x:Math.round(lastPoint.x), y:Math.round(lastPoint.y)};
    }
    async function insertTextItem(text, x, y, note){
      text = String(text == null ? "" : text).trim();
      let szv = TEXT_SZ_DEFAULT;
      if (x && typeof x === "object"){ const op = x; x = op.x; y = op.y; if (op.note != null) note = !!op.note; if (op.sz != null) szv = +op.sz; }
      if (!text) return null;
      const pt = insertPoint(x, y);
      const {w, h} = autoTextBox(text, szv);
      const item = {t:"t", x:pt.x, y:pt.y, w, h, s:text.slice(0, TEXT_MAX), c: note ? COLORS[1] : color, sz:Math.min(TEXT_SZ_MAX, Math.max(TEXT_SZ_MIN, szv || TEXT_SZ_DEFAULT))};
      if (note) item.note = true;
      const id = await addItem(item);
      return id == null ? null : Object.assign({id}, item);
    }
    function imageRatio(url){
      return new Promise(res => {
        let done = false;
        const fin = r => { if (!done){ done = true; res(r); } };
        try {
          const im = new Image();
          im.onload = () => fin(im.width && im.height ? im.width / im.height : 1.5);
          im.onerror = () => fin(1.5);
          im.src = url;
          setTimeout(() => fin(1.5), 3000);
        } catch (_) { fin(1.5); }
      });
    }
    async function insertImageItem(url, x, y, w){
      if (x && typeof x === "object"){ const op = x; x = op.x; y = op.y; if (op.w != null) w = op.w; }
      url = String(url == null ? "" : url).trim();
      if (!url) return null;
      const pt = insertPoint(x, y);
      const ratio = await imageRatio(url);
      const width = Math.min(800, Math.max(60, +w || 420));
      const hh = Math.round(width / ratio);
      const item = {t:"i", x:pt.x, y:pt.y, w:width, h:hh, ratio, src:url, bw:width, bh:hh};
      const id = await addItem(item);
      return id == null ? null : Object.assign({id}, item);
    }
    async function insertImagesAt(files, at){
      let px = Math.round((at && at.x != null) ? at.x : lastPoint.x);
      let py = Math.round((at && at.y != null) ? at.y : lastPoint.y);
      let made = 0;
      for (const f of files){
        const list = await imageFileToItems(f);
        for (const it of list){
          const width = 420, hh = width / (it.ratio || 1.5);
          addItem({t:"i", x:px, y:py, w:width, h:hh, ratio:it.ratio, src:it.src, bw:width, bh:hh});
          py += hh + 20; made++;
        }
      }
      return made;
    }
    async function pasteAtPoint(){
      if (lastClipFiles && lastClipFiles.length){
        const made = await insertImagesAt(lastClipFiles, lastPoint);
        if (made) return {kind:"image", count:made};
      }
      if (lastClipText){
        openEditor({x:lastPoint.x, y:lastPoint.y, s:lastClipText});
        return {kind:"text"};
      }
      try {
        const list = await navigator.clipboard.read();
        for (const ci of list){
          let handled = false;
          for (const type of (ci.types || [])){
            if (/^image\//.test(type)){
              const blob = await ci.getType(type);
              const f = new File([blob], "clip.png", {type});
              lastClipFiles = [f];
              const made = await insertImagesAt([f], lastPoint);
              if (made){ handled = true; return {kind:"image", count:made}; }
            }
          }
          if (handled) continue;
          const txt = await ci.getType("text/plain").then(b => b.text()).catch(() => "");
          if (txt){ lastClipText = txt; openEditor({x:lastPoint.x, y:lastPoint.y, s:txt}); return {kind:"text"}; }
        }
      } catch (_) {}
      return null;
    }
    function zoomAction(kind){
      if (kind === "in") return zoomBy(Math.max(0.1, scale * 0.2));
      if (kind === "out") return zoomBy(-Math.max(0.1, scale * 0.2));
      if (kind === "reset") return setZoom(1);
      if (kind === "fit") return fitWidth();
    }

    /* «бесконечный» холст: у нижнего края лист сам удлиняется */
    stage.addEventListener("scroll", () => { if (stage.scrollLeft + stage.clientWidth > widthL * scale - 120 && widthL > W) maybeGrowWidth([widthL, 0]); if (stage.scrollTop + stage.clientHeight > height * scale - 160) maybeGrowHeight([0, height]); viewChanged(); }, {passive: true});
    /* ---------- жест двумя пальцами: щипок – масштаб, сдвиг – перемещение холста (любым инструментом) ---------- */
    const tps = new Map(); let gz = null, gRaf = 0;
    const tdist = () => { const a = [...tps.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1; };
    const tmid = () => { const a = [...tps.values()]; return {x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2}; };
    stage.addEventListener("pointerdown", e => {
      if (e.pointerType !== "touch") return;
      tps.set(e.pointerId, {x: e.clientX, y: e.clientY});
      if (tps.size === 2){
        try { cancelStroke(); } catch (_) {}
        pan = null; moving = null; textTap = null; lpClear();
        const m = tmid(); gz = {d0: tdist(), z0: scale, mx: m.x, my: m.y};
      }
      if (gz){ e.stopPropagation(); e.preventDefault(); }
    }, true);
    stage.addEventListener("pointermove", e => {
      if (e.pointerType !== "touch" || !tps.has(e.pointerId)) return;
      tps.set(e.pointerId, {x: e.clientX, y: e.clientY});
      if (!gz || tps.size < 2) return;
      e.stopPropagation(); e.preventDefault();
      if (gRaf) return;
      gRaf = requestAnimationFrame(() => {
        gRaf = 0; if (!gz || tps.size < 2) return;
        const m = tmid(), nz = clampZoom(gz.z0 * tdist() / gz.d0);
        if (Math.abs(nz - scale) > 0.004) setZoom(nz, m.x, m.y);
        stage.scrollLeft -= m.x - gz.mx; stage.scrollTop -= m.y - gz.my;
        gz.mx = m.x; gz.my = m.y;
      });
    }, true);
    const tpEnd = e => {
      if (e.pointerType !== "touch") return;
      const was = !!gz; tps.delete(e.pointerId);
      if (tps.size < 2) gz = null;
      if (was){ e.stopPropagation(); }
    };
    stage.addEventListener("pointerup", tpEnd, true);
    stage.addEventListener("pointercancel", tpEnd, true);
    /* ---------- указатели ---------- */
    /* рисует только один указатель: второй палец, ладонь при стилусе и правая кнопка мыши не дают «зигзагов» */
    let penSeen = 0, lp = null;
    const lpClear = () => { if (lp){ clearTimeout(lp.timer); lp = null; } };
    cv.addEventListener("contextmenu", e => { e.preventDefault(); openMenu(e.clientX, e.clientY); });
    cv.addEventListener("pointerdown", e => {
      closeMenu();
      if (e.pointerType === "pen") penSeen = Date.now();
      if (e.button === 2 || (e.buttons & 2) || (e.pointerType === "pen" && (e.buttons & 32))){ e.preventDefault(); end(); openMenu(e.clientX, e.clientY); return; }
      if (e.pointerType === "touch" && Date.now() - penSeen < 4000) return;   // ладонь, пока пишут стилусом
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (drawing && drawing.pid !== e.pointerId){ end(); return; }         // второй палец – это не рисунок
      if (tool === "hand"){                                                  // панорама холста рукой
        e.preventDefault();
        pan = {sx:e.clientX, sy:e.clientY, l:stage.scrollLeft, t:stage.scrollTop};
        try { cv.setPointerCapture(e.pointerId); } catch(_) {}
        cv.style.cursor = "grabbing";
        return;
      }
      const p = pos(e);
      lastPoint = {x:p[0], y:p[1]};
      maybeGrowHeight(p);
      placeEraseCur(e);
      lpClear();
      if (e.pointerType !== "mouse"){ const x = e.clientX, y = e.clientY; lp = {x, y, timer: setTimeout(() => { lp = null; cancelStroke(); openMenu(x, y); }, 550)}; }
      if (tool === "text"){   // редактор создаётся на pointerup: в pointerdown фокус теряется
        lpClear();
        textTap = {x:p[0], y:p[1], cx:e.clientX, cy:e.clientY};
        try { cv.setPointerCapture(e.pointerId); } catch(_) {}
        return;
      }
      if (tool === "move"){
        const id = hitOf(p, ["i", "t"]);
        if (!id){ select(null); return; }        // тап по пустому месту снимает выделение
        select(id);                              // тап по объекту выделяет (и дальше можно тащить)
        e.preventDefault(); lpClear();
        const it = items.get(id); if (!it) return;
        moving = {id, sx:p[0], sy:p[1], ox:it.x, oy:it.y, orig:{x:it.x, y:it.y}, moved:false};
        try { cv.setPointerCapture(e.pointerId); } catch(_) {}
        return;
      }
      try { cv.setPointerCapture(e.pointerId); } catch(_) {}
      if (tool === "erase"){ drawing = {erase:true, pid:e.pointerId, gone:new Set(), made:new Map()}; eraseAt(p); return; }
      drawing = {t:"s", c: tool === "hl" ? "#ffd23f" : color, w: tool === "hl" ? 18 : 3, h: tool === "hl", p:[p], pid:e.pointerId, sid: rid().slice(0, 6), a: anchorAt(p)};
      draftBuf = [p];
    });
    cv.addEventListener("pointermove", e => {
      const p = pos(e), now = performance.now();
      placeEraseCur(e);
      if (pan){ stage.scrollLeft = pan.l - (e.clientX - pan.sx); stage.scrollTop = pan.t - (e.clientY - pan.sy); return; }
      if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 8) lpClear();
      if (now - lastCursor > 45 && (!drawing || drawing.pid === e.pointerId)){ lastCursor = now; send("cursor", {x:p[0], y:p[1], a:anchorAt(p)}); }
      if (moving){
        const it = items.get(moving.id);
        if (!it){ moving = null; return; }
        const nx = Math.round(moving.ox + (p[0] - moving.sx));
        const ny = Math.round(moving.oy + (p[1] - moving.sy));
        if (nx !== it.x || ny !== it.y){ it.x = nx; it.y = ny; moving.moved = true; redraw(); }
        return;
      }
      if (!drawing || drawing.pid !== e.pointerId) return;
      if (drawing.erase){ let evs = []; try { evs = e.getCoalescedEvents ? e.getCoalescedEvents() : []; } catch (_) {} if (!evs || !evs.length) evs = [e]; evs.forEach(ev => eraseAt(pos(ev))); return; }
      let pts = (e.getCoalescedEvents ? e.getCoalescedEvents() : []).map(pos); if (!pts.length) pts.push(p);
      if (e.pointerType === "mouse"){   // мышь и тачпад: сглаживаем дрожание руки
        let prev = drawing.p[drawing.p.length - 1]; pts = pts.map(q => (prev = [Math.round((prev[0] + (q[0] - prev[0]) * 0.55) * 10) / 10, Math.round((prev[1] + (q[1] - prev[1]) * 0.55) * 10) / 10]));
      }
      for (const q of pts){
        const last = drawing.p[drawing.p.length - 1];
        if (Math.hypot(q[0] - last[0], q[1] - last[1]) < 1.5) continue;
        if (Math.hypot(q[0] - last[0], q[1] - last[1]) > 260) continue;      // случайный скачок указателя – пропускаем
        drawing.p.push(q); draftBuf.push(q); drawSeg(last, q, drawing);
      }
      maybeGrowHeight(p);
      if (drawing.p.length > 1500) drawing.p = drawing.p.filter((_, i2) => i2 % 2 === 0 || i2 === drawing.p.length - 1);
      if (now - lastDraft > 50 && draftBuf.length > 1){ lastDraft = now; send("draft", {sid:drawing.sid, c:drawing.c, w:drawing.w, h:drawing.h, p:draftBuf, a:drawing.a}); draftBuf = [draftBuf[draftBuf.length - 1]]; }
    });
    /* ластик стирает ТОЛЬКО то, по чему провели: линия делится на куски, стёртое пропадает */
    function textInkHit(it, p){
      const z = textSz(it), lh = textLineH(z);
      const lines = wrapLines(it.s, it.w || DEFAULT_TEXT_W, z);
      if (!lines.length) return false;
      ctx.save(); ctx.font = textFont(z);
      let hit = false;
      for (let i = 0; i < lines.length; i++){
        const y0 = it.y + i * lh, y1 = y0 + lh;
        if (p[1] < y0 || p[1] > y1) continue;
        const wl = ctx.measureText(lines[i] || "").width;
        if (p[0] >= it.x && p[0] <= it.x + Math.max(8, wl) + 4){ hit = true; break; }
      }
      ctx.restore();
      return hit;
    }
    function eraseAt(pt){
      const d = drawing; if (!d?.erase) return; let changed = false;
      const drop = id => { const cur = items.get(id); items.delete(id); if (id.startsWith("er")) d.made.delete(id); else { d.gone.add(id); (d.snap = d.snap || new Map()).set(id, cur); } changed = true; };
      [...items.entries()].forEach(([id, it]) => {
        if (it.t === "s"){
          /* штрих с якорем сдвинут к текущему положению элемента – проверяем в его координатах */
          const [dx, dy] = it.a ? shiftFor(it.a) : [0, 0];
          const rx = pt[0] - dx, ry = pt[1] - dy;
          const r2 = (ER + (it.w || 3) / 2) ** 2;
          if (!it.p.some(q => (q[0] - rx) ** 2 + (q[1] - ry) ** 2 < r2)) return;
          const runs = []; let cur = [];
          it.p.forEach(q => { if ((q[0] - rx) ** 2 + (q[1] - ry) ** 2 < r2){ if (cur.length) runs.push(cur); cur = []; } else cur.push(q); }); if (cur.length) runs.push(cur);
          drop(id);
          runs.filter(x => x.length > 1).forEach(pp => { const nid = "er" + rid(), ni = {...it, p: pp}; items.set(nid, ni); d.made.set(nid, ni); });
        } else if (it.t === "i"){
          const b = itemBox(it);
          if (b && contains(b, pt)) drop(id);        // картинка – только если точка реально внутри
        } else if (it.t === "t"){
          if (textInkHit(it, pt)) drop(id);          // надпись – только по закрашенному тексту, не по bbox
        }
      });
      if (changed) redraw();
    }
    async function eraseCommit(d){
      if (!d.gone.size && !d.made.size) return;
      const gone = [...d.gone];
      const prevB = hbatch, mine2 = {added: [], removed: []}; if (!histMute) hbatch = mine2;
      try {
        if (gone.length) await removeIds(gone, d.snap);
        for (const [nid, it] of d.made){ items.delete(nid); await addItem(it); }
      } finally { hbatch = prevB; }
      hpush(mine2);
      redraw();
    }
    function cancelStroke(){ if (drawing && !drawing.erase) send("draft", {sid:drawing.sid, p:[], end:true, drop:true}); drawing = null; redraw(); }
    function end(e){
      if (e && drawing && drawing.pid !== e.pointerId) return;
      lpClear();
      if (pan){ pan = null; cv.style.cursor = "grab"; return; }
      if (moving){
        const mv = moving; moving = null;
        commitMove(mv);
        return;
      }
      if (textTap){
        const t = textTap; textTap = null;
        if (!e || e.type === "pointercancel") return;
        const cx = e.clientX != null ? e.clientX : t.cx;
        const cy = e.clientY != null ? e.clientY : t.cy;
        if (Math.abs(cx - t.cx) > 10 || Math.abs(cy - t.cy) > 10) return;   // это был свайп, не клик
        if (editor){ closeEditor(true); return; }
        /* заполнение пропуска на основном листе: тап T по .blank/input – редактор прямо над ним */
        const bl = blankAt([t.x, t.y]);
        if (bl){
          openEditor({x:bl.x, y:bl.y, w:Math.min(TEXT_MAX_W, Math.max(TEXT_MIN_W, Math.round(bl.w))), h:Math.max(TEXT_LINE, Math.round(bl.h)), blank:true});
          return;
        }
        const hitId = hitOf([t.x, t.y], ["t"]);
        if (hitId){
          const it = items.get(hitId);
          if (it){ openEditor({x:it.x, y:it.y, w:it.w, h:it.h, s:it.s, c:it.c, note:it.note, sz:it.sz, id:hitId}); return; }
        }
        openEditor({x:t.x, y:t.y});
        return;
      }
      if (!drawing) return;
      const d = drawing; drawing = null;
      if (d.erase){ eraseCommit(d); return; }
      send("draft", {sid:d.sid, c:d.c, w:d.w, h:d.h, p:draftBuf, a:d.a, end:true});
      delete d.pid; delete d.sid;
      if (d.p.length) addItem(d);
    }
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", e => { pan = null; moving = null; textTap = null; drawing = null; try { cv.style.cursor = tool === "hand" ? "grab" : cv.style.cursor; } catch (_) {} placeEraseCur(e); });
    cv.addEventListener("pointerleave", e => { if (e.pointerType === "mouse"){ placeEraseCur(); end(e); } });

    /* снимок листа: всё, что на нём – задания, ответы, пометки ручкой */
    async function snapshot(){
      try {
        if (!window.html2canvas) await new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
        U.toast("Делаю снимок…");
        const shot = await window.html2canvas(wrap, {backgroundColor: "#fff", scale: Math.min(2, window.devicePixelRatio || 1), useCORS: true, logging: false});
        const label = (pagesArr.find(p => p.key === page)?.label || "лист").replace(/[\\/:*?"<>|]/g, "");
        const a = document.createElement("a"); a.href = shot.toDataURL("image/png"); a.download = `Доска – ${label} – ${new Date().toLocaleString("ru-RU").replace(/[:,]/g, "-")}.png`; a.click();
      } catch(_) { U.toast("Не получилось сделать снимок. Можно сделать снимок экрана: Win + Shift + S."); }
    }
    /* ---------- «прикрепить задание»: лист урока (теория, практика, тест…) ложится на холст картинками, их можно двигать и менять размер ---------- */
    async function stickPage(key){
      const pg = pagesArr.find(x => x.key === key);
      if (!pg || !pg.html){ toast("Этот лист «живой» – его нельзя прикрепить. Откройте его на доске и работайте прямо там."); return; }
      toast("Готовлю задание…");
      try {
        if (!window.html2canvas) await new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
        const host = document.createElement("div"); host.className = "bd-bg";
        host.style.cssText = `position:fixed;left:-10000px;top:0;width:${W}px;transform:none;background:#fff;pointer-events:none`;
        host.innerHTML = pg.html; document.body.appendChild(host);
        await delay(250);
        let cnv; try { cnv = await window.html2canvas(host, {backgroundColor: "#ffffff", scale: 1, useCORS: true, logging: false}); } finally { host.remove(); }
        const v = getView(), x0 = Math.max(10, Math.round(v.x) + 20); let y = Math.max(20, Math.round(v.y) + 20);
        const prev = hbatch, bt = {added: [], removed: []}; hbatch = bt;
        try {
          for (let y0 = 0; y0 < cnv.height; y0 += 700){
            const c2 = document.createElement("canvas"); c2.width = cnv.width; c2.height = Math.min(700, cnv.height - y0);
            const cx2 = c2.getContext("2d"); cx2.fillStyle = "#fff"; cx2.fillRect(0, 0, c2.width, c2.height); cx2.drawImage(cnv, 0, y0, c2.width, c2.height, 0, 0, c2.width, c2.height);
            const w = Math.min(W - 20, c2.width), ratio = c2.width / c2.height;
            const rec = await insertImageItem(fitDataUrl(c2, ITEM_MAX, 900), x0, y, w);
            y += (rec ? rec.h : Math.round(w / ratio)) + 6;
          }
        } finally { hbatch = prev; }
        hpush(bt); layout();
        toast("Задание на холсте: двигайте ✥, меняйте размер, отменяйте ↶");
      } catch (_) { toast("Не получилось прикрепить задание. Попробуйте ещё раз."); }
    }
    function openStickMenu(btn){
      const pgs = pagesArr.filter(x => x.html);
      if (!pgs.length){ toast("На этом уроке нет листов, которые можно прикрепить."); return; }
      menu.innerHTML = `<div class="bd-mlist"><b style="padding:4px 8px;font-size:12px;opacity:.7">Прикрепить на холст:</b>${pgs.map(x => `<button data-mstick="${esc(x.key)}">📌 ${esc(x.label || "Лист")}</button>`).join("")}</div>`;
      if (menu.parentElement !== document.body) document.body.appendChild(menu);
      menu.hidden = false;
      const r = btn.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
      menu.style.left = Math.max(4, Math.min(r.right + 6, innerWidth - mw - 4)) + "px";
      menu.style.top = Math.max(4, Math.min(r.top, innerHeight - mh - 4)) + "px";
      menu.onclick = ev => { const b = ev.target.closest("button"); if (!b) return; const k = b.dataset.mstick; closeMenu(); if (k) stickPage(k); };
    }
    /* ---------- быстрая панель: правая кнопка мыши, кнопка стилуса или долгое нажатие ---------- */
    const menu = root.querySelector(".bd-menu");
    function openMenu(x, y){
      /* правый клик/долгий тап по объекту – выделяем его и показываем «Удалить» */
      try { const pt = toLogical(x, y); const sid = hitOf(pt, ["i", "t"]); if (sid) select(sid); } catch (_) {}
      const sel = selectedInfo();
      const extra = typeof o.menu === "function" ? (o.menu() || []) : [];
      const titles = {pen:"Ручка", hl:"Маркер", text:"Текст", move:"Переместить", erase:"Ластик", hand:"Листать"};
      const icons = {pen:"✎", hl:"▮", text:"T", move:"✥", erase:'<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 17l8-8 6 6-4 4H6z" fill="#f48fb1" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M11 9l4-4 6 6-4 4" fill="#fff" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M13 19h8" stroke="currentColor" stroke-width="1.5"/></svg>', hand:"✋"};
      menu.innerHTML = `<div class="bd-mrow">${["pen","hl","text","move","erase","hand"].map(t => `<button data-mtool="${t}" aria-pressed="${tool === t}" title="${titles[t]}">${icons[t]}</button>`).join("")}</div>
        <div class="bd-mrow">${COLORS.map(c => `<button class="bd-color" data-mcolor="${c}" style="--bc:${c}" aria-pressed="${color === c}" aria-label="Цвет"></button>`).join("")}</div>
        <div class="bd-mlist">${sel ? `<button data-mact="del">🗑 Удалить</button>` : ""}<button data-mact="undo">↶ Отменить</button><button data-mact="redo">↷ Вернуть</button><button data-mact="blank">📄 Чистый лист</button>${extra.map((m, i) => `<button data-mext="${i}">${esc(m.label)}</button>`).join("")}</div>`;
      if (menu.parentElement !== document.body) document.body.appendChild(menu);   // над всеми окнами (у «стеклянных» окон свой слой)
      menu.hidden = false;
      const mw = menu.offsetWidth, mh = menu.offsetHeight;
      menu.style.left = Math.max(4, Math.min(x, innerWidth - mw - 4)) + "px";
      menu.style.top = Math.max(4, Math.min(y, innerHeight - mh - 4)) + "px";
      menu.onclick = ev => {
        const b = ev.target.closest("button"); if (!b) return;
        if (b.dataset.mtool) setTool(b.dataset.mtool);
        if (b.dataset.mcolor){ setColor(b.dataset.mcolor); if (tool !== "pen" && tool !== "text") setTool("pen"); }
        if (b.dataset.mact === "del") deleteSelected();
        if (b.dataset.mact === "undo") undo();
        if (b.dataset.mact === "redo") redo();
        if (b.dataset.mact === "blank"){ const bl = pagesArr.find(p => p.key === "blank") || pagesArr.find(p => p.key === "p1"); if (bl){ openPage(bl.key); if (o.role === "teacher") send("page", {page: bl.key}); } }
        if (b.dataset.mext != null){ try { extra[+b.dataset.mext].run(); } catch(_) {} }
        closeMenu();
      };
    }
    function closeMenu(){ if (menu && !menu.hidden){ menu.hidden = true; menu.innerHTML = ""; } }
    const onDocDown = e => { if (menu && !menu.hidden && !menu.contains(e.target)) closeMenu(); };
    document.addEventListener("pointerdown", onDocDown, true);

    root.addEventListener("click", async e => {
      const b = e.target.closest("button"); if (!b || !root.contains(b)) return;
      if (b.dataset.pstep){ stepPage(+b.dataset.pstep); return; }
      if (b.dataset.bpage){ openPage(b.dataset.bpage); if (o.role === "teacher") send("page", {page:b.dataset.bpage}); }
      if (b.dataset.tool) setTool(b.dataset.tool);
      if (b.dataset.color){ setColor(b.dataset.color); if (tool !== "pen" && tool !== "text") setTool("pen"); }
      if (b.dataset.act === "stick"){ openStickMenu(b); return; }
      if (b.dataset.act === "undo") undo();
      if (b.dataset.act === "redo") redo();
      if (b.dataset.act === "snap") snapshot();
      if (b.dataset.act === "clear"){
        if (b.dataset.sure){ hpush({added:[], removed:[...items.entries()].filter(([k]) => !k.startsWith("tmp")).map(([, v]) => v)}); await o.api.clear(page); items.clear(); mine = []; selectedId = null; redraw(); layout(); send("clear", {}); b.textContent = "🧹"; delete b.dataset.sure; }
        else { b.dataset.sure = "1"; b.textContent = "✔?"; b.title = "Нажмите ещё раз, чтобы очистить лист"; setTimeout(() => { b.textContent = "🧹"; delete b.dataset.sure; }, 3000); }
      }
    });

    /* ---------- вложения: файлы, буфер обмена, перетаскивание ---------- */
    const fileInput = document.createElement("input");
    fileInput.type = "file"; fileInput.multiple = true; fileInput.accept = "image/*,application/pdf,video/*,.docx,.pptx"; fileInput.style.display = "none";
    root.appendChild(fileInput);
    const dropHint = document.createElement("div"); dropHint.className = "bd-drop"; dropHint.textContent = "Отпустите файл — он появится на доске";
    wrap.appendChild(dropHint);

    /* диалог «Куда выгрузить материал?» */
    const dlg = document.createElement("div");
    dlg.className = "bd-dialog"; dlg.hidden = true;
    dlg.innerHTML = `<div class="bd-dialog-card" role="dialog" aria-modal="true" aria-label="Куда выгрузить материал">
      <h3>Куда выгрузить материал?</h3>
      <p class="bd-dialog-note">Можно положить картинками на текущий лист или сохранить отдельными листами доски.</p>
      <div class="bd-dialog-files"></div>
      <div class="bd-dialog-actions">
        <button type="button" data-bd-dest="inline">На этот лист</button>
        <button type="button" data-bd-dest="pages">Отдельными листами</button>
        <button type="button" data-bd-dest="cancel" class="bd-dialog-cancel">Отмена</button>
      </div></div>`;
    root.appendChild(dlg);
    function askDestination(files){
      return new Promise(resolve => {
        const filesBox = dlg.querySelector(".bd-dialog-files");
        if (filesBox) filesBox.innerHTML = files.map(f => `<div>${esc(f.name || "файл")}</div>`).join("");
        dlg.hidden = false;
        let done = false;
        const finish = val => {
          if (done) return; done = true;
          dlg.hidden = true;
          dlg.removeEventListener("click", onClick);
          document.removeEventListener("keydown", onKey, true);
          resolve(val);
        };
        const onClick = e => {
          const b = e.target.closest && e.target.closest("[data-bd-dest]");
          if (!b){ if (e.target === dlg) finish(null); return; }
          finish(b.dataset.bdDest === "cancel" ? null : b.dataset.bdDest);
        };
        const onKey = e => { if (e.key === "Escape"){ e.stopPropagation(); finish(null); } };
        dlg.addEventListener("click", onClick);
        document.addEventListener("keydown", onKey, true);
      });
    }

    function loadScript(src){
      return new Promise((res, rej) => {
        if (document.querySelector('script[src="' + src + '"]')) return res();
        const s = document.createElement("script"); s.src = src;
        s.onload = res; s.onerror = () => rej(new Error("не загрузился модуль"));
        document.head.appendChild(s);
      });
    }
    async function loadJSZip(){
      if (window.JSZip) return window.JSZip;
      await loadScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js");
      return window.JSZip;
    }
    /* подбираем JPEG так, чтобы data-URL влез в лимит одного объекта board_items */
    function fitDataUrl(cv2, maxChars, maxW){
      let c = cv2;
      const k = Math.min(1, (maxW || 1600) / c.width);
      if (k < 1){
        const c2 = document.createElement("canvas");
        c2.width = Math.max(1, Math.round(c.width * k)); c2.height = Math.max(1, Math.round(c.height * k));
        c2.getContext("2d").drawImage(c, 0, 0, c2.width, c2.height); c = c2;
      }
      let last = c.toDataURL("image/jpeg", 0.82);
      if (last.length <= maxChars) return last;
      for (const q of [0.72, 0.62, 0.52, 0.42, 0.32]){
        last = c.toDataURL("image/jpeg", q);
        if (last.length <= maxChars) return last;
      }
      let w = c.width, h = c.height;
      for (let i = 0; i < 7 && last.length > maxChars; i++){
        w = Math.max(120, Math.round(w * 0.8)); h = Math.max(90, Math.round(h * 0.8));
        const c2 = document.createElement("canvas"); c2.width = w; c2.height = h;
        c2.getContext("2d").drawImage(c, 0, 0, w, h); c = c2;
        last = c.toDataURL("image/jpeg", 0.7);
      }
      return last;
    }
    async function imageFileToItems(file){
      const url = URL.createObjectURL(file);
      try {
        const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("bad image")); i.src = url; });
        const k = Math.min(1, 1600 / im.width);
        const c2 = document.createElement("canvas");
        c2.width = Math.max(1, Math.round(im.width * k)); c2.height = Math.max(1, Math.round(im.height * k));
        c2.getContext("2d").drawImage(im, 0, 0, c2.width, c2.height);
        return [{src: fitDataUrl(c2, ITEM_MAX, 1600), ratio: im.width / im.height}];
      } catch (_) { toast("Не удалось открыть изображение"); return []; }
      finally { URL.revokeObjectURL(url); }
    }
    async function pdfToImages(file, budget, limit){
      try {
        if (!window.pdfjsLib) await loadScript("https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js");
        if (!window.pdfjsLib) throw new Error("PDF-модуль не загрузился (нет интернета)");
        const buf = await file.arrayBuffer();
        const doc = await pdfjsLib.getDocument({data:buf}).promise;
        const out = []; const n = Math.min(doc.numPages, limit || 8);
        for (let i = 1; i <= n; i++){
          const pg = await doc.getPage(i), vp = pg.getViewport({scale:1.4});
          const c2 = document.createElement("canvas");
          c2.width = Math.max(1, Math.round(vp.width)); c2.height = Math.max(1, Math.round(vp.height));
          await pg.render({canvasContext:c2.getContext("2d"), viewport:vp}).promise;
          out.push({src: fitDataUrl(c2, budget || ITEM_MAX, 1600), ratio: c2.width / c2.height});
        }
        return out;
      } catch (e) { toast("PDF не удалось открыть: " + oneLine(e && e.message)); return []; }
    }
    async function videoFrames(file, maxChars){
      const url = URL.createObjectURL(file);
      try {
        const v = document.createElement("video"); v.src = url; v.muted = true; v.playsInline = true;
        await new Promise(res => { v.onloadedmetadata = res; setTimeout(res, 2500); });
        const shots = [];
        for (const t of [0.5, Math.min(2, v.duration || 1), Math.min(4, v.duration || 2)]){
          await new Promise(res => { v.onseeked = res; try { v.currentTime = Math.max(0, Math.min(t, (v.duration || 1) - 0.05)); } catch (_) {} setTimeout(res, 900); });
          const c2 = document.createElement("canvas"); c2.width = v.videoWidth || 640; c2.height = v.videoHeight || 360;
          c2.getContext("2d").drawImage(v, 0, 0, c2.width, c2.height);
          shots.push({src: fitDataUrl(c2, maxChars || ITEM_MAX, 1200), ratio: c2.width / c2.height});
        }
        return shots;
      } catch (_) { return []; }
      finally { URL.revokeObjectURL(url); }
    }
    function imgsHTML(list, max){
      return (list || []).slice(0, max || 12).map(src => src ? `<div style="margin:12px 0"><img src="${src}" alt="" style="max-width:100%;border-radius:8px;border:1px solid #e6e2f2"></div>` : "").join("");
    }
    async function zipImage(zip, name, maxChars){
      try {
        const b64 = await zip.file(name).async("base64");
        const ext = (name.split(".").pop() || "png").toLowerCase();
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "svg" ? "image/svg+xml" : "image/png";
        const raw = "data:" + mime + ";base64," + b64;
        if (raw.length <= maxChars || mime === "image/svg+xml") return raw;
        const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("img")); i.src = raw; });
        let w = Math.min(1200, im.width), h = Math.max(1, Math.round(im.height * (w / im.width)));
        let out = "";
        for (let k = 0; k < 8; k++){
          const c2 = document.createElement("canvas"); c2.width = w; c2.height = h;
          c2.getContext("2d").drawImage(im, 0, 0, w, h);
          out = c2.toDataURL("image/jpeg", 0.72);
          if (out.length <= maxChars) return out;
          w = Math.round(w * 0.75); h = Math.max(1, Math.round(h * 0.75));
          if (w < 80) break;
        }
        return out;
      } catch (_) { return null; }
    }
    async function buildDocxPages(file){
      try {
        const JSZip = await loadJSZip(); const zip = await JSZip.loadAsync(file);
        const xml = await zip.file("word/document.xml").async("string");
        const paras = [...xml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)].map(m => [...m[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(x => x[1]).join("")).filter(Boolean);
        const text = paras.join("\n").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
        const body = esc(text.slice(0, 20000));
        const media = Object.keys(zip.files).filter(n => /^word\/media\//.test(n) && /\.(png|jpe?g|gif)$/i.test(n));
        const budget = PAGE_HTML_MAX - body.length - 1500;
        const count = Math.min(media.length, 6, Math.max(0, Math.floor(budget / 6000)));
        const per = count ? Math.max(2500, Math.min(12000, Math.floor(budget / count))) : 0;
        const imgs = [];
        for (const n of media.slice(0, count)) { const src = await zipImage(zip, n, per); if (src) imgs.push(src); }
        return [{label:"Документ", html:`<div class="bd-sheet"><h2>${esc(file.name)}</h2>${imgsHTML(imgs, imgs.length)}<div style="white-space:pre-line;font-size:15px;line-height:1.55">${body}</div></div>`}];
      } catch (e) { toast("Не удалось открыть документ: " + oneLine(e && e.message)); return []; }
    }
    async function buildPptxPages(file){
      try {
        const JSZip = await loadJSZip(); const zip = await JSZip.loadAsync(file);
        const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => (+a.match(/\d+/)[0]) - (+b.match(/\d+/)[0]));
        const out = []; let made = 0;
        for (const n of slides){
          made++;
          const num = n.match(/slide(\d+)\.xml/)[1];
          const xml = await zip.file(n).async("string");
          const text = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map(x => x[1]).join("\n").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
          const body = esc(text || "");
          const relName = "ppt/slides/_rels/slide" + num + ".xml.rels";
          let rels = "";
          try { rels = await zip.file(relName).async("string"); } catch (_) {}
          const map = {};
          [...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].forEach(m => { map[m[1]] = m[2]; });
          const ids = [...xml.matchAll(/r:embed="([^"]+)"/g)].map(m => m[1]);
          const budget = PAGE_HTML_MAX - body.length - 800;
          const count = Math.min(ids.length, 4, Math.max(0, Math.floor(budget / 6000)));
          const per = count ? Math.max(2500, Math.min(12000, Math.floor(budget / count))) : 0;
          const imgs = [];
          for (const id of ids.slice(0, count)){
            const tgt = map[id]; if (!tgt) continue;
            const full = tgt.replace(/^\.\.\//, "ppt/");
            const src = await zipImage(zip, full, per); if (src) imgs.push(src);
          }
          out.push({label:"Слайд " + made, html:`<div class="bd-sheet"><h2>Слайд ${made}</h2>${imgsHTML(imgs, imgs.length)}<div style="white-space:pre-line;font-size:16px;line-height:1.6">${body}</div></div>`});
        }
        return out;
      } catch (e) { toast("Не удалось открыть презентацию: " + oneLine(e && e.message)); return []; }
    }
    async function buildImagePage(file){
      const list = await imageFileToItems(file);
      if (!list.length) return [];
      const src = list[0].src;
      return [{label:file.name || "Картинка", html:`<div class="bd-sheet"><h2>${esc(file.name || "Картинка")}</h2><img src="${src}" alt="" style="width:100%;border-radius:8px;border:1px solid #e6e2f2"></div>`}];
    }
    async function buildPdfPages(file){
      const imgs = await pdfToImages(file, 48000, 60);
      return imgs.map((it, i) => ({label:"PDF " + (i + 1), html:`<div class="bd-sheet"><h2>${esc(file.name)} — страница ${i + 1}</h2><img src="${it.src}" alt="" style="width:100%;border-radius:8px;border:1px solid #e6e2f2"></div>`}));
    }
    async function buildVideoPage(file){
      /* на один лист 3 кадра; бюджет на кадр считаем так, чтобы html листа влез в лимит */
      const shots = await videoFrames(file, Math.min(12000, Math.floor((PAGE_HTML_MAX - 2500) / 3)));
      const frames = imgsHTML(shots.map(s => s.src), 3);
      return [{label:"Видео", html:`<div class="bd-sheet"><h2>${esc(file.name)}</h2><p class="small muted">Кадры видео добавлены на лист доски. Полный видеофайл доступен у учителя.</p>${frames}</div>`}];
    }
    function addImage(src, ratio, x, y, w){
      const width = w || 460, hh = width / (ratio || 1.5);
      addItem({t:"i", x: x == null ? 40 : x, y: y == null ? nextFreeY() : y, w:width, h:hh, ratio:ratio || 1.5, src, bw:width, bh:hh});
      return hh;
    }
    async function attachInline(files, at){
      let y = (at && at.y != null) ? Math.round(at.y) : nextFreeY();
      const x0 = (at && at.x != null) ? Math.round(at.x) : 40;
      let made = 0;
      for (const f of files){
        let shots = [];
        if (/^image\//.test(f.type)) shots = await imageFileToItems(f);
        else if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) shots = await pdfToImages(f, ITEM_MAX, 8);
        else if (/^video\//.test(f.type)) shots = await videoFrames(f, ITEM_MAX);
        else if (/\.(docx|pptx)$/i.test(f.name)){ toast("Документы добавляются отдельными листами доски."); await attachPages([f]); continue; }
        else { toast("Формат «" + f.name + "» пока не преобразуется в картинки. Прикрепите фото, PDF или документ."); continue; }
        for (const it of shots){ const hh = addImage(it.src, it.ratio, x0, y, 480); y += hh + 30; made++; }
      }
      if (made) toast("Материал добавлен на доску");
    }
    async function attachPages(files){
      const keys = [];
      for (const f of files){
        let descs = [];
        if (/^image\//.test(f.type)) descs = await buildImagePage(f);
        else if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) descs = await buildPdfPages(f);
        else if (/^video\//.test(f.type)) descs = await buildVideoPage(f);
        else if (/\.(docx)$/i.test(f.name)) descs = await buildDocxPages(f);
        else if (/\.(pptx)$/i.test(f.name)) descs = await buildPptxPages(f);
        else { toast("Формат «" + f.name + "» пока не поддерживается."); continue; }
        for (const d of descs) keys.push(addPageP(d.label, d.html, true));
      }
      if (keys.length){
        openPage(keys[0]);
        if (o.role === "teacher") send("page", {page:keys[0]});
        toast("Добавлено листов: " + keys.length);
      } else {
        toast("Не удалось добавить материал отдельными листами");
      }
    }
    async function handleFiles(files, at){
      const list = Array.from(files || []).filter(Boolean);
      if (!list.length) return;
      const dest = await askDestination(list);
      if (!dest) return;
      if (dest === "inline") await attachInline(list, at);
      else await attachPages(list);
    }
    fileInput.addEventListener("change", () => { if (fileInput.files?.length) handleFiles([...fileInput.files]); fileInput.value = ""; });
    wrap.addEventListener("dragover", e => { e.preventDefault(); dropHint.style.display = "flex"; });
    wrap.addEventListener("dragleave", () => { dropHint.style.display = "none"; });
    wrap.addEventListener("drop", e => {
      e.preventDefault(); dropHint.style.display = "none";
      const ds = e.dataTransfer; if (!ds) return;
      const files = [...(ds.files || [])].filter(Boolean);
      if (!files.length) return;
      /* вставка в ТОЧКУ дропа (логические координаты с учётом скролла и зума) */
      const p = pos(e);
      lastPoint = {x:p[0], y:p[1]};
      handleFiles(files, {x:p[0], y:p[1]});
    });
    const onPaste = e => {
      if (!root.isConnected) return;
      /* если печатают в поле/редакторе – не мешаем обычной вставке текста */
      const ae = document.activeElement;
      if (ae && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName || "") || ae.isContentEditable)) return;
      const cd = e.clipboardData; if (!cd) return;
      const files = [...(cd.files || [])];
      const imgs = files.filter(f => /^image\//i.test(f.type || ""));
      let text = "";
      try { text = cd.getData("text/plain") || ""; } catch (_) {}
      if (imgs.length){
        e.preventDefault();
        lastClipFiles = imgs;
        insertImagesAt(imgs, lastPoint);
        return;
      }
      if (files.length){ e.preventDefault(); lastClipFiles = []; handleFiles(files, lastPoint); return; }
      if (text && text.trim()){
        e.preventDefault();
        lastClipText = text;
        openEditor({x:lastPoint.x, y:lastPoint.y, s:text});
      }
    };
    document.addEventListener("paste", onPaste);

    root.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b || !root.contains(b)) return;
      if (b.dataset.zoom){ zoomAction(b.dataset.zoom); return; }
      if (b.dataset.esz){ ER = ER_SIZES[b.dataset.esz] || ER; try { localStorage.setItem("bd-er", b.dataset.esz); } catch (_) {} syncEraseSize(); placeEraseCur(); return; }
      if (b.dataset.act === "extend"){ extendHeight(800); return; }
      if (b.dataset.act === "insert-text"){ openEditor({x:lastPoint.x, y:lastPoint.y}); return; }
      if (b.dataset.act === "insert-image"){
        if (root.querySelector(".bd-insertform")) return;
        const f = document.createElement("form"); f.className = "bd-insertform card";
        f.innerHTML = `<b>Вставить картинку по ссылке</b><p class="small muted" style="margin:4px 0 8px">Ссылка на изображение (https://…) или data:-адрес. Картинка появится в последней точке клика на листе.</p>
          <input name="u" placeholder="https://…" required style="width:100%"><div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap"><label class="small">Ширина <input name="w" type="number" value="420" min="60" max="800" step="20" style="width:90px"></label><button class="btn sm">Вставить</button><button type="button" class="btn ghost sm" data-x>Отмена</button></div>`;
        root.querySelector(".bd-bar").after(f); f.u.focus();
        f.addEventListener("submit", ev => { ev.preventDefault(); const url = f.u.value.trim(); const w = f.w.value; f.remove(); if (url) insertImageItem(url, lastPoint.x, lastPoint.y, w); });
        f.querySelector("[data-x]").onclick = () => f.remove();
        return;
      }
      if (b.dataset.act === "attach") fileInput.click();
      if (b.dataset.act === "embed"){
        if (root.querySelector(".bd-embedform")) return;
        const f = document.createElement("form"); f.className = "bd-embedform card";
        f.innerHTML = `<b>Встроить сайт на доску</b><p class="small muted" style="margin:4px 0 8px">Ссылка на Wordwall, YouTube, RuTube, Google Презентации, Canva или любую страницу, которая разрешает встраивание. Сайт появится отдельным листом у вас обоих.</p>
          <input name="u" placeholder="https://…" required style="width:100%"><div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap"><input name="l" placeholder="Название листа" style="flex:1;min-width:140px"><label class="small">Высота <input name="h" type="number" value="560" min="300" max="2400" step="20" style="width:90px"></label><button class="btn sm">Встроить</button><button type="button" class="btn ghost sm" data-x>Отмена</button></div>`;
        root.querySelector(".bd-bar").after(f); f.u.focus();
        f.addEventListener("submit", ev => { ev.preventDefault(); const key = embedPage(f.u.value, f.l.value || "Сайт", f.h.value); f.remove(); openPage(key); if (o.role === "teacher") send("page", {page: key}); setTool("touch"); });
        f.querySelector("[data-x]").onclick = () => f.remove();
      }
      if (b.dataset.act === "camera"){ const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.capture = "environment"; inp.onchange = () => inp.files?.length && handleFiles([...inp.files]); inp.click(); }
    });

    /* ---------- реальное время ---------- */
    function send(type, payload){
      if (!channel) return;
      try {
        const r = channel.send({type:"broadcast", event:"ev", payload:{type, from:me, page, ...payload}});
        if (r && typeof r.catch === "function") r.catch(() => {});   // до подписки канал может отказать – не шумим
      } catch (_) {}
    }
    function sendPresence(){ if (channel) { try { const p = channel.track({id:me, name:o.name, role:o.role, page}); if (p && p.catch) p.catch(() => {}); } catch (_) {} } }
    function renderWho(){
      const list = [...peers.values()].filter(p => p.online);
      $(".bd-who").textContent = list.length ? "На доске: " + list.map(p => `${p.name} (${p.role === "teacher" ? "учитель" : "ученик"})`).join(", ") : (channel ? "Вы на доске одни" : "Доска без связи: рисунки сохраняются только у вас");
    }
    function cursorFor(id){
      let p = peers.get(id);
      if (!p){ p = {online:false, el:null}; peers.set(id, p); }
      if (!p.el){
        p.el = document.createElement("div"); p.el.className = "bd-cursor";
        p.el.innerHTML = `<svg viewBox="0 0 16 16" width="18" height="18"><path d="M1 1l5 14 2-6 6-2z" fill="currentColor" stroke="#fff" stroke-width="1"/></svg><span></span>`;
        curLayer.appendChild(p.el);
      }
      return p;
    }
    function placeCursor(p){
      if (!p || !p.el || !p.raw) return;
      let x = p.raw.x, y = p.raw.y;
      if (p.raw.a){ const [dx, dy] = shiftFor(p.raw.a); x += dx; y += dy; }
      p.el.style.transform = `translate(${x * scale}px, ${y * scale}px)`;
      p.el.hidden = !p.online || p.page !== page;
      p.el.style.color = p.role === "teacher" ? "#ee5fa8" : "#7b4cf5";
      const sp = p.el.querySelector("span"); if (sp) sp.dataset.n = p.name || "";
    }
    function placeCursors(){ peers.forEach(placeCursor); }
    let chFails = 0, chBorn = 0, guardT = 0, syncT = 0, resyncBusy = false, hidHandlers = [];
    function connect(){
      channel = o.sb.channel(o.channelName, {config:{broadcast:{self:false}, presence:{key:me}}});
      const mine_ch = channel; chBorn = Date.now();
      channel.on("broadcast", {event:"ev"}, ({payload:m}) => {
        if (!m || m.from === me) return;
        /* общий фон живого листа: ученик присылает html, учитель просит его. Эти события
           обрабатываем ДО раннего «не моя страница»: html храним всегда, bgreq – отвечаем всегда */
        if (m.type === "bg"){
          if (isTeacher) applyRemoteBg(m.page, m.html);
          return;
        }
        if (m.type === "bgreq"){
          if (isStudent) answerBgReq(m.page);
          return;
        }
        if (m.type === "addpage"){
          const ex = pagesArr.find(x => x.key === String(m.key));
          if (ex){
            /* сервер/вторая сторона могли сохранить усечённую версию – синхронизируем html по тому же ключу */
            if (typeof m.html === "string" && m.html !== ex.html){
              ex.html = m.html; ex.saved = true;
              if (page === ex.key){ if (!paintLive(true)){ bg.innerHTML = m.html; bgSource = "static"; } afterSheet(); layout(); }
            } else ex.saved = true;
          } else if (m.key){
            pagesArr.push({key:String(m.key), label:m.label || "Лист", html:m.html || "", saved:true});
            renderPageButtons();
          }
          return;
        }
        if (m.type === "page" && o.role === "student"){ if (m.page !== page){ openPage(m.page); toast("Учитель открыл другой лист"); } return; }
        if (m.page !== page) return;
        if (m.type === "cursor"){
          const p = cursorFor(m.from); p.raw = {x:m.x, y:m.y, a:m.a || null}; placeCursor(p);
        }
        if (m.type === "draft"){
          const k = m.from + ":" + (m.sid || "");
          if (m.drop){ drafts.delete(k); redraw(); return; }
          let d = drafts.get(k);
          if (!d){ d = {t:"s", c:m.c, w:m.w, h:m.h, p:[], a:m.a || null}; drafts.set(k, d); }
          if (!d.a && m.a) d.a = m.a;
          (m.p || []).forEach(q => d.p.push(q));
          if (m.end) setTimeout(() => { drafts.delete(k); redraw(); }, 1500);
          redraw();
        }
        if (m.type === "add" && m.opt){          // мгновенная копия до сохранения в базе
          const k = "rtmp:" + m.id; items.set(k, m.item); st8(k); redraw(); layout(); return;
        }
        if (m.type === "add" && m.tmp) items.delete("rtmp:" + m.tmp);
        if (m.type === "move" && m.opt){
          st8(m.id, m.newId); if (m.id != null) items.delete(String(m.id));
          const k = "rtmp:" + m.newId; items.set(k, m.item); st8(k);
          redraw(); layout(); return;
        }
        if (m.type === "move" && m.tmp) items.delete("rtmp:" + m.tmp);
        if (m.type === "tdraft"){
          const k = m.from + ":" + (m.sid || ""), key = "rtxt:" + k;
          if (m.drop){
            items.delete(key);
            const h = textHeld.get(k); textHeld.delete(k);
            if (h && !m.commit && !items.has(String(h.id))) items.set(String(h.id), h.item);
            redraw(); layout(); return;
          }
          if (m.edId != null && !textHeld.has(k) && items.has(String(m.edId))){ textHeld.set(k, {id:String(m.edId), item:items.get(String(m.edId))}); items.delete(String(m.edId)); }
          const h = textHeld.get(k); if (h) st8(h.id);
          items.set(key, m.item); st8(key); redraw(); layout(); return;
        }
        if (m.type === "add"){
          [...drafts.keys()].forEach(k => { if (k.startsWith(m.from + ":") && drafts.get(k).p.length >= ((m.item && m.item.p && m.item.p.length) || 0) - 2) drafts.delete(k); });
          if (m.id != null){ items.set(String(m.id), m.item); st8(m.id); }
          redraw(); layout();
        }
        if (m.type === "remove"){
          st8(m.ids || []); (m.ids || []).forEach(id => items.delete(String(id)));
          if (selectedId != null && (m.ids || []).some(id => String(id) === String(selectedId))) selectedId = null;
          redraw(); layout();
        }
        if (m.type === "move"){
          st8(m.id, m.newId);
          if (m.id != null) items.delete(String(m.id));
          if (m.newId != null) items.set(String(m.newId), m.item);
          if (selectedId != null && String(selectedId) === String(m.id)) selectedId = m.newId != null ? String(m.newId) : null;
          redraw(); layout();
        }
        if (m.type === "clear"){ items.clear(); mine = []; selectedId = null; redraw(); layout(); }
      });
      channel.on("presence", {event:"sync"}, () => {
        const st = channel.presenceState();
        peers.forEach(p => p.online = false);
        Object.values(st).flat().forEach(x => { if (!x || x.id === me) return; const p = cursorFor(x.id); Object.assign(p, {online:true, name:x.name, role:x.role, page:x.page}); });
        peers.forEach(p => { if (p.el) p.el.hidden = !p.online || p.page !== page; });
        placeCursors();
        renderWho();
        maybeRequestBg();     // ученик появился – просим у него фон живого листа
      });
      channel.subscribe(s => {
        if (channel !== mine_ch) return;
        if (s === "SUBSCRIBED"){ chFails = 0; sendPresence(); renderWho(); resync(true); }
        else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED"){
          const d = Math.min(15000, 1200 * 2 ** Math.min(chFails++, 4));
          setTimeout(() => { if (channel === mine_ch && o.sb) reconnect(); }, d);
        }
      });
    }
    function reconnect(){
      if (!o.sb || !o.channelName || destroyed) return;
      const old = channel; channel = null;
      if (old){ try { o.sb.removeChannel(old); } catch (_) {} }
      connect();
    }
    function ensureChannel(){
      if (!o.sb || !o.channelName || destroyed || document.hidden) return;
      if (!channel){ connect(); return; }
      const st = typeof channel.state === "string" ? channel.state : "joined", stuck = st === "joining" && Date.now() - chBorn > 15000;
      if (st !== "joined" && (st !== "joining" || stuck)) reconnect(); else sendPresence();
    }
    /* «сверка с базой»: что записано в board_items, то и должно быть на листе – даже если живое событие потерялось или лист был закрыт */
    async function resync(force){
      if (resyncBusy || destroyed || !page || !o.api || typeof o.api.load !== "function") return;
      if (!force && (drawing || moving || pan || editor)) return;
      resyncBusy = true; const key = page, tok0 = openTok;
      try {
        const list = await o.api.load(key) || [];
        if (destroyed || page !== key || tok0 !== openTok || (!force && (drawing || moving || pan || editor))) return;
        if (list.some(r => !r || r.id == null)) return;          // без id сверять нечем
        const db = new Map(); list.forEach(r => { if (r.item && r.item.t && !fresh8(r.id)) db.set(String(r.id), r.item); });
        [...items.keys()].forEach(id => { if ((id.startsWith("rtmp:") || id.startsWith("rtxt:")) && Date.now() - (stamp.get(id) || 0) > 20000) items.delete(id); });
        const local = [...items.keys()].filter(id => !isTemp(id) && !fresh8(id));
        let same = local.length === db.size; if (same) for (const id of local) if (!db.has(id)) { same = false; break; }
        if (!same){
          const keep = [...items.entries()].filter(([id]) => isTemp(id) || fresh8(id));
          items = new Map([...db.entries(), ...keep]);
          if (selectedId != null && !items.has(String(selectedId))) selectedId = null;
          pageCache.set(key, list);
          redraw(); layout();
        }
      } catch (_) {} finally { resyncBusy = false; }
    }
    let destroyed = false;
    if (o.sb && o.channelName){
      connect();
      guardT = setInterval(ensureChannel, 15000);
      syncT = setInterval(() => { if (!document.hidden) resync(false); }, 6000);
      const onVis = () => { if (document.hidden) return; ensureChannel(); resync(true); };
      document.addEventListener("visibilitychange", onVis); window.addEventListener("online", onVis); window.addEventListener("focus", onVis);
      hidHandlers = [["visibilitychange", onVis, document], ["online", onVis, window], ["focus", onVis, window]];
    }
    renderWho();

    /* ---------- запуск ---------- */
    /* колесо с Ctrl/Alt/Meta – зум к точке под курсором; обычное колесо – нативный скролл */
    const onWheel = e => {
      if (!(e.ctrlKey || e.altKey || e.metaKey)) return;
      e.preventDefault();
      const now = performance.now();
      const sig = e.clientX + "," + e.clientY + "," + e.deltaY + "," + (e.ctrlKey ? 1 : 0) + (e.altKey ? 1 : 0) + (e.metaKey ? 1 : 0);
      if (sig === lastWheelSig && now - lastWheelAt < 80) return;   // одно событие могли прислать и на canvas, и на stage
      lastWheelSig = sig; lastWheelAt = now;
      setZoom(scale * (e.deltaY > 0 ? 0.9 : 1.1), e.clientX, e.clientY);
    };
    stage.addEventListener("wheel", onWheel, {passive:false});
    let roT = 0; const ro = new ResizeObserver(() => { clearTimeout(roT); roT = setTimeout(layout, 30); }); ro.observe(stage); ro.observe(bg);
    setTool("pen"); setColor(COLORS[0]);

    /* ---------- хуки для тестов ---------- */
    function info(){
      const list = [];
      items.forEach((it, id) => {
        if (it.t === "s"){
          list.push({id, t:"s", p: shiftedPoints(it), c:it.c, w:it.w, hl:!!it.h, a:it.a || null});
        } else if (it.t === "i"){
          const [w2, h2] = imageSize(it);
          list.push({id, t:"i", x:it.x, y:it.y, w:w2, h:h2, ratio:it.ratio, src:it.src});
        } else if (it.t === "t"){
          list.push({id, t:"t", x:it.x, y:it.y, w:it.w || DEFAULT_TEXT_W, h:it.h || textHeight(it), s:it.s, c:it.c, sz:textSz(it)});
        }
      });
      const cur = pagesArr.find(p => p.key === page);
      return {
        ready: readyDone,
        page,
        scale,
        width: widthL,
        height,
        saving,
        anchors: bdBoxes.length,
        items: list,
        selected: selectedInfo(),
        pages: pagesArr.map(p => ({key:p.key, label:p.label, htmlLen:(p.html || "").length, saved:!!p.saved})),
        pageHtmlLen: cur ? (cur.html || "").length : 0,
        bgSource,
        zoom: scale,
        scrollX: stage.scrollLeft,
        scrollY: stage.scrollTop,
        lastPoint: {x:lastPoint.x, y:lastPoint.y},
        view: getView(),
        editor: editor ? {open:true, id:editor.id || null, inline:true, text:editor.ta.value, note:!!editor.note, sz:editor.sz || TEXT_SZ_DEFAULT} : null
      };
    }
    function destroy(){
      try { ro.disconnect(); } catch (_) {}
      clearTimeout(roT);
      clearTimeout(bgSendT); clearTimeout(bgReqT);
      try { stage.removeEventListener("wheel", onWheel); } catch (_) {}
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDocDown, true);
      document.removeEventListener("paste", onPaste);
      lpClear();
      pan = null;
      selectedId = null; selResize = null;
      if (editor){ const ed = editor; editor = null; ed.closed = true; try { ed.el.remove(); } catch (_) {} }
      peers.forEach(p => { if (p.el){ try { p.el.remove(); } catch (_) {} } });
      drafts.clear();
      destroyed = true; clearInterval(guardT); clearInterval(syncT);
      hidHandlers.forEach(([ev, fn, el]) => { try { el.removeEventListener(ev, fn); } catch (_) {} });
      if (channel && o.sb && typeof o.sb.removeChannel === "function"){ try { o.sb.removeChannel(channel); } catch (_) {} }
      channel = null;
      try { menu.remove(); } catch (_) {}
      try { readyResolve && readyResolve(info()); } catch (_) {}
      root.innerHTML = "";
    }
    async function boot(){
      try { await Promise.race([syncPages(), delay(5000)]); } catch (_) {}
      if (!root.isConnected) return;
      if (o.page && pagesArr.some(p => p.key === String(o.page))) page = String(o.page);
      await openPage(page);
      readyDone = true;
      try { readyResolve && readyResolve(info()); } catch (_) {}
    }
    boot();

    return {
      /* прежний контракт keep()/приложения */
      setMenu(fn){ o.menu = fn; },
      setLive(map, pagesNew){ live = map || {}; liveBgCache.clear(); if (pagesNew){ pagesNew.forEach(p => { const i = pagesArr.findIndex(x => x.key === p.key); if (i >= 0) pagesArr[i] = {...pagesArr[i], ...p}; else pagesArr.push(p); }); renderPageButtons(); } },
      refresh(){ liveBgCache.clear(); const painted = paintLive(false); if (painted || anchorsDirty){ afterSheet(); } boxesDirty = true; layout(); },
      open(key){ if (key && key !== page && pagesArr.some(p => p.key === key)) openPage(key); },
      destroy(){ destroy(); },
      relayout(){ layout(); },
      page: () => page,
      /* хуки для тестов (verifier): имена – часть контракта */
      info,
      ready: () => readyP,
      whenIdle: async () => { await readyP; while (saving > 0 || selPending > 0) await delay(50); return info(); },
      attach: files => handleFiles(files),
      addPage: (label, html, broadcast) => addPageP(label, html, broadcast),
      stickPage: key => stickPage(key),
      setView: v => setRelView(v),
      getRelView: () => getRelView(),
      undo: () => undo(),
      redo: () => redo(),
      insertPage: (label, html, broadcast, opts) => insertPageAt(label, html, broadcast, opts),
      insertText: (text, x, y) => insertTextItem(text, x, y, false),
      insertNote: (text, x, y, opts) => insertTextItem(text, x, y, true),
      insertImage: (url, x, y, w) => insertImageItem(url, x, y, w),
      select: id => select(id),
      selected: () => selectedInfo(),
      deleteSelected: () => deleteSelected(),
      pasteAtPoint: () => pasteAtPoint(),
      lastPoint: () => ({x:lastPoint.x, y:lastPoint.y}),
      getView: () => getView(),
      setZoom: (z, cx, cy) => setZoom(z, cx, cy),
      zoomBy: d => zoomBy(d),
      fitWidth: () => fitWidth(),
      extendHeight: px => extendHeight(px),
      openPage,
      pages: () => pagesArr.map(p => ({key:p.key, label:p.label, saved:!!p.saved})),
      debug(){
        const v = info();
        v.raw = Array.from(items.entries()).map(([id, it]) => ({id, item:it}));
        v.anchorBoxes = bdBoxes.map(b => ({i:+b.el.getAttribute("data-bd"), x:b.x, y:b.y, w:b.w, h:b.h}));
        v.remoteBgPages = [...remoteBg.keys()];
        v.bgSource = bgSource;
        v.selected = selectedInfo();
        return v;
      }
    };
  }

  /* хранилище: Supabase (ученик – через функции, учитель – напрямую) или браузер */
  function api(kind, sb, ident){
    const lk = p => `${ident.lesson}:${p}`;
    if (!sb){
      const key = p => `oge-board-${ident.lesson}-${p}`;
      const get = p => { try { const v = JSON.parse(localStorage.getItem(key(p))); return Array.isArray(v) ? v : []; } catch(_) { return []; } };
      const put = (p, v) => { try { localStorage.setItem(key(p), JSON.stringify(v)); } catch(_) {} };
      return {
        load: async p => get(p),
        add: async (p, item) => { const l = get(p), id = Date.now() + Math.random().toString(36).slice(2, 6); l.push({id, item}); put(p, l); return id; },
        remove: async (p, ids) => { const set = new Set((ids || []).map(String)); put(p, get(p).filter(r => !set.has(String(r.id)))); },
        clear: async p => put(p, [])
      };
    }
    if (kind === "student") return {
      load: async p => { const {data, error} = await sb.rpc("board_load", {p_code: ident.code, p_lesson: lk(p)}); if (error) throw error; return data || []; },
      add: async (p, item) => { const {data, error} = await sb.rpc("board_add", {p_code: ident.code, p_lesson: lk(p), p_item: item}); if (error) throw error; return data; },
      remove: async (p, ids) => { const nums = (ids || []).map(Number).filter(Number.isFinite); if (!nums.length) return; await sb.rpc("board_remove", {p_code: ident.code, p_lesson: lk(p), p_ids: nums}); },
      clear: async () => {}
    };
    return {
      load: async p => { const {data, error} = await sb.from("board_items").select("id,item").eq("student_id", ident.studentId).eq("lesson_id", lk(p)).order("id"); if (error) throw error; return data || []; },
      add: async (p, item) => { const {data, error} = await sb.from("board_items").insert({student_id: ident.studentId, lesson_id: lk(p), item, author: "teacher"}).select("id").single(); if (error) throw error; return data.id; },
      remove: async (p, ids) => { const nums = (ids || []).map(Number).filter(Number.isFinite); if (!nums.length) return; await sb.from("board_items").delete().in("id", nums); },
      clear: async p => { await sb.from("board_items").delete().eq("student_id", ident.studentId).eq("lesson_id", lk(p)); }
    };
  }

  /* листы доски для занятия */
  function pages(course, l){
    if (l.free) return [{key:"p1", label:"Лист 1", html:`<div class="bd-sheet"></div>`}, {key:"p2", label:"Лист 2", html:`<div class="bd-sheet"></div>`},
      {key:"lined", label:"В линейку", html:`<div class="bd-sheet bd-lined"></div>`}, {key:"grid", label:"В клетку", html:`<div class="bd-sheet bd-grid"></div>`}];
    const out = [], noInputs = h => h.replace(/<button[\s\S]*?<\/button>/g, "").replace(/<input[^>]*>/g, '<span class="blank" style="min-width:160px"></span>');
    if (l.practice?.length) out.push({key:"practice", label:"Практика", html:`<div class="bd-sheet"><h2>${esc(l.title)}: практика</h2>${U.practiceHTML(l, false)}</div>`});
    if ((l.test || []).length) out.push({key:"test", label:"Тест", html:`<div class="bd-sheet"><h2>${esc(l.title)}: проверь себя</h2><ol>${(l.test || []).map(q => `<li style="margin-bottom:16px">${esc(q.q)}${q.pn ? "<br>" + esc(q.pn.w.join(" ")) : ""}${q.o ? "<br><span style='font-size:15px;color:#555'>" + q.o.map((x, k) => (k + 1) + ") " + esc(x)).join("   ") + "</span>" : ""}<span class="blank"></span></li>`).join("")}</ol><p class="small muted">Ответы не показываются: проверка — в разделе «Тест» урока.</p></div>`});
    out.push({key:"theory", label:"Теория", html:`<div class="bd-sheet">${noInputs(U.theoryHTML(l))}</div>`});
    const w = l.writing, txt = w ? (w.type === "izl" ? course.izl?.[w.text] : course.texts?.[w.text]) : null;
    if (txt) out.push({key:"text", label:"Текст для письма", html:`<div class="bd-sheet"><h2>${esc(txt.title)}</h2>${w.type === "izl" ? txt.paras.map(p => `<p>${esc(p)}</p>`).join("") : `<p>${esc(txt.text)}</p>`}</div>`});
    (l.materials || []).forEach((m, i) => {
      if (m.kind === "text") out.push({key:"m" + m.id, label: m.title || "Материал " + (i + 1), html:`<div class="bd-sheet"><h2>${esc(m.title || "")}</h2><div style="white-space:pre-line">${esc(m.body || "")}</div></div>`});
      if (m.kind === "file" && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(m.url || "")) out.push({key:"m" + m.id, label: m.title || "Картинка", html:`<div class="bd-sheet"><h2>${esc(m.title || "")}</h2><img src="${esc(m.url)}" alt="" style="width:100%"></div>`});
      if (m.kind === "tasks" && (m.data?.mini?.length || m.data?.test?.length)) out.push({key:"m" + m.id, label: m.title || "Задания", html:`<div class="bd-sheet"><h2>${esc(m.title || "Задания")}</h2><ol>${[...(m.data.mini || []).map(x => x.q), ...(m.data.test || []).map(x => x.q + " " + x.o.map((o, k) => `${k + 1}) ${o}`).join("; "))].map(q => `<li style="margin-bottom:14px">${esc(q)}<span class="blank"></span></li>`).join("")}</ol></div>`});
    });
    out.push({key:"blank", label:"Чистый лист", html:`<div class="bd-sheet bd-lined"></div>`});
    return out;
  }

  /* доска не пересоздаётся при каждой перерисовке экрана: тот же лист, то же соединение */
  let kept = null;
  function keep(container, key, opts){
    if (!container) return null;
    if (kept && kept.key === key){ if (opts && "menu" in opts) kept.inst.setMenu(opts.menu); if (opts?.live) kept.inst.setLive(opts.live, opts.pages); kept.inst.refresh(); container.replaceChildren(kept.holder); requestAnimationFrame(() => kept && kept.inst.relayout()); return kept.inst; }
    release();
    const holder = document.createElement("div"); holder.className = "bd-holder"; container.replaceChildren(holder);
    const inst = mount(holder, opts); kept = {key, holder, inst}; return inst;
  }
  function release(){ if (kept){ try { kept.inst.destroy(); } catch(_) {} kept = null; } }
  const keptPage = () => kept?.inst.page();

  return {mount, api, pages, keep, release, keptPage};
})();
