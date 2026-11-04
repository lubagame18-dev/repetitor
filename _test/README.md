# Стенд доски v54 — проверки (`_test/`)

Проверки доски `assets/board.js` новой версии (v54) в реальном браузере, без npm.
Поднимается статический сервер (`serve.mjs`), запускается локальный Chrome/Edge через
DevTools Protocol (`cdp.mjs`), на странице `_test/board.html` монтируются **две доски**
с общим in-memory api и fake-каналом (broadcast + presence):

- `teacher` — 1100 px (масштаб ≈ 1.31), `student` — 380 px (масштаб ≈ 0.41);
- `window.__boards = {teacher, student}` — результаты `Board.mount()`;
- `window.__board` — хелперы стенда (см. `board-harness.js`): логические координаты
  (`point/logicalRect/ink`), кнопки/инструменты (`findButton/clickButton/toolbarText`),
  редактор (`textEditor/editorFocused/editorBoxNow`), якоря (`shiftLayout/relayout`),
  листы (`pageButtons/pageKeys/openPage`), api (`dump/seed/clearStore`),
  вложения (`attachFiles`), хуки доски (`info/whenIdle`).

## Запуск

```bash
cd repetitor-live
node _test/board.mjs            # headless: сервер + Chrome + все проверки
node _test/run.mjs              # то же самое
```

Полезные переменные окружения:

| Переменная      | По умолчанию | Что делает                                   |
|-----------------|--------------|----------------------------------------------|
| `BOARD_HEADLESS`| `1`          | `0` — показать окно браузера                 |
| `BOARD_ONLY`    | (все)        | фильтр по id: `C`, `D`, `E`, `D2,E1`, `smoke`|
| `PORT`          | `8765`       | порт статического сервера                    |
| `CDP_PORT`      | `9333`       | порт удалённой отладки Chrome                |
| `CHROME`        | авто         | путь к chrome.exe/msedge.exe                 |

Итог: `PASS`/`FAIL` по каждому сценарию и строка
`Итог по доске v54: N/M PASS`. Скриншоты падений — `_test/artifacts/board-<ID>.png`.
Код выхода: `0` — всё прошло, `1` — есть падения, `2` — стенд не поднялся.

**Ограничение:** в части сессий субагента Chrome не стартует (mojo/named pipes).
В этом окружении прогон из subagent-сессии прошёл: **10/10 PASS, три прогона подряд**
(2026-11-04, board.js/worktree v54 + порт правок). Если Chrome не поднимается — стенд
запускает Lead/пользователь обычной командой из консоли; в сессии субагента тогда
доступна только проверка синтаксиса: `node --check _test/*.mjs` (и `board-harness.js`).

## Что покрывается

| id    | Сценарий |
|-------|----------|
| A0    | обе доски монтируются, листы рендерятся, fake-presence видит обе стороны (`.bd-who`) |
| SMOKE | v54: нет исключений, есть инструменты (pen/hl/text/erase/hand/touch/move ✥), кнопки attach/snap/embed, `info().ready/width/anchors` |
| B1    | штрих учителя появляется у ученика через broadcast |
| C     | якорь: ученик подчёркивает предложение при сдвинутом макете учителя (padding-top листа) — штрих на том же тексте; после `remount` — снова на тексте |
| D1    | две картинки через диалог «Куда выгрузить материал?» → «На этот лист»: не накладываются, видны ученику, живы после `remount` |
| D2    | инструмент ✥ двигает картинку (x+90, y+70): позиция сохраняется, вторая сторона видит, жива после `remount` |
| D3    | PDF через «Отдельными листами»: доп. листы в api `"_pages"` (строки `{t:"pg",...}`), видны обеим сторонам, живы после `remount` |
| D4    | большой лист (>55k html): html обрезан ≤55000, **одинаков** у обеих сторон, сохранён в `"_pages"`, жив после `remount` |
| E1    | текст: инструмент T → тап по листу → `.bd-editor` существует и в фокусе, ввод, drag ручки `.bd-editor-handle`, Enter → надпись `{t:"t",...}` на листе, видна учителю |
| E2    | надпись переживает `remount` |

## Контракт board.js, на который рассчитаны проверки

`Board.mount(root, opts)` возвращает (помимо существующего API v54):

- `info()` → `{ready, page, scale, width:800, height, saving, anchors, items:[{id,t,x,y,w,h,s,p,a}], pages:[{key,label,htmlLen,saved}], pageHtmlLen, editor}`;
- `whenIdle()` — дождаться окончания сохранений (и загрузки);
- `attach(files)` — принять `File[]`, показать диалог `.bd-dialog` (промис может резолвиться после выбора);
- `addPage(label, html, broadcast)` → `key`; html обрезается ≤55000 **синхронно** до broadcast/сохранения;
  сохраняется через `api.add("_pages", {t:"pg",key,label,html})`;
- `openPage(key)`, `refresh()` (перемерить якоря/боксы и перерисовать), `destroy()`, `ready()` (опционально).

DOM-селекторы, которые используют тесты: `.bd-cv`, `.bd-bg .bd-sheet`, `[data-bpage]`
(`aria-pressed` у текущего), `.bd-who`, `[data-tool]`, `[data-act]`, `.bd-dialog`
(`[data-bd-dest="inline"|"pages"]`), `.bd-editor` + `.bd-editor-ta` + `.bd-editor-handle`.

Тесты пишутся под этот контракт: если `board.js` переименует селекторы/хуки — правится
`board-harness.js`/`board.mjs`, а не продуктовый код.

## Файлы

- `cdp.mjs` — мини-драйвер CDP (Chrome, мышь/клавиатура, `Runtime.evaluate`, скриншоты);
- `serve.mjs` — статический сервер корня worktree (без кэша);
- `board.html` — страница стенда: `app.css` + `assets/board.js` + `board-harness.js`,
  заглушки `pdfjsLib`/`html2canvas`/`U`;
- `board-harness.js` — доски, fake-api/канал, хелперы;
- `board.mjs` — сценарии, раннер, фикстуры (png/pdf генерируются локально);
- `run.mjs` — простой запуск `board.mjs`;
- `artifacts/` — скриншоты падений (создаётся при падении).
