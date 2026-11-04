# Стенд доски v55 — проверки (`_test/`)

Проверки доски `assets/board.js` актуальной версии (v55, ветка `fix/board-live`) в реальном
браузере, без npm. Поднимается статический сервер (`serve.mjs`), запускается локальный
Chrome/Edge через DevTools Protocol (`cdp.mjs`), на странице `_test/board.html` монтируются
**две доски** с общим in-memory api и fake-каналом (broadcast + presence):

- `teacher` — 1100 px (масштаб ≈ 1.25…1.31), `student` — 380 px (масштаб ≈ 0.41);
- `window.__boards = {teacher, student}` — результаты `Board.mount()`;
- `window.__board` — хелперы стенда (см. `board-harness.js`): логические координаты
  (`point/logicalRect/ink`), кнопки/инструменты (`findButton/clickButton/toolbarText/setTool`),
  редактор (`textEditor/editorFocused/editorBoxNow`), якоря (`shiftLayout/relayout`,
  `elementAtAnchor/elementUnderPoint`), листы (`pageButtons/pageKeys/openPage/waitPage`),
  api (`dump/seed/clearStore`), вложения (`attachFiles`), хуки доски (`info/debug/whenIdle`),
  журнал канала (`channelLog/channelHas/clearLog/waitChannel`);
- **«живой урок»** (`mountLiveBoth/mountLiveTeacher/mountLiveStudent`): у `teacher` свой HTML
  листа с маркером `TEACHER-KEYS` (длиннее, другие блоки), у `student` — `STUDENT-SHEET`
  (другой набор/порядок/высота). Это повторяет реальный раскол `roomPane` (учитель) vs
  `lessonPane` (ученик), из-за которого раньше «съезжала» доска;
- хелперы единого фона: `bgEl/bgHtml/bgSource/bgDebug`, ожидания `waitBgSource/waitBgContains`,
  отрисовка листа в detached-контейнер `liveRenderDetached` (ответ на `bgreq`).

## Запуск

```bash
cd repetitor-live
node _test/board.mjs            # headless: сервер + Chrome + все проверки
node _test/run.mjs              # то же самое
```

Полезные переменные окружения:

| Переменная      | По умолчанию | Что делает                                       |
|-----------------|--------------|--------------------------------------------------|
| `BOARD_HEADLESS`| `1`          | `0` — показать окно браузера                     |
| `BOARD_ONLY`    | (все)        | фильтр по id: `C`, `D`, `E`, `D2,E1`, `F`, `G`   |
| `PORT`          | `8765`       | порт статического сервера                        |
| `CDP_PORT`      | `9333`       | порт удалённой отладки Chrome                    |
| `CHROME`        | авто         | путь к chrome.exe/msedge.exe                     |

Итог: `PASS`/`FAIL` по каждому сценарию и строка
`Итог по доске v55: N/M PASS`. Скриншоты падений — `_test/artifacts/board-<ID>.png`
(каталог создаётся только при падении). Код выхода: `0` — всё прошло, `1` — есть падения,
`2` — стенд не поднялся.

**Ограничение:** в части сессий субагента Chrome не стартует (mojo/named pipes).
В этом окружении прогон из subagent-сессии проходит: **15/15 PASS** (2026-11-04,
board.js v55 + единый фон/bg + якоря в пустоте). Если Chrome не поднимается — стенд
запускает Lead/пользователь обычной командой из консоли; в сессии субагента тогда
доступна только проверка синтаксиса: `node --check _test/*.mjs` (и `board-harness.js`).

## Что покрывается

| id    | Сценарий |
|-------|----------|
| A0    | обе доски монтируются, листы рендерятся, fake-presence видит обе стороны (`.bd-who`) |
| SMOKE | v55: нет исключений, инструменты (pen/hl/text/erase/hand/touch/move ✥), кнопки attach/embed, кнопка снимка 📸, `info().ready/width/anchors`, `Board.keep()` переиспользует инстанс; **затем включается bg-режим** — инструменты/кнопки/📸 и `_pages` (addPage) не сломаны, `info().bgSource` в `remote\|own\|static` |
| B1    | штрих учителя появляется у ученика через broadcast |
| C     | якорь: ученик подчёркивает предложение при сдвинутом макете учителя (padding-top листа) — штрих на том же тексте; после `remount` — снова на тексте |
| D1    | две картинки через диалог «Куда выгрузить материал?» → «На этот лист»: не накладываются, видны ученику, живы после `remount` |
| D2    | инструмент ✥ двигает картинку (x+90, y+70): позиция сохраняется, вторая сторона видит, жива после `remount` |
| D3    | PDF через «Отдельными листами»: доп. листы в api `"_pages"` (строки `{t:"pg",...}`), видны обеим сторонам, живы после `remount` |
| D4    | большой лист (>55k html): html обрезан ≤55000, **одинаков** у обеих сторон, сохранён в `"_pages"`, жив после `remount` |
| E1    | текст: инструмент T → тап по листу → `.bd-editor` существует и в фокусе, ввод, drag ручки `.bd-editor-handle`, Enter → надпись `{t:"t",...}` на листе, видна учителю |
| E2    | надпись переживает `remount` |
| **F1** | **единый фон живого листа**: учитель открыл лист первым (свой `TEACHER-KEYS`), ученик отрисовал свой → по каналу `bg` фон учителя становится HTML ученика (`STUDENT-SHEET` есть, `TEACHER-KEYS` нет), `info().bgSource==="remote"`, `debug().remoteBgPages` содержит `theory`, ученик чужой фон не применяет |
| **F2** | **рисунок совпадает**: на общем фоне ученик рисует штрих в ПУСТОМ месте (ниже `#student-sent` на 80 лог. px) → у учителя штрих в том же месте: координаты bbox (Δ<8 лог. px), тот же якорь (абзац `#student-sent`) и тот же элемент под краской; фон учителя = ученика |
| **F3** | **обратно**: учитель рисует на общем фоне (над `#student-sent`) → у ученика те же координаты/якорь/элемент, видит без перезагрузки |
| **F4** | **запрос фона**: ученик не открывал лист (сидит на `p2`), но отдаёт его по `bgreq` из detached-контейнера → учитель получает `STUDENT-SHEET`; вариант «без ученика»: учитель остаётся на своём `TEACHER-KEYS` (`bgSource` ≠ remote), запрос не даёт исключений |
| **G**  | **якоря в пустоте**: на статическом листе штрих нарисован в пустом промежутке между абзацами (ниже `.sentence`); у принимающей стороны вставляется абзац + `refresh/relayout` → штрих остаётся привязан к ближайшему абзацу (уезжает ровно на сдвиг макета, не остаётся на абсолютном месте и не попадает на чужой текст); якорь — `P.sentence`, а не корень `.bd-sheet` |

## Живой фон листа (`bg` / `bgreq`)

На уроке доска — это «живые» листы: `teacher.js` рисует лист через `roomPane()` (с ключами
и ответами, `TEACHER-KEYS`), `student.js` — через `lessonPane()` (`STUDENT-SHEET`). HTML
разный, поэтому одинаковые координаты штриха попадали в разные места. Стенд эмулирует это
двумя live-наборами и проверяет механизм выравнивания:

- ученик после каждой отрисовки live-листа отправляет по каналу
  `send("bg", {page, html, rev})` (с дебаунсом ~240 мс, без повторов и без отправки учителем);
- учитель, получив `bg`, сохраняет html в `remoteBg` и, если лист открыт, рисует ровно его
  (`bgSource==="remote"`); своего HTML он не отправляет никогда;
- если у учителя для листа ещё нет `remoteBg`, он рисует свой live-лист и шлёт
  `send("bgreq", {page})` (с повтором через ~900 мс); ученик отвечает `bg` даже для не
  открытого листа, отрисовав его в detached-`div`; без ученика учитель остаётся на своём фоне;
- проверки: `board.mjs` F1–F4 (см. таблицу), наблюдаемость — `info().bgSource`,
  `debug().remoteBgPages`, журнал фейкового канала (`__board.channelLog("bg")`).

Важно: в live-режиме `openPage` включает инструмент 👆 `touch` (canvas не перехватывает
события), поэтому перед рисованием тесты явно выбирают инструмент `setTool(side,"pen")`.

## Контракт board.js, на который рассчитаны проверки

`Board.mount(root, opts)` возвращает (помимо существующего API v55):

- `info()` → `{ready, page, scale, width:800, height, saving, anchors, bgSource, items:[{id,t,x,y,w,h,s,p,a}], pages:[{key,label,htmlLen,saved}], pageHtmlLen, editor}`,
  где `bgSource` ∈ `"remote" | "own" | "static"` (что сейчас на фоне живого листа);
- `debug()` → то же + `raw`, `anchorBoxes` и `remoteBgPages` (страницы, полученные от ученика);
- `whenIdle()` — дождаться окончания сохранений (и загрузки);
- `attach(files)` — принять `File[]`, показать диалог `.bd-dialog` (промис может резолвиться после выбора);
- `addPage(label, html, broadcast)` → `key`; html обрезается ≤55000 **синхронно** до broadcast/сохранения;
  сохраняется через `api.add("_pages", {t:"pg",key,label,html})`;
- `openPage(key)`, `refresh()` (перемерить якоря/боксы и перерисовать), `destroy()`, `ready()` (опционально).

`opts.live` — карта `{pageKey: host => { host.innerHTML = … }}` (функция обязана работать и на
detached-элементе: её зовут для ответа на `bgreq`). `opts.role` ∈ `"teacher" | "student"`
определяет, кто отдаёт фон, а кто его принимает.

DOM-селекторы, которые используют тесты: `.bd-cv`, `.bd-bg .bd-sheet`, `.bd-bg [data-bd]`,
`[data-bpage]` (`aria-pressed` у текущего), `.bd-who`, `[data-tool]`, `[data-act]`,
`.bd-dialog` (`[data-bd-dest="inline"|"pages"]`), `.bd-editor` + `.bd-editor-ta` + `.bd-editor-handle`.

Тесты пишутся под этот контракт: если `board.js` переименует селекторы/хуки — правится
`board-harness.js`/`board.mjs`, а не продуктовый код.

## Файлы

- `cdp.mjs` — мини-драйвер CDP (Chrome, мышь/клавиатура, `Runtime.evaluate`, скриншоты);
- `serve.mjs` — статический сервер корня worktree (без кэша);
- `board.html` — страница стенда: `app.css` + `assets/board.js` + `board-harness.js`,
  заглушки `pdfjsLib`/`html2canvas`/`U`;
- `board-harness.js` — доски (статический и live-режим), fake-api/канал, хелперы;
- `board.mjs` — сценарии, раннер, фикстуры (png/pdf генерируются локально);
- `run.mjs` — простой запуск `board.mjs`;
- `artifacts/` — скриншоты падений (создаётся при падении).
